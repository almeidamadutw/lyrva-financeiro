import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "npm:@supabase/server@1.5.3";

type UnitCode = "sorocaba" | "salto_de_pirapora";
type JsonRecord = Record<string, unknown>;

const API_BASE = "https://api.clinicorp.com/rest/v1";
const ALLOWED_ROLES = new Set(["ceo", "suporte"]);
const SECRET_NAMES: Record<UnitCode, { username: string; token: string }> = {
  sorocaba: { username: "CLINICORP_SOROCABA_USERNAME", token: "CLINICORP_SOROCABA_TOKEN" },
  salto_de_pirapora: { username: "CLINICORP_SALTO_USERNAME", token: "CLINICORP_SALTO_TOKEN" },
};

function json(body: JsonRecord, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function configOf(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, unknown>;
  return value as Record<string, unknown>;
}

function spDate(date = new Date()) {
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

function minDate(a: string, b: string) {
  return a < b ? a : b;
}

function historicalWindows(from: string, to: string) {
  const windows: Array<{ from: string; to: string }> = [];
  let cursor = from;
  while (cursor <= to) {
    const end = minDate(addDays(cursor, 30), to);
    windows.push({ from: cursor, to: end });
    cursor = addDays(end, 1);
  }
  return windows;
}

function normalizeRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row));
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const record = payload as Record<string, unknown>;
  for (const key of ["data", "Data", "items", "Items", "results", "Results"]) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row));
    }
  }
  return [record];
}

