import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CueChannels } from '../shared/protocol';
import type { SerializedFile } from '../shared/protocol';
import type { BucketRef } from '../shared/protocol';
import {
  isValidInstallId,
  listBucketRefs,
  listVSCodeInstalls,
  readBucket,
  readFolderRecursive,
  startWatch,
  stopAllWatches,
} from './discovery';
import { log } from './logger';

// ---------------------------------------------------------------------------
// Custom app:// scheme for the production renderer. Serving from a stable
// custom origin (instead of file://) pins the IndexedDB origin so the Dexie
// session cache survives app updates.
// ---------------------------------------------------------------------------

const APP_SCHEME = 'app';
const APP_HOST = 'bundle';

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

function registerAppProtocol(): void {
  const rendererRoot = path.resolve(__dirname, '../renderer');
  protocol.handle(APP_SCHEME, async (request) => {
    const { pathname } = new URL(request.url);
    const rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
    const target = path.resolve(rendererRoot, rel);
    if (target !== rendererRoot && !target.startsWith(rendererRoot + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }
    try {
      await fsp.access(target);
      return await net.fetch(pathToFileURL(target).toString());
    } catch {
      // SPA fallback: unknown paths serve index.html.
      return net.fetch(pathToFileURL(path.join(rendererRoot, 'index.html')).toString());
    }
  });
}

// ---------------------------------------------------------------------------
// IPC surface (see src/shared/protocol.ts). Kept narrow: the renderer never
// touches Node APIs directly.
// ---------------------------------------------------------------------------

function registerIpcHandlers(): void {
  ipcMain.handle(CueChannels.listInstalls, () => listVSCodeInstalls());

  ipcMain.handle(CueChannels.listBuckets, (_e, installId: string) => {
    // Full allowlist + segment validation lives in discovery.ts; this is a
    // cheap early short-circuit so an invalid installId never even calls in.
    if (!isValidInstallId(installId)) return [];
    return listBucketRefs(installId);
  });

  ipcMain.handle(CueChannels.readBucket, (_e, installId: string, ref: BucketRef) => {
    if (!isValidInstallId(installId)) return [];
    return readBucket(installId, ref);
  });

  ipcMain.handle(CueChannels.watchSessions, async (e, installId: string) => {
    if (!isValidInstallId(installId)) return;
    const contents = e.sender;
    await startWatch(installId, (buckets: SerializedFile[][]) => {
      if (!contents.isDestroyed()) contents.send(CueChannels.sessionsUpdate, buckets);
    });
  });

  ipcMain.handle(CueChannels.unwatchSessions, () => {
    stopAllWatches();
  });

  ipcMain.handle(
    CueChannels.saveFile,
    async (e, name: string, _mime: string, content: string | Uint8Array): Promise<boolean> => {
      const win = BrowserWindow.fromWebContents(e.sender);
      if (!win) return false;
      const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: name });
      if (canceled || !filePath) return false;
      await fsp.writeFile(filePath, typeof content === 'string' ? content : Buffer.from(content));
      return true;
    }
  );

  ipcMain.handle(CueChannels.pickFolderAndRead, async (e): Promise<SerializedFile[][]> => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return [];
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Pick a folder containing Copilot debug logs',
      properties: ['openDirectory'],
    });
    if (canceled || filePaths.length === 0) return [];
    return readFolderRecursive(filePaths[0]);
  });
}

// ---------------------------------------------------------------------------
// Window + lifecycle
// ---------------------------------------------------------------------------

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.on('ready-to-show', () => win.show());

  // External links open in the default browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadURL(`${APP_SCHEME}://${APP_HOST}/index.html`);
  }
}

function setupAutoUpdate(): void {
  // Windows-only: builds are unsigned and macOS auto-update requires code
  // signing. GitHub Releases is the publish provider (electron-builder.yml).
  if (!app.isPackaged || process.platform !== 'win32') return;
  autoUpdater.checkForUpdatesAndNotify().catch((e: unknown) => {
    // Offline or no releases yet — never block startup, but keep a trace.
    log.error('Auto-update check failed', e);
  });
}

void app.whenReady().then(() => {
  log.info(`App ready — version ${app.getVersion()}, platform ${process.platform} (${process.arch})`);
  registerAppProtocol();
  registerIpcHandlers();
  createWindow();
  setupAutoUpdate();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopAllWatches();
  if (process.platform !== 'darwin') app.quit();
});
