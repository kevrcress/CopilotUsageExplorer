import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEventsFromText, parseSession } from '../src/lib/parser';
import { rollupSession, formatTokens } from '../src/lib/tokens';
import type { SessionModelInfo } from '../src/lib/types';

const fixturePath = (p: string) => join(__dirname, 'fixtures', p);
const text = readFileSync(fixturePath('session-basic.jsonl'), 'utf8');
const models = JSON.parse(readFileSync(fixturePath('models.json'), 'utf8')) as SessionModelInfo[];

describe('token rollup', () => {
  const session = parseSession({ events: parseEventsFromText(text), rootDirName: 'x', modelsCatalog: models });

  it('sums input/output tokens straight from the log', () => {
    const r = rollupSession(session);
    expect(r.llmCalls).toBe(2);
    expect(r.totalInputTokens).toBe(1500);
    expect(r.totalOutputTokens).toBe(300);
    expect(r.totalTokens).toBe(1800);
  });

  it('breaks tokens down per model', () => {
    const r = rollupSession(session);
    expect(r.byModel).toHaveLength(2);
    const opus = r.byModel.find((m) => m.model === 'claude-opus-4.6');
    expect(opus?.calls).toBe(1);
    expect(opus?.inputTokens).toBe(1000);
    expect(opus?.outputTokens).toBe(200);
  });

  it('counts cache boundary markers and errors', () => {
    const r = rollupSession(session);
    expect(r.cacheBoundaryHits).toBe(1);
    // the fixture has one errored tool_call event
    expect(r.errorCount).toBeGreaterThanOrEqual(1);
  });

  it('formats token magnitudes', () => {
    expect(formatTokens(500)).toBe('500');
    expect(formatTokens(1500)).toBe('1.5k');
    expect(formatTokens(2_000_000)).toBe('2.00M');
  });
});
