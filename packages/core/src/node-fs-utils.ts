import { promises as fsp } from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Shared pure-Node filesystem utilities for host apps that scan a VS Code-like
// workspaceStorage tree (apps/electron/src/main/discovery.ts and
// apps/vscode-ext/src/discovery.ts). Both hosts run in plain Node — there's no
// browser/DOM boundary here, unlike the ingest collectors — so this logic has
// exactly one home instead of two byte-for-byte copies. See changes log
// DD-602 for the hoist rationale.
// ---------------------------------------------------------------------------

/** A file serialized for transport to a renderer/webview: relative path (for
 *  grouping), display name, size, text content (full or head-only), and a
 *  best-effort absolute path (used to derive workspaceHash downstream). */
export interface SerializedFileLike {
  relPath: string;
  name: string;
  size: number;
  text: string;
  absPath?: string;
}

export async function isDir(p: string): Promise<boolean> {
  try {
    return (await fsp.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

export async function listSubdirs(p: string): Promise<string[]> {
  try {
    const entries = await fsp.readdir(p, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** Parse a workspaceStorage hash dir's workspace.json for a friendly folder
 *  name: last path segment of the folder/workspace/configuration URI,
 *  trailing-slash-stripped and URI-decoded. Never throws. */
export async function readWorkspaceFriendlyName(hashDir: string): Promise<string | undefined> {
  try {
    const raw = await fsp.readFile(path.join(hashDir, 'workspace.json'), 'utf8');
    const parsed = JSON.parse(raw) as { folder?: string; workspace?: string; configuration?: string };
    const uri = parsed.folder ?? parsed.workspace ?? parsed.configuration;
    if (typeof uri !== 'string' || !uri) return undefined;
    const last = uri.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
    return last ? decodeURIComponent(last) : undefined;
  } catch {
    return undefined;
  }
}

/** Stat + read a file. When `headBytes` is set and the file is larger than
 *  that, only the first `headBytes` bytes are read (via fs.open/read/close);
 *  otherwise the full file is read. Returns null if the file vanished mid-scan
 *  (VS Code purges logs) or is otherwise unreadable — callers should skip it. */
export async function serializeFile(
  absPath: string,
  relPath: string,
  headBytes?: number
): Promise<SerializedFileLike | null> {
  try {
    const st = await fsp.stat(absPath);
    let text: string;
    if (headBytes && st.size > headBytes) {
      const fh = await fsp.open(absPath, 'r');
      try {
        const buf = Buffer.alloc(Math.min(headBytes, st.size));
        const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
        text = buf.subarray(0, bytesRead).toString('utf8');
      } finally {
        await fh.close();
      }
    } else {
      text = await fsp.readFile(absPath, 'utf8');
    }
    return { relPath, name: path.basename(absPath), size: st.size, text, absPath };
  } catch {
    return null;
  }
}

/** Group a flat list of serialized files by their relPath's parent directory,
 *  preserving encounter order within each group. Used to bucket a recursive
 *  folder scan into one array per session/parent folder. */
export function groupByParentDir<T extends { relPath: string }>(files: T[]): T[][] {
  const byParent = new Map<string, T[]>();
  for (const f of files) {
    const parent = f.relPath.slice(0, f.relPath.lastIndexOf('/'));
    const arr = byParent.get(parent) ?? [];
    arr.push(f);
    byParent.set(parent, arr);
  }
  return Array.from(byParent.values());
}

/** Run `fn` over `items` with at most `limit` in flight at once. Results are
 *  returned in the same order as `items`. Dependency-free stand-in for
 *  `p-limit` — this codebase prefers a ~15-line helper over a new npm
 *  dependency for a single bounded-concurrency use site. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker());
  await Promise.all(workers);
  return results;
}
