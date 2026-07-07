# Research: Package CopilotUsageExplorer as a VS Code extension + standalone Electron app with a shared core
Date: 2026-07-06
Task slug: dual-package-vscode-electron
Confidence: HIGH overall (core-extraction findings verified from code; host-platform findings from official docs, a few flagged for spikes)

## Summary
The codebase is unusually well-positioned for a dual-target split: six lib modules are already pure TypeScript, and the ingest pipeline has a host-neutral `RecoveredFile[]` boundary that both hosts can feed. Only four seams need adapter interfaces (session cache, prefs, file-save, ingest source). npm workspaces (already npm) with `packages/core` + `packages/ui` + three thin apps is the recommended layout; Vite consumes workspace TS source with no prebuild. The two hard external constraints: macOS auto-update for Electron strictly requires code signing, and a sideloaded `.vsix` does not auto-update (needs a GitHub-Releases version check or Marketplace publishing).

## Key Findings

### Core extraction readiness (from subagents/2026-07-06/dual-package-core-readiness.md)
- Pure, portable as-is: parser.ts, tokens.ts, tokenizer.ts, models.ts, types.ts, redact.ts — zero browser/React deps [HIGH]
- The extraction lever: `RecoveredFile` (src/lib/fs.ts:8-19) is already host-neutral; exporting `groupAndParse(RecoveredFile[])` (src/lib/fs.ts:216) makes everything downstream host-agnostic [HIGH]
- Four adapter seams: SessionCache over Dexie (src/lib/db.ts:4-72), PrefsStore over localStorage (src/lib/store.ts:11,103-113), FileSaver replacing the DOM-anchor `downloadFile` (src/lib/export.ts:25-35), IngestSource replacing the browser collectors (src/lib/fs.ts:35,84,130) [HIGH]
- Ingest chain today: Ingest.tsx:65-140 → fs.ts collectors → RecoveredFile[] → groupAndParse → parseSession → store.addSession merge (src/lib/store.ts:75-84) → Dexie upsert (src/lib/db.ts:25). Adapters plug in at the RecoveredFile[] boundary [HIGH]
- insights.ts needs a small split: `useFilteredSessions` is React-coupled (src/lib/insights.ts:14) and `InsightsResult.icon` types as LucideIcon (src/lib/insights.ts:28); `computeInsights`/`computeAnalytics` (src/lib/insights.ts:60,331) are pure [HIGH]
- Ingest.tsx is the only heavily host-coupled component (showDirectoryPicker at :22,:70,:90; webkitdirectory :232; setInterval live-tail :111; confirm :34) [HIGH]
- Tests run in node environment (vite.config.ts:16); parser/tokens tests port unchanged; test/fs.test.ts:25-30 depends on Node's global File + a webkitRelativePath shim — trivially rewritable against RecoveredFile [HIGH]

### VS Code extension architecture (from subagents/2026-07-06/dual-package-vscode-extension.md)
- Webview hosting requirements: `asWebviewUri` rewrite of all dist asset URLs + `localResourceRoots`; CSP meta tag with `script-src/style-src ${webview.cspSource}` (inline scripts/styles disabled). Vite needs `base: './'`; chunked output is fine [HIGH]
- Log discovery is trivial from inside the extension: `path.dirname(context.storageUri.fsPath)` IS the workspaceStorage `<hash>` dir; the sibling `GitHub.copilot-chat/debug-logs/` sits right there. Walking up one level and reading each hash's `workspace.json` gives an all-workspaces scan [HIGH]
- Desktop extension host is unsandboxed Node — reading another extension's storage folder works mechanically, but the layout is undocumented, not an API contract (stability risk) [MEDIUM]
- Live tail: `createFileSystemWatcher` with a `RelativePattern` rooted outside the workspace works (recursive watching is resource-flagged) [MEDIUM]; Node `fs.watch`/stat-polling is the guaranteed fallback [HIGH]
- postMessage has no documented size limit; chunk per-session/per-file (the bucket logic at src/lib/fs.ts:216 maps directly) or serve bulk bytes via `asWebviewUri` + fetch [MEDIUM]
- IndexedDB/Dexie should work unchanged in the webview — stable per-extension origin, persists across restarts [MEDIUM — needs a ~1h spike]; mirroring to `context.globalStorageUri` is the durable fallback and the export/import plumbing at src/lib/db.ts:51 is reusable [HIGH]
- Distribution without Marketplace: `vsce package` → .vsix; install via `code --install-extension` or Install-from-VSIX. No publisher account needed, but sideloaded VSIX does NOT auto-update — plan a GitHub-Releases version check on activation. Marketplace adds auto-update + a `--pre-release` channel [HIGH]

