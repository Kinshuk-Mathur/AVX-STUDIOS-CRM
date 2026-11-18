import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { fixture } from './firestore-fixture';
import { transaction, get, list, newRow } from '../src/server/firebase/store';
import { login, sessionState, hashToken } from '../src/server/security';
import { issueOwnerRecovery, redeemOwnerRecovery } from '../src/server/services/owner-recovery';
import {
  saveClient,
  saveProject,
  saveTask,
  addExpense,
  saveCategory,
} from '../src/server/services/catalog';
import {
  createDocument,
  recordPayment,
  invoiceBalance,
  refundPayment,
  documentAction,
} from '../src/server/services/finance';
import { saveViewer, decideAccess, viewerAction } from '../src/server/services/viewers';
import { listRecords, recordDetail, dashboard, search } from '../src/server/services/queries';
import { getPdf, uploadAttachment, getAttachment } from '../src/server/services/files';
import { allocate, paise, invoiceTotal } from '../src/lib/money';
import { today, type Principal } from '../src/lib/domain';
import type { Receipt, FinancialDocument } from '../src/server/firebase/models';
import { GET as events } from '../src/app/api/events/route';
import { pendingRequests } from '../src/server/services/viewers';
import { GET, POST } from '../src/app/api/[...path]/route';

test('Firestore financial and access-control integration', async (t) => {
  t.after(await fixture());
  const password = 'integration-' + randomUUID();
  await redeemOwnerRecovery(
    { token: await issueOwnerRecovery(), username: 'owner', name: 'Test owner', password },
    'local',
  );
  const signedIn = await login('owner', password, false, 'Test browser');
  const state = await sessionState(signedIn.token);
  assert.ok(state.principal);
  const owner = state.principal;
  const serviceId = (await list('service_categories', [['name', '==', 'Video Editing']]))[0].id;
  let clientId: string, projectId: string, invoiceId: string, paymentId: string, receiptId: string;
  const paymentBody = () => ({
    idempotencyKey: randomUUID(),
    clientId,
    projectId,
    invoiceId,
    amount: '8000',
    paymentDate: today(),
    method: 'UPI',
    transactionRef: 'TEST-UTR-8000',
    description: 'Milestone payment',
  });
  await t.test('owner login, catalog validation and linked project/task records', async () => {
    assert.equal(owner.role, 'owner');
    await assert.rejects(login('owner', 'incorrect password', false, 'Test'), /Unable to sign in/);
    await assert.rejects(
      saveCategory(owner, { name: 'Video Editing', color: '#ffffff', active: true }),
      /exists/,
    );
    clientId = String(
      (
        await saveClient(owner, {
          name: 'Integration Client',
          company: 'Test Company',
          email: 'client@example.test',
          profile: { address: 'Test address' },
          status: 'Active',
        })
      ).id,
    );
    await assert.rejects(
      saveProject(owner, {
        name: 'Missing client',
        clientId: randomUUID(),
        items: [{ serviceId, description: 'Edit', amount: '20' }],
      }),
      /client|Client/,
    );
    projectId = String(
      (
        await saveProject(owner, {
          name: 'Test Film',
          clientId,
          items: [{ serviceId, description: 'Film edit', amount: '20000' }],
          startDate: today(),
          deadline: today(),
        })
      ).id,
    );
    await saveTask(owner, { title: 'First cut', projectId, status: 'Completed', dueDate: today() });
    assert((await listRecords(owner, 'clients')).some((c) => c.id === clientId));
    assert(
      ((await recordDetail(owner, 'clients', clientId)).projects as { id: string }[]).some(
        (p) => p.id === projectId,
      ),
    );
  });
  await t.test('invoice and partial payment atomically update revenue and balances', async () => {
    const invoice = await createDocument(owner, {
      kind: 'invoice',
      clientId,
      projectId,
      issueDate: today(),
      dueDate: today(),
      items: [{ serviceId, description: 'Film edit', quantity: 1, rate: '20000' }],
    });
    invoiceId = invoice.id;
    assert.match(invoice.number, /AVX-INV-\d{4}-0001/);
    const result = await recordPayment(owner, paymentBody());
    paymentId = result.id;
    receiptId = result.receipt_id;
    const dash = await dashboard(owner, today(), today());
    assert.equal((dash.totals as Record<string, string>).all_time, '800000');
    assert.equal(
      (dash.services as { id: string; amount: string }[]).find((s) => s.id === serviceId)!.amount,
      '800000',
    );
    assert.equal(
      (await transaction((tx) => invoiceBalance(tx, invoiceId), owner)).balance,
      1200000n,
    );
  });
  await t.test('private receipt PDF and snapshot remain unchanged after client edits', async () => {
    const receipt = await get<Receipt>('receipts', receiptId, owner);
    assert.equal(receipt!.snapshot.total, '800000');
    assert.equal(receipt!.snapshot.client.name, 'Integration Client');
    const pdf = await getPdf(owner, 'receipts', receiptId);
    const bytes = Buffer.from(pdf.pdf_base64, 'base64');
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    assert((await PDFDocument.load(bytes)).getPageCount() >= 1);
    await saveClient(
      owner,
      { name: 'Renamed Client', company: 'Changed', email: 'new@example.test' },
      clientId,
    );
    assert.equal(
      (await get<Receipt>('receipts', receiptId, owner))!.snapshot.client.name,
      'Integration Client',
    );
    assert.equal((await getPdf(owner, 'receipts', receiptId)).pdf_base64, pdf.pdf_base64);
  });
  await t.test('settlement, overpayment protection and concurrent idempotent retries', async () => {
    await recordPayment(owner, {
      ...paymentBody(),
      amount: '12000',
      transactionRef: 'TEST-UTR-12000',
    });
    const invoice = (await listRecords(owner, 'invoices')).find((i) => i.id === invoiceId)!;
    assert.equal(invoice.status, 'Paid');
    assert.equal(invoice.balance, '0');
    const request = {
      ...paymentBody(),
      invoiceId: null,
      amount: '10',
      transactionRef: 'TEST-IDEMPOTENT',
    };
    const [a, b] = await Promise.all([
      recordPayment(owner, request),
      recordPayment(owner, request),
    ]);
    assert.equal(a.id, b.id);
    await assert.rejects(recordPayment(owner, { ...request, amount: '11' }), /already used/);
    await assert.rejects(
      recordPayment(owner, { ...request, idempotencyKey: randomUUID() }),
      /reference|exists/,
    );
    await assert.rejects(
      recordPayment(owner, { ...paymentBody(), amount: '1', transactionRef: 'OVERPAY' }),
      /remaining invoice/,
    );
    assert.equal(
      (await list('payments', [['idempotency_key', '==', request.idempotencyKey]], owner)).length,
      1,
    );
  });
  const viewerPassword = 'viewer-' + randomUUID();
  let viewerId: string, viewerToken: string, viewerSession: string, viewer: Principal;
  await t.test(
    'viewer login is pending; owner approval applies to exactly one device',
    async () => {
      viewerId = (
        await saveViewer(owner, {
          name: 'Krishna',
          username: 'krishna@avxstudio',
          password: viewerPassword,
          permissions: ['overview', 'projects', 'tasks'],
        })
      ).id;
      viewerToken = (await login('krishna@avxstudio', viewerPassword, true, 'Device A')).token;
      assert.equal((await sessionState(viewerToken)).status, 'pending');
      viewerSession = String((await get('session_tokens', hashToken(viewerToken)))!.session_id);
      const context = { params: Promise.resolve({ path: ['projects'] }) };
      assert.equal(
        (
          await GET(
            new Request('http://localhost:3000/api/projects', {
              headers: { cookie: 'avx_session=' + viewerToken },
            }),
            context,
          )
        ).status,
        401,
      );
      assert.equal((await pendingRequests(owner))[0].id, viewerSession);
      const abort = new AbortController();
      const stream = await events(
        new Request('http://localhost:3000/api/events', {
          headers: { cookie: 'avx_session=' + viewerToken },
          signal: abort.signal,
        }),
      );
      const reader = stream.body!.getReader();
      const read = async () =>
        Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            const timer = setTimeout(() => reject(new Error('Session event timed out')), 10000);
            timer.unref();
          }),
        ]);
      try {
        const first = await read();
        assert.match(new TextDecoder().decode(first.value), /"status":"pending"/);
        await decideAccess(owner, viewerSession, 'approve');
        let approved = false;
        for (let attempt = 0; attempt < 5 && !approved; attempt++) {
          const next = await read();
          assert.equal(next.done, false);
          approved = new TextDecoder().decode(next.value).includes('"status":"approved"');
        }
        assert.equal(approved, true, 'approval must reach the live event stream');
      } finally {
        abort.abort();
        await reader.cancel();
      }

      const approved = await sessionState(viewerToken);
      assert.ok(approved.principal);
      viewer = approved.principal;
      assert.equal(viewer.role, 'viewer');
      assert.deepEqual(viewer.permissions.sort(), ['overview', 'projects', 'tasks']);
      const deviceB = await login('krishna@avxstudio', viewerPassword, true, 'Device B');
      assert.equal((await sessionState(deviceB.token)).status, 'pending');
      assert.equal((await sessionState(viewerToken)).status, 'approved');
      await decideAccess(
        owner,
        String((await get('session_tokens', hashToken(deviceB.token)))!.session_id),
        'reject',
      );
      assert.equal((await sessionState(deviceB.token)).status, 'rejected');
    },
  );
  await t.test(
    'API and repository enforce owner-only mutations and permission redaction',
    async () => {
      await assert.rejects(saveClient(viewer, { name: 'Unauthorized' }), /Owner access/);
      for (const table of ['clients', 'service_categories'])
        await assert.rejects(
          transaction((tx) => tx.create(table, newRow({ name: 'Forbidden' })), viewer),
          /Owner access/,
        );
      await assert.rejects(
        transaction((tx) => tx.update('projects', projectId, { name: 'Tampered' }), viewer),
        /Owner access/,
      );
      const response = await POST(
        new Request('http://localhost:3000/api/clients', {
          method: 'POST',
          headers: {
            origin: 'http://localhost:3000',
            cookie: 'avx_session=' + viewerToken,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ name: 'Unauthorized' }),
        }),
        { params: Promise.resolve({ path: ['clients'] }) },
      );
      assert.equal(response.status, 403);
      await assert.rejects(listRecords(viewer, 'payments'), /not available/);
      await assert.rejects(getPdf(viewer, 'receipts', receiptId), /not available|permissions/);
      await assert.rejects(uploadAttachment(viewer, {}), /Owner access/);
      const dash = await dashboard(viewer, today(), today());
      assert.equal(dash.financial, false);
      assert.equal(dash.totals, undefined);
      assert.equal(dash.transactions, undefined);
      const project = (await listRecords(viewer, 'projects'))[0];
      for (const key of ['value', 'received', 'notes', 'items', 'received_paise', 'value_paise'])
        assert.equal(project[key], undefined, key);
      assert.equal(project.client_name, null);
      assert.equal((await search(viewer, 'AVX-PAY')).length, 0);
      assert.equal((await list('payments', [], viewer)).length, 0);
      const partial: Principal = {
        ...viewer,
        permissions: ['overview', 'projects', 'payments', 'invoices', 'expenses', 'analytics'],
      };
      await assert.rejects(getPdf(partial, 'receipts', receiptId), /permissions/);
      assert.equal((await list('receipts', [], partial)).length, 0);
      assert.equal((await dashboard(partial, today(), today())).financial, false);
    },
  );
  await t.test('revocation, expiration and account changes invalidate sessions', async () => {
    await decideAccess(owner, viewerSession, 'revoke');
    assert.equal((await sessionState(viewerToken)).status, 'revoked');
    const expired = (await login('krishna@avxstudio', viewerPassword, true, 'Expired')).token;
    const id = String((await get('session_tokens', hashToken(expired)))!.session_id);
    await transaction((tx) =>
      tx.update('sessions', id, { request_expires_at: new Date(Date.now() - 60000).toISOString() }),
    );
    assert.equal((await sessionState(expired)).status, 'expired');
    await assert.rejects(decideAccess(owner, id, 'approve'), /expired|handled/);
    const active = (await login('krishna@avxstudio', viewerPassword, true, 'Active')).token;
    await viewerAction(owner, viewerId, 'revoke');
    assert.equal((await sessionState(active)).status, 'revoked');
  });
  await t.test(
    'refunds, service allocations, immutable history and analytics reconcile',
    async () => {
      const request = {
        idempotencyKey: randomUUID(),
        amount: '1234.56',
        refundDate: today(),
        reason: 'Audited correction',
      };
      const [a, b] = await Promise.all([
        refundPayment(owner, paymentId, request),
        refundPayment(owner, paymentId, request),
      ]);
      assert.equal(a.id, b.id);
      await assert.rejects(
        refundPayment(owner, paymentId, { ...request, amount: '1' }),
        /already used/,
      );
      await assert.rejects(
        refundPayment(owner, paymentId, {
          ...request,
          idempotencyKey: randomUUID(),
          amount: '8000',
        }),
        /remaining|exceed|balance/,
      );
      await addExpense(owner, {
        name: 'Software',
        amount: '500.25',
        expenseDate: today(),
        category: 'Software',
        method: 'Card',
      });
      const dash = await dashboard(owner, today(), today()),
        totals = dash.totals as Record<string, string>;
      assert.equal(totals.all_time, '1877544');
      assert.equal(totals.expenses, '50025');
      assert.equal(totals.profit, '1827519');
      const allocated = (dash.services as { amount: string }[]).reduce(
        (sum, s) => sum + BigInt(s.amount),
        0n,
      );
      assert.equal(allocated, BigInt(totals.all_time));
      assert.equal(
        (await transaction((tx) => invoiceBalance(tx, invoiceId), owner)).balance,
        123456n,
      );
      await assert.rejects(
        transaction((tx) => tx.update('payments', paymentId, { amount_paise: '1' }), owner),
        /immutable/,
      );
      await assert.rejects(
        transaction((tx) => tx.remove('receipts', receiptId), owner),
        /immutable/,
      );
    },
  );
  await t.test('quotation converts once; draft issue refreshes the PDF snapshot', async () => {
    const body = {
      clientId,
      issueDate: today(),
      dueDate: today(),
      items: [{ serviceId, description: 'New film', quantity: 1, rate: '1000' }],
    };
    const quote = await createDocument(owner, { ...body, kind: 'quotation' });
    await documentAction(owner, quote.id, 'accept');
    const results = await Promise.allSettled([
      documentAction(owner, quote.id, 'convert'),
      documentAction(owner, quote.id, 'convert'),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const draft = await createDocument(owner, {
      ...body,
      kind: 'invoice',
      status: 'Draft',
      projectId,
    });
    await documentAction(owner, draft.id, 'issue');
    assert.equal(
      (await get<FinancialDocument>('documents', draft.id, owner))!.snapshot.details.find(
        (d) => d.label === 'Status at issue',
      )!.value,
      'Issued',
    );
  });
  await t.test(
    'large attachments stay outside Firestore and cannot be read by viewers',
    async () => {
      const bytes = Buffer.alloc(2 * 1024 * 1024);
      bytes.write('%PDF-1.7');
      const file = await uploadAttachment(owner, {
        section: 'clients',
        recordId: clientId,
        name: 'large.pdf',
        mime: 'application/pdf',
        content: bytes.toString('base64'),
      });
      const saved = await getAttachment(owner, String(file.id));
      assert.equal(Buffer.from(String(saved.content_base64), 'base64').length, bytes.length);
      const metadata = await get('attachments', String(file.id));
      assert.equal(metadata!.content_base64, undefined);
      await assert.rejects(getAttachment(viewer, String(file.id)), /Owner access/);
    },
  );
  await t.test('cross-origin writes and unauthenticated Firestore reads are denied', async () => {
    const response = await POST(
      new Request('http://localhost:3000/api/clients', {
        method: 'POST',
        headers: { origin: 'https://attacker.example' },
        body: '{}',
      }),
      { params: Promise.resolve({ path: ['clients'] }) },
    );
    assert.equal(response.status, 403);
    const url =
      'http://' +
      process.env.FIRESTORE_EMULATOR_HOST +
      '/v1/projects/demo-avx-tests/databases/(default)/documents/avx_workspaces/' +
      process.env.AVX_WORKSPACE_ID +
      '/clients/' +
      clientId;
    assert.equal((await fetch(url)).status, 403);
  });
});
test('exact monetary arithmetic and largest-remainder allocation', () => {
  assert.equal(paise('8000.01'), 800001n);
  for (const input of ['0.001', '-1', '1e3']) assert.throws(() => paise(input));
  assert.deepEqual(
    allocate(100n, [
      { id: 'a', weight: 1n },
      { id: 'b', weight: 1n },
      { id: 'c', weight: 1n },
    ]).map((a) => a.amount),
    [34n, 33n, 33n],
  );
  assert.equal(invoiceTotal([{ quantity: 3, rate: '0.10' }], '0', 1800).total, 35n);
  assert.throws(() => invoiceTotal([{ quantity: 1, rate: '1' }], '2', 0));
});
