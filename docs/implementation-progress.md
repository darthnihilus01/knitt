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
