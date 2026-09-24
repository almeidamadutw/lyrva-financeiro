import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type Row = Record<string, unknown>;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function text(body: string, status = 200) {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

Deno.serve(async (req) => {
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ ok: false }, 500);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    const { data: secret, error } = await admin
      .from("system_secrets")
      .select("secret")
      .eq("key", "whatsapp_webhook_verify_token")
      .maybeSingle();

    if (error || !secret?.secret) return text("verification unavailable", 503);
    if (mode === "subscribe" && token === secret.secret && challenge) return text(challenge, 200);
    return text("forbidden", 403);
  }

  if (req.method !== "POST") return json({ ok: false }, 405);

  let payload: Row;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, message: "invalid json" }, 400);
  }

  try {
    const entries = Array.isArray(payload.entry) ? payload.entry as Row[] : [];

    for (const entry of entries) {
      const wabaId = String(entry.id ?? "") || null;
      const changes = Array.isArray(entry.changes) ? entry.changes as Row[] : [];

      for (const change of changes) {
        const value = (change.value && typeof change.value === "object" ? change.value : {}) as Row;
        const metadata = (value.metadata && typeof value.metadata === "object" ? value.metadata : {}) as Row;
        const phoneNumberId = String(metadata.phone_number_id ?? "") || null;

        let unitId: number | null = null;
        if (phoneNumberId) {
          const { data: connection } = await admin
            .from("integration_connections")
            .select("unit_id")
            .eq("provider", "whatsapp")
            .eq("non_secret_config->>phone_number_id", phoneNumberId)
            .maybeSingle();
          unitId = connection?.unit_id ? Number(connection.unit_id) : null;
        }

        const statuses = Array.isArray(value.statuses) ? value.statuses as Row[] : [];
        const messages = Array.isArray(value.messages) ? value.messages as Row[] : [];

        if (statuses.length) {
          for (const status of statuses) {
            const messageId = String(status.id ?? "") || null;
            const state = String(status.status ?? "unknown");
            const stamp = new Date().toISOString();

            await admin.from("whatsapp_webhook_events").insert({
              unit_id: unitId,
              phone_number_id: phoneNumberId,
              waba_id: wabaId,
              message_id: messageId,
              event_type: `status:${state}`,
              payload: { entry, change },
              processed_at: stamp,
            });

            if (messageId) {
              const update: Row = { status: state, updated_at: stamp };
              if (state === "sent") update.sent_at = stamp;
              if (state === "delivered") update.delivered_at = stamp;
              if (state === "read") update.read_at = stamp;
              if (state === "failed") {
                update.failed_at = stamp;
                const errors = Array.isArray(status.errors) ? status.errors : [];
                update.last_error = errors.length ? JSON.stringify(errors[0]).slice(0, 1000) : "Falha informada pelo WhatsApp.";
              }
              await admin.from("message_events").update(update).eq("external_message_id", messageId);
            }
          }
        } else if (messages.length) {
          for (const message of messages) {
            await admin.from("whatsapp_webhook_events").insert({
              unit_id: unitId,
              phone_number_id: phoneNumberId,
              waba_id: wabaId,
              message_id: String(message.id ?? "") || null,
              event_type: "message:received",
              payload: { entry, change },
              processed_at: new Date().toISOString(),
            });
          }
        } else {
          await admin.from("whatsapp_webhook_events").insert({
            unit_id: unitId,
            phone_number_id: phoneNumberId,
            waba_id: wabaId,
            event_type: String(change.field ?? "unknown"),
            payload: { entry, change },
            processed_at: new Date().toISOString(),
          });
        }
      }
    }

    return json({ ok: true }, 200);
  } catch (error) {
    return json({ ok: false, message: error instanceof Error ? error.message : "webhook error" }, 200);
  }
});
