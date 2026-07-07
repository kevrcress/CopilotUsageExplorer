import type { ParsedSession } from './types';
import { rollupSession, formatTokens, computeAiCredits } from './tokens';
import { modelTier, tierLabel } from './models';

/** Host-agnostic icon key for a recommendation. The UI layer maps these keys
 *  to actual icon components (see packages/ui/src/icons.ts); core stays pure. */
export type RecommendationIconKey =
  | 'trending-down'
  | 'zap'
  | 'message-square'
  | 'wrench'
  | 'alert-triangle'
  | 'layers'
  | 'target'
  | 'lightbulb';

export interface Recommendation {
  icon: RecommendationIconKey;
  title: string;
  text: string;
  impact: string;
  /** 'finding' = derived from a detected pattern; 'general' = always-on tips. */
  kind: 'finding' | 'general';
}

export interface InsightsResult {
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalLlmCalls: number;
  totalToolCalls: number;
  totalWastedTokens: number;
  totalFailedToolCalls: number;
  /** Sum of copilotUsageNanoAiu across all sessions in the list. Null when none of the
   *  loaded logs captured that field, so the UI can omit the stat instead of showing 0. */
  totalAiCredits: number | null;
  modelRows: Array<{ model: string; calls: number; inputTokens: number; outputTokens: number; tier: string; tokens: number; avgInputPerCall: number }>;
  toolRows: Array<{ tool: string; calls: number; failed: number }>;
  bgModels: Array<{ model: string; calls: number; totalTokens: number }>;
  contextGrowthFactor: number;
  recommendations: Recommendation[];
  /** Only the pattern-derived recommendations (excludes the always-on general tips). */
  findings: Recommendation[];
  sessionCount: number;
}

/** Compute usage insights + the optimization recommendation set for a list of
 *  sessions. Pure: every number comes straight from the debug logs. */
