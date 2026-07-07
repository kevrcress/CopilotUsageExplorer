# RPI Validation: Dual-Package VS Code + Electron — Phase 2 (VS Code Extension)
Date: 2026-07-06
Plan phase: Phase 2: VS Code extension (ship target #1)
Coverage: 100% (9/9 plan steps implemented)
Status: Pass

## Plan Item Comparison

| Plan Step | Changes Log Status | Evidence File | Status |
|---|---|---|---|
| Step 2.1: SPIKE (IndexedDB persistence) | Found (pragmatic resolution) | `apps/vscode-ext/src/extension.ts:120-124` | ✅ Implemented — dual backends |
| Step 2.2: WebviewPanel + CSP + asWebviewUri + Vite | Found | `apps/vscode-ext/src/extension.ts:45-118` | ✅ Implemented |
| Step 2.3: Log discovery all-workspaces + fallback | Found | `apps/vscode-ext/src/discovery.ts:68-91` | ✅ Implemented |
| Step 2.4: Message protocol + chunking (20 MB) | Found | `apps/vscode-ext/src/protocol.ts` + `src/extension.ts:277-320` | ✅ Implemented |
| Step 2.5: Live tail with fs.watch + polling | Found | `apps/vscode-ext/src/watcher.ts:18-121` | ✅ Implemented |
| Step 2.6: Four webview adapters | Found | `apps/vscode-ext/webview/adapters.ts` + `bridge.ts` | ✅ Implemented |
| Step 2.7: Manifest + vsce package script + README | Found | `apps/vscode-ext/package.json` + `.vscodeignore` + `README.md` | ✅ Implemented |
| Step 2.8: GitHub Releases version check | Found | `apps/vscode-ext/src/update-check.ts:25-56` | ✅ Implemented |
| Step 2.9: Guard step (automated) + manual checklist | Found | Typechecks green, builds green, package succeeds; checklist exists | ✅ Implemented |

## Findings

### RV2-001 [MINOR]
Plan item: Step 2.1 SPIKE — IndexedDB webview persistence across VS Code restarts
Evidence: Plan specifies a ~1h spike to verify IndexedDB durability; changes log resolves pragmatically by implementing both backends (globalStorage default, IndexedDB opt-in) and deferring the restart test to a manual checklist.
Impact: The webview Dexie cache exists (`apps/vscode-ext/webview/dexie-cache.ts:1-78`) as an opt-in backend, but whether it survives restarts is unverified by the implementation phase. This is by design per DD-201 — a reasonable trade-off that keeps IndexedDB available for users who want faster local caching, while defaulting to globalStorage (file-per-session JSON under `context.globalStorageUri`) whose durability is API-contract-guaranteed.
Recommendation: Treat as expected deferred runtime verification (manual checklist item at changes log line 123). No blocking issue.

### RV2-002 [MINOR]
Plan item: Step 2.3 — Remote dev support guard
Evidence: `apps/vscode-ext/src/extension.ts:176-185` checks `vscode.env.remoteName` and disables auto-discovery with a fallback to "Pick folder…" for remote workspaces.
Impact: Plan explicitly defers remote-dev to out-of-scope (constraints §5); the guard is present and prevents silent failure. Documentation in README.md:29-30 is clear. No correctness issue.
Recommendation: None — guard and messaging are correct.

### RV2-003 [MINOR]
Plan item: Step 2.4 — postMessage payload limit assumption (no documented hard limit)
Evidence: Changes log at line 47 flags this as [MEDIUM] assumption; implementation at `apps/vscode-ext/src/extension.ts:287-298` batches under MAX_MESSAGE_BYTES (20 MB) and per-file chunks oversized buckets at line 300-320. Plan explicitly gates on "Guard: if a session exceeds ~20 MB, stream per-file messages" — implemented as `sendChunked`.
Impact: The soft 20 MB cap is conservative and avoids fragility; any single file larger than the cap still ships whole (comment at line 307). No correctness issue.
Recommendation: None — implementation is sound.

### RV2-004 [MINOR]
Plan item: Step 2.6 — sessionCache adapter backends
Evidence: Two implementations present: 
  - `apps/vscode-ext/webview/adapters.ts:60-84` defines `createGlobalStorageCache(bridge: Bridge): SessionCache` using file-per-session JSON under `context.globalStorageUri/sessions/`
  - `apps/vscode-ext/webview/dexie-cache.ts:29-78` defines `createDexieSessionCache(): SessionCache` using IndexedDB
  - Selection at `apps/vscode-ext/webview/main.tsx:15` via the `cacheBackend` setting
Impact: Both backends satisfy the adapter interface. Export/import interchangeability is preserved (`file-cache.ts:114` and `dexie-cache.ts:60` use identical `{version, exportedAt, sessions}` shape). No discrepancy.
Recommendation: None — adapter design is correct.

### RV2-005 [MINOR]
Plan item: Step 2.8 — Repo owner discrepancy (kevrcress vs kevincress)
Evidence: 
  - `apps/vscode-ext/src/update-check.ts:5-6` defines `REPO_OWNER = 'kevrcress'` (the GitHub username)
  - `apps/vscode-ext/package.json:6` defines `"publisher": "kevincress"` (the VSCode marketplace placeholder)
  - Changes log explicitly documents this as DD-205: "the two are intentionally different constants"
  - Git remote is `https://github.com/kevrcress/CopilotUsageExplorer.git` (per status output)
Impact: The constants are intentionally split; update-check correctly uses the real owner (kevrcress). This is documented and not an error. Marketplace publisher field is a placeholder (manifest is not published).
Recommendation: None — naming is intentional per DD-205.

### RV2-006 [MINOR]
Plan item: Step 2.9 — Build artifacts not in git (benign)
Evidence: Changes log line 236 notes "Phase 2/3 local build artifacts (copilot-usage-explorer-0.1.0.vsix, apps/electron/release/*) remain in the tree; all gitignored, harmless."
Impact: `.gitignore:26` includes `*.vsix` (added during this phase); `apps/electron/out/` and `apps/electron/release/` already gitignored (lines 29-30). All artifacts are correctly ignored.
Recommendation: None — housekeeping is correct.

### RV2-007 [MINOR]
Plan item: Step 2.9 — Manual verification checklist existential check
Evidence: Changes log lines 121-127 list six manual checklist items (F5 Extension Development Host, cache restart test, live tail, export, install on second machine, update notification). These are the **deferred** runtime verifications that cannot be run in a headless environment.
Impact: The plan's success criterion "cache survives VS Code restart" is acknowledged as unverified by design (DD-201). This is appropriate because the automated build + typecheck phase cannot launch VS Code interactively. The checklist covers all critical user flows (discover, cache, live-tail, save, install, update-check).
Recommendation: None — deferred verification is expected and documented.

## Unlisted Changes
No changes detected outside `apps/vscode-ext/`, `.gitignore`, and `package-lock.json` that relate to Phase 2. All modifications are scoped correctly.

## Research Coverage

### Core requirement: Webview hosting + CSP
- ✅ `asWebviewUri` rewriting of dist asset URLs: `apps/vscode-ext/src/extension.ts:85-86`
- ✅ `localResourceRoots` pointing at dist: line 58
- ✅ CSP meta tag with `script-src/style-src ${webview.cspSource}`: lines 95-101
- ✅ Boot data injected via data attribute (no inline scripts): line 109
- ✅ Vite build with `base: './'`: `apps/vscode-ext/vite.config.ts:10`

### Core requirement: Log discovery
- ✅ `path.dirname(context.storageUri.fsPath)` → workspaceStorage root: `apps/vscode-ext/src/discovery.ts:34`
- ✅ Sibling `GitHub.copilot-chat/debug-logs/` scan: line 81
- ✅ All-workspaces via walking hash dirs: lines 68-90
- ✅ `workspace.json` friendly name extraction: lines 52-64
- ✅ Feature-detect + manual folder-pick fallback: `apps/vscode-ext/src/extension.ts:216-235`

### Core requirement: Live tail
- ✅ `fs.watch` with `{recursive: true}`: `apps/vscode-ext/src/watcher.ts:42`
- ✅ 2s debounce per session folder: lines 6, 38
- ✅ 5s stat-polling fallback on watch error: lines 7, 81-121
- ✅ Coalesced per-session-folder events: lines 25-34

### Core requirement: Message protocol
- ✅ Discriminated union message types: `apps/vscode-ext/src/protocol.ts:28-53`
- ✅ One session bucket per message: lines 32, 40
- ✅ 20 MB chunking escape hatch: lines 7-8, 39-45
- ✅ SerializedFile shape with optional `absPath`: lines 14-20
- ✅ Chunked reassembly in webview: `apps/vscode-ext/webview/bridge.ts:120-129`

### Core requirement: Four adapters
- ✅ IngestSource (discover/pick/watch): `apps/vscode-ext/webview/adapters.ts:39-54`
- ✅ SessionCache (globalStorage + Dexie options): lines 60-84 + `dexie-cache.ts`
- ✅ PrefsStore (memory + workspaceState mirror): lines 8-19
- ✅ FileSaver (postMessage → native dialog): lines 22-34

### Core requirement: Sideload distribution
- ✅ Manifest with command + activation: `apps/vscode-ext/package.json:20-42`
- ✅ `vsce package --no-dependencies` script: line 48
- ✅ README sideload install instructions: `apps/vscode-ext/README.md:5-12`
- ✅ `.vscodeignore` keeping package minimal (276 KB claimed): `.vscodeignore:1-5`

### Core requirement: GitHub Releases version check
- ✅ Unauthenticated API call to latest release: `apps/vscode-ext/src/update-check.ts:7`
- ✅ 3s AbortController timeout + silent failure: lines 30-42
- ✅ Semver comparison + notification with download link: lines 12-51

### Research question resolution:
1. **IndexedDB persistence [MEDIUM]** → DD-201: Pragmatic dual-backend approach; restart test deferred.
2. **Folder layout stability [MEDIUM]** → Implemented with feature-detect + fallback.
3. **postMessage payload limits [MEDIUM]** → Conservative 20 MB soft cap + per-file chunking.
4. **File.path removal in Electron** → Not applicable to Phase 2 (Electron is Phase 3).
5. **macOS signing** → Not applicable to Phase 2 (Windows-only release, per constraints).

## Discrepancies & Decisions Log

All discrepancies noted in the changes log are reflected in the code:
- **DD-201**: globalStorage (file-backed) default, IndexedDB opt-in (not contract-guaranteed).
- **DD-202**: SerializedFile carries optional `absPath` for workspaceHash derivation.
- **DD-203**: Boot data injected as HTML data attribute, not inline script (CSP-clean).
- **DD-204**: requestId correlation + terminal empty frame for scan resolution.
- **DD-205**: REPO_OWNER constant (kevrcress) vs publisher placeholder (kevincress) — intentional.

## Summary

**All 9 plan steps for Phase 2 are implemented and verified.** The automated scoping includes:
- ✅ Extension host scaffold (webview panel, CSP, asWebviewUri)
- ✅ Session discovery from all workspaceStorage hashes
- ✅ Live tail with fs.watch + polling fallback
- ✅ Chunked message protocol (20 MB soft cap)
- ✅ Four host-adapter interfaces (IngestSource, SessionCache, PrefsStore, FileSaver)
- ✅ Dual SessionCache backends (globalStorage default, IndexedDB opt-in)
- ✅ Sideload packaging (vsce, .vscodeignore, README)
- ✅ GitHub Releases version check on activation
- ✅ Build green (typecheck, esbuild, vite, vsce package)

**Deferred runtime verification** (manual checklist, expected):
- F5 Extension Development Host rendering
- Cache restart durability (the core Step 2.1 spike)
- Live-tail pickup of new sessions
- Export via native save dialog
- Install from .vsix on a second machine
- Update notification and download flow

The plan's success criterion "cache survives VS Code restart" is unverified by design (DD-201) because the implementation cannot launch VS Code interactively. Both backends are implemented; the restart test is the manual checklist item 2.9.2.

No Critical or Major findings. Minor findings are documentation/completeness items and expected deferred verifications.

---

## Coverage Assessment
- **Total plan steps (Phase 2)**: 9
- **Implemented steps**: 9
- **Coverage**: 100%
- **Critical findings**: 0
- **Major findings**: 0
- **Minor findings**: 7 (all expected/benign)
