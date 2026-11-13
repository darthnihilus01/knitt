import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../packages/memory/src/store.ts";
const key = { repoId: "r", client: "codex", nativeSessionId: "same" };
const location = { workspace: "/project", branch: "main", commit: "abc" };
test("native sessions are stable, client qualified, and cannot reassign evidence", () => {
  const store = new MemoryStore(":memory:", { conversationMode: true });
  try {
    const a = store.ensureSession(key, location);
    assert.equal(
      store.ensureSession(key, location).conversationId,
      a.conversationId,
    );
    const bkey = { ...key, client: "claude" };
    const b = store.ensureSession(bkey, location);
    assert.notEqual(a.conversationId, b.conversationId);
    const event = {
      repoId: "r",
      featureId: a.conversationId,
      eventId: "e",
      kind: "progress" as const,
      content: "original",
    };
    store.appendEvidence(key, event);
    store.appendEvidence(key, event);
    assert.throws(() => store.appendEvidence(bkey, event), /conversation/);
    assert.equal(store.listConversations("r").length, 2);
    assert.equal(store.listConversations("other").length, 0);
    assert.equal(
      store.context({ repoId: "r", featureId: a.conversationId }).total,
      1,
    );
  } finally {
    store.close();
  }
});

test("continuations freeze source evidence and keep concurrent destinations separate", () => {
  const store = new MemoryStore(":memory:", { conversationMode: true });
  try {
    const akey = { ...key, nativeSessionId: "a" },
      bkey = { ...key, nativeSessionId: "b" },
      ckey = { ...key, nativeSessionId: "c" };
    const a = store.ensureSession(akey, location),
      b = store.ensureSession(bkey, location);
    store.ensureSession(ckey, location);
    const save = (k: typeof key, id: string, featureId: string) =>
      store.appendEvidence(k, {
        repoId: "r",
        featureId,
        eventId: id,
        kind: "progress",
        content: id,
      });
    save(akey, "before", a.conversationId);
    store.linkSource(bkey, a.conversationId);
    store.linkSource(ckey, a.conversationId);
    save(akey, "after", a.conversationId);
    save(bkey, "destination", b.conversationId);
    assert.deepEqual(
      store.conversationEvidence(bkey).map((e) => e.eventId),
      ["destination", "before"],
    );
    assert.deepEqual(
      store.conversationEvidence(ckey).map((e) => e.eventId),
      ["before"],
    );
    assert.equal(
      store.context({ repoId: "r", featureId: a.conversationId }).total,
      2,
    );
    assert.throws(() => store.linkSource(bkey, b.conversationId), /self/);
    assert.throws(() =>
      store.linkSource({ ...bkey, repoId: "other" }, a.conversationId),
    );
    store.linkSource(bkey, a.conversationId);
    assert.deepEqual(
      store.conversationEvidence(bkey).map((e) => e.eventId),
      ["destination", "after", "before"],
    );
  } finally {
    store.close();
  }
});
