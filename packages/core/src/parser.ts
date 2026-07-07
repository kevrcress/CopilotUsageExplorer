import type {
  RawEvent,
  ParsedSession,
  LlmCall,
  Turn,
  ToolCallSummary,
  CustomizationsResolution,
  DiscoveryRecord,
  ChildSessionRefAttrs,
  SessionModelInfo,
  LlmRequestAttrs,
  AgentResponseAttrs,
  ToolCallAttrs,
  DiscoveryAttrs,
  GenericAttrs,
  UserMessageAttrs,
  TurnAttrs,
  SessionStartAttrs,
} from './types';

const CACHE_MARKER_RE = /"cache_control"\s*:\s*\{\s*"type"\s*:\s*"ephemeral"/g;

/** Parse a `main.jsonl` (or child) text blob into typed RawEvents.
 *  Skips empty lines and lines that fail JSON.parse (with a console warning).
 */
export function parseJsonl(text: string): RawEvent[] {
  const out: RawEvent[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as RawEvent);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[parser] skipping malformed JSONL line ${i + 1}:`, err);
    }
  }
  return out;
}

function safeJsonParse<T = unknown>(value: unknown): T | null {
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function countCacheMarkers(value: unknown): number {
  if (value == null) return 0;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const m = text.match(CACHE_MARKER_RE);
  return m ? m.length : 0;
}

function parseDiscoveryDetails(details: string | undefined): { count: number; loaded: string[]; folders: string[] } {
  if (!details) return { count: 0, loaded: [], folders: [] };
  const countMatch = details.match(/Resolved\s+(\d+)\s+/i);
  const loadedMatch = details.match(/loaded:\s*\[([^\]]*)\]/i);
  const foldersMatch = details.match(/folders:\s*\[([^\]]*)\]/i);
  const splitList = (s?: string) =>
    s
      ? s
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
      : [];
  return {
    count: countMatch ? Number(countMatch[1]) : 0,
    loaded: splitList(loadedMatch?.[1]),
    folders: splitList(foldersMatch?.[1]),
  };
}

/** Heuristic parse of a "Resolve Customizations" generic event's `details` string.
 *  These events list which skills / instructions / agents were attached to a turn,
 *  and which were skipped + the reason. The exact format is unstable across versions,
 *  so we extract loosely and surface raw text alongside.
 */
function parseCustomizationsDetails(details: string | undefined): {
  attached: CustomizationsResolution['attached'];
  skipped: CustomizationsResolution['skipped'];
} {
  if (!details) return { attached: [], skipped: [] };
  const attached: CustomizationsResolution['attached'] = [];
  const skipped: CustomizationsResolution['skipped'] = [];

  const kindFor = (label: string): 'skill' | 'instruction' | 'agent' | 'unknown' => {
    const l = label.toLowerCase();
    if (l.includes('skill')) return 'skill';
    if (l.includes('instruction')) return 'instruction';
    if (l.includes('agent')) return 'agent';
    return 'unknown';
  };

  // Attempt: "attached <kind>: [a, b, c]" / "skipped <kind>: [a (reason), b (reason)]"
  const attachRe = /attached\s+([a-z]+)s?\s*:\s*\[([^\]]*)\]/gi;
  const skipRe = /skipped\s+([a-z]+)s?\s*:\s*\[([^\]]*)\]/gi;
  let m: RegExpExecArray | null;
  while ((m = attachRe.exec(details))) {
    const kind = kindFor(m[1]);
    for (const name of m[2].split(',').map((s) => s.trim()).filter(Boolean)) {
      attached.push({ kind, name });
    }
  }
  while ((m = skipRe.exec(details))) {
    const kind = kindFor(m[1]);
    for (const item of m[2].split(',').map((s) => s.trim()).filter(Boolean)) {
      const rm = item.match(/^([^()]+?)(?:\s*\(([^)]+)\))?$/);
      skipped.push({ kind, name: (rm?.[1] ?? item).trim(), reason: rm?.[2]?.trim() });
    }
  }
  return { attached, skipped };
}

function deriveWorkspaceHash(rootPath: string | undefined): string | undefined {
  if (!rootPath) return undefined;
  // .../workspaceStorage/<hash>/GitHub.copilot-chat/debug-logs/<sessionId>/
  const m = rootPath.match(/workspaceStorage[\\/]([0-9a-f]{8,})[\\/]/i);
  return m?.[1];
}

export interface ParseSessionInput {
  /** Parsed events from main.jsonl. */
  events: RawEvent[];
  /** Optional rolled-up models.json. */
  modelsCatalog?: SessionModelInfo[];
  /** filename -> raw text, for system_prompt_N.json files in the session folder. */
  systemPromptFiles?: Record<string, string>;
  /** filename -> raw text, for tools_N.json files in the session folder. */
  toolsFiles?: Record<string, string>;
  /** Source folder name (typically the sessionId). */
  rootDirName: string;
  /** Best-effort full path on disk (for workspaceHash extraction & display). */
  rootPath?: string;
  /** Bytes (informational). */
  fileSizesBytes?: { main: number; total: number };
  /** Reference back to the parent session if this is a child log. */
  parent?: { sessionId: string; label?: string };
}

/** Roll up a list of RawEvents into a fully-parsed Session. */
export function parseSession(input: ParseSessionInput): ParsedSession {
  const { events, rootDirName, rootPath, fileSizesBytes, modelsCatalog, parent } = input;
  const systemPromptFiles = input.systemPromptFiles ?? {};
  const toolsFiles = input.toolsFiles ?? {};

  const llmCalls: LlmCall[] = [];
  const toolCalls: ToolCallSummary[] = [];
  const turnsMap = new Map<string, Turn>();
  const customizations: CustomizationsResolution[] = [];
  const discoveries: DiscoveryRecord[] = [];
  const childSessionRefs: ChildSessionRefAttrs[] = [];
  const errors: RawEvent[] = [];

  let sessionId = events[0]?.sid ?? rootDirName;
  let startedAt = events[0]?.ts ?? 0;
  let endedAt = startedAt;
  let copilotVersion: string | undefined;
  let vscodeVersion: string | undefined;

  // Build span -> turnId map for attribution.
  // Strategy: turn_start spanId follows pattern; we record events between turn_start
  // and the matching turn_end for the same turnId. Then any LLM/tool call whose
  // parentSpanId chain reaches (or whose ts falls within) the turn window is attributed.
  const turnWindows: { turnId: string; start: number; end: number }[] = [];

  // First pass: turns + session metadata + simple categorization.
  for (const ev of events) {
    if (!ev || typeof ev.ts !== 'number') continue;
    if (ev.ts < startedAt) startedAt = ev.ts;
    if (ev.ts > endedAt) endedAt = ev.ts;
    if (ev.sid) sessionId = ev.sid;
    if (ev.status === 'error') errors.push(ev);

    switch (ev.type) {
      case 'session_start': {
        const a = ev.attrs as unknown as SessionStartAttrs;
        copilotVersion = a?.copilotVersion;
        vscodeVersion = a?.vscodeVersion;
        break;
      }
      case 'turn_start': {
        const a = ev.attrs as unknown as TurnAttrs;
        const turnId = a?.turnId ?? ev.spanId;
        turnsMap.set(turnId, {
          turnId,
          startTs: ev.ts,
          llmCallSpanIds: [],
          toolCallSpanIds: [],
          agentResponseSpanIds: [],
          status: 'ok',
        });
        break;
      }
      case 'turn_end': {
        const a = ev.attrs as unknown as TurnAttrs;
        const turnId = a?.turnId ?? ev.spanId;
        const t = turnsMap.get(turnId);
        if (t) {
          t.endTs = ev.ts;
          t.durationMs = ev.ts - t.startTs;
          if (ev.status === 'error') t.status = 'error';
          turnWindows.push({ turnId, start: t.startTs, end: ev.ts });
        }
        break;
      }
      case 'user_message': {
        // Attribute user_message to the next turn_start (typical ordering).
        // We'll resolve in a second pass.
        break;
      }
      case 'child_session_ref': {
        childSessionRefs.push(ev.attrs as unknown as ChildSessionRefAttrs);
        break;
      }
    }
  }

  // Sort turn windows for binary attribution.
  turnWindows.sort((a, b) => a.start - b.start);
  const findTurnIdAt = (ts: number): string | undefined => {
    // linear scan acceptable for typical N (tens to low hundreds of turns)
    for (const w of turnWindows) {
      if (ts >= w.start && (w.end === 0 || ts <= w.end || ts >= w.start)) {
        if (w.end === 0 || (ts >= w.start && ts <= w.end)) return w.turnId;
      }
    }
    // fallback: most recent turn that started before ts
    let last: string | undefined;
    for (const w of turnWindows) {
      if (w.start <= ts) last = w.turnId;
      else break;
    }
    return last;
  };

  // Second pass: rich event extraction.
  let pendingUserMessage: string | undefined;
  for (const ev of events) {
    switch (ev.type) {
      case 'user_message': {
        const a = ev.attrs as unknown as UserMessageAttrs;
        pendingUserMessage = a?.content;
        break;
      }
      case 'turn_start': {
        const a = ev.attrs as unknown as TurnAttrs;
        const turnId = a?.turnId ?? ev.spanId;
        const t = turnsMap.get(turnId);
        if (t && pendingUserMessage != null) {
          t.userMessageContent = pendingUserMessage;
          pendingUserMessage = undefined;
        }
        break;
      }
      case 'llm_request': {
        const a = (ev.attrs ?? {}) as unknown as LlmRequestAttrs;
        const turnId = findTurnIdAt(ev.ts);
        const cacheBoundaryHits =
          countCacheMarkers(a.userRequest) + countCacheMarkers(a.inputMessages);
        const inputTokens = Number(a.inputTokens ?? 0) || 0;
        const cachedTokens = Number((a as any).cachedTokens ?? 0) || 0;
        const outputTokens = Number(a.outputTokens ?? 0) || 0;
        const call: LlmCall = {
          spanId: ev.spanId,
          parentSpanId: ev.parentSpanId,
          turnId,
          ts: ev.ts,
          durationMs: ev.dur ?? 0,
          ttftMs: typeof a.ttft === 'number' ? a.ttft : undefined,
          model: String(a.model ?? 'unknown'),
          inputTokens,
          cachedTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          maxTokens: typeof a.maxTokens === 'number' ? a.maxTokens : undefined,
          systemPromptFile: a.systemPromptFile,
          toolsFile: a.toolsFile,
          status: ev.status,
          cacheBoundaryHits,
          raw: ev,
        };
        llmCalls.push(call);
        if (turnId) turnsMap.get(turnId)?.llmCallSpanIds.push(ev.spanId);
        break;
      }
      case 'tool_call': {
        const a = (ev.attrs ?? {}) as unknown as ToolCallAttrs;
        const turnId = findTurnIdAt(ev.ts);
        const argsLength =
          typeof a.args === 'string' ? a.args.length : a.args ? JSON.stringify(a.args).length : 0;
        const resultLength =
          typeof a.result === 'string'
            ? a.result.length
            : a.result
              ? JSON.stringify(a.result).length
              : 0;
        const errorMessage =
          a.error == null
            ? undefined
            : typeof a.error === 'string'
              ? a.error
              : (a.error as { message?: string })?.message ?? JSON.stringify(a.error);
        const summary: ToolCallSummary = {
          spanId: ev.spanId,
          parentSpanId: ev.parentSpanId,
          turnId,
          name: ev.name,
          ts: ev.ts,
          durationMs: ev.dur ?? 0,
          status: ev.status,
          argsLength,
          resultLength,
          errorMessage,
          raw: ev,
        };
        toolCalls.push(summary);
        if (turnId) turnsMap.get(turnId)?.toolCallSpanIds.push(ev.spanId);
        break;
      }
      case 'agent_response': {
        const turnId = findTurnIdAt(ev.ts);
        if (turnId) turnsMap.get(turnId)?.agentResponseSpanIds.push(ev.spanId);
        break;
      }
      case 'discovery': {
        const a = (ev.attrs ?? {}) as unknown as DiscoveryAttrs;
        const parsed = parseDiscoveryDetails(a.details);
        discoveries.push({
          ts: ev.ts,
          category: ev.name || a.category || 'Discovery',
          count: parsed.count,
          loaded: parsed.loaded,
          folders: parsed.folders,
          source: a.source,
          raw: ev,
        });
        break;
      }
      case 'generic': {
        const a = (ev.attrs ?? {}) as unknown as GenericAttrs;
        if (/customization/i.test(ev.name) || /customization/i.test(a.details ?? '')) {
          const parsed = parseCustomizationsDetails(a.details);
          customizations.push({
            ts: ev.ts,
            turnId: findTurnIdAt(ev.ts),
            attached: parsed.attached,
            skipped: parsed.skipped,
            raw: ev,
          });
        }
        break;
      }
    }
  }

  // Mark "unknown args" tool_call results that are JSON strings — for nicer display in UI.
  // No-op here; the UI does the parsing.
  void safeJsonParse;

  return {
    id: sessionId,
    rootDirName,
    workspaceHash: deriveWorkspaceHash(rootPath),
    workspacePath: rootPath,
    startedAt,
    endedAt,
    durationMs: Math.max(0, endedAt - startedAt),
    copilotVersion,
    vscodeVersion,
    events,
    llmCalls,
    turns: Array.from(turnsMap.values()).sort((a, b) => a.startTs - b.startTs),
    toolCalls,
    customizations,
    discoveries,
    childSessionRefs,
    errors,
    systemPromptFiles,
    toolsFiles,
    modelsCatalog,
    fileSizesBytes,
    parent,
  };
}

/** Convenience: parse just the events from a JSONL text blob. */
export function parseEventsFromText(text: string): RawEvent[] {
  return parseJsonl(text);
}
