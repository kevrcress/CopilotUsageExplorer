import { promises as fsp, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { isRelevantFile, SKIP_DIRS } from '@cue/core';
import {
  isDir,
  listSubdirs,
  readWorkspaceFriendlyName,
  serializeFile as serializeFileCore,
  groupByParentDir,
  mapWithConcurrency,
} from '@cue/core/node-fs-utils';
import type { BucketRef, InstallInfo, SerializedFile } from '../shared/protocol';
import { log } from './logger';

/** Bounded concurrency for leaf-level file stat/read calls within a single
 *  directory's worth of work — see IV-Perf findings in the 2026-07-06 PR
 *  review (unbounded sequential walks serialize hundreds of fs calls on a
 *  100+ session corpus). Only leaf file reads are parallelized; the outer
 *  directory-recursion structure stays sequential/depth-first. */
const FILE_READ_CONCURRENCY = 8;

/** Product dirs (under the per-OS userData root) we probe for Copilot debug logs. */
const PRODUCT_DIRS: Array<{ id: string; product: string }> = [
  { id: 'Code', product: 'VS Code' },
  { id: 'Code - Insiders', product: 'VS Code Insiders' },
  { id: 'VSCodium', product: 'VSCodium' },
  { id: 'Cursor', product: 'Cursor' },
];

const DEBUG_LOGS_SUBPATH = path.join('GitHub.copilot-chat', 'debug-logs');
/** Only the first 2 KB of a chatSessions title file is ever needed (customTitle is in lines 1-4). */
const CHAT_SESSIONS_HEAD_BYTES = 2048;

const PRODUCT_IDS = new Set(PRODUCT_DIRS.map((p) => p.id));

/** IPC input validation: `installId` must be one of the known PRODUCT_DIRS
 *  ids. Renderer-supplied values are otherwise attacker-controlled strings
 *  that get `path.join()`-ed into a filesystem root — reject anything not
 *  on the allowlist rather than let it reach `path.join`. */
export function isValidInstallId(installId: unknown): installId is string {
  return typeof installId === 'string' && PRODUCT_IDS.has(installId);
}

/** IPC input validation for `hash`/`session` path segments: reject anything
 *  containing a path separator or `..`, and reject empty strings. These
 *  values come from the renderer (BucketRef) and get `path.join()`-ed
 *  directly; a crafted segment must not be able to escape the intended dir. */
export function isSafePathSegment(segment: unknown): segment is string {
  return (
    typeof segment === 'string' &&
    segment.length > 0 &&
    segment !== '..' &&
    !segment.includes('/') &&
    !segment.includes('\\')
  );
}

function userDataRoot(): string {
  if (process.platform === 'win32') {
    return process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support');
  }
  return process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config');
}

function workspaceStorageDir(productId: string): string {
  return path.join(userDataRoot(), productId, 'User', 'workspaceStorage');
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Per-installId cache of a workspaceStorage tree walk: hash -> its debug-logs
 *  session-folder names (only for hashes that have a debug-logs dir at all).
 *  `listVSCodeInstalls` and `listBucketRefs` both need this exact tree shape;
 *  without a cache they'd each independently re-walk hundreds of dirs back to
 *  back (the redundant-walk Major from the 2026-07-06 PR review — the
 *  renderer calls listVSCodeInstalls() then listBucketRefs(installId) per
 *  install). TTL is short: this only needs to survive the handful of
 *  milliseconds between the two IPC round-trips in that call pattern, not
 *  serve as a long-lived cache that could go stale against live edits. */
const HASH_TREE_CACHE_TTL_MS = 10_000;
interface HashTreeEntry {
  builtAt: number;
  hashSessions: Map<string, string[]>;
}
const hashTreeCache = new Map<string, HashTreeEntry>();

/** Walk one install's workspaceStorage root once, returning hash -> session
 *  folder names for every hash that has a debug-logs dir. Shared by
 *  listVSCodeInstalls (which also derives sessionCount/workspaceNames from
 *  it) and listBucketRefs (which turns it into BucketRefs) so the tree is
 *  only read from disk once per TTL window. */
async function buildHashTree(installId: string, wsDir: string): Promise<Map<string, string[]>> {
  const cached = hashTreeCache.get(installId);
  if (cached && Date.now() - cached.builtAt < HASH_TREE_CACHE_TTL_MS) return cached.hashSessions;

  const hashSessions = new Map<string, string[]>();
  const hashes = await listSubdirs(wsDir);
  await mapWithConcurrency(hashes, FILE_READ_CONCURRENCY, async (hash) => {
    const debugLogs = path.join(wsDir, hash, DEBUG_LOGS_SUBPATH);
    if (!(await isDir(debugLogs))) return;
    hashSessions.set(hash, await listSubdirs(debugLogs));
  });
  hashTreeCache.set(installId, { builtAt: Date.now(), hashSessions });
  return hashSessions;
}

/** Probe every known VS Code-family install for Copilot debug logs. */
export async function listVSCodeInstalls(): Promise<InstallInfo[]> {
  const out: InstallInfo[] = [];
  for (const { id, product } of PRODUCT_DIRS) {
    const wsDir = workspaceStorageDir(id);
    if (!(await isDir(wsDir))) continue;
    const hashSessions = await buildHashTree(id, wsDir);
    const workspaceNames: Record<string, string> = {};
    let sessionCount = 0;
    await mapWithConcurrency(Array.from(hashSessions.keys()), FILE_READ_CONCURRENCY, async (hash) => {
      sessionCount += hashSessions.get(hash)?.length ?? 0;
      const name = await readWorkspaceFriendlyName(path.join(wsDir, hash));
      if (name) workspaceNames[hash] = name;
    });
    // Include installs even with zero sessions so the UI can say "found VS Code, no logs yet".
    out.push({ id, product, workspaceStorageDir: wsDir, workspaceNames, sessionCount });
  }
  return out;
}

async function serializeFile(absPath: string, relPath: string, headOnly = false): Promise<SerializedFile | null> {
  return serializeFileCore(absPath, relPath, headOnly ? CHAT_SESSIONS_HEAD_BYTES : undefined);
}

/** Recursively collect relevant files under a session folder. Leaf-level file
 *  reads within a directory are bounded-concurrency (FILE_READ_CONCURRENCY);
 *  the recursive directory structure itself stays sequential/depth-first. */
async function collectSessionFiles(dir: string, relBase: string): Promise<SerializedFile[]> {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const subdirs = entries.filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name));
  const files = entries.filter((e) => e.isFile() && isRelevantFile(e.name));

  const nested = await Promise.all(subdirs.map((e) => collectSessionFiles(path.join(dir, e.name), `${relBase}/${e.name}`)));
  const leaf = await mapWithConcurrency(files, FILE_READ_CONCURRENCY, (e) =>
    serializeFile(path.join(dir, e.name), `${relBase}/${e.name}`)
  );

  const out: SerializedFile[] = [];
  for (const arr of nested) out.push(...arr);
  for (const f of leaf) if (f) out.push(f);
  return out;
}