### Electron + monorepo build tooling (from subagents/2026-07-06/dual-package-electron-tooling.md)
- macOS auto-update requires code signing, full stop, plus a zip target for latest-mac.yml. Unsigned macOS = manual downloads + Gatekeeper xattr friction. One Apple Developer ID cert ($99/yr) + notarization unlocks it [HIGH]
- src/lib/fs.ts:23 relies on `File.path`, which was removed in Electron 32 — the Electron ingest adapter must use `webUtils.getPathForFile` in the preload instead [MEDIUM — verify exact version against current breaking-changes docs]
- Scaffold: electron-vite v5 (`npm create @quick-start/electron@latest`, react-ts template) + electron-builder; the existing SPA drops into src/renderer nearly unchanged [HIGH]
- IPC: contextBridge exposing a narrow API + `ipcRenderer.invoke`/`ipcMain.handle`; live-tail pushes via `webContents.send`. Maps cleanly onto `RecoveredFile` — a new adapter, no parser changes [HIGH]
- Windows: NSIS + GitHub Releases auto-update works unsigned in practice (SmartScreen warnings on first run); signing is optional polish. electron-builder explicitly discourages the private-repo GitHub provider — use a public releases repo [HIGH]
- Monorepo: npm workspaces suffice (repo already uses npm); Vite serves linked workspace packages as ESM source with zero prebuild, so packages/core and packages/ui can export `src/index.ts` directly; TS project references are optional [HIGH]
- Dexie/IndexedDB works unchanged in the Electron renderer; gotchas are dev-vs-packaged userData dirs and the renderer origin (app:// custom scheme vs file://) determining which DB is used — the existing export/import backup covers migration [MEDIUM]

## Recommended target layout (synthesis)
```
packages/core     — parser, tokens, tokenizer, models, types, redact, pure insights (computeInsights/computeAnalytics), groupAndParse + RecoveredFile
packages/ui       — React components + useFilteredSessions + icon mapping; consumes core + host-adapter interfaces (SessionCache, PrefsStore, FileSaver, IngestSource)
apps/web          — current Vite SPA (browser adapters: FS-Access/upload ingest, Dexie, DOM download) — keeps working
apps/vscode-ext   — extension host (Node FS discovery/watch, globalStorage mirror) + webview shell of packages/ui
apps/electron     — electron-vite main/preload/renderer; preload IPC adapters
```

## Codebase References
- src/lib/fs.ts — ingest collectors + RecoveredFile + groupAndParse (the extraction seam)
- src/lib/db.ts — Dexie cache (SessionCache adapter target)
- src/lib/store.ts — zustand store + localStorage persistence (PrefsStore adapter target)
- src/lib/export.ts — downloadFile DOM coupling (FileSaver adapter target)
- src/lib/insights.ts — mixed pure/React, needs split
- src/components/Ingest.tsx — only heavily host-coupled component
- vite.config.ts — node test environment; needs base './' for webview build
- test/fs.test.ts — File/webkitRelativePath shim, rewrite against RecoveredFile

## External References
Consulted by subagents (see their artifacts for URL lists): code.visualstudio.com/api (webview, extension anatomy, vsce publishing), electronjs.org (contextBridge/IPC, breaking changes), electron-vite and electron-builder docs (scaffold, GitHub Releases publish, code signing/auto-update).

## Open Questions
1. IndexedDB persistence across VS Code restarts in a webview — assumed stable origin [MEDIUM]; needs a ~1h spike before committing the cache design.
2. Exact Electron version that removed `File.path` and the `webUtils.getPathForFile` replacement pattern — verify against current breaking-changes docs.
3. macOS signing: does Kevin have (or want) an Apple Developer ID? Determines whether Electron macOS auto-update is in scope for v1 or manual-download-only.
4. Distribution channel for the extension: sideloaded .vsix with a homegrown update check vs publishing to the Marketplace (or both, phased)?
5. Remote dev (SSH/WSL) support for the extension: logs live on the remote userDataDir — in scope for v1 or explicitly deferred?

## Recommended Research Follow-On
- [ ] Spike: minimal webview extension proving IndexedDB persistence across restart
- [ ] Spike: workspaceStorage discovery on all 3 OSes incl. Insiders/VSCodium/Cursor variants
- [ ] Benchmark postMessage vs chunked vs asWebviewUri-fetch for a 5–20 MB main.jsonl
- [ ] Verify webUtils.getPathForFile / File.path removal against Electron breaking-changes docs
- [ ] Decide icon representation (string key vs UI-layer mapping) for the insights.ts split
