import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../packages/memory/src/store.ts";
const key = { repoId: "r", client: "codex", nativeSessionId: "s" };
const entry = {
  id: "decision",
  category: "decision" as const,
  content: "Use upstream IDs",
  evidenceIds: ["e"],
  status: "reported" as const,
};
test("checkpoints validate citations, reject invented verification and preserve revisions", () => {
  const store = new MemoryStore(":memory:", { conversationMode: true });
  try {
    const own = store.ensureSession(key, { workspace: "/p" });
    store.appendEvidence(key, {
      repoId: "r",
      featureId: own.conversationId,
      eventId: "e",
      kind: "decision",
      content: "Use upstream IDs",
    });
    const a = store.saveCheckpoint(key, [entry]);
    assert.equal(
      store.saveCheckpoint(key, [entry]).checkpointId,
      a.checkpointId,
    );
    assert.throws(
      () =>
        store.saveCheckpoint(key, [
          { ...entry, id: "bad", evidenceIds: ["missing"] },
        ]),
      /evidence/,
    );
    assert.throws(
      () =>
        store.saveCheckpoint(key, [{ ...entry, id: "bad", evidenceIds: [] }]),
      /evidence|small|least/,
    );
    assert.throws(
      () =>
        store.saveCheckpoint(key, [
          { ...entry, id: "bad", status: "verified" },
        ]),
      /verified/,
    );
    assert.throws(() => store.saveCheckpoint(key, [entry, entry]), /Duplicate/);
    assert.throws(
      () =>
        store.saveCheckpoint(key, [
          { ...entry, id: "new", supersedes: "missing" },
        ]),
      /supersed/,
    );
    const b = store.saveCheckpoint(key, [
      {
        ...entry,
        id: "replacement",
        content: "Use immutable IDs",
        supersedes: "decision",
      },
    ]);
    assert.equal(
      store.saveCheckpoint(key, [
        {
          ...entry,
          id: "replacement",
          content: "Use immutable IDs",
          supersedes: "decision",
        },
      ]).checkpointId,
      b.checkpointId,
    );
    assert.throws(() => store.saveCheckpoint(key, [entry]), /retired|supersed/);
    assert.notEqual(b.checkpointId, a.checkpointId);
    assert.deepEqual(
      b.entries.map((e) => e.id),
      ["replacement"],
    );
    assert.equal(store.evidence("r", "e")?.content, "Use upstream IDs");
    assert.equal(
      store.latestCheckpoint("r", own.conversationId)?.checkpointId,
      b.checkpointId,
    );
  } finally {
    store.close();
  }
});
test("checkpoint citations obey direct source cutoff and exclude unrelated sessions", () => {
  const store = new MemoryStore(":memory:", { conversationMode: true });
  try {
    const sourceKey = { ...key, nativeSessionId: "source" };
    const source = store.ensureSession(sourceKey, { workspace: "/p" });
    store.ensureSession(key, { workspace: "/p" });
    store.appendEvidence(sourceKey, {
      repoId: "r",
      featureId: source.conversationId,
      eventId: "e",
      kind: "decision",
      content: "early",
    });
    store.linkSource(key, source.conversationId);
    store.appendEvidence(sourceKey, {
      repoId: "r",
      featureId: source.conversationId,
      eventId: "late",
      kind: "decision",
      content: "late",
    });
    assert.ok(store.saveCheckpoint(key, [entry]));
    assert.throws(
      () =>
        store.saveCheckpoint(key, [
          { ...entry, id: "late", evidenceIds: ["late"] },
        ]),
      /evidence/,
    );
  } finally {
    store.close();
  }
});
