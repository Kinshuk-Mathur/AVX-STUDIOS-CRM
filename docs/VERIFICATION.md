# Verification — 17 November 2026

Final project: `/Users/kinshukmathur/developer/avx crm`

## Passed

- TypeScript strict check: passed.
- ESLint: passed, no errors or warnings.
- Automated integration and arithmetic checks: **22 passed, 0 failed**.
- Production build: passed with Next.js 16.4.6, React 19.3.1 and TypeScript 6.0.3.
- Dependency audit at install: 0 known vulnerabilities reported.
- Clean installation lockfile check: `npm ci --dry-run` passed.
- Local `/login` HTTP response: 200.
- HTTP workflow smoke test against an isolated test database: owner login; client/project/invoice creation; ₹8,000 payment; stored PDF download; owner SSE access-request event; viewer pending authorization, approval, allowed project read, forbidden financial read and writes, revocation; CSV export; logout.

The automated suite covers all 13 requested financial/authorization scenarios, plus exact rounding, idempotency/concurrent retries, overpayment rejection, single-owner enforcement, immutable financial history, account expiry, quote conversion, issuing draft PDFs and CSRF rejection. The final privacy checks also verify that financial documents cannot expose hidden client data through raw viewer-role database queries or PDF APIs.

A refund date comparison failed in the first test pass because the local PostgreSQL engine returned a Date object. The query now explicitly returns an ISO date string. A draft document's PDF status is now regenerated transactionally when issued. Both cases passed the final suite.

## Not verified externally

- Native browser automation timed out. No completed visual or browser click-through verification is claimed. The responsive UI is implemented, type-checked and built; its login route was served successfully.
- No production PostgreSQL provider, public deployment, real email delivery, multi-host proxy configuration or backup restoration was tested. These require the owner's deployment configuration.
- No independent security audit or load test was performed.

## Test data

Automated tests use isolated in-memory PostgreSQL. HTTP smoke tests used a separate temporary PGlite directory and generated credentials. The temporary browser test data and credentials were removed. No real business records or permanent owner credentials were created.

See README.md for implemented features and known limits, and docs/DEPLOYMENT.md for database roles, environment, initialization, deployment and backup instructions.

## Owner recovery update

Owner setup/recovery now uses a trusted CLI-generated, single-use 30-minute link and a browser credential form. The complete suite passes **28 tests**, including initial owner creation, token hashing, expired/reused/invalid links, competing redemptions, preserved owner ID and business records, session revocation, CSRF, and absence of a public link issuer. TypeScript, ESLint and production build also pass. A local database backup was taken before activating recovery; no new password has been selected for the user.
