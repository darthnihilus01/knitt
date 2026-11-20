# Knitt Cloud

The Cloudflare Worker serves the dashboard, OAuth endpoints and authenticated API at https://knit.deeeznuts.me. D1 stores accounts, identities, browser sessions, devices, contacts and published context versions. Browser mutations require an exact Origin and session CSRF token. Device credentials are revocable and stored as hashes.

## Provider registration

Create a Google web OAuth client and a GitHub OAuth application with homepage https://knit.deeeznuts.me. Register the respective exact callbacks.

- Google uses https://knit.deeeznuts.me/auth/google/callback.
- GitHub uses https://knit.deeeznuts.me/auth/github/callback.

Use the provider's publishing/consent settings to allow the intended audience. Google testing-mode restrictions may require adding testers until the application is published.

From apps/cloud, enter the four credentials through Wrangler secret prompts.

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
```

Sign-in uses provider identities, with explicit account linking from Settings. Accounts are never merged by email. Google users with third-party email addresses can sign in, and receive invitations by username. Only authoritative verified Google email or verified GitHub primary email can claim email invitations. Existing Access-created accounts retain their IDs and data, but require a separately verified migration route before a new provider can access them.

## Build and deploy

The existing Wrangler configuration names the production D1 database and custom domain. Confirm the account with wrangler whoami. Apply migrations before deploying the new code.

```bash
npx wrangler d1 migrations apply knitt-cloud --local
npx wrangler deploy --dry-run --outdir /tmp/knitt-cloud-bundle
npx wrangler d1 migrations apply knitt-cloud --remote
npx wrangler deploy
```

The /health endpoint remains public. Interactive workers.dev visits redirect to the canonical custom domain. Missing provider secrets produce an explicit configuration error. The dashboard becomes usable after sign-in and username selection.

## Admin panel

The dashboard includes an **Admin** tab for accounts listed in `ADMIN_ACCOUNT_IDS`.
Open `/#admin` after signing in. It shows total users, signups in the last seven
days, pending onboarding, connected installations, published contexts and synced
conversation counts. Search users by email, username or account ID; filter by
provider or onboarding status. Results are paginated, newest first. Installation
activity is the last recorded device API use, not browser activity.

To grant access, sign in normally and retrieve your stable account ID from the
`account.id` field of `/api/me` in your browser. From `apps/cloud`, run
`npx wrangler secret put ADMIN_ACCOUNT_IDS` and enter that exact ID at the prompt.
Multiple account IDs may be comma-separated. Removing an ID removes its admin
access on the next request. No account has admin access when the setting is empty.
Admin APIs require a valid browser session; installation tokens cannot access
them. They expose account metadata and usage counts, without conversation content
or session/device credentials. No new database migration is needed.

## Test the development CLI

The cloud commands are implemented in this checkout. The published npm beta.5 does not yet include them. From the repository root, run the source entry point with Node.js 24 or later.

```bash
node packages/installer/src/cli.ts cloud login
node packages/installer/src/cli.ts cloud publish --workspace /absolute/path/to/project
node packages/installer/src/cli.ts cloud logout
```

Publishing supports offline draft preparation and review. Use knitt cloud publish list to inspect local conversations, prepare to save an editable draft, show to review it and submit for explicit publication. The CLI prints detailed usage for missing options. It discovers supported Codex, Claude Code and Antigravity histories. In a connected coding session, /knit offers Shared with me alongside local histories. Selecting a remote version pins it to that session and rechecks cloud permissions for reads, search and evidence.

## Verification

Run npm run check, npm test and npm run test:package from the repository root. Tests exercise real SQLite migrations, signed provider fixtures, state and session rejection, three-account authorization and all three source/destination adapter pairings. Live Google/GitHub consent and real client application testing require configured providers and authenticated client installations.
