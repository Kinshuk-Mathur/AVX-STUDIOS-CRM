import { readFile } from 'node:fs/promises';
import { createPrivateKey } from 'node:crypto';

export class FirebaseConfigurationError extends Error {}

export interface FirebaseServerConfig {
  projectId: string;
  serviceAccount: { projectId: string; clientEmail: string; privateKey: string };
}

export async function firebaseServerConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<FirebaseServerConfig> {
  const projectId = env.FIREBASE_PROJECT_ID?.trim();
  if (!projectId || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId))
    throw new FirebaseConfigurationError('Set FIREBASE_PROJECT_ID to your Firebase project ID.');
  const inline = env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const filename = env.GOOGLE_APPLICATION_CREDENTIALS;
  if (inline && filename)
    throw new FirebaseConfigurationError(
      'Configure only one credential source: FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS.',
    );
  if (!inline && !filename)
    throw new FirebaseConfigurationError(
      'Firebase credentials are missing. Set GOOGLE_APPLICATION_CREDENTIALS to your private service-account JSON file, or configure FIREBASE_SERVICE_ACCOUNT_JSON on the server.',
    );
  let account: unknown;
  try {
    account = JSON.parse(inline || (await readFile(filename!, 'utf8')));
  } catch {
    // Never include the JSON, file contents, or parser error in logs.
    throw new FirebaseConfigurationError(
      'The Firebase service-account file could not be read or parsed.',
    );
  }
  if (!account || typeof account !== 'object' || Array.isArray(account))
    throw new FirebaseConfigurationError('A Firebase service-account JSON object is required.');
  const value = account as Record<string, unknown>;
  if (value.type !== 'service_account' || value.project_id !== projectId)
    throw new FirebaseConfigurationError('The service account must belong to FIREBASE_PROJECT_ID.');
  if (
    typeof value.client_email !== 'string' ||
    !value.client_email.endsWith('@' + projectId + '.iam.gserviceaccount.com') ||
    typeof value.private_key !== 'string'
  )
    throw new FirebaseConfigurationError(
      'The service account is missing its email or private key.',
    );
  try {
    const key = createPrivateKey(value.private_key);
    if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength || 0) < 2048)
      throw new Error('Unsupported signing key');
  } catch {
    throw new FirebaseConfigurationError('The Firebase service-account private key is invalid.');
  }
  return {
    projectId,
    serviceAccount: {
      projectId,
      clientEmail: value.client_email,
      privateKey: value.private_key,
    },
  };
}
