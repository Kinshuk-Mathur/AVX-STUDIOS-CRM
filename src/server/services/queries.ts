import { get, list, getMany, type Row, type Filter } from '../firebase/store';
import type {
  Client,
  Project,
  Task,
  Payment,
  FinancialDocument,
  Expense,
  Category,
  Rollup,
  Settings,
} from '../firebase/models';
import { assertOwner, assertSection } from '../security-primitives';
import { financialAccess, can, today, type Principal, type Section } from '@/lib/domain';
import { insist } from '../errors';
const text = (row: Row, key: string) => String(row[key] ?? '');
const descending = (key: string) => (a: Row, b: Row) => text(b, key).localeCompare(text(a, key));
const amountSum = (rows: Row[], key: string) =>
  rows.reduce((sum, r) => sum + BigInt(String(r[key] || 0)), 0n);
export function canDocuments(p: Principal) {
  return (
    p.role === 'owner' ||
    ['invoices', 'payments', 'clients', 'projects'].every((s) => can(p, s as Section))
  );
}
function omit(row: Row, keys: string[]) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key))) as Row;
}
export async function listRecords(
  p: Principal,
  section: Section,
  onlyId?: string,
  filters: readonly Filter[] = [],
) {
  assertSection(p, section);
  if (section === 'invoices')
    insist(
      canDocuments(p),
      'Invoices, Payments, Clients and Projects permissions are required for financial documents.',
      403,
    );
  const table = section === 'invoices' ? 'documents' : section;
  const data = onlyId
    ? [await get(table, onlyId, p)].filter((r): r is Row => !!r)
    : await list(table, filters, p);
  const financial = financialAccess(p),
    rows: Row[] = [];
  const clientCache = new Map<string, Client | undefined>(),
    projectCache = new Map<string, Project | undefined>();
  const clientIds = [...new Set(data.map((r) => String(r.client_id || '')).filter(Boolean))];
  const projectIds = [...new Set(data.map((r) => String(r.project_id || '')).filter(Boolean))];
  const [relatedClients, relatedProjects] = await Promise.all([
    getMany<Client>('clients', clientIds, p),
    getMany<Project>('projects', projectIds, p),
  ]);
  for (const id of clientIds) clientCache.set(id, undefined);
  for (const id of projectIds) projectCache.set(id, undefined);
  for (const row of relatedClients) clientCache.set(row.id, row);
  for (const row of relatedProjects) projectCache.set(row.id, row);
  const client = async (id: string) => {
    if (!clientCache.has(id)) clientCache.set(id, await get<Client>('clients', id, p));
    return clientCache.get(id);
  };
  const project = async (id: string) => {
    if (!id) return undefined;
    if (!projectCache.has(id)) projectCache.set(id, await get<Project>('projects', id, p));
    return projectCache.get(id);
  };
  const projects = section === 'clients' ? await list<Project>('projects', [], p) : [];
  const tasks = section === 'projects' ? await list<Task>('tasks', [], p) : [];
  for (const raw of data) {
    if (section === 'clients') {
      const r = raw as Client;
      rows.push({
        ...omit(r, ['received_paise', 'outstanding_paise']),
        profile:
          p.role === 'owner'
            ? r.profile
            : Object.fromEntries(
                Object.entries(r.profile).filter(([k]) => !['notes', 'links'].includes(k)),
              ),
        active_projects: projects.filter(
          (x) => x.client_id === r.id && !['Completed', 'Cancelled'].includes(x.status),
        ).length,
        ...(financial ? { revenue: r.received_paise, outstanding: r.outstanding_paise } : {}),
      });
    } else if (section === 'projects') {
      const r = raw as Project;
      rows.push({
        ...omit(r, [
          'items',
          'value_paise',
          'received_paise',
          'has_financial_history',
          ...(p.role === 'viewer' ? ['notes'] : []),
        ]),
        client_name: (await client(r.client_id))?.name || null,
        task_count: tasks.filter((t) => t.project_id === r.id).length,
        completed_tasks: tasks.filter((t) => t.project_id === r.id && t.status === 'Completed')
          .length,
        ...(financial ? { value: r.value_paise, received: r.received_paise } : {}),
      });
    } else if (section === 'payments') {
      const r = raw as Payment;
      rows.push({
        ...omit(r, [
          'request_hash',
          'idempotency_key',
          'allocations',
          'refunded_paise',
          ...(!canDocuments(p) ? ['receipt_id', 'receipt_number'] : []),
          ...(p.role === 'viewer' ? ['notes'] : []),
        ]),
        client_name: (await client(r.client_id))?.name || null,
        project_name: (await project(r.project_id))?.name || null,
        refunded: r.refunded_paise,
      });
    } else if (section === 'invoices') {
      const r = raw as FinancialDocument,
        received = BigInt(r.received_paise),
        balance = BigInt(r.total_paise) - received;
      const status =
        r.kind === 'quotation' || ['Draft', 'Voided'].includes(r.status)
          ? r.status
          : balance <= 0n
            ? 'Paid'
            : r.due_date < today()
              ? 'Overdue'
              : received > 0n
                ? 'Partially Paid'
                : 'Issued';
      rows.push({
        ...omit(r, ['items', 'snapshot', 'pdf_key', 'received_paise', 'has_payments']),
        stored_status: r.status,
        status,
        received: received.toString(),
        balance: balance.toString(),
        client_name: (await client(r.client_id))?.name || null,
        project_name: (await project(r.project_id || ''))?.name || null,
      });
    } else if (section === 'tasks' || section === 'expenses') {
      const r = raw as Task | Expense;
      rows.push({
        ...omit(r, p.role === 'viewer' ? ['notes'] : []),
        project_name: (await project(r.project_id || ''))?.name || null,
      });
    }
  }
  rows.sort(
    descending(
      section === 'payments'
        ? 'payment_date'
        : section === 'expenses'
          ? 'expense_date'
          : section === 'invoices'
            ? 'created_at'
            : 'updated_at',
    ),
  );
  if (section === 'tasks')
    rows.sort(
      (a, b) =>
        String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')) ||
        descending('created_at')(a, b),
    );
  return onlyId ? rows : rows.slice(0, 1000);
}
export async function dashboard(p: Principal, from: string, to: string) {
  assertSection(p, 'overview');
  return analytics(p, from, to, false);
}
export async function analytics(p: Principal, from: string, to: string, requireAnalytics = true) {
  if (requireAnalytics) assertSection(p, 'analytics');
  const financial = financialAccess(p);
  insist(
    !requireAnalytics || financial,
    'Detailed analytics requires all financial sections plus Clients and Projects permissions.',
    403,
  );
  const output: Record<string, unknown> = { financial, from, to };
  if (financial) {
    const month = today().slice(0, 7) + '-01',
      previous = new Date(month + 'T12:00:00Z');
    previous.setUTCMonth(previous.getUTCMonth() - 1);
    const previousMonth = previous.toISOString().slice(0, 10);
    const [all, categories, global] = await Promise.all([
      list<Rollup>('rollups', [
        ['date', '>=', from < previousMonth ? from : previousMonth],
        ['date', '<=', to > today() ? to : today()],
      ]),
      list<Category>('service_categories'),
      get('metrics', 'global'),
    ]);
    const within = all.filter((r) => r.date >= from && r.date <= to),
      cash = within.filter((r) => r.dimension === 'cash'),
      expenses = within.filter((r) => r.dimension === 'expense');
    const revenue = amountSum(cash, 'amount_paise'),
      expense = amountSum(expenses, 'amount_paise');
    output.totals = {
      all_time: String(global?.all_time || 0),
      revenue: revenue.toString(),
      expenses: expense.toString(),
      profit: (revenue - expense).toString(),
      outstanding: String(global?.outstanding || 0),
      month: amountSum(
        all.filter((r) => r.dimension === 'cash' && r.date >= month && r.date <= today()),
        'amount_paise',
      ).toString(),
      previous_month: amountSum(
        all.filter((r) => r.dimension === 'cash' && r.date >= previousMonth && r.date < month),
        'amount_paise',
      ).toString(),
    };
    const grouped = (dimension: string) => {
      const groups = new Map<string, { amount: bigint; events: number }>();
      for (const r of within.filter((r) => r.dimension === dimension)) {
        const old = groups.get(r.subject) || { amount: 0n, events: 0 };
        groups.set(r.subject, {
          amount: old.amount + BigInt(r.amount_paise),
          events: old.events + r.events,
        });
      }
      return [...groups].sort((a, b) =>
        a[1].amount > b[1].amount ? -1 : a[1].amount < b[1].amount ? 1 : 0,
      );
    };
    const services = new Map(grouped('service'));
    output.services = categories.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      amount: (services.get(c.id)?.amount || 0n).toString(),
    }));
    output.methods = grouped('method').map(([method, v]) => ({
      id: method,
      method,
      amount: v.amount.toString(),
    }));
    output.expenseCategories = grouped('expense').map(([category, v]) => ({
      id: category,
      category,
      amount: v.amount.toString(),
    }));
    const days = [...new Set([...cash, ...expenses].map((r) => r.date))].sort();
    output.trend = days.map((date) => ({
      id: date,
      date,
      revenue: amountSum(
        cash.filter((r) => r.date === date),
        'amount_paise',
      ).toString(),
      expenses: amountSum(
        expenses.filter((r) => r.date === date),
        'amount_paise',
      ).toString(),
    }));
    const clients = grouped('client');
    output.topClients = await Promise.all(
      clients.slice(0, 5).map(async ([id, v]) => {
        const c = await get<Client>('clients', id, p);
        return { id, name: c?.name || '', company: c?.company || '', amount: v.amount.toString() };
      }),
    );
    output.clientMetrics = {
      new_clients: (
        await list(
          'clients',
          [
            ['created_at', '>=', new Date(from + 'T00:00:00.000+05:30').toISOString()],
            ['created_at', '<=', new Date(to + 'T23:59:59.999+05:30').toISOString()],
          ],
          p,
        )
      ).length,
      repeat_clients: clients.filter(([, v]) => v.events > 1).length,
      average_revenue: clients.length ? (revenue / BigInt(clients.length)).toString() : '0',
    };
    output.projectRevenue = await Promise.all(
      grouped('project')
        .slice(0, 20)
        .map(async ([id, v]) => ({
          id,
          name: (await get<Project>('projects', id, p))?.name || '',
          amount: v.amount.toString(),
        })),
    );
  }
  if (can(p, 'projects')) {
    const all = await listRecords(p, 'projects'),
      active = all.filter((r) => !['Completed', 'Cancelled'].includes(String(r.status)));
    output.projects = active
      .sort((a, b) => String(a.deadline || '9999').localeCompare(String(b.deadline || '9999')))
      .slice(0, 6);
    const completed = all.filter((r) => r.completed_at);
    output.projectMetrics = {
      active: active.length,
      completed: all.filter((r) => r.status === 'Completed').length,
      overdue: active.filter((r) => r.deadline && String(r.deadline) < today()).length,
      average_days: completed.length
        ? (
            completed.reduce(
              (s, r) =>
                s +
                (Date.parse(String(r.completed_at)) - Date.parse(String(r.created_at))) / 86400000,
              0,
            ) / completed.length
          ).toFixed(1)
        : null,
    };
  }
  if (can(p, 'tasks'))
    output.deadlines = (await listRecords(p, 'tasks'))
      .filter((r) => r.status !== 'Completed' && r.due_date)
      .slice(0, 5);
  if (can(p, 'payments'))
    output.transactions = (await listRecords(p, 'payments'))
      .sort(descending('created_at'))
      .slice(0, 5);
  if (p.role === 'owner')
    output.activity = (await list('activity_logs', [], p))
      .sort(descending('created_at'))
      .slice(0, 8);
  return output;
}
export async function recordDetail(p: Principal, section: Section, id: string) {
  const record = (await listRecords(p, section, id))[0];
  insist(record, 'Record not found.', 404);
  const result: Record<string, unknown> = { record };
  if (section === 'clients' || section === 'projects') {
    for (const child of ['projects', 'tasks', 'payments', 'invoices', 'expenses'] as Section[]) {
      if (child === section || !can(p, child) || (child === 'invoices' && !canDocuments(p)))
        continue;
      result[child] = await listRecords(p, child, undefined, [
        [section === 'clients' ? 'client_id' : 'project_id', '==', id],
      ]);
    }
    if (section === 'projects') {
      result.deliverables = (await list('deliverables', [['project_id', '==', id]], p)).sort(
        descending('delivered_at'),
      );
      if (financialAccess(p)) {
        const project = await get<Project>('projects', id, p);
        const categories = new Map(
          (await list<Category>('service_categories', [], p)).map((c) => [c.id, c.name]),
        );
        result.items = project!.items.map((i) => ({
          ...i,
          service_name: categories.get(i.service_id) || '',
        }));
      }
    }
  }
  if (p.role === 'owner') {
    result.attachments = (await list('attachments', [['record_id', '==', id]], p))
      .filter((r) => r.section === section)
      .map((r) => omit(r, ['blob_key']));
    result.activity = (await list('activity_logs', [['entity_id', '==', id]], p)).sort(
      descending('created_at'),
    );
  }
  return result;
}
export async function search(p: Principal, query: string) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const results: { id: string; title: string; subtitle: string; section: string }[] = [];
  for (const section of ['clients', 'projects', 'tasks', 'payments', 'invoices'] as Section[]) {
    if (!can(p, section) || (section === 'invoices' && !canDocuments(p))) continue;
    for (const r of await listRecords(p, section)) {
      const title = String(r.name || r.title || r.reference || r.number || ''),
        subtitle = String(r.company || r.client_name || r.project_name || '');
      if ((title + ' ' + subtitle + ' ' + String(r.receipt_number || '')).toLowerCase().includes(q))
        results.push({ id: r.id, title, subtitle, section });
    }
  }
  return results.slice(0, 30);
}
export async function bootstrap(p: Principal) {
  const categories = (await list<Category>('service_categories', [], p)).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const result: Record<string, unknown> = { principal: p, categories };
  if (p.role === 'owner') {
    result.settings = (await get<Settings>('agency_settings', 'agency', p))?.data || {};
    result.emailConfigured = !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
    result.storage = 'Cloud Firestore';
  }
  return result;
}
export function defaultRange() {
  const to = today();
  return { from: to.slice(0, 7) + '-01', to };
}
export async function exportRecords(p: Principal, section: Section) {
  assertOwner(p);
  const rows = await listRecords(p, section),
    clean = rows.map((r) =>
      Object.fromEntries(Object.entries(r).filter(([, v]) => v === null || typeof v !== 'object')),
    ),
    keys = [...new Set(clean.flatMap(Object.keys))];
  const escape = (v: unknown) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return [
    keys.map(escape).join(','),
    ...clean.map((r) => keys.map((k) => escape(r[k])).join(',')),
  ].join('\r\n');
}
