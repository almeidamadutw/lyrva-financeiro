"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Sale = {
  id: string;
  patient: string;
  agreed_on: string;
  sale_cents: number;
  minimum_cents: number;
  entry_cents: number;
  paid_entry_cents: number;
  paid_total_cents: number;
  forecast_on: string | null;
  reached_on: string | null;
  overdue_count: number;
  approved_at: string | null;
};

type Summary = Record<"paid_entry" | "paid_balance" | "expected_entry" | "expected_balance" | "sold_cents" | "patient_count" | "paying_patients", number>;
type Period = { summary: Summary; entries: Sale[] };
type Installment = { id: string; kind: "initial" | "entry" | "balance"; number: number; cents: number; due_on: string; paid_on: string | null };

const labels = { initial: "Valor no ato", entry: "Boleto da entrada", balance: "Boleto do saldo" };
const gateway = "https://uurlfnpuorqunlbvybau.supabase.co/functions/v1/entry-sales";
const moneyFormat = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
const money = (cents: number) => moneyFormat.format(cents / 100);
const day = (value: string) => dateFormat.format(new Date(`${value}T12:00:00Z`));
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format();

async function request<T>(body: Record<string, unknown>, signal?: AbortSignal) {
  const { data, error } = await getSupabaseBrowserClient().auth.getSession();
  if (error || !data.session) throw new Error("Entre novamente para consultar os recebimentos.");
  let response: Response;
  try {
    response = await fetch(gateway, {
      method: "POST",
      headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
      cache: "no-store",
    });
  } catch (failure) {
    if (signal?.aborted) throw failure;
    throw new Error("A integração com o AVERA está indisponível.");
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Não foi possível completar a operação.");
  return result as { data: T; canConfirm: boolean };
}

export function SalesEntries({ unit }: { unit: string }) {
  const [selectedUnit, setSelectedUnit] = useState("salto_de_pirapora");
  const activeUnit = unit === "salto" ? "salto_de_pirapora" : unit === "sorocaba" ? unit : selectedUnit;
  const [month, setMonth] = useState(today().slice(0, 7));
  return (
    <section className="space-y-5">
      <div className="surface-card flex flex-wrap items-end justify-between gap-4 rounded-[24px] p-5">
        <div><h2 className="font-display text-2xl font-semibold text-[#192820]">Controle de Entrada de Vendas</h2><p className="mt-1 text-sm text-[#526358]">Recebimentos da entrada, boletos do saldo e negociações vindas do AVERA.</p></div>
        <div className="flex flex-wrap items-end gap-3">
          {unit === "todas" && <label className="grid gap-1 text-sm font-medium">Unidade
            <select className="h-9 rounded-md border bg-white px-2" value={selectedUnit} onChange={(event) => setSelectedUnit(event.target.value)}>
              <option value="salto_de_pirapora">Salto de Pirapora</option><option value="sorocaba">Sorocaba</option>
            </select>
          </label>}
          <label className="grid gap-1 text-sm font-medium">Mês de referência<Input type="month" value={month} onChange={(event) => { if (event.target.value) setMonth(event.target.value); }} /></label>
        </div>
      </div>
      <SalesPeriod key={`${activeUnit}:${month}`} unit={activeUnit} month={month} />
    </section>
  );
}

function SalesPeriod({ unit, month }: { unit: string; month: string }) {
  const [period, setPeriod] = useState<Period | null>(null);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const goal = unit === "salto_de_pirapora" && /^2026-(0[6-9]|1[0-2])$/.test(month) ? 8_000_000 : null;
  useEffect(() => {
    const controller = new AbortController();
    void request<Period>({ action: "list", unit, month }, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setPeriod(result.data); })
      .catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [unit, month, revision]);

  function refresh() {
    setError("");
    setRevision((value) => value + 1);
  }

  const summary = period?.summary;
  const metrics = summary ? [
    ["Vendas negociadas no mês", money(summary.sold_cents)],
    ["Entradas recebidas no mês", money(summary.paid_entry)],
    ["Entradas em aberto com vencimento no mês", money(summary.expected_entry)],
    ["Saldo recebido no mês", money(summary.paid_balance)],
    ["Saldo em aberto com vencimento no mês", money(summary.expected_balance)],
    ["Pacientes com negociação no mês", String(summary.patient_count)],
    ["Ticket médio por paciente que pagou entrada", money(summary.paying_patients ? summary.paid_entry / summary.paying_patients : 0)],
    ["Meta de entrada do mês", goal === null ? "Não cadastrada" : money(goal)],
    ...(goal === null ? [] : [
      ["Falta para a meta", money(Math.max(0, goal - summary.paid_entry))],
      ["Meta atingida", new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 }).format(summary.paid_entry / goal)],
    ]),
  ] : [];

  const rows = period?.entries.filter((entry) => entry.patient.toLocaleLowerCase("pt-BR").includes(query.trim().toLocaleLowerCase("pt-BR")));
  return (
    <>
      <div className="flex flex-wrap justify-between gap-2">
        <p className="text-sm text-[#526358]">Recebido pela data da baixa. Em aberto pelo vencimento. Vendas pela data da negociação.</p>
        <Button variant="outline" onClick={refresh}>Atualizar</Button>
      </div>
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {!period && !error && <p role="status">Carregando recebimentos…</p>}
      {summary && <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map(([label, value]) => <div className="surface-card rounded-2xl p-4" key={label}><p className="text-sm text-[#526358]">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{value}</p></div>)}
      </div>}
      {selectedSale && <SaleDetails key={selectedSale.id} unit={unit} month={month} sale={selectedSale} onClose={() => setSelectedSale(null)} onChange={refresh} />}
      {period && <div className="surface-card rounded-[24px] p-5">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3"><h3 className="text-lg font-semibold">Negociações do período</h3><label className="grid gap-1 text-sm">Buscar paciente<Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
        {rows?.length ? <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm">
          <thead className="bg-[#f1f5f1]"><tr>{["Paciente", "Venda", "Entrada confirmada", "Falta para aprovar", "Saldo total a receber", "Aprovação", "Ação"].map((header) => <th className="p-3 font-medium" key={header}>{header}</th>)}</tr></thead>
          <tbody>{rows.map((sale) => <tr key={sale.id} className="border-b border-[#e4ebe4]">
            <th scope="row" className="p-3 font-medium">{sale.patient}</th><td className="p-3">{money(sale.sale_cents)}</td>
            <td className="p-3">{money(sale.paid_entry_cents)}<small className="block text-[#526358]">{(100 * sale.paid_entry_cents / sale.sale_cents).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% da venda</small><small className="block text-[#526358]">{sale.paid_entry_cents * 100 >= 30 * sale.sale_cents ? "OK · 30% ou mais" : sale.paid_entry_cents * 100 >= 20 * sale.sale_cents ? "Atenção · 20% a 29,99%" : "Baixo · abaixo de 20%"}</small></td>
            <td className="p-3">{money(Math.max(0, sale.minimum_cents - sale.paid_entry_cents))}</td><td className="p-3">{money(sale.sale_cents - sale.paid_total_cents)}</td>
            <td className="p-3">{sale.approved_at ? sale.reached_on ? "Aprovado no AVERA" : "Aprovado · revisar baixa" : sale.reached_on ? `Apto desde ${day(sale.reached_on)}` : sale.forecast_on ? `Prevista em ${day(sale.forecast_on)}` : "Sem previsão · conferir atraso"}</td>
            <td className="p-3"><Button variant="outline" size="sm" aria-label={`Abrir parcelas de ${sale.patient}`} onClick={() => setSelectedSale(sale)}>Parcelas</Button></td>
          </tr>)}</tbody>
        </table></div> : <p className="text-sm text-[#526358]">Nenhuma negociação encontrada para este período.</p>}
      </div>}
    </>
  );
}

