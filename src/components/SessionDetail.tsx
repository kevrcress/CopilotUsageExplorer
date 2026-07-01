import { useMemo, useState } from 'react';
import { ArrowLeft, Download, AlertCircle, ChevronDown, ChevronRight, Columns2, PanelLeftClose, PanelRightClose, Database } from 'lucide-react';
import type { ParsedSession, LlmCall, ToolCallSummary, RawEvent, Turn } from '@/lib/types';
import { useAppStore } from '@/lib/store';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { formatTokens, rollupSession, computeAiCredits } from '@/lib/tokens';
import { modelTier, tierLabel, tierBadgeVariant } from '@/lib/models';
import { formatDuration, getSessionDisplayTitle } from '@/lib/utils';
import { heuristicTokenCount } from '@/lib/tokenizer';
import { AreaChart, Area, PieChart, Pie, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import { downloadFile, exportSessionHtml, exportSessionJson } from '@/lib/export';
import { redactBody, redactString } from '@/lib/redact';

type TabId = 'conversation' | 'context' | 'tools' | 'timeline' | 'subagents';

export function SessionDetail({ session, onBack }: { session: ParsedSession; onBack: () => void }) {
  const { redact, sessions, workspaceNames, selectSession } = useAppStore();
  const [tab, setTab] = useState<TabId>('conversation');
  const rollup = useMemo(() => rollupSession(session), [session]);
  const wsName = session.workspaceHash ? workspaceNames[session.workspaceHash] : undefined;

  const jumpToTurn = (turnId: string) => {
    setTab('conversation');
    // The Conversation tab's content unmounts when inactive, so give it a tick to mount before scrolling.
    setTimeout(() => {
      document.getElementById(`turn-${turnId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  };

  const childSessions = session.childSessionRefs
    .map((r) => Object.values(sessions).find((s) => s.id === r.childSessionId))
    .filter((x): x is ParsedSession => !!x);

  const exportHtml = () => {
    downloadFile(`session-${session.id}.html`, exportSessionHtml(session, workspaceNames, redact), 'text/html;charset=utf-8');
  };
  const exportJson = () => {
    downloadFile(`session-${session.id}.json`, exportSessionJson(session, redact), 'application/json');
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <div className="flex-1 min-w-0">
          {(() => {
            const displayTitle = redact ? null : getSessionDisplayTitle(session);
            return displayTitle ? (
              <>
                <div className="text-sm font-semibold truncate" title={displayTitle}>{displayTitle}</div>
                <div className="text-xs text-muted-foreground font-mono">{redact ? '[redacted]' : session.id}</div>
              </>
            ) : (
              <div className="text-sm font-semibold font-mono">{redact ? '[redacted-session]' : session.id}</div>
            );
          })()}
          <div className="text-xs text-muted-foreground">
            {new Date(session.startedAt).toLocaleString()} · {formatDuration(session.durationMs)} ·{' '}
            {wsName ?? session.workspaceHash ?? 'unknown workspace'} · Copilot {session.copilotVersion ?? '?'} · VS Code{' '}
            {session.vscodeVersion ?? '?'}
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={exportHtml}>
          <Download className="h-4 w-4" />HTML report
        </Button>
        <Button size="sm" variant="outline" onClick={exportJson}>
          <Download className="h-4 w-4" />JSON
        </Button>
      </div>

      {/* KPI strip — every metric is for THIS SESSION ONLY (cumulative across all turns). */}
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        Totals for this session
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Kpi label="Turns" value={session.turns.length.toString()} hint="User → assistant exchanges in this session." />
        <Kpi label="LLM calls" value={rollup.llmCalls.toString()} hint="Total model invocations. One turn can trigger multiple LLM calls (tool-use loops, retries)." />
        <Kpi label="Input tokens" sublabel="sent to model" value={formatTokens(rollup.totalInputTokens)} hint="Sum of inputTokens across every llm_request in this session, as reported by Copilot in the debug log." highlight />
        <Kpi label="Output tokens" sublabel="generated" value={formatTokens(rollup.totalOutputTokens)} hint="Sum of outputTokens across every llm_request in this session, as reported by Copilot in the debug log." highlight />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)} className="flex flex-1 flex-col overflow-hidden">
        <TabsList className="self-start">
          <TabsTrigger value="conversation">Conversation</TabsTrigger>
          <TabsTrigger value="context">Context &amp; Optimization</TabsTrigger>
          <TabsTrigger value="tools">Tool calls</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="subagents">Subagents</TabsTrigger>
        </TabsList>

        <div className="mt-3 flex-1 overflow-auto">
          <TabsContent value="conversation" className="h-full"><ConversationPanel session={session} redact={redact} /></TabsContent>
          <TabsContent value="context"><ContextOptimizationPanel session={session} rollup={rollup} onJumpToTurn={jumpToTurn} /></TabsContent>
          <TabsContent value="tools"><ToolCallsPanel session={session} redact={redact} /></TabsContent>
          <TabsContent value="timeline"><TimelinePanel session={session} redact={redact} /></TabsContent>
          <TabsContent value="subagents"><SubagentsPanel session={session} children={childSessions} onOpen={(id) => selectSession(id)} /></TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

function Kpi({ label, value, sublabel, hint, highlight = false }: { label: string; value: string; sublabel?: string; hint?: string; highlight?: boolean }) {
  return (
    <Card className={highlight ? 'border-primary/40' : ''} title={hint}>
      <CardContent className="p-3">
        <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          <span>{label}</span>
          {hint && <span className="cursor-help text-muted-foreground/60" aria-label={hint}>ⓘ</span>}
        </div>
        <div className={`text-lg font-semibold ${highlight ? 'text-primary' : ''}`}>{value}</div>
        {sublabel && <div className="text-[10px] text-muted-foreground">{sublabel}</div>}
      </CardContent>
    </Card>
  );
}

// ----- Context & Optimization -----
// Merges what were previously separate Overview / Optimize / System prompt / Customizations
// tabs. Every card is measured directly from this session's log — no diagnosis, just facts —
// tagged against the numbered strategies from the "Copilot Optimization Strategies" guide
// where applicable.

/** Sort turn ids numerically when possible (turnId is usually a numeric string,
 *  but falls back to string comparison for non-numeric ids). */
function turnIdCompare(a: string, b: string): number {
  const na = parseInt(a, 10);
  const nb = parseInt(b, 10);
  return isNaN(na) || isNaN(nb) ? a.localeCompare(b) : na - nb;
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

interface ToolBudget {
  includedCount: number;
  usedCount: number;
  unusedNames: string[];
  unusedTokens: number; // heuristic size of unused tool defs, per request
  llmCallsWithTools: number; // how many requests carried this tools schema
  failedToolCalls: number;
  totalToolCalls: number;
}

/** Parse a captured tools_N.json (the `{content:"<json string>"}` envelope, or a
 *  bare array) into {name, sizeTokens} defs, reusing the same envelope-unwrapping
 *  shape as prettyFormat/formatToolsList. */
function parseToolDefs(raw: string): { name: string; sizeTokens: number }[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  let arr: unknown[] | null = Array.isArray(parsed) ? parsed : null;
  if (!arr && parsed && typeof parsed === 'object') {
    const content = (parsed as { content?: unknown }).content;
    if (typeof content === 'string') {
      const inner = tryJsonParse(content.trim());
      if (Array.isArray(inner)) arr = inner;
    }
  }
  if (!arr) return [];
  const out: { name: string; sizeTokens: number }[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const fn = (rec.function && typeof rec.function === 'object' ? rec.function : rec) as Record<string, unknown>;
    const name = typeof fn.name === 'string' ? fn.name : '';
    if (!name) continue;
    out.push({ name, sizeTokens: heuristicTokenCount(JSON.stringify(item)) });
  }
  return out;
}

/** Tool schemas travel on every request that carries them. Compare the tool set
 *  actually defined (from the captured tools file) against tool names that were
 *  ever invoked, to size the fixed overhead of definitions that never got used. */
function computeToolBudget(session: ParsedSession): ToolBudget | null {
  const toolsFileNames = Object.keys(session.toolsFiles);
  if (toolsFileNames.length === 0) return null;
  // Most sessions carry one stable tool set; if it changed mid-session, use the largest one.
  const [chosenName, chosenRaw] = toolsFileNames
    .map((n): [string, string] => [n, session.toolsFiles[n]])
    .sort((a, b) => b[1].length - a[1].length)[0];
  const defs = parseToolDefs(chosenRaw);
  if (defs.length === 0) return null;

  const usedNames = new Set(session.toolCalls.map((t) => t.name));
  const unused = defs.filter((d) => !usedNames.has(d.name));
  const llmCallsWithTools =
    session.llmCalls.filter((c) => c.toolsFile === chosenName).length ||
    session.llmCalls.filter((c) => !!c.toolsFile).length;

  return {
    includedCount: defs.length,
    usedCount: defs.length - unused.length,
    unusedNames: unused.map((d) => d.name),
    unusedTokens: unused.reduce((a, d) => a + d.sizeTokens, 0),
    llmCallsWithTools,
    failedToolCalls: session.toolCalls.filter((t) => t.status === 'error').length,
    totalToolCalls: session.toolCalls.length,
  };
}

interface TurnContext {
  turnId: string;
  activeFile?: string;
  attachments: { id: string; path: string }[];
}

/** 2 rounds of JSON string-escaping collapse each real backslash into 4 literal
 *  backslash characters in the once-decoded `userRequest` string. */
function cleanEscapedPath(s: string): string {
  return s.replace(/\\{4}/g, '\\');
}

/** Extract the current-turn context Copilot actually attached to a request: the
 *  active file + explicit #file/#folder/#prompt attachments. Regex-matched directly
 *  against the raw (once-decoded) `userRequest` string rather than fully re-parsing
 *  it as JSON, since large payloads are sometimes truncated in the log — the same
 *  reason AssistantBubble salvages text instead of requiring a clean parse. */
function extractRequestContext(userRequest: unknown): { activeFile?: string; attachments: { id: string; path: string }[] } | null {
  if (typeof userRequest !== 'string') return null;
  const attachments: { id: string; path: string }[] = [];
  const attRe = /attachment id=\\"(.*?)\\" filePath=\\"(.*?)\\"/g;
  let m: RegExpExecArray | null;
  while ((m = attRe.exec(userRequest)) !== null) {
    attachments.push({ id: m[1], path: cleanEscapedPath(m[2]) });
  }
  const activeMatch = /current file is (.*?)\.(?:\s*\\n|\s*<\/editorContext)/.exec(userRequest);
  const activeFile = activeMatch ? cleanEscapedPath(activeMatch[1]) : undefined;
  if (!activeFile && attachments.length === 0) return null;
  return { activeFile, attachments };
}

/** One entry per turn — using the first call in that turn whose request carried
 *  explicit context (attachments are only declared on the message-sending call,
 *  not later tool-continuation calls within the same turn). */
function computeContextSent(session: ParsedSession): TurnContext[] {
  const byTurn = new Map<string, TurnContext>();
  const sortedCalls = [...session.llmCalls].sort((a, b) => a.ts - b.ts);
  for (const call of sortedCalls) {
    if (!call.turnId || byTurn.has(call.turnId)) continue;
    const ctx = extractRequestContext(call.raw.attrs.userRequest);
    if (ctx) byTurn.set(call.turnId, { turnId: call.turnId, ...ctx });
  }
  return Array.from(byTurn.values());
}

interface ActiveFileSegment {
  file: string;
  fromTurn: string;
  toTurn: string;
  turnCount: number;
}

/** Run-length encode the active file across turns, so "same file for 10 turns"
 *  reads as one line instead of 10 identical rows. */
function computeActiveFileSegments(contexts: TurnContext[]): ActiveFileSegment[] {
  const withFile = contexts.filter((c) => c.activeFile).sort((a, b) => turnIdCompare(a.turnId, b.turnId));
  const segments: ActiveFileSegment[] = [];
  for (const c of withFile) {
    const last = segments[segments.length - 1];
    if (last && last.file === c.activeFile) {
      last.toTurn = c.turnId;
      last.turnCount++;
    } else {
      segments.push({ file: c.activeFile!, fromTurn: c.turnId, toTurn: c.turnId, turnCount: 1 });
    }
  }
  return segments;
}

interface Lever {
  title: string;
  detail: string;
  tokens: number;
  strategy: string;
}

/** Rank a handful of deterministic candidate levers by cumulative tokens involved.
 *  This is a ranking of where the numbers are biggest, not a judgment call. */
function computeTopLevers(
  session: ParsedSession,
  opts: { toolBudget: ToolBudget | null; cacheMisses: Map<string, TurnCacheInfo>; shape: SessionTokenShape }
): Lever[] {
  const candidates: Lever[] = [];

  const b = opts.toolBudget;
  if (b && b.unusedTokens > 0) {
    const cumulative = b.unusedTokens * Math.max(1, b.llmCallsWithTools);
    candidates.push({
      title: `${b.unusedNames.length} of ${b.includedCount} tools never used`,
      detail: `Their schemas add ~${formatTokens(b.unusedTokens)} tokens to every request — ~${formatTokens(cumulative)} cumulative tokens across ${b.llmCallsWithTools} requests this session.`,
      tokens: cumulative,
      strategy: 'Strategy #10 · Disable unused tools',
    });
  }

  const missTotal = Array.from(opts.cacheMisses.values()).reduce((a, v) => a + v.fresh, 0);
  if (missTotal > 0) {
    candidates.push({
      title: `${opts.cacheMisses.size} turn${opts.cacheMisses.size === 1 ? '' : 's'} with a low cache hit`,
      detail: `${formatTokens(missTotal)} tokens were reprocessed at full cost instead of served from cache.`,
      tokens: missTotal,
      strategy: 'Strategy #6 · Keep the cache warm',
    });
  }

  if (opts.shape.perTurn.length > 3) {
    const first = opts.shape.perTurn[0];
    const totalFirst = first.cached + first.fresh;
    const extra = opts.shape.perTurn.reduce((a, t) => a + Math.max(0, t.cached + t.fresh - totalFirst), 0);
    if (extra > 0) {
      candidates.push({
        title: 'Context grew across the session',
        detail: `Turns after the first paid ~${formatTokens(extra)} extra cumulative tokens as history accumulated.`,
        tokens: extra,
        strategy: 'Strategy #3 · Start new chats per task',
      });
    }
  }

  const frontierTrivial = session.llmCalls.filter((c) => modelTier(c.model) === 'frontier' && c.outputTokens < 200);
  if (frontierTrivial.length >= 2) {
    const tok = frontierTrivial.reduce((a, c) => a + c.inputTokens, 0);
    candidates.push({
      title: `${frontierTrivial.length} trivial calls ran on a frontier model`,
      detail: `Each produced under 200 output tokens but paid frontier-model input pricing on ~${formatTokens(tok)} tokens combined.`,
      tokens: tok,
      strategy: 'Strategy #2 · Pick the right model',
    });
  }

  return candidates.sort((a, b2) => b2.tokens - a.tokens).slice(0, 3);
}

interface DistinctFile {
  content: string;
  sampleName: string;
  fileNames: string[];
  tokens: number;
}

/** Copilot writes a new numbered system_prompt_N.json / tools_N.json every time it builds
 *  a request, even when the content is byte-identical to a previous one. Group by exact
 *  content so a session that captured 21 files but only has 6 distinct prompts reads as 6. */
function dedupeFilesByContent(files: Record<string, string>): DistinctFile[] {
  const byContent = new Map<string, string[]>();
  for (const name of Object.keys(files).sort()) {
    const content = files[name];
    const arr = byContent.get(content) ?? [];
    arr.push(name);
    byContent.set(content, arr);
  }
  return Array.from(byContent.entries())
    .map(([content, fileNames]) => ({ content, sampleName: fileNames[0], fileNames, tokens: heuristicTokenCount(content) }))
    .sort((a, b) => b.fileNames.length - a.fileNames.length);
}

function ContextOptimizationPanel({
  session,
  rollup,
  onJumpToTurn,
}: {
  session: ParsedSession;
  rollup: ReturnType<typeof rollupSession>;
  onJumpToTurn: (turnId: string) => void;
}) {
  const shape = useMemo(() => computeSessionTokenShape(session), [session]);
  const toolBudget = useMemo(() => computeToolBudget(session), [session]);
  const cacheMisses = useMemo(() => computeCacheMisses(session), [session]);
  const contexts = useMemo(() => computeContextSent(session), [session]);
  const activeFileSegments = useMemo(() => computeActiveFileSegments(contexts), [contexts]);
  const fileAttachCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of contexts) for (const a of c.attachments) m.set(a.path, (m.get(a.path) ?? 0) + 1);
    return Array.from(m.entries())
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count);
  }, [contexts]);
  const aiCredits = useMemo(() => computeAiCredits(session), [session]);
  const levers = useMemo(() => computeTopLevers(session, { toolBudget, cacheMisses, shape }), [session, toolBudget, cacheMisses, shape]);
  const distinctPrompts = useMemo(() => dedupeFilesByContent(session.systemPromptFiles), [session]);
  const distinctTools = useMemo(() => dedupeFilesByContent(session.toolsFiles), [session]);

  const [selectedFile, setSelectedFile] = useState<{ kind: 'prompt' | 'tools'; content: string; sampleName: string } | null>(null);
  const [pretty, setPretty] = useState(true);

  const peakInput = session.llmCalls.reduce((a, c) => Math.max(a, c.inputTokens), 0);
  const cacheMissList = Array.from(cacheMisses.entries()).sort((a, b) => b[1].fresh - a[1].fresh);

  return (
    <div className="space-y-3">
      <p className="rounded border border-muted bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground">
        Measured directly from this session&rsquo;s debug log — facts, not diagnosis. Strategy tags reference the Copilot
        Optimization Strategies guide.
      </p>

      <TokenShapeCard session={session} />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <Card>
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground">Peak context in one call</div>
            <div className="text-lg font-semibold">{formatTokens(peakInput)} tok</div>
          </CardContent>
        </Card>
        {aiCredits !== null && (
          <Card>
            <CardContent className="p-3">
              <div className="text-[10px] uppercase text-muted-foreground">AI Credits used</div>
              <div className="text-lg font-semibold">{aiCredits.toFixed(2)} AIC</div>
              <div className="text-[11px] text-muted-foreground">1 AIC ≈ 1 billing unit, from the log</div>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground">History re-sent</div>
            <div className="text-lg font-semibold">{rollup.llmCalls}×</div>
            <div className="text-[11px] text-muted-foreground">the conversation is resent on every model call</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Top opportunities in this session</CardTitle>
          <CardDescription>Ranked by cumulative tokens involved — not a verdict, just where the numbers are biggest.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {levers.length === 0 && <p className="text-xs text-muted-foreground">Nothing notable stood out for this session.</p>}
          {levers.map((l, i) => (
            <div key={i} className="rounded-md border px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">
                  {i + 1}. {l.title}
                </div>
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  {l.strategy}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{l.detail}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">By model</CardTitle>
          <CardDescription>Token usage and tier per model for this session, straight from the log.</CardDescription>
        </CardHeader>
        <CardContent>
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr><th className="text-left">Model</th><th title="Lightweight / Versatile / Frontier">Tier</th><th title="Number of llm_request events that hit this model">Calls</th><th title="Sum of inputTokens across calls">In</th><th title="Sum of outputTokens across calls">Out</th></tr>
            </thead>
            <tbody>
              {rollup.byModel.map((m) => (
                <tr key={m.model} className="border-t">
                  <td className="py-1 font-mono">{m.model}</td>
                  <td className="text-center"><Badge variant={tierBadgeVariant(modelTier(m.model))}>{tierLabel(modelTier(m.model))}</Badge></td>
                  <td className="text-center">{m.calls}</td>
                  <td className="text-center">{formatTokens(m.inputTokens)}</td>
                  <td className="text-center">{formatTokens(m.outputTokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rollup.cacheBoundaryHits > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Detected {rollup.cacheBoundaryHits} <code>cache_control:ephemeral</code> markers (prompt-caching boundaries) —
              actual paid input may differ from raw tokens above.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Tool budget</CardTitle>
            <CardDescription>Strategy #10 · Disable tools you don&rsquo;t need — schemas travel on every request.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            {toolBudget ? (
              <>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-lg font-semibold">{toolBudget.includedCount}</div>
                    <div className="text-muted-foreground">included</div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold">{toolBudget.usedCount}</div>
                    <div className="text-muted-foreground">used</div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-amber-500">{toolBudget.unusedNames.length}</div>
                    <div className="text-muted-foreground">unused</div>
                  </div>
                </div>
                <p className="text-muted-foreground">
                  Unused tool definitions are ~{formatTokens(toolBudget.unusedTokens)} tokens (heuristic), sent on{' '}
                  {toolBudget.llmCallsWithTools} requests this session.
                </p>
                {toolBudget.unusedNames.length > 0 && (
                  <details>
                    <summary className="cursor-pointer text-muted-foreground">Show unused tools ({toolBudget.unusedNames.length})</summary>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {toolBudget.unusedNames.map((n) => (
                        <Badge key={n} variant="outline" className="font-mono text-[10px]">
                          {n}
                        </Badge>
                      ))}
                    </div>
                  </details>
                )}
                {toolBudget.failedToolCalls > 0 && (
                  <p className="text-muted-foreground">
                    Failed tool calls: <strong>{toolBudget.failedToolCalls}</strong> of {toolBudget.totalToolCalls}.
                  </p>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">No tools file captured for this session.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Context sent to the model</CardTitle>
            <CardDescription>Strategy #5 · Close unnecessary tabs — what Copilot actually attached this session.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            {activeFileSegments.length > 0 ? (
              <div>
                <div className="mb-1 text-muted-foreground">Active file over time:</div>
                <ul className="space-y-0.5">
                  {activeFileSegments.map((s, i) => (
                    <li key={i} className="flex items-center gap-1.5">
                      <button
                        className="font-mono text-primary hover:underline"
                        onClick={() => onJumpToTurn(s.fromTurn)}
                        title={s.file}
                      >
                        {basename(s.file)}
                      </button>
                      <span className="text-muted-foreground">
                        turn {s.fromTurn}
                        {s.toTurn !== s.fromTurn ? `–${s.toTurn}` : ''} ({s.turnCount} turn{s.turnCount === 1 ? '' : 's'})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-muted-foreground">No active-file context captured for this session.</p>
            )}

            {fileAttachCounts.length > 0 && (
              <div>
                <div className="mb-1 mt-2 text-muted-foreground">Files attached (#file / #prompt refs):</div>
                <ul className="space-y-0.5">
                  {fileAttachCounts.slice(0, 8).map((f) => (
                    <li key={f.path} className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono" title={f.path}>
                        {basename(f.path)}
                      </span>
                      <span className="shrink-0 text-muted-foreground">×{f.count} turns</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Cache health</CardTitle>
          <CardDescription>Strategy #6 · Keep the cache warm — cached input runs ~10% of normal cost.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          {cacheMissList.length > 0 ? (
            <>
              <p className="text-muted-foreground">
                {cacheMissList.length} turn{cacheMissList.length === 1 ? '' : 's'} had a notably low cache hit, reprocessing{' '}
                {formatTokens(cacheMissList.reduce((a, [, v]) => a + v.fresh, 0))} tokens at full cost.
              </p>
              <ul className="space-y-1">
                {cacheMissList.slice(0, 5).map(([turnId, info]) => (
                  <li key={turnId} className="flex items-center justify-between gap-2 rounded border px-2 py-1">
                    <button className="text-primary hover:underline" onClick={() => onJumpToTurn(turnId)}>
                      turn {turnId}
                    </button>
                    <span className="text-muted-foreground">
                      {Math.round(info.hitRatio * 100)}% cached · {formatTokens(info.fresh)} fresh
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-muted-foreground">No notable cache misses detected in this session.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Chat length</CardTitle>
            <CardDescription>Strategy #3 &amp; #9 · Start new chats per task; use /compact on long ones.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            <div>
              Turns: <strong>{session.turns.length}</strong>
            </div>
            {shape.perTurn.length > 1 &&
              (() => {
                // Peak vs. first turn, not last vs. first — context can dip mid-session
                // (compaction, a cache reset), so "last" alone can understate how large
                // it got. This matches the "Peak context" stat and the lever above it.
                const first = shape.perTurn[0];
                const t0 = first.cached + first.fresh;
                const peak = Math.max(...shape.perTurn.map((t) => t.cached + t.fresh));
                const multiple = t0 > 0 ? peak / t0 : 1;
                return (
                  <div>
                    Context peaked at <strong>{multiple.toFixed(1)}×</strong> the size of turn {first.turn.replace(/^T/, '')}.
                  </div>
                );
              })()}
            {session.turns.length > 20 && (
              <p className="text-muted-foreground">
                20+ turns — consider <code>/compact</code> or a fresh chat for the next task.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Health</CardTitle>
            <CardDescription>Tokens that didn&rsquo;t produce useful output.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div title="Events with status=error in main.jsonl">Errored events: <strong>{rollup.errorCount}</strong></div>
            <div title="Sum of input+output tokens for llm_request events that ended with status=error">Wasted tokens (errored LLM calls): <strong>{formatTokens(rollup.wastedTokens)}</strong></div>
            <div title="child_session_ref events: subagent runs / title generation / etc.">Subagent runs: <strong>{session.childSessionRefs.length}</strong></div>
            {session.fileSizesBytes && (
              <div>Log size: {(session.fileSizesBytes.total / 1024).toFixed(0)} KB</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">System prompt &amp; tools</CardTitle>
          <CardDescription>
            Copilot writes a new numbered file every time it builds a request, even when the content is unchanged —
            grouped here by exact content so repeats don&rsquo;t look like separate prompts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {distinctPrompts.length === 0 && distinctTools.length === 0 ? (
            <p className="text-xs text-muted-foreground">No system_prompt / tools files were captured for this session.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-[220px_1fr]">
              <div className="space-y-2">
                {distinctPrompts.length > 0 && (
                  <div>
                    <div className="mb-1 text-[10px] uppercase text-muted-foreground">
                      {distinctPrompts.length} distinct prompt{distinctPrompts.length === 1 ? '' : 's'}
                      {' '}({Object.keys(session.systemPromptFiles).length} files captured)
                    </div>
                    <div className="space-y-1">
                      {distinctPrompts.map((d) => (
                        <button
                          key={d.sampleName}
                          onClick={() => setSelectedFile({ kind: 'prompt', content: d.content, sampleName: d.sampleName })}
                          className={`block w-full rounded px-2 py-1 text-left text-xs hover:bg-accent ${selectedFile?.content === d.content ? 'bg-accent' : ''}`}
                        >
                          <div className="font-mono">{d.sampleName}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {formatTokens(d.tokens)} tok · used {d.fileNames.length}×
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {distinctTools.length > 0 && (
                  <div>
                    <div className="mb-1 text-[10px] uppercase text-muted-foreground">
                      {distinctTools.length} distinct tool set{distinctTools.length === 1 ? '' : 's'}
                      {' '}({Object.keys(session.toolsFiles).length} files captured)
                    </div>
                    <div className="space-y-1">
                      {distinctTools.map((d) => (
                        <button
                          key={d.sampleName}
                          onClick={() => setSelectedFile({ kind: 'tools', content: d.content, sampleName: d.sampleName })}
                          className={`block w-full rounded px-2 py-1 text-left text-xs hover:bg-accent ${selectedFile?.content === d.content ? 'bg-accent' : ''}`}
                        >
                          <div className="font-mono">{d.sampleName}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {formatTokens(d.tokens)} tok · used {d.fileNames.length}×
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="min-w-0">
                {selectedFile ? (
                  <Card>
                    <CardHeader>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <CardTitle className="text-sm">{selectedFile.sampleName}</CardTitle>
                          <CardDescription>~{formatTokens(heuristicTokenCount(selectedFile.content))} tokens (heuristic, ~4 chars/token)</CardDescription>
                        </div>
                        <div className="flex shrink-0 overflow-hidden rounded-md border text-xs">
                          <button
                            onClick={() => setPretty(true)}
                            className={`px-2 py-1 ${pretty ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
                          >
                            Formatted
                          </button>
                          <button
                            onClick={() => setPretty(false)}
                            className={`border-l px-2 py-1 ${!pretty ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
                          >
                            Raw
                          </button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 text-xs">
                        {pretty ? prettyFormat(selectedFile.content) : selectedFile.content}
                      </pre>
                    </CardContent>
                  </Card>
                ) : (
                  <p className="text-sm text-muted-foreground">Select a file to inspect its tokenization cost contribution.</p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <details className="rounded-md border">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Customizations</summary>
        <div className="space-y-3 border-t p-3">
          <Card>
            <CardHeader><CardTitle className="text-sm">Discoveries (session start)</CardTitle></CardHeader>
            <CardContent>
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr><th className="text-left">Category</th><th>Count</th><th className="text-left">Loaded</th></tr>
                </thead>
                <tbody>
                  {session.discoveries.map((d, i) => (
                    <tr key={i} className="border-t align-top">
                      <td className="py-1">{d.category}</td>
                      <td className="text-center">{d.count}</td>
                      <td className="font-mono text-[11px]">{d.loaded.join(', ')}</td>
                    </tr>
                  ))}
                  {session.discoveries.length === 0 && <tr><td colSpan={3} className="py-2 text-muted-foreground">No discovery events.</td></tr>}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Resolve Customizations (per turn)</CardTitle>
              <CardDescription>Skills, instructions, and agents attached to (or skipped from) each turn.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {session.customizations.length === 0 && (
                <p className="text-xs text-muted-foreground">No "Resolve Customizations" generic events were captured. Either none ran or your Copilot version doesn't emit them.</p>
              )}
              {session.customizations.map((c, i) => (
                <div key={i} className="rounded border p-2 text-xs">
                  <div className="mb-1 flex items-center gap-2 text-muted-foreground">
                    <span>turn {c.turnId ?? '?'}</span>
                    <span>·</span>
                    <span>{new Date(c.ts).toLocaleTimeString()}</span>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <div>
                      <div className="font-semibold text-emerald-500">attached</div>
                      <ul className="ml-4 list-disc">
                        {c.attached.map((a, j) => <li key={j}><Badge variant="outline">{a.kind}</Badge> {a.name}</li>)}
                        {c.attached.length === 0 && <li className="text-muted-foreground">none</li>}
                      </ul>
                    </div>
                    <div>
                      <div className="font-semibold text-amber-500">skipped</div>
                      <ul className="ml-4 list-disc">
                        {c.skipped.map((a, j) => <li key={j}><Badge variant="outline">{a.kind}</Badge> {a.name} {a.reason && <span className="text-muted-foreground">— {a.reason}</span>}</li>)}
                        {c.skipped.length === 0 && <li className="text-muted-foreground">none</li>}
                      </ul>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </details>
    </div>
  );
}

// ----- Token usage shape (for the growth sparkline + composition donut) -----

interface TurnTokenPoint {
  turn: string;
  cached: number;
  fresh: number;
  output: number;
}

interface SessionTokenShape {
  perTurn: TurnTokenPoint[];
  /** Estimated split of total INPUT tokens across the session. */
  composition: { systemPrompt: number; tools: number; conversation: number };
  hasOverheadFiles: boolean;
  totalInput: number;
  totalOutput: number;
}

/** Estimate where a session's tokens go. System-prompt and tools files are
 *  re-sent on every llm_request, so their (heuristic) token counts are summed
 *  per call; whatever input remains is conversation history + context. */
function computeSessionTokenShape(session: ParsedSession): SessionTokenShape {
  const sysCache = new Map<string, number>();
  const toolCache = new Map<string, number>();
  const sysTok = (f?: string): number => {
    if (!f) return 0;
    if (!sysCache.has(f)) {
      const txt = session.systemPromptFiles[f];
      sysCache.set(f, txt ? heuristicTokenCount(txt) : 0);
    }
    return sysCache.get(f)!;
  };
  const toolTok = (f?: string): number => {
    if (!f) return 0;
    if (!toolCache.has(f)) {
      const txt = session.toolsFiles[f];
      toolCache.set(f, txt ? heuristicTokenCount(txt) : 0);
    }
    return toolCache.get(f)!;
  };

  let cSys = 0;
  let cTool = 0;
  let cCached = 0;
  let cConv = 0;
  let totIn = 0;
  let totOut = 0;
  for (const c of session.llmCalls) {
    const s = sysTok(c.systemPromptFile);
    const t = toolTok(c.toolsFile);
    cSys += s;
    cTool += t;
    const cached = c.cachedTokens ?? 0;
    cCached += cached;
    cConv += Math.max(0, c.inputTokens - s - t - cached);
    totIn += c.inputTokens;
    totOut += c.outputTokens;
  }

  const perTurn = [...session.turns]
    .sort((a, b) => {
      const na = parseInt(a.turnId, 10);
      const nb = parseInt(b.turnId, 10);
      return (isNaN(na) || isNaN(nb)) ? a.turnId.localeCompare(b.turnId) : na - nb;
    })
    .map((turn) => {
    const calls = session.llmCalls.filter((c) => c.turnId === turn.turnId);
    if (calls.length === 0) return { turn: `T${turn.turnId}`, cached: 0, fresh: 0, output: 0 };
    // Use the call with the largest input (= the most complete context snapshot for this turn).
    // Summing all calls would inflate agentic turns with many tool-use loops.
    const largest = calls.reduce((a, b) => b.inputTokens > a.inputTokens ? b : a);
    const cached = largest.cachedTokens ?? 0;
    return {
      turn: `T${turn.turnId}`,
      cached,
      fresh: largest.inputTokens - cached,
      output: calls.reduce((a, c) => a + c.outputTokens, 0),
    };
  });

  return {
    perTurn,
    composition: { systemPrompt: cSys, tools: cTool, conversation: cConv },
    hasOverheadFiles: cSys > 0 || cTool > 0,
    totalInput: totIn,
    totalOutput: totOut,
  };
}

const COMP_COLORS = {
  conversation: 'hsl(var(--primary))',
  systemPrompt: '#f59e0b',
  tools: '#10b981',
  cached: '#7c3aed',
};

/** Stacked area chart: cached (bottom) + fresh (top) tokens per turn, using the largest
 *  single LLM call per turn so agentic multi-call turns don't inflate the view. */
function TokenGrowthStrip({ session, onTurnClick }: { session: ParsedSession; onTurnClick?: (turnId: string) => void }) {
  const shape = useMemo(() => computeSessionTokenShape(session), [session]);
  if (shape.perTurn.length < 2) return null;
  const last = shape.perTurn[shape.perTurn.length - 1];
  const first = shape.perTurn[0];
  const totalFirst = first.cached + first.fresh;
  const totalLast = last.cached + last.fresh;
  const growthPct = totalFirst > 0 ? Math.round(((totalLast - totalFirst) / totalFirst) * 100) : 0;
  return (
    <div className="mb-2 rounded-md border bg-card px-3 py-2">
      <div className="mb-1 flex items-baseline justify-between gap-4">
        <span className="text-[11px] font-medium">Context window per turn</span>
        <span className="text-[10px] text-muted-foreground">
          {growthPct > 0
            ? `grew ${growthPct}% over ${shape.perTurn.length} turns — start a new chat per task to keep context lean`
            : `${shape.perTurn.length} turns`}
        </span>
      </div>
      <div style={{ height: 90 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={shape.perTurn}
            margin={{ top: 2, right: 4, bottom: 0, left: 0 }}
            stackOffset="none"
            style={onTurnClick ? { cursor: 'pointer' } : undefined}
            onClick={(data) => {
              if (!onTurnClick || !data?.activeLabel) return;
              onTurnClick(String(data.activeLabel).replace(/^T/, ''));
            }}
          >
            <defs>
              <linearGradient id="cachedFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7c3aed" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#7c3aed" stopOpacity={0.1} />
              </linearGradient>
              <linearGradient id="freshFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.7} />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.2} />
              </linearGradient>
            </defs>
            <XAxis dataKey="turn" stroke="hsl(var(--muted-foreground))" fontSize={9} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis hide />
            <Tooltip
              formatter={(v: number, name: string) => [
                formatTokens(v),
                name === 'cached' ? 'cached (~10% cost)' : 'fresh (full cost)',
              ]}
              labelFormatter={(l) => `turn ${String(l).replace(/^T/, '')}`}
              contentStyle={{ fontSize: 11 }}
            />
            <Area type="monotone" dataKey="cached" stackId="ctx" stroke="#7c3aed" strokeWidth={1} fill="url(#cachedFill)" />
            <Area type="monotone" dataKey="fresh" stackId="ctx" stroke="hsl(var(--primary))" strokeWidth={1.5} fill="url(#freshFill)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 flex gap-3">
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className="inline-block h-2 w-2 rounded-sm bg-[#7c3aed] opacity-60" />
          cached (~10% cost)
        </span>
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className="inline-block h-2 w-2 rounded-sm bg-primary opacity-80" />
          fresh (full cost)
        </span>
      </div>
    </div>
  );
}

/** "Where your tokens go" card: composition donut + per-turn growth chart. */
function TokenShapeCard({ session }: { session: ParsedSession }) {
  const shape = useMemo(() => computeSessionTokenShape(session), [session]);
  const { systemPrompt, tools, conversation } = shape.composition;
  const compData = [
    { name: 'Conversation & context', value: conversation, color: COMP_COLORS.conversation },
    { name: 'System prompt', value: systemPrompt, color: COMP_COLORS.systemPrompt },
    { name: 'Tools', value: tools, color: COMP_COLORS.tools },
  ].filter((d) => d.value > 0);
  const overhead = systemPrompt + tools;
  const overheadPct = shape.totalInput > 0 ? Math.round((overhead / shape.totalInput) * 100) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Where your tokens go</CardTitle>
        <CardDescription>
          Every turn re-sends the system prompt, tool definitions, and the whole conversation as input — fixed overhead even on a one-word question.
          The per-turn token chart is taken straight from the log; the composition split is <strong>estimated</strong> from the captured system-prompt &amp; tools file sizes (the log gives the input total, not a labeled breakdown).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-2">
          {/* Composition donut */}
          <div>
            <div className="mb-1 text-[11px] font-medium">Input token composition <span className="font-normal text-muted-foreground">(estimated split)</span></div>
            <div style={{ height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={compData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={2}>
                    {compData.map((d) => (
                      <Cell key={d.name} fill={d.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatTokens(v)} contentStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-1 text-[11px]">
              {compData.map((d) => (
                <div key={d.name} className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: d.color }} />
                  <span>{d.name}</span>
                  <span className="ml-auto font-mono text-muted-foreground">
                    {formatTokens(d.value)} ({shape.totalInput > 0 ? Math.round((d.value / shape.totalInput) * 100) : 0}%)
                  </span>
                </div>
              ))}
            </div>
            {shape.hasOverheadFiles ? (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Roughly <strong>{overheadPct}%</strong> of every request is fixed system-prompt + tool overhead (estimated) before any of your conversation.
              </p>
            ) : (
              <p className="mt-2 text-[11px] text-muted-foreground">
                No system_prompt / tools files were captured, so overhead can't be split out — all input is shown as conversation &amp; context.
              </p>
            )}
          </div>

          {/* Per-turn growth */}
          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-[11px] font-medium">Context window per turn</span>
              <span className="flex gap-3">
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span className="inline-block h-2 w-2 rounded-sm bg-[#7c3aed] opacity-60" />cached (~10% cost)
                </span>
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span className="inline-block h-2 w-2 rounded-sm bg-primary opacity-80" />fresh (full cost)
                </span>
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span className="inline-block h-2 w-2 rounded-sm bg-muted-foreground opacity-60" />output
                </span>
              </span>
            </div>
            <div style={{ height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={shape.perTurn} margin={{ top: 4, right: 6, bottom: 0, left: -10 }} stackOffset="none">
                  <defs>
                    <linearGradient id="cachedFillBig" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#7c3aed" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#7c3aed" stopOpacity={0.1} />
                    </linearGradient>
                    <linearGradient id="freshFillBig" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.6} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.1} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="turn" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickFormatter={(v) => formatTokens(v)} width={42} />
                  <Tooltip
                    formatter={(v: number, name: string) => [
                      formatTokens(v),
                      name === 'cached' ? 'cached (~10% cost)' : name === 'fresh' ? 'fresh (full cost)' : 'output',
                    ]}
                    contentStyle={{ fontSize: 11 }}
                  />
                  <Area type="monotone" dataKey="cached" stackId="ctx" stroke="#7c3aed" strokeWidth={1} fill="url(#cachedFillBig)" name="cached" />
                  <Area type="monotone" dataKey="fresh" stackId="ctx" stroke="hsl(var(--primary))" strokeWidth={1.5} fill="url(#freshFillBig)" name="fresh" />
                  <Area type="monotone" dataKey="output" stroke="hsl(var(--muted-foreground))" strokeWidth={1} fillOpacity={0} name="output" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Context grows as history accumulates — cached tokens cost ~10% of fresh. Start a new chat per task to keep it lean.
            </p>
          </div>
        </div>

        {/* Input vs output sidenote */}
        <InputOutputBar input={shape.totalInput} output={shape.totalOutput} />
      </CardContent>
    </Card>
  );
}

/** Slim stacked bar contrasting total input vs output tokens. */
function InputOutputBar({ input, output }: { input: number; output: number }) {
  const total = input + output;
  if (total === 0) return null;
  const inPct = Math.round((input / total) * 100);
  const outPct = 100 - inPct;
  return (
    <div className="mt-4 border-t pt-3">
      <div className="mb-1 flex items-baseline justify-between text-[11px]">
        <span className="font-medium">Input vs output tokens</span>
        <span className="text-muted-foreground">cached input costs ~10% of fresh — output is most expensive per token</span>
      </div>
      <div className="flex h-4 w-full overflow-hidden rounded">
        <div style={{ width: `${inPct}%`, background: 'hsl(var(--primary))' }} title={`input ${inPct}%`} />
        <div style={{ width: `${outPct}%`, background: 'hsl(var(--muted-foreground))' }} title={`output ${outPct}%`} />
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'hsl(var(--primary))' }} />
          Input {formatTokens(input)} ({inPct}%)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'hsl(var(--muted-foreground))' }} />
          Output {formatTokens(output)} ({outPct}%)
        </span>
      </div>
    </div>
  );
}

// ----- Conversation (split chat / raw-JSON view) -----

type Pane = 'both' | 'chat' | 'json';

function ConversationPanel({ session, redact }: { session: ParsedSession; redact: boolean }) {
  const [pane, setPane] = useState<Pane>('both');

  const showChat = pane === 'both' || pane === 'chat';
  const showJson = pane === 'both' || pane === 'json';

  const handleTurnClick = (turnId: string) => {
    document.getElementById(`turn-${turnId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById(`json-turn-${turnId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="flex h-full flex-col">
      <TokenGrowthStrip session={session} onTurnClick={handleTurnClick} />

      {/* Pane toolbar */}
      <div className="mb-2 flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">View:</span>
        <div className="flex overflow-hidden rounded-md border">
          <PaneButton active={pane === 'chat'} onClick={() => setPane('chat')} icon={<PanelRightClose className="h-3.5 w-3.5" />} label="Chat" />
          <PaneButton active={pane === 'both'} onClick={() => setPane('both')} icon={<Columns2 className="h-3.5 w-3.5" />} label="Split" />
          <PaneButton active={pane === 'json'} onClick={() => setPane('json')} icon={<PanelLeftClose className="h-3.5 w-3.5" />} label="JSON" />
        </div>
        <span className="ml-auto text-muted-foreground">{session.turns.length} turn{session.turns.length === 1 ? '' : 's'}</span>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        {showChat && (
          <div className={`min-h-0 overflow-auto rounded-md border bg-background ${showJson ? 'w-1/2' : 'flex-1'}`}>
            <ChatView session={session} redact={redact} />
          </div>
        )}
        {showJson && (
          <div className={`min-h-0 overflow-auto rounded-md border bg-muted/20 ${showChat ? 'w-1/2' : 'flex-1'}`}>
            <JsonTurnsView session={session} redact={redact} />
          </div>
        )}
      </div>
    </div>
  );
}

function PaneButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-2 py-1 ${active ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
    >
      {icon}
      {label}
    </button>
  );
}

// ----- Pretty chat side -----

interface TurnCacheInfo {
  fresh: number;         // tokens the model reprocessed (input − cached) on the primary call
  hitRatio: number;      // 0..1 cached share of the primary call
  prevHitRatio?: number; // previous turn's primary-call hit ratio, for contrast
  model: string;
  gapMs: number;         // wall-clock since the previous model call anywhere in the session
  longestTool?: { name: string; agentName?: string; durationMs: number }; // notable work before the call
}

/** Flag turns whose primary (largest-context) model call had a notably low cache hit — a big
 *  context largely reprocessed instead of served from cache. We surface the surrounding facts
 *  (hit rate, idle gap, what ran before the call) and let the reader draw the conclusion. */
function computeCacheMisses(session: ParsedSession): Map<string, TurnCacheInfo> {
  const out = new Map<string, TurnCacheInfo>();
  const byTs = [...session.llmCalls].sort((a, b) => a.ts - b.ts);

  // Primary (largest-context) call per turn, in turn order — used for prev-turn contrast.
  const primaries = session.turns.map((turn) => {
    const calls = session.llmCalls.filter((c) => c.turnId === turn.turnId);
    return {
      turnId: turn.turnId,
      primary: calls.length ? calls.reduce((a, b) => (b.inputTokens > a.inputTokens ? b : a)) : undefined,
    };
  });

  for (let i = 0; i < primaries.length; i++) {
    const { turnId, primary } = primaries[i];
    if (!primary) continue;
    const input = primary.inputTokens;
    const cached = primary.cachedTokens ?? 0;
    const hitRatio = input > 0 ? cached / input : 1;
    const idx = byTs.findIndex((c) => c.spanId === primary.spanId);
    // Only a large context, mostly reprocessed, that isn't the session's cold-start first call.
    if (input < 50000 || hitRatio >= 0.5 || idx <= 0) continue;

    const gapMs = primary.ts - byTs[idx - 1].ts;

    // Previous turn's primary hit ratio, for contrast.
    let prevHitRatio: number | undefined;
    for (let j = i - 1; j >= 0; j--) {
      const p = primaries[j].primary;
      if (p && p.inputTokens > 0) {
        prevHitRatio = (p.cachedTokens ?? 0) / p.inputTokens;
        break;
      }
    }

    // The longest-running tool that finished before this call (subagent or otherwise), if notable.
    const longest = session.toolCalls
      .filter((tc) => tc.turnId === turnId && tc.ts <= primary.ts)
      .sort((a, b) => b.durationMs - a.durationMs)[0];
    let longestTool: TurnCacheInfo['longestTool'];
    if (longest && longest.durationMs > 30000) {
      let agentName: string | undefined;
      const rawArgs = (longest.raw?.attrs as { args?: unknown } | undefined)?.args;
      if (/subagent/i.test(longest.name) && typeof rawArgs === 'string') {
        try {
          agentName = (JSON.parse(rawArgs) as { agentName?: string }).agentName;
        } catch { /* args not JSON */ }
      }
      longestTool = { name: longest.name, agentName, durationMs: longest.durationMs };
    }

    out.set(turnId, { fresh: input - cached, hitRatio, prevHitRatio, model: primary.model, gapMs, longestTool });
  }
  return out;
}

function formatGap(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function CacheMissPanel({ info }: { info: TurnCacheInfo }) {
  const pct = (r: number) => `${Math.round(r * 100)}%`;
  return (
    <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs">
      <div className="mb-1.5 flex items-center gap-1.5 font-medium">
        <Database className="h-3.5 w-3.5 text-muted-foreground" />
        Low cache hit this turn
      </div>
      <div className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
        <span className="text-muted-foreground">Cache hit</span>
        <span>
          {pct(info.hitRatio)} cached
          {info.prevHitRatio !== undefined && (
            <span className="text-muted-foreground"> · previous turn {pct(info.prevHitRatio)}</span>
          )}
        </span>

        <span className="text-muted-foreground">Reprocessed</span>
        <span>{formatTokens(info.fresh)} fresh tokens</span>

        <span className="text-muted-foreground">Model</span>
        <span>{info.model}</span>

        <span className="text-muted-foreground">Since last model call</span>
        <span>{formatGap(info.gapMs)}</span>

        {info.longestTool && (
          <>
            <span className="text-muted-foreground">Ran before this call</span>
            <span>
              <code>{info.longestTool.name}</code>
              {info.longestTool.agentName && <> → {info.longestTool.agentName}</>} ({formatGap(info.longestTool.durationMs)})
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function ChatView({ session, redact }: { session: ParsedSession; redact: boolean }) {
  const cacheMisses = useMemo(() => computeCacheMisses(session), [session]);
  if (session.turns.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">No turns captured for this session.</p>;
  }
  return (
    <div className="mx-auto flex max-w-3xl flex-col p-3">
      {session.turns.map((t, i) => (
        <ChatTurn key={t.turnId} session={session} turn={t} redact={redact} cacheMiss={cacheMisses.get(t.turnId)} first={i === 0} />
      ))}
    </div>
  );
}

function ChatTurn({ session, turn, redact, cacheMiss, first }: { session: ParsedSession; turn: Turn; redact: boolean; cacheMiss?: TurnCacheInfo; first?: boolean }) {
  const llmCalls = session.llmCalls.filter((c) => c.turnId === turn.turnId);
  const toolCalls = session.toolCalls.filter((c) => c.turnId === turn.turnId);
  const agentEv = session.events.filter(
    (e) => e.type === 'agent_response' && turn.agentResponseSpanIds.includes(e.spanId)
  );

  // Interleave assistant responses and tool calls chronologically.
  const stream: Array<
    | { ts: number; kind: 'assistant'; ev: RawEvent }
    | { ts: number; kind: 'tool'; tc: ToolCallSummary }
  > = [
    ...agentEv.map((ev) => ({ ts: ev.ts, kind: 'assistant' as const, ev })),
    ...toolCalls.map((tc) => ({ ts: tc.ts, kind: 'tool' as const, tc })),
  ].sort((a, b) => a.ts - b.ts);

  const totalIn = llmCalls.reduce((a, c) => a + c.inputTokens, 0);
  const totalOut = llmCalls.reduce((a, c) => a + c.outputTokens, 0);
  const totalCached = llmCalls.reduce((a, c) => a + (c.cachedTokens ?? 0), 0);
  const cachePct = totalIn > 0 ? Math.round((totalCached / totalIn) * 100) : null;

  return (
    <div id={`turn-${turn.turnId}`} className={`space-y-2 ${first ? '' : 'mt-6 border-t border-border pt-6'}`}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Badge variant="outline">turn {turn.turnId}</Badge>
        <span>{new Date(turn.startTs).toLocaleTimeString()}</span>
        <span>· {formatDuration(turn.durationMs ?? 0)}</span>
        {turn.status === 'error' && <Badge variant="destructive">error</Badge>}
      </div>

      {cacheMiss && <CacheMissPanel info={cacheMiss} />}

      {turn.userMessageContent && (
        <div className="flex justify-end">
          <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
            {redact ? redactString(turn.userMessageContent) : turn.userMessageContent}
          </div>
        </div>
      )}

      {stream.map((item, i) =>
        item.kind === 'assistant' ? (
          <AssistantBubble key={`a-${item.ev.spanId}-${i}`} ev={item.ev} redact={redact} />
        ) : (
          <div key={`t-${item.tc.spanId}-${i}`} className="flex justify-start">
            <div className="w-[92%]">
              <ToolCallRow tc={item.tc} redact={redact} />
            </div>
          </div>
        )
      )}

      {llmCalls.length > 0 && (
        <details className="pl-1">
          <summary className="cursor-pointer text-[11px] text-muted-foreground">
            {llmCalls.length} model call{llmCalls.length === 1 ? '' : 's'} · in {formatTokens(totalIn)} / out {formatTokens(totalOut)}
            {cachePct !== null && <> · {cachePct}% cached</>}
          </summary>
          <div className="mt-2 space-y-1">
            {llmCalls.map((c) => (
              <LlmCallRow key={c.spanId} call={c} redact={redact} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function AssistantBubble({ ev, redact }: { ev: RawEvent; redact: boolean }) {
  const a = (ev.attrs ?? {}) as { response?: unknown; reasoning?: unknown };
  const text = redact ? '[redacted]' : extractAssistantText(a.response);
  const reasoning = redact ? '' : extractAssistantText(a.reasoning);

  // A pure tool-call turn has no assistant text of its own — the tool calls
  // render separately as their own rows, so skip the empty bubble entirely.
  if (!redact && !text && !reasoning) return null;

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] space-y-1 rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm">
        {reasoning && (
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">reasoning</summary>
            <div className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs italic text-muted-foreground">
              {reasoning}
            </div>
          </details>
        )}
        {text ? (
          <div className="whitespace-pre-wrap break-words">{text}</div>
        ) : (
          !reasoning && <span className="text-muted-foreground">[no text content]</span>
        )}
      </div>
    </div>
  );
}

/** Pull human-readable text out of an agent_response `response`/`reasoning`
 *  payload. Copilot logs store these as a JSON *string* shaped like
 *  `[{ role, parts: [{ type: 'text', content }, { type: 'tool_call', ... }] }]`.
 *  We parse that, keep only text parts, and drop tool-call parts (they render
 *  separately as their own rows). Plain-text payloads pass through unchanged. */
function extractAssistantText(payload: unknown): string {
  return normalizeToText(payload).trim();
}

/** Recover assistant prose from a truncated/invalid `[{role,parts:[…]}]` string by
 *  regex-extracting the structural "content"/"text" values. Escaped occurrences nested
 *  inside a tool_call's `arguments` won't match (their quotes are backslash-escaped), so
 *  this grabs only the real text parts and skips the truncated tool payload. */
function salvageText(raw: string): string {
  const out: string[] = [];
  // Closing quote is optional so a content string truncated mid-value is still captured.
  const re = /"(?:content|text)"\s*:\s*"((?:[^"\\]|\\.)*)"?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    if (!m[1]) continue;
    try {
      out.push(JSON.parse(`"${m[1]}"`) as string);
    } catch {
      out.push(m[1]); // trailing partial escape — show as-is
    }
  }
  return out.filter(Boolean).join('\n');
}

function normalizeToText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') {
    const t = value.trim();
    if (t.startsWith('[') || t.startsWith('{')) {
      try {
        return normalizeToText(JSON.parse(t));
      } catch {
        // Copilot truncates large payloads mid-string (usually a tool_call's
        // arguments), so the JSON won't parse. Salvage the intact text parts.
        const salvaged = salvageText(t);
        if (salvaged) return salvaged;
        // Looks like a message-parts payload but has no recoverable prose (e.g. a
        // truncated tool_call-only chunk) — render nothing instead of raw JSON.
        if (/"(?:role|parts|tool_call)"/.test(t)) return '';
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(normalizeToText).filter(Boolean).join('\n');
  }
  if (typeof value === 'object') {
    const o = value as { parts?: unknown; text?: unknown; content?: unknown };
    if (Array.isArray(o.parts)) return normalizeToText(o.parts);
    if (typeof o.text === 'string') return o.text;
    if (typeof o.content === 'string') return o.content;
    return ''; // tool_call and other non-text parts contribute no prose
  }
  return '';
}

/** Turn a captured system_prompt / tools file into a human-readable view.
 *  Both are stored as a `{ "content": "<json string>" }` envelope: system
 *  prompts unwrap to prose, tools unwrap to a list of function definitions.
 *  Anything else is pretty-printed JSON, falling back to raw text. */
function prettyFormat(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return raw;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return raw;
  }

  // System-prompt-style array of message parts (no envelope).
  if (Array.isArray(parsed)) {
    const prose = normalizeToText(parsed);
    if (prose) return prose;
    const tools = formatToolsList(parsed);
    if (tools) return tools;
    return safePretty(parsed, raw);
  }

  // `{ content: "<prose-or-json string>" }` envelope.
  if (parsed && typeof parsed === 'object') {
    const content = (parsed as { content?: unknown }).content;
    if (typeof content === 'string') {
      const prose = normalizeToText(content);
      if (prose) return prose; // system prompt → readable prose
      const inner = content.trim();
      if (inner.startsWith('[') || inner.startsWith('{')) {
        const innerParsed = tryJsonParse(inner);
        if (Array.isArray(innerParsed)) {
          const tools = formatToolsList(innerParsed);
          if (tools) return tools; // tools → readable list
        }
        if (innerParsed != null) return safePretty(innerParsed, raw);
      }
      return content; // plain-string content
    }
  }

  return safePretty(parsed, raw);
}

function safePretty(v: unknown, raw: string): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return raw;
  }
}

function tryJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Render an array of tool / function definitions as a readable list. Returns
 *  '' if the array doesn't look like tool definitions (so the caller can fall
 *  back to pretty-printed JSON). */
function formatToolsList(arr: unknown[]): string {
  const blocks: string[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') return '';
    const rec = item as Record<string, unknown>;
    // Support both flat ({name, ...}) and nested ({function: {name, ...}}) shapes.
    const fn = (rec.function && typeof rec.function === 'object' ? rec.function : rec) as Record<string, unknown>;
    const name = typeof fn.name === 'string' ? fn.name : '';
    if (!name) return ''; // not a tool list
    const lines: string[] = [name];
    if (typeof fn.description === 'string' && fn.description.trim()) {
      lines.push(fn.description.trim());
    }
    const params = fn.parameters as { properties?: Record<string, unknown>; required?: unknown } | undefined;
    const props = params?.properties;
    if (props && typeof props === 'object' && Object.keys(props).length > 0) {
      const required = new Set(Array.isArray(params?.required) ? (params!.required as string[]) : []);
      lines.push('Parameters:');
      for (const [pname, pdef] of Object.entries(props)) {
        const pd = (pdef ?? {}) as { type?: unknown; description?: unknown };
        const type = typeof pd.type === 'string' ? pd.type : 'any';
        const req = required.has(pname) ? ', required' : '';
        const desc = typeof pd.description === 'string' && pd.description ? ` — ${pd.description}` : '';
        lines.push(`  • ${pname} (${type}${req})${desc}`);
      }
    }
    blocks.push(lines.join('\n'));
  }
  if (blocks.length === 0) return '';
  return blocks.join(`\n\n${'─'.repeat(40)}\n\n`);
}

// ----- Raw-JSON side (grouped by turn) -----

function JsonTurnsView({ session, redact }: { session: ParsedSession; redact: boolean }) {
  const turns = session.turns;
  // Assign each event to the turn whose [start, end) window contains it.
  const eventsByTurn = useMemo(() => {
    const groups = new Map<string, RawEvent[]>();
    for (const t of turns) groups.set(t.turnId, []);
    const sorted = [...turns].sort((a, b) => a.startTs - b.startTs);
    const windowFor = (ts: number): string | undefined => {
      let pick: string | undefined;
      for (let i = 0; i < sorted.length; i++) {
        const lo = sorted[i].startTs;
        const hi = sorted[i].endTs ?? sorted[i + 1]?.startTs ?? Infinity;
        if (ts >= lo && ts < hi) return sorted[i].turnId;
        if (lo <= ts) pick = sorted[i].turnId;
      }
      return pick;
    };
    const ungrouped: RawEvent[] = [];
    for (const ev of session.events) {
      const id = windowFor(ev.ts);
      if (id && groups.has(id)) groups.get(id)!.push(ev);
      else ungrouped.push(ev);
    }
    return { groups, ungrouped };
  }, [session.events, turns]);

  if (turns.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">No turns captured for this session.</p>;
  }

  const sortedTurns = useMemo(
    () => [...turns].sort((a, b) => {
      const na = parseInt(a.turnId, 10), nb = parseInt(b.turnId, 10);
      return (isNaN(na) || isNaN(nb)) ? a.turnId.localeCompare(b.turnId) : na - nb;
    }),
    [turns]
  );

  return (
    <div className="space-y-2 p-3">
      <p className="text-[11px] text-muted-foreground">Raw events grouped by turn. Open a turn to read the JSON it produced.</p>
      {sortedTurns.map((t, i) => {
        const evs = eventsByTurn.groups.get(t.turnId) ?? [];
        return (
          <details key={t.turnId} id={`json-turn-${t.turnId}`} open={i === 0} className="rounded border bg-background">
            <summary className="cursor-pointer px-2 py-1.5 text-xs">
              <Badge variant="outline">turn {t.turnId}</Badge>{' '}
              <span className="text-muted-foreground">{evs.length} event{evs.length === 1 ? '' : 's'}</span>
            </summary>
            <pre className="max-h-[60vh] overflow-auto border-t px-2 py-2 text-[11px] leading-relaxed">
              {redact ? '[redacted — turn off Redact in the header to view raw JSON]' : JSON.stringify(evs, null, 2)}
            </pre>
          </details>
        );
      })}
      {eventsByTurn.ungrouped.length > 0 && (
        <details className="rounded border bg-background">
          <summary className="cursor-pointer px-2 py-1.5 text-xs">
            <Badge variant="outline">session-level</Badge>{' '}
            <span className="text-muted-foreground">{eventsByTurn.ungrouped.length} event(s) outside any turn</span>
          </summary>
          <pre className="max-h-[60vh] overflow-auto border-t px-2 py-2 text-[11px] leading-relaxed">
            {redact ? '[redacted]' : JSON.stringify(eventsByTurn.ungrouped, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

function LlmCallRow({ call, redact }: { call: LlmCall; redact: boolean }) {
  const [open, setOpen] = useState(false);
  const attrs = (call.raw.attrs ?? {}) as { userRequest?: unknown; inputMessages?: unknown };

  // Parse the messages from userRequest or inputMessages
  const messages = useMemo(() => {
    const raw = attrs.userRequest ?? attrs.inputMessages;
    if (!raw) return null;
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
    return raw;
  }, [attrs.userRequest, attrs.inputMessages]);

  const hasMessages = messages != null;

  return (
    <div className="rounded border bg-card text-xs">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={!hasMessages}
        className="flex w-full flex-wrap items-center gap-2 p-2 text-left hover:bg-accent/50 disabled:cursor-default disabled:hover:bg-card"
      >
        {hasMessages && (open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />)}
        <Badge>{call.model}</Badge>
        <span>in {formatTokens(call.inputTokens)} · out {formatTokens(call.outputTokens)}</span>
        <span>· {formatDuration(call.durationMs)}</span>
        {call.ttftMs != null && <span>· ttft {call.ttftMs}ms</span>}
        {call.cacheBoundaryHits > 0 && <Badge variant="outline">cache marks: {call.cacheBoundaryHits}</Badge>}
        {call.status === 'error' && <Badge variant="destructive">error</Badge>}
      </button>
      {open && hasMessages && (
        <div className="space-y-2 border-t px-3 py-2">
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Messages sent to model {attrs.userRequest ? '(userRequest)' : '(inputMessages)'}
            </div>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-2">
              {redact ? '[redacted]' : safeStringify(messages)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function safeStringify(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

// ----- Tool calls -----

function ToolCallsPanel({ session, redact }: { session: ParsedSession; redact: boolean }) {
  const [filter, setFilter] = useState('');
  const filtered = session.toolCalls.filter((t) =>
    !filter ? true : (t.name.toLowerCase().includes(filter.toLowerCase()) || (t.errorMessage ?? '').toLowerCase().includes(filter.toLowerCase()))
  );
  return (
    <div className="space-y-2">
      <Input placeholder="Filter tools by name or error…" value={filter} onChange={(e) => setFilter(e.target.value)} className="max-w-md" />
      <div className="space-y-1">
        {filtered.map((tc) => <ToolCallRow key={tc.spanId} tc={tc} redact={redact} />)}
        {filtered.length === 0 && <p className="text-sm text-muted-foreground">No tool calls match.</p>}
      </div>
    </div>
  );
}

function ToolCallRow({ tc, redact }: { tc: ToolCallSummary; redact: boolean }) {
  const [open, setOpen] = useState(false);
  const a = (tc.raw.attrs ?? {}) as { args?: unknown; result?: unknown; error?: unknown };
  const argsText = typeof a.args === 'string' ? a.args : safeStringify(a.args);
  const resultText = typeof a.result === 'string' ? a.result : safeStringify(a.result);
  return (
    <div className="rounded border text-xs">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-accent/50"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span className="font-mono">{tc.name}</span>
        <span className="text-muted-foreground">{formatDuration(tc.durationMs)}</span>
        {tc.status === 'error' && <Badge variant="destructive">error</Badge>}
        <span className="ml-auto text-muted-foreground">{tc.argsLength}b args · {tc.resultLength}b result</span>
      </button>
      {open && (
        <div className="space-y-2 border-t px-3 py-2">
          {tc.errorMessage && (
            <div className="flex items-start gap-2 rounded bg-destructive/10 p-2 text-destructive">
              <AlertCircle className="h-3.5 w-3.5" />
              <span>{redact ? '[redacted]' : tc.errorMessage}</span>
            </div>
          )}
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">args</div>
            <pre className="max-h-48 overflow-auto rounded bg-muted/50 p-2">
              {redact ? redactBody(a.args) as string : prettyJsonOrText(argsText)}
            </pre>
          </div>
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">result</div>
            <pre className="max-h-72 overflow-auto rounded bg-muted/50 p-2">
              {redact ? redactBody(a.result) as string : prettyJsonOrText(resultText)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function prettyJsonOrText(t: string): string {
  if (!t) return '';
  try { return JSON.stringify(JSON.parse(t), null, 2); } catch { return t; }
}

// ----- Subagents -----

function SubagentsPanel({ session, children, onOpen }: { session: ParsedSession; children: ParsedSession[]; onOpen: (id: string) => void }) {
  if (session.childSessionRefs.length === 0) {
    return <p className="text-sm text-muted-foreground">No child sessions referenced from this session.</p>;
  }
  return (
    <div className="space-y-2">
      {session.childSessionRefs.map((ref, i) => {
        const child = children.find((c) => c.id === ref.childSessionId);
        const r = child ? rollupSession(child) : null;
        return (
          <Card key={i}>
            <CardContent className="flex items-center gap-3 p-3 text-sm">
              <div className="flex-1">
                <div className="font-mono text-xs">{ref.childSessionId}</div>
                <div className="text-xs text-muted-foreground">{ref.label ?? '—'} · {ref.childLogFile}</div>
              </div>
              {r ? (
                <div className="text-right text-xs">
                  <div>{r.llmCalls} LLM calls</div>
                  <div className="text-primary font-semibold">{formatTokens(r.totalTokens)} tok</div>
                </div>
              ) : (
                <Badge variant="outline">child log not loaded</Badge>
              )}
              {child && <Button size="sm" variant="outline" onClick={() => onOpen(child.id)}>Open</Button>}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ----- Timeline (filterable chronological event log; formerly "Raw events") -----

function TimelinePanel({ session, redact }: { session: ParsedSession; redact: boolean }) {
  const [filter, setFilter] = useState('');
  const filtered = session.events.filter((e) =>
    !filter ? true : `${e.type} ${e.name}`.toLowerCase().includes(filter.toLowerCase())
  );
  return (
    <div className="space-y-2">
      <Input placeholder="Filter by type/name…" value={filter} onChange={(e) => setFilter(e.target.value)} className="max-w-md" />
      <div className="overflow-auto rounded border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/60"><tr>
            <th className="px-2 py-1 text-left">ts</th>
            <th className="px-2 py-1 text-left">type</th>
            <th className="px-2 py-1 text-left">name</th>
            <th className="px-2 py-1">dur</th>
            <th className="px-2 py-1">status</th>
            <th className="px-2 py-1 text-left">attrs</th>
          </tr></thead>
          <tbody>
            {filtered.map((ev) => <RawRow key={`${ev.spanId}-${ev.ts}`} ev={ev} redact={redact} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RawRow({ ev, redact }: { ev: RawEvent; redact: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="cursor-pointer border-t hover:bg-accent/40" onClick={() => setOpen((v) => !v)}>
        <td className="px-2 py-1 font-mono">{new Date(ev.ts).toLocaleTimeString()}</td>
        <td className="px-2 py-1">{ev.type}</td>
        <td className="px-2 py-1">{ev.name}</td>
        <td className="px-2 py-1 text-center">{ev.dur ?? 0}</td>
        <td className="px-2 py-1 text-center">{ev.status === 'error' ? <Badge variant="destructive">error</Badge> : 'ok'}</td>
        <td className="px-2 py-1">
          <span className="text-muted-foreground">{Object.keys(ev.attrs ?? {}).join(', ')}</span>
        </td>
      </tr>
      {open && (
        <tr><td colSpan={6} className="border-t bg-muted/20 px-3 py-2">
          <pre className="max-h-72 overflow-auto text-[11px]">
            {redact ? '[redacted attrs]' : JSON.stringify(ev.attrs, null, 2)}
          </pre>
        </td></tr>
      )}
    </>
  );
}
