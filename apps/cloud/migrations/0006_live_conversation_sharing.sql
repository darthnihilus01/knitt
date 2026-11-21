-- Separate from published snapshots: a grant exposes one conversation's synced history.
CREATE TABLE conversation_invitations (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 conversation_id TEXT NOT NULL,
 recipient_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'pending'
  CHECK(status IN ('pending','accepted','declined','withdrawn','revoked','left')),
 grant_id TEXT UNIQUE,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK(owner_id<>recipient_id),
 FOREIGN KEY(owner_id,conversation_id) REFERENCES private_conversations(account_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX open_conversation_invitation ON conversation_invitations(owner_id,conversation_id,recipient_id)
 WHERE status IN ('pending','accepted');
CREATE INDEX incoming_conversation_invitations ON conversation_invitations(recipient_id,status);
CREATE TRIGGER remove_friend_conversation_access AFTER UPDATE OF status ON contacts
 WHEN OLD.status='accepted' AND NEW.status='removed' BEGIN
 UPDATE conversation_invitations SET status=CASE status WHEN 'pending' THEN 'withdrawn' ELSE 'revoked' END
 WHERE status IN ('pending','accepted') AND
 ((owner_id=NEW.sender_id AND recipient_id=NEW.recipient_id) OR
  (owner_id=NEW.recipient_id AND recipient_id=NEW.sender_id));
END;
