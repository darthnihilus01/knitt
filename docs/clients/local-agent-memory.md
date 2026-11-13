# Local conversation memory preview

This opt-in mode separates each coding session's evidence from the source conversation it continues. It remains local to one machine and uses the existing SQLite database, hook delivery queue and MCP server. Legacy connections keep their existing behavior.

## Enable for a connected project

Build and pack this checkout, then use that tarball with the installer:

```bash
npm run check
npm test
npm run build
npm pack
```

Run the packaged CLI with `setup --workspace /absolute/path/to/project --client codex --client claude-code --capture-new-sessions --package /absolute/path/to/package.tgz --preview`. Review the output, then rerun without `--preview` to apply. `--capture-new-sessions` opts the connected project into capture of supported user/assistant text in fresh sessions; it is retained across subsequent setup/update operations. Select only clients you use. Restart them and approve MCP and hook trust using their normal interfaces.

No existing installation is upgraded by building this source. A connection upgrade creates a consistent, private SQLite backup beside an existing database before migrating its schema. New session identity is keyed by repository, coding client and native session ID. Branch and commit are provenance rather than identity.

## Continue work

Use `/continue-chat` in a fresh native agent session. The startup hook provides its native session ID. Pick the source explicitly. The destination keeps its own history; its direct source is limited to the evidence available when selected. Canceling preserves the previous link if one exists. Re-selecting refreshes the source cutoff. Ancestors are not recursively recalled.

The picker includes stored Knitt conversations and supported local Antigravity, Codex and Claude Code JSONL histories. External discovery reads bounded metadata from known client directories and imports text only after selection. Unsupported metadata and missing directories produce diagnostics. Titles for Codex/Claude discovery currently use the client and native session ID. Clients' local formats can change; fixture support does not establish live support for every release.

When MCP form selection is unavailable, use `knitt continue --workspace /absolute/path/to/project --session NATIVE_SESSION_ID --client codex` interactively, with the same `--home` as installation if customized. Use `claude` for Claude Code's native adapter name. The terminal picker requires a session already registered by its startup hook and uses the installation database. It does not reconfigure the project or launch an agent.

## Checkpoints and evidence

Ask the agent to use `save_checkpoint` for goals, decisions, rejected attempts, progress, test claims, blockers and next steps. Every entry requires real evidence IDs accessible to that session. Hooks capture on supported lifecycle invocations, so evidence may not exist until capture runs; use `save_memory` to explicitly record a checkpoint's supporting statement when necessary. Never invent citations.

Checkpoints are derived claims, not proof that tests ran. This preview accepts `reported` status and rejects unsupported `verified` claims. The server validates citations and scope but cannot establish semantic truth. Explicit supersession preserves old revisions and original evidence.

Recall prioritizes cited checkpoint entries and recent text, with attribution, branch/commit metadata, staleness and omission indicators. The serialized result is bounded to 12000 characters by default (256–24000 configurable); this is not a token count. Very small budgets omit metadata and say so. Search and evidence tools can retrieve older details within the same destination/direct-source scope. Switching sources excludes checkpoint entries whose citations no longer belong to the permitted scope.

## Observe capture

`knitt doctor --home /installation/home` reports whether any capture status has been observed, last successful capture/delivery timestamps, queued counts and fixed error codes. It does not log message text. No observation means capture is unknown, not healthy. A missed stop hook cannot be diagnosed at the instant it fails to run; the next invocation or explicit inspection is needed. Queue retries remain invocation-driven, without a background daemon.

## Compatibility and recovery

Keep the backup together with its schema version. To restore, first stop all connected servers and hooks; retain the current database and its WAL/SHM files for recovery, then restore a consistent backup through an explicit recovery operation. Restoring a backup discards later changes from the active database; never do this automatically as part of runtime rollback.

The updated installer refuses a target runtime whose declared supported schema is older than the database. Missing compatibility metadata means legacy schema zero. Old already-published binaries cannot be retroactively changed: invoking those directly bypasses the new installer's guard. Keep using the compatible installed CLI for update/rollback.

The conversation-mode server is for local coding clients. Ordinary-chat/HTTP connectors retain their legacy behavior; this change does not make remote clients conversation-aware.

## Verification

Automated tests cover schema preservation/recovery, independent capture, deduplication, explicit selection/cancellation, source cutoffs, checkpoint citations, bounded Unicode recall, capture health and incompatible runtime refusal. Installed-package smoke tests exercise legacy and conversation-mode hooks/MCP, checkpoint handoff, source-history isolation, doctor, update, rollback, failed installation preservation and uninstall. See the implementation progress record for live-client evidence and remaining limits.
