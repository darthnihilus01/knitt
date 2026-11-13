import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { MemoryStore } from "../packages/memory/src/store.ts";
import { captureTranscript } from "../packages/adapters/src/transcript.ts";
import { capture, flush } from "../packages/adapters/src/hooks.ts";
import { planConnection } from "../packages/installer/src/connections.ts";
import { resolveRepository } from "../packages/adapters/src/repository.ts";
test("conversation transcript cursor survives provenance changes", () => {
  const dir = mkdtempSync(join(tmpdir(), "knitt-provenance-")),
    path = join(dir, "t.jsonl");
  try {
    writeFileSync(
      path,
      JSON.stringify({ role: "assistant", content: "one message" }) + "\n",
    );
    const base = {
      directory: dir,
      client: "codex" as const,
      sessionId: "s",
      path,
      session: { repoId: "r", client: "codex", nativeSessionId: "s" },
    };
    assert.equal(
      captureTranscript({
        ...base,
        scope: { repoId: "r", featureId: "conversation:s", commit: "a" },
      }).events,
      1,
    );
    assert.equal(
      captureTranscript({
        ...base,
        scope: { repoId: "r", featureId: "conversation:s", commit: "b" },
      }).events,
      0,
    );
    let count = 0;
    flush(dir, () => {
      count++;
    });
    assert.equal(count, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("legacy invocation routes queued conversation evidence using durable identity", () => {
  const dir = mkdtempSync(join(tmpdir(), "knitt-mixed-")),
    db = join(dir, "events.sqlite"),
    queue = join(dir, "queue");
  const key = { repoId: "opted", client: "codex", nativeSessionId: "source" };
  try {
    let store = new MemoryStore(db, { conversationMode: true });
    const own = store.ensureSession(key, { workspace: dir });
    store.close();
    capture(
      queue,
      "codex",
      { repoId: "opted", featureId: own.conversationId },
      { session_id: "source", last_assistant_message: "pending decision" },
      key,
    );
    const env = {
      ...process.env,
      MEMORY_REPO: "legacy",
      MEMORY_FEATURE: "f",
      MEMORY_DB: db,
      MEMORY_QUEUE: queue,
    };
    delete (env as Record<string, string | undefined>).NODE_TEST_CONTEXT;
    const result = spawnSync(
      process.execPath,
      [resolve("packages/adapters/src/cli.ts"), "flush", "codex"],
      { env, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    store = new MemoryStore(db, { conversationMode: true });
    try {
      assert.equal(store.conversationEvidence(key).length, 1);
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("opting coding agents in preserves Desktop's legacy connection", () => {
  const plan = planConnection({
    workspace: process.cwd(),
    appRoot: process.cwd(),
    database: "/tmp/example.sqlite",
    repoId: "r",
    clients: ["codex", "claude-desktop"],
    captureNewSessions: true,
  });
  const desktop = JSON.parse(
    plan.changes[".memory/connectors/claude-desktop.json"]!,
  ).mcpServers["shared-memory"].env;
  assert.equal(desktop.MEMORY_CONVERSATION_MODE, undefined);
  assert.equal(desktop.MEMORY_CHAT_CLIENT, "claude-desktop");
});
test("repositories without origin retain identity across worktrees", () => {
  const dir = mkdtempSync(join(tmpdir(), "knitt-worktrees-")),
    repo = join(dir, "repo"),
    worktree = join(dir, "worktree");
  try {
    execFileSync("git", ["init", repo], { stdio: "ignore" });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "--allow-empty",
        "-m",
        "initial",
      ],
      { cwd: repo, stdio: "ignore" },
    );
    execFileSync("git", ["worktree", "add", "--detach", worktree], {
      cwd: repo,
      stdio: "ignore",
    });
    assert.equal(
      resolveRepository(repo).repoId,
      resolveRepository(worktree).repoId,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("legacy continuation evidence is not adopted into native Antigravity source", () => {
  const store = new MemoryStore(":memory:", { conversationMode: true });
  try {
    const key = {
      repoId: "r",
      client: "antigravity",
      nativeSessionId: "source",
    };
    const own = store.ensureSession(key, { workspace: "/p" });
    for (const [eventId, client, sessionId] of [
      ["native", "antigravity", "source"],
      ["destination", "codex", "dest"],
    ])
      store.save({
        repoId: "r",
        featureId: "antigravity:source",
        eventId,
        source: client + ":transcript:line-byte=0:part=0",
        sessionId,
        kind: "progress",
        content: eventId,
      });
    store.importLegacyEvidence(key, "antigravity:source");
    assert.deepEqual(
      store.conversationEvidence(key).map((e) => e.eventId),
      ["native"],
    );
    assert.equal(
      store.context({ repoId: "r", featureId: "antigravity:source" }).total,
      2,
    );
  } finally {
    store.close();
  }
});

test("continue with custom home refuses legacy database without migrating it", () => {
  const dir = mkdtempSync(join(tmpdir(), "knitt-continue-")),
    workspace = join(dir, "repo"),
    home = join(dir, "home"),
    db = join(home, "data/events.sqlite");
  try {
    execFileSync("git", ["init", workspace], { stdio: "ignore" });
    mkdirSync(join(home, "data"), { recursive: true });
    const store = new MemoryStore(db);
    store.close();
    const result = spawnSync(
      process.execPath,
      [
        resolve("packages/installer/src/cli.ts"),
        "continue",
        "--home",
        home,
        "--workspace",
        workspace,
        "--session",
        "s",
        "--client",
        "codex",
      ],
      { encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.ok(!result.stderr.includes("Unknown option '--home'"));
    const probe = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1],{readOnly:true});console.log(db.prepare('PRAGMA user_version').get().user_version);db.close();",
        db,
      ],
      { encoding: "utf8" },
    );
    assert.equal(probe.trim(), "0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("replayed native evidence preserves first provenance without swallowing content conflicts", () => {
  const store = new MemoryStore(":memory:", { conversationMode: true });
  try {
    const key = { repoId: "r", client: "codex", nativeSessionId: "s" },
      own = store.ensureSession(key, { workspace: "/p" });
    const event = {
      repoId: "r",
      featureId: own.conversationId,
      eventId: "replay",
      kind: "progress" as const,
      content: "same",
      commit: "a",
    };
    store.appendEvidence(key, event);
    store.appendEvidence(key, { ...event, commit: "b" });
    assert.equal(store.evidence("r", "replay")?.commit, "a");
    assert.throws(
      () => store.appendEvidence(key, { ...event, content: "different" }),
      /conflict/,
    );
  } finally {
    store.close();
  }
});

test("manual mixed-mode flush updates the queued session's delivery status", async () => {
  const { recordCaptureStatus, readCaptureStatuses } = await import(
    "../packages/adapters/src/status.ts"
  );
  const dir = mkdtempSync(join(tmpdir(), "knitt-flush-status-")),
    db = join(dir, "events.sqlite"),
    queue = join(dir, "queue"),
    key = { repoId: "r", client: "codex", nativeSessionId: "queued" };
  try {
    const store = new MemoryStore(db, { conversationMode: true }),
      own = store.ensureSession(key, { workspace: dir });
    store.close();
    capture(
      queue,
      "codex",
      { repoId: "r", featureId: own.conversationId },
      { session_id: "queued", last_assistant_message: "pending" },
      key,
    );
    recordCaptureStatus(queue, {
      session: key,
      lastCaptureAt: "2026-11-13T00:00:00Z",
      lastDeliveryAt: null,
      pending: 1,
      lastErrorCode: "DELIVERY_PENDING",
      captureState: "captured",
    });
    const env = {
      ...process.env,
      MEMORY_REPO: "legacy",
      MEMORY_FEATURE: "f",
      MEMORY_DB: db,
      MEMORY_QUEUE: queue,
    };
    delete (env as Record<string, string | undefined>).NODE_TEST_CONTEXT;
    const result = spawnSync(
      process.execPath,
      [resolve("packages/adapters/src/cli.ts"), "flush", "codex"],
      { env, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const status = readCaptureStatuses(queue)[0];
    assert.ok(status.lastDeliveryAt);
    assert.equal(status.pending, 0);
    assert.equal(status.lastErrorCode, null);
    assert.equal(status.lastCaptureAt, "2026-11-13T00:00:00Z");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("unknown-only transcript is observed without claiming successful capture", async () => {
  const { readCaptureStatuses } = await import(
    "../packages/adapters/src/status.ts"
  );
  const dir = mkdtempSync(join(tmpdir(), "knitt-unknown-")),
    queue = join(dir, "queue"),
    path = join(dir, "t.jsonl");
  try {
    writeFileSync(
      path,
      JSON.stringify({ type: "unknown", content: "unsupported text" }) + "\n",
    );
    const env = {
      ...process.env,
      MEMORY_REPO: "r",
      MEMORY_DB: join(dir, "events.sqlite"),
      MEMORY_QUEUE: queue,
      MEMORY_CONVERSATION_MODE: "1",
      MEMORY_CAPTURE_NEW_SESSIONS: "1",
    };
    delete (env as Record<string, string | undefined>).NODE_TEST_CONTEXT;
    const result = spawnSync(
      process.execPath,
      [resolve("packages/adapters/src/cli.ts"), "capture", "codex"],
      {
        env,
        input: JSON.stringify({ session_id: "s", transcript_path: path }),
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const status = readCaptureStatuses(queue)[0];
    assert.equal(status.lastCaptureAt, null);
    assert.equal(status.captureState, "no_supported_text");
    assert.ok(status.lastAttemptAt);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