export function computeInsights(list: ParsedSession[]): InsightsResult | null {
  if (list.length === 0) return null;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCachedTokens = 0;
  let totalLlmCalls = 0;
  let totalToolCalls = 0;
  let totalWastedTokens = 0;
  let totalAiCredits = 0;
  let anyAiCredits = false;

  const contextGrowthSamples: number[] = [];
  const modelUsage = new Map<string, { calls: number; inputTokens: number; outputTokens: number; tier: string }>();
  const toolUsage = new Map<string, { calls: number; failed: number }>();
  const backgroundModels = new Map<string, { calls: number; totalTokens: number }>();

  let totalTurns = 0;
  let highTurnSessions = 0;
  let totalFailedToolCalls = 0;
  let frontierTrivialCalls = 0;
  let frontierTotalCalls = 0;
  let lightweightCalls = 0;
  let totalCacheBoundaryHits = 0;

  for (const s of list) {
    const rollup = rollupSession(s);
    totalInputTokens += rollup.totalInputTokens;
    totalOutputTokens += rollup.totalOutputTokens;
    totalCachedTokens += rollup.totalCachedTokens ?? 0;
    totalLlmCalls += rollup.llmCalls;
    totalWastedTokens += rollup.wastedTokens;
    const aic = computeAiCredits(s);
    if (aic !== null) {
      totalAiCredits += aic;
      anyAiCredits = true;
    }

    totalTurns += s.turns.length;
    if (s.turns.length >= 20) highTurnSessions++;

    for (const tool of s.toolCalls) {
      totalToolCalls++;
      const tUsage = toolUsage.get(tool.name) ?? { calls: 0, failed: 0 };
      tUsage.calls++;
      if (tool.status === 'error') {
        tUsage.failed++;
        totalFailedToolCalls++;
      }
      toolUsage.set(tool.name, tUsage);
    }

    for (const call of s.llmCalls) {
      contextGrowthSamples.push(call.inputTokens);
      totalCacheBoundaryHits += call.cacheBoundaryHits;

      const tier = modelTier(call.model);
      if (tier === 'lightweight') lightweightCalls++;
      if (tier === 'frontier') {
        frontierTotalCalls++;
        if (call.outputTokens < 200 && call.inputTokens < 2000) frontierTrivialCalls++;
      }

      if (call.outputTokens < 50 && call.inputTokens < 500) {
        const bg = backgroundModels.get(call.model) ?? { calls: 0, totalTokens: 0 };
        bg.calls++;
        bg.totalTokens += call.inputTokens + call.outputTokens;
        backgroundModels.set(call.model, bg);
      }
    }

    for (const m of rollup.byModel) {
      const mu = modelUsage.get(m.model) ?? { calls: 0, inputTokens: 0, outputTokens: 0, tier: '' };
      mu.calls += m.calls;
      mu.inputTokens += m.inputTokens;
      mu.outputTokens += m.outputTokens;
      mu.tier = tierLabel(modelTier(m.model));
      modelUsage.set(m.model, mu);
    }
  }

  const totalTokens = totalInputTokens + totalOutputTokens;
  const modelRows = Array.from(modelUsage.entries())
    .map(([model, stats]) => ({ model, ...stats, tokens: stats.inputTokens + stats.outputTokens, avgInputPerCall: Math.round(stats.inputTokens / stats.calls) }))
    .sort((a, b) => b.tokens - a.tokens);

  const toolRows = Array.from(toolUsage.entries())
    .map(([tool, stats]) => ({ tool, ...stats }))
    .sort((a, b) => b.calls - a.calls);

  const firstQuarter = contextGrowthSamples.slice(0, Math.ceil(contextGrowthSamples.length / 4));
  const lastQuarter = contextGrowthSamples.slice(-Math.ceil(contextGrowthSamples.length / 4));
  const avgFirst = firstQuarter.length > 0 ? firstQuarter.reduce((a, b) => a + b, 0) / firstQuarter.length : 0;
  const avgLast = lastQuarter.length > 0 ? lastQuarter.reduce((a, b) => a + b, 0) / lastQuarter.length : 0;
  const contextGrowthFactor = avgFirst > 0 ? avgLast / avgFirst : 1;

  const bgModels = Array.from(backgroundModels.entries())
    .filter(([, v]) => v.calls >= 1)
    .map(([model, stats]) => ({ model, ...stats }));

  const findings: Recommendation[] = [];

  // 1. Context window accumulation
  if (contextGrowthFactor > 3) {
    findings.push({
      icon: 'message-square',
      kind: 'finding',
      title: `Input tokens grew ${contextGrowthFactor.toFixed(0)}× from start to end of chat`,
      text: `Each new message resends the full conversation history, so token usage compounds as a chat lengthens. Two focused 10-turn chats send less total history than one 20-turn chat covering the same ground.`,
      impact: `Start new chats more often. Break tasks into focused conversations instead of one marathon session.`,
    });
  }

  // 2. Frontier model usage analysis
  const frontierModels = modelRows.filter((m) => modelTier(m.model) === 'frontier');
  if (frontierModels.length > 0) {
    const frontierTokens = frontierModels.reduce((a, m) => a + m.tokens, 0);
    const frontierPct = totalTokens > 0 ? ((frontierTokens / totalTokens) * 100).toFixed(0) : '0';
    findings.push({
      icon: 'trending-down',
      kind: 'finding',
      title: `Frontier models account for ${frontierPct}% of your tokens`,
      text: `${frontierModels.map((m) => `${m.model} (${m.calls} calls, avg ${formatTokens(m.avgInputPerCall)} input/call)`).join('; ')}. Frontier models typically process several times more tokens per call than versatile ones.`,
      impact: `Route routine tasks to a versatile or lightweight model. Reserve frontier models for complex multi-step reasoning.`,
    });
  }

  // 3. Tool call analysis
  if (totalToolCalls > 20) {
    const failedTools = toolRows.filter((t) => t.failed > 0);
    findings.push({
      icon: 'wrench',
      kind: 'finding',
      title: `${totalToolCalls} tool calls — each adds tokens to context`,
      text: `Top tools: ${toolRows.slice(0, 5).map((t) => `${t.tool} (${t.calls}${t.failed > 0 ? `, ${t.failed} failed` : ''})`).join(', ')}. Every tool call adds its result to the conversation, growing the context for all subsequent calls.${failedTools.length > 0 ? ` Failed calls (${failedTools.reduce((a, t) => a + t.failed, 0)} total) add error-message tokens without adding useful context.` : ''}`,
      impact: `Be specific in requests to reduce back-and-forth. Disable tools you don't need (Configure Tools). Avoid exploratory searches when you already know the answer.`,
    });
  }

  // 4. Input/output ratio
  const ioRatio = totalInputTokens / Math.max(1, totalOutputTokens);
  if (ioRatio > 50) {
    findings.push({
      icon: 'zap',
      kind: 'finding',
      title: `Input-to-output ratio is ${ioRatio.toFixed(0)}:1`,
      text: `${formatTokens(totalInputTokens)} input vs ${formatTokens(totalOutputTokens)} output. Most tokens go to resending system prompts, conversation history, and tool results, not the model's generated responses.`,
      impact: `Shorter chats = less re-reading. Starting fresh resets the context window to zero.`,
    });
  }

  // 5. Prompt-chipping detection
  if (totalTurns > 10 && totalLlmCalls > 0) {
    const avgOutputPerCall = totalOutputTokens / totalLlmCalls;
    if (avgOutputPerCall < 200) {
      findings.push({
        icon: 'alert-triangle',
        kind: 'finding',
        title: `Avg ${Math.round(avgOutputPerCall)} output tokens/call across ${totalTurns} turns`,
        text: `A low average often comes from instructions sent piecemeal ("do A" → "now B" → "actually C") rather than consolidated up front. Every message re-sends the entire conversation, so even a short follow-up reprocesses everything before it — three drip-fed messages cost roughly three times the re-processing of one consolidated message.`,
        impact: `Front-load intent, constraints, and output format in your first message. Consolidate instructions instead of drip-feeding.`,
      });
    }
  }

  // 6. Lightweight-model lane awareness
  if (totalLlmCalls > 10 && lightweightCalls === 0) {
    findings.push({
      icon: 'layers',
      kind: 'finding',
      title: 'Lightweight lane unused — everything ran on versatile/frontier models',
      text: `All ${totalLlmCalls} LLM calls used versatile or frontier models. Lightweight models (e.g. GPT-5 mini, Gemini Flash, Haiku) use far fewer tokens of budget per task. Strategy discussions, confirmations, log analysis, and task decomposition rarely need a heavier model.`,
      impact: `Use a "two-lane" approach: route Q&A and planning to lightweight models, reserve versatile/frontier models for execution. Model switching is one click in VS Code.`,
    });
  }

  // 7. Frontier model used for trivial tasks
  if (frontierTotalCalls > 0 && frontierTrivialCalls >= 3) {
    const trivialPct = ((frontierTrivialCalls / frontierTotalCalls) * 100).toFixed(0);
    findings.push({
      icon: 'target',
      kind: 'finding',
      title: `${trivialPct}% of frontier-model calls were trivial (<200 output tokens)`,
      text: `${frontierTrivialCalls} of ${frontierTotalCalls} frontier calls produced tiny responses — likely simple Q&A, confirmations, or title generation, yet each ran on a heavy model.`,
      impact: `Use a lighter model (e.g. Haiku) for quick questions and confirmations. Reserve frontier models for complex multi-step reasoning where their power is actually needed.`,
    });
  }

  // 8. High turn count sessions
  if (highTurnSessions > 0) {
    findings.push({
      icon: 'message-square',
      kind: 'finding',
      title: `${highTurnSessions} session${highTurnSessions > 1 ? 's' : ''} with 20+ turns`,
      text: `Long threads risk approaching the context limit, where earlier information can get trimmed and constraints may need re-explaining — each re-explanation re-sends the full conversation again.`,
      impact: `Rule of thumb: 1 task = 1 thread. At breakpoints, start a new chat with a brief summary of decisions so far. This resets context to zero.`,
    });
  }

  // 9. Failed tool calls
  if (totalFailedToolCalls >= 5) {
    const failRate = ((totalFailedToolCalls / totalToolCalls) * 100).toFixed(0);
    findings.push({
      icon: 'alert-triangle',
      kind: 'finding',
      title: `${totalFailedToolCalls} failed tool calls (${failRate}% failure rate)`,
      text: `Each failed tool call injects an error message into context, growing it for all subsequent calls. It also often triggers automatic retries — doubling the tokens spent on the same task.`,
      impact: `Be precise with file paths and symbol names. If Copilot is searching for something you already know, tell it directly (e.g., "in src/auth/login.ts" instead of "find the auth file").`,
    });
  }

  // 10. Cache boundary utilization
  if (totalLlmCalls > 20 && totalCacheBoundaryHits === 0) {
    findings.push({
      icon: 'zap',
      kind: 'finding',
      title: 'No prompt caching detected across sessions',
      text: `Across ${totalLlmCalls} LLM calls, no cache boundary hits were observed. Prompt caching reuses previously-sent context at a discount, reducing the effective cost of input tokens.`,
      impact: `This is largely automatic (depends on model/provider support), but shorter, more consistent system prompts and avoiding long mid-session gaps improve cache hit rates.`,
    });
  }

  // 11. General tips (always shown)
  const general: Recommendation = {
    icon: 'lightbulb',
    kind: 'general',
    title: 'General tips for reducing usage',
    text: `• Use completions first — autocomplete and Next Edit Suggestions are free\n• Start new chats frequently — don't let one chat grow to 50+ turns\n• Pick the right model: lightweight for syntax/Q&A, versatile for dev work, frontier sparingly\n• Be precise: "edit line 42 of foo.ts" sends less than "find and fix the bug"\n• Close unnecessary editor tabs — open files are included with every request\n• Use Ask/Plan modes when you don't need Agent mode (Agent uses the most)\n• Use /compact on long chats so history is summarized instead of fully re-sent\n• Disable tools you don't need (Configure Tools) to trim tool-schema overhead\n• Externalize project conventions to .github/copilot-instructions.md instead of repeating them`,
    impact: `These habits can substantially cut your token usage with no loss of productivity.`,
  };

  return {
    totalTokens,
    totalInputTokens,
    totalOutputTokens,
    totalCachedTokens,
    totalLlmCalls,
    totalToolCalls,
    totalWastedTokens,
    totalFailedToolCalls,
    totalAiCredits: anyAiCredits ? totalAiCredits : null,
    modelRows,
    toolRows,
    bgModels,
    contextGrowthFactor,
    recommendations: [...findings, general],
    findings,
    sessionCount: list.length,
  };
}

