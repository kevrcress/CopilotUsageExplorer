import type { FileSaver } from '@cue/ui';

/** FileSaver over the native save dialog (window.cue.saveFile -> main process). */
export function createCueFileSaver(): FileSaver {
  return {
    async save(name: string, content: string | Uint8Array, mime: string): Promise<void> {
      await window.cue.saveFile(name, mime, content);
    },
  };
}
