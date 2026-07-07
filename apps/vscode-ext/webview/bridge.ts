import type { RecoveredFile } from '@cue/core';
import type {
  BootData,
  ExtToWebviewMessage,
  SerializedFile,
  SessionsOrigin,
  WebviewToExtMessage,
} from '../src/protocol';

// ---------------------------------------------------------------------------
// VS Code webview API singleton
// ---------------------------------------------------------------------------

interface VsCodeApi {
  postMessage(msg: WebviewToExtMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

/** Boot payload injected by the extension as a data attribute (see
 *  extension.ts buildHtml — keeps the CSP free of inline scripts). */
export function readBoot(): BootData {
  const el = document.getElementById('cue-boot');
  const raw = el?.getAttribute('data-boot');
  if (raw) {
    try {
      return JSON.parse(raw) as BootData;
    } catch {
      // fall through to defaults
    }
  }
  return { cacheBackend: 'globalStorage', prefs: {} };
}

/** Wrap a SerializedFile bucket as core RecoveredFiles (text is inlined). */
export function toRecoveredFiles(files: SerializedFile[]): RecoveredFile[] {
  return files.map((f) => ({
    relPath: f.relPath,
    name: f.name,
    absPath: f.absPath,
    size: f.size,
    text: async () => f.text,
    readHead: async (bytes: number) => f.text.slice(0, bytes),
  }));
}

// ---------------------------------------------------------------------------
// Bridge: message routing + request/response correlation + chunk assembly
// ---------------------------------------------------------------------------

export interface SessionsEvent {
  buckets: RecoveredFile[][];
  origin: SessionsOrigin;
}

export interface Bridge {
  /** Every session bucket that arrives, regardless of origin/initiator. */
  onSessions(cb: (e: SessionsEvent) => void): () => void;
  onStatus(cb: (message: string) => void): () => void;
  onWorkspaceNames(cb: (names: Record<string, string>) => void): () => void;
  /** Tell the extension the app mounted; it replies with auto-discovery. */
  ready(): void;
  /** Re-run auto-discovery; resolves with the discovered buckets. */
  discover(): Promise<RecoveredFile[][]>;
  /** showOpenDialog folder scan; resolves with the scanned buckets. */
  pickFolder(): Promise<RecoveredFile[][]>;
  save(name: string, mime: string, content: string): Promise<void>;
  setWatch(enabled: boolean): void;
  watchEnabled(): boolean;
  /** Fires whenever `watching` changes, including from setWatch() calls the
   *  caller didn't itself trigger (e.g. main.tsx's post-init auto-enable). */
  onWatchChange(cb: (enabled: boolean) => void): () => void;
  prefsSet(key: string, value: unknown): void;
  cacheOp(op: Extract<WebviewToExtMessage, { type: 'cacheOp' }>['op'], extra?: Record<string, unknown>): Promise<unknown>;
}

export function createBridge(): Bridge {
  let nextRequestId = 1;

  const sessionListeners = new Set<(e: SessionsEvent) => void>();
  const statusListeners = new Set<(m: string) => void>();
  const nameListeners = new Set<(n: Record<string, string>) => void>();
  const watchListeners = new Set<(enabled: boolean) => void>();

  // Scans in flight: sessions frames sharing a requestId accumulate until the
  // terminal empty frame resolves the promise.
  const pendingScans = new Map<number, { buckets: RecoveredFile[][]; resolve: (b: RecoveredFile[][]) => void }>();
  const pendingSaves = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();
  const pendingCache = new Map<number, { resolve: (data: unknown) => void; reject: (e: Error) => void }>();

  // sessionsChunk reassembly buffers, keyed by bucketId.
  const chunkBuffers = new Map<string, SerializedFile[]>();

  let watching = false;

  function deliverBuckets(raw: SerializedFile[][], origin: SessionsOrigin, requestId?: number): void {
    const buckets = raw.filter((b) => b.length > 0).map(toRecoveredFiles);
    if (buckets.length > 0) {
      for (const cb of sessionListeners) cb({ buckets, origin });
    }
    if (requestId !== undefined) {
      const scan = pendingScans.get(requestId);
      if (scan) {
        scan.buckets.push(...buckets);
        if (raw.length === 0) {
          // Terminal empty frame: the scan is complete.
          pendingScans.delete(requestId);
          scan.resolve(scan.buckets);
        }
      }
    }
  }

  window.addEventListener('message', (event: MessageEvent<ExtToWebviewMessage>) => {
    const msg = event.data;
    switch (msg.type) {
      case 'sessions':
        deliverBuckets(msg.files, msg.origin, msg.requestId);
        return;
      case 'sessionsChunk': {
        const buf = chunkBuffers.get(msg.bucketId) ?? [];
        buf.push(...msg.files);
        if (msg.done) {
          chunkBuffers.delete(msg.bucketId);
          deliverBuckets([buf], msg.origin, msg.requestId);
        } else {
          chunkBuffers.set(msg.bucketId, buf);
        }
        return;
      }
      case 'workspaceNames':
        for (const cb of nameListeners) cb(msg.names);
        return;
      case 'status':
        for (const cb of statusListeners) cb(msg.message);
        return;
      case 'saveResult': {
        const p = pendingSaves.get(msg.requestId);
        if (!p) return;
        pendingSaves.delete(msg.requestId);
        if (msg.ok) p.resolve();
        else p.reject(new Error(msg.error ?? 'save failed'));
        return;
      }
      case 'cacheResult': {
        const p = pendingCache.get(msg.requestId);
        if (!p) return;
        pendingCache.delete(msg.requestId);
        if (msg.ok) p.resolve(msg.data);
        else p.reject(new Error(msg.error ?? 'cache operation failed'));
        return;
      }
    }
  });

  function startScan(type: 'discover' | 'pickFolder'): Promise<RecoveredFile[][]> {
    const requestId = nextRequestId++;
    return new Promise<RecoveredFile[][]>((resolve) => {
      pendingScans.set(requestId, { buckets: [], resolve });
      vscode.postMessage({ type, requestId });
    });
  }

  return {
    onSessions(cb) {
      sessionListeners.add(cb);
      return () => sessionListeners.delete(cb);
    },
    onStatus(cb) {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
    onWorkspaceNames(cb) {
      nameListeners.add(cb);
      return () => nameListeners.delete(cb);
    },
    onWatchChange(cb) {
      watchListeners.add(cb);
      return () => watchListeners.delete(cb);
    },
    ready() {
      vscode.postMessage({ type: 'ready' });
    },
    discover: () => startScan('discover'),
    pickFolder: () => startScan('pickFolder'),
    save(name, mime, content) {
      const requestId = nextRequestId++;
      return new Promise<void>((resolve, reject) => {
        pendingSaves.set(requestId, { resolve, reject });
        vscode.postMessage({ type: 'save', requestId, name, mime, content });
      });
    },
    setWatch(enabled) {
      watching = enabled;
      vscode.postMessage({ type: 'watch', enabled });
      for (const cb of watchListeners) cb(enabled);
    },
    watchEnabled: () => watching,
    prefsSet(key, value) {
      vscode.postMessage({ type: 'prefsSet', key, value });
    },
    cacheOp(op, extra) {
      const requestId = nextRequestId++;
      return new Promise<unknown>((resolve, reject) => {
        pendingCache.set(requestId, { resolve, reject });
        vscode.postMessage({ type: 'cacheOp', requestId, op, ...extra } as WebviewToExtMessage);
      });
    },
  };
}
