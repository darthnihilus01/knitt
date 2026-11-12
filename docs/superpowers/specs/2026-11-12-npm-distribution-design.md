# npm distribution — proposed production release design

## Decision and intent

The user chose a published npm CLI as the first distribution method. A source-download wizard was rejected. A desktop application adds packaging work without satisfying the requested npm installation path.

The eventual entry point is `npx <package-name>@latest setup`. Package name and npm publisher ownership remain undecided; examples are placeholders, not currently runnable registry commands.

## Installation architecture

Publish compiled JavaScript with a CLI binary, explicit package file allowlist, license and repository metadata. End users need Node 24+ and Git, without Python or a source checkout. Port the existing Python configuration merger to TypeScript, preserving conflict detection, backups and unrelated settings.

Setup installs the exact invoked package version and production dependencies in a versioned per-user application directory using npm. It never binds long-lived connectors to the npx cache. Memory databases, queues and installation metadata live in a separate durable per-user data directory. Neither setup nor updates store data inside installed package directories.

Use platform-appropriate application/data locations, with an explicit override for controlled installations and tests. Install into staging, verify the runtime, then activate it. Failed installation leaves previous connectors and data usable. Generated configuration references absolute executable and installed runtime paths; no privileged global installation or shell profile changes are required.

## CLI behavior

- `setup`: choose project and clients, inspect proposed changes, apply, then report any client trust/restart steps. Explicit flags support noninteractive use. Cancellation applies no configuration.
- `doctor`: verify prerequisites, runtime and generated settings, with actionable diagnostics and no memory-content output.
- `update`: install a selected version and update only managed bindings after verification. Preserve user data and allow rollback to the previous working version.
- `uninstall`: preview and remove only still-managed bindings. Preserve modified user settings and memory data. Memory deletion requires an explicit separate request.
- `serve`: local stdio MCP server from the persistent runtime. Keep authenticated HTTP serving available for self-hosted remote clients.

Avoid custom install-time lifecycle scripts. Network/package installation occurs only in explicit setup/update operations. Setup must not run an agent model.

## Compatibility and product boundaries

Target macOS, Linux and Windows with platform-specific command/path handling. Windows hook support is a release criterion requiring real Windows tests; it must not be inferred from a successful Linux test. Claude Desktop setup must detect supported configuration locations, preview/merge changes and preserve unrelated servers.

Local installation provides local memory. Team sharing and ChatGPT/Claude web require a reachable authenticated service; installing the CLI alone does not supply hosting or synchronize machines. Existing remote OAuth prerequisites remain explicit. Current Antigravity history discovery does not imply access to all clients' account history. Conversation selection remains explicit before recall or capture.

## Release evidence

Build and type-check; run existing behavior tests plus installer tests. Produce an npm tarball and install it in a clean temporary consumer environment. Launch MCP through the packaged binary after removing the temporary bootstrap location. Verify setup, repeated setup, conflict preservation, rollback, doctor and uninstall using fixture repositories.

Exercise spaces/Unicode in paths, interrupted installs, concurrent setup, stale Node paths and readonly destinations. Ensure package contents exclude memory, local profiles, personal paths and fixtures containing private history. CI should cover supported platforms and package smoke tests. Document actual live client verification separately from configuration tests.

## Publishing

Use versioned releases and npm trusted publishing where supported, with a package preview before publication. Package ownership, license choice, history/data audit and registry publication are release checkpoints. Public availability is not claimed until the registry install command has been verified. This proposal authorizes no repository visibility change or actual package publication by itself.

## Approval

The npm approach is selected. This detailed design is proposed for user review before implementation.
