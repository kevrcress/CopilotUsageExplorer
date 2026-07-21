import { describe, it, expect } from 'vitest';
import type { ParsedSession } from '@cue/core';
import { createAppStore } from '../src/store';
import type { PrefsStore, SessionCache } from '../src/host';

/** SessionCache.list makes no ordering guarantee: the VS Code globalStorage
 *  adapter streams sessions in filesystem (readdir) order so it can post
 *  frames during the disk read instead of after it (apps/vscode-ext/src/
 *  file-cache.ts iterateSessions). These tests pin the property that makes
 *  that safe — init() keys results by id, so any order yields the same store
 *  state. If someone later makes init() order-sensitive, this fails. */

function session(id: string, startedAt: number): ParsedSession {
  // Only the fields init() actually touches need to be real; the rest of
  // ParsedSession is empty scaffolding for the cast.
  return {
    id,
    rootDirName: `dir-${id}`,
    startedAt,
    endedAt: startedAt + 1000,
    durationMs: 1000,
    events: [],
    llmCalls: [],
    turns: [],
    toolCalls: [],
    customizations: [],
    discoveries: [],
    childSessionRefs: [],
    errors: [],
    systemPromptFiles: {},
    toolsFiles: {},
  } as unknown as ParsedSession;
}

function stubPrefs(): PrefsStore {
  return { get: () => undefined, set: () => undefined };
}

function stubCache(listResult: ParsedSession[]): SessionCache {
  return {
    upsert: async () => undefined,
    list: async () => listResult,
    get: async () => undefined,
    delete: async () => undefined,
    clear: async () => undefined,
    exportBackup: async () => '',
    importBackup: async () => 0,
  };
}

describe('createAppStore init()', () => {
  const oldest = session('a', 1_000);
  const middle = session('b', 2_000);
  const newest = session('c', 3_000);

  it('produces identical state regardless of the order list() resolves in', async () => {
    const orders: ParsedSession[][] = [
      [newest, middle, oldest], // newest-first, the pre-streaming sort
      [oldest, middle, newest], // oldest-first
      [middle, newest, oldest], // arbitrary, e.g. readdir order
    ];

    const states = [];
    for (const order of orders) {
      const store = createAppStore({ cache: stubCache(order), prefs: stubPrefs() });
      await store.getState().init();
      states.push(store.getState().sessions);
    }

    for (const sessions of states) {
      expect(Object.keys(sessions).sort()).toEqual(['a', 'b', 'c']);
      expect(sessions.a).toBe(oldest);
      expect(sessions.b).toBe(middle);
      expect(sessions.c).toBe(newest);
    }
  });

  it('clears loading and loadingProgress once the cache resolves', async () => {
    const store = createAppStore({ cache: stubCache([newest]), prefs: stubPrefs() });
    await store.getState().init();

    const state = store.getState();
    expect(state.loading).toBe(false);
    expect(state.loadingProgress).toBeNull();
    expect(state.error).toBeNull();
  });

  it('surfaces a cache failure as error state rather than staying stuck loading', async () => {
    const failing: SessionCache = {
      ...stubCache([]),
      list: async () => {
        throw new Error('cache exploded');
      },
    };
    const store = createAppStore({ cache: failing, prefs: stubPrefs() });
    await store.getState().init();

    const state = store.getState();
    expect(state.error).toBe('cache exploded');
    expect(state.loading).toBe(false);
    expect(state.loadingProgress).toBeNull();
  });
});