function ymd(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface AnalyticsResult {
  rangeTokens: number;
  rangeInputTokens: number;
  rangeOutputTokens: number;
  projectedTokens: number | null;
  dayRows: Array<{ day: string; input: number; output: number; calls: number }>;
  modelRows: Array<{ model: string; tokens: number; calls: number; in: number; out: number }>;
  wsRows: Array<{ workspace: string; tokens: number; sessions: number }>;
  top10: Array<{ id: string; startedAt: number; tokens: number; llmCalls: number }>;
  wasted: number;
  failedToolCalls: number;
  avgInputBloat: number;
}

/** Time-bucketed analytics (daily/model/workspace/top sessions) for the charts. */
export function computeAnalytics(
  list: ParsedSession[],
  opts: { workspaceNames: Record<string, string>; dateRangeStart: number | null; dateRangeEnd: number | null; dateRangeLabel: string }
): AnalyticsResult {
  const { workspaceNames, dateRangeStart, dateRangeEnd, dateRangeLabel } = opts;
  const now = Date.now();
  const rangeEnd = dateRangeEnd ?? now;

  let rangeInputTokens = 0;
  let rangeOutputTokens = 0;
  const perDay = new Map<string, { input: number; output: number; calls: number }>();
  const perModel = new Map<string, { tokens: number; calls: number; in: number; out: number }>();
  const perWorkspace = new Map<string, { tokens: number; sessions: number }>();
  const sessionRollups = list.map((s) => ({ s, r: rollupSession(s) }));

  for (const { s } of sessionRollups) {
    const wsKey = s.workspaceHash ?? 'unknown';
    if (!perWorkspace.has(wsKey)) perWorkspace.set(wsKey, { tokens: 0, sessions: 0 });
    perWorkspace.get(wsKey)!.sessions += 1;

    for (const c of s.llmCalls) {
      if (dateRangeStart !== null && c.ts < dateRangeStart) continue;
      if (c.ts > rangeEnd) continue;

      const day = ymd(c.ts);
      const tokens = c.inputTokens + c.outputTokens;

      const dAgg = perDay.get(day) ?? { input: 0, output: 0, calls: 0 };
      dAgg.input += c.inputTokens;
      dAgg.output += c.outputTokens;
      dAgg.calls += 1;
      perDay.set(day, dAgg);

      const mAgg = perModel.get(c.model) ?? { tokens: 0, calls: 0, in: 0, out: 0 };
      mAgg.tokens += tokens;
      mAgg.calls += 1;
      mAgg.in += c.inputTokens;
      mAgg.out += c.outputTokens;
      perModel.set(c.model, mAgg);

      perWorkspace.get(wsKey)!.tokens += tokens;

      rangeInputTokens += c.inputTokens;
      rangeOutputTokens += c.outputTokens;
    }
  }

  const rangeTokens = rangeInputTokens + rangeOutputTokens;

  let projectedTokens: number | null = null;
  if (dateRangeLabel === 'This Month' && dateRangeStart !== null) {
    const daysElapsed = Math.max(1, Math.ceil((now - dateRangeStart) / 86_400_000));
    const d = new Date(dateRangeStart);
    const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    projectedTokens = (rangeTokens / daysElapsed) * daysInMonth;
  }

  const dayRows = Array.from(perDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, v]) => ({ day, ...v }));
  const modelRows = Array.from(perModel.entries())
    .map(([model, v]) => ({ model, ...v }))
    .sort((a, b) => b.tokens - a.tokens);
  const wsRows = Array.from(perWorkspace.entries())
    .map(([k, v]) => ({ workspace: workspaceNames[k] ?? k, ...v }))
    .sort((a, b) => b.tokens - a.tokens);

  const top10 = sessionRollups
    .sort((a, b) => b.r.totalTokens - a.r.totalTokens)
    .slice(0, 10)
    .map(({ s, r }) => ({ id: s.id, startedAt: s.startedAt, tokens: r.totalTokens, llmCalls: r.llmCalls }));

  const wasted = sessionRollups.reduce((acc, x) => acc + x.r.wastedTokens, 0);
  const failedToolCalls = list.reduce((a, s) => a + s.toolCalls.filter((t) => t.status === 'error').length, 0);

  const turnAverages = sessionRollups
    .filter(({ s }) => s.turns.length > 0 && s.llmCalls.length > 0)
    .map(({ s, r }) => r.totalInputTokens / s.turns.length);
  const avgInputBloat = turnAverages.length > 0 ? turnAverages.reduce((a, b) => a + b, 0) / turnAverages.length : 0;

  return {
    rangeTokens, rangeInputTokens, rangeOutputTokens, projectedTokens,
    dayRows, modelRows, wsRows, top10, wasted, failedToolCalls, avgInputBloat,
  };
}
