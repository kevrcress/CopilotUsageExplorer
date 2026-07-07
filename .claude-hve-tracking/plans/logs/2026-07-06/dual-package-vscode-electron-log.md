# Planning Log: dual-package-vscode-electron
Date: 2026-07-06
Plan: .claude-hve-tracking/plans/2026-07-06/dual-package-vscode-electron-plan.md

## Discrepancies

### DD-001: Store singleton vs injected provider
Source: Design decision without full information — research confirmed store.ts coupling (src/lib/store.ts:3,11,103-113) but not how many call sites use `useAppStore` directly.
Assumption: a module-level `initAppStore(adapters)` bootstrap preserves the existing `useAppStore` import style with minimal component churn [MEDIUM].
Risk: hidden import-order issues (component module evaluating before init). Mitigation: init before ReactDOM render in every app entry; store getter throws if uninitialized.
Status: Open

### DD-002: Public releases repo assumed
Source: Both the extension update check (plan Step 2.8) and electron-updater (Step 3.5) assume a public GitHub repo for releases; current repo visibility not confirmed.
Assumption: Kevin will host releases publicly, or a separate public releases-only repo is acceptable [MEDIUM].
Risk: private repo breaks unauthenticated update checks and is discouraged for electron-updater. Needs user confirmation before Phase 4.
Status: Resolved (user confirmed 2026-07-06: repo is public)

### DD-003: macOS Electron build scope
Source: User said no Apple Dev ID; plan offers unsigned opt-in zip OR skipping macOS entirely (Step 3.5).
Assumption: unsigned macOS zip is nice-to-have for Kevin's own machine; not a team deliverable [MEDIUM].
Risk: none material; xattr/Gatekeeper friction documented if built.
Status: Resolved (user confirmed 2026-07-06: build unsigned macOS zip if low-effort — for home testing; skip if it adds meaningful effort)

### DD-004: Recharts inline styles require style-src 'unsafe-inline' in webview CSP
Source: Details §5. Not verified against a built bundle — inferred from how Recharts renders [MEDIUM].
Risk: if scripts also need relaxation (they should not), CSP design revisits. Verify during Step 2.2.
Status: Open

### DR-001: Electron File.path removal version
Source: Research marked "removed in Electron 32" [MEDIUM — flagged for verification against breaking-changes docs].
Resolution: Plan does not depend on File.path at all — Electron ingest goes through main-process fs + IPC; drag-drop path capture, if added, uses webUtils.getPathForFile (Step 3.3 assumption). Verification folded into Step 3.3.
Status: Resolved (by design routing around it)

### DR-002: IndexedDB persistence in webview unverified
Source: Research open question #1 [MEDIUM].
Resolution: Plan Step 2.1 is a gating spike with a designed fallback (globalStorageUri file cache). No downstream step assumes the spike passes.
Status: Resolved (gated)

### DD-005: RecoveredFile readHead implementation per-host
Source: Plan Step 1.5 promotes RecoveredFile with optional `readHead(bytes): Promise<string>` replacing Blob slice, but exact implementation per host (browser Blob, Node fs range-read, VS Code fs.read ranged) is inferred, not verified.
Assumption: Each host adapter can implement readHead efficiently for its platform [HIGH — research confirms platform APIs exist, electron-tooling finding 3, vscode-extension finding 10]. 
Risk: Minor — if a host's readHead becomes unexpectedly complex, fallback is `text().slice(0, N)` at runtime cost.
Severity: Minor
Status: Open (implementation detail; no blocker)
