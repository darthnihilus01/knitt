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
npx --yes --package ./tinchu0-knitt-0.1.0-beta.1.tgz knitt setup \
  --workspace /path/to/project --client codex --client claude-code \
  --package /absolute/path/to/tinchu0-knitt-0.1.0-beta.1.tgz
```

The outer `--package` tells npx which CLI to run. The `--package` after `setup` tells setup which exact artifact to install persistently. Before registry publication this second argument is required for applying setup; preview can run without it. The release candidate is configured for registry publication; until it is published, pass the explicit tarball to setup/update. After publication, omitting the internal package argument installs the CLI's exact published version. `update` follows the `next` registry tag for prerelease CLIs and `latest` for stable CLIs.

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

The selected package is `@tinchu0/knitt`, owned by the intended npm account `tinchu0`. A registry lookup returned no public package on 2026-11-13; Terminal login as `tinchu0` is verified. Version `0.1.0-beta.1` is prepared with public access and the `next` tag; actual publication is still pending. Knitt is licensed under Apache-2.0; the LICENSE file ships in the npm package. Native Windows setup deliberately fails rather than writing POSIX hook commands. Linux tarball checks are the current local verification target; macOS/Windows live client behavior remains unverified.

ChatGPT, Claude web and teammate machines require a separately reachable authenticated service. Packaging a CLI does not supply hosting, authentication accounts or background synchronization.
