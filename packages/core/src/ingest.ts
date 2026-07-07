import { parseSession, parseEventsFromText } from './parser';
import type { ParsedSession, RawEvent, SessionModelInfo } from './types';

/** A file recovered from any host source (folder pick, drag-drop, extension-host
 *  FS scan, Electron main process). We carry the relative path so we can group
 *  sibling files (system_prompt_N.json, models.json, child JSONLs) under their
 *  parent session folder.
 */
export interface RecoveredFile {
  /** Full path-like string used for grouping, e.g. "debug-logs/<sid>/main.jsonl" */
  relPath: string;
  name: string;
  /** Best-effort absolute path (when the host knows it, e.g. Node fs scans). */
  absPath?: string;
  size: number;
  /** Lazy text loader. */
  text: () => Promise<string>;
  /** Efficient head read (e.g. Blob.slice in browsers, partial fs read in Node).
   *  When absent, callers fall back to text() and slice in memory. */
  readHead?: (bytes: number) => Promise<string>;
}

/** Names we never need to descend into when walking a workspaceStorage-like tree.
 *  Keeps recursive picks (“point at workspaceStorage”) reasonably fast.
 */
export const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out', 'coverage',
  'workbench.desktop.main.css.cache', 'logs', 'CachedExtensions', 'CachedData',
  'GPUCache', 'Cache', 'Code Cache', 'blob_storage', 'Service Worker',
  'Local Storage', 'Session Storage', 'IndexedDB', 'databases', 'shared_proto_db',
  // VS Code chat directories that have .jsonl files with same session IDs but less data.
  // chatSessions is intentionally NOT here — we read the first 2 KB of each file for the
  // AI-generated conversation title (kind:1 customTitle event), then discard the rest.
  'transcripts', 'chatEditingSessions',
]);

/** Whitelist files we actually care about. Anything else is ignored to keep memory low. */
export function isRelevantFile(name: string): boolean {
  if (name === 'main.jsonl' || name === 'models.json') return true;
  if (/^system_prompt_\d+\.json$/i.test(name)) return true;
  if (/^tools_\d+\.json$/i.test(name)) return true;
  if (/\.jsonl$/i.test(name)) return true; // child title-*.jsonl
  return false;
}

/** True if this file is a chatSessions/<uuid>.jsonl — holds the AI-generated title. */
function isChatSessionFile(f: RecoveredFile): boolean {
  const parts = f.relPath.replace(/\\/g, '/').split('/');
  return (
    parts.includes('chatSessions') &&
    /^[0-9a-f]{8}-[0-9a-f-]{27,}\.jsonl$/i.test(f.name)
  );
}

/** Scan the first few lines of a chatSessions JSONL for the customTitle delta event. */
function extractCustomTitle(chunk: string): string | undefined {
  for (const line of chunk.split('\n').slice(0, 15)) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (
        obj.kind === 1 &&
        Array.isArray(obj.k) &&
        (obj.k as string[])[0] === 'customTitle' &&
        typeof obj.v === 'string' &&
        (obj.v as string).trim()
      ) {
        return (obj.v as string).trim();
      }
    } catch { /* invalid JSON line */ }
  }
  return undefined;
}

