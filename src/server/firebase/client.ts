import 'server-only';
import { cert, getApps, initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { firebaseServerConfig, FirebaseConfigurationError } from './config';
export async function firebaseDatabase() {
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  if (emulator) {
    if (
      process.env.NODE_ENV === 'production' ||
      !/^127\.0\.0\.1:\d+$/.test(emulator) ||
      !process.env.FIREBASE_PROJECT_ID?.startsWith('demo-')
    )
      throw new FirebaseConfigurationError(
        'The emulator requires a demo- project and a loopback address outside production.',
      );
    const projectId = process.env.FIREBASE_PROJECT_ID,
      appName = 'avx-emulator-' + projectId;
    const app = getApps().find((a) => a.name === appName) || initializeApp({ projectId }, appName);
    return getFirestore(app);
  }
  const cached = getApps().find(
    (a) => a.name === 'avx-firestore-' + process.env.FIREBASE_PROJECT_ID?.trim(),
  );
  if (cached) return getFirestore(cached);
  const config = await firebaseServerConfig(),
    appName = 'avx-firestore-' + config.projectId;
  const app =
    getApps().find((a) => a.name === appName) ||
    initializeApp(
      { projectId: config.projectId, credential: cert(config.serviceAccount) },
      appName,
    );
  return getFirestore(app);
}
export async function closeFirebase() {
  for (const app of getApps().filter((a) => a.name.startsWith('avx-'))) {
    await getFirestore(app).terminate();
    await deleteApp(app);
  }
}
