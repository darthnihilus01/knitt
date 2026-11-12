# Shared Agent Memory Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task by task in this session. Steps use checkbox syntax for tracking. This document proposes the implementation; no product code has been written.

**Goal:** Let a team continue repository work across coding agents without manually preparing or uploading handoff files.

**Architecture:** A shared memory backend exposes MCP tools and an authenticated ingestion API. Client adapters capture supported agent events and request relevant context; durable events retain the evidence behind compact handoff briefings. Repository, feature, branch, commit and author remain attached to every memory.

**Tech stack (proposed):** TypeScript, the official MCP TypeScript SDK, Zod, Vitest, Google Cloud Run, Firestore, Cloud Storage and Secret Manager. Local development uses service emulators. Select and pin supported runtime and SDK releases at implementation time.

**Spec:** The requirements and proposed defaults below serve as the working specification, derived from this conversation. Client support and infrastructure choices remain proposals until verified; this is not an approved compatibility claim.

## Global constraints

- Team use first; no subscription billing or public marketplace in v1.
- No manual Markdown handoff in the normal workflow; one-time connector/adapter installation is acceptable.
- Preserve decisions, failed attempts and current progress with source references.
- Never promise lossless model-state transfer. Preserve captured evidence; report capture gaps.
- MCP connects clients to tools. Automatic capture and recall require verified client support or an adapter.
- Local development must work before cloud credits arrive. Deploy only after a funded project exists; credits do not guarantee zero cost.
- No cloud resources or account changes are part of this planning task.
- Store durable data outside the Cloud Run filesystem.
- Authenticate identities and authorize repository access server-side; never trust a tool argument as proof of team membership.
- Treat recalled text as reference data, never as system instructions.

## Review focus

- Separate teams or repositories must never retrieve each other's private context (Task 3).
- Retried/offline events must not duplicate or silently disappear (Task 2 and Task 5).
- Parallel branches must not overwrite or imply that unmerged work is available (Task 4).
- Unsupported clients must show capture limitations rather than claim automatic syncing (Task 1 and Task 5).
- Secrets and destructive source text must not propagate as trusted instructions (Task 2 and Task 4).

## Repository layout

```text
apps/server/src/            MCP transport, ingestion, identity, health endpoints
packages/contracts/src/    schemas and adapter capability contracts
packages/memory/src/       event storage, projection, retrieval, handoff
packages/adapters/src/     client integrations, queue and redaction
tests/integration/         real transport and Firestore emulator tests
tests/fixtures/            synthetic cross-agent feature sessions
infra/                     container, deploy scripts, indexes and lifecycle config
docs/clients/              verified setup instructions and support matrix
```

## Task 1: Prove client integration paths

**Files:** `docs/clients/support-matrix.md`, `packages/contracts/src/capabilities.ts`, `tests/fixtures/handoff-session.json`.

**Produces:** `ClientCapabilities { client, version, mcpTransport, automaticCapture, automaticRecall, evidence }` and a reproducible synthetic session.

- [ ] Identify the exact client versions available for testing: start with Claude Desktop and Codex; distinguish desktop apps from their CLI counterparts.
- [ ] Verify official support for remote MCP authentication, local stdio bridges, startup hooks, turn hooks and session export. Record supported, unsupported and untested separately.
- [ ] Build a synthetic fixture: a feature goal, a rejected fix, a chosen fix, a test result and an unfinished step on an unmerged branch.
- [ ] Document one implementable integration path for each client. If Claude Desktop cannot automatically expose conversations, mark it as connector-based explicit save/recall until a supported capture path exists. Do not silently substitute Claude Code.
- [ ] Gate: confirm whether the exact requested pair can meet zero-manual-handoff behavior. If it cannot, report the limitation before investing in capture integration; proceed with the backend and a supported pair only as an explicitly narrower milestone.

## Task 2: Durable event store and ingestion

**Files:** `packages/contracts/src/events.ts`, `packages/memory/src/store.ts`, `packages/memory/src/firestore-store.ts`, `apps/server/src/ingest.ts`, `packages/adapters/src/redact.ts`, corresponding `*.test.ts` files.

