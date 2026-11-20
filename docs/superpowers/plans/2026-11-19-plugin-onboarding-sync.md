# Plugin onboarding and private history sync implementation

User approved full-history plugin onboarding for Codex desktop, Claude Code and Antigravity, with the Knitt marketplace beta. Personal contexts automatically sync after project-specific consent. Friend invitations require acceptance and destination project consent is separate.

## Integration contract

- Package host-specific plugins with bundled verified Node runtimes. Launch local MCP through plugin-main and capture through plugin-hook. User state survives plugin updates.
- Extend device pairing into in-agent onboarding tools. Present actual history discovery before consent and let users explicitly create or select a cloud project.
- Store private projects, installation consent, conversations, immutable event batches and pinned ingestion boundaries in D1. Keep sharing publications separate.
- Capture and upload with durable local retry state, even when the user has not selected a source. Every cloud read and write checks account ownership, live consent and device validity.
- Present plugin readiness, project controls and private conversations in the dashboard.

## Verification

Run focused local sync, consent/isolation, retries, packaging and picker tests before the full suite and packaged lifecycle checks. Check browser dashboard flows using fixtures. Verify real installed plugin and capture behavior for each host before exposing that host artifact as released. Record external blockers separately from passing adapter tests.

## Decisions

- Use existing Cloudflare device pairing for the local plugin adapter, with no user-entered terminal command.
- Installation approval and account linkage do not imply cloud upload consent. Explicit confirmation binds local canonical project root, installation and account to a cloud project ID.
- Expose paused/disconnected states accurately and preserve retained cloud history unless the owner explicitly deletes it.
