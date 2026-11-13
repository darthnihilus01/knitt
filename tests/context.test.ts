import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../packages/memory/src/store.ts";
const key = { repoId: "r", client: "codex", nativeSessionId: "s" };
test("checkpoint-first recall retains old decisions and reports stale, omitted evidence", () => {
  const store = new MemoryStore(":memory:", { conversationMode: true });
  try {
    const own = store.ensureSession(key, {
      workspace: "/p",
      branch: "main",
      commit: "a",
    });
    store.appendEvidence(key, {
      repoId: "r",
      featureId: own.conversationId,
      eventId: "early",
      kind: "decision",
      content: "Rejected whole-batch retry; use upstream ID",
    });
    store.saveCheckpoint(key, [
      {
        id: "decision",
        category: "decision",
        content: "Use upstream ID",
        evidenceIds: ["early"],
        status: "reported",
      },
    ]);
    for (let i = 0; i < 20; i++)
      store.appendEvidence(key, {
        repoId: "r",
        featureId: own.conversationId,
        eventId: "recent-" + i,
        kind: "progress",
        content: "Recent work " + i + " " + "x".repeat(400),
      });
    const result = store.getConversationContext(key, { maxChars: 3000 });
    assert.ok(JSON.stringify(result.checkpoint).includes("upstream ID"));
    assert.equal(result.stale, true);
    assert.equal(result.truncated, true);
    assert.ok(result.events.some((e) => e.eventId === "recent-19"));
    assert.ok(result.omitted.events > 0);
    assert.ok(JSON.stringify(result).length <= 3000);
  } finally {
    store.close();
  }
});
test("all context sizes remain bounded, skipping oversized entries and preserving source cutoff", () => {
  const store = new MemoryStore(":memory:", { conversationMode: true });
  try {
    const sourceKey = { ...key, nativeSessionId: "source" };
    const source = store.ensureSession(sourceKey, {
      workspace: "/source",
      branch: "feature",
      commit: "old",
    });
    store.ensureSession(key, {
      workspace: "/dest",
      branch: "main",
      commit: "new",
    });
    store.appendEvidence(sourceKey, {
      repoId: "r",
      featureId: source.conversationId,
      eventId: "early",
      kind: "decision",
      content: "early",
    });
    store.saveCheckpoint(sourceKey, [
      {
        id: "large",
        category: "decision",
        content: '界"'.repeat(4000),
        evidenceIds: ["early"],
        status: "reported",
      },
      {
        id: "small",
        category: "next_step",
        content: "Test concurrency",
        evidenceIds: ["early"],
        status: "reported",
      },
    ]);
    store.linkSource(key, source.conversationId);
    store.appendEvidence(sourceKey, {
      repoId: "r",
      featureId: source.conversationId,
      eventId: "late",
      kind: "progress",
      content: "should not appear",
    });
    for (const budget of [256, 350, 1000, 12000, 24000]) {
      const result = store.getConversationContext(key, { maxChars: budget });
      assert.ok(
        JSON.stringify(result).length <= budget,
        JSON.stringify(result).length + " > " + budget,
      );
      assert.ok(!result.events.some((e) => e.eventId === "late"));
    }
    const regular = store.getConversationContext(key, { maxChars: 3000 });
    assert.ok(JSON.stringify(regular.checkpoint).includes("Test concurrency"));
    assert.equal(regular.stale, false);
    assert.ok(JSON.stringify(regular.provenance).includes("old"));
    assert.throws(() => store.getConversationContext(key, { maxChars: 255 }));
  } finally {
    store.close();
  }
});
test("switching source excludes checkpoint claims citing the former source", () => {
  const store = new MemoryStore(":memory:", { conversationMode: true });
  try {
    const a = { ...key, nativeSessionId: "a" },
      b = { ...key, nativeSessionId: "b" };
    const ac = store.ensureSession(a, { workspace: "/p" }),
      bc = store.ensureSession(b, { workspace: "/p" });
    store.ensureSession(key, { workspace: "/p" });
    store.appendEvidence(a, {
      repoId: "r",
      featureId: ac.conversationId,
      eventId: "a",
      kind: "decision",
      content: "old source claim",
    });
    store.linkSource(key, ac.conversationId);
    store.saveCheckpoint(key, [
      {
        id: "old",
        category: "decision",
        content: "old source claim",
        evidenceIds: ["a"],
        status: "reported",
      },
    ]);
    store.linkSource(key, bc.conversationId);
    assert.ok(
      !JSON.stringify(store.getConversationContext(key, {})).includes(
        "old source claim",
      ),
    );
  } finally {
    store.close();
  }
});
