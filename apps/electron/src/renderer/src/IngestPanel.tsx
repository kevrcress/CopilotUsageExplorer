import { useSyncExternalStore } from 'react';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@cue/ui';
import { FolderOpen, RefreshCw, Radio } from 'lucide-react';
import { discover, getIngestState, pickFolder, startWatch, stopWatch, subscribeIngest } from './ingest-controller';

/** Electron ingest panel: a view over ingest-controller.ts, which auto-scans
 *  every local VS Code-family install and live-tails debug logs. The controller
 *  runs from app startup (main.tsx); this panel shows status + manual actions. */
export function IngestPanel() {
  const { busy, watching, log } = useSyncExternalStore(subscribeIngest, getIngestState);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Copilot debug logs</CardTitle>
          <CardDescription>
            Sessions are auto-discovered from every local VS Code, Insiders, VSCodium, and Cursor install
            and cached locally — VS Code auto-deletes debug logs after a few days, but cached sessions survive.
            Everything stays on this machine.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void discover()} disabled={busy} size="lg">
              <RefreshCw className="h-4 w-4" />
              Rescan now
            </Button>
            <Button variant="secondary" onClick={() => void pickFolder()} disabled={busy}>
              <FolderOpen className="h-4 w-4" />
              Pick folder…
            </Button>
            {watching ? (
              <Button variant="destructive" onClick={stopWatch}>
                <Radio className="h-4 w-4" />
                Stop live-tail
              </Button>
            ) : (
              <Button variant="secondary" onClick={startWatch}>
                <Radio className="h-4 w-4" />
                Start live-tail
              </Button>
            )}
          </div>
          {log.length > 0 && (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {log.map((l, i) => (
                <li key={i} className="font-mono">
                  {l}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
