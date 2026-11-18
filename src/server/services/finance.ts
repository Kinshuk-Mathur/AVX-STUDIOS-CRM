import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  transaction,
  newRow,
  now,
  audit,
  nextNumber,
  stableKey,
  type UnitOfWork,
} from '../firebase/store';
import { metric, rollup } from '../firebase/metrics';
import { putFile } from '../firebase/blobs';
import type {
  Client,
  Project,
  Category,
  Settings,
  FinancialDocument,
  Payment,
  Receipt,
  Refund,
} from '../firebase/models';
import { assertOwner } from '../security-primitives';
import { insist } from '../errors';
import { paymentSchema, documentSchema, amount, id, type DocumentInput } from '../validation';
import { paise, allocate, invoiceTotal, lineTotal } from '@/lib/money';
import { money, today, type Principal } from '@/lib/domain';
import { createPdf, type DocumentSnapshot } from './pdf';
const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function context(tx: UnitOfWork, clientId: string, projectId?: string | null) {
  const client = await tx.get<Client>('clients', clientId);
  insist(client, 'Client not found.', 404);
  const project = projectId ? await tx.get<Project>('projects', projectId) : undefined;
  if (projectId)
    insist(
      project && project.client_id === clientId,
      'The project must belong to the selected client.',
    );
  const agency = await tx.get<Settings>('agency_settings', 'agency');
  insist(agency, 'Agency settings are missing.', 503);
  return {
    client: {
      name: client.name,
      company: client.company,
      email: client.email,
      address: client.profile.address || '',
    },
    project,
    agency: agency.data,
  };
}
async function outstanding(tx: UnitOfWork, clientId: string, delta: bigint) {
  const client = await tx.get<Client>('clients', clientId);
  insist(client, 'Client not found.', 404);
  await tx.update('clients', clientId, {
    outstanding_paise: (BigInt(client.outstanding_paise) + delta).toString(),
  });
  await metric(tx, 'outstanding', delta);
}
async function cash(
  tx: UnitOfWork,
  payment: Payment,
  date: string,
  value: bigint,
  shares: { service_id: string; amount_paise: string }[],
  event = 0,
) {
  const client = await tx.get<Client>('clients', payment.client_id),
    project = await tx.get<Project>('projects', payment.project_id);
  insist(client && project, 'The payment references a missing client or project.', 409);
  await tx.update('clients', client.id, {
    received_paise: (BigInt(client.received_paise) + value).toString(),
  });
  await tx.update('projects', project.id, {
    received_paise: (BigInt(project.received_paise) + value).toString(),
    has_financial_history: true,
  });
  if (payment.invoice_id) {
    const doc = await tx.get<FinancialDocument>('documents', payment.invoice_id);
    insist(doc, 'Invoice not found.', 404);
    await tx.update('documents', doc.id, {
      received_paise: (BigInt(doc.received_paise) + value).toString(),
      has_payments: true,
    });
    await outstanding(tx, client.id, -value);
  }
  await metric(tx, 'all_time', value);
  for (const [dimension, subject] of [
    ['cash', 'all'],
    ['client', client.id],
    ['project', project.id],
    ['method', payment.method],
  ])
    await rollup(tx, date, dimension, subject, value, event);
  for (const share of shares)
    await rollup(tx, date, 'service', share.service_id, BigInt(share.amount_paise));
}
export async function invoiceBalance(tx: UnitOfWork, id: string) {
  const doc = await tx.get<FinancialDocument>('documents', id);
  insist(doc, 'Invoice not found.', 404);
  return {
    total_paise: doc.total_paise,
    received: doc.received_paise,
    status: doc.status,
    balance: BigInt(doc.total_paise) - BigInt(doc.received_paise),
  };
}
export async function recordPayment(p: Principal, body: unknown) {
  assertOwner(p);
  const v = paymentSchema.parse(body),
    value = paise(v.amount),
    request_hash = fingerprint(v);
  insist(value > 0n, 'Payment must be greater than zero.');
  insist(v.paymentDate <= today(), 'A received payment cannot have a future date.');
  return transaction(async (tx) => {
    const previous = await tx.get('payment_requests', v.idempotencyKey);
    if (previous) {
      insist(
        previous.request_hash === request_hash,
        'This submission key was already used for a different payment.',
        409,
      );
      return {
        id: String(previous.payment_id),
        receipt_id: String(previous.receipt_id),
        number: String(previous.number),
        reference: String(previous.reference),
        duplicate: true,
      };
    }
    const ctx = await context(tx, v.clientId, v.projectId);
    let balance: bigint | undefined,
      invoiceNumber = '';
    const invoice = v.invoiceId
      ? await tx.get<FinancialDocument>('documents', v.invoiceId)
      : undefined;
    if (v.invoiceId) {
      insist(
        invoice &&
          invoice.kind === 'invoice' &&
          invoice.status === 'Issued' &&
          invoice.client_id === v.clientId &&
          invoice.project_id === v.projectId,
        'Select an issued invoice for this client and project.',
      );
      balance = BigInt(invoice.total_paise) - BigInt(invoice.received_paise) - value;
      insist(balance >= 0n, 'Payment exceeds the remaining invoice balance.');
      invoiceNumber = invoice.number;
    }
    const weights = new Map<string, bigint>();
    for (const item of invoice?.items || ctx.project!.items)
      weights.set(
        item.service_id,
        (weights.get(item.service_id) || 0n) + BigInt(item.amount_paise),
      );
    const distribution = allocate(
      value,
      [...weights].sort(([a], [b]) => a.localeCompare(b)).map(([id, weight]) => ({ id, weight })),
    );
    const external = v.transactionRef
      ? stableKey(v.method + '\0' + v.transactionRef.toLowerCase())
      : null;
    if (external)
      insist(
        !(await tx.get('external_payments', external)),
        'This transaction reference already exists.',
        409,
      );
    const year = Number(today().slice(0, 4));
    const reference = await nextNumber(tx, 'AVX-PAY', year),
      number = await nextNumber(tx, String(ctx.agency.receiptPrefix || 'AVX-RCP'), year);
    const receiptId = randomUUID();
    const payment: Payment = newRow({
      idempotency_key: v.idempotencyKey,
      request_hash,
      reference,
      client_id: v.clientId,
      project_id: v.projectId,
      invoice_id: v.invoiceId || null,
      amount_paise: value.toString(),
      refunded_paise: '0',
      payment_date: v.paymentDate,
      method: v.method,
      transaction_ref: v.transactionRef,
      description: v.description,
      notes: v.notes,
      receipt_id: receiptId,
      receipt_number: number,
      allocations: distribution.map((s) => ({
        service_id: s.id,
        amount_paise: s.amount.toString(),
        refunded_paise: '0',
      })),
    });
    const items = [];
    for (const share of distribution) {
      const category = await tx.get<Category>('service_categories', share.id);
      insist(category, 'Service not found.', 404);
      items.push({ description: category.name, amount: share.amount.toString() });
    }
    const snapshot: DocumentSnapshot = {
      type: 'receipt',
      number,
      issueDate: today(),
      agency: ctx.agency,
      client: ctx.client,
      project: ctx.project!.name,
      items,
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
    const pdf_key = await putFile(Buffer.from(await createPdf(snapshot), 'base64'));
    await tx.create('payments', payment);
    await tx.create<Receipt>('receipts', {
      id: receiptId,
      created_at: now(),
      payment_id: payment.id,
      number,
      snapshot,
      pdf_key,
    });
    await tx.create('payment_requests', {
      id: v.idempotencyKey,
      payment_id: payment.id,
      receipt_id: receiptId,
      request_hash,
      number,
      reference,
    });
    if (external) await tx.create('external_payments', { id: external, payment_id: payment.id });
    await cash(tx, payment, v.paymentDate, value, payment.allocations, 1);
    await audit(tx, 'payments', payment.id, 'received', reference + ' · Payment received');
    return { id: payment.id, receipt_id: receiptId, number, reference, duplicate: false };
  }, p);
}
async function insertDocument(tx: UnitOfWork, v: DocumentInput) {
  const totals = invoiceTotal(v.items, v.discount, v.taxBps);
  insist(totals.total > 0n, 'Document total must be greater than zero.');
  insist(v.dueDate >= v.issueDate, 'Due date must be on or after issue date.');
  const ctx = await context(tx, v.clientId, v.projectId);
  if (v.taxBps > 0) insist(ctx.agency.gst, 'Configure your GST registration before adding GST.');
  for (const item of v.items)
    insist(
      (await tx.get<Category>('service_categories', item.serviceId))?.active,
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
  const pdf_key = await putFile(Buffer.from(await createPdf(snapshot), 'base64'));
  const row: FinancialDocument = newRow({
    kind: v.kind,
    number,
    client_id: v.clientId,
    project_id: v.projectId || null,
    status: v.status,
    issue_date: v.issueDate,
    due_date: v.dueDate,
    subtotal_paise: totals.subtotal.toString(),
    discount_paise: totals.discount.toString(),
    tax_bps: v.taxBps,
    tax_paise: totals.tax.toString(),
    total_paise: totals.total.toString(),
    received_paise: '0',
    has_payments: false,
    notes: v.notes,
    terms: v.terms,
    snapshot,
    pdf_key,
    items: v.items.map((i) => ({
      id: randomUUID(),
      service_id: i.serviceId,
      description: i.description,
      quantity: i.quantity,
      rate_paise: paise(i.rate).toString(),
      amount_paise: lineTotal(i.quantity, i.rate).toString(),
    })),
  });
  await tx.create('documents', row);
  if (ctx.project) await tx.update('projects', ctx.project.id, { has_financial_history: true });
  if (v.kind === 'invoice' && v.status === 'Issued')
    await outstanding(tx, v.clientId, totals.total);
  return row;
}
export async function createDocument(p: Principal, body: unknown) {
  assertOwner(p);
  const v = documentSchema.parse(body);
  return transaction(async (tx) => {
    const row = await insertDocument(tx, v);
    await audit(tx, 'invoices', row.id, 'created', row.number + ' created');
    return { id: row.id, number: row.number };
  }, p);
}
export async function documentAction(p: Principal, documentId: string, action: string) {
  assertOwner(p);
  return transaction(async (tx) => {
    const doc = await tx.get<FinancialDocument>('documents', documentId);
    insist(doc, 'Document not found.', 404);
    if (action === 'void') {
      insist(
        !doc.has_payments,
        'Refund linked payments before correcting financial history; a paid invoice cannot be voided.',
      );
      insist(doc.status !== 'Converted', 'A converted quotation cannot be voided.');
      if (doc.kind === 'invoice' && doc.status === 'Issued')
        await outstanding(tx, doc.client_id, -BigInt(doc.total_paise));
      await tx.update('documents', doc.id, { status: 'Voided' });
    } else if (action === 'issue') {
      insist(doc.status === 'Draft', 'Only drafts can be issued.');
      const snapshot = {
        ...doc.snapshot,
        details: doc.snapshot.details.map((d) =>
          d.label === 'Status at issue' ? { ...d, value: 'Issued' } : d,
        ),
      };
      const pdf_key = await putFile(Buffer.from(await createPdf(snapshot), 'base64'));
      await tx.update('documents', doc.id, { status: 'Issued', snapshot, pdf_key });
      if (doc.kind === 'invoice') await outstanding(tx, doc.client_id, BigInt(doc.total_paise));
    } else if (action === 'accept') {
      insist(
        doc.kind === 'quotation' && doc.status === 'Issued',
        'Only issued quotations can be accepted.',
      );
      await tx.update('documents', doc.id, { status: 'Accepted' });
    } else if (action === 'convert') {
      insist(
        doc.kind === 'quotation' && doc.status === 'Accepted',
        'Accept this quotation before converting it.',
      );
      let projectId = doc.project_id;
      if (!projectId) {
        const items = doc.items
          .filter((i) => BigInt(i.amount_paise) > 0n)
          .map((i) => ({
            id: randomUUID(),
            service_id: i.service_id,
            description: i.description,
            amount_paise: i.amount_paise,
          }));
        const project: Project = newRow({
          client_id: doc.client_id,
          name: 'Project · ' + doc.number,
          description: doc.notes,
          status: 'Planning',
          priority: 'Medium',
          start_date: null,
          deadline: null,
          notes: '',
          completed_at: null,
          items,
          value_paise: items.reduce((s, i) => s + BigInt(i.amount_paise), 0n).toString(),
          received_paise: '0',
          has_financial_history: true,
          updated_at: now(),
        });
        await tx.create('projects', project);
        projectId = project.id;
      }
      const decimal = (n: string) =>
        BigInt(n) / 100n + '.' + (BigInt(n) % 100n).toString().padStart(2, '0');
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
        items: doc.items.map((i) => ({
          serviceId: i.service_id,
          description: i.description,
          quantity: i.quantity,
          rate: decimal(i.rate_paise),
        })),
      });
      await tx.update('documents', doc.id, {
        status: 'Converted',
        converted_project_id: projectId,
        converted_invoice_id: invoice.id,
      });
      await audit(
        tx,
        'invoices',
        doc.id,
        'converted',
        doc.number + ' converted to project and invoice',
      );
      return { projectId, invoiceId: invoice.id };
    } else insist(false, 'Unknown document action.');
    await audit(tx, 'invoices', doc.id, action, doc.number + ' ' + action);
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
      .parse(body),
    value = paise(v.amount),
    request_hash = fingerprint({ paymentId, ...v });
  insist(value > 0n, 'Refund must be greater than zero.');
  insist(v.refundDate <= today(), 'Refund date cannot be in the future.');
  return transaction(async (tx) => {
    const index = await tx.get('refund_requests', v.idempotencyKey);
    if (index) {
      insist(index.request_hash === request_hash, 'Submission key is already used.', 409);
      return (await tx.get<Refund>('refunds', String(index.refund_id)))!;
    }
    const payment = await tx.get<Payment>('payments', paymentId);
    insist(payment, 'Payment not found.', 404);
    insist(v.refundDate >= payment.payment_date, 'Refund cannot precede the payment.');
    insist(
      value <= BigInt(payment.amount_paise) - BigInt(payment.refunded_paise),
      'Refund exceeds the unrefunded amount.',
    );
    const shares = allocate(
      value,
      payment.allocations.map((a) => ({
        id: a.service_id,
        weight: BigInt(a.amount_paise) - BigInt(a.refunded_paise),
      })),
    );
    const allocations = shares.map((s) => ({
      service_id: s.id,
      amount_paise: s.amount.toString(),
    }));
    const refund: Refund = newRow({
      payment_id: paymentId,
      idempotency_key: v.idempotencyKey,
      amount_paise: value.toString(),
      refund_date: v.refundDate,
      reason: v.reason,
      request_hash,
      allocations,
    });
    await tx.create('refunds', refund);
    await tx.create('refund_requests', {
      id: v.idempotencyKey,
      refund_id: refund.id,
      request_hash,
    });
    await tx.update('payments', payment.id, {
      refunded_paise: (BigInt(payment.refunded_paise) + value).toString(),
      allocations: payment.allocations.map((a) => ({
        ...a,
        refunded_paise: (
          BigInt(a.refunded_paise) + (shares.find((s) => s.id === a.service_id)?.amount || 0n)
        ).toString(),
      })),
    });
    await cash(
      tx,
      payment,
      v.refundDate,
      -value,
      allocations.map((a) => ({ ...a, amount_paise: (-BigInt(a.amount_paise)).toString() })),
    );
    await audit(tx, 'payments', paymentId, 'refunded', 'Refund recorded: ' + v.reason);
    return refund;
  }, p);
}
