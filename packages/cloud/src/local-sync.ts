import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { credentials, api, CloudError, type Credentials } from "./client.ts";
import {
  defaultHistoryRoots,
  discoverHistories,
} from "../../adapters/src/histories.ts";
import { describeConversation } from '../../adapters/src/conversation.ts';
import { importConversation } from "../../adapters/src/handoff.ts";
import { MemoryStore } from "../../memory/src/store.ts";

export const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export type SyncProgress = {
  imported: number; delivered: number; importErrors: number;
  incompleteSources: number; emptySources: number; discovered: number;
};
export class SyncFailure extends Error {
  report: SyncProgress;
  constructor(cause: unknown, report: SyncProgress) {
    super(cause instanceof Error ? cause.message : String(cause), {cause});
    this.report = report;
  }
}
export function canonicalWorkspace(workspace: string) {
  return realpathSync(resolve(workspace));
}
export function syncDatabase(home: string) {
  const directory = join(home, "cloud");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "sync.sqlite");
  const db = new DatabaseSync(path);
  chmodSync(path, 0o600);
  db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS bindings(key TEXT PRIMARY KEY,origin TEXT NOT NULL,account TEXT NOT NULL,workspace TEXT NOT NULL,project TEXT NOT NULL,enabled INTEGER NOT NULL,roots TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS uploads(id TEXT PRIMARY KEY,binding TEXT NOT NULL,payload TEXT NOT NULL,delivered INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS source_names(binding TEXT NOT NULL, agent TEXT NOT NULL, native TEXT NOT NULL, source TEXT NOT NULL, cloud_session TEXT NOT NULL, PRIMARY KEY(binding,source), UNIQUE(binding,agent,cloud_session));
    CREATE TABLE IF NOT EXISTS sync_errors(binding TEXT PRIMARY KEY,message TEXT NOT NULL,at TEXT NOT NULL);`);
  db.prepare("INSERT OR IGNORE INTO settings VALUES(?,?)").run(
    "installationId",
    randomUUID(),
  );
  return db;
}
export function bindingKey(device: Credentials, workspace: string) {
  return digest([
    device.origin,
    device.account.id,
    device.device.id,
    canonicalWorkspace(workspace),
  ]);
}
function onboardingKey(workspace: string, device: Credentials | null) {
  return "onboardingDismissed:" + digest([canonicalWorkspace(workspace), device?.origin ?? "", device?.account.id ?? "anonymous", device?.device.id ?? ""]);
}
export function dismissOnboarding(home: string, workspace: string) {
  const db = syncDatabase(home);
  try { db.prepare("INSERT OR REPLACE INTO settings VALUES(?,?)").run(onboardingKey(workspace, credentials(home)), new Date().toISOString()); }
  finally { db.close(); }
  return syncStatus(home, workspace);
}
export function syncStatus(home: string, workspace: string) {
  const device = credentials(home),
    db = syncDatabase(home);
  try {
    const binding = device
      ? db
          .prepare("SELECT project,enabled,roots FROM bindings WHERE key=?")
          .get(bindingKey(device, workspace))
      : undefined;
    const key = device ? bindingKey(device, workspace) : "";
    const pending = db
      .prepare(
        "SELECT COUNT(*) AS count FROM uploads WHERE binding=? AND delivered=0",
      )
      .get(key);
    const error = db
      .prepare("SELECT message,at FROM sync_errors WHERE binding=?")
      .get(key);
    const dismissed = !!db.prepare("SELECT 1 FROM settings WHERE key=?").get(onboardingKey(workspace, device));
    const pendingCount = Number(pending?.count ?? 0);
    const lastSuccessfulSync = db.prepare("SELECT value FROM settings WHERE key=?")
      .get("lastSync:" + key)?.value ?? null;
    const setupState = !device ? "account_connection_required"
      : !binding ? "sync_approval_required"
      : !binding.enabled ? "paused"
      : error ? "sync_error"
      : pendingCount || !lastSuccessfulSync ? "initial_sync_pending" : "synced";
    const guidance = {
      account_connection_required: ["Account connection required", "Call knitt_connect to pair this installation; then preview and approve project sync."],
      sync_approval_required: ["Account connected · project sync required", "Call knitt_preview_sync, show the discovered history and scope, and obtain explicit project choice and upload approval before knitt_enable_sync."],
      paused: ["Project sync paused", "Ask for explicit approval before calling knitt_sync_control with action resume."],
      sync_error: ["Project sync needs attention", "Report the error and pending uploads. Retry with knitt_sync; if authorization was revoked, ask for explicit reconnect approval."],
      initial_sync_pending: ["Waiting for project history sync", "Call knitt_sync and report its import and cloud verification result. If no supported chats are found, explain that instead of claiming history is ready."],
      synced: ["Project history synced", "Use knitt_sync to verify current cloud visibility before claiming chats are available; use /knit to continue work."],
    };
    return {
      setupState,
      onboarding: {offer: !binding && !dismissed, dismissed},
      statusMessage: guidance[setupState][0],
      nextAction: guidance[setupState][1],
      connected: !!device,
      account: device?.account,
      device: device?.device,
      workspace: canonicalWorkspace(workspace),
      binding: binding
        ? {
            projectId: String(binding.project),
            enabled: !!binding.enabled,
            historyRoots: JSON.parse(String(binding.roots)),
          }
        : null,
      pending: pendingCount,
      error: error ?? null,
      lastSuccessfulSync,
    };
  } finally {
    db.close();
  }
}
export function bindWorkspace(
  home: string,
  device: Credentials,
  workspace: string,
  projectId: string,
  roots: ReturnType<typeof defaultHistoryRoots>,
) {
  const db = syncDatabase(home);
  try {
    const key = bindingKey(device, workspace);
    const previous = db
      .prepare("SELECT project, roots FROM bindings WHERE key=?")
      .get(key);
    if (!previous || previous.project !== projectId || previous.roots !== JSON.stringify(roots)) {
      db.prepare("DELETE FROM uploads WHERE binding=?").run(key);
      db.prepare("DELETE FROM sync_errors WHERE binding=?").run(key);
      db.prepare("DELETE FROM settings WHERE key=?").run("lastSync:" + key);
    }
    db.prepare(
      "INSERT INTO bindings VALUES(?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET project=excluded.project,enabled=1,roots=excluded.roots",
    ).run(
      bindingKey(device, workspace),
      device.origin,
      device.account.id,
      canonicalWorkspace(workspace),
      projectId,
      1,
      JSON.stringify(roots),
    );
  } finally {
    db.close();
  }
}
export async function controlSync(
  home: string,
  workspace: string,
  action: "pause" | "resume" | "disconnect",
) {
  const device = credentials(home);
  if (!device) throw new Error("Connect an account first.");
  const db = syncDatabase(home);
  try {
    const key = bindingKey(device, workspace),
      binding = db.prepare("SELECT * FROM bindings WHERE key=?").get(key);
    if (!binding)
      throw new Error("This workspace has no approved sync mapping.");
    // Disable locally first, including when the server is offline.
    if (action !== "resume")
      db.prepare("UPDATE bindings SET enabled=0 WHERE key=?").run(key);
    await api(
      device,
      `/api/private/projects/${encodeURIComponent(String(binding.project))}/control`,
      { action },
    );
    if (action === "resume")
      db.prepare("UPDATE bindings SET enabled=1 WHERE key=?").run(key);
    if (action === "disconnect") {
      db.prepare("DELETE FROM uploads WHERE binding=?").run(key);
      db.prepare("DELETE FROM bindings WHERE key=?").run(key);
      db.prepare("DELETE FROM sync_errors WHERE binding=?").run(key);
      db.prepare("DELETE FROM settings WHERE key=?").run("lastSync:" + key);
    }
    return { action, enabled: action === "resume" };
  } finally {
    db.close();
  }
}
const running = new Map<string, Promise<unknown>>();
export function syncWorkspace(
  home: string,
  env: NodeJS.ProcessEnv,
  workspace: string,
): Promise<unknown> {
  const key = resolve(home) + ":" + canonicalWorkspace(workspace);
  const active = running.get(key);
  if (active) return active;
  const promise = performSync(home, env, workspace).finally(() =>
    running.delete(key),
  );
  running.set(key, promise);
  return promise;
}
async function performSync(
  home: string,
  _env: NodeJS.ProcessEnv,
  workspace: string,
) {
  const device = credentials(home);
  if (!device) return { skipped: "disconnected" };
  const db = syncDatabase(home),
    key = bindingKey(device, workspace);
  let imported = 0, importErrors = 0, incompleteSources = 0, emptySources = 0, delivered = 0, discovered = 0;
  try {
    const binding = db
      .prepare("SELECT * FROM bindings WHERE key=? AND enabled=1")
      .get(key);
    if (!binding) return { skipped: "consent_required_or_paused" };
    await api(
      device,
      `/api/private/projects/${encodeURIComponent(String(binding.project))}/status`,
      {
        status: "syncing",
        pendingCount: Number(
          db
            .prepare(
              "SELECT COUNT(*) AS count FROM uploads WHERE binding=? AND delivered=0",
            )
            .get(key)!.count,
        ),
      },
    ).catch(() => {});
    const installationId = String(
      db
        .prepare("SELECT value FROM settings WHERE key=?")
        .get("installationId")!.value,
    );
    const roots = JSON.parse(String(binding.roots)) as ReturnType<
      typeof defaultHistoryRoots
    >;
    const conversations = discoverHistories({
      roots,
      workspace: canonicalWorkspace(workspace),
    });
    discovered = conversations.length;
    const syncedConversations: {id: string; eventCount: number}[] = [];
    for (const conversation of conversations) {
      try {
        const root = realpathSync(conversation.root),
          agent = conversation.client ?? "antigravity";
        const metadataIdentity=describeConversation(conversation).sourceId;
        let sourceName=db.prepare("SELECT cloud_session FROM source_names WHERE binding=? AND source=?").get(key,metadataIdentity);
        if(!sourceName){
          const primary=db.prepare("SELECT 1 FROM source_names WHERE binding=? AND agent=? AND cloud_session=?").get(key,agent,conversation.id);
          const cloudSession=primary?conversation.id+"@"+metadataIdentity.slice(0,16):conversation.id;
          db.prepare("INSERT INTO source_names VALUES(?,?,?,?,?)").run(key,agent,conversation.id,metadataIdentity,cloudSession);
          sourceName={cloud_session:cloudSession};
        }
        const cloudSession=String(sourceName.cloud_session);
        const id = digest([binding.project, agent, cloudSession]);
        const directory = join(home, "cloud", "imports", id);
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        const store = new MemoryStore(join(directory, "events.sqlite"));
        const events: {
          id: string;
          sequence: number;
          role: string;
          text: string;
        }[] = [];
        try {
          let report;
          do {
          report = importConversation({
            conversation: { ...conversation, branch: undefined },
            repoId: id,
            directory: join(directory, "queue"),
            store, maxBatches:1, maxRecords:50,
          });
          await new Promise<void>(resolve=>setImmediate(resolve));
          } while(report.remainingBytes && !report.incomplete);
          if (report.incomplete || report.remainingBytes) incompleteSources++;
          let before: number | undefined;
          const ordered: { id: string; text: string }[] = [];
          do {
            const page = store.search({
              repoId: id,
              featureId: report.featureId,
              before,
              limit: 20,
            });
            for (const event of page.matches)
              ordered.push({
                id: event.eventId,
                text: store.evidence(id, event.eventId)!.content,
              });
            before = page.nextCursor ?? undefined;
            await new Promise<void>(resolve=>setImmediate(resolve));
          } while (before);
          let role = "assistant";
          ordered.reverse().forEach((event, index) => {
            if (event.text.startsWith("user: ")) role = "user";
            else if (
              event.text.startsWith("assistant: ") ||
              event.text.startsWith("model: ")
            )
              role = "assistant";
            events.push({ ...event, sequence: index + 1, role });
          });
        } finally {
          store.close();
        }
        const metadata=describeConversation(conversation);
        for (let offset = 0; offset < events.length; offset += 40) {
          const chunk = events.slice(offset, offset + 40),
            batchId = offset+40 >= events.length ? digest([key, id, chunk, conversation.title, metadata.summary, metadata.titleSource,metadata.modified]) : digest([key,id,chunk]);
          const payload = {
            projectId: String(binding.project),
            batchId,
            conversations: [
              {
                id,
                origin: agent,
                sessionId: cloudSession,
                title: conversation.title,
                provenance: {
                  installationId,
                  sourceId: metadata.sourceId,
                  summary: metadata.summary,
                  titleSource: metadata.titleSource,
                  modified: metadata.modified,
                  ...(conversation.branch
                    ? { branch: conversation.branch }
                    : {}),
                },
                events: chunk,
              },
            ],
          };
          db.prepare(
            "INSERT OR IGNORE INTO uploads(id,binding,payload) VALUES(?,?,?)",
          ).run(batchId, key, JSON.stringify(payload));
        }
        if (events.length) syncedConversations.push({id, eventCount: events.length});
        else emptySources++;
        imported++;
      } catch (error) {
        importErrors++;
        db.prepare("INSERT OR REPLACE INTO sync_errors VALUES(?,?,?)").run(
          key,
          String(error),
          new Date().toISOString(),
        );
      }
    }

    // Each persisted batch is replayed exactly after network failures or restart.
    for (const row of db
      .prepare(
        "SELECT id,payload FROM uploads WHERE binding=? AND delivered=0 ORDER BY rowid",
      )
      .all(key)) {
      const current = credentials(home);
      if (
        !current ||
        current.account.id !== device.account.id ||
        current.device.id !== device.device.id ||
        current.origin !== device.origin
      )
        break;
      if (
        !db
          .prepare(
            "SELECT 1 FROM bindings WHERE key=? AND enabled=1 AND project=? AND roots=?",
          )
          .get(key, binding.project, binding.roots)
      )
        break;
      await api(current, "/api/private/sync", JSON.parse(String(row.payload)));
      db.prepare("UPDATE uploads SET delivered=1 WHERE id=?").run(row.id);
      delivered++;
    }
    const pending = Number(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM uploads WHERE binding=? AND delivered=0",
        )
        .get(key)!.count,
    );
    if (incompleteSources || emptySources) {
      db.prepare("INSERT OR REPLACE INTO sync_errors VALUES(?,?,?)")
        .run(key, "History import pending: " + incompleteSources + " incomplete and " + emptySources + " empty sources", new Date().toISOString());
    }
    if (!importErrors && !incompleteSources && !emptySources && pending === 0 && syncedConversations.length > 0) {
      // A background upload cannot clear a failed cloud readback; only explicit verification can.
      db.prepare("DELETE FROM sync_errors WHERE binding=? AND message NOT LIKE 'Cloud history %'").run(key);
      db.prepare("INSERT OR REPLACE INTO settings VALUES(?,?)").run(
        "lastSync:" + key,
        new Date().toISOString(),
      );
    }
    const verificationPending = db.prepare("SELECT 1 FROM sync_errors WHERE binding=? AND message LIKE 'Cloud history %'").get(key);
    await api(
      device,
      `/api/private/projects/${encodeURIComponent(String(binding.project))}/status`,
      {
        status:
          importErrors || pending || verificationPending
            ? "offline"
            : incompleteSources || emptySources ? "waiting" : syncedConversations.length
              ? "up_to_date"
              : "waiting",
        pendingCount: Number(
          db
            .prepare(
              "SELECT COUNT(*) AS count FROM uploads WHERE binding=? AND delivered=0",
            )
            .get(key)!.count,
        ),
      },
    ).catch(() => {});
    return {
      discovered: conversations.length,
      incompleteSources,
      emptySources,
      syncedConversations,
      imported,
      delivered,
      importErrors,
      pending: Number(
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM uploads WHERE binding=? AND delivered=0",
          )
          .get(key)!.count,
      ),
    };
  } catch (error) {
    db.prepare("INSERT OR REPLACE INTO sync_errors VALUES(?,?,?)").run(
      key,
      String(error),
      new Date().toISOString(),
    );
    const binding = db
      .prepare("SELECT project FROM bindings WHERE key=?")
      .get(key);
    if (binding)
      await api(
        device,
        `/api/private/projects/${encodeURIComponent(String(binding.project))}/status`,
        {
          status:
            error instanceof CloudError && [401, 403].includes(error.status)
              ? "reconnect"
              : "offline",
          pendingCount: Number(
            db
              .prepare(
                "SELECT COUNT(*) AS count FROM uploads WHERE binding=? AND delivered=0",
              )
              .get(key)!.count,
          ),
        },
      ).catch(() => {});
    throw new SyncFailure(error, {imported, delivered, importErrors, incompleteSources, emptySources, discovered});
  } finally {
    db.close();
  }
}
export function startAutosync(
  home: string,
  env: NodeJS.ProcessEnv,
  workspace: string,
) {
  const run = () => {
    void syncWorkspace(home, env, workspace).catch(() => {});
  };
  run();
  const timer = setInterval(run, 30_000);
  timer.unref();
  return () => clearInterval(timer);
}
