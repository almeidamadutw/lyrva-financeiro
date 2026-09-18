import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import {
  eligibleAutomaticPayments,
  externalPaymentId,
  normalizeClinicorpRows,
  paymentChanged,
} from "./clinicorp.mjs";

type UnitCode = "sorocaba" | "salto_de_pirapora";
type JsonRecord = Record<string, unknown>;
type ExistingPayment = { clinicorp_payment_id: string; raw_data: JsonRecord | null };

const API_BASE = "https://api.clinicorp.com/rest/v1";
const SECRET_NAMES: Record<UnitCode, { username: string; token: string }> = {
  sorocaba: { username: "CLINICORP_SOROCABA_USERNAME", token: "CLINICORP_SOROCABA_TOKEN" },
  salto_de_pirapora: { username: "CLINICORP_SALTO_USERNAME", token: "CLINICORP_SALTO_TOKEN" },
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function saoPauloDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDays(dateText: string, days: number) {
  const date = new Date(`${dateText}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function clinicorpGet(
  path: string,
  subscriberId: string,
  credentials: { username: string; token: string },
  from: string,
  to: string,
  extraQuery: Record<string, string> = {},
) {
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries({
    subscriber_id: subscriberId,
    from,
    to,
    ...extraQuery,
  })) url.searchParams.set(key, value);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Basic ${btoa(`${credentials.username}:${credentials.token}`)}`,
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("O Clinicorp recusou as credenciais desta unidade.");
    }
    throw new Error(`O Clinicorp respondeu com HTTP ${response.status}.`);
  }

  const text = await response.text();
  if (text.length > 6_000_000) {
    throw new Error("A resposta recente do Clinicorp excedeu o limite seguro de leitura.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("O Clinicorp retornou uma resposta inválida.");
  }
}

async function existingPaymentsByExternalId(
  admin: ReturnType<typeof createClient>,
  unitId: number,
  rows: JsonRecord[],
) {
  const ids = rows.map(externalPaymentId).filter((id): id is string => Boolean(id));
  const existing = new Map<string, JsonRecord | null>();

  for (const batch of chunks(ids, 200)) {
    const { data, error } = await admin
      .from("payments")
      .select("clinicorp_payment_id,raw_data")
      .eq("unit_id", unitId)
      .in("clinicorp_payment_id", batch);
    if (error) throw new Error(`Não foi possível conferir pagamentos já sincronizados: ${error.message}`);
    for (const payment of (data ?? []) as ExistingPayment[]) {
      existing.set(payment.clinicorp_payment_id, payment.raw_data);
    }
  }

  return existing;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, message: "Use POST." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ ok: false, message: "Configuração interna indisponível." }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const incomingKey = req.headers.get("x-lyvra-cron-key") ?? "";
  const { data: storedSecret, error: secretError } = await admin
    .from("system_secrets")
    .select("secret")
    .eq("key", "clinicorp_auto_sync_key")
    .maybeSingle();
  if (secretError || !storedSecret?.secret || incomingKey !== storedSecret.secret) {
    return json({ ok: false, message: "Chamada não autorizada." }, 401);
  }

  const to = saoPauloDate();
  const from = addDays(to, -7);
  const invoiceFrom = `${to.slice(0, 7)}-01`;
  const results: Array<Record<string, unknown>> = [];

  for (const unitCode of ["sorocaba", "salto_de_pirapora"] as UnitCode[]) {
    let syncRunId: number | null = null;
    let connectionId: number | null = null;
    try {
      const { data: unit, error: unitError } = await admin
        .from("units")
        .select("id,code,name,is_active")
        .eq("code", unitCode)
        .eq("is_active", true)
        .maybeSingle();
      if (unitError || !unit) throw new Error("Unidade não encontrada.");

      const { data: connection, error: connectionError } = await admin
        .from("integration_connections")
        .select("id,status,non_secret_config")
        .eq("provider", "clinicorp")
        .eq("unit_id", unit.id)
        .maybeSingle();
      if (connectionError || !connection || connection.status !== "connected") {
        throw new Error("Conexão do Clinicorp não está ativa.");
      }
      connectionId = connection.id;

      const config = (connection.non_secret_config ?? {}) as Record<string, unknown>;
      const subscriberId = String(config.subscriber_id ?? "").trim();
      const businessId = String(config.business_id ?? "").trim();
      if (!subscriberId) throw new Error("Assinante do Clinicorp não identificado.");

      const names = SECRET_NAMES[unitCode];
      const username = Deno.env.get(names.username)?.trim() ?? "";
      const token = Deno.env.get(names.token)?.trim() ?? "";
      if (!username || !token) throw new Error("Credenciais da unidade não estão configuradas.");

      const staleBefore = new Date(Date.now() - 30 * 60_000).toISOString();
      const nowIso = new Date().toISOString();
      await admin.from("sync_runs").update({
        status: "failed",
        error_count: 1,
        error_summary: "Sincronização automática anterior interrompida.",
        completed_at: nowIso,
      }).eq("connection_id", connection.id)
        .eq("entity_type", "payments_auto_sync")
        .eq("status", "running")
        .lt("started_at", staleBefore);

      const { data: activeRun } = await admin
        .from("sync_runs")
        .select("id")
        .eq("connection_id", connection.id)
        .eq("entity_type", "payments_auto_sync")
        .eq("status", "running")
        .gte("started_at", staleBefore)
        .limit(1)
        .maybeSingle();
      if (activeRun) {
        results.push({ unit: unit.name, ok: true, skipped: true, reason: "already_running" });
        continue;
      }

      const { data: syncRun, error: runError } = await admin.from("sync_runs").insert({
        connection_id: connection.id,
        unit_id: unit.id,
        entity_type: "payments_auto_sync",
        direction: "inbound",
        status: "running",
        metadata: {
          mode: "automatic_recent_sync",
          from,
          to,
          lookback_days: 7,
          creates_new_patients: true,
          requires_payment_confirmed: true,
          preserves_unconfirmed_rows: true,
          syncs_invoices: true,
          row_events: false,
        },
      }).select("id").single();
      if (runError || !syncRun) throw new Error("Não foi possível registrar a sincronização automática.");
      syncRunId = syncRun.id;

      const [payload, invoicePayload] = await Promise.all([
        clinicorpGet("/payment/list", subscriberId, { username, token }, from, to, {
          include_total_amount: "X",
          get_amount_with_discounts: "X",
        }),
        clinicorpGet("/financial/list_invoices", subscriberId, { username, token }, invoiceFrom, to, businessId ? { business_id: businessId } : {}),
      ]);
      const fetchedRows = normalizeClinicorpRows(payload) as JsonRecord[];
      const eligibleRows = eligibleAutomaticPayments(fetchedRows) as JsonRecord[];
      const existing = await existingPaymentsByExternalId(admin, unit.id, eligibleRows);
      const rowsToApply = eligibleRows.filter((row) => {
        const id = externalPaymentId(row);
        return !id || !existing.has(id) || paymentChanged(row, existing.get(id));
      });
      const unchangedCount = eligibleRows.length - rowsToApply.length;
      const filteredCount = fetchedRows.length - eligibleRows.length;

      const { data: appliedRows, error: applyError } = await admin.rpc(
        "ingest_clinicorp_payments",
        {
          p_unit_id: unit.id,
          p_rows: rowsToApply,
          // O automático mantém o resumo em sync_runs. O histórico por linha
          // fica no modo manual para não inflar o banco a cada 15 minutos.
          p_sync_run_id: null,
        },
      );
      if (applyError) throw new Error(`As baixas não puderam ser aplicadas: ${applyError.message}`);

      const invoiceRows = normalizeClinicorpRows(invoicePayload) as JsonRecord[];
      const { data: invoiceAppliedRows, error: invoiceApplyError } = await admin.rpc(
        "ingest_clinicorp_invoices",
        { p_unit_id: unit.id, p_rows: invoiceRows, p_sync_run_id: null },
      );
      if (invoiceApplyError) throw new Error(`As notas não puderam ser aplicadas: ${invoiceApplyError.message}`);

      const applied = appliedRows?.[0] ?? {};
      const appliedSummary = {
        appliedCount: Number(applied.processed_count ?? 0),
        createdCount: Number(applied.created_count ?? 0),
        updatedCount: Number(applied.updated_count ?? 0),
        pendingCount: Number(applied.skipped_count ?? 0),
        failedCount: Number(applied.failed_count ?? 0),
        paidInstallments: Number(applied.paid_installments ?? 0),
      };
      const invoiceApplied = invoiceAppliedRows?.[0] ?? {};
      const invoiceSummary = {
        fetchedCount: invoiceRows.length,
        createdCount: Number(invoiceApplied.created_count ?? 0),
        updatedCount: Number(invoiceApplied.updated_count ?? 0),
        pendingCount: Number(invoiceApplied.skipped_count ?? 0),
        failedCount: Number(invoiceApplied.failed_count ?? 0),
      };
      const summary = {
        fetchedCount: fetchedRows.length,
        eligibleCount: eligibleRows.length,
        filteredCount,
        unchangedCount,
        ...appliedSummary,
        invoices: invoiceSummary,
      };
      const completedAt = new Date().toISOString();
      const skippedCount = appliedSummary.pendingCount + invoiceSummary.pendingCount;
      const failedCount = appliedSummary.failedCount + invoiceSummary.failedCount;

      await Promise.all([
        admin.from("sync_runs").update({
          status: failedCount ? "partial" : "completed",
          processed_count: fetchedRows.length + invoiceRows.length,
          created_count: appliedSummary.createdCount + invoiceSummary.createdCount,
          updated_count: appliedSummary.updatedCount + invoiceSummary.updatedCount,
          skipped_count: skippedCount,
          error_count: failedCount,
          metadata: {
            mode: "automatic_recent_sync",
            from,
            to,
            invoice_from: invoiceFrom,
            lookback_days: 7,
            creates_new_patients: true,
            requires_payment_confirmed: true,
            preserves_unconfirmed_rows: true,
            syncs_invoices: true,
            row_events: false,
            result: summary,
          },
          completed_at: completedAt,
        }).eq("id", syncRun.id),
        admin.from("integration_connections").update({
          status: "connected",
          last_sync_at: completedAt,
          last_error: null,
        }).eq("id", connection.id),
      ]);

      results.push({ unit: unit.name, ok: true, ...summary });
    } catch (error) {
      const message = error instanceof Error
        ? error.message.slice(0, 500)
        : "Falha na sincronização automática.";
      const completedAt = new Date().toISOString();
      if (syncRunId) {
        await admin.from("sync_runs").update({
          status: "failed",
          error_count: 1,
          error_summary: message,
          completed_at: completedAt,
        }).eq("id", syncRunId);
      }
      if (connectionId) {
        await admin.from("integration_connections").update({ last_error: message }).eq("id", connectionId);
      }
      results.push({ unit: unitCode, ok: false, message });
    }
  }

  return json({ ok: results.every((item) => item.ok), from, invoiceFrom, to, results });
});
