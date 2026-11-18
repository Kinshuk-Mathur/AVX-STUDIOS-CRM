import 'server-only';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getStore } from '@netlify/blobs';
import { insist } from '../errors';
function localDirectory() {
  if (process.env.NETLIFY) return null;
  insist(
    process.env.NODE_ENV !== 'production',
    'Private file storage is not configured for this host.',
    503,
  );
  return path.resolve(process.env.AVX_BLOB_DIR || '.data/files');
}
export async function putFile(content: Buffer) {
  const key = createHash('sha256').update(content).digest('hex');
  const dir = localDirectory();
  if (dir) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(path.join(dir, key), content, { mode: 0o600, flag: 'w' });
  } else
    await getStore({ name: 'avx-private-files', consistency: 'strong' }).set(
      key,
      new Uint8Array(content).buffer,
    );
  return key;
}
export async function readFileContent(key: string): Promise<Buffer> {
  insist(/^[a-f0-9]{64}$/.test(key), 'Invalid file reference.', 404);
  const dir = localDirectory();
  if (dir) {
    try {
      return await readFile(path.join(dir, key));
    } catch {
      insist(false, 'File not found.', 404);
    }
  }
  const data = await getStore({ name: 'avx-private-files', consistency: 'strong' }).get(key, {
    type: 'arrayBuffer',
  });
  insist(data, 'File not found.', 404);
  return Buffer.from(data);
}
