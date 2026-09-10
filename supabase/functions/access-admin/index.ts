import { createClient } from "@supabase/supabase-js";
import { normalizeUsername, canManage, corsHeaders, json, hashKey } from "../_shared/access.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ ok: false, message: "Método não permitido." }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
    const client = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
    const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ ok: false, message: "Entre novamente no sistema." }, 401);
    const { data: { user }, error: userError } = await client.auth.getUser(token);
    if (userError || !user) return json({ ok: false, message: "Sessão inválida." }, 401);
    // getUser verifies the JWT; a session lookup also rejects revoked sessions.
    const claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    const { data: activeSession, error: sessionError } = await admin.rpc("access_session_active", { p_session_id: claims.session_id, p_user_id: user.id });
    if (sessionError || !activeSession) return json({ ok: false, message: "Sua sessão expirou. Entre novamente." }, 401);
    const { data: actor } = await admin.from("profiles").select("role,is_active").eq("user_id", user.id).single();
    if (!actor?.is_active || !["gestora", "ceo", "suporte"].includes(actor.role)) return json({ ok: false, message: "Você não possui permissão para gerenciar acessos." }, 403);
    const { data: actorUnits, error: actorUnitsError } = await admin.from("profile_units").select("unit_id").eq("user_id", user.id);
    if (actorUnitsError) throw actorUnitsError;
    const allowedIds = new Set<number>((actorUnits ?? []).map(row => row.unit_id));
    const { data: allUnits, error: unitsError } = await admin.from("units").select("id,code,name,access_recovery_email").eq("is_active", true).order("name");
    if (unitsError) throw unitsError;
    const units = actor.role === "gestora" ? (allUnits ?? []).filter(unit => allowedIds.has(unit.id)) : (allUnits ?? []);
    const body = await request.json();
    const action = body.action ?? "list";
    if (action === "list") {
      const { data: profiles, error } = await admin.from("profiles").select("user_id,username,full_name,role,is_active,recovery_unit_id,profile_units(unit_id)").order("full_name");
      if (error) throw error;
      return json({ ok: true, units, profiles: (profiles ?? []).filter(p => canManage(actor.role, user.id, p, allowedIds, p.profile_units.map(pu => pu.unit_id))) });
    }
    const username = normalizeUsername(body.username);
    if (!username || !["invite", "recover"].includes(action)) return json({ ok: false, message: "Dados do acesso inválidos." }, 400);
    const { data: allowed, error: rateError } = await admin.rpc("consume_access_attempt", { p_key: await hashKey(`admin:${action}:${user.id}:${username}`), p_limit: 3 });
    if (rateError) throw rateError;
    if (!allowed) return json({ ok: false, message: "Aguarde 15 minutos antes de solicitar novamente." }, 429);
    if (action === "recover") {
      const { data: target, error } = await admin.from("profiles").select("user_id,email,role,is_active,recovery_unit_id,profile_units(unit_id)").eq("username", username).maybeSingle();
      if (error) throw error;
      if (!target?.is_active || !canManage(actor.role, user.id, target, allowedIds, target.profile_units.map(pu => pu.unit_id))) return json({ ok: false, message: "Você não pode recuperar este acesso." }, 403);
      const { error: sendError } = await client.auth.resetPasswordForEmail(target.email);
      if (sendError) return json({ ok: false, message: "Não foi possível enviar o código agora." }, 502);
      const unitId = target.recovery_unit_id ?? target.profile_units[0]?.unit_id;
      const { error: auditError } = await admin.from("access_management_events").insert({ action: "recovery", target_user_id: target.user_id, target_username: username, unit_id: unitId, requested_by: user.id });
      return json({ ok: true, message: auditError ? "Código enviado. O registro de auditoria precisa de revisão pelo suporte." : "Código enviado ao e-mail responsável pelo acesso." });
    }
    const role = body.role ?? "membro";
    const fullName = String(body.fullName ?? "").trim();
    const unitCodes = Array.isArray(body.unitCodes) ? [...new Set<string>(body.unitCodes.map(String))] : [];
    const selectedUnits = units.filter(u => unitCodes.includes(u.code));
    const recoveryUnit = selectedUnits.find(u => u.code === body.unitCode);
    if (fullName.length < 2 || fullName.length > 120 || !["membro", "gestora", "ceo"].includes(role) || username === "suporte" || (actor.role === "gestora" && role !== "membro")) return json({ ok: false, message: "Você não pode criar este tipo de acesso." }, 403);
    if (!recoveryUnit?.access_recovery_email || selectedUnits.length !== unitCodes.length || !selectedUnits.length) return json({ ok: false, message: "Escolha as unidades liberadas e uma delas para receber o código." }, 400);
    const email = recoveryUnit.access_recovery_email.replace("@", `+${username}@`);
    const { data: invitation, error: insertError } = await admin.from("staff_invitations").insert({ email, full_name: fullName, role, username, recovery_unit_id: recoveryUnit.id, invited_by: user.id, status: "pending", expires_at: new Date(Date.now()+7*86400000).toISOString() }).select("id").single();
    if (insertError || !invitation) return json({ ok: false, message: insertError?.code === "23505" ? "Este usuário já possui um cadastro ou convite. Use a recuperação se já estiver cadastrado." : "Não foi possível preparar o convite." }, 400);
    const { error: assignmentError } = await admin.from("staff_invitation_units").insert(selectedUnits.map(unit => ({ invitation_id: invitation.id, unit_id: unit.id })));
    if (assignmentError) {
      await admin.from("staff_invitations").delete().eq("id", invitation.id).eq("status", "pending");
      throw assignmentError;
    }
    const { data: created, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, { data: { username } });
    if (inviteError || !created.user) {
      // Preserve any created Auth account on ambiguous SMTP errors. Only remove an
      // unconsumed invitation so a transient failure can be retried.
      await admin.from("staff_invitations").delete().eq("id", invitation.id).eq("status", "pending");
      return json({ ok: false, message: "O convite não foi confirmado. Atualize a lista; se o acesso aparecer, use Recuperar senha. Caso contrário, tente cadastrar novamente." }, 502);
    }
    const { error: auditError } = await admin.from("access_management_events").insert({ action: "invite", target_user_id: created.user.id, target_username: username, unit_id: recoveryUnit.id, requested_by: user.id });
    return json({ ok: true, message: auditError ? "Convite enviado. O registro de auditoria precisa de revisão pelo suporte." : `Convite enviado à caixa de ${recoveryUnit.name}.` });
  } catch {
    return json({ ok: false, message: "Não foi possível concluir a operação. Tente novamente em instantes." }, 500);
  }
});
