import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "npm:@supabase/server@1.5.3";

import {
  CLINICORP_API_BASE,
  CLINICORP_SECRET_NAMES,
  ClinicorpApiError,
  clinicorpGet,
  extractBusinessCandidates,
  extractSubscriberCandidates,
  selectBusiness,
  summarizePaymentMapping,
  summarizePayments,
  normalizeClinicorpRows,
  validateDateRange,
} from "./clinicorp.mjs";

type UnitCode = keyof typeof CLINICORP_SECRET_NAMES;
type Action = "status" | "discover" | "preview_payments" | "sync_existing_payments";

type RequestBody = {
  action?: Action;
  unitCode?: UnitCode;
  subscriberId?: string;
  businessId?: string;
  from?: string;
  to?: string;
};

type JsonRecord = Record<string, unknown>;

const ALLOWED_ROLES = new Set(["ceo", "suporte"]);

function json(body: JsonRecord, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function secretNamesFor(unitCode: UnitCode) {
  return CLINICORP_SECRET_NAMES[unitCode];
}

function readCredentials(unitCode: UnitCode) {
  const names = secretNamesFor(unitCode);
  const username = Deno.env.get(names.username)?.trim() ?? "";
  const token = Deno.env.get(names.token)?.trim() ?? "";
  return {
    configured: Boolean(username && token),
    names,
    username,
    token,
  };
}

function connectionConfig(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function safeErrorMessage(error: unknown) {
  if (error instanceof ClinicorpApiError) return error.message;
  if (error instanceof Error && error.message) return error.message.slice(0, 280);
  return "A leitura do Clinicorp não foi concluída.";
}

Deno.serve(withSupabase({
  auth: "user",
  cors: true,
  errors: { detailed: false },
}, async (req, ctx) => {
  if (req.method !== "POST") {
    return json({ ok: false, code: "method_not_allowed", message: "Use uma solicitação POST." }, 405);
  }

  const userId = ctx.userClaims?.id;
  if (!userId) {
    return json({ ok: false, code: "unauthorized", message: "Sessão inválida." }, 401);
  }

  const { data: profile, error: profileError } = await ctx.supabase
    .from("profiles")
    .select("role, is_active")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileError || !profile?.is_active || !ALLOWED_ROLES.has(profile.role)) {
    return json({ ok: false, code: "forbidden", message: "Este perfil não pode administrar integrações." }, 403);
  }

  let body: RequestBody;
  try {
    body = await req.json() as RequestBody;
  } catch {
    return json({ ok: false, code: "invalid_json", message: "A solicitação não contém JSON válido." }, 400);
  }

  const action = body.action;
  const unitCode = body.unitCode;
  if (!action || !["status", "discover", "preview_payments", "sync_existing_payments"].includes(action)) {
    return json({ ok: false, code: "invalid_action", message: "Ação de integração inválida." }, 400);
  }
  if (!unitCode || !(unitCode in CLINICORP_SECRET_NAMES)) {
    return json({ ok: false, code: "invalid_unit", message: "Unidade inválida." }, 400);
  }

  const { data: unit, error: unitError } = await ctx.supabaseAdmin
    .from("units")
    .select("id, code, name, clinicorp_business_id, is_active")
    .eq("code", unitCode)
    .eq("is_active", true)
    .maybeSingle();

  if (unitError || !unit) {
    return json({ ok: false, code: "unit_not_found", message: "A unidade não foi encontrada." }, 404);
  }

  const { data: membership, error: membershipError } = await ctx.supabaseAdmin
    .from("profile_units")
    .select("unit_id")
    .eq("user_id", userId)
    .eq("unit_id", unit.id)
    .maybeSingle();

  if (membershipError || !membership) {
    return json({ ok: false, code: "unit_forbidden", message: "Seu perfil não tem acesso a esta unidade." }, 403);
  }

  const { data: existingConnection, error: connectionReadError } = await ctx.supabaseAdmin
    .from("integration_connections")
    .select("id, status, non_secret_config, last_sync_at, last_error")
    .eq("provider", "clinicorp")
    .eq("unit_id", unit.id)
    .maybeSingle();

  if (connectionReadError) {
    return json({ ok: false, code: "connection_read_failed", message: "Não foi possível consultar a conexão." }, 500);
  }

  const credentials = readCredentials(unitCode);
  const currentConfig = connectionConfig(existingConnection?.non_secret_config);

  if (action === "status") {
    return json({
      ok: true,
      action,
      unit: { code: unit.code, name: unit.name },
      credentialsConfigured: credentials.configured,
      connection: existingConnection ? {
        status: existingConnection.status,
        subscriberId: currentConfig.subscriber_id ?? null,
        businessId: currentConfig.business_id ?? unit.clinicorp_business_id ?? null,
        lastSyncAt: existingConnection.last_sync_at,
        lastError: existingConnection.last_error,
      } : null,
    });
  }

  if (!credentials.configured) {
    return json({
      ok: false,
      code: "credentials_pending",
      message: `As credenciais seguras de ${unit.name} ainda não foram cadastradas.`,
      requiredSecrets: [credentials.names.username, credentials.names.token],
    }, 409);
  }

  let connectionId = existingConnection?.id ?? null;
  const secretReference = `edge-secrets:${credentials.names.username},${credentials.names.token}`;

  if (!connectionId) {
    const { data: createdConnection, error: createConnectionError } = await ctx.supabaseAdmin
      .from("integration_connections")
      .insert({
        unit_id: unit.id,
        provider: "clinicorp",
        display_name: `Clinicorp — ${unit.name}`,
        status: "pending",
        non_secret_config: {
          api_base: CLINICORP_API_BASE,
          credential_scope: "per_unit",
        },
        secret_reference: secretReference,
      })
      .select("id")
      .single();
    if (createConnectionError || !createdConnection) {
      return json({ ok: false, code: "connection_create_failed", message: "Não foi possível preparar a conexão." }, 500);
    }
    connectionId = createdConnection.id;
  }

  if (action === "discover") {
    try {
      console.log(JSON.stringify({ event: "clinicorp_discovery_started", unitCode }));
      // Contas separadas do Clinicorp podem não aparecer em /group/list_subscribers,
      // pois esse endpoint é voltado principalmente a agrupamentos/franquias.
      // Primeiro consultamos assinante+clínicas da própria credencial.
      const subscriberClinicPayload = await clinicorpGet(
        "/group/list_subscribers_clinics",
        {},
        credentials,
      );

      let subscribers = extractSubscriberCandidates(subscriberClinicPayload);

      // Fallback para contas organizadas como grupo/franquia.
      if (!subscribers.length) {
        const franchisePayload = await clinicorpGet("/group/list_subscribers", {}, credentials);
        subscribers = extractSubscriberCandidates(franchisePayload);
      }

      // Em uma assinatura independente, o Clinicorp pode não devolver registros
      // nos endpoints de grupo. Nessa modalidade, o Usuário API é o ID de acesso
      // ao sistema e pode ser validado diretamente como subscriber_id.
      let businessesFromCredential: ReturnType<typeof extractBusinessCandidates> = [];
      let usedCredentialAsSubscriber = false;
      if (!subscribers.length) {
        try {
          const directBusinessPayload = await clinicorpGet(
            "/business/list",
            { subscriber_id: credentials.username },
            credentials,
          );
          businessesFromCredential = extractBusinessCandidates(directBusinessPayload);
          if (businessesFromCredential.length) {
            subscribers = [{ id: credentials.username, name: unit.name }];
            usedCredentialAsSubscriber = true;
          }
        } catch (error) {
          if (!(error instanceof ClinicorpApiError && error.status === 400)) throw error;
        }
      }

      console.log(JSON.stringify({
        event: "clinicorp_subscriber_candidates",
        unitCode,
        count: subscribers.length,
        usedCredentialAsSubscriber,
      }));

      const requestedSubscriberId = body.subscriberId?.trim();
      const subscriber = selectBusiness(subscribers, unit.name, requestedSubscriberId ?? null);

      if (!subscriber) {
        const message = subscribers.length
          ? "O acesso retornou mais de um assinante e nenhum correspondeu a esta unidade."
          : "A credencial foi aceita, mas o Clinicorp não retornou um assinante nem uma clínica para este Usuário API.";
        await ctx.supabaseAdmin
          .from("integration_connections")
          .update({ status: "error", last_error: message })
          .eq("id", connectionId);
        return json({
          ok: false,
          code: "subscriber_selection_required",
          message,
          subscribers,
        }, 409);
      }

      // /business/list exige subscriber_id. Consultá-lo antes de descobrir o
      // assinante faz o Clinicorp responder HTTP 400 e interrompe toda a etapa.
      const scopedBusinessPayload = businessesFromCredential.length
        ? null
        : await clinicorpGet(
          "/business/list",
          { subscriber_id: subscriber.id },
          credentials,
        );
      const businesses = [
        ...businessesFromCredential,
        ...(scopedBusinessPayload ? extractBusinessCandidates(scopedBusinessPayload) : []),
        ...extractBusinessCandidates(subscriberClinicPayload),
      ].filter((candidate, index, all) => all.findIndex((item) => item.id === candidate.id) === index);
      const business = selectBusiness(businesses, unit.name, body.businessId?.trim() ?? null);

      console.log(JSON.stringify({
        event: "clinicorp_business_candidates",
        unitCode,
        count: businesses.length,
        matched: Boolean(business),
      }));

      if (!business) {
        const message = businesses.length
          ? "O acesso retornou mais de uma clínica e nenhuma correspondeu a esta unidade."
          : "O assinante foi identificado, mas não retornou nenhuma clínica.";
        await ctx.supabaseAdmin
          .from("integration_connections")
          .update({ status: "error", last_error: message })
          .eq("id", connectionId);
        return json({
          ok: false,
          code: "business_selection_required",
          message,
          businesses,
        }, 409);
      }

      const now = new Date().toISOString();
      const config = {
        api_base: CLINICORP_API_BASE,
        credential_scope: "per_unit",
        subscriber_id: subscriber.id,
        subscriber_name: subscriber.name,
        business_id: business.id,
        business_name: business.name,
        discovered_at: now,
      };

      const [{ error: unitUpdateError }, { error: connectionUpdateError }] = await Promise.all([
        ctx.supabaseAdmin
          .from("units")
          .update({ clinicorp_business_id: business.id })
          .eq("id", unit.id),
        ctx.supabaseAdmin
          .from("integration_connections")
          .update({
            status: "connected",
            non_secret_config: config,
            secret_reference: secretReference,
            last_error: null,
          })
          .eq("id", connectionId),
      ]);

      if (unitUpdateError || connectionUpdateError) {
        throw new Error("A conexão foi validada, mas não pôde ser registrada.");
      }

      console.log(JSON.stringify({ event: "clinicorp_discovery_completed", unitCode }));

      return json({
        ok: true,
        action,
        unit: { code: unit.code, name: unit.name },
        connection: {
          status: "connected",
          subscriberId: subscriber.id,
          businessId: business.id,
          businessName: business.name,
        },
      });
    } catch (error) {
      const message = safeErrorMessage(error);
      await ctx.supabaseAdmin
        .from("integration_connections")
        .update({ status: "error", last_error: message })
        .eq("id", connectionId);
      console.error(JSON.stringify({ event: "clinicorp_discovery_failed", unitCode, message }));
      return json({ ok: false, code: "clinicorp_discovery_failed", message }, 502);
    }
  }

  const subscriberId = String(currentConfig.subscriber_id ?? "").trim();
  const businessId = String(currentConfig.business_id ?? unit.clinicorp_business_id ?? "").trim();
  if (!subscriberId || !businessId || !existingConnection) {
    return json({
      ok: false,
      code: "connection_not_discovered",
      message: `Valide a conexão de ${unit.name} antes da primeira leitura.`,
    }, 409);
  }

  let dateRange;
  try {
    dateRange = validateDateRange(body.from, body.to);
  } catch (error) {
    return json({ ok: false, code: "invalid_date_range", message: safeErrorMessage(error) }, 400);
  }

  const { data: syncRun, error: syncRunError } = await ctx.supabaseAdmin
    .from("sync_runs")
    .insert({
      connection_id: existingConnection.id,
      unit_id: unit.id,
      entity_type: action === "sync_existing_payments" ? "payments_sync" : "payments_preview",
      direction: "inbound",
      status: "running",
      metadata: {
        mode: action === "sync_existing_payments" ? "existing_only" : "read_only_preview",
        date_range: dateRange,
        patient_data_persisted: false,
        creates_new_patients: false,
      },
    })
    .select("id")
    .single();

  if (syncRunError || !syncRun) {
    return json({ ok: false, code: "sync_run_failed", message: "Não foi possível abrir o registro da leitura." }, 500);
  }

  try {
    const commonQuery = {
      subscriber_id: subscriberId,
      from: dateRange.from,
      to: dateRange.to,
      include_total_amount: "X",
      get_amount_with_discounts: "X",
    };
    const [postedPayload, receivedPayload] = await Promise.all([
      clinicorpGet("/payment/list", { ...commonQuery, date_type: "postDate" }, credentials),
      clinicorpGet("/payment/list", commonQuery, credentials),
    ]);
    if (action === "sync_existing_payments") {
      const receivedRows = normalizeClinicorpRows(receivedPayload);
      const { data: appliedRows, error: applyError } = await ctx.supabaseAdmin.rpc(
        "apply_clinicorp_confirmed_payments",
        {
          p_unit_id: unit.id,
          p_rows: receivedRows,
          p_sync_run_id: syncRun.id,
        },
      );
      if (applyError) throw new Error(`A leitura do Clinicorp terminou, mas as baixas não puderam ser aplicadas: ${applyError.message}`);

      const applied = appliedRows?.[0] as {
        processed_count?: number;
        created_count?: number;
        updated_count?: number;
        skipped_count?: number;
        failed_count?: number;
        paid_installments?: number;
      } | undefined;
      if (!applied) throw new Error("O Clinicorp respondeu, mas o resumo da sincronização não foi retornado.");

      const result = {
        processedCount: Number(applied.processed_count ?? 0),
        createdCount: Number(applied.created_count ?? 0),
        updatedCount: Number(applied.updated_count ?? 0),
        skippedCount: Number(applied.skipped_count ?? 0),
        failedCount: Number(applied.failed_count ?? 0),
        paidInstallments: Number(applied.paid_installments ?? 0),
      };
      const completedAt = new Date().toISOString();
      const runStatus = result.failedCount > 0 ? "partial" : "completed";

      const [{ error: runUpdateError }, { error: connectionUpdateError }] = await Promise.all([
        ctx.supabaseAdmin
          .from("sync_runs")
          .update({
            status: runStatus,
            processed_count: result.processedCount,
            created_count: result.createdCount,
            updated_count: result.updatedCount,
            skipped_count: result.skippedCount,
            error_count: result.failedCount,
            metadata: {
              mode: "existing_only",
              date_range: dateRange,
              endpoint: "/payment/list",
              creates_new_patients: false,
              requires_payment_confirmed: true,
              supported_methods: ["boleto", "card"],
              result,
            },
            completed_at: completedAt,
          })
          .eq("id", syncRun.id),
        ctx.supabaseAdmin
          .from("integration_connections")
          .update({ status: "connected", last_sync_at: completedAt, last_error: null })
          .eq("id", existingConnection.id),
      ]);

      if (runUpdateError || connectionUpdateError) {
        throw new Error("As baixas foram processadas, mas o histórico da sincronização não pôde ser atualizado.");
      }

      return json({
        ok: true,
        action,
        unit: { code: unit.code, name: unit.name },
        dateRange,
        sync: result,
        persisted: true,
        createsNewPatients: false,
      });
    }

    const posted = summarizePayments(postedPayload);
    const received = summarizePayments(receivedPayload);
    const mapping = summarizePaymentMapping(postedPayload, receivedPayload);
    const completedAt = new Date().toISOString();

    const [{ error: runUpdateError }, { error: connectionUpdateError }] = await Promise.all([
      ctx.supabaseAdmin
        .from("sync_runs")
        .update({
          status: "completed",
          processed_count: posted.totalRows + received.totalRows,
          metadata: {
            mode: "read_only_preview",
            date_range: dateRange,
            endpoint: "/payment/list",
            posted,
            received,
            mapping,
            patient_data_persisted: false,
          },
          completed_at: completedAt,
        })
        .eq("id", syncRun.id),
      ctx.supabaseAdmin
        .from("integration_connections")
        .update({ status: "connected", last_sync_at: completedAt, last_error: null })
        .eq("id", existingConnection.id),
    ]);

    if (runUpdateError || connectionUpdateError) {
      throw new Error("A leitura terminou, mas o histórico não pôde ser atualizado.");
    }

    return json({
      ok: true,
      action,
      unit: { code: unit.code, name: unit.name },
      dateRange,
      preview: { posted, received, mapping },
      persisted: false,
    });
  } catch (error) {
    const message = safeErrorMessage(error);
    const completedAt = new Date().toISOString();
    await Promise.all([
      ctx.supabaseAdmin
        .from("sync_runs")
        .update({
          status: "failed",
          error_count: 1,
          error_summary: message,
          completed_at: completedAt,
        })
        .eq("id", syncRun.id),
      ctx.supabaseAdmin
        .from("integration_connections")
        .update({ status: "error", last_error: message })
        .eq("id", existingConnection.id),
    ]);
    console.error(JSON.stringify({ event: "clinicorp_preview_failed", unitCode, syncRunId: syncRun.id, message }));
    return json({ ok: false, code: "clinicorp_preview_failed", message }, 502);
  }
}));
