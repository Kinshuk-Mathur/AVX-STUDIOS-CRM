'use client';
import { useEffect, useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  ArrowUpRight,
  ArrowDownRight,
  Wallet,
  ArrowDownLeft,
  CreditCard,
  TrendingUp,
  FolderKanban,
  Receipt,
  Plus,
  CalendarDays,
} from 'lucide-react';
import { money, dateLabel, today, type RecordRow } from '@/lib/domain';
import { api, Panel, Empty, Badge, ViewLink, Loading } from './ui';
interface DashboardData {
  financial: boolean;
  totals?: Record<string, string>;
  services?: RecordRow[];
  trend?: RecordRow[];
  projects?: RecordRow[];
  projectMetrics?: Record<string, string>;
  transactions?: RecordRow[];
  deadlines?: RecordRow[];
  activity?: RecordRow[];
  topClients?: RecordRow[];
  methods?: RecordRow[];
  expenseCategories?: RecordRow[];
  projectRevenue?: RecordRow[];
  clientMetrics?: Record<string, string>;
}
function rangeFor(label: string) {
  const to = today();
  const end = new Date(to + 'T12:00:00Z');
  const days = label === '7d' ? 6 : label === '90d' ? 89 : 29;
  const from =
    label === 'year'
      ? to.slice(0, 4) + '-01-01'
      : label === 'all'
        ? '2000-01-01'
        : new Date(+end - days * 86400000).toISOString().slice(0, 10);
  return { from, to };
}
export function Dashboard({
  analytics = false,
  revision,
  onAdd,
  owner,
}: {
  analytics?: boolean;
  revision: number;
  onAdd: () => void;
  owner: boolean;
}) {
  const [range, setRange] = useState(() => rangeFor('30d'));
  const [preset, setPreset] = useState('30d');
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const [service, setService] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api<DashboardData>(`${analytics ? 'analytics' : 'overview'}?from=${range.from}&to=${range.to}`)
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
  }, [analytics, range, revision]);
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      hour: 'numeric',
      hour12: false,
      timeZone: 'Asia/Kolkata',
    }).format(new Date()),
  );
  const greeting = hour < 12 ? 'Good morning.' : hour < 17 ? 'Good afternoon.' : 'Good evening.';
  const totals = data?.totals;
  const chart = (data?.trend || []).map((r) => ({
    ...r,
    date: String(r.date),
    revenue: Number(r.revenue) / 100,
    expenses: Number(r.expenses) / 100,
  }));
  const selectedServices = (data?.services || []).filter((s) => !service || s.id === service);
  const positive = (data?.services || []).reduce(
    (sum, s) => sum + Math.max(0, Number(s.amount)),
    0,
  );
  const change = Number(totals?.previous_month)
    ? ((Number(totals?.month) - Number(totals?.previous_month)) / Number(totals?.previous_month)) *
      100
    : null;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {analytics ? 'THE BIGGER PICTURE' : 'YOUR STUDIO AT A GLANCE'}
          </span>
          <h1>{analytics ? 'Financial clarity.' : greeting}</h1>
          <p>
            {analytics
              ? 'Follow the numbers. Understand what moves your studio forward.'
              : 'Here’s what’s happening at AVX Studios.'}
          </p>
        </div>
        <div className="date-chip">
          <CalendarDays size={15} />
          {dateLabel(today())}
        </div>
      </div>
      <div className="report-toolbar">
        <div className="segmented">
          {[
            ['7d', '7 Days'],
            ['30d', '30 Days'],
            ['90d', '90 Days'],
            ['year', 'This Year'],
            ['all', 'All Time'],
            ['custom', 'Custom'],
          ].map(([key, label]) => (
            <button
              className={preset === key ? 'selected' : ''}
              key={key}
              onClick={() => {
                setPreset(key);
                if (key !== 'custom') setRange(rangeFor(key));
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {preset === 'custom' ? (
          <div className="date-range">
            <input
              aria-label="From date"
              type="date"
              value={range.from}
              max={range.to}
              onChange={(e) => {
                if (e.target.value) setRange({ ...range, from: e.target.value });
              }}
            />
            <span>to</span>
            <input
              aria-label="To date"
              type="date"
              value={range.to}
              min={range.from}
              onChange={(e) => {
                if (e.target.value) setRange({ ...range, to: e.target.value });
              }}
            />
          </div>
        ) : (
          <span className="muted">
            {dateLabel(range.from)} — {dateLabel(range.to)} · INR
          </span>
        )}
      </div>
      {error ? (
        <div className="error-message" role="alert">
          {error}
        </div>
      ) : !data ? (
        <Loading />
      ) : (
        <>
          {data.financial && totals ? (
            <>
              <div className="stats-grid">
                {[
                  {
                    label: 'All-time Revenue',
                    value: totals.all_time,
                    icon: Wallet,
                    caption: 'Received, less refunds · all time',
                    className: 'highlight',
                  },
                  {
                    label: 'This Month',
                    value: totals.month,
                    icon: ArrowDownLeft,
                    caption:
                      change === null
                        ? 'No previous-month revenue'
                        : `${change >= 0 ? '+' : ''}${change.toFixed(1)}% vs. last month`,
                  },
                  {
                    label: 'Pending Payments',
                    value: totals.outstanding,
                    icon: CreditCard,
                    caption: 'Outstanding issued invoices',
                  },
                  {
                    label: 'Expenses',
                    value: totals.expenses,
                    icon: Receipt,
                    caption: 'Recorded in selected period',
                  },
                  {
                    label: 'Operating Profit',
                    value: totals.profit,
                    icon: TrendingUp,
                    caption: 'Cash basis · selected period',
                  },
                  {
                    label: 'Active Projects',
                    value: data.projectMetrics?.active || '0',
                    icon: FolderKanban,
                    caption: 'Currently in the studio',
                    count: true,
                  },
                ].map((card) => (
                  <div className={`stat-card ${card.className || ''}`} key={card.label}>
                    <div className="stat-top">
                      <span>{card.label}</span>
                      <card.icon size={16} />
                    </div>
                    <strong>{card.count ? card.value : money(card.value)}</strong>
                    <div className="stat-caption">
                      {card.label === 'This Month' &&
                        change !== null &&
                        (change >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />)}
                      {card.caption}
                    </div>
                  </div>
                ))}
              </div>
              <Panel
                title="Revenue by Service"
                subtitle="Every rupee, attributed. Net received revenue in this period."
                action={
                  <span className="pill">
                    {(data.services || []).filter((s) => Number(s.amount) > 0).length} revenue
                    sources
                  </span>
                }
              >
                <div className="service-breakdown">
                  {positive > 0 ? (
                    <>
                      <div className="service-bar">
                        {(data.services || [])
                          .filter((s) => Number(s.amount) > 0)
                          .map((s) => (
                            <button
                              aria-label={`${s.name}: ${money(s.amount)}`}
                              key={s.id}
                              title={`${s.name} · ${money(s.amount)} · ${((Number(s.amount) / positive) * 100).toFixed(1)}%`}
                              style={{
                                width: `${(Number(s.amount) / positive) * 100}%`,
                                background: String(s.color),
                                opacity: service && service !== s.id ? 0.35 : 1,
                              }}
                              onClick={() => setService(service === s.id ? null : s.id)}
                            />
                          ))}
                      </div>
                      <div className="service-legend">
                        {selectedServices
                          .filter((s) => Number(s.amount) !== 0)
                          .map((s) => (
                            <button
                              key={s.id}
                              onClick={() => setService(service === s.id ? null : s.id)}
                            >
                              <span>
                                <i style={{ background: String(s.color) }} />
                                {String(s.name)}
                              </span>
                              <strong>
                                {money(s.amount)}{' '}
                                <small>{((Number(s.amount) / positive) * 100).toFixed(1)}%</small>
                              </strong>
                            </button>
                          ))}
                      </div>
                      {service && (
                        <button className="text-button" onClick={() => setService(null)}>
                          Show all services
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="service-empty">
                      <div className="service-bar empty-bar" />
                      <p>Your service mix starts with your first payment.</p>
                      {owner && (
                        <button className="text-button" onClick={onAdd}>
                          Record a payment <ArrowUpRight size={13} />
                        </button>
                      )}
                    </div>
                  )}
                  {(data.services || []).some((s) => Number(s.amount) < 0) && (
                    <p className="muted">
                      Negative values reflect refunds in this period. The bar shows positive net
                      contributions.
                    </p>
                  )}
                </div>
              </Panel>
              <div className="dashboard-columns">
                <Panel
                  title="Revenue Trend"
                  subtitle="Cash received across your studio"
                  action={
                    <span className="chart-key">
                      <i />
                      Revenue
                      {analytics && (
                        <>
                          <i className="expense-dot" />
                          Expenses
                        </>
                      )}
                    </span>
                  }
                  className="trend-panel"
                >
                  {chart.length ? (
                    <div className="chart-wrap">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chart} margin={{ top: 15, right: 18, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#ff4565" stopOpacity={0.2} />
                              <stop offset="100%" stopColor="#ff4565" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid vertical={false} stroke="#242226" strokeDasharray="3 5" />
                          <XAxis
                            dataKey="date"
                            tickFormatter={(v) =>
                              new Date(v + 'T12:00:00Z').toLocaleDateString('en-IN', {
                                day: 'numeric',
                                month: 'short',
                              })
                            }
                            stroke="#38343c"
                            tick={{ fill: '#827d88', fontSize: 10 }}
                            tickLine={false}
                            minTickGap={40}
                          />
                          <YAxis
                            tickFormatter={(v) => '₹' + (v >= 1000 ? v / 1000 + 'k' : v)}
                            stroke="transparent"
                            tick={{ fill: '#827d88', fontSize: 10 }}
                            width={60}
                          />
                          <Tooltip
                            contentStyle={{
                              background: '#18151c',
                              border: '1px solid #39323e',
                              borderRadius: 8,
                            }}
                            formatter={(v) => money(Number(v) * 100)}
                          />
                          <Area
                            type="monotone"
                            dataKey="revenue"
                            stroke="#ff4565"
                            fill="url(#revenueFill)"
                            strokeWidth={2.5}
                          />
                          {analytics && (
                            <Area
                              type="monotone"
                              dataKey="expenses"
                              stroke="#8b8cf8"
                              fill="transparent"
                              strokeWidth={2}
                            />
                          )}
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <Empty
                      title="A fresh start"
                      text="Your revenue trend appears as payments are recorded."
                    />
                  )}
                </Panel>
                <Panel
                  title="Top Clients"
                  subtitle="Ranked by received revenue"
                  action={<ViewLink href="/clients" />}
                >
                  {data.topClients?.length ? (
                    <div className="rank-list">
                      {data.topClients.map((c, i) => (
                        <div className="rank-row" key={c.id}>
                          <span className="rank">0{i + 1}</span>
                          <div className="avatar small">
                            {String(c.name).slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <strong>{String(c.name)}</strong>
                            <small>{String(c.company || 'Client')}</small>
                          </div>
                          <b>{money(c.amount)}</b>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      title="Your next great partnership"
                      text="Client revenue rankings will appear here."
                    />
                  )}
                </Panel>
              </div>
            </>
          ) : (
            <div className="notice">
              <FolderKanban size={18} /> Your workspace shows the sections your owner has shared.
              Financial summaries are restricted.
            </div>
          )}
          <div className="dashboard-columns">
            <Panel
              title="Active Projects"
              subtitle="The work moving forward"
              action={<ViewLink href="/projects" />}
            >
              {data.projects?.length ? (
                <div className="project-list">
                  {data.projects.map((p) => (
                    <div key={p.id} className="project-summary">
                      <div className="project-icon">
                        <FolderKanban size={19} />
                      </div>
                      <div className="project-main">
                        <a href={'/projects/' + p.id}>{String(p.name)}</a>
                        <small>
                          {String(p.client_name || 'Project')}
                          <span>·</span>
                          {p.deadline ? dateLabel(p.deadline) : 'No deadline'}
                        </small>
                      </div>
                      <Badge>{String(p.status)}</Badge>
                      <div className="mini-progress">
                        <span>
                          {Number(p.task_count)
                            ? Math.round((Number(p.completed_tasks) / Number(p.task_count)) * 100)
                            : 0}
                          %
                        </span>
                        <div>
                          <i
                            style={{
                              width: `${Number(p.task_count) ? (Number(p.completed_tasks) / Number(p.task_count)) * 100 : 0}%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty
                  title="Make room for your best work"
                  text="Create a project to keep deadlines and deliverables in view."
                />
              )}
            </Panel>
            <Panel
              title="Upcoming Deadlines"
              subtitle="Keep the important things in sight"
              action={<ViewLink href="/tasks" />}
            >
              {data.deadlines?.length ? (
                <div className="deadline-list">
                  {data.deadlines.map((t) => (
                    <div key={t.id}>
                      <span
                        className={`deadline-day ${String(t.due_date).slice(0, 10) < today() ? 'late' : ''}`}
                      >
                        {new Date(String(t.due_date)).getUTCDate()}
                      </span>
                      <div>
                        <strong>{String(t.title)}</strong>
                        <small>{dateLabel(t.due_date)}</small>
                      </div>
                      <Badge>{String(t.priority)}</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty title="A little breathing room" text="No upcoming task deadlines." />
              )}
            </Panel>
          </div>
          <div className="dashboard-columns">
            <Panel title="Recent Transactions" action={<ViewLink href="/payments" />}>
              {data.transactions?.length ? (
                <div className="transaction-list">
                  {data.transactions.map((t) => (
                    <div key={t.id}>
                      <span className="transaction-icon">
                        <ArrowDownLeft size={17} />
                      </span>
                      <div>
                        <strong>{String(t.client_name || t.reference)}</strong>
                        <small>
                          {String(t.reference)} · {dateLabel(t.payment_date)}
                        </small>
                      </div>
                      <b>+{money(t.amount_paise)}</b>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty
                  title="Your first payment is a milestone"
                  text="Received payments will show up here."
                  action={
                    owner ? (
                      <button className="button small" onClick={onAdd}>
                        <Plus size={14} />
                        Record payment
                      </button>
                    ) : undefined
                  }
                />
              )}
            </Panel>
            <Panel title="Studio Activity" subtitle="A quiet record of what’s changed">
              {data.activity?.length ? (
                <div className="activity-list">
                  {data.activity.slice(0, 5).map((a) => (
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
                <Empty title="All caught up" text="Studio updates will appear as you work." />
              )}
            </Panel>
          </div>
          {analytics && (
            <>
              <div className="metric-strip">
                {Object.entries({ ...data.clientMetrics, ...data.projectMetrics }).map(([k, v]) => (
                  <div key={k}>
                    <span>{k.replaceAll('_', ' ')}</span>
                    <strong>{k === 'average_revenue' ? money(v) : String(v ?? '—')}</strong>
                  </div>
                ))}
              </div>
              <div className="dashboard-columns">
                {[
                  ['Payment Methods', data.methods, 'method'],
                  ['Expenses by Category', data.expenseCategories, 'category'],
                  ['Revenue by Project', data.projectRevenue, 'name'],
                ].map(([title, rows, key]) => (
                  <Panel key={String(title)} title={String(title)}>
                    {(rows as RecordRow[] | undefined)?.length ? (
                      <div className="rank-list">
                        {(rows as RecordRow[]).map((r, i) => (
                          <div className="rank-row" key={i}>
                            <span>{String(r[String(key)])}</span>
                            <b>{money(r.amount)}</b>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Empty text="No records in this period." />
                    )}
                  </Panel>
                ))}
              </div>
              {owner && (
                <div className="export-row">
                  <a download className="button" href="/api/export?section=payments">
                    Export payments CSV
                  </a>
                  <a download className="button" href="/api/export?section=expenses">
                    Export expenses CSV
                  </a>
                  <a download className="button" href="/api/export?section=invoices">
                    Export invoices CSV
                  </a>
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
