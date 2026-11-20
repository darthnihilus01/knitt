import { z } from "zod";
import { hash, json as response, type CloudAccount, type CloudEnvironment } from "./identity.ts";

export const revocationNotice = "Revoking access stops future retrieval through Knitt. Content already loaded may remain in the recipient’s chat or local storage.";

const field = (max: number) => z.string().min(1).max(max).refine(value => value.trim().length > 0, "Empty field");
const title = field(160);
const key = field(128);
const createContext = z.strictObject({ title, sourceVersionId: key.optional(), creationKey: key.optional() });
const metadata = z.strictObject({
  agent: field(100),
  repository: field(512).optional(),
  branch: field(255).optional(),
  commit: field(100).optional(),
  conversationId: field(255).optional(),
});
const publication = z.strictObject({
  publicationKey: key, checkpoint: field(64_000), source: metadata,
  excerpts: z.array(z.strictObject({ text: field(16_000) })).max(80),
  originalWork: z.literal(true).optional(),
});
const missing = () => response({ error: "Not found" }, 404);
const conflict = (error: string) => response({ error }, 409);

async function input<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const limit = 240_000;
  const reader = request.body?.getReader();
  if (!reader || Number(request.headers.get("content-length")) > limit) throw new RangeError("Invalid body size");
  const chunks: Uint8Array[] = [];
  let count = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      count += value.byteLength;
      if (count > limit) {
        await reader.cancel();
        throw new RangeError("Body too large");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(count);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return schema.parse(JSON.parse(new TextDecoder().decode(bytes)));
}
async function fingerprint(value: unknown) {
  return hash(JSON.stringify(value));
}

const visibleVersion = `(c.owner_id = ? OR EXISTS (
  SELECT 1 FROM invitations g JOIN versions start ON start.id=g.start_version_id
  WHERE g.context_id=c.id AND g.status='accepted' AND g.recipient_id=? AND start.number<=v.number
))`;
const visibleContext = `(c.owner_id=? OR EXISTS (
  SELECT 1 FROM invitations g WHERE g.context_id=c.id AND g.status='accepted' AND g.recipient_id=?
))`;
const contextFields = `c.id,c.title,c.source_version_id AS sourceVersionId,a.username AS ownerUsername,
  (SELECT json_extract(source,'$.agent') FROM versions WHERE context_id=c.id ORDER BY number DESC LIMIT 1) AS sourceAgent,
  (c.owner_id=?) AS owned,(SELECT id FROM versions WHERE context_id=c.id ORDER BY number DESC LIMIT 1) AS latestVersionId,
  (SELECT MAX(number) FROM versions WHERE context_id=c.id) AS latestVersionNumber`;
const contextTables = "contexts c JOIN accounts a ON a.id=c.owner_id";
type ContextRow = { id: string; title: string; owned: number; sourceVersionId: string | null };
const formatContext = (row: ContextRow) => ({ ...row, owned: Boolean(row.owned) });

const versionFields = `v.id,v.context_id AS contextId,v.number,v.created_at AS createdAt,
  c.title,c.source_version_id AS sourceVersionId,v.checkpoint,v.source,v.excerpts`;
type VersionRow = { id: string; source: string; excerpts: string };
const formatVersion = (row: VersionRow) => ({ ...row, source: JSON.parse(row.source), excerpts: JSON.parse(row.excerpts) });
const versionsFrom = "versions v JOIN contexts c ON c.id=v.context_id";
const invitationFields = `i.id,c.id AS contextId,c.title,v.id AS startVersionId,v.number AS startVersionNumber,
  owner.username AS senderUsername,coalesce(rec.username,i.invited_email) AS recipient,i.status,i.grant_id AS grantId`;
const invitationTables = `invitations i JOIN contexts c ON c.id=i.context_id JOIN accounts owner ON owner.id=c.owner_id
  JOIN versions v ON v.id=i.start_version_id LEFT JOIN accounts rec ON rec.id=i.recipient_id`;
const addressedTo = `(i.recipient_id=? OR (i.recipient_id IS NULL AND i.status='pending' AND EXISTS (
  SELECT 1 FROM account_verified_emails me WHERE me.account_id=? AND me.email=i.invited_email COLLATE NOCASE
  AND NOT EXISTS (SELECT 1 FROM account_verified_emails other WHERE other.account_id<>me.account_id
    AND other.email=i.invited_email COLLATE NOCASE)
)))`;

