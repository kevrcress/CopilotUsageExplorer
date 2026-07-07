# RPI Validation: Package CopilotUsageExplorer as VS Code extension + Electron app with shared core — Phase 1
Date: 2026-07-06
Plan phase: Phase 1: Monorepo restructure + core extraction
Coverage: 100%
Status: Fail: 1 critical

## Plan Item Comparison

| Plan Step | Changes Log Status | Evidence File | Status |
|---|---|---|---|
| Step 1.1: Root workspaces + core/ui/web package.json files | Found | `package.json:7-10`, `packages/core/package.json`, `packages/ui/package.json`, `apps/web/package.json` | ✅ Implemented |
| Step 1.2: Move pure modules to packages/core/src | Found | `packages/core/src/{parser,tokens,tokenizer,models,types,redact,ingest,session-utils,index}.ts` | ✅ Implemented |
| Step 1.3: Split insights.ts (computeInsights/computeAnalytics + icon keys) | Found | `packages/core/src/insights.ts:1-24`, `packages/ui/src/insights.ts:8`, `packages/ui/src/icons.ts` | ✅ Implemented |
| Step 1.4: Split utils.ts (cn → ui, session helpers → core) | Found | `packages/ui/src/utils.ts:1-6`, `packages/core/src/session-utils.ts` | ✅ Implemented |
| Step 1.5: Promote RecoveredFile, replace rawBlob, export groupAndParse | Found | `packages/core/src/ingest.ts:9-21,75`, `apps/web/src/adapters/browser-ingest.ts:5-16` | ✅ Implemented |
| Step 1.6: Define four host-adapter interfaces | Found | `packages/ui/src/host.ts` (SessionCache, PrefsStore, FileSaver, IngestSource) | ✅ Implemented |
| Step 1.7: Convert store to createAppStore factory | Found | `packages/ui/src/store.ts:41,125-128` | ✅ Implemented |
| Step 1.8: Move React components + exports to packages/ui; apps/web = adapters + entry | Found | `packages/ui/src/App.tsx:15`, `apps/web/src/main.tsx:11-22`, `apps/web/src/adapters/*` | ✅ Implemented |
| Step 1.9: Move tests with corrected imports | Found | `packages/core/test/{parser,tokens,ingest}.test.ts` | ✅ Implemented |
| Step 1.10: Guard step (npm test, npm run build, purity grep) | Found | `npm test` 14/14 pass per changes log; purity grep zero hits over packages/core/src | ✅ Implemented |

## Findings

### RV1-001 [CRITICAL]
**Plan item:** DD-101: importBackup return type + UI text reword
**Evidence:** `packages/ui/src/host.ts:12` declares `importBackup(json: string): Promise<number>` (correct). `packages/ui/src/components/Settings.tsx:83` reads: `"Restored ${imported} sessions (already-cached sessions with equal or more data were skipped). Reload to see them."` — explicitly references the skipped-session logic the DD-101 claim says was removed.
**File:Line:** `packages/ui/src/components/Settings.tsx:83`
**Impact:** DD-101 falsely claims "Settings restore message no longer shows the skipped count (text reworded)" but the actual code contradicts this. The message still explicitly explains that skipped sessions were omitted, preserving the old semantic contract even though the return type changed. This is a **record-consistency violation** in the changes log.
**Recommendation:** Reword Settings.tsx:83 to remove "already-cached sessions with equal or more data were skipped" clause, or correct DD-101 in the changes log to acknowledge the message still references the skip logic.

### RV1-002 [INFO]
**Plan item:** Step 1.1 workspaces declaration
**Evidence:** `package.json:7-10` declares `"workspaces": ["packages/*", "apps/*"]` exactly per plan.
**Status:** Correct; no issues.

### RV1-003 [INFO]
**Plan item:** Step 1.3 insights.ts split — RecommendationIconKey string union
**Evidence:** `packages/core/src/insights.ts:7-18` defines `RecommendationIconKey` as a type union of 8 string keys ('trending-down', 'zap', etc.); `packages/ui/src/icons.ts:7-16` maps those keys to Lucide components via `ICONS: Record<RecommendationIconKey, LucideIcon>`. No React/Lucide in core.
**Status:** Correct; separation achieved.

### RV1-004 [INFO]
**Plan item:** Step 1.5 RecoveredFile.readHead replacement of rawBlob
**Evidence:** `packages/core/src/ingest.ts:17-20` defines optional `readHead?: (bytes: number) => Promise<string>`; `apps/web/src/adapters/browser-ingest.ts:14` implements as `file.slice(0, bytes).text()`, matching the plan's intent to avoid holding Blob refs.
**Status:** Correct; lazy head-read pattern fully implemented.

### RV1-005 [INFO]
**Plan item:** Step 1.8 App prop-injection of ingest (DD-102)
**Evidence:** `packages/ui/src/App.tsx:15` declares `function App({ ingest }: { ingest: ReactNode })` and renders the prop without coupling to browser specifics. `apps/web/src/main.tsx:20` passes `<App ingest={<Ingest />} />`, keeping ui host-agnostic. DD-102 correctly documented.
**Status:** Correct; design decision properly applied.

