import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from "jose";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import { createGateway } from "../apps/server/src/http-gateway.ts";
import { createOAuthVerifier } from "../apps/server/src/web-auth.ts";

test("OAuth web MCP requires user selection and isolates users and chat sessions", async () => {
  const root = mkdtempSync(join(tmpdir(), "web-mcp-"));
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  const log = join(root, "brain/source/.system_generated/logs");
  mkdirSync(log, { recursive: true });
  writeFileSync(join(log, "transcript.jsonl"), JSON.stringify({ type: "PLANNER_RESPONSE", content: "Decision: use upstream ID; next test concurrent retries." }) + "\n");
  const index = new DatabaseSync(join(root, "conversation_summaries.db"));
  index.exec("CREATE TABLE conversation_summaries(conversation_id TEXT,title TEXT,workspace_uris TEXT,last_modified_time TEXT)");
  index.prepare("INSERT INTO conversation_summaries VALUES(?,?,?,?)").run("source", "Retry design", JSON.stringify([pathToFileURL(workspace).href]), "2026-11-12");
  index.close();
  const resource = new URL("https://memory.example/mcp");
  const issuer = "https://identity.example";
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const verifier = createOAuthVerifier({ issuer, resource, subjects: ["a", "b"], getKey: createLocalJWKSet({ keys: [jwk] }) });
  const app = createGateway({
    resource, repoId: "repo", workspace, database: join(root, "events.sqlite"), sourceRoots: [root], verifier,
    metadata: { issuer, authorization_endpoint: issuer + "/authorize", token_endpoint: issuer + "/token", response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] },
  });
  const listener = app.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address();
  assert.ok(address && typeof address !== "string");
  const base = "http://127.0.0.1:" + address.port;
  const clients: Client[] = [];
  const token = (subject: string, scope = "memory:read memory:write") =>
    new SignJWT({ scope }).setProtectedHeader({ alg: "RS256" }).setSubject(subject).setIssuer(issuer)
      .setAudience(resource.href).setExpirationTime("5m").sign(privateKey);
  const connect = async (subject: string, scope?: string) => {
    const client = new Client({ name: "chat-app-test", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(base + "/mcp"), { requestInit: { headers: { Authorization: "Bearer " + await token(subject, scope) } } }));
    clients.push(client);
    return client;
  };
  const callPicker = (path: string, ticket: string, key?: string) => fetch(base + path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket, ...(key ? { key } : {}) }),
  });
  try {
    const unauthenticated = await fetch(base + "/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(unauthenticated.status, 401);
    assert.ok(unauthenticated.headers.get("www-authenticate")?.includes("oauth-protected-resource"));
    const invalid = await fetch(base + "/mcp", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer invalid" }, body: "{}" });
    assert.equal(invalid.status, 401);
    const metadata = await fetch(base + "/.well-known/oauth-protected-resource/mcp").then(r => r.json());
    assert.equal(metadata.resource, resource.href);
    const a = await connect("a");
    const started = await a.callTool({ name: "start_session", arguments: {} });
    const sessionId = z.object({ sessionId: z.string() }).parse(started.structuredContent).sessionId;
    const noSelection = await a.callTool({ name: "get_context", arguments: { repoId: "repo", sessionId } });
    assert.equal(noSelection.isError, true);
    const picker = await a.callTool({ name: "choose_conversation", arguments: { sessionId } });
    const pickerUrl = new URL(z.object({ pickerUrl: z.string() }).parse(picker.structuredContent).pickerUrl);
    const ticket = pickerUrl.hash.slice(1);
    const choices = await callPicker("/picker/options", ticket).then(r => r.json());
    assert.equal(choices.choices[0].label.includes("Retry design"), true);
    const selected = await callPicker("/picker/select", ticket, "0");
    assert.equal(selected.status, 200);
    assert.equal((await callPicker("/picker/select", ticket, "0")).status, 400);
    const context = await a.callTool({ name: "get_context", arguments: { repoId: "repo", sessionId } });
    assert.ok(JSON.stringify(context.structuredContent).includes("concurrent retries"));
    const fresh = await a.callTool({ name: "start_session", arguments: {} });
    const otherSession = z.object({ sessionId: z.string() }).parse(fresh.structuredContent).sessionId;
    assert.notEqual(otherSession, sessionId);
    assert.equal((await a.callTool({ name: "get_context", arguments: { repoId: "repo", sessionId: otherSession } })).isError, true);
    const b = await connect("b");
    assert.equal((await b.callTool({ name: "get_context", arguments: { repoId: "repo", sessionId } })).isError, true);
    const readOnly = await token("a", "memory:read");
    const write = await fetch(base + "/mcp", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + readOnly },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "save_memory", arguments: {} } }),
    });
    assert.equal(write.status, 403);
    const wrongOrigin = await fetch(base + "/health", { headers: { Origin: "https://untrusted.example" } });
    assert.equal(wrongOrigin.status, 403);
  } finally {
    await Promise.all(clients.map(c => c.close()));
    await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});
