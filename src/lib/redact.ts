/** Lightweight redaction helpers for sharing exports without leaking source code,
 *  secrets, or absolute paths.
 */

const PATH_RE = /([A-Za-z]:[\\/])?(?:[\w.-]+[\\/])+[\w.-]+/g;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

export function redactString(s: string): string {
  if (!s) return s;
  return s
    .replace(EMAIL_RE, '[email]')
    .replace(PATH_RE, '[path]');
}

export function redactBody(_body: unknown): string {
  return '[redacted]';
}

/** Hash a string with FNV-1a (32-bit) for friendly path tokens like `path:9d3f1c20`. */
export function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function redactPathHashed(p: string): string {
  return `path:${shortHash(p)}`;
}
