"use client";
import { useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, LoaderCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { accessAuth } from "@/lib/access-auth";

function PasswordField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  const [visible, setVisible] = useState(false);
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><div className="relative">
    <Input id={id} type={visible ? "text" : "password"} value={value} onChange={e => onChange(e.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required className="h-12 pr-12" />
    <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1" aria-label={visible ? "Ocultar senha" : "Mostrar senha"} onClick={() => setVisible(v => !v)}>{visible ? <EyeOff /> : <Eye />}</Button>
  </div></div>;
}
export function AboveframeBrand() {
  return <div className="aboveframe-brand"><Image src="/brand/aboveframe-inverse.png" alt="Logo Aboveframe" width={780} height={1014} unoptimized /><div><span>ABOVEFRAME</span><small>SUPORTE</small></div></div>;
}
function AccessCodePage({ recovery = false }: { recovery?: boolean }) {
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(""); setNotice("");
    if (!/^\d{8}$/.test(code)) return setError("Preencha os oito números do código recebido.");
    if (password.length < 8) return setError("Use uma senha com pelo menos 8 caracteres.");
    if (password !== confirmation) return setError("As senhas não coincidem. Confira e tente novamente.");
    setBusy(true);
    try {
      await accessAuth({ action: "verify", username, code, password, type: recovery ? "recovery" : "invite" });
      setPassword(""); setConfirmation(""); setCode(""); setComplete(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível concluir. Tente novamente."); }
    finally { setBusy(false); }
  };
  const requestCode = async () => {
    setError(""); setNotice("");
    if (!username.trim()) return setError("Informe seu usuário para solicitar o código.");
    setBusy(true);
    try {
      await accessAuth({ action: "recover", username });
      setNotice("Se o acesso estiver cadastrado e ativo, enviaremos um código ao e-mail responsável. Confira também o spam.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível solicitar o código agora."); }
    finally { setBusy(false); }
  };
  return <main className="aboveframe-access"><div className="aboveframe-access-wrap">
    <header className="aboveframe-top"><AboveframeBrand /><span className="aboveframe-product">LYRVA <span>FINANCEIRO</span></span></header>
    <section className="aboveframe-panel" aria-labelledby="access-title">
      <aside className="aboveframe-welcome"><span className="aboveframe-label">{recovery ? "CUIDANDO DO SEU ACESSO" : "UM NOVO COMEÇO"}</span>
        <h1 id="access-title">{recovery ? <>Vamos abrir<br /> essa porta<br /><em>de novo.</em></> : <>Seu lugar na<br /> LYRVA está<br /><em>pronto.</em></>}</h1>
        <p>{recovery ? "Recupere seu acesso e continue de onde parou. A Aboveframe está com você." : "Boas-vindas a uma rotina com mais clareza e organização. É bom ter você por aqui."}</p>
        <div className="aboveframe-trust"><ShieldCheck aria-hidden="true" /><span>Seu acesso é pessoal.<br />Seu código, de uso único.</span></div>
      </aside>
      <div className="aboveframe-form">{complete ? <div className="aboveframe-success" role="status"><span><Check /></span><p className="aboveframe-label">TUDO CERTO</p><h2>{recovery ? "Senha atualizada." : "Agora é com você."}</h2><p>Seu acesso está pronto. Entre com seu usuário e a senha que acabou de criar.</p><Button asChild className="aboveframe-submit"><Link href="/">Entrar na LYRVA <ArrowRight /></Link></Button></div> : <>
        <div className="aboveframe-step">01 <span /> {recovery ? "RECUPERAR ACESSO" : "ATIVAR ACESSO"}</div>
        <h2>{recovery ? "Uma nova senha." : "Vamos começar?"}</h2>
        <p className="aboveframe-intro">{recovery ? "Solicite um código ou use o que já recebeu no e-mail responsável pelo seu acesso." : "Informe seu usuário e o código do convite. Depois, escolha uma senha só sua."}</p>
        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-2"><Label htmlFor="access-user">Seu usuário</Label><Input id="access-user" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="nome@lyvrafinanceiro" maxLength={100} required className="h-12" /></div>
          <div className="space-y-3"><Label htmlFor="access-code">{recovery ? "Código de recuperação" : "Código de ativação"}</Label><InputOTP id="access-code" value={code} onChange={setCode} maxLength={8} pattern="^[0-9]*$" autoComplete="one-time-code" inputMode="numeric" aria-describedby="code-help"><InputOTPGroup className="aboveframe-code-group">{Array.from({ length: 8 }, (_, i) => <InputOTPSlot key={i} index={i} className="aboveframe-code-slot" />)}</InputOTPGroup></InputOTP><p id="code-help" className="aboveframe-help">Válido por 15 minutos. Pode ser usado uma única vez.</p></div>
          <PasswordField id="access-password" label="Nova senha" value={password} onChange={setPassword} />
          <PasswordField id="access-confirm" label="Confirmar nova senha" value={confirmation} onChange={setConfirmation} />
          <p className="aboveframe-help">Use pelo menos 8 caracteres, combinando letras e números.</p>
          {error && <p role="alert" className="aboveframe-error">{error}</p>}{notice && <p role="status" className="aboveframe-notice">{notice}</p>}
          <Button type="submit" disabled={busy} className="aboveframe-submit">{busy ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}{busy ? "Aguarde…" : recovery ? "Salvar nova senha" : "Ativar meu acesso"}</Button>
        </form><div className="aboveframe-form-footer">{recovery ? <Button variant="link" type="button" disabled={busy} onClick={() => void requestCode()}>Solicitar novo código</Button> : <Link href="/nova-senha">O convite expirou? Solicitar um novo código</Link>}</div>
      </>}</div>
    </section><footer className="aboveframe-footer"><Link href="/"><ArrowLeft size={16} /> Voltar para o login</Link><a href="mailto:suporteaboveframe@gmail.com">Precisa de ajuda? Fale com a Aboveframe</a></footer>
  </div></main>;
}
export function ActivateAccess() { return <AccessCodePage />; }
export function SetNewPassword() { return <AccessCodePage recovery />; }
