# Implementation progress

## Local MCP prototype

Implemented the official SDK stdio transport, SQLite persistence, schema validation, retry idempotency with conflicting-payload detection, repository/feature/branch filtering, bounded retrieval and original evidence lookup.

Ruling: use SQLite for the first executable local milestone because cloud credits and a funded project are pending. Firestore remains the planned shared deployment backend. This postpones cloud datastore integration testing.

Planning policy: compact implementation, contracts/store/transport scope, process integration verification, no delegation.

Verified four tests outside the sandbox. They cover persistence, retries, conflicts, branch/repository filtering, bounded results, input rejection and a fixture transferred across independent MCP server processes. The sandbox closes subprocess input pipes and therefore cannot run that process integration test successfully. TypeScript checks pass.

Pending: real agent capture and recall, authenticated team sharing, redaction, ingestion queue, Firestore, remote HTTP/OAuth, deployment and real two-user pilot. Task 1 remains documented rather than live-verified for desktop apps.

## Hook runner preview

Added a durable SQLite delivery queue, common credential redaction, capture of supported payload text, and client-specific recall instruction output for Claude Code, Codex and Antigravity. Added opt-in configuration examples for Claude Code and Antigravity. No agent configuration was installed.

Adapter tests cover failed delivery/retry/deduplication, redaction before queue delivery, and MCP recall instructions. Full transcript extraction and real agent testing remain pending. Antigravity capture currently preserves latest user input only. Automatic retry is driven by capture/flush invocations rather than a background worker.

## Incremental transcript capture

Added transactional transcript checkpoints and queue writes, source byte offsets, stable event IDs, incomplete-line handling and bounded Unicode-safe event splitting. A synthetic Antigravity hook process now captures a conversation, flushes into SQLite, and a fresh MCP client retrieves the failed attempt, chosen approach and next step. Startup output for Codex is also checked in that integration test.

All 13 tests and TypeScript checks passed. Supported message schemas are fixture-tested, not live desktop-verified. No actual user conversation was imported, no client configuration installed, and no cloud resources provisioned. Automatic extraction into decision/attempt categories and background retry remain pending.

## Repository connection and live pilot

Added a preview/apply installer for repository-scoped Antigravity and Codex configuration. It merges unrelated settings, records original file contents in a private Git-ignored backup, and is repeatable. Added branch-based feature selection and truthful MCP read/write annotations so recall can run without a write confirmation.

Installed connections in this checkout and reviewed/enabled both Codex hooks through its normal review interface. Antigravity executed SessionStart and recorded the injected recall instruction, but its account returned RESOURCE_EXHAUSTED before producing a model response. Claude Code has no signed-in account here, so no live Claude test was attempted.

The Antigravity pilot exposed step-based JSONL records (USER_INPUT with USER_REQUEST content). Added support for that format and fixture coverage for PLANNER_RESPONSE and ASSISTANT_MESSAGE. Actual successful Antigravity assistant output remains unverified.

The live Codex source session and destination session are recorded in local pilot logs. A fresh destination session was given no synthetic feature facts and made a successful shared-memory get_context call. It correctly recalled the duplicate-invoice failure, upstream-ID idempotency decision, simultaneous-retry next step and verification marker. No destination filesystem tool call was observed. Local raw pilot logs are Git-ignored under .memory.

The installer defaults feature identity to the active branch. An explicit MEMORY_FEATURE supports cross-branch handoffs. Team identity and remote storage are still pending. Local Codex CLI behavior is verified; desktop UI session behavior is not yet independently tested.

## Product-managed historical handoff

Added the public memory list/handoff commands. A handoff selects an Antigravity conversation by title or ID, derives the workspace and repository, imports its readable JSONL history or selected indexed text, and configures only the destination Codex connection. Feature identity is pinned to the selected conversation. Existing unrelated settings are preserved, backups are local, and generated files are excluded via the destination repository's local Git exclusion file. No source content is written into the product repository.

Added search_memory for scoped text lookup and pagination across older records. The command itself is exercised in a process integration test, including a preview without writes, selected-only import, removal of credentials from remote identity, and preservation of source-client settings.

Ran the same product command against the conversation selected by the user. It imported 55 records from its existing transcript. A fresh Codex session in the derived workspace automatically called get_context and recovered the last completed milestone and pending task. The receiving test did not inspect repository files or receive the source facts in its prompt. Native hook review was completed through Codex's standard interface. Raw conversation data and verification logs remain local and Git-ignored.

The historical transfer works without calling the quota-blocked source model. Live source response generation remains blocked by that account's quota. The source branch differs from the current checkout, so continuation must verify the appropriate branch before editing. No branch switch or source-project code edit was performed.

## Wrong-project handoff regression

The reported chat was opened in the memory-product workspace. Its MCP connection could request imported context from a different repository because server-side binding was absent. Inspection of the interrupted chat showed repository reads and no file-writing actions. The identified connector worktree was clean at the checked commit. Existing unrelated files were preserved.

Added mandatory MEMORY_REPO binding for all MCP tools, optional feature binding including evidence lookup, and workspace validation before hooks resolve a feature. The installer now sets the server repository/feature, startup directory and hook workspace. Reinstalled both current local connections. Existing client processes need to reconnect and changed hook definitions require normal native review.

