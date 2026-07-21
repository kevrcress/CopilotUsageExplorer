# Research: VS Code extension stuck on "Loading…" after first use

Date: 2026-07-14
Task slug: vscode-ext-stuck-loading
Method: inline code review by the planning session (no separate research phase was run; findings below were read directly from source this session).

## Symptom (user report)

The extension worked on first open. Every subsequent open shows the "Loading…" screen indefinitely. User suspects a live-Copilot-vs-historical-data interaction. Observed on the user's work laptop; repro machine not currently available to this session.

## How the loading screen works

- `packages/ui/src/App.tsx:29` — renders "Loading…" while `loading === true`.
- `packages/ui/src/store.ts:48` — `loading` starts `true`; `store.ts:54-68` — `init()` flips it `false` only after `await cache.list()` resolves (or sets `error` if it rejects). [HIGH]
- In the VS Code host, `cache.list()` is `createGlobalStorageCache(bridge).list()` → `bridge.cacheOp('list')` (`apps/vscode-ext/webview/adapters.ts:65-67`). [HIGH]
- `bridge.cacheOp` registers a pending promise keyed by requestId and posts a `cacheOp` message; the promise resolves **only** when a matching `cacheResult` message arrives (`apps/vscode-ext/webview/bridge.ts:206-212`, `bridge.ts:149-156`). There is **no timeout** — if the reply never arrives, `loading` stays `true` forever. [HIGH]

## Root-cause finding: unbounded single-frame `cacheResult` reply

- Extension side: `handleCacheOp('list')` reads **every** cached session JSON from `globalStorageUri/sessions/` and returns the full array (`apps/vscode-ext/src/file-cache.ts:91-93`).
- The reply is sent as **one** `postMessage` with the entire array as `data` (`apps/vscode-ext/src/extension.ts:178-179`). Unlike session-log delivery — which is carefully batched under `MAX_MESSAGE_BYTES` = 20 MB (`extension.ts:294-337`, `protocol.ts:8`) — **cacheResult has no size batching at all**. [HIGH]
- Cached payloads are large: `ParsedSession` retains `events: RawEvent[]` (each event keeps its raw `content` string), plus raw `systemPromptFiles` and `toolsFiles` texts (`packages/core/src/types.ts:112-132`). A cached session is therefore roughly the size of its source debug log (multi-MB each). [HIGH]
- `post()` discards the boolean/promise returned by `webview.postMessage` (`extension.ts:152-154`), so a failed or dropped delivery is silent — no log, no error frame. [HIGH]

### Why "first time works, then never again"

1. First open: cache dir is empty → `list` returns `[]` → tiny reply → `loading` flips false → discovery ingests logs → **every session is upserted into the cache** (`store.ts:79`, `addSession`).
2. Second open: `init()`'s `cacheOp('list')` reply now carries the entire cache (potentially tens to hundreds of MB) in a single JSON-serialized postMessage. VS Code webview messages are JSON-serialized over IPC; very large frames stall the extension host serializer and/or fail to deliver. The pending promise never resolves → permanent "Loading…". [MEDIUM — mechanism at the VS Code IPC layer inferred; the unbounded-frame code path itself is verified]

The user's "using Copilot at the same time" hypothesis is adjacent but not the trigger: concurrent use just grows the cache faster (live-tail is on by default, `webview/main.tsx:78`, and each watched session is re-upserted). Cache size, not concurrency, is the variable that changed between first and second open. [MEDIUM]

## Same defect class elsewhere (in scope to note, fix optional)

- `cacheOp('export')` returns the whole cache as one JSON string in one frame (`file-cache.ts:113-116`) — same unbounded reply.
- `cacheOp('upsert')` sends one whole session webview→ext per call — bounded by single-session size (~one log file), lower risk.
- Boot data `prefsSnapshot()` inlines all workspaceState into an HTML attribute (`extension.ts:140-146`) — only prefs, small; not implicated.

## Ruled out

- `runDiscovery` re-send on reopen: batched under 20 MB via `sendBuckets`/`sendChunked` — not the hang. [HIGH]
- `init()` exception path: `handleCacheOp` errors are caught and posted as `cacheResult ok:false` (`extension.ts:180-182`), which would show the Error screen, not eternal Loading. The observed symptom therefore points at a reply that never arrives, not one that errors. [HIGH]

## Repro / troubleshooting steps for the affected machine (work laptop)

1. Output panel → channel "Copilot Usage Explorer" — activation and discovery logs appear here.
2. Command palette → "Developer: Open Webview Developer Tools" → Console tab — look for errors after opening the panel.
3. Check cache size: `~/Library/Application Support/Code/User/globalStorage/kevincress.copilot-usage-explorer/sessions/` (macOS) or `%APPDATA%\Code\User\globalStorage\kevincress.copilot-usage-explorer\sessions\` (Windows). Many/large JSON files + stuck loading = consistent with this diagnosis.
4. Confirming workaround: quit VS Code, rename that `sessions/` folder aside, reopen — the panel should load (first-run behavior). This preserves the data for later import if the fix ships chunked replies.

## Open questions

- Actual cache size on the affected machine (confirms severity). [LOW — unverified until user checks]
- Exact VS Code postMessage failure threshold — not needed for the fix; the fix bounds frames regardless.
