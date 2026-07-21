/** Message protocol between the extension host and the webview.
 *  Discriminated unions; one session bucket per `sessions` message. Buckets
 *  whose serialized payload exceeds MAX_MESSAGE_BYTES are split into
 *  `sessionsChunk` frames keyed by bucketId (details doc §3).
 */

/** Soft cap on a single postMessage payload (~20 MB). */
export const MAX_MESSAGE_BYTES = 20 * 1024 * 1024;

/** A file read up-front by the extension host. Mirrors core's RecoveredFile,
 *  with text inlined because the webview cannot lazily call back into Node.
 *  absPath is carried so core's parser can derive workspaceHash from
 *  .../workspaceStorage/<hash>/... (parser.ts deriveWorkspaceHash). */
export interface SerializedFile {
  relPath: string;
  name: string;
  absPath?: string;
  size: number;
  text: string;
}

export type SessionsOrigin = 'discover' | 'watch' | 'pick';

// ---------------------------------------------------------------------------
// Extension host -> webview
// ---------------------------------------------------------------------------

export type ExtToWebviewMessage =
  | {
      type: 'sessions';
      /** One RecoveredFile[]-shaped array per session bucket. */
      files: SerializedFile[][];
      origin: SessionsOrigin;
      /** Echoed when the webview initiated this scan (pick/discover). */
      requestId?: number;
    }
  | {
      /** Escape hatch for buckets over MAX_MESSAGE_BYTES: per-file frames. */
      type: 'sessionsChunk';
      bucketId: string;
      files: SerializedFile[];
      done: boolean;
      origin: SessionsOrigin;
      requestId?: number;
    }
  | {
      /** workspaceStorage/<hash>/workspace.json friendly names, discovery side effect. */
      type: 'workspaceNames';
      names: Record<string, string>;
    }
  | { type: 'saveResult'; requestId: number; ok: boolean; error?: string }
  | { type: 'cacheResult'; requestId: number; ok: boolean; data?: unknown; error?: string }
  | {
      /** Escape hatch for cacheOp replies over MAX_MESSAGE_BYTES (`list`,
       *  `export`): streamed in requestId-correlated frames instead of one
       *  `cacheResult` (details doc §2). `items` is ParsedSession-shaped
       *  payloads for `list`, or string segments to concatenate for `export`.
       *  `bytes` is the frame's serialized-size estimate, for Phase 3's
       *  loading-progress UI — free to compute since streaming already
       *  measures it per frame. */
      type: 'cacheResultChunk';
      requestId: number;
      items: unknown[];
      done: boolean;
      bytes?: number;
    }
  | { type: 'status'; message: string };

// ---------------------------------------------------------------------------
// Webview -> extension host
// ---------------------------------------------------------------------------

export type CacheOp =
  | { op: 'upsert'; session: unknown }
  | { op: 'list' }
  | { op: 'get'; id: string }
  | { op: 'delete'; id: string }
  | { op: 'clear' }
  | { op: 'export' }
  | { op: 'import'; json: string };

export type WebviewToExtMessage =
  | { type: 'ready' }
  | { type: 'discover'; requestId: number }
  | { type: 'pickFolder'; requestId: number }
  | { type: 'save'; requestId: number; name: string; mime: string; content: string }
  | { type: 'watch'; enabled: boolean }
  | { type: 'prefsSet'; key: string; value: unknown }
  | ({ type: 'cacheOp'; requestId: number } & CacheOp);

/** Boot payload injected into the webview HTML as a data attribute (no inline
 *  script needed, so the CSP stays `script-src ${cspSource}`). */
export interface BootData {
  cacheBackend: 'globalStorage' | 'indexeddb';
  /** workspaceState snapshot for sync PrefsStore hydration before mount. */
  prefs: Record<string, unknown>;
}