/** Group recovered files by their parent folder (== session folder), then parse each. */
export async function groupAndParse(files: RecoveredFile[]): Promise<ParsedSession[]> {
  // Separate chatSessions title files from debug-log files.
  const chatFiles = files.filter(isChatSessionFile);
  const debugFiles = files.filter((f) => !isChatSessionFile(f));

  // Extract AI-generated titles — only read the first 2 KB of each file (title is in line 1–4).
  const titleMap = new Map<string, string>();
  for (const f of chatFiles) {
    const chunk = f.readHead
      ? await f.readHead(2048)
      : (await f.text()).slice(0, 2048);
    const title = extractCustomTitle(chunk);
    if (title) titleMap.set(f.name.replace(/\.jsonl$/i, ''), title);
  }

  // Bucket by parent dir relative path.
  const buckets = new Map<string, RecoveredFile[]>();
  for (const f of debugFiles) {
    const lastSlash = Math.max(f.relPath.lastIndexOf('/'), f.relPath.lastIndexOf('\\'));
    const parent = lastSlash >= 0 ? f.relPath.substring(0, lastSlash) : '';
    const arr = buckets.get(parent) ?? [];
    arr.push(f);
    buckets.set(parent, arr);
  }

  const out: ParsedSession[] = [];
  for (const [parent, list] of buckets) {
    // A session bucket must contain a main.jsonl OR be a child title-*.jsonl directly.
    const main = list.find((f) => f.name === 'main.jsonl');
    if (main) {
      const session = await parseOneSessionBucket(parent, list, main);
      if (session) out.push(session);
    } else {
      // Solo title-*.jsonl child or stray file. Treat each *.jsonl as its own session.
      for (const f of list.filter((x) => x.name.endsWith('.jsonl'))) {
        const text = await f.text();
        const events = parseEventsFromText(text);
        if (events.length === 0) continue;
        out.push(
          parseSession({
            events,
            rootDirName: f.name.replace(/\.jsonl$/i, ''),
            rootPath: f.absPath,
            fileSizesBytes: { main: f.size, total: f.size },
          })
        );
      }
    }
  }

  // Also produce ParsedSessions for child *.jsonl files inside a bucket: title-*.jsonl
  // (chat-title generation) and runSubagent-*.jsonl (subagent runs) are known conventions;
  // anything else a parent explicitly named via child_session_ref is picked up too, so a
  // future subagent naming convention doesn't silently fail to load.
  const extras: ParsedSession[] = [];
  for (const [, list] of buckets) {
    const children = list.filter(
      (f) =>
        f.name !== 'main.jsonl' &&
        f.name.endsWith('.jsonl') &&
        (/^(title|runSubagent)-.*\.jsonl$/i.test(f.name) ||
          out.some((s) => s.childSessionRefs.some((r) => r.childLogFile.endsWith(f.name))))
    );
    for (const t of children) {
      const text = await t.text();
      const events = parseEventsFromText(text);
      if (events.length === 0) continue;
      const parentSession = out.find((s) => s.childSessionRefs.some((r) => r.childLogFile.endsWith(t.name)));
      extras.push(
        parseSession({
          events,
          rootDirName: t.name.replace(/\.jsonl$/i, ''),
          rootPath: t.absPath,
          fileSizesBytes: { main: t.size, total: t.size },
          parent: parentSession ? { sessionId: parentSession.id, label: 'child' } : undefined,
        })
      );
    }
  }

  // Dedupe by id, prefer the version with more events (richest data).
  const dedup = new Map<string, ParsedSession>();
  for (const s of [...out, ...extras]) {
    const existing = dedup.get(s.id);
    if (!existing || s.events.length > existing.events.length) {
      dedup.set(s.id, s);
    }
  }

  // Inject AI-generated titles from chatSessions files.
  for (const s of dedup.values()) {
    const title = titleMap.get(s.id);
    if (title) s.title = title;
  }

  return Array.from(dedup.values()).sort((a, b) => b.startedAt - a.startedAt);
}

async function parseOneSessionBucket(
  parentRel: string,
  list: RecoveredFile[],
  main: RecoveredFile
): Promise<ParsedSession | null> {
  const mainText = await main.text();
  const events: RawEvent[] = parseEventsFromText(mainText);
  if (events.length === 0) return null;

  const systemPromptFiles: Record<string, string> = {};
  const toolsFiles: Record<string, string> = {};
  let modelsCatalog: SessionModelInfo[] | undefined;
  let totalSize = main.size;

  for (const f of list) {
    if (f === main) continue;
    totalSize += f.size;
    if (/^system_prompt_\d+\.json$/i.test(f.name)) {
      systemPromptFiles[f.name] = await f.text();
    } else if (/^tools_\d+\.json$/i.test(f.name)) {
      toolsFiles[f.name] = await f.text();
    } else if (f.name === 'models.json') {
      try {
        modelsCatalog = JSON.parse(await f.text()) as SessionModelInfo[];
      } catch {
        // ignore
      }
    }
  }

  const rootDirName = parentRel.split(/[\\/]/).pop() || parentRel || 'session';
  const rootPath = main.absPath ? main.absPath.replace(/[\\/]main\.jsonl$/i, '') : undefined;

  return parseSession({
    events,
    rootDirName,
    rootPath,
    fileSizesBytes: { main: main.size, total: totalSize },
    systemPromptFiles,
    toolsFiles,
    modelsCatalog,
  });
}
