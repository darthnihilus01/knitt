import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../packages/memory/src/store.ts";
import { pickConversation } from "../packages/adapters/src/picker.ts";

const conversations = [
  { id: "a", title: "Connector scope", workspace: "/projects/weave", root: "/data", modified: "2026-11-12" },
  { id: "b", title: "Invoice retries", workspace: "/projects/weave", root: "/data", modified: "2026-11-11" },
];

test("picker requires explicit user selection and cancellation selects nothing", async () => {
  const output: string[] = [];
  const selected = await pickConversation(conversations, { ask: async () => "2", write: text => { output.push(text); } });
  assert.equal(selected?.id, "b");
  assert.ok(output.join().includes("Connector scope"));
  assert.ok(output.join().includes("Invoice retries"));
  assert.ok(output.join().includes("/projects/weave"));
  assert.equal(await pickConversation(conversations, { ask: async () => "", write: () => {} }), null);
});

test("picker lets the user search and never interprets invalid input as the newest chat", async () => {
  const answers = ["0", "s invoice", "1"];
  const selected = await pickConversation(conversations, { ask: async () => answers.shift() ?? "", write: () => {} });
  assert.equal(selected?.id, "b");
});

test("two Codex sessions retain independent selections within one repository", () => {
  const store = new MemoryStore(":memory:");
  try {
    assert.equal(store.sessionSelection("repo", "session-a"), null);
    store.selectSession("repo", "session-a", "antigravity:a", "Connector scope");
    store.selectSession("repo", "session-b", "antigravity:b", "Invoice retries");
    assert.equal(store.sessionSelection("repo", "session-a")?.featureId, "antigravity:a");
    assert.equal(store.sessionSelection("repo", "session-b")?.featureId, "antigravity:b");
    assert.equal(store.sessionSelection("other-repo", "session-a"), null);
  } finally { store.close(); }
});

test("launch carries the user's choice on that process instead of changing project-wide selection", async () => {
  const { codexLaunch } = await import("../packages/adapters/src/launch.ts");
  const a = codexLaunch("/project", { featureId: "antigravity:a", title: "Chat a" });
  const b = codexLaunch("/project", { featureId: "antigravity:b", title: "Chat b" });
  assert.equal(a.env.MEMORY_LAUNCH_FEATURE, "antigravity:a");
  assert.equal(b.env.MEMORY_LAUNCH_FEATURE, "antigravity:b");
});
