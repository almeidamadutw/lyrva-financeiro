"use client";

import { useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, FileSpreadsheet, LoaderCircle, Search, ShieldAlert, UploadCloud } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { parseCollectionsWorkbook, type ParsedCollectionRow, type ParsedNegotiation } from "@/lib/collections-workbook";

const norm = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const dateLabel = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));

function addBusinessDays(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00Z`);
  while (days > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (![0, 6].includes(date.getUTCDay())) days -= 1;
  }
  return date.toISOString().slice(0, 10);
}

function caseState(row: ParsedCollectionRow) {
  if (row.protested) return { status: "protested", next: null };
  const note = row.notes ?? "";
  const match = [...note.matchAll(/(?:dia\s*)?(\d{1,2})\/(\d{1,2})/gi)].at(-1);
  const year = Number(row.dueDate.slice(0, 4));
  const next = match ? `${year}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[1])).padStart(2, "0")}T12:00:00-03:00` : null;
  if (/renegoci/i.test(note)) return { status: "negotiating", next };
  if (/vai\s+pagar|paga\s+dia|pagamento\s+(?:no|dia)|promet/i.test(note)) return { status: "promise", next };
  return { status: "pending_contact", next: null };
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

async function fetchAllRows<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

export function CollectionsWorkbookImportView({ onImported }: { onImported?: () => Promise<void> | void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ParsedCollectionRow[]>([]);
  const [negotiations, setNegotiations] = useState<ParsedNegotiation[]>([]);
  const [sheets, setSheets] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const [unitCode, setUnitCode] = useState<"sorocaba" | "salto_de_pirapora" | "">("");

  const parseFile = async (file: File) => {
    setFileName(file.name);
    setError("");
    setRows([]);
    try {
      const parsed = await parseCollectionsWorkbook(file);
      setRows(parsed.rows);
      setNegotiations(parsed.negotiations);
      setSheets(parsed.sheets);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível ler a planilha.");
    }
  };

  const openRows = rows.filter((row) => !row.settled);
  const settled = rows.filter((row) => row.settled);
  const protested = openRows.filter((row) => row.protested);
  const visible = useMemo(() => {
    const query = norm(search);
    return query ? rows.filter((row) => norm(`${row.patientName} ${row.cpf ?? ""} ${row.sourceSheet}`).includes(query)) : rows;
  }, [rows, search]);

  const submit = async () => {
    if (!openRows.length || !unitCode) return;
    setImporting(true);
    try {
      const supabase = getSupabaseBrowserClient();
      let preparedCreated = 0;
      let preparedUpdated = 0;
      let preparedInstallments = 0;
      let preparedSkipped = 0;
      let preparedErrors = 0;

      for (const group of chunks(openRows, 100)) {
        const prepared = await (supabase as any).rpc("prepare_collection_import_targets", { p_unit_code: unitCode, p_rows: JSON.parse(JSON.stringify(group)) });
        if (prepared.error) throw prepared.error;
        const summary = prepared.data?.[0];
        preparedCreated += Number(summary?.created_patients ?? 0);
        preparedUpdated += Number(summary?.updated_patients ?? 0);
        preparedInstallments += Number(summary?.created_installments ?? 0);
        preparedSkipped += Number(summary?.skipped_settled ?? 0);
        preparedErrors += Number(summary?.error_count ?? 0);
      }
      if (preparedErrors) throw new Error(`${preparedErrors} linha(s) não puderam ser preparadas no banco.`);

      const unitResult = await supabase.from("units").select("id,name,collection_assignee_user_id").eq("code", unitCode).maybeSingle();
      if (unitResult.error) throw unitResult.error;
      if (!unitResult.data) throw new Error("A unidade selecionada não foi encontrada.");
      const unitId = Number((unitResult.data as any).id);
      const assignee = (unitResult.data as any).collection_assignee_user_id;

      const [patients, plans, installments] = await Promise.all([
        fetchAllRows<any>((from, to) => supabase.from("patient_directory").select("patient_unit_id,patient_id,full_name,cpf,unit_id,unit_name").eq("unit_id", unitId).range(from, to) as any),
        fetchAllRows<any>((from, to) => supabase.from("payment_plans").select("id,patient_unit_id,status").eq("unit_id", unitId).range(from, to) as any),
        fetchAllRows<any>((from, to) => supabase.from("installments").select("id,payment_plan_id,due_date,expected_amount,status").eq("unit_id", unitId).range(from, to) as any),
      ]);

      const byCpf = new Map<string, any>();
      const byName = new Map<string, any>();
      patients.forEach((patient) => {
        if (patient.cpf) byCpf.set(String(patient.cpf).replace(/\D/g, ""), patient);
        byName.set(norm(patient.full_name), patient);
      });
      const planIds = new Map<number, number[]>();
      plans.filter((plan) => ["active", "completed", "suspended"].includes(plan.status)).forEach((plan) => {
        const patientUnitId = Number(plan.patient_unit_id);
        planIds.set(patientUnitId, [...(planIds.get(patientUnitId) ?? []), Number(plan.id)]);
      });
      const byPlan = new Map<number, any[]>();
      installments.forEach((installment) => {
        const planId = Number(installment.payment_plan_id);
        byPlan.set(planId, [...(byPlan.get(planId) ?? []), installment]);
      });

      const mapped: Array<{ row: ParsedCollectionRow; patient: any; installment: any }> = [];
      const unmatched: ParsedCollectionRow[] = [];
      for (const row of openRows) {
        const patient = (row.cpf ? byCpf.get(row.cpf) : undefined) ?? byName.get(norm(row.patientName));
        if (!patient) { unmatched.push(row); continue; }
        const candidates = (planIds.get(Number(patient.patient_unit_id)) ?? []).flatMap((id) => byPlan.get(id) ?? []).filter((installment) => installment.due_date === row.dueDate);
        if (!candidates.length) { unmatched.push(row); continue; }
        const target = row.openAmountCents / 100;
        const installment = [...candidates].sort((a, b) => Math.abs(Number(a.expected_amount) - target) - Math.abs(Number(b.expected_amount) - target))[0];
        mapped.push({ row, patient, installment });
      }
      if (unmatched.length) throw new Error(`${unmatched.length} linha(s) foram gravadas, mas não reapareceram na conferência final. Recarregue a tela antes de importar novamente.`);

      const installmentIds = [...new Set(mapped.map((item) => Number(item.installment.id)))];
      const existingCases: any[] = [];
      for (const group of chunks(installmentIds, 100)) {
        if (!group.length) continue;
        const result = await (supabase as any).from("collection_cases").select("id,installment_id,status,notes,protested_at").in("installment_id", group);
        if (result.error) throw result.error;
        existingCases.push(...(result.data ?? []));
      }
      const caseByInstallment = new Map(existingCases.map((item) => [Number(item.installment_id), item]));
      const casesToInsert = mapped.filter((item) => !caseByInstallment.has(Number(item.installment.id))).map((item) => {
        const state = caseState(item.row);
        const eligible = addBusinessDays(item.row.dueDate, 3);
        return { unit_id: unitId, patient_unit_id: item.patient.patient_unit_id, installment_id: item.installment.id, responsible_user_id: assignee, eligible_at: eligible, status: state.status, next_action_at: state.next ?? `${eligible}T12:00:00-03:00`, protested_at: item.row.protested ? `${item.row.dueDate}T12:00:00-03:00` : null, notes: item.row.notes ?? `Importado da régua ${item.row.sourceSheet}.` };
      });
      for (const group of chunks(casesToInsert, 50)) {
        const result = await (supabase as any).from("collection_cases").insert(group);
        if (result.error) throw result.error;
      }

      for (const item of mapped) {
        const old = caseByInstallment.get(Number(item.installment.id));
        if (!old) continue;
        const state = caseState(item.row);
        const changes: Record<string, unknown> = {};
        if (item.row.protested && old.status !== "protested") { changes.status = "protested"; changes.protested_at = old.protested_at ?? `${item.row.dueDate}T12:00:00-03:00`; }
        else if (old.status === "pending_contact" && state.status !== "pending_contact") { changes.status = state.status; changes.next_action_at = state.next; }
        if (!old.notes && item.row.notes) changes.notes = item.row.notes;
        if (Object.keys(changes).length) {
          const result = await (supabase as any).from("collection_cases").update(changes).eq("id", old.id);
          if (result.error) throw result.error;
        }
      }

      const refreshedCases: any[] = [];
      for (const group of chunks(installmentIds, 100)) {
        const result = await (supabase as any).from("collection_cases").select("id,installment_id").in("installment_id", group);
        if (result.error) throw result.error;
        refreshedCases.push(...(result.data ?? []));
      }
      const refreshedMap = new Map(refreshedCases.map((item) => [Number(item.installment_id), item]));
      const caseIds = refreshedCases.map((item) => Number(item.id));
      const oldInteractions: any[] = [];
      for (const group of chunks(caseIds, 100)) {
        if (!group.length) continue;
        const result = await (supabase as any).from("collection_interactions").select("collection_case_id,notes").in("collection_case_id", group);
        if (result.error) throw result.error;
        oldInteractions.push(...(result.data ?? []));
      }
      const interactionKeys = new Set(oldInteractions.map((item) => `${item.collection_case_id}|${item.notes}`));
      const interactions: any[] = [];
      const caseHistory = new Map<number, Array<{ caseId: number; dueDate: string }>>();
      for (const item of mapped) {
        const collectionCase = refreshedMap.get(Number(item.installment.id));
        if (!collectionCase) continue;
        const patientId = Number(item.patient.patient_id);
        caseHistory.set(patientId, [...(caseHistory.get(patientId) ?? []), { caseId: Number(collectionCase.id), dueDate: item.row.dueDate }]);
        const source = item.row.notes || (item.row.protested ? "Paciente marcado como protestado na planilha." : "");
        if (!source) continue;
        const note = `Planilha ${item.row.sourceSheet}: ${source}`;
        const key = `${collectionCase.id}|${note}`;
        if (interactionKeys.has(key)) continue;
        interactionKeys.add(key);
        interactions.push({ unit_id: unitId, collection_case_id: collectionCase.id, channel: "system", outcome: item.row.protested ? "protest" : "note", notes: note, occurred_at: `${item.row.dueDate}T12:00:00-03:00` });
      }
      for (const negotiation of negotiations) {
        const patient = byName.get(norm(negotiation.patientName));
        if (!patient) continue;
        const history = [...(caseHistory.get(Number(patient.patient_id)) ?? [])].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
        const collectionCase = history.filter((item) => item.dueDate <= negotiation.date).at(-1) ?? history.at(-1);
        if (!collectionCase) continue;
        const note = [`Negociação de ${dateLabel(negotiation.date)}`, negotiation.negotiatedAmountCents ? `negociado ${money(negotiation.negotiatedAmountCents)}` : "", negotiation.receivedAmountCents ? `recebido ${money(negotiation.receivedAmountCents)}` : "", negotiation.paymentMethod ?? "", negotiation.notes ?? ""].filter(Boolean).join(" • ");
        const key = `${collectionCase.caseId}|${note}`;
        if (interactionKeys.has(key)) continue;
        interactionKeys.add(key);
        interactions.push({ unit_id: unitId, collection_case_id: collectionCase.caseId, channel: "system", outcome: negotiation.receivedAmountCents > 0 ? "payment" : "negotiation", notes: note, occurred_at: `${negotiation.date}T12:00:00-03:00` });
      }
      for (const group of chunks(interactions, 50)) {
        const result = await (supabase as any).from("collection_interactions").insert(group);
        if (result.error) throw result.error;
      }

      for (const row of settled) {
        const patient = (row.cpf ? byCpf.get(row.cpf) : undefined) ?? byName.get(norm(row.patientName));
        if (!patient) continue;
        const installment = (planIds.get(Number(patient.patient_unit_id)) ?? []).flatMap((id) => byPlan.get(id) ?? []).find((item) => item.due_date === row.dueDate);
        if (!installment) continue;
        await (supabase as any).from("collection_cases").update({ status: "paid", outcome: "paid", closed_at: new Date().toISOString() }).eq("installment_id", installment.id);
      }

      toast.success("Régua importada sem pendências", { description: `${mapped.length} caso(s) vinculados • ${preparedCreated} paciente(s) criado(s) • ${preparedUpdated} atualizado(s) • ${preparedInstallments} parcela(s) técnica(s) criada(s) • ${interactions.length} histórico(s) trazidos • ${settled.length} quitado(s) fora da cobrança.` });
      if (preparedSkipped) toast.info(`${preparedSkipped} paciente(s) quitado(s) permaneceram fora da cobrança.`);
      await onImported?.();
    } catch (caught) {
      toast.error("Não foi possível importar a régua", { description: caught instanceof Error ? caught.message : "Tente novamente." });
    } finally {
      setImporting(false);
    }
  };

  return <div className="space-y-5"><section className="grid gap-5 xl:grid-cols-[.72fr_1.28fr]"><div className="surface-card rounded-[24px] p-5 md:p-7"><p className="eyebrow">RÉGUA DA DAI</p><h2 className="font-display mt-2 text-2xl font-semibold text-[#192820]">Importar histórico de cobrança</h2><p className="mt-2 text-sm leading-6 text-[#718078]">A Régua procura primeiro os pacientes e parcelas já cadastrados. Quando faltar cadastro ou parcela, ela cria/atualiza o necessário sem duplicar e traz o histórico da Dai.</p><div className="mt-5 space-y-2"><p className="text-xs font-semibold text-[#53645a]">Unidade desta planilha</p><Select value={unitCode} onValueChange={(value) => setUnitCode(value as "sorocaba" | "salto_de_pirapora")}><SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder="Selecione Sorocaba ou Salto" /></SelectTrigger><SelectContent><SelectItem value="sorocaba">Sorocaba</SelectItem><SelectItem value="salto_de_pirapora">Salto de Pirapora</SelectItem></SelectContent></Select></div><input ref={inputRef} className="sr-only" type="file" accept=".xlsx,.xls" onChange={(event) => { const file = event.target.files?.[0]; if (file) void parseFile(file); }} /><button type="button" onClick={() => inputRef.current?.click()} className="mt-4 flex min-h-44 w-full flex-col items-center justify-center rounded-[22px] border border-dashed border-[#b7c4ba] bg-[#fafbf8] px-6 text-center"><div className="grid size-14 place-items-center rounded-2xl bg-[#e4f8ee] text-[#00884a]"><UploadCloud className="size-6" /></div><p className="mt-4 font-medium">{fileName || "Escolher planilha da régua"}</p><p className="mt-1 text-xs text-[#87928c]">{unitCode === "sorocaba" ? "Régua de Cobrança — Sorocaba" : unitCode === "salto_de_pirapora" ? "Régua de Cobrança — Salto de Pirapora" : "Escolha a unidade antes de importar"}</p></button>{error && <div className="mt-4 flex gap-2 rounded-2xl bg-[#fae8e3] p-4 text-sm text-[#934e3f]"><AlertCircle className="size-4" />{error}</div>}</div><div className="surface-card overflow-hidden rounded-[24px]"><div className="border-b border-[#e7ebe7] p-5 md:px-6"><div className="flex justify-between"><div><p className="eyebrow">CONFERÊNCIA</p><h2 className="font-display mt-2 text-xl font-semibold">Antes de trazer para a Dai</h2></div>{rows.length > 0 && <Badge variant="secondary">{rows.length} registros</Badge>}</div>{sheets.length > 0 && <p className="mt-2 text-xs text-[#87928c]">Abas lidas: {sheets.join(", ")}</p>}</div>{rows.length ? <><div className="grid grid-cols-2 gap-px bg-[#e8ece8] sm:grid-cols-4"><Summary value={openRows.length} label="Em aberto" /><Summary value={settled.length} label="Quitados" /><Summary value={protested.length} label="Protestados" /><Summary value={negotiations.length} label="Negociações" /></div><div className="border-b p-4 md:px-6"><div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#9aa49e]" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar paciente, CPF ou mês" className="h-10 rounded-xl pl-9" /></div></div><div className="max-h-[520px] overflow-auto"><Table><TableHeader className="sticky top-0 bg-[#fafbf8]"><TableRow><TableHead className="pl-6">Paciente</TableHead><TableHead>Vencimento</TableHead><TableHead>Em aberto</TableHead><TableHead>Recebido</TableHead><TableHead>Situação</TableHead></TableRow></TableHeader><TableBody>{visible.map((row) => <TableRow key={`${row.sourceSheet}-${row.sourceRow}`}><TableCell className="py-4 pl-6"><p className="font-medium">{row.patientName}</p><p className="mt-1 text-xs text-[#87928c]">{row.cpf || "CPF não informado"} • {row.sourceSheet}</p></TableCell><TableCell>{dateLabel(row.dueDate)}</TableCell><TableCell>{money(row.openAmountCents)}</TableCell><TableCell>{row.receivedAmountCents ? money(row.receivedAmountCents) : "—"}</TableCell><TableCell>{row.settled ? <Badge className="bg-[#e8f5df] text-[#55762e]"><CheckCircle2 /> Quitado</Badge> : row.protested ? <Badge className="bg-[#fae8e3] text-[#934e3f]"><ShieldAlert /> Protestado</Badge> : <Badge variant="secondary">Em aberto</Badge>}</TableCell></TableRow>)}</TableBody></Table></div><div className="flex flex-col gap-3 border-t p-5 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-[#7d8982]">A Régua atualiza pacientes existentes e cria somente o que estiver faltando. Pacientes quitados continuam fora da cobrança.</p><Button onClick={() => void submit()} disabled={importing || !openRows.length || !unitCode}>{importing ? <><LoaderCircle className="animate-spin" /> Importando…</> : <><FileSpreadsheet /> Trazer histórico para a régua</>}</Button></div></> : <div className="grid min-h-80 place-items-center text-center text-sm text-[#7d8982]">Selecione a planilha da régua.</div>}</div></section></div>;
}

function Summary({ value, label }: { value: number; label: string }) {
  return <div className="bg-white p-5 text-center"><p className="font-display text-2xl font-semibold">{value}</p><p className="mt-1 text-xs text-[#7f8b84]">{label}</p></div>;
}
