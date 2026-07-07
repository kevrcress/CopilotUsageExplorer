import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Thin wrapper over a single OutputChannel, created once in extension.ts's
// activate() and reused by every other extension-host file. The extension's
// entire purpose is reading an undocumented, vendor-unstable filesystem
// layout — this channel is the diagnostic trail when discovery silently
// finds nothing on a teammate's machine (see "Copilot Usage Explorer" output
// channel: View > Output > Copilot Usage Explorer).
// ---------------------------------------------------------------------------

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string, err?: unknown): void;
}

function timestamp(): string {
  return new Date().toISOString();
}

function formatErr(err?: unknown): string {
  if (err === undefined) return '';
  if (err instanceof Error) return ` — ${err.message}`;
  return ` — ${String(err)}`;
}

export function createLogger(channel: vscode.OutputChannel): Logger {
  return {
    info(msg: string): void {
      channel.appendLine(`${timestamp()} [INFO] ${msg}`);
    },
    warn(msg: string): void {
      channel.appendLine(`${timestamp()} [WARN] ${msg}`);
    },
    error(msg: string, err?: unknown): void {
      channel.appendLine(`${timestamp()} [ERROR] ${msg}${formatErr(err)}`);
    },
  };
}
