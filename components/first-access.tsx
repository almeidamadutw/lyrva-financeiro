"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  MailCheck,
  ShieldCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LYVRA_ICON_DATA_URL } from "@/lib/lyrva-icon-data";

type Step = "token" | "password" | "success";

const accessDraftKey = "lyvra-first-access-preview-v1";

function Brand() {
  return (
    <header className="login-brand" aria-label="LYVRA Inteligência Financeira">
      <div className="login-logo" aria-hidden="true"><img src={LYVRA_ICON_DATA_URL} alt="" /></div>
      <p className="font-display text-[30px] font-semibold leading-none tracking-[0.24em] text-[#102d23]">LYVRA</p>
      <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#6f7e75]">Inteligência financeira</p>
    </header>
  );
}

function PasswordField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-sm font-semibold text-[#33473c]">{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Mínimo de 8 caracteres"
          className="h-12 rounded-xl border-[#dce4de] bg-[#fbfcfa] px-4 pr-12 shadow-none focus-visible:ring-[#00BF63]"
          minLength={8}
          required
        />
        <Button type="button" variant="ghost" size="icon-sm" onClick={() => setVisible((current) => !current)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg text-[#7d8a82] hover:bg-[#eef4ef] hover:text-[#183b32]" aria-label={visible ? "Ocultar senha" : "Mostrar senha"}>
          {visible ? <EyeOff /> : <Eye />}
        </Button>
      </div>
    </div>
  );
}

export function FirstAccess() {
  const [step, setStep] = useState<Step>("token");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get("token") ?? "");
    setEmail(params.get("email") ?? "");
  }, []);

  const validateToken = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.endsWith("@lyvrafinanceiro.com.br")) {
      setError("Use o e-mail corporativo recebido no convite.");
      return;
    }
    if (token.trim().length < 6) {
      setError("Informe o token enviado no seu convite de primeiro acesso.");
      return;
    }
    setError("");
    setStep("password");
  };

  const createPassword = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password.length < 8) {
      setError("Sua senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    if (password !== confirmation) {
      setError("As senhas não coincidem. Confira e tente novamente.");
      return;
    }
    window.localStorage.setItem(accessDraftKey, JSON.stringify({ email, activatedAt: new Date().toISOString() }));
    setError("");
    setStep("success");
  };

  return (
    <main className="login-shell">
      <div className="login-grid" aria-hidden="true" />
      <div className="login-glow" aria-hidden="true" />
      <section className="login-access">
        <Brand />

        <div className="login-ribbon" aria-label="Ativação protegida">
          <ShieldCheck className="size-3.5 text-[#00a958]" />
          <span>Ativação protegida</span>
        </div>

        <div className="login-card">
          {step !== "success" && (
            <div className="mb-7 flex items-center gap-2" aria-label={`Etapa ${step === "token" ? "1" : "2"} de 2`}>
              <span className="h-1.5 flex-1 rounded-full bg-[#00BF63]" />
              <span className={`h-1.5 flex-1 rounded-full ${step === "password" ? "bg-[#00BF63]" : "bg-[#e2e8e3]"}`} />
              <span className="ml-2 text-[10px] font-bold uppercase tracking-[.12em] text-[#89958e]">{step === "token" ? "1 de 2" : "2 de 2"}</span>
            </div>
          )}

          {step === "token" && (
            <>
              <div className="text-center">
                <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-[#e4f8ee] text-[#00884a]"><MailCheck className="size-5" /></div>
                <p className="eyebrow mt-5">PRIMEIRO ACESSO</p>
                <h1 className="font-display mt-3 text-3xl font-semibold tracking-tight text-[#172a21]">Ative sua conta</h1>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#75827a]">Use o e-mail corporativo e o token recebidos no seu convite.</p>
              </div>

              <form className="mt-8 space-y-5" onSubmit={validateToken}>
                <div className="space-y-2">
                  <Label htmlFor="access-email" className="text-sm font-semibold text-[#33473c]">E-mail corporativo</Label>
                  <Input id="access-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value.toLowerCase())} placeholder="nome@lyvrafinanceiro.com.br" className="h-12 rounded-xl border-[#dce4de] bg-[#fbfcfa] px-4 shadow-none focus-visible:ring-[#00BF63]" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="access-token" className="text-sm font-semibold text-[#33473c]">Token de acesso</Label>
                  <div className="relative">
                    <KeyRound className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#849188]" />
                    <Input id="access-token" value={token} onChange={(event) => setToken(event.target.value.toUpperCase())} placeholder="Ex.: LYVRA-7K9P2M" className="h-12 rounded-xl border-[#dce4de] bg-[#fbfcfa] pl-11 pr-4 font-mono uppercase tracking-[.08em] shadow-none focus-visible:ring-[#00BF63]" required />
                  </div>
                </div>
                {error && <p className="rounded-xl bg-[#fae8e3] px-4 py-3 text-sm text-[#934e3f]" role="alert">{error}</p>}
                <Button type="submit" className="h-12 w-full rounded-xl bg-[#00BF63] font-bold text-[#10221f] shadow-none hover:bg-[#00d56e]">Validar convite <ChevronRight /></Button>
              </form>
            </>
          )}

          {step === "password" && (
            <>
              <button type="button" onClick={() => { setStep("token"); setError(""); }} className="mb-5 inline-flex items-center gap-2 text-xs font-semibold text-[#6f7d74] transition hover:text-[#183b32]"><ArrowLeft className="size-3.5" /> Corrigir convite</button>
              <div className="text-center">
                <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-[#e4f8ee] text-[#00884a]"><LockKeyhole className="size-5" /></div>
                <p className="eyebrow mt-5">CONVITE VALIDADO</p>
                <h1 className="font-display mt-3 text-3xl font-semibold tracking-tight text-[#172a21]">Crie sua senha</h1>
                <p className="mx-auto mt-2 max-w-sm truncate text-sm leading-6 text-[#75827a]">Conta: <strong className="font-semibold text-[#405148]">{email}</strong></p>
              </div>

              <form className="mt-8 space-y-5" onSubmit={createPassword}>
                <PasswordField id="access-password" label="Nova senha" value={password} onChange={setPassword} />
                <PasswordField id="access-confirmation" label="Confirmar senha" value={confirmation} onChange={setConfirmation} />
                <div className="grid grid-cols-2 gap-2 text-xs text-[#6c7a72]">
                  <span className="flex items-center gap-1.5"><Check className="size-3.5 text-[#00a958]" /> 8 caracteres</span>
                  <span className="flex items-center gap-1.5"><Check className="size-3.5 text-[#00a958]" /> Uso individual</span>
                </div>
                {error && <p className="rounded-xl bg-[#fae8e3] px-4 py-3 text-sm text-[#934e3f]" role="alert">{error}</p>}
                <Button type="submit" className="h-12 w-full rounded-xl bg-[#00BF63] font-bold text-[#10221f] shadow-none hover:bg-[#00d56e]">Criar acesso <ShieldCheck /></Button>
              </form>
            </>
          )}

          {step === "success" && (
            <div className="py-2 text-center">
              <div className="mx-auto grid size-16 place-items-center rounded-[22px] bg-[#e4f8ee] text-[#00884a]"><CheckCircle2 className="size-7" /></div>
              <p className="eyebrow mt-6">TUDO CERTO</p>
              <h1 className="font-display mt-3 text-3xl font-semibold tracking-tight text-[#172a21]">Conta ativada</h1>
              <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[#75827a]">Seu primeiro acesso foi concluído. Agora você já pode entrar no LYVRA.</p>
              <Button asChild className="mt-8 h-12 w-full rounded-xl bg-[#00BF63] font-bold text-[#10221f] shadow-none hover:bg-[#00d56e]"><a href="/">Ir para o login <ChevronRight /></a></Button>
            </div>
          )}

          <div className="mt-7 rounded-xl border border-[#e7ece8] bg-[#f8faf7] px-4 py-3 text-center">
            <p className="text-[11px] leading-5 text-[#849087]">Fluxo demonstrativo nesta versão. A validação segura do token será conectada quando o banco de dados for ativado.</p>
          </div>
        </div>

        <a href="/" className="login-footer inline-flex items-center gap-2 transition hover:text-[#53645a]"><ArrowLeft className="size-3.5" /> Voltar para o login</a>
      </section>
    </main>
  );
}
