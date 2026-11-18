# Firestore migration verification — 18 November 2026

Verified in /Users/kinshukmathur/Developer/avx crm.

## Automated checks

- ESLint: passed.
- TypeScript: passed.
- Next.js production build: passed.
- Official Firestore emulator integration suite: **21 tests passed, 0 failed**.
- npm audit --omit=dev: **0 known production vulnerabilities** at verification time. Development tooling has separate audit findings; this is not a claim that every development dependency is vulnerability-free.
- Git diff whitespace check: passed.
- Deployment tracing: five manifests checked; private credential JSON, local environment files, business-data directories and source backups excluded. PDF font included in API bundle.

Tests cover exact paise arithmetic; linked catalog records; invoice balances; payment/refund idempotency under concurrent retries; overpayment rejection; immutable receipt PDFs; historical snapshots; quotation conversion; draft issue; owner recovery and global session invalidation; atomic setup import; viewer approval per device; live Firestore-driven approval events; repository/API permissions; revocation/expiry; financial redaction; private 2 MB attachment round-trip; CSRF; denied unauthenticated Firestore access.

The emulator used demo-avx-tests on loopback, isolated workspace IDs and temporary files. Test workspaces were deleted. No test owner/client/payment records were written to the live project.

## Live Firebase verification

- Server read access to avx-crm-509a3 / (default) verified.
- Firestore field-index exclusions deployed successfully.
- Legacy local database backed up before import.
- Source contained one owner, zero viewers and zero business records.
- Existing owner, settings, service categories and audit history imported atomically into avx_workspaces/primary.
- Target verified against source: identical owner ID, username and password hash; exactly one owner.
- Local HTTP smoke checks against the real Firebase backend: /login 200; /api/auth/state 200; protected /api/clients without a session 401; nonexistent credentials 401 with a normal authentication error.

## Remaining deployment steps / limits

The updated code and Netlify environment variables have **not** been deployed to the live Netlify site. Local validation does not establish that the existing live deployment has been fixed.

Add FIREBASE_PROJECT_ID, secret FIREBASE_SERVICE_ACCOUNT_JSON and APP_ORIGIN, then deploy the updated repository code. Production Netlify Blobs access and an actual owner browser login on the deployed site still need verification. Real receipt email, cloud backup scheduling/restoration, malware scanning and large-volume performance were not tested or configured.

The default local system has no Java installation. Emulator checks were run using a freshly downloaded, SHA-256 verified official Eclipse Temurin Java 21 runtime in a task-local directory. Install Java 21+ or set JAVA_HOME before future npm test runs.

The existing UI retains a 1,000-record list cap. The legacy setup importer deliberately refuses sources containing business records and targets that are already initialized.
