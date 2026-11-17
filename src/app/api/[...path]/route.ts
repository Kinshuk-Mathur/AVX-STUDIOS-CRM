import { redeemOwnerRecovery } from '@/server/services/owner-recovery';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  authenticate,
  checkOrigin,
  clientAddress,
  cookieToken,
  login,
  logout,
  sessionCookie,
  sessionState,
  throttle,
} from '@/server/security';
import { AppError, insist } from '@/server/errors';
import { loginSchema } from '@/server/validation';
import { sections, type Section } from '@/lib/domain';
import {
  bootstrap,
  dashboard,
  analytics,
  listRecords,
  recordDetail,
  search,
  defaultRange,
  exportRecords,
} from '@/server/services/queries';
import {
  saveClient,
  saveProject,
  saveTask,
  addExpense,
  voidExpense,
  saveSettings,
  saveCategory,
  removeRecord,
  updateProjectStatus,
  addDeliverable,
} from '@/server/services/catalog';
import {
  recordPayment,
  createDocument,
  refundPayment,
  documentAction,
} from '@/server/services/finance';
import {
  saveViewer,
  decideAccess,
  viewerAction,
  viewerData,
  changeOwnerPassword,
} from '@/server/services/viewers';
import { getPdf, getAttachment, uploadAttachment, emailReceipt } from '@/server/services/files';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}
async function body(request: Request) {
  const max = 7_100_000;
  insist(Number(request.headers.get('content-length') || 0) <= max, 'Request is too large.', 413);
  const reader = request.body?.getReader();
  insist(reader, 'A JSON request body is required.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > max) {
      await reader.cancel();
      throw new AppError(413, 'Request is too large.');
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError(400, 'Invalid JSON request.');
  }
}

