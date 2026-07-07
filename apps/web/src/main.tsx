import React from 'react';
import ReactDOM from 'react-dom/client';
import { App, initAppStore, createLocalStoragePrefs } from '@cue/ui';
import { createDexieSessionCache } from '@cue/ui/adapters/dexie-cache';
import { createAnchorFileSaver } from './adapters/anchor-saver';
import { createBrowserIngestSource } from './adapters/browser-ingest';
import { Ingest } from './Ingest';
import './index.css';

initAppStore({
  cache: createDexieSessionCache(),
  prefs: createLocalStoragePrefs(),
  saver: createAnchorFileSaver(),
  ingest: createBrowserIngestSource(),
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App ingest={<Ingest />} />
  </React.StrictMode>
);