### RV1-006 [INFO]
**Plan item:** DD-103 exportation of isRelevantFile + SKIP_DIRS from core
**Evidence:** `packages/core/src/ingest.ts:26-44` exports both `SKIP_DIRS` (Set) and `isRelevantFile(name)` function; `apps/web/src/adapters/browser-ingest.ts:1-2` imports both, using them to filter collected files. Purity not violated.
**Status:** Correct; reusable filtering logic properly extracted.

### RV1-007 [INFO]
**Plan item:** DD-104 ui-internal relative imports, cross-boundary @cue/ paths
**Evidence:** Grep over `packages/ui/src` finds zero hits for `from '@/` patterns; all internal imports are relative (e.g., `from './store'`); cross-boundary imports use `@cue/core` (e.g., `packages/ui/src/host.ts:1`, `packages/ui/src/icons.ts:5`). Avoids @/ alias collision.
**Status:** Correct; boundary imports follow the plan.

## Unlisted Changes

Searched for files modified but not explicitly listed in the changes log for Phase 1:
- Root `vitest.config.ts` (created, per Step 1.10) — listed in changes log under "Root"
- Root `tsconfig.base.json` (created, per Step 1.1) — listed in changes log under "Root"
- `.gitignore` (modified for *.pem, *.key, *.p12 per security hygiene) — listed under "Root"
- All Phase 1 files are accounted for in the changes log.

No unlisted changes detected.

## Research Coverage

### Core Purity (Research: "zero browser/React deps")
- **Requirement:** packages/core has no imports of react, dexie, zustand, DOM/window/localStorage/indexedDB [HIGH confidence]
- **Verification:** Grep `react|dexie|zustand|document\.|window\.|localStorage|indexedDB` over packages/core/src → **zero hits**
- **Status:** ✅ Met
- **Evidence:** packages/core/src contains only pure TypeScript: parser, tokens, tokenizer, models, types, redact, insights (computeInsights/computeAnalytics only), ingest (groupAndParse), session-utils

### RecoveredFile extraction boundary (Research: "host-neutral RecoveredFile[] boundary")
- **Requirement:** groupAndParse exported, consumers receive RecoveredFile[]
- **Verification:** `packages/core/src/ingest.ts:75` exports groupAndParse; `packages/core/src/ingest.ts:9-21` defines RecoveredFile; `apps/web/src/adapters/browser-ingest.ts:19,32` calls groupAndParse with RecoveredFile[]
- **Status:** ✅ Met
- **Evidence:** packages/ui/src/host.ts:28-33 IngestSource.autoDiscover/pickAndIngest return `Promise<RecoveredFile[][]>` (buckets)

### Four adapter interfaces (Research: "SessionCache, PrefsStore, FileSaver, IngestSource")
- **Requirement:** Contracts defined per research findings (details doc §2 implied)
- **Verification:** `packages/ui/src/host.ts:5-40` defines all four interfaces exactly
- **Status:** ✅ Met
- **Evidence:** SessionCache (upsert/list/get/delete/clear/exportBackup/importBackup), PrefsStore (get/set), FileSaver (save), IngestSource (capabilities/pickAndIngest/autoDiscover/watch)

### Test suite migration (Research: "existing Vitest suites moved")
- **Requirement:** parser, tokens tests run from packages/core/test; fs.test rewritten against groupAndParse literals
- **Verification:** `vitest.config.ts:5` includes `packages/*/test`, `apps/*/test`; `packages/core/test/ingest.test.ts:37-75` uses RecoveredFile literals with no browser File shim
- **Status:** ✅ Met
- **Evidence:** `npm test` passes 14/14 per changes log; all three test files in packages/core/test/

## Severity Assessment

**1 CRITICAL finding:** DD-101 falsifies its claim that the Settings UI text was reworded to omit skipped-session references. The actual message at `packages/ui/src/components/Settings.tsx:83` explicitly states "already-cached sessions with equal or more data were skipped", contradicting the changes log's assertion.

All other Phase 1 steps are correctly implemented with high fidelity.

## Confidence Markers

| Finding | Confidence |
|---|---|
| Core purity (zero browser deps) | HIGH — verified by grep |
| RecoveredFile extraction seam | HIGH — both core export and web consumer verified |
| Four adapters defined | HIGH — interfaces read directly |
| Test migration | HIGH — file existence + vitest.config include verified |
| Store factory injection | HIGH — function signature verified |
| DD-101 contradiction | HIGH — changes-log claim vs. actual code line verified |

## Coverage Calculation

**Total plan steps for Phase 1:** 10 (Steps 1.1–1.10)
**Implemented steps:** 10 (all found in code)
**Coverage:** 10 / 10 × 100% = **100%**

---

## Recommended Follow-On Validations

- [ ] Update Settings.tsx:83 to remove "already-cached sessions… were skipped" text, or correct DD-101 annotation in the changes log with a Correction entry explaining the discrepancy
- [ ] Run `npm run build -w apps/web` and verify zero TypeScript errors (apps/web's @/ alias scoping)
- [ ] Verify root `npm run dev -w apps/web` serves the app at :5173 with zero console errors
- [ ] Spot-check one component (e.g., SessionList.tsx) for correct relative + @cue/core imports
- [ ] Confirm git history shows all Phase 1 files moved via `git mv` (preserving blame)

---

Written: `.claude-hve-tracking/reviews/rpi/2026-07-06/dual-package-vscode-electron-phase-001-validation.md`
