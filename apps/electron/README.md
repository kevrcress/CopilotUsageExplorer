# Copilot Usage Explorer — Desktop (Electron)

Desktop host for the shared `@cue/ui` app. Auto-discovers GitHub Copilot Chat
debug logs from every local VS Code, VS Code Insiders, VSCodium, and Cursor
install, live-tails them, and caches parsed sessions locally (IndexedDB).

## Install (Windows)

1. Download the latest `Copilot Usage Explorer Setup x.y.z.exe` from the
   [GitHub Releases page](https://github.com/kevrcress/CopilotUsageExplorer/releases).
2. Run the installer.

> **SmartScreen warning:** builds are not code-signed, so Windows shows
> "Windows protected your PC" on first run. Click **More info** → **Run anyway**.
> This is expected for unsigned apps; the source is this repository.

Updates are automatic: the app checks GitHub Releases on launch
(electron-updater) and installs new versions in the background.

## Install (macOS — manual, optional)

There is no signed macOS build (no Apple Developer ID) and **no macOS
auto-update**. An unsigned zip can be built locally:

```bash
npm run build:mac-unsigned -w apps/electron
```

Unzip `release/Copilot Usage Explorer-x.y.z-arm64-mac.zip`, move the app to
Applications, and on first launch right-click → Open (Gatekeeper). To update,
rebuild and replace the app.

## Development

```bash
npm run dev -w apps/electron        # dev server + electron with HMR
npm run build -w apps/electron      # typecheck + build main/preload/renderer to out/
npm run start -w apps/electron      # run the built output
npm run build:dir -w apps/electron  # unpackaged app in release/ (packaging smoke)
npm run build:win -w apps/electron  # Windows NSIS installer (run on Windows/CI)
```

Architecture:

- `src/main/` — window, `app://` custom scheme (pins the IndexedDB origin across
  updates), IPC handlers, auto-update, and `discovery.ts` (per-OS workspaceStorage
  probing + fs.watch live tail).
- `src/preload/` — `window.cue` contextBridge API (context isolation on). Discovery
  is chunked one session bucket per IPC message; a full corpus can be hundreds of MB.
- `src/renderer/` — mounts `@cue/ui` with Electron adapters (Dexie cache,
  localStorage prefs, native save dialog, `window.cue` ingest) plus
  `ingest-controller.ts` (startup auto-scan + live tail).
