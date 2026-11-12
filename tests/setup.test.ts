import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

test("connection install preserves settings, backs up changes, and is repeatable", () => {
  const workspace = mkdtempSync(join(tmpdir(), "memory setup '"));
  try {
    mkdirSync(join(workspace, ".codex"));
    mkdirSync(join(workspace, ".agents"));
    const codexPath = join(workspace, ".codex/config.toml");
    writeFileSync(codexPath, 'model = "existing-model"\n');
    writeFileSync(join(workspace, ".agents/hooks.json"), JSON.stringify({ existing: { Stop: [{ command: "echo keep" }] } }));
    writeFileSync(join(workspace, ".codex/hooks.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "echo keep" }] }] } }));
    const args = [resolve("scripts/connect.py"), "--workspace", workspace, "--app-root", process.cwd(), "--node", process.execPath, "--repo-id", "test/repo"];
    const preview = spawnSync("python3", args, { encoding: "utf8" });
    assert.equal(preview.status, 0, preview.stderr);
    assert.equal(readFileSync(codexPath, "utf8"), 'model = "existing-model"\n');
    const run = () => spawnSync("python3", [...args, "--apply"], { encoding: "utf8" });
    const installed = run();
    assert.equal(installed.status, 0, installed.stderr);
    assert.ok(readFileSync(codexPath, "utf8").startsWith('model = "existing-model"'));
    const before = readFileSync(join(workspace, ".codex/hooks.json"), "utf8");
    assert.equal(run().status, 0);
    assert.equal(readFileSync(join(workspace, ".codex/hooks.json"), "utf8"), before);
    const ag = JSON.parse(readFileSync(join(workspace, ".agents/hooks.json"), "utf8"));
    assert.ok(ag.existing);
    assert.ok(ag["shared-memory"]);
    const cx = JSON.parse(before);
    assert.equal(cx.hooks.Stop.length, 2);
    assert.ok(existsSync(join(workspace, ".memory/connection-backup.json")));
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

test("scope follows the active branch without per-session environment setup", async () => {
  const { execFileSync } = await import("node:child_process");
  const { resolveScope } = await import("../packages/adapters/src/scope.ts");
  const workspace = mkdtempSync(join(tmpdir(), "memory-branch-"));
  try {
    execFileSync("git", ["init", "--initial-branch=feature/retries", workspace], { stdio: "ignore" });
    assert.deepEqual(resolveScope({ workspacePaths: [workspace] }, { MEMORY_REPO: "repo" }), {
      repoId: "repo", featureId: "feature/retries", branch: "feature/retries",
    });
    assert.deepEqual(resolveScope({}, { MEMORY_REPO: "repo", MEMORY_FEATURE: "shared-feature" }), {
      repoId: "repo", featureId: "shared-feature",
    });
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});
