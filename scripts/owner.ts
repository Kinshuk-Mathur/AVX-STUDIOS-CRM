import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { hashPassword } from '../src/server/security';
import { transaction, get, newRow, accessAudit } from '../src/server/firebase/store';
import { closeFirebase } from '../src/server/firebase/client';
import { initializeWorkspace } from '../src/server/firebase/bootstrap';
async function main() {
  await initializeWorkspace();
  const existing = (await get('meta', 'access'))?.owner_id;
  if (existing)
    throw new Error(
      'Your owner account already exists. Sign in at /login. To reset credentials, stop the local app and run npm run owner:setup.',
    );
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, cb) {
      if (!muted) process.stdout.write(chunk, encoding);
      cb();
    },
  });
  const prompt = createInterface({ input: process.stdin, output, terminal: !!process.stdin.isTTY });
  const username = (process.env.OWNER_USERNAME || (await prompt.question('Owner username: ')))
    .trim()
    .toLowerCase();
  const name = (process.env.OWNER_NAME || (await prompt.question('Display name: '))).trim();
  let password = process.env.OWNER_PASSWORD;
  if (!password) {
    process.stdout.write('Password (minimum 12 characters; hidden): ');
    muted = true;
    password = await prompt.question('');
    muted = false;
    process.stdout.write('\n');
  }
  prompt.close();
  if (!/^[a-z0-9@._-]{3,100}$/.test(username) || !name)
    throw new Error('Enter a valid username and display name.');
  const hash = await hashPassword(password);
  delete process.env.OWNER_PASSWORD;
  await transaction(async (tx) => {
    const meta = await tx.get('meta', 'access');
    if (meta?.owner_id) throw new Error('An owner already exists. Use npm run owner:reset.');
    const owner = await tx.create(
      'owners',
      newRow({ username, display_name: name, password_hash: hash, session_version: 0 }),
    );
    await tx.update('meta', 'access', { owner_id: owner.id });
    await accessAudit(tx, 'owner_initialized');
  });
  console.log(
    'Owner initialized. Start AVX OS and sign in at /login. No further owner accounts can be created.',
  );
}
main()
  .catch((e) => {
    console.error((e as Error).message);
    process.exitCode = 1;
  })
  .finally(closeFirebase);
