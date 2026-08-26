import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const patients = sqliteTable(
  "patients",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    clinicorpId: text("clinicorp_id"),
    name: text("name").notNull(),
    cpf: text("cpf"),
    phone: text("phone"),
    email: text("email"),
    unit: text("unit").notNull(),
    treatment: text("treatment"),
    paymentMethod: text("payment_method"),
    planAmountCents: integer("plan_amount_cents").notNull().default(0),
    startDate: text("start_date"),
    installments: integer("installments"),
    dueDay: integer("due_day"),
    taxReceiptIr: integer("tax_receipt_ir", { mode: "boolean" }).notNull().default(false),
    invoiceFrequency: text("invoice_frequency").notNull().default("monthly"),
    notes: text("notes"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("patients_cpf_unique").on(table.cpf),
    uniqueIndex("patients_clinicorp_id_unique").on(table.clinicorpId),
  ],
);

export const financialObligations = sqliteTable(
  "financial_obligations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    patientId: integer("patient_id").notNull().references(() => patients.id),
    clinicorpPaymentId: text("clinicorp_payment_id"),
    competence: text("competence").notNull(),
    cycleStart: text("cycle_start"),
    cycleEnd: text("cycle_end"),
    expectedAmountCents: integer("expected_amount_cents").notNull().default(0),
    paidAmountCents: integer("paid_amount_cents").notNull().default(0),
    dueDate: text("due_date"),
    paidAt: text("paid_at"),
    paymentStatus: text("payment_status").notNull().default("pending"),
    invoiceStatus: text("invoice_status").notNull().default("forecast"),
    invoiceNumber: text("invoice_number"),
    invoiceIssuedAt: text("invoice_issued_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("obligations_clinicorp_payment_unique").on(table.clinicorpPaymentId)],
);

export const messageEvents = sqliteTable(
  "message_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    obligationId: integer("obligation_id").notNull().references(() => financialObligations.id),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("scheduled"),
    externalMessageId: text("external_message_id"),
    scheduledFor: text("scheduled_for"),
    sentAt: text("sent_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("message_events_once_unique").on(table.obligationId, table.kind)],
);

export const importRuns = sqliteTable("import_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fileName: text("file_name").notNull(),
  totalRows: integer("total_rows").notNull().default(0),
  importedRows: integer("imported_rows").notNull().default(0),
  errorRows: integer("error_rows").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
