# Knitt Cloud context sharing contract

Approved for the first coding-agent release on 19 November 2026. This contract defines the behavior to implement and test in the cloud service.

## What leaves the owner's machine

A context is a conversation or task owned by one account. The owner selects a coding-agent context and prepares a checkpoint recording its goal, decisions, progress, verification results, unresolved issues and next steps. They choose which supporting messages to include. In the preview, they can edit the checkpoint and remove excerpts. The preview shows the exact checkpoint, excerpt text and source metadata a recipient can retrieve.

Each handoff identifies its source agent. The owner can include a repository, branch and commit. Local filesystem paths are omitted from source metadata by default. Repository and local conversation identifiers describe the source. Repository access is governed separately by the repository provider.

Explicit publication creates one immutable version containing the reviewed material. A correction or update requires another preview and publication. Capturing additional local progress never publishes it. The service commits the checkpoint and excerpts together. A failed attempt exposes no partial version, and a retry of the same publication yields one version.

## Who can open a version

Only the owner manages invitations to their context. Each invitation names one account or email address, the context and a starting published version. A pending recipient can inspect the invitation and accept or decline it. Acceptance requires the named account or an account with the invited email address verified. A contact relationship alone confers no access.

Acceptance creates a grant starting at the invited version. For example, a recipient invited at v2 can read v2 and subsequent publications under the active share. Earlier versions remain private to anyone without separate authorization. A recipient explicitly selects a version to load. Publishing v3 makes it available while an agent working from v2 stays on v2 until its user switches.

The owner can withdraw a pending invitation or revoke an active share. The recipient can decline a pending invitation or leave an active share. Retrying acceptance yields at most one grant. An old acceptance request cannot reopen a declined, withdrawn, left or revoked share. Restoring access requires a fresh invitation and acceptance.

Cloud contexts, published versions, invitations, grants and continuation links each have stable identifiers. Every cloud listing, version read, search and direct evidence lookup checks the requesting account's ownership or active grant, including the grant's starting version. Search results and evidence are limited to material in authorized publications. Possessing an identifier, using the same repository or reopening a previously authorized session grants no access.

At sharing and revocation, show this notice: “Revoking access stops future retrieval through Knitt. Content already loaded may remain in the recipient’s chat or local storage.”

## Continuing and sharing back

Loading a version starts or resumes work in the recipient's own session. The recipient owns their new progress. A continuation records the exact source version for provenance. Reading the continuation or following that link requires separate authorization for any source content retrieved.

The recipient can preview and publish their own checkpoint and invite the original sender or another person to it. The preview identifies any included source material. Reading an excerpt gives no authority to redistribute it. Knitt requires the original owner's permission before including that excerpt in an onward share. A continuation can be published with only the recipient's new work.

## Acceptance scenarios for cloud implementation

| Scenario | Required outcome |
| --- | --- |
| Aditya edits the checkpoint, removes one message, publishes v2 and invites Ramanand. | After acceptance, Ramanand loads the edited checkpoint, selected excerpts and previewed source metadata. The removed message and subsequent unpublished local progress are absent from reads, evidence and search. |
| A contact guesses a context, version or evidence ID. An account with an unverified address attempts to claim an email invitation. | Neither obtains the content. Only the named account or the account that verifies the invited address can accept. |
| Aditya publishes v3 while Ramanand is working from v2. | Ramanand can inspect and load v3. His current selection stays at v2 until he chooses v3. His v2 grant excludes v1. |
| Aditya revokes access while Ramanand's session is open. | Subsequent lists, reads, searches and evidence lookups through the share exclude its content. Already retrieved copies can persist. Replaying acceptance cannot restore access. |
| Ramanand shares his continuation back, then invites a third person to his own work. | The continuation identifies v2 as its source. Only Ramanand's reviewed publication is shared. The third person gains no access to Aditya's context, and onward inclusion of an original excerpt requires Aditya's permission. |
| Publication or acceptance is interrupted, retried or submitted concurrently. | Readers see either a complete publication or no publication. Repeating the same operation creates at most one version or grant. A completed revocation prevents subsequent retrieval even after an acceptance retry. |

The next milestone implements accounts and cloud access enforcement against these scenarios.
