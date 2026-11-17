'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Edit3, Download, Upload, Plus, ExternalLink } from 'lucide-react';
import {
  money,
  dateLabel,
  financialAccess,
  type Principal,
  type RecordRow,
  type Section,
} from '@/lib/domain';
import { api, send, Badge, Panel, Loading, DataTable, Empty, Modal } from './ui';
import type { FormKind } from './record-form';
export function RecordDetail({
  section,
  id,
  principal,
  revision,
  onEdit,
  onNotice,
  onRefresh,
}: {
  section: Section;
  id: string;
  principal: Principal;
  revision: number;
  onEdit: (kind: FormKind, row: RecordRow, items?: RecordRow[]) => void;
  onNotice: (message: string) => void;
  onRefresh: () => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('Overview');
  const [action, setAction] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const owner = principal.role === 'owner';
  useEffect(() => {
    let alive = true;
    api<Record<string, unknown>>(`${section}/${id}`)
      .then((v) => {
        if (alive) {
          setData(v);
          setError('');
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [section, id, revision]);
  if (error) return <div className="error-message">{error}</div>;
  if (!data) return <Loading />;
  const r = data.record as RecordRow;
  const profile = (r.profile || {}) as Record<string, unknown>;
  const related = ['Projects', 'Tasks', 'Payments', 'Invoices', 'Expenses'].filter((s) =>
    Array.isArray(data[s.toLowerCase()]),
  );
  const tabs = [
    'Overview',
    ...related,
    ...(section === 'projects' ? ['Deliverables'] : []),
    ...(owner
      ? [
          ...(['clients', 'projects', 'payments', 'expenses'].includes(section) ? ['Files'] : []),
          'Activity',
        ]
      : []),
  ];
  const title = String(r.name || r.title || r.reference || r.number);
  async function run(url: string, body: unknown, method = 'POST') {
    setBusy(true);
    try {
      const result = await send(url, body, method);
      setAction(null);
      onNotice(String(result.message || 'Saved successfully.'));
      onRefresh();
      return true;
    } catch (e) {
      onNotice((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Files must be 5 MB or smaller.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      let raw = '';
      for (let i = 0; i < bytes.length; i += 8192)
        raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
      await send('attachments', {
        section,
        recordId: id,
        name: file.name,
        mime: file.type,
        content: btoa(raw),
      });
      onNotice('File stored securely.');
      onRefresh();
    } catch (e) {
      onNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Link className="back-link" href={'/' + section}>
        <ArrowLeft size={15} />
        Back to {section}
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">{section.slice(0, -1)} PROFILE</span>
          <h1>{title}</h1>
          <p>
            {String(
              r.company || r.client_name || r.project_name || r.description || 'Your studio record',
            )}
          </p>
        </div>
        <div className="table-controls">
          {!!r.status && <Badge>{String(r.status)}</Badge>}
          {owner && ['clients', 'projects', 'tasks'].includes(section) && (
            <button
              className="button"
              onClick={() => onEdit(section as FormKind, r, data.items as RecordRow[])}
            >
              <Edit3 size={15} />
              Edit
            </button>
          )}
          {section === 'invoices' && (
            <a className="button" href={'/api/documents/' + id + '/pdf?download=1'}>
              <Download size={15} />
              Download PDF
            </a>
          )}
          {section === 'payments' && !!r.receipt_id && (
            <a
              className="button"
              href={'/api/receipts/' + r.receipt_id + '/pdf'}
              target="_blank"
              rel="noreferrer"
            >
              <Download size={15} />
              View receipt
            </a>
          )}
        </div>
      </div>
      <div className="tabs">
        {tabs.map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'Overview' && (
        <>
          <div className="detail-grid">
            <Panel title="Details">
              <dl className="details-list">
                {Object.entries({ ...r, ...(section === 'clients' ? profile : {}) })
                  .filter(
                    ([k, v]) =>
                      ![
                        'id',
                        'profile',
                        'created_at',
                        'updated_at',
                        'client_id',
                        'project_id',
                        'invoice_id',
                        'receipt_id',
                        'stored_status',
                      ].includes(k) &&
                      v !== null &&
                      v !== '' &&
                      typeof v !== 'object',
                  )
                  .map(([key, value]) => (
                    <div key={key}>
                      <dt>{key.replaceAll('_', ' ').replace('paise', '(INR)')}</dt>
                      <dd>
                        {[
                          'amount_paise',
                          'total_paise',
                          'balance',
                          'received',
                          'revenue',
                          'value',
                          'outstanding',
                          'refunded',
                        ].includes(key)
                          ? money(value)
                          : /date|deadline|_at$/.test(key)
                            ? dateLabel(value)
                            : String(value)}
                      </dd>
                    </div>
                  ))}
              </dl>
            </Panel>
            <div className="detail-side">
              {section === 'projects' && (
                <Panel title="Project progress">
                  <div className="progress-summary">
                    <strong>
                      {Number(r.task_count)
                        ? Math.round((Number(r.completed_tasks) / Number(r.task_count)) * 100)
                        : 0}
                      %
                    </strong>
                    <p>
                      {String(r.completed_tasks)} of {String(r.task_count)} tasks complete
                    </p>
                    <div className="progress-track">
                      <i
                        style={{
                          width: `${Number(r.task_count) ? (Number(r.completed_tasks) / Number(r.task_count)) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    {financialAccess(principal) && (
                      <>
                        <h3>Payment progress</h3>
                        <p>
                          {money(r.received)} received of {money(r.value)} project value
                        </p>
                        <div className="progress-track">
                          <i
                            style={{
                              width: `${Math.min(100, Number(r.value) ? (Number(r.received) / Number(r.value)) * 100 : 0)}%`,
                            }}
                          />
                        </div>
                        <p>
                          Outstanding issued invoices:{' '}
                          {money(
                            ((data.invoices || []) as RecordRow[])
                              .filter((i) => i.kind === 'invoice' && i.stored_status === 'Issued')
                              .reduce((sum, i) => sum + Number(i.balance), 0),
                          )}
                        </p>
                      </>
                    )}
                  </div>
                </Panel>
              )}
              {section === 'clients' && financialAccess(principal) && (
                <Panel title="Client financials">
                  <dl className="details-list">
                    <div>
                      <dt>Total contract value</dt>
                      <dd>
                        {money(
                          ((data.projects || []) as RecordRow[]).reduce(
                            (sum, p) => sum + Number(p.value || 0),
                            0,
                          ),
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Total received</dt>
                      <dd>{money(r.revenue)}</dd>
                    </div>
                    <div>
                      <dt>Outstanding invoices</dt>
                      <dd>{money(r.outstanding)}</dd>
                    </div>
                    <div>
                      <dt>Completed projects</dt>
                      <dd>
                        {
                          ((data.projects || []) as RecordRow[]).filter(
                            (p) => p.status === 'Completed',
                          ).length
                        }
                      </dd>
                    </div>
                  </dl>
                </Panel>
              )}
              {owner && (
                <Panel title="Record actions">
                  <div className="action-stack">
                    {section === 'payments' && (
                      <>
                        <button className="button" onClick={() => setAction('refund')}>
                          Record refund / correction
                        </button>
                        {r.receipt_id && (
                          <>
                            <button
                              className="button"
                              onClick={() =>
                                run('receipts/' + r.receipt_id + '/email', { copyOnly: false })
                              }
                            >
                              Send receipt to client
                            </button>
                            <button
                              className="button"
                              onClick={() =>
                                run('receipts/' + r.receipt_id + '/email', { copyOnly: true })
                              }
                            >
                              Email copy to me
                            </button>
                          </>
                        )}
                      </>
                    )}
                    {section === 'expenses' && !r.voided_at && (
                      <button className="button danger" onClick={() => setAction('void')}>
                        Reverse expense
                      </button>
                    )}
                    {section === 'invoices' && (
                      <>
                        {r.stored_status === 'Draft' && (
                          <button
                            className="button"
                            onClick={() => run('invoices/' + id + '/issue', {})}
                          >
                            Issue document
                          </button>
                        )}
                        {r.kind === 'quotation' && r.stored_status === 'Issued' && (
                          <button
                            className="button"
                            onClick={() => run('invoices/' + id + '/accept', {})}
                          >
                            Mark quote accepted
                          </button>
                        )}
                        {r.kind === 'quotation' && r.stored_status === 'Accepted' && (
                          <button
                            className="button primary"
                            onClick={() => run('invoices/' + id + '/convert', {})}
                          >
                            Convert to project & invoice
                          </button>
                        )}
                        {!['Voided', 'Converted'].includes(String(r.stored_status)) && (
                          <button
                            className="button danger"
                            onClick={() => setAction('voidDocument')}
                          >
                            Void document
                          </button>
                        )}
                      </>
                    )}
                    {['clients', 'tasks'].includes(section) && (
                      <button className="button danger" onClick={() => setAction('delete')}>
                        Delete {section.slice(0, -1)}
                      </button>
                    )}
                    {section === 'projects' && (
                      <button className="button" onClick={() => setAction('deliverable')}>
                        <Plus size={15} />
                        Add deliverable
                      </button>
                    )}
                    <p className="muted">
                      Financial history is preserved. Corrections create an audit record.
                    </p>
                  </div>
                </Panel>
              )}
            </div>
          </div>
          {data.items && (
            <Panel title="Billable services">
              <DataTable
                rows={data.items as RecordRow[]}
                columns={[
                  { key: 'service_name', label: 'Service' },
                  { key: 'description', label: 'Description' },
                  { key: 'amount_paise', label: 'Value', render: (r) => money(r.amount_paise) },
                ]}
              />
            </Panel>
          )}
        </>
      )}
      {related.includes(tab) && (
        <DataTable
          rows={data[tab.toLowerCase()] as RecordRow[]}
          columns={[
            {
              key:
                tab === 'Tasks'
                  ? 'title'
                  : tab === 'Payments'
                    ? 'reference'
                    : tab === 'Invoices'
                      ? 'number'
                      : 'name',
              label: tab.slice(0, -1),
            },
            {
              key: tab === 'Payments' ? 'method' : 'status',
              label: tab === 'Payments' ? 'Method' : 'Status',
            },
            ...(['Payments', 'Invoices', 'Expenses'].includes(tab)
              ? [
                  {
                    key: tab === 'Invoices' ? 'total_paise' : 'amount_paise',
                    label: 'Amount',
                    render: (r: RecordRow) =>
                      money(r[tab === 'Invoices' ? 'total_paise' : 'amount_paise']),
                  },
                ]
              : []),
            {
              key: 'open',
              label: 'Open',
              render: (r) => (
                <Link
                  className="icon-button"
                  aria-label="Open record"
                  href={'/' + tab.toLowerCase() + '/' + r.id}
                >
                  <ExternalLink size={15} />
                </Link>
              ),
            },
          ]}
        />
      )}
      {tab === 'Deliverables' && (
        <Panel
          title="Deliverables"
          action={
            owner ? (
              <button className="button small" onClick={() => setAction('deliverable')}>
                <Plus size={14} />
                Add
              </button>
            ) : undefined
          }
        >
          {(data.deliverables as RecordRow[])?.length ? (
            <DataTable
              rows={data.deliverables as RecordRow[]}
              columns={[
                { key: 'title', label: 'Title' },
                { key: 'version', label: 'Version' },
                {
                  key: 'delivered_at',
                  label: 'Delivered',
                  render: (r) => dateLabel(r.delivered_at),
                },
                {
                  key: 'url',
                  label: 'Link',
                  render: (r) => (
                    <a
                      href={String(r.url)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-button"
                    >
                      Open deliverable <ExternalLink size={13} />
                    </a>
                  ),
                },
              ]}
            />
          ) : (
            <Empty
              title="Ready when you are"
              text="Add links to versions, final files, and delivery records."
            />
          )}
        </Panel>
      )}
      {tab === 'Files' && owner && (
        <Panel
          title="Private attachments"
          subtitle="PDF, PNG, JPG or WebP · maximum 5 MB · owner only"
          action={
            <label className="button small file-label">
              <Upload size={14} />
              {busy ? 'Uploading…' : 'Upload file'}
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp"
                disabled={busy}
                onChange={(e) => upload(e.target.files?.[0])}
              />
            </label>
          }
        >
          {(data.attachments as RecordRow[])?.length ? (
            <DataTable
              rows={data.attachments as RecordRow[]}
              columns={[
                { key: 'name', label: 'File' },
                {
                  key: 'size',
                  label: 'Size',
                  render: (r) => Math.round(Number(r.size) / 1024) + ' KB',
                },
                {
                  key: 'download',
                  label: 'Download',
                  render: (r) => (
                    <a
                      href={'/api/attachments/' + r.id}
                      className="icon-button"
                      aria-label={'Download ' + r.name}
                    >
                      <Download size={15} />
                    </a>
                  ),
                },
              ]}
            />
          ) : (
            <Empty
              title="Keep your references close"
              text="Upload a brief, agreement, or payment proof."
            />
          )}
        </Panel>
      )}
      {tab === 'Activity' && (
        <Panel title="Activity timeline">
          {(data.activity as RecordRow[])?.length ? (
            <div className="activity-list">
              {(data.activity as RecordRow[]).map((a) => (
                <div key={a.id}>
                  <i />
                  <div>
                    <p>{String(a.description)}</p>
                    <small>{dateLabel(a.created_at)}</small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty />
          )}
        </Panel>
      )}
      <Modal
        open={!!action}
        onClose={() => setAction(null)}
        title={
          action === 'refund'
            ? 'Record refund'
            : action === 'deliverable'
              ? 'Add deliverable'
              : action === 'delete'
                ? 'Delete record'
                : 'Confirm correction'
        }
        description={
          action === 'delete'
            ? 'This removes the record if it has no linked financial history.'
            : 'This action is recorded in your studio history.'
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            if (action === 'refund')
              void run('payments/' + id + '/refund', {
                idempotencyKey: crypto.randomUUID(),
                amount: form.get('amount'),
                refundDate: form.get('date'),
                reason: form.get('reason'),
              });
            else if (action === 'deliverable')
              void run('projects/' + id + '/deliverables', {
                title: form.get('title'),
                url: form.get('url'),
                version: form.get('version'),
              });
            else if (action === 'void')
              void run('expenses/' + id + '/void', { reason: form.get('reason') });
            else if (action === 'voidDocument') void run('invoices/' + id + '/void', {});
            else if (action === 'delete')
              void run(section + '/' + id, {}, 'DELETE').then((ok) => {
                if (ok) router.push('/' + section);
              });
          }}
        >
          <div className="form-scroll form-grid">
            {action === 'refund' && (
              <>
                <label>
                  Amount (INR)
                  <input name="amount" type="number" min="0.01" step="0.01" required />
                </label>
                <label>
                  Refund date
                  <input name="date" type="date" required />
                </label>
              </>
            )}
            {['refund', 'void'].includes(action || '') && (
              <label className="span-2">
                Reason
                <textarea name="reason" minLength={5} maxLength={4000} required />
              </label>
            )}
            {action === 'deliverable' && (
              <>
                <label className="span-2">
                  Title
                  <input name="title" required maxLength={160} />
                </label>
                <label className="span-2">
                  HTTPS link
                  <input name="url" type="url" required />
                </label>
                <label>
                  Version
                  <input name="version" defaultValue="1" required maxLength={40} />
                </label>
              </>
            )}
          </div>
          <div className="modal-actions">
            <button type="button" className="button" onClick={() => setAction(null)}>
              Cancel
            </button>
            <button disabled={busy} className="button primary">
              {busy ? 'Saving…' : 'Confirm'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
