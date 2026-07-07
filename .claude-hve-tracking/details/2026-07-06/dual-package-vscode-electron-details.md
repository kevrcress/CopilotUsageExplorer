# Implementation Details: dual-package-vscode-electron
Date: 2026-07-06
Plan: .claude-hve-tracking/plans/2026-07-06/dual-package-vscode-electron-plan.md

## §1 Target layout

```
package.json               # root: workspaces ["packages/*","apps/*"], shared scripts
packages/
  core/                    # pure TS, no react/dexie/zustand/DOM
    package.json           # name: @cue/core, exports ./src/index.ts (source-linked)
    src/
      index.ts             # public API barrel
      parser.ts tokens.ts tokenizer.ts models.ts types.ts redact.ts
      insights.ts          # computeInsights/computeAnalytics only; icon: string key
      session-utils.ts     # ParsedSession helpers split out of utils.ts
      ingest.ts            # RecoveredFile type + groupAndParse + parseOneSessionBucket
    test/                  # parser/tokens/ingest tests + fixtures
  ui/
    package.json           # name: @cue/ui; peer deps react, zustand, dexie NOT here
    src/
      host.ts              # the four adapter interfaces + HostAdapters bundle
      store.ts             # createAppStore(host)
      icons.ts             # icon-key -> LucideIcon map
      export.ts            # pure string producers (csv/json/html)
      components/          # all existing components except Ingest.tsx
      App.tsx
apps/
  web/                     # current SPA behavior preserved
    src/adapters/          # dexie-cache.ts, localstorage-prefs.ts, anchor-saver.ts, browser-ingest.ts (3 collectors + Ingest UI)
  vscode-ext/
    src/extension.ts       # activate, panel mgmt, discovery, watcher, update check
    src/protocol.ts        # message types (shared const enum / discriminated union)
    webview/               # thin shell: adapters + mount of @cue/ui App
  electron/
    src/main/  src/preload/  src/renderer/
```

## §2 Host adapter contracts (packages/ui/src/host.ts)

```ts
import type { ParsedSession } from '@cue/core';
import type { RecoveredFile } from '@cue/core';

export interface SessionCache {          // mirrors src/lib/db.ts:25-72
  upsert(s: ParsedSession): Promise<void>;
  list(): Promise<ParsedSession[]>;
  get(id: string): Promise<ParsedSession | undefined>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
  exportBackup(): Promise<string>;
  importBackup(json: string): Promise<number>;
}

export interface PrefsStore {            // covers store.ts:11,103-113
  get<T>(key: string): T | undefined;    // sync ok: hosts hydrate before mount
  set<T>(key: string, value: T): void;
}

export interface FileSaver {             // replaces export.ts:25-35 downloadFile
  save(name: string, content: string | Uint8Array, mime: string): Promise<void>;
}

export interface IngestSource {
  // capabilities drive which buttons Ingest UI renders
  capabilities(): { pickFolder: boolean; autoDiscover: boolean; watch: boolean; dropFiles: boolean };
  pickAndIngest?(): Promise<RecoveredFile[][]>;    // one RecoveredFile[] per session bucket
  autoDiscover?(): Promise<RecoveredFile[][]>;
  watch?(onSessions: (files: RecoveredFile[][]) => void): () => void;  // returns dispose
}

export interface HostAdapters {
  cache: SessionCache; prefs: PrefsStore; saver: FileSaver; ingest: IngestSource;
}
```

`RecoveredFile` public shape (promoted from src/lib/fs.ts:8-19): `{ relPath: string; name: string; absPath?: string; size: number; text(): Promise<string>; readHead?(bytes: number): Promise<string> }`. `readHead` replaces the `rawBlob` 2KB slice at src/lib/fs.ts:224-226; when absent, callers fall back to `text()`.

## §3 VS Code message protocol (apps/vscode-ext/src/protocol.ts)

Discriminated unions, one session bucket per message:

```
ext -> webview:
  { type: 'sessions', files: SerializedFile[][], origin: 'discover'|'watch'|'pick' }
  { type: 'saveResult', ok: boolean }
webview -> ext:
  { type: 'ready' }                    // ext replies with autoDiscover results
  { type: 'pickFolder' }
  { type: 'save', name, mime, content }
  { type: 'watch', enabled: boolean }
```

`SerializedFile = { relPath, name, size, text }` — text inlined since webview can't call back lazily; the extension host reads files up front. If a single session's payload exceeds ~20 MB, split into `{ type:'sessionsChunk', bucketId, files, done }` frames.

