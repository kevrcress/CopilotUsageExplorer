# Planning Log: Fix VS Code webview stuck on "Loading…" after first use
Date: 2026-07-14
Plan: .claude-hve-tracking/plans/2026-07-14/vscode-ext-stuck-loading-plan.md

## Discrepancies

### DD-001: No separate research phase was run
Source: /hve-plan invoked without a prior /hve-research artifact for this task.
Assumption: The inline code review captured in research/2026-07-14/vscode-ext-stuck-loading.md is sufficient — the failure path is short (init → cacheOp('list') → single unbounded reply) and every link is cited from source read this session.
Risk: The diagnosis has not been reproduced on the affected machine; the VS Code IPC failure threshold is inferred, not measured. Mitigated by Phase 1 landing observability regardless (timeout + delivery logging), so even if the root cause differs, the symptom becomes a visible error with logs instead of an infinite spinner.
Status: Open (closes when the user's work-laptop troubleshooting confirms cache size / workaround)

### DD-002: Symptom not yet reproduced locally
Source: User doesn't have the extension installed on this machine; Copilot is only used on the work laptop.
Assumption: The seeded-cache manual test (Step 3.3) is an adequate local repro proxy [MEDIUM].
Risk: A second, unrelated contributing cause on the work laptop would survive the fix. Mitigation: research doc's troubleshooting steps gather cache size + webview console output from the real machine before/alongside the fix. (superseded — see Correction 2026-07-14)
Status: Open
Correction (2026-07-14): User will not run pre-fix troubleshooting on the affected machine; validation is install-and-observe with the fixed VSIX. Mitigation shifted to plan Phases 1 and 3: the loading-progress UI and stall-error screen make the installed build self-diagnosing (progress ticking = chunked path working; stall error + output-channel logs = evidence for a follow-up). Seeded-cache EDH run (Step 4.3) is now the primary pre-ship validation.

### DD-003: Export chunking may be deferred
Source: Plan Step 2.3 allows a logged-warning fallback instead of chunking `export`.
Assumption: `export` is user-triggered backup, not on the boot path; it cannot cause the stuck-loading symptom [HIGH — code path read: only init() blocks the Loading screen].
Risk: Backups silently fail on very large caches until the follow-up lands. Accepted; the size warning makes it non-silent.
Status: Open (resolve during implementation with the actual choice taken)

### DD-004: Step 2.4 underspecified: missing pendingCache.op tracking strategy
Source: Plan Step 2.4 says "resolve the pending promise on done: true" but does not specify (1) storing the `op` field in pendingCache entries, or (2) the branching resolution logic (list → return array, export → join segments into string).
Assumption: Details section (lines 55–72) clarifies the intent, but the plan step is vague enough that an implementor could miss the op-tracking requirement [MEDIUM].
Risk: Implementor might resolve with wrong type (array for export instead of joined string), causing type mismatches in adapters.ts exportBackup(). Alternatively, pendingCache entries lack op, breaking the resolution dispatch.
Severity: Major
Recommendation: Before implementation, clarify Step 2.4 to explicitly state: "Store the `op` field in each pendingCache entry (cacheOp line ~209). In the cacheResultChunk handler, resolve with `p.op === 'export' ? p.buffer.join('') : p.buffer` so adapters receive the correct shape."
Status: Resolved — Correction (2026-07-14): Plan Step 2.4 amended in place with op-tracking, the expanded `pendingCache` entry type `{ op, buffer, timer, resolve, reject }`, shape-correct resolution, and clear-before-rearm timer reset.
