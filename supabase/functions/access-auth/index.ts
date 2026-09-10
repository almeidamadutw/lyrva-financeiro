import { createClient } from "@supabase/supabase-js";
import { normalizeUsername, corsHeaders, json, hashKey } from "../_shared/access.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ ok: false, message: "Método não permitido." }, 405);
  try {
    const body = await request.json();
    const username = normalizeUsername(body.username);
    const action = body.action;
    if (!username || !["login", "verify", "recover"].includes(action)) return json({ ok: false, message: "Confira o usuário informado." }, 400);
    if (action === "verify" && (!/^\d{8}$/.test(body.code) || !["invite", "recovery"].includes(body.type) || typeof body.password !== "string" || body.password.length < 8 || body.password.length > 128)) {
      return json({ ok: false, message: "Confira o código e use uma senha de 8 a 128 caracteres." }, 400);
    }
    if (action === "login" && (typeof body.password !== "string" || body.password.length > 128)) return json({ ok: false, message: "Usuário ou senha inválidos." }, 400);
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
    const client = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { data: allowed, error: limitError } = await admin.rpc("consume_access_attempt", {
      p_key: await hashKey(`${action}:${username}`), p_limit: action === "recover" ? 3 : action === "verify" ? 6 : 10,
    });
    if (limitError) return json({ ok: false, message: "Serviço temporariamente indisponível." }, 503);
    if (!allowed) return json({ ok: false, message: "Muitas tentativas. Aguarde 15 minutos antes de tentar novamente." }, 429);
    const { data: profile, error: lookupError } = await admin.from("profiles").select("user_id, email, is_active").eq("username", username).maybeSingle();
    if (lookupError) return json({ ok: false, message: "Serviço temporariamente indisponível." }, 503);
    if (action === "recover") {
      if (profile?.is_active) {
        const { error } = await client.auth.resetPasswordForEmail(profile.email);
        if (error) return json({ ok: false, message: "Não foi possível enviar agora. Aguarde alguns minutos e tente novamente." }, 502);
      }
      return json({ ok: true });
    }
    if (!profile?.is_active) return json({ ok: false, message: action === "login" ? "Usuário ou senha inválidos." : "Código inválido ou expirado. Solicite outro em Recuperar acesso." }, 400);
    if (action === "login") {
      const { data, error } = await client.auth.signInWithPassword({ email: profile.email, password: body.password });
      if (error || !data.session) return json({ ok: false, message: "Usuário ou senha inválidos." }, 400);
      return json({ ok: true, session: data.session });
    }
    // Verify and change using a short-lived client. Never return the OTP session.
    const { data, error } = await client.auth.verifyOtp({ email: profile.email, token: body.code, type: body.type });
    if (error || !data.session || data.user?.id !== profile.user_id) return json({ ok: false, message: "Código inválido ou expirado. Solicite outro em Recuperar acesso." }, 400);
    const { error: updateError } = await client.auth.updateUser({ password: body.password });
    const { error: signoutError } = await client.auth.signOut({ scope: "global" });
    if (updateError) return json({ ok: false, message: "O código foi validado, mas a senha não foi aceita. Solicite outro código e escolha uma senha mais forte." }, 400);
    if (signoutError) return json({ ok: false, message: "Sua senha foi salva, mas não foi possível encerrar as sessões anteriores. Entre em contato com o suporte." }, 503);
    return json({ ok: true });
  } catch {
    return json({ ok: false, message: "Não foi possível concluir a solicitação." }, 500);
  }
});
