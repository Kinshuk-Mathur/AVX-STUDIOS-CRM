import { z } from 'zod';
import { expenseCategories, paymentMethods, projectStatuses, sections } from '@/lib/domain';
export const id = z.uuid();
const text = z.string().trim().max(4000).default('');
const name = z.string().trim().min(1).max(160);
export const amount = z
  .string()
  .regex(/^\d{1,11}(\.\d{1,2})?$/, 'Enter a valid INR amount (up to 2 decimal places).');
const date = z.iso.date();
const nullableId = z
  .union([id, z.literal(''), z.null()])
  .transform((v) => v || null)
  .optional();
const nullableDate = z
  .union([date, z.literal(''), z.null()])
  .transform((v) => v || null)
  .optional();
const url = z
  .union([
    z.url().refine((v) => /^https?:\/\//.test(v), 'Use an HTTP or HTTPS link.'),
    z.literal(''),
  ])
  .default('');
const priority = z.enum(['Low', 'Medium', 'High', 'Urgent']).default('Medium');
export const loginSchema = z
  .object({
    username: z.string().trim().min(1).max(160),
    password: z.string().min(1).max(128),
    viewer: z.boolean().default(false),
  })
  .strict();
export const clientSchema = z
  .object({
    name,
    company: text,
    email: z.union([z.email(), z.literal('')]).default(''),
    status: z.enum(['Lead', 'Active', 'Inactive', 'Archived']).default('Active'),
    profile: z
      .object({
        mobile: text,
        whatsapp: text,
        city: text,
        country: text,
        address: text,
        website: url,
        social: url,
        type: text,
        services: text,
        source: text,
        acquisitionDate: nullableDate,
        gst: text,
        notes: text,
        tags: text,
        links: text,
      })
      .partial()
      .default({}),
  })
  .strict();
export const serviceItemSchema = z.object({ serviceId: id, description: name, amount });
export const projectSchema = z
  .object({
    name,
    clientId: id,
    description: text,
    status: z.enum(projectStatuses).default('Planning'),
    priority,
    startDate: nullableDate,
    deadline: nullableDate,
    notes: text,
    items: z.array(serviceItemSchema).min(1).max(100),
  })
  .strict();
export const taskSchema = z
  .object({
    title: name,
    description: text,
    projectId: nullableId,
    priority,
    status: z.enum(['To Do', 'In Progress', 'Completed']).default('To Do'),
    dueDate: nullableDate,
    notes: text,
  })
  .strict();
export const paymentSchema = z
  .object({
    idempotencyKey: id,
    clientId: id,
    projectId: id,
    invoiceId: nullableId,
    amount,
    paymentDate: date,
    method: z.enum(paymentMethods),
    transactionRef: z.string().trim().max(160).default(''),
    description: text,
    notes: text,
  })
  .strict();
export const documentSchema = z
  .object({
    kind: z.enum(['invoice', 'quotation']),
    clientId: id,
    projectId: nullableId,
    status: z.enum(['Draft', 'Issued']).default('Issued'),
    issueDate: date,
    dueDate: date,
    discount: amount.default('0'),
    taxBps: z.number().int().min(0).max(10000).default(0),
    notes: text,
    terms: text,
    items: z
      .array(
        z.object({
          serviceId: id,
          description: name,
          quantity: z.number().int().min(1).max(10000),
          rate: amount,
        }),
      )
      .min(1)
      .max(100),
  })
  .strict();
export const expenseSchema = z
  .object({
    name,
    amount,
    expenseDate: date,
    category: z.enum(expenseCategories),
    vendor: text,
    method: z.enum(paymentMethods),
    projectId: nullableId,
    recurrence: z.enum(['None', 'Monthly', 'Yearly']).default('None'),
    notes: text,
  })
  .strict();
export const viewerSchema = z
  .object({
    name,
    username: z
      .string()
      .trim()
      .min(3)
      .max(100)
      .regex(/^[a-zA-Z0-9@._-]+$/),
    password: z.string().min(12).max(128).optional(),
    status: z.enum(['Active', 'Disabled']).default('Active'),
    expiresAt: z.union([z.iso.datetime({ offset: true }), z.literal(''), z.null()]).optional(),
    permissions: z.array(z.enum(sections)).min(1),
  })
  .strict();
export const settingsSchema = z
  .object({
    name,
    tagline: text,
    email: z.union([z.email(), z.literal('')]).default(''),
    phone: text,
    website: url,
    address: text,
    gst: text,
    receiptPrefix: z.string().regex(/^[A-Z0-9-]{1,20}$/),
    invoicePrefix: z.string().regex(/^[A-Z0-9-]{1,20}$/),
    quotePrefix: z.string().regex(/^[A-Z0-9-]{1,20}$/),
    footer: text,
    paymentTerms: text,
    bankDetails: text,
    upi: text,
    currency: z.literal('INR'),
    taxBps: z.number().int().min(0).max(10000),
    requestTimeoutMinutes: z.number().int().min(1).max(15),
    sessionMinutes: z.number().int().min(5).max(480),
    idleMinutes: z.number().int().min(5).max(60),
    accent: z.string().regex(/^#[a-fA-F0-9]{6}$/),
  })
  .strict();
export type ClientInput = z.infer<typeof clientSchema>;
export type ProjectInput = z.infer<typeof projectSchema>;
export type PaymentInput = z.infer<typeof paymentSchema>;
export type DocumentInput = z.infer<typeof documentSchema>;
