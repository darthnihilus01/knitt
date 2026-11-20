# Knitt npx cloud release

User-approved scope: keep npm/npx installation; stop ZIP and public-directory work. Deliver the existing cloud account, consent, autosync and continuation features through the package used by npx.

Policy: compact planning; dependency context; impact verification; no implementation delegation. Use the existing shared checkout because it contains the cloud implementation; preserve unrelated work.

## Work

1. Compare the published package and current runtime; verify npm access.
2. Prepare beta.6: keep account data in the selected installation home, exclude Cloudflare service code from npm, update onboarding/usage, and verify local plus cloud flows from an actual installed tarball.
3. Run focused, full and packaged checks; review release changes.
4. Publish the exact tested tarball to next, verify the registry-installed version, then advance latest. Record limits honestly; do not claim native OS/client or real multi-account checks that did not run.
5. Verify dashboard instructions and published npx command.

## Evidence and rulings

- npm latest and next both point to beta.5. Its published archive lacks cloud-cli.js, onboarding.js, local-sync.js and cloud-picker.js.
- npm maintainer login is available.
- The dashboard already uses the npx setup prompt; preserve that work.
- Ruling: use the existing /knit skill for setup and continuation rather than introducing a new managed skill path. This preserves compatibility with older installer ownership records during rollback.
- Ruling: stage beta.6 on next before moving latest, so the default npx route advances only after registry verification.

## Verification before publication

- Fixed custom-home propagation; its regression failed before the change and passes afterwards.
- Setup skill baseline incorrectly selected a conversation for setup. Updated skill check correctly starts with status and requires separate project selection and automatic-sync consent.
- Full source suite: 107 passed. Installed tarball lifecycle passed.
- Installed cloud smoke passed all three-account scenarios against the real Worker handler and disposable data.
- Scoped fresh review found no concrete release blocker; native UI/cross-platform limits remain explicit.

- Published beta.6 to npm next after browser 2FA. Registry bytes match the tested SHA256 1cc1443996305e679764d18c3452f58afa1026fbe45dc45f01bc692b0cd264ca. Clean external npx cache runs beta.6 and cloud help. Latest promotion is a separate npm-protected operation.

- Completed latest promotion after fresh browser authorization. Registry confirms latest and next are beta.6; external npx @latest runs beta.6 with cloud help.
- Deployed dashboard onboarding (Worker 5daa47ee-1acf-4e8e-bac2-270249d3f2e1). Production health 200; app.js and style.css match local assets and setup prompt explicitly uses @latest.
