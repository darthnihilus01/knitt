import { z } from "zod";
import {
  hash,
  HttpError,
  json,
  method,
  type Auth,
  type CloudEnvironment,
} from "./identity.ts";
const text = (max: number) => z.string().min(1).max(max);
const identifier = text(256);
const eventSchema = z.strictObject({
  id: identifier,
  sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  role: text(64),
  text: text(64_000),
  timestamp: text(100).optional(),
});
const batchSchema = z.strictObject({
  projectId: z.uuid(),
  batchId: identifier,
  conversations: z
    .array(
      z.strictObject({
        id: identifier,
        origin: text(100),
        sessionId: identifier,
        title: text(512),
        provenance: z.record(text(64), z.string().max(1024)),
        events: z.array(eventSchema).max(200),
      }),
    )
    .min(1)
    .max(64),
});
async function body<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new HttpError(415, "Send application/json");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Expected body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2_000_000) {
        await reader.cancel();
        throw new HttpError(413, "Batch too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  try {
    return schema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    throw new HttpError(400, "Invalid private sync input");
  }
}
const conversationFields = `c.id,c.project_id AS projectId,(SELECT p.title FROM private_projects p WHERE p.id=c.project_id AND p.account_id=c.account_id) AS projectTitle,c.origin,c.session_id AS sessionId,c.title,c.provenance,c.created_at AS createdAt,c.updated_at AS updatedAt,
 (SELECT count(*) FROM private_events e WHERE e.account_id=c.account_id AND e.conversation_id=c.id) AS eventCount,
 (SELECT coalesce(max(ingest_id),0) FROM private_events e WHERE e.account_id=c.account_id AND e.conversation_id=c.id) AS cutoff`;
