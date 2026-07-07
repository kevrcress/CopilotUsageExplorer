import { useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { useAppStore, getHost } from '../store';

export function SettingsPanel() {
  const { sizeWarnMb, setSizeWarnMb, workspaceNames, setWorkspaceName, sessions, clearSessions, init } = useAppStore();
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);

  const knownHashes = useMemo(() => {
    const set = new Set<string>();
    for (const s of Object.values(sessions)) if (s.workspaceHash) set.add(s.workspaceHash);
    return Array.from(set).sort();
  }, [sessions]);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Card className="border-amber-500/40">
        <CardHeader>
          <CardTitle className="text-sm">Privacy</CardTitle>
          <CardDescription>This app is 100% local. No telemetry. No network calls. Everything is parsed in your browser.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          <div className="flex items-center gap-2">
            <span>Warn when opening logs larger than</span>
            <Input
              type="number"
              className="w-24"
              value={sizeWarnMb}
              onChange={(e) => setSizeWarnMb(Number(e.target.value) || 0)}
            />
            <span>MB</span>
          </div>
          <Button size="sm" variant="destructive" onClick={() => confirm('Clear all cached sessions from IndexedDB?') && clearSessions()}>
            Clear all cached sessions
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Backup & Restore</CardTitle>
          <CardDescription>
            VS Code auto-deletes debug logs after a few days. This app caches sessions in IndexedDB, but that can be
            lost if browser data is cleared. Use backup to save a permanent local copy. Restore merges — it never overwrites
            richer existing data.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={async () => {
                const json = await getHost().cache.exportBackup();
                const date = new Date().toISOString().slice(0, 10);
                await getHost().saver.save(`copilot-sessions-backup-${date}.json`, json, 'application/json');
                setBackupMsg(`Exported ${Object.keys(sessions).length} sessions.`);
              }}
            >
              Export backup (JSON)
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => restoreInputRef.current?.click()}
            >
              Restore from backup
            </Button>
            <input
              ref={restoreInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const text = await file.text();
                  const imported = await getHost().cache.importBackup(text);
                  setBackupMsg(`Restored ${imported} sessions (already-cached sessions with equal or more data were skipped). Reload to see them.`);
                  // Reload sessions from DB
                  await init();
                } catch (err) {
                  setBackupMsg(`Restore failed: ${(err as Error).message}`);
                }
                e.target.value = '';
              }}
            />
          </div>
          {backupMsg && <p className="text-xs text-muted-foreground">{backupMsg}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Workspace name mapping</CardTitle>
          <CardDescription>Friendly names for the opaque <code>workspaceStorage/&lt;hash&gt;</code> folders.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {knownHashes.length === 0 && <p className="text-xs text-muted-foreground">No workspaces detected yet. Load some sessions first.</p>}
          {knownHashes.map((h) => (
            <div key={h} className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono">{h.slice(0, 12)}…</Badge>
              <Input
                placeholder="friendly name (e.g. CopilotUsageExplorer)"
                value={workspaceNames[h] ?? ''}
                onChange={(e) => setWorkspaceName(h, e.target.value)}
              />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
