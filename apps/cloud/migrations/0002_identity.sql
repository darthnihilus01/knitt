-- Existing Access accounts retain their original IDs and are never matched by email.
ALTER TABLE accounts ADD COLUMN username TEXT COLLATE NOCASE;
ALTER TABLE accounts ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1));
CREATE UNIQUE INDEX accounts_username ON accounts(username);

CREATE TABLE provider_identities (
  provider TEXT NOT NULL CHECK (provider IN ('google', 'github')),
  subject TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  PRIMARY KEY (provider, subject),
  UNIQUE (account_id, provider)
);

CREATE TABLE browser_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX session_expiry ON browser_sessions(expires_at);

CREATE TABLE oauth_flows (
  state_hash TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  browser_hash TEXT NOT NULL,
  verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  link_session TEXT REFERENCES browser_sessions(token_hash) ON DELETE CASCADE,
  return_to TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX flow_expiry ON oauth_flows(expires_at);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX devices_account ON devices(account_id);

CREATE TABLE device_pairings (
  id TEXT PRIMARY KEY,
  user_code_hash TEXT NOT NULL UNIQUE,
  device_code_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX pairing_expiry ON device_pairings(expires_at);
