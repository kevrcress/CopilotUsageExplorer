# Implementation Plan: Fix VS Code webview stuck on "Loading…" after first use
Date: 2026-07-14
Task slug: vscode-ext-stuck-loading
Research: .claude-hve-tracking/research/2026-07-14/vscode-ext-stuck-loading.md
Status: Draft

## Overview

The webview's `init()` blocks on `cacheOp('list')`, whose reply ships the **entire** session cache in a single unbatched `postMessage` frame (`apps/vscode-ext/src/extension.ts:178-179`, `src/file-cache.ts:91-93`). Once the cache holds real sessions (after first use), the frame is tens-to-hundreds of MB and never arrives, so `loading` never flips false. Fix in four layers: (1) make the failure visible instead of infinite (timeout + delivery logging), (2) chunk the `list` reply under the existing 20 MB cap with incremental streaming, (3) show live loading progress in the UI so a working-but-slow load is distinguishable from a hang, (4) verify with tests and a populated-cache manual run. Field validation is install-and-observe on the affected machine: progress ticking up = chunked path working; error screen = the new diagnostics say what stalled.

## Phases

### Phase 1: Fail visibly instead of hanging forever
Dependencies: none
Estimated scope: `apps/vscode-ext/webview/bridge.ts`, `apps/vscode-ext/src/extension.ts` — ~40 lines
Success criteria: a `cacheOp` whose reply never arrives rejects within 30 s and the App shows the Error screen (store.ts:66-67 already routes a rejected `init()` there); a failed `postMessage` delivery is logged to the output channel.

Steps:
- [ ] Step 1.1: In `bridge.ts` `cacheOp()` (webview/bridge.ts:206-212), add a 60 s inactivity timeout that deletes the `pendingCache` entry and rejects with a descriptive error (op name + requestId). Clear the timer on resolve/reject. The timer measures gaps between frames, not total transfer time — it is re-armed on every received chunk (Step 2.4), and Step 2.2 streams frames incrementally so a healthy transfer never has long silent gaps.
  - Assumption: 60 s without a single frame means the reply is not coming (dropped frame or dead host), not merely slow [MEDIUM — user raised the slow-machine concern; incremental streaming in Step 2.2 is the primary mitigation, the timeout is the backstop]
- [ ] Step 1.2: In `extension.ts` `post()` (src/extension.ts:152-154), stop discarding the `postMessage` result — `.then(ok => { if (!ok) this.log.warn(...) }, e => this.log.warn(...))` with the message type in the log line.
  - Assumption: `webview.postMessage` returns `Thenable<boolean>` per VS Code API [HIGH — vscode.d.ts contract]
- [ ] Step 1.3: Log the serialized reply size for `cacheResult` frames before posting (JSON.stringify length of `data` for `list`/`export` ops only, to avoid the cost on every op), so field reports include the number.
  - Assumption: stringify cost is acceptable because Phase 2 bounds these frames anyway [MEDIUM]

### Phase 2: Chunk the `list` (and `export`) replies under MAX_MESSAGE_BYTES
Dependencies: Phase 1
Estimated scope: `apps/vscode-ext/src/protocol.ts`, `src/extension.ts`, `webview/bridge.ts` — ~90 lines
Success criteria: with a cache whose total size exceeds 20 MB, `cacheOp('list')` resolves with all sessions and no single posted frame's payload exceeds `MAX_MESSAGE_BYTES`; verified by the Phase 3 harness test.

Steps:
- [ ] Step 2.1: Add a `cacheResultChunk` message to `ExtToWebviewMessage` in protocol.ts: `{ type, requestId, items: unknown[], done: boolean }`, mirroring the existing `sessionsChunk` shape (protocol.ts:38 area).
- [ ] Step 2.2: In `extension.ts` `onMessage` `cacheOp` handling (src/extension.ts:176-184), special-case `list`: stream incrementally rather than read-all-then-batch — iterate the sessions dir file-by-file (refactor `readAll` in file-cache.ts:38-57 into an async generator or callback form), measure each payload via `JSON.stringify(payload).length`, and post a `cacheResultChunk` frame as soon as accumulated payloads reach `MAX_MESSAGE_BYTES`; final frame `done: true`. Incremental posting keeps frames flowing during long disk reads so the webview's inactivity timeout (Step 1.1) sees continuous progress. A single session larger than the cap ships alone in its own frame (same rule as `sendChunked`, extension.ts:317-337). Preserve the newest-first ordering `readAll` provides today by sorting the directory listing by each file's parsed `startedAt` before streaming — or drop the ordering guarantee explicitly if the store proves order-insensitive (it keys by id into a map, store.ts:62-64); record the choice as a DD. Non-`list` ops keep the single `cacheResult` reply.
  - Assumption: no single session payload approaches the ~1 GB hard IPC ceiling, since each ≈ one debug-log folder [MEDIUM]
- [ ] Step 2.3: Same treatment for `export`: build the export JSON per-session and stream string segments in `cacheResultChunk` frames; bridge concatenates. If this complicates the frame type, acceptable fallback is chunking only `list` and logging a size warning on `export` — record the choice as a DD in the planning log.
  - Assumption: export is user-triggered (backup), so a logged size warning is a tolerable interim state [MEDIUM]
