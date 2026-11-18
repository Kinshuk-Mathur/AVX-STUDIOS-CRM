# Firestore implementation

- Firestore stores owner/viewer accounts, session hashes, approvals, business records and audit history.
- A deferred-write repository enforces owner mutations and section access, then commits native Firestore transactions. Reads finish before writes reach Firestore.
- Financial identifiers, transaction references, recovery tokens and idempotency keys use dedicated guard records to prevent duplicates under concurrent requests.
- Owner recovery uses one active hashed token and a global session epoch. Account changes use per-account session versions.
- Receipt and invoice snapshots stay with the record; PDF/upload content lives in private object storage. Financial totals use integer paise.
- Financial summaries are transactionally maintained daily aggregates. The existing UI list cap remains 1,000; cursor pagination is future work for larger workspaces.
- Server-sent events subscribe to Firestore session/account/access changes and pending requests, avoiding periodic full scans.
- Browser Firestore access is denied. The app exposes only its authenticated API; no Firebase service-account key enters client bundles.
- The legacy setup import is atomic and designed for the actual source containing one owner and no business records. Populated legacy databases are explicitly rejected by that command.
