import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Exercises scripts/sync-version.mjs as a subprocess against a scratch --root
// fixture, since it's a CLI entrypoint (main() runs unconditionally on
// import) rather than an importable module.

const SCRIPT = join(__dirname, '..', 'sync-version.mjs');

function makeFixture(rootVersion: string, targetVersions: [string, string]) {
  const root = mkdtempSync(join(tmpdir(), 'sync-version-test-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: rootVersion }, null, 2));
  mkdirSync(join(root, 'apps/vscode-ext'), { recursive: true });
  mkdirSync(join(root, 'apps/electron'), { recursive: true });
  writeFileSync(
    join(root, 'apps/vscode-ext/package.json'),
    JSON.stringify({ name: 'vscode-ext', version: targetVersions[0] }, null, 2)
  );
  writeFileSync(
    join(root, 'apps/electron/package.json'),
    JSON.stringify({ name: 'electron', version: targetVersions[1] }, null, 2)
  );
  return root;
}

function run(args: string[], root: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args, '--root', root], { encoding: 'utf8' });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { status: e.status, stdout: e.stdout, stderr: e.stderr };
  }
}

let root: string;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('sync-version.mjs', () => {
  it('stamps out-of-sync target manifests to the root version', () => {
    root = makeFixture('1.2.3', ['1.0.0', '1.1.0']);
    const result = run([], root);
    expect(result.status).toBe(0);
    const ext = JSON.parse(readFileSync(join(root, 'apps/vscode-ext/package.json'), 'utf8'));
    const electron = JSON.parse(readFileSync(join(root, 'apps/electron/package.json'), 'utf8'));
    expect(ext.version).toBe('1.2.3');
    expect(electron.version).toBe('1.2.3');
  });

  it('only rewrites the version field, preserving other keys', () => {
    root = makeFixture('2.0.0', ['1.0.0', '1.0.0']);
    run([], root);
    const ext = JSON.parse(readFileSync(join(root, 'apps/vscode-ext/package.json'), 'utf8'));
    expect(ext.name).toBe('vscode-ext');
    expect(ext.version).toBe('2.0.0');
  });

  it('--check fails without writing when a target is out of sync', () => {
    root = makeFixture('1.5.0', ['1.0.0', '1.5.0']);
    const result = run(['--check'], root);
    expect(result.status).toBe(1);
    const ext = JSON.parse(readFileSync(join(root, 'apps/vscode-ext/package.json'), 'utf8'));
    expect(ext.version).toBe('1.0.0'); // unchanged
  });

  it('--check succeeds when all targets already match', () => {
    root = makeFixture('1.5.0', ['1.5.0', '1.5.0']);
    const result = run(['--check'], root);
    expect(result.status).toBe(0);
  });

  it('--expect fails when root version does not match the given tag version', () => {
    root = makeFixture('1.2.3', ['1.2.3', '1.2.3']);
    const result = run(['--expect', '1.9.9'], root);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/expected 1\.9\.9/);
  });

  it('--expect succeeds and stamps when root version matches', () => {
    root = makeFixture('1.2.3', ['1.0.0', '1.0.0']);
    const result = run(['--expect', '1.2.3'], root);
    expect(result.status).toBe(0);
    const ext = JSON.parse(readFileSync(join(root, 'apps/vscode-ext/package.json'), 'utf8'));
    expect(ext.version).toBe('1.2.3');
  });

  it('rejects unknown arguments with exit code 2', () => {
    root = makeFixture('1.0.0', ['1.0.0', '1.0.0']);
    const result = run(['--bogus'], root);
    expect(result.status).toBe(2);
  });
});
