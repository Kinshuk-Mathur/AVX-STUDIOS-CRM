import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { driver, closeDb } from '../src/server/db';
async function main() {
  const url = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
  if (url) {
    const pool = new Pool({ connectionString: url });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(await readFile('src/server/db/schema.sql', 'utf8'));
      await client.query('COMMIT');
      console.log('PostgreSQL migration 1 applied.');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
      await pool.end();
    }
  } else {
    await driver();
    await closeDb();
    console.log('Local PostgreSQL initialized in ' + (process.env.PGLITE_DATA_DIR || '.data/avx'));
  }
}
main().catch(() => {
  console.error('Migration failed. Check database permissions and connection configuration.');
  process.exitCode = 1;
});
