import { stableKey, now, type UnitOfWork } from './store';
export async function metric(tx: UnitOfWork, field: string, delta: bigint) {
  const old = await tx.get('metrics', 'global');
  const value = (BigInt(String(old?.[field] || 0)) + delta).toString();
  if (old) await tx.update('metrics', 'global', { [field]: value });
  else await tx.create('metrics', { id: 'global', [field]: value });
}
export async function rollup(
  tx: UnitOfWork,
  date: string,
  dimension: string,
  subject: string,
  amount: bigint,
  events = 0,
) {
  const id = stableKey(JSON.stringify([date, dimension, subject])),
    old = await tx.get('rollups', id);
  const patch = {
    amount_paise: (BigInt(String(old?.amount_paise || 0)) + amount).toString(),
    events: Number(old?.events || 0) + events,
  };
  if (old) await tx.update('rollups', id, patch);
  else await tx.create('rollups', { id, date, dimension, subject, created_at: now(), ...patch });
}
