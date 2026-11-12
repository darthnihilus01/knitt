# npm Distribution Implementation Plan

> **For agentic workers:** Use executing-plans to implement task-by-task with TDD.

**Goal:** Install and manage a durable MCP runtime through an npm CLI.
**Architecture:** Compile the existing application preserving its directory layout. Port configuration merging to Node, then install a versioned runtime outside the npx cache and retain user data separately.
**Tech Stack:** Node 24+, TypeScript, npm, SQLite, existing MCP SDK.
**Spec:** ../specs/2026-11-12-npm-distribution-design.md (approved by user).

## Global Constraints

- No Python requirement on published installation paths.
- Never store durable data in the npm cache or runtime version directories.
- No actual registry publication or repository visibility changes.
- Package name stays provisional until publisher ownership is settled.
- Preserve unrelated configuration and never automatically delete memory.

## Review Focus

- Spaces, Unicode and command metacharacters in project paths.
- User edits between setup and uninstall/update.
- Concurrent setup and interrupted/failed npm installation.
- Stale runtime/Node paths and isolated bootstrap-cache deletion.
- Platform-specific hooks: no Windows support claim without Windows validation.

### Task 1: Node-only connection planner and transactional apply

Files: packages/installer/src/connections.ts, tests/installer.test.ts.
Interface: planConnection(options) returns path/content patches; applyConnectionPlan(plan) preserves originals and rolls back on failure.
- [x] Write preview/idempotency/conflict/uninstall preservation tests; observe failure.
- [x] Implement existing client configuration merging, managed ownership and Git excludes.
- [x] Verify tests with fixture repositories and paths containing quotes/spaces.

### Task 2: Compiled npm package and CLI

Files: package.json, tsconfig.build.json, scripts/build.ts, packages/installer/src/cli.ts.
Interface: CLI setup, doctor, update, rollback, uninstall, serve, handoff.
- [x] Write packaged binary and allowlist smoke test; observe failure.
- [x] Compile JavaScript and copy skill assets; add bin and explicit files.
- [x] Remove Python from connector-setup and handoff paths using Task 1.

### Task 3: Durable runtime lifecycle

Files: packages/installer/src/runtime.ts, tests/runtime.test.ts.
Interface: installRuntime(home, packageSpec), readInstallation(home), managed project registry.
- [x] Write durable runtime, concurrent lock, rollback and failed-install tests; observe failure.
- [x] Implement staging/versioned install, pinned version, private data root and atomic metadata.
- [x] Bind configurations to the durable runtime; implement doctor and lifecycle commands.

### Task 4: Release verification and documentation

Files: README.md, docs/clients/npm-installation.md, scripts/package-smoke.ts, CI configuration.
- [x] Pack and install tarball into clean directories; remove bootstrap and exercise MCP.
- [x] Test preservation, upgrades/rollback, uninstall and failure recovery.
- [x] Run full tests, build, type-check and diff checks.
- [x] Review completed implementation; record platform/publication limitations.

## Progress and policy

Planning: deep; context depth: dependency; verification: package/runtime + full suite; delegation: none during implementation.
Ruling: implement on feature branch in current workspace to preserve the existing installed application's location; do not move live .memory data.
Publication gates: license, npm owner/name, complete history audit and supported-platform evidence are still required before a public release.

## Completion evidence and rulings

- Type checking and build pass. Full suite: 48/48. Final tarball smoke passes bootstrap removal, MCP execution, recall hook, doctor, update, rollback, failed-install preservation and uninstall.
- Fresh independent review found four preservation defects; all were reproduced and fixed with regression coverage: backup rebasing, precise hook ownership, extended hook-group conflict, edited skill conflict.
- Ruling: retain private:true and disable implicit registry installs while unpublished; publisher/name and license are unsettled.
- Ruling: block native Windows setup rather than emit unvalidated POSIX hooks. CI is prepared for Linux/macOS; remote runs and macOS live client tests are not yet observed.
- Ruling: Claude Desktop generates a fragment requiring manual merge, preserving the existing tested behavior; automatic Desktop configuration management remains unfinished.
- Ruling: retain old runtime versions and user memory on uninstall. Garbage collection is deferred.
- Legacy Python-installed bindings are treated as unmanaged; explicit migration is required to avoid silently adopting user settings.
