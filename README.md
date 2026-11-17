# AVX OS

AVX Studios’ private agency management workspace. One owner manages business records; viewers require approval for every login and have temporary, section-scoped, read-only access.

## Start locally

Requires Node.js 22.9+ and npm. The repository includes a lockfile with exact dependency versions.

```sh
cd "/Users/kinshukmathur/developer/avx crm"
npm ci
cp .env.example .env.local
npm run db:migrate
npm run owner:create
npm run dev
```

Open **http://localhost:3000/login**. The owner command prompts for a username, display name and a hidden password (12–128 characters). There are no default credentials, public registration, sample clients or fabricated financial records. A database constraint permits exactly one owner.

For viewer access on another device, use a deployed HTTPS instance. The development server binds to loopback by default. A local single-process PostgreSQL engine, PGlite, persists records in `.data/avx`; do not run two processes against the same directory. Stop the web server before running database maintenance or the owner CLI. **PGlite is for local development; production requires PostgreSQL.**

## Create or recover owner credentials in your browser

Stop the local app first (Control+C in its terminal), then run:

```sh
npm run owner:setup
npm run dev
```

Open the private link printed by the setup command. Choose your owner name, username and new password, confirm it, and click **Save owner credentials**. Then use **Owner sign in** at `/login`. The Viewer sign in page is for read-only guest accounts.

The link expires after 30 minutes, works once, and is generated only from the trusted project terminal. Generating another link invalidates older links. It creates the single owner if needed or updates the existing owner's credentials while retaining the owner ID and business records. Completing recovery revokes all previous sessions. The database stores only the token hash; the URL fragment is removed from browser history when the form opens. Keep the link private. If you reload the form, reopen the original private link.

`npm run owner:reset` is an alias for the same secure setup-link command. There is no public registration or public reset-link issuer. For managed PostgreSQL, run database migrations with the admin credential before using recovery.

## Implemented workflows

- Owner login, scrypt-hashed passwords, hashed opaque session tokens, HttpOnly SameSite cookies, CSRF origin checks, persistent login throttling, owner password changes, access audits.
- Clients with contact/business profiles, project histories, payment and invoice views, notes, tags, private files, search, sorting and archive status.
- Projects with multiple service line items, table and drag-and-drop Kanban views, statuses, task-based progress, deliverable links/versions, private attachments, financial summaries and timelines.
- Personal tasks with due dates, priority, project linkage, Today/Upcoming/Overdue/Completed filters.
- Confirmed payments, optional invoice linkage, partial/final/advance payments, transaction references, proof uploads and service attribution. Refunds are separate immutable records.
- Automatically generated and stored A4 receipt PDFs, unique sequential numbering, immutable business/client snapshots, protected view/download endpoints, optional Resend delivery.
- Invoices and quotations with service items, integer quantities, discounts and optional configured GST; derived balances and payment statuses; quote acceptance and atomic conversion to a project and invoice. Issued financial documents are corrected by voiding/reissuing where allowed rather than silently changing history.
- Expenses with project linkage, categories, recurrence reminders, attachments and audited reversals.
- Real database dashboard metrics, revenue/service breakdown, date-filtered trend, clients/projects/deadlines/activity, payment methods, expenses and operating-profit analytics.
- Custom-username viewer accounts, independent visible sections, expiry, initial/password reset, disable/delete, per-session approval/rejection, persistent request queue, login history and immediate revocation.
- Authenticated server-sent events reconcile approvals, rejections and revocations every two seconds. Business views reconcile every ten seconds. Optional sound and permission-based desktop notifications work while the app is open.
- Cmd/Ctrl+K scoped search, owner Quick Add, owner CSV exports, responsive sidebar/drawer, accessible Radix dialogs, reduced-motion support, empty/error states and AVX theme tokens.

## Architecture

```text
src/app/                    Next.js App Router, security headers, API routes
src/components/             Shell, dashboard, forms, tables, modules and dialogs
src/lib/                    Shared types, formatting and exact-money arithmetic
src/server/db/              PostgreSQL adapter, migrations, constraints and RLS
src/server/security.ts      Passwords, tokens, approval-aware authorization
src/server/services/        Catalog, finance, queries, viewers, PDFs and files
scripts/                    Database migration and secure owner bootstrap
 tests/                     Database-backed financial and security integration tests
```

Business writes run only after owner authorization. Viewer queries use a separate **SELECT-only PostgreSQL role** plus section-level Row Level Security. The runtime validates every session against the database; role values never come from client input. Authenticated API responses are not cached. Reads revalidate authorization before releasing data. Data already received by a viewer cannot be recalled or protected against screenshots.

