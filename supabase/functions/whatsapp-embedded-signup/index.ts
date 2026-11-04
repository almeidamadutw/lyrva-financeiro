import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Only management users can start onboarding. Never return a Meta token to the browser.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const ENCRYPTION_KEY = Deno.env.get("META_TOKEN_ENCRYPTION_KEY") ?? "";
const APP_ID = "1609781340894846";
const GRAPH = "https://graph.facebook.com/v25.0";
const ALLOWED_ORIGINS = new Set([
  "https://lyvrafinanceiro.com.br",
  "https://www.lyvrafinanceiro.com.br",
  "https://lyvra-financeiro.vercel.app",
]);

function send(value: unknown, status = 200, origin = "") {
  const headers = new Headers({
    "content-type": "application/json", "cache-control": "no-store",
    "vary": "Origin", "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
    "access-control-allow-methods": "POST, OPTIONS",
  });
  if (ALLOWED_ORIGINS.has(origin)) headers.set("access-control-allow-origin", origin);
  return new Response(JSON.stringify(value), { status, headers });
}
function isDigits(value: unknown) {
  return typeof value === "string" && /^[0-9]{6,30}$/.test(value);
}
class MetaRequestError extends Error {
  constructor(readonly httpStatus: number, readonly metaCode?: number, readonly metaSubcode?: number) {
    super("Meta request failed");
  }
}

async function graph(path: string | URL, token?: string) {
  const controller = new AbortController();
  const abort = setTimeout(() => controller.abort(), 15000);
  try {
    const headers = new Headers({ accept: "application/json" });
    if (token) headers.set("authorization", "Bearer " + token);
    const response = await fetch(path, { headers, signal: controller.signal });
    if (response.ok) return await response.json();

    const data = await response.json().catch(() => null);
    throw new MetaRequestError(
      response.status,
      typeof data?.error?.code === "number" ? data.error.code : undefined,
      typeof data?.error?.error_subcode === "number" ? data.error.error_subcode : undefined,
    );
  } finally { clearTimeout(abort); }
}

function getEncryptionKey() {
  try {
    const raw = Uint8Array.from(atob(ENCRYPTION_KEY), c => c.charCodeAt(0));
    return raw.byteLength === 32 ? raw.buffer : null;
  } catch {
    return null;
  }
}

