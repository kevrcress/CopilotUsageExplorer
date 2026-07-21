# Changes Log: Fix VS Code webview stuck on "Loading…" after first use
Date: 2026-07-14
Plan: .claude-hve-tracking/plans/2026-07-14/vscode-ext-stuck-loading-plan.md
Status: Complete

## Phases

### Phase 1: Fail visibly instead of hanging forever
Status: Complete
Started: 2026-07-14T11:20:00Z
Completed: 2026-07-14T11:28:00Z

#### Files Modified
- `apps/vscode-ext/webview/bridge.ts:83-88` — added `CACHE_OP_TIMEOUT_MS = 60_000` constant
- `apps/vscode-ext/webview/bridge.ts:99-102` — `pendingCache` entry type expanded to `{ op, resolve, reject, timer }`
- `apps/vscode-ext/webview/bridge.ts:155-162` — `cacheResult` handler clears the timer on resolve/reject
- `apps/vscode-ext/webview/bridge.ts:212-221` — `cacheOp()` arms a 60s inactivity timer at send time; on fire, deletes the `pendingCache` entry and rejects with `cacheOp '<op>' stalled: no reply frame for 60s (requestId <id>)`
- `apps/vscode-ext/src/extension.ts:152-160` — `post()` now chains `.then(ok => ..., e => ...)` on the `postMessage` result instead of discarding it; logs `postMessage(<type>) not delivered` or `postMessage(<type>) failed: <message>` via `this.log.warn`
- `apps/vscode-ext/src/extension.ts:176-184` — `cacheOp` handling logs `cacheOp '<op>' reply size: <bytes> bytes` via `this.log.info` for `list`/`export` ops only, before posting `cacheResult`

#### Steps Completed
- [x] Step 1.1: bridge.ts cacheOp() 60s inactivity timeout — `apps/vscode-ext/webview/bridge.ts:212-221`
- [x] Step 1.2: extension.ts post() logs failed delivery — `apps/vscode-ext/src/extension.ts:152-160`
- [x] Step 1.3: log serialized reply size for cacheResult (list/export) — `apps/vscode-ext/src/extension.ts:176-184`

#### Issues Encountered
None. Verified with `npx vitest run` (26/26 passed, workspace root) and `npm run typecheck` (apps/vscode-ext, clean).

#### Discrepancies & Decisions
- DR-001: The plan's Phase 1 success-criteria line states the `cacheOp` reply timeout is "within 30 s," but Step 1.1 itself and details.md §4 (`CACHE_OP_TIMEOUT_MS = 60_000`) both specify 60s, and details.md §4 explicitly ties this same 60s constant into the Phase 2 re-arming behavior (bridge.ts message listener, `resetTimer`). The 30s figure appears nowhere else and is inconsistent with the rest of the plan/details.
- DD-001: Resolved DR-001 by implementing `CACHE_OP_TIMEOUT_MS = 60_000` (60s) per Step 1.1 and details.md §4, since those are more specific and internally consistent with Phase 2's design (the same constant is reused and re-armed there). The 30s success-criteria line is treated as a stale/imprecise restatement, not a separate requirement.

---

### Phase 2: Chunk the `list` (and `export`) replies under MAX_MESSAGE_BYTES
Status: Complete
Started: 2026-07-14T11:35:00Z
Completed: 2026-07-14T11:55:00Z

