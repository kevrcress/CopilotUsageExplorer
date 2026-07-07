// Public API of @cue/ui — the shared React app plus the host adapter contracts.
// createDexieSessionCache is intentionally NOT re-exported here: import it
// from '@cue/ui/adapters/dexie-cache' directly. A static re-export from this
// barrel would pull `dexie` into every consumer's bundle (including hosts
// that default to a non-Dexie cache backend) regardless of whether the
// consumer's own code lazy-loads it (PR review IV-D01).
export * from './host';
export { createLocalStoragePrefs } from './adapters/localstorage-prefs';
export { createAppStore, initAppStore, getHost, useAppStore, type AppState, type AppStore } from './store';
export { useFilteredSessions } from './insights';
export { recommendationIcon } from './icons';
export * from './export';
export { cn } from './utils';
export { default as App } from './App';
// UI primitives, for host-specific panels (e.g. the browser ingest UI).
export * from './components/ui/badge';
export * from './components/ui/button';
export * from './components/ui/card';
export * from './components/ui/dialog';
export * from './components/ui/input';
export * from './components/ui/tabs';
