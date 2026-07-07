#!/usr/bin/env node
// Version sync (details doc §7): the ROOT package.json version is the single
// source of truth. This script stamps it into the workspace manifests that
// ship versioned binaries:
//   - apps/vscode-ext/package.json  (vsce reads "version" for the .vsix)
//   - apps/electron/package.json    (electron-builder reads "version" for the installer + latest.yml)
//
// Usage:
//   node scripts/sync-version.mjs                   stamp the root version into the targets
//   node scripts/sync-version.mjs --check           exit 1 if any target is out of sync (writes nothing)
//   node scripts/sync-version.mjs --expect 1.2.3    additionally fail unless root version === 1.2.3
//                                                   (release workflow passes the tag-derived version)
//   node scripts/sync-version.mjs --root <dir>      operate on another checkout (used by tests)
//
// No dependencies; safe to run from any cwd.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const TARGETS = ['apps/vscode-ext/package.json', 'apps/electron/package.json'];

function parseArgs(argv) {
  const opts = { check: false, expect: undefined, root: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--check') opts.check = true;
    else if (arg === '--expect') opts.expect = argv[++i];
    else if (arg === '--root') opts.root = argv[++i];
    else {
      console.error(`sync-version: unknown argument "${arg}"`);
      console.error('usage: node scripts/sync-version.mjs [--check] [--expect <version>] [--root <dir>]');
      process.exit(2);
    }
  }
  if (opts.expect === undefined && process.argv.includes('--expect')) {
    console.error('sync-version: --expect requires a version argument');
    process.exit(2);
  }
  return opts;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = opts.root
    ? resolve(opts.root)
    : resolve(dirname(fileURLToPath(import.meta.url)), '..');

  const rootPkgPath = join(root, 'package.json');
  const version = readJson(rootPkgPath).version;
  if (!version) {
    console.error(`sync-version: no "version" in ${rootPkgPath}`);
    process.exit(1);
  }

  if (opts.expect !== undefined && opts.expect !== version) {
    console.error(
      `sync-version: root version is ${version} but expected ${opts.expect} ` +
        '(tag and root package.json version must match — bump the root version and re-tag)'
    );
    process.exit(1);
  }

  let failures = 0;
  for (const rel of TARGETS) {
    const path = join(root, rel);
    const pkg = readJson(path);
    if (pkg.version === version) {
      console.log(`sync-version: ${rel} already at ${version}`);
      continue;
    }
    if (opts.check) {
      console.error(`sync-version: ${rel} is ${pkg.version}, expected ${version}`);
      failures++;
      continue;
    }
    pkg.version = version;
    writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`sync-version: ${rel} stamped to ${version}`);
  }

  if (failures > 0) process.exit(1);
  console.log(`sync-version: OK (${version})`);
}

main();
