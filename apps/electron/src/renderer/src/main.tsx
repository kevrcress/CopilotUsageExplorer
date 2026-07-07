import React from 'react';
import ReactDOM from 'react-dom/client';
import { App, initAppStore, createLocalStoragePrefs } from '@cue/ui';
import { createDexieSessionCache } from '@cue/ui/adapters/dexie-cache';
import { createCueFileSaver } from './adapters/cue-saver';
import { createElectronIngestSource } from './adapters/electron-ingest';
import { IngestPanel } from './IngestPanel';
import { startAutoIngest } from './ingest-controller';
import './index.css';

initAppStore({
  cache: createDexieSessionCache(),
  prefs: createLocalStoragePrefs(),
  saver: createCueFileSaver(),
  ingest: createElectronIngestSource(),
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App ingest={<IngestPanel />} />
  </React.StrictMode>
);

// The ingest panel lives in a closed-by-default dialog, so discovery + live
// tail bootstrap here instead of in a component mount effect.
startAutoIngest();
