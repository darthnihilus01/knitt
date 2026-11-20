# Knitt plugin beta release candidate validation

The Codex Linux x64 preview was published on 2026-11-20 as an explicitly experimental prerelease. The existing npm beta.5 release is unchanged. Other host and platform packages remain unreleased.

## Fixes from native Codex testing

- The portable stdio executable must be a contained `./scripts/node` path. `${PLUGIN_ROOT}/scripts/node` was rejected by Codex even though directly launching it in the old smoke test worked.
- Portable hosts start the process inside the plugin directory. The adapter now waits for MCP project roots before registering project tools and starting synchronization. Missing or ambiguous roots require an explicitly approved project selection. It never silently treats the installation directory as a project.
- Artifact verification now launches the actual host manifest with the installation directory as cwd and supplies project roots independently. The previous artifact reproduced the wrong-directory failure; the fixed artifact passes.

## Evidence

- Type checking passes.
- Full suite: 105 tests pass, none fail.
- Packaged lifecycle: clean installation, MCP, chat selection, capture/recall, update, rollback, failure preservation and uninstall pass.
- All three Linux x64 host artifacts pass manifest-based MCP launch, project-root resolution, startup hook output and external state preservation.
- Runtime builds exist for all six OS/architecture targets. Windows/macOS and Linux arm64 were not executed natively.
- Live browser account pairing succeeded against production.
- With explicit user consent for a disposable project only, one native Codex conversation was discovered and uploaded: one batch delivered, zero pending, no import errors.
- The approved Codex conversation loaded through the Claude adapter from the live cloud with a pinned source boundary. Destination synchronization remained disabled. This is an adapter test, not proof of Claude's native UI.
- A short headless Codex session did not automatically upload by itself. In a separate live test, the installed adapter stayed running and automatically uploaded a newly created native Codex conversation through its periodic synchronization loop. No manual sync tool was called; pending was zero with no error. This proves adapter-driven automatic capture, not desktop hook invocation.
- The revised website setup dialog was browser-verified against a disposable database and deployed. It shows connected installation count and a separate setup action for already installed plugins. The Codex Linux x64 experimental preview has a download link; other hosts remain gated.

## Published preview artifacts

GitHub preview: https://github.com/darthnihilus01/knitt/releases/tag/knitt-plugins-v0.1.0-beta.6-rc.1

Tag: `knitt-plugins-v0.1.0-beta.6-rc.1`. The published Codex marketplace ZIP includes verified Node, dependencies, setup/continuation skills, a marketplace catalog and a SHA256 file. The Claude candidate remains local. Archive validation excludes account credentials and SQLite runtime state. The attached exact source snapshot reproduces the runtime JavaScript; the base repository commit does not represent these uncommitted changes.

Cloud dashboard deployment: `899cceda-67d4-4038-bdb4-74c49764e265`.

## Remaining release gates

1. Demonstrate new-message capture inside Codex desktop with the installed plugin.
2. Demonstrate Claude Code and Antigravity native installation and capture on their actual clients.
3. Exercise the two-account invitation/continuation/revocation matrix in the real clients.
4. Verify each platform natively before enabling its download link.
5. Source snapshot verification passed: all 35 runtime JavaScript files match the rebuilt source byte-for-byte.

A local source ZIP accompanies the runtime candidates. Recompiling that snapshot reproduces all 35 packaged plugin JavaScript files byte-for-byte. The distributed runtime excludes the cloud-service implementation. Source upload was initially blocked by automatic approval review. The user subsequently explicitly authorized the source upload and experimental preview publication. The plugin and source ZIPs are publicly accessible without authentication.

The published preview deliberately retains the desktop-hook and two-account limitations above. It is not a claim that full host certification passed. GitHub asset digests matched the approved local files before publication; the release is marked prerelease and is not the latest stable release.
