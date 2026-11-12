import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../packages/memory/src/store.ts";

test("memory survives restart, deduplicates retries and isolates branches", () => {
  const dir = mkdtempSync(join(tmpdir(), "memory-"));
  const path = join(dir, "store.sqlite");
  const event = { eventId: "1", repoId: "repo", featureId: "retry", branch: "feature/retry", kind: "attempt", content: "Whole batch retry duplicated orders." };
  try {
    let store = new MemoryStore(path);
    store.save(event);
    store.save(event);
    assert.throws(() => store.save({ ...event, content: "different" }), /conflict/);
    store.close();
    store = new MemoryStore(path);
    assert.equal(store.context({ repoId: "repo", featureId: "retry" }).events.length, 1);
    assert.equal(store.context({ repoId: "other", featureId: "retry" }).events.length, 0);
    assert.equal(store.context({ repoId: "repo", featureId: "retry", branch: "main" }).events.length, 0);
    assert.equal(store.evidence("other", "1"), null);
    assert.equal(store.evidence("repo", "1")?.content, event.content);
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("handoff returns bounded context and indicates omitted evidence", () => {
  const store = new MemoryStore(":memory:");
  try {
    for (let i = 0; i < 4; i++) store.save({ eventId: String(i), repoId: "repo", featureId: "f", kind: "progress", content: "x".repeat(100) });
    const result = store.context({ repoId: "repo", featureId: "f", maxChars: 350 });
    assert.ok(JSON.stringify(result.events).length <= 350);
    assert.equal(result.truncated, true);
    assert.ok(result.total === 4);
  } finally { store.close(); }
});

test("invalid and oversized events are rejected before storage", () => {
  const store = new MemoryStore(":memory:");
  try {
    assert.throws(() => store.save({ eventId: "1", repoId: "r", featureId: "f", kind: "oops", content: "test" }));
    assert.throws(() => store.save({ eventId: "1", repoId: "r", featureId: "f", kind: "goal", content: "x".repeat(32769) }));
    assert.equal(store.context({ repoId: "r", featureId: "f" }).total, 0);
  } finally { store.close(); }
});
