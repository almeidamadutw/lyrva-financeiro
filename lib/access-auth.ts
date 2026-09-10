import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Session } from "@supabase/supabase-js";
export async function accessAuth(body: Record<string, unknown>): Promise<{ ok: boolean; session?: Session }> {
  const { data, error } = await getSupabaseBrowserClient().functions.invoke("access-auth", { body });
  if (error) {
    let message = "Não foi possível conectar. Tente novamente em instantes.";
    if (error.context instanceof Response) {
      const response = await error.context.json().catch(() => null);
      if (typeof response?.message === "string") message = response.message;
    }
    throw new Error(message);
  }
  if (!data?.ok) throw new Error(data?.message ?? "Não foi possível concluir esta solicitação.");
  return data;
}
