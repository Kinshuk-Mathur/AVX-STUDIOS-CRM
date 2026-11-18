import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { firebaseServerConfig } from '../src/server/firebase/config';

const projectId = 'avx-crm-509a3';
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const account = {
  type: 'service_account',
  project_id: projectId,
  client_email: 'avx-runtime@' + projectId + '.iam.gserviceaccount.com',
  private_key: privateKey,
};
const base = { FIREBASE_PROJECT_ID: projectId };

test('Firebase requires credentials and rejects credentials for another project', async () => {
  await assert.rejects(firebaseServerConfig(base), /credentials are missing/);
  await assert.rejects(
    firebaseServerConfig({
      ...base,
      FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ ...account, project_id: 'another-project' }),
    }),
    /must belong/,
  );
  await assert.rejects(
    firebaseServerConfig({
      ...base,
      FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        ...account,
        client_email: 'runtime@another-project.iam.gserviceaccount.com',
      }),
    }),
    /missing its email/,
  );
});

test('Firebase validates signing keys without disclosing secret contents', async () => {
  const marker = 'DO-NOT-LOG-THIS-PRIVATE-VALUE';
  for (const value of [marker, JSON.stringify({ ...account, private_key: marker })]) {
    await assert.rejects(
      firebaseServerConfig({ ...base, FIREBASE_SERVICE_ACCOUNT_JSON: value }),
      (error: Error) => !error.message.includes(marker),
    );
  }
});

test('Firebase supports server JSON and private local files without environment mutation', async (t) => {
  const inline = { ...base, FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(account) };
  const config = await firebaseServerConfig(inline);
  assert.equal(config.projectId, projectId);
  assert.equal(config.serviceAccount.privateKey, privateKey);
  assert.equal(inline.FIREBASE_SERVICE_ACCOUNT_JSON, JSON.stringify(account));
  const directory = await mkdtemp(path.join(tmpdir(), 'avx-firebase-config-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'service-account.json');
  await writeFile(filename, JSON.stringify(account), { mode: 0o600 });
  const fromFile = await firebaseServerConfig({
    ...base,
    GOOGLE_APPLICATION_CREDENTIALS: filename,
  });
  assert.deepEqual(fromFile, config);
  await assert.rejects(
    firebaseServerConfig({ ...inline, GOOGLE_APPLICATION_CREDENTIALS: filename }),
    /only one credential source/,
  );
});
