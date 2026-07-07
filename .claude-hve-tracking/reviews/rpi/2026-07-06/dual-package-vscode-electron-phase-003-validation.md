# RPI Validation: Package CopilotUsageExplorer as VS Code extension + Electron app — Phase 3
Date: 2026-07-06
Plan phase: Phase 3: Electron app
Coverage: 100% (6/6 plan steps verified)
Status: Pass

---

## Plan Item Comparison

| Plan Step | Changes Log Entry | Evidence File | Status |
|---|---|---|---|
| Step 3.1: Scaffold electron-vite v5, renderer imports workspace packages | Phase 3 Scaffold/config section | `apps/electron/electron.vite.config.ts:1-15` | ✅ Implemented |
| Step 3.2: Main process discovery — per-OS paths, session enumeration, fs.watch | Phase 3 Main process section | `apps/electron/src/main/discovery.ts:19-84,275-298` | ✅ Implemented |
| Step 3.3: Preload/IPC contextBridge API, contextIsolation on, SerializedFile→RecoveredFile | Phase 3 Preload section | `apps/electron/src/preload/index.ts:1-51`, `apps/electron/src/main/index.ts:110-114` | ✅ Implemented |
| Step 3.4: Production renderer from app:// custom scheme, stable IndexedDB origin | Phase 3 Main process & config section | `apps/electron/src/main/index.ts:17-44,129` | ✅ Implemented |
| Step 3.5: electron-builder config Windows NSIS + GitHub auto-update, unsigned, macOS zip opt-in | Phase 3 Scaffold/config section | `apps/electron/electron-builder.yml:1-27` | ✅ Implemented |
| Step 3.6: Guard step — macOS smoke (auto-discovery, cache persistence, live tail), dev/build green | Phase 3 Issues/verification section | Changes log line 181 (verified green) | ✅ Verified |

---

## Findings

### RV3-001 [CRITICAL]
**Plan item:** Step 3.3 — File.path removal (Electron 32) — research flagged this breaking change

**Evidence:** Grep of entire `apps/electron/` tree and workspace returns zero hits for `File.path` or `getPathForFile`. All file path handling uses Node `fs` APIs in the main process and passes serialized paths + file contents through IPC. Preload script never touches `File.path`.

**Details:** 
- `apps/electron/src/preload/index.ts:51` — contextBridge exposes only `window.cue` API (typed in `src/shared/protocol.ts:29-43`); no File access
- `apps/electron/src/renderer/src/adapters/electron-ingest.ts:6-14` — SerializedFile→RecoveredFile wrapper provides `text` and `readHead` callbacks as async functions, not File objects
- `apps/electron/src/main/discovery.ts:86-102` — `serializeFile()` reads file contents on the main process using `fsp.readFile` and passes strings over IPC

**Impact:** None — implementation correctly avoids the deprecated API.

**Recommendation:** No action required; the implementation is correct as-is.

---

### RV3-002 [CRITICAL]
**Plan item:** Step 3.4 — app:// custom scheme to pin IndexedDB origin across updates

**Evidence:** The app:// scheme is registered and used correctly in production.

**Details:**
- `apps/electron/src/main/index.ts:17-25` — `registerSchemesAsPrivileged` registers app scheme with `standard: true, secure: true, supportFetchAPI: true`
- `:27-44` — `protocol.handle(APP_SCHEME, ...)` implements path traversal guard (`:33-35`) and SPA fallback to index.html
- `:125-130` — Dev mode uses `ELECTRON_RENDERER_URL`, production uses `app://bundle/index.html`
- Changes log line 179 — smoke test confirmed: "dev uses ELECTRON_RENDERER_URL; prod verified: smoke run loaded app://bundle/index.html"

**Impact:** None — scheme correctly implemented and verified to work.

**Recommendation:** No action required.

---

### RV3-003 [CRITICAL]
**Plan item:** Step 3.3 — contextIsolation on and nodeIntegration off as per security requirement

**Evidence:** Both settings are correctly configured in the BrowserWindow.

**Details:**
- `apps/electron/src/main/index.ts:110-114` — BrowserWindow webPreferences explicitly set:
  - `contextIsolation: true` (line 112)
  - `nodeIntegration: false` (line 113)
  - `preload: path.join(__dirname, '../preload/index.js')` (line 111)

**Impact:** None — security constraints met.

**Recommendation:** No action required.

---

### RV3-004 [CRITICAL]
**Plan item:** Step 3.5 — autoUpdater guarded to packaged + Windows-only (not macOS due to no signing)

**Evidence:** The autoUpdater guard correctly implements Windows-only policy and documents macOS limitation.

**Details:**
- `apps/electron/src/main/index.ts:133-140` — `setupAutoUpdate()` function:
  - `:136` — `if (!app.isPackaged || process.platform !== 'win32') return;` guards auto-update to packaged builds on Windows only
  - `:137-139` — error swallowing prevents startup blocking if offline or no releases exist