- [ ] Step 2.4: In `bridge.ts` message listener (webview/bridge.ts:118-158), handle `cacheResultChunk`: accumulate `items` per requestId, resolve the pending promise on `done: true`. Store the `op` on each `pendingCache` entry when `cacheOp()` registers it (webview/bridge.ts:206-212) and expand the entry type to `{ op, buffer, timer, resolve, reject }`; on `done`, resolve with `op === 'export' ? buffer.join('') : buffer` so `adapters.ts` receives the shape it expects (array for `list`, string for `exportBackup`). Reset the Phase 1 timeout on every received chunk (clear the old timer before arming the new one) so slow-but-progressing transfers don't false-trip it. (DD-004 resolution.)
- [ ] Step 2.5: Confirm the Electron app and web app are unaffected: `rg "cacheResult" apps/ packages/` must show no consumers outside `apps/vscode-ext/` (they use Dexie/browser caches directly). If the grep hits elsewhere, stop and re-scope.

### Phase 3: Loading-progress UI
Dependencies: Phase 2
Estimated scope: `packages/ui/src/host.ts`, `store.ts`, `App.tsx`, `apps/vscode-ext/webview/adapters.ts`, `webview/bridge.ts` — ~60 lines
Success criteria: while `cacheOp('list')` chunks stream in, the loading screen shows a live count ("Loading cached sessions… N sessions / X MB") instead of bare "Loading…"; hosts whose caches don't report progress (web/electron Dexie) still render the plain loading state unchanged.

Steps:
- [ ] Step 3.1: Extend the `SessionCache.list` signature in `packages/ui/src/host.ts` with an **optional** progress callback: `list(onProgress?: (p: { sessions: number; bytes: number }) => void)`. Optionality keeps the Dexie cache and web adapters compiling untouched.
  - Assumption: `SessionCache` is defined in packages/ui/src/host.ts and Dexie/web adapters implement it structurally, so an added optional parameter is non-breaking [MEDIUM — verify with a workspace typecheck (`npm run build` or `tsc -b`) before committing; if list is declared elsewhere, follow the actual definition site]
- [ ] Step 3.2: Add `loadingProgress: { sessions: number; bytes: number } | null` to the store state (packages/ui/src/store.ts); `init()` passes an `onProgress` that `set({ loadingProgress })`s, and clears it to `null` when `loading` flips false (both success and error paths).
- [ ] Step 3.3: In `App.tsx` (packages/ui/src/App.tsx:29-31), render the progress line inside the loading branch when `loadingProgress` is non-null: session count and MB received (one decimal). Keep plain "Loading…" when null so web/electron behavior is unchanged.
- [ ] Step 3.4: Wire it in the VS Code host: `bridge.cacheOp` accepts an optional per-chunk callback (invoked with cumulative items length and byte estimate as `cacheResultChunk` frames arrive, webview/bridge.ts message listener); `createGlobalStorageCache().list(onProgress)` forwards it (apps/vscode-ext/webview/adapters.ts:65-67). Byte estimate: sum of `JSON.stringify` lengths is already computed extension-side for framing — include a `bytes` field on `cacheResultChunk` frames so the webview doesn't re-stringify.
  - Assumption: adding an optional `bytes` field to the new `cacheResultChunk` message is free since the protocol is being introduced in Phase 2 of this same plan [HIGH]

### Phase 4: Tests and verification
Dependencies: Phase 3
Estimated scope: `apps/vscode-ext/test/` new file(s) — ~120 lines; manual run
Success criteria: new tests pass in CI harness (`npm test` in apps/vscode-ext); manual Extension Development Host run with a >20 MB synthetic cache shows live progress on the loading screen and reaches the dashboard.

Steps:
- [ ] Step 4.1: Unit-test the frame-batching function (extract it so it's testable pure): buckets of known sizes → frame count and per-frame byte totals under the cap; oversized-single-item case ships alone.
- [ ] Step 4.2: Unit-test bridge chunk reassembly: synthetic `cacheResultChunk` sequences (in-order, single-frame, empty list) resolve with the concatenated items; missing `done` trips the timeout rejection; the per-chunk progress callback reports cumulative sessions/bytes.
- [ ] Step 4.3: Manual verification in the Extension Development Host: seed `globalStorage/kevincress.copilot-usage-explorer/sessions/` with synthetic session JSONs totalling >20 MB (script it into the scratchpad, copy in), open the panel, confirm the loading screen shows a live progress count, the dashboard renders, and the output channel shows chunked frame logs. Record the observed frame count in the changes log.
  - Assumption: a local VS Code with the extension side-loaded is available for this step — this is the primary pre-ship validation, since the user plans to install the built VSIX on the affected machine directly rather than troubleshoot there first [MEDIUM]

## Risk Log
| Risk | Likelihood | Mitigation |
|---|---|---|
| Very large caches still slow to transfer even chunked (UI blocked on init) | Medium | Chunks keep frames deliverable; timeout now surfaces failure. Follow-up (out of scope): lazy-load session payloads, list metadata only |
| `export` chunking complicates the protocol | Medium | Step 2.3 explicitly allows the logged-warning fallback, recorded as DD |
| Timeout false-trips on genuinely slow machines | Low | Timer measures inter-frame gaps only: 60 s, re-armed per chunk (Step 2.4), and Step 2.2 streams frames during disk reads so healthy transfers show continuous progress |
| A single session payload alone exceeds deliverable size | Low | Ships alone in one frame; log its size; follow-up if observed |

## Testing Approach

Unit tests for the two pure pieces (frame batching, chunk reassembly + progress callback) in the existing vitest-style harness (`apps/vscode-ext/test/version-compare.test.ts` shows the pattern). End-to-end confirmation via a seeded oversized cache in the Extension Development Host (Step 4.3) — this is the load-bearing validation, because field validation is install-and-observe only: the user will install the fixed VSIX on the previously stuck machine without prior troubleshooting. The Phase 3 progress UI and Phase 1 error screen are what make that observation conclusive (progress ticking = fix working; stall error = diagnostics captured in the output channel for a follow-up).
