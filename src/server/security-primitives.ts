import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { insist } from './errors';
import { type Principal, type Section } from '@/lib/domain';
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
