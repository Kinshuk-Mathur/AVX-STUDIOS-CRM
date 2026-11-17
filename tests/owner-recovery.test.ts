import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { issueOwnerRecovery, redeemOwnerRecovery } from '../src/server/services/owner-recovery';
import { transaction, one, closeDb } from '../src/server/db';
import { login, sessionState, hashToken } from '../src/server/security';
import { saveClient } from '../src/server/services/catalog';
import { POST } from '../src/app/api/[...path]/route';

process.env.PGLITE_DATA_DIR = 'memory://';
delete process.env.DATABASE_URL;
process.env.APP_ORIGIN = 'http://localhost:3000';

test('trusted one-use owner setup and recovery', async (t) => {
  let originalOwnerId: string;
  let previousSession: string;
  let clientId: string;
  let password = 'recovery-' + randomUUID();
  t.after(closeDb);
  {
    await t.test('a private token creates exactly one owner and stores only its hash', async () => {
      const token = await issueOwnerRecovery();
      const stored = await transaction((tx) =>
        one<{ token_hash: string }>(
          tx,
          'SELECT token_hash FROM owner_recovery_tokens WHERE consumed_at IS NULL',
        ),
      );
      assert.equal(stored!.token_hash, hashToken(token));
      assert.notEqual(stored!.token_hash, token);
      await redeemOwnerRecovery(
        { token, username: 'owner', name: 'Original Owner', password },
        'local',
      );
      const signedIn = await login('owner', password, false, 'Test');
      previousSession = signedIn.token;
      const ownerState = await sessionState(previousSession);
      assert.equal(ownerState.status, 'approved');
      assert.ok(ownerState.principal);
      const owner = ownerState.principal;
      originalOwnerId = owner.id;
      clientId = String((await saveClient(owner, { name: 'Preserved client' })).id);
      await assert.rejects(
        redeemOwnerRecovery({ token, username: 'attacker', name: 'Other', password }, 'local'),
        /invalid, expired, or already used/,
      );
    });
    await t.test('invalid and expired tokens never change credentials', async () => {
      await assert.rejects(
        redeemOwnerRecovery(
          {
            token: randomBytes(32).toString('base64url'),
            username: 'other',
            name: 'Other',
            password,
          },
          'local',
        ),
        /invalid, expired, or already used/,
      );
      const token = await issueOwnerRecovery();
      await transaction((tx) =>
        tx.query(
          "UPDATE owner_recovery_tokens SET expires_at=now()-interval '1 minute' WHERE token_hash=$1",
          [hashToken(token)],
        ),
      );
      await assert.rejects(
        redeemOwnerRecovery({ token, username: 'other', name: 'Other', password }, 'local'),
        /invalid, expired, or already used/,
      );
      assert.equal((await sessionState(previousSession)).status, 'approved');
    });
    await t.test('issuing a new link invalidates older unconsumed links', async () => {
      const old = await issueOwnerRecovery();
      const fresh = await issueOwnerRecovery();
      await assert.rejects(
        redeemOwnerRecovery({ token: old, username: 'other', name: 'Other', password }, 'local'),
        /invalid, expired, or already used/,
      );
      const count = await transaction((tx) =>
        one<{ count: string }>(
          tx,
          'SELECT count(*)::text AS count FROM owner_recovery_tokens WHERE consumed_at IS NULL',
        ),
      );
      assert.equal(count!.count, '1');
      assert.notEqual(fresh, old);
    });
    await t.test(
      'recovery keeps the owner ID and records, revokes sessions, and permits one concurrent redemption',
      async () => {
        const token = await issueOwnerRecovery();
        const oldPassword = password;
        password = 'new-' + randomUUID();
        const payload = { token, username: 'kinshuk@avxstudios', name: 'Kinshuk', password };
        const results = await Promise.allSettled([
          redeemOwnerRecovery(payload, 'local'),
          redeemOwnerRecovery(payload, 'local'),
        ]);
        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
        assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
        assert.equal((await sessionState(previousSession)).status, 'revoked');
        await assert.rejects(login('owner', oldPassword, false, 'Test'), /Unable to sign in/);
        const session = await login(payload.username, password, false, 'Test');
        const recoveredState = await sessionState(session.token);
        assert.equal(recoveredState.status, 'approved');
        assert.ok(recoveredState.principal);
        const principal = recoveredState.principal;
        assert.equal(principal.id, originalOwnerId);
        const client = await transaction(
          (tx) => one<{ name: string }>(tx, 'SELECT name FROM clients WHERE id=$1', [clientId]),
          principal,
        );
        assert.equal(client!.name, 'Preserved client');
        const count = await transaction((tx) =>
          one<{ count: string }>(tx, 'SELECT count(*)::text AS count FROM owners'),
        );
        assert.equal(count!.count, '1');
        await assert.rejects(
          transaction((tx) => tx.query('SELECT token_hash FROM owner_recovery_tokens'), {
            ...principal,
            role: 'viewer',
            permissions: ['overview'],
          }),
          /permission denied/,
        );
      },
    );
    await t.test(
      'HTTP recovery rejects cross-origin requests and requires the one-use token',
      async () => {
        const token = await issueOwnerRecovery();
        const context = { params: Promise.resolve({ path: ['auth', 'owner-setup'] }) };
        const payload = { token, username: 'kinshuk@avxstudios', name: 'Kinshuk', password };
        const bad = await POST(
          new Request('http://localhost:3000/api/auth/owner-setup', {
            method: 'POST',
            headers: { origin: 'https://other.example' },
            body: JSON.stringify(payload),
          }),
          context,
        );
        assert.equal(bad.status, 403);
        const good = await POST(
          new Request('http://localhost:3000/api/auth/owner-setup', {
            method: 'POST',
            headers: { origin: 'http://localhost:3000' },
            body: JSON.stringify(payload),
          }),
          context,
        );
        assert.equal(good.status, 200);
        assert.match(good.headers.get('set-cookie')!, /Max-Age=0/);
        const publicIssuer = await POST(
          new Request('http://localhost:3000/api/auth/owner-setup-link', {
            method: 'POST',
            headers: { origin: 'http://localhost:3000' },
            body: '{}',
          }),
          { params: Promise.resolve({ path: ['auth', 'owner-setup-link'] }) },
        );
        assert.equal(publicIssuer.status, 401);
      },
    );
  }
});