async function handler(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  try {
    const { path } = await params;
    const [section, id, action] = path;
    const url = new URL(request.url);
    const mutate = !['GET', 'HEAD'].includes(request.method);
    if (mutate) checkOrigin(request);
    if (section === 'auth') {
      if (id === 'owner-setup' && request.method === 'POST') {
        await throttle('owner-recovery:' + clientAddress(request), 8);
        const result = await redeemOwnerRecovery(await body(request), clientAddress(request));
        return json(result, 200, { 'Set-Cookie': sessionCookie('', true) });
      }
      if (id === 'login' && request.method === 'POST') {
        await throttle('ip:' + clientAddress(request), 30);
        const v = loginSchema.parse(await body(request));
        await throttle('username:' + v.username.trim().toLowerCase());
        const result = await login(
          v.username,
          v.password,
          v.viewer,
          request.headers.get('user-agent') || 'Unknown browser',
        );
        return json({ status: result.status }, 200, { 'Set-Cookie': sessionCookie(result.token) });
      }
      if (id === 'state' && request.method === 'GET') {
        const state = await sessionState(cookieToken(request));
        return json(state);
      }
      if (id === 'logout' && request.method === 'POST') {
        await logout(cookieToken(request));
        return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', true) });
      }
    }
    const principal = await authenticate(request, mutate);
    if (section === 'activity' && request.method === 'POST') return json({ ok: true });
    let result: unknown;
    if (request.method === 'GET') {
      if (section === 'bootstrap') result = await bootstrap(principal);
      else if (section === 'overview' || section === 'analytics') {
        const defaults = defaultRange();
        const from = z.iso.date().parse(url.searchParams.get('from') || defaults.from),
          to = z.iso.date().parse(url.searchParams.get('to') || defaults.to);
        insist(from <= to, 'Start date must precede end date.');
        result =
          section === 'overview'
            ? await dashboard(principal, from, to)
            : await analytics(principal, from, to);
      } else if (section === 'search')
        result = await search(principal, (url.searchParams.get('q') || '').slice(0, 100));
      else if (section === 'viewers') result = await viewerData(principal);
      else if (section === 'export') {
        const target = z.enum(sections).parse(url.searchParams.get('section'));
        const data = await exportRecords(principal, target);
        await authenticate(request, false);
        return new Response('\uFEFF' + data, {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="avx-${target}.csv"`,
            'Cache-Control': 'no-store',
          },
        });
      } else if ((section === 'receipts' || section === 'documents') && id && action === 'pdf') {
        z.uuid().parse(id);
        const pdf = await getPdf(principal, section, id);
        await authenticate(request, false);
        return new Response(Buffer.from(pdf.pdf_base64, 'base64'), {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `${url.searchParams.has('download') ? 'attachment' : 'inline'}; filename="${pdf.number}.pdf"`,
            'Cache-Control': 'private, no-store',
          },
        });
      } else if (section === 'attachments' && id) {
        z.uuid().parse(id);
        const file = await getAttachment(principal, id);
        await authenticate(request, false);
        return new Response(Buffer.from(file.content_base64, 'base64'), {
          headers: {
            'Content-Type': file.mime,
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
            'Cache-Control': 'no-store',
          },
        });
      } else if (sections.includes(section as Section)) {
        if (id) z.uuid().parse(id);
        result = id
          ? await recordDetail(principal, section as Section, id)
          : await listRecords(principal, section as Section);
      } else throw new AppError(404, 'Endpoint not found.');
      // Revalidate immediately before releasing business data, including after long-running reads.
      await authenticate(request, false);
      return json(result);
    }
    if (id) z.uuid().parse(id);
    const value = request.method === 'DELETE' ? {} : await body(request);
    if (section === 'clients' && ['POST', 'PATCH'].includes(request.method))
      result = await saveClient(principal, value, id);
    else if (section === 'projects' && action === 'status')
      result = await updateProjectStatus(principal, id, value.status);
    else if (section === 'projects' && action === 'deliverables')
      result = await addDeliverable(principal, id, value);
    else if (section === 'projects' && ['POST', 'PATCH'].includes(request.method))
      result = await saveProject(principal, value, id);
    else if (section === 'tasks' && ['POST', 'PATCH'].includes(request.method))
      result = await saveTask(principal, value, id);
    else if (section === 'payments' && action === 'refund')
      result = await refundPayment(principal, id, value);
    else if (section === 'payments' && request.method === 'POST' && !id)
      result = await recordPayment(principal, value);
    else if (section === 'invoices' && id && action)
      result = await documentAction(principal, id, action);
    else if (section === 'invoices' && request.method === 'POST' && !id)
      result = await createDocument(principal, value);
    else if (section === 'expenses' && action === 'void')
      result = await voidExpense(principal, id, z.string().max(4000).parse(value.reason));
    else if (section === 'expenses' && request.method === 'POST' && !id)
      result = await addExpense(principal, value);
    else if (section === 'viewers' && action)
      result = await viewerAction(principal, id, z.enum(['revoke', 'delete']).parse(action));
    else if (section === 'viewers' && ['POST', 'PATCH'].includes(request.method))
      result = await saveViewer(principal, value, id);
    else if (section === 'access' && id && action)
      result = await decideAccess(
        principal,
        id,
        z.enum(['approve', 'reject', 'revoke']).parse(action),
      );
    else if (section === 'settings' && !id) result = await saveSettings(principal, value);
    else if (section === 'password') result = await changeOwnerPassword(principal, value);
    else if (section === 'categories') result = await saveCategory(principal, value, id);
    else if (section === 'attachments') result = await uploadAttachment(principal, value);
    else if (section === 'receipts' && action === 'email') {
      await throttle('email:' + principal.id, 20, 60);
      result = await emailReceipt(
        principal,
        id,
        z
          .object({ copyOnly: z.boolean().default(false) })
          .strict()
          .parse(value).copyOnly,
      );
    } else if (['clients', 'tasks'].includes(section) && id && request.method === 'DELETE')
      result = await removeRecord(principal, section, id);
    else throw new AppError(404, 'Endpoint not found.');
    return json(result);
  } catch (error) {
    if (error instanceof z.ZodError)
      return json(
        { error: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') },
        400,
      );
    if (error instanceof AppError) return json({ error: error.message }, error.status);
    const code = (error as { code?: string }).code;
    if (code === '23505')
      return json(
        {
          error:
            'This record or transaction reference already exists. Check existing records before retrying.',
        },
        409,
      );
    if (code === '23503')
      return json({ error: 'A linked record is missing or still in use.' }, 409);
    const trace = randomUUID();
    console.error('AVX request failure', {
      trace,
      name: (error as Error).name,
      code,
      message: process.env.NODE_ENV !== 'production' ? (error as Error).message : undefined,
    });
    return json({ error: 'The request could not be completed. Please try again.', trace }, 500);
  }
}
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
