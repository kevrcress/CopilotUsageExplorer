import { describe, it, expect, vi } from 'vitest';
import type { ParsedSession } from '@cue/core';
import { createGlobalStorageCache } from '../../webview/adapters';
import type { Bridge } from '../../webview/bridge';

/** The extension streams sessions in filesystem (readdir) order so frames keep
 *  flowing during a long disk read (src/file-cache.ts iterateSessions), which
 *  means the globalStorage adapter is where the SessionCache.list newest-first
 *  contract gets restored. These tests pin that, so the adapter can't silently
 *  drift from the Dexie adapter's index-ordered guarantee. */

function session(id: string, startedAt: number): ParsedSession {
  return { id, startedAt } as unknown as ParsedSession;
}

function stubBridge(listResult: unknown): Bridge {
  return {
    cacheOp: vi.fn(async () => listResult),
  } as unknown as Bridge;
}

describe('createGlobalStorageCache().list', () => {
  it('sorts newest-first regardless of the order frames arrived in', async () => {
    const wireOrder = [session('b', 2_000), session('c', 3_000), session('a', 1_000)];
    const cache = createGlobalStorageCache(stubBridge(wireOrder));

    const result = await cache.list();

    expect(result.map((s) => s.id)).toEqual(['c', 'b', 'a']);
  });

  it('keeps an already-sorted reply in newest-first order', async () => {
    const wireOrder = [session('c', 3_000), session('b', 2_000), session('a', 1_000)];
    const cache = createGlobalStorageCache(stubBridge(wireOrder));

    const result = await cache.list();

    expect(result.map((s) => s.id)).toEqual(['c', 'b', 'a']);
  });

  it('returns an empty array when the cache is empty', async () => {
    const cache = createGlobalStorageCache(stubBridge([]));
    await expect(cache.list()).resolves.toEqual([]);
  });

  it('returns an empty array when the reply is undefined', async () => {
    const cache = createGlobalStorageCache(stubBridge(undefined));
    await expect(cache.list()).resolves.toEqual([]);
  });

  it('forwards the onProgress callback through to cacheOp', async () => {
    const bridge = stubBridge([]);
    const cache = createGlobalStorageCache(bridge);
    const onProgress = vi.fn();

    await cache.list(onProgress);

    expect(bridge.cacheOp).toHaveBeenCalledWith('list', undefined, onProgress);
  });
});
