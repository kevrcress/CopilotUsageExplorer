# Build a Copilot Chat Debug Log Viewer

## Goal
Build a local, browser-based UI tool to ingest and analyze GitHub Copilot Chat **agent debug log** files (JSONL) emitted by VS Code when the setting `github.copilot.chat.agent.debugLog.fileLogging` is enabled.

The primary purpose is to give an **individual developer** detailed, **tokens-only** visibility into:

- Token usage per chat / per turn / per LLM call / per model
- Where the input tokens go: system prompt vs tools vs conversation (an estimated split)
- Tool, skill, instruction, and MCP-server behavior that drives token bloat
- Errors, retries, and wasted requests

Everything shown is taken **straight from the debug logs** — token counts as reported by Copilot. There is **no pricing, no USD cost, and no premium-request estimation** anywhere in the app.

Scope is **single-developer / local-only** for v1. No team rollup, no upload, no backend.

---

## Background context

### Where the logs live

When file logging is enabled in VS Code, logs are written to the workspace-storage folder:

**Windows**
```
%APPDATA%\Code\User\workspaceStorage\<workspaceHash>\GitHub.copilot-chat\debug-logs\<sessionId>\
```

**macOS**
```
~/Library/Application Support/Code/User/workspaceStorage/<workspaceHash>/GitHub.copilot-chat/debug-logs/<sessionId>/
```

**Linux**
```
~/.config/Code/User/workspaceStorage/<workspaceHash>/GitHub.copilot-chat/debug-logs/<sessionId>/
```

Each chat session produces a folder containing:

- `main.jsonl` — primary event stream, one JSON object per line
- `system_prompt_N.json` — captured system prompt for LLM call N
- `tools_N.json` — tool definitions sent to the model for LLM call N
- `models.json` — model metadata for the session
- `title-<childSessionId>.jsonl` — child sub-sessions (title generation, subagent runs, etc.)

A child session log is referenced from the parent via a `child_session_ref` event.

### Event schema (observed from real logs)

Every line in `main.jsonl` is shaped:

```json
{
  "v": 1,
  "ts": 1777483061160,
  "dur": 0,
  "sid": "2e5b8f32-66fc-427e-a390-5aaa0c19ca0c",
  "type": "...",
  "name": "...",
  "spanId": "...",
  "parentSpanId": "...",
  "status": "ok" | "error",
  "attrs": { ... }
}
```

Spans form a tree via `spanId` / `parentSpanId`, scoped within `sid`. `ts` is unix-ms, `dur` is wall-clock ms.

Known `type` values and their important `attrs`:

| type | Key `attrs` | Notes |
|---|---|---|
| `session_start` | `copilotVersion`, `vscodeVersion` | One per session |
| `user_message` | `content` | Raw user input for that turn |
| `turn_start` / `turn_end` | `turnId` | Brackets one model turn (may include multiple LLM calls + tool calls) |
| `llm_request` | `model`, `inputTokens`, `outputTokens`, `ttft`, `maxTokens`, `userRequest`, `inputMessages`, `systemPromptFile`, `toolsFile` | **Primary token signal.** `dur` is total request time |
| `agent_response` | `response` (assistant message parts incl. tool_calls), `reasoning` | Final assistant output for that LLM call |
| `tool_call` | `args`, `result`, `error?` | Built-in tools (`read_file`, `run_in_terminal`, `manage_todo_list`, etc.) and MCP tools |
| `discovery` | `details`, `category`, `source` | Agents / skills / instructions / hooks / slash-commands found at session start |
| `generic` | `details`, `category` | Misc events such as `Resolve Customizations` (lists which skills/instructions were attached to a turn and which were skipped + why) |
| `child_session_ref` | `childSessionId`, `childLogFile`, `label` | Pointer to a sub-session (title gen, subagent, etc.) |

Detect `"cache_control":{"type":"ephemeral"}` markers inside `userRequest` / `inputMessages` payloads — these indicate prompt-caching boundaries.

### Why this matters

There is **no first-party UI** that tells a developer:

- How many tokens a single chat conversation consumed, per turn and per model
- How input tokens grow as a conversation gets longer (context re-sent every turn)
- Which models were used and how heavy each was
- Which tool calls / subagent fan-out patterns blew up token usage
- Which skills, instructions, or MCP servers added the most tokens to system prompts

This tool fills that gap for the individual developer — without guessing at billing.

---

## Functional requirements

### 1. Ingest

- Drag-and-drop, "Open folder" picker, or file-picker for: the `debug-logs/` root, a single session folder, or a single `main.jsonl`
- Recursively discover sessions; auto-link `child_session_ref` to child log files
- All parsing happens **client-side** — these logs contain prompt content and may include source code, secrets, customer data
- Support live-tail mode where the browser allows it (File System Access API): poll a folder every ~5 s and stream new sessions/events into the UI. Fall back to Upload on paths the browser blocks (e.g. Windows `%APPDATA%`).

### 2. Session list view

Columns: session id, start time, duration, workspace (derive from the parent `workspaceStorage` folder name; allow a user-supplied `hash → friendly name` mapping), Copilot version, # turns, # LLM calls, total input tokens, total output tokens, model breakdown chip, error count.

Sortable and filterable.

### 3. Session detail view

Tabs (Conversation is the default):

