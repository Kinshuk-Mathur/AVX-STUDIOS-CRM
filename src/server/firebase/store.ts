import 'server-only';
import { randomUUID, createHash } from 'node:crypto';
import type { Transaction, Query, WhereFilterOp } from 'firebase-admin/firestore';
import type { Principal, RecordRow, Section } from '@/lib/domain';
import { can } from '@/lib/domain';
import { insist } from '../errors';
import { firebaseDatabase } from './client';
export type Row = RecordRow;
export type Filter = readonly [string, WhereFilterOp, unknown];
const immutable = new Set([
  'payments',
  'refunds',
  'receipts',
  'activity_logs',
  'access_audit_logs',
]);
const protectedFields: Record<string, Set<string>> = {
  payments: new Set(['refunded_paise', 'allocations']),
};
const business: Record<string, Section> = {
  clients: 'clients',
  projects: 'projects',
  tasks: 'tasks',
  deliverables: 'projects',
  payments: 'payments',
  refunds: 'payments',
  documents: 'invoices',
  receipts: 'invoices',
  expenses: 'expenses',
};
export function now() {
  return new Date().toISOString();
}
export const stableKey = (value: string) => createHash('sha256').update(value).digest('hex');
export function newRow<T extends Record<string, unknown>>(data: T) {
  return { id: randomUUID(), created_at: now(), ...data };
}
export async function workspace() {
  const name = process.env.AVX_WORKSPACE_ID || 'primary';
  insist(/^[a-zA-Z0-9_-]{1,100}$/.test(name), 'Invalid workspace configuration.', 503);
  return (await firebaseDatabase()).collection('avx_workspaces').doc(name);
}
function readable(table: string, p?: Principal) {
  if (!p || p.role === 'owner' || table === 'service_categories') return true;
  if (['documents', 'receipts'].includes(table))
    return ['clients', 'projects', 'payments', 'invoices'].every((s) => can(p, s as Section));
  return !!business[table] && can(p, business[table]);
}
function matches(row: Row, filters: readonly Filter[]) {
  return filters.every(([field, op, expected]) => {
    const actual = row[field] as string | number;
    const target = expected as string | number;
    if (op === '==') return actual === target;
    if (op === '>=') return actual >= target;
    if (op === '<=') return actual <= target;
    if (op === '>') return actual > target;
    if (op === '<') return actual < target;
    if (op === 'in') return (expected as unknown[]).includes(actual);
    throw new Error('Unsupported repository filter');
  });
}
export class UnitOfWork {
  private changes = new Map<
    string,
    { table: string; id: string; row: Row | null; create: boolean }
  >();
  private cache = new Map<string, Row | undefined>();
  constructor(
    private native: Transaction,
    private root: Awaited<ReturnType<typeof workspace>>,
    private principal?: Principal,
  ) {}
  async get<T extends Row = Row>(table: string, id: string): Promise<T | undefined> {
    if (!readable(table, this.principal)) return undefined;
    const key = table + '/' + id;
    if (this.changes.has(key)) return (this.changes.get(key)!.row || undefined) as T | undefined;
    if (!this.cache.has(key)) {
      const snap = await this.native.get(this.root.collection(table).doc(id));
      this.cache.set(key, snap.exists ? ({ ...snap.data(), id: snap.id } as Row) : undefined);
    }
    return this.cache.get(key) as T | undefined;
  }
  async list<T extends Row = Row>(table: string, filters: readonly Filter[] = []): Promise<T[]> {
    if (!readable(table, this.principal)) return [];
    let query: Query = this.root.collection(table);
    for (const [field, op, value] of filters) query = query.where(field, op, value);
    const snap = await this.native.get(query);
    const rows = new Map(snap.docs.map((d) => [d.id, { ...d.data(), id: d.id } as Row]));
    for (const d of snap.docs) this.cache.set(table + '/' + d.id, rows.get(d.id));
    for (const change of this.changes.values())
      if (change.table === table) {
        if (change.row && matches(change.row, filters)) rows.set(change.id, change.row);
        else rows.delete(change.id);
      }
    return [...rows.values()] as T[];
  }
  private writable() {
    insist(!this.principal || this.principal.role === 'owner', 'Owner access is required.', 403);
  }
  async create<T extends Row>(table: string, row: T): Promise<T> {
    this.writable();
    insist(
      !(await this.get(table, row.id)),
      'This record or transaction reference already exists.',
      409,
    );
    this.changes.set(table + '/' + row.id, { table, id: row.id, row, create: true });
    return row;
  }
  async update<T extends Row = Row>(table: string, id: string, patch: Partial<T>): Promise<T> {
    this.writable();
    if (immutable.has(table))
      insist(
        !!protectedFields[table] && Object.keys(patch).every((k) => protectedFields[table].has(k)),
        'Financial history is immutable.',
        403,
      );
    const current = await this.get<T>(table, id);
    insist(current, 'Record not found.', 404);
    const row = { ...current, ...patch, id };
    const previous = this.changes.get(table + '/' + id);
    this.changes.set(table + '/' + id, { table, id, row, create: previous?.create || false });
    return row;
  }
  async remove(table: string, id: string) {
    this.writable();
    insist(!immutable.has(table), 'Financial history is immutable.', 403);
    await this.get(table, id);
    const key = table + '/' + id;
    if (this.changes.get(key)?.create) this.changes.delete(key);
    else this.changes.set(key, { table, id, row: null, create: false });
  }
  flush() {
    insist(
      this.changes.size <= 450,
      'This operation is too large. Split it into smaller changes.',
      413,
    );
    for (const c of this.changes.values()) {
      const ref = this.root.collection(c.table).doc(c.id);
      if (c.row === null) this.native.delete(ref);
      else if (c.create) this.native.create(ref, c.row);
      else this.native.set(ref, c.row);
    }
  }
}
export async function transaction<T>(
  fn: (tx: UnitOfWork) => Promise<T>,
  principal?: Principal,
): Promise<T> {
  const root = await workspace();
  return root.firestore.runTransaction(
    async (native) => {
      const tx = new UnitOfWork(native, root, principal);
      const result = await fn(tx);
      tx.flush();
      return result;
    },
    { maxAttempts: 8 },
  );
}
export async function get<T extends Row = Row>(table: string, id: string, p?: Principal) {
  return transaction((tx) => tx.get<T>(table, id), p);
}
export async function list<T extends Row = Row>(
  table: string,
  filters: readonly Filter[] = [],
  p?: Principal,
) {
  return transaction((tx) => tx.list<T>(table, filters), p);
}
export async function audit(
  tx: UnitOfWork,
  section: string,
  id: string,
  action: string,
  description: string,
) {
  await tx.create('activity_logs', newRow({ section, entity_id: id, action, description }));
}
export async function accessAudit(
  tx: UnitOfWork,
  event: string,
  viewer_id: string | null = null,
  session_id: string | null = null,
) {
  await tx.create('access_audit_logs', newRow({ event, viewer_id, session_id }));
}
export async function nextNumber(tx: UnitOfWork, prefix: string, year: number) {
  const id = stableKey(prefix + '-' + year),
    old = await tx.get('counters', id);
  const value = Number(old?.value || 0) + 1;
  if (old) await tx.update('counters', id, { value });
  else await tx.create('counters', { id, value });
  return prefix + '-' + year + '-' + String(value).padStart(4, '0');
}

export async function getMany<T extends Row = Row>(
  table: string,
  ids: readonly string[],
  p?: Principal,
): Promise<T[]> {
  if (!readable(table, p) || !ids.length) return [];
  const root = await workspace(),
    unique = [...new Set(ids)];
  const groups = [];
  for (let i = 0; i < unique.length; i += 100) groups.push(unique.slice(i, i + 100));
  const rows: T[] = [];
  for (const group of groups) {
    const snapshots = await root.firestore.getAll(
      ...group.map((id) => root.collection(table).doc(id)),
    );
    for (const snap of snapshots) if (snap.exists) rows.push({ ...snap.data(), id: snap.id } as T);
  }
  return rows;
}
