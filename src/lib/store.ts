import { create } from 'zustand';
import type { ParsedSession } from './types';
import { db, listStoredSessions, upsertSession, deleteStoredSession, clearAll } from './db';

const WORKSPACE_NAMES_KEY = 'cue.workspaceNames.v1';
const REDACT_KEY = 'cue.redact.v1';
const SIZE_WARN_KEY = 'cue.sizeWarnMb.v1';

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

interface AppState {
  sessions: Record<string, ParsedSession>;
  selectedSessionId: string | null;
  workspaceNames: Record<string, string>; // hash -> friendly name
  redact: boolean;
  sizeWarnMb: number;
  loading: boolean;
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

function thisMonthStart(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export const useAppStore = create<AppState>((set, get) => ({
  sessions: {},
  selectedSessionId: null,
  workspaceNames: {},
  redact: false,
  sizeWarnMb: 50,
  loading: true,
  error: null,
  dateRangeStart: thisMonthStart(),
  dateRangeEnd: null,
  dateRangeLabel: 'This Month',

  init: async () => {
    try {
      const workspaceNames = loadJson<Record<string, string>>(WORKSPACE_NAMES_KEY, {});
      const redact = loadJson<boolean>(REDACT_KEY, false);
      const sizeWarnMb = loadJson<number>(SIZE_WARN_KEY, 50);

      // Load cached sessions from IndexedDB
      const stored = await listStoredSessions();
      const sessions: Record<string, ParsedSession> = {};
      for (const s of stored) sessions[s.id] = s.payload;

      set({ workspaceNames, redact, sizeWarnMb, sessions, loading: false });
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
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
    await upsertSession(s);
  },

  removeSession: async (id) => {
    const next = { ...get().sessions };
    delete next[id];
    set({ sessions: next, selectedSessionId: get().selectedSessionId === id ? null : get().selectedSessionId });
    await deleteStoredSession(id);
  },

  clearSessions: async () => {
    set({ sessions: {}, selectedSessionId: null });
    await clearAll();
  },

  selectSession: (id) => set({ selectedSessionId: id }),

  setWorkspaceName: (hash, name) => {
    const next = { ...get().workspaceNames, [hash]: name };
    if (!name.trim()) delete next[hash];
    localStorage.setItem(WORKSPACE_NAMES_KEY, JSON.stringify(next));
    set({ workspaceNames: next });
  },

  setRedact: (v) => {
    localStorage.setItem(REDACT_KEY, JSON.stringify(v));
    set({ redact: v });
  },

  setSizeWarnMb: (n) => {
    localStorage.setItem(SIZE_WARN_KEY, JSON.stringify(n));
    set({ sizeWarnMb: n });
  },

  setDateRange: (start, end, label) => set({ dateRangeStart: start, dateRangeEnd: end, dateRangeLabel: label }),
}));

// Re-export DB ref for tooling.
export { db };
