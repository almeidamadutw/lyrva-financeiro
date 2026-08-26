import { getD1 } from "@/lib/d1";

type ImportedPatient = {
  clinicorpId?: string | null;
  name?: string;
  cpf?: string | null;
  phone?: string | null;
  email?: string | null;
  unit?: string;
  treatment?: string | null;
  paymentMethod?: string | null;
  planAmountCents?: number;
  startDate?: string | null;
  installments?: number | null;
  dueDay?: number | null;
  taxReceiptIr?: boolean;
  invoiceFrequency?: string;
  notes?: string | null;
};

const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";

export async function GET() {
  try {
    const result = await getD1().prepare(`
      SELECT id, clinicorp_id AS clinicorpId, name, cpf, phone, email, unit,
             treatment, payment_method AS paymentMethod,
             plan_amount_cents AS planAmountCents, start_date AS startDate,
             installments, due_day AS dueDay, tax_receipt_ir AS taxReceiptIr,
             invoice_frequency AS invoiceFrequency, notes, created_at AS createdAt
      FROM patients
      ORDER BY name COLLATE NOCASE
      LIMIT 1000
    `).all();
    return Response.json({ patients: result.results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível carregar os pacientes.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { fileName?: string; patients?: ImportedPatient[] };
    const incoming = Array.isArray(payload.patients) ? payload.patients.slice(0, 1000) : [];
    if (!incoming.length) return Response.json({ error: "Nenhum paciente válido para importar." }, { status: 400 });

    const valid = incoming.filter((patient) => clean(patient.name));
    if (!valid.length) return Response.json({ error: "A coluna de nome é obrigatória." }, { status: 400 });

    const db = getD1();
    const statements = valid.map((patient) => db.prepare(`
      INSERT INTO patients (
        clinicorp_id, name, cpf, phone, email, unit, treatment, payment_method,
        plan_amount_cents, start_date, installments, due_day, tax_receipt_ir,
        invoice_frequency, notes, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT DO UPDATE SET
        clinicorp_id = COALESCE(excluded.clinicorp_id, patients.clinicorp_id),
        name = excluded.name, phone = excluded.phone, email = excluded.email,
        unit = excluded.unit, treatment = excluded.treatment,
        payment_method = excluded.payment_method,
        plan_amount_cents = excluded.plan_amount_cents,
        start_date = excluded.start_date, installments = excluded.installments,
        due_day = excluded.due_day, tax_receipt_ir = excluded.tax_receipt_ir,
        invoice_frequency = excluded.invoice_frequency, notes = excluded.notes,
        updated_at = CURRENT_TIMESTAMP
    `).bind(
      clean(patient.clinicorpId) || null,
      clean(patient.name),
      clean(patient.cpf).replace(/\D/g, "") || null,
      clean(patient.phone),
      clean(patient.email),
      clean(patient.unit) || "Sorocaba",
      clean(patient.treatment),
      clean(patient.paymentMethod),
      Number.isFinite(patient.planAmountCents) ? Math.max(0, Math.round(patient.planAmountCents ?? 0)) : 0,
      clean(patient.startDate) || null,
      patient.installments ? Math.max(1, Math.round(patient.installments)) : null,
      patient.dueDay ? Math.min(31, Math.max(1, Math.round(patient.dueDay))) : null,
      patient.taxReceiptIr ? 1 : 0,
      clean(patient.invoiceFrequency) || "monthly",
      clean(patient.notes),
    ));

    await db.batch(statements);
    await db.prepare(`
      INSERT INTO import_runs (file_name, total_rows, imported_rows, error_rows)
      VALUES (?, ?, ?, ?)
    `).bind(clean(payload.fileName) || "planilha", incoming.length, valid.length, incoming.length - valid.length).run();

    return Response.json({ imported: valid.length, errors: incoming.length - valid.length }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível importar a planilha.";
    return Response.json({ error: message }, { status: 500 });
  }
}
