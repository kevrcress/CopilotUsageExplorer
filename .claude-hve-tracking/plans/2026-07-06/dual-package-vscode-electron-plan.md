# Implementation Plan: Package CopilotUsageExplorer as VS Code extension + Electron app with shared core
Date: 2026-07-06
Task slug: dual-package-vscode-electron
Research: .claude-hve-tracking/research/2026-07-06/dual-package-vscode-electron.md
Status: Draft

## Overview
Restructure the repo into npm workspaces — `packages/core` (pure parsing/insights), `packages/ui` (React app behind four host-adapter interfaces), `apps/web` (current SPA, kept working) — then build `apps/vscode-ext` (webview + extension-host FS, sideloaded .vsix with GitHub-Releases update check) and `apps/electron` (electron-vite, Windows NSIS + auto-update; macOS unsigned manual build only). The VS Code extension ships first since the team runs sideloaded Windows laptops.

## Constraints (user-confirmed 2026-07-06)
- No Apple Developer ID → no macOS signing/notarization; Electron auto-update is Windows-only; macOS gets an unsigned zip labeled "manual install" or is deferred entirely.
- Extension distribution = sideloaded .vsix on Windows laptops. No Marketplace publishing in scope. Update path = version check against GitHub Releases on activation.
- No remote-dev (SSH/WSL) support. Extension may use plain Node `fs` on the local machine.

## Phases

### Phase 1: Monorepo restructure + core extraction
Dependencies: none
Estimated scope: ~15 files moved/edited, ~300 lines changed (mostly imports + 4 new interface files); root package.json + 3 new package.json files
Success criteria: `npm test` passes from root; `npm run dev -w apps/web` serves the app unchanged; `packages/core` has zero imports of react/dexie/zustand/DOM types (verifiable by grep over packages/core/src)

Steps:
- [ ] Step 1.1: Convert root to npm workspaces (`"workspaces": ["packages/*", "apps/*"]`); create `packages/core`, `packages/ui`, `apps/web` package.json files. Vite resolves workspace TS source without a prebuild step.
  - Assumption: npm workspaces + Vite source-linking works with the existing npm lockfile after `npm install` regenerates it [HIGH — standard behavior, verified in research from electron-tooling findings]
- [ ] Step 1.2: Move pure modules to `packages/core/src`: parser.ts, tokens.ts, tokenizer.ts, models.ts, types.ts, redact.ts (research: zero browser/React deps, grep-verified at src/lib/parser.ts:1, src/lib/tokens.ts:1, src/lib/tokenizer.ts:1-21)
- [ ] Step 1.3: Split insights.ts — move `computeInsights` (src/lib/insights.ts:60) and `computeAnalytics` (src/lib/insights.ts:331) to core; replace the `LucideIcon` field (src/lib/insights.ts:28) with a string icon key; keep `useFilteredSessions` (src/lib/insights.ts:14) + an icon-key→LucideIcon map in packages/ui
- [ ] Step 1.4: Split utils.ts — `cn()` (clsx/tailwind-merge, src/lib/utils.ts:1-2) stays in packages/ui; ParsedSession helpers move to core
- [ ] Step 1.5: Promote `RecoveredFile` (src/lib/fs.ts:8-19) to a public core type; replace `rawBlob` with optional `readHead(bytes): Promise<string>` (only Blob use is the 2KB slice at src/lib/fs.ts:224-226); export `groupAndParse(files: RecoveredFile[])` (src/lib/fs.ts:216) from core. The three browser collectors (`ingestFromFileList` :35, `ingestFromDirectoryHandle` :84, `ingestFromDataTransfer` :130) move to apps/web as the browser IngestSource impl.
- [ ] Step 1.6: Define the four host-adapter interfaces in `packages/ui/src/host.ts` (contracts in details doc §2): `SessionCache` (mirrors src/lib/db.ts:25-72 surface), `PrefsStore` (covers src/lib/store.ts:11,103-113 localStorage use), `FileSaver` (replaces `downloadFile`, src/lib/export.ts:25-35), `IngestSource` (pick/watch/receive → RecoveredFile[])
- [ ] Step 1.7: Convert store.ts to a `createAppStore(host: HostAdapters)` factory injecting SessionCache + PrefsStore; keep zustand. Callers per research: store.ts:3 db import, Settings.tsx:7-8, SessionList.tsx:22, SessionDetail.tsx:15.
- [ ] Step 1.8: Move React components + remaining lib (export.ts string producers, insights hook) into packages/ui; apps/web becomes: Dexie SessionCache impl, localStorage PrefsStore impl, anchor-click FileSaver impl, the three browser collectors as IngestSource, plus main.tsx/index.html/vite config
- [ ] Step 1.9: Move tests: parser/tokens tests to packages/core (import-path changes only per test/parser.test.ts:1-5, test/tokens.test.ts:1-6); rewrite test/fs.test.ts against `groupAndParse(RecoveredFile[])` literals, dropping the Node File/webkitRelativePath shim (test/fs.test.ts:25-30)
- [ ] Step 1.10: Guard step — run `npm test` and `npm run build -w apps/web` from root; grep packages/core/src for `react|dexie|zustand|document\.|window\.|localStorage|indexedDB` and fix any hits before declaring the phase done

