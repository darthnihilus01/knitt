# Knitt plugin onboarding beta

Install Knitt from its marketplace source in the coding agent's plugin manager. Review the plugin permissions and trust its capture hooks when the host asks. Run the Knitt setup skill in the agent, connect an account in the browser, then choose Continue my work or Open a friend's invitation.

For personal work, inspect the canonical project and discovered histories, select an existing cloud project or create a new one, and explicitly approve private automatic sync. Account approval alone does not enable upload. An invitation can be accepted and continued independently of destination sync consent. Separate project consent enables syncing the recipient's own future work.

Use /knit to choose a local, personal cloud or accepted shared conversation. The host may display the command under the Knitt plugin namespace. Personal cloud selection pins the ingestion boundary. Shared selection pins the published version. New destination progress is captured separately. Sharing a reviewed publication always requires explicit action.

## Completing project cloud sync

Connector installation and account pairing do not mean your chats have synced. After restarting your coding agent, paste:

> Set up Knitt cloud sync for my current project. Show me the history preview before uploading.

The agent confirms the current project, shows discovered conversations and counts by agent, and asks you to choose or create a cloud project and approve existing and future supported messages. It imports the history, then verifies that the cloud conversation API can read the imported conversations before reporting them as available. It reports pending uploads and errors instead of treating partial setup as success. Existing approved mappings are reused; paused mappings require explicit approval to resume.

In My contexts, **Add or finish project sync** remains available even if you already have chats. Only approved projects appear; the browser cannot discover unselected local workspaces. Paused and unfinished sync details expand automatically. Project links from setup filter the history list to that project, with **Show all projects** to return. Existing history is retained when paused or disconnected.

The additive `knitt_status` fields `setupState`, `statusMessage` and `nextAction` distinguish `account_connection_required`, `project_selection_required` (unbound native plugin), `sync_approval_required`, `paused`, `initial_sync_pending`, `sync_error` and `synced`. `synced` reflects the local upload record; only the explicit sync result's `cloudVerified: true` confirms a current cloud read. Initial approval and explicit retries return import counts, cloud verification and a project URL; failed uploads remain queued. Account sign-in never implies project upload consent.

## Build and validation

Maintainers build the application with npm run build, then run node scripts/package-plugins.ts with one or more targets. The supported artifact targets are linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64 and win32-arm64. KNITT_PLUGIN_OUTPUT selects the artifact directory. Runtime archives are downloaded from nodejs.org and verified against the version's official SHASUMS256.txt before extraction. Every artifact includes the Node license and runtime provenance.

The output contains platform-specific marketplace roots and host plugin directories, plus compressed artifacts and SHA256 files. Node and production dependencies are bundled. End users install through their host's plugin UI. The generated marketplace is a development source until verified in the actual host.

## Readiness matrix

| Host | Manifest, bundled Linux runtime and MCP/hook tests | Native plugin manager installation | Capture inside the trusted app | Two-account handoff |
| --- | --- | --- | --- | --- |
| Codex desktop | Passed | Passed via Codex 0.167.0-alpha.3.2 manager | Pending | Pending |
| Claude Code | Passed | Passed via Claude Code 2.1.322 manager | Pending | Pending |
| Antigravity | Passed | Pending for IDE 1.107.0 | Pending | Pending |

Cross-platform binary launch and hook invocation require native OS checks. Building an arm64 or Windows artifact on Linux does not verify that it runs on the target. The dashboard exposes an explicitly experimental Codex Linux x64 preview. Verified host releases still require native installation and capture checks; other host/platform links remain pending.

Capture is scoped to approved projects and supported user/assistant text. Tool output and hidden reasoning are excluded by the existing importer. Importer credential redaction is best effort. Full text is retained as events and paged for bounded recall. Client hooks and the running local MCP process trigger synchronization, including retry after offline work. No background upload is promised while the plugin's local processes are stopped.

Pause stops uploads, including queued uploads, while preserving local memory. Disconnect removes the local sync mapping and queued uploads for that mapping, while retaining existing local and cloud history. Reconnecting requires fresh consent. Installation revocation stops authenticated cloud retrieval and upload. Project sync controls in Settings show observed heartbeat and last successful sync, with stale state identified.

## Validation recorded on 2026-11-19

The full automated suite passed 102 tests. The packaged npm lifecycle check passed clean installation, MCP selection, capture/recall, update, rollback and uninstall. The three Linux x64 plugin artifacts each passed bundled-runtime startup, MCP tool discovery, startup-hook output and persistent-state preservation with `node scripts/verify-plugin-artifacts.ts`. All 18 host/platform archives were built with verified official Node 24.18.0 checksums; only the Linux x64 binaries were executed.

Browser checks against the real Worker with a disposable local database verified private-history listing and detail, the pending plugin catalog, pause/resume, disconnect and retained history. Native plugin-manager installation is separate from trusted app execution. Real app capture, browser pairing across two accounts and cross-agent handoffs remain release gates. The local marketplace remains available for development. The Codex Linux x64 preview is now published with its unverified desktop-hook and two-account checks clearly stated; other public links remain pending.

Cloud deployment: Worker version `0a144f44-81ce-4340-b114-ae77370d27ac` at https://knit.deeeznuts.me. Production checks passed `/health` (200), anonymous private-project retrieval (401), and updated dashboard assets. Migration 0005 was applied before deployment. The production catalog exposes only the experimental Codex Linux x64 preview and retains pending links for other hosts.

## Experimental Codex Linux preview

Published 2026-11-20: https://github.com/darthnihilus01/knitt/releases/tag/knitt-plugins-v0.1.0-beta.6-rc.1. The release includes the Codex marketplace ZIP, exact plugin source snapshot and checksums. Extract and open the marketplace folder in Codex to install through Plugins, then return to the real project for setup. This is an experimental prerelease, with desktop hooks and two-account sharing still unverified.
