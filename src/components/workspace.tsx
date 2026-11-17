'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  FolderKanban,
  CheckSquare2,
  Wallet,
  FileText,
  Receipt,
  ChartNoAxesCombined,
  ShieldCheck,
  Settings2,
  Search,
  Bell,
  Plus,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  ArrowUpRight,
  LogOut,
  X,
  Check,
  Download,
  Mail,
  CheckCircle2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  sectionNames,
  sections,
  can,
  type Principal,
  type RecordRow,
  type Section,
} from '@/lib/domain';
import { api, send, Modal, Loading } from './ui';
import { Dashboard } from './dashboard';
import { RecordsView } from './records-view';
import { RecordDetail } from './record-detail';
import { RecordForm, type FormKind, type Lookups } from './record-form';
import { ViewerAdmin } from './viewer-admin';
import { Settings } from './settings';
interface Boot {
  principal: Principal;
  categories: RecordRow[];
  settings?: Record<string, unknown>;
  emailConfigured?: boolean;
  storage?: string;
}
const navigation = [
  ['overview', LayoutDashboard],
  ['clients', Users],
  ['projects', FolderKanban],
  ['tasks', CheckSquare2],
  ['payments', Wallet],
  ['invoices', FileText],
  ['expenses', Receipt],
  ['analytics', ChartNoAxesCombined],
  ['viewers', ShieldCheck],
  ['settings', Settings2],
] as const;
const quickOptions: [FormKind, string, typeof Users][] = [
  ['clients', 'Add client', Users],
  ['projects', 'Create project', FolderKanban],
  ['payments', 'Record payment', Wallet],
  ['invoices', 'Create invoice / quotation', FileText],
  ['expenses', 'Add expense', Receipt],
  ['tasks', 'Add task', CheckSquare2],
];
export function Workspace({ section, recordId }: { section: string; recordId?: string }) {
  const router = useRouter();
  const [boot, setBoot] = useState<Boot | null>(null);
  const [error, setError] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [quick, setQuick] = useState(false);
  const [profile, setProfile] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<
    { id: string; title: string; subtitle: string; section: string }[]
  >([]);
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [form, setForm] = useState<{
    kind: FormKind;
    record?: RecordRow;
    items?: RecordRow[];
  } | null>(null);
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [requests, setRequests] = useState<RecordRow[]>([]);
  const [notifications, setNotifications] = useState(false);
  const [success, setSuccess] = useState<Record<string, unknown> | null>(null);
  const [connected, setConnected] = useState(false);
  const [sound, setSound] = useState(false);
  const seen = useRef(new Set<string>());
  const audio = useRef<AudioContext | null>(null);
  const activeSessionId = boot?.principal.sessionId;
  const notify = useCallback((message: string) => setNotice(message), []);
  const refresh = useCallback(() => {
    setRevision((v) => v + 1);
    api<Boot>('bootstrap')
      .then(setBoot)
      .catch(() => {});
  }, []);
  useEffect(() => {
    const end = () => router.replace('/login');
    window.addEventListener('avx:unauthorized', end);
    return () => window.removeEventListener('avx:unauthorized', end);
  }, [router]);
  useEffect(() => {
    api<Boot>('bootstrap')
      .then(setBoot)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 6500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((s) => !s);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api<typeof results>('search?q=' + encodeURIComponent(query), { signal: controller.signal })
        .then(setResults)
        .catch(() => {});
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  useEffect(() => {
    if (!activeSessionId) return;
    const stream = new EventSource('/api/events');
    stream.onmessage = (e) => {
      setConnected(true);
      const v = JSON.parse(e.data) as {
        status: string;
        requests?: RecordRow[];
        reconcile: boolean;
      };
      if (v.status !== 'approved') {
        stream.close();
        router.replace('/viewer-login');
        return;
      }
      if (v.reconcile) setRevision((r) => r + 1);
      if (v.requests) {
        setRequests(v.requests);
        for (const request of v.requests) {
          if (seen.current.has(request.id)) continue;
          seen.current.add(request.id);
          setNotifications(true);
          if (sound && audio.current) {
            const ctx = audio.current;
            const oscillator = ctx.createOscillator();
            const gain = ctx.createGain();
            oscillator.connect(gain);
            gain.connect(ctx.destination);
            oscillator.frequency.value = 660;
            gain.gain.setValueAtTime(0.04, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
            oscillator.start();
            oscillator.stop(ctx.currentTime + 0.25);
          }
          if ('Notification' in window && Notification.permission === 'granted')
            new Notification('AVX OS · Access Request', {
              body: String(request.display_name) + ' is requesting access.',
            });
        }
      }
    };
    stream.onerror = () => setConnected(false);
    return () => stream.close();
  }, [activeSessionId, router, sound]);
  useEffect(() => {
    if (!activeSessionId) return;
    let lastTouch = 0;
    const touch = () => {
      if (Date.now() - lastTouch < 30000) return;
      lastTouch = Date.now();
      void send('activity', {}).catch(() => {});
    };
    for (const event of ['pointerdown', 'keydown', 'scroll'])
      window.addEventListener(event, touch, { passive: true });
    return () => {
      for (const event of ['pointerdown', 'keydown', 'scroll'])
        window.removeEventListener(event, touch);
    };
  }, [activeSessionId]);
  useEffect(() => {
    if (boot?.settings?.accent)
      document.documentElement.style.setProperty('--accent', String(boot.settings.accent));
  }, [boot?.settings?.accent]);
  async function openForm(kind: FormKind, record?: RecordRow, items?: RecordRow[]) {
    setQuick(false);
    setLookups(null);
    setForm({ kind, record, items });
    try {
      const [clients, projects, invoices] = await Promise.all([
        api<RecordRow[]>('clients'),
        api<RecordRow[]>('projects'),
        api<RecordRow[]>('invoices'),
      ]);
      setLookups({ clients, projects, invoices, categories: boot!.categories });
    } catch (e) {
      notify((e as Error).message);
      setForm(null);
    }
  }
  async function decide(id: string, action: string) {
    try {
      await send(`access/${id}/${action}`, {});
      setRequests((r) => r.filter((v) => v.id !== id));
      notify(action === 'approve' ? 'Viewer session approved.' : 'Request rejected.');
      refresh();
    } catch (e) {
      notify((e as Error).message);
    }
  }
  if (!boot)
    return (
      <main className="initial-loading">
        <div className="brand-word">
          AVX<span>OS</span>
        </div>
        {error ? (
          <div className="error-message">
            {error}
            <Link href="/login">Sign in</Link>
          </div>
        ) : (
          <Loading />
        )}
      </main>
    );
  const owner = boot.principal.role === 'owner';
  const allowed =
    owner || (sections.includes(section as Section) && can(boot.principal, section as Section));
  const valid = navigation.some(([key]) => key === section);
  const name = boot.principal.name;
  return (
    <div className={`app-shell ${collapsed ? 'is-collapsed' : ''}`}>
      <button
        className={`mobile-scrim ${mobile ? 'visible' : ''}`}
        aria-label="Close navigation"
        onClick={() => setMobile(false)}
      />
      <aside className={`sidebar ${mobile ? 'mobile-open' : ''}`}>
        <Link href="/overview" className="brand-word">
          AVX<span>OS</span>
          <i />
        </Link>
        <div className="workspace-label">
          <span className="workspace-logo">A</span>
          <div>
            <strong>AVX Studios</strong>
            <small>Private workspace</small>
          </div>
          <ShieldCheck size={14} />
        </div>
        <span className="nav-label">WORKSPACE</span>
        <nav>
          {navigation
            .filter(
              ([key]) =>
                owner || (sections.includes(key as Section) && can(boot.principal, key as Section)),
            )
            .map(([key, Icon], i) => (
              <Link
                key={key}
                title={collapsed ? sectionNames[key] : undefined}
                className={`${section === key ? 'active' : ''} ${i === 8 ? 'nav-separator' : ''}`}
                href={'/' + key}
                onClick={() => setMobile(false)}
              >
                <Icon size={18} />
                <span>{sectionNames[key]}</span>
                {key === 'viewers' && requests.length > 0 && <b>{requests.length}</b>}
                {key === section && <i />}
              </Link>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <a
            className="studio-link"
            href="https://avxstudios.netlify.app"
            target="_blank"
            rel="noreferrer"
          >
            <span>Visit the studio</span>
            <ArrowUpRight size={15} />
          </a>
          <div className="private-label">
            <ShieldCheck size={13} />
            <span>YOUR STUDIO. YOUR SPACE.</span>
          </div>
          <button
            className="collapse-button"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            <span>Collapse sidebar</span>
          </button>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div className="topbar-title">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <span className="breadcrumb">
              Workspace <span>/</span>
            </span>
            <strong>{sectionNames[section as keyof typeof sectionNames] || 'Not found'}</strong>
            {!owner && <span className="view-only">VIEW ONLY</span>}
          </div>
          <div className="topbar-actions">
            <button className="global-search" onClick={() => setSearchOpen(true)}>
              <Search size={16} />
              <span>Search anything…</span>
              <kbd>⌘ K</kbd>
            </button>
            <span
              className={`connection-dot ${connected ? 'live' : ''}`}
              title={connected ? 'Live connection' : 'Reconnecting'}
            />
            {owner && (
              <div className="popover-anchor">
                <button
                  className="icon-button notification-button"
                  aria-label={'Notifications, ' + requests.length + ' pending access requests'}
                  onClick={() => setNotifications(!notifications)}
                >
                  <Bell size={18} />
                  {requests.length > 0 && <i />}
                </button>
                {notifications && (
                  <div className="notification-popover">
                    <div className="popover-title">
                      <strong>
                        Access requests <span>{requests.length}</span>
                      </strong>
                      <button
                        className="icon-button"
                        onClick={() => setNotifications(false)}
                        aria-label="Close notifications"
                      >
                        <X size={16} />
                      </button>
                    </div>
                    {requests.length ? (
                      requests.map((r) => (
                        <div className="notification-request" key={r.id}>
                          <strong>{String(r.display_name)} is requesting access.</strong>
                          <p>
                            {String(r.username)} ·{' '}
                            {new Date(String(r.created_at)).toLocaleTimeString()}
                          </p>
                          <small>{String(r.device)}</small>
                          <div>
                            <button
                              className="button primary small"
                              onClick={() => decide(r.id, 'approve')}
                            >
                              <Check size={13} />
                              Approve Access
                            </button>
                            <button className="button small" onClick={() => decide(r.id, 'reject')}>
                              Reject
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="popover-empty">No pending requests. You’re all caught up.</p>
                    )}
                    <div className="notification-options">
                      <button
                        className="text-button"
                        onClick={() => {
                          if (!sound) {
                            audio.current ??= new AudioContext();
                            void audio.current.resume();
                          }
                          setSound(!sound);
                        }}
                      >
                        {sound ? <Volume2 size={14} /> : <VolumeX size={14} />}Sound{' '}
                        {sound ? 'on' : 'off'}
                      </button>
                      <button
                        className="text-button"
                        onClick={async () => {
                          if (!('Notification' in window)) {
                            notify('Desktop notifications are not supported by this browser.');
                            return;
                          }
                          const permission = await Notification.requestPermission();
                          notify('Desktop notifications: ' + permission);
                        }}
                      >
                        Desktop notifications
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {owner && (
              <div className="popover-anchor">
                <button className="button primary quick-add" onClick={() => setQuick(!quick)}>
                  <Plus size={16} />
                  <span>Quick Add</span>
                  <ChevronDown size={13} />
                </button>
                {quick && (
                  <div className="quick-menu">
                    {quickOptions.map(([kind, label, Icon]) => (
                      <button key={kind} onClick={() => openForm(kind)}>
                        <Icon size={16} />
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="popover-anchor">
              <button
                className="avatar profile-avatar"
                aria-label="Profile menu"
                onClick={() => setProfile(!profile)}
              >
                {name
                  .split(' ')
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join('')}
              </button>
              {profile && (
                <div className="profile-popover">
                  <strong>{name}</strong>
                  <p>{owner ? 'Studio owner' : 'Read-only viewer'}</p>
                  <button
                    onClick={async () => {
                      await send('auth/logout', {});
                      router.replace(owner ? '/login' : '/viewer-login');
                    }}
                  >
                    <LogOut size={15} />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="page-content">
          {!valid ? (
            <div className="empty">
              <h1>Page not found</h1>
              <Link href="/overview">Return to workspace</Link>
            </div>
          ) : !allowed ? (
            <div className="empty">
              <ShieldCheck size={32} />
              <h1>This section is private.</h1>
              <p>Your owner hasn’t shared access to this part of the workspace.</p>
            </div>
          ) : recordId ? (
            <RecordDetail
              key={section + '/' + recordId}
              section={section as Section}
              id={recordId}
              principal={boot.principal}
              revision={revision}
              onEdit={openForm}
              onNotice={notify}
              onRefresh={refresh}
            />
          ) : section === 'overview' || section === 'analytics' ? (
            <Dashboard
              analytics={section === 'analytics'}
              revision={revision}
              onAdd={() => openForm('payments')}
              owner={owner}
            />
          ) : section === 'viewers' ? (
            <ViewerAdmin
              revision={revision}
              onAdd={() => openForm('viewers')}
              onEdit={(r) => openForm('viewers', r)}
              onNotice={notify}
              onRefresh={refresh}
            />
          ) : section === 'settings' ? (
            <Settings
              key={JSON.stringify(boot.settings)}
              settings={boot.settings || {}}
              categories={boot.categories}
              emailConfigured={!!boot.emailConfigured}
              storage={boot.storage || ''}
              onNotice={notify}
              onRefresh={refresh}
            />
          ) : (
            <RecordsView
              key={section}
              section={section as Section}
              principal={boot.principal}
              revision={revision}
              onAdd={openForm}
              onNotice={notify}
            />
          )}
          <footer className="workspace-footer">
            <span>
              AVX OS <i /> Art · Visual · Experience
            </span>
            <span>
              <ShieldCheck size={12} />
              Private studio workspace
            </span>
          </footer>
        </main>
      </div>
      <Modal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        title="Search your workspace"
        description="Only records you can access appear here."
      >
        <div className="command-input">
          <Search size={19} />
          <input
            autoFocus
            placeholder="Clients, projects, payments, invoices, tasks…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="command-results">
          {results.length ? (
            results.map((r) => (
              <button
                key={r.section + r.id}
                onClick={() => {
                  router.push('/' + r.section + '/' + r.id);
                  setSearchOpen(false);
                }}
              >
                <div>
                  <strong>{r.title}</strong>
                  <small>{r.subtitle}</small>
                </div>
                <span>{r.section}</span>
                <ArrowUpRight size={15} />
              </button>
            ))
          ) : (
            <p>
              {query.length < 2
                ? 'Type at least two characters to search.'
                : 'No matching records.'}
            </p>
          )}
        </div>
      </Modal>
      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form ? (form.record ? 'Edit ' : 'Create ') + sectionNames[form.kind] : 'Add record'}
        description="Keep your studio’s information accurate and up to date."
        wide
      >
        {form && lookups ? (
          <RecordForm
            key={form.kind + (form.record?.id || 'new')}
            kind={form.kind}
            lookups={lookups}
            record={form.record}
            projectItems={form.items}
            onCancel={() => setForm(null)}
            onSaved={(result) => {
              if (form.kind === 'payments') setSuccess(result);
              else notify('Record saved successfully.');
              setForm(null);
              refresh();
            }}
          />
        ) : (
          <Loading />
        )}
      </Modal>
      <Modal
        open={!!success}
        onClose={() => setSuccess(null)}
        title="Payment Recorded"
        description="Your payment has been saved and the receipt is ready."
      >
        <div className="payment-success">
          <CheckCircle2 size={46} />
          <strong>{String(success?.number || 'Payment saved')}</strong>
          <p>Your dashboard and financial records are up to date.</p>
          <div className="success-actions">
            <a
              className="button primary"
              href={'/api/receipts/' + success?.receipt_id + '/pdf'}
              target="_blank"
              rel="noreferrer"
            >
              View receipt <ArrowUpRight size={15} />
            </a>
            <a className="button" href={'/api/receipts/' + success?.receipt_id + '/pdf?download=1'}>
              <Download size={15} />
              Download PDF
            </a>
            {[false, true].map((copyOnly) => (
              <button
                key={String(copyOnly)}
                className="button"
                onClick={async () => {
                  try {
                    const result = await send('receipts/' + success?.receipt_id + '/email', {
                      copyOnly,
                    });
                    notify(String(result.message));
                  } catch (e) {
                    notify((e as Error).message);
                  }
                }}
              >
                <Mail size={15} />
                {copyOnly ? 'Email copy to me' : 'Send to client'}
              </button>
            ))}
          </div>
        </div>
      </Modal>
      {notice && (
        <div role="status" className="toast">
          <CheckCircle2 size={17} />
          <span>{notice}</span>
          <button aria-label="Dismiss message" onClick={() => setNotice('')}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
