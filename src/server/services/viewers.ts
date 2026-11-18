import { z } from 'zod';
import { transaction, list, get, newRow, now, accessAudit } from '../firebase/store';
import type { Account, Session, AccessMeta } from '../firebase/models';
import { assertOwner, hashPassword, verifyPassword, hashToken } from '../security-primitives';
import { effectiveSessionStatus } from '../security';
import { insist } from '../errors';
import { viewerSchema } from '../validation';
import type { Principal } from '@/lib/domain';
export async function saveViewer(p: Principal, body: unknown, id?: string) {
  assertOwner(p);
  const v = viewerSchema.parse(body);
  insist(id || v.password, 'Set an initial password.');
  const password_hash = v.password ? await hashPassword(v.password) : undefined,
    username = v.username.toLowerCase();
  return transaction(async (tx) => {
    const old = id ? await tx.get<Account>('viewer_accounts', id) : undefined;
    if (id) insist(old && old.status !== 'Deleted', 'Viewer not found.', 404);
    const key = hashToken('viewer:' + username),
      index = await tx.get('usernames', key);
    insist(!index || index.account_id === id, 'This username is already in use.', 409);
    const data = {
      display_name: v.name,
      username,
      status: v.status,
      expires_at: v.expiresAt || null,
      permissions: [...new Set(v.permissions)],
      session_version: (old?.session_version || 0) + (old ? 1 : 0),
      password_hash: password_hash || old!.password_hash,
      updated_at: now(),
    };
    const row = id
      ? await tx.update('viewer_accounts', id, data)
      : await tx.create('viewer_accounts', newRow(data));
    if (old && old.username !== username)
      await tx.remove('usernames', hashToken('viewer:' + old.username));
    if (!index) await tx.create('usernames', { id: key, account_id: row.id });
    await accessAudit(tx, id ? 'account_updated_sessions_revoked' : 'account_created', row.id);
    return { id: row.id };
  }, p);
}
export async function decideAccess(
  p: Principal,
  sessionId: string,
  decision: 'approve' | 'reject' | 'revoke',
) {
  assertOwner(p);
  return transaction(async (tx) => {
    const s = await tx.get<Session>('sessions', sessionId);
    insist(s?.viewer_id, 'Access request not found.', 404);
    const a = await tx.get<Account>('viewer_accounts', s.viewer_id),
      meta = await tx.get<AccessMeta>('meta', 'access');
    if (decision !== 'revoke')
      insist(
        effectiveSessionStatus(s, a, meta) === 'pending',
        'This request has expired or has already been handled.',
        409,
      );
    const status =
      decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'revoked';
    await tx.update('sessions', sessionId, {
      status,
      last_activity_at: now(),
      ...(status === 'approved' ? { approved_at: now() } : {}),
      ...(status === 'revoked' ? { revoked_at: now() } : {}),
    });
    await accessAudit(tx, decision, s.viewer_id, sessionId);
    return { ok: true };
  }, p);
}
export async function viewerAction(p: Principal, id: string, action: 'revoke' | 'delete') {
  assertOwner(p);
  return transaction(async (tx) => {
    const a = await tx.get<Account>('viewer_accounts', id);
    insist(a, 'Viewer not found.', 404);
    await tx.update('viewer_accounts', id, {
      session_version: a.session_version + 1,
      updated_at: now(),
      ...(action === 'delete' ? { status: 'Deleted' } : {}),
    });
    await accessAudit(tx, action === 'delete' ? 'account_deleted' : 'all_sessions_revoked', id);
    return { ok: true };
  }, p);
}
export async function viewerData(p: Principal) {
  assertOwner(p);
  const [accounts, sessions, history, meta] = await Promise.all([
    list<Account>('viewer_accounts'),
    list<Session>('sessions'),
    list('access_audit_logs'),
    get<AccessMeta>('meta', 'access'),
  ]);
  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  const joined = sessions
    .filter((s) => s.viewer_id)
    .map((s) => ({
      ...s,
      effective_status: effectiveSessionStatus(s, accountsById.get(s.viewer_id!), meta),
      display_name: accountsById.get(s.viewer_id!)?.display_name,
      username: accountsById.get(s.viewer_id!)?.username,
    }));
  const safe = (row: (typeof joined)[number]) =>
    Object.fromEntries(
      Object.entries(row).filter(
        ([key]) => !['token_hash', 'account_version', 'auth_epoch'].includes(key),
      ),
    );
  return {
    viewers: accounts
      .filter((a) => a.status !== 'Deleted')
      .map((a) => ({
        id: a.id,
        display_name: a.display_name,
        username: a.username,
        status: a.status,
        expires_at: a.expires_at,
        last_login: a.last_login,
        created_at: a.created_at,
        permissions: a.permissions || [],
        last_request:
          joined
            .filter((s) => s.viewer_id === a.id)
            .map((s) => s.created_at)
            .sort()
            .at(-1) || null,
        active_sessions: joined.filter(
          (s) => s.viewer_id === a.id && s.effective_status === 'approved',
        ).length,
      })),
    requests: joined
      .filter((s) => s.effective_status === 'pending')
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map(safe),
    sessions: joined
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 100)
      .map(safe),
    history: history
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, 100)
      .map((a) => ({
        ...a,
        display_name: accountsById.get(String(a.viewer_id))?.display_name || null,
      })),
  };
}
export async function changeOwnerPassword(p: Principal, body: unknown) {
  assertOwner(p);
  const v = z
    .object({ currentPassword: z.string().max(128), newPassword: z.string().min(12).max(128) })
    .strict()
    .parse(body);
  const old = await get<Account>('owners', p.id);
  insist(
    old && (await verifyPassword(v.currentPassword, old.password_hash)),
    'Current password is incorrect.',
  );
  const password_hash = await hashPassword(v.newPassword);
  return transaction(async (tx) => {
    const current = await tx.get<Account>('owners', p.id);
    insist(
      current?.password_hash === old.password_hash,
      'Credentials changed. Sign in and try again.',
      409,
    );
    const session_version = current.session_version + 1;
    await tx.update('owners', p.id, { password_hash, session_version });
    if (p.sessionId) await tx.update('sessions', p.sessionId, { account_version: session_version });
    await accessAudit(tx, 'owner_password_changed');
    return { ok: true };
  }, p);
}

export async function pendingRequests(p: Principal) {
  assertOwner(p);
  return transaction(async (tx) => {
    const meta = await tx.get<AccessMeta>('meta', 'access');
    const sessions = await tx.list<Session>('sessions', [['status', '==', 'pending']]);
    const requests = [];
    for (const s of sessions) {
      if (!s.viewer_id || s.request_expires_at <= now()) continue;
      const account = await tx.get<Account>('viewer_accounts', s.viewer_id);
      if (effectiveSessionStatus(s, account, meta) === 'pending')
        requests.push({
          id: s.id,
          device: s.device,
          created_at: s.created_at,
          display_name: account!.display_name,
          username: account!.username,
        });
    }
    return requests.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, p);
}
