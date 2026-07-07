import { groupAndParse } from '@cue/core';
import type { RecoveredFile } from '@cue/core';
import { getHost, useAppStore } from '@cue/ui';

/** Headless ingest controller. App mounts the ingest panel inside a closed-by-
 *  default dialog, so auto-discovery and live tail must run independently of
 *  the panel's lifecycle: main.tsx calls startAutoIngest() once after render,
 *  and IngestPanel subscribes to this state for display + manual actions. */

export interface IngestState {
  busy: boolean;
  watching: boolean;
  log: string[];
}

// Snapshots are replaced immutably so useSyncExternalStore sees changes.
let state: IngestState = { busy: false, watching: false, log: [] };
const listeners = new Set<() => void>();
let disposeWatch: (() => void) | null = null;

function update(patch: Partial<IngestState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function append(s: string): void {
  update({ log: [s, ...state.log].slice(0, 100) });
}

export function getIngestState(): IngestState {
  return state;
}

export function subscribeIngest(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function ingestBuckets(buckets: RecoveredFile[][], origin: string): Promise<void> {
  const files = buckets.flat();
  if (files.length === 0) return;
  const sessions = await groupAndParse(files);
  const { addSession } = useAppStore.getState();
  const before = Object.keys(useAppStore.getState().sessions).length;
  for (const s of sessions) await addSession(s);
  const added = Object.keys(useAppStore.getState().sessions).length - before;
  if (origin === 'watch' && added === 0) return; // quiet no-op tail ticks
  append(`${origin}: ${sessions.length} session(s) scanned, ${added} new.`);
}

/** Adopt friendly workspace names from each install's workspace.json files
 *  without clobbering names the user has customized. */
async function adoptWorkspaceNames() {
  const installs = await window.cue.listVSCodeInstalls();
  const { workspaceNames, setWorkspaceName } = useAppStore.getState();
  for (const install of installs) {
    for (const [hash, name] of Object.entries(install.workspaceNames)) {
      if (!workspaceNames[hash]) setWorkspaceName(hash, name);
    }
  }
  return installs;
}

export async function discover(): Promise<void> {
  if (state.busy) return;
  update({ busy: true });
  try {
    const installs = await adoptWorkspaceNames();
    if (installs.length === 0) {
      append('No VS Code / Insiders / VSCodium / Cursor install with Copilot debug logs found. Use "Pick folder…".');
      return;
    }
    append(`Found: ${installs.map((i) => `${i.product} (${i.sessionCount} session folders)`).join(', ')}. Scanning…`);
    const buckets = await getHost().ingest.autoDiscover?.();
    if (buckets) await ingestBuckets(buckets, 'scan');
  } catch (e) {
    append(`Error: ${(e as Error).message}`);
  } finally {
    update({ busy: false });
  }
}

export function startWatch(): void {
  const watch = getHost().ingest.watch;
  if (!watch || disposeWatch) return;
  disposeWatch = watch((buckets) => {
    // Unlike discover()/pickFolder(), this callback isn't awaited by a
    // caller that can catch — a bad mid-write JSONL during a live-tail tick
    // would otherwise be an unhandled rejection with no user-visible trace.
    ingestBuckets(buckets, 'watch').catch((e) => {
      append(`Error: ${(e as Error).message}`);
    });
  });
  update({ watching: true });
  append('Live-tail on: new Copilot activity is picked up automatically.');
}

export function stopWatch(): void {
  disposeWatch?.();
  disposeWatch = null;
  update({ watching: false });
  append('Live-tail stopped.');
}

export async function pickFolder(): Promise<void> {
  if (state.busy) return;
  update({ busy: true });
  try {
    const buckets = await getHost().ingest.pickAndIngest?.();
    if (buckets && buckets.length > 0) await ingestBuckets(buckets, 'folder');
    else append('No Copilot log files found in that folder.');
  } catch (e) {
    append(`Error: ${(e as Error).message}`);
  } finally {
    update({ busy: false });
  }
}

/** One-shot bootstrap: full scan, then live tail. Called from main.tsx. */
export function startAutoIngest(): void {
  void discover().then(() => startWatch());
}
