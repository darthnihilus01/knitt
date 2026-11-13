import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../packages/memory/src/store.ts";
const key = { repoId: "r", client: "codex", nativeSessionId: "same" };
const location = { workspace: "/project", branch: "main", commit: "abc" };
test("native sessions are stable, client qualified, and cannot reassign evidence", () => {
 const store = new MemoryStore(":memory:", { conversationMode: true });
 try {
  const a = store.ensureSession(key, location);
  assert.equal(store.ensureSession(key, location).conversationId, a.conversationId);
  const bkey = { ...key, client: "claude" };
  const b = store.ensureSession(bkey, location);
  assert.notEqual(a.conversationId, b.conversationId);
  const event = { repoId: "r", featureId: a.conversationId, eventId: "e", kind: "progress" as const, content: "original" };
  store.appendEvidence(key, event); store.appendEvidence(key, event);
  assert.throws(() => store.appendEvidence(bkey, event), /conversation/);
  assert.equal(store.listConversations("r").length, 2);
  assert.equal(store.listConversations("other").length, 0);
  assert.equal(store.context({repoId: "r", featureId: a.conversationId}).total, 1);
 } finally { store.close(); }
});
