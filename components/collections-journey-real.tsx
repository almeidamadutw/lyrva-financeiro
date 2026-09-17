"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BellRing,
  CalendarClock,
  ChevronRight,
  CircleAlert,
  Clock3,
  History,
  Landmark,
  LoaderCircle,
  MessageSquareText,
  Mic,
  PhoneCall,
  RefreshCw,
  Send,
  ShieldAlert,
  Square,
  UserRoundCheck,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type CollectionStage = "call" | "negotiation" | "promise" | "protested";

type QueueRow = {
  id: number;
  unit_id: number;
  unit_name: string;
  unit_code: string | null;
  patient_id: number;
  patient_name: string;
  phone: string | null;
  installment_id: number;
  installment_number: number | null;
  due_date: string;
  open_amount: number | string;
  eligible_at: string;
  status: string;
  responsible_user_id: string | null;
  responsible_name: string | null;
  next_action_at: string | null;
  protested_at: string | null;
  notes: string | null;
  installment_status: string | null;
};

type InteractionRow = {
  id: number;
  collection_case_id: number;
  performed_by: string | null;
  channel: string;
  outcome: string;
  notes: string;
  occurred_at: string;
  next_action_at: string | null;
};

type ProfileRow = { user_id: string; full_name: string };

type HistoryEntry = {
  id: number | string;
  date: string;
  author: string;
  channel: string;
  text: string;
};

type CollectionPatient = {
  id: number;
  unitId: number;
  name: string;
  initials: string;
  phone: string;
  unit: "Sorocaba" | "Salto de Pirapora";
  amount: string;
  amountValue: number;
  dueDate: string;
  dueDateIso: string;
  eligibleAt: string;
  delay: string;
  stage: CollectionStage;
  status: string;
  nextAction: string;
  nextActionAt?: string | null;
  promiseDate?: string;
  protestedAt?: string;
  owner: string;
  installmentNumber?: number | null;
  history: HistoryEntry[];
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

type SpeechRecognitionErrorEventLike = { error?: string; message?: string };

type SpeechAvailability = "available" | "downloadable" | "downloading" | "unavailable";
type SpeechRecognitionOptionsLike = { langs: string[]; processLocally?: boolean; quality?: string };

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
};

type SpeechRecognitionConstructor = {
  new (): SpeechRecognitionLike;
  available?: (options: SpeechRecognitionOptionsLike) => Promise<SpeechAvailability>;
  install?: (options: SpeechRecognitionOptionsLike) => Promise<boolean>;
};

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

const stageTone: Record<CollectionStage, string> = {
  call: "bg-[#fff1d8] text-[#946614]",
  negotiation: "bg-[#e9f2f3] text-[#397174]",
  promise: "bg-[#e6f6ed] text-[#137044]",
  protested: "bg-[#fae8e3] text-[#9b4d3e]",
};

const channelLabels: Record<string, string> = {
  call: "Ligação",
  whatsapp: "WhatsApp",
  in_person: "Presencial",
  email: "E-mail",
  system: "LYVRA",
};

