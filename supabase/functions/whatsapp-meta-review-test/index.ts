import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type Body = { action: "send" | "management_test"; to?: string; access_token?: string };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PHONE_NUMBER_ID = "1426521627207345";
const WABA_ID = "1674618824003781";
const TEMPLATE_NAME = "jaspers_market_order_confirmation_v1";
const TEMPLATE_LANGUAGE = "en_US";

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ ok: false, message: "Use POST." }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ ok: false, message: "Configuração interna indisponível." }, 500);

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ ok: false, message: "Entre no LYVRA para continuar." }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return json({ ok: false, message: "Sessão inválida." }, 401);

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("role,is_active")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (profileError || !profile?.is_active || !["suporte", "gestora"].includes(profile.role)) {
    return json({ ok: false, message: "Este teste está disponível somente para suporte ou gestão." }, 403);
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, message: "Requisição inválida." }, 400);
  }

  if (body.action === "management_test") {
    const accessToken = String(body.access_token ?? "").trim();
    if (!accessToken || accessToken.length < 20) {
      return json({ ok: false, message: "Cole primeiro um novo token temporário gerado pela Meta." }, 400);
    }

    const response = await fetch(`https://graph.facebook.com/v25.0/${WABA_ID}/message_templates?limit=10`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json",
      },
    });

    let payload: any = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const metaMessage =
        payload?.error?.error_user_msg ||
        payload?.error?.message ||
        `Meta HTTP ${response.status}`;
      return json({ ok: false, message: String(metaMessage) }, 502);
    }

    const templates = Array.isArray(payload?.data)
      ? payload.data.map((item: any) => ({
          id: item?.id ?? null,
          name: item?.name ?? null,
          status: item?.status ?? null,
          language: item?.language ?? null,
        }))
      : [];

    await admin.from("whatsapp_webhook_events").insert({
      phone_number_id: PHONE_NUMBER_ID,
      waba_id: WABA_ID,
      event_type: "review:management_api_test",
      payload: {
        endpoint: "message_templates",
        template_count: templates.length,
      },
      processed_at: new Date().toISOString(),
    });

    return json({ ok: true, templates, count: templates.length });
  }

  if (body.action === "send") {
    const to = String(body.to ?? "").replace(/\D/g, "");
    const accessToken = String(body.access_token ?? "").trim();
    if (to.length < 10 || to.length > 15) {
      return json({ ok: false, message: "Informe um destinatário válido com DDI e DDD." }, 400);
    }

    if (!accessToken || accessToken.length < 20) {
      return json({ ok: false, message: "Cole primeiro um novo token temporário gerado pela Meta." }, 400);
    }

    const response = await fetch(`https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: TEMPLATE_NAME,
          language: { code: TEMPLATE_LANGUAGE },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: "LYVRA Financeiro" },
                { type: "text", text: "LYVRA-TESTE-001" },
                { type: "text", text: "Oct 2, 2026" },
              ],
            },
          ],
        },
      }),
    });

    let payload: any = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const metaMessage =
        payload?.error?.error_user_msg ||
        payload?.error?.message ||
        `Meta HTTP ${response.status}`;
      return json({ ok: false, message: String(metaMessage) }, 502);
    }

    const messageId = payload?.messages?.[0]?.id ?? null;

    await admin.from("whatsapp_webhook_events").insert({
      phone_number_id: PHONE_NUMBER_ID,
      event_type: "review:test_send",
      message_id: messageId,
      payload: {
        to,
        template_name: TEMPLATE_NAME,
        meta_response: payload,
      },
      processed_at: new Date().toISOString(),
    });

    return json({ ok: true, message_id: messageId });
  }

  return json({ ok: false, message: "Ação inválida." }, 400);
});
