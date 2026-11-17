import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { one, transaction } from '../db';
import { insist } from '../errors';
import { hashPassword, hashToken } from '../security';

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

// Only the trusted server CLI imports this issuer. It is never exposed by an HTTP route.
export async function issueOwnerRecovery() {
  const token = randomBytes(32).toString('base64url');
  await transaction(async (tx) => {
    await tx.query('LOCK TABLE owner_recovery_tokens IN EXCLUSIVE MODE');
    await tx.query('UPDATE owner_recovery_tokens SET consumed_at=now() WHERE consumed_at IS NULL');
    await tx.query(
      "INSERT INTO owner_recovery_tokens(token_hash,expires_at) VALUES($1,now()+interval '30 minutes')",
      [hashToken(token)],
    );
    await tx.query("INSERT INTO access_audit_logs(event) VALUES('owner_recovery_link_issued')");
  });
  return token;
}

export async function redeemOwnerRecovery(body: unknown, address: string) {
  const input = recoveryInput.parse(body);
  const tokenHash = hashToken(input.token);
  const valid = await transaction((tx) =>
    one(
      tx,
      'SELECT token_hash FROM owner_recovery_tokens WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now()',
      [tokenHash],
    ),
  );
  insist(valid, invalidLink, 403);
  const passwordHash = await hashPassword(input.password);
  return transaction(async (tx) => {
    // Lock and recheck after hashing: concurrent submissions can consume a link only once.
    const token = await one(
      tx,
      'SELECT token_hash FROM owner_recovery_tokens WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE',
      [tokenHash],
    );
    insist(token, invalidLink, 403);
    await tx.query('LOCK TABLE owners IN EXCLUSIVE MODE');
    const existing = await one<{ id: string; username: string }>(
      tx,
      'SELECT id,username FROM owners LIMIT 1',
    );
    if (existing) {
      await tx.query('UPDATE owners SET username=$1,display_name=$2,password_hash=$3 WHERE id=$4', [
        input.username,
        input.name,
        passwordHash,
        existing.id,
      ]);
    } else {
      await tx.query('INSERT INTO owners(username,display_name,password_hash) VALUES($1,$2,$3)', [
        input.username,
        input.name,
        passwordHash,
      ]);
    }
    await tx.query(
      "UPDATE sessions SET status='revoked',revoked_at=now() WHERE status IN('pending','approved')",
    );
    await tx.query('UPDATE owner_recovery_tokens SET consumed_at=now() WHERE token_hash=$1', [
      tokenHash,
    ]);
    for (const key of [
      `username:${input.username}`,
      `username:${existing?.username || input.username}`,
      `ip:${address}`,
    ]) {
      await tx.query('DELETE FROM login_limits WHERE key=$1', [hashToken(key)]);
    }
    await tx.query('INSERT INTO access_audit_logs(event) VALUES($1)', [
      existing ? 'owner_credentials_recovered' : 'owner_initialized',
    ]);
    return {
      ok: true,
      message: 'Owner credentials saved. Sign in with your new username and password.',
    };
  });
}
