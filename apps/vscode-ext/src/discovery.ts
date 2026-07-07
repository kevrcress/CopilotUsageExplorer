import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { isRelevantFile, SKIP_DIRS } from '@cue/core';
import {
  isDir,
  readWorkspaceFriendlyName,
  serializeFile as serializeFileCore,
  groupByParentDir,
  mapWithConcurrency,
} from '@cue/core/node-fs-utils';
import type { SerializedFile } from './protocol';
import type { Logger } from './logger';

/** How much of a chatSessions title file we ship to the webview. The AI title
 *  lives in the first few lines; core's groupAndParse only reads 2 KB anyway. */
const CHAT_SESSION_HEAD_BYTES = 4096;

/** Bounded concurrency for leaf-level file stat/read calls within a single
 *  directory's worth of work — see the Performance findings in the
 *  2026-07-06 PR review (unbounded sequential walks serialize hundreds of fs
 *  calls on a 100+ session corpus). Only leaf file reads are parallelized;
 *  the outer directory-recursion structure stays sequential/depth-first. */
const FILE_READ_CONCURRENCY = 8;

/** No-op logger so discovery.ts/watcher.ts can log without every call site
 *  (extension.ts, off-limits to this remediation pass) having to be updated
 *  to pass one through. Callers that do have a Logger instance (created in
 *  extension.ts's activate()) can pass it explicitly. */
const noopLogger: Logger = { info() {}, warn() {}, error() {} };

export interface DiscoveredWorkspace {
  /** workspaceStorage hash directory name. */
  hash: string;
  /** Absolute path to <hash>/GitHub.copilot-chat/debug-logs. */
  debugLogsDir: string;
  /** Friendly name from workspace.json (last path segment of the folder URI). */
  friendlyName?: string;
}

export interface DiscoveryResult {
  workspaces: DiscoveredWorkspace[];
  /** hash -> friendly name, for the store's workspaceNames prefs. */
  names: Record<string, string>;
}

/** Locate the VS Code workspaceStorage root for this window.
 *  Primary: parent of the current workspace's storage hash dir. Fallback (no
 *  workspace open): derive from globalStorageUri (…/User/globalStorage/<ext-id>
 *  is a sibling of …/User/workspaceStorage). All probing is best-effort. */
export function workspaceStorageRoot(context: vscode.ExtensionContext): string | undefined {
  try {
    if (context.storageUri) {
      // …/workspaceStorage/<hash> -> …/workspaceStorage
      return path.dirname(path.dirname(context.storageUri.fsPath));
    }
    // …/User/globalStorage/<ext-id> -> …/User/workspaceStorage
    const userDir = path.dirname(path.dirname(context.globalStorageUri.fsPath));
    return path.join(userDir, 'workspaceStorage');
  } catch {
    return undefined;
  }
}

/** Scan every workspaceStorage hash dir for GitHub.copilot-chat/debug-logs.
 *  Never throws; an unreadable root yields an empty result. */
export async function discoverWorkspaces(
  context: vscode.ExtensionContext,
  logger: Logger = noopLogger
): Promise<DiscoveryResult> {
  const result: DiscoveryResult = { workspaces: [], names: {} };
  const root = workspaceStorageRoot(context);
  if (!root || !(await isDir(root))) return result;
  let entries: string[] = [];
  try {
    entries = await fs.readdir(root);
  } catch (err) {
    logger.warn(`discovery: workspaceStorage root unreadable (${errMessage(err)})`);
    return result;
  }
  await mapWithConcurrency(entries, FILE_READ_CONCURRENCY, async (hash) => {
    try {
      const hashDir = path.join(root, hash);
      const debugLogsDir = path.join(hashDir, 'GitHub.copilot-chat', 'debug-logs');
      if (!(await isDir(debugLogsDir))) return;
      const friendlyName = await readWorkspaceFriendlyName(hashDir);
      if (friendlyName) result.names[hash] = friendlyName;
      result.workspaces.push({ hash, debugLogsDir, friendlyName });
    } catch {
      // skip unreadable hash dirs
    }
  });
  return result;
}

