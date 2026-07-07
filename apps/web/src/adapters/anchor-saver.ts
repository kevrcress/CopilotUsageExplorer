import type { FileSaver } from '@cue/ui';

/** Browser FileSaver: object-URL + anchor click download. */
export function createAnchorFileSaver(): FileSaver {
  return {
    async save(name: string, content: string | Uint8Array, mime: string): Promise<void> {
      const blob = new Blob([content as BlobPart], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  };
}
