# RPI Validation: Package CopilotUsageExplorer as VS Code extension + Electron app with shared core — Phase 1 (Re-validation post-Phase 5/6)
Date: 2026-07-06
Plan phase: Phase 1: Monorepo restructure + core extraction
Coverage: 100% (10/10 steps implemented + verified)
Status: Pass

## Context
This is a re-validation of Phase 1 after Phase 5 (R5.2 adapter consolidation) and Phase 6 (R6.2 discovery consolidation + R6.4 dexie-cache subpath export) made targeted modifications to packages/core and packages/ui that Phase 1 originally delivered. The validation focuses on:
1. packages/core's zero-forbidden-imports success criterion (strict compliance post-R6.2 node-fs-utils.ts addition)
2. packages/core/package.json exports structure safety (both "." and "./node-fs-utils" subpaths)
3. packages/ui barrel integrity and public API post-R6.4 (dexie-cache removal from main barrel)
4. Verification that Phase 5/6 remediation files don't break the contract Phase 1 established

## Plan Item Comparison

| Plan Step | Changes Log Status | Evidence Files | Status |
|---|---|---|---|
| Step 1.1: Root workspaces + 3 package.json files | Found (Implemented) | `package.json:7-10` | ✅ Implemented |
| Step 1.2: Pure modules → packages/core/src | Found (Implemented) | `packages/core/src/{parser,tokens,tokenizer,models,types,redact}.ts` | ✅ Implemented |
| Step 1.3: insights.ts split — core/ui | Found (Implemented) | `packages/core/src/insights.ts:1-18`, `packages/ui/src/insights.ts` | ✅ Implemented |
| Step 1.4: utils.ts split — cn()/session helpers | Found (Implemented) | `packages/ui/src/utils.ts`, `packages/core/src/session-utils.ts` | ✅ Implemented |
| Step 1.5: RecoveredFile + groupAndParse + ingest split | Found (Implemented) | `packages/core/src/ingest.ts:9,75`, `apps/web/src/adapters/browser-ingest.ts` | ✅ Implemented |
| Step 1.6: Four host-adapter interfaces | Found (Implemented) | `packages/ui/src/host.ts` | ✅ Implemented |
| Step 1.7: createAppStore(adapters) factory | Found (Implemented) | `packages/ui/src/store.ts:41,126` | ✅ Implemented |
| Step 1.8: Components + lib → packages/ui | Found (Implemented) | `packages/ui/src/`, `apps/web/src/adapters/` | ✅ Implemented |
| Step 1.9: Tests moved/rewritten | Found (Implemented) | `packages/core/test/` | ✅ Implemented |
| Step 1.10: Guard — npm test + build + purity grep | Found (Implemented) | Plan §20 success criteria verified below | ✅ Implemented |

## Findings

### Core Purity — Forbidden Import Audit (Success Criterion §20)

**RV1-101 [PASS]** — Grep for `react|dexie|zustand|document\.|window\.|localStorage|indexedDB` over `packages/core/src/` returns **zero hits**, including the newly-added `node-fs-utils.ts` (which uses only `node:fs` and `node:path`, neither flagged by the purity pattern).

Evidence: `packages/core/src/` verified clean via grep; `node-fs-utils.ts:1-2` imports only Node built-ins. The pattern-whitelist in `packages/core/package.json:6` ("No React, no DOM, no storage") is maintained.

### packages/core/package.json Exports Structure Safety

**RV1-102 [PASS]** — Two-subpath exports design correctly gates Node-only code:
- Main `"."` export → `./src/index.ts` (the pure barrel, reusable by browser bundlers)
- `index.ts:11-16` carries an **explicit explanatory comment** documenting that `node-fs-utils.ts` is deliberately excluded from the barrel
- Second subpath `"./node-fs-utils"` → `./src/node-fs-utils.ts` (Node-only; directly imported only by discovery.ts files in apps/electron/src/main and apps/vscode-ext/src, never through the main barrel)

Evidence: `packages/core/package.json:7-10`; `packages/core/src/index.ts:11-16`. The Vite/Rollup build breakage that would result from re-exporting node-fs-utils through the main barrel was discovered and fixed in Phase 6 (DD-602). No regression detected.

### packages/ui Barrel Integrity Post-R6.4

**RV1-103 [PASS]** — The `createDexieSessionCache` re-export was **correctly removed** from `packages/ui/src/index.ts` and a parallel subpath export was added:

- `packages/ui/src/index.ts:1-6` explicitly documents why the static re-export was removed (PR review IV-D01: it defeated tree-shaking for zero-dexie consumers)
- `packages/ui/package.json:7-10` declares a second `exports` subpath `"./adapters/dexie-cache": "./src/adapters/dexie-cache.ts"`
- Main barrel now exports `createLocalStoragePrefs` but **not** `createDexieSessionCache`
- Exported symbols remain comprehensive: `host`, `store`, `insights`, `icons`, `export`, `utils`, `App`, UI primitives (badge, button, card, dialog, input, tabs)

Evidence: `packages/ui/src/index.ts:1-22`; `packages/ui/package.json:7-10`.

### Cross-Host Import Compliance — createDexieSessionCache Import Paths

**RV1-104 [PASS]** — All three hosts import `createDexieSessionCache` from the correct subpath, not the barrel:
- `apps/web/src/main.tsx:4` — `import { createDexieSessionCache } from '@cue/ui/adapters/dexie-cache'`
- `apps/electron/src/renderer/src/main.tsx:4` — same import path
- `apps/vscode-ext/webview/main.tsx:18` — dynamic `await import('@cue/ui/adapters/dexie-cache')`; the dynamic form avoids loading dexie for the globalStorage cache backend (the default)

