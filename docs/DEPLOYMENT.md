# Production deployment

## PostgreSQL

Use PostgreSQL 15+ with TLS, automated backups, point-in-time recovery and a tested restore process. Supabase's direct/session database endpoint or another managed PostgreSQL provider is suitable. Avoid disabling TLS certificate verification.

Run the migration with a trusted admin connection from a maintenance environment:

```sh
DATABASE_ADMIN_URL='postgresql://ADMIN:SECRET@HOST:5432/DB?sslmode=verify-full' npm run db:migrate
```

Create a dedicated login role through your provider/secret manager. Supply a strong generated password privately, not in source control or shell history. Grant it membership in both application roles:

```sql
-- avx_runtime must be created with LOGIN and a secret managed outside this file.
ALTER ROLE avx_runtime NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT avx_app, avx_readonly TO avx_runtime;
```

The server explicitly selects `avx_app` for authentication/owner operations and `avx_readonly` for viewer business reads inside each transaction. Viewer roles have no write privileges, and business SELECTs are further restricted by section RLS. Runtime credentials stay server-side; never expose the database directly to a browser. The server is the only authority that sets role/section transaction claims.

The `avx_app` role must not own tables and must not have BYPASSRLS. `SET LOCAL ROLE` drops migration-owner privileges for application transactions. Administrative connections must not be used as browser-accessible APIs. Keep `DATABASE_ADMIN_URL` out of the web runtime.

Initialize the single owner with the admin connection in a trusted terminal, then discard that environment's secret:

```sh
DATABASE_ADMIN_URL='postgresql://...' npm run owner:create
```

Set runtime `DATABASE_URL` to the restricted login, `APP_ORIGIN` to your HTTPS origin, and the optional Resend configuration. Review agency settings, tax details and document prefixes before issuing live documents. GST is optional and is never invented.

## Host

Use a Node.js 22.9+ host or container with persistent PostgreSQL connectivity. The app is a Node server, not a static export. Long-lived server-sent event requests are used for viewer approvals. A container host is recommended so event connections can remain open for up to 55 seconds, reconnect, and scale across instances without in-memory authorization state.

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm start
```

Ensure the deployment includes `public/NotoSans-Regular.ttf` and `src/server/db/schema.sql`. The standard repository-based deployment includes both. Do not run PGlite on a serverless filesystem or run multiple processes against its local directory.

At your reverse proxy: terminate HTTPS, disable buffering/caching for `/api/events`, set appropriate request timeouts and a maximum body size around 7 MB, replace forwarded client-IP headers, and set `TRUST_PROXY=true` only when those headers are trusted. Add network-layer login throttling and operational monitoring. Verify secure cookies over HTTPS. The development binding is loopback; production binds to all interfaces behind the proxy.

## Email and notifications

Verify the Resend sender domain, configure `RESEND_API_KEY`, `EMAIL_FROM` and optionally `OWNER_COPY_EMAIL`, and test with your own recipient. The app records provider acceptance; integrate signed provider webhooks if inbox-delivered/bounced events are required.

Owner desktop notifications require browser permission and an open connected app. No offline Web Push subscription or service worker is configured. The persistent approval queue remains available from any owner session.

## Backup and recovery

Use provider snapshots/PITR and periodically verify a full restore into an isolated environment. Include application roles/grants and the full schema; receipts and uploaded attachments live in the database. Encrypted exports contain private information and must have restricted access.

For local development, stop all app processes before copying the entire `.data/avx` directory. A PGlite directory is not a PostgreSQL server data directory; migrate to managed PostgreSQL via a logical dump/import workflow and verify totals/allocations before switching. Do not copy its files directly into a PostgreSQL server.

## Release verification

Validate owner login and password rotation, viewer pending/approve/reject/revoke on two devices, section isolation, an invoice with partial and final payments, PDF download, refund reconciliation, actual email receipt delivery, backup restoration and multi-instance SSE reconciliation in the target environment. Local integration tests do not replace this deployment verification.
