import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { initializeWorkspace } from '../src/server/firebase/bootstrap';
import { closeFirebase } from '../src/server/firebase/client';
import { workspace } from '../src/server/firebase/store';
export async function fixture() {
  assert.match(
    process.env.FIRESTORE_EMULATOR_HOST || '',
    /^127\.0\.0\.1:\d+$/,
    'Run tests through the Firestore emulator.',
  );
  process.env.FIREBASE_PROJECT_ID = 'demo-avx-tests';
  process.env.AVX_WORKSPACE_ID = 'test-' + randomUUID();
  process.env.APP_ORIGIN = 'http://localhost:3000';
  Object.assign(process.env, { NODE_ENV: 'test' });
  const dir = await mkdtemp(path.join(tmpdir(), 'avx-files-'));
  process.env.AVX_BLOB_DIR = dir;
  await initializeWorkspace();
  return async () => {
    const root = await workspace();
    await root.firestore.recursiveDelete(root);
    await closeFirebase();
    await rm(dir, { recursive: true, force: true });
  };
}