Added --launch to execute Codex CLI with the destination directory explicitly selected. Desktop project/chat routing remains pending. This fix restricts memory access and clarifies routing; the coding client's own tools and filesystem permissions remain outside the memory server's control.

Regression tests first reproduced both cross-repository retrieval and wrong-workspace recall, then passed after the fix. The complete suite now has 24 passing tests, with TypeScript checks passing.

## Explicit user chat selection

Added an interactive terminal picker with numbered choices, search, paging and cancellation. Handoff without --conversation now opens that picker. Explicit title/ID arguments remain available for scripts. The user chooses before import.

Added the choose_conversation MCP tool using protocol form elicitation. It shows title, workspace and activity for matching local chats, waits for user acceptance, then imports the selected history. Unsupported hosts receive a terminal-picker fallback. The protocol is tested with an actual SDK client/server exchange; desktop form rendering remains unverified.

Selections are now stored by repository and native coding session, rather than in the repository's fixed feature configuration. Native startup asks for a user choice when continuing a previous chat, and all memory tools enforce that session's chosen feature. CLI launch carries its explicit user choice into that new session. Cancellation leaves new sessions unselected. Choosing a different chat in another session does not overwrite the first.

Updated the installed project connection to session-selection mode and removed its repository-wide fixed conversation. Updated hooks require native review when a fresh session loads them. General legacy fixed-feature developer connections remain supported.

Verified picker cancellation/search, independent session state, process-specific launch choices, native MCP form acceptance/cancellation, startup binding and cross-session isolation. Source history remains local.

## Slash-menu shortcut

Added the continue-chat skill and included it in Codex connection installation. Installed it in the connected project. The short skill dispatches to the native user picker and loads the accepted selection without authorizing file edits. It avoids typing a full request but remains model-driven, so token-free behavior is not claimed. Skill validation, TypeScript checks and all 30 tests pass. Desktop menu rendering remains unverified.


## Connector setup · 2026-11-12

Added Claude Code configuration merging and a Claude Desktop local configuration fragment. Added OAuth-protected Streamable HTTP, owned chat sessions, read/write scopes, browser conversation picker and private setup profiles for ChatGPT/Claude web. External JWT/OIDC authentication is required; no authorization server is implemented. Local SQLite remains the persistence layer.

Validation: 38 tests pass and TypeScript checking passes. Claude Code recognizes the installed project server, pending login/approval. Remote clients remain unconnected until public HTTPS, issuer and allowed subject values are configured. Desktop rendering and live web OAuth flows remain unverified. See [setup guide](clients/connector-setup.md).


## Local conversation-centered memory · 2026-11-13

Added opt-in new-session capture, provider-qualified session identities, additive versioned SQLite migrations with consistent backups, explicit direct-source continuation cutoffs, stored conversation discovery, bounded Codex/Claude metadata discovery, cited checkpoint revisions, checkpoint-first recall and content-free capture status. The updated runtime lifecycle checks target schema compatibility before changing connectors.

Legacy connections remain in legacy mode unless explicitly upgraded through `--capture-new-sessions`. New conversation MCP mode is local-only. Existing HTTP/browser-pickers remain on their tested legacy contract. Original event payloads and IDs are preserved during schema migration; imported legacy Antigravity evidence is mapped without rewriting it.

At this milestone, 77 automated tests and the expanded installed-tarball smoke test pass. Live Claude Code testing is unavailable because the CLI is not authenticated. Live native hook behavior for every supported client remains separate from process-fixture and installed-shell-hook evidence. No installed user project or live memory database was upgraded during development.

See [local conversation memory](clients/local-agent-memory.md) for opt-in setup, checkpoint limits, diagnostics and recovery.

A read-only live Codex CLI pilot called the new `get_context` tool against synthetic memory in a temporary repository. It recovered the rejected batch-retry approach, immutable upstream-ID decision, concurrency-test next step and a marker absent from the prompt. This establishes live model-driven MCP recall, not native startup/stop hook invocation; the pilot pre-registered and explicitly linked its synthetic destination. No filesystem tools or writes were requested.

Independent whole-branch review identified defects in known-session access, historical Antigravity attribution, mixed-mode queue delivery, commit-stable capture identity, frozen checkpoint/provenance snapshots, conversation-local checkpoint coverage, persistent retirement, terminal preflight, Desktop mode selection, per-session diagnostics and duplicate discovery. Each received executable regression coverage and a scoped fix. Exact-fit serialized budgets were also fixed. Session capabilities now rotate at native startup, are stored as hashes and are required by every conversation-mode MCP tool. Queue records retain their own delivery identity independently of the invoking project's mode.

Final live recheck after capability enforcement was blocked by automatic approval review because it would send a temporary test capability in the external model prompt. It was not retried. The earlier live Codex recall pilot predates this guard; final capabilities are covered by real MCP process and installed-hook/package tests. Native all-client lifecycle coverage remains unverified. Very-long-history SQL pagination and targeted lookup optimization remain deferred; context no longer fetches the full history twice.
