# npm installation and runtime lifecycle

## Try the unpublished release candidate

Build and pack from the repository:

```bash
npm ci
npm run check
npm run build
npm pack
```

Then use the tarball (absolute paths work from any directory):

```bash
npx --yes --package ./shared-agent-memory-0.1.0.tgz shared-agent-memory setup \
  --workspace /path/to/project --client codex --client claude-code \
  --package /absolute/path/to/shared-agent-memory-0.1.0.tgz
```

The outer `--package` tells npx which CLI to run. The `--package` after `setup` tells setup which exact artifact to install persistently. Before registry publication this second argument is required for applying setup; preview can run without it. While the package is private, applying setup/update without an explicit artifact is blocked to avoid fetching an unrelated registry package. After publication, omitting the internal package argument installs the CLI's exact published version. `update` defaults to the registry's latest version instead.

Use `--preview` to inspect changes without creating installation/configuration files. Interactive setup asks before applying; automation must pass `--yes`. Repeat `--client` for several agents. Setup requires Git repository metadata to derive a stable repository identity.

## Durable installation

The default installation directory is:

- Linux: `$XDG_DATA_HOME/shared-agent-memory` or `~/.local/share/shared-agent-memory`.
- macOS: `~/Library/Application Support/SharedAgentMemory` (platform validation pending).

Override with `SHARED_MEMORY_HOME` or `--home /absolute/path`. The directory contains private `data/`, versioned runtime installations and `installation.json`. Node and runtime paths in generated settings are absolute. Upgrading/removing Node itself can invalidate the executable path; rerun setup with the new Node installation.

The setup process uses npm to install production dependencies in staging with dependency lifecycle scripts disabled. It verifies the packaged executable before rebinding connectors. The temporary npx cache can then be removed without breaking installed connections. Installation metadata uses an exclusive lock; after a crash, inspect the PID in `install.lock/owner.json` before removing a stale lock.

The project-local `.memory/npm-connection.json` records original and generated settings. Keep it until uninstall. Do not commit this private file. Existing Git excludes are extended for local generated settings. Existing Python-installed connections are considered unmanaged by the new CLI: they are not silently adopted or overwritten. Use a fresh project for the release candidate, or restore the legacy connector backups before migrating deliberately.

## Commands

Run commands through the tarball CLI above (or the eventual published package):

```text
shared-agent-memory setup --workspace PATH --client codex --preview
shared-agent-memory doctor
shared-agent-memory update --yes
shared-agent-memory rollback --yes
shared-agent-memory uninstall --workspace PATH --yes
shared-agent-memory serve
```

Use the same `--home` for every lifecycle command if you customized it. `doctor` checks local installation/configuration, not account login or a live model handoff. Changed settings are reported for review.

Update installs another runtime before changing project connections. Failed dependency installation leaves the active installation metadata and bindings untouched. Rollback switches managed projects to the previous runtime, preserving memory. Old runtime directories remain available; garbage collection is not implemented.

Uninstall restores unchanged managed values and preserves independent additions or user edits. It removes one project's bindings and registry entry while retaining the runtime and all memory. It does not recursively delete the application directory or memory. Claude Desktop fragments must still be removed manually from Desktop's actual configuration if previously merged there.

## Release gates

The package name `shared-agent-memory` is provisional; availability and publisher ownership are not confirmed. The repository still has `private: true` to prevent accidental registry publication. No license has been selected, so this is not yet a licensed open-source release. Native Windows setup deliberately fails rather than writing POSIX hook commands. Linux tarball checks are the current local verification target; macOS/Windows live client behavior remains unverified.

ChatGPT, Claude web and teammate machines require a separately reachable authenticated service. Packaging a CLI does not supply hosting, authentication accounts or background synchronization.
