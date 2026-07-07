// Schema for one event line in `main.jsonl` (and child session jsonl files).
// Derived from observed real logs as of Copilot Chat 0.45.x.

export type SpanStatus = 'ok' | 'error';

export type EventType =
  | 'session_start'
  | 'user_message'
  | 'turn_start'
  | 'turn_end'
  | 'llm_request'
  | 'agent_response'
  | 'tool_call'
  | 'discovery'
  | 'generic'
  | 'child_session_ref'
  | (string & {}); // forward-compatible

export interface RawEvent {
  v?: number;
  ts: number;            // unix ms
  dur: number;           // wall-clock ms
  sid: string;           // session id
  type: EventType;
  name: string;
  spanId: string;
  parentSpanId?: string;
  status: SpanStatus;
  attrs: Record<string, unknown>;
}

// ---- Per-type attr shapes (best-effort; fields may be missing) ----

export interface SessionStartAttrs {
  copilotVersion?: string;
  vscodeVersion?: string;
}

export interface UserMessageAttrs {
  content: string;
}

export interface TurnAttrs {
  turnId: string;
}

export interface LlmRequestAttrs {
  model: string;
  inputTokens?: number;
  cachedTokens?: number;
  outputTokens?: number;
  ttft?: number;            // time-to-first-token ms
  maxTokens?: number;
  userRequest?: unknown;    // possibly large; may include cache_control markers
  inputMessages?: unknown;  // possibly large
  systemPromptFile?: string;
  toolsFile?: string;
}

export interface AgentResponseAttrs {
  response?: unknown;       // assistant message parts (text + tool_calls)
  reasoning?: string;
}

export interface ToolCallAttrs {
  args?: unknown;           // observed as a JSON string in some versions
  result?: unknown;         // ditto
  error?: unknown;
}

export interface DiscoveryAttrs {
  details?: string;         // "Resolved N skills in Xms | loaded: [a,b,c] | folders: [...]"
  category?: string;
  source?: string;
}

export interface GenericAttrs {
  details?: string;
  category?: string;
}

export interface ChildSessionRefAttrs {
  childSessionId: string;
  childLogFile: string;
  label?: string;
}

// ---- models.json (per-session model catalog emitted by Copilot) ----

export interface SessionModelInfo {
  id: string;
  name?: string;
  vendor?: string;
  version?: string;
  preview?: boolean;
  billing?: {
    is_premium?: boolean;
    multiplier?: number;
    restricted_to?: string[];
  };
  capabilities?: {
    family?: string;
    tokenizer?: string;
    type?: string;
    limits?: Record<string, unknown>;
  };
  model_picker_category?: string;
}

// ---- Parsed (rolled-up) shapes used by the UI ----

export interface ParsedSession {
  id: string;
  title?: string;             // AI-generated conversation title from chatSessions/<id>.jsonl
  rootDirName: string;        // e.g. "2fab2c2f-..."
  workspaceHash?: string;     // derived from path: .../workspaceStorage/<hash>/...
  workspacePath?: string;     // best-effort full path on disk
  startedAt: number;          // unix ms
  endedAt: number;            // unix ms (ts of last event)
  durationMs: number;
  copilotVersion?: string;
  vscodeVersion?: string;
  events: RawEvent[];
  llmCalls: LlmCall[];
  turns: Turn[];
  toolCalls: ToolCallSummary[];
  customizations: CustomizationsResolution[];
  discoveries: DiscoveryRecord[];
  childSessionRefs: ChildSessionRefAttrs[];
  errors: RawEvent[];
  systemPromptFiles: Record<string, string>; // filename -> raw text
  toolsFiles: Record<string, string>;        // filename -> raw text
  modelsCatalog?: SessionModelInfo[];        // from models.json
  fileSizesBytes?: { main: number; total: number };
  parent?: { sessionId: string; label?: string };
}

export interface LlmCall {
  spanId: string;
  parentSpanId?: string;
  turnId?: string;
  ts: number;
  durationMs: number;
  ttftMs?: number;
  model: string;
  inputTokens: number;
  cachedTokens?: number;
  outputTokens: number;
  totalTokens: number;
  maxTokens?: number;
  systemPromptFile?: string;
  toolsFile?: string;
  status: SpanStatus;
  cacheBoundaryHits: number;     // count of "cache_control":{"type":"ephemeral"} markers in inputMessages
  raw: RawEvent;
}

export interface Turn {
  turnId: string;
  startTs: number;
  endTs?: number;
  durationMs?: number;
  llmCallSpanIds: string[];
  toolCallSpanIds: string[];
  userMessageContent?: string;
  agentResponseSpanIds: string[];
  status: SpanStatus;
}

export interface ToolCallSummary {
  spanId: string;
  parentSpanId?: string;
  turnId?: string;
  name: string;          // tool name
  ts: number;
  durationMs: number;
  status: SpanStatus;
  argsLength: number;
  resultLength: number;
  errorMessage?: string;
  raw: RawEvent;
}

export interface CustomizationsResolution {
  ts: number;
  turnId?: string;
  attached: { kind: 'skill' | 'instruction' | 'agent' | 'unknown'; name: string }[];
  skipped: { kind: 'skill' | 'instruction' | 'agent' | 'unknown'; name: string; reason?: string }[];
  raw: RawEvent;
}

export interface DiscoveryRecord {
  ts: number;
  category: string;        // "Agent Discovery", "Skill Discovery", ...
  count: number;
  loaded: string[];
  folders: string[];
  source?: string;
  raw: RawEvent;
}
