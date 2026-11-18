# AVX OS

Private agency workspace for AVX Studios: clients, projects, tasks, invoices, quotations, payments, receipts, expenses, analytics, and owner-approved viewers.

The application uses Next.js, TypeScript, **Cloud Firestore** for records and authentication state, and **private Netlify Blobs** for PDFs and attachments in production. Local development stores private files in `.data/files`.

## Run locally

Use Node.js 22.9+.

```sh
npm ci
cp .env.example .env.local
# Configure Firebase credentials in .env.local.
npm run firebase:check
npm run db:migrate
npm run owner:setup
npm run dev
```

Open the private setup link printed by the trusted terminal, choose your owner credentials, then sign in at http://localhost:3000/login. An existing initialized workspace is preserved by `db:migrate`. Do not run initialization before importing an existing setup into an empty target.

The account in the local legacy database is being preserved by the Firestore migration. `owner:setup` also provides credential recovery; it does not create another owner.

## Netlify environment variables

Set these for the **Production** context and **Functions** scope:

| Variable                        | Value                                                                 |
| ------------------------------- | --------------------------------------------------------------------- |
| `FIREBASE_PROJECT_ID`           | `avx-crm-509a3`                                                       |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Complete contents of the private service-account JSON; mark as secret |
| `APP_ORIGIN`                    | `https://avxstudioscrm.netlify.app`                                   |

If your plan does not offer scope selection, use all scopes and still mark the credential secret. Redeploy after changing variables. No Firebase client SDK key or `NEXT_PUBLIC_` credential is required. Do not set the Mac-only `GOOGLE_APPLICATION_CREDENTIALS` path on Netlify. PostgreSQL `DATABASE_URL` is no longer used by the app.

Build command: `npm run build`. Netlify's Next.js adapter provisions the server functions. PDFs and uploads use a private site-wide Netlify Blobs store, with every download authorized by the app.

See [deployment](docs/DEPLOYMENT.md) and [Firebase configuration](docs/FIREBASE.md).

## Owner and viewers

- Owner sign-in: `/login`. Member requests appear in **Viewer Access** and the live access-request notifications.
- Create viewer accounts and select their allowed sections in Viewer Access.
- Each viewer device must be approved separately. Correct credentials alone do not authorize access.
- Owners can reject/revoke sessions, disable accounts, and change permissions. Authorization is revalidated before API reads return.
- Change your password in Settings. If locked out, run `npm run owner:reset` from the trusted project terminal. For a deployed link, set `APP_ORIGIN` to the deployed origin for that command.
- Recovery links expire after 30 minutes, work once, preserve the owner ID and records, and invalidate existing sessions. Only token hashes are stored.
- No public owner registration or recovery-link issuer exists.

## Accounting and files

Amounts use integer paise and INR. Payments/refunds have transactional idempotency keys, immutable financial records, and exact service allocations. Financial summaries are updated in the same Firestore transaction as the financial event. Receipt PDFs preserve their historical snapshots. Draft invoice PDFs are regenerated on issue.

Files are signature-validated PDF/JPEG/PNG/WebP, up to 5 MB. File contents are stored outside Firestore's document-size limit. Downloads require authorization. Retried operations may leave unreachable content-addressed blobs; do not delete blobs referenced by any receipt, invoice, or attachment.

Resend is optional: configure `RESEND_API_KEY`, `EMAIL_FROM`, and optionally `OWNER_COPY_EMAIL` to send receipts. Provider acceptance does not prove inbox delivery.

## Development checks

Install Java 21+ for the official Firestore emulator.

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

Tests use `demo-avx-tests`, a loopback emulator, isolated workspace IDs, and temporary file storage. They never use the production Firebase project. Run `npm test`, not `test:unit` directly without an emulator.

## Structure

- `src/server/firebase/`: server credential validation, transactional repository, models, metrics, private files.
- `src/server/services/`: catalog, financial workflows, access control, queries, PDFs.
- `src/server/security.ts`: authentication, session versions, throttling.
- `src/app/api/`: authorized API routes and Firestore-driven session events.
- `src/server/db/`: legacy PostgreSQL source retained only for the setup importer.
- `scripts/`: trusted owner setup, connectivity, initialization, legacy setup import.

## Existing local setup migration

Stop the old app and back up its complete `.data/avx` directory. `npm run db:import-legacy-setup` performs a dry run; add `-- --apply` to import an empty business workspace's accounts, settings, service categories, counters, and audit history into an uninitialized Firestore namespace. The import is atomic and refuses to overwrite an initialized target. Re-running the same import is safe.

This specific importer rejects any source with business records. It is intended for this project's existing setup, which has one owner and no business records. A populated legacy database needs a separately verified data conversion including files and financial reconciliation.

## Operating limits

The current UI retains the existing 1,000-record list cap. It is designed for a private agency workspace; large record sets need cursor pagination and search indexing. Daily financial rollups avoid scanning every payment for totals. Firestore listeners update access status without continuous full-database polling.

Back up both Firestore and private file storage. Confirm available export/backup options for your Firebase plan and test restoration. Automated cloud backups and real email delivery are not configured by this migration. Use separate credentials/workspaces for deploy previews; never expose production secrets to untrusted preview builds.
