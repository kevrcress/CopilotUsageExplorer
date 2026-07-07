import { useCallback, useEffect, useState } from 'react';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, getHost } from '@cue/ui';
import { FolderOpen, RefreshCw, Search } from 'lucide-react';
import type { Bridge } from './bridge';

/** VS Code ingest panel. Unlike the browser host there's no drag-drop: the
 *  extension host reads the local disk, so this panel only triggers scans
 *  (auto-discovery / folder pick) and toggles the live tail. Session buckets
 *  land through the single ingester in main.tsx. */
export function Ingest({ bridge }: { bridge: Bridge }) {
  const [busy, setBusy] = useState(false);
  const [tailing, setTailing] = useState(bridge.watchEnabled());
  const [log, setLog] = useState<string[]>([]);

  const append = useCallback((s: string) => setLog((l) => [s, ...l].slice(0, 100)), []);

  useEffect(() => bridge.onStatus(append), [bridge, append]);
  // Keeps `tailing` in sync with bridge state changes made outside this
  // component (e.g. main.tsx's auto-enable after the cache finishes
  // loading), not just this component's own toggleTail clicks.
  useEffect(() => bridge.onWatchChange(setTailing), [bridge]);

  const rescan = useCallback(async () => {
    setBusy(true);
    try {
      const buckets = await getHost().ingest.autoDiscover!();
      append(`Auto-discovery returned ${buckets.length} session folder(s).`);
    } catch (e) {
      append(`Error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [append]);

  const pickFolder = useCallback(async () => {
    setBusy(true);
    try {
      const buckets = await getHost().ingest.pickAndIngest!();
      append(`Folder scan returned ${buckets.length} session folder(s).`);
    } catch (e) {
      append(`Error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [append]);

  const toggleTail = useCallback(() => {
    const next = !tailing;
    // setTailing is not called here directly — the onWatchChange subscription
    // above is the single place `tailing` gets updated, so this button and
    // main.tsx's auto-enable can never disagree about the current state.
    bridge.setWatch(next);
    append(next ? 'Live tail enabled.' : 'Live tail stopped.');
  }, [bridge, tailing, append]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Load Copilot debug logs</CardTitle>
          <CardDescription>
            Sessions are auto-discovered from this machine's VS Code workspaceStorage and parsed
            locally — no uploads, no telemetry. Rescan anytime to pick up new sessions, or keep
            live tail on to stream the chat you're having right now.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
            <strong className="text-amber-600">Important:</strong> VS Code <strong>auto-deletes debug log files</strong> after
            a few days. This extension caches every discovered session in its own storage, so once
            loaded, your history is preserved even after VS Code purges the files.
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={rescan} disabled={busy} size="lg">
              <Search className="h-4 w-4" />
              Rescan all workspaces
            </Button>
            <Button variant="secondary" onClick={pickFolder} disabled={busy}>
              <FolderOpen className="h-4 w-4" />
              Pick folder…
            </Button>
            <Button variant={tailing ? 'destructive' : 'secondary'} onClick={toggleTail}>
              <RefreshCw className="h-4 w-4" />
              {tailing ? 'Stop live tail' : 'Start live tail'}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            "Pick folder…" scans any folder (e.g. a copied <code className="rounded bg-muted px-1">workspaceStorage</code> from
            another machine) for Copilot debug logs.
          </p>
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
