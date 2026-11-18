import { firebaseDatabase } from '../src/server/firebase/client';
import { FirebaseConfigurationError } from '../src/server/firebase/config';

async function main() {
  const db = await firebaseDatabase();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    // A read of a nonexistent document still verifies authentication and database access.
    // No customer records are read, and no documents are written.
    await Promise.race([
      db.doc('_avx_diagnostics/connection').get(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Connection timeout')), 15000);
      }),
    ]);
    console.log(
      'Firestore read access verified for ' +
        process.env.FIREBASE_PROJECT_ID?.trim() +
        ' / (default).',
    );
    console.log(
      'CRM authentication and data services use Firestore. This check does not write any records.',
    );
  } finally {
    clearTimeout(timeout);
    await db.terminate();
  }
}
main().catch((error: unknown) => {
  console.error(
    error instanceof FirebaseConfigurationError
      ? error.message
      : 'Firestore connection failed. Check the service account permissions, enabled database, and network access.',
  );
  process.exitCode = 1;
});
