export const normalizeUsername = (value: unknown) => {
  if (typeof value !== "string") return "";
  const candidate = value.trim().toLowerCase().replace(/@lyvrafinanceiro$/, "");
  return /^[a-z0-9][a-z0-9._-]{2,39}$/.test(candidate) ? candidate : "";
};
export const canManage = (role: string, actorId: string, target: { user_id: string; role: string }, allowed: Set<number>, targetUnits: number[]) => {
  if (target.role === "suporte") return role === "suporte" && actorId === target.user_id;
  if (role === "suporte" || role === "ceo") return true;
  return role === "gestora" && target.role === "membro" && targetUnits.length > 0 && targetUnits.every(id => allowed.has(id));
};
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
});
export async function hashKey(value: string) {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, "0")).join("");
}