#### Files Modified
- `apps/vscode-ext/src/protocol.ts:53-66` — added `cacheResultChunk` to `ExtToWebviewMessage`: `{ type, requestId, items: unknown[], done, bytes? }`
- `apps/vscode-ext/src/frame-batch.ts:1-52` (new file) — `batchBySize<T>(items, sizeOf, cap): T[][]` pure batching helper; `streamBatches<T>(source, sizeOf, cap, onFrame)` async streaming wrapper built on top of it
- `apps/vscode-ext/src/file-cache.ts:38-67` — replaced `readAll`'s read-then-sort loop with `iterateSessions()`, an async generator that yields each parsed `StoredSession` as its file is read
- `apps/vscode-ext/src/file-cache.ts:69-89` — added `iterateSessionPayloads()` (list source) and `iterateExportSegments()` (export source: header + per-session `JSON.stringify` + separators + trailer, streamed as string segments)
- `apps/vscode-ext/src/file-cache.ts:115-123` — `handleCacheOp` narrowed to `SingleFrameCacheOp = Exclude<CacheOp, {op:'list'}|{op:'export'}>`; `list`/`export` cases removed (now handled by extension.ts streaming methods)
- `apps/vscode-ext/src/extension.ts:9-10` — import `iterateExportSegments`, `iterateSessionPayloads` from file-cache.ts, `streamBatches` from frame-batch.ts
- `apps/vscode-ext/src/extension.ts:184-192` — `cacheOp` handling special-cases `list`/`export` to `streamList`/`streamExport`; all other ops keep the single-frame `handleCacheOp` → `cacheResult` path
- `apps/vscode-ext/src/extension.ts:205-259` — new `streamList()`/`streamExport()` methods: drive `streamBatches` over the file-cache generators, post one `cacheResultChunk` frame per filled batch (with `bytes`), log final `cacheOp '<op>' reply size: <bytes> bytes, <n> session(s)/frame(s)`; error mid-stream posts a `cacheResult` with `ok:false` (bridge still has the pending entry to reject)
- `apps/vscode-ext/webview/bridge.ts:99-124` — `pendingCache` entry gains `buffer: unknown[]`; extracted `armCacheTimeout(requestId)` (used both at initial arm and re-arm) so the reject message and delete logic live in one place
- `apps/vscode-ext/webview/bridge.ts:188-201` — added `cacheResultChunk` case: pushes `items` into `buffer`, clears the timer; on `done`, deletes the pending entry and resolves with `buffer.join('')` for `export` or `buffer` (array) for `list`; otherwise re-arms the timer via `armCacheTimeout`
- `apps/vscode-ext/webview/bridge.ts:216-221` — `cacheOp()` now sets `buffer: []` and calls `armCacheTimeout(requestId)` instead of inlining the timer/reject logic

#### Steps Completed
- [x] Step 2.1: `cacheResultChunk` message added to protocol.ts, including the `bytes?` field (kept in scope now per details.md §8/Phase 3 prep) — `apps/vscode-ext/src/protocol.ts:53-66`
- [x] Step 2.2: extension.ts streams `list` chunks incrementally via `iterateSessions`/`iterateSessionPayloads` generators + `streamBatches`/`batchBySize` (`apps/vscode-ext/src/frame-batch.ts`) — `apps/vscode-ext/src/extension.ts:205-233`, `apps/vscode-ext/src/file-cache.ts:38-74`
- [x] Step 2.3: `export` chunking implemented via the **preferred** streaming approach (not the single-frame fallback) — header + per-session `JSON.stringify` + separators + trailer as string segments, batched the same way — `apps/vscode-ext/src/file-cache.ts:76-89`, `apps/vscode-ext/src/extension.ts:235-259`
- [x] Step 2.4: bridge.ts handles `cacheResultChunk`: accumulates into `buffer`, resets the inactivity timer per chunk, resolves on `done` with `buffer.join('')` (export) or `buffer` (list) — `apps/vscode-ext/webview/bridge.ts:188-201`
- [x] Step 2.5: `rg "cacheResult" apps/ packages/` — all 17 matches are inside `apps/vscode-ext/` (protocol.ts, bridge.ts, extension.ts, file-cache.ts, frame-batch.ts doc comment); no consumers in the Electron or web apps or in `packages/`, so those hosts (Dexie-backed) are unaffected

#### Issues Encountered
None. `npm run typecheck` (apps/vscode-ext) passes clean; `npx vitest run` (workspace root) passes 26/26 with no regressions.

#### Discrepancies & Decisions
- DD-002: `iterateSessions()` (file-cache.ts:38-67) yields sessions in `fs.readdir` order rather than reusing the old `readAll`'s newest-first (`startedAt` descending) sort. Preserving that sort would require reading every session file into memory before any could be yielded, which defeats the purpose of streaming (posting a frame as soon as it fills, to keep the bridge's inactivity timer fed during a long disk read). Verified `packages/ui/src/store.ts:63` keys `list()` results into `sessions[s.id] = s` (a `Record`, not an ordered array/list render), so the app is order-insensitive — dropping the ordering guarantee is safe. This is the DD the plan (Step 2.2) explicitly anticipated and permitted.
- DD-003: `export` was implemented via the plan's **preferred** chunked-streaming approach (details.md §5), not the single-frame-with-`log.warn` fallback. The string-segment streaming reused the same `streamBatches`/`batchBySize` machinery already built for `list`, so the "if this proves complex" condition for falling back never materialized — no separate export-only code path was needed.

