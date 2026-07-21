import * as vscode from 'vscode';
import {
  discoverWorkspaces,
  readPickedFolder,
  readSessionBucket,
  readWorkspaceBuckets,
  type DiscoveredWorkspace,
} from './discovery';
import { handleCacheOp, iterateExportSegments, iterateSessionPayloads } from './file-cache';
import { streamBatches } from './frame-batch';
import { createLogger, type Logger } from './logger';
import {
  MAX_MESSAGE_BYTES,
  type BootData,
  type ExtToWebviewMessage,
  type SerializedFile,
  type SessionsOrigin,
  type WebviewToExtMessage,
} from './protocol';
import { checkForUpdate } from './update-check';
import { watchWorkspaces, type SessionWatcher } from './watcher';

const VIEW_TYPE = 'copilotUsageExplorer';

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel('Copilot Usage Explorer');
  context.subscriptions.push(channel);
  const log = createLogger(channel);

  const version = (context.extension.packageJSON as { version?: string }).version ?? 'unknown';
  log.info(`Extension activated — version ${version}`);

  context.subscriptions.push(
    vscode.commands.registerCommand('copilotUsageExplorer.open', () => {
      ExplorerPanel.createOrShow(context, log);
    })
  );
  // Fire-and-forget; swallows every user-facing failure (see update-check.ts),
  // but the failure itself is still logged to the output channel.
  void checkForUpdate(context, log);
}

export function deactivate(): void {
  ExplorerPanel.current?.dispose();
}

class ExplorerPanel {
  static current: ExplorerPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private workspaces: DiscoveredWorkspace[] = [];
  private watcher: SessionWatcher | undefined;
  private disposed = false;

