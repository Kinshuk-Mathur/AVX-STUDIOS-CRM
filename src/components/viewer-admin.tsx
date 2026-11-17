'use client';
import { useEffect, useState } from 'react';
import { Plus, ShieldCheck, Check, X, Edit3, LogOut, Trash2 } from 'lucide-react';
import { dateLabel, type RecordRow } from '@/lib/domain';
import { api, send, Panel, Empty, DataTable, Badge, Loading, Modal } from './ui';
export function ViewerAdmin({
  revision,
  onAdd,
  onEdit,
  onNotice,
  onRefresh,
}: {
  revision: number;
  onAdd: () => void;
  onEdit: (row: RecordRow) => void;
  onNotice: (message: string) => void;
  onRefresh: () => void;
}) {
  const [data, setData] = useState<{
    viewers: RecordRow[];
    requests: RecordRow[];
    sessions: RecordRow[];
    history: RecordRow[];
  } | null>(null);
  const [error, setError] = useState('');
  const [remove, setRemove] = useState<RecordRow | null>(null);
  useEffect(() => {
    api<typeof data>('viewers')
      .then(setData)
      .catch((e) => setError(e.message));
  }, [revision]);
  async function act(url: string) {
    try {
      await send(url, {});
      onRefresh();
      setRemove(null);
      onNotice('Viewer access updated.');
    } catch (e) {
      onNotice((e as Error).message);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PRIVATE BY DESIGN</span>
          <h1>Viewer Access</h1>
          <p>A window into your studio. Always on your terms.</p>
        </div>
        <button className="button primary" onClick={onAdd}>
          <Plus size={16} />
          Create viewer
        </button>
      </div>
      <div className="security-banner">
        <ShieldCheck size={26} />
        <div>
          <strong>You’re the only one with the keys.</strong>
          <p>
            Every viewer login needs your approval. Access is temporary, scoped, and strictly read
            only.
          </p>
        </div>
      </div>
      {error ? (
        <div className="error-message">{error}</div>
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <Panel
            title="Access requests"
            subtitle="Live requests · each approval applies to one session"
            action={<span className="pill">{data.requests.length} pending</span>}
          >
            {data.requests.length ? (
              <div className="request-list">
                {data.requests.map((r) => (
                  <div className="request-row" key={r.id}>
                    <div className="avatar">{String(r.display_name).slice(0, 2).toUpperCase()}</div>
                    <div>
                      <strong>{String(r.display_name)}</strong>
                      <p>
                        {String(r.username)} · {new Date(String(r.created_at)).toLocaleTimeString()}
                      </p>
                      <small>{String(r.device)}</small>
                    </div>
                    <button
                      className="button primary small"
                      onClick={() => act('access/' + r.id + '/approve')}
                    >
                      <Check size={14} />
                      Approve
                    </button>
                    <button
                      className="button small"
                      onClick={() => act('access/' + r.id + '/reject')}
                    >
                      <X size={14} />
                      Reject
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                title="No one’s waiting"
                text="New viewer requests will appear here automatically."
              />
            )}
          </Panel>
          <Panel title="Viewer accounts">
            <DataTable
              rows={data.viewers}
              columns={[
                { key: 'display_name', label: 'Name' },
                { key: 'username', label: 'Username' },
                {
                  key: 'status',
                  label: 'Status',
                  render: (r) => (
                    <Badge>
                      {Number(r.active_sessions) > 0 ? 'Currently Viewing' : String(r.status)}
                    </Badge>
                  ),
                },
                {
                  key: 'permissions',
                  label: 'Visible sections',
                  render: (r) => (
                    <span className="permission-summary">
                      {(r.permissions as string[]).join(', ')}
                    </span>
                  ),
                },
                { key: 'last_login', label: 'Last login', render: (r) => dateLabel(r.last_login) },
                {
                  key: 'actions',
                  label: 'Actions',
                  render: (r) => (
                    <div className="row-actions">
                      <button
                        className="icon-button"
                        aria-label={'Edit ' + r.display_name}
                        onClick={() => onEdit(r)}
                      >
                        <Edit3 size={15} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={'Revoke access for ' + r.display_name}
                        onClick={() => act('viewers/' + r.id + '/revoke')}
                      >
                        <LogOut size={15} />
                      </button>
                      <button
                        className="icon-button danger"
                        aria-label={'Delete ' + r.display_name}
                        onClick={() => setRemove(r)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ),
                },
              ]}
              emptyTitle="Share a little perspective"
            />
          </Panel>
          <Panel title="Login sessions" subtitle="Latest 100 sessions">
            <DataTable
              rows={data.sessions}
              columns={[
                { key: 'display_name', label: 'Viewer' },
                {
                  key: 'effective_status',
                  label: 'Status',
                  render: (r) => <Badge>{String(r.effective_status)}</Badge>,
                },
                {
                  key: 'created_at',
                  label: 'Requested',
                  render: (r) => new Date(String(r.created_at)).toLocaleString('en-IN'),
                },
                {
                  key: 'device',
                  label: 'Device / browser',
                  render: (r) => (
                    <span className="truncate-device" title={String(r.device)}>
                      {String(r.device)}
                    </span>
                  ),
                },
                {
                  key: 'revoke',
                  label: 'Action',
                  render: (r) =>
                    r.effective_status === 'approved' ? (
                      <button
                        className="text-button danger"
                        onClick={() => act('access/' + r.id + '/revoke')}
                      >
                        Revoke session
                      </button>
                    ) : (
                      '—'
                    ),
                },
              ]}
            />
          </Panel>
          <Panel title="Access history">
            <div className="activity-list">
              {data.history.map((h) => (
                <div key={h.id}>
                  <i />
                  <div>
                    <p>
                      {String(h.display_name || 'Owner')} · {String(h.event).replaceAll('_', ' ')}
                    </p>
                    <small>{new Date(String(h.created_at)).toLocaleString('en-IN')}</small>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}
      <Modal
        open={!!remove}
        onClose={() => setRemove(null)}
        title="Delete viewer?"
        description="All access will end immediately. Audit history will be preserved."
      >
        <div className="modal-actions">
          <button className="button" onClick={() => setRemove(null)}>
            Cancel
          </button>
          <button
            className="button primary"
            onClick={() => act('viewers/' + remove!.id + '/delete')}
          >
            Delete viewer
          </button>
        </div>
      </Modal>
    </>
  );
}