Evidence: Direct file reads confirm all three import statements use the subpath, not the barrel. Zero dangling references to the old barrel-import pattern were found (grep for `createDexieSessionCache` returned only the implementation file, the subpath export declaration, the three main.tsx call sites, and documentation/log entries).

### Dexie-Cache Subpath Export Completeness

**RV1-105 [PASS]** — The shared `packages/ui/src/adapters/dexie-cache.ts` is a complete, standalone factory:
- `packages/ui/src/adapters/dexie-cache.ts:29` exports `createDexieSessionCache(): SessionCache`
- Dependencies: only `Dexie` (npm), `ParsedSession` type from `@cue/core`, and `SessionCache` interface from `../host.ts` (within the same package)
- No circular imports; no re-export of the main barrel; safe to import via subpath

Evidence: `packages/ui/src/adapters/dexie-cache.ts:1-30`.

### Continuation of Phase 1's Three-Way Adapter Consolidation (R5.2)

**RV1-106 [PASS]** — Phase 5 (R5.2) consolidated `dexie-cache.ts` and `localstorage-prefs.ts` from three duplicate copies into `packages/ui/src/adapters/`. The changes log verifies all consolidation steps completed (deletion of duplicate files, import rewrites, dependency cleanup, verification via grep). Phase 1's original plan §20 guard ("npm test and build green") remains satisfied post-consolidation.

Evidence: Changes log lines 291–382 (R5.2 detailed verification); zero test failures; zero build failures post-consolidation (changes log line 336-340: "`npm run build -w apps/web` green; `npm run typecheck -w apps/electron` clean; `npm run typecheck -w apps/vscode-ext` clean`").

### Phase 6 (R6.2) Node-FS Utilities Hoisting — Purity Boundary Preservation

**RV1-107 [PASS]** — Phase 6 (R6.2) added `packages/core/src/node-fs-utils.ts` (discovery utilities for the Electron and VS Code extension hosts). The file:
- Uses only `node:fs` and `node:path` (no browser/React/storage APIs)
- Is **deliberately excluded from the main `@cue/core` barrel** via an explanatory comment in `index.ts:11-16`
- Is exported via a separate `"./node-fs-utils"` subpath (`packages/core/package.json:9`)
- Is imported directly only by Node-context discovery.ts files (apps/electron/src/main and apps/vscode-ext/src), never transitively through the main barrel

Evidence: `packages/core/src/node-fs-utils.ts:1-2` (imports); `packages/core/src/index.ts:11-16` (comment explaining exclusion); purity grep returns zero hits for the new file; changes log DD-602 documents the fix for a Vite/Rollup bundle-break that occurred when an initial attempt tried to re-export node-fs-utils through the main barrel (now resolved by the subpath separation).

## Unlisted Changes

No unlisted changes to packages/core or packages/ui source files beyond what Phase 1's plan specified. Phase 5 (R5.2) and Phase 6 (R6.2, R6.4) modifications are fully documented in the changes log with clear cross-phase citations and correction/decision entries (DD-501 through DD-608).

## Research Coverage

Plan success criteria (§20) vs. implementation evidence:

| Criterion | Evidence | Status |
|---|---|---|
| `npm test` passes from root | Changes log Phase 1 step 1.10, verified again in Phase 5 (26 tests, 0 failed) and Phase 6 (26/26). | ✅ Met |
| `npm run dev -w apps/web` serves app unchanged | Changes log Phase 1 line 67: "`npm run dev -w apps/web` binds :5173, app verified rendering in browser (Dashboard + ingest dialog, zero console errors/warnings)". No regressions reported in subsequent phases. | ✅ Met |
| packages/core has zero imports of react/dexie/zustand/DOM types | Grep audit RV1-101 above: zero hits. Purity pattern tested post-Phase 6 R6.2 addition of node-fs-utils.ts. | ✅ Met |

Research findings (§17–18, insights.ts and ingest.ts splits) verified:
- `useFilteredSessions` is React-coupled and moved to packages/ui/src/insights.ts ✅
- `computeInsights`/`computeAnalytics` are pure and live in packages/core/src/insights.ts ✅
- RecoveredFile is host-neutral and exported from packages/core ✅
- groupAndParse(RecoveredFile[]) is the host-neutral extraction seam ✅

## Summary Assessment

**Phase 1 re-validation: PASS**

All 10 plan steps remain fully implemented and operational. The targeted modifications made by Phase 5 (R5.2: adapter consolidation) and Phase 6 (R6.2: node-fs-utils hoisting; R6.4: dexie-cache subpath export) carefully preserved Phase 1's architectural boundaries and success criteria:

1. **packages/core purity** is stricter post-Phase 6 (node-fs-utils is explicitly gated via subpath, not re-exported through the main barrel), not weaker.
2. **packages/ui public API** is refactored but complete — createLocalStoragePrefs remains in the main barrel; createDexieSessionCache is available via a documented subpath to avoid unintended bundle inclusion for zero-dexie backends.
3. **All three hosts** (apps/web, apps/electron, apps/vscode-ext) correctly import from the subpath or have dynamic-import fallback logic in place.
4. **Test suite baseline** (26/26 passing) is stable.

No critical or major findings. Correction annotations in the changes log (Corrections subsections at Phase 1 and Phase 4, DD-501 through DD-608) are properly in place for any reviewer follow-on.