- `apps/electron/README.md:20-31` — macOS section documents manual installation only, no auto-update, with unsigned zip build command
- `apps/electron/electron-builder.yml:17-21` — macOS target explicitly sets `identity: null` (unsigned)
- Changes log line 204 (DD-306) — explicitly justifies the Windows-only guard: "autoUpdater guarded to `app.isPackaged && process.platform === 'win32'` — unsigned macOS builds cannot auto-update (Squirrel.Mac requires signing), per the user-confirmed Windows-only update constraint."

**Impact:** None — constraint correctly implemented.

**Recommendation:** No action required; Windows-only constraint documented in README.

---

### RV3-005 [MAJOR]
**Plan item:** Step 3.3 — Preload API exposes `discoverSessions`, `watchSessions`, `unwatch`, `saveFile`, `pickFolderAndRead` with chunked discovery per plan Step 3.3

**Evidence:** All required IPC channels are implemented and chunking is in place.

**Details:**
- `apps/electron/src/preload/index.ts:13-49` — CueApi interface exposes all five methods:
  - `:14` — `listVSCodeInstalls()`
  - `:18-26` — `discoverSessions()` assembles buckets one-per-IPC-message (`:19` listBuckets, then loop `:21-24` readBucket per ref)
  - `:28-35` — `watchSessions()` with callback registration
  - `:37-44` — `unwatch()`
  - `:46` — `saveFile()`
  - `:48` — `pickFolderAndRead()`
- `apps/electron/src/main/index.ts:52-97` — All ipcMain.handle handlers match preload channels
- Changes log line 199 (DD-302) — "Discovery IPC is chunked (listBuckets + readBucket channels, one session bucket per message) instead of one discoverSessions payload — 633 MB in a single structured-clone message is fragile; matches plan Step 2.4's chunking principle."

**Impact:** None — all required APIs implemented and chunked correctly.

**Recommendation:** No action required.

---

### RV3-006 [MAJOR]
**Plan item:** Step 3.2 — Per-OS workspaceStorage path probing (Windows %APPDATA%, macOS ~/Library, Linux ~/.config) plus VSCode Insiders/VSCodium/Cursor variants, with workspace.json friendly names

**Evidence:** All OS-specific paths and product variants are implemented with correct path construction.

**Details:**
- `apps/electron/src/main/discovery.ts:19-27` — `userDataRoot()` function:
  - `:20-21` — Windows: `%APPDATA%` or `AppData/Roaming` fallback
  - `:23-24` — macOS: `~/Library/Application Support`
  - `:26` — Linux: `$XDG_CONFIG_HOME` or `~/.config`
- `:8-13` — `PRODUCT_DIRS` array lists all four products: Code, Code - Insiders, VSCodium, Cursor
- `:47-58` — `readWorkspaceName()` parses workspace.json and extracts the friendly name from folder/workspace/configuration URI
- `:65-84` — `listVSCodeInstalls()` walks all products and hashes, populating workspaceNames map
- Changes log line 160 — "probes %APPDATA% / ~/Library/Application Support / ~/.config × Code / Code - Insiders / VSCodium / Cursor"

**Impact:** None — all OS and product variants correctly enumerated.

**Recommendation:** No action required.

---

## Unlisted Changes

No unlisted files found in `apps/electron/` that represent work not claimed in the Phase 3 changes log. All files are accounted for:
- Scaffold files: electron.vite.config.ts, tsconfig.*.json, tailwind.config.js, postcss.config.js, package.json, README.md, electron-builder.yml
- Main process: src/main/index.ts, src/main/discovery.ts, src/shared/protocol.ts
- Preload: src/preload/index.ts
- Renderer: src/renderer/ (main.tsx, IngestPanel.tsx, adapters, index.html, index.css, cue.d.ts, ingest-controller.ts)

---

## Research Coverage

### Key research requirements for Phase 3 (from research.md):

1. **File.path removed in Electron 32** [HIGH] — Research flagged this as MEDIUM confidence finding; implementation verified: zero uses of File.path anywhere in the codebase; all file I/O on main process via Node fs APIs, fully compliant.

2. **electron-vite scaffold with workspace source resolution** [HIGH] — Implementation matches: `electron.vite.config.ts:6-7` explicitly excludes `@cue/core` from externalization, bundling workspace source directly.

3. **IPC: contextBridge, narrow API, request-response + push messaging** [HIGH] — Implementation matches: preload contextBridge exposes only the five methods in `CueApi`; ipcRenderer.invoke for request-response (discover, watch, save, pick), webContents.send for live-tail pushes.

4. **Windows NSIS + GitHub Releases auto-update, unsigned (SmartScreen warning accepted)** [HIGH] — Implementation matches: `electron-builder.yml` configures win nsis + publish github; unsigned (no identity); README documents SmartScreen warning path ("More info → Run anyway").