async function seal(token: string, encryptionKey: ArrayBuffer) {
  const key = await crypto.subtle.importKey("raw", encryptionKey, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(token)));
  const encode = (bytes: Uint8Array) => btoa(Array.from(bytes, b => String.fromCharCode(b)).join(""));
  return { cipher: encode(encrypted), iv: encode(iv) };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  if (req.method === "OPTIONS") return send({ ok: true }, ALLOWED_ORIGINS.has(origin) ? 200 : 403, origin);
  if (req.method !== "POST" || !ALLOWED_ORIGINS.has(origin)) return send({ ok: false, message: "Origem não autorizada." }, 403, origin);
  if (!SUPABASE_URL || !SERVICE_ROLE) return send({ ok: false, message: "Servidor indisponível." }, 503, origin);
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!bearer) return send({ ok: false, message: "Entre no LYRVA." }, 401, origin);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data: auth, error: authErr } = await admin.auth.getUser(bearer);
  if (authErr || !auth.user) return send({ ok: false, message: "Sessão inválida." }, 401, origin);
  const { data: profile } = await admin.from("profiles").select("role,is_active").eq("user_id", auth.user.id).maybeSingle();
  if (!profile?.is_active || !["suporte", "ceo", "gestora"].includes(profile.role))
    return send({ ok: false, message: "Somente suporte ou gestão pode conectar WhatsApp." }, 403, origin);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return send({ ok: false, message: "Dados inválidos." }, 400, origin); }
  if (body.action !== "status" && body.action !== "complete") return send({ ok: false, message: "Ação inválida." }, 400, origin);
  const code = body.unit_code;
  if (code !== "sorocaba" && code !== "salto_de_pirapora") return send({ ok: false, message: "Unidade inválida." }, 400, origin);
  const { data: unit } = await admin.from("units").select("id,name").eq("code", code).eq("is_active", true).maybeSingle();
  if (!unit) return send({ ok: false, message: "Unidade não encontrada." }, 404, origin);
  if (profile.role !== "suporte" && profile.role !== "ceo") {
    const { data: membership } = await admin.from("profile_units").select("unit_id")
      .eq("user_id", auth.user.id).eq("unit_id", unit.id).maybeSingle();
    if (!membership) return send({ ok: false, message: "Sem permissão nesta unidade." }, 403, origin);
  }

  const encryptionKey = getEncryptionKey();
  const ready = Boolean(META_APP_SECRET && encryptionKey);
  const requiredSetup = !META_APP_SECRET || !ENCRYPTION_KEY
    ? "Falta configurar uma credencial da integração do WhatsApp. Avise o suporte."
    : "A chave de proteção da integração do WhatsApp está inválida. Avise o suporte.";
  if (body.action === "status") {
    const { data: connection } = await admin.from("integration_connections")
      .select("status,non_secret_config").eq("unit_id", unit.id).eq("provider", "whatsapp").maybeSingle();
    const config = connection?.non_secret_config ?? {};
    return send({
      ok: true,
      ready, status: connection?.status ?? "not_configured",
      phoneConfigured: Boolean(config.phone_number_id),
      phoneDisplay: config.phone_display || null,
      onboardingStatus: config.onboarding_status || null,
      requiredSetup: ready ? null : requiredSetup,
    }, 200, origin);
  }
  if (!META_APP_SECRET || !encryptionKey) return send({ ok: false, message: requiredSetup }, 409, origin);
  const authorizationCode = body.code;
  const session = body.session;
  if (typeof authorizationCode !== "string" || authorizationCode.length < 8 || authorizationCode.length > 2048 ||
      !session || typeof session !== "object" || Array.isArray(session)) {
    return send({ ok: false, message: "Resposta da Meta incompleta." }, 400, origin);
  }
  const event = (session as Record<string, unknown>).event;
  const wabaId = (session as Record<string, unknown>).waba_id;
  const phoneId = (session as Record<string, unknown>).phone_number_id;
  if (event !== "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" || !isDigits(wabaId)) {
    return send({ ok: false, message: "Coexistência não confirmada. Nenhum número foi ativado no LYRVA." }, 409, origin);
  }

  let stage: "exchange_code" | "verify_number" | "protect_token" | "save_connection" = "exchange_code";
  try {
    const oauth = new URL(GRAPH + "/oauth/access_token");
    oauth.searchParams.set("client_id", APP_ID);
    oauth.searchParams.set("client_secret", META_APP_SECRET);
    oauth.searchParams.set("code", authorizationCode);
    // Exchange only on server. Do not print or return access tokens, even on failure.
    const { access_token } = await graph(oauth);
    if (typeof access_token !== "string" || access_token.length < 16) throw new Error("token missing");

    stage = "verify_number";
    const phonesResult = await graph(GRAPH + "/" + wabaId + "/phone_numbers?fields=id,display_phone_number,verified_name&limit=100", access_token);
    const phones = Array.isArray(phonesResult.data) ? phonesResult.data : [];
    const matches = phones.filter((p: Record<string, unknown>) => isDigits(p.id) &&
      (!phoneId || p.id === phoneId));
    if (matches.length !== 1) return send({ ok: false,
      message: "A conta possui vários números ou o número retornado não foi confirmado. Nenhum número foi ativado; revise a seleção na Meta."
    }, 409, origin);
    const selected = matches[0];
    const display = String(selected.display_phone_number ?? "");
    if (!display || display.length > 40) throw new Error("missing verified phone");
    stage = "protect_token";
    const sealed = await seal(access_token, encryptionKey);
    stage = "save_connection";
    const { error: saveError } = await admin.rpc("save_whatsapp_embedded_connection", {
      p_unit_id: unit.id, p_waba_id: wabaId, p_phone_number_id: String(selected.id),
      p_phone_display: display, p_token_cipher: sealed.cipher, p_token_iv: sealed.iv,
      p_signup_event: String(event),
    });
    if (saveError) {
      // Avoid untrusted error details since they may reveal identifiers.
      console.warn("whatsapp_embedded_signup_failure", { unit: code, stage, databaseCode: saveError.code });
      return send({ ok: false, message: "Não foi possível salvar o vínculo. Confira se o número já está em outra unidade." }, 409, origin);
    }
    return send({ ok: true, status: "pending_internal_test", unit: unit.name, phoneDisplay: display,
      message: "Número identificado com coexistência; envios continuam bloqueados até o teste interno." }, 200, origin);
  } catch (error) {
    // Log only the stage and numeric Meta error identifiers. URLs and response messages may contain credentials.
    console.warn("whatsapp_embedded_signup_failure", {
      unit: code,
      stage,
      ...(error instanceof MetaRequestError && {
        httpStatus: error.httpStatus, metaCode: error.metaCode, metaSubcode: error.metaSubcode,
      }),
    });
    const message = {
      exchange_code: "A autorização do WhatsApp não pôde ser validada na Meta. Avise o suporte.",
      verify_number: "A Meta autorizou o acesso, mas não foi possível verificar o número. Avise o suporte.",
      protect_token: "Não foi possível proteger a credencial do WhatsApp. Avise o suporte.",
      save_connection: "Não foi possível salvar a conexão do WhatsApp. Avise o suporte.",
    }[stage];
    return send({ ok: false, message }, stage === "protect_token" || stage === "save_connection" ? 500 : 502, origin);
  }
});
