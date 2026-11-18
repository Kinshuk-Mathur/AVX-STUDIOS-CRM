import { transaction, stableKey, now, type Row } from './store';
import { defaultSettings } from './bootstrap';
import { insist } from '../errors';
export interface LegacySetup {
  owners: Row[];
  viewer_accounts: Row[];
  viewer_permissions: { viewer_id: string; section: string }[];
  agency_settings: Row[];
  service_categories: Row[];
  access_audit_logs: Row[];
  sessions: Row[];
  counters: { key: string; value: number }[];
}
/** Imports the existing setup only. Business-data migration requires a separately verified export. */
export async function importLegacySetup(data: LegacySetup) {
  insist(data.owners.length <= 1, 'The source must contain at most one owner.');
  const fingerprint = stableKey(JSON.stringify(data));
  return transaction(async (tx) => {
    const existing = await tx.get('meta', 'schema');
    if (existing?.import_fingerprint === fingerprint) return { alreadyImported: true };
    insist(
      !existing,
      'The target Firestore workspace is already initialized. No data was overwritten.',
      409,
    );
    const timestamp = now();
    for (const owner of data.owners) {
      const { singleton, ...account } = owner;
      void singleton;
      await tx.create('owners', { ...account, session_version: 0 });
    }
    for (const account of data.viewer_accounts) {
      await tx.create('viewer_accounts', {
        ...account,
        session_version: 0,
        permissions: data.viewer_permissions
          .filter((p) => p.viewer_id === account.id)
          .map((p) => p.section),
      });
      await tx.create('usernames', {
        id: stableKey('viewer:' + String(account.username).toLowerCase()),
        account_id: account.id,
      });
    }
    await tx.create('agency_settings', {
      id: 'agency',
      created_at: timestamp,
      data: {
        ...defaultSettings,
        ...((data.agency_settings[0]?.data as Record<string, unknown>) || {}),
      },
    });
    for (const category of data.service_categories) {
      await tx.create('service_categories', { ...category, created_at: timestamp });
      await tx.create('category_names', {
        id: stableKey(String(category.name).toLowerCase()),
        category_id: category.id,
      });
    }
    for (const entry of data.access_audit_logs) await tx.create('access_audit_logs', entry);
    for (const session of data.sessions)
      await tx.create('sessions', {
        ...session,
        status: 'revoked',
        revoked_at: timestamp,
        account_version: 0,
        auth_epoch: 0,
      });
    for (const counter of data.counters)
      await tx.create('counters', { id: stableKey(counter.key), value: counter.value });
    await tx.create('meta', {
      id: 'access',
      created_at: timestamp,
      auth_epoch: 1,
      ...(data.owners[0] ? { owner_id: data.owners[0].id } : {}),
    });
    await tx.create('meta', {
      id: 'schema',
      version: 1,
      created_at: timestamp,
      backend: 'firestore',
      import_fingerprint: fingerprint,
    });
    return { alreadyImported: false };
  });
}
