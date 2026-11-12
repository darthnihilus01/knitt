# Public installation — proposed first release

## Intent

Someone other than the developer can download this repository and connect their own coding agents without copying machine-specific paths or existing private memory. Context remains scoped to their repository and explicitly selected conversation.

## Approaches

1. Download/clone plus a local setup wizard (recommended): reuse the existing TypeScript server and Python installer. Requires Node 24+, Python 3.11+ and Git. Lowest release complexity; the installed application folder must remain in place.
2. Published npm CLI: a shorter installation command, but requires package naming, distributable packaging and an npm release process. Good follow-up once the first installation flow passes clean-machine checks.
3. Desktop application: can bundle prerequisites and add a graphical onboarding flow, with substantially more packaging, signing and platform work.

The first approach is proposed, awaiting user approval. No public publishing or repository visibility change is part of implementing this proposal.

## User flow

Download or clone → npm ci → npm run setup → choose project folder → choose agents → inspect configuration changes → apply → review client trust prompts → select a conversation to continue.

The wizard validates prerequisites and project paths, derives repository identity, and reuses the existing configuration merger for Codex, Claude Code, Antigravity and the Claude Desktop fragment. It reports each client's actual state: configured, manual action required, or failed. Cancellation must not apply settings. Repeated installation preserves unrelated settings and uses existing backups.

An npm run doctor command checks prerequisites, application paths, database accessibility and generated connection configuration without starting a model or changing project files. It reports actionable repair instructions, not a claim of a successful model handoff.

## Boundaries

Initial testing targets local POSIX installations. Windows hook commands need separate implementation and verification before Windows support is advertised. Ordinary ChatGPT and Claude web continue to require an HTTPS/OAuth service, which the wizard describes and can prepare but cannot silently provision. Local setup alone does not synchronize a team's machines.

Conversation discovery currently imports Antigravity local history; the release must not promise universal access to every agent's past chats. Chat selection remains explicit, and recalled context does not authorize code edits.

## Release preparation

Replace personal-machine examples in the primary quickstart with portable commands. Document prerequisites, client support and honest limitations. Add clean-install checks using a temporary project and a distributable source snapshot, excluding private .memory data and local connection settings.

Before an actual open-source release: choose a license, audit repository history and release contents, add contribution/security guidance and CI. The current repository has no license or CI; neither a full-history secrets scan nor public release approval has occurred.

## Acceptance

- An unrelated temporary Git repository can be connected through the wizard using its own paths and identity.
- Preview/cancellation writes no client configuration.
- Repeated setup preserves unrelated configuration and selected-chat behavior.
- Missing prerequisites produce readable remediation.
- Doctor detects missing or stale paths without exposing memory content.
- Type checking and existing plus installation-focused tests pass.
- No credentials, personal conversation content or machine-specific configurations are bundled.
