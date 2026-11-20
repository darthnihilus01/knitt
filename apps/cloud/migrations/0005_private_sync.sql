-- Private history is account owned; no invitation or sharing table references it.
CREATE TABLE private_projects (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 title TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(account_id,id)
);
CREATE TABLE private_project_devices (
 project_id TEXT NOT NULL REFERENCES private_projects(id) ON DELETE CASCADE,
 device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
 status TEXT NOT NULL CHECK(status IN ('active','paused','disconnected')),
 last_sync_at TEXT, runtime_status TEXT CHECK(runtime_status IN ('syncing','up_to_date','offline','reconnect','waiting')),
 pending_count INTEGER NOT NULL DEFAULT 0 CHECK(pending_count>=0), last_seen_at TEXT, PRIMARY KEY(project_id,device_id)
);
CREATE TABLE private_conversations (
 account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, id TEXT NOT NULL,
 project_id TEXT NOT NULL REFERENCES private_projects(id) ON DELETE CASCADE,
 origin TEXT NOT NULL, session_id TEXT NOT NULL, title TEXT NOT NULL, provenance TEXT NOT NULL CHECK(json_valid(provenance)),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(account_id,id), UNIQUE(account_id,project_id,origin,session_id)
);
CREATE TABLE private_events (
 ingest_id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
 id TEXT NOT NULL, sequence INTEGER NOT NULL CHECK(sequence>=0), role TEXT NOT NULL, text TEXT NOT NULL, timestamp TEXT,
 FOREIGN KEY(account_id,conversation_id) REFERENCES private_conversations(account_id,id) ON DELETE CASCADE,
 UNIQUE(account_id,conversation_id,id), UNIQUE(account_id,conversation_id,sequence)
);
CREATE TABLE private_batches (
 account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, project_id TEXT NOT NULL,
 device_id TEXT NOT NULL, id TEXT NOT NULL, payload_hash TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(account_id,device_id,id)
);
CREATE TRIGGER private_batch_guard BEFORE INSERT ON private_batches BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM private_project_devices s JOIN devices d ON d.id=s.device_id
 JOIN private_projects p ON p.id=s.project_id WHERE p.account_id=NEW.account_id AND p.id=NEW.project_id
 AND s.device_id=NEW.device_id AND d.account_id=NEW.account_id AND d.expires_at>(julianday('now')-2440587.5)*86400000 AND s.status='active')
 THEN RAISE(ABORT,'private sync consent unavailable') END;
END;
CREATE TRIGGER private_batch_materialize AFTER INSERT ON private_batches BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.payload,'$.conversations') c JOIN private_conversations p
 ON p.account_id=NEW.account_id AND p.id=json_extract(c.value,'$.id')
 WHERE p.project_id<>NEW.project_id OR p.origin<>json_extract(c.value,'$.origin') OR p.session_id<>json_extract(c.value,'$.sessionId'))
 THEN RAISE(ABORT,'private conversation identity conflict') END;
 INSERT INTO private_conversations(account_id,id,project_id,origin,session_id,title,provenance)
 SELECT NEW.account_id,json_extract(value,'$.id'),NEW.project_id,json_extract(value,'$.origin'),json_extract(value,'$.sessionId'),
 json_extract(value,'$.title'),json_extract(value,'$.provenance') FROM json_each(NEW.payload,'$.conversations') WHERE true
 ON CONFLICT(account_id,id) DO UPDATE SET title=excluded.title,provenance=excluded.provenance,updated_at=NEW.created_at;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.payload,'$.conversations') c,json_each(c.value,'$.events') e
 JOIN private_events p ON p.account_id=NEW.account_id AND p.conversation_id=json_extract(c.value,'$.id')
 AND (p.id=json_extract(e.value,'$.id') OR p.sequence=json_extract(e.value,'$.sequence'))
 WHERE p.id<>json_extract(e.value,'$.id') OR p.sequence<>json_extract(e.value,'$.sequence') OR p.role<>json_extract(e.value,'$.role')
 OR p.text<>json_extract(e.value,'$.text') OR p.timestamp IS NOT json_extract(e.value,'$.timestamp'))
 THEN RAISE(ABORT,'private event identity conflict') END;
 INSERT INTO private_events(account_id,conversation_id,id,sequence,role,text,timestamp)
 SELECT NEW.account_id,json_extract(c.value,'$.id'),json_extract(e.value,'$.id'),json_extract(e.value,'$.sequence'),
 json_extract(e.value,'$.role'),json_extract(e.value,'$.text'),json_extract(e.value,'$.timestamp')
 FROM json_each(NEW.payload,'$.conversations') c,json_each(c.value,'$.events') e WHERE true
 ON CONFLICT(account_id,conversation_id,id) DO NOTHING;
 UPDATE private_project_devices SET last_sync_at=NEW.created_at WHERE project_id=NEW.project_id AND device_id=NEW.device_id;
END;
CREATE INDEX private_events_snapshot ON private_events(account_id,conversation_id,ingest_id);
