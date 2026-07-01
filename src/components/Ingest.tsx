import { useCallback, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAppStore } from '@/lib/store';
import {
  ingestFromDataTransfer,
  ingestFromDirectoryHandle,
  ingestFromFileList,
  type IngestProgress,
} from '@/lib/fs';
import { FolderOpen, Upload, RefreshCw } from 'lucide-react';
import { formatBytes } from '@/lib/utils';

export function Ingest({ variant }: { variant?: 'empty-state' }) {
  const { addSession, sizeWarnMb } = useAppStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<IngestProgress | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [tailing, setTailing] = useState<{ handle: FileSystemDirectoryHandle; lastSeenIds: Set<string> } | null>(null);

  const supportsFsAccess = typeof (window as any).showDirectoryPicker === 'function';

  const append = (s: string) => setLog((l) => [s, ...l].slice(0, 100));

  const isSystemFolderError = (e: unknown): boolean => {
    const msg = (e as Error)?.message?.toLowerCase() ?? '';
    return msg.includes('system files') || msg.includes('blocked') || (e as DOMException)?.name === 'SecurityError';
  };
  const guardSize = useCallback(
    (totalBytes: number): boolean => {
      const mb = totalBytes / (1024 * 1024);
      if (mb > sizeWarnMb) {
        return confirm(
          `These logs are ~${mb.toFixed(1)} MB, above your ${sizeWarnMb} MB warning threshold. Parsing happens entirely in your browser. Continue?`
        );
      }
      return true;
    },
    [sizeWarnMb]
  );

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files);
      const total = arr.reduce((a, f) => a + f.size, 0);
      if (!guardSize(total)) return;
      setBusy(true);
      try {
        const sessions = await ingestFromFileList(files);
        const beforeCount = Object.keys(useAppStore.getState().sessions).length;
        for (const s of sessions) await addSession(s);
        const afterCount = Object.keys(useAppStore.getState().sessions).length;
        const newSessions = afterCount - beforeCount;
        append(`Scanned ${sessions.length} session(s) from ${arr.length} files (${formatBytes(total)}). ${newSessions} new, ${sessions.length - newSessions} already cached.`);
      } catch (e) {
        append(`Error: ${(e as Error).message}`);
      } finally {
        setBusy(false);
      }
    },
    [addSession, guardSize]
  );

  const pickDirectoryFsAccess = useCallback(async () => {
    if (!supportsFsAccess) return;
    setBusy(true);
    setProgress({ filesScanned: 0, relevantFilesFound: 0, bytesRead: 0 });
    try {
      const handle: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker({ mode: 'read' });
      const sessions = await ingestFromDirectoryHandle(handle, '', (p) => setProgress({ ...p }));
      for (const s of sessions) await addSession(s);
      append(`Loaded ${sessions.length} session(s) from "${handle.name}".`);
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return;
      if (isSystemFolderError(e)) {
        append('Browser blocked that folder because it lives under a system path (e.g. %APPDATA%). Use "Upload files / folder" instead, or create a symlink under %USERPROFILE%.');
      } else {
        append(`Error: ${(e as Error).message}`);
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [addSession, supportsFsAccess]);

  const startLiveTail = useCallback(async () => {
    if (!supportsFsAccess) return;
    try {
      const handle: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker({ mode: 'read' });
      const seen = new Set<string>();
      setTailing({ handle, lastSeenIds: seen });
      append(`Live-tail enabled on "${handle.name}". Polling every 5s.`);
      const tick = async () => {
        try {
          const sessions = await ingestFromDirectoryHandle(handle);
          let newCount = 0;
          for (const s of sessions) {
            const key = `${s.id}:${s.events.length}`; // event count changes -> re-store
            if (!seen.has(key)) {
              await addSession(s);
              seen.add(key);
              newCount++;
            }
          }
          if (newCount > 0) append(`Live-tail: refreshed ${newCount} session(s).`);
        } catch (e) {
          append(`Live-tail error: ${(e as Error).message}`);
        }
      };
      const id = window.setInterval(tick, 5000);
      // Tag the interval on the tailing object so user can stop later (handled below by setTailing(null)).
      (handle as any).__cueIntervalId = id;
      tick();
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return;
      if (isSystemFolderError(e)) {
        append('Browser blocked that folder because it lives under a system path. Use "Upload files / folder" or symlink the folder under %USERPROFILE%.');
      } else {
        append(`Error: ${(e as Error).message}`);
      }
    }
  }, [addSession, supportsFsAccess]);

  const stopLiveTail = useCallback(() => {
    if (tailing) {
      const id = (tailing.handle as any).__cueIntervalId;
      if (typeof id === 'number') window.clearInterval(id);
      setTailing(null);
      append('Live-tail stopped.');
    }
  }, [tailing]);

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      if (!e.dataTransfer?.items?.length) return;
      setBusy(true);
      try {
        const sessions = await ingestFromDataTransfer(e.dataTransfer.items);
        for (const s of sessions) await addSession(s);
        append(`Loaded ${sessions.length} session(s) via drop.`);
      } catch (err) {
        append(`Error: ${(err as Error).message}`);
      } finally {
        setBusy(false);
      }
    },
    [addSession]
  );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <Card
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        className={variant === 'empty-state' ? 'border-dashed' : ''}
      >
        <CardHeader>
          <CardTitle>Load Copilot debug logs</CardTitle>
          <CardDescription>
            Pick the entire workspaceStorage/ folder to load every chat across every workspace at once.
            Everything is parsed locally in your browser — no uploads, no telemetry. Re-click the button to refresh and see new sessions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* === Instructions === */}
          <div className="rounded-md border bg-muted/30 p-3 text-xs">
            <p className="mb-2">
              <strong>Windows:</strong> Click the button below and navigate to{' '}
              <code className="rounded bg-muted px-1">%APPDATA%\Code\User\workspaceStorage\</code>
            </p>
            <p className="mb-2">
              <strong>Mac:</strong> <code className="rounded bg-muted px-1">~/Library/Application Support/Code/User/workspaceStorage/</code>
            </p>
            <p>
              <strong>Linux:</strong> <code className="rounded bg-muted px-1">~/.config/Code/User/workspaceStorage/</code>
            </p>
            <p className="mt-2 text-muted-foreground">
              Select the entire workspaceStorage folder — the app will recursively scan for all Copilot sessions.
              <strong> Re-click the button anytime to refresh</strong> with newly written sessions (like the chat you're having right now).
            </p>
          </div>

          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
            <strong className="text-amber-600">Important:</strong> VS Code <strong>auto-deletes debug log files</strong> after a few days.
            This app caches every session in your browser's IndexedDB, so once loaded, your history is preserved
            even after VS Code purges the files. <strong>Load frequently</strong> to capture sessions before they disappear.
            Previously-cached sessions are never overwritten by newer (smaller) versions.
          </div>

          <div
            className="rounded-md border-2 border-dashed border-muted-foreground/30 p-8 text-center text-sm text-muted-foreground"
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
          >
            Drop a folder or files here, or click below.
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => fileInputRef.current?.click()} disabled={busy} size="lg">
              <Upload className="h-4 w-4" />
              Upload files / folder
            </Button>
            {/* Hidden: Open folder / live-tail (blocked on Windows %APPDATA%) */}
            {false && supportsFsAccess && (
              <>
                <Button onClick={pickDirectoryFsAccess} disabled={busy}>
                  <FolderOpen className="h-4 w-4" />
                  Open folder…
                </Button>
                {tailing ? (
                  <Button variant="destructive" onClick={stopLiveTail}>
                    <RefreshCw className="h-4 w-4" />
                    Stop live-tail
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={startLiveTail} disabled={busy}>
                    <RefreshCw className="h-4 w-4" />
                    Start live-tail
                  </Button>
                )}
              </>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            // @ts-expect-error: webkitdirectory + directory not in standard DOM types
            webkitdirectory=""
            directory=""
            className="hidden"
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />

          {progress && (
            <div className="rounded border bg-muted/30 px-3 py-2 text-xs">
              Scanning… {progress.filesScanned} files seen, <strong>{progress.relevantFilesFound}</strong> Copilot log files matched
              ({formatBytes(progress.bytesRead)})
              {progress.currentPath && (
                <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{progress.currentPath}</div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {log.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {log.map((l, i) => (
                <li key={i} className="font-mono">{l}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
