'use client';
import { useState } from 'react';
import {
  Save,
  Plus,
  Mail,
  ShieldCheck,
  Database,
  Palette,
  Building2,
  CreditCard,
  Download,
} from 'lucide-react';
import type { RecordRow } from '@/lib/domain';
import { send, Panel, Modal } from './ui';
export function Settings({
  settings,
  categories,
  emailConfigured,
  storage,
  onNotice,
  onRefresh,
}: {
  settings: Record<string, unknown>;
  categories: RecordRow[];
  emailConfigured: boolean;
  storage: string;
  onNotice: (message: string) => void;
  onRefresh: () => void;
}) {
  const [tab, setTab] = useState('Agency profile');
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState<RecordRow | boolean | null>(null);
  const [values, setValues] = useState(settings);
  const tabs = [
    ['Agency profile', Building2],
    ['Financial & receipts', CreditCard],
    ['Service categories', Palette],
    ['Email delivery', Mail],
    ['Security', ShieldCheck],
    ['Appearance', Palette],
    ['Data & backups', Database],
  ] as const;
  const fields: Record<string, { key: string; label: string; type?: string; full?: boolean }[]> = {
    'Agency profile': [
      { key: 'name', label: 'Agency name' },
      { key: 'tagline', label: 'Tagline' },
      { key: 'email', label: 'Contact email', type: 'email' },
      { key: 'phone', label: 'Phone' },
      { key: 'website', label: 'Website', type: 'url' },
      { key: 'address', label: 'Business address', type: 'textarea', full: true },
    ],
    'Financial & receipts': [
      { key: 'currency', label: 'Currency' },
      { key: 'gst', label: 'GST registration (optional)' },
      { key: 'taxBps', label: 'Default tax rate · basis points', type: 'number' },
      { key: 'invoicePrefix', label: 'Invoice prefix' },
      { key: 'receiptPrefix', label: 'Receipt prefix' },
      { key: 'quotePrefix', label: 'Quotation prefix' },
      { key: 'paymentTerms', label: 'Default payment terms', type: 'textarea', full: true },
      { key: 'bankDetails', label: 'Bank details', type: 'textarea', full: true },
      { key: 'upi', label: 'UPI ID' },
      { key: 'footer', label: 'Document footer', type: 'textarea', full: true },
    ],
    Security: [
      { key: 'requestTimeoutMinutes', label: 'Request timeout (1–15 minutes)', type: 'number' },
      { key: 'sessionMinutes', label: 'Viewer session (5–480 minutes)', type: 'number' },
      { key: 'idleMinutes', label: 'Inactivity timeout (5–60 minutes)', type: 'number' },
    ],
    Appearance: [{ key: 'accent', label: 'Accent color', type: 'color' }],
  };
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const defaults = {
        name: 'AVX Studios',
        tagline: 'Art • Visual • Experience',
        email: '',
        phone: '',
        website: '',
        address: '',
        gst: '',
        receiptPrefix: 'AVX-RCP',
        invoicePrefix: 'AVX-INV',
        quotePrefix: 'AVX-QTE',
        footer: '',
        paymentTerms: '',
        bankDetails: '',
        upi: '',
        currency: 'INR',
        taxBps: 0,
        requestTimeoutMinutes: 5,
        sessionMinutes: 60,
        idleMinutes: 15,
        accent: '#ff002c',
      };
      await send('settings', { ...defaults, ...values });
      onNotice('Agency settings saved.');
      onRefresh();
    } catch (e) {
      onNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">MAKE IT YOURS</span>
          <h1>Settings</h1>
          <p>The details that make this your studio.</p>
        </div>
        <span className="pill">
          <ShieldCheck size={13} />
          Owner only
        </span>
      </div>
      <div className="settings-layout">
        <nav className="settings-nav">
          {tabs.map(([name, Icon]) => (
            <button
              key={name}
              className={tab === name ? 'selected' : ''}
              onClick={() => setTab(name)}
            >
              <Icon size={16} />
              {name}
            </button>
          ))}
        </nav>
        <div>
          {fields[tab] && (
            <Panel
              title={tab}
              subtitle={
                tab === 'Appearance'
                  ? 'AVX’s black, white, and red visual system.'
                  : tab === 'Security'
                    ? 'Policy changes apply to new sessions. Revoke existing access from Viewer Access.'
                    : undefined
              }
            >
              <form onSubmit={save}>
                <div className="form-scroll form-grid">
                  {fields[tab].map((f) => (
                    <label key={f.key} className={f.full ? 'span-2' : ''}>
                      {f.label}
                      {f.type === 'textarea' ? (
                        <textarea
                          value={String(values[f.key] || '')}
                          onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                          rows={3}
                          maxLength={4000}
                        />
                      ) : (
                        <input
                          value={String(values[f.key] ?? '')}
                          readOnly={f.key === 'currency'}
                          type={f.type || 'text'}
                          onChange={(e) =>
                            setValues({
                              ...values,
                              [f.key]:
                                f.type === 'number' ? Number(e.target.value) : e.target.value,
                            })
                          }
                          required={[
                            'name',
                            'receiptPrefix',
                            'invoicePrefix',
                            'quotePrefix',
                          ].includes(f.key)}
                        />
                      )}
                    </label>
                  ))}
                </div>
                <div className="modal-actions">
                  <button disabled={busy} className="button primary">
                    <Save size={15} />
                    {busy ? 'Saving…' : 'Save settings'}
                  </button>
                </div>
              </form>
            </Panel>
          )}
          {tab === 'Security' && (
            <Panel
              title="Change owner password"
              subtitle="Other owner sessions will be signed out."
            >
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const data = new FormData(form);
                  try {
                    await send('password', {
                      currentPassword: data.get('current'),
                      newPassword: data.get('next'),
                    });
                    form.reset();
                    onNotice('Password changed. Other owner sessions were revoked.');
                  } catch (e) {
                    onNotice((e as Error).message);
                  }
                }}
              >
                <div className="form-scroll form-grid">
                  <label>
                    Current password
                    <input
                      name="current"
                      type="password"
                      required
                      autoComplete="current-password"
                    />
                  </label>
                  <label>
                    New password
                    <input
                      name="next"
                      type="password"
                      minLength={12}
                      maxLength={128}
                      required
                      autoComplete="new-password"
                    />
                  </label>
                </div>
                <div className="modal-actions">
                  <button className="button">Change password</button>
                </div>
              </form>
            </Panel>
          )}
          {tab === 'Service categories' && (
            <Panel
              title="Services"
              subtitle="Disabled categories remain in financial history."
              action={
                <button className="button small" onClick={() => setCategory(true)}>
                  <Plus size={14} />
                  Add service
                </button>
              }
            >
              <div className="category-list">
                {categories.map((c) => (
                  <button key={c.id} onClick={() => setCategory(c)}>
                    <i style={{ background: String(c.color) }} />
                    <strong>{String(c.name)}</strong>
                    <span>{c.active ? 'Active' : 'Disabled'}</span>
                  </button>
                ))}
              </div>
            </Panel>
          )}
          {tab === 'Email delivery' && (
            <Panel title="Receipt delivery" subtitle="Powered by Resend">
              <div className="settings-copy">
                <span className={`badge ${emailConfigured ? 'green' : 'neutral'}`}>
                  <i />
                  {emailConfigured ? 'Configured' : 'Setup required'}
                </span>
                <p>
                  Receipt emails include the PDF and an optional copy to your agency email. Messages
                  are sent only when you choose Send to Client or Email Copy to Me.
                </p>
                <p>Set these variables in your server environment, then restart:</p>
                <pre>
                  RESEND_API_KEY
                  <br />
                  EMAIL_FROM
                  <br />
                  OWNER_COPY_EMAIL
                </pre>
                <p>
                  Verify your sending domain with Resend. An accepted status means the provider
                  received the request; it does not confirm inbox delivery. PDFs remain available
                  for manual download.
                </p>
              </div>
            </Panel>
          )}
          {tab === 'Data & backups' && (
            <>
              <Panel title="Storage & backups">
                <div className="settings-copy">
                  <span className="pill">{storage}</span>
                  <p>
                    Financial totals are calculated from payments, refunds, invoices, and expenses.
                    Receipt PDFs are stored with immutable historical snapshots.
                  </p>
                  <p>
                    For production, use PostgreSQL with automated encrypted backups and
                    point-in-time recovery. Test restoration regularly. For local storage, stop the
                    app before copying the complete <code>.data/avx</code> directory.
                  </p>
                  <p>
                    See the project README and deployment guide for migration and recovery commands.
                  </p>
                </div>
              </Panel>
              <Panel title="Export your data">
                <div className="action-stack">
                  {['clients', 'projects', 'tasks', 'payments', 'invoices', 'expenses'].map((s) => (
                    <a key={s} className="button" href={'/api/export?section=' + s}>
                      <Download size={15} />
                      {s[0].toUpperCase() + s.slice(1)} CSV
                    </a>
                  ))}
                </div>
              </Panel>
            </>
          )}
        </div>
      </div>
      <Modal
        open={!!category}
        onClose={() => setCategory(null)}
        title={typeof category === 'object' ? 'Edit service' : 'Add service'}
      >
        <form
          key={typeof category === 'object' ? category?.id : 'new'}
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            try {
              await send(
                'categories' + (typeof category === 'object' ? '/' + category?.id : ''),
                {
                  name: form.get('name'),
                  color: form.get('color'),
                  active: form.get('active') === 'on',
                },
                typeof category === 'object' ? 'PATCH' : 'POST',
              );
              setCategory(null);
              onRefresh();
              onNotice('Service saved.');
            } catch (e) {
              onNotice((e as Error).message);
            }
          }}
        >
          <div className="form-scroll form-grid">
            <label className="span-2">
              Name
              <input
                name="name"
                defaultValue={typeof category === 'object' ? String(category?.name || '') : ''}
                required
                maxLength={100}
              />
            </label>
            <label>
              Color
              <input
                name="color"
                type="color"
                defaultValue={
                  typeof category === 'object' ? String(category?.color || '#8b8cf8') : '#8b8cf8'
                }
              />
            </label>
            <label className="check-label">
              <input
                name="active"
                type="checkbox"
                defaultChecked={typeof category === 'object' ? Boolean(category?.active) : true}
              />
              Active
            </label>
          </div>
          <div className="modal-actions">
            <button className="button primary">Save service</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
