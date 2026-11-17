import { createHash } from 'node:crypto';
import { z } from 'zod';
import { transaction, one, audit, nextNumber, type Tx } from '../db';
import { assertOwner } from '../security';
import { insist } from '../errors';
import { paymentSchema, documentSchema, amount, id, type DocumentInput } from '../validation';
import { paise, allocate, invoiceTotal, lineTotal } from '@/lib/money';
import { money, today, type Principal } from '@/lib/domain';
import { createPdf, type DocumentSnapshot } from './pdf';
async function context(tx: Tx, clientId: string, projectId?: string | null) {
  const client = await one<{
    name: string;
    company: string;
    email: string;
    profile: Record<string, unknown>;
  }>(tx, 'SELECT name,company,email,profile FROM clients WHERE id=$1', [clientId]);
  insist(client, 'Client not found.', 404);
  const project = projectId
    ? await one<{ id: string; name: string; client_id: string }>(
        tx,
        'SELECT id,name,client_id FROM projects WHERE id=$1 FOR UPDATE',
        [projectId],
      )
    : undefined;
  if (projectId)
    insist(
      project && project.client_id === clientId,
      'The project must belong to the selected client.',
    );
  const agency = await one<{ data: Record<string, unknown> }>(
    tx,
    'SELECT data FROM agency_settings',
  );
  return {
    client: {
      name: client.name,
      company: client.company,
      email: client.email,
      address: client.profile.address || '',
    },
    project,
    agency: agency!.data,
  };
}
export async function invoiceBalance(tx: Tx, id: string) {
  const row = await one<{ total_paise: string; received: string; status: string }>(
    tx,
    `SELECT d.total_paise,d.status,coalesce((SELECT sum(p.amount_paise-coalesce((SELECT sum(r.amount_paise) FROM refunds r WHERE r.payment_id=p.id),0)) FROM payments p WHERE p.invoice_id=d.id),0)::text AS received FROM documents d WHERE d.id=$1`,
    [id],
  );
  insist(row, 'Invoice not found.', 404);
  return { ...row, balance: BigInt(row.total_paise) - BigInt(row.received) };
}
export async function recordPayment(p: Principal, body: unknown) {
  assertOwner(p);
  const v = paymentSchema.parse(body),
    value = paise(v.amount);
  insist(value > 0n, 'Payment must be greater than zero.');
  insist(v.paymentDate <= today(), 'A received payment cannot have a future date.');
  const fingerprint = createHash('sha256').update(JSON.stringify(v)).digest('hex');
  return transaction(async (tx) => {
    // The project row lock serializes related payments and makes duplicate retries deterministic.
    const ctx = await context(tx, v.clientId, v.projectId);
    const old = await one<{ id: string; request_hash: string; receipt_id: string }>(
      tx,
      'SELECT p.id,p.request_hash,r.id AS receipt_id FROM payments p JOIN receipts r ON r.payment_id=p.id WHERE p.idempotency_key=$1',
      [v.idempotencyKey],
    );
    if (old) {
      insist(
        old.request_hash === fingerprint,
        'This submission key was already used for a different payment.',
        409,
      );
      return { ...old, duplicate: true };
    }
    let balance: bigint | undefined,
      invoiceNumber = '';
    if (v.invoiceId) {
      const invoice = await one<{
        client_id: string;
        project_id: string;
        number: string;
        kind: string;
        status: string;
      }>(
        tx,
        'SELECT client_id,project_id,number,kind,status FROM documents WHERE id=$1 FOR UPDATE',
        [v.invoiceId],
      );
      insist(
        invoice &&
          invoice.kind === 'invoice' &&
          invoice.status === 'Issued' &&
          invoice.client_id === v.clientId &&
          invoice.project_id === v.projectId,
        'Select an issued invoice for this client and project.',
      );
      const financial = await invoiceBalance(tx, v.invoiceId);
      insist(value <= financial.balance, 'Payment exceeds the remaining invoice balance.');
      balance = financial.balance - value;
      invoiceNumber = invoice.number;
    }
    const source = await tx.query<{ id: string; weight: string }>(
      v.invoiceId
        ? 'SELECT service_id AS id,sum(amount_paise)::text AS weight FROM document_items WHERE document_id=$1 GROUP BY service_id ORDER BY service_id'
        : 'SELECT service_id AS id,sum(amount_paise)::text AS weight FROM project_service_items WHERE project_id=$1 GROUP BY service_id ORDER BY service_id',
      [v.invoiceId || v.projectId],
    );
    const distribution = allocate(
      value,
      source.rows.map((i) => ({ id: i.id, weight: BigInt(i.weight) })),
    );
    const year = Number(today().slice(0, 4));
    const reference = await nextNumber(tx, 'AVX-PAY', year);
    const payment = await one<{ id: string }>(
      tx,
      'INSERT INTO payments(idempotency_key,request_hash,reference,client_id,project_id,invoice_id,amount_paise,payment_date,method,transaction_ref,description,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id',
      [
        v.idempotencyKey,
        fingerprint,
        reference,
        v.clientId,
        v.projectId,
        v.invoiceId || null,
        value.toString(),
        v.paymentDate,
        v.method,
        v.transactionRef,
        v.description,
        v.notes,
      ],
    );
    for (const share of distribution)
      await tx.query(
        'INSERT INTO payment_allocations(payment_id,service_id,amount_paise) VALUES($1,$2,$3)',
        [payment!.id, share.id, share.amount.toString()],
      );
    const number = await nextNumber(tx, String(ctx.agency.receiptPrefix || 'AVX-RCP'), year);
    const serviceNames = await tx.query<{ name: string; amount_paise: string }>(
      'SELECT s.name,a.amount_paise FROM payment_allocations a JOIN service_categories s ON s.id=a.service_id WHERE a.payment_id=$1 ORDER BY s.name',
      [payment!.id],
    );
    const snapshot: DocumentSnapshot = {
      type: 'receipt',
      number,
      issueDate: today(),
      agency: ctx.agency,
      client: ctx.client,
      project: ctx.project!.name,
      items: serviceNames.rows.map((i) => ({ description: i.name, amount: i.amount_paise })),
      total: value.toString(),
      details: [
        { label: 'Payment date', value: v.paymentDate },
        { label: 'Payment method', value: v.method },
        { label: 'Transaction reference', value: v.transactionRef || reference },
        ...(v.invoiceId
          ? [
              { label: 'Related invoice', value: invoiceNumber },
              { label: 'Remaining invoice balance', value: money(balance!.toString()) },
            ]
          : []),
      ],
      notes: v.description,
      footer: String(ctx.agency.footer || 'Thank you for working with AVX Studios.'),
    };
    const pdf = await createPdf(snapshot);
    const receipt = await one<{ id: string }>(
      tx,
      'INSERT INTO receipts(payment_id,number,snapshot,pdf_base64) VALUES($1,$2,$3,$4) RETURNING id',
      [payment!.id, number, JSON.stringify(snapshot), pdf],
    );
    await audit(tx, 'payments', payment!.id, 'received', `${reference} · Payment received`);
    return { id: payment!.id, receipt_id: receipt!.id, number, reference, duplicate: false };
  }, p);
}
async function insertDocument(tx: Tx, v: DocumentInput) {
  const totals = invoiceTotal(v.items, v.discount, v.taxBps);
  insist(totals.total > 0n, 'Document total must be greater than zero.');
  insist(v.dueDate >= v.issueDate, 'Due date must be on or after issue date.');
  const ctx = await context(tx, v.clientId, v.projectId);
  if (v.taxBps > 0) insist(ctx.agency.gst, 'Configure your GST registration before adding GST.');
  for (const item of v.items)
    insist(
      await one(tx, 'SELECT id FROM service_categories WHERE id=$1 AND active=true', [
        item.serviceId,
      ]),
      'Select an active service.',
    );
  const number = await nextNumber(
    tx,
    String(
      ctx.agency[v.kind === 'invoice' ? 'invoicePrefix' : 'quotePrefix'] ||
        (v.kind === 'invoice' ? 'AVX-INV' : 'AVX-QTE'),
    ),
    Number(v.issueDate.slice(0, 4)),
  );
  const snapshot: DocumentSnapshot = {
    type: v.kind,
    number,
    issueDate: v.issueDate,
    agency: ctx.agency,
    client: ctx.client,
    project: ctx.project?.name || '',
    items: v.items.map((i) => ({
      description: i.description,
      quantity: i.quantity,
      rate: paise(i.rate).toString(),
      amount: lineTotal(i.quantity, i.rate).toString(),
    })),
    total: totals.total.toString(),
    details: [
      { label: v.kind === 'quotation' ? 'Valid until' : 'Due date', value: v.dueDate },
      { label: 'Subtotal', value: money(totals.subtotal.toString()) },
      { label: 'Discount', value: money(totals.discount.toString()) },
      { label: 'Tax', value: money(totals.tax.toString()) },
      { label: 'Status at issue', value: v.status },
    ],
    notes: [v.notes, v.terms, ctx.agency.paymentTerms, ctx.agency.bankDetails, ctx.agency.upi]
      .filter(Boolean)
      .join('\n'),
    footer: String(ctx.agency.footer || 'Thank you for working with AVX Studios.'),
  };
  const row = await one<{ id: string }>(
    tx,
    'INSERT INTO documents(kind,number,client_id,project_id,status,issue_date,due_date,subtotal_paise,discount_paise,tax_bps,tax_paise,total_paise,notes,terms,snapshot,pdf_base64) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id',
    [
      v.kind,
      number,
      v.clientId,
      v.projectId || null,
      v.status,
      v.issueDate,
      v.dueDate,
      totals.subtotal.toString(),
      totals.discount.toString(),
      v.taxBps,
      totals.tax.toString(),
      totals.total.toString(),
      v.notes,
      v.terms,
      JSON.stringify(snapshot),
      await createPdf(snapshot),
    ],
  );
  for (const item of v.items)
    await tx.query(
      'INSERT INTO document_items(document_id,service_id,description,quantity,rate_paise,amount_paise) VALUES($1,$2,$3,$4,$5,$6)',
      [
        row!.id,
        item.serviceId,
        item.description,
        item.quantity,
        paise(item.rate).toString(),
        lineTotal(item.quantity, item.rate).toString(),
      ],
    );
  await audit(tx, 'invoices', row!.id, 'created', number + ' created');
  return { id: row!.id, number };
}
export async function createDocument(p: Principal, body: unknown) {
  assertOwner(p);
  const v = documentSchema.parse(body);
  return transaction((tx) => insertDocument(tx, v), p);
}
export async function documentAction(p: Principal, documentId: string, action: string) {
  assertOwner(p);
  return transaction(async (tx) => {
    const doc = await one<{
      id: string;
      kind: string;
      status: string;
      client_id: string;
      project_id: string;
      number: string;
      tax_bps: number;
      discount_paise: string;
      notes: string;
      terms: string;
      due_date: string;
    }>(tx, 'SELECT * FROM documents WHERE id=$1 FOR UPDATE', [documentId]);
    insist(doc, 'Document not found.', 404);
    if (action === 'void') {
      const payment = await one(tx, 'SELECT id FROM payments WHERE invoice_id=$1 LIMIT 1', [
        documentId,
      ]);
      insist(
        !payment,
        'Refund linked payments before correcting financial history; a paid invoice cannot be voided.',
      );
      insist(doc.status !== 'Converted', 'A converted quotation cannot be voided.');
      await tx.query("UPDATE documents SET status='Voided' WHERE id=$1", [documentId]);
    } else if (action === 'issue') {
      insist(doc.status === 'Draft', 'Only drafts can be issued.');
      const stored = await one<{ snapshot: DocumentSnapshot }>(
        tx,
        'SELECT snapshot FROM documents WHERE id=$1',
        [documentId],
      );
      const snapshot = {
        ...stored!.snapshot,
        details: stored!.snapshot.details.map((d) =>
          d.label === 'Status at issue' ? { ...d, value: 'Issued' } : d,
        ),
      };
      await tx.query("UPDATE documents SET status='Issued',snapshot=$2,pdf_base64=$3 WHERE id=$1", [
        documentId,
        JSON.stringify(snapshot),
        await createPdf(snapshot),
      ]);
    } else if (action === 'accept') {
      insist(
        doc.kind === 'quotation' && doc.status === 'Issued',
        'Only issued quotations can be accepted.',
      );
      await tx.query("UPDATE documents SET status='Accepted' WHERE id=$1", [documentId]);
    } else if (action === 'convert') {
      insist(
        doc.kind === 'quotation' && doc.status === 'Accepted',
        'Accept this quotation before converting it.',
      );
      const items = (
        await tx.query<{
          service_id: string;
          description: string;
          quantity: number;
          rate_paise: string;
          amount_paise: string;
        }>('SELECT * FROM document_items WHERE document_id=$1', [documentId])
      ).rows;
      let projectId = doc.project_id;
      if (!projectId) {
        const project = await one<{ id: string }>(
          tx,
          'INSERT INTO projects(client_id,name,description) VALUES($1,$2,$3) RETURNING id',
          [doc.client_id, 'Project · ' + doc.number, doc.notes],
        );
        projectId = project!.id;
        for (const i of items) {
          if (BigInt(i.amount_paise) > 0n)
            await tx.query(
              'INSERT INTO project_service_items(project_id,service_id,description,amount_paise) VALUES($1,$2,$3,$4)',
              [projectId, i.service_id, i.description, i.amount_paise],
            );
        }
      }
      const decimal = (v: string) =>
        `${BigInt(v) / 100n}.${(BigInt(v) % 100n).toString().padStart(2, '0')}`;
      const invoice = await insertDocument(tx, {
        kind: 'invoice',
        clientId: doc.client_id,
        projectId,
        status: 'Issued',
        issueDate: today(),
        dueDate: today(),
        discount: decimal(doc.discount_paise),
        taxBps: doc.tax_bps,
        notes: doc.notes,
        terms: doc.terms,
        items: items.map((i) => ({
          serviceId: i.service_id,
          description: i.description,
          quantity: i.quantity,
          rate: decimal(i.rate_paise),
        })),
      });
      await tx.query(
        "UPDATE documents SET status='Converted',converted_project_id=$2,converted_invoice_id=$3 WHERE id=$1",
        [documentId, projectId, invoice.id],
      );
      await audit(
        tx,
        'invoices',
        documentId,
        'converted',
        doc.number + ' converted to project and invoice',
      );
      return { projectId, invoiceId: invoice.id };
    } else insist(false, 'Unknown document action.');
    await audit(tx, 'invoices', documentId, action, doc.number + ' ' + action);
    return { ok: true };
  }, p);
}
export async function refundPayment(p: Principal, paymentId: string, body: unknown) {
  assertOwner(p);
  const v = z
    .object({
      idempotencyKey: id,
      amount,
      refundDate: z.iso.date(),
      reason: z.string().trim().min(5).max(4000),
    })
    .strict()
    .parse(body);
  const value = paise(v.amount);
  insist(value > 0n, 'Refund must be greater than zero.');
  insist(v.refundDate <= today(), 'Refund date cannot be in the future.');
  return transaction(async (tx) => {
    const payment = await one<{ amount_paise: string; payment_date: string }>(
      tx,
      'SELECT amount_paise,payment_date::text FROM payments WHERE id=$1 FOR UPDATE',
      [paymentId],
    );
    insist(payment, 'Payment not found.', 404);
    insist(
      v.refundDate >= String(payment.payment_date).slice(0, 10),
      'Refund cannot precede the payment.',
    );
    const old = await one<{ id: string; payment_id: string; amount_paise: string; reason: string }>(
      tx,
      'SELECT id,payment_id,amount_paise,reason FROM refunds WHERE idempotency_key=$1',
      [v.idempotencyKey],
    );
    if (old) {
      insist(
        old.payment_id === paymentId &&
          old.amount_paise === value.toString() &&
          old.reason === v.reason,
        'Submission key is already used.',
        409,
      );
      return old;
    }
    const refunded = await one<{ total: string }>(
      tx,
      'SELECT coalesce(sum(amount_paise),0)::text AS total FROM refunds WHERE payment_id=$1',
      [paymentId],
    );
    insist(
      value <= BigInt(payment.amount_paise) - BigInt(refunded!.total),
      'Refund exceeds the unrefunded amount.',
    );
    const row = await one<{ id: string }>(
      tx,
      'INSERT INTO refunds(payment_id,idempotency_key,amount_paise,refund_date,reason) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [paymentId, v.idempotencyKey, value.toString(), v.refundDate, v.reason],
    );
    const shares = (
      await tx.query<{ id: string; weight: string }>(
        'SELECT a.service_id AS id,(a.amount_paise-coalesce((SELECT sum(ra.amount_paise) FROM refund_allocations ra JOIN refunds r ON r.id=ra.refund_id WHERE r.payment_id=a.payment_id AND ra.service_id=a.service_id),0))::text AS weight FROM payment_allocations a WHERE payment_id=$1 ORDER BY service_id',
        [paymentId],
      )
    ).rows;
    for (const a of allocate(
      value,
      shares.map((s) => ({ id: s.id, weight: BigInt(s.weight) })),
    ))
      await tx.query(
        'INSERT INTO refund_allocations(refund_id,service_id,amount_paise) VALUES($1,$2,$3)',
        [row!.id, a.id, a.amount.toString()],
      );
    await audit(tx, 'payments', paymentId, 'refunded', 'Refund recorded: ' + v.reason);
    return row;
  }, p);
}