  static createOrShow(context: vscode.ExtensionContext, log: Logger): void {
    if (ExplorerPanel.current) {
      ExplorerPanel.current.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'Copilot Usage Explorer',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        // Tab switches must not re-parse multi-MB logs (details doc §5).
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')],
      }
    );
    ExplorerPanel.current = new ExplorerPanel(panel, context, log);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly log: Logger
  ) {
    this.panel = panel;
    panel.webview.html = this.buildHtml();
    panel.webview.onDidReceiveMessage((msg: WebviewToExtMessage) => void this.onMessage(msg));
    panel.onDidDispose(() => {
      this.disposed = true;
      this.watcher?.dispose();
      ExplorerPanel.current = undefined;
    });
  }

  dispose(): void {
    this.panel.dispose();
  }

  // -------------------------------------------------------------------------
  // HTML / CSP
  // -------------------------------------------------------------------------

  private buildHtml(): string {
    const { webview } = this.panel;
    const assetUri = (name: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', name));

    // Boot data rides a data attribute, not an inline script, so script-src
    // stays locked to cspSource. style-src needs 'unsafe-inline' because
    // Recharts sets inline style attributes (details doc §5).
    const boot: BootData = {
      cacheBackend: this.cacheBackend(),
      prefs: this.prefsSnapshot(),
    };
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data:`,
      `script-src ${webview.cspSource}`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
    ].join('; ');

    return `<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta id="cue-boot" data-boot="${escapeAttr(JSON.stringify(boot))}" />
    <link rel="stylesheet" href="${assetUri('webview.css')}" />
    <title>Copilot Usage Explorer</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="${assetUri('webview.js')}"></script>
  </body>
</html>`;
  }

  private cacheBackend(): BootData['cacheBackend'] {
    const v = vscode.workspace
      .getConfiguration('copilotUsageExplorer')
      .get<string>('cacheBackend', 'globalStorage');
    return v === 'indexeddb' ? 'indexeddb' : 'globalStorage';
  }

  private prefsSnapshot(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of this.context.workspaceState.keys()) {
      out[key] = this.context.workspaceState.get(key);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------

  private post(msg: ExtToWebviewMessage): void {
    if (this.disposed) return;
    this.panel.webview.postMessage(msg).then(
      (ok) => {
        if (!ok) this.log.warn(`postMessage(${msg.type}) not delivered`);
      },
      (e: unknown) => {
        this.log.warn(`postMessage(${msg.type}) failed: ${(e as Error).message}`);
      }
    );
  }

  private async onMessage(msg: WebviewToExtMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
        await this.runDiscovery(undefined);
        return;
      case 'discover':
        await this.runDiscovery(msg.requestId);
        return;
      case 'pickFolder':
        await this.pickFolder(msg.requestId);
        return;
      case 'save':
        await this.saveFile(msg.requestId, msg.name, msg.content);
        return;
      case 'watch':
        this.setWatch(msg.enabled);
        return;
      case 'prefsSet':
        await this.context.workspaceState.update(msg.key, msg.value);
        return;
      case 'cacheOp': {
        if (msg.op === 'list') {
          await this.streamList(msg.requestId);
          return;
        }
        if (msg.op === 'export') {
          await this.streamExport(msg.requestId);
          return;
        }
        try {
          const data = await handleCacheOp(this.context, msg);
          this.post({ type: 'cacheResult', requestId: msg.requestId, ok: true, data });
        } catch (e) {
          this.post({ type: 'cacheResult', requestId: msg.requestId, ok: false, error: (e as Error).message });
        }
        return;
      }
    }
  }

  /** Stream `list` replies as `cacheResultChunk` frames instead of one
   *  `cacheResult` (Phase 2): a cache whose serialized size exceeds
   *  MAX_MESSAGE_BYTES would otherwise never be delivered by postMessage,
   *  leaving the webview's cacheOp promise pending forever. Frames post as
   *  soon as they fill, keeping the bridge's inactivity timeout fed during a
   *  long disk read (details doc §3). */
  private async streamList(requestId: number): Promise<void> {
    let sessionCount = 0;
    let totalBytes = 0;
    let frameCount = 0;
    try {
      await streamBatches(
        iterateSessionPayloads(this.context),
        (payload) => JSON.stringify(payload).length,
        MAX_MESSAGE_BYTES,
        (frame, done, bytes) => {
          sessionCount += frame.length;
          totalBytes += bytes;
          frameCount++;
          this.post({ type: 'cacheResultChunk', requestId, items: frame, done, bytes });
        }
      );
      this.log.info(
        `cacheOp 'list' reply size: ${totalBytes} bytes, ${sessionCount} session(s), ${frameCount} frame(s)`
      );
    } catch (e) {
      this.post({ type: 'cacheResult', requestId, ok: false, error: (e as Error).message });
    }
  }

  /** Stream `export` replies as `cacheResultChunk` frames of JSON string
   *  segments; the bridge concatenates them back into the same
   *  `{"version":1,...}` export document (details doc §5, preferred
   *  approach — chunked rather than the single-frame-with-warning fallback). */
  private async streamExport(requestId: number): Promise<void> {
    let totalBytes = 0;
    let frameCount = 0;
    try {
      await streamBatches(
        iterateExportSegments(this.context),
        (segment) => segment.length,
        MAX_MESSAGE_BYTES,
        (frame, done, bytes) => {
          totalBytes += bytes;
          frameCount++;
          this.post({ type: 'cacheResultChunk', requestId, items: frame, done, bytes });
        }
      );
      this.log.info(`cacheOp 'export' reply size: ${totalBytes} bytes, ${frameCount} frame(s)`);
    } catch (e) {
      this.post({ type: 'cacheResult', requestId, ok: false, error: (e as Error).message });
    }
  }

  private async runDiscovery(requestId: number | undefined): Promise<void> {
    if (vscode.env.remoteName) {
      // Remote dev is explicitly unsupported: logs live on the remote host but
      // this extension reads the local disk (details doc §4).
      void vscode.window.showInformationMessage(
        'Copilot Usage Explorer: auto-discovery is disabled in remote workspaces (SSH/WSL/containers). Use "Pick folder…" on a local window instead.'
      );
      this.post({ type: 'status', message: 'Remote workspace detected — auto-discovery disabled. Use "Pick folder…".' });
      this.post({ type: 'sessions', files: [], origin: 'discover', requestId });
      return;
    }
    try {
      const { workspaces, names } = await discoverWorkspaces(this.context, this.log);
      this.workspaces = workspaces;
      if (Object.keys(names).length > 0) this.post({ type: 'workspaceNames', names });
      if (workspaces.length === 0) {
        this.post({
          type: 'status',
          message: 'No Copilot debug logs found under workspaceStorage. Enable debug logging or use "Pick folder…".',
        });
        this.post({ type: 'sessions', files: [], origin: 'discover', requestId });
        return;
      }
      let total = 0;
      for (const ws of workspaces) {
        const buckets = await readWorkspaceBuckets(ws, this.log);
        total += buckets.length;
        this.sendBuckets(buckets, 'discover', requestId);
      }
      // Terminal empty frame so requestId-correlated callers always resolve.
      this.post({ type: 'sessions', files: [], origin: 'discover', requestId });
      this.post({
        type: 'status',
        message: `Auto-discovery: ${total} session folder(s) across ${workspaces.length} workspace(s).`,
      });
    } catch (e) {
      this.post({ type: 'status', message: `Discovery failed: ${(e as Error).message}` });
      this.post({ type: 'sessions', files: [], origin: 'discover', requestId });
    }
  }

  private async pickFolder(requestId: number): Promise<void> {
    try {
      const picked = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Scan for Copilot logs',
      });
      if (!picked || picked.length === 0) {
        this.post({ type: 'sessions', files: [], origin: 'pick', requestId });
        return;
      }
      const buckets = await readPickedFolder(picked[0].fsPath);
      this.sendBuckets(buckets, 'pick', requestId);
      this.post({ type: 'sessions', files: [], origin: 'pick', requestId });
    } catch (e) {
      this.post({ type: 'status', message: `Folder scan failed: ${(e as Error).message}` });
      this.post({ type: 'sessions', files: [], origin: 'pick', requestId });
    }
  }

  private async saveFile(requestId: number, name: string, content: string): Promise<void> {
    try {
      const target = await vscode.window.showSaveDialog({ defaultUri: this.defaultSaveUri(name) });
      if (!target) {
        this.post({ type: 'saveResult', requestId, ok: false, error: 'cancelled' });
        return;
      }
      await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(content));
      this.post({ type: 'saveResult', requestId, ok: true });
    } catch (e) {
      this.post({ type: 'saveResult', requestId, ok: false, error: (e as Error).message });
    }
  }

  private defaultSaveUri(name: string): vscode.Uri | undefined {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    return root ? vscode.Uri.joinPath(root, name) : undefined;
  }

  private setWatch(enabled: boolean): void {
    this.watcher?.dispose();
    this.watcher = undefined;
    if (!enabled || vscode.env.remoteName) return;
    this.watcher = watchWorkspaces(
      this.workspaces,
      (ws, sessionIds) => {
        void (async () => {
          for (const sid of sessionIds) {
            try {
              const bucket = await readSessionBucket(ws, sid);
              if (bucket.length > 0) this.sendBuckets([bucket], 'watch', undefined);
            } catch {
              // session folder vanished between event and read
            }
          }
        })();
      },
      this.log
    );
    this.post({ type: 'status', message: `Live tail enabled on ${this.workspaces.length} workspace(s).` });
  }

  /** Send buckets batched under MAX_MESSAGE_BYTES; an oversized single bucket
   *  is split into per-file sessionsChunk frames (details doc §3). */
  private sendBuckets(buckets: SerializedFile[][], origin: SessionsOrigin, requestId: number | undefined): void {
    let batch: SerializedFile[][] = [];
    let batchBytes = 0;
    const flush = () => {
      if (batch.length > 0) this.post({ type: 'sessions', files: batch, origin, requestId });
      batch = [];
      batchBytes = 0;
    };

    for (const bucket of buckets) {
      const size = bucket.reduce((a, f) => a + f.text.length, 0);
      if (size > MAX_MESSAGE_BYTES) {
        flush();
        this.sendChunked(bucket, origin, requestId);
        continue;
      }
      if (batchBytes + size > MAX_MESSAGE_BYTES) flush();
      batch.push(bucket);
      batchBytes += size;
    }
    flush();
  }

  private sendChunked(bucket: SerializedFile[], origin: SessionsOrigin, requestId: number | undefined): void {
    const bucketId = `${bucket[0]?.relPath ?? 'bucket'}#${Date.now()}`;
    let frame: SerializedFile[] = [];
    let frameBytes = 0;
    const frames: SerializedFile[][] = [];
    for (const f of bucket) {
      // A single file larger than the cap still ships whole — postMessage has
      // no hard documented limit; the cap just keeps typical frames small.
      if (frameBytes + f.text.length > MAX_MESSAGE_BYTES && frame.length > 0) {
        frames.push(frame);
        frame = [];
        frameBytes = 0;
      }
      frame.push(f);
      frameBytes += f.text.length;
    }
    if (frame.length > 0) frames.push(frame);
    frames.forEach((files, i) => {
      this.post({ type: 'sessionsChunk', bucketId, files, done: i === frames.length - 1, origin, requestId });
    });
  }
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