/** Serialize one debug-logs session folder as a bucket. */
async function readSessionBucket(wsDir: string, hash: string, sessionName: string): Promise<SerializedFile[]> {
  const sessionDir = path.join(wsDir, hash, DEBUG_LOGS_SUBPATH, sessionName);
  const relBase = `workspaceStorage/${hash}/GitHub.copilot-chat/debug-logs/${sessionName}`;
  return collectSessionFiles(sessionDir, relBase);
}

/** Serialize a hash's chatSessions/*.jsonl title files (head-only). */
async function readChatSessionsBucket(wsDir: string, hash: string): Promise<SerializedFile[]> {
  const dir = path.join(wsDir, hash, 'chatSessions');
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const jsonlFiles = entries.filter((e) => e.isFile() && /\.jsonl$/i.test(e.name));
  const results = await mapWithConcurrency(jsonlFiles, FILE_READ_CONCURRENCY, (e) =>
    serializeFile(path.join(dir, e.name), `workspaceStorage/${hash}/chatSessions/${e.name}`, true)
  );
  return results.filter((f): f is SerializedFile => f !== null);
}

/** Enumerate discoverable buckets without reading file contents. One ref per
 *  debug-logs session folder, plus one chatSessions-titles ref per hash.
 *  Contents are then fetched one bucket per IPC message via readBucket —
 *  a full corpus can be hundreds of MB, too big for a single message.
 *
 *  Reuses buildHashTree's cached walk when called shortly after
 *  listVSCodeInstalls() for the same installId (the renderer's normal
 *  discover-then-list-buckets sequence) instead of re-walking the tree. */
