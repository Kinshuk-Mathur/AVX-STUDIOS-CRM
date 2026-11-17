# Implementation plan

1. Foundation: Next.js App Router, TypeScript, dark design tokens, PostgreSQL migrations, persistent local PGlite, secure CLI owner bootstrap.
2. Core: clients, project line items, task progress, deliverable records and protected attachments.
3. Finance: integer paise, atomic/idempotent payment and refund transactions, deterministic service allocation, immutable receipt snapshots and PDFs, invoices, quotations, expenses and derived analytics.
4. Access: scrypt credentials, hashed session tokens, database-backed rate limits, per-login approval, scoped server reads, live SSE reconciliation, revocation and audit trail.
5. Experience: responsive navigation, command search, owner actions, analytics, settings, optional Resend, CSV export.
6. Verification: financial and authorization integration tests against real PostgreSQL engine; lint/type/build and browser checks. External email and managed PostgreSQL require deployment credentials.

Scope decisions: single workspace and INR accounting (foreign currency mixing is rejected); PostgreSQL-compatible embedded storage is development-only; no public owner signup. Server-sent events reconcile database state every 2 seconds. Large attachments should move to object storage as volume grows.
