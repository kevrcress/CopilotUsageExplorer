import type { CueApi } from '../../shared/protocol';

declare global {
  interface Window {
    /** Narrow IPC API exposed by src/preload/index.ts via contextBridge. */
    cue: CueApi;
  }
}

export {};
