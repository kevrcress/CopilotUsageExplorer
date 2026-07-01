import Dexie, { type Table } from 'dexie';
import type { ParsedSession } from './types';

class CueDb extends Dexie {
  sessions!: Table<StoredSession, string>;

  constructor() {
    super('copilot-usage-explorer');
    this.version(1).stores({
      sessions: '&id, startedAt, workspaceHash',
    });
  }
}

export interface StoredSession {
  id: string;
  startedAt: number;
  workspaceHash?: string;
  /** JSON-serialized ParsedSession (events array can be large; we keep it for fidelity). */
  payload: ParsedSession;
}

export const db = new CueDb();

export async function upsertSession(s: ParsedSession): Promise<void> {
  await db.sessions.put({
    id: s.id,
    startedAt: s.startedAt,
    workspaceHash: s.workspaceHash,
    payload: s,
  });
}

export async function listStoredSessions(): Promise<StoredSession[]> {
  return db.sessions.orderBy('startedAt').reverse().toArray();
}

export async function getStoredSession(id: string): Promise<StoredSession | undefined> {
  return db.sessions.get(id);
}

export async function deleteStoredSession(id: string): Promise<void> {
  await db.sessions.delete(id);
}

export async function clearAll(): Promise<void> {
  await db.sessions.clear();
}

/** Export all cached sessions as a JSON blob for backup. */
export async function exportBackup(): Promise<string> {
  const all = await db.sessions.toArray();
  return JSON.stringify({ version: 1, exportedAt: Date.now(), sessions: all });
}

/** Import sessions from a backup JSON blob, merging (keeps richer versions). */
export async function importBackup(json: string): Promise<{ imported: number; skipped: number }> {
  const data = JSON.parse(json);
  if (!data?.sessions?.length) return { imported: 0, skipped: 0 };
  let imported = 0;
  let skipped = 0;
  for (const s of data.sessions as StoredSession[]) {
    const existing = await db.sessions.get(s.id);
    if (existing && existing.payload.events.length >= s.payload.events.length) {
      skipped++;
    } else {
      await db.sessions.put(s);
      imported++;
    }
  }
  return { imported, skipped };
}
