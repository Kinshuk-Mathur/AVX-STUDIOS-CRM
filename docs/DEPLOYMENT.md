# Netlify deployment

1. Connect the repository and build with `npm run build` using Node.js 22.9+.
2. In **Project configuration → Environment variables**, add the following for **Production**, scope **Functions**:
   - `FIREBASE_PROJECT_ID`: `avx-crm-509a3`
   - `FIREBASE_SERVICE_ACCOUNT_JSON`: the entire service-account JSON, marked secret.
   - `APP_ORIGIN`: `https://avxstudioscrm.netlify.app`
3. Do not deploy `GOOGLE_APPLICATION_CREDENTIALS` pointing to a Mac path. Remove obsolete `DATABASE_URL` if present. No `NEXT_PUBLIC_` variables are needed.
4. Deploy the Firestore migration commit, then test owner login, client creation, an invoice/PDF and viewer approval.
5. Netlify Blobs is automatically available to the Next.js server functions. The private `avx-private-files` store persists across deployments; the app authorizes downloads.
6. Optional receipt email uses `RESEND_API_KEY`, `EMAIL_FROM`, and `OWNER_COPY_EMAIL`.

If scope selection is unavailable, use all scopes. Do not share production secrets with untrusted deploy-preview contexts. Set a separate Firestore project/workspace for previews.

## Initial setup and recovery

The existing local owner account can be imported before initializing the empty target. The setup importer refuses populated business databases and refuses overwriting an initialized Firestore target. Back up the old local directory first.

For a genuinely new workspace: run `npm run db:migrate`, then `npm run owner:setup` from a trusted terminal configured for the production Firebase project. Use `APP_ORIGIN=https://avxstudioscrm.netlify.app npm run owner:setup` to print a production URL. The private link can reset the existing owner without deleting business data.

## Storage and operations

Firestore transactions atomically update payments, refunds, balances, daily rollups, and uniqueness guards. PDF/blob writes occur before the transaction commits. An unsuccessful/retried transaction can leave an unreferenced blob; its random-looking content hash is not a public URL, and the download API requires a committed metadata record and an authorized session.

Back up Firestore and the private Netlify Blobs store. CSV exports alone do not include PDFs, uploads, credentials or complete audit history. Confirm backup/export features supported by your Firebase plan before adopting a backup schedule. No billing-plan upgrade is performed here.

The official Firestore emulator requires Java 21+. Run `npm test` locally before deployment. Real-provider receipt email and cloud backup restoration require separate verification.

The legacy PostgreSQL adapter is only retained for reading the pre-migration setup. It is not imported by any web route or runtime data service.
