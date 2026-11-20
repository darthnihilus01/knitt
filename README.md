# Knitt

Continue coding conversations across agents. Keep local memory, optionally sync supported project history privately to Knitt Cloud, and explicitly publish reviewed handoffs for another person.

Start with the **[Knitt usage guide](docs/usage.md)** for setup, choosing a conversation, continuing work across agents, saving checkpoints, and troubleshooting.

## npm installation

Open your Git project in a coding agent and paste this into the chat:

> Run `npx @tinchu0/knitt@latest plugin` from this Git project to connect my coding agents.

Knitt detects Codex, Claude Code, and Antigravity from their local settings or executables on PATH. Add `--client` to choose specific agents. In an interactive terminal you can review the detected list before applying setup.

After setup, restart the connected agents and review their trust prompts. Ask “Set up Knitt for this project” to pair your account and approve project sync, then use `/knit` to resume a conversation. The coding agent needs local shell access, Node.js 24+, and Git.

For interactive setup from your own terminal, run:

```bash
npx @tinchu0/knitt setup
```

Setup asks for a Git project folder and agents. It shows configuration changes before applying them, installs a persistent runtime in your user data directory, and leaves client login/trust prompts to the client. Node.js 24+ and Git are required. No source checkout or Python is needed.

For Antigravity only:

```bash
npx @tinchu0/knitt setup --workspace /path/to/project --client antigravity
```

The installer includes native Linux, macOS and Windows paths. Windows uses built-in Windows PowerShell for hooks; macOS and Linux use POSIX hooks. CI is configured to run the full suite and packaged lifecycle checks on all three operating systems. Linux checks passed locally; native Windows/macOS runs and live client handoffs still need confirmation. Claude Desktop currently receives a configuration fragment requiring a manual merge into Desktop settings. No universal client compatibility is claimed.

See [npm installation and lifecycle](docs/clients/npm-installation.md) and [remote connector setup](docs/clients/connector-setup.md).

## What gets connected

- **Codex, Claude Code:** repository MCP settings and startup/stop hooks. Restart clients and approve MCP/hook trust normally.
- **Antigravity:** project startup/stop hooks plus automatic registration in `~/.gemini/config/mcp_config.json`. Each project gets its own server name. Setup verifies its memory tools before activating the runtime. Restart Antigravity and use `/knit` in a fresh chat. Choose a conversation inside the same coding interface. Antigravity uses its selectable question UI; clients with native MCP forms can use those.
- **Claude Desktop:** a generated local MCP fragment; chat checkpoints use tool calls rather than coding hooks.
- **ChatGPT / Claude web:** authenticated HTTP MCP is implemented, but requires your own public HTTPS endpoint and compatible OAuth provider. Local CLI setup does not provision a shared server.

The knit skill calls the user picker. New sessions begin unselected. The history importer discovers local Claude Code project transcripts, Codex sessions and Antigravity conversations in the connected repository, including linked worktrees. It excludes the current coding agent and sorts the other agents’ histories newest first. It does not access remote Claude or ChatGPT account histories. Ordinary chat MCP clients must explicitly call memory tools to save checkpoints; MCP alone cannot passively capture every chat turn.

Local installation alone uploads nothing. After browser account pairing, review the project and discovered histories inside the agent and approve private automatic sync. Select an existing cloud project explicitly when connecting another installation. Sharing with another person requires a reviewed publication, an invitation and acceptance. Manage access at https://knit.deeeznuts.me; identical repository names never join projects automatically.

## Memory behavior

Local memory tools include `choose_conversation`, `get_context`, `search_memory`, `get_evidence` and `save_memory`; ordinary chat profiles also expose `start_session`. Repository/session checks prevent one session from silently choosing another session's feature. The HTTP gateway validates JWT issuer, audience, expiry, subjects and scopes. Allowed users of a repository service share its feature evidence; finer team roles remain future work.

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

The one-command installer resolves the npm `latest` tag. Building or packing locally does not publish a release. A packed installation can be tested with `npx --yes --package /absolute/path/to/package.tgz knitt setup --package /absolute/path/to/package.tgz`.

## License

Knitt is licensed under the [Apache License 2.0](LICENSE).
