import type { ParsedSession, RecoveredFile } from '@cue/core';

/** Durable session cache. Mirrors the previous Dexie surface (apps/web wraps
 *  Dexie; other hosts may use extension globalStorage, etc.). */
export interface SessionCache {
  upsert(s: ParsedSession): Promise<void>;
  list(): Promise<ParsedSession[]>;
  get(id: string): Promise<ParsedSession | undefined>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
  exportBackup(): Promise<string>;
  importBackup(json: string): Promise<number>;
}

/** Small key/value preference store. Sync is fine: hosts hydrate before mount. */
export interface PrefsStore {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
}

/** Saves a produced export (CSV/JSON/HTML) via the host's native mechanism. */
export interface FileSaver {
  save(name: string, content: string | Uint8Array, mime: string): Promise<void>;
}

/** Source of Copilot debug-log files. Capabilities drive which affordances the
 *  ingest UI renders. Each RecoveredFile[] is one session bucket. */
export interface IngestSource {
  capabilities(): { pickFolder: boolean; autoDiscover: boolean; watch: boolean; dropFiles: boolean };
  pickAndIngest?(): Promise<RecoveredFile[][]>;
  autoDiscover?(): Promise<RecoveredFile[][]>;
  watch?(onSessions: (files: RecoveredFile[][]) => void): () => void;
}

export interface HostAdapters {
  cache: SessionCache;
  prefs: PrefsStore;
  saver: FileSaver;
  ingest: IngestSource;
}
