import Dexie, { type Table } from 'dexie';
import type { ParsedSession } from '@cue/core';
import type { SessionCache } from '../host';

class CueDb extends Dexie {
  sessions!: Table<StoredSession, string>;

  constructor() {
    super('copilot-usage-explorer');
    this.version(1).stores({
      sessions: '&id, startedAt, workspaceHash',
    });
  }
}

interface StoredSession {
  id: string;
  startedAt: number;
  workspaceHash?: string;
  /** JSON-serialized ParsedSession (events array can be large; we keep it for fidelity). */
  payload: ParsedSession;
}

/** IndexedDB-backed SessionCache, shared by every host that opts into a
 *  browser-local Dexie cache (apps/web always; apps/electron renderer always;
 *  apps/vscode-ext webview only when `copilotUsageExplorer.cacheBackend` is
 *  `"indexeddb"` — globalStorage is its default because Dexie/IndexedDB
 *  durability across VS Code restarts is not contract-guaranteed). */
export function createDexieSessionCache(): SessionCache {
  const db = new CueDb();
  return {
    async upsert(s: ParsedSession): Promise<void> {
      await db.sessions.put({
        id: s.id,
        startedAt: s.startedAt,
        workspaceHash: s.workspaceHash,
        payload: s,
      });
    },

    async list(): Promise<ParsedSession[]> {
      const rows = await db.sessions.orderBy('startedAt').reverse().toArray();
      return rows.map((r) => r.payload);
    },

    async get(id: string): Promise<ParsedSession | undefined> {
      return (await db.sessions.get(id))?.payload;
    },

    async delete(id: string): Promise<void> {
      await db.sessions.delete(id);
    },

    async clear(): Promise<void> {
      await db.sessions.clear();
    },

    /** Export all cached sessions as a JSON blob for backup. */
    async exportBackup(): Promise<string> {
      const all = await db.sessions.toArray();
      return JSON.stringify({ version: 1, exportedAt: Date.now(), sessions: all });
    },

    /** Import sessions from a backup JSON blob, merging (keeps richer versions).
     *  Returns the number of imported sessions. */
    async importBackup(json: string): Promise<number> {
      const data = JSON.parse(json);
      if (!data?.sessions?.length) return 0;
      let imported = 0;
      for (const s of data.sessions as StoredSession[]) {
        const existing = await db.sessions.get(s.id);
        if (existing && existing.payload.events.length >= s.payload.events.length) {
          continue; // keep the richer cached version
        }
        await db.sessions.put(s);
        imported++;
      }
      return imported;
    },
  };
}
