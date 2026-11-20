import assert from "node:assert/strict";
import test from "node:test";
import { cloudDatabase } from "./fixtures/cloud-db.ts";
import worker from "../apps/cloud/src/worker.ts";
import { hash } from "../apps/cloud/src/identity.ts";
async function setup() {
  const { db, binding } = cloudDatabase(),
    env = { DB: binding, APP_ORIGIN: "https://knitt.example" };
  const tokens: Record<string, string> = {};
  for (const user of ["alice", "bob", "carol"]) {
    tokens[user] = "knitt_" + user[0].repeat(43);
    db.prepare(
      "INSERT INTO accounts(id,issuer,subject,email) VALUES(?,?,?,?)",
    ).run(user, "test", user, user + "@example.com");
    db.prepare(
      "INSERT INTO devices(id,token_hash,account_id,name,created_at,last_used_at,expires_at) VALUES(?,?,?,?,?,?,?)",
    ).run(
      user,
      await hash(tokens[user]),
      user,
      user,
      Date.now(),
      Date.now(),
      Date.now() + 60000,
    );
  }
  const call = async (
    user: string,
    path: string,
    method = "GET",
    body?: unknown,
  ) => {
    const response = await worker.fetch(
      new Request(env.APP_ORIGIN + "/api/private/" + path, {
        method,
        headers: {
          Authorization: "Bearer " + tokens[user],
          "Content-Type": "application/json",
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
      env,
    );
    return { status: response.status, data: await response.json() };
  };
  const ok = async (
    user: string,
    path: string,
    method = "GET",
    body?: unknown,
  ) => {
    const r = await call(user, path, method, body);
    assert.ok(r.status < 300, JSON.stringify(r));
    return r.data;
  };
  return { db, env, call, ok };
}
const event = (sequence: number, text = "Text " + sequence) => ({
  id: "event-" + sequence,
  sequence,
  role: sequence % 2 ? "assistant" : "user",
  text,
  timestamp: "2026-11-19T00:00:00Z",
});
const batch = (
  projectId: string,
  batchId: string,
  events = [event(0), event(1)],
) => ({
  projectId,
  batchId,
  conversations: [
    {
      id: "conversation",
      origin: "codex",
      sessionId: "session",
      title: "Private history",
      provenance: { agent: "codex", installationId: "install" },
      events,
    },
  ],
});
test("three accounts: full private ordered text sync, idempotency, consent and isolation", async () => {
  const { db, ok, call } = await setup();
  try {
    const p = (await ok("alice", "projects", "POST", { title: "Project" }))
      .project;
    assert.equal(
      (await call("alice", "sync", "POST", batch(p.id, "first"))).status,
      403,
    );
    await ok("alice", `projects/${p.id}/consent`, "POST", { enabled: true });
    const input = batch(p.id, "first", [
      event(2, "Full tool output\n" + "x".repeat(20000)),
      event(0),
      event(1),
    ]);
    const results = await Promise.all([
      ok("alice", "sync", "POST", input),
      ok("alice", "sync", "POST", input),
    ]);
    assert.equal(results[0].lastSyncAt, results[1].lastSyncAt);
    const list = await ok("alice", "conversations");
    assert.equal(list.conversations[0].eventCount, 3);
    const cutoff = list.conversations[0].cutoff;
    const ctx = await ok("alice", "conversations/conversation/context?limit=2");
    assert.deepEqual(
      ctx.events.map((e: any) => e.sequence),
      [1, 2],
    );
    assert.equal(ctx.events[1].text, input.conversations[0].events[0].text);
    assert.equal(ctx.nextBefore, 1);
    assert.deepEqual(
      (
        await ok("alice", "conversations/conversation/context?before=1")
      ).events.map((e: any) => e.sequence),
      [0],
    );
    assert.equal(
      (
        await call(
          "alice",
          "sync",
          "POST",
          batch(p.id, "first", [event(0, "Changed")]),
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await call(
          "alice",
          "sync",
          "POST",
          batch(p.id, "mutation", [event(0, "Changed"), event(3)]),
        )
      ).status,
      409,
    );
    assert.equal(
      (await ok("alice", "conversations")).conversations[0].eventCount,
      3,
    );
    await ok("alice", `projects/${p.id}/control`, "POST", { action: "pause" });
    assert.equal(
      (await call("alice", "sync", "POST", batch(p.id, "offline", [event(3)])))
        .status,
      403,
    );
    await ok("alice", `projects/${p.id}/control`, "POST", { action: "resume" });
    await ok(
      "alice",
      "sync",
      "POST",
      batch(p.id, "offline", [event(3, "Resumed work")]),
    );
    assert.equal(
      (await ok("alice", `conversations/conversation/context?cutoff=${cutoff}`))
        .events.length,
      3,
    );
    assert.equal(
      (
        await ok(
          "alice",
          `conversations/conversation/search?q=Resumed&cutoff=${cutoff}`,
        )
      ).results.length,
      0,
    );
    assert.equal(
      (
        await call(
          "alice",
          `conversations/conversation/evidence?eventId=event-3&cutoff=${cutoff}`,
        )
      ).status,
      404,
    );
    for (const other of ["bob", "carol"]) {
      assert.deepEqual((await ok(other, "projects")).projects, []);
      assert.deepEqual((await ok(other, "conversations")).conversations, []);
      for (const suffix of [
        "context",
        "search?q=Text",
        "evidence?eventId=event-0",
      ])
        assert.equal(
          (await call(other, "conversations/conversation/" + suffix)).status,
          404,
        );
      assert.equal(
        (
          await call(other, `projects/${p.id}/consent`, "POST", {
            enabled: true,
          })
        ).status,
        404,
      );
      assert.equal(
        (await call(other, "sync", "POST", batch(p.id, "stolen"))).status,
        404,
      );
    }
    assert.equal(db.prepare("SELECT count(*) AS n FROM contexts").get()!.n, 0);
    await ok("alice", `projects/${p.id}/control`, "POST", {
      action: "disconnect",
    });
    assert.equal(
      (
        await call("alice", `projects/${p.id}/control`, "POST", {
          action: "resume",
        })
      ).status,
      409,
    );
    await ok("alice", `projects/${p.id}/consent`, "POST", { enabled: true });
    db.prepare("DELETE FROM devices WHERE id=?").run("alice");
    assert.equal(
      (await call("alice", "sync", "POST", batch(p.id, "revoked"))).status,
      401,
    );
  } finally {
    db.close();
  }
});
test("atomic write rechecks consent after authentication and retries remain safe", async () => {
  const { db, env, ok } = await setup();
  try {
    const p = (await ok("alice", "projects", "POST", { title: "P" })).project;
    await ok("alice", `projects/${p.id}/consent`, "POST", { enabled: true });
    const { handlePrivateSync } = await import(
      "../apps/cloud/src/private-sync.ts"
    );
    const auth = {
      account: {
        id: "alice",
        email: "alice@example.com",
        emailVerified: true,
        username: null,
        createdAt: "",
      },
      deviceId: "alice",
      sessionHash: null,
      csrfToken: null,
    };
    const original = env.DB.prepare;
    let intercepted = false;
    env.DB.prepare = (sql: string) => {
      if (sql.startsWith("INSERT INTO private_batches") && !intercepted) {
        intercepted = true;
        db.prepare("UPDATE private_project_devices SET status='paused'").run();
      }
      return original(sql);
    };
    await assert.rejects(
      handlePrivateSync(
        new Request(env.APP_ORIGIN + "/api/private/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(batch(p.id, "race")),
        }),
        env,
        auth,
      ),
      { status: 403 },
    );
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM private_events").get()!.n,
      0,
    );
    env.DB.prepare = original;
    await ok("alice", `projects/${p.id}/control`, "POST", { action: "resume" });
    await ok("alice", "sync", "POST", batch(p.id, "race"));
    assert.equal(
      (await ok("alice", "projects")).projects[0].installations[0].status,
      "active",
    );
  } finally {
    db.close();
  }
});
test("browser can manage prior installations but cannot grant private sync consent", async () => {
  const { db, env, ok } = await setup();
  try {
    const p = (await ok("alice", "projects", "POST", { title: "P" })).project;
    const token = "s".repeat(43),
      csrf = await hash("csrf:" + token);
    db.prepare(
      "INSERT INTO browser_sessions(token_hash,account_id,expires_at) VALUES(?,?,?)",
    ).run(await hash(token), "alice", Date.now() + 60000);
    const browser = async (action: string, input: unknown) =>
      worker.fetch(
        new Request(
          env.APP_ORIGIN + `/api/private/projects/${p.id}/${action}`,
          {
            method: "POST",
            headers: {
              Cookie: "__Host-knitt_session=" + token,
              Origin: env.APP_ORIGIN,
              "X-CSRF-Token": csrf,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(input),
          },
        ),
        env,
      );
    assert.equal((await browser("consent", { enabled: true })).status, 403);
    assert.equal(
      (await browser("control", { action: "resume", deviceId: "alice" }))
        .status,
      409,
    );
    await ok("alice", `projects/${p.id}/consent`, "POST", { enabled: true });
    assert.equal(
      (await browser("control", { action: "pause", deviceId: "alice" })).status,
      200,
    );
    assert.equal(
      (await browser("control", { action: "resume", deviceId: "alice" }))
        .status,
      200,
    );
    assert.equal(
      (await browser("control", { action: "disconnect", deviceId: "alice" }))
        .status,
      200,
    );
    assert.equal(
      (await browser("control", { action: "resume", deviceId: "alice" }))
        .status,
      409,
    );
  } finally {
    db.close();
  }
});

test("private project conversations paginate and account namespaces keep identical source IDs isolated", async () => {
  const { db, ok, call } = await setup();
  try {
    for (const user of ["alice", "bob", "carol"]) {
      const project = (await ok(user, "projects", "POST", { title: user }))
        .project;
      await ok(user, `projects/${project.id}/consent`, "POST", {
        enabled: true,
      });
      await ok(
        user,
        "sync",
        "POST",
        batch(project.id, "same-batch", [event(0, user + " secret")]),
      );
      assert.equal(
        (await ok(user, "conversations/conversation/context")).events[0].text,
        user + " secret",
      );
    }
    const project = (await ok("alice", "projects")).projects[0];
    const insert = db.prepare(
      `INSERT INTO private_conversations(account_id,id,project_id,origin,session_id,title,provenance) VALUES(?,?,?,?,?,?,?)`,
    );
    for (let i = 0; i < 205; i++)
      insert.run(
        "alice",
        "item-" + String(i).padStart(3, "0"),
        project.id,
        "test",
        "session-" + i,
        "Title",
        "{}",
      );
    const first = await ok("alice", "conversations");
    assert.equal(first.conversations.length, 200);
    assert.ok(first.nextCursor);
    const second = await ok(
      "alice",
      "conversations?cursor=" + first.nextCursor,
    );
    assert.equal(second.conversations.length, 6);
    assert.equal(second.nextCursor, null);
    assert.equal(
      new Set(
        [...first.conversations, ...second.conversations].map((c: any) => c.id),
      ).size,
      206,
    );
    assert.equal(
      (await call("alice", "conversations/conversation/context?limit=101"))
        .status,
      400,
    );
    assert.equal(
      (
        await call(
          "alice",
          "sync",
          "POST",
          batch(project.id, "too-large", [event(9, "x".repeat(64001))]),
        )
      ).status,
      400,
    );
    const invalid = batch(project.id, "ambiguous", [event(8), event(8)]);
    assert.equal((await call("alice", "sync", "POST", invalid)).status, 400);
  } finally {
    db.close();
  }
});

test("runtime heartbeat never grants consent or claims current before initial sync", async () => {
  const { db, ok, call } = await setup();
  try {
    const p = (await ok("alice", "projects", "POST", { title: "P" })).project;
    const status = `projects/${p.id}/status`;
    assert.equal(
      (
        await call("alice", status, "POST", {
          status: "up_to_date",
          pendingCount: 0,
        })
      ).status,
      409,
    );
    await ok("alice", `projects/${p.id}/consent`, "POST", { enabled: true });
    assert.equal(
      (
        await call("alice", status, "POST", {
          status: "up_to_date",
          pendingCount: 0,
        })
      ).status,
      409,
    );
    await ok("alice", status, "POST", { status: "syncing", pendingCount: 2 });
    await ok("alice", "sync", "POST", batch(p.id, "initial"));
    await ok("alice", status, "POST", {
      status: "up_to_date",
      pendingCount: 0,
    });
    const installation = (await ok("alice", "projects")).projects[0]
      .installations[0];
    assert.equal(installation.runtimeStatus, "up_to_date");
    assert.ok(installation.lastSeenAt);
    assert.ok(installation.lastSyncAt);
    assert.equal(
      (
        await call("alice", status, "POST", {
          status: "up_to_date",
          pendingCount: 1,
        })
      ).status,
      400,
    );
    await ok("alice", `projects/${p.id}/control`, "POST", { action: "pause" });
    assert.equal(
      (
        await call("alice", status, "POST", {
          status: "up_to_date",
          pendingCount: 0,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await call("bob", status, "POST", {
          status: "offline",
          pendingCount: 4,
        })
      ).status,
      404,
    );
  } finally {
    db.close();
  }
});
