import { z } from 'zod';
import { transaction, one, audit } from '../db';
import { assertOwner } from '../security';
import { insist } from '../errors';
import {
  clientSchema,
  projectSchema,
  taskSchema,
  expenseSchema,
  settingsSchema,
} from '../validation';
import { paise } from '@/lib/money';
import { projectStatuses, type Principal } from '@/lib/domain';
export async function saveClient(p: Principal, body: unknown, id?: string) {
  assertOwner(p);
  const v = clientSchema.parse(body);
  return transaction(async (tx) => {
    const row = await one(
      tx,
      id
        ? 'UPDATE clients SET name=$1,company=$2,email=$3,status=$4,profile=$5,updated_at=now() WHERE id=$6 RETURNING *'
        : 'INSERT INTO clients(name,company,email,status,profile) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [v.name, v.company, v.email, v.status, JSON.stringify(v.profile), ...(id ? [id] : [])],
    );
    insist(row, 'Client not found.', 404);
    await audit(
      tx,
      'clients',
      String(row.id),
      id ? 'updated' : 'created',
      `${v.name} ${id ? 'updated' : 'added'}`,
    );
    return row;
  }, p);
}
export async function saveProject(p: Principal, body: unknown, id?: string) {
  assertOwner(p);
  const v = projectSchema.parse(body);
  insist(
    !v.startDate || !v.deadline || v.startDate <= v.deadline,
    'Deadline must be on or after the start date.',
  );
  return transaction(async (tx) => {
    insist(
      await one(tx, "SELECT id FROM clients WHERE id=$1 AND status<>'Archived'", [v.clientId]),
      'Select an active client.',
    );
    if (id) {
      const existing = await one(tx, 'SELECT id FROM projects WHERE id=$1 FOR UPDATE', [id]);
      insist(existing, 'Project not found.', 404);
      const financial = await one(
        tx,
        'SELECT id FROM payments WHERE project_id=$1 UNION SELECT id FROM documents WHERE project_id=$1 LIMIT 1',
        [id],
      );
      if (financial) {
        const original = await one<{ client_id: string }>(
          tx,
          'SELECT client_id FROM projects WHERE id=$1',
          [id],
        );
        insist(
          original!.client_id === v.clientId,
          'A project with financial history cannot change client.',
        );
      }
    }
    const row = await one(
      tx,
      id
        ? "UPDATE projects SET client_id=$1,name=$2,description=$3,status=$4,priority=$5,start_date=$6,deadline=$7,notes=$8,updated_at=now(),completed_at=CASE WHEN $4='Completed' THEN coalesce(completed_at,now()) ELSE NULL END WHERE id=$9 RETURNING *"
        : "INSERT INTO projects(client_id,name,description,status,priority,start_date,deadline,notes,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $4='Completed' THEN now() ELSE NULL END) RETURNING *",
      [
        v.clientId,
        v.name,
        v.description,
        v.status,
        v.priority,
        v.startDate || null,
        v.deadline || null,
        v.notes,
        ...(id ? [id] : []),
      ],
    );
    insist(row, 'Project not found.', 404);
    if (id) await tx.query('DELETE FROM project_service_items WHERE project_id=$1', [id]);
    for (const item of v.items) {
      insist(paise(item.amount) > 0n, 'Service values must be greater than zero.');
      insist(
        await one(tx, 'SELECT id FROM service_categories WHERE id=$1 AND active=true', [
          item.serviceId,
        ]),
        'Select an active service.',
      );
      await tx.query(
        'INSERT INTO project_service_items(project_id,service_id,description,amount_paise) VALUES($1,$2,$3,$4)',
        [row.id, item.serviceId, item.description, paise(item.amount).toString()],
      );
    }
    await audit(
      tx,
      'projects',
      String(row.id),
      id ? 'updated' : 'created',
      `${v.name} ${id ? 'updated' : 'created'}`,
    );
    return row;
  }, p);
}
export async function updateProjectStatus(p: Principal, id: string, status: unknown) {
  assertOwner(p);
  const value = z.enum(projectStatuses).parse(status);
  return transaction(async (tx) => {
    const row = await one(
      tx,
      "UPDATE projects SET status=$1,updated_at=now(),completed_at=CASE WHEN $1='Completed' THEN coalesce(completed_at,now()) ELSE NULL END WHERE id=$2 RETURNING id,name",
      [value, id],
    );
    insist(row, 'Project not found.', 404);
    await audit(tx, 'projects', id, 'status_changed', `${row.name} → ${value}`);
    return row;
  }, p);
}
export async function saveTask(p: Principal, body: unknown, id?: string) {
  assertOwner(p);
  const v = taskSchema.parse(body);
  return transaction(async (tx) => {
    const row = await one(
      tx,
      id
        ? 'UPDATE tasks SET title=$1,description=$2,project_id=$3,priority=$4,status=$5,due_date=$6,notes=$7,updated_at=now() WHERE id=$8 RETURNING *'
        : 'INSERT INTO tasks(title,description,project_id,priority,status,due_date,notes) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [
        v.title,
        v.description,
        v.projectId || null,
        v.priority,
        v.status,
        v.dueDate || null,
        v.notes,
        ...(id ? [id] : []),
      ],
    );
    insist(row, 'Task not found.', 404);
    await audit(
      tx,
      'tasks',
      String(row.id),
      id ? 'updated' : 'created',
      `${v.title} ${id ? 'updated' : 'created'}`,
    );
    return row;
  }, p);
}
export async function addExpense(p: Principal, body: unknown) {
  assertOwner(p);
  const v = expenseSchema.parse(body);
  insist(paise(v.amount) > 0n, 'Expense must be greater than zero.');
  return transaction(async (tx) => {
    const row = await one(
      tx,
      'INSERT INTO expenses(name,amount_paise,expense_date,category,vendor,method,project_id,recurrence,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [
        v.name,
        paise(v.amount).toString(),
        v.expenseDate,
        v.category,
        v.vendor,
        v.method,
        v.projectId || null,
        v.recurrence,
        v.notes,
      ],
    );
    await audit(tx, 'expenses', String(row!.id), 'created', `${v.name} recorded`);
    return row;
  }, p);
}
export async function voidExpense(p: Principal, id: string, reason: string) {
  assertOwner(p);
  insist(reason.trim().length >= 5, 'Provide a correction reason of at least five characters.');
  return transaction(async (tx) => {
    const row = await one(
      tx,
      'UPDATE expenses SET voided_at=now(),void_reason=$2 WHERE id=$1 AND voided_at IS NULL RETURNING id',
      [id, reason.slice(0, 4000)],
    );
    insist(row, 'Expense not found or already reversed.', 404);
    await audit(tx, 'expenses', id, 'voided', 'Expense reversed: ' + reason);
    return row;
  }, p);
}
export async function removeRecord(p: Principal, section: string, id: string) {
  assertOwner(p);
  return transaction(async (tx) => {
    if (section === 'clients') {
      const linked = await one(
        tx,
        'SELECT id FROM projects WHERE client_id=$1 UNION SELECT id FROM documents WHERE client_id=$1 LIMIT 1',
        [id],
      );
      insist(!linked, 'This client has history. Archive the client instead.');
      await tx.query('DELETE FROM clients WHERE id=$1', [id]);
    } else if (section === 'tasks') await tx.query('DELETE FROM tasks WHERE id=$1', [id]);
    else insist(false, 'This record must be archived or reversed, not deleted.');
    await audit(tx, section, id, 'deleted', `${section === 'clients' ? 'Client' : 'Task'} deleted`);
    return { ok: true };
  }, p);
}
export async function saveSettings(p: Principal, body: unknown) {
  assertOwner(p);
  const data = settingsSchema.parse(body);
  return transaction(async (tx) => {
    await tx.query('UPDATE agency_settings SET data=$1,updated_at=now()', [JSON.stringify(data)]);
    await audit(tx, 'settings', p.id, 'updated', 'Agency settings updated');
    return data;
  }, p);
}
export async function saveCategory(p: Principal, body: unknown, id?: string) {
  assertOwner(p);
  const v = z
    .object({
      name: z.string().trim().min(1).max(100),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      active: z.boolean(),
    })
    .strict()
    .parse(body);
  return transaction(
    (tx) =>
      one(
        tx,
        id
          ? 'UPDATE service_categories SET name=$1,color=$2,active=$3 WHERE id=$4 RETURNING *'
          : 'INSERT INTO service_categories(name,color,active) VALUES($1,$2,$3) RETURNING *',
        [v.name, v.color, v.active, ...(id ? [id] : [])],
      ),
    p,
  );
}
export async function addDeliverable(p: Principal, projectId: string, body: unknown) {
  assertOwner(p);
  const v = z
    .object({
      title: z.string().min(1).max(160),
      url: z.url().refine((v) => /^https?:\/\//.test(v)),
      version: z.string().min(1).max(40),
    })
    .strict()
    .parse(body);
  return transaction(async (tx) => {
    const row = await one(
      tx,
      'INSERT INTO deliverables(project_id,title,url,version) VALUES($1,$2,$3,$4) RETURNING *',
      [projectId, v.title, v.url, v.version],
    );
    await audit(
      tx,
      'projects',
      projectId,
      'delivered',
      v.title + ' delivered (v' + v.version + ')',
    );
    return row;
  }, p);
}
