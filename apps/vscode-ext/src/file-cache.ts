import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { CacheOp } from './protocol';

/** File-backed session cache under context.globalStorageUri/sessions/.
 *  One JSON file per session, shaped exactly like a Dexie StoredSession row
 *  ({ id, startedAt, workspaceHash?, payload }) so exportBackup output is
 *  interchangeable with the shared Dexie cache's backup format
 *  (packages/ui/src/adapters/dexie-cache.ts).
 *  Durability here is a VS Code API contract, unlike webview IndexedDB. */

interface StoredSession {
  id: string;
  startedAt: number;
  workspaceHash?: string;
  payload: SessionPayload;
}

/** Minimal shape we rely on; the payload is otherwise opaque JSON. */
interface SessionPayload {
  id: string;
  startedAt: number;
  workspaceHash?: string;
  events: unknown[];
}

function sessionsDir(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, 'sessions');
}

/** Session ids are uuid-ish (or title-<uuid>) but sanitize defensively for
 *  filesystem use; the real id always lives inside the JSON. */
function fileNameFor(id: string): string {
  return `${id.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`;
}

async function readAll(context: vscode.ExtensionContext): Promise<StoredSession[]> {
  const dir = sessionsDir(context);
  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: StoredSession[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')) as StoredSession);
    } catch {
      // skip corrupt entries rather than failing the whole list
    }
  }
  out.sort((a, b) => b.startedAt - a.startedAt);
  return out;
}

async function writeOne(context: vscode.ExtensionContext, row: StoredSession): Promise<void> {
  const dir = sessionsDir(context);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, fileNameFor(row.id)), JSON.stringify(row), 'utf8');
}

async function readOne(context: vscode.ExtensionContext, id: string): Promise<StoredSession | undefined> {
  try {
    const raw = await fs.readFile(path.join(sessionsDir(context), fileNameFor(id)), 'utf8');
    return JSON.parse(raw) as StoredSession;
  } catch {
    return undefined;
  }
}

function toRow(payload: SessionPayload): StoredSession {
  return {
    id: payload.id,
    startedAt: payload.startedAt,
    workspaceHash: payload.workspaceHash,
    payload,
  };
}

/** Execute one webview cacheOp against the globalStorage file cache.
 *  Returns the `data` value for the cacheResult reply. */
export async function handleCacheOp(context: vscode.ExtensionContext, msg: CacheOp): Promise<unknown> {
  switch (msg.op) {
    case 'upsert': {
      await writeOne(context, toRow(msg.session as SessionPayload));
      return undefined;
    }
    case 'list': {
      return (await readAll(context)).map((r) => r.payload);
    }
    case 'get': {
      return (await readOne(context, msg.id))?.payload;
    }
    case 'delete': {
      try {
        await fs.unlink(path.join(sessionsDir(context), fileNameFor(msg.id)));
      } catch {
        // already gone
      }
      return undefined;
    }
    case 'clear': {
      try {
        await fs.rm(sessionsDir(context), { recursive: true, force: true });
      } catch {
        // already gone
      }
      return undefined;
    }
    case 'export': {
      const all = await readAll(context);
      return JSON.stringify({ version: 1, exportedAt: Date.now(), sessions: all });
    }
    case 'import': {
      const data = JSON.parse(msg.json) as { sessions?: StoredSession[] };
      if (!data?.sessions?.length) return 0;
      let imported = 0;
      for (const row of data.sessions) {
        const existing = await readOne(context, row.id);
        if (existing && existing.payload.events.length >= row.payload.events.length) {
          continue; // keep the richer cached version (same rule as dexie-cache)
        }
        await writeOne(context, row);
        imported++;
      }
      return imported;
    }
  }
}
