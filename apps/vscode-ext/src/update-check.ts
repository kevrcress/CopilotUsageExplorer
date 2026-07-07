import * as vscode from 'vscode';
import type { Logger } from './logger';
import { compareVersions } from './version-compare';

/** Sideload distribution: no Marketplace, so we version-check GitHub Releases
 *  on activation (details doc §7). Public repo — unauthenticated API. */
const REPO_OWNER = 'kevrcress';
const REPO_NAME = 'CopilotUsageExplorer';
const RELEASES_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
const TIMEOUT_MS = 3000;

/** Non-blocking update check: fetch the latest release tag, notify with a link
 *  when it's newer than the installed extension. 3s timeout; every failure
 *  path (offline, rate-limited, no releases yet) is swallowed silently —
 *  never bother the user — but logged to the output channel for diagnostics. */
export async function checkForUpdate(context: vscode.ExtensionContext, log: Logger): Promise<void> {
  try {
    const current = (context.extension.packageJSON as { version?: string }).version;
    if (!current) return;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let latest: string | undefined;
    try {
      const res = await fetch(RELEASES_API, {
        signal: controller.signal,
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) return;
      const body = (await res.json()) as { tag_name?: string };
      latest = body.tag_name?.replace(/^v/i, '');
    } finally {
      clearTimeout(timer);
    }
    if (!latest || compareVersions(latest, current) <= 0) return;

    const action = await vscode.window.showInformationMessage(
      `Copilot Usage Explorer ${latest} is available (you have ${current}).`,
      'Download .vsix'
    );
    if (action === 'Download .vsix') {
      void vscode.env.openExternal(vscode.Uri.parse(RELEASES_PAGE));
    }
  } catch (e) {
    // Offline / aborted / malformed response — never bother the user, but
    // keep a diagnostic trail for "why didn't I get an update notification".
    log.warn(`Update check failed (this is expected when offline or before any release exists)${formatCatch(e)}`);
  }
}

function formatCatch(e: unknown): string {
  return e instanceof Error ? `: ${e.message}` : '';
}