export async function handleSharing(request: Request, env: CloudEnvironment, account: CloudAccount): Promise<Response|null> {
  const url = new URL(request.url);
  const [api, resource, id, action, extra] = url.pathname.slice(1).split("/");
  if (api !== "api" || extra !== undefined) return null;
  const { method } = request;
  const { DB: db } = env;
  const user = account.id;
  const statement = (sql: string, ...values: (string|number|null)[]) => db.prepare(sql).bind(...values);
  const getContext = async (id: string) => {
    const row = await statement(`SELECT ${contextFields} FROM ${contextTables} WHERE c.id=? AND ${visibleContext}`,
      user,id,user,user).first<ContextRow>();
    return row && formatContext(row);
  };
  const getVersion = async (id: string) => {
    const row = await statement(`SELECT ${versionFields} FROM ${versionsFrom} WHERE v.id=? AND ${visibleVersion}`,
      id,user,user).first<VersionRow>();
    return row && formatVersion(row);
  };
  try {
    if (resource === "contexts" && !id && method === "GET") {
      const { results } = await statement(`SELECT ${contextFields} FROM ${contextTables} WHERE ${visibleContext}
        ORDER BY c.created_at DESC,c.id`, user,user,user).all<ContextRow>();
      return response({ contexts: results.map(formatContext) });
    }
    if (resource === "contexts" && !id && method === "POST") {
      const body = await input(request, createContext);
      const hash = await fingerprint([body.title,body.sourceVersionId ?? null]);
      const sourceId = body.sourceVersionId ?? null;
      const row = await statement(`INSERT INTO contexts(id,owner_id,title,source_version_id,creation_key,creation_hash)
        SELECT ?,?,?,?,?,? WHERE ? IS NULL OR EXISTS (SELECT 1 FROM ${versionsFrom} WHERE v.id=? AND ${visibleVersion})
        ON CONFLICT(owner_id,creation_key) DO UPDATE SET creation_key=excluded.creation_key
        WHERE contexts.creation_hash=excluded.creation_hash RETURNING id`,
        crypto.randomUUID(),user,body.title,sourceId,body.creationKey ?? null,hash,sourceId,sourceId,user,user).first<{id:string}>();
      if (!row) {
        if (body.creationKey) {
          const existing = await statement("SELECT id,creation_hash FROM contexts WHERE owner_id=? AND creation_key=?",user,body.creationKey)
            .first<{id:string;creation_hash:string}>();
          if (existing && existing.creation_hash === hash) return response({ context: await getContext(existing.id) });
          if (existing) return conflict("Creation key already used for a different context");
        }
        return missing();
      }
      return response({ context: await getContext(row.id) }, 201);
    }
    if (resource === "contexts" && id && !action) {
      if (method === "GET") {
        const context = await getContext(id);
        return context ? response({ context }) : missing();
      }
      if (method === "PATCH") {
        const body = await input(request, z.strictObject({ title }));
        const updated = await statement("UPDATE contexts SET title=? WHERE id=? AND owner_id=? RETURNING id",body.title,id,user).first();
        return updated ? response({ context: await getContext(id) }) : missing();
      }
      if (method === "DELETE") {
        const row = await statement("DELETE FROM contexts WHERE id=? AND owner_id=? RETURNING id",id,user).first();
        return row ? response({ deleted: true }) : missing();
      }
    }
    if (resource === "contexts" && id && action === "versions") {
      if (method === "GET") {
        if (!await getContext(id)) return missing();
        const { results } = await statement(`SELECT v.id,v.number,v.created_at AS createdAt FROM ${versionsFrom}
          WHERE c.id=? AND ${visibleVersion} ORDER BY v.number DESC`,id,user,user).all();
        return response({ versions: results });
      }
      if (method === "POST") {
        const body = await input(request, publication);
        const context = await getContext(id);
        if (!context?.owned) return missing();
        if (context.sourceVersionId && !body.originalWork) return response({ error: "Confirm the continuation contains only original work" },400);
        const hash = await fingerprint([body.checkpoint,body.source,body.excerpts]);
        const excerpts = JSON.stringify(body.excerpts.map(entry => ({ id: crypto.randomUUID(), text: entry.text })));
        // Test every original excerpt against each reviewed field separately so no delimiter can change the match.
        const row = await statement(`INSERT INTO versions(id,context_id,number,publication_key,payload_hash,checkpoint,source,excerpts)
          SELECT ?,c.id,(SELECT coalesce(MAX(number),0)+1 FROM versions WHERE context_id=c.id),?,?,?,?,?
          FROM contexts c WHERE c.id=? AND c.owner_id=? AND NOT EXISTS (
            SELECT 1 FROM evidence e WHERE e.version_id=c.source_version_id AND (
              instr(?,e.text)>0 OR EXISTS(SELECT 1 FROM json_each(?) j WHERE instr(json_extract(j.value,'$.text'),e.text)>0)
            )
          ) ON CONFLICT(context_id,publication_key) DO UPDATE SET publication_key=excluded.publication_key
          WHERE versions.payload_hash=excluded.payload_hash RETURNING id`,
          crypto.randomUUID(),body.publicationKey,hash,body.checkpoint,JSON.stringify(body.source),excerpts,id,user,body.checkpoint,excerpts)
          .first<{id:string}>();
        if (!row) return conflict("Publication conflicts with a previous submission or includes inherited evidence");
        return response({ version: await getVersion(row.id) },201);
      }
    }
    if (resource === "versions" && id && !action && method === "GET") {
      const version = await getVersion(id);
      return version ? response({ version }) : missing();
    }
    if (resource === "evidence" && id && !action && method === "GET") {
      const pin = url.searchParams.get("versionId");
      const evidence = await statement(`SELECT e.id,e.text,e.version_id AS versionId FROM evidence e
        JOIN versions v ON v.id=e.version_id JOIN contexts c ON c.id=v.context_id
        WHERE e.id=? AND (? IS NULL OR v.id=?) AND ${visibleVersion}`,id,pin,pin,user,user).first();
      return evidence ? response({ evidence }) : missing();
    }
    if (resource === "search" && !id && method === "GET") {
      const q = url.searchParams.get("q")?.trim();
      if (!q || q.length>512) return response({error:"Enter a search query of 1 to 512 characters"},400);
      const pin = url.searchParams.get("versionId");
      const { results } = await statement(`SELECT c.id AS contextId,c.title,v.id AS versionId,v.number,v.checkpoint
        FROM ${versionsFrom} WHERE ${visibleVersion} AND (? IS NULL OR v.id=?) AND (
        instr(lower(v.checkpoint),lower(?))>0 OR instr(lower(c.title),lower(?))>0 OR EXISTS (
          SELECT 1 FROM evidence e WHERE e.version_id=v.id AND instr(lower(e.text),lower(?))>0
        )) ORDER BY v.created_at DESC,v.id LIMIT 50`,user,user,pin,pin,q,q,q).all();
      return response({ results });
    }

    if (resource === "contexts" && id && action === "invitations" && method === "POST") {
      const body = await input(request,z.strictObject({ recipient: field(254), startVersionId: key }));
      const target = body.recipient.trim().replace(/^@/, "").toLowerCase();
      const byEmail = target.includes("@");
      if (byEmail && !z.email().safeParse(target).success) return response({error:"Invalid invitation email"},400);
      // Only the owner may resolve a recipient while creating an invitation on this context.
      const owned = await statement("SELECT 1 FROM contexts WHERE id=? AND owner_id=?",id,user).first();
      if (!owned) return missing();
      const candidates = (await statement(byEmail
        ? "SELECT account_id AS id FROM account_verified_emails WHERE email=? COLLATE NOCASE LIMIT 2"
        : "SELECT id,username FROM accounts WHERE username=? COLLATE NOCASE",target).all<{id:string;username:string}>()).results;
      if (byEmail && candidates.length>1) return conflict("This email belongs to multiple accounts. Invite their username.");
      if (!byEmail && !candidates.length) return missing();
      if (candidates[0]?.id===user || (byEmail && account.email.toLowerCase()===target)) return response({error:"Choose another recipient"},400);
      const targetId = candidates[0]?.id ?? null;
      const created = await statement(`INSERT INTO invitations(id,context_id,start_version_id,recipient_id,invited_email)
        SELECT ?,c.id,v.id,?,? FROM ${versionsFrom} WHERE c.id=? AND c.owner_id=? AND v.id=?
        AND NOT EXISTS (SELECT 1 FROM invitations i WHERE i.context_id=c.id AND i.status IN ('pending','accepted')
          AND (i.recipient_id=? OR i.invited_email=? COLLATE NOCASE OR i.invited_email IN
            (SELECT email FROM account_verified_emails WHERE account_id=?)))
        ON CONFLICT DO NOTHING RETURNING id`,crypto.randomUUID(),byEmail?null:targetId,byEmail?target:null,
        id,user,body.startVersionId,targetId,byEmail?target:null,targetId).first<{id:string}>();
      if (!created) return conflict("Choose a published version and a recipient without an open invitation");
      const invitation = await statement(`SELECT ${invitationFields} FROM ${invitationTables} WHERE i.id=? AND c.owner_id=?`,
        created.id,user).first();
      return response({ invitation, notice: revocationNotice },201);
    }
    if ((resource === "inbox" || resource === "invitations") && !id && method === "GET") {
      const incoming = resource === "inbox";
      const { results } = await statement(`SELECT ${invitationFields} FROM ${invitationTables}
        WHERE ${incoming ? addressedTo + " AND i.status IN ('pending','accepted')" : "c.owner_id=?"} ORDER BY i.created_at DESC,i.id`,
        ...(incoming ? [user,user] : [user])).all();
      return response({ invitations: results, notice: revocationNotice });
    }
    if (resource === "invitations" && id && action && method === "POST") {
      const eligible = `EXISTS(SELECT 1 FROM invitations i WHERE i.id=invitations.id AND ${addressedTo})`;
      if (action === "accept") {
        const accepted = await statement(`UPDATE invitations SET status='accepted',recipient_id=?,grant_id=coalesce(grant_id,?)
          WHERE id=? AND status IN ('pending','accepted') AND ${eligible}
          AND NOT EXISTS (SELECT 1 FROM invitations other WHERE other.context_id=invitations.context_id
            AND other.recipient_id=? AND other.status='accepted' AND other.id<>invitations.id)
          RETURNING id,status,grant_id AS grantId`,user,crypto.randomUUID(),id,user,user,user).first();
        return accepted ? response({ invitation: accepted, notice: revocationNotice }) : missing();
      }
      const transitions: Record<string,[string,string,boolean]> = {
        decline: ["pending","declined",false], leave: ["accepted","left",false],
        withdraw: ["pending","withdrawn",true], revoke: ["accepted","revoked",true],
      };
      if (!Object.hasOwn(transitions,action)) return null;
      const [before,after,owner] = transitions[action];
      const actor = owner ? "EXISTS(SELECT 1 FROM contexts c WHERE c.id=invitations.context_id AND c.owner_id=?)" : eligible;
      const changed = await statement(`UPDATE invitations SET status=? WHERE id=? AND status=? AND ${actor}
        RETURNING id,status,grant_id AS grantId`,after,id,before,...(owner?[user]:[user,user])).first();
      return changed ? response({ invitation: changed, notice: revocationNotice }) : missing();
    }
    if (resource === "contacts") {
      const fields = `p.id,other.username,p.status,CASE WHEN p.sender_id=? THEN 'outgoing' ELSE 'incoming' END AS direction`;
      const tables = `contacts p JOIN accounts other ON other.id=CASE WHEN p.sender_id=? THEN p.recipient_id ELSE p.sender_id END`;
      if (!id && method === "GET") {
        const { results } = await statement(`SELECT ${fields} FROM ${tables} WHERE (p.sender_id=? OR p.recipient_id=?)
          AND p.status IN ('pending','accepted') ORDER BY other.username`,user,user,user,user).all();
        return response({ contacts: results });
      }
      if (!id && method === "POST") {
        const body = await input(request,z.strictObject({ username: field(64) }));
        const target = body.username.trim().replace(/^@/,"");
        const row = await statement(`INSERT INTO contacts(id,sender_id,recipient_id) SELECT ?,?,id
          FROM accounts WHERE username=? COLLATE NOCASE AND id<>? ON CONFLICT DO NOTHING RETURNING id`,
          crypto.randomUUID(),user,target,user).first<{id:string}>();
        if (!row) return conflict("Contact unavailable or request already exists");
        const contact = await statement(`SELECT ${fields} FROM ${tables} WHERE p.id=?`,user,user,row.id).first();
        return response({ contact },201);
      }
      if (id && action && method === "POST") {
        const transitions: Record<string,[string,string,string]> = {
          accept:["pending","accepted","recipient_id=?"],decline:["pending","declined","recipient_id=?"],
          withdraw:["pending","withdrawn","sender_id=?"],remove:["accepted","removed","? IN (sender_id,recipient_id)"],
        };
        if (!Object.hasOwn(transitions,action)) return null;
        const [before,after,actor] = transitions[action];
        const contact = await statement(`UPDATE contacts SET status=? WHERE id=? AND status=? AND ${actor}
          RETURNING id,status`,after,id,before,user).first();
        return contact ? response({ contact }) : missing();
      }
    }
    return null;
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof RangeError)
      return response({ error: "Invalid sharing request" },400);
    throw error;
  }
}

