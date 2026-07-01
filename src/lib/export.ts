import type { ParsedSession } from './types';
import { rollupSession, computeAiCredits } from './tokens';
import { redactBody, redactPathHashed, redactString } from './redact';

function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '';
  const cols = Array.from(
    rows.reduce<Set<string>>((acc, r) => {
      Object.keys(r).forEach((k) => acc.add(k));
      return acc;
    }, new Set())
  );
  const header = cols.join(',');
  const body = rows.map((r) => cols.map((c) => csvEscape(r[c])).join(',')).join('\n');
  return `${header}\n${body}\n`;
}

export function downloadFile(name: string, content: string | Blob, mime = 'text/plain;charset=utf-8'): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportSessionListCsv(
  sessions: ParsedSession[],
  workspaceNames: Record<string, string>,
  redact = false
): string {
  const rows = sessions.map((s) => {
    const r = rollupSession(s);
    const wsName = s.workspaceHash ? workspaceNames[s.workspaceHash] : undefined;
    return {
      sessionId: s.id,
      startedAt: new Date(s.startedAt).toISOString(),
      durationMs: s.durationMs,
      copilotVersion: s.copilotVersion,
      vscodeVersion: s.vscodeVersion,
      workspaceHash: redact ? (s.workspaceHash ? redactPathHashed(s.workspaceHash) : '') : s.workspaceHash ?? '',
      workspaceName: wsName ?? '',
      turns: s.turns.length,
      llmCalls: r.llmCalls,
      inputTokens: r.totalInputTokens,
      outputTokens: r.totalOutputTokens,
      aiCredits: computeAiCredits(s) ?? '',
      models: r.byModel.map((m) => `${m.model}×${m.calls}`).join('; '),
      errors: r.errorCount,
    };
  });
  return toCsv(rows);
}

export function exportSessionJson(s: ParsedSession, redact = false): string {
  if (!redact) return JSON.stringify(s, null, 2);

  const clone: ParsedSession = JSON.parse(JSON.stringify(s));
  if (clone.workspacePath) clone.workspacePath = redactPathHashed(clone.workspacePath);
  for (const ev of clone.events) {
    if (ev.attrs && typeof ev.attrs === 'object') {
      for (const k of Object.keys(ev.attrs)) {
        const v = (ev.attrs as Record<string, unknown>)[k];
        if (typeof v === 'string') {
          (ev.attrs as Record<string, unknown>)[k] = redactString(v);
        } else if (k === 'userRequest' || k === 'inputMessages' || k === 'response' || k === 'reasoning' || k === 'content' || k === 'args' || k === 'result') {
          (ev.attrs as Record<string, unknown>)[k] = redactBody(v);
        }
      }
    }
  }
  for (const k of Object.keys(clone.systemPromptFiles)) clone.systemPromptFiles[k] = '[redacted]';
  for (const k of Object.keys(clone.toolsFiles)) clone.toolsFiles[k] = '[redacted]';
  return JSON.stringify(clone, null, 2);
}

/** A self-contained HTML report for one session. Useful for sharing. */
export function exportSessionHtml(
  s: ParsedSession,
  workspaceNames: Record<string, string>,
  redact = false
): string {
  const r = rollupSession(s);
  const wsName = s.workspaceHash ? workspaceNames[s.workspaceHash] : undefined;
  const esc = (x: unknown) =>
    String(x ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  const turnRows = s.turns
    .map(
      (t) =>
        `<tr><td>${esc(t.turnId)}</td><td>${new Date(t.startTs).toISOString()}</td><td>${
          t.durationMs ?? ''
        }</td><td>${esc(t.status)}</td><td>${esc(redact ? '[redacted]' : (t.userMessageContent ?? '').slice(0, 200))}</td></tr>`
    )
    .join('');
  const modelRows = r.byModel
    .map(
      (m) =>
        `<tr><td>${esc(m.model)}</td><td>${m.calls}</td><td>${m.inputTokens}</td><td>${m.outputTokens}</td></tr>`
    )
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>Copilot session ${esc(s.id)}</title>
<style>
body{font-family:system-ui,Segoe UI,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#0f172a;background:#fff}
h1,h2{margin:.5rem 0}
table{width:100%;border-collapse:collapse;margin:.5rem 0 1.5rem}
th,td{border:1px solid #e2e8f0;padding:.4rem .6rem;text-align:left;vertical-align:top;font-size:13px}
th{background:#f8fafc}
small{color:#64748b}
.kv{display:grid;grid-template-columns:max-content 1fr;gap:.25rem 1rem}
.warn{padding:.5rem .75rem;border:1px solid #fde68a;background:#fffbeb;border-radius:6px;font-size:13px;margin:.5rem 0 1rem}
</style></head><body>
<h1>Copilot Chat session report</h1>
<div class="warn">Token figures below are taken straight from the debug log.${redact ? ' &mdash; <strong>redacted export</strong>.' : ''}</div>
<div class="kv">
  <div>Session ID</div><div>${esc(redact ? redactPathHashed(s.id) : s.id)}</div>
  <div>Started</div><div>${new Date(s.startedAt).toISOString()}</div>
  <div>Duration</div><div>${(s.durationMs / 1000).toFixed(1)}s</div>
  <div>Workspace</div><div>${esc(wsName ?? (redact && s.workspaceHash ? redactPathHashed(s.workspaceHash) : s.workspaceHash ?? '—'))}</div>
  <div>Copilot</div><div>${esc(s.copilotVersion ?? '—')}</div>
  <div>VS Code</div><div>${esc(s.vscodeVersion ?? '—')}</div>
  <div>Turns</div><div>${s.turns.length}</div>
  <div>LLM calls</div><div>${r.llmCalls}</div>
  <div>Tool calls</div><div>${s.toolCalls.length}</div>
  <div>Total tokens</div><div>${r.totalInputTokens.toLocaleString()} in / ${r.totalOutputTokens.toLocaleString()} out</div>
  <div>Errors</div><div>${r.errorCount}</div>
</div>
<h2>By model</h2>
<table><thead><tr><th>Model</th><th>Calls</th><th>Input</th><th>Output</th></tr></thead><tbody>${modelRows}</tbody></table>
<h2>Turns</h2>
<table><thead><tr><th>Turn</th><th>Started</th><th>ms</th><th>Status</th><th>User message</th></tr></thead><tbody>${turnRows}</tbody></table>
<p><small>Generated by Copilot Usage Explorer. Local export &mdash; never uploaded.</small></p>
</body></html>`;
}
