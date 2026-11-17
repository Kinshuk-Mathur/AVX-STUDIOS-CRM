export const sections = [
  'overview',
  'clients',
  'projects',
  'tasks',
  'payments',
  'invoices',
  'expenses',
  'analytics',
] as const;
export type Section = (typeof sections)[number];
export const sectionNames: Record<Section | 'viewers' | 'settings', string> = {
  overview: 'Overview',
  clients: 'Clients',
  projects: 'Projects',
  tasks: 'Tasks',
  payments: 'Payments',
  invoices: 'Invoices & Receipts',
  expenses: 'Expenses',
  analytics: 'Analytics',
  viewers: 'Viewer Access',
  settings: 'Settings',
};
export const projectStatuses = [
  'Planning',
  'In Progress',
  'Client Review',
  'Revisions',
  'Completed',
  'On Hold',
  'Cancelled',
] as const;
export const paymentMethods = ['UPI', 'Bank Transfer', 'Cash', 'Card', 'Other'] as const;
export const expenseCategories = [
  'Software',
  'Freelancers',
  'Hosting & Domains',
  'Marketing',
  'Equipment',
  'Travel',
  'Office',
  'Other',
] as const;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface Principal {
  id: string;
  name: string;
  role: 'owner' | 'viewer';
  permissions: Section[];
  sessionId: string;
}
export interface RecordRow {
  id: string;
  [key: string]: unknown;
}
export function money(value: unknown): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(Number(value || 0) / 100);
}
export function dateLabel(value: unknown): string {
  if (!value) return '—';
  const d = new Date(String(value));
  return isNaN(+d)
    ? '—'
    : d.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Kolkata',
      });
}
export function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
export function can(p: Principal, section: Section): boolean {
  return p.role === 'owner' || p.permissions.includes(section);
}
export function financialAccess(p: Principal): boolean {
  return (
    p.role === 'owner' ||
    ['clients', 'projects', 'payments', 'invoices', 'expenses', 'analytics'].every((s) =>
      p.permissions.includes(s as Section),
    )
  );
}
