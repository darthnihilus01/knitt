# npm installation and runtime lifecycle

## Install the npm preview

Run the published CLI:

```bash
npx @tinchu0/knitt@latest setup \
  --workspace /path/to/project --client codex --client claude-code
```

Add `--capture-new-sessions` to opt into independent local conversation histories and checkpoint-first handoffs. Version `0.1.0-beta.2` remains a preview. Both `latest` and `next` track the current preview release.

To test a source checkout before publication, run `npm ci`, `npm run check`, `npm run build` and `npm pack`, then install its exact artifact:

```bash
npx --yes --package ./tinchu0-knitt-0.1.0-beta.2.tgz knitt setup \
  --workspace /path/to/project --client codex --client claude-code \
  --package /absolute/path/to/tinchu0-knitt-0.1.0-beta.2.tgz
```

The outer `--package` selects the CLI; the `--package` after `setup` selects the artifact to install persistently. Without that inner option, setup installs the CLI's exact published version. `update` follows `next` for prerelease CLIs and `latest` for stable CLIs.

Use `--preview` to inspect changes without creating installation/configuration files. Interactive setup asks before applying; automation must pass `--yes`. Repeat `--client` for several agents. Setup requires Git repository metadata to derive a stable repository identity.

## Durable installation

The default installation directory is:

- Linux: `$XDG_DATA_HOME/shared-agent-memory` or `~/.local/share/shared-agent-memory`.
- macOS: `~/Library/Application Support/SharedAgentMemory` (platform validation pending).

Override with `SHARED_MEMORY_HOME` or `--home /absolute/path`. The directory contains private `data/`, versioned runtime installations and `installation.json`. Node and runtime paths in generated settings are absolute. Upgrading/removing Node itself can invalidate the executable path; rerun setup with the new Node installation.

The setup process uses npm to install production dependencies in staging with dependency lifecycle scripts disabled. It verifies the packaged executable before rebinding connectors. The temporary npx cache can then be removed without breaking installed connections. Installation metadata uses an exclusive lock; after a crash, inspect the PID in `install.lock/owner.json` before removing a stale lock.

The project-local `.memory/npm-connection.json` records original and generated settings. Keep it until uninstall. Do not commit this private file. Existing Git excludes are extended for local generated settings. Existing Python-installed connections are considered unmanaged by the new CLI: they are not silently adopted or overwritten. Use a fresh project for the release candidate, or restore the legacy connector backups before migrating deliberately.

## Commands

Run commands through `npx @tinchu0/knitt@latest` or the tarball CLI above:

```text
knitt setup --workspace PATH --client codex --preview
knitt doctor
knitt update --yes
knitt rollback --yes
knitt uninstall --workspace PATH --yes
knitt serve
```

Use the same `--home` for every lifecycle command if you customized it. `doctor` checks local installation/configuration, not account login or a live model handoff. Changed settings are reported for review.

Update installs another runtime before changing project connections. Failed dependency installation leaves the active installation metadata and bindings untouched. Rollback switches managed projects to the previous runtime, preserving memory. Old runtime directories remain available; garbage collection is not implemented.

Uninstall restores unchanged managed values and preserves independent additions or user edits. It removes one project's bindings and registry entry while retaining the runtime and all memory. It does not recursively delete the application directory or memory. Claude Desktop fragments must still be removed manually from Desktop's actual configuration if previously merged there.

## Release gates

The package is `@tinchu0/knitt`, published under npm account `tinchu0`, with Apache-2.0 licensing. The LICENSE file ships in the npm archive. Release `0.1.0-beta.2` includes opt-in local conversation memory. Native Windows setup deliberately fails rather than writing POSIX hook commands. Linux tarball checks are the local verification target; macOS/Windows live client behavior remains unverified.

ChatGPT, Claude web and teammate machines require a separately reachable authenticated service. Packaging a CLI does not supply hosting, authentication accounts or background synchronization.


### Optional local conversation mode

Add `--capture-new-sessions` to setup to opt a connected project into independent session capture and explicit continuation links. The preference survives subsequent setup/update operations. Existing connections keep their previous semantics until opted in. This mode upgrades the database using consistent SQLite backups; the updated installer blocks incompatible runtime downgrade rather than restoring data automatically. Use `doctor` for content-free capture status. See [setup and recovery](local-agent-memory.md).
