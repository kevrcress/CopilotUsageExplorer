import { app } from 'electron';
import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Minimal file logger for the main process. Both host apps' entire purpose is
// reading an undocumented, vendor-unstable filesystem layout (VS Code's
// Copilot Chat debug logs) — when discovery silently finds nothing on a
// teammate's machine, this is the diagnostic trail to ask them to send us.
//
// Hand-rolled instead of pulling in electron-log: apps/electron's only
// runtime dependency today is electron-updater (everything else is dev
// tooling), and a timestamped-line file appender is ~20 lines of Node. See
// changes log DD-601 for the full rationale.
// ---------------------------------------------------------------------------

let stream: WriteStream | undefined;
let logPath: string | undefined;
let initPromise: Promise<void> | undefined;

function targetPath(): string {
  return path.join(app.getPath('logs'), 'main.log');
}

async function ensureStream(): Promise<void> {
  if (stream) return;
  logPath = targetPath();
  await mkdir(path.dirname(logPath), { recursive: true });
  stream = createWriteStream(logPath, { flags: 'a' });
}

function write(level: 'INFO' | 'WARN' | 'ERROR', msg: string, err?: unknown): void {
  const line = `${new Date().toISOString()} [${level}] ${msg}${formatErr(err)}\n`;
  // Fire-and-forget: logging must never block or throw into caller code.
  initPromise = (initPromise ?? Promise.resolve())
    .then(ensureStream)
    .then(() => {
      stream?.write(line);
    })
    .catch(() => {
      /* logging is best-effort; a failed write must not crash the app */
    });
  // Mirror to the console too, useful in `electron-vite dev`.
  const consoleFn = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
  consoleFn(line.trimEnd());
}

function formatErr(err?: unknown): string {
  if (err === undefined) return '';
  if (err instanceof Error) return ` — ${err.message}${err.stack ? `\n${err.stack}` : ''}`;
  return ` — ${String(err)}`;
}

export const log = {
  info(msg: string): void {
    write('INFO', msg);
  },
  warn(msg: string): void {
    write('WARN', msg);
  },
  error(msg: string, err?: unknown): void {
    write('ERROR', msg, err);
  },
  /** Path the logger writes to, for surfacing in diagnostics/UI later. */
  path(): string {
    return logPath ?? targetPath();
  },
};
