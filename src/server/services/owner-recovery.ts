import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { transaction, now, newRow, accessAudit } from '../firebase/store';
import type { AccessMeta, Account } from '../firebase/models';
import { insist } from '../errors';
import { hashPassword, hashToken } from '../security-primitives';
const recoveryInput = z
  .object({
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    username: z
      .string()
      .trim()
      .min(3)
      .max(100)
      .regex(/^[a-zA-Z0-9@._-]+$/)
      .transform((v) => v.toLowerCase()),
    name: z.string().trim().min(1).max(160),
    password: z.string().min(12).max(128),
  })
  .strict();
const invalidLink =
  'This setup link is invalid, expired, or already used. Generate a new link from your project terminal.';
export async function issueOwnerRecovery() {
  const token = randomBytes(32).toString('base64url');
  await transaction(async (tx) => {
    insist(
      await tx.get('meta', 'access'),
      'Initialize the workspace first: npm run db:migrate.',
      503,
    );
    await tx.update('meta', 'access', {
      recovery_hash: hashToken(token),
      recovery_expires_at: new Date(Date.now() + 30 * 60000).toISOString(),
      recovery_consumed_at: null,
    });
    await accessAudit(tx, 'owner_recovery_link_issued');
  });
  return token;
}
export async function redeemOwnerRecovery(body: unknown, address: string) {
  const input = recoveryInput.parse(body),
    tokenHash = hashToken(input.token);
  const valid = (m: AccessMeta | undefined) =>
    m?.recovery_hash === tokenHash &&
    !m.recovery_consumed_at &&
    !!m.recovery_expires_at &&
    m.recovery_expires_at > now();
  await transaction(async (tx) =>
    insist(valid(await tx.get<AccessMeta>('meta', 'access')), invalidLink, 403),
  );
  const password_hash = await hashPassword(input.password);
  return transaction(async (tx) => {
    const meta = await tx.get<AccessMeta>('meta', 'access');
    insist(valid(meta), invalidLink, 403);
    const existing = meta!.owner_id ? await tx.get<Account>('owners', meta!.owner_id) : undefined;
    const owner = existing
      ? await tx.update('owners', existing.id, {
          username: input.username,
          display_name: input.name,
          password_hash,
          session_version: existing.session_version + 1,
        })
      : await tx.create(
          'owners',
          newRow({
            username: input.username,
            display_name: input.name,
            password_hash,
            session_version: 0,
          }),
        );
    await tx.update('meta', 'access', {
      owner_id: owner.id,
      recovery_consumed_at: now(),
      auth_epoch: meta!.auth_epoch + 1,
    });
    for (const key of [
      'username:' + input.username,
      'username:' + (existing?.username || input.username),
      'ip:' + address,
    ])
      await tx.remove('login_limits', hashToken(key));
    await accessAudit(tx, existing ? 'owner_credentials_recovered' : 'owner_initialized');
    return {
      ok: true,
      message: 'Owner credentials saved. Sign in with your new username and password.',
    };
  });
}