async function clinicorpGet(path: string, query: Record<string, string>, credentials: { username: string; token: string }) {
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(query)) if (value) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Basic ${btoa(`${credentials.username}:${credentials.token}`)}`,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("O Clinicorp recusou o Usuário API ou o Token API desta unidade.");
    throw new Error(`O Clinicorp respondeu com erro HTTP ${response.status}.`);
  }
  const text = await response.text();
  if (text.length > 6_000_000) throw new Error("Uma janela do histórico do Clinicorp excedeu o limite de leitura.");
  try { return JSON.parse(text); }
  catch { throw new Error("O Clinicorp retornou uma resposta inválida durante a conciliação histórica."); }
}

Deno.serve(withSupabase({ auth: "user", cors: true, errors: { detailed: false } }, async (req, ctx) => {
  if (req.method !== "POST") return json({ ok: false, message: "Use uma solicitação POST." }, 405);

  const userId = ctx.userClaims?.id;
  if (!userId) return json({ ok: false, message: "Sessão inválida." }, 401);

  const { data: profile } = await ctx.supabase
    .from("profiles").select("role,is_active").eq("user_id", userId).maybeSingle();
  if (!profile?.is_active || !ALLOWED_ROLES.has(profile.role)) {
    return json({ ok: false, message: "Este perfil não pode administrar integrações." }, 403);
  }

  let body: { unitCode?: UnitCode };
  try { body = await req.json(); }
  catch { return json({ ok: false, message: "A solicitação não contém JSON válido." }, 400); }

  const unitCode = body.unitCode;
  if (!unitCode || !(unitCode in SECRET_NAMES)) return json({ ok: false, message: "Unidade inválida." }, 400);

  const { data: unit } = await ctx.supabaseAdmin
    .from("units").select("id,code,name").eq("code", unitCode).eq("is_active", true).maybeSingle();
  if (!unit) return json({ ok: false, message: "A unidade não foi encontrada." }, 404);

  const { data: membership } = await ctx.supabaseAdmin
    .from("profile_units").select("unit_id").eq("user_id", userId).eq("unit_id", unit.id).maybeSingle();
  if (!membership) return json({ ok: false, message: "Seu perfil não tem acesso a esta unidade." }, 403);

  const { data: connection } = await ctx.supabaseAdmin
    .from("integration_connections").select("id,status,non_secret_config")
    .eq("provider", "clinicorp").eq("unit_id", unit.id).maybeSingle();
  if (!connection || connection.status !== "connected") {
    return json({ ok: false, message: `Valide a conexão de ${unit.name} antes da conciliação.` }, 409);
  }

  const currentConfig = configOf(connection.non_secret_config);
  const subscriberId = String(currentConfig.subscriber_id ?? "").trim();
  const businessId = String(currentConfig.business_id ?? "").trim();
  if (!subscriberId) return json({ ok: false, message: "O assinante do Clinicorp ainda não foi identificado." }, 409);

  if (currentConfig.historical_bootstrap_completed_at) {
    return json({
      ok: true,
      alreadyComplete: true,
      bootstrap: false,
      unit: { code: unit.code, name: unit.name },
      completedAt: currentConfig.historical_bootstrap_completed_at,
    });
  }

  const names = SECRET_NAMES[unitCode];
  const username = Deno.env.get(names.username)?.trim() ?? "";
  const token = Deno.env.get(names.token)?.trim() ?? "";
  if (!username || !token) return json({ ok: false, message: `As credenciais seguras de ${unit.name} não estão configuradas.` }, 409);

  const { data: earliestPlan, error: earliestError } = await ctx.supabaseAdmin
    .from("payment_plans")
    .select("start_date")
    .eq("unit_id", unit.id)
    .eq("status", "active")
    .is("archived_at", null)
    .not("start_date", "is", null)
    .order("start_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (earliestError) return json({ ok: false, message: "Não foi possível descobrir o início dos planos locais." }, 500);
  if (!earliestPlan?.start_date) return json({ ok: false, message: "Ainda não existem planos financeiros nesta unidade." }, 409);

  const from = addDays(String(earliestPlan.start_date), -120);
  const to = spDate();
  const windows = historicalWindows(from, to);

  const { data: syncRun, error: syncRunError } = await ctx.supabaseAdmin
    .from("sync_runs")
    .insert({
      connection_id: connection.id,
      unit_id: unit.id,
      entity_type: "payments_bootstrap",
      direction: "inbound",
      status: "running",
      metadata: {
        mode: "historical_bootstrap",
        from,
        to,
        windows: windows.length,
        creates_new_patients: true,
        requires_payment_confirmed: true,
        preserves_unconfirmed_rows: true,
        syncs_invoices: true,
      },
    })
    .select("id")
    .single();
  if (syncRunError || !syncRun) return json({ ok: false, message: "Não foi possível abrir a conciliação histórica." }, 500);

  const total = {
    processedCount: 0,
    createdCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    paidInstallments: 0,
    invoices: {
      processedCount: 0,
      createdCount: 0,
      updatedCount: 0,
      pendingCount: 0,
      failedCount: 0,
    },
  };

  try {
    for (const window of windows) {
      const [payload, invoicePayload] = await Promise.all([
        clinicorpGet("/payment/list", {
          subscriber_id: subscriberId,
          from: window.from,
          to: window.to,
          include_total_amount: "X",
          get_amount_with_discounts: "X",
        }, { username, token }),
        clinicorpGet("/financial/list_invoices", {
          subscriber_id: subscriberId,
          business_id: businessId,
          from: window.from,
          to: window.to,
        }, { username, token }),
      ]);
      const rows = normalizeRows(payload);

      const { data: appliedRows, error: applyError } = await ctx.supabaseAdmin.rpc(
        "ingest_clinicorp_payments",
        { p_unit_id: unit.id, p_rows: rows, p_sync_run_id: syncRun.id },
      );
      if (applyError) throw new Error(`As baixas da janela ${window.from} a ${window.to} não puderam ser aplicadas: ${applyError.message}`);
      const applied = appliedRows?.[0] ?? {};
      total.processedCount += Number(applied.processed_count ?? 0);
      total.createdCount += Number(applied.created_count ?? 0);
      total.updatedCount += Number(applied.updated_count ?? 0);
      total.skippedCount += Number(applied.skipped_count ?? 0);
      total.failedCount += Number(applied.failed_count ?? 0);
      total.paidInstallments += Number(applied.paid_installments ?? 0);

      const invoiceRows = normalizeRows(invoicePayload);
      const { data: appliedInvoiceRows, error: invoiceError } = await ctx.supabaseAdmin.rpc(
        "ingest_clinicorp_invoices",
        { p_unit_id: unit.id, p_rows: invoiceRows, p_sync_run_id: syncRun.id },
      );
      if (invoiceError) throw new Error(`As notas da janela ${window.from} a ${window.to} não puderam ser aplicadas: ${invoiceError.message}`);
      const invoices = appliedInvoiceRows?.[0] ?? {};
      total.invoices.processedCount += Number(invoices.processed_count ?? 0);
      total.invoices.createdCount += Number(invoices.created_count ?? 0);
      total.invoices.updatedCount += Number(invoices.updated_count ?? 0);
      total.invoices.pendingCount += Number(invoices.skipped_count ?? 0);
      total.invoices.failedCount += Number(invoices.failed_count ?? 0);
    }

    const completedAt = new Date().toISOString();
    const nextConfig = {
      ...currentConfig,
      historical_bootstrap_completed_at: completedAt,
      historical_bootstrap_from: from,
      historical_bootstrap_to: to,
      historical_bootstrap_summary: total,
    };

    const [{ error: runError }, { error: connectionError }] = await Promise.all([
      ctx.supabaseAdmin.from("sync_runs").update({
        status: total.failedCount + total.invoices.failedCount ? "partial" : "completed",
        processed_count: total.processedCount + total.invoices.processedCount,
        created_count: total.createdCount + total.invoices.createdCount,
        updated_count: total.updatedCount + total.invoices.updatedCount,
        skipped_count: total.skippedCount + total.invoices.pendingCount,
        error_count: total.failedCount + total.invoices.failedCount,
        metadata: {
          mode: "historical_bootstrap",
          from,
          to,
          windows: windows.length,
          creates_new_patients: true,
          requires_payment_confirmed: true,
          preserves_unconfirmed_rows: true,
          syncs_invoices: true,
          result: total,
        },
        completed_at: completedAt,
      }).eq("id", syncRun.id),
      ctx.supabaseAdmin.from("integration_connections").update({
        status: "connected",
        non_secret_config: nextConfig,
        last_sync_at: completedAt,
        last_error: null,
      }).eq("id", connection.id),
    ]);
    if (runError || connectionError) throw new Error("A conciliação terminou, mas o histórico não pôde ser salvo.");

    return json({
      ok: true,
      bootstrap: true,
      alreadyComplete: false,
      unit: { code: unit.code, name: unit.name },
      from,
      to,
      windows: windows.length,
      sync: total,
      createsNewPatients: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "A conciliação histórica não foi concluída.";
    const completedAt = new Date().toISOString();
    await Promise.all([
      ctx.supabaseAdmin.from("sync_runs").update({ status: "failed", error_count: 1, error_summary: message, completed_at: completedAt }).eq("id", syncRun.id),
      ctx.supabaseAdmin.from("integration_connections").update({ status: "error", last_error: message }).eq("id", connection.id),
    ]);
    return json({ ok: false, message }, 502);
  }
}));
