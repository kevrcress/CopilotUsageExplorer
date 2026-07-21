import type { ParsedSession } from '@cue/core';
import type { FileSaver, IngestSource, PrefsStore, SessionCache } from '@cue/ui';
import type { Bridge } from './bridge';

/** PrefsStore hydrated synchronously from the boot snapshot (workspaceState
 *  keys injected into the HTML); writes go to memory and are mirrored to
 *  context.workspaceState via prefsSet messages (details doc §5). */
export function createMessagePrefs(bridge: Bridge, initial: Record<string, unknown>): PrefsStore {
  const mem = new Map<string, unknown>(Object.entries(initial));
  return {
    get<T>(key: string): T | undefined {
      return mem.get(key) as T | undefined;
    },
    set<T>(key: string, value: T): void {
      mem.set(key, value);
      bridge.prefsSet(key, value);
    },
  };
}

/** FileSaver: postMessage → extension showSaveDialog + workspace.fs.writeFile. */
export function createMessageFileSaver(bridge: Bridge): FileSaver {
  return {
    async save(name, content, mime) {
      const text = typeof content === 'string' ? content : new TextDecoder().decode(content);
      try {
        await bridge.save(name, mime, text);
      } catch (e) {
        if ((e as Error).message === 'cancelled') return; // user dismissed the dialog
        throw e;
      }
    },
  };
}

/** IngestSource: sessions arrive as extension messages. The single ingester
 *  in main.tsx subscribes to bridge.onSessions, so pick/discover here only
 *  trigger scans and report the bucket lists for logging. */
export function createMessageIngestSource(bridge: Bridge): IngestSource {
  return {
    capabilities: () => ({ pickFolder: true, autoDiscover: true, watch: true, dropFiles: false }),
    pickAndIngest: () => bridge.pickFolder(),
    autoDiscover: () => bridge.discover(),
    watch(onSessions) {
      const unsubscribe = bridge.onSessions((e) => {
        if (e.origin === 'watch') onSessions(e.buckets);
      });
      bridge.setWatch(true);
      return () => {
        unsubscribe();
        bridge.setWatch(false);
      };
    },
  };
}

/** SessionCache over the extension host's globalStorage file cache — the
 *  default backend: globalStorageUri durability is an API contract, unlike
 *  webview IndexedDB (Step 2.1 spike resolution, DD-201). */
export function createGlobalStorageCache(bridge: Bridge): SessionCache {
  return {
    async upsert(s: ParsedSession): Promise<void> {
      await bridge.cacheOp('upsert', { session: s });
    },
    async list(onProgress?: (p: { sessions: number; bytes: number }) => void): Promise<ParsedSession[]> {
      return ((await bridge.cacheOp('list', undefined, onProgress)) as ParsedSession[]) ?? [];
    },
    async get(id: string): Promise<ParsedSession | undefined> {
      return (await bridge.cacheOp('get', { id })) as ParsedSession | undefined;
    },
    async delete(id: string): Promise<void> {
      await bridge.cacheOp('delete', { id });
    },
    async clear(): Promise<void> {
      await bridge.cacheOp('clear');
    },
    async exportBackup(): Promise<string> {
      return (await bridge.cacheOp('export')) as string;
    },
    async importBackup(json: string): Promise<number> {
      return ((await bridge.cacheOp('import', { json })) as number) ?? 0;
    },
  };
}