async function serializeFile(absPath: string, relPath: string, headBytes?: number): Promise<SerializedFile | null> {
  return serializeFileCore(absPath, relPath, headBytes);
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Read one session folder (debug-logs/<sessionId>) into a SerializedFile
 *  bucket. Includes the sibling chatSessions/<sessionId>.jsonl head when
 *  present so core's groupAndParse can inject the AI-generated title. */
export async function readSessionBucket(
  ws: DiscoveredWorkspace,
  sessionId: string
): Promise<SerializedFile[]> {
  const out: SerializedFile[] = [];
  const sessionDir = path.join(ws.debugLogsDir, sessionId);
  const relBase = `${ws.hash}/GitHub.copilot-chat/debug-logs/${sessionId}`;

  async function walk(dir: string, relDir: string): Promise<SerializedFile[]> {
    let entries: import('node:fs').Dirent[] = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const subdirs = entries.filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name));
    const files = entries.filter((e) => e.isFile() && isRelevantFile(e.name));

    const nested = await Promise.all(subdirs.map((e) => walk(path.join(dir, e.name), `${relDir}/${e.name}`)));
    const leaf = await mapWithConcurrency(files, FILE_READ_CONCURRENCY, (e) =>
      serializeFile(path.join(dir, e.name), `${relDir}/${e.name}`)
    );

    const result: SerializedFile[] = [];
    for (const arr of nested) result.push(...arr);
    for (const f of leaf) if (f) result.push(f);
    return result;
  }
  out.push(...(await walk(sessionDir, relBase)));

  // Sibling AI-title file: <hash>/chatSessions/<sessionId>.jsonl (head only).
  try {
    const chatFile = path.join(path.dirname(path.dirname(ws.debugLogsDir)), 'chatSessions', `${sessionId}.jsonl`);
    const f = await serializeFile(chatFile, `${ws.hash}/chatSessions/${sessionId}.jsonl`, CHAT_SESSION_HEAD_BYTES);
    if (f) out.push(f);
  } catch {
    // no title file — fine
  }
  return out;
}

/** All session buckets under one workspace's debug-logs dir. */
export async function readWorkspaceBuckets(
  ws: DiscoveredWorkspace,
  logger: Logger = noopLogger
): Promise<SerializedFile[][]> {
  let entries: import('node:fs').Dirent[] = [];
  try {
    entries = await fs.readdir(ws.debugLogsDir, { withFileTypes: true });
  } catch (err) {
    logger.warn(`discovery: debug-logs dir unreadable for workspace "${ws.hash}" (${errMessage(err)})`);
    return [];
  }
  const sessionDirs = entries.filter((e) => e.isDirectory());
  const buckets = await mapWithConcurrency(sessionDirs, FILE_READ_CONCURRENCY, async (e) => {
    try {
      return await readSessionBucket(ws, e.name);
    } catch {
      return []; // skip unreadable session folders
    }
  });
  return buckets.filter((bucket) => bucket.length > 0);
}

/** Manual fallback: scan any user-picked folder recursively for relevant files,
 *  bucketed by parent dir (mirrors the browser collectors' shape). Used when
 *  auto-discovery finds nothing or the user wants another location. */
export async function readPickedFolder(rootDir: string): Promise<SerializedFile[][]> {
  async function walk(dir: string, relDir: string): Promise<SerializedFile[]> {
    let entries: import('node:fs').Dirent[] = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const subdirs = entries.filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name));
    const files = entries.filter((e) => e.isFile() && isRelevantFile(e.name));

    const leaf = await mapWithConcurrency(files, FILE_READ_CONCURRENCY, (e) => {
      const abs = path.join(dir, e.name);
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      const isChatSession = relDir.split('/').includes('chatSessions');
      return serializeFile(abs, rel, isChatSession ? CHAT_SESSION_HEAD_BYTES : undefined);
    });
    const nested = await Promise.all(
      subdirs.map((e) => walk(path.join(dir, e.name), relDir ? `${relDir}/${e.name}` : e.name))
    );

    const result: SerializedFile[] = [];
    for (const f of leaf) if (f) result.push(f);
    for (const arr of nested) result.push(...arr);
    return result;
  }
  const files = await walk(rootDir, path.basename(rootDir));

  // Bucket by parent dir so each message stays one-session-sized.
  return groupByParentDir(files);
}
