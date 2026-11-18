import { randomBytes } from 'node:crypto';
import { AppError, insist } from './errors';
import { transaction, get, newRow, now, accessAudit } from './firebase/store';
import type { Account, Session, AccessMeta, Settings } from './firebase/models';
import { sections, type Principal } from '@/lib/domain';
import { hashToken, verifyPassword, cookieToken } from './security-primitives';
export * from './security-primitives';
export type SessionState =
  | { status: 'approved'; principal: Principal }
  | {
      status: 'signed-out' | 'pending' | 'rejected' | 'revoked' | 'expired';
      principal?: undefined;
    };
export function clientAddress(request: Request) {
  return process.env.TRUST_PROXY === 'true'
    ? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    : 'local';
}
export async function throttle(key: string, limit = 8, minutes = 15) {
  const blocked = await transaction(async (tx) => {
    const id = hashToken(key),
      old = await tx.get('login_limits', id);
    const expired = !old || String(old.reset_at) < now();
    const attempts = expired ? 1 : Number(old!.attempts) + 1;
    const row = {
      id,
      attempts,
      reset_at: expired ? new Date(Date.now() + minutes * 60000).toISOString() : old!.reset_at,
    };
    if (old) await tx.update('login_limits', id, row);
    else await tx.create('login_limits', row);
    return attempts > limit;
  });
  if (blocked) throw new AppError(429, 'Too many attempts. Please try again later.');
}
export function effectiveSessionStatus(
  s: Session,
  a: Account | undefined,
  meta: AccessMeta | undefined,
) {
  if (['rejected', 'revoked', 'expired'].includes(s.status)) return s.status;
  if (
    !a ||
    !meta ||
    s.auth_epoch !== meta.auth_epoch ||
    s.account_version !== a.session_version ||
    s.revoked_at ||
    (s.viewer_id && a.status !== 'Active')
  )
    return 'revoked';
  const timestamp = now();
  if (
    s.expires_at <= timestamp ||
    (s.status === 'pending' && s.request_expires_at <= timestamp) ||
    (s.viewer_id &&
      ((a.expires_at && a.expires_at <= timestamp) ||
        s.last_activity_at <= new Date(Date.now() - s.idle_minutes * 60000).toISOString()))
  )
    return 'expired';
  return s.status;
}
export async function sessionState(
  token: string | undefined,
  touch = false,
): Promise<SessionState> {
  if (!token) return { status: 'signed-out' };
  return transaction<SessionState>(async (tx) => {
    const index = await tx.get('session_tokens', hashToken(token));
    if (!index) return { status: 'signed-out' };
    const s = await tx.get<Session>('sessions', String(index.session_id));
    if (!s) return { status: 'signed-out' };
    const a = await tx.get<Account>(
      s.owner_id ? 'owners' : 'viewer_accounts',
      (s.owner_id || s.viewer_id)!,
    );
    const meta = await tx.get<AccessMeta>('meta', 'access');
    const status = effectiveSessionStatus(s, a, meta);
    if (status !== 'approved') {
      if (status !== s.status) await tx.update('sessions', s.id, { status });
      return { status: status as 'pending' | 'rejected' | 'revoked' | 'expired' };
    }
    if (touch) await tx.update('sessions', s.id, { last_activity_at: now() });
    return {
      status: 'approved',
      principal: {
        id: a!.id,
        name: a!.display_name,
        role: s.owner_id ? 'owner' : 'viewer',
        permissions: s.owner_id ? [...sections] : a!.permissions || [],
        sessionId: s.id,
      },
    };
  });
}
export async function authenticate(request: Request, touch = true) {
  const state = await sessionState(cookieToken(request), touch);
  if (!state.principal)
    throw new AppError(
      401,
      state.status === 'pending'
        ? 'Owner approval is required.'
        : 'Your session has ended. Please sign in again.',
    );
  return state.principal;
}
export async function login(username: string, password: string, viewer: boolean, device: string) {
  username = username.toLowerCase().trim();
  const account = await transaction(async (tx) => {
    if (viewer) {
      const index = await tx.get('usernames', hashToken('viewer:' + username));
      return index ? tx.get<Account>('viewer_accounts', String(index.account_id)) : undefined;
    }
    const meta = await tx.get<AccessMeta>('meta', 'access');
    const a = meta?.owner_id ? await tx.get<Account>('owners', meta.owner_id) : undefined;
    return a?.username === username ? a : undefined;
  });
  const verified = await verifyPassword(
    password,
    account?.password_hash || 'scrypt$' + '0'.repeat(32) + '$' + '0'.repeat(128),
  );
  insist(account && verified, 'Unable to sign in with those credentials.', 401);
  const token = randomBytes(32).toString('base64url');
  await transaction(async (tx) => {
    const a = await tx.get<Account>(viewer ? 'viewer_accounts' : 'owners', account.id);
    insist(
      a &&
        a.password_hash === account.password_hash &&
        (!viewer || (a.status === 'Active' && (!a.expires_at || a.expires_at > now()))),
      'Unable to sign in with those credentials.',
      401,
    );
    const meta = await tx.get<AccessMeta>('meta', 'access');
    insist(meta, 'Initialize the workspace before signing in.', 503);
    const policy = await tx.get<Settings>('agency_settings', 'agency');
    const settings = policy?.data || {};
    const time = Date.now();
    const s = newRow({
      token_hash: hashToken(token),
      owner_id: viewer ? null : a.id,
      viewer_id: viewer ? a.id : null,
      status: viewer ? 'pending' : 'approved',
      device: device.slice(0, 300),
      request_expires_at: new Date(
        time + Number(settings.requestTimeoutMinutes || 5) * 60000,
      ).toISOString(),
      expires_at: new Date(
        time + Number(viewer ? settings.sessionMinutes || 60 : 720) * 60000,
      ).toISOString(),
      idle_minutes: Number(settings.idleMinutes || 15),
      last_activity_at: now(),
      approved_at: viewer ? null : now(),
      account_version: a.session_version,
      auth_epoch: meta.auth_epoch,
    });
    await tx.create('sessions', s);
    await tx.create('session_tokens', {
      id: hashToken(token),
      session_id: s.id,
      expires_at: s.expires_at,
    });
    await accessAudit(tx, viewer ? 'access_requested' : 'owner_login', viewer ? a.id : null, s.id);
    if (viewer) await tx.update('viewer_accounts', a.id, { last_login: now() });
  });
  return { token, status: viewer ? 'pending' : 'approved' };
}
export async function logout(token: string | undefined) {
  if (!token) return;
  const index = await get('session_tokens', hashToken(token));
  if (index)
    await transaction((tx) =>
      tx.update('sessions', String(index.session_id), { status: 'revoked', revoked_at: now() }),
    );
}
