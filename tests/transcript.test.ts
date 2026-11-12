import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureTranscript } from "../packages/adapters/src/transcript.ts";
import { flush } from "../packages/adapters/src/hooks.ts";
import { MemoryStore } from "../packages/memory/src/store.ts";

test("capture queues decisions and failed attempts once, resumes incomplete lines, and preserves source", () => {
  const dir = mkdtempSync(join(tmpdir(), "transcript-"));
  const path = join(dir, "session.jsonl");
  const scope = { repoId: "repo", featureId: "retry", branch: "feature/retry" };
  const first = { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Whole batch retry duplicated orders. Use idempotency instead. api_key=private-value" }] } };
  const second = { role: "model", parts: [{ text: "Next test concurrent retries." }] };
  const store = new MemoryStore(join(dir, "memory.sqlite"));
  try {
    writeFileSync(path, JSON.stringify(first) + "\n" + JSON.stringify(second).slice(0, 10));
    const args = { directory: dir, client: "antigravity" as const, scope, sessionId: "s", path };
    assert.equal(captureTranscript(args).events, 1);
    assert.equal(captureTranscript(args).events, 0);
    appendFileSync(path, JSON.stringify(second).slice(10) + "\n");
    assert.equal(captureTranscript(args).events, 1);
    flush(dir, e => { store.save(e); });
    const events = store.context(scope).events;
    assert.equal(events.length, 2);
    assert.ok(events.some(e => e.content.includes("idempotency")));
    assert.ok(events.some(e => e.content.includes("concurrent retries")));
    assert.ok(events.every(e => !e.content.includes("private-value")));
    assert.ok(events.every(e => e.source?.includes("line-byte=")));
    // Replayed content after truncation remains idempotent.
    writeFileSync(path, JSON.stringify(first) + "\n");
    captureTranscript(args);
    flush(dir, e => { store.save(e); });
    assert.equal(store.context(scope).total, 2);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("Codex response items capture user and assistant text, excluding raw tool results", () => {
  const dir = mkdtempSync(join(tmpdir(), "transcript-"));
  const path = join(dir, "session.jsonl");
  try {
    writeFileSync(path, [
      { type: "session_meta", payload: { id: "s" } },
      { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Decision: use upstream order ID." }] } },
      { type: "response_item", payload: { type: "function_call_output", output: "RAW SECRET FILE" } },
    ].map(e => JSON.stringify(e)).join("\n") + "\n");
    assert.equal(captureTranscript({ directory: dir, client: "codex", scope: { repoId: "r", featureId: "f" }, sessionId: "s", path }).events, 1);
    const collected: string[] = [];
    const report = flush(dir, e => { collected.push(e.content); });
    assert.equal(report.pending, 0);
    assert.equal(collected.length, 1);
    assert.ok(!collected.join().includes("RAW SECRET FILE"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("malformed completed lines report an error and can be retried without losing earlier records", () => {
  const dir = mkdtempSync(join(tmpdir(), "transcript-"));
  const path = join(dir, "session.jsonl");
  const args = { directory: dir, client: "claude" as const, scope: { repoId: "r", featureId: "f" }, sessionId: "s", path };
  try {
    writeFileSync(path, '{"role":"assistant","content":"Keep this decision"}\nBROKEN\n');
    assert.throws(() => captureTranscript(args), /Invalid transcript JSON/);
    writeFileSync(path, '{"role":"assistant","content":"Keep this decision"}\n');
    assert.equal(captureTranscript(args).events, 1);
    let count = 0;
    flush(dir, () => { count++; });
    assert.equal(count, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("large Unicode messages preserve all text in bounded events retrievable with the default budget", () => {
  const dir = mkdtempSync(join(tmpdir(), "transcript-"));
  const path = join(dir, "session.jsonl");
  const content = "साड़ी ".repeat(5000);
  const store = new MemoryStore(":memory:");
  try {
    writeFileSync(path, JSON.stringify({ role: "assistant", content }) + "\n");
    captureTranscript({ directory: dir, client: "claude", scope: { repoId: "r", featureId: "f" }, sessionId: "s", path });
    const parts: string[] = [];
    flush(dir, e => { parts.push(e.content); store.save(e); });
    assert.equal(parts.join(""), "assistant: " + content);
    assert.ok(store.context({ repoId: "r", featureId: "f" }).events.length > 0);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("unrecognized conversational text cannot silently advance the capture cursor", () => {
  const dir = mkdtempSync(join(tmpdir(), "transcript-"));
  const path = join(dir, "session.jsonl");
  try {
    writeFileSync(path, JSON.stringify({ role: "assistant", novelField: "A decision we cannot read yet" }) + "\n");
    const args = { directory: dir, client: "antigravity" as const, scope: { repoId: "r", featureId: "f" }, sessionId: "s", path };
    assert.throws(() => captureTranscript(args), /Unsupported transcript/);
    assert.throws(() => captureTranscript(args), /Unsupported transcript/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
