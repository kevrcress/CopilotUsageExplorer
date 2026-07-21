/** Pure, testable frame-batching for cacheResultChunk streaming (details doc
 *  §3). Mirrors sendChunked's semantics (extension.ts): items are packed into
 *  frames whose serialized size stays under `cap`, an item alone larger than
 *  `cap` still ships whole in its own frame, and an empty input always
 *  produces exactly one (empty) frame so callers keyed on a terminal frame
 *  still get one. */
export function batchBySize<T>(items: T[], sizeOf: (t: T) => number, cap: number): T[][] {
  const frames: T[][] = [];
  let frame: T[] = [];
  let frameBytes = 0;
  for (const item of items) {
    const size = sizeOf(item);
    if (frameBytes + size > cap && frame.length > 0) {
      frames.push(frame);
      frame = [];
      frameBytes = 0;
    }
    frame.push(item);
    frameBytes += size;
  }
  if (frame.length > 0 || frames.length === 0) frames.push(frame);
  return frames;
}

/** Streaming twin of `batchBySize`: consumes an async source (e.g. a
 *  file-by-file generator) and invokes `onFrame` as soon as a frame fills,
 *  rather than waiting for the whole source to be read first. This is what
 *  keeps postMessage frames flowing during a long disk read, so the
 *  webview's inactivity timeout (bridge.ts CACHE_OP_TIMEOUT_MS) sees
 *  continuous progress instead of one long silence followed by a giant
 *  frame. Thin wrapper around `batchBySize`: re-batches the small pending
 *  buffer on every item so the same greedy rule governs both. */
export async function streamBatches<T>(
  source: AsyncIterable<T>,
  sizeOf: (t: T) => number,
  cap: number,
  onFrame: (frame: T[], done: boolean, bytes: number) => Promise<void> | void
): Promise<void> {
  const emit = async (frame: T[], done: boolean): Promise<void> => {
    const bytes = frame.reduce((a, t) => a + sizeOf(t), 0);
    await onFrame(frame, done, bytes);
  };

  let buffer: T[] = [];
  for await (const item of source) {
    buffer.push(item);
    const frames = batchBySize(buffer, sizeOf, cap);
    if (frames.length > 1) {
      for (let i = 0; i < frames.length - 1; i++) await emit(frames[i], false);
      buffer = frames[frames.length - 1];
    }
  }
  const finalFrames = batchBySize(buffer, sizeOf, cap);
  for (let i = 0; i < finalFrames.length; i++) {
    await emit(finalFrames[i], i === finalFrames.length - 1);
  }
}
