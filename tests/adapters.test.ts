import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capture, flush, recallInstruction } from "../packages/adapters/src/hooks.ts";
import { MemoryStore } from "../packages/memory/src/store.ts";

test("Antigravity capture survives delivery failure and deduplicates retries", () => {
  const dir = mkdtempSync(join(tmpdir(), "adapter-"));
  const scope = { repoId: "repo", featureId: "feature", branch: "feature/a" };
  const payload = { conversationId: "session", lastUserInput: "Resume retry implementation" };
  try {
    capture(dir, "antigravity", scope, payload);
    capture(dir, "antigravity", scope, payload);
    const failed = flush(dir, () => { throw new Error("offline"); });
    assert.equal(failed.pending, 1);
    const store = new MemoryStore(join(dir, "events.sqlite"));
    const delivered = flush(dir, event => { store.save(event); });
    assert.equal(delivered.pending, 0);
    assert.equal(store.context(scope).total, 1);
    assert.equal(store.context(scope).events[0].sessionId, "session");
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("capture redacts common secrets before durable queueing", () => {
  const dir = mkdtempSync(join(tmpdir(), "adapter-"));
  try {
    capture(dir, "claude", { repoId: "r", featureId: "f" }, {
      session_id: "s", last_assistant_message: "Decision: retry by ID. api_key=secret-value",
    });
    flush(dir, event => {
      assert.ok(event.content.includes("retry by ID"));
      assert.ok(!event.content.includes("secret-value"));
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("recall supplies a fixed MCP instruction without promoting stored content", () => {
  const output = recallInstruction("antigravity", { repoId: "r", featureId: "f" });
  assert.ok(JSON.stringify(output).includes("get_context"));
  assert.ok(JSON.stringify(output).includes("untrusted"));
});
