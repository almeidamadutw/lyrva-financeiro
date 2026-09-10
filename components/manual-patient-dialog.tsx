"use client";

import { useState, type FormEvent } from "react";
import { LoaderCircle, Plus, ReceiptText } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Props = { onSaved: () => Promise<void> | void };

const moneyToCents = (value: string) => {
  const cleaned = value.trim().replace(/R\$/gi, "").replace(/\s/g, "");
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  const parsed = Number(normalized.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
};

export function ManualPatientDialog({ onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [cpf, setCpf] = useState("");
  const [phone, setPhone] = useState("");
  const [unit, setUnit] = useState("");
  const [treatment, setTreatment] = useState("");
  const [totalValue, setTotalValue] = useState("");
  const [installments, setInstallments] = useState("1");
  const [firstDueDate, setFirstDueDate] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"Cartão" | "Boleto">("Boleto");
  const [invoiceMode, setInvoiceMode] = useState<"automatic" | "manual">("automatic");
  const [firstInvoiceDate, setFirstInvoiceDate] = useState("");
  const [invoiceInterval, setInvoiceInterval] = useState("12");
  const [invoiceRecipient, setInvoiceRecipient] = useState("");
  const [invoiceDisabled, setInvoiceDisabled] = useState(false);
  const [invoiceDisabledReason, setInvoiceDisabledReason] = useState("");
  const [notes, setNotes] = useState("");

  const reset = () => {
    setName(""); setCpf(""); setPhone(""); setUnit(""); setTreatment(""); setTotalValue("");
    setInstallments("1"); setFirstDueDate(""); setPaymentMethod("Boleto"); setInvoiceMode("automatic");
    setFirstInvoiceDate(""); setInvoiceInterval("12"); setInvoiceRecipient(""); setInvoiceDisabled(false);
    setInvoiceDisabledReason(""); setNotes("");
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const totalCents = moneyToCents(totalValue);
    const count = Math.trunc(Number(installments));
    const interval = Math.trunc(Number(invoiceInterval));

    if (!name.trim() || !unit || totalCents <= 0 || count <= 0 || !firstDueDate) {
      toast.error("Preencha os campos obrigatórios do paciente e do parcelamento.");
      return;
    }
    if (invoiceMode === "manual" && (!firstInvoiceDate || interval < 1 || interval > 24)) {
      toast.error("Informe a primeira data da NF e um intervalo de 1 a 24 meses.");
      return;
    }

    setSaving(true);
    try {
      const unitCode = unit === "Salto de Pirapora" ? "salto_de_pirapora" : "sorocaba";
      const row = {
        name: name.trim(),
        cpf: cpf.trim() || null,
        phone: phone.trim() || null,
        unit,
        treatment: treatment.trim() || null,
        paymentMethod,
        planAmountCents: totalCents,
        installmentAmountCents: Math.round(totalCents / count),
        installments: count,
        startDate: firstDueDate,
        dueDay: Number(firstDueDate.slice(-2)),
        taxReceiptIr: !invoiceDisabled,
        invoiceScheduleMode: invoiceMode,
        firstInvoiceDate: invoiceMode === "manual" ? firstInvoiceDate : null,
        invoiceIntervalMonths: invoiceMode === "manual" ? interval : 12,
        invoiceRecipientName: invoiceRecipient.trim() || null,
        invoiceDisabled,
        invoiceDisabledReason: invoiceDisabled ? (invoiceDisabledReason.trim() || "Não emitir nota fiscal") : null,
        notes: notes.trim() || null,
        source: "manual",
        importKey: `manual|${crypto.randomUUID()}`,
      };

      const { data, error } = await getSupabaseBrowserClient().rpc("import_patients", {
        p_unit_code: unitCode,
        p_file_name: "cadastro manual",
        p_rows: [row],
      });
      if (error) throw error;
      const result = data?.[0];
      if ((result?.error_count ?? 0) > 0) throw new Error("O cadastro foi enviado, mas ficou pendente de revisão no relatório de importação.");

      toast.success("Paciente cadastrado", { description: "Parcelas, lembretes e agenda de NF foram gerados automaticamente." });
      await onSaved();
      reset();
      setOpen(false);
    } catch (error) {
      toast.error("Paciente não cadastrado", { description: error instanceof Error ? error.message : "Tente novamente." });
    } finally {
      setSaving(false);
    }
  };

  return <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value && !saving) reset(); }}>
    <DialogTrigger asChild><Button className="h-10 rounded-xl bg-[#183b32]"><Plus /> Novo paciente</Button></DialogTrigger>
    <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle className="font-display text-2xl">Cadastrar paciente</DialogTitle><DialogDescription>O LYVRA cria o plano, as parcelas e a agenda operacional a partir destes dados.</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-6">
        <section className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do paciente" required /></Field>
          <Field label="CPF"><Input value={cpf} onChange={(e) => setCpf(e.target.value)} inputMode="numeric" placeholder="000.000.000-00" /></Field>
          <Field label="Telefone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="(15) 99999-9999" /></Field>
          <Field label="Unidade" required><Select value={unit} onValueChange={setUnit}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent><SelectItem value="Sorocaba">Sorocaba</SelectItem><SelectItem value="Salto de Pirapora">Salto de Pirapora</SelectItem></SelectContent></Select></Field>
          <div className="sm:col-span-2"><Field label="Tratamento"><Input value={treatment} onChange={(e) => setTreatment(e.target.value)} placeholder="Ex.: implantes, ortodontia, protocolo" /></Field></div>
        </section>

        <section className="rounded-2xl border border-[#e3e8e3] bg-[#fafbf8] p-4">
          <div className="mb-4 flex items-center gap-2"><ReceiptText className="size-4 text-[#39805f]" /><p className="text-sm font-semibold text-[#31483b]">Plano de pagamento</p></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Valor total do tratamento" required><Input value={totalValue} onChange={(e) => setTotalValue(e.target.value)} inputMode="decimal" placeholder="Ex.: 8.500,00" required /></Field>
            <Field label="Número de parcelas" required><Input type="number" min={1} max={120} value={installments} onChange={(e) => setInstallments(e.target.value)} required /></Field>
            <Field label="Data da 1ª parcela / vencimento" required><Input type="date" value={firstDueDate} onChange={(e) => setFirstDueDate(e.target.value)} required /></Field>
            <Field label="Forma de pagamento" required><Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value as "Cartão" | "Boleto")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Boleto">Boleto</SelectItem><SelectItem value="Cartão">Cartão</SelectItem></SelectContent></Select></Field>
          </div>
        </section>

        <section className="rounded-2xl border border-[#e3e8e3] p-4">
          <p className="text-sm font-semibold text-[#31483b]">Nota fiscal</p>
          <p className="mt-1 text-xs leading-5 text-[#7c8981]">Automática: cartão emite por ano no primeiro recebimento; boleto no término ou 31/12, o que vier primeiro.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Agenda da NF"><Select value={invoiceMode} onValueChange={(value) => setInvoiceMode(value as "automatic" | "manual")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="automatic">Regra automática</SelectItem><SelectItem value="manual">Personalizada</SelectItem></SelectContent></Select></Field>
            <Field label="NF em nome de"><Input value={invoiceRecipient} onChange={(e) => setInvoiceRecipient(e.target.value)} placeholder="Opcional: terceiro responsável" /></Field>
            {invoiceMode === "manual" && <><Field label="Primeira data da NF" required><Input type="date" value={firstInvoiceDate} onChange={(e) => setFirstInvoiceDate(e.target.value)} required /></Field><Field label="Emitir a cada quantos meses" required><Input type="number" min={1} max={24} value={invoiceInterval} onChange={(e) => setInvoiceInterval(e.target.value)} required /></Field></>}
          </div>
          <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl bg-[#fff7f4] p-3 text-sm text-[#6f5148]"><input type="checkbox" checked={invoiceDisabled} onChange={(e) => setInvoiceDisabled(e.target.checked)} className="mt-1" /><span><strong>Não emitir nota fiscal para este plano</strong><span className="mt-0.5 block text-xs text-[#8b7169]">Use para casos especiais. A obrigação fiscal não será criada.</span></span></label>
          {invoiceDisabled && <div className="mt-3"><Field label="Motivo"><Input value={invoiceDisabledReason} onChange={(e) => setInvoiceDisabledReason(e.target.value)} placeholder="Ex.: tratamento da Dra. Jane" /></Field></div>}
        </section>

        <Field label="Observações"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Informações adicionais do financeiro" rows={3} /></Field>
        <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button><Button type="submit" disabled={saving} className="bg-[#183b32]">{saving ? <LoaderCircle className="animate-spin" /> : <Plus />} Cadastrar paciente</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

function Field({ label, required = false, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}{required && <span className="ml-1 text-[#b24f3b]">*</span>}</Label>{children}</div>;
}