- **Conversation** — reconstruct the chat as a collapsible split: chat bubbles on the left (`user_message` / `agent_response` pairs with inline tool calls and the usually-hidden `reasoning`), raw JSON turns on the right, with a **Chat / Split / JSON** layout toggle. Show an **input-tokens-per-turn growth sparkline** so the user can see context accumulating across turns.
- **Overview** — a **"Where your tokens go"** composition donut splitting the input total into **System prompt / Tools / Conversation & context**. Clearly label it an **estimated split**: the log reports only the input total, so derive the breakdown with a heuristic (~4 chars/token) over the captured `system_prompt_N.json` / `tools_N.json` (which are re-sent each LLM call). Also: a tokens-per-turn chart (input vs output), an input-vs-output bar, a per-model table with tier badges, and a health card.
- **Timeline / waterfall** of spans (turns → LLM calls → tool calls), color-coded by type, hoverable for `dur` and `ttft`.
- **Tool-call inspector** — name, args (pretty-printed JSON), result (truncated with expand), duration, status, error.
- **System prompt & tools viewer** — load the referenced `system_prompt_N.json` and `tools_N.json` and show their heuristic token contribution (~4 chars/token) so the user can spot bloat.
- **Customizations panel** — parse `Resolve Customizations` generic events to show which skills / instructions / agents were attached to each turn and which were skipped and why; plus the session-start discoveries.
- **Subagent tree** — visualize parent → child session relationships from `child_session_ref`, with rolled-up token totals.
- **Raw events** — every event in the JSONL, grouped by turn.

### 4. Token analytics

- **Summary tab**: token totals (input + output, LLM calls, tool calls), a per-model table with a tier badge, a per-tool usage table, and a **Usage Optimization Tips** section of context-aware suggestions for reducing token usage (context growth, model-tier fit, tool-call overhead, prompt caching, failed calls, general tips).
- **Analytics tab**: daily token usage over time (input vs output), tokens by model, tokens by workspace, top 10 sessions by total tokens, and a health summary (wasted tokens from errored LLM calls, failed tool calls, average input tokens per turn).
- **Model tiers** are a pure display heuristic — bucket model ids into **Lightweight** (`mini`/`flash`/`haiku`), **Versatile** (`sonnet`/`codex`/`gpt-5`/`gemini`+`pro`), or **Frontier** (`opus`/`gpt-5.5`). No price or quota is attached to a tier.

> Do **not** build any pricing, USD cost, premium-request, multiplier, model-catalog, or billing-reconciliation features. The only estimate in the whole app is the clearly-labeled token *composition* split on the Overview tab.

### 5. Search & filter

- Search across sessions, workspaces, models, and errors in the session list.
- Date-range filtering on the Summary and Analytics tabs.

### 6. Export

- Export the session list to **CSV** (one row per session).
- Export a single session as a self-contained **HTML report** (good for sharing) and as **JSON** (fidelity).
- Export / restore the full local cache as a **backup JSON** (Settings tab).
- **Redaction toggle** that hashes file paths and replaces prompt/response bodies with `[redacted]` for any export.

### 7. Privacy & safety

- 100% local. No telemetry. No network calls.
- Never write back into the source `debug-logs/` folder.
- Warn when opening logs that exceed a configurable size threshold.
- Vendor-neutral UI: don't name model vendors or their tooling in the interface; model ids that appear in the logs (e.g. `claude-opus-…`, `gpt-5-…`) are displayed as-is.

---

## Non-functional requirements

- Stack: **TypeScript + React + Vite**. No backend.
- Virtualized table: TanStack Table + TanStack Virtual (sessions can have thousands of events).
- Charts: Recharts.
- State: Zustand. Persist user settings (workspace name mappings, size threshold) locally.
- Cache: IndexedDB (Dexie) for parsed sessions so reopening is instant.
- Tokenization: a `~4 chars/token` heuristic (`src/lib/tokenizer.ts`); model-accurate tokenizers could be lazy-loaded later by extending that module.
- Theming: light / dark, follow system.
- Accessibility: keyboard navigation, ARIA labels, color-blind-safe palette for the timeline.
- Tests: Vitest for the parser and token rollups. Provide sanitized fixture JSONL files under `test/`.

---

## Deliverables

1. Working web app (`npm run dev`) — no backend required
2. Static build (`npm run build`) deployable to GitHub Pages
3. Optional stretch: package as a VS Code webview extension that auto-discovers the current install's `debug-logs` folder
4. README with the schema table above and a clearly-flagged note that the token *composition* split is an estimate (heuristic), while every other number is read straight from the logs

---

## Acceptance criteria

- Can open a real `debug-logs/` folder, list every session, and show per-session token totals within ~2 seconds for ≤100 sessions.
- For any session, I can see exactly how many input/output tokens it consumed, broken down by turn and by model.
- I can see how my input tokens grow over the course of a conversation.
- I can identify which skill / instruction file added the most tokens to my system prompts.
- I can export a per-session CSV / HTML / JSON for sharing.

---

## Out of scope (v1)

- Any pricing, cost, premium-request, or billing-reconciliation feature
- Calling the GitHub Copilot Admin API (org / enterprise metrics)
- Modifying or replaying chat sessions
- Multi-user / team rollup features
- Any data leaving the local machine
</content>
