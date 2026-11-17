import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { AppError, insist } from './errors';
import { one, transaction } from './db';
import { sections, type Principal, type Section } from '@/lib/domain';
const derive = (
  password: string,
  salt: string,
  length: number,
  options: { N: number; r: number; p: number; maxmem: number },
): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    scrypt(password, salt, length, options, (error, key) => (error ? reject(error) : resolve(key))),
  );
const OPTIONS = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
export const COOKIE = 'avx_session';
export const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');
export async function hashPassword(password: string) {
  insist(
    password.length >= 12 && password.length <= 128,
    'Use a password between 12 and 128 characters.',
  );
  const salt = randomBytes(16).toString('hex');
  const key = (await derive(password, salt, 64, OPTIONS)) as Buffer;
  return `scrypt$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(password: string, hash: string) {
  const [, salt, hex] = hash.split('$');
  if (!salt || !hex) return false;
  const key = (await derive(password, salt, 64, OPTIONS)) as Buffer;
  const stored = Buffer.from(hex, 'hex');
  return stored.length === key.length && timingSafeEqual(key, stored);
}
export function assertOwner(p: Principal) {
  insist(p.role === 'owner', 'Owner access is required.', 403);
}
export function assertSection(p: Principal, section: Section) {
  insist(
    p.role === 'owner' || p.permissions.includes(section),
    'This section is not available to your account.',
    403,
  );
}
export function cookieToken(request: Request) {
  return request.headers
    .get('cookie')
    ?.split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
}
export function sessionCookie(token: string, clear = false) {
  const secure = process.env.NODE_ENV === 'production';
  return `${COOKIE}=${clear ? '' : token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : 43200}${secure ? '; Secure' : ''}`;
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const expected = process.env.APP_ORIGIN || new URL(request.url).origin;
  insist(origin === expected, 'Request origin was rejected.', 403);
  const site = request.headers.get('sec-fetch-site');
  insist(
    !site || site === 'same-origin' || site === 'none',
    'Cross-site requests are not allowed.',
    403,
  );
}
export async function throttle(key: string, limit = 8, minutes = 15) {
  const blocked = await transaction(async (tx) => {
    const row = await one<{ attempts: number }>(
      tx,
      "INSERT INTO login_limits(key,attempts,reset_at) VALUES($1,1,now()+($2||' minutes')::interval) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_limits.reset_at<now() THEN 1 ELSE login_limits.attempts+1 END,reset_at=CASE WHEN login_limits.reset_at<now() THEN excluded.reset_at ELSE login_limits.reset_at END RETURNING attempts",
      [hashToken(key), String(minutes)],
    );
    return row!.attempts > limit;
  });
  if (blocked) throw new AppError(429, 'Too many attempts. Please try again later.');
}
export function clientAddress(request: Request) {
  return process.env.TRUST_PROXY === 'true'
    ? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    : 'local';
}
type StoredSessionStatus = 'pending' | 'approved' | 'rejected' | 'revoked' | 'expired';
export type SessionState =
  | { status: 'approved'; principal: Principal }
  | { status: Exclude<StoredSessionStatus, 'approved'> | 'signed-out'; principal?: undefined };

interface SessionRow {
  id: string;
  owner_id: string | null;
  viewer_id: string | null;
  status: StoredSessionStatus;
  name: string;
  permissions: Section[];
  valid: boolean;
}
export async function sessionState(
  token: string | undefined,
  touch = false,
): Promise<SessionState> {
  if (!token) return { status: 'signed-out' };
  return transaction<SessionState>(async (tx) => {
    const row = await one<SessionRow>(
      tx,
      `SELECT s.id,s.owner_id,s.viewer_id,s.status,coalesce(o.display_name,v.display_name) AS name,
      coalesce((SELECT array_agg(section) FROM viewer_permissions WHERE viewer_id=v.id),'{}') AS permissions,
      (s.revoked_at IS NULL AND s.expires_at>now() AND (s.owner_id IS NOT NULL OR (v.status='Active' AND (v.expires_at IS NULL OR v.expires_at>now()) AND s.last_activity_at>now()-(s.idle_minutes||' minutes')::interval)) AND (s.status<>'pending' OR s.request_expires_at>now())) AS valid
      FROM sessions s LEFT JOIN owners o ON o.id=s.owner_id LEFT JOIN viewer_accounts v ON v.id=s.viewer_id WHERE s.token_hash=$1`,
      [hashToken(token)],
    );
    if (!row) return { status: 'signed-out' };
    if (!row.valid) {
      if (['pending', 'approved'].includes(row.status))
        await tx.query("UPDATE sessions SET status='expired' WHERE id=$1", [row.id]);
      return {
        status: row.status === 'rejected' || row.status === 'revoked' ? row.status : 'expired',
      };
    }
    if (row.status !== 'approved') return { status: row.status };
    if (touch) await tx.query('UPDATE sessions SET last_activity_at=now() WHERE id=$1', [row.id]);
    const principal: Principal = {
      id: (row.owner_id || row.viewer_id)!,
      name: row.name,
      role: row.owner_id ? 'owner' : 'viewer',
      permissions: row.owner_id ? [...sections] : row.permissions,
      sessionId: row.id,
    };
    return { status: 'approved', principal };
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
  const account = await transaction((tx) =>
    one<{ id: string; password_hash: string; display_name: string; valid: boolean }>(
      tx,
      viewer
        ? "SELECT id,password_hash,display_name,(status='Active' AND (expires_at IS NULL OR expires_at>now())) AS valid FROM viewer_accounts WHERE username=$1"
        : 'SELECT id,password_hash,display_name,true AS valid FROM owners WHERE username=$1',
      [username.toLowerCase().trim()],
    ),
  );
  const dummy = `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`;
  const verified = await verifyPassword(password, account?.password_hash || dummy);
  insist(account && verified && account.valid, 'Unable to sign in with those credentials.', 401);
  const token = randomBytes(32).toString('base64url');
  await transaction(
    async (tx) => {
      const policy = await one<{
        data: { requestTimeoutMinutes?: number; sessionMinutes?: number; idleMinutes?: number };
      }>(tx, 'SELECT data FROM agency_settings');
      const settings = policy?.data || {};
      const session = await one<{ id: string }>(
        tx,
        `INSERT INTO sessions(token_hash,${viewer ? 'viewer_id' : 'owner_id'},status,device,request_expires_at,expires_at,idle_minutes,approved_at) VALUES($1,$2,$3,$4,now()+($5||' minutes')::interval,now()+($6||' minutes')::interval,$7,${viewer ? 'NULL' : 'now()'}) RETURNING id`,
        [
          hashToken(token),
          account.id,
          viewer ? 'pending' : 'approved',
          device.slice(0, 300),
          String(settings.requestTimeoutMinutes || 5),
          String(viewer ? settings.sessionMinutes || 60 : 720),
          settings.idleMinutes || 15,
        ],
      );
      await tx.query('INSERT INTO access_audit_logs(viewer_id,session_id,event) VALUES($1,$2,$3)', [
        viewer ? account.id : null,
        session!.id,
        viewer ? 'access_requested' : 'owner_login',
      ]);
      if (viewer)
        await tx.query('UPDATE viewer_accounts SET last_login=now() WHERE id=$1', [account.id]);
    },
    {
      id: account.id,
      name: account.display_name,
      role: 'owner',
      permissions: [...sections],
      sessionId: '',
    },
  );
  return { token, status: viewer ? 'pending' : 'approved' };
}
export async function logout(token: string | undefined) {
  if (token)
    await transaction(async (tx) => {
      await tx.query("UPDATE sessions SET status='revoked',revoked_at=now() WHERE token_hash=$1", [
        hashToken(token),
      ]);
    });
}
