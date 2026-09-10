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

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const [queueResult, interactionResult, profileResult] = await Promise.all([
        supabase.from("collection_queue").select("*").order("eligible_at", { ascending: true }),
        supabase.from("collection_interactions").select("id,collection_case_id,performed_by,channel,outcome,notes,occurred_at,next_action_at").order("occurred_at", { ascending: true }),
        supabase.from("profiles").select("user_id,full_name").eq("is_active", true),
      ]);
      const firstError = queueResult.error ?? interactionResult.error ?? profileResult.error;
      if (firstError) throw firstError;
      setQueue((queueResult.data ?? []) as QueueRow[]);
      setInteractions((interactionResult.data ?? []) as InteractionRow[]);
      setProfiles((profileResult.data ?? []) as ProfileRow[]);
    } catch (error) {
      toast.error("Não foi possível carregar a régua de cobrança", { description: error instanceof Error ? error.message : "Tente novamente." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
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

  const actionable = selectedUnit.filter((patient) => {
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
      <div className="flex items-start gap-4"><div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[#e4f8ee] text-[#00884a]"><WalletCards className="size-5" /></div><div><div className="flex flex-wrap items-center gap-2"><p className="eyebrow">REGRA DE ENTRADA</p><Badge className="bg-[#183b32] text-white hover:bg-[#183b32]">Responsável: Daiane</Badge></div><h2 className="font-display mt-2 text-2xl font-semibold text-[#192820]">A cobrança começa 3 dias úteis após o vencimento</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-[#718078]">O LYVRA só libera o caso no prazo correto. Cada tentativa, acordo, promessa e retorno fica gravado no histórico.</p></div></div>
      <div className="flex items-center gap-2"><Badge variant="outline" className="w-fit border-[#b9dbc7] bg-[#edf8f1] px-3 py-1.5 text-[#27704b]">BASE REAL</Badge><Button variant="outline" size="icon" onClick={() => void load()} disabled={loading} className="rounded-xl">{loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}</Button></div>
    </section>

    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <CollectionMetric icon={PhoneCall} label="Ligações para fazer" value={String(today.filter((patient) => patient.stage === "call").length)} detail="Casos que já chegaram no prazo" tone="bg-[#fff1d8] text-[#946614]" />
      <CollectionMetric icon={CalendarClock} label="Promessas para conferir" value={String(today.filter((patient) => patient.stage === "promise").length)} detail="Pagamento combinado para confirmar" tone="bg-[#e6f6ed] text-[#137044]" />
      <CollectionMetric icon={MessageSquareText} label="Em negociação" value={String(negotiating.length)} detail="Histórico e próximo retorno salvos" tone="bg-[#e9f2f3] text-[#397174]" />
      <CollectionMetric icon={Landmark} label="Pacientes protestados" value={String(protested.length)} detail="Acompanhamento separado" tone="bg-[#fae8e3] text-[#9b4d3e]" />
    </section>

    <section className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(310px,.55fr)]">
      <div className="surface-card overflow-hidden rounded-[24px]">
        <Tabs defaultValue="today">
          <div className="flex flex-col gap-4 border-b border-[#e7ebe7] p-5 md:flex-row md:items-center md:justify-between md:px-6"><div><h3 className="font-display text-xl font-semibold text-[#192820]">Jornada de cobrança</h3><p className="mt-1 text-sm text-[#718078]">Ligações, acordos e protestos no mesmo fluxo.</p></div><TabsList className="h-10 w-full justify-start overflow-x-auto rounded-xl bg-[#f1f4f0] p-1 md:w-auto"><TabsTrigger value="today" className="rounded-lg px-3">Hoje <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1.5">{today.length}</Badge></TabsTrigger><TabsTrigger value="negotiating" className="rounded-lg px-3">Negociações <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1.5">{negotiating.length}</Badge></TabsTrigger><TabsTrigger value="protested" className="rounded-lg px-3 text-[#8f4b3f]">Protestados <Badge className="ml-1 h-5 min-w-5 bg-[#f6ddd7] px-1.5 text-[#934c3e] hover:bg-[#f6ddd7]">{protested.length}</Badge></TabsTrigger></TabsList></div>
          <TabsContent value="today" className="m-0"><CollectionTable patients={today} onOpen={setSelectedId} loading={loading} /></TabsContent>
          <TabsContent value="negotiating" className="m-0"><CollectionTable patients={negotiating} onOpen={setSelectedId} loading={loading} /></TabsContent>
          <TabsContent value="protested" className="m-0"><ProtestedBlock patients={protested} onOpen={setSelectedId} loading={loading} /></TabsContent>
        </Tabs>
      </div>

      <aside className="space-y-5">
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
  return <div className="overflow-x-auto"><Table><TableHeader><TableRow className="bg-[#fafbf8] hover:bg-[#fafbf8]"><TableHead className="pl-6">Paciente</TableHead><TableHead>Vencimento</TableHead><TableHead>Valor</TableHead><TableHead>Situação</TableHead><TableHead>Próxima ação</TableHead><TableHead className="w-32" /></TableRow></TableHeader><TableBody>{patients.map((patient) => <TableRow key={patient.id}><TableCell className="py-4 pl-6"><div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-xl bg-[#edf2ed] text-xs font-semibold text-[#365146]">{patient.initials}</div><div><p className="font-medium text-[#213128]">{patient.name}</p><p className="mt-0.5 text-xs text-[#849087]">{patient.unit} • {patient.owner}</p></div></div></TableCell><TableCell><p className="text-sm">{patient.dueDate}</p><p className="mt-1 text-xs text-[#a25f4d]">{patient.delay}</p></TableCell><TableCell className="font-semibold tabular-nums">{patient.amount}</TableCell><TableCell><Badge className={`border-0 font-medium hover:opacity-100 ${stageTone[patient.stage]}`}>{patient.status}</Badge></TableCell><TableCell><p className="text-sm font-medium text-[#405148]">{patient.nextAction}</p></TableCell><TableCell><Button onClick={() => onOpen(patient.id)} variant="outline" size="sm" className="rounded-lg">Negociar <ChevronRight /></Button></TableCell></TableRow>)}</TableBody></Table></div>;
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

  const stopListening = () => { recognitionRef.current?.stop(); recognitionRef.current = null; setListening(false); };
  const toggleListening = () => {
    if (listening) { stopListening(); return; }
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) { toast.info("Transcrição indisponível neste navegador", { description: "Você ainda pode escrever a negociação normalmente." }); return; }
    const recognition = new Recognition();
    recognition.lang = "pt-BR"; recognition.continuous = true; recognition.interimResults = false;
    recognition.onresult = (event) => { const pieces: string[] = []; for (let index = event.resultIndex; index < event.results.length; index += 1) if (event.results[index].isFinal) pieces.push(event.results[index][0].transcript.trim()); if (pieces.length) setNote((current) => `${current}${current.trim() ? " " : ""}${pieces.join(" ")}`); };
    recognition.onend = () => { recognitionRef.current = null; setListening(false); };
    recognition.onerror = () => { recognitionRef.current = null; setListening(false); toast.error("Não consegui ouvir o áudio", { description: "Confira a permissão do microfone ou digite a observação." }); };
    recognitionRef.current = recognition; recognition.start(); setListening(true);
  };

  const register = async () => {
    if (!patient || !note.trim()) { toast.info("Conte o que foi negociado antes de registrar."); return; }
    if (outcome === "promise" && !nextDate) { toast.info("Escolha a data combinada para o pagamento."); return; }
    setSaving(true);
    try {
      const nextActionAt = nextDate ? new Date(`${nextDate}T09:00:00-03:00`).toISOString() : null;
      const { error } = await getSupabaseBrowserClient().rpc("register_collection_interaction", {
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