export async function listBucketRefs(installId: string): Promise<BucketRef[]> {
  if (!isValidInstallId(installId)) return [];
  const wsDir = workspaceStorageDir(installId);
  const hashSessions = await buildHashTree(installId, wsDir);
  const refs: BucketRef[] = [];
  for (const [hash, sessionNames] of hashSessions) {
    for (const sessionName of sessionNames) {
      refs.push({ hash, session: sessionName });
    }
    refs.push({ hash, session: null }); // chatSessions titles for this workspace
  }
  return refs;
}

/** Read one bucket's file contents. `session: null` -> chatSessions titles. */
export async function readBucket(installId: string, ref: BucketRef): Promise<SerializedFile[]> {
  if (!isValidInstallId(installId)) return [];
  if (!isSafePathSegment(ref?.hash)) return [];
  const wsDir = workspaceStorageDir(installId);
  if (ref.session === null) return readChatSessionsBucket(wsDir, ref.hash);
  if (!isSafePathSegment(ref.session)) return [];
  return readSessionBucket(wsDir, ref.hash, ref.session);
}

/** Recursive scan of an arbitrary user-picked folder (native dialog flow).
 *  Same filtering as the browser collectors: SKIP_DIRS pruned, relevant files
 *  only, chatSessions/*.jsonl read head-only. Buckets by parent dir. Leaf-level
 *  file reads within a directory are bounded-concurrency. */
export async function readFolderRecursive(root: string): Promise<SerializedFile[][]> {
  const files: SerializedFile[] = [];
  async function walk(dir: string, relBase: string): Promise<void> {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const subdirs = entries.filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name));
    const relevantFiles = entries.filter((e) => e.isFile() && isRelevantFile(e.name));

    const results = await mapWithConcurrency(relevantFiles, FILE_READ_CONCURRENCY, (e) => {
      const abs = path.join(dir, e.name);
      const rel = relBase ? `${relBase}/${e.name}` : e.name;
      const headOnly = /(^|\/)chatSessions\//.test(rel) || relBase.endsWith('/chatSessions');
      return serializeFile(abs, `${path.basename(root)}/${rel}`, headOnly);
    });
    for (const f of results) if (f) files.push(f);

    for (const e of subdirs) {
      const abs = path.join(dir, e.name);
      const rel = relBase ? `${relBase}/${e.name}` : e.name;
      await walk(abs, rel);
    }
  }
  await walk(root, '');
  return groupByParentDir(files);
}

// ---------------------------------------------------------------------------
// Live tail. fs.watch({ recursive }) works on macOS/Windows; on platforms
// where it throws (older Linux), we fall back to 5s polling. New workspace
// hash dirs created AFTER the watch starts are not tailed until the next
// rescan/relaunch — acceptable for v1 (documented limitation).
// ---------------------------------------------------------------------------

type PushFn = (buckets: SerializedFile[][]) => void;

interface ActiveWatch {
  installId: string;
  wsDir: string;
  push: PushFn;
  watchers: Map<string, FSWatcher>;
  debounceTimers: Map<string, NodeJS.Timeout>;
  pollTimer?: NodeJS.Timeout;
  pollSignatures: Map<string, string>;
  /** Hashes currently being covered by the poll fallback (either because
   *  fs.watch never started for them, or because it errored post-init). */
  pollingHashes: Set<string>;
}

const DEBOUNCE_MS = 2000;
const POLL_MS = 5000;

const activeWatches = new Map<string, ActiveWatch>();

async function rescanDebugLogsDir(wsDir: string, hash: string, push: PushFn): Promise<void> {
  // One push per session bucket keeps each webContents.send payload bounded.
  // The hash's chatSessions title heads (2 KB each) ride along in every push
  // so a re-parsed session keeps its AI-generated title.
  const debugLogs = path.join(wsDir, hash, DEBUG_LOGS_SUBPATH);
  const titles = await readChatSessionsBucket(wsDir, hash);
  for (const sessionName of await listSubdirs(debugLogs)) {
    const bucket = await readSessionBucket(wsDir, hash, sessionName);
    if (bucket.length) push(titles.length ? [bucket, titles] : [bucket]);
  }
}

