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
        "MEMORY_DB": "/home/tinchu/Documents/ChatGPT/rigved/.memory/events.sqlite",
        "MEMORY_REPO": "github.com/darthnihilus01/shared-agent-memory"
      }
    }
  }
}
```

Both local clients must use the same database path. Adapt the configuration to the client's supported format. This sample has not been installed in your agents.

Every MCP connection requires `MEMORY_REPO` and rejects requests for a different repository across all tools. Setting `MEMORY_FEATURE` additionally restricts it to that handoff. Existing running clients must reconnect after updating their configuration. These are memory-service checks. Agent filesystem permissions remain controlled by the coding client.

The tools are:

- `save_memory` accepts eventId, repoId, featureId, kind and content. Optional branch, commit, author, sessionId and source preserve attribution. Kinds are goal, decision, attempt, progress, test_result, blocker and next_step.
- `get_context` accepts repoId, featureId, optional branch and maxChars. It returns newest evidence first, with total and truncated fields. The character budget covers the serialized events array. Inspect truncated before assuming the history is complete.
- `get_evidence` retrieves one original event using repoId and eventId.
- `search_memory` searches all stored text within a repository feature. It returns short excerpts and evidence IDs. An empty query browses history. Pass `nextCursor` as `before` for the next page, and fetch complete records with `get_evidence`.

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

Examples for Claude Code and Antigravity are under `examples/`. For an Antigravity and Codex connection, use the repository installer below. It generates machine-specific configuration rather than requiring edits to the examples.

Recall emits a fixed instruction to call the MCP tool. The agent must have the MCP connection enabled. Capture queues supported hook text before attempting local delivery. Failed delivery leaves the event pending. Run the flush action or trigger another capture to retry, with up to 100 queued events delivered per invocation. There is no background retry daemon yet.

When a hook supplies transcript_path or transcriptPath, capture incrementally reads complete JSONL messages and checkpoints its position atomically with the queued events. Supported message shapes include Claude message.content, Codex response_item messages, and role/content or role/parts text records. User and assistant/model text is preserved, including decisions and failed attempts expressed in conversation. Raw tool output, images and thinking blocks are excluded.

Transcript formats are tested using synthetic records. Actual Antigravity transcript serialization still needs a live fixture to confirm coverage. An unrecognized conversational record reports an error and rolls back the batch. Metadata and non-conversational records are skipped. Capture reads up to 4 MiB and 500 complete records per invocation, splitting long text into UTF-8-safe events of at most 6,000 bytes. It reports remainingBytes when more input or an unfinished line remains. Subsequent capture invocations resume from the checkpoint. A completed line over 1 MiB is rejected.

When no transcript path is supplied, capture falls back to Claude's final assistant message or Antigravity's latest user input. Text is stored as progress evidence without automatically classifying decisions or attempts. Retries use stable event IDs. The reader expects append-only JSONL and resets its position after truncation or a changed initial prefix.

Basic credential redaction runs before queue persistence. It cannot identify every secret. Queue errors and pending counts go to stderr. Hook errors return an empty response so coding work can continue.

## Connect Antigravity and Codex

Preview the repository-scoped connection, then apply it:

```bash
python3 scripts/connect.py --node "$(command -v node)" --repo-id github.com/YOUR_ACCOUNT/YOUR_REPO
python3 scripts/connect.py --node "$(command -v node)" --repo-id github.com/YOUR_ACCOUNT/YOUR_REPO --apply
```

Run from the repository to connect, or pass `--workspace /absolute/path/to/repository`. The memory application remains at the installer's own directory by default. Use `--app-root` if needed. All connected clients use its local database.

The installer merges `.agents/hooks.json`, `.agents/mcp_config.json`, `.codex/hooks.json` and `.codex/config.toml`. Existing unrelated entries are preserved. The initial contents are backed up under `.memory/connection-backup.json`. Local client configurations and memory databases are excluded from this repository's Git history.

Start fresh agent sessions after installing. In Codex, review the generated hooks through `/hooks` or Settings > Hooks. Recall tools advertise read-only behavior and the generated Codex connection prompts for memory-writing tools. The installer does not grant hook trust itself.

Repository identity is configured once. The active branch becomes the feature ID and branch filter by default. To share one feature across different branches, launch the clients with the same `MEMORY_FEATURE` value and omit `MEMORY_BRANCH` to retrieve all feature branches. A detached checkout requires an explicit feature ID.

Verified on this development machine: the Antigravity CLI executed the startup recall hook, but its account quota prevented a model response. A separate live Codex session automatically captured a synthetic conversation, and a fresh Codex session retrieved the failed approach, decision and next test through MCP without those facts in the destination prompt. A live Antigravity-to-Codex assistant-response handoff remains pending.

## Continue an existing Antigravity conversation in Codex

Run the product command from the memory application directory:

```bash
npm run memory -- handoff --conversation "Your conversation title" --to codex
```

To start the destination directly in Codex CLI, add `--launch`:

```bash
npm run memory -- handoff --conversation "Your conversation title" --to codex --launch
```

The launch uses the discovered destination as both the process directory and Codex's `--cd` argument. It opens the local CLI with `--no-daemon` and goes through normal hook review. Desktop chat creation and project selection are not automated by this option. A new chat opened under the memory-product project still belongs to that project.

The command finds that conversation in Antigravity's local index, determines its workspace and repository, imports its existing user and assistant text, and installs a Codex MCP connection and capture/recall hooks in that workspace. It binds the destination to the selected conversation so an unrelated branch's memory does not replace the handoff. It works with existing history even if hooks were not installed when the source conversation began. If the source agent is quota-blocked, importing its readable local history does not require another model response.

Open the identified workspace in Codex, review the generated project hooks if prompted, then start a fresh chat and say **Continue the task from the imported Antigravity conversation.** The startup hook directs Codex to retrieve the saved context. Existing code and branch state still need to be checked before continuing implementation.

Installed hooks record `MEMORY_WORKSPACE` and compare the current Git repository with the configured destination before capture or recall. Linked worktrees of that same repository are allowed. A mismatch returns a visible handoff warning without recalling or capturing context. The startup instruction tells the agent to report a different required checkout before editing there.

Use `--preview` to see the selected workspace and destination before applying changes. Use `npm run memory -- list --workspace /absolute/path` to list conversation titles and IDs. Duplicate titles require an exact ID and, when necessary, a workspace filter. Only the selected conversation's content is imported. A readable JSONL transcript is preferred. If it is unavailable, the importer can use that conversation's indexed user/assistant text. Indexed text may group messages by role within a chunk. Tool output, images and hidden reasoning are outside this text handoff.

The command currently supports local Antigravity-to-Codex handoffs. Private history, database files, backups and machine-specific client settings stay outside source control. Installed history is scoped by repository and selected conversation. Re-running the command imports newly available text without duplicating existing evidence.

Verified with an existing Antigravity conversation: the command imported 55 records, installed the destination connection, and a fresh Codex session successfully called `get_context` and recovered the last completed milestone and outstanding task without reading repository files or receiving a pasted summary. The live source generation test remains quota-blocked, while historical conversation transfer is verified.
