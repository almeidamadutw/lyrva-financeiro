"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, LoaderCircle, PhoneCall, ShieldAlert, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const APP_ID = "1609781340894846";
const CONFIG_ID = "986805407042470";
const GRAPH_VERSION = "v25.0";
type UnitCode = "salto_de_pirapora" | "sorocaba";
type FbResponse = { authResponse?: { code?: string } };
type FacebookSDK = {
  init(args: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
  login(callback: (response: FbResponse) => void, args: Record<string, unknown>): void;
};
type SessionInfo = { event: string; waba_id: string; phone_number_id?: string };
type ConnectionInfo = {
  ok?: boolean; ready?: boolean; status?: string; phoneConfigured?: boolean;
  phoneDisplay?: string | null; onboardingStatus?: string | null;
  requiredSetup?: string | null; message?: string;
};

declare global { interface Window { FB?: FacebookSDK } }

const units: { code: UnitCode; label: string }[] = [
  { code: "salto_de_pirapora", label: "Salto de Pirapora" },
  { code: "sorocaba", label: "Sorocaba" },
];

export function WhatsAppEmbeddedSignup() {
  const [sdkReady, setSdkReady] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, ConnectionInfo>>({});
  const [busy, setBusy] = useState<UnitCode | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const codeRef = useRef<string | null>(null);
  const sessionRef = useRef<SessionInfo | null>(null);
  const attemptRef = useRef<UnitCode | null>(null);
  const finishingRef = useRef(false);

  const refresh = useCallback(async () => {
    const sb = getSupabaseBrowserClient();
    await Promise.all(units.map(async (unit) => {
      try {
        const { data, error } = await sb.functions.invoke("whatsapp-embedded-signup", {
          body: { action: "status", unit_code: unit.code },
        });
        if (error) throw error;
        setStatuses(prev => ({ ...prev, [unit.code]: data as ConnectionInfo }));
      } catch {
        setStatuses(prev => ({ ...prev, [unit.code]: {
          ok: false, ready: false, message: "Não foi possível verificar esta unidade.",
        } }));
      }
    }));
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    let active = true;
    const boot = () => {
      if (!active || !window.FB) return;
      window.FB.init({
        appId: APP_ID, autoLogAppEvents: false, xfbml: false, version: GRAPH_VERSION,
      });
      setSdkReady(true);
    };
    const existing = document.querySelector<HTMLScriptElement>("script[data-lyvra-meta-sdk]");
    if (existing) {
      if (window.FB) boot();
      else existing.addEventListener("load", boot, { once: true });
      return () => { active = false; existing.removeEventListener("load", boot); };
    }
    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/pt_BR/sdk.js";
    script.async = true;
    script.dataset.lyvraMetaSdk = "true";
    script.addEventListener("load", boot);
    document.head.appendChild(script);
    return () => { active = false; script.removeEventListener("load", boot); };
  }, []);

  const complete = useCallback(async () => {
    const unitCode = attemptRef.current;
    const code = codeRef.current;
    const session = sessionRef.current;
    if (!unitCode || !code || !session || finishingRef.current) return;
    finishingRef.current = true;
    setNotice("Validando a conta e o número diretamente com a Meta...");
    try {
      const { data, error } = await getSupabaseBrowserClient().functions.invoke("whatsapp-embedded-signup", {
        body: { action: "complete", unit_code: unitCode, code, session },
      });
      if (error || !data?.ok) throw new Error(data?.message || "Não foi possível concluir a conexão.");
      toast.success("Número registrado para testes!", {
        description: String(data.phoneDisplay || "Coexistência confirmada, disparos permanecem bloqueados."),
      });
      setNotice("Conexão identificada. Nenhum lembrete será enviado até o teste interno e a aprovação.");
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "A Meta não confirmou a conexão.";
      setNotice(message);
      toast.error("WhatsApp ainda não conectado", { description: message });
    } finally {
      codeRef.current = null;
      sessionRef.current = null;
      attemptRef.current = null;
      finishingRef.current = false;
      setBusy(null);
    }
  }, [refresh]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!["https://www.facebook.com", "https://web.facebook.com"].includes(event.origin)) return;
      if (!attemptRef.current) return;
      let message: unknown = event.data;
      if (typeof message === "string") {
        try { message = JSON.parse(message); } catch { return; }
      }
      if (!message || typeof message !== "object") return;
      const item = message as { type?: string; event?: string; data?: Record<string, unknown> };
      if (item.type !== "WA_EMBEDDED_SIGNUP") return;
      if (item.event === "CANCEL") {
        setNotice("Cadastro cancelado. Nenhum número foi ativado no LYRVA.");
        attemptRef.current = null;
        setBusy(null);
        return;
      }
      if (item.event !== "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING") {
        if (item.event === "FINISH") {
          setNotice("A Meta concluiu o cadastro comum, mas não confirmou coexistência. Nenhum número foi ativado no LYRVA.");
          attemptRef.current = null;
          setBusy(null);
        }
        return;
      }
      const wabaId = item.data?.waba_id;
      if (typeof wabaId !== "string" || !/^\d+$/.test(wabaId)) return;
      const numberId = item.data?.phone_number_id;
      sessionRef.current = { event: item.event, waba_id: wabaId,
        ...(typeof numberId === "string" ? { phone_number_id: numberId } : {}) };
      void complete();
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [complete]);

  function launch(code: UnitCode) {
    if (!sdkReady || !window.FB || !statuses[code]?.ready || busy) return;
    codeRef.current = null;
    sessionRef.current = null;
    finishingRef.current = false;
    attemptRef.current = code;
    setBusy(code);
    setNotice("Na janela da Meta, escolha manter o WhatsApp Business no celular. Não selecione migração ou exclusão.");
    // The SDK login is invoked directly from the click event so browsers allow the popup.
    window.FB.login((response) => {
      const codeValue = response?.authResponse?.code;
      if (!attemptRef.current) return;
      if (!codeValue) {
        setBusy(null);
        attemptRef.current = null;
        setNotice("A janela foi fechada ou o cadastro foi interrompido. Nada foi salvo.");
        return;
      }
      codeRef.current = codeValue;
      void complete();
    }, {
      config_id: CONFIG_ID,
      response_type: "code",
      override_default_response_type: true,
      extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" },
    });
  }

  return (
    <section className="surface-card rounded-[24px] p-5 md:p-6">
      <div className="flex items-start gap-3">
        <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[#e7f7ee] text-[#00884a]"><Smartphone /></div>
        <div>
          <p className="eyebrow">WHATSAPP BUSINESS · META CLOUD API</p>
          <h2 className="font-display mt-2 text-xl font-semibold text-[#192820]">Conectar números das clínicas</h2>
          <p className="mt-1 text-sm leading-6 text-[#718078]">
            Cadastro Incorporado v4 com preferência por coexistência. Se a Meta não confirmar
            a manutenção do WhatsApp Business no celular, o LYRVA não ativa a conexão.
          </p>
        </div>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {units.map(unit => {
          const info = statuses[unit.code];
          const registered = Boolean(info?.phoneConfigured);
          const canStart = Boolean(info?.ready && sdkReady && !busy);
          return (
            <article key={unit.code} className="rounded-2xl border border-[#dde8e0] bg-[#fafbf9] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold text-[#223c2b]">{unit.label}</h3>
                <span className={\`rounded-full px-2.5 py-1 text-xs font-medium \${registered ? "bg-[#e4f5e9] text-[#24663b]" : "bg-[#fff1d8] text-[#91631a]"}\`}>
                  {registered ? "Vinculado · testes pendentes" : "Aguardando conexão"}
                </span>
              </div>
              <p className="mt-3 text-xs leading-5 text-[#64766a]">
                {registered ? \`Número: \${info?.phoneDisplay || "verificado na Meta"}\` : "Nenhum número foi associado a esta unidade."}
              </p>
              {!info?.ready && (
                <p className="mt-2 text-xs leading-5 text-[#91631a]">
                  {info?.requiredSetup || info?.message || "Verificando configurações do servidor..."}
                </p>
              )}
              <Button disabled={!canStart} onClick={() => launch(unit.code)} className="mt-4 w-full rounded-xl">
                {busy === unit.code ? <LoaderCircle className="animate-spin" /> : <PhoneCall />}
                {busy === unit.code ? "Aguardando Meta..." : registered ? "Reconectar pelo Facebook" : "Conectar WhatsApp Business"}
              </Button>
            </article>
          );
        })}
      </div>
      {notice && <p role="status" className="mt-4 rounded-xl bg-[#f4f8f1] p-3 text-sm text-[#31583d]">{notice}</p>}
      <p className="mt-4 flex items-center gap-2 text-xs leading-5 text-[#69796e]">
        <ShieldAlert className="size-4 shrink-0" /> Nenhum disparo automático é ativado nesta etapa. O primeiro teste será feito somente com contato interno.
      </p>
      {Object.values(statuses).some(s => s?.phoneConfigured) && <p className="mt-2 flex items-center gap-2 text-xs text-[#337d4d]"><CheckCircle2 className="size-4" /> O vínculo foi salvo de forma protegida. O envio de lembretes continua desabilitado.</p>}
    </section>
  );
}
