import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

test("connector setup prepares a reviewable OAuth profile and rejects non-HTTPS URLs", () => {
  const workspace = mkdtempSync(join(tmpdir(), "web-setup-"));
  try {
    execFileSync("git", ["init", "--initial-branch=main", workspace], { stdio: "ignore" });
    const command = resolve("scripts/connector-setup.ts");
    const args = [command, "--client", "chatgpt", "--workspace", workspace, "--preview"];
    const pending = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(pending.status, 0, pending.stderr);
    const pendingProfile = JSON.parse(pending.stdout);
    assert.equal(pendingProfile.status, "configuration_required");
    assert.equal(pendingProfile.missing.length, 3);
    const ready = spawnSync(process.execPath, [
      ...args, "--public-url", "https://memory.example", "--issuer", "https://identity.example", "--subject", "owner",
    ], { encoding: "utf8" });
    assert.equal(ready.status, 0, ready.stderr);
    const json = ready.stdout.slice(0, ready.stdout.indexOf("\nStart the authenticated"));
    const profile = JSON.parse(json);
    assert.equal(profile.server.publicUrl, "https://memory.example/mcp");
    assert.equal(profile.status, "ready_to_serve");
    const invalid = spawnSync(process.execPath, [...args, "--public-url", "http://public.example"], { encoding: "utf8" });
    assert.equal(invalid.status, 1);
    assert.ok(invalid.stderr.includes("HTTPS"));
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

test("Claude Desktop gets a local connector profile with chat-session initialization", () => {
  const workspace = mkdtempSync(join(tmpdir(), "desktop-setup-"));
  try {
    const result = spawnSync(process.platform === "win32" ? "python" : "python3", [resolve("scripts/connect.py"), "--client", "claude-desktop",
      "--workspace", workspace, "--node", process.execPath, "--repo-id", "repo", "--apply"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const profile = JSON.parse(readFileSync(join(workspace, ".memory/connectors/claude-desktop.json"), "utf8"));
    const connection = Object.values(profile.mcpServers)[0] as { env: Record<string, string> };
    assert.equal(connection.env.MEMORY_CHAT_CLIENT, "claude-desktop");
    assert.equal(connection.env.MEMORY_SESSION_SELECTION, "1");
    assert.equal(connection.env.MEMORY_REPO, "repo");
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});
