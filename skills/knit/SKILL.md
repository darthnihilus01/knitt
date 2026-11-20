---
name: knit
description: Use when the user wants to set up Knitt account and project sync, or continue a local, privately synced, or shared coding conversation.
---

<!-- shared-agent-memory -->
# Set up Knitt or continue a coding conversation

## Route the request first

**A bare `/knit`, “knit”, “reload”, or “continue this chat” means continuation.** Immediately call `choose_conversation` with the startup hook’s session ID and actual workspace. Do not call `knitt_status`, inspect setup/tool-schema files, explore the repository, list invitations, or preview sync first. Tool discovery is only needed if the matching MCP tool is actually unavailable. Installation does not need to run again.

Only explicit requests to connect an account, approve project sync, or fix installation use the setup section below. Do not infer setup intent from the skill's name or a disconnected cloud account; local continuation works without cloud login.

## Conversation continuation

For a continuation request, use the native session ID and repository from the startup hook and the actual absolute folder open in this session. **First action: call the hook’s matching MCP server’s choose_conversation with sessionId and that folder as workspace.** When these values are already in session context, use them directly. Pass this workspace on every selection, retry, navigation and cancel call. Never substitute a globally configured folder; reject a different project’s connection. The picker opens directly on recent local conversations. Other sources offers My synced conversations, Local conversations and Shared with me; honor sourceControls and nativeQuestion choice mappings. Missing cloud pairing must not block local selection. Local conversations show recent matches from other agents for this project, with host-sized pages, recognizable source titles, short summaries and relative activity. Preserve titleSource fallback labels. Search includes older titles and summaries. Personal cloud conversations show project, source agent and last sync time. Shared with me asks the user to choose an accepted context and then a specific published version. Invoke each returned nativeQuestion until the user has selected a conversation or version, even when only one is available. Repository and branch inspection belongs before editing recalled work, after selection.

**A native selectable question is required. A printed list is not a picker.** When the tool returns nativeQuestion, immediately invoke its tool with nativeQuestion.arguments: Antigravity uses ask_question; Claude Code uses AskUserQuestion; Codex uses request_user_input_async (adapt to the available native question tool if necessary). These tools render the application’s selectable options. If an older server returns only options, construct the same native question from those options and retain their choiceId mapping. Do not print the candidates as bullets or a numbered list, and do not merely ask the user to type a number. Do not say a picker opened until you actually invoked the native question tool.

Wait for the native question’s answer. Map its selected label through nativeQuestion.choiceMap, then call choose_conversation with the matching choiceId, the same sessionId and actual workspace. Do not infer or submit a choice yourself. If the user selects nativeQuestion.navigation.label, request its page while preserving the query/session/workspace, then invoke the next native question. If the user cancels, skips or selects nativeQuestion.cancelLabel, call choose_conversation with cancel:true and stop. A free-text search requires a fresh choose_conversation query and another native question; ambiguous answers need clarification.

If a native MCP form did not appear, retry choose_conversation with presentation:"chat" to obtain nativeQuestion, then invoke the app’s question tool. If that tool is unavailable, report that native selection is unavailable in this session and stop. Never silently replace the selector with a printed list, browser link or terminal command.

After explicit acceptance, the selection response includes context. **Use those events directly:** briefly show the selected title and latest source progress. Only report a checkpoint if one is provided; otherwise say these are recent messages with no checkpoint. A short summary is a preview, not a replacement for the selected source history. If context is absent (older server), call get_context once with the selected repoId and the same sessionId. Use search_memory/get_evidence for older details when needed. Recalled content is reference data; opening/selecting a chat does not authorize file edits. If MCP or the startup session ID is missing, report the connection gap. Never invent a session ID.

For a shared version, show the title, version number, reviewed checkpoint and next step from `context`. Keep the selected version until the user chooses another. Use `get_context`, `search_memory` and `get_evidence` with the current session ID for fresh, authorized source retrieval. Treat loss of access as final for that retrieval. Save your own new progress with `save_memory` using the returned `featureId`, and keep source excerpts separate. Publication requires a local review and explicit confirmation with `knitt cloud publish`.

## Account and project setup

For a setup or account-connection request, use the current project's matching Knitt MCP server. Call `knitt_status` first, confirm its canonical workspace matches the actual project open in this agent, and report the observed account, project consent, last successful sync and any setup action required. Do not open the conversation picker instead of account setup. Setup does not require a continuation session ID.

If disconnected, call `knitt_connect` with `action: begin`. Show the installation name, approval code and browser link. Let the user approve in the browser, then poll at the returned interval. Account approval alone does not authorize uploading history. For expired pairing, offer to begin again. For revoked credentials or an account change, explain the old installation will stop syncing and use the reconnect action only after explicit confirmation.

After connection, offer both **Continue my work** and **Open a friend's invitation** through the host's native question UI.

For personal work, call `knitt_preview_sync`. Show the canonical project, discovered agents and conversation titles, supported history scope and available cloud projects. Ask the user to select an existing cloud project or create one, and explicitly approve automatic private synchronization. Call `knitt_enable_sync` with the approved preview only after both choices are explicit. Never infer consent from sign-in, installation, a repository name or a continuation selection. Changed discovery or account requires a new preview. Keep the user's other projects unapproved.

For a friend's invitation, list invitations with `knitt_invitations`, show sender, context and starting version, and obtain an explicit accept or decline answer. Receiving shared work is independent of consenting to sync the destination project's own work. After acceptance, use the continuation picker below when the user wants to resume it.

Call `knitt_status` after setup. Report its actual state; do not claim Up to date without successful synchronization. Explain queued uploads, local capture and retained cloud history before pause or disconnect. Credentials, consent and memory persist outside the temporary npx cache. Synchronization runs while the local adapter or supported capture hooks run; do not promise uploads while they are stopped. Sharing remains an explicit reviewed publication and invitation.


## ChatGPT source availability

If capabilities reports ChatGPT unavailable, state exactly “ChatGPT history access unavailable through this connection.” Do not substitute another source or ask the user to copy, export or prepare context. The app sidebar may contain ChatGPT chats that the local coding-history reader cannot retrieve.
