import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import type { Principal } from '@/lib/domain';
export interface Tx {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
type Driver = { kind: 'local'; db: PGlite } | { kind: 'postgres'; db: Pool };
const globalDb = globalThis as unknown as { avxDriver?: Promise<Driver> };
async function connect(): Promise<Driver> {
  if (process.env.DATABASE_URL)
    return {
      kind: 'postgres',
      db: new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      }),
    };
  if (process.env.NODE_ENV === 'production')
    throw new Error('DATABASE_URL is required in production.');
  const directory = process.env.PGLITE_DATA_DIR || path.resolve('.data/avx');
  if (directory !== 'memory://') await mkdir(directory, { recursive: true, mode: 0o700 });
  const db = new PGlite(directory);
  await db.waitReady;
  const version = await db.query<{ exists: boolean }>(
    "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists",
  );
  const currentVersion = version.rows[0].exists
    ? (
        await db.query<{ version: number }>(
          'SELECT coalesce(max(version),0) AS version FROM schema_migrations',
        )
      ).rows[0].version
    : 0;
  if (currentVersion < 2)
    await db.exec(await readFile(path.resolve('src/server/db/schema.sql'), 'utf8'));
  return { kind: 'local', db };
}
export async function driver() {
  return (globalDb.avxDriver ??= connect().catch((e) => {
    globalDb.avxDriver = undefined;
    throw e;
  }));
}
export async function transaction<T>(
  fn: (tx: Tx) => Promise<T>,
  principal?: Principal,
): Promise<T> {
  const d = await driver();
  const run = async (tx: Tx) => {
    await tx.query(
      principal?.role === 'viewer' ? 'SET LOCAL ROLE avx_readonly' : 'SET LOCAL ROLE avx_app',
    );
    await tx.query("SELECT set_config('avx.role',$1,true),set_config('avx.sections',$2,true)", [
      principal?.role || 'system',
      principal?.permissions.join(',') || '',
    ]);
    return fn(tx);
  };
  if (d.kind === 'local') return d.db.transaction((tx) => run(tx as Tx));
  const client = await d.db.connect();
  try {
    await client.query('BEGIN');
    const value = await run(client);
    await client.query('COMMIT');
    return value;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
export async function closeDb() {
  const d = await globalDb.avxDriver;
  if (d) {
    if (d.kind === 'local') await d.db.close();
    else await d.db.end();
  }
  globalDb.avxDriver = undefined;
}
export async function one<T = Record<string, unknown>>(
  tx: Tx,
  sql: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  return (await tx.query<T>(sql, params)).rows[0];
}
export async function audit(
  tx: Tx,
  section: string,
  id: string,
  action: string,
  description: string,
) {
  await tx.query(
    'INSERT INTO activity_logs(section,entity_id,action,description) VALUES($1,$2,$3,$4)',
    [section, id, action, description],
  );
}
export async function nextNumber(tx: Tx, prefix: string, year: number) {
  const row = await one<{ value: number }>(
    tx,
    'INSERT INTO counters(key,value) VALUES($1,1) ON CONFLICT(key) DO UPDATE SET value=counters.value+1 RETURNING value',
    [`${prefix}-${year}`],
  );
  return `${prefix}-${year}-${String(row!.value).padStart(4, '0')}`;
}