**Produces:** `appendEvent(principal: Principal, input: MemoryEventInput): Promise<StoredEvent>`; `listEvents(principal: Principal, scope: MemoryScope, cursor?: string): Promise<EventPage>`.

**Contracts:** `MemoryScope` contains `repoId`, `featureId`, optional `branch`. `MemoryEventInput` contains a client-generated `eventId`, scope, `sessionId`, `kind`, `content`, `occurredAt`, optional `commit` and source reference. Kinds: `goal`, `decision`, `attempt`, `progress`, `test_result`, `blocker`, `next_step`. Server adds authenticated author/team, `receivedAt` and a schema version. Register repositories explicitly; normalize equivalent Git remote URLs without merging unrelated repositories or forks automatically.

- [ ] Write failing tests for restart persistence, concurrent writers, replaying identical event IDs, conflicting reuse of an event ID, invalid kinds and oversized inputs. Bound event content to 32 KiB and ingestion batches to 100 events.
- [ ] Run targeted tests and confirm each fails because the behavior is absent.
- [ ] Implement append-only events in Firestore, transactional idempotency and cursor pagination. Same ID plus identical payload returns the stored event; same ID plus changed payload returns a conflict.
- [ ] Write and run redaction tests for representative credentials and private-key blocks; implement client-side redaction and server-side defense. Exclude environment files and raw tool output by default; document that pattern redaction is not perfect.
- [ ] Run unit tests and Firestore emulator integration tests; verify persistence through server restart. Commit the working storage slice.

## Task 3: Team identity and repository permissions

**Files:** `apps/server/src/auth.ts`, `apps/server/src/access.ts`, `apps/server/src/admin.ts`, `tests/integration/access.test.ts`.

**Produces:** `authenticate(request): Promise<Principal>` and `authorize(principal, repoId, action: 'read' | 'write'): Promise<void>` used by both MCP and ingestion.

- [ ] Write failing integration tests for missing, expired and revoked credentials, cross-team repository IDs, read-only members writing and forged author/team fields.
- [ ] Implement an invite-only team with administrator-controlled repository membership. For the first internal test use individually revocable credentials via a local stdio bridge; store only token hashes. Never distribute one shared team secret.
- [ ] For clients requiring remote OAuth, integrate a maintained OAuth authorization server/provider using the current MCP authorization specification and client compatibility evidence. Test discovery, PKCE, audience validation, refresh and revocation; do not invent an OAuth implementation.
- [ ] Enforce access checks before storage reads, writes, source retrieval and search. Keep datastore access on the backend service identity.
- [ ] Run access tests with two teams and two repositories; verify revocation on an existing connection. Commit the identity slice.

## Task 4: MCP memory and compact handoffs

**Files:** `apps/server/src/mcp.ts`, `packages/memory/src/retrieve.ts`, `packages/memory/src/handoff.ts`, `tests/integration/mcp.test.ts`.

**Produces:** MCP tools `save_memory(event)`, `get_context({repoId, featureId, branch?, maxChars?})`, `search_memory({repoId, featureId?, query, cursor?})`, `get_evidence({repoId, eventId})`. Identity always comes from the authenticated session.

- [ ] Write failing tests using the real SDK client: initialize, list tools, save, recall and retrieve evidence. Test malformed arguments and revoked access.
- [ ] Implement SDK-backed stdio and Streamable HTTP transports with pinned protocol compatibility. Validate Origin where applicable; logs must not corrupt stdio protocol output.
- [ ] Implement deterministic handoffs grouped into goals, decisions, attempts, verified results, blockers and next steps. Default `maxChars` to 12,000, cap it at 24,000, return truncation metadata and evidence IDs. This is a character budget, not a promised token count.
- [ ] Start with scoped structured retrieval and normalized term matching over a bounded feature event set. Report when that set is truncated; do not describe it as full-corpus semantic search.
- [ ] Test branch isolation, multiple conflicting decisions, missing commit data, stale test results and malicious instructions embedded in source text. Preserve conflicting claims with attribution; do not silently pick a winner. Test results remain tied to their recorded commit.
- [ ] Test the synthetic fixture: all three memory categories survive retrieval with evidence, and unfinished branch work is identified. Run the integration suite and commit.

