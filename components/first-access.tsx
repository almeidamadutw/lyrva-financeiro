"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  MailCheck,
  ShieldCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LYVRA_ICON_DATA_URL } from "@/lib/lyrva-icon-data";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);

  const createAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail.endsWith("@lyvrafinanceiro.com.br")) {
      setError("Use o e-mail corporativo autorizado pela LYRVA.");
      return;
    }
    if (password.length < 8) {
      setError("Sua senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    if (password !== confirmation) {
      setError("As senhas não coincidem. Confira e tente novamente.");
      return;
    }

    setLoading(true);
    setError("");
    const { data, error: signUpError } = await getSupabaseBrowserClient().auth.signUp({
      email: normalizedEmail,
      password,
    });
    setLoading(false);

    if (signUpError) {
      const message = signUpError.message.toLowerCase();
      if (message.includes("already") || message.includes("registered")) {
        setError("Este e-mail já possui uma conta. Volte ao login para entrar.");
      } else {
        setError("Este e-mail não possui um convite ativo ou não pôde ser cadastrado.");
      }
      return;
    }

    setNeedsConfirmation(!data.session);
    setComplete(true);
  };

  return (
    <main className="login-shell">
      <div className="login-grid" aria-hidden="true" />
      <div className="login-glow" aria-hidden="true" />
      <section className="login-access">
        <Brand />

        <div className="login-ribbon" aria-label="Ativação protegida">
          <ShieldCheck className="size-3.5 text-[#00a958]" />
          <span>Ativação protegida pelo convite</span>
        </div>

        <div className="login-card">
          {!complete ? (
            <>
              <div className="text-center">
                <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-[#e4f8ee] text-[#00884a]"><LockKeyhole className="size-5" /></div>
                <p className="eyebrow mt-5">PRIMEIRO ACESSO</p>
                <h1 className="font-display mt-3 text-3xl font-semibold tracking-tight text-[#172a21]">Crie sua conta</h1>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#75827a]">Use o e-mail corporativo que foi autorizado para você no LYVRA.</p>
              </div>

              <form className="mt-8 space-y-5" onSubmit={createAccount}>
                <div className="space-y-2">
                  <Label htmlFor="access-email" className="text-sm font-semibold text-[#33473c]">E-mail corporativo</Label>
                  <div className="relative">
                    <MailCheck className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#849188]" />
                    <Input id="access-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value.toLowerCase())} placeholder="nome@lyvrafinanceiro.com.br" className="h-12 rounded-xl border-[#dce4de] bg-[#fbfcfa] pl-11 pr-4 shadow-none focus-visible:ring-[#00BF63]" required />
                  </div>
                </div>
                <PasswordField id="access-password" label="Nova senha" value={password} onChange={setPassword} />
                <PasswordField id="access-confirmation" label="Confirmar senha" value={confirmation} onChange={setConfirmation} />
                <div className="grid grid-cols-2 gap-2 text-xs text-[#6c7a72]">
                  <span className="flex items-center gap-1.5"><Check className="size-3.5 text-[#00a958]" /> 8 caracteres</span>
                  <span className="flex items-center gap-1.5"><Check className="size-3.5 text-[#00a958]" /> Uso individual</span>
                </div>
                {error && <p className="rounded-xl bg-[#fae8e3] px-4 py-3 text-sm text-[#934e3f]" role="alert">{error}</p>}
                <Button type="submit" disabled={loading} className="h-12 w-full rounded-xl bg-[#00BF63] font-bold text-[#10221f] shadow-none hover:bg-[#00d56e]">{loading ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />} {loading ? "Criando acesso…" : "Criar acesso"}</Button>
              </form>
            </>
          ) : (
            <div className="py-2 text-center">
              <div className="mx-auto grid size-16 place-items-center rounded-[22px] bg-[#e4f8ee] text-[#00884a]"><CheckCircle2 className="size-7" /></div>
              <p className="eyebrow mt-6">TUDO CERTO</p>
              <h1 className="font-display mt-3 text-3xl font-semibold tracking-tight text-[#172a21]">Conta criada</h1>
              <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[#75827a]">{needsConfirmation ? "Enviamos uma confirmação para o seu e-mail. Confirme antes de entrar." : "Seu perfil e suas unidades já estão vinculados à base do LYVRA."}</p>
              <Button asChild className="mt-8 h-12 w-full rounded-xl bg-[#00BF63] font-bold text-[#10221f] shadow-none hover:bg-[#00d56e]"><Link href="/">Ir para o LYVRA <ChevronRight /></Link></Button>
            </div>
          )}
        </div>

        <Link href="/" className="login-footer inline-flex items-center gap-2 transition hover:text-[#53645a]"><ArrowLeft className="size-3.5" /> Voltar para o login</Link>
      </section>
    </main>
  );
}
