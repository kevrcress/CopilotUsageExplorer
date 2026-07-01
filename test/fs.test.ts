import { describe, it, expect } from 'vitest';
import { ingestFromFileList } from '../src/lib/fs';

/** Build a minimal main.jsonl for a parent session that references one child via
 *  child_session_ref, plus the child's own main-shaped jsonl content. */
function parentJsonl(sid: string, childId: string, childLogFile: string, label: string): string {
  return [
    { ts: 1700000000000, dur: 0, sid, type: 'session_start', name: 'session_start', spanId: 's0', status: 'ok', attrs: {} },
    { ts: 1700000000010, dur: 0, sid, type: 'user_message', name: 'user_message', spanId: 'u1', status: 'ok', attrs: { content: 'hi' } },
    { ts: 1700000000020, dur: 0, sid, type: 'turn_start', name: 'turn_start:0', spanId: 'ts-0', status: 'ok', attrs: { turnId: '0' } },
    { ts: 1700000000030, dur: 5, sid, type: 'child_session_ref', name: 'child_session_ref', spanId: 'c0', status: 'ok', attrs: { childSessionId: childId, childLogFile, label } },
    { ts: 1700000000040, dur: 0, sid, type: 'turn_end', name: 'turn_end:0', spanId: 'te-0', status: 'ok', attrs: { turnId: '0' } },
  ].map((e) => JSON.stringify(e)).join('\n');
}

function childJsonl(sid: string): string {
  return [
    { ts: 1700000000031, dur: 0, sid, type: 'session_start', name: 'session_start', spanId: 'cs0', status: 'ok', attrs: {} },
    { ts: 1700000000032, dur: 0, sid, type: 'user_message', name: 'user_message', spanId: 'cu1', status: 'ok', attrs: { content: 'subagent task' } },
    { ts: 1700000000033, dur: 0, sid, type: 'turn_start', name: 'turn_start:0', spanId: 'cts-0', status: 'ok', attrs: { turnId: '0' } },
    { ts: 1700000000034, dur: 500, sid, type: 'llm_request', name: 'llm_request', spanId: 'cllm-0', parentSpanId: 'cts-0', status: 'ok', attrs: { model: 'gpt-5.4-mini', inputTokens: 100, outputTokens: 50 } },
  ].map((e) => JSON.stringify(e)).join('\n');
}

function fileOf(relPath: string, content: string): File {
  const name = relPath.split('/').pop()!;
  const file = new File([content], name, { type: 'application/json' });
  Object.defineProperty(file, 'webkitRelativePath', { value: relPath });
  return file;
}

describe('ingestFromFileList — subagent child linkage', () => {
  it('loads a runSubagent-*.jsonl child and links it to its parent', async () => {
    const childLogFile = 'runSubagent-Phase Implementor-call_abc123.jsonl';
    const files = [
      fileOf('debug-logs/parent-sess/main.jsonl', parentJsonl('parent-sess', 'call_abc123', childLogFile, 'runSubagent-Phase Implementor')),
      fileOf(`debug-logs/parent-sess/${childLogFile}`, childJsonl('call_abc123')),
    ];

    const sessions = await ingestFromFileList(files);

    const parent = sessions.find((s) => s.id === 'parent-sess');
    const child = sessions.find((s) => s.id === 'call_abc123');

    expect(parent).toBeDefined();
    expect(parent!.childSessionRefs).toHaveLength(1);
    expect(parent!.childSessionRefs[0].childSessionId).toBe('call_abc123');

    expect(child).toBeDefined();
    expect(child!.parent?.sessionId).toBe('parent-sess');
    expect(child!.turns).toHaveLength(1);
    expect(child!.llmCalls[0].model).toBe('gpt-5.4-mini');
  });

  it('still loads a title-*.jsonl child (existing behavior, unaffected)', async () => {
    const childLogFile = 'title-def456.jsonl';
    const files = [
      fileOf('debug-logs/parent-sess-2/main.jsonl', parentJsonl('parent-sess-2', 'def456', childLogFile, 'title')),
      fileOf(`debug-logs/parent-sess-2/${childLogFile}`, childJsonl('def456')),
    ];

    const sessions = await ingestFromFileList(files);
    const child = sessions.find((s) => s.id === 'def456');

    expect(child).toBeDefined();
    expect(child!.parent?.sessionId).toBe('parent-sess-2');
  });

  it('loads a child referenced under an unrecognized naming convention via childLogFile fallback', async () => {
    const childLogFile = 'futureSubagentKind-xyz789.jsonl';
    const files = [
      fileOf('debug-logs/parent-sess-3/main.jsonl', parentJsonl('parent-sess-3', 'xyz789', childLogFile, 'futureSubagentKind')),
      fileOf(`debug-logs/parent-sess-3/${childLogFile}`, childJsonl('xyz789')),
    ];

    const sessions = await ingestFromFileList(files);
    const child = sessions.find((s) => s.id === 'xyz789');

    expect(child).toBeDefined();
    expect(child!.parent?.sessionId).toBe('parent-sess-3');
  });
});
