# Knitt

Carry selected repository conversation context between coding agents. Choose the chat you want to continue, retrieve its checkpoint through MCP, and capture new progress using supported coding hooks.

## npm installation (release candidate)

The npm CLI is being prepared for publication. **It is not published yet:** the selected package is `@tinchu0/knitt`, and terminal login as `tinchu0` is verified. Until then, test the same distribution artifact locally:

```bash
npm ci
npm run build
npm pack
npx --yes --package ./tinchu0-knitt-0.1.0-beta.1.tgz knitt setup \
  --package /absolute/path/to/tinchu0-knitt-0.1.0-beta.1.tgz
```

Setup asks for a Git project folder and agents. It shows configuration changes before applying them, installs a persistent runtime in your user data directory, and leaves client login/trust prompts to the client. Node.js 24+ and Git are required. The npm installation path does not require Python or a source checkout once the tarball exists.

Once a registry package has actually been published, the intended entry point is `npx @tinchu0/knitt@next setup`. That placeholder is not a current install command.

Supported installer preview: Linux; macOS uses POSIX hooks but still needs platform validation. Native Windows installation is explicitly blocked pending implementation and tests; WSL can use the Linux path. Claude Desktop currently receives a configuration fragment requiring a manual merge into Desktop settings. No universal client compatibility is claimed.

See [npm installation and lifecycle](docs/clients/npm-installation.md) and [remote connector setup](docs/clients/connector-setup.md).

## What gets connected

- **Codex, Claude Code, Antigravity:** repository MCP settings and startup/stop hooks. Restart clients and approve MCP/hook trust normally.
- **Claude Desktop:** a generated local MCP fragment; chat checkpoints use tool calls rather than coding hooks.
- **ChatGPT / Claude web:** authenticated HTTP MCP is implemented, but requires your own public HTTPS endpoint and compatible OAuth provider. Local CLI setup does not provision a shared server.

The continue-chat skill calls the user picker. New sessions begin unselected. The current history importer discovers local Antigravity conversations in the connected repository, including linked worktrees. It does not access arbitrary Claude or ChatGPT account histories. Ordinary chat MCP clients must explicitly call memory tools to save checkpoints; MCP alone cannot passively capture every chat turn.

Local memory is local to one machine. Team sharing requires a shared authenticated service; identical repository names do not synchronize databases.

## Memory behavior

The tools are `choose_conversation`, `get_context`, `search_memory`, `get_evidence` and `save_memory`; ordinary chat profiles also expose `start_session`. Repository/session checks prevent one session from silently choosing another session's feature. The HTTP gateway validates JWT issuer, audience, expiry, subjects and scopes. Allowed users of a repository service share its feature evidence; finer team roles remain future work.

Evidence stores supported user/assistant text, with stable IDs for deduplication. Raw tool results, images and hidden reasoning are excluded. Bounded context reports truncation; search/evidence tools retrieve older detail. Recalled material can be stale or conflicting and is reference material, not authorization to edit files. Basic credential redaction is best effort.

## Development

```bash
npm ci
npm run check
npm test
npm run test:package
```

`test:package` builds and installs a real tarball, deletes the bootstrap copy, and verifies persistent MCP/hook execution, doctor, update, rollback, failed-install preservation and uninstall. It requires network access for production dependencies and an environment permitting child-process pipes.

The legacy Python development installer remains available under `scripts/connect.py`. Published CLI setup and handoff installation use the Node-only planner.

This repository remains a release candidate. Public release additionally requires publisher access confirmation, a full-history/private-data audit and supported-platform evidence. No npm publication or repository visibility change is performed by building or packing.

## License

Knitt is licensed under the [Apache License 2.0](LICENSE).
