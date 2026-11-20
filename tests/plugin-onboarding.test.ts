import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerOnboarding } from "../apps/server/src/onboarding.ts";
import { bindWorkspace } from "../packages/cloud/src/local-sync.ts";
import { credentials } from "../packages/cloud/src/client.ts";
import { cloudPicker } from "../apps/server/src/cloud-picker.ts";
import { MemoryStore } from "../packages/memory/src/store.ts";
import { historyFixture } from "./fixtures/history.ts";

test("onboarding requires preview approval and explicit project selection; invitations work without personal sync consent", async () => {
  const fixture = historyFixture();
  const home = join(fixture.root, "home");
  const projectId = "11111111-1111-4111-8111-111111111111";
  const invitationId = "22222222-2222-4222-8222-222222222222";
  mkdirSync(join(home, "cloud"), { recursive: true });
  writeFileSync(
    join(home, "cloud", "device.json"),
    JSON.stringify({
      origin: "https://cloud.example.test",
      token: "device-token",
      account: { id: "account", email: "a@example.test" },
      device: { id: "dev", name: "fixture" },
    }),
  );
  const handlers = new Map<string, (input: unknown) => Promise<any>>();
  const server = {
    registerTool(name: string, options: any, handler: any) {
      handlers.set(name, async (input) =>
        handler(z.object(options.inputSchema).parse(input)),
      );
    },
  } as unknown as McpServer;
  const originalFetch = globalThis.fetch;
  const requests: { url: string; body: any }[] = [];
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    requests.push({
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    if (path === "/api/private/projects")
      return Response.json({
        projects: [{ id: projectId, title: "Same title" }],
      });
    if (path === "/api/inbox")
      return Response.json({
        invitations: [
          {
            id: invitationId,
            title: "Friend work",
            senderUsername: "friend",
            startVersionNumber: 2,
            status: "pending",
          },
        ],
      });
    return Response.json({ accepted: true });
  };
  try {
    registerOnboarding(
      server,
      home,
      { MEMORY_HISTORY_ROOTS: JSON.stringify(fixture.roots) },
      fixture.workspace,
    );
    const call = async (name: string, input: unknown = {}) =>
      (await handlers.get(name)!(input)).structuredContent;
    assert.equal((await call("knitt_status")).binding, null);
    assert.match(
      JSON.stringify(await call("knitt_invitations", { action: "list" })),
      /Friend work/,
    );
    await assert.rejects(
      call("knitt_invitations", { action: "accept", invitationId }),
      /explicit user approval/,
    );
    await call("knitt_invitations", {
      action: "accept",
      invitationId,
      userApproved: true,
    });
    assert.equal((await call("knitt_status")).binding, null);
    const preview = await call("knitt_preview_sync");
    assert.equal(preview.histories.length, 3);
    assert.equal(
      requests.some((request) => request.url.endsWith("/api/private/sync")),
      false,
    );
    await assert.rejects(
      call("knitt_enable_sync", {
        previewId: preview.previewId,
        projectId,
        userApproved: false,
      }),
    );
    await assert.rejects(
      call("knitt_enable_sync", {
        previewId: preview.previewId,
        userApproved: true,
      }),
      /Choose one/,
    );
    const credentialFile = join(home, "cloud", "device.json");
    const originalCredentials = readFileSync(credentialFile, "utf8");
    const replacement = JSON.parse(originalCredentials);
    replacement.device.id = "other-installation";
    writeFileSync(credentialFile, JSON.stringify(replacement));
    await assert.rejects(call("knitt_enable_sync", {previewId:preview.previewId,projectId,userApproved:true}), /Preview expired/);
    writeFileSync(credentialFile, originalCredentials);
    await call("knitt_enable_sync", {
      previewId: preview.previewId,
      projectId,
      userApproved: true,
    });
    assert.equal((await call("knitt_status")).binding.projectId, projectId);
    assert.equal(
      requests.filter((request) => request.url.endsWith("/api/private/sync"))
        .length,
      3,
    );
    await assert.rejects(
      call("knitt_enable_sync", {
        previewId: preview.previewId,
        projectId,
        userApproved: true,
      }),
      /Preview expired/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("personal synced picker pages conversations, pins cutoff and separates recipient progress", async () => {
  const fixture = historyFixture(),
    home = join(fixture.root, "home");
  mkdirSync(join(home, "cloud"), { recursive: true });
  writeFileSync(
    join(home, "cloud/device.json"),
    JSON.stringify({
      origin: "https://cloud.example.test",
      token: "device-token",
      account: { id: "account", email: "a@example.test" },
      device: { id: "dev", name: "fixture" },
    }),
  );
  const originalFetch = globalThis.fetch;
  let cutoff = 9;
  const store = new MemoryStore(":memory:");
  globalThis.fetch = async (raw) => {
    const url = new URL(String(raw));
    if (url.pathname === "/api/private/conversations") {
      assert.equal(url.searchParams.get("projectId"),"11111111-1111-4111-8111-111111111111");
      return Response.json(
        url.searchParams.has("cursor")
          ? {
              conversations: [
                { id: "chat", title: "Old work", origin: "codex", cutoff },
              ],
              nextCursor: null,
            }
          : { conversations: [], nextCursor: "next" },
      );
    }
    assert.equal(url.searchParams.get("cutoff"), "9");
    return Response.json({
      conversation: { id: "chat" },
      events: [{ id: "event", text: "Pinned original work" }],
      cutoff: 9,
      nextBefore: 3,
    });
  };
  try {
    bindWorkspace(home,credentials(home)!,fixture.workspace,"11111111-1111-4111-8111-111111111111",fixture.roots);
    const picker = cloudPicker(home, "repo", store);
    const start = await picker.choose(
      "claude",
      fixture.workspace,
      "new-session",
      "",
    );
    const option = (start!.options as any[]).find(
      (option) => option.title === "My synced conversations",
    );
    const chats = await picker.choose(
      "claude",
      fixture.workspace,
      "new-session",
      "",
      option.choiceId,
    );
    const selected = await picker.choose(
      "claude",
      fixture.workspace,
      "new-session",
      "",
      (chats!.options as any[])[0].choiceId,
    );
    assert.equal(selected!.cutoff, 9);
    cutoff = 15;
    const featureId = String(selected!.featureId);
    store.save({
      repoId: "repo",
      featureId,
      sessionId: "new-session",
      eventId: "new",
      kind: "progress",
      content: "Recipient new work",
    });
    const recalled = await picker.recall(featureId, "get_context");
    assert.match(JSON.stringify(recalled), /Pinned original work/);
    assert.match(JSON.stringify(recalled), /Recipient new work/);
    assert.equal(store.context({ repoId: "repo", featureId }).total, 1);
    const older = await picker.recall(featureId, "search_memory", "", 4);
    assert.equal(older.nextCursor, 3);
  } finally {
    store.close();
    globalThis.fetch = originalFetch;
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
