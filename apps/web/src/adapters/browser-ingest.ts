import { groupAndParse, isRelevantFile, SKIP_DIRS } from '@cue/core';
import type { ParsedSession, RecoveredFile } from '@cue/core';
import type { IngestSource } from '@cue/ui';

function fileFromBlob(name: string, relPath: string, file: File): RecoveredFile {
  // VS Code/Electron environments expose .path on File; standard browsers do not.
  const maybePath = (file as unknown as { path?: unknown }).path;
  return {
    relPath,
    name,
    absPath: typeof maybePath === 'string' ? maybePath : undefined,
    size: file.size,
    text: () => file.text(),
    readHead: (bytes: number) => file.slice(0, bytes).text(),
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
      out.push(fileFromBlob(name, rel, f));
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
          out.push(fileFromBlob(entry.name, rel, file));
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

/** Browser IngestSource. The browser host drives ingest through its own UI
 *  (drag-drop / file input in Ingest.tsx), so only capabilities are declared
 *  here; the optional pick/discover/watch methods stay unimplemented. */
export function createBrowserIngestSource(): IngestSource {
  return {
    capabilities: () => ({ pickFolder: false, autoDiscover: false, watch: false, dropFiles: true }),
  };
}
