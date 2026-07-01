import type { ParsedSession } from './types';

/** Per-session token aggregation. Every field comes straight from the debug
 *  log — no pricing, no estimates. */
export interface SessionTokenRollup {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens?: number;
  totalTokens: number;
  llmCalls: number;
  byModel: Array<{ model: string; calls: number; inputTokens: number; outputTokens: number }>;
  errorCount: number;
  /** Sum of input+output tokens for llm_request events that ended with status=error. */
  wastedTokens: number;
  /** Count of cache_control:ephemeral markers seen across input payloads. */
  cacheBoundaryHits: number;
}

export function rollupSession(session: ParsedSession): SessionTokenRollup {
  const byModelMap = new Map<string, SessionTokenRollup['byModel'][number]>();
  let totalIn = 0;
  let totalOut = 0;
  let totalCached = 0;
  let wasted = 0;
  let cacheHits = 0;

  for (const call of session.llmCalls) {
    totalIn += call.inputTokens;
    totalCached += (call.cachedTokens ?? 0);
    totalOut += call.outputTokens;
    cacheHits += call.cacheBoundaryHits;
    if (call.status === 'error') wasted += call.totalTokens;

    const cur = byModelMap.get(call.model) ?? {
      model: call.model,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    cur.calls += 1;
    cur.inputTokens += call.inputTokens;
    cur.outputTokens += call.outputTokens;
    byModelMap.set(call.model, cur);
  }

  return {
    totalInputTokens: totalIn,
    totalOutputTokens: totalOut,
      totalCachedTokens: totalCached,
    totalTokens: totalIn + totalOut,
    llmCalls: session.llmCalls.length,
    byModel: Array.from(byModelMap.values()).sort(
      (a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens)
    ),
    errorCount: session.errors.length,
    wastedTokens: wasted,
    cacheBoundaryHits: cacheHits,
  };
}

/** Sum of copilotUsageNanoAiu (AI Credits × 1e9) across llm_request events, when
 *  the log includes it. Returns null rather than 0 when the field is absent, so
 *  callers can omit the stat instead of showing a fabricated zero. */
export function computeAiCredits(session: ParsedSession): number | null {
  let sum = 0;
  let found = false;
  for (const call of session.llmCalls) {
    const v = call.raw.attrs.copilotUsageNanoAiu;
    if (typeof v === 'number') {
      sum += v;
      found = true;
    }
  }
  return found ? sum / 1e9 : null;
}

export function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
