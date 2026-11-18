import type { Section, RecordRow } from '@/lib/domain';
import type { DocumentSnapshot } from '../services/pdf';
export interface Entity extends RecordRow {
  created_at: string;
  updated_at?: string;
}
export interface Account extends Entity {
  username: string;
  display_name: string;
  password_hash: string;
  session_version: number;
  status?: string;
  expires_at?: string | null;
  permissions?: Section[];
  last_login?: string;
}
export interface Session extends Entity {
  token_hash: string;
  owner_id: string | null;
  viewer_id: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'revoked' | 'expired';
  device: string;
  approved_at: string | null;
  expires_at: string;
  request_expires_at: string;
  last_activity_at: string;
  idle_minutes: number;
  account_version: number;
  auth_epoch: number;
  revoked_at?: string | null;
}
export interface Client extends Entity {
  name: string;
  company: string;
  email: string;
  status: string;
  profile: Record<string, unknown>;
  received_paise: string;
  outstanding_paise: string;
}
export interface ServiceItem {
  id: string;
  service_id: string;
  description: string;
  amount_paise: string;
}
export interface Project extends Entity {
  client_id: string;
  name: string;
  description: string;
  status: string;
  priority: string;
  start_date: string | null;
  deadline: string | null;
  notes: string;
  completed_at: string | null;
  items: ServiceItem[];
  value_paise: string;
  received_paise: string;
  has_financial_history: boolean;
}
export interface Task extends Entity {
  title: string;
  description: string;
  project_id: string | null;
  priority: string;
  status: string;
  due_date: string | null;
  notes: string;
}
export interface Category extends Entity {
  name: string;
  color: string;
  active: boolean;
}
export interface DocumentItem extends ServiceItem {
  quantity: number;
  rate_paise: string;
}
export interface FinancialDocument extends Entity {
  kind: 'invoice' | 'quotation';
  number: string;
  client_id: string;
  project_id: string | null;
  status: string;
  issue_date: string;
  due_date: string;
  subtotal_paise: string;
  discount_paise: string;
  tax_bps: number;
  tax_paise: string;
  total_paise: string;
  received_paise: string;
  has_payments: boolean;
  notes: string;
  terms: string;
  snapshot: DocumentSnapshot;
  pdf_key: string;
  items: DocumentItem[];
  converted_project_id?: string;
  converted_invoice_id?: string;
}
export interface Payment extends Entity {
  idempotency_key: string;
  request_hash: string;
  reference: string;
  client_id: string;
  project_id: string;
  invoice_id: string | null;
  amount_paise: string;
  refunded_paise: string;
  payment_date: string;
  method: string;
  transaction_ref: string;
  description: string;
  notes: string;
  receipt_id: string;
  receipt_number: string;
  allocations: { service_id: string; amount_paise: string; refunded_paise: string }[];
}
export interface Receipt extends Entity {
  payment_id: string;
  number: string;
  snapshot: DocumentSnapshot;
  pdf_key: string;
}
export interface Refund extends Entity {
  payment_id: string;
  idempotency_key: string;
  amount_paise: string;
  refund_date: string;
  reason: string;
  request_hash: string;
  allocations: { service_id: string; amount_paise: string }[];
}
export interface Expense extends Entity {
  name: string;
  amount_paise: string;
  expense_date: string;
  category: string;
  vendor: string;
  method: string;
  project_id: string | null;
  recurrence: string;
  notes: string;
  voided_at: string | null;
  void_reason: string | null;
}
export interface Attachment extends Entity {
  section: string;
  record_id: string;
  name: string;
  mime: string;
  size: number;
  blob_key: string;
}
export interface Settings extends Entity {
  data: Record<string, unknown>;
}
export interface AccessMeta extends Entity {
  auth_epoch: number;
  owner_id?: string;
  recovery_hash?: string;
  recovery_expires_at?: string;
  recovery_consumed_at?: string | null;
}
export interface Rollup extends Entity {
  date: string;
  dimension: string;
  subject: string;
  amount_paise: string;
  events: number;
}
