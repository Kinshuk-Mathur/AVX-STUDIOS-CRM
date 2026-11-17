'use client';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { LoaderCircle, Plus, Trash2, RefreshCw } from 'lucide-react';
import {
  sections,
  sectionNames,
  projectStatuses,
  paymentMethods,
  expenseCategories,
  today,
  type RecordRow,
} from '@/lib/domain';
import { send } from './ui';
export type FormKind =
  'clients' | 'projects' | 'tasks' | 'payments' | 'invoices' | 'expenses' | 'viewers';
export interface Lookups {
  clients: RecordRow[];
  projects: RecordRow[];
  invoices: RecordRow[];
  categories: RecordRow[];
}
type Field = {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  full?: boolean;
  hint?: string;
};
const opts = (values: readonly string[]) => values.map((v) => ({ value: v, label: v }));
const records = (rows: RecordRow[], label = 'name') =>
  rows.map((r) => ({ value: r.id, label: String(r[label]) }));
const priorities = opts(['Low', 'Medium', 'High', 'Urgent']);
function decimal(v: unknown) {
  return (Number(v || 0) / 100).toFixed(2);
}
function defaults(kind: FormKind, record?: RecordRow): Record<string, unknown> {
  const d = today();
  if (!record)
    return {
      status:
        kind === 'tasks'
          ? 'To Do'
          : kind === 'projects'
            ? 'Planning'
            : kind === 'invoices'
              ? 'Issued'
              : 'Active',
      priority: 'Medium',
      startDate: d,
      paymentDate: d,
      expenseDate: d,
      issueDate: d,
      dueDate: d,
      kind: 'invoice',
      discount: '0',
      taxBps: '0',
      method: 'UPI',
      category: 'Software',
      recurrence: 'None',
      permissions: ['overview', 'projects', 'tasks'],
    };
  if (kind === 'clients') return record;
  if (kind === 'viewers')
    return {
      name: record.display_name,
      username: record.username,
      status: record.status,
      expiresAt: record.expires_at ? String(record.expires_at).slice(0, 16) : '',
      permissions: record.permissions,
    };
  return {
    name: record.name,
    title: record.title,
    description: record.description,
    clientId: record.client_id,
    projectId: record.project_id || '',
    status: record.status,
    priority: record.priority,
    startDate: record.start_date ? String(record.start_date).slice(0, 10) : '',
    deadline: record.deadline ? String(record.deadline).slice(0, 10) : '',
    dueDate: record.due_date ? String(record.due_date).slice(0, 10) : '',
    notes: record.notes,
  };
}
export function RecordForm({
  kind,
  lookups,
  record,
  projectItems,
  onSaved,
  onCancel,
}: {
  kind: FormKind;
  lookups: Lookups;
  record?: RecordRow;
  projectItems?: RecordRow[];
  onSaved: (result: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const { register, handleSubmit, control, setValue } = useForm<Record<string, unknown>>({
    defaultValues: defaults(kind, record),
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [submissionKey] = useState(() => crypto.randomUUID());
  const [items, setItems] = useState(
    () =>
      projectItems?.map((i) => ({
        serviceId: String(i.service_id),
        description: String(i.description),
        amount: decimal(i.amount_paise),
        quantity: 1,
        rate: decimal(i.amount_paise),
      })) || [
        {
          serviceId: String(lookups.categories.find((c) => c.active)?.id || ''),
          description: '',
          amount: '',
          quantity: 1,
          rate: '',
        },
      ],
  );
  const clientId = String(useWatch({ control, name: 'clientId' }) || '');
  const projectId = String(useWatch({ control, name: 'projectId' }) || '');
  const fields: Record<FormKind, Field[]> = {
    clients: [
      { name: 'name', label: 'Full name', required: true },
      { name: 'company', label: 'Company' },
      { name: 'email', label: 'Email', type: 'email' },
      {
        name: 'status',
        label: 'Status',
        options: opts(['Lead', 'Active', 'Inactive', 'Archived']),
      },
      { name: 'profile.mobile', label: 'Mobile number', type: 'tel' },
      { name: 'profile.whatsapp', label: 'WhatsApp number', type: 'tel' },
      { name: 'profile.city', label: 'City' },
      { name: 'profile.country', label: 'Country' },
      { name: 'profile.address', label: 'Billing address', full: true },
      { name: 'profile.website', label: 'Website', type: 'url' },
      { name: 'profile.social', label: 'Instagram / social link', type: 'url' },
      { name: 'profile.type', label: 'Client type' },
      { name: 'profile.services', label: 'Interested services' },
      { name: 'profile.source', label: 'Lead source' },
      { name: 'profile.acquisitionDate', label: 'Acquisition date', type: 'date' },
      { name: 'profile.gst', label: 'GST details (if applicable)' },
      { name: 'profile.tags', label: 'Tags', hint: 'Separate with commas' },
      { name: 'profile.links', label: 'Important links', full: true },
      { name: 'profile.notes', label: 'Internal notes', type: 'textarea', full: true },
    ],
    projects: [
      { name: 'name', label: 'Project name', required: true },
      { name: 'clientId', label: 'Client', required: true, options: records(lookups.clients) },
      { name: 'description', label: 'Description', type: 'textarea', full: true },
      { name: 'status', label: 'Status', options: opts(projectStatuses) },
      { name: 'priority', label: 'Priority', options: priorities },
      { name: 'startDate', label: 'Start date', type: 'date' },
      { name: 'deadline', label: 'Deadline', type: 'date' },
      { name: 'notes', label: 'Internal notes', type: 'textarea', full: true },
    ],
    tasks: [
      { name: 'title', label: 'Task title', required: true, full: true },
      { name: 'projectId', label: 'Related project', options: records(lookups.projects) },
      { name: 'priority', label: 'Priority', options: priorities },
      { name: 'status', label: 'Status', options: opts(['To Do', 'In Progress', 'Completed']) },
      { name: 'dueDate', label: 'Due date', type: 'date' },
      { name: 'description', label: 'Description', type: 'textarea', full: true },
      { name: 'notes', label: 'Internal notes', type: 'textarea', full: true },
    ],
    payments: [
      { name: 'clientId', label: 'Client', required: true, options: records(lookups.clients) },
      {
        name: 'projectId',
        label: 'Project',
        required: true,
        options: records(lookups.projects.filter((p) => p.client_id === clientId)),
      },
      {
        name: 'invoiceId',
        label: 'Invoice (optional)',
        options: records(
          lookups.invoices.filter(
            (i) =>
              i.kind === 'invoice' &&
              i.stored_status === 'Issued' &&
              Number(i.balance) > 0 &&
              i.client_id === clientId &&
              i.project_id === projectId,
          ),
          'number',
        ),
        full: true,
      },
      { name: 'amount', label: 'Amount received (INR)', required: true, type: 'number' },
      { name: 'paymentDate', label: 'Payment date', required: true, type: 'date' },
      { name: 'method', label: 'Payment method', options: opts(paymentMethods) },
      { name: 'transactionRef', label: 'Transaction reference / UTR' },
      {
        name: 'description',
        label: 'Description (shown on receipt)',
        type: 'textarea',
        full: true,
      },
      { name: 'notes', label: 'Internal note', type: 'textarea', full: true },
    ],
    invoices: [
      {
        name: 'kind',
        label: 'Document type',
        options: [
          { value: 'invoice', label: 'Invoice' },
          { value: 'quotation', label: 'Quotation' },
        ],
      },
      { name: 'status', label: 'Status', options: opts(['Draft', 'Issued']) },
      { name: 'clientId', label: 'Client', required: true, options: records(lookups.clients) },
      {
        name: 'projectId',
        label: 'Project (optional)',
        options: records(lookups.projects.filter((p) => p.client_id === clientId)),
      },
      { name: 'issueDate', label: 'Issue date', required: true, type: 'date' },
      { name: 'dueDate', label: 'Due / valid until', required: true, type: 'date' },
      { name: 'discount', label: 'Discount (INR)', type: 'number' },
      {
        name: 'taxBps',
        label: 'Tax rate in basis points',
        type: 'number',
        hint: '100 basis points = 1%. Requires GST details.',
      },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true },
      { name: 'terms', label: 'Terms & payment instructions', type: 'textarea', full: true },
    ],
    expenses: [
      { name: 'name', label: 'Expense name', required: true, full: true },
      { name: 'amount', label: 'Amount (INR)', required: true, type: 'number' },
      { name: 'expenseDate', label: 'Expense date', required: true, type: 'date' },
      { name: 'category', label: 'Category', options: opts(expenseCategories) },
      { name: 'vendor', label: 'Vendor' },
      { name: 'method', label: 'Payment method', options: opts(paymentMethods) },
      { name: 'projectId', label: 'Related project', options: records(lookups.projects) },
      {
        name: 'recurrence',
        label: 'Recurrence reminder',
        options: opts(['None', 'Monthly', 'Yearly']),
        hint: 'Each actual payment is recorded separately.',
      },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true },
    ],
    viewers: [
      { name: 'name', label: 'Viewer name', required: true },
      {
        name: 'username',
        label: 'Login username',
        required: true,
        hint: 'A custom username; no email domain required.',
      },
      {
        name: 'password',
        label: record ? 'New password (leave blank to keep)' : 'Initial password',
        required: !record,
        type: 'password',
      },
      { name: 'status', label: 'Account status', options: opts(['Active', 'Disabled']) },
      { name: 'expiresAt', label: 'Account expiry (optional)', type: 'datetime-local', full: true },
    ],
  };
  async function submit(raw: Record<string, unknown>) {
    setBusy(true);
    setError('');
    try {
      const data: Record<string, unknown> = { ...raw };
      delete data.permissions;
      if (kind === 'projects')
        data.items = items.map(({ serviceId, description, amount }) => ({
          serviceId,
          description,
          amount,
        }));
      if (kind === 'invoices') {
        data.items = items.map(({ serviceId, description, quantity, rate }) => ({
          serviceId,
          description,
          quantity: Number(quantity),
          rate,
        }));
        data.taxBps = Number(data.taxBps || 0);
      }
      if (kind === 'payments') data.idempotencyKey = submissionKey;
      if (kind === 'viewers') {
        data.permissions = raw.permissions;
        data.expiresAt = raw.expiresAt ? new Date(String(raw.expiresAt)).toISOString() : null;
        if (!raw.password) delete data.password;
      }
      // Only send the schema fields for this form, avoiding persisted record metadata.
      const roots = new Set(fields[kind].map((f) => f.name.split('.')[0]));
      for (const key of Object.keys(data))
        if (!roots.has(key) && !['items', 'idempotencyKey', 'permissions'].includes(key))
          delete data[key];
      const result = await send(
        `${kind}${record ? '/' + record.id : ''}`,
        data,
        record ? 'PATCH' : 'POST',
      );
      onSaved(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={handleSubmit(submit)}>
      <div className="form-scroll">
        <div className="form-grid">
          {fields[kind].map((f) => (
            <label key={f.name} className={f.full ? 'span-2' : ''}>
              {f.label}
              {f.required && <span className="required"> *</span>}
              {f.options ? (
                <select {...register(f.name)} required={f.required}>
                  <option value="">Select…</option>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : f.type === 'textarea' ? (
                <textarea {...register(f.name)} rows={3} maxLength={4000} />
              ) : (
                <input
                  {...register(f.name)}
                  type={f.type || 'text'}
                  required={f.required}
                  step={f.name === 'taxBps' ? '1' : f.type === 'number' ? '0.01' : undefined}
                  min={f.type === 'number' ? '0' : undefined}
                  minLength={f.type === 'password' ? 12 : undefined}
                  maxLength={f.type === 'password' ? 128 : 4000}
                  autoComplete={f.type === 'password' ? 'new-password' : 'off'}
                />
              )}{' '}
              {f.hint && <small>{f.hint}</small>}
            </label>
          ))}
        </div>
        {(kind === 'projects' || kind === 'invoices') && (
          <div className="line-items">
            <div className="subheading">
              <h3>
                Service line items <span>INR</span>
              </h3>
              <button
                type="button"
                className="button small"
                onClick={() =>
                  setItems([
                    ...items,
                    {
                      serviceId: String(lookups.categories[0]?.id || ''),
                      description: '',
                      amount: '',
                      quantity: 1,
                      rate: '',
                    },
                  ])
                }
              >
                <Plus size={14} />
                Add item
              </button>
            </div>
            {items.map((item, index) => (
              <div className="line-item" key={index}>
                <label>
                  Service
                  <select
                    aria-label={'Service ' + (index + 1)}
                    value={item.serviceId}
                    onChange={(e) =>
                      setItems(
                        items.map((v, i) =>
                          i === index ? { ...v, serviceId: e.target.value } : v,
                        ),
                      )
                    }
                    required
                  >
                    <option value="">Select service</option>
                    {lookups.categories
                      .filter((c) => c.active)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {String(c.name)}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="line-description">
                  Description
                  <input
                    value={item.description}
                    onChange={(e) =>
                      setItems(
                        items.map((v, i) =>
                          i === index ? { ...v, description: e.target.value } : v,
                        ),
                      )
                    }
                    required
                    maxLength={160}
                  />
                </label>
                {kind === 'invoices' && (
                  <label>
                    Qty
                    <input
                      type="number"
                      min={1}
                      max={10000}
                      step={1}
                      value={item.quantity}
                      onChange={(e) =>
                        setItems(
                          items.map((v, i) =>
                            i === index ? { ...v, quantity: Number(e.target.value) } : v,
                          ),
                        )
                      }
                      required
                    />
                  </label>
                )}
                <label>
                  {kind === 'invoices' ? 'Rate (₹)' : 'Value (₹)'}
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={kind === 'invoices' ? item.rate : item.amount}
                    onChange={(e) =>
                      setItems(
                        items.map((v, i) =>
                          i === index
                            ? { ...v, [kind === 'invoices' ? 'rate' : 'amount']: e.target.value }
                            : v,
                        ),
                      )
                    }
                    required
                  />
                </label>
                <button
                  type="button"
                  aria-label={'Remove line item ' + (index + 1)}
                  className="icon-button"
                  disabled={items.length === 1}
                  onClick={() => setItems(items.filter((_, i) => i !== index))}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
        {kind === 'viewers' && (
          <>
            <button
              type="button"
              className="button small"
              onClick={() => {
                const bytes = crypto.getRandomValues(new Uint8Array(20));
                const password = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
                setValue('password', password);
                navigator.clipboard
                  ?.writeText(password)
                  .then(() => setError('Secure password generated and copied. Share it privately.'))
                  .catch(() =>
                    setError(
                      'Password generated. Use the field’s reveal control to save it before continuing.',
                    ),
                  );
              }}
            >
              <RefreshCw size={14} /> Generate & copy password
            </button>
            <fieldset className="permission-grid">
              <legend>Visible sections · read only</legend>
              {sections.map((s) => (
                <label key={s}>
                  <input type="checkbox" value={s} {...register('permissions')} />
                  {sectionNames[s]}
                </label>
              ))}
            </fieldset>
            <p className="notice">
              Every login requires your approval. Saving changes revokes existing sessions. Invoice
              documents require Clients, Projects and Payments permissions too; financial summaries
              also require Expenses and Analytics.
            </p>
          </>
        )}
        {kind === 'payments' && (
          <div className="notice">
            Only record money already received. A unique PDF receipt is created when this
            transaction is saved. Attach payment proof from the saved payment.
          </div>
        )}
        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}
      </div>
      <div className="modal-actions">
        <button type="button" onClick={onCancel} className="button">
          Cancel
        </button>
        <button className="button primary" disabled={busy}>
          {busy && <LoaderCircle className="spin" size={16} />}{' '}
          {busy
            ? 'Saving…'
            : kind === 'payments'
              ? 'Record payment'
              : record
                ? 'Save changes'
                : 'Create ' +
                  ({
                    clients: 'client',
                    projects: 'project',
                    tasks: 'task',
                    invoices: 'document',
                    expenses: 'expense',
                    viewers: 'viewer',
                  }[kind] || 'record')}
        </button>
      </div>
    </form>
  );
}
