import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("two independent MCP processes share persistent feature evidence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mcp-memory-"));
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/handoff-session.json", import.meta.url), "utf8"));
  const connect = async () => {
    const env = { ...process.env } as Record<string, string>;
    delete env.NODE_TEST_CONTEXT;
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve("apps/server/src/main.ts")],
      env: { ...env, MEMORY_DB: join(dir, "events.sqlite") },
      stderr: "inherit",
    });
    const client = new Client({ name: "handoff-test", version: "1" });
    await client.connect(transport);
    return client;
  };
  let source: Client | undefined;
  let destination: Client | undefined;
  try {
    source = await connect();
    const catalog = await source.listTools();
    assert.equal(catalog.tools.find(t => t.name === "get_context")?.annotations?.readOnlyHint, true);
    assert.equal(catalog.tools.find(t => t.name === "save_memory")?.annotations?.readOnlyHint, false);
    for (const [i, event] of fixture.sourceSession.entries()) {
      const result = await source.callTool({ name: "save_memory", arguments: {
        ...event, eventId: String(i), repoId: fixture.repoId, featureId: fixture.featureId, branch: fixture.branch,
      } });
      assert.ok(!result.isError);
    }
    await source.close();
    destination = await connect();
    const result = await destination.callTool({ name: "get_context", arguments: {
      repoId: fixture.repoId, featureId: fixture.featureId,
    } });
    const data = result.structuredContent as { events: { content: string }[] };
    assert.equal(data.events.length, 5);
    assert.ok(data.events.some(e => e.content.includes("duplicate order")));
    assert.ok(data.events.some(e => e.content.includes("idempotency")));
    const invalid = await destination.callTool({ name: "save_memory", arguments: { kind: "bad" } });
    assert.equal(invalid.isError, true);
    const evidence = await destination.callTool({ name: "get_evidence", arguments: { repoId: fixture.repoId, eventId: "1" } });
    assert.ok(JSON.stringify(evidence).includes("duplicate order"));
  } finally {
    await source?.close();
    await destination?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Antigravity transcript hook delivers evidence to a fresh MCP process", async () => {
  const { spawnSync } = await import("node:child_process");
  const { writeFileSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "hook-mcp-"));
  const transcript = join(dir, "transcript.jsonl");
  const env = { ...process.env, MEMORY_DB: join(dir, "events.sqlite"), MEMORY_QUEUE: join(dir, "queue"), MEMORY_REPO: "pilot", MEMORY_FEATURE: "retry" };
  delete (env as Record<string, string | undefined>).NODE_TEST_CONTEXT;
  const client = new Client({ name: "destination", version: "1" });
  try {
    writeFileSync(transcript, JSON.stringify({ role: "assistant", parts: [{ text: "Whole batch retry failed. Chose order ID idempotency. Next test concurrency." }] }) + "\n");
    const captured = spawnSync(process.execPath, [resolve("packages/adapters/src/cli.ts"), "capture", "antigravity"], {
      env, input: JSON.stringify({ conversationId: "session-a", transcriptPath: transcript }), encoding: "utf8", timeout: 10000,
    });
    assert.equal(captured.status, 0, captured.stderr);
    assert.ok(captured.stderr.includes('"delivered":1'), captured.stderr);
    const recalled = spawnSync(process.execPath, [resolve("packages/adapters/src/cli.ts"), "recall", "codex"], { env, encoding: "utf8", timeout: 10000 });
    assert.ok(JSON.parse(recalled.stdout).hookSpecificOutput.additionalContext.includes("get_context"));
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve("apps/server/src/main.ts")], env }));
    const result = await client.callTool({ name: "get_context", arguments: { repoId: "pilot", featureId: "retry" } });
    const data = result.structuredContent as { events: { content: string }[] };
    assert.equal(data.events.length, 1);
    assert.ok(data.events[0].content.includes("idempotency"));
    assert.ok(data.events[0].content.includes("concurrency"));
  } finally { await client.close(); rmSync(dir, { recursive: true, force: true }); }
});