---

### Phase 3: Loading-progress UI
Status: Complete
Started: 2026-07-14T12:05:00Z
Completed: 2026-07-14T12:20:00Z

#### Files Modified
- `packages/ui/src/host.ts:5-9` — `SessionCache.list` gains optional `onProgress?: (p: { sessions: number; bytes: number }) => void)` param
- `packages/ui/src/store.ts:15` — `AppState.loadingProgress: { sessions: number; bytes: number } | null` added
- `packages/ui/src/store.ts:48` — initial state `loadingProgress: null`
- `packages/ui/src/store.ts:60-69` — `init()` passes `(p) => set({ loadingProgress: p })` to `cache.list()`; both success and error paths now also `set({ loadingProgress: null })` alongside `loading: false`
- `packages/ui/src/App.tsx:16` — destructure `loadingProgress` from `useAppStore()`
- `packages/ui/src/App.tsx:29-36` — loading branch renders `Loading cached sessions… N session(s) · X.X MB` when `loadingProgress` is non-null, else plain `Loading…`
- `apps/vscode-ext/webview/bridge.ts:78-84` — `Bridge.cacheOp` gains optional third param `onProgress?: (p: { sessions: number; bytes: number }) => void)`
- `apps/vscode-ext/webview/bridge.ts:99-117` — `pendingCache` entry gains `bytesReceived: number` and `onProgress?`
- `apps/vscode-ext/webview/bridge.ts:197-213` — `cacheResultChunk` handler accumulates `msg.bytes ?? 0` into `bytesReceived` and invokes `p.onProgress?.({ sessions: buffer.length, bytes: bytesReceived })` per frame, before the existing timer reset/done logic
- `apps/vscode-ext/webview/bridge.ts:264-278` — `cacheOp()` accepts `onProgress` and stores it (plus `bytesReceived: 0`) on the new `pendingCache` entry
- `apps/vscode-ext/webview/adapters.ts:65-67` — `createGlobalStorageCache().list(onProgress?)` forwards it as `bridge.cacheOp('list', undefined, onProgress)`

#### Steps Completed
- [x] Step 3.1: `SessionCache.list` optional progress callback — confirmed `SessionCache` is defined in `packages/ui/src/host.ts:5` (not elsewhere); Dexie adapter (`packages/ui/src/adapters/dexie-cache.ts:41`, `async list(): Promise<ParsedSession[]>`) and electron's use of it compile unchanged since the added param is optional — `packages/ui/src/host.ts:5-9`
- [x] Step 3.2: store.ts `loadingProgress` state, wired through `init()`, cleared to `null` on both success and error — `packages/ui/src/store.ts:15,48,60-69`
- [x] Step 3.3: App.tsx progress line in the loading branch — `packages/ui/src/App.tsx:29-36`
- [x] Step 3.4: VS Code host wiring — `bridge.ts` cacheOp's onProgress + cumulative bytes tracking, `adapters.ts` forwards — `apps/vscode-ext/webview/bridge.ts:78-84,99-117,197-213,264-278`, `apps/vscode-ext/webview/adapters.ts:65-67`

#### Issues Encountered
None. Verified with:
- `npx vitest run` (workspace root): 26/26 passed, no regressions
- `npm run typecheck` (apps/vscode-ext): clean (`tsc -p tsconfig.json` + `tsc -p tsconfig.webview.json`)
- `npx tsc -p tsconfig.json --noEmit` (apps/web): clean, confirming the Dexie `SessionCache` adapter still satisfies the interface with the added optional param
- `npm run typecheck` (apps/electron): clean (`tsc -p tsconfig.node.json` + `tsc -p tsconfig.web.json`), confirming the electron renderer's use of the Dexie cache is unaffected

`packages/ui` has no dedicated typecheck script; its compilation was validated transitively via the apps/web and apps/electron typechecks above, both of which import `@cue/ui` directly.

#### Discrepancies & Decisions
None.

---

### Phase 4: Tests and verification
Status: Complete
Started: 2026-07-14T12:30:00Z
Completed: 2026-07-14 (4.3 confirmed by user)

