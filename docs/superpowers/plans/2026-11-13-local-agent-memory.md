# Local Agent Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Delegate only if subsequently authorized.

**Goal:** Improve local coding-agent memory so new work is captured, continuations retain separate histories, and handoffs deliver useful cited checkpoints.

**Architecture:** Retain SQLite, local hooks, durable queues and MCP. Add explicit conversations and session mappings, destination-owned continuation links, and structured checkpoint revisions over captured evidence. Keep legacy connections operational while conversation mode is introduced explicitly.

**Tech Stack:** TypeScript, Node.js 24+, SQLite via `node:sqlite`, existing MCP SDK, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-13-local-agent-memory-design.md` — proposed; review before implementation.

## Global Constraints

- Continue using TypeScript, Node.js 24+, SQLite, hooks and MCP.
- A repository remains the access boundary.
- New-session capture is enabled only through an explicit setup preference for connected projects.
- No automatic model inference is required.
- Preserve the existing `maxChars` default of 12000 and range 256–24000.
- No cloud, ordinary-chat integrations, embeddings, vector database, automatic semantic extraction, recursive lineage recall, background daemon or deletion/retention redesign in this milestone.

## Review Focus

- Existing databases and runtime rollback must not silently lose evidence after schema changes; Task 1.
- Identical native session IDs from different clients and concurrent destinations must remain distinct; Tasks 1–2.
- A canceled or switched selection must not relocate captured messages or reveal unrelated source evidence; Task 3.
- Oversized checkpoint entries and multibyte text must not hide all usable recall or exceed its budget; Task 5.
- Missed stop hooks, unsupported transcripts and delivery failures must be visible without claiming complete capture; Task 6.

## File responsibilities

Existing `packages/contracts/src/events.ts` and `packages/memory/src/store.ts` retain legacy APIs. Add `packages/contracts/src/conversations.ts` for new schemas, `packages/memory/src/migrations.ts` for versioned upgrades, `packages/memory/src/conversations.ts` for conversation persistence, and `packages/memory/src/context.ts` for context assembly. The existing store owns and shares its SQLite connection with these modules.

Add `packages/adapters/src/discovery.ts` for provider interfaces and `packages/adapters/src/providers/{antigravity,codex,claude}.ts` for discovery/import adapters. Keep `handoff.ts` as a compatibility entry point. Add `packages/adapters/src/status.ts` for content-free capture status. Update `cli.ts`, hooks, MCP server, installer configuration and relevant docs in the tasks that change their behavior.

## Task 1: Add conversation identity and safe schema upgrades

**Files:** Create the contracts, migrations and conversation persistence modules above; modify `store.ts`; create `tests/conversations.test.ts` and `tests/migrations.test.ts`; extend `tests/runtime.test.ts`.

**Interfaces:** Define `SessionKey = { repoId: string; client: string; nativeSessionId: string }` and `Conversation = { repoId: string; conversationId: string; title: string; client: string }`. Add store methods `ensureSession(key: SessionKey, location: { workspace: string; branch?: string; commit?: string }): Conversation`, `listConversations(repoId: string): Conversation[]`, and `appendEvidence(key: SessionKey, event: MemoryEvent): StoredEvent`. Add evidence mappings keyed by repository/event ID without changing legacy event payloads. Internal schema upgrades use `migrate(db: DatabaseSync): void`.

- [ ] Write migration tests from an existing-schema fixture. Assert reopening preserves event IDs, content and legacy search results; retrying migration changes no rows. Assert a deliberately failed migration leaves the previous schema usable and a newer unsupported version is rejected.
- [ ] Run `node --test tests/migrations.test.ts tests/conversations.test.ts`; confirm tests fail for the missing APIs.
- [ ] Implement additive schema tables for conversations, native-session mappings, evidence mappings and version metadata. Enforce repository-scoped uniqueness, idempotent session creation and transactional writes. Use a consistent SQLite backup before upgrading a file-backed database; never back up a WAL database by copying only its main file.
- [ ] Assert different clients with the same native ID get different conversations, restart returns the same mapping, and evidence cannot be reassigned to another conversation. Test runtime downgrade refusal without altering newer data.
- [ ] Run the focused tests and `npm run check`. Commit the scoped implementation as `feat: add local conversation identity and versioned storage`.

## Task 2: Capture independent new-session history

**Files:** Modify `packages/adapters/src/{cli,hooks,transcript,scope}.ts`, `packages/installer/src/{connections,cli,runtime}.ts`; extend `tests/{transcript,adapters,installer,selection}.test.ts`.

**Interfaces:** Consume `ensureSession` and `appendEvidence`. Add an explicit installer preference `--capture-new-sessions` persisted as `MEMORY_CAPTURE_NEW_SESSIONS=1`; include `MEMORY_CONVERSATION_MODE=1` for upgraded connections. Existing configuration without those values retains legacy semantics. Keep incremental cursor and deduplication algorithms.

- [ ] Add failing tests: an opted-in unlinked session captures to its own conversation; a default existing installation retains its behavior; a continued session writes to its own conversation; retry and restart do not duplicate evidence.
- [ ] Run `node --test tests/adapters.test.ts tests/transcript.test.ts tests/selection.test.ts tests/installer.test.ts`; identify the new expected failures.
- [ ] Route conversation-mode capture through the native-session mapping independently of recall selection. Record current workspace, branch and commit where available; detached HEAD must retain commit provenance without inventing a branch. Preserve repository validation and redaction before durable writes.
- [ ] Test simultaneous sessions, wrong repository, transcript truncation, incomplete lines and unsupported message formats. Preserve legacy queue draining and ensure pending legacy records retain their old identity.
- [ ] Run focused tests and `npm run check`. Commit as `feat: capture new agent sessions independently of continuation`.

## Task 3: Discover and explicitly link conversations

**Files:** Create discovery/provider modules; modify `handoff.ts`, `picker.ts`, `launch.ts`, `server.ts`, `web-picker.ts` and conversation persistence; extend `tests/{handoff,selection,session-picker,http-gateway}.test.ts`.

**Interfaces:** Define `DiscoveredConversation = Conversation & { sourceId: string; workspace: string; modified: string }` and `ConversationProvider = { client: string; discover(workspace: string): DiscoveredConversation[]; import(source: DiscoveredConversation, store: MemoryStore): { conversationId: string; captured: number } }`. Add `linkSource(key: SessionKey, sourceConversationId: string): { sourceConversationId: string; throughSeq: number }` and `selectedSource(key: SessionKey): { sourceConversationId: string; throughSeq: number } | null`.

- [ ] Test listing stored conversations from every captured client, provider-qualified ID collisions, filtering to the repository/worktrees and lazy import after selection. Test source links A→B and A→C without modifying A's evidence.
- [ ] Run `node --test tests/handoff.test.ts tests/selection.test.ts tests/session-picker.test.ts`; confirm missing behavior fails.
- [ ] Wrap existing Antigravity discovery in the provider interface. Inspect supported local Codex and Claude Code formats using content-minimizing fixtures; implement only evidenced formats. Missing directories and unsupported versions return diagnostics, not fabricated histories. Stored Knitt conversations remain selectable even when an external adapter is unavailable.
- [ ] In conversation mode, update picker, launch and MCP selection to create destination-owned links with a source sequence cutoff. Verify session identity against the bound connection; never accept a caller-supplied destination conversation as authority. Reject self-links and cross-repository links. Cancellation retains the prior link, if any; switching never moves evidence.
- [ ] Test changed source after selection, deliberate re-selection refreshing the cutoff, two concurrent destinations, and HTTP owner isolation. Keep legacy selection behavior and existing response fields for legacy connections.
- [ ] Run focused tests, `node --test tests/http-gateway.test.ts` and `npm run check`. Commit as `feat: discover local conversations and link explicit continuations`.

## Task 4: Save cited structured checkpoints

**Files:** Extend conversation contracts and persistence; modify `server.ts`; create `tests/checkpoints.test.ts`; extend `tests/mcp.test.ts`.

**Interfaces:** Define `CheckpointEntry = { id: string; category: 'goal' | 'decision' | 'attempt' | 'progress' | 'test_result' | 'blocker' | 'next_step'; content: string; evidenceIds: string[]; status: 'reported' | 'verified'; supersedes?: string }`. Define `Checkpoint = { checkpointId: string; conversationId: string; throughSeq: number; entries: CheckpointEntry[] }`. Add `saveCheckpoint(key: SessionKey, entries: CheckpointEntry[]): Checkpoint` and `latestCheckpoint(repoId: string, conversationId: string, throughSeq?: number): Checkpoint | null`.

- [ ] Add tests for complete checkpoint round trips, missing citations, nonexistent evidence, citations outside the destination's permitted context, stale coverage, revisions and explicit supersession. Reject empty entry text, duplicate entry IDs and dangling supersession references.
- [ ] Run `node --test tests/checkpoints.test.ts tests/mcp.test.ts`; confirm the new tests fail before implementation.
- [ ] Add conversation-mode `save_checkpoint` with Zod validation, append-only revisions and idempotent checkpoint submission. Permit citations only to destination evidence or the directly selected source within its cutoff. Preserve legacy `save_memory` behavior.
- [ ] Treat MCP-submitted test claims as `reported`; only trusted execution evidence can establish `verified`. This milestone has no new trusted execution capture, so reject unsupported promotion. Return explicit unknown verification rather than interpreting assistant prose as proof.
- [ ] Update local agent instructions to save a checkpoint after substantive milestones. Saving is best effort and must not block the coding turn or promise that every agent will comply.
- [ ] Run focused tests and `npm run check`. Commit as `feat: persist structured checkpoints with scoped evidence`.

## Task 5: Return useful bounded handoff context

**Files:** Create `packages/memory/src/context.ts`; modify `server.ts` and recall instructions in `hooks.ts`; extend `tests/{store,mcp,checkpoints}.test.ts`.

**Interfaces:** Add `getConversationContext(key: SessionKey, options: { maxChars?: number }): { checkpoint: Checkpoint | null; events: StoredEvent[]; provenance: object; stale: boolean; truncated: boolean; omitted: { entries: number; events: number }; contentTrust: 'untrusted_reference' }`. `maxChars` bounds the serialized returned object. When even the metadata envelope cannot fit, return a bounded compact response stating truncation. Source checkpoint selection must respect `throughSeq`.

- [ ] Add an acceptance fixture with an early rejected approach/decision and enough later messages to exceed the budget. Assert cited checkpoint entries remain available, recent destination evidence is present, unrelated sessions are absent and `JSON.stringify(result).length <= maxChars`.
- [ ] Run `node --test tests/store.test.ts tests/mcp.test.ts tests/checkpoints.test.ts`; confirm new retrieval tests fail.
- [ ] Implement deterministic assembly: metadata first, checkpoint entries up to half the budget, then recent evidence; skip items that cannot fit and account for final JSON escaping and metadata size. Return source checkpoint plus destination checkpoint entries when available, with attribution and explicit supersession; report conflicting claims rather than resolving them by assumption. Do not traverse ancestors.
- [ ] Test the 256-character minimum, default 12000, maximum 24000, oversized first entry, multibyte/escaped content, no checkpoint, stale checkpoint, old-source cutoff and branch/commit drift metadata. Missing checkpoints fall back to evidence and say so.
- [ ] Keep legacy `get_context` output unchanged outside conversation mode. Ensure `search_memory` and `get_evidence` resolve the same permitted destination/source set and respect cutoff, repository and session checks.
- [ ] Run focused tests and `npm run check`. Commit as `feat: assemble bounded checkpoint-first handoff context`.

## Task 6: Expose capture health and prove local handoffs

**Files:** Create `packages/adapters/src/status.ts`; modify adapter CLI and installer doctor; extend `tests/{adapters,runtime,mcp}.test.ts`; update `docs/{usage,implementation-progress}.md` and `docs/clients/{support-matrix,npm-installation}.md`.

**Interfaces:** Define `CaptureStatus = { session: SessionKey; lastCaptureAt: string | null; lastDeliveryAt: string | null; pending: number; lastErrorCode: string | null }`. Persist via `recordCaptureStatus(status: CaptureStatus): void`; expose through `knitt doctor` without message text or credentials.

- [ ] Add process tests: capture in one client fixture, close it, select the conversation from a second MCP process, retrieve the early decision, capture destination progress, and assert the source evidence is unchanged after restart. Repeat with two independent destinations.
- [ ] Test pending queue, failed delivery, unsupported format and no hook invocation. Distinguish configuration present, capture observed, evidence delivered and live handoff verified; lack of a capture record must not be described as a successful capture.
- [ ] Implement status recording and doctor output; retain the existing queue and invocation-driven retries. Do not add a daemon or claim a missed hook can be detected at the instant it fails to run.
- [ ] Run `npm run check`, `npm test` and `npm run test:package`. Record exact results; do not replace blocked package/process checks with claims based on unit tests.
- [ ] Run a user-authorized live handoff in the available local clients using synthetic facts, including one fact deliberately absent from the destination prompt. Verify native capture, selection, recall and destination-only continuation writes. Report unavailable clients separately; fixture success is not live compatibility.
- [ ] Update usage with opt-in capture, selection/cancellation, checkpoint provenance, schema recovery and real support evidence. Commit as `feat: report capture health and verify local agent handoffs`.

## Delivery order and completion

Tasks 1–3 establish independent capture and explicit continuation; Tasks 4–5 improve recall; Task 6 validates the installed product. Do not expose conversation mode as generally supported until the relevant process and installed-runtime checks pass.

Before execution, review the proposed design and capture preference. During execution, record evidence per task and review the final changes for source-history mutation, cross-repository access and compatibility. No implementation, installation upgrade, database migration or live conversation import is authorized merely by this plan document.
