import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { ParsedSession } from '@cue/core';
import type { HostAdapters } from './host';

const WORKSPACE_NAMES_KEY = 'cue.workspaceNames.v1';
const REDACT_KEY = 'cue.redact.v1';
const SIZE_WARN_KEY = 'cue.sizeWarnMb.v1';

export interface AppState {
  sessions: Record<string, ParsedSession>;
  selectedSessionId: string | null;
  workspaceNames: Record<string, string>; // hash -> friendly name
  redact: boolean;
  sizeWarnMb: number;
  loading: boolean;
  loadingProgress: { sessions: number; bytes: number } | null;
  error: string | null;
  dateRangeStart: number | null; // inclusive lower bound (ms since epoch), null = no lower bound
  dateRangeEnd: number | null;   // inclusive upper bound (ms since epoch), null = now
  dateRangeLabel: string;        // human-readable label for the active preset

  init: () => Promise<void>;
  addSession: (s: ParsedSession) => Promise<void>;
  removeSession: (id: string) => Promise<void>;
  clearSessions: () => Promise<void>;
  selectSession: (id: string | null) => void;
  setWorkspaceName: (hash: string, name: string) => void;
  setRedact: (v: boolean) => void;
  setSizeWarnMb: (n: number) => void;
  setDateRange: (start: number | null, end: number | null, label: string) => void;
}

export type AppStore = UseBoundStore<StoreApi<AppState>>;

function thisMonthStart(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

/** Build the zustand store against host adapters. Session persistence goes
 *  through SessionCache, preferences through PrefsStore. */
export function createAppStore({ cache, prefs }: Pick<HostAdapters, 'cache' | 'prefs'>): AppStore {
  return create<AppState>((set, get) => ({
    sessions: {},
    selectedSessionId: null,
    workspaceNames: {},
    redact: false,
    sizeWarnMb: 50,
    loading: true,
    loadingProgress: null,
    error: null,
    dateRangeStart: thisMonthStart(),
    dateRangeEnd: null,
    dateRangeLabel: 'This Month',

    init: async () => {
      try {
        const workspaceNames = prefs.get<Record<string, string>>(WORKSPACE_NAMES_KEY) ?? {};
        const redact = prefs.get<boolean>(REDACT_KEY) ?? false;
        const sizeWarnMb = prefs.get<number>(SIZE_WARN_KEY) ?? 50;

        // Load cached sessions from the host's durable cache. onProgress is a
        // no-op for hosts that don't stream (Dexie/web, electron); those
        // resolve directly and loadingProgress stays null throughout.
        const stored = await cache.list((p) => set({ loadingProgress: p }));
        const sessions: Record<string, ParsedSession> = {};
        for (const s of stored) sessions[s.id] = s;

        set({ workspaceNames, redact, sizeWarnMb, sessions, loading: false, loadingProgress: null });
      } catch (e) {
        set({ error: (e as Error).message, loading: false, loadingProgress: null });
      }
    },

    addSession: async (s) => {
      // Merge: only overwrite an existing cached session if the new one has more events.
      // This preserves historical sessions whose log files have been deleted by VS Code.
      const existing = get().sessions[s.id];
      if (existing && existing.events.length >= s.events.length) {
        return; // keep the richer cached version
      }
      set((state) => ({ sessions: { ...state.sessions, [s.id]: s } }));
      await cache.upsert(s);
    },

    removeSession: async (id) => {
      const next = { ...get().sessions };
      delete next[id];
      set({ sessions: next, selectedSessionId: get().selectedSessionId === id ? null : get().selectedSessionId });
      await cache.delete(id);
    },

    clearSessions: async () => {
      set({ sessions: {}, selectedSessionId: null });
      await cache.clear();
    },

    selectSession: (id) => set({ selectedSessionId: id }),

    setWorkspaceName: (hash, name) => {
      const next = { ...get().workspaceNames, [hash]: name };
      if (!name.trim()) delete next[hash];
      prefs.set(WORKSPACE_NAMES_KEY, next);
      set({ workspaceNames: next });
    },

    setRedact: (v) => {
      prefs.set(REDACT_KEY, v);
      set({ redact: v });
    },

    setSizeWarnMb: (n) => {
      prefs.set(SIZE_WARN_KEY, n);
      set({ sizeWarnMb: n });
    },

    setDateRange: (start, end, label) => set({ dateRangeStart: start, dateRangeEnd: end, dateRangeLabel: label }),
  }));
}

// ---------------------------------------------------------------------------
// Module-level singleton. Each app calls initAppStore(adapters) once before
// render; components keep the existing `useAppStore` import style.
// ---------------------------------------------------------------------------

let appStore: AppStore | null = null;
let hostAdapters: HostAdapters | null = null;

export function initAppStore(host: HostAdapters): AppStore {
  hostAdapters = host;
  appStore = createAppStore(host);
  return appStore;
}

/** The full adapter bundle for components that need saver/ingest directly. */
export function getHost(): HostAdapters {
  if (!hostAdapters) throw new Error('initAppStore(adapters) must be called before getHost()');
  return hostAdapters;
}

function requireStore(): AppStore {
  if (!appStore) throw new Error('initAppStore(adapters) must be called before useAppStore()');
  return appStore;
}

function useAppStoreImpl(): AppState;
function useAppStoreImpl<T>(selector: (s: AppState) => T): T;
function useAppStoreImpl<T>(selector?: (s: AppState) => T): T | AppState {
  const store = requireStore();
  return selector ? store(selector) : store();
}

export const useAppStore = Object.assign(useAppStoreImpl, {
  getState: (): AppState => requireStore().getState(),
});