type Conversation = { id: string; provenance: string; cutoff: number; updatedAt?:string };
const formatConversation = (c: Conversation) => {
  const provenance=JSON.parse(c.provenance);
  return {...c,provenance,sourceId:provenance.sourceId??c.id,modified:provenance.modified??c.updatedAt,summary:provenance.summary??'',titleSource:provenance.titleSource??'fallback',availability:'available'};
};
const eventFields = "id,sequence,role,text,timestamp,ingest_id AS ingestId";
function integer(
  value: string | null,
  fallback: number,
  max = Number.MAX_SAFE_INTEGER,
) {
  if (value === null) return fallback;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0 || n > max)
    throw new HttpError(400, "Invalid pagination");
  return n;
}
export async function handlePrivateSync(
  request: Request,
  env: CloudEnvironment,
  auth: Auth,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/private/")) return null;
  const path = url.pathname.slice("/api/private/".length),
    db = env.DB,
    account = auth.account.id;
  const ownProject = async (id: string) => {
    const row = await db
      .prepare(
        "SELECT id,title,created_at AS createdAt FROM private_projects WHERE id=? AND account_id=?",
      )
      .bind(id, account)
      .first();
    if (!row) throw new HttpError(404, "Not found");
    return row;
  };
  if (path === "projects") {
    if (request.method === "POST") {
      const input = await body(
        request,
        z.strictObject({ id: z.uuid().optional(), title: text(160) }),
      );
      const id = input.id ?? crypto.randomUUID();
      await db
        .prepare(
          "INSERT INTO private_projects(id,account_id,title) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING",
        )
        .bind(id, account, input.title)
        .run();
      return json({ project: await ownProject(id) }, 201);
    }
    method(request, "GET");
    const projects = await db
      .prepare(
        "SELECT id,title,created_at AS createdAt FROM private_projects WHERE account_id=? ORDER BY created_at,id",
      )
      .bind(account)
      .all<{ id: string }>();
    const result = [];
    for (const p of projects.results) {
      const installations = (
        await db
          .prepare(
            `SELECT d.id AS deviceId,d.name,s.status,s.last_sync_at AS lastSyncAt,s.runtime_status AS runtimeStatus,s.pending_count AS pendingCount,s.last_seen_at AS lastSeenAt FROM private_project_devices s JOIN devices d ON d.id=s.device_id WHERE s.project_id=? AND d.account_id=? ORDER BY d.created_at`,
          )
          .bind(p.id, account)
          .all<{
            deviceId: string;
            status: string;
            lastSyncAt: string | null;
            runtimeStatus: string | null;
            pendingCount: number;
            lastSeenAt: string | null;
          }>()
      ).results;
      const current = installations.find((i) => i.deviceId === auth.deviceId);
      result.push({
        ...p,
        installations,
        status:
          current?.status ??
          (installations.some((i) => i.status === "active")
            ? "active"
            : installations.some((i) => i.status === "paused")
              ? "paused"
              : installations.length
                ? "disconnected"
                : "unconfigured"),
        lastSyncAt:
          current?.lastSyncAt ??
          installations
            .map((i) => i.lastSyncAt)
            .filter((value): value is string => Boolean(value))
            .sort()
            .at(-1) ??
          null,
      });
    }
    return json({ projects: result });
  }
  const statusRoute = /^projects\/([^/]+)\/status$/.exec(path);
  if (statusRoute) {
    method(request, "POST");
    if (!auth.deviceId) throw new HttpError(403, "Device required");
    await ownProject(statusRoute[1]);
    const input = await body(
      request,
      z.strictObject({
        status: z.enum([
          "syncing",
          "up_to_date",
          "offline",
          "reconnect",
          "waiting",
        ]),
        pendingCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      }),
    );
    if (input.status === "up_to_date" && input.pendingCount !== 0)
      throw new HttpError(400, "Pending work remains");
    const row = await db
      .prepare(
        `UPDATE private_project_devices SET runtime_status=?,pending_count=?,last_seen_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE project_id=? AND device_id=? AND (status='active' OR ?<>'up_to_date')
      AND (?<>'up_to_date' OR last_sync_at IS NOT NULL)
      AND EXISTS(SELECT 1 FROM devices d WHERE d.id=? AND d.account_id=? AND d.expires_at>?)
      RETURNING runtime_status AS runtimeStatus,pending_count AS pendingCount,last_seen_at AS lastSeenAt`,
      )
      .bind(
        input.status,
        input.pendingCount,
        statusRoute[1],
        auth.deviceId,
        input.status,
        input.status,
        auth.deviceId,
        account,
        Date.now(),
      )
      .first();
    if (!row)
      throw new HttpError(409, "Local consent and completed sync required");
    return json(row);
  }
  const control = /^projects\/([^/]+)\/(consent|control)$/.exec(path);
  if (control) {
    method(request, "POST");
    const [, projectId, action] = control;
    await ownProject(projectId);
    if (action === "consent") {
      if (!auth.deviceId)
        throw new HttpError(403, "Local device consent required");
      const input = await body(
        request,
        z.strictObject({ enabled: z.boolean() }),
      );
      await db
        .prepare(
          `INSERT INTO private_project_devices(project_id,device_id,status) SELECT ?,id,? FROM devices WHERE id=? AND account_id=? AND expires_at>? ON CONFLICT(project_id,device_id) DO UPDATE SET status=excluded.status`,
        )
        .bind(
          projectId,
          input.enabled ? "active" : "disconnected",
          auth.deviceId,
          account,
          Date.now(),
        )
        .run();
      return json({ status: input.enabled ? "active" : "disconnected" });
    }
    const input = await body(
      request,
      z.strictObject({
        action: z.enum(["pause", "resume", "disconnect"]),
        deviceId: identifier.optional(),
      }),
    );
    const deviceId = input.deviceId ?? auth.deviceId;
    if (!deviceId) throw new HttpError(400, "Select an installation");
    const state =
      input.action === "pause"
        ? "paused"
        : input.action === "resume"
          ? "active"
          : "disconnected";
    const updated = await db
      .prepare(
        `UPDATE private_project_devices SET status=? WHERE project_id=? AND device_id=? AND EXISTS(SELECT 1 FROM devices WHERE id=? AND account_id=?) AND (?<>'active' OR status IN ('paused','active')) RETURNING status`,
      )
      .bind(state, projectId, deviceId, deviceId, account, state)
      .first();
    if (!updated) throw new HttpError(409, "Local device consent required");
    return json(updated);
  }
  if (path === "sync") {
    method(request, "POST");
    if (!auth.deviceId) throw new HttpError(403, "Device required");
    const input = await body(request, batchSchema);
    await ownProject(input.projectId);
    // Reject ambiguous duplicates before the one-statement atomic materialization.
    const seen = new Set<string>();
    for (const c of input.conversations) {
      if (seen.has(c.id)) throw new HttpError(400, "Duplicate conversation");
      seen.add(c.id);
      const ids = new Set<string>(),
        seq = new Set<number>();
      for (const e of c.events) {
        if (ids.has(e.id) || seq.has(e.sequence))
          throw new HttpError(400, "Duplicate event");
        ids.add(e.id);
        seq.add(e.sequence);
      }
    }
    const payload = JSON.stringify(input),
      digest = await hash(payload);
    const active = async () =>
      db
        .prepare(
          `SELECT s.status FROM private_project_devices s JOIN devices d ON d.id=s.device_id WHERE s.project_id=? AND s.device_id=? AND s.status='active' AND d.account_id=? AND d.expires_at>?`,
        )
        .bind(input.projectId, auth.deviceId!, account, Date.now())
        .first();
    if (!(await active()))
      throw new HttpError(403, "Private sync consent unavailable");
    try {
      await db
        .prepare(
          `INSERT INTO private_batches(account_id,project_id,device_id,id,payload_hash,payload) VALUES(?,?,?,?,?,?) ON CONFLICT(account_id,device_id,id) DO NOTHING`,
        )
        .bind(
          account,
          input.projectId,
          auth.deviceId,
          input.batchId,
          digest,
          payload,
        )
        .run();
    } catch (error) {
      if (!(await active()))
        throw new HttpError(403, "Private sync consent unavailable");
      if (
        error instanceof Error &&
        /private (conversation|event) identity conflict|UNIQUE constraint failed: private_/.test(
          error.message,
        )
      ) {
        throw new HttpError(409, "Private history identity conflict");
      }
      throw error;
    }
    const row = await db
      .prepare(
        "SELECT payload_hash AS digest,created_at AS lastSyncAt FROM private_batches WHERE account_id=? AND device_id=? AND id=?",
      )
      .bind(account, auth.deviceId, input.batchId)
      .first<{ digest: string; lastSyncAt: string }>();
    if (!row || row.digest !== digest)
      throw new HttpError(409, "Batch ID already used");
    return json({
      batchId: input.batchId,
      accepted: true,
      lastSyncAt: row.lastSyncAt,
    });
  }
  if (path === "conversations") {
    method(request, "GET");
    const projectId = url.searchParams.get("projectId");
    if (projectId) await ownProject(projectId);
    const cursor = url.searchParams.get("cursor") ?? "";
    if (cursor.length > 256) throw new HttpError(400, "Invalid cursor");
    const rows = await db
      .prepare(
        `SELECT ${conversationFields} FROM private_conversations c WHERE c.account_id=? ${projectId ? "AND c.project_id=?" : ""} AND c.id>? ORDER BY c.id LIMIT 201`,
      )
      .bind(account, ...(projectId ? [projectId] : []), cursor)
      .all<Conversation>();
    const page = rows.results.slice(0, 200);
    return json({
      conversations: page.map(formatConversation),
      nextCursor: rows.results.length > 200 ? page.at(-1)!.id : null,
    });
  }
  const retrieval = /^conversations\/([^/]+)\/(context|search|evidence)$/.exec(
    path,
  );
  if (retrieval) {
    method(request, "GET");
    const id = decodeURIComponent(retrieval[1]);
    const conversation = await db
      .prepare(
        `SELECT ${conversationFields} FROM private_conversations c WHERE c.account_id=? AND c.id=?`,
      )
      .bind(account, id)
      .first<Conversation>();
    if (!conversation) throw new HttpError(404, "Not found");
    const cutoff = Math.min(
        integer(url.searchParams.get("cutoff"), conversation.cutoff),
        conversation.cutoff,
      ),
      limit = integer(url.searchParams.get("limit"), 30, 100);
    if (retrieval[2] === "evidence") {
      const evidence = await db
        .prepare(
          `SELECT ${eventFields} FROM private_events WHERE account_id=? AND conversation_id=? AND id=? AND ingest_id<=?`,
        )
        .bind(account, id, url.searchParams.get("eventId"), cutoff)
        .first();
      if (!evidence) throw new HttpError(404, "Not found");
      return json({ evidence, cutoff });
    }
    if (retrieval[2] === "search") {
      const q = url.searchParams.get("q") ?? "";
      if (!q.trim() || q.length > 512)
        throw new HttpError(400, "Enter a search query");
      const results = await db
        .prepare(
          `SELECT id,sequence,role,substr(text,1,2000) AS text,timestamp,ingest_id AS ingestId FROM private_events WHERE account_id=? AND conversation_id=? AND ingest_id<=? AND instr(lower(text),lower(?))>0 ORDER BY sequence LIMIT ?`,
        )
        .bind(account, id, cutoff, q, limit)
        .all();
      return json({ results: results.results, cutoff });
    }
    const before = integer(
      url.searchParams.get("before"),
      Number.MAX_SAFE_INTEGER,
    );
    const rows = await db
      .prepare(
        `SELECT ${eventFields} FROM private_events WHERE account_id=? AND conversation_id=? AND ingest_id<=? AND sequence<? ORDER BY sequence DESC LIMIT ?`,
      )
      .bind(account, id, cutoff, before, limit + 1)
      .all<{ id: string; sequence: number; text: string }>();
    const selected = [];
    let size = 0;
    for (const event of rows.results.slice(0, limit)) {
      if (size + event.text.length > 100_000 && selected.length) break;
      selected.push(event);
      size += event.text.length;
    }
    const nextBefore =
      rows.results.length > selected.length && selected.length
        ? selected[selected.length - 1].sequence
        : null;
    return json({
      conversation: formatConversation(conversation),
      events: selected.reverse(),
      cutoff,
      nextBefore,
    });
  }
  return json({ error: "Not found" }, 404);
}
