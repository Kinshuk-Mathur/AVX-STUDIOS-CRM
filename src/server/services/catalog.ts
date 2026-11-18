import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { transaction, newRow, now, audit, stableKey } from '../firebase/store';
import { rollup } from '../firebase/metrics';
import type { Client, Project, Expense, Category } from '../firebase/models';
import { assertOwner } from '../security-primitives';
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
    const row = id
      ? await tx.update<Client>('clients', id, { ...v, updated_at: now() })
      : await tx.create(
          'clients',
          newRow({ ...v, updated_at: now(), received_paise: '0', outstanding_paise: '0' }),
        );
    await audit(
      tx,
      'clients',
      row.id,
      id ? 'updated' : 'created',
      v.name + ' ' + (id ? 'updated' : 'added'),
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
    const client = await tx.get<Client>('clients', v.clientId);
    insist(client && client.status !== 'Archived', 'Select an active client.');
    const original = id ? await tx.get<Project>('projects', id) : undefined;
    if (id) insist(original, 'Project not found.', 404);
    if (original?.has_financial_history)
      insist(
        original.client_id === v.clientId,
        'A project with financial history cannot change client.',
      );
    const items = [];
    for (const item of v.items) {
      insist(paise(item.amount) > 0n, 'Service values must be greater than zero.');
      const service = await tx.get<Category>('service_categories', item.serviceId);
      insist(service?.active, 'Select an active service.');
      items.push({
        id: randomUUID(),
        service_id: item.serviceId,
        description: item.description,
        amount_paise: paise(item.amount).toString(),
      });
    }
    const data = {
      client_id: v.clientId,
      name: v.name,
      description: v.description,
      status: v.status,
      priority: v.priority,
      start_date: v.startDate || null,
      deadline: v.deadline || null,
      notes: v.notes,
      completed_at: v.status === 'Completed' ? original?.completed_at || now() : null,
      items,
      value_paise: items.reduce((s, i) => s + BigInt(i.amount_paise), 0n).toString(),
      updated_at: now(),
    };
    const row = id
      ? await tx.update<Project>('projects', id, data)
      : await tx.create(
          'projects',
          newRow({ ...data, received_paise: '0', has_financial_history: false }),
        );
    await audit(
      tx,
      'projects',
      row.id,
      id ? 'updated' : 'created',
      v.name + ' ' + (id ? 'updated' : 'created'),
    );
    return row;
  }, p);
}
export async function updateProjectStatus(p: Principal, id: string, status: unknown) {
  assertOwner(p);
  const value = z.enum(projectStatuses).parse(status);
  return transaction(async (tx) => {
    const old = await tx.get<Project>('projects', id);
    insist(old, 'Project not found.', 404);
    const row = await tx.update('projects', id, {
      status: value,
      updated_at: now(),
      completed_at: value === 'Completed' ? old.completed_at || now() : null,
    });
    await audit(tx, 'projects', id, 'status_changed', old.name + ' → ' + value);
    return { id, name: row.name };
  }, p);
}
export async function saveTask(p: Principal, body: unknown, id?: string) {
  assertOwner(p);
  const v = taskSchema.parse(body);
  return transaction(async (tx) => {
    if (v.projectId) insist(await tx.get('projects', v.projectId), 'Project not found.', 404);
    const data = {
      title: v.title,
      description: v.description,
      project_id: v.projectId || null,
      priority: v.priority,
      status: v.status,
      due_date: v.dueDate || null,
      notes: v.notes,
      updated_at: now(),
    };
    const row = id ? await tx.update('tasks', id, data) : await tx.create('tasks', newRow(data));
    await audit(
      tx,
      'tasks',
      row.id,
      id ? 'updated' : 'created',
      v.title + ' ' + (id ? 'updated' : 'created'),
    );
    return row;
  }, p);
}
export async function addExpense(p: Principal, body: unknown) {
  assertOwner(p);
  const v = expenseSchema.parse(body),
    amount = paise(v.amount);
  insist(amount > 0n, 'Expense must be greater than zero.');
  return transaction(async (tx) => {
    if (v.projectId) insist(await tx.get('projects', v.projectId), 'Project not found.', 404);
    const row = await tx.create(
      'expenses',
      newRow({
        name: v.name,
        amount_paise: amount.toString(),
        expense_date: v.expenseDate,
        category: v.category,
        vendor: v.vendor,
        method: v.method,
        project_id: v.projectId || null,
        recurrence: v.recurrence,
        notes: v.notes,
        voided_at: null,
        void_reason: null,
      }),
    );
    await rollup(tx, v.expenseDate, 'expense', v.category, amount);
    await audit(tx, 'expenses', row.id, 'created', v.name + ' recorded');
    return row;
  }, p);
}
export async function voidExpense(p: Principal, id: string, reason: string) {
  assertOwner(p);
  insist(reason.trim().length >= 5, 'Provide a correction reason of at least five characters.');
  return transaction(async (tx) => {
    const old = await tx.get<Expense>('expenses', id);
    insist(old && !old.voided_at, 'Expense not found or already reversed.', 404);
    await tx.update('expenses', id, { voided_at: now(), void_reason: reason.slice(0, 4000) });
    await rollup(tx, old.expense_date, 'expense', old.category, -BigInt(old.amount_paise));
    await audit(tx, 'expenses', id, 'voided', 'Expense reversed: ' + reason);
    return { id };
  }, p);
}
export async function removeRecord(p: Principal, section: string, id: string) {
  assertOwner(p);
  return transaction(async (tx) => {
    if (section === 'clients') {
      insist(
        !(await tx.list('projects', [['client_id', '==', id]])).length &&
          !(await tx.list('documents', [['client_id', '==', id]])).length,
        'This client has history. Archive the client instead.',
      );
    } else insist(section === 'tasks', 'This record must be archived or reversed, not deleted.');
    insist(await tx.get(section, id), 'Record not found.', 404);
    await tx.remove(section, id);
    await audit(
      tx,
      section,
      id,
      'deleted',
      (section === 'clients' ? 'Client' : 'Task') + ' deleted',
    );
    return { ok: true };
  }, p);
}
export async function saveSettings(p: Principal, body: unknown) {
  assertOwner(p);
  const data = settingsSchema.parse(body);
  return transaction(async (tx) => {
    await tx.update('agency_settings', 'agency', { data, updated_at: now() });
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
  return transaction(async (tx) => {
    const old = id ? await tx.get<Category>('service_categories', id) : undefined;
    if (id) insist(old, 'Service not found.', 404);
    const key = stableKey(v.name.toLowerCase()),
      index = await tx.get('category_names', key);
    insist(!index || index.category_id === id, 'A service with this name already exists.', 409);
    const row = id
      ? await tx.update('service_categories', id, v)
      : await tx.create('service_categories', newRow(v));
    if (old && old.name.toLowerCase() !== v.name.toLowerCase())
      await tx.remove('category_names', stableKey(old.name.toLowerCase()));
    if (!index) await tx.create('category_names', { id: key, category_id: row.id });
    return row;
  }, p);
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
    insist(await tx.get('projects', projectId), 'Project not found.', 404);
    const row = await tx.create(
      'deliverables',
      newRow({ project_id: projectId, ...v, delivered_at: now() }),
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
