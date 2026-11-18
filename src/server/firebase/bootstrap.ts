import { randomUUID } from 'node:crypto';
import { transaction, now, stableKey } from './store';
export const defaultSettings = {
  name: 'AVX Studios',
  tagline: 'Art • Visual • Experience',
  website: 'https://avxstudios.netlify.app',
  currency: 'INR',
  receiptPrefix: 'AVX-RCP',
  invoicePrefix: 'AVX-INV',
  quotePrefix: 'AVX-QTE',
  footer: 'Thank you for working with AVX Studios.',
  requestTimeoutMinutes: 5,
  sessionMinutes: 60,
  idleMinutes: 15,
  accent: '#ff002c',
  taxBps: 0,
};
export async function initializeWorkspace() {
  return transaction(async (tx) => {
    const meta = await tx.get('meta', 'schema');
    if (meta) return { initialized: false };
    const timestamp = now();
    await tx.create('agency_settings', {
      id: 'agency',
      created_at: timestamp,
      data: defaultSettings,
    });
    await tx.create('meta', { id: 'access', created_at: timestamp, auth_epoch: 0 });
    for (const [name, color] of [
      ['Video Editing', '#ff4565'],
      ['Website Development', '#8b8cf8'],
      ['Motion Graphics', '#d3ad73'],
      ['AI Video Production', '#6db5a0'],
      ['Branding & Design', '#8cb8d9'],
      ['Social Media Content', '#bd8dbe'],
      ['Other', '#8d8992'],
    ]) {
      const id = randomUUID();
      await tx.create('service_categories', {
        id,
        name,
        color,
        active: true,
        created_at: timestamp,
      });
      await tx.create('category_names', { id: stableKey(name.toLowerCase()), category_id: id });
    }
    await tx.create('meta', {
      id: 'schema',
      version: 1,
      created_at: timestamp,
      backend: 'firestore',
    });
    return { initialized: true };
  });
}
