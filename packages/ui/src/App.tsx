import { useEffect, useState, type ReactNode } from 'react';
import { LayoutDashboard, FolderOpen, Lightbulb, Settings as SettingsIcon, ShieldCheck, Upload } from 'lucide-react';
import { useAppStore } from './store';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './components/ui/dialog';
import { Dashboard } from './components/Dashboard';
import { SessionList } from './components/SessionList';
import { SessionDetail } from './components/SessionDetail';
import { Optimize } from './components/Optimize';
import { SettingsPanel } from './components/Settings';
import { Button } from './components/ui/button';

/** The shared app shell. `ingest` is the host-specific ingest panel (browser
 *  drag-drop/file picker in apps/web; message-driven panels elsewhere). */
export default function App({ ingest }: { ingest: ReactNode }) {
  const { init, loading, loadingProgress, error, sessions, selectedSessionId, selectSession, redact, setRedact } = useAppStore();
  const [tab, setTab] = useState('dashboard');
  const [ingestOpen, setIngestOpen] = useState(false);

  useEffect(() => {
    init();
  }, [init]);

  // Count only valid sessions (non-zero timestamps)
  const sessionCount = Object.values(sessions).filter(s =>
    s.startedAt > new Date('2020-01-01').getTime()
  ).length;

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        {loadingProgress
          ? `Loading cached sessions… ${loadingProgress.sessions} session${loadingProgress.sessions === 1 ? '' : 's'} · ${(loadingProgress.bytes / 1048576).toFixed(1)} MB`
          : 'Loading…'}
      </div>
    );
  }
  if (error) {
    return <div className="flex h-screen items-center justify-center text-destructive">Error: {error}</div>;
  }

  const loadButton = (
    <Button size="sm" onClick={() => setIngestOpen(true)} title="Load or refresh Copilot debug logs">
      <Upload className="h-4 w-4" />
      Load logs
    </Button>
  );

  const emptyPrompt = (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm text-muted-foreground">No sessions loaded yet.</p>
      {loadButton}
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="text-lg" aria-hidden>🧮</span>
          <div>
            <h1 className="text-base font-semibold leading-tight">Copilot Usage Explorer</h1>
            <p className="text-[11px] text-muted-foreground leading-tight">Local debug-log viewer · {sessionCount} session{sessionCount === 1 ? '' : 's'} loaded</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {loadButton}
          <Button
            size="sm"
            variant={redact ? 'default' : 'outline'}
            onClick={() => setRedact(!redact)}
            title="Toggle redaction in exports and detail views"
          >
            <ShieldCheck className="h-4 w-4" />
            {redact ? 'Redact: on' : 'Redact: off'}
          </Button>
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b px-4 py-2">
          <TabsList>
            <TabsTrigger value="dashboard"><LayoutDashboard className="mr-1 h-4 w-4" />Dashboard</TabsTrigger>
            <TabsTrigger value="sessions"><FolderOpen className="mr-1 h-4 w-4" />Sessions</TabsTrigger>
            <TabsTrigger value="optimize"><Lightbulb className="mr-1 h-4 w-4" />Optimize</TabsTrigger>
            <TabsTrigger value="settings"><SettingsIcon className="mr-1 h-4 w-4" />Settings</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="dashboard" className="flex-1 overflow-auto p-4">
          <Dashboard totalLoaded={sessionCount} onNavigate={setTab} onLoadClick={() => setIngestOpen(true)} />
        </TabsContent>

        <TabsContent value="sessions" className="flex-1 overflow-hidden p-4">
          {sessionCount === 0 ? (
            emptyPrompt
          ) : selectedSessionId && sessions[selectedSessionId] ? (
            <SessionDetail session={sessions[selectedSessionId]} onBack={() => selectSession(null)} />
          ) : (
            <SessionList />
          )}
        </TabsContent>

        <TabsContent value="optimize" className="flex-1 overflow-auto p-4">
          {sessionCount === 0 ? emptyPrompt : <Optimize />}
        </TabsContent>

        <TabsContent value="settings" className="flex-1 overflow-auto p-4">
          <SettingsPanel />
        </TabsContent>
      </Tabs>

      <Dialog open={ingestOpen} onOpenChange={setIngestOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Load Copilot debug logs</DialogTitle>
          </DialogHeader>
          {ingest}
        </DialogContent>
      </Dialog>
    </div>
  );
}
