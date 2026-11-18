# Firebase configuration

Project: `avx-crm-509a3`; Firestore database: `(default)`; region: `asia-south1`.

The application uses the Firebase Admin SDK only on the server. Owner and viewer usernames, password hashes, approvals, sessions, business records and financial aggregates are stored under `avx_workspaces/primary`. Firebase Authentication providers are not used.

Keep Firestore browser rules deny-all, as supplied in `firestore.rules`. Server authorization is enforced in the repository and services; Admin SDK calls bypass browser rules by design.

Local credentials are referenced from ignored `.env.local` through `GOOGLE_APPLICATION_CREDENTIALS`. The supplied `avx-crm.json` is excluded from Git and has restricted filesystem permissions. Never paste this JSON into chat, browser application code, or a public repository.

On Netlify set the private JSON as the secret `FIREBASE_SERVICE_ACCOUNT_JSON`, plus `FIREBASE_PROJECT_ID` and `APP_ORIGIN`. See [deployment instructions](DEPLOYMENT.md).

`npm run firebase:check` performs only a read of a diagnostic document and verifies connectivity without creating records. `npm run db:migrate` initializes a new empty workspace. `npm run owner:setup` prints a private one-use setup/recovery link.

Financial documents contain only metadata and content-addressed file keys. Netlify Blobs stores private file contents on the deployed site; local development uses `.data/files`. Local private files are not automatically uploaded to Netlify. The migrated local setup has no existing documents or attachments.

`firestore.indexes.json` excludes large snapshots and embedded arrays from indexing. Deploy rules/index configuration using the Firebase CLI with administrative permission:

```sh
firebase deploy --only firestore --project avx-crm-509a3
```

No composite indexes are required by the current equality and single-field date-range queries.
