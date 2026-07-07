import React from 'react';
import ReactDOM from 'react-dom/client';
import { groupAndParse, type RecoveredFile } from '@cue/core';
import { App, initAppStore, type AppStore, type SessionCache } from '@cue/ui';
import { createBridge, readBoot } from './bridge';
import { createGlobalStorageCache, createMessageFileSaver, createMessageIngestSource, createMessagePrefs } from './adapters';
import { Ingest } from './Ingest';
import './index.css';

const boot = readBoot();
const bridge = createBridge();

// The `indexeddb` cache backend is opt-in (globalStorage is the default) —
// dynamic-import it so Vite code-splits dexie into its own chunk instead of
// bundling it into every webview load (PR review IV-D01).
async function createCache(): Promise<SessionCache> {
  if (boot.cacheBackend === 'indexeddb') {
    const { createDexieSessionCache } = await import('@cue/ui/adapters/dexie-cache');
    return createDexieSessionCache();
  }
  return createGlobalStorageCache(bridge);
}

// ---------------------------------------------------------------------------
// Single ingester: every session bucket from the extension (discover, pick,
// watch) flows through here. Buckets are queued until store.init() finishes,
// because init() replaces the sessions map wholesale from the cache.
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const store: AppStore = initAppStore({
    cache: await createCache(),
    prefs: createMessagePrefs(bridge, boot.prefs),
    saver: createMessageFileSaver(bridge),
    ingest: createMessageIngestSource(bridge),
  });

  let storeReady = !store.getState().loading;
  const pendingBuckets: RecoveredFile[][] = [];
  const pendingNames: Record<string, string> = {};

  async function ingestBuckets(buckets: RecoveredFile[][]): Promise<void> {
    const { addSession } = store.getState();
    for (const bucket of buckets) {
      try {
        const sessions = await groupAndParse(bucket);
        for (const s of sessions) await addSession(s);
      } catch {
        // one bad session folder must not sink the rest
      }
    }
  }

  /** Apply workspace.json friendly names without clobbering user-set names. */
  function applyNames(names: Record<string, string>): void {
    const state = store.getState();
    for (const [hash, name] of Object.entries(names)) {
      if (!state.workspaceNames[hash]) state.setWorkspaceName(hash, name);
    }
  }

  bridge.onSessions((e) => {
    if (storeReady) void ingestBuckets(e.buckets);
    else pendingBuckets.push(...e.buckets);
  });
  bridge.onWorkspaceNames((names) => {
    if (storeReady) applyNames(names);
    else Object.assign(pendingNames, names);
  });

  const unsubscribe = store.subscribe((state) => {
    if (state.loading || storeReady) return;
    storeReady = true;
    unsubscribe();
    applyNames(pendingNames);
    void ingestBuckets(pendingBuckets.splice(0));
    // Live tail on by default — new sessions stream in as Copilot writes them.
    bridge.setWatch(true);
  });

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App ingest={<Ingest bridge={bridge} />} />
    </React.StrictMode>
  );

  // App.init() runs on mount; the extension answers `ready` with auto-discovery.
  bridge.ready();
}

void main();
