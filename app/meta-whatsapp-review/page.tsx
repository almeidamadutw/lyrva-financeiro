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
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [tokenSaved, setTokenSaved] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setReady(Boolean(data.session));
      if (!data.session) setError("Entre no LYVRA antes de abrir esta página.");
    });
  }, [supabase]);

  async function saveToken() {
    setError("");
    setMessage("");
    if (!token.trim()) {
      setError("Cole o novo token temporário gerado pela Meta.");
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-meta-review-test", {
        body: { action: "save_token", access_token: token.trim() },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.message || "Não foi possível salvar o token.");
      setToken("");
      setTokenSaved(true);
      setMessage("Token salvo com segurança no servidor. Ele não será exibido no vídeo.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar o token.");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setError("");
    setMessage("");
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-meta-review-test", {
        body: { action: "send", to },
      });
      if (error) throw error;
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
            <h2 className="text-lg font-semibold">1. Salvar novo token temporário</h2>
            <p className="mt-1 text-sm text-black/55">
              Faça isso antes de começar a gravação. O token fica somente no servidor e some deste campo após salvar.
            </p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="Cole aqui o NOVO token da Meta"
                autoComplete="off"
                className="min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-4 py-3 text-sm outline-none focus:border-[#00a86b]"
              />
              <button
                type="button"
                onClick={saveToken}
                disabled={!ready || saving}
                className="rounded-xl bg-[#102b27] px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? "Salvando..." : tokenSaved ? "Token salvo" : "Salvar token"}
              </button>
            </div>
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
