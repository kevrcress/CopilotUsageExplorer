import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { WebviewToExtMessage } from '../../src/protocol';

/** bridge.ts acquires its VS Code API singleton at module load time via a
 *  global `acquireVsCodeApi()` (declared `declare function acquireVsCodeApi`)
 *  and listens on the global `window` — neither exists in the vitest `node`
 *  environment. Each test stubs both globals and then dynamically imports a
 *  fresh copy of the module (vi.resetModules) so the module-level `const
 *  vscode = acquireVsCodeApi()` picks up that test's mock postMessage and the
 *  message listener attaches to that test's fake window. No production code
 *  was changed to make this possible. */

type MessageHandler = (event: { data: unknown }) => void;

function installFakeHost(): { postMessage: ReturnType<typeof vi.fn>; getHandler: () => MessageHandler } {
  const postMessage = vi.fn<(msg: WebviewToExtMessage) => void>();
  let handler: MessageHandler | undefined;

  (globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({
    postMessage,
    getState: () => undefined,
    setState: () => undefined,
  });
  (globalThis as Record<string, unknown>).window = {
    addEventListener: (type: string, cb: MessageHandler) => {
      if (type === 'message') handler = cb;
    },
  };

  return {
    postMessage,
    getHandler: () => {
      if (!handler) throw new Error('message handler was never registered');
      return handler;
    },
  };
}

async function loadBridge() {
  vi.resetModules();
  const host = installFakeHost();
  const mod = await import('../../webview/bridge');
  return { ...host, createBridge: mod.createBridge };
}

function lastRequestId(postMessage: ReturnType<typeof vi.fn>): number {
  const call = postMessage.mock.calls.at(-1);
  return (call?.[0] as { requestId: number }).requestId;
}

describe('bridge cacheOp chunk reassembly', () => {
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as Record<string, unknown>).acquireVsCodeApi;
    delete (globalThis as Record<string, unknown>).window;
  });

  it('resolves list with the concatenated array across in-order multi-frame chunks', async () => {
    const { postMessage, getHandler, createBridge } = await loadBridge();
    const bridge = createBridge();

    const promise = bridge.cacheOp('list');
    const requestId = lastRequestId(postMessage);
    const handler = getHandler();

    handler({ data: { type: 'cacheResultChunk', requestId, items: ['a', 'b'], done: false, bytes: 100 } });
    handler({ data: { type: 'cacheResultChunk', requestId, items: ['c'], done: true, bytes: 50 } });

    await expect(promise).resolves.toEqual(['a', 'b', 'c']);
  });

  it('resolves list with its items when the whole reply arrives in a single frame', async () => {
    const { postMessage, getHandler, createBridge } = await loadBridge();
    const bridge = createBridge();

    const promise = bridge.cacheOp('list');
    const requestId = lastRequestId(postMessage);
    getHandler()({ data: { type: 'cacheResultChunk', requestId, items: ['only'], done: true, bytes: 10 } });

    await expect(promise).resolves.toEqual(['only']);
  });

  it('resolves list with an empty array for an empty cache (single empty done frame)', async () => {
    const { postMessage, getHandler, createBridge } = await loadBridge();
    const bridge = createBridge();

    const promise = bridge.cacheOp('list');
    const requestId = lastRequestId(postMessage);
    getHandler()({ data: { type: 'cacheResultChunk', requestId, items: [], done: true, bytes: 0 } });

    await expect(promise).resolves.toEqual([]);
  });

  it('resolves export with the joined string across segments', async () => {
    const { postMessage, getHandler, createBridge } = await loadBridge();
    const bridge = createBridge();

    const promise = bridge.cacheOp('export');
    const requestId = lastRequestId(postMessage);
    const handler = getHandler();

    handler({ data: { type: 'cacheResultChunk', requestId, items: ['{"a":1', '}'], done: false, bytes: 8 } });
    handler({ data: { type: 'cacheResultChunk', requestId, items: [''], done: true, bytes: 0 } });

    await expect(promise).resolves.toBe('{"a":1}');
  });

  it('reports cumulative sessions/bytes to the onProgress callback per chunk', async () => {
    const { postMessage, getHandler, createBridge } = await loadBridge();
    const bridge = createBridge();
    const progress: Array<{ sessions: number; bytes: number }> = [];

    const promise = bridge.cacheOp('list', undefined, (p) => progress.push({ ...p }));
    const requestId = lastRequestId(postMessage);
    const handler = getHandler();

    handler({ data: { type: 'cacheResultChunk', requestId, items: ['a', 'b'], done: false, bytes: 100 } });
    handler({ data: { type: 'cacheResultChunk', requestId, items: ['c'], done: false, bytes: 40 } });
    handler({ data: { type: 'cacheResultChunk', requestId, items: ['d'], done: true, bytes: 10 } });

    await promise;

    expect(progress).toEqual([
      { sessions: 2, bytes: 100 },
      { sessions: 3, bytes: 140 },
      { sessions: 4, bytes: 150 },
    ]);
  });

  it('rejects with a stall error if the inactivity timeout fires before a done frame arrives', async () => {
    vi.useFakeTimers();
    const { postMessage, getHandler, createBridge } = await loadBridge();
    const bridge = createBridge();

    const promise = bridge.cacheOp('list');
    const requestId = lastRequestId(postMessage);
    const handler = getHandler();

    // A chunk arrives (progress), but the terminal done:true frame never does.
    handler({ data: { type: 'cacheResultChunk', requestId, items: ['a'], done: false, bytes: 10 } });

    const assertion = expect(promise).rejects.toThrow(/stalled: no reply frame for 60s/);
    await vi.advanceTimersByTimeAsync(60_001);
    await assertion;
  });

  it('does not false-trip the timeout when chunks keep arriving within the window', async () => {
    vi.useFakeTimers();
    const { postMessage, getHandler, createBridge } = await loadBridge();
    const bridge = createBridge();

    const promise = bridge.cacheOp('list');
    const requestId = lastRequestId(postMessage);
    const handler = getHandler();

    // Three chunks, each well inside the 60s inactivity window, then done.
    handler({ data: { type: 'cacheResultChunk', requestId, items: ['a'], done: false, bytes: 10 } });
    await vi.advanceTimersByTimeAsync(30_000);
    handler({ data: { type: 'cacheResultChunk', requestId, items: ['b'], done: false, bytes: 10 } });
    await vi.advanceTimersByTimeAsync(30_000);
    handler({ data: { type: 'cacheResultChunk', requestId, items: ['c'], done: true, bytes: 10 } });

    await expect(promise).resolves.toEqual(['a', 'b', 'c']);
  });
});
