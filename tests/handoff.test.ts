import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { findConversations, selectConversation, importConversation } from "../packages/adapters/src/handoff.ts";
import { MemoryStore } from "../packages/memory/src/store.ts";

test("product discovers a conversation by title and imports its history once", () => {
  const root = mkdtempSync(join(tmpdir(), "handoff-"));
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  const index = new DatabaseSync(join(root, "conversation_summaries.db"));
  index.exec("CREATE TABLE conversation_summaries(conversation_id TEXT, title TEXT, workspace_uris TEXT, last_modified_time TEXT)");
  index.prepare("INSERT INTO conversation_summaries VALUES(?,?,?,?)").run("session-a", "Connector scope", JSON.stringify([pathToFileURL(workspace).href]), "2026-11-12");
  index.prepare("INSERT INTO conversation_summaries VALUES(?,?,?,?)").run("session-b", "Unrelated", "[]", "2026-11-12");
  index.close();
  const logDir = join(root, "brain/session-a/.system_generated/logs");
  mkdirSync(logDir, { recursive: true });
  writeFileSync(join(logDir, "transcript.jsonl"), JSON.stringify({ type: "PLANNER_RESPONSE", content: "Chose MCP because all agents need the same project context." }) + "\n");
  const store = new MemoryStore(join(root, "destination.sqlite"));
  try {
    const all = findConversations([root], workspace);
    assert.equal(all.length, 1);
    const selected = selectConversation(all, "Connector scope");
    assert.equal(selected.workspace, workspace);
    const options = { conversation: selected, repoId: "repo", directory: join(root, "queue"), store };
    assert.ok(importConversation(options).delivered > 0);
    assert.equal(importConversation(options).delivered, 0);
    const saved = store.context({ repoId: "repo", featureId: "antigravity:session-a" });
    assert.equal(saved.events.length, 1);
    assert.ok(saved.events[0].content.includes("Chose MCP"));
    assert.equal(store.context({ repoId: "different", featureId: "antigravity:session-a" }).total, 0);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("missing transcripts can use only the selected conversation's indexed user and assistant text", () => {
  const root = mkdtempSync(join(tmpdir(), "handoff-index-"));
  const index = new DatabaseSync(join(root, "conversation_summaries.db"));
  index.exec("CREATE TABLE conversations_fts(conversation_id TEXT, chunk_index INT, user_body TEXT, agent_body TEXT)");
  index.prepare("INSERT INTO conversations_fts VALUES(?,?,?,?)").run("s", 0, "Avoid changing unrelated services.", "Decision: limit the connector to this repository.");
  index.prepare("INSERT INTO conversations_fts VALUES(?,?,?,?)").run("other", 0, "PRIVATE OTHER CHAT", "PRIVATE OTHER CHAT");
  index.close();
  const store = new MemoryStore(":memory:");
  try {
    const conversation = { id: "s", title: "Scope", workspace: root, root, modified: "" };
    const report = importConversation({ conversation, repoId: "r", directory: join(root, "queue"), store });
    assert.equal(report.source, "conversation_index");
    assert.equal(report.delivered, 2);
    const events = store.context({ repoId: "r", featureId: "antigravity:s" }).events;
    assert.ok(events.some(e => e.content.includes("limit the connector")));
    assert.ok(!JSON.stringify(events).includes("PRIVATE OTHER CHAT"));
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("ambiguous and missing conversation selections fail explicitly", () => {
  const conversations = [
    { id: "a", title: "Same", root: "/tmp/a", workspace: "/tmp/a", modified: "" },
    { id: "b", title: "Same", root: "/tmp/b", workspace: "/tmp/b", modified: "" },
  ];
  assert.throws(() => selectConversation(conversations, "Same"), /ambiguous/i);
  assert.throws(() => selectConversation(conversations, "Missing"), /not found/i);
});

test("handoff command imports history and connects only Codex without a handoff file", async () => {
  const { execFileSync, spawnSync } = await import("node:child_process");
  const { readFileSync, existsSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const root = mkdtempSync(join(tmpdir(), "handoff-command-"));
  const workspace = join(root, "workspace");
  const dataRoot = join(root, "antigravity");
  mkdirSync(workspace);
  mkdirSync(dataRoot);
  execFileSync("git", ["init", "--initial-branch=work", workspace], { stdio: "ignore" });
  execFileSync("git", ["-C", workspace, "remote", "add", "origin", "https://fake:credential@github.com/test/repo.git"]);
  mkdirSync(join(workspace, ".agents"));
  writeFileSync(join(workspace, ".agents/hooks.json"), '{"existing":true}');
  const index = new DatabaseSync(join(dataRoot, "conversation_summaries.db"));
  index.exec("CREATE TABLE conversation_summaries(conversation_id TEXT,title TEXT,workspace_uris TEXT,last_modified_time TEXT); CREATE TABLE conversations_fts(conversation_id TEXT,chunk_index INT,user_body TEXT,agent_body TEXT)");
  index.prepare("INSERT INTO conversation_summaries VALUES(?,?,?,?)").run("s", "Selected conversation", JSON.stringify([pathToFileURL(workspace).href]), "2026-11-12");
  index.prepare("INSERT INTO conversations_fts VALUES(?,?,?,?)").run("s", 0, "Connect my agents", "Use shared memory.");
  index.close();
  const env = { ...process.env, MEMORY_DB: join(root, "events.sqlite") };
  delete (env as Record<string, string | undefined>).NODE_TEST_CONTEXT;
  const args = [resolve("packages/adapters/src/command.ts"), "handoff", "--conversation", "Selected conversation", "--data-root", dataRoot];
  try {
    const preview = spawnSync(process.execPath, [...args, "--preview"], { env, encoding: "utf8" });
    assert.equal(preview.status, 0, preview.stderr);
    assert.ok(!existsSync(join(workspace, ".codex")));
    const run = spawnSync(process.execPath, args, { env, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.ok(run.stdout.includes('"ready": true'));
    const installed = readFileSync(join(workspace, ".codex/hooks.json"), "utf8");
    const hookCommand = JSON.parse(installed).hooks.SessionStart[0].hooks[0].command as string;
    const hookScript = process.platform === 'win32' ? Buffer.from(hookCommand.split(' ').at(-1)!, 'base64').toString('utf16le') : hookCommand;
    assert.match(hookScript, /MEMORY_SESSION_SELECTION(?:=1|='1')/);
    assert.ok(!installed.includes("MEMORY_FEATURE="));
    assert.ok(!installed.includes("credential"));
    assert.equal(readFileSync(join(workspace, ".agents/hooks.json"), "utf8"), '{"existing":true}');
    const store = new MemoryStore(env.MEMORY_DB);
    try { assert.equal(store.context({ repoId: "github.com/test/repo", featureId: "antigravity:s" }).total, 2); }
    finally { store.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("chat discovery includes linked worktrees of the same repository", async () => {
  const { execFileSync } = await import("node:child_process");
  const root = mkdtempSync(join(tmpdir(), "worktree-chats-"));
  const main = join(root, "main");
  const worktree = join(root, "feature");
  try {
    execFileSync("git", ["init", "--initial-branch=main", main], { stdio: "ignore" });
    execFileSync("git", ["-C", main, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "initial"], { stdio: "ignore" });
    execFileSync("git", ["-C", main, "worktree", "add", "-b", "feature", worktree], { stdio: "ignore" });
    const db = new DatabaseSync(join(root, "conversation_summaries.db"));
    db.exec("CREATE TABLE conversation_summaries(conversation_id TEXT,title TEXT,workspace_uris TEXT,last_modified_time TEXT)");
    db.prepare("INSERT INTO conversation_summaries VALUES(?,?,?,?)").run("source", "Main checkout chat", JSON.stringify([pathToFileURL(main).href]), "2026-11-12");
    db.close();
    assert.equal(findConversations([root], worktree).length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