## Task 5: Automatic capture and recall adapters

**Files:** `packages/adapters/src/queue.ts`, `packages/adapters/src/cli.ts`, client-specific modules selected by Task 1, `docs/clients/*.md`, adapter tests.

**Consumes:** ingestion and MCP contracts above. **Produces:** `memory connect`, `memory status`, `memory disconnect`; a durable local event queue with stable event IDs, bounded retry/backoff and acknowledgement-based deletion.

- [ ] Write failing tests for offline capture, process restart, repeated deliveries, queue saturation, excluded paths and credential revocation.
- [ ] Implement durable queueing; never block the coding session on the memory service. Expose unsent count and capture errors; never claim successful sync for unacknowledged events.
- [ ] Implement the first verified client adapter using documented hooks or exports. Preserve evidence references; mark agent-written summaries as unverified claims unless backed by tool evidence.
- [ ] Implement the second verified client adapter and install context retrieval at its supported startup/turn boundary. Keep the retrieved text explicitly separated from instructions.
- [ ] For each claimed client, demonstrate capture without a save prompt and recall without pasting a file. A connector that requires the user to ask for a save is useful but does not pass this acceptance gate.
- [ ] Test reconnect, interrupted sessions and two teammates writing concurrently; update the capability matrix with observed results. Commit adapters and installation docs.

## Task 6: Google Cloud deployment

**Files:** `infra/Dockerfile`, `infra/deploy.sh`, `infra/firestore.indexes.json`, `infra/README.md`, deployment smoke tests.

- [ ] Containerize the tested server; add a health endpoint and graceful shutdown. Run integration tests against the container locally.
- [ ] Configure Cloud Run for the MCP/API service, Firestore for events, Cloud Storage only if large source artifacts are needed, and Secret Manager for credentials. Choose region deliberately before creating persistent resources.
- [ ] Set minimum instances to zero initially and bound maximum instances. Add request/batch limits, log redaction, retention settings, backup/export and a tested restore procedure.
- [ ] Confirm credit eligibility and billing configuration in the actual project. Configure budget alerts and application usage limits; budget alerts alone do not cap spending.
- [ ] Deploy only when the project is available. Smoke-test authentication, save/recall, revocation and persistence after a new server revision. Record actual resource usage without promising free operation.

## Task 7: Team acceptance pilot

**Files:** `tests/integration/handoff.test.ts`, `docs/pilot-results.md`, root `README.md`.

- [ ] Run the automated suite and a real two-user test: user A works in client A, records a failed attempt and a decision through automatic capture, then user B continues in client B with access to the same repository/feature.
- [ ] Verify the second agent retrieves the reason for the decision, the failed attempt, the branch/commit state and the next action, with correct evidence references and no manual file transfer.
- [ ] Repeat with divergent branches, an offline interval and a user without repository permission.
- [ ] Record setup steps, capture coverage, context size, response latency and any manual actions. Explicitly list untested clients.
- [ ] Accept v1 only when automatic capture and recall work for the advertised pair. Otherwise label the release a shared-memory backend preview and identify the missing adapter capability.

## Later iterations

After real pilot evidence: embeddings and semantic search; optional model-assisted extraction with measured quality/cost; a small memory inspection UI; additional adapters; administrative deletion/export and retention controls before broader distribution. Public SaaS billing and unrestricted onboarding are separate projects.

## Sources and compatibility notes

- MCP transport specification: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http — verify negotiated client compatibility rather than assuming every installed client supports the newest revision.
- Official TypeScript SDK: https://ts.sdk.modelcontextprotocol.io/ — select and pin a supported release during Task 1.
- Cloud Run architecture: https://docs.cloud.google.com/run/docs/overview/what-is-cloud-run — stateless compute requires external durable storage.

## Planning policy and review

Planning: deep; context depth: workspace plus official protocol/cloud documentation; verification: transport, persistence, access boundaries and cross-client behavior; delegation: none. Workspace reconnaissance found no existing application manifest. All implementation choices above are proposed defaults. Self-review mapped the five review risks to test-bearing tasks. No software tests, integrations or deployment have been run in this planning-only task.