### Phase 2: VS Code extension (ship target #1)
Dependencies: Phase 1
Estimated scope: new `apps/vscode-ext` (~10 new files, ~600 lines): extension.ts, webview panel manager, message protocol, adapters, build config
Success criteria: F5 debug session opens the panel showing real sessions auto-discovered from the local workspaceStorage; `vsce package` produces an installable .vsix; cache survives VS Code restart

Steps:
- [ ] Step 2.1: SPIKE (timeboxed ~1h): minimal webview proving IndexedDB persists across VS Code restarts.
  - Assumption: webviews get a stable per-extension origin so Dexie works unchanged [MEDIUM — research flagged this unverified]. If the spike fails: implement SessionCache over `context.globalStorageUri` files instead (export/import plumbing at src/lib/db.ts:51-72 is the model). Decision gates Step 2.6.
- [ ] Step 2.2: Scaffold `apps/vscode-ext`: extension entry (`activate`), a `WebviewPanel` with `retainContextWhenHidden: true`, `localResourceRoots` pointing at the built ui dist, CSP meta tag using `${webview.cspSource}` (inline scripts/styles disabled), and `asWebviewUri` rewriting of the Vite asset URLs. Vite build for the webview bundle uses `base: './'`.
- [ ] Step 2.3: Log discovery in the extension host: `path.dirname(context.storageUri.fsPath)` is the current workspace's storageStorage hash dir; sibling `GitHub.copilot-chat/debug-logs/` is the target. Walk up one level and read each hash's `workspace.json` for the all-workspaces scan.
  - Assumption: this folder layout is stable but undocumented — not an API contract [MEDIUM]. Mitigation: feature-detect (if the folder shape is missing, fall back to a manual folder-pick dialog via `vscode.window.showOpenDialog`), never hard-fail.
- [ ] Step 2.4: Message protocol extension→webview: send sessions as RecoveredFile-shaped payloads (relPath, name, size, text content) chunked per session folder — the bucket grouping at core's groupAndParse boundary maps directly. No single postMessage carries more than one session's files.
  - Assumption: postMessage handles multi-MB single-session payloads acceptably [MEDIUM — no documented limit]. Guard: if a session exceeds ~20 MB, stream per-file messages; benchmark during implementation.
