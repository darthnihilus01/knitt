CREATE INDEX accounts_verified_email ON accounts(email COLLATE NOCASE) WHERE email_verified=1;
CREATE INDEX provider_verified_email ON provider_identities(email COLLATE NOCASE);
CREATE VIEW account_verified_emails AS
  SELECT id AS account_id,email COLLATE NOCASE AS email FROM accounts WHERE email_verified=1
  UNION SELECT account_id,email COLLATE NOCASE FROM provider_identities;

CREATE TABLE contexts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  source_version_id TEXT,
  creation_key TEXT,
  creation_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(owner_id, creation_key)
);

CREATE TABLE versions (
  id TEXT PRIMARY KEY,
  context_id TEXT NOT NULL REFERENCES contexts(id) ON DELETE CASCADE,
  number INTEGER NOT NULL CHECK(number >= 1),
  publication_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  checkpoint TEXT NOT NULL,
  source TEXT NOT NULL CHECK(json_valid(source)),
  excerpts TEXT NOT NULL CHECK(json_valid(excerpts)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(context_id, number),
  UNIQUE(context_id, publication_key),
  UNIQUE(context_id, id)
);

CREATE TABLE evidence (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  text TEXT NOT NULL
);
CREATE INDEX evidence_version ON evidence(version_id);
-- The same SQLite statement commits the version and all evidence or rolls back both.
CREATE TRIGGER materialize_version_evidence AFTER INSERT ON versions BEGIN
  INSERT INTO evidence(id,version_id,text)
  SELECT json_extract(value,'$.id'),NEW.id,json_extract(value,'$.text') FROM json_each(NEW.excerpts);
END;

-- A grant is the accepted state of its invitation. Terminal states never transition back.
CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  context_id TEXT NOT NULL REFERENCES contexts(id) ON DELETE CASCADE,
  start_version_id TEXT NOT NULL,
  recipient_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  invited_email TEXT COLLATE NOCASE,
  grant_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','accepted','declined','withdrawn','revoked','left')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK(recipient_id IS NOT NULL OR invited_email IS NOT NULL),
  FOREIGN KEY(context_id,start_version_id) REFERENCES versions(context_id,id) ON DELETE CASCADE
);
CREATE INDEX invitations_recipient ON invitations(recipient_id,context_id,status);
CREATE INDEX invitations_email ON invitations(invited_email,status);
CREATE UNIQUE INDEX open_account_invite ON invitations(context_id,recipient_id)
  WHERE recipient_id IS NOT NULL AND status IN ('pending','accepted');
CREATE UNIQUE INDEX open_email_invite ON invitations(context_id,invited_email)
  WHERE invited_email IS NOT NULL AND status IN ('pending','accepted');

CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','withdrawn','removed')),
  CHECK(sender_id <> recipient_id)
);
CREATE UNIQUE INDEX open_contact_pair ON contacts(min(sender_id,recipient_id),max(sender_id,recipient_id))
  WHERE status IN ('pending','accepted');
