import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { money } from '@/lib/domain';
export interface DocumentSnapshot {
  type: 'receipt' | 'invoice' | 'quotation';
  number: string;
  issueDate: string;
  agency: Record<string, unknown>;
  client: Record<string, unknown>;
  project: string;
  items: { description: string; amount: string; quantity?: number; rate?: string }[];
  total: string;
  details: { label: string; value: string }[];
  notes: string;
  footer: string;
}
let fontBytes: Promise<Buffer> | undefined;
export async function createPdf(snapshot: DocumentSnapshot) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(
    await (fontBytes ??= readFile(path.resolve('public/NotoSans-Regular.ttf'))),
    { subset: true },
  );
  let page = pdf.addPage([595.28, 841.89]),
    y = 784;
  const dark = rgb(0.06, 0.05, 0.07),
    muted = rgb(0.42, 0.4, 0.45),
    accent = rgb(1, 0, 0.173);
  const line = (text: string, size = 10, color = dark) => {
    const cleaned = text.replace(/[\u0000-\u001f]/g, ' ');
    const words = cleaned.split(/\s+/);
    let current = '';
    for (const word of words) {
      const next = current ? current + ' ' + word : word;
      if (font.widthOfTextAtSize(next, size) > 485 && current) {
        draw(current, size, color);
        current = word;
      } else current = next;
    }
    if (current) draw(current, size, color);
  };
  const draw = (value: string, size: number, color: ReturnType<typeof rgb>) => {
    if (y < 65) {
      page = pdf.addPage([595.28, 841.89]);
      y = 784;
    }
    page.drawText(value, { x: 52, y, size, font, color, maxWidth: 490 });
    y -= size + 8;
  };
  line(String(snapshot.agency.name || 'AVX STUDIOS').toUpperCase(), 24);
  line(String(snapshot.agency.tagline || 'Art • Visual • Experience'), 9, muted);
  y -= 20;
  line(snapshot.type === 'receipt' ? 'PAYMENT RECEIPT' : snapshot.type.toUpperCase(), 12, accent);
  line(snapshot.number, 11);
  line('Issued ' + snapshot.issueDate, 9, muted);
  y -= 15;
  line('BILLED TO', 8, muted);
  line(String(snapshot.client.name), 13);
  if (snapshot.client.company) line(String(snapshot.client.company), 10);
  if (snapshot.client.address) line(String(snapshot.client.address), 10, muted);
  if (snapshot.client.email) line(String(snapshot.client.email), 10, muted);
  y -= 15;
  if (snapshot.project) {
    line('PROJECT', 8, muted);
    line(snapshot.project, 12);
    y -= 10;
  }
  line('SERVICE / DESCRIPTION', 8, muted);
  for (const item of snapshot.items) {
    line(item.description, 10);
    line(
      `${item.quantity ? item.quantity + ' × ' + money(item.rate) + '    ' : ''}${money(item.amount)}`,
      11,
    );
    y -= 4;
  }
  y -= 10;
  line(snapshot.type === 'receipt' ? 'AMOUNT RECEIVED' : 'TOTAL AMOUNT', 9, muted);
  line(money(snapshot.total), 29, accent);
  y -= 12;
  for (const detail of snapshot.details) line(`${detail.label}: ${detail.value}`, 9, muted);
  if (snapshot.notes) {
    y -= 12;
    line('NOTES / TERMS', 8, muted);
    line(snapshot.notes, 9);
  }
  y -= 20;
  line(snapshot.footer, 10);
  line(
    [snapshot.agency.website, snapshot.agency.email, snapshot.agency.phone]
      .filter(Boolean)
      .join(' • '),
    8,
    muted,
  );
  if (snapshot.agency.address) line(String(snapshot.agency.address), 8, muted);
  if (snapshot.agency.gst) line('GSTIN: ' + snapshot.agency.gst, 8, muted);
  const pages = pdf.getPages();
  pages.forEach((p, i) =>
    p.drawText(`${snapshot.number}  ·  ${i + 1} / ${pages.length}`, {
      x: 52,
      y: 30,
      font,
      size: 8,
      color: muted,
    }),
  );
  pdf.setTitle(`${snapshot.number} · AVX Studios`);
  pdf.setAuthor(String(snapshot.agency.name || 'AVX Studios'));
  return Buffer.from(await pdf.save()).toString('base64');
}