- [ ] Step 2.5: Live tail: Node `fs.watch` on the debug-logs dir (stat-polling fallback), pushing new/updated sessions through the same protocol. `createFileSystemWatcher` with out-of-workspace RelativePattern is optional polish [MEDIUM per research]; plain fs.watch is the guaranteed path since remote-dev is out of scope.
- [ ] Step 2.6: Implement the four adapters in the webview shell: IngestSource = messages from extension (plus a "pick folder…" command routed to showOpenDialog); SessionCache = Dexie or globalStorage per Step 2.1 outcome; PrefsStore = `vscode.getState/setState` bridged to `workspaceState`; FileSaver = postMessage → extension `vscode.window.showSaveDialog` + `workspace.fs.writeFile`
- [ ] Step 2.7: Packaging: manifest (name, publisher placeholder, `engines.vscode`, activation events, contributes.commands for "Copilot Usage Explorer: Open"), `vsce package` script, README install instructions (`code --install-extension copilot-usage-explorer-x.y.z.vsix`)
- [ ] Step 2.8: Update check on activation: fetch latest release tag from the GitHub Releases API, compare to extension version, show a notification with a download link when newer. Non-blocking, fails silent offline.
  - Assumption: the repo will have a public releases repo (research: electron-builder discourages private-repo GitHub provider; same public repo serves the .vsix) [MEDIUM — needs Kevin's confirmation on repo visibility]
- [ ] Step 2.9: Guard step — manual verify checklist: F5 → panel renders Dashboard with auto-discovered sessions; restart VS Code → cache intact; live-tail picks up a new session; export saves via native dialog; `vsce package` + install-from-VSIX on a second machine profile

### Phase 3: Electron app (ship target #2)
Dependencies: Phase 1 (not Phase 2)
Estimated scope: new `apps/electron` (~8 new files, ~500 lines): main, preload, renderer shell, electron-builder config
Success criteria: `npm run dev -w apps/electron` opens the app with auto-discovered sessions; `electron-builder` produces a Windows NSIS installer that auto-updates from GitHub Releases

Steps:
- [ ] Step 3.1: Scaffold with electron-vite v5 (react-ts template) merged into `apps/electron`; renderer imports packages/ui + packages/core directly (workspace source resolution)
- [ ] Step 3.2: Main process: locate VS Code workspaceStorage per-OS (Windows `%APPDATA%\Code\User\workspaceStorage`, macOS `~/Library/Application Support/Code/User/workspaceStorage`, Linux `~/.config/Code/User/workspaceStorage`; also scan Insiders/VSCodium/Cursor variant dirs when present), enumerate debug-logs session folders, watch for changes (fs.watch or chokidar)
- [ ] Step 3.3: Preload/IPC: contextBridge exposes a narrow typed API (`listSessions`, `readSessionFiles`, `watchStart/Stop`, `saveFile`, `pickFolder`); `ipcRenderer.invoke`/`ipcMain.handle` for request-response, `webContents.send` for live-tail pushes. Renderer adapters: IngestSource over IPC, SessionCache = Dexie (IndexedDB works in renderer), PrefsStore = localStorage, FileSaver = IPC → `dialog.showSaveDialog`.
  - Assumption: `File.path` is unavailable (removed in Electron 32); any drag-drop path capture uses `webUtils.getPathForFile` in preload [MEDIUM — verify exact API against the Electron version scaffolded]
- [ ] Step 3.4: Lock the renderer origin: serve production renderer from a custom `app://` scheme so the IndexedDB origin is stable between versions
  - Assumption: electron-vite's default production loading may use file:// — override per its docs [MEDIUM]
- [ ] Step 3.5: electron-builder config: Windows NSIS target + GitHub Releases publish provider + electron-updater; unsigned (SmartScreen warning accepted — document it). macOS: unsigned zip build behind an opt-in script, labeled manual-install/no-auto-update, or skipped entirely if Kevin prefers.
- [ ] Step 3.6: Guard step — on a Windows machine/VM: install NSIS build, verify auto-discovery + live tail; publish a bumped release; verify in-app auto-update completes

### Phase 4: CI + release pipeline
Dependencies: Phases 2 and 3
Estimated scope: 1–2 GitHub Actions workflows (~150 lines)
Success criteria: pushing a version tag produces a GitHub Release containing the .vsix and the Windows installer; extension update-check sees it

Steps:
- [ ] Step 4.1: Workflow: on tag `v*` — npm ci, run tests, build web, `vsce package`, electron-builder --win (on windows-latest runner), attach artifacts to the Release
- [ ] Step 4.2: Version sync: single source version (root package.json) propagated to extension manifest + electron app at build time
- [ ] Step 4.3: Guard step — dry-run the workflow on a prerelease tag; confirm both artifacts download and install

## Risk Log
| Risk | Likelihood | Mitigation |
|---|---|---|
| IndexedDB not durable in VS Code webview | Medium | Step 2.1 spike gates the cache design; globalStorage file cache is the designed fallback |
| Copilot debug-logs folder layout changes (undocumented) | Medium | Feature-detect + manual folder-pick fallback (Step 2.3); parser already tolerates unknown event types |
| Multi-MB postMessage payloads slow/fragile | Medium | Per-session chunking from day one; per-file streaming escape hatch (Step 2.4) |
| Unsigned Windows builds trigger SmartScreen distrust among teammates | Medium | Document the warning in install instructions; signing cert is a later, optional add |
| Workspace refactor breaks the existing web app | Low | Phase 1 success criteria pins `npm test` + web build green before any host work starts |
| macOS Electron users expect auto-update | Low | Explicitly out of scope (no Apple ID); macOS build labeled manual-install or skipped |

## Testing Approach
- Phase 1: existing Vitest suites moved with the code (`npm test` from root); grep-based purity check on packages/core; manual smoke of apps/web dev server.
- Phase 2: F5 extension-development-host manual checklist (Step 2.9); the spike (2.1) is itself a test artifact.
- Phase 3: dev-mode smoke on macOS (Kevin's machine) for logic; Windows VM for installer + auto-update verification (Step 3.6).
- Phase 4: prerelease-tag dry run.
- No new unit-test framework needed; core tests are the regression net for both hosts since all parsing/insights logic lives there.
