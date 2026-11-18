import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { fixture } from './firestore-fixture';
import { issueOwnerRecovery, redeemOwnerRecovery } from '../src/server/services/owner-recovery';
import { transaction, get, list, workspace } from '../src/server/firebase/store';
import { login, sessionState, hashToken } from '../src/server/security';
import { saveClient } from '../src/server/services/catalog';
import { importLegacySetup } from '../src/server/firebase/import-legacy-setup';
import { POST } from '../src/app/api/[...path]/route';

test('trusted one-use owner setup and recovery', async (t) => {
  t.after(await fixture());
  let password = 'recovery-' + randomUUID();
  const token = await issueOwnerRecovery();
  const stored = await get('meta', 'access');
  assert.equal(stored!.recovery_hash, hashToken(token));
  assert.notEqual(stored!.recovery_hash, token);
  await redeemOwnerRecovery(
    { token, username: 'owner', name: 'Original Owner', password },
    'local',
  );
  const previousSession = (await login('owner', password, false, 'Test')).token;
  const state = await sessionState(previousSession);
  assert.ok(state.principal);
  const originalOwner = state.principal;
  const clientId = String((await saveClient(originalOwner, { name: 'Preserved client' })).id);
  await t.test('used, invalid, expired and replaced links never change credentials', async () => {
    const payload = { username: 'other', name: 'Other', password };
    for (const invalid of [token, randomBytes(32).toString('base64url')])
      await assert.rejects(
        redeemOwnerRecovery({ ...payload, token: invalid }, 'local'),
        /invalid, expired, or already used/,
      );
    const expired = await issueOwnerRecovery();
    await transaction((tx) =>
      tx.update('meta', 'access', {
        recovery_expires_at: new Date(Date.now() - 60000).toISOString(),
      }),
    );
    await assert.rejects(
      redeemOwnerRecovery({ ...payload, token: expired }, 'local'),
      /invalid, expired, or already used/,
    );
    const old = await issueOwnerRecovery();
    await issueOwnerRecovery();
    await assert.rejects(
      redeemOwnerRecovery({ ...payload, token: old }, 'local'),
      /invalid, expired, or already used/,
    );
    assert.equal((await sessionState(previousSession)).status, 'approved');
  });
  await t.test(
    'concurrent recovery preserves owner ID and data and revokes old sessions',
    async () => {
      const token = await issueOwnerRecovery(),
        oldPassword = password;
      password = 'new-' + randomUUID();
      const payload = { token, username: 'kinshuk@avxstudios', name: 'Kinshuk', password };
      const results = await Promise.allSettled([
        redeemOwnerRecovery(payload, 'local'),
        redeemOwnerRecovery(payload, 'local'),
      ]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal((await sessionState(previousSession)).status, 'revoked');
      await assert.rejects(login('owner', oldPassword, false, 'Test'), /Unable to sign in/);
      const session = await login(payload.username, password, false, 'Test');
      const recovered = await sessionState(session.token);
      assert.ok(recovered.principal);
      assert.equal(recovered.principal.id, originalOwner.id);
      assert.equal((await get('clients', clientId, recovered.principal))!.name, 'Preserved client');
      assert.equal((await list('owners')).length, 1);
      assert.equal(
        await get('meta', 'access', {
          ...recovered.principal,
          role: 'viewer',
          permissions: ['overview'],
        }),
        undefined,
      );
    },
  );
  await t.test(
    'legacy setup import preserves credentials and refuses overwriting another workspace',
    async () => {
      const source = {
        owners: await list('owners'),
        viewer_accounts: [],
        viewer_permissions: [],
        service_categories: await list('service_categories'),
        agency_settings: await list('agency_settings'),
        access_audit_logs: await list('access_audit_logs'),
        sessions: [],
        counters: [],
      };
      const original = process.env.AVX_WORKSPACE_ID;
      process.env.AVX_WORKSPACE_ID = 'import-' + randomUUID();
      try {
        assert.equal((await importLegacySetup(source)).alreadyImported, false);
        const imported = await login('kinshuk@avxstudios', password, false, 'Imported');
        const importedState = await sessionState(imported.token);
        assert.ok(importedState.principal);
        assert.equal(importedState.principal.id, originalOwner.id);
        assert.equal((await importLegacySetup(source)).alreadyImported, true);
        await assert.rejects(importLegacySetup({ ...source, owners: [] }), /already initialized/);
        assert.equal((await list('owners')).length, 1);
      } finally {
        const importedRoot = await workspace();
        await importedRoot.firestore.recursiveDelete(importedRoot);
        process.env.AVX_WORKSPACE_ID = original;
      }
    },
  );
  await t.test(
    'HTTP recovery validates origin and one-use token; no public issuer exists',
    async () => {
      const payload = {
        token: await issueOwnerRecovery(),
        username: 'kinshuk@avxstudios',
        name: 'Kinshuk',
        password,
      };
      const call = (origin: string, path = 'owner-setup', body: unknown = payload) =>
        POST(
          new Request('http://localhost:3000/api/auth/' + path, {
            method: 'POST',
            headers: { origin },
            body: JSON.stringify(body),
          }),
          { params: Promise.resolve({ path: ['auth', path] }) },
        );
      assert.equal((await call('https://other.example')).status, 403);
      const good = await call('http://localhost:3000');
      assert.equal(good.status, 200);
      assert.match(good.headers.get('set-cookie')!, /Max-Age=0/);
      assert.equal((await call('http://localhost:3000', 'owner-setup-link', {})).status, 401);
    },
  );
});
