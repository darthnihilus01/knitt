# Knitt release security and privacy audit — 2026-11-13

## Result

No credential matches were detected by Gitleaks 8.30.1 in the audited Git history, tracked tree, npm archive or available GitHub logs/discussions. No raw conversation export, memory database, private key file or installed connection backup was identified in Git history. This is a scoped audit result, not proof that all sensitive material is absent.

Historical privacy metadata remains: early README versions contain developer-machine paths; historical progress notes name a connected project. Those are metadata findings, not detected credentials. Current progress notes have been generalized and the package smoke test now checks generic personal-directory patterns instead of embedding a developer username. These edits do not remove metadata from historical commits. No history rewrite or credential rotation was performed.

The owner was unsure whether any private material had ever been committed. The inspected handoff fixture is a synthetic order-retry scenario. Other conversation-format tests construct synthetic payloads. That evidence does not establish that every historical reference is nonconfidential; the owner should determine whether the historical metadata is acceptable for public retention.

## Audited scope

- Refreshed origin branches and tags, then scanned all local refs: 11 reachable commits at audit time, including the fetched default-branch merge.
- Current committed source snapshot: 58 tracked files.
- Built npm archive for `@tinchu0/knitt@0.1.0`, including LICENSE; no source-project identifiers or memory/configuration data found in its contents.
- One GitHub PR/issue and available review/comment endpoints; no issue comments were present.
- All 5 available workflow-run log archives, expanded and scanned locally.
- GitHub release inventory: 0 releases. Actions artifact inventory: 0 artifacts.
- GitHub reports the repository is already public. This audit changed no visibility settings.
- Wiki ref lookup returned no accessible refs and an error. Wiki content was therefore not audited; an empty or absent wiki is not asserted.

## Method and evidence

Downloaded Gitleaks from its official GitHub release and verified the archive against the release's SHA-256 checksums before execution. Used default rules, full redaction, and JSON reports kept under ignored `.memory/audit/`.

History invocation:

```text
gitleaks git . --log-opts=--all --redact=100 --report-format=json
```

Separate directory scans covered a `git archive HEAD` snapshot, the extracted npm tarball, and expanded GitHub surfaces. All four reports contain zero findings. Supplemental path/content inventory looked for local personal paths, source-project references, credential/data filenames and email addresses. Existing public account/repository attribution and synthetic example addresses were distinguished from private runtime data.

Current `.memory/`, SQLite files, generated npm archives and local connection settings are excluded from Git. The npm package uses an explicit file allowlist. Generated Claude settings are now also ignored at the product root. Audit evidence and downloaded workflow content remain private local files and are not included in this report or npm distribution.

## Limits and remaining release work

- The scanner does not verify credential validity and cannot identify every secret or determine business confidentiality.
- Scope is reachable repository refs and the GitHub surfaces accessible at audit time. Unreachable/deleted objects, caches, forks, developer machines, inaccessible wiki content and external systems are outside this audit.
- No claim is made that already-public historical metadata has been erased.
- Actual registry publication, account permissions, platform compatibility and live model handoffs remain separate release checks. No npm publication was performed.