const brl = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const dateOnly = (value: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
const dateTime = (value: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
const saoPauloDayKey = (date = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function daysLate(dueDate: string) {
  const today = new Date(`${saoPauloDayKey()}T12:00:00-03:00`);
  const due = new Date(`${dueDate}T12:00:00-03:00`);
  const days = Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86_400_000));
  return days === 1 ? "1 dia em atraso" : `${days} dias em atraso`;
}

function stageFor(status: string): CollectionStage {
  if (status === "promise") return "promise";
  if (status === "protested") return "protested";
  if (status === "negotiating") return "negotiation";
  return "call";
}

function statusLabel(status: string) {
  if (status === "promise") return "Pagamento prometido";
  if (status === "protested") return "Protestado";
  if (status === "negotiating") return "Em negociação";
  return "Ligar";
}

function nextActionText(row: QueueRow) {
  if (row.status === "protested") return "Acompanhar protesto";
  if (row.next_action_at) {
    const prefix = row.status === "promise" ? "Confirmar pagamento" : "Retorno";
    return `${dateTime(row.next_action_at)} • ${prefix}`;
  }
  if (row.status === "promise") return "Confirmar pagamento";
  if (row.status === "negotiating") return "Definir próximo retorno";
  return `${dateOnly(row.eligible_at)} • iniciar contato`;
}

function CollectionMetric({ icon: Icon, label, value, detail, tone }: { icon: typeof BellRing; label: string; value: string; detail: string; tone: string }) {
  return <article className="surface-card rounded-[22px] p-5"><div className="flex items-start justify-between gap-3"><div className={`grid size-11 place-items-center rounded-2xl ${tone}`}><Icon className="size-5" /></div><span className="text-[10px] font-bold uppercase tracking-[.12em] text-[#909a94]">Agora</span></div><p className="font-display mt-5 text-[30px] font-semibold leading-none text-[#192820]">{value}</p><p className="mt-2 text-sm font-medium text-[#4c5c53]">{label}</p><p className="mt-1 text-xs text-[#88938d]">{detail}</p></article>;
}

export function CollectionsJourney({ unit, openPatientId, onPatientOpened }: { unit: string; openPatientId?: number | null; onPatientOpened?: () => void }) {
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [interactions, setInteractions] = useState<InteractionRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [internalSelectedId, setSelectedId] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [monthFilter, setMonthFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [quickPeriod, setQuickPeriod] = useState("all");

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const selectedCode = unit === "salto" ? "salto_de_pirapora" : unit;
      const pageSize = 500;
      const queueRows: QueueRow[] = [];
      const interactionRows: InteractionRow[] = [];

      for (let offset = 0; ; offset += pageSize) {
        let query = (supabase as any)
          .from("collection_queue")
          .select("*")
          .order("eligible_at", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (selectedCode !== "todas") query = query.eq("unit_code", selectedCode);
        const result = await query;
        if (result.error) throw result.error;
        const page = (result.data ?? []) as unknown as QueueRow[];
        queueRows.push(...page);
        if (page.length < pageSize) break;
      }

      for (let offset = 0; ; offset += pageSize) {
        const result = await supabase
          .from("collection_interactions")
          .select("id,collection_case_id,performed_by,channel,outcome,notes,occurred_at,next_action_at")
          .order("occurred_at", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (result.error) throw result.error;
        const page = (result.data ?? []) as unknown as InteractionRow[];
        interactionRows.push(...page);
        if (page.length < pageSize) break;
      }

      const profileResult = await supabase.from("profiles").select("user_id,full_name").eq("is_active", true);
      if (profileResult.error) throw profileResult.error;
      setQueue(queueRows);
      setInteractions(interactionRows);
      setProfiles((profileResult.data ?? []) as unknown as ProfileRow[]);
    } catch (error) {
      toast.error("Não foi possível carregar a régua de cobrança", { description: error instanceof Error ? error.message : "Tente novamente." });
    } finally {
      if (!silent) setLoading(false);
    }
  }, [unit]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = () => { void load(true); };
    const interval = window.setInterval(refresh, 60_000);
    const onVisibility = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", onVisibility); window.removeEventListener("focus", refresh); };
  }, [load]);
  useEffect(() => {
    if (!openPatientId) return;
    onPatientOpened?.();
  }, [openPatientId, onPatientOpened]);

  const profileById = useMemo(() => new Map(profiles.map((profile) => [profile.user_id, profile.full_name])), [profiles]);
  const interactionsByCase = useMemo(() => {
    const map = new Map<number, InteractionRow[]>();
    for (const interaction of interactions) map.set(interaction.collection_case_id, [...(map.get(interaction.collection_case_id) ?? []), interaction]);
    return map;
  }, [interactions]);

  const patients = useMemo<CollectionPatient[]>(() => queue
    .filter((row) => !["paid", "closed"].includes(row.status) && !["paid", "cancelled", "refunded"].includes(row.installment_status ?? ""))
    .map((row) => {
      const rowInteractions = interactionsByCase.get(row.id) ?? [];
      const history: HistoryEntry[] = [
        {
          id: `system-${row.id}`,
          date: dateOnly(row.eligible_at),
          author: "LYVRA",
          channel: "Entrada automática",
          text: row.notes || "Caso liberado para a régua de cobrança após o prazo configurado.",
        },
        ...rowInteractions.map((entry) => ({
          id: entry.id,
          date: dateTime(entry.occurred_at),
          author: entry.performed_by ? profileById.get(entry.performed_by) ?? "Equipe" : "LYVRA",
          channel: channelLabels[entry.channel] ?? entry.channel,
          text: entry.notes,
        })),
      ];
      return {
        id: row.id,
        unitId: row.unit_id,
        name: row.patient_name,
        initials: initials(row.patient_name),
        phone: row.phone || "Telefone não informado",
        unit: row.unit_name === "Salto de Pirapora" ? "Salto de Pirapora" : "Sorocaba",
        amount: brl(Number(row.open_amount ?? 0)),
        amountValue: Number(row.open_amount ?? 0),
        dueDate: dateOnly(row.due_date),
        dueDateIso: row.due_date,
        eligibleAt: row.eligible_at,
        delay: daysLate(row.due_date),
        stage: stageFor(row.status),
        status: statusLabel(row.status),
        nextAction: nextActionText(row),
        nextActionAt: row.next_action_at,
        promiseDate: row.status === "promise" && row.next_action_at ? dateTime(row.next_action_at) : undefined,
        protestedAt: row.protested_at ? dateTime(row.protested_at) : undefined,
        owner: row.responsible_name || "Daiane",
        installmentNumber: row.installment_number,
        history,
      };
    }), [queue, interactionsByCase, profileById]);

  const selectedUnit = useMemo(() => patients.filter((patient) => unit === "todas" || (unit === "sorocaba" ? patient.unit === "Sorocaba" : patient.unit === "Salto de Pirapora")), [patients, unit]);
  const todayKey = saoPauloDayKey();
  const now = Date.now();
  const availableYears = useMemo(() => [...new Set(selectedUnit.map((patient) => patient.dueDateIso.slice(0, 4)))].sort((a, b) => b.localeCompare(a)), [selectedUnit]);
  const periodFiltered = useMemo(() => {
    let quickStart = "";
    if (quickPeriod !== "all") {
      const start = new Date(`${todayKey}T12:00:00-03:00`);
      start.setDate(start.getDate() - (Number(quickPeriod) - 1));
      quickStart = saoPauloDayKey(start);
    }
    return selectedUnit.filter((patient) => {
      const due = patient.dueDateIso;
      if (quickStart && (due < quickStart || due > todayKey)) return false;
      if (dateFrom && due < dateFrom) return false;
      if (dateTo && due > dateTo) return false;
      if (yearFilter !== "all" && due.slice(0, 4) !== yearFilter) return false;
      if (monthFilter !== "all" && due.slice(5, 7) !== monthFilter) return false;
      return true;
    });
  }, [selectedUnit, quickPeriod, todayKey, dateFrom, dateTo, yearFilter, monthFilter]);

  const clearPeriodFilters = () => {
    setQuickPeriod("all");
    setDateFrom("");
    setDateTo("");
    setMonthFilter("all");
    setYearFilter("all");
  };

  const setQuick = (days: string) => {
    setQuickPeriod(days);
    setDateFrom("");
    setDateTo("");
    setMonthFilter("all");
    setYearFilter("all");
  };

  const actionable = periodFiltered.filter((patient) => {
    if (patient.stage === "protested") return true;
    if (patient.stage === "negotiation") return true;
    if (patient.stage === "promise") return true;
    return patient.eligibleAt <= todayKey;
  });

  const today = actionable.filter((patient) => {
    if (patient.stage === "call") return patient.nextActionAt ? new Date(patient.nextActionAt).getTime() <= now : patient.eligibleAt <= todayKey;
    if (patient.stage === "promise") return patient.nextActionAt ? saoPauloDayKey(new Date(patient.nextActionAt)) <= todayKey : true;
    return false;
  });
  const negotiating = actionable.filter((patient) => patient.stage === "negotiation" || patient.stage === "promise");
  const protested = actionable.filter((patient) => patient.stage === "protested");
  const selectedId = openPatientId ?? internalSelectedId;
  const selected = patients.find((patient) => patient.id === selectedId) ?? null;

  return <div className="space-y-5">
    <section className="surface-card flex flex-col justify-between gap-5 rounded-[24px] p-5 md:flex-row md:items-center md:p-6">
      <div className="flex items-start gap-4"><div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[#e4f8ee] text-[#00884a]"><WalletCards className="size-5" /></div><div><div className="flex flex-wrap items-center gap-2"><p className="eyebrow">REGRA DE ENTRADA</p><Badge className="bg-[#183b32] text-white hover:bg-[#183b32]">Responsável: Daiane</Badge></div><h2 className="font-display mt-2 text-2xl font-semibold text-[#192820]">Comece pelos casos liberados para contato</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-[#718078]">Antes de ligar, confira vencimento, valor e telefone. Depois do contato, registre o resultado e a próxima ação no histórico.</p></div></div>
      <div className="flex items-center gap-2"><Button variant="outline" size="icon" onClick={() => void load()} disabled={loading} className="rounded-xl">{loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}</Button></div>
    </section>

    <section className="surface-card rounded-[24px] p-5 md:p-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div><div className="flex items-center gap-2"><CalendarClock className="size-4 text-[#00884a]" /><p className="text-sm font-semibold text-[#2d3e34]">Filtrar por vencimento</p></div><p className="mt-1 text-xs text-[#87928c]">Use um período rápido, mês/ano ou escolha as datas exatas.</p></div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant={quickPeriod === "7" ? "default" : "outline"} onClick={() => setQuick("7")} className="rounded-xl">7 dias</Button>
            <Button type="button" size="sm" variant={quickPeriod === "30" ? "default" : "outline"} onClick={() => setQuick("30")} className="rounded-xl">30 dias</Button>
            <Button type="button" size="sm" variant={quickPeriod === "90" ? "default" : "outline"} onClick={() => setQuick("90")} className="rounded-xl">90 dias</Button>
            <Button type="button" size="sm" variant="ghost" onClick={clearPeriodFilters} className="rounded-xl">Limpar</Button>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div><Label className="mb-1.5 block text-xs text-[#718078]">De</Label><Input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setQuickPeriod("all"); }} className="h-10 rounded-xl" /></div>
          <div><Label className="mb-1.5 block text-xs text-[#718078]">Até</Label><Input type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setQuickPeriod("all"); }} className="h-10 rounded-xl" /></div>
          <div><Label className="mb-1.5 block text-xs text-[#718078]">Mês</Label><Select value={monthFilter} onValueChange={(value) => { setMonthFilter(value); setQuickPeriod("all"); }}><SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos os meses</SelectItem><SelectItem value="01">Janeiro</SelectItem><SelectItem value="02">Fevereiro</SelectItem><SelectItem value="03">Março</SelectItem><SelectItem value="04">Abril</SelectItem><SelectItem value="05">Maio</SelectItem><SelectItem value="06">Junho</SelectItem><SelectItem value="07">Julho</SelectItem><SelectItem value="08">Agosto</SelectItem><SelectItem value="09">Setembro</SelectItem><SelectItem value="10">Outubro</SelectItem><SelectItem value="11">Novembro</SelectItem><SelectItem value="12">Dezembro</SelectItem></SelectContent></Select></div>
          <div><Label className="mb-1.5 block text-xs text-[#718078]">Ano</Label><Select value={yearFilter} onValueChange={(value) => { setYearFilter(value); setQuickPeriod("all"); }}><SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos os anos</SelectItem>{availableYears.map((year) => <SelectItem key={year} value={year}>{year}</SelectItem>)}</SelectContent></Select></div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-[#718078]"><Badge variant="secondary">{periodFiltered.length} caso(s) no período</Badge>{dateFrom && <span>De {dateOnly(dateFrom)}</span>}{dateTo && <span>até {dateOnly(dateTo)}</span>}{monthFilter !== "all" && <span>Mês {monthFilter}</span>}{yearFilter !== "all" && <span>Ano {yearFilter}</span>}</div>
      </div>
    </section>

    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <CollectionMetric icon={PhoneCall} label="Ligações para fazer" value={String(today.filter((patient) => patient.stage === "call").length)} detail="Casos que já chegaram no prazo" tone="bg-[#fff1d8] text-[#946614]" />
      <CollectionMetric icon={CalendarClock} label="Promessas para conferir" value={String(today.filter((patient) => patient.stage === "promise").length)} detail="Pagamento combinado para confirmar" tone="bg-[#e6f6ed] text-[#137044]" />
      <CollectionMetric icon={MessageSquareText} label="Em negociação" value={String(negotiating.length)} detail="Histórico e próximo retorno salvos" tone="bg-[#e9f2f3] text-[#397174]" />
      <CollectionMetric icon={Landmark} label="Pacientes protestados" value={String(protested.length)} detail="Acompanhamento separado" tone="bg-[#fae8e3] text-[#9b4d3e]" />
    </section>

    <section className="lyvra-split-collections">
      <div className="surface-card min-w-0 overflow-hidden rounded-[24px]">
        <Tabs defaultValue="all">
          <div className="flex flex-col gap-4 border-b border-[#e7ebe7] p-5 md:flex-row md:items-center md:justify-between md:px-6"><div><h3 className="font-display text-xl font-semibold text-[#192820]">Jornada de cobrança</h3><p className="mt-1 text-sm text-[#718078]">Ligações, acordos e protestos no mesmo fluxo.</p></div><TabsList className="h-10 w-full justify-start overflow-x-auto rounded-xl bg-[#f1f4f0] p-1 md:w-auto"><TabsTrigger value="all" className="rounded-lg px-3">Todos <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1.5">{actionable.length}</Badge></TabsTrigger><TabsTrigger value="today" className="rounded-lg px-3">Hoje <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1.5">{today.length}</Badge></TabsTrigger><TabsTrigger value="negotiating" className="rounded-lg px-3">Negociações <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1.5">{negotiating.length}</Badge></TabsTrigger><TabsTrigger value="protested" className="rounded-lg px-3 text-[#8f4b3f]">Protestados <Badge className="ml-1 h-5 min-w-5 bg-[#f6ddd7] px-1.5 text-[#934c3e] hover:bg-[#f6ddd7]">{protested.length}</Badge></TabsTrigger></TabsList></div>
          <TabsContent value="all" className="m-0"><CollectionTable patients={actionable} onOpen={setSelectedId} loading={loading} /></TabsContent>
          <TabsContent value="today" className="m-0"><CollectionTable patients={today} onOpen={setSelectedId} loading={loading} /></TabsContent>
          <TabsContent value="negotiating" className="m-0"><CollectionTable patients={negotiating} onOpen={setSelectedId} loading={loading} /></TabsContent>
          <TabsContent value="protested" className="m-0"><ProtestedBlock patients={protested} onOpen={setSelectedId} loading={loading} /></TabsContent>
        </Tabs>
      </div>

      <aside className="min-w-0 space-y-5">
        <div className="rounded-[24px] bg-[#10221f] p-6 text-white shadow-[0_18px_45px_rgba(24,59,50,.13)]"><div className="flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-white/45">Avisos da Daiane</p><BellRing className="size-5 text-[#00BF63]" /></div><p className="font-display mt-5 text-2xl font-semibold">{today.length ? `${today.length} ação(ões) para hoje` : "Nenhuma cobrança vencida agora"}</p><p className="mt-2 text-sm leading-6 text-white/55">{today.length ? "A fila considera o prazo D+3 e os retornos que já chegaram na data combinada." : "Casos futuros ficam escondidos até chegar o dia correto."}</p></div>
        <div className="surface-card rounded-[24px] p-5 md:p-6"><p className="eyebrow">COMO A JORNADA FUNCIONA</p><div className="mt-5 space-y-4"><JourneyStep number="1" title="Vencimento" detail="Boleto permanece em acompanhamento." /><JourneyStep number="2" title="D+3 dias úteis" detail="Paciente entra na fila da Daiane." /><JourneyStep number="3" title="Negociação" detail="Conversa, acordo e retorno registrados." /><JourneyStep number="4" title="Desfecho" detail="Pagamento confirmado ou protesto." last /></div></div>
      </aside>
    </section>

    <NegotiationSheet patient={selected} onClose={() => setSelectedId(null)} onRegistered={load} />
  </div>;
}

function JourneyStep({ number, title, detail, last = false }: { number: string; title: string; detail: string; last?: boolean }) {
  return <div className="relative flex gap-3">{!last && <span className="absolute left-[15px] top-8 h-8 w-px bg-[#dfe6df]" />}<span className="relative z-10 grid size-8 shrink-0 place-items-center rounded-full bg-[#e4f8ee] text-xs font-bold text-[#00884a]">{number}</span><div><p className="text-sm font-semibold text-[#2d3e34]">{title}</p><p className="mt-0.5 text-xs leading-5 text-[#829087]">{detail}</p></div></div>;
}

function CollectionTable({ patients, onOpen, loading }: { patients: CollectionPatient[]; onOpen: (id: number) => void; loading: boolean }) {
  if (loading) return <div className="grid min-h-56 place-items-center"><LoaderCircle className="size-5 animate-spin text-[#00BF63]" /></div>;
  if (!patients.length) return <div className="grid min-h-56 place-items-center p-6 text-sm text-[#7d8982]">Nenhum paciente nesta etapa.</div>;
  return <div className="collection-responsive-list divide-y divide-[#e7ebe7]">{patients.map((patient) => <div key={patient.id} className="collection-responsive-row">
    <div className="collection-field collection-patient-field">
      <span className="collection-field-label">Paciente</span>
      <div className="flex min-w-0 items-center gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#edf2ed] text-xs font-semibold text-[#365146]">{patient.initials}</div><div className="min-w-0"><p className="truncate font-medium text-[#213128]">{patient.name}</p><p className="mt-0.5 truncate text-xs text-[#849087]">{patient.unit} • {patient.owner}</p></div></div>
    </div>
    <div className="collection-field"><span className="collection-field-label">Vencimento</span><p className="text-sm text-[#2c3b33]">{patient.dueDate}</p><p className="mt-1 text-xs text-[#a25f4d]">{patient.delay}</p></div>
    <div className="collection-field"><span className="collection-field-label">Valor</span><p className="font-semibold tabular-nums text-[#2c3b33]">{patient.amount}</p></div>
    <div className="collection-field"><span className="collection-field-label">Situação</span><div><Badge className={`border-0 font-medium hover:opacity-100 ${stageTone[patient.stage]}`}>{patient.status}</Badge></div></div>
    <div className="collection-field collection-next-field"><span className="collection-field-label">Próxima ação</span><p className="break-words text-sm font-medium leading-5 text-[#405148]">{patient.nextAction}</p></div>
    <div className="collection-action-field"><Button onClick={() => onOpen(patient.id)} variant="outline" size="sm" className="w-full rounded-lg whitespace-nowrap">Negociar <ChevronRight /></Button></div>
  </div>)}</div>;
}

function ProtestedBlock({ patients, onOpen, loading }: { patients: CollectionPatient[]; onOpen: (id: number) => void; loading: boolean }) {
  if (loading) return <div className="grid min-h-56 place-items-center"><LoaderCircle className="size-5 animate-spin text-[#00BF63]" /></div>;
  if (!patients.length) return <div className="grid min-h-56 place-items-center p-6 text-center"><div><div className="mx-auto grid size-12 place-items-center rounded-2xl bg-[#fae8e3] text-[#9b4d3e]"><ShieldAlert className="size-5" /></div><p className="mt-4 font-medium text-[#405148]">Nenhum paciente protestado</p><p className="mt-1 text-sm text-[#87928c]">Os títulos protestados ficarão reunidos neste bloco.</p></div></div>;
  return <div className="grid gap-4 p-5 md:grid-cols-2 md:p-6">{patients.map((patient) => <article key={patient.id} className="rounded-[20px] border border-[#efd7d0] bg-[#fffafa] p-5"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-[#402d28]">{patient.name}</p><p className="mt-1 text-xs text-[#9b766c]">{patient.unit} • {patient.protestedAt ?? "Protesto registrado"}</p></div><Badge className="bg-[#fae8e3] text-[#934c3e] hover:bg-[#fae8e3]">Protestado</Badge></div><div className="mt-5 flex items-end justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.1em] text-[#a09089]">Valor em aberto</p><p className="mt-1 font-display text-xl font-semibold text-[#402d28]">{patient.amount}</p></div><Button onClick={() => onOpen(patient.id)} variant="outline" size="sm" className="border-[#e6cfc8] bg-white text-[#75483e] hover:bg-[#fff5f1]">Ver histórico</Button></div></article>)}</div>;
}

function NegotiationSheet({ patient, onClose, onRegistered }: { patient: CollectionPatient | null; onClose: () => void; onRegistered: () => Promise<void> }) {
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState("contact");
  const [nextDate, setNextDate] = useState("");
  const [listening, setListening] = useState(false);
  const [saving, setSaving] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const stopListening = () => {
    try { recognitionRef.current?.stop(); } catch { /* reconhecimento já encerrado */ }
    recognitionRef.current = null;
    setListening(false);
  };

  const toggleListening = async () => {
    if (listening) { stopListening(); return; }
    if (!window.isSecureContext) {
      toast.error("O microfone precisa de uma conexão segura", { description: "Abra o LYVRA pelo endereço HTTPS oficial." });
      return;
    }

    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      toast.info("Este navegador não oferece transcrição por voz", { description: "No Chrome ou Edge o botão de ditado funciona diretamente. Você também pode usar o ditado do Windows com Win + H dentro do campo." });
      return;
    }

    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      }
    } catch {
      toast.error("Permissão do microfone bloqueada", { description: "Libere o microfone para este site nas permissões do navegador e tente novamente." });
      return;
    }

    const isOpera = /OPR\//.test(navigator.userAgent);
    let useLocalRecognition = false;

    if (Recognition.available) {
      try {
        const availability = await Recognition.available({ langs: ["pt-BR"], processLocally: true });
        if (availability === "available") {
          useLocalRecognition = true;
        } else if ((availability === "downloadable" || availability === "downloading") && Recognition.install) {
          toast.info("Preparando o ditado em português", { description: "Na primeira vez o navegador pode baixar o pacote de voz." });
          useLocalRecognition = await Recognition.install({ langs: ["pt-BR"], processLocally: true });
        }
      } catch {
        useLocalRecognition = false;
      }
    }

    if (isOpera && !useLocalRecognition && !Recognition.available) {
      toast.info("O Opera não liberou o reconhecimento local", { description: "O microfone funciona, mas esta versão do Opera pode não entregar a transcrição. O LYVRA ainda tentará o reconhecimento disponível." });
    }

    const recognition = new Recognition();
    recognition.lang = "pt-BR";
    recognition.continuous = false;
    recognition.interimResults = true;
    if (useLocalRecognition && "processLocally" in recognition) recognition.processLocally = true;

    const noteBeforeDictation = note.trim();
    let receivedTranscript = false;
    recognition.onresult = (event) => {
      const pieces: string[] = [];
      for (let index = 0; index < event.results.length; index += 1) {
        const transcript = event.results[index][0]?.transcript?.trim();
        if (transcript) pieces.push(transcript);
      }
      const spoken = pieces.join(" ").trim();
      if (spoken) {
        receivedTranscript = true;
        setNote(`${noteBeforeDictation}${noteBeforeDictation ? " " : ""}${spoken}`);
      }
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
      if (!receivedTranscript && isOpera) {
        toast.info("O Opera encerrou o áudio sem devolver texto", { description: "Toque novamente no microfone. Se o pacote local estiver disponível, o LYVRA passa a usá-lo automaticamente." });
      }
    };
    recognition.onerror = (event) => {
      recognitionRef.current = null;
      setListening(false);
      const code = event?.error ?? "unknown";
      const descriptions: Record<string, string> = {
        "not-allowed": "O navegador bloqueou o microfone. Libere a permissão do site e tente novamente.",
        "service-not-allowed": "O serviço de transcrição foi bloqueado pelo navegador. Tente Chrome ou Edge.",
        "audio-capture": "Nenhum microfone disponível foi encontrado neste computador.",
        "no-speech": "Não ouvi fala. Toque no microfone e fale novamente.",
        "network": "A transcrição por voz perdeu a conexão. Tente novamente.",
        "language-not-supported": "O português ainda não está disponível para reconhecimento local neste navegador.",
      };
      toast.error("Não consegui transcrever o áudio", { description: descriptions[code] ?? "Confira o microfone e a permissão do navegador e tente novamente." });
    };

    try {
      recognitionRef.current = recognition;
      recognition.start();
      setListening(true);
    } catch {
      recognitionRef.current = null;
      setListening(false);
      toast.error("O ditado não pôde ser iniciado", { description: "Feche qualquer gravação de voz aberta e tente novamente." });
    }
  };

  const register = async () => {
    if (!patient || !note.trim()) { toast.info("Conte o que foi negociado antes de registrar."); return; }
    if (outcome === "promise" && !nextDate) { toast.info("Escolha a data combinada para o pagamento."); return; }
    setSaving(true);
    try {
      const nextActionAt = nextDate ? new Date(`${nextDate}T09:00:00-03:00`).toISOString() : null;
      const { error } = await (getSupabaseBrowserClient() as any).rpc("register_collection_interaction", {
        p_case_id: patient.id,
        p_outcome: outcome === "no-contact" ? "no_contact" : outcome,
        p_notes: note.trim(),
        p_next_action_at: nextActionAt,
        p_channel: "call",
      });
      if (error) throw error;
      const formattedDate = nextDate ? dateOnly(nextDate) : "";
      toast.success("Negociação registrada", { description: outcome === "promise" ? `Retorno criado para ${formattedDate}.` : "O histórico real do paciente foi atualizado." });
      setNote(""); setNextDate(""); setOutcome("contact"); stopListening();
      await onRegistered();
      onClose();
    } catch (error) {
      toast.error("Não foi possível registrar a negociação", { description: error instanceof Error ? error.message : "Tente novamente." });
    } finally { setSaving(false); }
  };

  return <Sheet open={Boolean(patient)} onOpenChange={(open) => { if (!open) { stopListening(); onClose(); } }}><SheetContent className="w-full gap-0 border-l-[#dfe5df] p-0 sm:max-w-[640px]">{patient && <><SheetHeader className="border-b border-[#e6ebe6] px-5 py-5 pr-12 md:px-6"><div className="flex items-center gap-3"><div className="grid size-11 place-items-center rounded-2xl bg-[#e4f8ee] text-sm font-bold text-[#16734a]">{patient.initials}</div><div className="min-w-0"><SheetTitle className="font-display text-xl text-[#192820]">{patient.name}</SheetTitle><SheetDescription>{patient.unit} • {patient.phone}</SheetDescription></div></div></SheetHeader><ScrollArea className="min-h-0 flex-1"><div className="space-y-6 px-5 py-5 md:px-6"><section className="grid grid-cols-3 gap-3"><MiniDetail label="Em aberto" value={patient.amount} /><MiniDetail label="Vencimento" value={patient.dueDate} /><MiniDetail label="Atraso" value={patient.delay} danger /></section><section><div className="flex items-center justify-between"><div><p className="eyebrow">HISTÓRICO DA NEGOCIAÇÃO</p><h3 className="font-display mt-1 text-lg font-semibold text-[#23342b]">Tudo que já foi conversado</h3></div><History className="size-5 text-[#829087]" /></div><div className="mt-5 space-y-5">{patient.history.map((entry, index) => <div key={entry.id} className="relative flex gap-3">{index < patient.history.length - 1 && <span className="absolute left-[15px] top-8 h-[calc(100%+4px)] w-px bg-[#dfe6df]" />}<span className={`relative z-10 grid size-8 shrink-0 place-items-center rounded-full ${entry.author === "LYVRA" ? "bg-[#edf2ed] text-[#627169]" : "bg-[#e4f8ee] text-[#00884a]"}`}>{entry.author === "LYVRA" ? <Clock3 className="size-3.5" /> : <UserRoundCheck className="size-3.5" />}</span><div className="min-w-0 flex-1 rounded-2xl border border-[#e6ebe6] bg-[#fbfcfa] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold text-[#405148]">{entry.author} • {entry.channel}</p><span className="text-[10px] text-[#929c96]">{entry.date}</span></div><p className="mt-2 text-sm leading-6 text-[#65736b]">{entry.text}</p></div></div>)}</div></section><section className="rounded-[22px] border border-[#dfe6df] bg-white p-4 md:p-5"><div className="flex items-start justify-between gap-3"><div><p className="eyebrow">NOVA ATUALIZAÇÃO</p><h3 className="font-display mt-1 text-lg font-semibold text-[#23342b]">Registrar negociação</h3></div>{listening && <Badge className="animate-pulse bg-[#fae8e3] text-[#9b4d3e] hover:bg-[#fae8e3]"><span className="mr-1.5 size-1.5 rounded-full bg-[#c25e4c]" />Ouvindo</Badge>}</div><div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="collection-outcome" className="text-xs font-semibold text-[#53645a]">Resultado do contato</Label><Select value={outcome} onValueChange={setOutcome}><SelectTrigger id="collection-outcome" className="h-10 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="contact">Contato realizado</SelectItem><SelectItem value="promise">Promessa de pagamento</SelectItem><SelectItem value="no-contact">Não atendeu</SelectItem><SelectItem value="protest">Título protestado</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label htmlFor="collection-date" className="text-xs font-semibold text-[#53645a]">Próxima data combinada</Label><Input id="collection-date" type="date" value={nextDate} onChange={(event) => setNextDate(event.target.value)} className="h-10 rounded-xl shadow-none" disabled={outcome === "protest"} /></div></div><div className={`mt-4 overflow-hidden rounded-[20px] border bg-[#fafbf9] transition ${listening ? "border-[#00BF63] ring-3 ring-[#00BF63]/10" : "border-[#dfe5df]"}`}><Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Escreva o que foi negociado ou toque no microfone para falar…" className="min-h-28 resize-none border-0 bg-transparent px-4 py-4 shadow-none focus-visible:ring-0" /><div className="flex items-center justify-between gap-3 border-t border-[#e6ebe6] px-3 py-2"><div className="flex items-center gap-2"><Button type="button" onClick={toggleListening} variant={listening ? "default" : "ghost"} size="icon" className={`rounded-full ${listening ? "bg-[#c85d4b] text-white hover:bg-[#b64f3e]" : "bg-white text-[#35483e] shadow-sm hover:bg-[#eef5ef]"}`} aria-label={listening ? "Parar gravação" : "Ditar observação"}>{listening ? <Square className="size-3.5 fill-current" /> : <Mic className="size-4" />}</Button><span className="hidden text-[11px] text-[#89958e] sm:inline">{listening ? "Fale agora. Toque para parar." : "Ditar observação"}</span></div><Button type="button" onClick={() => void register()} disabled={saving} size="sm" className="rounded-xl bg-[#00BF63] font-semibold text-[#10221f] hover:bg-[#00d56e]">{saving ? <LoaderCircle className="animate-spin" /> : <>Registrar <Send /></>}</Button></div></div><p className="mt-3 flex items-center gap-2 text-[11px] leading-5 text-[#8a958e]"><CircleAlert className="size-3.5 shrink-0" />A voz é transcrita antes de salvar. O registro final fica permanente no histórico.</p></section></div></ScrollArea></>}</SheetContent></Sheet>;
}

function MiniDetail({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return <div className="rounded-2xl border border-[#e5eae5] bg-[#fafbf9] p-3"><p className="text-[9px] font-bold uppercase tracking-[.1em] text-[#909a94]">{label}</p><p className={`mt-1 truncate text-sm font-semibold ${danger ? "text-[#a25f4d]" : "text-[#304138]"}`}>{value}</p></div>;
}
