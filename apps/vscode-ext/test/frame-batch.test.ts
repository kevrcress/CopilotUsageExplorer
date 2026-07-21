import { describe, it, expect } from 'vitest';
import { batchBySize, streamBatches } from '../src/frame-batch';

describe('batchBySize', () => {
  it('packs items into frames whose total size stays under the cap', () => {
    // Six items of size 40 with a cap of 100: 2 fit per frame (80 <= 100),
    // a third would push to 120 > 100, so it rolls to the next frame.
    const items = [1, 2, 3, 4, 5, 6];
    const frames = batchBySize(items, () => 40, 100);

    expect(frames).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
    for (const frame of frames) {
      const total = frame.reduce((a, _t) => a + 40, 0);
      expect(total).toBeLessThanOrEqual(100);
    }
  });

  it('ships an oversized single item alone in its own frame', () => {
    const items = ['small', 'huge', 'small2'];
    const sizeOf = (s: string) => (s === 'huge' ? 500 : 10);
    const frames = batchBySize(items, sizeOf, 100);

    // 'small' (10) starts a frame; 'huge' (500) alone can't fit alongside it
    // (10 + 500 > 100) so it flushes 'small' first, then ships 'huge' solo.
    expect(frames).toEqual([['small'], ['huge'], ['small2']]);
  });

  it('always emits at least one (empty) frame for empty input', () => {
    const frames = batchBySize<number>([], () => 1, 100);
    expect(frames).toEqual([[]]);
  });

  it('fills a frame right up to the cap boundary', () => {
    // Three items of size 50 with cap 100: first two exactly hit 100, so the
    // third must roll to a new frame rather than exceeding the cap.
    const frames = batchBySize([1, 2, 3], () => 50, 100);
    expect(frames).toEqual([[1, 2], [3]]);
  });
});

describe('streamBatches', () => {
  async function* gen<T>(items: T[]): AsyncGenerator<T> {
    for (const item of items) yield item;
  }

  it('emits frames incrementally as the async source fills them, with a final done:true', async () => {
    const received: Array<{ frame: number[]; done: boolean; bytes: number }> = [];
    await streamBatches(gen([1, 2, 3, 4, 5, 6]), () => 40, 100, (frame, done, bytes) => {
      received.push({ frame: [...frame], done, bytes });
    });

    expect(received).toEqual([
      { frame: [1, 2], done: false, bytes: 80 },
      { frame: [3, 4], done: false, bytes: 80 },
      { frame: [5, 6], done: true, bytes: 80 },
    ]);
  });

  it('emits exactly one empty done frame for an empty source', async () => {
    const received: Array<{ frame: number[]; done: boolean }> = [];
    await streamBatches(gen<number>([]), () => 1, 100, (frame, done) => {
      received.push({ frame: [...frame], done });
    });

    expect(received).toEqual([{ frame: [], done: true }]);
  });
});
