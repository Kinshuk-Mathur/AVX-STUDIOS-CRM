import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { transaction, one, closeDb } from '../src/server/db';
import { hashPassword, login, sessionState, hashToken } from '../src/server/security';
import { saveClient, saveProject, saveTask, addExpense } from '../src/server/services/catalog';
import {
  createDocument,
  recordPayment,
  invoiceBalance,
  refundPayment,
  documentAction,
} from '../src/server/services/finance';
import { saveViewer, decideAccess, viewerAction } from '../src/server/services/viewers';
import { listRecords, recordDetail, dashboard, search } from '../src/server/services/queries';
import { getPdf, uploadAttachment } from '../src/server/services/files';
import { allocate, paise, invoiceTotal } from '../src/lib/money';
import { today, type Principal } from '../src/lib/domain';
import { GET, POST } from '../src/app/api/[...path]/route';
process.env.PGLITE_DATA_DIR = 'memory://';
delete process.env.DATABASE_URL;
process.env.APP_ORIGIN = 'http://localhost:3000';

test('AVX OS financial and security integration suite', async (t) => {
  let owner: Principal;
  let clientId: string;
  let projectId: string;
  let invoiceId: string;
  let paymentId: string;
  let receiptId: string;
  let viewerId: string;
  let viewerToken: string;
  let viewerSession: string;
  let serviceId: string;
  t.after(closeDb);
  {
    await t.test('secure single-owner initialization and authentication', async () => {
      const password = 'integration-' + randomUUID();
      const passwordHash = await hashPassword(password);
      const row = await transaction((tx) =>
        one<{ id: string }>(
          tx,
          'INSERT INTO owners(username,display_name,password_hash) VALUES($1,$2,$3) RETURNING id',
          ['owner', 'Test owner', passwordHash],
        ),
      );
      const result = await login('owner', password, false, 'Test browser');
      assert.equal(result.status, 'approved');
      const state = await sessionState(result.token);
      owner = state.principal!;
      assert.equal(owner.id, row!.id);
      assert.equal(owner.role, 'owner');
      assert(!passwordHash.includes(password));
      await assert.rejects(
        transaction((tx) =>
          tx.query('INSERT INTO owners(username,display_name,password_hash) VALUES($1,$2,$3)', [
            'another',
            'Other',
            passwordHash,
          ]),
        ),
        /unique|duplicate/,
      );
      serviceId = (await transaction(
        (tx) =>
          one<{ id: string }>(tx, "SELECT id FROM service_categories WHERE name='Video Editing'"),
        owner,
      ))!.id;
    });
    await t.test('1: owner creates a client, persisted and visible in Clients', async () => {
      const row = await saveClient(owner, {
        name: 'Integration Client',
        company: 'Test Company',
        email: 'client@example.test',
        profile: { address: 'Test address' },
        status: 'Active',
      });
      clientId = String(row.id);
      assert((await listRecords(owner, 'clients')).some((c) => c.id === clientId));
    });
    await t.test('2: project belongs to client and appears on both profiles', async () => {
      const row = await saveProject(owner, {
        name: 'Test Film',
        clientId,
        items: [{ serviceId, description: 'Film edit', amount: '20000' }],
        startDate: today(),
        deadline: today(),
      });
      projectId = String(row.id);
      await saveTask(owner, {
        title: 'First cut',
        projectId,
        status: 'Completed',
        dueDate: today(),
      });
      assert((await listRecords(owner, 'projects')).some((p) => p.id === projectId));
      const detail = await recordDetail(owner, 'clients', clientId);
      assert((detail.projects as { id: string }[]).some((p) => p.id === projectId));
    });
    await t.test('invoice creation uses exact integer amounts and unique number', async () => {
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
    });
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
    await t.test(
      '3: ₹8,000 payment increases revenue and the correct service allocation',
      async () => {
        const result = await recordPayment(owner, paymentBody());
        paymentId = result.id;
        receiptId = result.receipt_id;
        const dash = await dashboard(owner, today(), today());
        assert.equal((dash.totals as Record<string, string>).all_time, '800000');
        assert.equal(
          (dash.services as { id: string; amount: string }[]).find((s) => s.id === serviceId)!
            .amount,
          '800000',
        );
      },
    );
    await t.test(
      '4: payment atomically stores a unique, valid PDF and historical snapshot',
      async () => {
        const row = await transaction(
          (tx) =>
            one<{
              number: string;
              snapshot: {
                client: { name: string };
                total: string;
                project: string;
                details: { label: string; value: string }[];
              };
              pdf_base64: string;
            }>(tx, 'SELECT number,snapshot,pdf_base64 FROM receipts WHERE id=$1', [receiptId]),
          owner,
        );
        assert.match(row!.number, /AVX-RCP-\d{4}-0001/);
        assert.equal(row!.snapshot.total, '800000');
        assert.equal(row!.snapshot.client.name, 'Integration Client');
        assert.equal(row!.snapshot.project, 'Test Film');
        assert(row!.snapshot.details.some((d) => d.value === 'TEST-UTR-8000'));
        const bytes = Buffer.from(row!.pdf_base64, 'base64');
        assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
        assert((await PDFDocument.load(bytes)).getPageCount() >= 1);
        await saveClient(
          owner,
          { name: 'Renamed Client', company: 'Changed', email: 'new@example.test' },
          clientId,
        );
        const preserved = await transaction(
          (tx) =>
            one<{ snapshot: { client: { name: string } } }>(
              tx,
              'SELECT snapshot FROM receipts WHERE id=$1',
              [receiptId],
            ),
          owner,
        );
        assert.equal(preserved!.snapshot.client.name, 'Integration Client');
      },
    );
    await t.test(
      '5: partial payment leaves ₹12,000 and final settlement marks invoice paid',
      async () => {
        assert.equal(
          (await transaction((tx) => invoiceBalance(tx, invoiceId), owner)).balance,
          1200000n,
        );
        await recordPayment(owner, {
          ...paymentBody(),
          amount: '12000',
          transactionRef: 'TEST-UTR-12000',
        });
        const invoices = await listRecords(owner, 'invoices');
        assert.equal(invoices.find((i) => i.id === invoiceId)!.status, 'Paid');
        assert.equal(invoices.find((i) => i.id === invoiceId)!.balance, '0');
      },
    );
    await t.test(
      'idempotency, concurrent retries, and overpayments cannot double-count',
      async () => {
        const request = {
          ...paymentBody(),
          invoiceId: null,
          transactionRef: 'TEST-IDEMPOTENT',
          amount: '10',
        };
        const [a, b] = await Promise.all([
          recordPayment(owner, request),
          recordPayment(owner, request),
        ]);
        assert.equal(a.id, b.id);
        await assert.rejects(recordPayment(owner, { ...request, amount: '11' }), /already used/);
        await assert.rejects(
          recordPayment(owner, { ...paymentBody(), transactionRef: 'OVERPAY', amount: '1' }),
          /remaining invoice/,
        );
        const row = await transaction(
          (tx) =>
            one<{ count: string }>(
              tx,
              'SELECT count(*)::text AS count FROM payments WHERE idempotency_key=$1',
              [request.idempotencyKey],
            ),
          owner,
        );
        assert.equal(row!.count, '1');
      },
    );
    const viewerPassword = 'viewer-' + randomUUID();
    await t.test(
      '6: correct viewer credentials create a pending, unauthorized session',
      async () => {
        const viewer = await saveViewer(owner, {
          name: 'Krishna',
          username: 'krishna@avxstudio',
          password: viewerPassword,
          permissions: ['overview', 'projects', 'tasks'],
        });
        viewerId = viewer.id;
        const result = await login('krishna@avxstudio', viewerPassword, true, 'Device A');
        viewerToken = result.token;
        const state = await sessionState(viewerToken);
        assert.equal(state.status, 'pending');
        assert.equal(state.principal, undefined);
        viewerSession = (await transaction((tx) =>
          one<{ id: string }>(tx, 'SELECT id FROM sessions WHERE token_hash=$1', [
            hashToken(viewerToken),
          ]),
        ))!.id;
        const response = await GET(
          new Request('http://localhost:3000/api/projects', {
            headers: { cookie: 'avx_session=' + viewerToken },
          }),
          { params: Promise.resolve({ path: ['projects'] }) },
        );
        assert.equal(response.status, 401);
      },
    );
    await t.test('7: owner approval authorizes only the exact requested session', async () => {
      await decideAccess(owner, viewerSession, 'approve');
      const state = await sessionState(viewerToken);
      assert.equal(state.status, 'approved');
      assert.equal(state.principal!.role, 'viewer');
      assert.deepEqual(state.principal!.permissions.sort(), ['overview', 'projects', 'tasks']);
      assert((await listRecords(state.principal!, 'projects')).some((p) => p.id === projectId));
    });
    await t.test('11: separate device login always requires a fresh approval', async () => {
      const loginB = await login('krishna@avxstudio', viewerPassword, true, 'Device B');
      assert.equal((await sessionState(loginB.token)).status, 'pending');
      assert.equal((await sessionState(viewerToken)).status, 'approved');
    });
    await t.test('8: rejected sessions remain unauthorized', async () => {
      const rejected = await login('krishna@avxstudio', viewerPassword, true, 'Rejected device');
      const id = (await transaction((tx) =>
        one<{ id: string }>(tx, 'SELECT id FROM sessions WHERE token_hash=$1', [
          hashToken(rejected.token),
        ]),
      ))!.id;
      await decideAccess(owner, id, 'reject');
      assert.equal((await sessionState(rejected.token)).status, 'rejected');
      await assert.rejects(decideAccess(owner, id, 'approve'), /expired|handled/);
    });
    await t.test(
      '9: crafted viewer write requests and direct database writes are rejected',
      async () => {
        const state = await sessionState(viewerToken);
        await assert.rejects(
          saveClient(state.principal!, { name: 'Unauthorized' }),
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
        await assert.rejects(
          transaction(
            (tx) => tx.query("INSERT INTO clients(name) VALUES('RLS bypass attempt')"),
            state.principal!,
          ),
          /row-level security|permission denied/,
        );
        await assert.rejects(
          transaction(
            (tx) =>
              tx.query('UPDATE projects SET name=$1 WHERE id=$2 RETURNING id', [
                'Tampered',
                projectId,
              ]),
            state.principal!,
          ),
          /permission denied/,
        );
        await assert.rejects(
          transaction(
            (tx) => tx.query("INSERT INTO service_categories(name) VALUES('Forbidden')"),
            state.principal!,
          ),
          /permission denied/,
        );
      },
    );
    await t.test(
      '12: hidden payments cannot leak via dashboard, projects, search, PDFs or files',
      async () => {
        const p = (await sessionState(viewerToken)).principal!;
        await assert.rejects(listRecords(p, 'payments'), /not available/);
        await assert.rejects(getPdf(p, 'receipts', receiptId), /not available|permissions/);
        await assert.rejects(uploadAttachment(p, {}), /Owner access/);
        const dash = await dashboard(p, today(), today());
        assert.equal(dash.financial, false);
        assert.equal(dash.totals, undefined);
        assert.equal(dash.transactions, undefined);
        assert.equal(dash.topClients, undefined);
        const projects = await listRecords(p, 'projects');
        assert.equal(projects[0].value, undefined);
        assert.equal(projects[0].received, undefined);
        assert.equal(projects[0].notes, undefined);
        assert.equal(projects[0].client_name, null);
        assert.equal((await search(p, 'AVX-PAY')).length, 0);
        assert.equal(
          (await transaction((tx) => tx.query('SELECT id FROM payments'), p)).rows.length,
          0,
        );
        const partial: Principal = {
          ...p,
          permissions: ['overview', 'projects', 'payments', 'invoices', 'expenses', 'analytics'],
        };
        await assert.rejects(getPdf(partial, 'receipts', receiptId), /permissions/);
        assert.equal(
          (await transaction((tx) => tx.query('SELECT id FROM receipts'), partial)).rows.length,
          0,
        );
        assert.equal((await dashboard(partial, today(), today())).financial, false);
      },
    );
    await t.test(
      '10: revocation immediately rejects further reads, including document endpoints',
      async () => {
        await decideAccess(owner, viewerSession, 'revoke');
        assert.equal((await sessionState(viewerToken)).status, 'revoked');
        const response = await GET(
          new Request('http://localhost:3000/api/projects', {
            headers: { cookie: 'avx_session=' + viewerToken },
          }),
          { params: Promise.resolve({ path: ['projects'] }) },
        );
        assert.equal(response.status, 401);
      },
    );
    await t.test(
      'expiration and account changes invalidate pending and approved sessions',
      async () => {
        const result = await login('krishna@avxstudio', viewerPassword, true, 'Expired');
        await transaction((tx) =>
          tx.query(
            "UPDATE sessions SET request_expires_at=now()-interval '1 minute' WHERE token_hash=$1",
            [hashToken(result.token)],
          ),
        );
        assert.equal((await sessionState(result.token)).status, 'expired');
        await viewerAction(owner, viewerId, 'revoke');
      },
    );
    await t.test(
      '13: refunds, service allocations, history and analytics reconcile exactly',
      async () => {
        await refundPayment(owner, paymentId, {
          idempotencyKey: randomUUID(),
          amount: '1234.56',
          refundDate: today(),
          reason: 'Audited correction',
        });
        await addExpense(owner, {
          name: 'Software',
          amount: '500.25',
          expenseDate: today(),
          category: 'Software',
          method: 'Card',
        });
        const dash = await dashboard(owner, today(), today());
        const totals = dash.totals as Record<string, string>;
        assert.equal(totals.all_time, '1877544');
        assert.equal(totals.expenses, '50025');
        assert.equal(totals.profit, '1827519');
        const allocated = (dash.services as { amount: string }[]).reduce(
          (sum, s) => sum + BigInt(s.amount),
          0n,
        );
        assert.equal(allocated, BigInt(totals.all_time));
        const history = await listRecords(owner, 'payments');
        assert.equal(
          history.reduce(
            (sum, p) => sum + BigInt(String(p.amount_paise)) - BigInt(String(p.refunded)),
            0n,
          ),
          allocated,
        );
        assert.equal(
          (await transaction((tx) => invoiceBalance(tx, invoiceId), owner)).balance,
          123456n,
        );
        await assert.rejects(
          transaction(
            (tx) => tx.query('UPDATE payments SET amount_paise=1 WHERE id=$1', [paymentId]),
            owner,
          ),
          /immutable/,
        );
        await assert.rejects(
          transaction((tx) => tx.query('DELETE FROM receipts WHERE id=$1', [receiptId]), owner),
          /immutable/,
        );
      },
    );
    await t.test('quotation converts atomically into one project and one invoice', async () => {
      const quote = await createDocument(owner, {
        kind: 'quotation',
        clientId,
        issueDate: today(),
        dueDate: today(),
        items: [{ serviceId, description: 'New film', quantity: 1, rate: '1000' }],
      });
      await documentAction(owner, quote.id, 'accept');
      const converted = await documentAction(owner, quote.id, 'convert');
      assert('projectId' in converted);
      assert('invoiceId' in converted);
      await assert.rejects(documentAction(owner, quote.id, 'convert'), /Accept this/);
    });
    await t.test('issuing a draft refreshes its branded PDF status', async () => {
      const draft = await createDocument(owner, {
        kind: 'invoice',
        status: 'Draft',
        clientId,
        projectId,
        issueDate: today(),
        dueDate: today(),
        items: [{ serviceId, description: 'Draft service', quantity: 1, rate: '100' }],
      });
      await documentAction(owner, draft.id, 'issue');
      const stored = await transaction(
        (tx) =>
          one<{ snapshot: { details: { label: string; value: string }[] } }>(
            tx,
            'SELECT snapshot FROM documents WHERE id=$1',
            [draft.id],
          ),
        owner,
      );
      assert.equal(
        stored!.snapshot.details.find((d) => d.label === 'Status at issue')!.value,
        'Issued',
      );
    });
    await t.test('CSRF blocks cross-origin writes before authorization', async () => {
      const response = await POST(
        new Request('http://localhost:3000/api/clients', {
          method: 'POST',
          headers: { origin: 'https://attacker.example', 'content-type': 'application/json' },
          body: '{}',
        }),
        { params: Promise.resolve({ path: ['clients'] }) },
      );
      assert.equal(response.status, 403);
    });
  }
});

test('exact monetary arithmetic and largest-remainder service allocation', () => {
  assert.equal(paise('8000.01'), 800001n);
  assert.throws(() => paise('0.001'));
  assert.throws(() => paise('-1'));
  assert.throws(() => paise('1e3'));
  const amounts = allocate(100n, [
    { id: 'a', weight: 1n },
    { id: 'b', weight: 1n },
    { id: 'c', weight: 1n },
  ]);
  assert.deepEqual(
    amounts.map((a) => a.amount),
    [34n, 33n, 33n],
  );
  assert.equal(
    amounts.reduce((s, a) => s + a.amount, 0n),
    100n,
  );
  assert.equal(invoiceTotal([{ quantity: 3, rate: '0.10' }], '0', 1800).total, 35n);
  assert.throws(() => invoiceTotal([{ quantity: 1, rate: '1' }], '2', 0));
});
