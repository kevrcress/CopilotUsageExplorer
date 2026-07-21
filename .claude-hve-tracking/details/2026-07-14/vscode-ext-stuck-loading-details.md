# Implementation Details: vscode-ext-stuck-loading
Date: 2026-07-14
Plan: .claude-hve-tracking/plans/2026-07-14/vscode-ext-stuck-loading-plan.md

## 1. Failure data flow (current, broken)

```
webview App.init()
  └─ cache.list()                       adapters.ts:65
      └─ bridge.cacheOp('list')         bridge.ts:206   → pendingCache[reqId], NO timeout
          └─ postMessage {cacheOp,list}
              └─ ext onMessage           extension.ts:176
                  └─ handleCacheOp       file-cache.ts:91  reads ALL sessions/*.json
                  └─ post({cacheResult, data: <ENTIRE CACHE>})   extension.ts:179
                       └─ ONE frame, unbounded size; postMessage result discarded (extension.ts:153)
                            ✗ frame too large → never delivered → promise pends forever → "Loading…"
```

Contrast with the healthy path: session-log delivery batches under `MAX_MESSAGE_BYTES = 20 * 1024 * 1024` (protocol.ts:8) via `sendBuckets`/`sendChunked` (extension.ts:294-337).

## 2. New protocol message

```ts
// protocol.ts — ExtToWebviewMessage union, alongside cacheResult
| {
    type: 'cacheResultChunk';
    requestId: number;
    /** For op:'list' — ParsedSession payloads. For op:'export' — string segments. */
    items: unknown[];
    done: boolean;
  }
```

`cacheResult` stays for single-frame ops (`get`, `upsert`, `delete`, `clear`, `import`) and for the error reply of any op (`ok:false` short-circuits — errors are always small).

## 3. Extension-side chunking (Step 2.2)

Extract a pure helper so Step 3.1 can test it without vscode imports:

```ts
// suggested: src/frame-batch.ts
export function batchBySize<T>(items: T[], sizeOf: (t: T) => number, cap: number): T[][]
```

Rules (identical to `sendChunked` semantics, extension.ts:317-337):
- Accumulate items into a frame while `frameBytes + sizeOf(item) <= cap`.
- An item alone larger than `cap` still ships whole, in its own frame.
- Always emit at least one frame (empty list → one `{items: [], done: true}` frame) so the webview promise resolves for empty caches — this preserves current first-run behavior.

**Streaming, not batch-after-read (plan Step 2.2):** for `list`, don't call `readAll()` and then batch — refactor the read loop (file-cache.ts:38-57) so each parsed session is fed to the accumulator as it's read, and a frame is posted the moment it fills. First frame lands after ~20 MB of disk I/O regardless of total cache size, which is what keeps the webview's inactivity timer fed on slow disks. `batchBySize` stays the pure, testable core; the streaming wrapper is a thin async loop around it (or an equivalent `pushItem(item) → frames` accumulator API if that tests more cleanly).

`sizeOf` for list payloads: `JSON.stringify(payload).length`. This double-serializes (VS Code serializes again on post); acceptable at 20 MB granularity, and it is exactly the measurement `sendBuckets` already approximates with `text.length`.

## 4. Bridge-side reassembly + timeout interplay (Steps 1.1, 2.4)

```ts
// bridge.ts — pendingCache entry gains: buffer: unknown[], timer: number
case 'cacheResultChunk': {
  const p = pendingCache.get(msg.requestId);
  if (!p) return;
  p.buffer.push(...msg.items);
  resetTimer(p);                       // progress ⇒ not hung
  if (msg.done) {
    pendingCache.delete(msg.requestId);
    clearTimeout(p.timer);
    p.resolve(p.buffer);               // list → array; export → segments.join('')
  }
  return;
}
```

- Timeout constant: `CACHE_OP_TIMEOUT_MS = 60_000`, defined in bridge.ts. This is an **inactivity** timeout (gap since the last received frame), not a total-transfer budget: it is armed at send, cleared+re-armed on every `cacheResultChunk`, and cleared on resolve/reject. Total transfer time is unbounded as long as frames keep arriving; §3's incremental streaming guarantees a healthy `list` produces its first frame after at most ~20 MB of disk reads, not after the whole cache.
- On timeout: `pendingCache.delete(requestId)`; reject with `new Error(\`cacheOp '${op}' stalled: no reply frame for 60s (requestId ${id})\`)`. `store.init()`'s catch (store.ts:66-67) turns this into the visible Error screen — the user-facing improvement even before Phase 2 lands.
- Which shape resolves: `list` resolves with the accumulated array (adapters.ts:66 already `?? []`s it). `export` (if chunked per Step 2.3) resolves with `segments.join('')`.

## 5. Export chunking decision (Step 2.3)

Preferred: stream the export JSON as string segments — build `{"version":1,"exportedAt":…,"sessions":[` header, then `JSON.stringify(row)` per session with comma separators, split into ≤20 MB string items, final `]}` in the `done` frame. Bridge joins segments.

Fallback (record as DD-00x if taken): leave `export` single-frame, add `log.warn` when the string exceeds `MAX_MESSAGE_BYTES`. Rationale: export is a user-triggered backup, not on the boot path; it cannot cause the stuck-loading symptom.

## 6. Logging additions (Steps 1.2, 1.3)

- `post()` failure: `this.log.warn(\`postMessage(${msg.type}) not delivered\`)` on `ok === false` or rejection. Keep `post()` fire-and-forget otherwise — callers don't await it today and shouldn't start.
- Reply size for `list`/`export`: one `log.info` per request: op, session count, total bytes, frame count. This is the number to ask for in future field reports.

## 7. Config keys / env / schema changes

None. No new settings; `cacheBackend` semantics unchanged. The cache file format on disk is untouched — only the transport of replies changes, so existing caches (including the user's stuck work-laptop cache) load without migration.

## 8. Loading-progress data flow (plan Phase 3)

```
ext: cacheResultChunk frames gain bytes: number (sum of payload stringify lengths in the frame)
webview bridge: cacheOp('list', onChunk?) — listener invokes onChunk({sessions: buffer.length, bytes: cumulative})
adapters: createGlobalStorageCache().list(onProgress) forwards onProgress as onChunk
store: init() → cache.list(p => set({ loadingProgress: p })); clears to null with loading:false
App.tsx loading branch:
  loadingProgress ? `Loading cached sessions… ${sessions} sessions · ${(bytes/1048576).toFixed(1)} MB`
                  : 'Loading…'
```

The `SessionCache.list` progress parameter is optional; Dexie (web/electron) ignores it and those hosts keep the plain "Loading…" — no cross-app behavior change. The install-and-observe field validation depends on this phase: a user watching numbers tick up knows the transfer is alive without opening devtools.

## 9. Verification seed script (Step 4.3)

Scratchpad script writes N synthetic `StoredSession` JSONs (~2 MB each, ≥12 files → >20 MB total) shaped per file-cache.ts:13-26 into the globalStorage sessions dir. Sessions need plausible `startedAt` (this month, so the default "This Month" date-range filter shows them) and non-empty `events` with `content` strings for bulk.
