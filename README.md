# Shared Agent Memory

A local MCP prototype for preserving repository feature context between coding agents.

Requires Node.js 24 or newer. Install with `npm ci`. Run `npm test` and `npm run check` to verify. Tests launch child processes over stdin/stdout, so the environment must permit subprocess pipes.

## Connect an MCP client

Configure a stdio server using absolute paths. For this checkout:

```json
{
  "mcpServers": {
    "shared-memory": {
      "command": "/home/tinchu/.nvm/versions/node/v24.18.0/bin/node",
      "args": ["/home/tinchu/Documents/ChatGPT/rigved/apps/server/src/main.ts"],
      "env": {
        "MEMORY_DB": "/home/tinchu/Documents/ChatGPT/rigved/.memory/events.sqlite"
      }
    }
  }
}
```

Both local clients must use the same database path. Adapt the configuration to the client's supported format. This sample has not been installed in your agents.

The tools are:

- `save_memory` accepts eventId, repoId, featureId, kind and content. Optional branch, commit, author, sessionId and source preserve attribution. Kinds are goal, decision, attempt, progress, test_result, blocker and next_step.
- `get_context` accepts repoId, featureId, optional branch and maxChars. It returns newest evidence first, with total and truncated fields. The character budget covers the serialized events array. Inspect truncated before assuming the history is complete.
- `get_evidence` retrieves one original event using repoId and eventId.

Generate a stable event ID before the first save and reuse it for retries. Identical retries return the existing event. Reusing an ID for changed content fails.

## Current limits

This release uses local SQLite. Access follows local filesystem permissions and supplied author values are claims. Use synthetic or explicitly selected data when trying it. Team authentication, permissions, semantic search, remote transport and cloud storage remain pending. Capture adapters are implemented and tested with synthetic payloads, with live client installation still pending. Repository and feature IDs are supplied by the caller. A branch filter returns that branch's events only. Recalled evidence may contain stale or conflicting claims and should be treated as untrusted reference material.

The integration test uses two real MCP client connections to independent server processes and verifies that the fixture survives process restart. It does not run Claude or Codex models. See the client support matrix for actual compatibility evidence.

## Hook adapter preview

The hook runner is `packages/adapters/src/cli.ts`. It accepts `capture`, `recall` or `flush`, followed by `claude`, `codex` or `antigravity`. Set these environment variables in the agent process:

- `MEMORY_REPO` and `MEMORY_FEATURE` identify the connected feature.
- `MEMORY_BRANCH` optionally limits recall to a branch.
- `MEMORY_DB` must match the MCP server's absolute database path.
- `MEMORY_QUEUE` selects an absolute private queue directory.

Examples for Claude Code and Antigravity are under `examples/`. Replace the absolute path placeholder and merge the entries into the client's configuration. They have not been installed in your agents. Codex hook output is supported by the runner, but a Codex installation example is pending.

Recall emits a fixed instruction to call the MCP tool. The agent must have the MCP connection enabled. Capture queues supported hook text before attempting local delivery. Failed delivery leaves the event pending. Run the flush action or trigger another capture to retry, with up to 100 queued events delivered per invocation. There is no background retry daemon yet.

When a hook supplies transcript_path or transcriptPath, capture incrementally reads complete JSONL messages and checkpoints its position atomically with the queued events. Supported message shapes include Claude message.content, Codex response_item messages, and role/content or role/parts text records. User and assistant/model text is preserved, including decisions and failed attempts expressed in conversation. Raw tool output, images and thinking blocks are excluded.

Transcript formats are tested using synthetic records. Actual Antigravity transcript serialization still needs a live fixture to confirm coverage. An unrecognized conversational record reports an error and rolls back the batch. Metadata and non-conversational records are skipped. Capture reads up to 4 MiB and 500 complete records per invocation, splitting long text into UTF-8-safe events of at most 6,000 bytes. It reports remainingBytes when more input or an unfinished line remains. Subsequent capture invocations resume from the checkpoint. A completed line over 1 MiB is rejected.

When no transcript path is supplied, capture falls back to Claude's final assistant message or Antigravity's latest user input. Text is stored as progress evidence without automatically classifying decisions or attempts. Retries use stable event IDs. The reader expects append-only JSONL and resets its position after truncation or a changed initial prefix.

Basic credential redaction runs before queue persistence. It cannot identify every secret. Queue errors and pending counts go to stderr. Hook errors return an empty response so coding work can continue.