/** Cheap change signature for polling: session dir names + file sizes. */
async function debugLogsSignature(debugLogs: string): Promise<string> {
  const parts: string[] = [];
  for (const sessionName of await listSubdirs(debugLogs)) {
    const sessionDir = path.join(debugLogs, sessionName);
    try {
      const entries = await fsp.readdir(sessionDir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isFile()) continue;
        try {
          const st = await fsp.stat(path.join(sessionDir, e.name));
          parts.push(`${sessionName}/${e.name}:${st.size}`);
        } catch {
          /* vanished */
        }
      }
    } catch {
      /* vanished */
    }
  }
  return parts.sort().join('|');
}

/** Ensure the poll timer is running and covering `hash`, seeding its baseline
 *  signature first so the next tick doesn't immediately re-push everything.
 *  Called both for hashes where fs.watch never started (init failure) and
 *  for hashes whose watcher died after a successful init (IV-O02) — both
 *  cases reuse this same poll-timer/pollSignatures machinery rather than a
 *  second polling mechanism. */
async function enablePollingFor(state: ActiveWatch, hash: string): Promise<void> {
  state.pollingHashes.add(hash);
  const debugLogs = path.join(state.wsDir, hash, DEBUG_LOGS_SUBPATH);
  state.pollSignatures.set(hash, await debugLogsSignature(debugLogs));

  if (state.pollTimer) return; // timer already running; it now covers this hash too
  state.pollTimer = setInterval(async () => {
    for (const h of state.pollingHashes) {
      const dir = path.join(state.wsDir, h, DEBUG_LOGS_SUBPATH);
      const sig = await debugLogsSignature(dir);
      const prev = state.pollSignatures.get(h);
      if (prev !== undefined && prev !== sig) {
        void rescanDebugLogsDir(state.wsDir, h, state.push);
      }
      state.pollSignatures.set(h, sig);
    }
  }, POLL_MS);
}

function startWatcherFor(state: ActiveWatch, hash: string, debugLogs: string): void {
  const watcher = watch(debugLogs, { recursive: true }, () => {
    const existing = state.debounceTimers.get(hash);
    if (existing) clearTimeout(existing);
    state.debounceTimers.set(
      hash,
      setTimeout(() => {
        state.debounceTimers.delete(hash);
        void rescanDebugLogsDir(state.wsDir, hash, state.push);
      }, DEBOUNCE_MS)
    );
  });
  watcher.on('error', (err) => {
    // Post-init failure (e.g. ENOSPC, the debug-logs dir being deleted and
    // recreated): fs.watch is dead for this hash. Previously this just closed
    // the watcher with no fallback and no signal — silently and permanently
    // stopping live-tail for the rest of the session (IV-O02). Now: log it
    // and fall back to the same stat-polling used for init-time failures.
    watcher.close();
    state.watchers.delete(hash);
    log.warn(
      `live-tail: watcher for install "${state.installId}" hash "${hash}" errored post-init (${errMessage(err)}) — falling back to polling`
    );
    void enablePollingFor(state, hash);
  });
  state.watchers.set(hash, watcher);
}

export async function startWatch(installId: string, push: PushFn): Promise<void> {
  if (!isValidInstallId(installId)) return;
  if (activeWatches.has(installId)) return;
  const wsDir = workspaceStorageDir(installId);
  const state: ActiveWatch = {
    installId,
    wsDir,
    push,
    watchers: new Map(),
    debounceTimers: new Map(),
    pollSignatures: new Map(),
    pollingHashes: new Set(),
  };
  activeWatches.set(installId, state);

  const hashesWithLogs: string[] = [];
  for (const hash of await listSubdirs(wsDir)) {
    if (await isDir(path.join(wsDir, hash, DEBUG_LOGS_SUBPATH))) hashesWithLogs.push(hash);
  }

  for (const hash of hashesWithLogs) {
    const debugLogs = path.join(wsDir, hash, DEBUG_LOGS_SUBPATH);
    try {
      startWatcherFor(state, hash, debugLogs);
    } catch (err) {
      log.warn(
        `live-tail: fs.watch unavailable for install "${installId}" hash "${hash}" (${errMessage(err)}) — falling back to polling`
      );
      await enablePollingFor(state, hash);
    }
  }
}

export function stopAllWatches(): void {
  for (const state of activeWatches.values()) {
    for (const w of state.watchers.values()) w.close();
    for (const t of state.debounceTimers.values()) clearTimeout(t);
    if (state.pollTimer) clearInterval(state.pollTimer);
  }
  activeWatches.clear();
}
