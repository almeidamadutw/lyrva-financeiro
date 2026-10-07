import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type UnitCode = "sorocaba" | "salto_de_pirapora";
type Row = Record<string, unknown>;

const API_BASE = "https://api.clinicorp.com/rest/v1";
const SECRETS: Record<UnitCode, { username: string; token: string }> = {
  sorocaba: { username: "CLINICORP_SOROCABA_USERNAME", token: "CLINICORP_SOROCABA_TOKEN" },
  salto_de_pirapora: { username: "CLINICORP_SALTO_USERNAME", token: "CLINICORP_SALTO_TOKEN" },
};

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

function rowsOf(payload: unknown): Row[] {
  if (Array.isArray(payload)) return payload.filter((r): r is Row => !!r && typeof r === "object" && !Array.isArray(r));
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const obj = payload as Row;
  for (const key of ["data", "Data", "items", "Items", "results", "Results"]) {
    const value = obj[key];
    if (Array.isArray(value)) return value.filter((r): r is Row => !!r && typeof r === "object" && !Array.isArray(r));
  }
  return [obj];
}

function rowId(row: Row) {
  return String(row.id ?? row.ExternalTxId ?? "").trim();
}

function dueDay(row: Row) {
  return String(row.DueDate ?? "").slice(0, 10);
}

function isBoleto(row: Row) {
  return String(row.PaymentForm ?? "").toLocaleLowerCase("pt-BR").includes("boleto");
}

function isPaid(row: Row) {
  return String(row.PaymentReceived ?? "").toUpperCase() === "X"
    || String(row.PaymentConfirmed ?? "").toUpperCase() === "X";
}

function isCancelled(row: Row) {
  return String(row.Canceled ?? "").toUpperCase() === "X"
    || String(row.CancelInstallment ?? "").toUpperCase() === "X";
}

function amount(row: Row) {
  const parsed = Number(String(row.Amount ?? "0").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function fetchRows(
  subscriber: string,
  credentials: { username: string; token: string },
  from: string,
  to: string,
  dateType?: string,
) {
  const url = new URL(`${API_BASE}/payment/list`);
  url.searchParams.set("subscriber_id", subscriber);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  url.searchParams.set("include_total_amount", "X");
  url.searchParams.set("get_amount_with_discounts", "X");
  if (dateType) url.searchParams.set("date_type", dateType);

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      authorization: `Basic ${btoa(`${credentials.username}:${credentials.token}`)}`,
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > 8_000_000) throw new Error("Resposta maior que o limite seguro.");
  return rowsOf(JSON.parse(text));
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, message: "Use POST." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRole) return json({ ok: false, message: "Configuração interna indisponível." }, 500);

  const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
  const incoming = req.headers.get("x-lyvra-cron-key") ?? "";
  const { data: secret } = await admin.from("system_secrets").select("secret").eq("key", "clinicorp_auto_sync_key").maybeSingle();
  if (!secret?.secret || incoming !== secret.secret) return json({ ok: false, message: "Chamada não autorizada." }, 401);

  let body: { unit_code?: UnitCode; from?: string; to?: string } = {};
  try { body = await req.json(); } catch {}

  const unitCode = body.unit_code;
  const from = String(body.from ?? "");
  const to = String(body.to ?? "");
  if ((unitCode !== "sorocaba" && unitCode !== "salto_de_pirapora")
    || !/^\d{4}-\d{2}-\d{2}$/.test(from)
    || !/^\d{4}-\d{2}-\d{2}$/.test(to)
    || from > to) {
    return json({ ok: false, message: "Parâmetros inválidos." }, 400);
  }

  const { data: unit } = await admin.from("units").select("id,name").eq("code", unitCode).eq("is_active", true).maybeSingle();
  const { data: connection } = unit
    ? await admin.from("integration_connections").select("id,status,non_secret_config").eq("provider", "clinicorp").eq("unit_id", unit.id).maybeSingle()
    : { data: null };
  if (!unit || !connection || connection.status !== "connected") return json({ ok: false, message: "Unidade sem Clinicorp conectado." }, 409);

  const config = (connection.non_secret_config ?? {}) as Row;
  const subscriber = String(config.subscriber_id ?? "").trim();
  const names = SECRETS[unitCode];
  const username = Deno.env.get(names.username)?.trim() ?? "";
  const token = Deno.env.get(names.token)?.trim() ?? "";
  if (!subscriber || !username || !token) return json({ ok: false, message: "Configuração incompleta." }, 500);

  const variants: Array<string | undefined> = ["postDate", "dueDate", "due_date", "DueDate", undefined];
  const results: Record<string, unknown> = {};

  for (const variant of variants) {
    const label = variant ?? "default";
    try {
      const fetched = await fetchRows(subscriber, { username, token }, from, to, variant);
      const deduped = [...new Map(fetched.map((row) => [rowId(row) || JSON.stringify(row), row])).values()];
      const inRange = deduped.filter((row) => {
        const due = dueDay(row);
        return /^\d{4}-\d{2}-\d{2}$/.test(due) && due >= from && due <= to;
      });
      const openBoletos = inRange.filter((row) => isBoleto(row) && !isPaid(row) && !isCancelled(row) && amount(row) > 0);
      results[label] = {
        totalRows: deduped.length,
        inRangeRows: inRange.length,
        inRangeRatio: deduped.length ? inRange.length / deduped.length : 1,
        openBoletoRows: openBoletos.length,
        openBoletoAmount: Number(openBoletos.reduce((sum, row) => sum + amount(row), 0).toFixed(2)),
        ids: openBoletos.map(rowId).filter(Boolean),
      };
    } catch (error) {
      results[label] = { error: error instanceof Error ? error.message : "Falha" };
    }
  }

  const { data: run } = await admin.from("sync_runs").insert({
    connection_id: connection.id,
    unit_id: unit.id,
    entity_type: "clinicorp_authoritative_audit",
    direction: "inbound",
    status: "completed",
    processed_count: 0,
    metadata: { from, to, variants: results },
    completed_at: new Date().toISOString(),
  }).select("id").single();

  return json({ ok: true, auditRunId: run?.id ?? null, unit: unit.name, from, to, variants: results });
});
