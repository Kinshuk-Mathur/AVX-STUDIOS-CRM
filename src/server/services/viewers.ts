import { z } from 'zod';
import { transaction, one } from '../db';
import { assertOwner, hashPassword, verifyPassword } from '../security';
import { insist } from '../errors';
import { viewerSchema } from '../validation';
import type { Principal } from '@/lib/domain';
export async function saveViewer(p: Principal, body: unknown, id?: string) {
  assertOwner(p);
  const v = viewerSchema.parse(body);
  insist(id || v.password, 'Set an initial password.');
  const hash = v.password ? await hashPassword(v.password) : undefined;
  return transaction(async (tx) => {
    const row = await one<{ id: string }>(
      tx,
      id
        ? "UPDATE viewer_accounts SET display_name=$1,username=$2,status=$3,expires_at=$4,password_hash=coalesce($5,password_hash),updated_at=now() WHERE id=$6 AND status<>'Deleted' RETURNING id"
        : 'INSERT INTO viewer_accounts(display_name,username,status,expires_at,password_hash) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [v.name, v.username.toLowerCase(), v.status, v.expiresAt || null, hash, ...(id ? [id] : [])],
    );
    insist(row, 'Viewer not found.', 404);
    await tx.query('DELETE FROM viewer_permissions WHERE viewer_id=$1', [row.id]);
    for (const section of [...new Set(v.permissions)])
      await tx.query('INSERT INTO viewer_permissions(viewer_id,section) VALUES($1,$2)', [
        row.id,
        section,
      ]);
    if (id)
      await tx.query(
        "UPDATE sessions SET status='revoked',revoked_at=now() WHERE viewer_id=$1 AND status IN('pending','approved')",
        [id],
      );
    await tx.query('INSERT INTO access_audit_logs(viewer_id,event) VALUES($1,$2)', [
      row.id,
      id ? 'account_updated_sessions_revoked' : 'account_created',
    ]);
    return row;
  }, p);
}
export async function decideAccess(
  p: Principal,
  sessionId: string,
  decision: 'approve' | 'reject' | 'revoke',
) {
  assertOwner(p);
  return transaction(async (tx) => {
    const session = await one<{ viewer_id: string; status: string; valid: boolean }>(
      tx,
      "SELECT s.viewer_id,s.status,(s.request_expires_at>now() AND s.expires_at>now() AND v.status='Active' AND (v.expires_at IS NULL OR v.expires_at>now())) AS valid FROM sessions s JOIN viewer_accounts v ON v.id=s.viewer_id WHERE s.id=$1 FOR UPDATE OF s",
      [sessionId],
    );
    insist(session, 'Access request not found.', 404);
    if (decision === 'approve' || decision === 'reject')
      insist(
        session.status === 'pending' && session.valid,
        'This request has expired or has already been handled.',
        409,
      );
    await tx.query(
      `UPDATE sessions SET status=$2,approved_at=CASE WHEN $2='approved' THEN now() ELSE approved_at END,revoked_at=CASE WHEN $2='revoked' THEN now() ELSE revoked_at END,last_activity_at=now() WHERE id=$1`,
      [
        sessionId,
        decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'revoked',
      ],
    );
    await tx.query(
      'INSERT INTO access_audit_logs(viewer_id,session_id,event,metadata) VALUES($1,$2,$3,$4)',
      [session.viewer_id, sessionId, decision, JSON.stringify({ ownerId: p.id })],
    );
    return { ok: true };
  }, p);
}
export async function viewerAction(p: Principal, id: string, action: 'revoke' | 'delete') {
  assertOwner(p);
  return transaction(async (tx) => {
    if (action === 'delete')
      await tx.query("UPDATE viewer_accounts SET status='Deleted',updated_at=now() WHERE id=$1", [
        id,
      ]);
    await tx.query(
      "UPDATE sessions SET status='revoked',revoked_at=now() WHERE viewer_id=$1 AND status IN('pending','approved')",
      [id],
    );
    await tx.query('INSERT INTO access_audit_logs(viewer_id,event) VALUES($1,$2)', [
      id,
      action === 'delete' ? 'account_deleted' : 'all_sessions_revoked',
    ]);
    return { ok: true };
  }, p);
}
export async function viewerData(p: Principal) {
  assertOwner(p);
  return transaction(
    async (tx) => ({
      viewers: (
        await tx.query(
          `SELECT v.id,v.display_name,v.username,v.status,v.expires_at,v.last_login,v.created_at,coalesce((SELECT array_agg(section) FROM viewer_permissions WHERE viewer_id=v.id),'{}') AS permissions,(SELECT max(created_at) FROM sessions WHERE viewer_id=v.id) AS last_request,(SELECT count(*) FROM sessions WHERE viewer_id=v.id AND status='approved' AND expires_at>now() AND revoked_at IS NULL AND last_activity_at>now()-(idle_minutes||' minutes')::interval) AS active_sessions FROM viewer_accounts v WHERE status<>'Deleted' ORDER BY created_at DESC`,
        )
      ).rows,
      requests: (
        await tx.query(
          `SELECT s.id,s.viewer_id,s.device,s.created_at,s.request_expires_at,v.display_name,v.username FROM sessions s JOIN viewer_accounts v ON v.id=s.viewer_id WHERE s.status='pending' AND s.request_expires_at>now() AND v.status='Active' AND (v.expires_at IS NULL OR v.expires_at>now()) ORDER BY s.created_at`,
        )
      ).rows,
      sessions: (
        await tx.query(
          `SELECT s.id,s.viewer_id,s.status,s.device,s.created_at,s.approved_at,s.expires_at,s.last_activity_at,v.display_name,CASE WHEN s.status IN('pending','approved') AND (s.expires_at<=now() OR (s.status='pending' AND s.request_expires_at<=now()) OR (s.status='approved' AND s.last_activity_at<=now()-(s.idle_minutes||' minutes')::interval)) THEN 'expired' ELSE s.status END AS effective_status FROM sessions s JOIN viewer_accounts v ON v.id=s.viewer_id ORDER BY s.created_at DESC LIMIT 100`,
        )
      ).rows,
      history: (
        await tx.query(
          `SELECT a.id,a.event,a.created_at,v.display_name FROM access_audit_logs a LEFT JOIN viewer_accounts v ON v.id=a.viewer_id ORDER BY a.created_at DESC LIMIT 100`,
        )
      ).rows,
    }),
    p,
  );
}
export async function changeOwnerPassword(p: Principal, body: unknown) {
  assertOwner(p);
  const v = z
    .object({ currentPassword: z.string().max(128), newPassword: z.string().min(12).max(128) })
    .strict()
    .parse(body);
  const existing = await transaction(
    (tx) =>
      one<{ password_hash: string }>(tx, 'SELECT password_hash FROM owners WHERE id=$1', [p.id]),
    p,
  );
  insist(
    existing && (await verifyPassword(v.currentPassword, existing.password_hash)),
    'Current password is incorrect.',
    400,
  );
  const hash = await hashPassword(v.newPassword);
  return transaction(async (tx) => {
    await tx.query('UPDATE owners SET password_hash=$1 WHERE id=$2', [hash, p.id]);
    await tx.query(
      "UPDATE sessions SET status='revoked',revoked_at=now() WHERE owner_id=$1 AND id<>$2",
      [p.id, p.sessionId],
    );
    await tx.query("INSERT INTO access_audit_logs(event) VALUES('owner_password_changed')");
    return { ok: true };
  }, p);
}
