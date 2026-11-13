# Local agent memory design

Status: proposed design accompanying the requested implementation plan; product code is unchanged.

## Intent

Make local coding-agent handoffs preserve useful context across new and continued sessions, without combining their source histories or requiring a cloud service. Continue using TypeScript, Node.js 24+, SQLite, hooks and MCP.

## Problems established by source inspection

- `packages/adapters/src/cli.ts` skips capture when a native session has no selected source conversation.
- `packages/adapters/src/handoff.ts` discovers Antigravity conversations only, although transcript parsing supports multiple message formats.
- Captured transcript messages become `progress` events. `MemoryStore.context` returns recent events within a character budget; it does not construct a structured checkpoint.
- Continuing sessions capture under the selected source feature. This preserves session IDs but does not model separate conversations and explicit continuation relationships.

## Approaches

1. Patch the existing feature-based pipeline: smallest change, but retains the coupling between selection, storage identity and recall.
2. Conversation-centered core: separate source conversations, native sessions, continuation links, evidence and derived checkpoints. Recommended foundation for local handoffs.
3. Background indexing daemon: can discover missed capture, but introduces a persistent process and recovery requirements before the core model is ready.

The user requested a plan after the conversation-centered proposal. These details are proposed implementation decisions, not an assertion that every detail has been approved.

## Model and boundaries

- A repository remains the access boundary. Worktrees are locations within that repository; branches and commits are recorded provenance, not conversation IDs.
- A conversation owns its captured evidence. A native session has a stable mapping keyed by repository, client and native session ID.
- A continuation link belongs to the destination session and records the selected source conversation and the source evidence sequence at selection. Selection never moves destination evidence into the source conversation.
- Source switching changes the destination's active link, not its captured history. Cancellation preserves any existing link; a new session remains unlinked. Re-selecting deliberately refreshes the source cutoff.
- Default recall includes the destination's evidence and its directly selected source up to that cutoff. Do not recursively traverse continuation ancestry in this milestone.
- New-session capture is enabled only through an explicit setup preference for connected projects. Existing installations keep their capture behavior until that preference is enabled. Capture never implies permission to recall another chat.
- Original means supported, redacted user/assistant text; raw tool output, images and hidden reasoning remain excluded. Retain stable evidence IDs and source locations.

## Checkpoints and retrieval

A checkpoint contains goal, decisions, failed attempts, progress, verification, blockers and next steps. Each entry contains evidence IDs and a status distinguishing a reported claim from independently verified execution. Omit unknown fields rather than inventing values.

No automatic model inference is required. Agents explicitly submit structured checkpoints through MCP; the server validates scope and citations but cannot prove semantic truth. Raw transcript capture remains a separate operation. Store checkpoints as append-only revisions with a coverage sequence; newer evidence marks them stale. Explicit supersession retires an old entry without deleting its evidence.

Recall returns a bounded checkpoint plus recent evidence and source/worktree metadata. Preserve the existing `maxChars` default of 12000 and range 256–24000; measure the serialized context payload, excluding MCP protocol wrappers. Reserve at most half the budget for checkpoint entries and use remaining capacity for recent evidence. Skip entries that do not fit and report all omissions. Keep evidence and search tools available for older detail. Do not claim a character limit is an exact model-token limit.

## Compatibility and operations

- Add versioned SQLite tables and mapping tables without rewriting existing event payloads or IDs. Preserve legacy tool behavior until the connection is explicitly upgraded to conversation mode.
- Expose stored Knitt conversations in the picker, alongside supported external sources. Use provider-qualified identities and lazy import only after selection.
- Add Codex and Claude Code history discovery only after inspecting their actual supported local formats. Unsupported versions return actionable diagnostics; do not guess paths or scan arbitrary home-directory content.
- Keep existing durable ingestion queues and incremental transcript cursors. Add per-session capture/delivery status without logging message content.
- Database upgrades require a consistent SQLite backup, schema-version checks and a recovery procedure. Old binaries must refuse newer unsupported schemas. Runtime rollback after a schema upgrade requires a compatible binary or explicit backup restoration; never silently restore and lose newer data.

## Scope and acceptance

Deliver local capture, explicit continuation, stored-chat discovery, cited structured checkpoints, bounded recall and observable failures. Preserve repository isolation, explicit user selection, redaction, retry deduplication and unrelated client settings.

No cloud, ordinary-chat integrations, embeddings, vector database, automatic semantic extraction, recursive lineage recall, background daemon or deletion/retention redesign in this milestone.

Acceptance: a newly captured source session can be selected in a second supported agent; the destination receives an older cited decision and the current next step; subsequent destination capture leaves source history unchanged. Cancellation, concurrent destinations, restarts, stale checkpoints and worktree changes preserve these properties. Live support is reported per tested client, separately from fixture results.
