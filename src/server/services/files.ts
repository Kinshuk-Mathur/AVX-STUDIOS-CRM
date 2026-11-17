import { z } from 'zod';
import { transaction, one, audit } from '../db';
import { assertOwner, assertSection } from '../security';
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
  return transaction(async (tx) => {
    const row = await one<{ number: string; pdf_base64: string }>(
      tx,
      `SELECT number,pdf_base64 FROM ${kind === 'receipts' ? 'receipts' : 'documents'} WHERE id=$1`,
      [id],
    );
    insist(row, 'Document not found.', 404);
    return row;
  }, p);
}
export async function uploadAttachment(p: Principal, body: unknown) {
  assertOwner(p);
  const v = z
    .object({
      section: z.enum(['clients', 'projects', 'payments', 'expenses']),
      recordId: z.uuid(),
      name: z.string().min(1).max(200),
      mime: z.enum(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']),
      content: z.string().max(7_000_000),
    })
    .strict()
    .parse(body);
  const content = Buffer.from(v.content, 'base64');
  insist(content.length > 0 && content.length <= 5 * 1024 * 1024, 'Files must be 5 MB or smaller.');
  const magic = content.subarray(0, 12);
  const valid =
    v.mime === 'application/pdf'
      ? magic.subarray(0, 5).toString() === '%PDF-'
      : v.mime === 'image/png'
        ? magic.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : v.mime === 'image/jpeg'
          ? magic[0] === 255 && magic[1] === 216 && magic[2] === 255
          : magic.subarray(0, 4).toString() === 'RIFF' &&
            magic.subarray(8, 12).toString() === 'WEBP';
  insist(valid, 'File contents do not match the selected format.');
  return transaction(async (tx) => {
    insist(
      await one(tx, `SELECT id FROM ${v.section} WHERE id=$1`, [v.recordId]),
      'Record not found.',
      404,
    );
    const row = await one(
      tx,
      'INSERT INTO attachments(section,record_id,name,mime,size,content_base64) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,name',
      [
        v.section,
        v.recordId,
        v.name.replace(/[\r\n/\\]/g, '_'),
        v.mime,
        content.length,
        content.toString('base64'),
      ],
    );
    await audit(tx, v.section, v.recordId, 'uploaded', 'File attached: ' + v.name);
    return row;
  }, p);
}
export async function getAttachment(p: Principal, id: string) {
  assertOwner(p);
  return transaction(async (tx) => {
    const row = await one<{ name: string; mime: string; content_base64: string }>(
      tx,
      'SELECT name,mime,content_base64 FROM attachments WHERE id=$1',
      [id],
    );
    insist(row, 'File not found.', 404);
    return row;
  }, p);
}
export async function listAttachments(p: Principal, section: Section, id: string) {
  assertOwner(p);
  return transaction(
    async (tx) =>
      (
        await tx.query(
          'SELECT id,name,mime,size,created_at FROM attachments WHERE section=$1 AND record_id=$2',
          [section, id],
        )
      ).rows,
    p,
  );
}
export async function emailReceipt(p: Principal, id: string, copyOnly = false) {
  assertOwner(p);
  insist(
    process.env.RESEND_API_KEY && process.env.EMAIL_FROM,
    'Email is not configured. Add RESEND_API_KEY and EMAIL_FROM to the server environment, then download the PDF for manual delivery.',
    503,
  );
  const payload = await transaction(async (tx) => {
    const receipt = await one<{
      number: string;
      pdf_base64: string;
      snapshot: { client: { email: string; name: string } };
    }>(tx, 'SELECT number,pdf_base64,snapshot FROM receipts WHERE id=$1', [id]);
    insist(receipt, 'Receipt not found.', 404);
    const email = copyOnly ? process.env.OWNER_COPY_EMAIL : receipt.snapshot.client.email;
    insist(email, 'Configure a recipient email before sending.');
    const delivery = await one<{ id: string }>(
      tx,
      "INSERT INTO email_deliveries(receipt_id,recipient,status) VALUES($1,$2,'queued') RETURNING id",
      [id, email],
    );
    return { receipt, email, delivery: delivery!.id };
  }, p);
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': payload.delivery,
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [payload.email],
        ...(!copyOnly && process.env.OWNER_COPY_EMAIL
          ? { cc: [process.env.OWNER_COPY_EMAIL] }
          : {}),
        subject: `AVX Studios · Payment receipt ${payload.receipt.number}`,
        text: `Hello ${payload.receipt.snapshot.client.name},\n\nPlease find your payment receipt attached. Thank you for working with AVX Studios.`,
        attachments: [
          { filename: payload.receipt.number + '.pdf', content: payload.receipt.pdf_base64 },
        ],
      }),
    });
    const result = (await response.json()) as { id?: string };
    insist(
      response.ok && result.id,
      'The email provider did not accept this message. You can download the receipt and try again.',
      502,
    );
    await transaction(async (tx) => {
      await tx.query("UPDATE email_deliveries SET status='accepted',provider_id=$1 WHERE id=$2", [
        result.id,
        payload.delivery,
      ]);
    }, p);
    return {
      status: 'accepted',
      message: 'Accepted by the email provider. Inbox delivery is not yet confirmed.',
    };
  } catch (e) {
    await transaction(async (tx) => {
      await tx.query(
        "UPDATE email_deliveries SET status='failed',error='Provider request failed; inspect provider dashboard before retrying' WHERE id=$1",
        [payload.delivery],
      );
    }, p);
    throw e;
  }
}
