ALTER TABLE provider_identities ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0,1));
DROP VIEW IF EXISTS account_verified_emails;
CREATE VIEW account_verified_emails AS
  SELECT id AS account_id,email COLLATE NOCASE AS email FROM accounts WHERE email_verified=1
  UNION SELECT account_id,email COLLATE NOCASE FROM provider_identities WHERE email_verified=1;
