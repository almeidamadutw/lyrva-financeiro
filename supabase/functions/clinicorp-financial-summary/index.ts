import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type UnitCode = "sorocaba" | "salto_de_pirapora";
type RangeInput = { from: string; to: string };
type Summary = {
  totalInForecastAmount: number;
  totalPaymentsAmount: number;
  totalDebitAmount: number;
};

const API_BASE = "https://api.clinicorp.com/rest/v1";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_COMBINATIONS = 30;

const UNIT_SECRETS: Record<UnitCode, { username: string; token: string }> = {
  sorocaba: { username: "CLINICORP_SOROCABA_USERNAME", token: "CLINICORP_SOROCABA_TOKEN" },
  salto_de_pirapora: { username: "CLINICORP_SALTO_USERNAME", token: "CLINICORP_SALTO_TOKEN" },
};

const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function validRange(range: RangeInput) {
  return DATE_RE.test(range.from) && DATE_RE.test(range.to) && range.from <= range.to;
}

async function fetchFinancialSummary(
  subscriberId: string,
  businessId: string,
  credentials: { username: string; token: string },
  range: RangeInput,
): Promise<{ summary: Summary; raw: unknown }> {
  const url = new URL(`${API_BASE}/financial/list_payments`);
  url.searchParams.set("subscriber_id", subscriberId);
  url.searchParams.set("business_id", businessId);
  url.searchParams.set("from", range.from);
  url.searchParams.set("to", range.to);

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      authorization: `Basic ${btoa(`${credentials.username}:${credentials.token}`)}`,
    },
    signal: AbortSignal.timeout(25_000),
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("O Clinicorp recusou as credenciais desta unidade.");
    }
    throw new Error(`O Clinicorp respondeu com HTTP ${response.status}.`);
  }

  const raw = await response.json() as unknown;
  const candidate = Array.isArray(raw) ? (raw[0] ?? {}) : raw;
  const payload = (candidate && typeof candidate === "object" ? candidate : {}) as Record<string, unknown>;
  return {
    raw,
    summary: {
      totalInForecastAmount: numberValue(payload.totalInForecastAmount ?? payload.TotalInForecastAmount),
      totalPaymentsAmount: numberValue(payload.totalPaymentsAmount ?? payload.TotalPaymentsAmount),
      totalDebitAmount: numberValue(payload.totalDebitAmount ?? payload.TotalDebitAmount),
    },
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply({ ok: false, message: "Use POST." }, 405);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceRole) return reply({ ok: false, message: "Configuração interna indisponível." }, 500);

  const admin = createClient(url, serviceRole, { auth: { persistSession: false } });

  let body: { unit_codes?: UnitCode[]; ranges?: RangeInput[] };
  try {
    body = await req.json();
  } catch {
    return reply({ ok: false, message: "Corpo inválido." }, 400);
  }

  const unitCodes = [...new Set((body.unit_codes ?? []).filter((code): code is UnitCode =>
    code === "sorocaba" || code === "salto_de_pirapora"
  ))];
  const ranges = body.ranges ?? [];

  if (!unitCodes.length || !ranges.length || ranges.some((range) => !validRange(range))) {
    return reply({ ok: false, message: "Informe unidade e período válidos." }, 400);
  }
  if (unitCodes.length * ranges.length > MAX_COMBINATIONS) {
    return reply({ ok: false, message: "O período selecionado é amplo demais para uma única consulta." }, 400);
  }

  const incomingCronKey = req.headers.get("x-lyvra-cron-key") ?? "";
  const { data: secret } = await admin
    .from("system_secrets")
    .select("secret")
    .eq("key", "clinicorp_auto_sync_key")
    .maybeSingle();
  const internalCall = Boolean(secret?.secret && incomingCronKey === secret.secret);

  let userId: string | null = null;
  if (!internalCall) {
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return reply({ ok: false, message: "Sessão não autenticada." }, 401);

    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return reply({ ok: false, message: "Sessão inválida." }, 401);
    userId = authData.user.id;

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("user_id,is_active")
      .eq("user_id", userId)
      .maybeSingle();

    if (profileError || !profile?.is_active) return reply({ ok: false, message: "Usuário sem acesso financeiro ativo." }, 403);
  }

  const { data: units, error: unitsError } = await admin
    .from("units")
    .select("id,code,name")
    .in("code", unitCodes)
    .eq("is_active", true);

  if (unitsError || !units || units.length !== unitCodes.length) {
    return reply({ ok: false, message: "Unidade não encontrada." }, 404);
  }

  if (!internalCall && userId) {
    const unitIds = units.map((unit) => Number(unit.id));
    const { data: memberships, error: membershipError } = await admin
      .from("profile_units")
      .select("unit_id")
      .eq("user_id", userId)
      .in("unit_id", unitIds);

    if (membershipError) return reply({ ok: false, message: "Não foi possível validar o acesso às unidades." }, 500);
    const allowed = new Set((memberships ?? []).map((row) => Number(row.unit_id)));
    if (unitIds.some((id) => !allowed.has(id))) {
      return reply({ ok: false, message: "Você não possui acesso a uma das unidades selecionadas." }, 403);
    }
  }

  const results: Array<{
    unitCode: UnitCode;
    unitName: string;
    from: string;
    to: string;
    totalInForecastAmount: number;
    totalPaymentsAmount: number;
    totalDebitAmount: number;
  }> = [];

  for (const unit of units) {
    const unitCode = unit.code as UnitCode;
    const { data: connection, error: connectionError } = await admin
      .from("integration_connections")
      .select("status,non_secret_config")
      .eq("provider", "clinicorp")
      .eq("unit_id", unit.id)
      .maybeSingle();

    if (connectionError || !connection || connection.status !== "connected") {
      return reply({ ok: false, message: `Clinicorp não está conectado para ${unit.name}.` }, 409);
    }

    const config = (connection.non_secret_config ?? {}) as Record<string, unknown>;
    const subscriberId = String(config.subscriber_id ?? "").trim();
    const businessId = String(config.business_id ?? "").trim();
    const secretNames = UNIT_SECRETS[unitCode];
    const username = Deno.env.get(secretNames.username)?.trim() ?? "";
    const token = Deno.env.get(secretNames.token)?.trim() ?? "";

    if (!subscriberId || !businessId || !username || !token) {
      return reply({ ok: false, message: `Configuração do Clinicorp incompleta para ${unit.name}.` }, 500);
    }

    for (const range of ranges) {
      const { summary, raw } = await fetchFinancialSummary(subscriberId, businessId, { username, token }, range);
      results.push({
        unitCode,
        unitName: unit.name,
        from: range.from,
        to: range.to,
        ...summary,
        ...(internalCall ? { raw } : {}),
      } as typeof results[number]);
    }
  }

  const totals = results.reduce(
    (acc, item) => ({
      totalInForecastAmount: acc.totalInForecastAmount + item.totalInForecastAmount,
      totalPaymentsAmount: acc.totalPaymentsAmount + item.totalPaymentsAmount,
      totalDebitAmount: acc.totalDebitAmount + item.totalDebitAmount,
    }),
    { totalInForecastAmount: 0, totalPaymentsAmount: 0, totalDebitAmount: 0 },
  );

  return reply({ ok: true, totals, results });
});
