import { parseSession, parseEventsFromText } from './parser';
import type { ParsedSession, RawEvent, SessionModelInfo } from './types';

/** A file we recovered from a folder pick / drag-drop. We carry the relative path
 *  so we can group sibling files (system_prompt_N.json, models.json, child JSONLs)
 *  under their parent session folder.
 */
interface RecoveredFile {
  /** Full path-like string used for grouping, e.g. "debug-logs/<sid>/main.jsonl" */
  relPath: string;
  name: string;
  /** Best-effort absolute path (from webkitdirectory File.path on Electron, or null). */
  absPath?: string;
  size: number;
  /** Lazy text loader. */
  text: () => Promise<string>;
  /** For browser File objects: the raw Blob, used for efficient head reads (slice). */
  rawBlob?: Blob;
}

function fileFromBlob(name: string, relPath: string, file: File): RecoveredFile {
  // VS Code/Electron environments expose .path on File; standard browsers do not.
  const maybePath = (file as unknown as { path?: unknown }).path;
  return {
    relPath,
    name,
    absPath: typeof maybePath === 'string' ? maybePath : undefined,
    size: file.size,
    text: () => file.text(),
    rawBlob: file,
  };
}

/** Fallback ingest using the standard <input type="file" webkitdirectory> picker. */
export async function ingestFromFileList(files: FileList | File[]): Promise<ParsedSession[]> {
  const arr = Array.from(files).filter((f) => {
    if (!isRelevantFile(f.name)) return false;
    // Also skip files in directories we know produce conflicting data
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || '';
    const parts = rel.replace(/\\/g, '/').split('/');
    return !parts.some(p => SKIP_DIRS.has(p));
  });
  const recovered: RecoveredFile[] = arr.map((f) => {
    // webkitRelativePath is set when using webkitdirectory
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    return fileFromBlob(f.name, rel, f);
  });
  return await groupAndParse(recovered);
}

/** Names we never need to descend into when walking a workspaceStorage-like tree.
 *  Keeps recursive picks (“point at workspaceStorage”) reasonably fast.
 */
const SKIP_DIRS = new Set([
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
function isRelevantFile(name: string): boolean {
  if (name === 'main.jsonl' || name === 'models.json') return true;
  if (/^system_prompt_\d+\.json$/i.test(name)) return true;
  if (/^tools_\d+\.json$/i.test(name)) return true;
  if (/\.jsonl$/i.test(name)) return true; // child title-*.jsonl
  return false;
}

export interface IngestProgress {
  filesScanned: number;
  relevantFilesFound: number;
  bytesRead: number;
  currentPath?: string;
}

export type IngestProgressCallback = (p: IngestProgress) => void;

/** Recursive ingest from the FS Access API directory handle. */
export async function ingestFromDirectoryHandle(
  dir: FileSystemDirectoryHandle,
  basePath = '',
  onProgress?: IngestProgressCallback
): Promise<ParsedSession[]> {
  const recovered: RecoveredFile[] = [];
  const progress: IngestProgress = { filesScanned: 0, relevantFilesFound: 0, bytesRead: 0 };
  await collectFromHandle(dir, basePath, recovered, progress, onProgress);
  onProgress?.(progress);
  return groupAndParse(recovered);
}

async function collectFromHandle(
  dir: FileSystemDirectoryHandle,
  basePath: string,
  out: RecoveredFile[],
  progress: IngestProgress,
  onProgress?: IngestProgressCallback
): Promise<void> {
  // for-await-of over directory entries
  // @ts-expect-error: .entries() typing differs across DOM lib versions
  for await (const [name, handle] of dir.entries()) {
    const rel = basePath ? `${basePath}/${name}` : name;
    if (handle.kind === 'file') {
      progress.filesScanned += 1;
      if (!isRelevantFile(name)) continue;
      const f = await (handle as FileSystemFileHandle).getFile();
      progress.relevantFilesFound += 1;
      progress.bytesRead += f.size;
      progress.currentPath = rel;
      if (progress.relevantFilesFound % 25 === 0) onProgress?.(progress);
      out.push({
        relPath: rel,
        name,
        size: f.size,
        text: () => f.text(),
        rawBlob: f,
      });
    } else if (handle.kind === 'directory') {
      if (SKIP_DIRS.has(name)) continue;
      await collectFromHandle(handle as FileSystemDirectoryHandle, rel, out, progress, onProgress);
    }
  }
}

/** Walk a DataTransferItemList from a drag event using webkitGetAsEntry (broad support). */
export async function ingestFromDataTransfer(items: DataTransferItemList): Promise<ParsedSession[]> {
  const recovered: RecoveredFile[] = [];
  const entries: FileSystemEntry[] = [];
  for (let i = 0; i < items.length; i++) {
    const e = items[i].webkitGetAsEntry?.();
    if (e) entries.push(e);
  }
  for (const e of entries) await walkEntry(e, '', recovered);
  return groupAndParse(recovered);
}

function walkEntry(entry: FileSystemEntry, basePath: string, out: RecoveredFile[]): Promise<void> {
  const rel = basePath ? `${basePath}/${entry.name}` : entry.name;
  if (entry.isFile) {
    if (!isRelevantFile(entry.name)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      (entry as FileSystemFileEntry).file(
        (file) => {
          out.push({
            relPath: rel,
            name: entry.name,
            size: file.size,
            text: () => file.text(),
            rawBlob: file,
          });
          resolve();
        },
        (err) => reject(err)
      );
    });
  }
  if (entry.isDirectory) {
    if (SKIP_DIRS.has(entry.name)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const all: FileSystemEntry[] = [];
      const readBatch = () => {
        reader.readEntries(
          async (batch) => {
            if (batch.length === 0) {
              for (const c of all) await walkEntry(c, rel, out);
              resolve();
            } else {
              all.push(...batch);
              readBatch();
            }
          },
          (err) => reject(err)
        );
      };
      readBatch();
    });
  }
  return Promise.resolve();
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
async function groupAndParse(files: RecoveredFile[]): Promise<ParsedSession[]> {
  // Separate chatSessions title files from debug-log files.
  const chatFiles = files.filter(isChatSessionFile);
  const debugFiles = files.filter((f) => !isChatSessionFile(f));

  // Extract AI-generated titles — only read the first 2 KB of each file (title is in line 1–4).
  const titleMap = new Map<string, string>();
  for (const f of chatFiles) {
    const chunk = f.rawBlob
      ? await f.rawBlob.slice(0, 2048).text()
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
