# Knitt installation through Plugin Management

The intended end-user flow is **Plugin Management → Knitt → Add → in-agent account connection → project consent**. GitHub release ZIPs and custom marketplace folders do not create a public directory listing.

## Current state

A developer-only submission candidate exists under `plugin-artifacts/openai-submission/0.1.0-beta.6-directory.2/`. It bundles the existing Linux x64 adapter and runtime, declares a local stdio MCP server and desktop-only execution, and removes lifecycle-hook declarations and hook-installation instructions. Its onboarding and continuation tools launch with the agent-supplied project root. This package uses periodic synchronization while its local adapter runs; it does not promise uploads while stopped. The listing subtitle fits the directory's 30-character limit.

This is a publisher upload artifact, not a new end-user ZIP installation flow. It has not been submitted, approved or listed. The published manual developer preview remains separate.

## External eligibility and submission requirements

Official OpenAI documentation, checked 2026-11-20:

- Local MCP submissions require an allowlisted submitting organization: https://developers.openai.com/plugins/deploy/desktop-only
- Lifecycle-hook packages cannot be submitted to the public directory: https://developers.openai.com/plugins/deploy/submission
- A verified publishing identity, submission permissions and OpenAI review are required.

The submission portal at https://platform.openai.com/plugins redirected to sign-in, so organization eligibility has not been inspected. Do not infer approval from a ChatGPT subscription or from successful local installation.

Before submission, the publisher must confirm organization allowlisting with OpenAI and test a clean desktop installation and its main workflows. Confirm whether the directory can distribute this package exclusively to Linux x64. The public error reference lists the exact five positive and three negative cases and demo recording under remote MCP requirements. Use the signed-in portal to confirm which reviewer materials it asks for on the approved local MCP path. If a reviewer account is needed, provide a dedicated test account.

## Local validation

- Type checking passes.
- Six focused packaging and bootstrap tests pass.
- The ZIP integrity test and SHA-256 verification pass.
- The full suite did not pass in the current environment.
- The submission candidate launches from its actual local MCP manifest, resolves the supplied project root, exposes account setup, consent and continuation tools, and declares no lifecycle hooks.
- This is not an OpenAI review result or proof of organization eligibility.

## Next publisher action

Sign in at https://platform.openai.com/plugins and confirm the submitting organization's local MCP approval. If not allowlisted, request that approval through the organization's OpenAI representative. The package can then be uploaded by the publisher and submitted for review after the remaining review requirements are complete. Only after publication may the website offer an actual directory Add link.
