import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  api,
  CloudError,
  credentials,
  credentialsPath,
  defaultServer,
  request,
  serverOrigin,
  type Credentials,
} from "../../../packages/cloud/src/client.ts";
import { atomicWrite } from "../../../packages/installer/src/connections.ts";
import {
  defaultHistoryRoots,
  discoverHistories,
} from "../../../packages/adapters/src/histories.ts";
import {
  bindWorkspace,
  canonicalWorkspace,
  controlSync,
  digest,
  syncStatus,
  syncWorkspace,
  syncDatabase,
} from "../../../packages/cloud/src/local-sync.ts";

type Pairing = {
  pairingId: string;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: string;
  interval: number;
  origin: string;
};
export function registerOnboarding(
  server: McpServer,
  home: string,
  env: NodeJS.ProcessEnv,
  workspace: string,
) {
  const output = (data: Record<string, unknown>) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    structuredContent: data,
  });
  const account = () => {
    const device = credentials(home);
    if (!device)
      throw new Error("Connect this installation first with knitt_connect.");
    return device;
  };
  const pairPath = join(home, "cloud", "pairing.json");
  const previews = new Map<
    string,
    {
      accountId: string;
      deviceId: string;
      origin: string;
      workspace: string;
      roots: ReturnType<typeof defaultHistoryRoots>;
      fingerprint: string;
      expires: number;
    }
  >();
  server.registerTool(
    "knitt_invitations",
    {
      description:
        "List friend invitations independently of personal sync setup. Show sender, title and starting version. Accept or decline only after the user explicitly chooses that invitation and action.",
      inputSchema: {
        action: z.enum(["list", "accept", "decline"]),
        invitationId: z.string().uuid().optional(),
        userApproved: z.boolean().optional(),
      },
    },
    async ({ action, invitationId, userApproved }) => {
      const device = account();
      if (action === "list")
        return output(await api<Record<string, unknown>>(device, "/api/inbox"));
      if (!invitationId || userApproved !== true)
        throw new Error(
          "Show the invitation and obtain explicit user approval for this action.",
        );
      const response = await api<Record<string, unknown>>(
        device,
        "/api/invitations/" + encodeURIComponent(invitationId) + "/" + action,
        {},
      );
      return output({
        ...response,
        next:
          action === "accept"
            ? "Call choose_conversation and let the user select Shared with me, then this context and its published version. Personal autosync remains disabled until separate approval."
            : "Invitation declined.",
      });
    },
  );
  server.registerTool(
    "knitt_status",
    {
      description:
        "Show the connected account, this canonical workspace mapping, consent, pending uploads and errors.",
      inputSchema: {},
    },
    async () => output(syncStatus(home, workspace)),
  );
  server.registerTool(
    "knitt_connect",
    {
      description:
        "Begin browser account approval or poll an existing pairing. This does not upload history. Show the approval code and URL to the user.",
      inputSchema: {
        action: z.enum(["begin", "poll", "reconnect"]),
        userApproved: z.boolean().optional(),
        server: z.string().optional(),
        openBrowser: z.boolean().default(true),
      },
    },
    async (input) => {
      const existing = credentials(home);
      if (existing && input.action !== "reconnect") {
        try {
          await api(existing, "/api/me");
          return output(syncStatus(home, workspace));
        } catch (error) {
          if (
            !(error instanceof CloudError) ||
            ![401, 403].includes(error.status)
          )
            throw error;
          return output({
            ...syncStatus(home, workspace),
            connectionInvalid: true,
            next: "This device authorization was revoked. Ask the user to reconnect, then call knitt_connect with action reconnect and userApproved true. Existing sync mappings stay suspended until separate approval.",
          });
        }
      }
      if (input.action === "reconnect") {
        if (input.userApproved !== true)
          throw new Error(
            "Get explicit user approval before disconnecting this account and reconnecting.",
          );
        if (existing) {
          const db = syncDatabase(home);
          try {
            db.prepare(
              "UPDATE bindings SET enabled=0 WHERE account=? AND origin=?",
            ).run(existing.account.id, existing.origin);
          } finally {
            db.close();
          }
          await request(existing.origin, "/api/devices/current", {
            method: "DELETE",
            token: existing.token,
          }).catch(() => {});
          rmSync(credentialsPath(home), { force: true });
        }
      }
      if (input.action === "begin" || input.action === "reconnect") {
        const origin = serverOrigin(
          input.server ?? env.KNITT_CLOUD_ORIGIN ?? defaultServer,
        );
        const pairing = {
          ...(await request<Omit<Pairing, "origin">>(
            origin,
            "/api/device-pairings",
            { body: { name: hostname() } },
          )),
          origin,
        };
        const url = new URL(pairing.verificationUri, origin);
        if (url.origin !== origin)
          throw new Error("Approval URL belongs to another server.");
        atomicWrite(pairPath, JSON.stringify(pairing));
        if (input.openBrowser) {
          const command =
            process.platform === "darwin"
              ? "open"
              : process.platform === "win32"
                ? "rundll32.exe"
                : "xdg-open";
          const child = spawn(
            command,
            process.platform === "win32"
              ? ["url.dll,FileProtocolHandler", url.href]
              : [url.href],
            { stdio: "ignore", detached: true },
          );
          child.on("error", () => {});
          child.unref();
        }
        return output({
          status: "approval_required",
          verificationUri: url.href,
          userCode: pairing.userCode,
          expiresAt: pairing.expiresAt,
          interval: pairing.interval,
          next: "Ask the user to approve in the browser, then poll. No histories are uploaded until separate workspace consent.",
        });
      }
      if (!existsSync(pairPath))
        throw new Error("Begin account connection first.");
      const pairing = JSON.parse(readFileSync(pairPath, "utf8")) as Pairing;
      if (Date.parse(pairing.expiresAt) < Date.now())
        throw new Error("Pairing expired; begin again.");
      const response = await request<
        { status?: string } & Omit<Credentials, "origin">
      >(pairing.origin, "/api/device-pairings/exchange", {
        body: { pairingId: pairing.pairingId, deviceCode: pairing.deviceCode },
      });
      if (response.status === "pending")
        return output({ status: "pending", interval: pairing.interval });
      if (!response.token || !response.account?.id || !response.device?.id)
        throw new Error("Incomplete pairing response.");
      atomicWrite(
        credentialsPath(home),
        JSON.stringify({
          origin: pairing.origin,
          token: response.token,
          account: response.account,
          device: response.device,
        }),
      );
      rmSync(pairPath);
      return output({
        ...syncStatus(home, workspace),
        next: "Call knitt_preview_sync, show the discovered histories and privacy scope, and ask the user to select or create a project and approve sync.",
      });
    },
  );
  server.registerTool(
    "knitt_preview_sync",
    {
      description:
        "Discover supported local histories for this workspace and list explicit cloud projects. Does not upload text. Show this preview and obtain user approval before enable_sync.",
      inputSchema: {},
    },
    async () => {
      const device = account(),
        roots = defaultHistoryRoots(env),
        canonical = canonicalWorkspace(workspace);
      const histories = discoverHistories({ roots, workspace: canonical });
      const previewId = randomUUID();
      previews.set(previewId, {
        accountId: device.account.id,
        deviceId: device.device.id,
        origin: device.origin,
        workspace: canonical,
        roots,
        fingerprint: digest(
          histories.map((c) => [c.client, c.id, c.root, c.workspace]),
        ),
        expires: Date.now() + 600_000,
      });
      const projects = await api<{ projects: unknown[] }>(
        device,
        "/api/private/projects",
      );
      return output({
        previewId,
        account: device.account,
        workspace: canonical,
        historyRoots: roots,
        histories: histories.map((c) => ({
          agent: c.client ?? "antigravity",
          id: c.id,
          title: c.title,
          workspace: c.workspace,
          modified: c.modified,
        })),
        projects: projects.projects,
        scope:
          "All supported user and assistant text in these workspace histories, including future sessions, is uploaded privately to this account after approval. Secrets are redacted by the existing importer. Tool outputs and unsupported message shapes are excluded. Select an existing project ID or explicitly create a new project; names never autojoin projects.",
      });
    },
  );
  server.registerTool(
    "knitt_enable_sync",
    {
      description:
        "Enable private full-history autosync ONLY after the user approves the preview and explicitly selects a project or asks to create one.",
      inputSchema: {
        previewId: z.string(),
        projectId: z.string().uuid().optional(),
        createTitle: z.string().trim().min(1).max(160).optional(),
        userApproved: z.literal(true),
      },
    },
    async (input) => {
      const device = account(),
        preview = previews.get(input.previewId);
      if (
        !preview ||
        preview.expires < Date.now() ||
        preview.accountId !== device.account.id ||
        preview.deviceId !== device.device.id ||
        preview.origin !== device.origin
      )
        throw new Error("Preview expired or account changed; preview again.");
      if (!!input.projectId === !!input.createTitle)
        throw new Error(
          "Choose one existing project ID or explicitly create a new project.",
        );
      const current = discoverHistories({
        roots: preview.roots,
        workspace: preview.workspace,
      });
      if (
        digest(current.map((c) => [c.client, c.id, c.root, c.workspace])) !==
        preview.fingerprint
      )
        throw new Error(
          "History discovery changed; show a fresh preview before approval.",
        );
      let projectId = input.projectId;
      if (!projectId) {
        const response = await api<{ project: { id: string } }>(
          device,
          "/api/private/projects",
          { id: randomUUID(), title: input.createTitle },
        );
        projectId = response.project.id;
      } else {
        const { projects } = await api<{ projects: { id: string }[] }>(
          device,
          "/api/private/projects",
        );
        if (!projects.some((p) => p.id === projectId))
          throw new Error("Select a project belonging to this account.");
      }
      await api(
        device,
        `/api/private/projects/${encodeURIComponent(projectId)}/consent`,
        { enabled: true },
      );
      bindWorkspace(home, device, preview.workspace, projectId, preview.roots);
      previews.delete(input.previewId);
      return output({
        enabled: true,
        projectId,
        ...((await syncWorkspace(home, env, workspace)) as Record<
          string,
          unknown
        >),
      });
    },
  );
  server.registerTool(
    "knitt_disconnect_account",
    {
      description:
        "Disconnect this device from its account, stop all local cloud uploads, and preserve native history and local memory. Requires the user's explicit request.",
      inputSchema: { userApproved: z.literal(true) },
    },
    async () => {
      const device = account();
      const db = syncDatabase(home);
      try {
        db.prepare(
          "UPDATE bindings SET enabled=0 WHERE account=? AND origin=?",
        ).run(device.account.id, device.origin);
      } finally {
        db.close();
      }
      let remoteRevoked = false;
      let remoteError: string | undefined;
      try {
        await request(device.origin, "/api/devices/current", {
          method: "DELETE",
          token: device.token,
        });
        remoteRevoked = true;
      } catch (error) {
        remoteError = String(error);
      } finally {
        rmSync(credentialsPath(home), { force: true });
      }
      return output({
        connected: false,
        remoteRevoked,
        ...(remoteError ? { remoteError } : {}),
      });
    },
  );
  server.registerTool(
    "knitt_sync",
    {
      description:
        "Retry durable pending uploads and sync complete histories for this approved workspace.",
      inputSchema: {},
    },
    async () =>
      output(
        (await syncWorkspace(home, env, workspace)) as Record<string, unknown>,
      ),
  );
  server.registerTool(
    "knitt_sync_control",
    {
      description:
        "Pause, resume or disconnect this workspace sync. Disconnect removes its local mapping and pending uploads; retained server data stays in the account.",
      inputSchema: { action: z.enum(["pause", "resume", "disconnect"]) },
    },
    async ({ action }) => output(await controlSync(home, workspace, action)),
  );
}
