import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEventsFromText, parseSession } from '../src/lib/parser';
import type { SessionModelInfo } from '../src/lib/types';

const fixturePath = (p: string) => join(__dirname, 'fixtures', p);

const text = readFileSync(fixturePath('session-basic.jsonl'), 'utf8');
const models = JSON.parse(readFileSync(fixturePath('models.json'), 'utf8')) as SessionModelInfo[];

describe('parseEventsFromText', () => {
  it('parses one JSON object per line and skips blanks', () => {
    const events = parseEventsFromText(text + '\n\n');
    expect(events.length).toBe(10);
    expect(events[0].type).toBe('session_start');
  });

  it('warns on malformed JSON but does not throw', () => {
    const events = parseEventsFromText('{invalid}\n{"ts":1,"dur":0,"sid":"a","type":"x","name":"x","spanId":"s","status":"ok","attrs":{}}');
    expect(events.length).toBe(1);
  });
});

describe('parseSession', () => {
  const events = parseEventsFromText(text);
  const session = parseSession({
    events,
    rootDirName: 'test-sess-1',
    rootPath: 'C:/Users/x/AppData/Roaming/Code/User/workspaceStorage/abc123def456/GitHub.copilot-chat/debug-logs/test-sess-1',
    modelsCatalog: models,
  });

  it('extracts session metadata and workspace hash', () => {
    expect(session.id).toBe('test-sess-1');
    expect(session.copilotVersion).toBe('0.45.0');
    expect(session.workspaceHash).toBe('abc123def456');
    expect(session.modelsCatalog).toHaveLength(2);
  });

  it('rolls up turns and attributes child events', () => {
    expect(session.turns).toHaveLength(1);
    expect(session.turns[0].turnId).toBe('0');
    expect(session.turns[0].userMessageContent).toBe('hello');
    expect(session.turns[0].llmCallSpanIds).toEqual(['llm-0', 'llm-1']);
    expect(session.turns[0].toolCallSpanIds).toEqual(['tc-0', 'tc-1']);
    expect(session.turns[0].agentResponseSpanIds).toEqual(['ar-0']);
  });

  it('extracts LLM calls with token totals and cache markers', () => {
    expect(session.llmCalls).toHaveLength(2);
    const opus = session.llmCalls[0];
    expect(opus.model).toBe('claude-opus-4.6');
    expect(opus.inputTokens).toBe(1000);
    expect(opus.outputTokens).toBe(200);
    expect(opus.totalTokens).toBe(1200);
    expect(opus.ttftMs).toBe(50);
    expect(opus.cacheBoundaryHits).toBe(1);
  });

  it('extracts tool calls and surfaces errors', () => {
    expect(session.toolCalls).toHaveLength(2);
    const failed = session.toolCalls.find((t) => t.status === 'error');
    expect(failed?.errorMessage).toBe('command not found');
  });

  it('captures child session references', () => {
    expect(session.childSessionRefs).toHaveLength(1);
    expect(session.childSessionRefs[0].childSessionId).toBe('child-1');
  });
});
