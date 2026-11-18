import { z } from 'zod';
import { transaction, get, list, newRow, now, audit } from '../firebase/store';
import { putFile, readFileContent } from '../firebase/blobs';
import type { Attachment, Receipt, FinancialDocument } from '../firebase/models';
import { assertOwner, assertSection } from '../security-primitives';
import { insist } from '../errors';
import type { Principal, Section } from '@/lib/domain';
import { canDocuments } from './queries';
export async function getPdf(p: Principal, kind: string, id: string) {
  assertSection(p, 'invoices');
  insist(
    canDocuments(p),
    'Invoices, Payments, Clients and Projects permissions are required.',
    403,
  );
  insist(kind === 'receipts' || kind === 'documents', 'Document type not found.', 404);
  const row = await get<Receipt | FinancialDocument>(kind, id, p);
  insist(row, 'Document not found.', 404);
  return {
    number: row.number,
    pdf_base64: (await readFileContent(row.pdf_key)).toString('base64'),
  };
}
export async function uploadAttachment(p: Principal, body: unknown) {
  assertOwner(p);
  const v = z
    .object({
      section: z.enum(['clients', 'projects', 'payments', 'expenses']),
      recordId: z.uuid(),
      name: z.string().min(1).max(200),
      mime: z.enum(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']),
      content: z.string().max(7000000),
    })
    .strict()
    .parse(body);
  const content = Buffer.from(v.content, 'base64');
  insist(content.length > 0 && content.length <= 5 * 1024 * 1024, 'Files must be 5 MB or smaller.');
  const magic = content.subarray(0, 12),
    valid =
      v.mime === 'application/pdf'
        ? magic.subarray(0, 5).toString() === '%PDF-'
        : v.mime === 'image/png'
          ? magic.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : v.mime === 'image/jpeg'
            ? magic[0] === 255 && magic[1] === 216 && magic[2] === 255
            : magic.subarray(0, 4).toString() === 'RIFF' &&
              magic.subarray(8, 12).toString() === 'WEBP';
  insist(valid, 'File contents do not match the selected format.');
  insist(await get(v.section, v.recordId, p), 'Record not found.', 404);
  const blob_key = await putFile(content);
  return transaction(async (tx) => {
    insist(await tx.get(v.section, v.recordId), 'Record not found.', 404);
    const row = await tx.create(
      'attachments',
      newRow({
        section: v.section,
        record_id: v.recordId,
        name: v.name.replace(/[\r\n/\\]/g, '_'),
        mime: v.mime,
        size: content.length,
        blob_key,
      }),
    );
    await audit(tx, v.section, v.recordId, 'uploaded', 'File attached: ' + v.name);
    return { id: row.id, name: row.name };
  }, p);
}
export async function getAttachment(p: Principal, id: string) {
  assertOwner(p);
  const row = await get<Attachment>('attachments', id, p);
  insist(row, 'File not found.', 404);
  return {
    name: row.name,
    mime: row.mime,
    content_base64: (await readFileContent(row.blob_key)).toString('base64'),
  };
}
export async function listAttachments(p: Principal, section: Section, id: string) {
  assertOwner(p);
  return (await list<Attachment>('attachments', [['record_id', '==', id]], p))
    .filter((r) => r.section === section)
    .map((r) => ({ id: r.id, name: r.name, mime: r.mime, size: r.size, created_at: r.created_at }));
}
export async function emailReceipt(p: Principal, id: string, copyOnly = false) {
  assertOwner(p);
  insist(
    process.env.RESEND_API_KEY && process.env.EMAIL_FROM,
    'Email is not configured. Add RESEND_API_KEY and EMAIL_FROM to the server environment, then download the PDF for manual delivery.',
    503,
  );
  const receipt = await get<Receipt>('receipts', id, p);
  insist(receipt, 'Receipt not found.', 404);
  const email = copyOnly
    ? process.env.OWNER_COPY_EMAIL
    : String(receipt.snapshot.client.email || '');
  insist(email, 'Configure a recipient email before sending.');
  const content = (await readFileContent(receipt.pdf_key)).toString('base64');
  const delivery = await transaction(
    (tx) =>
      tx.create('email_deliveries', newRow({ receipt_id: id, recipient: email, status: 'queued' })),
    p,
  );
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: 'Bearer ' + process.env.RESEND_API_KEY,
        'Content-Type': 'application/json',
        'Idempotency-Key': delivery.id,
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [email],
        ...(!copyOnly && process.env.OWNER_COPY_EMAIL
          ? { cc: [process.env.OWNER_COPY_EMAIL] }
          : {}),
        subject: 'AVX Studios · Payment receipt ' + receipt.number,
        text:
          'Hello ' +
          receipt.snapshot.client.name +
          ',\n\nPlease find your payment receipt attached. Thank you for working with AVX Studios.',
        attachments: [{ filename: receipt.number + '.pdf', content }],
      }),
    });
    const result = (await response.json()) as { id?: string };
    insist(
      response.ok && result.id,
      'The email provider did not accept this message. You can download the receipt and try again.',
      502,
    );
    await transaction(
      (tx) =>
        tx.update('email_deliveries', delivery.id, {
          status: 'accepted',
          provider_id: result.id,
          updated_at: now(),
        }),
      p,
    );
    return {
      status: 'accepted',
      message: 'Accepted by the email provider. Inbox delivery is not yet confirmed.',
    };
  } catch (e) {
    await transaction(
      (tx) =>
        tx.update('email_deliveries', delivery.id, {
          status: 'failed',
          error: 'Provider request failed; inspect provider dashboard before retrying',
        }),
      p,
    );
    throw e;
  }
}
