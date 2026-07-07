import type { PrefsStore } from '../host';

/** localStorage-backed PrefsStore, shared by every host that has a `window.localStorage`
 *  (apps/web, apps/electron renderer, apps/vscode-ext webview). Values are JSON. */
export function createLocalStoragePrefs(): PrefsStore {
  return {
    get<T>(key: string): T | undefined {
      try {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : undefined;
      } catch {
        return undefined;
      }
    },
    set<T>(key: string, value: T): void {
      localStorage.setItem(key, JSON.stringify(value));
    },
  };
}
