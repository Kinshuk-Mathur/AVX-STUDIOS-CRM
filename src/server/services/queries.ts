import { transaction, one } from '../db';
import { assertOwner, assertSection } from '../security';
import { financialAccess, can, today, type Principal, type Section } from '@/lib/domain';
import { insist } from '../errors';
export function canDocuments(p: Principal) {
  return (
    p.role === 'owner' ||
    (can(p, 'invoices') && can(p, 'payments') && can(p, 'clients') && can(p, 'projects'))
  );
}
const revenueCte = `WITH cash AS (SELECT id,client_id,project_id,payment_date AS date,amount_paise AS amount,method FROM payments UNION ALL SELECT r.id,p.client_id,p.project_id,r.refund_date,-r.amount_paise,p.method FROM refunds r JOIN payments p ON p.id=r.payment_id)`;
const docSelect = `SELECT d.id,d.kind,d.number,d.client_id,d.project_id,d.status AS stored_status,d.issue_date,d.due_date,d.total_paise,d.notes,d.terms,d.created_at,c.name AS client_name,p.name AS project_name,coalesce(pay.received,0)::text AS received,(d.total_paise-coalesce(pay.received,0))::text AS balance,CASE WHEN d.kind='quotation' OR d.status IN('Draft','Voided') THEN d.status WHEN coalesce(pay.received,0)>=d.total_paise THEN 'Paid' WHEN d.due_date<(now() AT TIME ZONE 'Asia/Kolkata')::date THEN 'Overdue' WHEN coalesce(pay.received,0)>0 THEN 'Partially Paid' ELSE 'Issued' END AS status FROM documents d LEFT JOIN clients c ON c.id=d.client_id LEFT JOIN projects p ON p.id=d.project_id LEFT JOIN LATERAL (SELECT sum(pm.amount_paise-coalesce((SELECT sum(r.amount_paise) FROM refunds r WHERE r.payment_id=pm.id),0)) AS received FROM payments pm WHERE pm.invoice_id=d.id) pay ON true`;
export async function listRecords(p: Principal, section: Section) {
  assertSection(p, section);
  return transaction(async (tx) => {
    if (section === 'clients') {
      const rows = (
        await tx.query(
          `SELECT c.id,c.name,c.company,c.email,c.status,c.profile,c.created_at,c.updated_at,(SELECT count(*) FROM projects p WHERE p.client_id=c.id AND p.status NOT IN('Completed','Cancelled')) AS active_projects ${financialAccess(p) ? `,(SELECT coalesce(sum(pm.amount_paise-coalesce((SELECT sum(r.amount_paise) FROM refunds r WHERE r.payment_id=pm.id),0)),0)::text FROM payments pm WHERE pm.client_id=c.id) AS revenue,(SELECT coalesce(sum(d.total_paise-coalesce((SELECT sum(pm.amount_paise-coalesce((SELECT sum(r.amount_paise) FROM refunds r WHERE r.payment_id=pm.id),0)) FROM payments pm WHERE pm.invoice_id=d.id),0)),0)::text FROM documents d WHERE d.client_id=c.id AND d.kind='invoice' AND d.status='Issued') AS outstanding` : ''} FROM clients c ORDER BY c.updated_at DESC LIMIT 1000`,
        )
      ).rows;
      if (p.role === 'viewer')
        for (const row of rows) {
          const profile = row.profile as Record<string, unknown>;
          row.profile = { ...profile, notes: undefined, links: undefined };
        }
      return rows;
    }
    if (section === 'projects') {
      return (
        await tx.query(
          `SELECT p.id,p.client_id,p.name,p.description,p.status,p.priority,p.start_date,p.deadline,${p.role === 'owner' ? 'p.notes,' : ''}p.completed_at,p.created_at,c.name AS client_name,(SELECT count(*) FROM tasks t WHERE t.project_id=p.id) AS task_count,(SELECT count(*) FROM tasks t WHERE t.project_id=p.id AND t.status='Completed') AS completed_tasks ${financialAccess(p) ? `,(SELECT coalesce(sum(amount_paise),0)::text FROM project_service_items i WHERE i.project_id=p.id) AS value,(SELECT coalesce(sum(pm.amount_paise-coalesce((SELECT sum(r.amount_paise) FROM refunds r WHERE r.payment_id=pm.id),0)),0)::text FROM payments pm WHERE pm.project_id=p.id) AS received` : ''} FROM projects p LEFT JOIN clients c ON c.id=p.client_id ORDER BY p.updated_at DESC LIMIT 1000`,
        )
      ).rows;
    }
    if (section === 'tasks')
      return (
        await tx.query(
          `SELECT t.id,t.title,t.description,t.project_id,t.priority,t.status,t.due_date,${p.role === 'owner' ? 't.notes,' : ''}t.created_at,p.name AS project_name FROM tasks t LEFT JOIN projects p ON p.id=t.project_id ORDER BY t.due_date ASC NULLS LAST,t.created_at DESC LIMIT 1000`,
        )
      ).rows;
    if (section === 'payments')
      return (
        await tx.query(
          `SELECT pm.id,pm.reference,pm.client_id,pm.project_id,pm.invoice_id,pm.amount_paise,pm.payment_date,pm.method,pm.transaction_ref,pm.description,${p.role === 'owner' ? 'pm.notes,' : ''}pm.created_at,c.name AS client_name,p.name AS project_name,${canDocuments(p) ? 'r.id AS receipt_id,r.number AS receipt_number,' : ''}(SELECT coalesce(sum(amount_paise),0)::text FROM refunds rf WHERE rf.payment_id=pm.id) AS refunded FROM payments pm LEFT JOIN clients c ON c.id=pm.client_id LEFT JOIN projects p ON p.id=pm.project_id ${canDocuments(p) ? 'LEFT JOIN receipts r ON r.payment_id=pm.id' : ''} ORDER BY pm.payment_date DESC,pm.created_at DESC LIMIT 1000`,
        )
      ).rows;
    if (section === 'invoices') {
      insist(
        canDocuments(p),
        'Invoices, Payments, Clients and Projects permissions are required for financial documents.',
        403,
      );
      return (await tx.query(docSelect + ' ORDER BY d.created_at DESC LIMIT 1000')).rows;
    }
    if (section === 'expenses')
      return (
        await tx.query(
          `SELECT e.id,e.name,e.amount_paise,e.expense_date,e.category,e.vendor,e.method,e.project_id,e.recurrence,e.voided_at,e.void_reason,${p.role === 'owner' ? 'e.notes,' : ''}e.created_at,p.name AS project_name FROM expenses e LEFT JOIN projects p ON p.id=e.project_id ORDER BY e.expense_date DESC LIMIT 1000`,
        )
      ).rows;
    return [];
  }, p);
}
export async function dashboard(p: Principal, from: string, to: string) {
  assertSection(p, 'overview');
  return analytics(p, from, to, false);
}
export async function analytics(p: Principal, from: string, to: string, requireAnalytics = true) {
  if (requireAnalytics) assertSection(p, 'analytics');
  insist(
    !requireAnalytics || financialAccess(p),
    'Detailed analytics requires all financial sections plus Clients and Projects permissions.',
    403,
  );
  return transaction(async (tx) => {
    const output: Record<string, unknown> = { financial: financialAccess(p), from, to };
    if (financialAccess(p)) {
      output.totals = await one(
        tx,
        `${revenueCte} SELECT coalesce(sum(amount),0)::text AS all_time,coalesce(sum(amount) FILTER(WHERE date BETWEEN $1::date AND $2::date),0)::text AS revenue,coalesce(sum(amount) FILTER(WHERE date>=date_trunc('month',now() AT TIME ZONE 'Asia/Kolkata')::date AND date<= (now() AT TIME ZONE 'Asia/Kolkata')::date),0)::text AS month,coalesce(sum(amount) FILTER(WHERE date>= (date_trunc('month',now() AT TIME ZONE 'Asia/Kolkata')-interval '1 month')::date AND date<date_trunc('month',now() AT TIME ZONE 'Asia/Kolkata')::date),0)::text AS previous_month FROM cash`,
        [from, to],
      );
      const totals = output.totals as Record<string, unknown>;
      Object.assign(
        totals,
        await one(
          tx,
          'SELECT coalesce(sum(amount_paise),0)::text AS expenses FROM expenses WHERE voided_at IS NULL AND expense_date BETWEEN $1::date AND $2::date',
          [from, to],
        ),
      );
      Object.assign(
        totals,
        await one(
          tx,
          `SELECT coalesce(sum(balance::bigint),0)::text AS outstanding FROM (${docSelect}) d WHERE kind='invoice' AND stored_status='Issued'`,
        ),
      );
      totals.profit = (BigInt(String(totals.revenue)) - BigInt(String(totals.expenses))).toString();
      output.services = (
        await tx.query(
          `WITH allocation AS(SELECT a.service_id,a.amount_paise AS amount,p.payment_date AS date FROM payment_allocations a JOIN payments p ON p.id=a.payment_id UNION ALL SELECT a.service_id,-a.amount_paise,r.refund_date FROM refund_allocations a JOIN refunds r ON r.id=a.refund_id) SELECT s.id,s.name,s.color,coalesce(sum(a.amount),0)::text AS amount FROM service_categories s LEFT JOIN allocation a ON a.service_id=s.id AND a.date BETWEEN $1::date AND $2::date GROUP BY s.id,s.name,s.color ORDER BY sum(a.amount) DESC NULLS LAST`,
          [from, to],
        )
      ).rows;
      output.trend = (
        await tx.query(
          `${revenueCte} SELECT date::text, sum(amount)::text AS revenue,(SELECT coalesce(sum(amount_paise),0)::text FROM expenses e WHERE e.expense_date=cash.date AND e.voided_at IS NULL) AS expenses FROM cash WHERE date BETWEEN $1::date AND $2::date GROUP BY date UNION SELECT expense_date::text,'0' AS revenue,sum(amount_paise)::text AS expenses FROM expenses WHERE voided_at IS NULL AND expense_date BETWEEN $1::date AND $2::date AND expense_date NOT IN(SELECT date FROM cash) GROUP BY expense_date ORDER BY date`,
          [from, to],
        )
      ).rows;
      output.methods = (
        await tx.query(
          `${revenueCte} SELECT method,coalesce(sum(amount),0)::text AS amount FROM cash WHERE date BETWEEN $1::date AND $2::date GROUP BY method ORDER BY sum(amount) DESC`,
          [from, to],
        )
      ).rows;
      output.expenseCategories = (
        await tx.query(
          'SELECT category, sum(amount_paise)::text AS amount FROM expenses WHERE voided_at IS NULL AND expense_date BETWEEN $1::date AND $2::date GROUP BY category ORDER BY sum(amount_paise) DESC',
          [from, to],
        )
      ).rows;
      if (can(p, 'clients')) {
        output.topClients = (
          await tx.query(
            `${revenueCte} SELECT c.id,c.name,c.company,sum(cash.amount)::text AS amount FROM cash JOIN clients c ON c.id=cash.client_id WHERE cash.date BETWEEN $1::date AND $2::date GROUP BY c.id,c.name,c.company ORDER BY sum(cash.amount) DESC LIMIT 5`,
            [from, to],
          )
        ).rows;
        output.clientMetrics = await one(
          tx,
          `${revenueCte} SELECT (SELECT count(*) FROM clients WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date) AS new_clients,(SELECT count(*) FROM (SELECT client_id FROM payments WHERE payment_date BETWEEN $1::date AND $2::date GROUP BY client_id HAVING count(*)>1) repeat) AS repeat_clients,coalesce(round(sum(amount)/nullif(count(DISTINCT client_id),0)),0)::text AS average_revenue FROM cash WHERE date BETWEEN $1::date AND $2::date`,
          [from, to],
        );
      }
      if (can(p, 'projects'))
        output.projectRevenue = (
          await tx.query(
            `${revenueCte} SELECT p.id,p.name,sum(cash.amount)::text AS amount FROM cash JOIN projects p ON p.id=cash.project_id WHERE cash.date BETWEEN $1::date AND $2::date GROUP BY p.id,p.name ORDER BY sum(cash.amount) DESC LIMIT 20`,
            [from, to],
          )
        ).rows;
    }
    if (can(p, 'projects')) {
      output.projects = (
        await tx.query(
          `SELECT p.id,p.name,p.status,p.deadline,p.priority,c.name AS client_name,(SELECT count(*) FROM tasks t WHERE t.project_id=p.id) AS task_count,(SELECT count(*) FROM tasks t WHERE t.project_id=p.id AND status='Completed') AS completed_tasks FROM projects p LEFT JOIN clients c ON c.id=p.client_id WHERE p.status NOT IN('Completed','Cancelled') ORDER BY deadline ASC NULLS LAST LIMIT 6`,
        )
      ).rows;
      output.projectMetrics = await one(
        tx,
        `SELECT count(*) FILTER(WHERE status NOT IN('Completed','Cancelled')) AS active,count(*) FILTER(WHERE status='Completed') AS completed,count(*) FILTER(WHERE status NOT IN('Completed','Cancelled') AND deadline<(now() AT TIME ZONE 'Asia/Kolkata')::date) AS overdue,round(avg(extract(epoch FROM completed_at-created_at)/86400) FILTER(WHERE completed_at IS NOT NULL),1) AS average_days FROM projects`,
      );
    }
    if (can(p, 'tasks'))
      output.deadlines = (
        await tx.query(
          "SELECT id,title,due_date,priority FROM tasks WHERE status<>'Completed' AND due_date IS NOT NULL ORDER BY due_date LIMIT 5",
        )
      ).rows;
    if (can(p, 'payments'))
      output.transactions = (
        await tx.query(
          'SELECT pm.id,pm.reference,pm.amount_paise,pm.payment_date,c.name AS client_name FROM payments pm LEFT JOIN clients c ON c.id=pm.client_id ORDER BY pm.created_at DESC LIMIT 5',
        )
      ).rows;
    if (p.role === 'owner')
      output.activity = (
        await tx.query(
          'SELECT id,section,description,created_at FROM activity_logs ORDER BY created_at DESC LIMIT 8',
        )
      ).rows;
    return output;
  }, p);
}
export async function recordDetail(p: Principal, section: Section, id: string) {
  assertSection(p, section);
  const rows = await listRecords(p, section);
  const record = rows.find((r) => r.id === id);
  insist(record, 'Record not found.', 404);
  const result: Record<string, unknown> = { record };
  if (section === 'clients' || section === 'projects') {
    for (const child of ['projects', 'tasks', 'payments', 'invoices', 'expenses'] as Section[]) {
      if (child === section || !can(p, child) || (child === 'invoices' && !canDocuments(p)))
        continue;
      const data = await listRecords(p, child);
      result[child] = data.filter((r) =>
        section === 'clients' ? r.client_id === id : r.project_id === id,
      );
    }
    Object.assign(
      result,
      await transaction(
        async (tx) => ({
          ...(p.role === 'owner'
            ? {
                attachments: (
                  await tx.query(
                    'SELECT id,name,mime,size,created_at FROM attachments WHERE section=$1 AND record_id=$2',
                    [section, id],
                  )
                ).rows,
                activity: (
                  await tx.query(
                    'SELECT id,description,created_at FROM activity_logs WHERE entity_id=$1 ORDER BY created_at DESC',
                    [id],
                  )
                ).rows,
              }
            : {}),
          ...(section === 'projects'
            ? {
                deliverables: (
                  await tx.query(
                    'SELECT id,title,url,version,delivered_at FROM deliverables WHERE project_id=$1 ORDER BY delivered_at DESC',
                    [id],
                  )
                ).rows,
                ...(financialAccess(p)
                  ? {
                      items: (
                        await tx.query(
                          'SELECT i.id,i.service_id,i.description,i.amount_paise,s.name AS service_name FROM project_service_items i JOIN service_categories s ON s.id=i.service_id WHERE project_id=$1',
                          [id],
                        )
                      ).rows,
                    }
                  : {}),
              }
            : {}),
        }),
        p,
      ),
    );
  }
  if (p.role === 'owner' && ['payments', 'expenses', 'tasks', 'invoices'].includes(section))
    Object.assign(
      result,
      await transaction(
        async (tx) => ({
          attachments: (
            await tx.query(
              'SELECT id,name,mime,size,created_at FROM attachments WHERE section=$1 AND record_id=$2',
              [section, id],
            )
          ).rows,
          activity: (
            await tx.query(
              'SELECT id,description,created_at FROM activity_logs WHERE entity_id=$1 ORDER BY created_at DESC',
              [id],
            )
          ).rows,
        }),
        p,
      ),
    );
  return result;
}
export async function search(p: Principal, query: string) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const result: { id: string; title: string; subtitle: string; section: string }[] = [];
  for (const section of ['clients', 'projects', 'tasks', 'payments', 'invoices'] as Section[]) {
    if (!can(p, section) || (section === 'invoices' && !canDocuments(p))) continue;
    for (const r of await listRecords(p, section)) {
      const title = String(r.name || r.title || r.reference || r.number || '');
      const subtitle = String(r.company || r.client_name || r.project_name || '');
      if ((title + ' ' + subtitle + ' ' + String(r.receipt_number || '')).toLowerCase().includes(q))
        result.push({ id: String(r.id), title, subtitle, section });
    }
  }
  return result.slice(0, 30);
}
export async function bootstrap(p: Principal) {
  return transaction(
    async (tx) => ({
      principal: p,
      categories: (
        await tx.query('SELECT id,name,color,active FROM service_categories ORDER BY name')
      ).rows,
      ...(p.role === 'owner'
        ? {
            settings: (await one<{ data: Record<string, unknown> }>(
              tx,
              'SELECT data FROM agency_settings',
            ))!.data,
            emailConfigured: !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
            storage: process.env.DATABASE_URL ? 'PostgreSQL' : 'Local PostgreSQL (PGlite)',
          }
        : {}),
    }),
    p,
  );
}
export function defaultRange() {
  const to = today();
  return { from: to.slice(0, 7) + '-01', to };
}
export async function exportRecords(p: Principal, section: Section) {
  assertOwner(p);
  const rows = await listRecords(p, section);
  const clean = rows.map((r) =>
    Object.fromEntries(Object.entries(r).filter(([, v]) => v === null || typeof v !== 'object')),
  );
  const keys = [...new Set(clean.flatMap(Object.keys))];
  const escape = (v: unknown) => {
    let text = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return [
    keys.map(escape).join(','),
    ...clean.map((r) => keys.map((k) => escape(r[k])).join(',')),
  ].join('\r\n');
}
