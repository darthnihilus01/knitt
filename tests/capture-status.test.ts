import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { readCaptureStatuses } from "../packages/adapters/src/status.ts";
test("capture health distinguishes no observation, delivery and unsupported hook text", () => {
  const dir = mkdtempSync(join(tmpdir(), "knitt-status-"));
  const queue = join(dir, "queue");
  const env = {
    ...process.env,
    MEMORY_DB: join(dir, "events.sqlite"),
    MEMORY_QUEUE: queue,
    MEMORY_REPO: "r",
    MEMORY_CONVERSATION_MODE: "1",
    MEMORY_CAPTURE_NEW_SESSIONS: "1",
  };
  delete (env as Record<string, string | undefined>).NODE_TEST_CONTEXT;
  try {
    assert.deepEqual(readCaptureStatuses(queue), []);
    const run = (payload: object) =>
      spawnSync(
        process.execPath,
        [resolve("packages/adapters/src/cli.ts"), "capture", "codex"],
        {
          env,
          input: JSON.stringify({ session_id: "s", ...payload }),
          encoding: "utf8",
        },
      );
    const good = run({ last_assistant_message: "remember this" });
    assert.equal(good.status, 0, good.stderr);
    let status = readCaptureStatuses(queue)[0];
    assert.ok(status.lastCaptureAt);
    assert.ok(status.lastDeliveryAt);
    assert.equal(status.pending, 0);
    assert.equal(status.lastErrorCode, null);
    run({});
    status = readCaptureStatuses(queue)[0];
    assert.equal(status.lastErrorCode, "CAPTURE_FAILED");
    assert.ok(status.lastDeliveryAt);
    assert.ok(!JSON.stringify(status).includes("remember this"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
