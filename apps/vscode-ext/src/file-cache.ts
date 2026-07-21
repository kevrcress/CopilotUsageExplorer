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

/** Stream stored sessions file-by-file rather than reading the whole
 *  directory into memory first, so `list`/`export` streaming (extension.ts
 *  streamList/streamExport) can post a cacheResultChunk frame the moment
 *  enough sessions have accumulated — the point being continuous progress
 *  during a long disk read, not just a smaller final payload.
 *
 *  DD: yields in `fs.readdir` order. The pre-streaming implementation sorted
 *  newest-first (`startedAt` descending), but preserving that sort would
 *  require reading every file before any could be yielded, defeating the
 *  purpose of streaming. store.ts keys the result by session id into a
 *  `Record`, so response order doesn't affect app behavior — dropping the
 *  ordering guarantee here is safe (plan Step 2.2 permits this explicitly,
 *  and packages/ui/test/store.test.ts pins the order-independence). */
export async function* iterateSessions(context: vscode.ExtensionContext): AsyncGenerator<StoredSession> {
  const dir = sessionsDir(context);
  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const raw = await fs.readFile(path.join(dir, name), 'utf8');
      yield JSON.parse(raw) as StoredSession;
    } catch {
      // skip corrupt entries rather than failing the whole list
    }
  }
}

/** `list` streaming source: session payloads only, in `iterateSessions` order. */
export async function* iterateSessionPayloads(
  context: vscode.ExtensionContext
): AsyncGenerator<SessionPayload> {
  for await (const row of iterateSessions(context)) yield row.payload;
}

/** `export` streaming source: string segments that concatenate (in order)
 *  into the same JSON shape `export` always produced —
 *  `{"version":1,"exportedAt":…,"sessions":[…]}` — built incrementally so no
 *  single string ever holds the whole export in memory (details doc §5,
 *  preferred approach). */
export async function* iterateExportSegments(context: vscode.ExtensionContext): AsyncGenerator<string> {
  yield `{"version":1,"exportedAt":${Date.now()},"sessions":[`;
  let first = true;
  for await (const row of iterateSessions(context)) {
    yield (first ? '' : ',') + JSON.stringify(row);
    first = false;
  }
  yield ']}';
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

/** Ops handled via the single-frame `cacheResult` reply. `list` and `export`
 *  are excluded — their replies can exceed MAX_MESSAGE_BYTES, so
 *  extension.ts streams them directly via iterateSessionPayloads /
 *  iterateExportSegments instead of routing through here. */
export type SingleFrameCacheOp = Exclude<CacheOp, { op: 'list' } | { op: 'export' }>;

/** Execute one webview cacheOp against the globalStorage file cache.
 *  Returns the `data` value for the cacheResult reply. */
export async function handleCacheOp(context: vscode.ExtensionContext, msg: SingleFrameCacheOp): Promise<unknown> {
  switch (msg.op) {
    case 'upsert': {
      await writeOne(context, toRow(msg.session as SessionPayload));
      return undefined;
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
