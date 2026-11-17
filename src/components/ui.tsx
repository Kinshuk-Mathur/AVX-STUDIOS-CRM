'use client';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Search, Inbox, ArrowUpRight, LoaderCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { RecordRow } from '@/lib/domain';
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          className={`modal-content ${wide ? 'wide' : ''}`}
          aria-describedby={description ? 'modal-description' : undefined}
        >
          <div className="modal-heading">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              {description && (
                <Dialog.Description id="modal-description">{description}</Dialog.Description>
              )}
            </div>
            <Dialog.Close className="icon-button" aria-label="Close dialog">
              <X size={19} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Badge({ children }: { children: React.ReactNode }) {
  const s = String(children).toLowerCase();
  return (
    <span
      className={`badge ${['paid', 'completed', 'active', 'approved', 'accepted'].includes(s) ? 'green' : ['overdue', 'urgent', 'rejected', 'voided', 'disabled', 'revoked'].includes(s) ? 'red' : ['in progress', 'issued', 'currently viewing'].includes(s) ? 'purple' : 'neutral'}`}
    >
      <i />
      {children}
    </span>
  );
}
export function Empty({
  title = 'Nothing here yet',
  text = 'Your records will appear here.',
  action,
}: {
  title?: string;
  text?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Inbox size={23} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading">
      <LoaderCircle size={22} className="spin" />
      <span>Loading your workspace…</span>
    </div>
  );
}
export function Panel({
  title,
  subtitle,
  children,
  action,
  className = '',
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export type Column = { key: string; label: string; render?: (row: RecordRow) => React.ReactNode };
export function DataTable({
  rows,
  columns,
  emptyTitle,
  onRow,
  tools,
}: {
  rows: RecordRow[];
  columns: Column[];
  emptyTitle?: string;
  onRow?: (row: RecordRow) => void;
  tools?: React.ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: string; direction: number } | null>(null);
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    const data = rows.filter((r) =>
      columns.some((c) =>
        String(r[c.key] ?? '')
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    );
    if (sort)
      data.sort((a, b) => {
        const x = a[sort.key],
          y = b[sort.key];
        return (
          (Number.isFinite(Number(x)) && Number.isFinite(Number(y))
            ? Number(x) - Number(y)
            : String(x ?? '').localeCompare(String(y ?? ''))) * sort.direction
        );
      });
    return data;
  }, [rows, columns, query, sort]);
  const current = Math.min(page, Math.max(0, Math.ceil(filtered.length / 20) - 1));
  return (
    <div className="table-panel">
      <div className="table-tools">
        <label className="search-input">
          <Search size={16} />
          <input
            aria-label="Search records"
            placeholder="Search records…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <div className="table-controls">
          {tools}
          <span className="muted">{filtered.length} records</span>
        </div>
      </div>
      {filtered.length ? (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.key}>
                      <button
                        onClick={() =>
                          setSort({
                            key: c.key,
                            direction: sort?.key === c.key ? -sort.direction : 1,
                          })
                        }
                      >
                        {c.label}
                        {sort?.key === c.key ? (sort.direction === 1 ? ' ↑' : ' ↓') : ''}
                      </button>
                    </th>
                  ))}
                  {onRow && (
                    <th>
                      <span className="sr-only">Open</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(current * 20, current * 20 + 20).map((r) => (
                  <tr key={r.id}>
                    {columns.map((c, i) => (
                      <td key={c.key}>
                        {c.render ? (
                          c.render(r)
                        ) : i === 0 && onRow ? (
                          <button className="text-button" onClick={() => onRow(r)}>
                            {String(r[c.key] ?? '—')}
                          </button>
                        ) : (
                          String(r[c.key] ?? '—')
                        )}
                      </td>
                    ))}
                    {onRow && (
                      <td>
                        <button
                          className="icon-button"
                          aria-label={
                            'Open ' + String(r.name || r.title || r.reference || r.number)
                          }
                          onClick={() => onRow(r)}
                        >
                          <ArrowUpRight size={16} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-footer">
            <span>
              Showing {current * 20 + 1}–{Math.min((current + 1) * 20, filtered.length)} of{' '}
              {filtered.length}
            </span>
            <div>
              <button disabled={current === 0} onClick={() => setPage(current - 1)}>
                Previous
              </button>
              <button
                disabled={(current + 1) * 20 >= filtered.length}
                onClick={() => setPage(current + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      ) : (
        <Empty
          title={query ? 'No matching records' : emptyTitle}
          text={query ? 'Try a different search.' : 'Add your first record to get started.'}
        />
      )}
    </div>
  );
}
export function ViewLink({
  href,
  children = 'View all',
}: {
  href: string;
  children?: React.ReactNode;
}) {
  return (
    <Link className="view-link" href={href}>
      {children}
      <ArrowUpRight size={14} />
    </Link>
  );
}
export async function api<T = Record<string, unknown>>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch('/api/' + url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    cache: 'no-store',
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && typeof window !== 'undefined' && !url.startsWith('auth/'))
      window.dispatchEvent(new Event('avx:unauthorized'));
    throw new Error(result.error || 'Unable to complete the request.');
  }
  return result as T;
}
export function send<T = Record<string, unknown>>(url: string, body: unknown, method = 'POST') {
  return api<T>(url, { method, body: JSON.stringify(body) });
}
