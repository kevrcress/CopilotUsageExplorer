import type { RecoveredFile } from '@cue/core';
import type { IngestSource } from '@cue/ui';
import type { SerializedFile } from '../../../shared/protocol';

/** Wrap a fully-read SerializedFile from the main process as a RecoveredFile. */
export function toRecoveredFile(f: SerializedFile): RecoveredFile {
  return {
    relPath: f.relPath,
    name: f.name,
    absPath: f.absPath,
    size: f.size,
    text: async () => f.text,
    readHead: async (bytes: number) => f.text.slice(0, bytes),
  };
}

export function toRecoveredBuckets(buckets: SerializedFile[][]): RecoveredFile[][] {
  return buckets.map((b) => b.map(toRecoveredFile));
}

/** Electron IngestSource: auto-discovery, live tail, and native folder pick,
 *  all over the window.cue preload API. Drag-drop is handled by the browser
 *  flow and intentionally disabled here. */
export function createElectronIngestSource(): IngestSource {
  return {
    capabilities: () => ({ pickFolder: true, autoDiscover: true, watch: true, dropFiles: false }),

    async autoDiscover(): Promise<RecoveredFile[][]> {
      const installs = await window.cue.listVSCodeInstalls();
      const buckets: RecoveredFile[][] = [];
      for (const install of installs) {
        buckets.push(...toRecoveredBuckets(await window.cue.discoverSessions(install.id)));
      }
      return buckets;
    },

    async pickAndIngest(): Promise<RecoveredFile[][]> {
      return toRecoveredBuckets(await window.cue.pickFolderAndRead());
    },

    watch(onSessions: (files: RecoveredFile[][]) => void): () => void {
      let disposed = false;
      void (async () => {
        const installs = await window.cue.listVSCodeInstalls();
        if (disposed) return;
        for (const install of installs) {
          await window.cue.watchSessions(install.id, (buckets) => {
            if (!disposed) onSessions(toRecoveredBuckets(buckets));
          });
        }
      })();
      return () => {
        disposed = true;
        void window.cue.unwatch();
      };
    },
  };
}