5. **macOS auto-update requires code signing; unsigned macOS = manual-only** [HIGH] — Implementation matches: macOS target in electron-builder.yml sets `identity: null`; `npm run build:mac-unsigned` script provided; README documents manual zip installation and no auto-update.

6. **Dexie/IndexedDB works unchanged in renderer** [MEDIUM] — Implementation verified: `src/renderer/src/adapters/dexie-cache.ts` copied verbatim from apps/web (per DD-303); app:// scheme pins origin so cache survives updates.

7. **app:// custom scheme pins IndexedDB origin across versions** [MEDIUM] — Implementation matches: scheme is registered with privileges, implemented with SPA fallback, and verified in smoke test.

---

## Cross-Phase Consistency Check

**Phase 1 to Phase 3 contracts:**
- ✅ @cue/core exports verified: `isRelevantFile`, `SKIP_DIRS` used in `discovery.ts:4` and `:201`
- ✅ @cue/ui exports verified: `App`, `initAppStore`, adapter interfaces all imported in renderer/src/main.tsx
- ✅ RecoveredFile shape matches: `electron-ingest.ts` wraps SerializedFile → RecoveredFile correctly

**Phase 2 to Phase 3 contracts (parallel phases, no direct dependencies but should use same patterns):**
- ✅ SerializedFile shape consistency: Both apps/vscode-ext and apps/electron define it with relPath, name, size, text, optional absPath (per DD-301, DD-202)
- ✅ Message protocol serialization: Both apps send fully-read file texts (no lazy callbacks in IPC)
- ✅ Auto-update paths: VS Code extension uses GitHub Releases version check on activation; Electron uses electron-updater guarded to Windows-only

---

## Discrepancy Declarations

All four DD- entries for Phase 3 (DD-301 through DD-306) are verified as implemented and consistent:

- **DD-301** (SerializedFile.absPath): ✅ Present in protocol.ts:13 and used in discovery.ts for workspace hash derivation
- **DD-302** (Chunked discovery IPC): ✅ Implemented in preload.ts:18-26 and discovery.ts:160 (listBucketRefs + readBucket loop)
- **DD-303** (dexie-cache copied not hoisted): ✅ Declared intentional in changes log line 201; files confirmed identical between apps/web and apps/electron renderers
- **DD-304** (ingest bootstrap in main.tsx not mount): ✅ Verified in renderer/src/main.tsx:27 calling `startAutoIngest()`; ingest panel in closed-by-default dialog justifies this
- **DD-305** (chatSessions title heads bundled per watch): ✅ Verified in discovery.ts:245 `readChatSessionsBucket()` called per push, and `:248` titles bundled with each session bucket push
- **DD-306** (autoUpdater guarded to packaged+win32): ✅ Verified in main/index.ts:136 and documented in README

---

## Manual Verification Checklist Status

The changes log lists Phase 3.6 as complete for macOS-scope items (all implemented, smoke-tested on macOS). Windows installer/auto-update items remain in the manual checklist (line 185-190) for a Windows machine:

- [ ] `npm run build:win` on Windows/CI → NSIS installer + SmartScreen warning
- [ ] Auto-update round-trip: publish v+1 Release, packaged app updates
- [ ] Windows discovery (code path shared with verified macOS)
- [ ] Native save dialog interactive flow (adapter is a thin wrapper, not automatable)
- [ ] macOS zip launch from archive (zip built; not launched from zip)

These are explicitly deferred to Windows hardware; no implementation gaps.

---

## Test Coverage

Per plan Testing Approach: Phase 3 introduces no new unit tests (all parsing/insights logic in @cue/core, already covered by 14/14 tests). Runtime verification:

- ✅ TypeCheck green: `npm run typecheck -w apps/electron` (both tsconfig.node.json and tsconfig.web.json)
- ✅ Build green: `npm run build -w apps/electron` (esbuild main/preload, vite renderer)
- ✅ Packaging smoke: `npm run build:dir -w apps/electron` (asar creation, signing skipped)
- ✅ macOS smoke: app launched, discovered 222 real sessions, restart restored cache, live-tail end-to-end verified
- ✅ Root tests still 14/14 pass

---

## Summary

All six plan steps for Phase 3 are fully implemented and verified:
1. ✅ Scaffold: electron-vite v5 with workspace source resolution
2. ✅ Discovery: Per-OS paths, all products, workspace.json names, fs.watch with debounce + polling
3. ✅ IPC: contextBridge with narrow API, chunked discovery, contextIsolation+nodeIntegration off
4. ✅ app:// scheme: Pins IndexedDB origin, includes SPA fallback
5. ✅ electron-builder: NSIS (Windows), GitHub auto-update, unsigned, macOS opt-in zip
6. ✅ Guard: MacOS smoke green; Windows checklist deferred to hardware

No Critical issues. All discrepancies (DD-301 through DD-306) are implemented and consistent. Research requirements met. File evidence cited for every claimed change.

**Status: PASS** — 100% coverage, all steps verified, ready for Windows manual verification step.
