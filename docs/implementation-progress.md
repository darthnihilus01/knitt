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
