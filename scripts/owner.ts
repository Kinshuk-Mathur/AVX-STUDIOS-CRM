import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { hashPassword } from '../src/server/security';
import { transaction, one, closeDb } from '../src/server/db';
async function main() {
  if (process.env.DATABASE_ADMIN_URL) process.env.DATABASE_URL = process.env.DATABASE_ADMIN_URL;
  const existing = await transaction((tx) => one(tx, 'SELECT id FROM owners LIMIT 1'));
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
    await tx.query('INSERT INTO owners(username,display_name,password_hash) VALUES($1,$2,$3)', [
      username,
      name,
      hash,
    ]);
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
  .finally(closeDb);
