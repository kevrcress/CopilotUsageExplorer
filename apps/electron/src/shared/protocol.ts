/** Types + channel names shared between main, preload, and renderer.
 *  The renderer only imports types from here (no Node code). */

/** A fully-read log file shaped to feed @cue/core's RecoveredFile/groupAndParse.
 *  `text` is inlined because the renderer cannot lazily call back into main.
 *  `absPath` is kept so the parser can derive workspaceHash from the real
 *  .../workspaceStorage/<hash>/... location. */
export interface SerializedFile {
  relPath: string;
  name: string;
  size: number;
  text: string;
  absPath?: string;
}

/** One detected VS Code-family install with Copilot debug logs. */
export interface InstallInfo {
  /** Product dir name under the userData root, e.g. "Code", "Cursor". */
  id: string;
  /** Friendly label, e.g. "VS Code", "VS Code Insiders". */
  product: string;
  workspaceStorageDir: string;
  /** workspaceStorage hash -> friendly folder name (from each hash's workspace.json). */
  workspaceNames: Record<string, string>;
  /** Number of debug-log session folders found across all workspaces. */
  sessionCount: number;
}

/** The narrow API exposed on window.cue by the preload script. */
export interface CueApi {
  listVSCodeInstalls(): Promise<InstallInfo[]>;
  /** Session buckets: one SerializedFile[] per debug-logs session folder
   *  (plus one bucket per workspace hash carrying chatSessions title heads). */
  discoverSessions(installId: string): Promise<SerializedFile[][]>;
  /** Live-tail an install's debug-logs dirs. Repeated calls share one push
   *  channel; each registered callback receives every update. */
  watchSessions(installId: string, cb: (buckets: SerializedFile[][]) => void): Promise<void>;
  /** Stop all watches and drop all callbacks. */
  unwatch(): Promise<void>;
  saveFile(name: string, mime: string, content: string | Uint8Array): Promise<boolean>;
  /** Native folder picker -> recursive scan (same filtering as discovery). */
  pickFolderAndRead(): Promise<SerializedFile[][]>;
}

/** Address of one discoverable bucket. `session: null` means the workspace
 *  hash's chatSessions title bucket. Used by preload/main to chunk discovery
 *  into one-bucket-per-IPC-message (a full corpus can be hundreds of MB). */
export interface BucketRef {
  hash: string;
  session: string | null;
}

export const CueChannels = {
  listInstalls: 'cue:list-installs',
  listBuckets: 'cue:list-buckets',
  readBucket: 'cue:read-bucket',
  watchSessions: 'cue:watch-sessions',
  unwatchSessions: 'cue:unwatch-sessions',
  saveFile: 'cue:save-file',
  pickFolderAndRead: 'cue:pick-folder-and-read',
  /** main -> renderer push (webContents.send) with SerializedFile[][]. */
  sessionsUpdate: 'cue:sessions-update',
} as const;
