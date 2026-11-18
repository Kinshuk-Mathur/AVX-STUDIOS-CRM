import { driver, closeDb, type Tx } from '../src/server/db';
import { closeFirebase } from '../src/server/firebase/client';
import { importLegacySetup, type LegacySetup } from '../src/server/firebase/import-legacy-setup';
async function main() {
  const source = await driver();
  const db = source.db as unknown as Tx;
  const tables = [
    'owners',
    'viewer_accounts',
    'viewer_permissions',
    'agency_settings',
    'service_categories',
    'access_audit_logs',
    'sessions',
    'counters',
  ] as const;
  const business = [
    'clients',
    'projects',
    'tasks',
    'deliverables',
    'documents',
    'payments',
    'refunds',
    'receipts',
    'expenses',
    'attachments',
    'activity_logs',
    'email_deliveries',
  ];
  for (const table of business) {
    const result = await db.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM ' + table,
    );
    if (result.rows[0].count !== '0')
      throw new Error(
        'This setup importer only accepts a database without business records. ' +
          table +
          ' contains records; no Firestore changes were made.',
      );
  }
  const records: Record<string, unknown> = {};
  for (const table of tables)
    records[table] = JSON.parse(JSON.stringify((await db.query('SELECT * FROM ' + table)).rows));
  const data = records as unknown as LegacySetup;
  console.log(
    'Source contains ' +
      data.owners.length +
      ' owner(s), ' +
      data.viewer_accounts.length +
      ' viewer(s), and no business records.',
  );
  if (!process.argv.includes('--apply')) {
    console.log('Dry run only. Add --apply to import into an empty Firestore workspace.');
    return;
  }
  const result = await importLegacySetup(data);
  console.log(
    result.alreadyImported
      ? 'This source has already been imported.'
      : 'Setup imported atomically. Existing owner credentials are preserved; all previous sessions are revoked.',
  );
}
main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Import failed.');
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
    await closeFirebase();
  });
