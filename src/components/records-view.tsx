'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, LayoutList, Columns3, Download, ArrowUpRight } from 'lucide-react';
import {
  money,
  dateLabel,
  today,
  projectStatuses,
  financialAccess,
  type Principal,
  type Section,
  type RecordRow,
} from '@/lib/domain';
import { api, send, DataTable, Badge, Loading, type Column } from './ui';
import type { FormKind } from './record-form';
export function RecordsView({
  section,
  principal,
  revision,
  onAdd,
  onNotice,
}: {
  section: Section;
  principal: Principal;
  revision: number;
  onAdd: (kind: FormKind) => void;
  onNotice: (message: string) => void;
}) {
  const [rows, setRows] = useState<RecordRow[] | null>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('table');
  const [filter, setFilter] = useState('All');
  const router = useRouter();
  const owner = principal.role === 'owner';
  const financial = financialAccess(principal);
  useEffect(() => {
    let alive = true;
    setRows(null);
    setError('');
    api<RecordRow[]>(section)
      .then((r) => {
        if (alive) setRows(r);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [section, revision]);
  const label = {
    clients: 'Clients',
    projects: 'Projects',
    tasks: 'Tasks',
    payments: 'Payments',
    invoices: 'Invoices & Receipts',
    expenses: 'Expenses',
    overview: 'Overview',
    analytics: 'Analytics',
  }[section];
  const description = {
    clients: 'Good work starts with good relationships.',
    projects: 'From the first idea to the final delivery.',
    tasks: 'A clear head. A focused studio.',
    payments: 'Every payment, accounted for.',
    invoices: 'Professional paperwork. Clear expectations.',
    expenses: 'Know where your money goes.',
    overview: '',
    analytics: '',
  }[section];
  const nameColumn: Column = {
    key: 'name',
    label: section === 'clients' ? 'Client name' : section === 'projects' ? 'Project' : 'Expense',
  };
  const status: Column = {
    key: 'status',
    label: 'Status',
    render: (r) => <Badge>{String(r.status)}</Badge>,
  };
  const amountColumn = (key: string, label: string): Column => ({
    key,
    label,
    render: (r) => <span className="numeric">{money(r[key])}</span>,
  });
  const dateColumn = (key: string, label: string): Column => ({
    key,
    label,
    render: (r) => dateLabel(r[key]),
  });
  const columns: Record<string, Column[]> = {
    clients: [
      nameColumn,
      { key: 'company', label: 'Company' },
      { key: 'email', label: 'Email' },
      { key: 'active_projects', label: 'Active projects' },
      ...(financial
        ? [amountColumn('revenue', 'Lifetime revenue'), amountColumn('outstanding', 'Outstanding')]
        : []),
      status,
      dateColumn('updated_at', 'Last activity'),
    ],
    projects: [
      nameColumn,
      { key: 'client_name', label: 'Client' },
      status,
      { key: 'priority', label: 'Priority' },
      dateColumn('deadline', 'Deadline'),
      {
        key: 'completed_tasks',
        label: 'Task progress',
        render: (r) => (
          <span>
            {String(r.completed_tasks)} / {String(r.task_count)}
          </span>
        ),
      },
      ...(financial
        ? [amountColumn('value', 'Project value'), amountColumn('received', 'Received')]
        : []),
    ],
    tasks: [
      { key: 'title', label: 'Task' },
      { key: 'project_name', label: 'Project' },
      status,
      { key: 'priority', label: 'Priority', render: (r) => <Badge>{String(r.priority)}</Badge> },
      dateColumn('due_date', 'Due date'),
    ],
    payments: [
      { key: 'reference', label: 'Reference' },
      { key: 'client_name', label: 'Client' },
      { key: 'project_name', label: 'Project' },
      amountColumn('amount_paise', 'Amount'),
      dateColumn('payment_date', 'Date'),
      { key: 'method', label: 'Method' },
      {
        key: 'refunded',
        label: 'Status',
        render: (r) => (
          <Badge>
            {Number(r.refunded) >= Number(r.amount_paise)
              ? 'Refunded'
              : Number(r.refunded) > 0
                ? 'Partially refunded'
                : 'Received'}
          </Badge>
        ),
      },
      {
        key: 'receipt_number',
        label: 'Receipt',
        render: (r) =>
          r.receipt_id ? (
            <a
              className="text-button"
              href={'/api/receipts/' + r.receipt_id + '/pdf'}
              target="_blank"
              rel="noreferrer"
            >
              {String(r.receipt_number)}
              <ArrowUpRight size={13} />
            </a>
          ) : (
            '—'
          ),
      },
    ],
    invoices: [
      { key: 'number', label: 'Document' },
      { key: 'kind', label: 'Type' },
      { key: 'client_name', label: 'Client' },
      amountColumn('total_paise', 'Total'),
      amountColumn('balance', 'Balance'),
      status,
      dateColumn('due_date', 'Due / valid until'),
      {
        key: 'pdf',
        label: 'PDF',
        render: (r) => (
          <a
            className="icon-button"
            aria-label={'Download ' + r.number}
            href={'/api/documents/' + r.id + '/pdf?download=1'}
          >
            <Download size={15} />
          </a>
        ),
      },
    ],
    expenses: [
      nameColumn,
      { key: 'category', label: 'Category' },
      { key: 'vendor', label: 'Vendor' },
      amountColumn('amount_paise', 'Amount'),
      dateColumn('expense_date', 'Date'),
      { key: 'recurrence', label: 'Recurrence' },
      {
        key: 'voided_at',
        label: 'Status',
        render: (r) => <Badge>{r.voided_at ? 'Reversed' : 'Recorded'}</Badge>,
      },
    ],
  };
  let filtered = rows || [];
  if (filter !== 'All') {
    if (section === 'tasks') {
      const d = today();
      filtered = filtered.filter((r) =>
        filter === 'Today'
          ? String(r.due_date).slice(0, 10) === d
          : filter === 'Upcoming'
            ? !!r.due_date && String(r.due_date).slice(0, 10) > d && r.status !== 'Completed'
            : filter === 'Overdue'
              ? !!r.due_date && String(r.due_date).slice(0, 10) < d && r.status !== 'Completed'
              : r.status === filter,
      );
    } else if (section === 'invoices') filtered = filtered.filter((r) => r.kind === filter);
    else if (section === 'expenses')
      filtered = filtered.filter((r) => (filter === 'Active' ? !r.voided_at : !!r.voided_at));
    else filtered = filtered.filter((r) => r.status === filter);
  }
  async function drop(event: React.DragEvent, status: string) {
    event.preventDefault();
    if (!owner) return;
    const id = event.dataTransfer.getData('text/plain');
    if (!rows?.some((r) => r.id === id)) return;
    try {
      await send('projects/' + id + '/status', { status });
      setRows(rows.map((r) => (r.id === id ? { ...r, status } : r)));
      onNotice('Project status updated.');
    } catch (e) {
      onNotice((e as Error).message);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">STUDIO OPERATIONS</span>
          <h1>{label}</h1>
          <p>{description}</p>
        </div>
        {owner && (
          <button className="button primary" onClick={() => onAdd(section as FormKind)}>
            <Plus size={16} />
            {section === 'payments'
              ? 'Record payment'
              : section === 'invoices'
                ? 'Create document'
                : 'Add ' + section.slice(0, -1)}
          </button>
        )}
      </div>
      {rows && ['payments', 'expenses'].includes(section) && (
        <div className="metric-strip">
          {section === 'payments' ? (
            <>
              <div>
                <span>Total received, net of refunds</span>
                <strong>
                  {money(rows.reduce((s, r) => s + Number(r.amount_paise) - Number(r.refunded), 0))}
                </strong>
              </div>
              <div>
                <span>Received this month · gross</span>
                <strong>
                  {money(
                    rows
                      .filter((r) => String(r.payment_date).startsWith(today().slice(0, 7)))
                      .reduce((s, r) => s + Number(r.amount_paise), 0),
                  )}
                </strong>
              </div>
              <div>
                <span>Payment methods</span>
                <strong>{new Set(rows.map((r) => r.method)).size}</strong>
              </div>
            </>
          ) : (
            <>
              <div>
                <span>Total expenses</span>
                <strong>
                  {money(
                    rows
                      .filter((r) => !r.voided_at)
                      .reduce((s, r) => s + Number(r.amount_paise), 0),
                  )}
                </strong>
              </div>
              <div>
                <span>This month</span>
                <strong>
                  {money(
                    rows
                      .filter(
                        (r) =>
                          !r.voided_at && String(r.expense_date).startsWith(today().slice(0, 7)),
                      )
                      .reduce((s, r) => s + Number(r.amount_paise), 0),
                  )}
                </strong>
              </div>
              <div>
                <span>Recurring reminders</span>
                <strong>
                  {rows.filter((r) => !r.voided_at && r.recurrence !== 'None').length}
                </strong>
              </div>
            </>
          )}
        </div>
      )}
      <div className="record-toolbar">
        <div className="segmented">
          {(section === 'tasks'
            ? ['All', 'Today', 'Upcoming', 'Overdue', 'Completed']
            : section === 'invoices'
              ? ['All', 'invoice', 'quotation']
              : section === 'clients'
                ? ['All', 'Lead', 'Active', 'Inactive', 'Archived']
                : section === 'projects'
                  ? ['All', ...projectStatuses]
                  : section === 'expenses'
                    ? ['All', 'Active', 'Reversed']
                    : ['All']
          ).map((f) => (
            <button key={f} className={filter === f ? 'selected' : ''} onClick={() => setFilter(f)}>
              {f === 'invoice' ? 'Invoices' : f === 'quotation' ? 'Quotations' : f}
            </button>
          ))}
        </div>
        <div className="table-controls">
          {owner && (
            <a className="button small" href={'/api/export?section=' + section}>
              <Download size={14} />
              Export
            </a>
          )}
          {section === 'projects' && (
            <div className="segmented">
              <button
                aria-label="Table view"
                className={mode === 'table' ? 'selected' : ''}
                onClick={() => setMode('table')}
              >
                <LayoutList size={16} />
              </button>
              <button
                aria-label="Kanban view"
                className={mode === 'kanban' ? 'selected' : ''}
                onClick={() => setMode('kanban')}
              >
                <Columns3 size={16} />
              </button>
            </div>
          )}
        </div>
      </div>
      {error ? (
        <div className="error-message" role="alert">
          {error}
        </div>
      ) : !rows ? (
        <Loading />
      ) : mode === 'kanban' && section === 'projects' ? (
        <div className="kanban">
          {projectStatuses.map((status) => (
            <section
              key={status}
              className="kanban-column"
              onDragOver={(e) => {
                if (owner) e.preventDefault();
              }}
              onDrop={(e) => drop(e, status)}
            >
              <h3>
                <i />
                {status}
                <span>{filtered.filter((r) => r.status === status).length}</span>
              </h3>
              {filtered
                .filter((r) => r.status === status)
                .map((r) => (
                  <article
                    key={r.id}
                    draggable={owner}
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', r.id)}
                  >
                    <button
                      className="text-button"
                      onClick={() => router.push('/projects/' + r.id)}
                    >
                      {String(r.name)}
                    </button>
                    <p>{String(r.client_name || 'Project')}</p>
                    <div>
                      <Badge>{String(r.priority)}</Badge>
                      <small>{dateLabel(r.deadline)}</small>
                    </div>
                    {owner && (
                      <label className="sr-only">
                        Move project
                        <select
                          value={String(r.status)}
                          onChange={async (e) => {
                            await send('projects/' + r.id + '/status', { status: e.target.value });
                            setRows(
                              rows.map((p) =>
                                p.id === r.id ? { ...p, status: e.target.value } : p,
                              ),
                            );
                          }}
                        >
                          {projectStatuses.map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      </label>
                    )}
                  </article>
                ))}
            </section>
          ))}
        </div>
      ) : (
        <DataTable
          rows={filtered}
          columns={columns[section] || []}
          onRow={(r) => router.push('/' + section + '/' + r.id)}
          emptyTitle={'No ' + label.toLowerCase() + ' yet'}
        />
      )}
    </>
  );
}
