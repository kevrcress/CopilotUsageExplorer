# Copilot Usage Explorer — VS Code extension

Local viewer for GitHub Copilot Chat agent debug logs: token usage, cache behavior, and optimization insights, auto-discovered straight from this machine's VS Code `workspaceStorage`. Everything is parsed locally — no uploads, no telemetry.

## Install (sideload)

This extension is distributed as a `.vsix` from GitHub Releases, not the Marketplace.

1. Download the latest `copilot-usage-explorer-<version>.vsix` from <https://github.com/kevrcress/CopilotUsageExplorer/releases/latest>.
2. Install it, either:
   - CLI: `code --install-extension copilot-usage-explorer-<version>.vsix`
   - UI: Extensions view → `…` menu → **Install from VSIX…**
3. Run **Copilot Usage Explorer: Open** from the Command Palette (`Ctrl/Cmd+Shift+P`).

The extension checks GitHub Releases on activation and shows a notification when a newer version is available (silent when offline).

## Usage

- Sessions are auto-discovered from every workspace's `GitHub.copilot-chat/debug-logs` under `workspaceStorage` when the panel opens.
- **Live tail** streams new sessions as Copilot writes them (on by default).
- **Pick folder…** scans any folder — e.g. a `workspaceStorage` copied from another machine.
- VS Code auto-deletes debug logs after a few days; the extension caches every discovered session in its own storage so history survives the purge.

## Settings

- `copilotUsageExplorer.cacheBackend` — `globalStorage` (default; JSON files under the extension's global storage, durability guaranteed by the VS Code API) or `indexeddb` (webview IndexedDB; faster, but persistence across restarts is not contract-guaranteed). Reopen the panel after changing.

## Limitations

- Remote workspaces (SSH/WSL/containers) are unsupported: the extension reads the local disk. Auto-discovery is disabled there; use a local window.

## Build from source

```bash
npm install                          # from the repo root
npm run build -w apps/vscode-ext     # typecheck + esbuild extension + vite webview
npm run package -w apps/vscode-ext   # produces copilot-usage-explorer-<version>.vsix
```

Development: open the repo in VS Code, run the build, then F5 (Extension Development Host) with `apps/vscode-ext` as the extension path.
