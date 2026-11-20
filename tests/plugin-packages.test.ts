import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  verifyArchive,
  hostFiles,
} from "../scripts/plugin-package-lib.ts";
test("runtime checksums fail closed", () => {
  const bytes = Buffer.from("runtime");
  const hash = createHash("sha256").update(bytes).digest("hex");
  assert.equal(
    verifyArchive(bytes, `${hash}  node.tar.xz\n`, "node.tar.xz"),
    hash,
  );
  assert.throws(
    () => verifyArchive(bytes, `${"0".repeat(64)}  node.tar.xz`, "node.tar.xz"),
    /checksum/,
  );
  assert.throws(() => verifyArchive(bytes, "", "node.tar.xz"), /checksum/);

});
test("native manifests use bundled runtime, host hooks, and setup skill", () => {
  for (const host of ["codex", "claude-code", "antigravity"] as const) {
    const files = hostFiles(host, "linux-x64", "0.1.0-test");
    const all = JSON.stringify(files);
    assert.match(all, /scripts\/node/);
    assert.doesNotMatch(all, /npx|npm install/);
    assert.match(all, /plugin-main.js/);
    assert.match(all, /plugin-hook.js/);
    assert.match(all, /knitt-setup/);
  }
  const ag = hostFiles("antigravity", "win32-arm64", "1.0.0");
  assert.match(ag["mcp_config.json"]!, /node.exe/);
  assert.ok(JSON.parse(ag["hooks.json"]!).knitt.SessionStart);
});

test('Codex portable MCP executable is a contained relative path', () => {
  for (const target of ['linux-x64', 'win32-arm64']) {
    const files = hostFiles('codex', target, '0.1.0-test');
    const server = JSON.parse(files['mcp.json']!).mcpServers.knitt;
    assert.equal(server.command, target.startsWith('win32') ? './scripts/node.exe' : './scripts/node');
  }
});

test('directory submission uses local MCP without lifecycle hook declarations', async () => {
  const {codexDirectoryFiles} = await import('../scripts/plugin-package-lib.ts');
  const files=codexDirectoryFiles('linux-x64','0.1.0-beta.6-directory.1');
  const root=JSON.parse(files['plugin.json']!);
  const overlay=JSON.parse(files['.codex-plugin/plugin.json']!);
  assert.equal(root.extensions['com.openai'].requires_local_executor,true);
  assert.equal(root.extensions['com.openai'].hooks,undefined);
  assert.equal(overlay.hooks,undefined);
  const listing = root.extensions['com.openai'].interface;
  assert.equal(overlay.interface.shortDescription, listing.shortDescription);
  assert.ok(listing.shortDescription.length > 0 && listing.shortDescription.length <= 30);
  assert.equal(files['hooks/hooks.json'],undefined);
  assert.equal(root.extensions['com.openai'].apps,undefined);
  assert.equal(JSON.parse(files['mcp.json']!).mcpServers.knitt.command,'./scripts/node');
});
