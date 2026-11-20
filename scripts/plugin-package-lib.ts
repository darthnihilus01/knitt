import { createHash } from "node:crypto";
import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";
export function copyPluginDist(source: string, destination: string) {
  mkdirSync(join(destination, "apps"), { recursive: true });
  cpSync(join(source, "apps", "server"), join(destination, "apps", "server"), { recursive: true });
  cpSync(join(source, "packages"), join(destination, "packages"), { recursive: true });
}
export type Host = "codex" | "claude-code" | "antigravity";
export const targets = [
  "linux-x64",
  "linux-arm64",
  "darwin-x64",
  "darwin-arm64",
  "win32-x64",
  "win32-arm64",
] as const;
export function verifyArchive(bytes: Uint8Array, sums: string, name: string) {
  const expected = sums
    .split(/\r?\n/)
    .map((x) => x.trim().split(/\s+/))
    .find((x) => x[1] === name)?.[0];
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (!expected || expected !== actual)
    throw new Error("Node runtime checksum mismatch: " + name);
  return actual;
}
export function hostFiles(
  host: Host,
  target: string,
  version: string,
): Record<string, string> {
  const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
  const root =
    host === "claude-code" ? "${CLAUDE_PLUGIN_ROOT}" : "${PLUGIN_ROOT}";
  const executable = target.startsWith("win32") ? "node.exe" : "node";
  const runtime = `${root}/scripts/${executable}`;
  const metadata = {
    name: "knitt",
    version,
    description: "Full conversation memory across coding agents",
    author: { name: "Knitt" },
    license: "Apache-2.0",
  };
  const env = {
    MEMORY_CLIENT: host === "claude-code" ? "claude" : host,
    MEMORY_PICKER_MODE: "chat",
  };
  const mcp = {
    mcpServers: {
      knitt: {
        type: "stdio",
        command: host === "codex" ? `./scripts/${executable}` : runtime,
        args: [`${root}/dist/apps/server/src/plugin-main.js`],
        env,
      },
    },
  };
  const files: Record<string, string> = {};
  const events =
    host === "antigravity"
      ? ["SessionStart", "PreInvocation", "PostInvocation", "Stop"]
      : ["SessionStart", "UserPromptSubmit", "Stop"];
  const handler = (event: string) => ({
    type: "command",
    command:
      host === "antigravity"
        ? `"./scripts/${executable}" ./dist/apps/server/src/plugin-hook.js ${event} ${host}`
        : `"${runtime}" "${root}/dist/apps/server/src/plugin-hook.js" ${event} ${host}`,
    timeout: 15,
  });
  if (host === "antigravity") {
    files["plugin.json"] = json({
      ...metadata,
      displayName: "Knitt",
      suggestedPrompts: [
        "Set up Knitt",
        "Continue another agent’s conversation with /knit",
      ],
    });
    files["mcp_config.json"] = json(mcp);
    files["hooks.json"] = json({
      knitt: {
        enabled: true,
        ...Object.fromEntries(events.map((e) => [e, [handler(e)]])),
      },
    });
  } else {
    files["hooks/hooks.json"] = json({
      hooks: Object.fromEntries(
        events.map((e) => [e, [{ hooks: [handler(e)] }]]),
      ),
    });
    if (host === "claude-code") {
      files[".claude-plugin/plugin.json"] = json(metadata);
      files[".mcp.json"] = json(mcp);
    } else {
      const overlay = {
        hooks: "./hooks/hooks.json",
        onboardingSkill: "./skills/knitt-setup/SKILL.md",
        interface: {
          displayName: "Knitt",
          shortDescription: "Continue conversations across coding agents",
          developerName: "Knitt",
          category: "Productivity",
        },
      };
      files["plugin.json"] = json({
        $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
        ...metadata,
        extensions: { "com.openai": overlay },
      });
      files[".codex-plugin/plugin.json"] = json({
        ...metadata,
        ...overlay,
        mcpServers: "./mcp.json",
      });
      files["mcp.json"] = json({ $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json", ...mcp });
    }
  }
  files["README.md"] =
    "# Knitt\n\nInstall through your host’s local plugin interface. Run /knitt-setup to sign in and enable history synchronization. Use /knit to continue a conversation. Lifecycle hooks require host trust. Data and authentication stay outside this plugin folder; removing or updating the plugin preserves them.\n\nHost UI verification is pending; this is a development artifact.\n";
  return files;
}

/** Developer upload package; directory eligibility and review are separate. */
export function codexDirectoryFiles(target: string, version: string) {
  const files = hostFiles("codex", target, version);
  delete files["hooks/hooks.json"];
  for (const name of ["plugin.json", ".codex-plugin/plugin.json"]) {
    const manifest = JSON.parse(files[name]!);
    const extension = name === "plugin.json"
      ? manifest.extensions["com.openai"] : manifest;
    delete extension.hooks;
    extension.requires_local_executor = true;
    extension.interface.shortDescription = "Resume chats across agents";
    extension.interface.longDescription = "Continue coding conversations across agents with private project history sync. This submission targets Linux x64. Knitt reads supported histories only after account connection and project consent. Automatic sync runs while its local MCP adapter is running.";
    files[name] = JSON.stringify(manifest, null, 2) + "\n";
  }
  files["README.md"] = "# Knitt desktop directory submission\n\nThis archive is for the publisher to upload to OpenAI, not for end users to extract. Local MCP submissions require an allowlisted OpenAI organization and directory review. After publication, users install through Plugin Management.\n\nThis package declares no lifecycle hooks. Its local adapter discovers and synchronizes approved project histories while the adapter is running. When stopped, native histories remain in the source agents and can be imported on the next run. Account approval alone never grants project sync consent. Run Knitt setup in the agent, then use /knit to select a conversation.\n";
  return files;
}