function SaleDetails({ unit, month, sale, onClose, onChange }: { unit: string; month: string; sale: Sale; onClose: () => void; onChange: () => void }) {
  const [items, setItems] = useState<Installment[] | null>(null);
  const [canConfirm, setCanConfirm] = useState(false);
  const [editing, setEditing] = useState<Installment | null>(null);
  const [mode, setMode] = useState<"receive" | "reverse" | "reschedule">("receive");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void request<Installment[]>({ action: "list", unit, month, entry: sale.id }, controller.signal)
      .then((result) => { if (!controller.signal.aborted) { setItems(result.data); setCanConfirm(result.canConfirm); } })
      .catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [sale.id, month, unit, revision]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || busy) return;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const receipt = { action: "receipt", paidOn: mode === "reverse" ? null : form.get("paidOn"), previousPaidOn: editing.paid_on };
      const reschedule = { action: "reschedule", dueOn: form.get("dueOn"), previousDueOn: editing.due_on };
      await request({
        ...(mode === "reschedule" ? reschedule : receipt),
        unit, installment: editing.id, reason: form.get("reason") ?? undefined,
      });
      setEditing(null);
      setRevision((value) => value + 1);
      onChange();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível registrar a baixa.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="surface-card rounded-[24px] p-5">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-lg font-semibold">Parcelas de {sale.patient}</h3>
      <Button variant="outline" onClick={onClose} disabled={busy}>Fechar parcelas</Button>
    </div>
    {error && <p role="alert" className="mb-3 text-sm text-red-800">{error}</p>}
    {!items && !error && <p role="status">Carregando parcelas…</p>}
    {editing && <form className="mb-4 flex flex-wrap items-end gap-3 rounded-xl bg-[#f1f5f1] p-3" onSubmit={save} key={`${editing.id}:${mode}`}>
      <p className="w-full text-sm font-medium">{mode === "reschedule" ? "Reprogramar vencimento" : mode === "reverse" ? "Estornar" : editing.paid_on ? "Corrigir baixa" : "Confirmar recebimento"} · {labels[editing.kind]} · {money(editing.cents)}</p>
      {mode === "receive" && <label className="grid gap-1 text-sm">Data recebida<Input name="paidOn" type="date" required min={sale.agreed_on} max={today()} defaultValue={editing.paid_on ?? today()} /></label>}
      {mode === "reschedule" && <label className="grid gap-1 text-sm">Novo vencimento<Input name="dueOn" type="date" required min={today()} defaultValue={editing.due_on < today() ? today() : editing.due_on} /></label>}
      {(editing.paid_on || mode === "reschedule") && <label className="grid flex-1 gap-1 text-sm">Motivo<Input name="reason" required minLength={5} maxLength={500} /></label>}
      <Button type="submit" disabled={busy}>{mode === "reschedule" ? "Salvar vencimento" : mode === "reverse" ? "Estornar baixa" : "Salvar baixa"}</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(null)}>Cancelar</Button>
    </form>}
    {items && <div className="max-h-[420px] overflow-auto"><table className="w-full min-w-[550px] text-left text-sm">
      <thead className="sticky top-0 bg-[#f1f5f1]"><tr>{["Parcela", "Vencimento", "Valor", "Baixa", "Ação"].map((header) => <th key={header} className="p-2 font-medium">{header}</th>)}</tr></thead>
      <tbody>{items.map((item) => <tr key={item.id} className="border-b border-[#e4ebe4]">
        <th scope="row" className="p-2 font-medium">{labels[item.kind]}{item.kind !== "initial" ? ` ${item.number}` : ""}</th>
        <td className="p-2">{day(item.due_on)}</td><td className="p-2">{money(item.cents)}</td><td className="p-2">{item.paid_on ? day(item.paid_on) : item.due_on < today() ? "Em atraso" : "Em aberto"}</td>
        <td className="p-2">{canConfirm && <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => { setEditing(item); setMode("receive"); }}>{item.paid_on ? "Corrigir" : "Confirmar"}</Button>
          {!item.paid_on && item.kind !== "initial" && <Button variant="outline" size="sm" disabled={busy} onClick={() => { setEditing(item); setMode("reschedule"); }}>Reprogramar</Button>}
          {item.paid_on && <Button variant="outline" size="sm" disabled={busy} onClick={() => { setEditing(item); setMode("reverse"); }}>Estornar</Button>}
        </div>}</td>
      </tr>)}</tbody>
    </table></div>}
  </div>;
}
