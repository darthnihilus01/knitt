# Cloudflare account foundation

Use compact planning, dependency-level inspection and impact-focused verification. Work in apps/cloud, its tests and cloud setup documentation. Authentication changes require signed-token rejection tests. No agent delegation is needed.

1. Add a Worker with public health and authenticated account endpoints, validating Access signature, issuer, audience, expiry and human identity.
2. Add a D1 accounts migration and atomic identity upsert. Keep account identity stable across retries and email changes.
3. Supply Wrangler configuration and deployment instructions for an Access-protected custom hostname.
4. Test signed identities and migration behavior using SQLite, typecheck, and validate the Wrangler bundle. Remote deployment requires the user's Cloudflare account and hostname.