Financial amounts are stored as **BIGINT paise** and calculated with `bigint`. Payments, allocations and receipts commit in one transaction. Project/invoice row locks prevent racing overpayments; idempotency keys and unique external references prevent duplicates. Largest-remainder allocation guarantees service shares equal the payment exactly. Refund allocations reduce the original services without drifting. The dashboard is derived from authoritative transactions.

Financial totals and profit are INR-only and cash-basis. Full dashboard/analytics financial summaries require Clients, Projects, Payments, Invoices, Expenses and Analytics permissions together; invoices and PDFs require Clients, Projects, Invoices and Payments. Client/project labels require their own section permissions. Unstructured uploaded attachments and internal notes are owner-only because their contents cannot be reliably filtered.

## Database and environment

Copy `.env.example`. No real secrets are committed.

| Variable             | Purpose                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `DATABASE_URL`       | Production runtime PostgreSQL connection, TLS enabled, restricted login role                   |
| `DATABASE_ADMIN_URL` | Migration/bootstrap only; never provide to the web runtime                                     |
| `PGLITE_DATA_DIR`    | Development data directory; default `.data/avx`                                                |
| `APP_ORIGIN`         | Exact canonical origin, e.g. `https://os.example.com`; required for production CSRF protection |
| `RESEND_API_KEY`     | Optional server-only Resend key                                                                |
| `EMAIL_FROM`         | Verified sender, e.g. `AVX Studios <receipts@example.com>`                                     |
| `OWNER_COPY_EMAIL`   | Optional agency copy recipient                                                                 |
| `TRUST_PROXY`        | Set true only behind a trusted proxy that replaces the client-IP header                        |

The schema is versioned in `src/server/db/schema.sql`. Migration requires permission to create the `avx_app` and `avx_readonly` roles. Managed Supabase PostgreSQL can be used as a direct database connection; no public client keys or Supabase Auth fake-email mappings are used.

See [deployment guide](docs/DEPLOYMENT.md) for role setup, runtime configuration and backups.

## Viewer flow

1. Owner creates a viewer and chooses sections in Viewer Access.
2. Viewer opens `/viewer-login` with the custom username and password.
3. Correct credentials create a unique **pending** session, never direct dashboard access.
4. The owner receives a live notification and explicitly approves or rejects that session.
5. Approval unlocks only the selected sections. New devices and subsequent logins need new approval.
6. Expiry, inactivity, account changes, logout or owner revocation invalidate access on the server.

Changing a viewer password, expiry, status or permissions revokes all existing viewer sessions. Browser notifications require permission and an open connected application; offline/background Web Push is not implemented. Settings policies apply to new sessions.

## Email

Configure a verified Resend sender with the environment variables above. Use **Send to client** or **Email copy to me** on a receipt. The PDF is attached; client sends include the configured owner copy. If email is unconfigured, the app gives a setup message and keeps download available. Status is truthfully recorded as queued, provider-accepted or failed; provider acceptance is **not** claimed as inbox delivery. Delivery/bounce webhooks are not yet implemented. Confirm ambiguous provider failures in the provider dashboard before retrying.

## Validation

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

The integration suite uses an isolated real PostgreSQL engine in memory; it never touches your business database. It tests the 13 requested financial/access scenarios plus idempotent retries, overpayment protection, single-owner enforcement, immutable history, quote conversion, CSRF and exact allocation. Test results are recorded in `docs/VERIFICATION.md` after validation completes.

## Current boundaries

- Local PGlite runs in one process. Production uses managed PostgreSQL; no SQLite or localStorage business-data fallback.
- Record lists and CSV exports currently cap at 1,000 rows; activity/session histories cap at 100. Add server pagination/streaming exports before larger datasets. Search currently scans authorized capped lists.
- Attachments (PDF/JPEG/PNG/WebP) are limited to 5 MB, validated by file signature and stored privately in PostgreSQL. Object storage, malware scanning, larger uploads and retention policies are next-scale improvements.
- Recurring expenses are reminders; each actual payment must be recorded explicitly. No unreceived or scheduled income is counted as revenue.
- Basic receipt layout and AVX wordmark are built in. Custom logo upload, a visual receipt template editor, full-text search and invoice editing are not included in this version. Use void/reissue for financial corrections.
- This is a substantial working implementation, not a claim of independently audited production security. Before handling live financial data, configure managed backups, verify PostgreSQL deployment, email delivery, restore procedures and your chosen hosting environment.
- No external emails were sent, no production data was imported, and no production deployment was performed during development.

Brand styling was derived from the public AVX Studios stylesheet: black surfaces, Inter, thin borders and `#ff002c` red. Noto Sans is included under its open font license for Unicode PDF rendering; the font license is in `public/FONT-LICENSE.txt`.
