"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const PHONE_NUMBER_ID = "1426521627207345";
const WABA_ID = "1674618824003781";

export default function MetaWhatsappReviewPage() {
  const supabase = getSupabaseBrowserClient();
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState("");
  const [to, setTo] = useState("5515992890414");
   const [sending, setSending] = useState(false);
  const [managementTesting, setManagementTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setReady(Boolean(data.session));
      if (!data.session) setError("Entre no LYVRA antes de abrir esta página.");
    });
  }, [supabase]);

  async function sendTest() {
    setError("");
    setMessage("");
    setSending(true);
    try {
      if (!token.trim()) throw new Error("Cole o novo token temporário da Meta antes de enviar.");
      const { data, error } = await supabase.functions.invoke("whatsapp-meta-review-test", {
        body: { action: "send", to, access_token: token.trim() },
      });
      if (error) {
        let detail = "Não foi possível concluir o teste.";
        if (error.context instanceof Response) {
          const payload = await error.context.clone().json().catch(() => null);
          if (typeof payload?.message === "string") detail = payload.message;
        }
        throw new Error(detail);
      }
      if (!data?.ok) throw new Error(data?.message || "Não foi possível enviar a mensagem.");
      setMessage(
        data.message_id
          ? `Mensagem enviada pela Cloud API. ID: ${data.message_id}`
          : "Mensagem enviada pela Cloud API. Confira o WhatsApp do destinatário.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível enviar a mensagem.");
    } finally {
      setSending(false);
    }
  }

  async function testManagementApi() {
    setError("");
    setMessage("");
    setManagementTesting(true);
    try {
      if (!token.trim()) throw new Error("Cole o novo token temporário da Meta antes de testar.");
      const { data, error } = await supabase.functions.invoke("whatsapp-meta-review-test", {
        body: { action: "management_test", access_token: token.trim() },
      });
      if (error) {
        let detail = "Não foi possível testar a API de gerenciamento.";
        if (error.context instanceof Response) {
          const payload = await error.context.clone().json().catch(() => null);
          if (typeof payload?.message === "string") detail = payload.message;
        }
        throw new Error(detail);
      }
      if (!data?.ok) throw new Error(data?.message || "A chamada de gerenciamento não foi concluída.");
      const names = Array.isArray(data.templates) ? data.templates.map((item: { name?: string }) => item?.name).filter(Boolean) : [];
      setMessage(
        names.length
          ? `API de gerenciamento testada com sucesso. Modelos encontrados: ${names.join(", ")}.`
          : "API de gerenciamento testada com sucesso. A Meta registrou a chamada.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível testar a API de gerenciamento.");
    } finally {
      setManagementTesting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f4f4ef] px-6 py-10 text-[#102b27]">
      <section className="mx-auto max-w-3xl rounded-[30px] border border-black/5 bg-white p-8 shadow-sm sm:p-10">
        <div className="mb-8">
          <span className="inline-flex rounded-full bg-[#dff8eb] px-3 py-1 text-xs font-semibold uppercase tracking-[0.15em] text-[#00884a]">
            Meta App Review
          </span>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">Teste do WhatsApp Cloud API</h1>
          <p className="mt-2 text-sm leading-6 text-black/55">
            Tela interna do LYVRA preparada para a gravação exigida pela Meta.
          </p>
        </div>

        <div className="grid gap-4 rounded-2xl bg-[#f7f8f5] p-5 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-black/45">Phone Number ID</p>
            <p className="mt-1 font-mono text-sm">{PHONE_NUMBER_ID}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-black/45">WhatsApp Business Account ID</p>
            <p className="mt-1 font-mono text-sm">{WABA_ID}</p>
          </div>
        </div>

        <div className="mt-8 space-y-8">
          <section>
            <h2 className="text-lg font-semibold">1. Token temporário da Meta</h2>
            <p className="mt-1 text-sm text-black/55">
              Cole o novo token. Ele fica somente nesta aba do navegador, é enviado por HTTPS no momento do teste e não é salvo no banco do LYVRA.
            </p>
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Cole aqui o NOVO token da Meta"
              autoComplete="off"
              className="mt-4 w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm outline-none focus:border-[#00a86b]"
            />
          </section>

          <section className="border-t border-black/5 pt-8">
            <h2 className="text-lg font-semibold">2. Enviar mensagem de teste</h2>
            <p className="mt-1 text-sm text-black/55">
              Durante o vídeo, mostre esta tela, clique em enviar e depois abra o WhatsApp que receberá a mensagem.
            </p>
            <label className="mt-4 block text-sm font-medium" htmlFor="review-to">
              Destinatário de teste
            </label>
            <input
              id="review-to"
              value={to}
              onChange={(event) => setTo(event.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              className="mt-2 w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm outline-none focus:border-[#00a86b]"
            />
            <button
              type="button"
              onClick={sendTest}
              disabled={!ready || sending}
              className="mt-4 w-full rounded-xl bg-[#13c66b] px-5 py-4 text-base font-semibold text-[#08261e] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? "Enviando..." : "Enviar mensagem de teste pelo LYVRA"}
            </button>
          </section>

          <section className="border-t border-black/5 pt-8">
            <h2 className="text-lg font-semibold">3. Testar whatsapp_business_management</h2>
            <p className="mt-1 text-sm text-black/55">
              Faz uma chamada real e somente de leitura à API oficial da Meta para listar os modelos do WhatsApp Business Account de teste.
            </p>
            <button
              type="button"
              onClick={testManagementApi}
              disabled={!ready || managementTesting}
              className="mt-4 w-full rounded-xl bg-[#102b27] px-5 py-4 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {managementTesting ? "Testando API..." : "Testar API de gerenciamento da Meta"}
            </button>
          </section>

          {message ? (
            <div className="rounded-2xl border border-[#bce8cf] bg-[#edf9f2] px-5 py-4 text-sm text-[#12683d]">
              {message}
            </div>
          ) : null}

          {error ? (
            <div className="rounded-2xl border border-[#f0cbc2] bg-[#fff2ee] px-5 py-4 text-sm text-[#93442f]">
              {error}
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
