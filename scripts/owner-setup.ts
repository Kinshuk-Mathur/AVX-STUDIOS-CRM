import { closeFirebase } from '../src/server/firebase/client';
import { issueOwnerRecovery } from '../src/server/services/owner-recovery';

async function main() {
  const origin = new URL(process.env.APP_ORIGIN || 'http://localhost:3000');
  if (
    origin.protocol !== 'https:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
  ) {
    throw new Error('Use an HTTPS APP_ORIGIN, or localhost for local setup.');
  }
  const token = await issueOwnerRecovery();
  const url = new URL('/owner-setup', origin);
  url.hash = new URLSearchParams({ token }).toString();
  console.log('Open this private one-use link to create or reset your owner credentials:');
  console.log(url.toString());
  console.log('Expires in 30 minutes. Keep the link private. Business data is preserved.');
  console.log('If the app is stopped, run npm run dev, then open the link.');
}
main()
  .catch((error) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  })
  .finally(closeFirebase);
