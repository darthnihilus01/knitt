import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(
  process.argv[2] ?? `plugin-artifacts/${process.platform}-${process.arch}`,
);
const temporary = mkdtempSync(join(tmpdir(), "knitt-installed-plugin-"));
const workspace = join(temporary, "project");
mkdirSync(workspace);
try {
  for (const host of ["codex", "claude-code", "antigravity"]) {
    const plugin = join(root, "plugins", host, "knitt");
    const runtime = join(
      plugin,
      "scripts",
      process.platform === "win32" ? "node.exe" : "node",
    );
    assert.match(
      execFileSync(runtime, ["--version"], { encoding: "utf8" }),
      /^v24\./,
    );
    const home = join(temporary, host);
    mkdirSync(home);
    writeFileSync(
      join(home, "preserved-state"),
      "survives plugin startup and shutdown",
    );
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      KNITT_HOME: home,
      MEMORY_CLIENT: host === "claude-code" ? "claude" : host,
    };
    delete env.MEMORY_WORKSPACE;
    const client = new Client({
      name: "plugin-artifact-verification",
      version: "1",
    }, { capabilities: { roots: { listChanged: true } } });
    client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: [{ uri: pathToFileURL(workspace).href }] }));
    const manifestName = host === "codex" ? "mcp.json" : host === "claude-code" ? ".mcp.json" : "mcp_config.json";
    const manifest = JSON.parse(readFileSync(join(plugin, manifestName), "utf8")).mcpServers.knitt;
    if (host === "codex") assert.match(manifest.command, /^\.\//);
    const expand = (value: string) => value.replaceAll("${PLUGIN_ROOT}", plugin).replaceAll("${CLAUDE_PLUGIN_ROOT}", plugin);
    try {
      await client.connect(
        new StdioClientTransport({
          command: resolve(plugin, expand(manifest.command)),
          args: manifest.args.map(expand),
          cwd: plugin,
          env,
        }),
      );
      const tools = (await client.listTools()).tools.map((tool) => tool.name);
      for (const name of [
        "knitt_status",
        "knitt_connect",
        "knitt_preview_sync",
        "knitt_enable_sync",
        "knitt_invitations",
        "choose_conversation",
      ])
        assert.ok(tools.includes(name), `${host} missing ${name}`);
      const status = await client.callTool({
        name: "knitt_status",
        arguments: {},
      });
      assert.equal(status.isError, undefined);
      assert.equal(
        (status.structuredContent as { connected: boolean }).connected,
        false,
      );
      assert.equal((status.structuredContent as { workspace: string }).workspace, workspace);
    } finally {
      await client.close();
    }
    const payload = JSON.stringify({
      cwd: workspace,
      session_id: "artifact-session",
    });
    const hook = execFileSync(
      runtime,
      [
        join(plugin, "dist/apps/server/src/plugin-hook.js"),
        "SessionStart",
        host,
      ],
      { env, input: payload, encoding: "utf8" },
    );
    assert.match(hook, /artifact-session/);
    assert.match(hook, /knitt_status/);
    assert.equal(
      readFileSync(join(home, "preserved-state"), "utf8"),
      "survives plugin startup and shutdown",
    );
    console.log(
      `PASS ${host}: bundled runtime, installed MCP tools, start hook and external state preservation`,
    );
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
