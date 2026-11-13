import { z } from "zod";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { MemoryStore } from "../packages/memory/src/store.ts";
test("conversation MCP selects explicitly, preserves canceled link and scopes evidence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "knitt-conversation-mcp-"));
  const database = join(dir, "events.sqlite");
  const key = { repoId: "r", client: "codex", nativeSessionId: "destination" };
  const store = new MemoryStore(database, { conversationMode: true });
  const sourceKey = { ...key, nativeSessionId: "source" };
  const source = store.ensureSession(sourceKey, { workspace: dir });
  store.ensureSession(key, { workspace: dir });
  store.appendEvidence(sourceKey, {
    repoId: "r",
    featureId: source.conversationId,
    eventId: "source-e",
    kind: "decision",
    content: "Use stable upstream IDs",
  });
  store.close();
  const env = {
    ...process.env,
    MEMORY_REPO: "r",
    MEMORY_DB: database,
    MEMORY_CONVERSATION_MODE: "1",
    MEMORY_CLIENT: "codex",
    MEMORY_WORKSPACE: dir,
    MEMORY_CODEX_HISTORY: join(dir, "missing"),
    MEMORY_CLAUDE_HISTORY: join(dir, "missing"),
    MEMORY_SOURCE_ROOTS: "[]",
  };
  delete (env as Record<string, string | undefined>).NODE_TEST_CONTEXT;
  const client = new Client(
    { name: "continuation-test", version: "1" },
    { capabilities: { elicitation: { form: {} } } },
  );
  let cancel = false;
  client.setRequestHandler(ElicitRequestSchema, async (request) => {
    if (request.params.mode === "url") throw new Error("Expected a form");
    const schema = z
      .object({
        properties: z.object({
          conversation: z.object({
            oneOf: z.array(z.object({ const: z.string(), title: z.string() })),
          }),
        }),
      })
      .parse(request.params.requestedSchema);
    const options = schema.properties.conversation.oneOf;
    assert.equal(options.length, 1);
    return cancel
      ? { action: "cancel" }
      : { action: "accept", content: { conversation: options[0].const } };
  });
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [resolve("apps/server/src/main.ts")],
        env,
        stderr: "inherit",
      }),
    );
    const selected = await client.callTool({
      name: "choose_conversation",
      arguments: { sessionId: "destination" },
    });
    assert.ok(!selected.isError, JSON.stringify(selected));
    const context = await client.callTool({
      name: "get_context",
      arguments: { repoId: "r", sessionId: "destination" },
    });
    assert.ok(JSON.stringify(context).includes("upstream IDs"));
    const checkpoint = await client.callTool({
      name: "save_checkpoint",
      arguments: {
        repoId: "r",
        sessionId: "destination",
        entries: [
          {
            id: "decision",
            category: "decision",
            content: "Use upstream IDs",
            evidenceIds: ["source-e"],
            status: "reported",
          },
        ],
      },
    });
    assert.ok(!checkpoint.isError, JSON.stringify(checkpoint));
    cancel = true;
    assert.ok(
      !(
        await client.callTool({
          name: "choose_conversation",
          arguments: { sessionId: "destination" },
        })
      ).isError,
    );
    assert.ok(
      JSON.stringify(
        await client.callTool({
          name: "get_evidence",
          arguments: {
            repoId: "r",
            sessionId: "destination",
            eventId: "source-e",
          },
        }),
      ).includes("upstream IDs"),
    );
    assert.equal(
      (
        await client.callTool({
          name: "get_context",
          arguments: { repoId: "other", sessionId: "destination" },
        })
      ).isError,
      true,
    );
    assert.equal(
      (
        await client.callTool({
          name: "get_context",
          arguments: { repoId: "r", sessionId: "unknown" },
        })
      ).isError,
      true,
    );
  } finally {
    await client.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
