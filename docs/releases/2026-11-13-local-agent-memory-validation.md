# Local agent memory validation

Implemented on `codex/local-agent-memory` in an isolated managed checkout. No merge, push, publication, installed-project upgrade or live user-database migration was performed. Existing edits in the original checkout were preserved.

## Final evidence

- `npm run check`: pass.
- `npm test`: 77 tests passed, zero failures.
- `npm run test:package`: pass; real tarball installation, bootstrap removal, legacy hook recall, opt-in startup/capture, capability-protected checkpoint handoff, source-history isolation, custom-home terminal preflight, doctor, update, rollback, failed-install preservation and uninstall.
- `git diff --check`: pass.
- Independent whole-branch review found concrete defects. The single fix pass added executable regressions for every Critical/Important finding and the exact-fit size violation, observed failures and verified the corrected behavior. No second model review was used as a substitute for tests.

## Live validation limits

An earlier read-only Codex CLI pilot retrieved synthetic decisions and a marker absent from its prompt through MCP. That pilot preceded final session-capability enforcement. Automatic approval review blocked the final live recheck because it would transmit a temporary synthetic capability in an external model prompt; that action was not retried or routed around. Final capability behavior is covered by real local MCP process and installed-hook tests. Claude Code was unauthenticated, and native all-client startup/stop invocation remains unverified.

## Implementation rulings

Ruling: implement and verify database upgrades only in temporary test databases; no live database or installed connection upgrade — limits irreversible effects while making changes reviewable.
Ruling: legacy connections do not run new migrations; conversation-mode connections explicitly upgrade. Unmodified old releases cannot be made to reject new schemas retrospectively; installer rollback must enforce compatibility.
Task 3: Ruling: share a bounded JSONL metadata scanner for Codex and Claude instead of one forwarding file per provider — inspected local headers establish the formats; unsupported metadata is diagnosed. Antigravity retains its existing importer.
Task 3: Ruling: new conversation MCP mode is explicitly local-only; existing authenticated HTTP mode and browser picker remain legacy and covered by their existing tests — ordinary-chat/remote redesign is outside the agreed local scope.
Task 5: Ruling: context checkpoint combines attributed entries plus revision metadata instead of pretending source and destination are one Checkpoint — preserves both provenances and avoids silently resolving conflicts. Legacy MCP responses remain unchanged.
Task 6: Ruling: capture health lives beside the durable delivery queue, not in the main memory schema — permits diagnostics when main-store delivery fails and avoids requiring memory migration just to inspect capture health.
Task 6: Ruling: live validation is a synthetic read-only Codex MCP recall pilot plus installed-shell-hook/process tests. Claude is unauthenticated; native all-client lifecycle invocation is not claimed — existing user installations remain untouched.
Final: Ruling: add startup-issued hashed session capabilities to conversation MCP tools — existing session IDs alone were insufficient to enforce the intended session boundary. Local CLI hooks remain trusted; remote/legacy contracts remain unchanged. Cost: upgraded coding agents must retain the capability from startup instructions.
Final: Ruling: evidence and checkpoint revision cutoffs are separate, and source provenance is snapshotted — makes selections stable until explicit re-selection. Cost: newer source changes intentionally require re-selection.
Final: minor (deferred): scope-aware SQL pagination/targeted evidence lookup for very long histories; removed redundant full-history fetch in context but retrieval still scans the permitted history.
Final: Ruling: local repositories without origin use git-common-dir identity; existing installed project IDs are retained when reconnecting — fixes worktree routing without abandoning old installed data. Cost: uninstalled source-only local DBs using the old workspace hash need deliberate migration/import.

## Remaining work

- Optional explicitly approved final external-model recall pilot with a temporary synthetic capability.
- Native lifecycle tests in authenticated clients, separately from process fixtures and installed shell-hook execution.
- SQL pagination and targeted evidence lookup for very long permitted histories. Serialized recall is bounded today, but backend queries still scan permitted history.

See [local memory setup and recovery](../clients/local-agent-memory.md) before explicitly opting an installation in.