Webview-side RecoveredFile impl wraps SerializedFile: `text: async () => f.text`.

## §4 Discovery + watch (extension host)

- Current workspace: `hashDir = path.dirname(context.storageUri.fsPath)`; logs at `path.join(hashDir, 'GitHub.copilot-chat', 'debug-logs')`.
- All workspaces: `wsRoot = path.dirname(hashDir)`; for each child hash dir, read `workspace.json` (gives folder URI → friendly name; feeds the existing workspaceNames mapping in prefs) and probe the same sibling path.
- Guard: wrap all probing in try/catch; if nothing found, UI falls back to pickFolder (showOpenDialog with `canSelectFolders`).
- Watch: `fs.watch(debugLogsDir, { recursive: true })` on macOS/Windows (recursive supported); debounce 2s; on event re-scan only the changed session folder and resend that bucket. Polling fallback (5s stat of dir mtimes) if fs.watch errors.
- Remote dev explicitly unsupported: if `vscode.env.remoteName` is set, show an info message and disable auto-discovery.

## §5 Webview hosting specifics

- Build: separate Vite config in apps/vscode-ext building webview/ with `base: './'`, output to `apps/vscode-ext/dist/webview`.
- Panel HTML template: rewrite `<script src>`/`<link href>` via `webview.asWebviewUri(Uri.joinPath(extUri, 'dist/webview', asset))`.
- CSP: `default-src 'none'; img-src ${cspSource} data:; script-src ${cspSource}; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource}` — note Tailwind injects a stylesheet file (fine) but Recharts sets inline style attributes, so `style-src` needs `'unsafe-inline'` (style attributes; acceptable, scripts stay locked).
- `retainContextWhenHidden: true` so tab switches don't re-parse.
- Prefs: `webview.getState/setState` for UI state; durable prefs mirrored to `context.workspaceState` via messages.

## §6 Electron specifics

- Scaffold: `npm create @quick-start/electron@latest` (electron-vite v5, react-ts), merged into apps/electron; renderer aliases `@cue/ui`, `@cue/core` to workspace source.
- IPC surface (preload contextBridge, `window.cue`):
  `listVSCodeInstalls(): Promise<InstallInfo[]>` — probes Code / Code - Insiders / VSCodium / Cursor user-data dirs per OS
  `discoverSessions(installId): Promise<SerializedFile[][]>`
  `watchSessions(installId, cb) / unwatch()` — via `webContents.send('sessions-update', ...)`
  `saveFile(name, mime, content): Promise<boolean>` — dialog.showSaveDialog + fs.writeFile
  `pickFolderAndRead(): Promise<SerializedFile[][]>`
- Per-OS userData roots: Windows `%APPDATA%`, macOS `~/Library/Application Support`, Linux `~/.config`; product dirs: `Code`, `Code - Insiders`, `VSCodium`, `Cursor`.
- Production renderer served from custom scheme `app://` (protocol.handle) to pin IndexedDB origin; dev uses the Vite dev server URL (electron-vite default).
- electron-builder: `win: { target: 'nsis' }`, `publish: { provider: 'github' }`, electron-updater `autoUpdater.checkForUpdatesAndNotify()` on ready. No mac target in the default build script; optional `build:mac-unsigned` script producing a zip with `identity: null`.

## §7 Version/update plumbing

- Root package.json version is canonical. Build scripts stamp it into apps/vscode-ext/package.json (vsce reads it) and electron-builder config at build time (simple node script, no extra dep).
- Extension update check: `https://api.github.com/repos/<owner>/<repo>/releases/latest` → compare `tag_name` (strip `v`) with extension version using simple semver-ish compare; on newer, `window.showInformationMessage` with "Download .vsix" button opening the release page. Timeout 3s, swallow all errors (offline-safe).
- Requires the releases repo to be public (electron-updater private-repo GitHub provider is discouraged; unauthenticated API + asset downloads need public anyway). Open item DD-002 in the planning log.

## §8 Store factory sketch

`createAppStore({ cache, prefs }: Pick<HostAdapters,'cache'|'prefs'>)` returns the zustand hook. Changes from src/lib/store.ts: the three localStorage reads (:11,:103-113) become `prefs.get/set`; `db.*` calls (:3 imports; :58-84 init/addSession/deleteSession/clearAll paths) route through `cache`. Component API (`useAppStore` selectors) unchanged — apps construct the store once and provide it via a module-level singleton assigned at bootstrap (keeps existing `useAppStore` import style; each app calls `initAppStore(adapters)` before render).
