import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryStore } from "../packages/memory/src/store.ts";
test("upgrade preserves legacy evidence, creates consistent backup and survives restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "knitt-migration-"));
  const path = join(dir, "memory.sqlite");
  try {
    let store = new MemoryStore(path);
    store.save({
      repoId: "r",
      featureId: "f",
      eventId: "e",
      kind: "decision",
      content: "keep this",
    });
    store.close();
    store = new MemoryStore(path, { conversationMode: true });
    const a = store.ensureSession(
      { repoId: "r", client: "codex", nativeSessionId: "s" },
      { workspace: "/p" },
    );
    store.close();
    store = new MemoryStore(path, { conversationMode: true });
    assert.equal(
      store.ensureSession(
        { repoId: "r", client: "codex", nativeSessionId: "s" },
        { workspace: "/p" },
      ).conversationId,
      a.conversationId,
    );
    assert.equal(
      store.search({ repoId: "r", featureId: "f", query: "keep" }).matches[0]
        .eventId,
      "e",
    );
    store.close();
    const backups = readdirSync(dir).filter((p) => p.includes("backup"));
    assert.equal(backups.length, 1);
    const backup = new MemoryStore(join(dir, backups[0]));
    assert.equal(backup.evidence("r", "e")?.content, "keep this");
    backup.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("unsupported schema is refused without altering data", () => {
  const dir = mkdtempSync(join(tmpdir(), "knitt-future-"));
  const path = join(dir, "m.sqlite");
  try {
    const db = new DatabaseSync(path);
    db.exec(
      "PRAGMA user_version=999; CREATE TABLE sentinel(value); INSERT INTO sentinel VALUES('keep')",
    );
    db.close();
    assert.throws(
      () => new MemoryStore(path, { conversationMode: true }),
      /schema/,
    );
    const check = new DatabaseSync(path);
    assert.equal(
      check.prepare("SELECT value FROM sentinel").get()?.value,
      "keep",
    );
    check.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("failed migration rolls back schema and version", async () => {
  const { migrate } = await import("../packages/memory/src/migrations.ts");
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE conversations(bad_column TEXT)");
    assert.throws(() => migrate(db));
    assert.equal(db.prepare("PRAGMA user_version").get()?.user_version, 0);
    assert.equal(
      db
        .prepare("SELECT name FROM sqlite_master WHERE name='native_sessions'")
        .get(),
      undefined,
    );
  } finally {
    db.close();
  }
});

test("checkpoint retirement survives upgrading an earlier conversation schema", () => {
  const dir = mkdtempSync(join(tmpdir(), "knitt-retirement-upgrade-")),
    path = join(dir, "events.sqlite"),
    key = { repoId: "r", client: "codex", nativeSessionId: "s" };
  try {
    let store = new MemoryStore(path, { conversationMode: true });
    const own = store.ensureSession(key, { workspace: "/p" });
    store.appendEvidence(key, {
      repoId: "r",
      featureId: own.conversationId,
      eventId: "e",
      kind: "decision",
      content: "e",
    });
    const entry = {
      id: "a",
      category: "decision" as const,
      content: "old",
      evidenceIds: ["e"],
      status: "reported" as const,
    };
    store.saveCheckpoint(key, [entry]);
    store.saveCheckpoint(key, [
      { ...entry, id: "b", content: "new", supersedes: "a" },
    ]);
    store.close();
    const db = new DatabaseSync(path);
    db.exec(
      "DROP TABLE retired_checkpoint_entries; ALTER TABLE native_sessions DROP COLUMN token_hash; ALTER TABLE continuation_links DROP COLUMN checkpoint_seq; ALTER TABLE continuation_links DROP COLUMN source_location; PRAGMA user_version=3;",
    );
    db.close();
    store = new MemoryStore(path, { conversationMode: true });
    try {
      assert.throws(
        () => store.saveCheckpoint(key, [entry]),
        /retired|supersed/,
      );
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
