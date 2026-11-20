# Reliable cloud history onboarding validation

Implementation is isolated on `codex/reliable-cloud-onboarding`, based on source snapshot `c960ee24ea2610e0698fa92314f57ebdab760e35`. The original checkout's changed files were compared to this snapshot and remain unchanged.

## Behavior delivered

- Derived setup states and next actions distinguish account pairing, workspace selection, project consent, pause, pending import, successful uploads and errors. Existing status fields remain.
- Both the native plugin setup skill and the npm-installed `/knit` skill guide users through current-project preview, explicit project selection and upload approval, initial import and verified cloud availability. Existing approved mappings are reused.
- Explicit setup/retry reads back every imported conversation's ID and event count and confirms installation consent. It rechecks local identity and mapping across asynchronous reads. Retained history does not turn paused or disconnected installations into successful setup.
- Incomplete transcripts remain pending. Verification failures remain visible across background imports. Rebinding or disconnecting clears obsolete success timestamps and errors.
- Interrupted uploads retain observed import/delivery counts and queued-work status, plus the cloud project link.
- The cloud always exposes Add or finish project sync. Paused/unfinished/error details open automatically. Project links filter conversations, survive sign-in and offer Show all projects. No conversation is hidden or deleted by title.

## Evidence

- `npm run check`: PASS after final implementation.
- `node --test --test-concurrency=2 tests/*.test.ts`: PASS, 153 tests, zero failures.
- Real Worker plus SQLite integration fixtures exercise pairing, cancellation, approved imports, recognizable titles/messages, incremental updates, idempotency, offline retry, empty discovery, changed/expired previews, failed sources, revoked devices, browser controls and changes during verification.
- `git diff --check`: PASS.
- `npm run test:package`: PASS; clean tarball installation, MCP, capture/recall, update, rollback, uninstall, and cloud consent/retry/sharing checks.
- `node scripts/package-plugins.ts linux-x64`: PASS.
- `node scripts/verify-plugin-artifacts.ts plugin-artifacts/linux-x64`: PASS for Codex, Claude Code and Antigravity bundled runtime, installed MCP tools, startup hooks and persistent-state preservation.

An earlier parallel suite run exceeded MCP timeouts and expired a short-lived fixture session; bounded concurrency subsequently passed all tests. Attempts to run process-based checks inside the restricted sandbox failed with EPERM. The final full-suite run used the approved process environment. The first package run caught an outdated assertion expecting an exception after consent; it now checks the structured error and durable queue instead.

## Independent review

A fresh reviewer identified six Important findings and two Minor findings. All were addressed: npm skill alignment; authoritative remote consent; identity/mapping race checks; durable verification failure state; incomplete-source handling; reset of stale timestamps; preservation of observed progress on failure; and project filter persistence through sign-in. Findings were covered by executable regressions, including observed RED-to-GREEN failures. No deferred review findings.

## Decisions and limits

- Browser UI uses an always-visible setup action rather than asserting knowledge of unselected local workspaces. Cost: users with all projects synced still see the optional action.
- Once consent succeeds, upload failures return structured enabled/error/queue/progress information rather than only a tool exception. Older automation that treated only MCP isError as failure must inspect setupState and cloudVerified; package acceptance checks cover the new contract.
- Shared APIs and schemas are reused. There are no migrations, production changes, user-account sync changes, publication or deployment.
- Actual interactive host UI onboarding and macOS/Windows binaries were not exercised. Linux packaged MCP startup and hook validation passed as listed above.
