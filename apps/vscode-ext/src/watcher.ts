import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { DiscoveredWorkspace } from './discovery';
import type { Logger } from './logger';

const DEBOUNCE_MS = 2000;
const POLL_INTERVAL_MS = 5000;

const noopLogger: Logger = { info() {}, warn() {}, error() {} };

export interface SessionWatcher {
  dispose(): void;
}

/** Watch every discovered debug-logs dir for new/updated session folders.
 *  Primary: `fs.watch({ recursive: true })` (supported on macOS/Windows —
 *  remote dev is out of scope). Fallback per-dir: 5s stat-polling of session
 *  folder mtimes. Events are debounced 2s and coalesced per session folder;
 *  `onChanged(ws, sessionIds)` receives only the touched folders. */
export function watchWorkspaces(
  workspaces: DiscoveredWorkspace[],
  onChanged: (ws: DiscoveredWorkspace, sessionIds: string[]) => void,
  logger: Logger = noopLogger
): SessionWatcher {
  const disposers: Array<() => void> = [];

  for (const ws of workspaces) {
    // Pending session-folder names for this workspace, flushed on debounce.
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const flush = () => {
      timer = undefined;
      const ids = Array.from(pending);
      pending.clear();
      if (ids.length > 0) onChanged(ws, ids);
    };
    const queue = (sessionId: string) => {
      pending.add(sessionId);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, DEBOUNCE_MS);
    };

    try {
      const watcher = fsSync.watch(ws.debugLogsDir, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        // First path segment relative to debug-logs is the session folder.
        const first = filename.toString().split(/[\\/]/)[0];
        if (first) queue(first);
      });
      watcher.on('error', (err) => {
        // fs.watch died (e.g. dir deleted/recreated) — fall back to polling.
        try {
          watcher.close();
        } catch {
          /* already closed */
        }
        logger.warn(`live-tail: watcher for workspace "${ws.hash}" errored post-init (${errMessage(err)}) — falling back to polling`);
        startPolling(ws, queue, disposers);
      });
      disposers.push(() => {
        if (timer) clearTimeout(timer);
        try {
          watcher.close();
        } catch {
          /* already closed */
        }
      });
    } catch (err) {
      logger.warn(`live-tail: fs.watch unavailable for workspace "${ws.hash}" (${errMessage(err)}) — falling back to polling`);
      startPolling(ws, queue, disposers);
      disposers.push(() => {
        if (timer) clearTimeout(timer);
      });
    }
  }

  return {
    dispose() {
      for (const d of disposers.splice(0)) d();
    },
  };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Poll session-folder mtimes every 5s; queue folders whose mtime advanced. */
function startPolling(
  ws: DiscoveredWorkspace,
  queue: (sessionId: string) => void,
  disposers: Array<() => void>
): void {
  const lastMtimes = new Map<string, number>();
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const entries = await fs.readdir(ws.debugLogsDir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        try {
          // Session folders get their mtime bumped when files are added; also
          // stat main.jsonl since appends don't touch the dir mtime.
          const dirStat = await fs.stat(path.join(ws.debugLogsDir, e.name));
          const mainStat = await fs
            .stat(path.join(ws.debugLogsDir, e.name, 'main.jsonl'))
            .catch(() => undefined);
          const mtime = Math.max(dirStat.mtimeMs, mainStat?.mtimeMs ?? 0);
          const prev = lastMtimes.get(e.name);
          lastMtimes.set(e.name, mtime);
          if (prev !== undefined && mtime > prev) queue(e.name);
        } catch {
          // folder vanished mid-scan
        }
      }
    } catch {
      // debug-logs dir unreadable this tick — retry next tick
    }
  };

  void tick(); // prime baseline mtimes
  const interval = setInterval(tick, POLL_INTERVAL_MS);
  disposers.push(() => {
    stopped = true;
    clearInterval(interval);
  });
}