#### Files Modified
- `apps/vscode-ext/test/frame-batch.test.ts` (new) — unit tests for `batchBySize` (frame-count/byte-cap correctness, oversized-single-item, empty-input) and `streamBatches` (incremental emission with a final `done:true`, empty-source case)
- `apps/vscode-ext/test/bridge.test.ts` (new) — unit tests for `bridge.ts` `cacheResultChunk` reassembly: in-order multi-frame, single-frame, empty-list, export segment-join, cumulative `onProgress`, inactivity-timeout rejection (fake timers), and non-false-trip under progressing chunks
- `apps/vscode-ext/tsconfig.json:7-8` — added `"exclude": ["test/bridge.test.ts"]` so the node-only (no DOM lib) project config doesn't try to type-check `bridge.test.ts`'s import of `webview/bridge.ts`
- `apps/vscode-ext/tsconfig.webview.json:8` — added `"test/bridge.test.ts"` to `include`, so it's type-checked under the DOM-lib webview config instead (DD-004, see below)

#### Steps Completed
- [x] Step 4.1: unit tests for `batchBySize`/`streamBatches` — `apps/vscode-ext/test/frame-batch.test.ts`, exercising `apps/vscode-ext/src/frame-batch.ts:7-57`
- [x] Step 4.2: unit tests for `bridge.ts` chunk reassembly, timeout, and progress callback — `apps/vscode-ext/test/bridge.test.ts`, exercising `apps/vscode-ext/webview/bridge.ts:105-278`
- [x] Step 4.3: Manual Extension Development Host verification — performed by the user against their **real** globalStorage cache (767 MB, ~38x the 20MB cap) rather than the synthetic seed script, since the real cache already exceeded the threshold. `apps/vscode-ext/.vscode/launch.json` and `.vscode/tasks.json` were added (this project had no `.vscode/` debug config at all) to enable F5 launch; the `tasks.json` npm task had to be switched from VS Code's `npm` task type (which silently substituted `pnpm`, causing a build failure — this repo has no `packageManager` field and uses npm workspaces per the root `package-lock.json`) to an explicit `shell` command `npm run build`. User confirmed: the loading screen showed live progress instead of hanging, and the dashboard rendered successfully with the real 767MB cache. A synthetic seed script was written to the scratchpad but was not needed.

#### Issues Encountered
- Running `npm run typecheck` (apps/vscode-ext) after adding `test/bridge.test.ts` surfaced a pre-existing tsconfig split issue: `tsconfig.json` (node-only, no DOM lib) includes the whole `test/` directory, but the new test imports `webview/bridge.ts`, which needs `document`/`window`/`MessageEvent` from the DOM lib (only present in `tsconfig.webview.json`). Fixed by excluding `bridge.test.ts` from `tsconfig.json` and including it in `tsconfig.webview.json` instead (DD-004). This didn't surface before because `version-compare.test.ts` never imported webview code.
- `bridge.ts` acquires `vscode.postMessage` via a module-level `const vscode = acquireVsCodeApi();` (an ambient `declare function`) and listens via the global `window`, neither of which exist in vitest's `node` test environment. Rather than restructuring `bridge.ts` to inject these as parameters (a larger refactor than this phase's scope), `bridge.test.ts` stubs `globalThis.acquireVsCodeApi` and `globalThis.window` per test and uses `vi.resetModules()` + dynamic `import()` to get a fresh module instance per test with that test's mocks in place before the module-level `acquireVsCodeApi()` call runs. No production code in `bridge.ts` was changed to enable this.

#### Discrepancies & Decisions
- DD-004: Split `bridge.test.ts` out of `tsconfig.json`'s `test/` inclusion and into `tsconfig.webview.json`'s `include` instead, because it's the only test file that imports DOM-dependent webview code (see Issues Encountered). This is a test-file-routing config change only — no production `src`/`webview` compiler options changed, and `tsconfig.json` still covers every other file under `test/`.

---

## Final Verification
- `npx vitest run` (workspace root): 39/39 tests passed, 7 files, no regressions.
- `npm run typecheck` (apps/vscode-ext): clean.

## Security Hygiene Check
- `git diff HEAD --name-only`: 10 files changed, all `apps/vscode-ext/` and `packages/ui/` source/config — no credential-like filenames.
- Grep changed files for `PRIVATE KEY|api_key\s*=|password\s*=|-----BEGIN|Bearer `: no matches.
- `.gitignore` contains `.env`, `.env.local`, `*.pem`, `*.key`, `*.p12`: confirmed present.
- No new dependencies added in this task.

---
