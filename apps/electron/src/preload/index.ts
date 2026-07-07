import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { CueChannels } from '../shared/protocol';
import type { BucketRef, CueApi, SerializedFile } from '../shared/protocol';

// One shared push channel; every watchSessions callback receives every update.
const updateCallbacks = new Set<(buckets: SerializedFile[][]) => void>();
let listenerAttached = false;

function onSessionsUpdate(_e: IpcRendererEvent, buckets: SerializedFile[][]): void {
  for (const cb of updateCallbacks) cb(buckets);
}

const api: CueApi = {
  listVSCodeInstalls: () => ipcRenderer.invoke(CueChannels.listInstalls),

  // Chunked: one IPC message per session bucket (a full corpus can be
  // hundreds of MB — too large for a single structured-clone payload).
  async discoverSessions(installId) {
    const refs: BucketRef[] = await ipcRenderer.invoke(CueChannels.listBuckets, installId);
    const buckets: SerializedFile[][] = [];
    for (const ref of refs) {
      const bucket: SerializedFile[] = await ipcRenderer.invoke(CueChannels.readBucket, installId, ref);
      if (bucket.length) buckets.push(bucket);
    }
    return buckets;
  },

  async watchSessions(installId, cb) {
    updateCallbacks.add(cb);
    if (!listenerAttached) {
      ipcRenderer.on(CueChannels.sessionsUpdate, onSessionsUpdate);
      listenerAttached = true;
    }
    await ipcRenderer.invoke(CueChannels.watchSessions, installId);
  },

  async unwatch() {
    updateCallbacks.clear();
    if (listenerAttached) {
      ipcRenderer.removeListener(CueChannels.sessionsUpdate, onSessionsUpdate);
      listenerAttached = false;
    }
    await ipcRenderer.invoke(CueChannels.unwatchSessions);
  },

  saveFile: (name, mime, content) => ipcRenderer.invoke(CueChannels.saveFile, name, mime, content),

  pickFolderAndRead: () => ipcRenderer.invoke(CueChannels.pickFolderAndRead),
};

contextBridge.exposeInMainWorld('cue', api);
