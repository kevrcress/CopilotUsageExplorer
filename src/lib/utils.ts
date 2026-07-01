import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { ParsedSession } from './types';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  return `${days}d ago`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

export function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * Returns the best human-readable label for a session:
 * 1. AI-generated title from chatSessions (if available)
 * 2. First user message, truncated to ~70 chars
 * 3. null (caller should show the raw session ID)
 */
export function getSessionDisplayTitle(session: ParsedSession): string | null {
  if (session.title) return session.title;
  const msg = session.turns.find((t) => t.userMessageContent)?.userMessageContent;
  if (msg) {
    const trimmed = msg.trim().replace(/\s+/g, ' ');
    return trimmed.length > 72 ? trimmed.slice(0, 69) + '…' : trimmed;
  }
  return null;
}
