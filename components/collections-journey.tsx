"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BellRing,
  CalendarClock,
  ChevronRight,
  CircleAlert,
  Clock3,
  History,
  Landmark,
  MessageSquareText,
  Mic,
  PhoneCall,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type CollectionStage = "call" | "negotiation" | "promise" | "protested";
type HistoryEntry = {
  id: number;
  date: string;
  author: string;
  channel: string;
  text: string;
};

type CollectionPatient = {
  id: number;
  name: string;
  initials: string;
  phone: string;
  unit: "Sorocaba" | "Salto de Pirapora";
  amount: string;
  dueDate: string;
  delay: string;
  stage: CollectionStage;
  status: string;
  nextAction: string;
  promiseDate?: string;
  protestedAt?: string;
  owner: string;
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

const initialPatients: CollectionPatient[] = [
  {
    id: 1,
    name: "Ana Paula Menezes",
    initials: "AM",
    phone: "(15) 9 8124-3077",
    unit: "Sorocaba",
    amount: "R$ 780,00",
    dueDate: "19/08/2026",
    delay: "6 dias úteis",
    stage: "call",
    status: "Ligação inicial",
    nextAction: "Hoje • 09:30",
    owner: "Daiane",
    history: [
      { id: 1, date: "24 ago • 08:00", author: "LYVRA", channel: "Sistema", text: "Paciente entrou automaticamente na régua após 3 dias úteis do vencimento." },
    ],
  },
  {
    id: 2,
    name: "Rogério Alves",
    initials: "RA",
    phone: "(15) 9 9432-1180",
    unit: "Salto de Pirapora",
    amount: "R$ 460,00",
    dueDate: "20/08/2026",
    delay: "5 dias úteis",
    stage: "call",
    status: "Nova tentativa",
    nextAction: "Hoje • 11:00",
    owner: "Daiane",
    history: [
      { id: 1, date: "25 ago • 08:00", author: "LYVRA", channel: "Sistema", text: "Paciente entrou automaticamente na régua após 3 dias úteis do vencimento." },
      { id: 2, date: "26 ago • 14:22", author: "Daiane", channel: "Ligação", text: "Ligação não atendida. Realizar uma nova tentativa amanhã pela manhã." },
    ],
  },
  {
    id: 3,
    name: "Renata Oliveira",
    initials: "RO",
    phone: "(15) 9 7664-9201",
    unit: "Sorocaba",
    amount: "R$ 1.240,00",
    dueDate: "13/08/2026",
    delay: "10 dias úteis",
    stage: "promise",
    status: "Pagamento prometido",
    nextAction: "Hoje • confirmar pagamento",
    promiseDate: "27/08/2026",
    owner: "Daiane",
    history: [
      { id: 1, date: "18 ago • 08:00", author: "LYVRA", channel: "Sistema", text: "Paciente entrou automaticamente na régua após 3 dias úteis do vencimento." },
      { id: 2, date: "22 ago • 16:10", author: "Daiane", channel: "Ligação", text: "Paciente informou que aguarda o salário e combinou realizar o pagamento integral no dia 27/08." },
    ],
  },
  {
    id: 4,
    name: "Marcos Vinícius Lima",
    initials: "ML",
    phone: "(15) 9 8877-2044",
    unit: "Sorocaba",
    amount: "R$ 620,00",
    dueDate: "11/08/2026",
    delay: "12 dias úteis",
    stage: "negotiation",
    status: "Em negociação",
    nextAction: "28 ago • retorno",
    promiseDate: "28/08/2026",
    owner: "Daiane",
    history: [
      { id: 1, date: "14 ago • 08:00", author: "LYVRA", channel: "Sistema", text: "Paciente entrou automaticamente na régua após 3 dias úteis do vencimento." },
      { id: 2, date: "26 ago • 10:42", author: "Daiane", channel: "Ligação", text: "Solicitou dividir o valor em duas vezes. Ficou de confirmar a proposta no dia 28/08." },
    ],
  },
  {
    id: 5,
    name: "Carla Ferreira",
    initials: "CF",
    phone: "(15) 9 7240-8812",
    unit: "Salto de Pirapora",
    amount: "R$ 1.580,00",
    dueDate: "06/07/2026",
    delay: "38 dias úteis",
    stage: "protested",
    status: "Protestado",
    nextAction: "Acompanhar regularização",
    protestedAt: "18/08/2026",
    owner: "Daiane",
    history: [
      { id: 1, date: "10 jul • 08:00", author: "LYVRA", channel: "Sistema", text: "Paciente entrou na régua de cobrança." },
      { id: 2, date: "14 ago • 15:30", author: "Daiane", channel: "Ligação", text: "Sem retorno após as tentativas registradas. Caso encaminhado para protesto." },
      { id: 3, date: "18 ago • 09:15", author: "Financeiro", channel: "Protesto", text: "Título protestado. Aguardando contato para regularização." },
    ],
  },
  {
    id: 6,
    name: "Paulo Henrique Souza",
    initials: "PS",
    phone: "(15) 9 9011-4427",
    unit: "Sorocaba",
    amount: "R$ 890,00",
    dueDate: "28/06/2026",
    delay: "44 dias úteis",
    stage: "protested",
    status: "Protestado",
    nextAction: "Retorno em 02 set",
    protestedAt: "11/08/2026",
    owner: "Daiane",
    history: [
      { id: 1, date: "03 jul • 08:00", author: "LYVRA", channel: "Sistema", text: "Paciente entrou na régua de cobrança." },
      { id: 2, date: "11 ago • 10:20", author: "Financeiro", channel: "Protesto", text: "Título protestado após encerramento das tentativas de negociação." },
      { id: 3, date: "26 ago • 17:08", author: "Daiane", channel: "Ligação", text: "Paciente pediu demonstrativo atualizado e combinou retorno para 02/09." },
    ],
  },
];

const stageTone: Record<CollectionStage, string> = {
  call: "bg-[#fff1d8] text-[#946614]",
  negotiation: "bg-[#e9f2f3] text-[#397174]",
  promise: "bg-[#e6f6ed] text-[#137044]",
  protested: "bg-[#fae8e3] text-[#9b4d3e]",
};

function CollectionMetric({ icon: Icon, label, value, detail, tone }: { icon: typeof BellRing; label: string; value: string; detail: string; tone: string }) {
  return (
    <article className="surface-card rounded-[22px] p-5">
      <div className="flex items-start justify-between gap-3">
        <div className={`grid size-11 place-items-center rounded-2xl ${tone}`}><Icon className="size-5" /></div>
        <span className="text-[10px] font-bold uppercase tracking-[.12em] text-[#909a94]">Hoje</span>
      </div>
      <p className="font-display mt-5 text-[30px] font-semibold leading-none text-[#192820]">{value}</p>
      <p className="mt-2 text-sm font-medium text-[#4c5c53]">{label}</p>
      <p className="mt-1 text-xs text-[#88938d]">{detail}</p>
    </article>
  );
}

export function CollectionsJourney({ unit, openPatientId, onPatientOpened }: { unit: string; openPatientId?: number | null; onPatientOpened?: () => void }) {
  const [patients, setPatients] = useState(initialPatients);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    if (!openPatientId) return;
    setSelectedId(openPatientId);
    onPatientOpened?.();
  }, [openPatientId, onPatientOpened]);

  const filtered = useMemo(() => patients.filter((patient) => unit === "todas" || (unit === "sorocaba" ? patient.unit === "Sorocaba" : patient.unit === "Salto de Pirapora")), [patients, unit]);
  const today = filtered.filter((patient) => patient.stage === "call" || patient.stage === "promise");
  const negotiating = filtered.filter((patient) => patient.stage === "negotiation" || patient.stage === "promise");
  const protested = filtered.filter((patient) => patient.stage === "protested");
  const selected = patients.find((patient) => patient.id === selectedId) ?? null;

  const updatePatient = (patient: CollectionPatient) => setPatients((current) => current.map((item) => item.id === patient.id ? patient : item));

  return (
    <div className="space-y-5">
      <section className="surface-card flex flex-col justify-between gap-5 rounded-[24px] p-5 md:flex-row md:items-center md:p-6">
        <div className="flex items-start gap-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[#e4f8ee] text-[#00884a]"><WalletCards className="size-5" /></div>
          <div>
            <div className="flex flex-wrap items-center gap-2"><p className="eyebrow">REGRA DE ENTRADA</p><Badge className="bg-[#183b32] text-white hover:bg-[#183b32]">Responsável: Daiane</Badge></div>
            <h2 className="font-display mt-2 text-2xl font-semibold text-[#192820]">A cobrança começa 3 dias úteis após o vencimento</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#718078]">No dia certo, o LYVRA coloca o paciente na fila da Daiane. Cada tentativa, acordo e retorno fica registrado na jornada.</p>
          </div>
        </div>
        <Badge variant="outline" className="w-fit border-[#d8e3d8] bg-[#f5f9f3] px-3 py-1.5 text-[#58704f]">DADOS DEMONSTRATIVOS</Badge>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <CollectionMetric icon={PhoneCall} label="Ligações para fazer" value={String(today.filter((patient) => patient.stage === "call").length)} detail="Fila organizada por horário" tone="bg-[#fff1d8] text-[#946614]" />
        <CollectionMetric icon={CalendarClock} label="Promessas para hoje" value={String(today.filter((patient) => patient.stage === "promise").length)} detail="Confirmar pagamento combinado" tone="bg-[#e6f6ed] text-[#137044]" />
        <CollectionMetric icon={MessageSquareText} label="Em negociação" value={String(negotiating.length)} detail="Com próximo retorno definido" tone="bg-[#e9f2f3] text-[#397174]" />
        <CollectionMetric icon={Landmark} label="Pacientes protestados" value={String(protested.length)} detail="Bloco separado para acompanhamento" tone="bg-[#fae8e3] text-[#9b4d3e]" />
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(310px,.55fr)]">
        <div className="surface-card overflow-hidden rounded-[24px]">
          <Tabs defaultValue="today">
            <div className="flex flex-col gap-4 border-b border-[#e7ebe7] p-5 md:flex-row md:items-center md:justify-between md:px-6">
              <div><h3 className="font-display text-xl font-semibold text-[#192820]">Jornada de cobrança</h3><p className="mt-1 text-sm text-[#718078]">Ligações, acordos e protestos no mesmo fluxo.</p></div>
              <TabsList className="h-10 w-full justify-start overflow-x-auto rounded-xl bg-[#f1f4f0] p-1 md:w-auto">
                <TabsTrigger value="today" className="rounded-lg px-3">Hoje <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1.5">{today.length}</Badge></TabsTrigger>
                <TabsTrigger value="negotiating" className="rounded-lg px-3">Negociações <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1.5">{negotiating.length}</Badge></TabsTrigger>
                <TabsTrigger value="protested" className="rounded-lg px-3 text-[#8f4b3f]">Protestados <Badge className="ml-1 h-5 min-w-5 bg-[#f6ddd7] px-1.5 text-[#934c3e] hover:bg-[#f6ddd7]">{protested.length}</Badge></TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="today" className="m-0"><CollectionTable patients={today} onOpen={setSelectedId} /></TabsContent>
            <TabsContent value="negotiating" className="m-0"><CollectionTable patients={negotiating} onOpen={setSelectedId} /></TabsContent>
            <TabsContent value="protested" className="m-0"><ProtestedBlock patients={protested} onOpen={setSelectedId} /></TabsContent>
          </Tabs>
        </div>

        <aside className="space-y-5">
          <div className="rounded-[24px] bg-[#10221f] p-6 text-white shadow-[0_18px_45px_rgba(24,59,50,.13)]">
            <div className="flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-white/45">Avisos da Daiane</p><BellRing className="size-5 text-[#00BF63]" /></div>
            <p className="font-display mt-5 text-2xl font-semibold">Próxima ligação às 09:30</p>
            <p className="mt-2 text-sm leading-6 text-white/55">Ana Paula Menezes • boleto vencido há 6 dias úteis.</p>
            <Button onClick={() => setSelectedId(1)} className="mt-6 h-11 w-full rounded-xl bg-[#00BF63] font-semibold text-[#10221f] hover:bg-[#00d56e]">Abrir negociação <ChevronRight /></Button>
          </div>

          <div className="surface-card rounded-[24px] p-5 md:p-6">
            <p className="eyebrow">COMO A JORNADA FUNCIONA</p>
            <div className="mt-5 space-y-4">
              <JourneyStep number="1" title="Vencimento" detail="Boleto continua somente em aberto." />
              <JourneyStep number="2" title="D+3 dias úteis" detail="Paciente entra na fila da Daiane." />
              <JourneyStep number="3" title="Negociação" detail="Conversa, acordo e retorno registrados." />
              <JourneyStep number="4" title="Desfecho" detail="Pagamento confirmado ou protesto." last />
            </div>
          </div>
        </aside>
      </section>

      <NegotiationSheet patient={selected} onClose={() => setSelectedId(null)} onUpdate={updatePatient} />
    </div>
  );
}

function JourneyStep({ number, title, detail, last = false }: { number: string; title: string; detail: string; last?: boolean }) {
  return (
    <div className="relative flex gap-3">
      {!last && <span className="absolute left-[15px] top-8 h-8 w-px bg-[#dfe6df]" />}
      <span className="relative z-10 grid size-8 shrink-0 place-items-center rounded-full bg-[#e4f8ee] text-xs font-bold text-[#00884a]">{number}</span>
      <div><p className="text-sm font-semibold text-[#2d3e34]">{title}</p><p className="mt-0.5 text-xs leading-5 text-[#829087]">{detail}</p></div>
    </div>
  );
}

function CollectionTable({ patients, onOpen }: { patients: CollectionPatient[]; onOpen: (id: number) => void }) {
  if (!patients.length) return <div className="grid min-h-56 place-items-center p-6 text-sm text-[#7d8982]">Nenhum paciente nesta etapa.</div>;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader><TableRow className="bg-[#fafbf8] hover:bg-[#fafbf8]"><TableHead className="pl-6">Paciente</TableHead><TableHead>Vencimento</TableHead><TableHead>Valor</TableHead><TableHead>Situação</TableHead><TableHead>Próxima ação</TableHead><TableHead className="w-32" /></TableRow></TableHeader>
        <TableBody>{patients.map((patient) => (
          <TableRow key={patient.id}>
            <TableCell className="py-4 pl-6"><div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-xl bg-[#edf2ed] text-xs font-semibold text-[#365146]">{patient.initials}</div><div><p className="font-medium text-[#213128]">{patient.name}</p><p className="mt-0.5 text-xs text-[#849087]">{patient.unit} • {patient.owner}</p></div></div></TableCell>
            <TableCell><p className="text-sm">{patient.dueDate}</p><p className="mt-1 text-xs text-[#a25f4d]">{patient.delay}</p></TableCell>
            <TableCell className="font-semibold tabular-nums">{patient.amount}</TableCell>
            <TableCell><Badge className={`border-0 font-medium hover:opacity-100 ${stageTone[patient.stage]}`}>{patient.status}</Badge></TableCell>
            <TableCell><p className="text-sm font-medium text-[#405148]">{patient.nextAction}</p></TableCell>
            <TableCell><Button onClick={() => onOpen(patient.id)} variant="outline" size="sm" className="rounded-lg">Negociar <ChevronRight /></Button></TableCell>
          </TableRow>
        ))}</TableBody>
      </Table>
    </div>
  );
}

function ProtestedBlock({ patients, onOpen }: { patients: CollectionPatient[]; onOpen: (id: number) => void }) {
  return (
    <div className="grid gap-4 p-5 md:grid-cols-2 md:p-6">
      {patients.map((patient) => (
        <article key={patient.id} className="rounded-[20px] border border-[#efd7d0] bg-[#fffafa] p-5">
          <div className="flex items-start justify-between gap-3"><div className="grid size-10 place-items-center rounded-2xl bg-[#fae8e3] text-[#9b4d3e]"><ShieldAlert className="size-4" /></div><Badge className="bg-[#f6ddd7] text-[#934c3e] hover:bg-[#f6ddd7]">PROTESTADO</Badge></div>
          <h4 className="mt-5 font-semibold text-[#332a27]">{patient.name}</h4>
          <p className="mt-1 text-xs text-[#8d7d77]">{patient.unit} • protestado em {patient.protestedAt}</p>
          <div className="mt-5 flex items-end justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.1em] text-[#a09089]">Valor em aberto</p><p className="mt-1 font-display text-xl font-semibold text-[#402d28]">{patient.amount}</p></div><Button onClick={() => onOpen(patient.id)} variant="outline" size="sm" className="border-[#e6cfc8] bg-white text-[#75483e] hover:bg-[#fff5f1]">Ver histórico</Button></div>
        </article>
      ))}
    </div>
  );
}

function NegotiationSheet({ patient, onClose, onUpdate }: { patient: CollectionPatient | null; onClose: () => void; onUpdate: (patient: CollectionPatient) => void }) {
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState("contact");
  const [nextDate, setNextDate] = useState("");
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const stopListening = () => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
  };

  const toggleListening = () => {
    if (listening) {
      stopListening();
      return;
    }
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      toast.info("Transcrição indisponível neste navegador", { description: "Você ainda pode escrever a negociação normalmente." });
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "pt-BR";
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const pieces: string[] = [];
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        if (event.results[index].isFinal) pieces.push(event.results[index][0].transcript.trim());
      }
      if (pieces.length) setNote((current) => `${current}${current.trim() ? " " : ""}${pieces.join(" ")}`);
    };
    recognition.onend = () => { recognitionRef.current = null; setListening(false); };
    recognition.onerror = () => { recognitionRef.current = null; setListening(false); toast.error("Não consegui ouvir o áudio", { description: "Confira a permissão do microfone ou digite a observação." }); };
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  };

  const register = () => {
    if (!patient || !note.trim()) {
      toast.info("Conte o que foi negociado antes de registrar.");
      return;
    }
    if (outcome === "promise" && !nextDate) {
      toast.info("Escolha a data combinada para o pagamento.");
      return;
    }

    const formattedDate = nextDate ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${nextDate}T12:00:00Z`)) : "";
    const keepsProtest = patient.stage === "protested";
    const updated: CollectionPatient = {
      ...patient,
      stage: outcome === "promise" ? "promise" : keepsProtest ? "protested" : "negotiation",
      status: outcome === "promise" ? "Pagamento prometido" : keepsProtest ? "Protestado" : outcome === "no-contact" ? "Nova tentativa" : "Em negociação",
      nextAction: outcome === "promise" ? `${formattedDate} • confirmar pagamento` : nextDate ? `${formattedDate} • retorno` : "Definir próximo retorno",
      promiseDate: formattedDate || patient.promiseDate,
      history: [...patient.history, { id: Date.now(), date: "Agora", author: "Daiane", channel: outcome === "no-contact" ? "Tentativa" : "Ligação", text: note.trim() }],
    };
    onUpdate(updated);
    setNote("");
    setNextDate("");
    setOutcome("contact");
    stopListening();
    toast.success("Negociação registrada", { description: outcome === "promise" ? `Lembrete criado para ${formattedDate}.` : "O histórico do paciente foi atualizado." });
  };

  return (
    <Sheet open={Boolean(patient)} onOpenChange={(open) => { if (!open) { stopListening(); onClose(); } }}>
      <SheetContent className="w-full gap-0 border-l-[#dfe5df] p-0 sm:max-w-[640px]">
        {patient && (
          <>
            <SheetHeader className="border-b border-[#e6ebe6] px-5 py-5 pr-12 md:px-6">
              <div className="flex items-center gap-3"><div className="grid size-11 place-items-center rounded-2xl bg-[#e4f8ee] text-sm font-bold text-[#16734a]">{patient.initials}</div><div className="min-w-0"><SheetTitle className="font-display text-xl text-[#192820]">{patient.name}</SheetTitle><SheetDescription>{patient.unit} • {patient.phone}</SheetDescription></div></div>
            </SheetHeader>

            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-6 px-5 py-5 md:px-6">
                <section className="grid grid-cols-3 gap-3">
                  <MiniDetail label="Em aberto" value={patient.amount} />
                  <MiniDetail label="Vencimento" value={patient.dueDate} />
                  <MiniDetail label="Atraso" value={patient.delay} danger />
                </section>

                <section>
                  <div className="flex items-center justify-between"><div><p className="eyebrow">HISTÓRICO DA NEGOCIAÇÃO</p><h3 className="font-display mt-1 text-lg font-semibold text-[#23342b]">Tudo que já foi conversado</h3></div><History className="size-5 text-[#829087]" /></div>
                  <div className="mt-5 space-y-5">
                    {patient.history.map((entry, index) => (
                      <div key={entry.id} className="relative flex gap-3">
                        {index < patient.history.length - 1 && <span className="absolute left-[15px] top-8 h-[calc(100%+4px)] w-px bg-[#dfe6df]" />}
                        <span className={`relative z-10 grid size-8 shrink-0 place-items-center rounded-full ${entry.author === "LYVRA" ? "bg-[#edf2ed] text-[#627169]" : "bg-[#e4f8ee] text-[#00884a]"}`}>{entry.author === "LYVRA" ? <Clock3 className="size-3.5" /> : <UserRoundCheck className="size-3.5" />}</span>
                        <div className="min-w-0 flex-1 rounded-2xl border border-[#e6ebe6] bg-[#fbfcfa] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold text-[#405148]">{entry.author} • {entry.channel}</p><span className="text-[10px] text-[#929c96]">{entry.date}</span></div><p className="mt-2 text-sm leading-6 text-[#65736b]">{entry.text}</p></div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-[22px] border border-[#dfe6df] bg-white p-4 md:p-5">
                  <div className="flex items-start justify-between gap-3"><div><p className="eyebrow">NOVA ATUALIZAÇÃO</p><h3 className="font-display mt-1 text-lg font-semibold text-[#23342b]">Registrar negociação</h3></div>{listening && <Badge className="animate-pulse bg-[#fae8e3] text-[#9b4d3e] hover:bg-[#fae8e3]"><span className="mr-1.5 size-1.5 rounded-full bg-[#c25e4c]" />Ouvindo</Badge>}</div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2"><Label htmlFor="collection-outcome" className="text-xs font-semibold text-[#53645a]">Resultado do contato</Label><Select value={outcome} onValueChange={setOutcome}><SelectTrigger id="collection-outcome" className="h-10 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="contact">Contato realizado</SelectItem><SelectItem value="promise">Promessa de pagamento</SelectItem><SelectItem value="no-contact">Não atendeu</SelectItem></SelectContent></Select></div>
                    <div className="space-y-2"><Label htmlFor="collection-date" className="text-xs font-semibold text-[#53645a]">Próxima data combinada</Label><Input id="collection-date" type="date" value={nextDate} onChange={(event) => setNextDate(event.target.value)} className="h-10 rounded-xl shadow-none" /></div>
                  </div>

                  <div className={`mt-4 overflow-hidden rounded-[20px] border bg-[#fafbf9] transition ${listening ? "border-[#00BF63] ring-3 ring-[#00BF63]/10" : "border-[#dfe5df]"}`}>
                    <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Escreva o que foi negociado ou toque no microfone para falar…" className="min-h-28 resize-none border-0 bg-transparent px-4 py-4 shadow-none focus-visible:ring-0" />
                    <div className="flex items-center justify-between gap-3 border-t border-[#e6ebe6] px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Button type="button" onClick={toggleListening} variant={listening ? "default" : "ghost"} size="icon" className={`rounded-full ${listening ? "bg-[#c85d4b] text-white hover:bg-[#b64f3e]" : "bg-white text-[#35483e] shadow-sm hover:bg-[#eef5ef]"}`} aria-label={listening ? "Parar gravação" : "Ditar observação"}>{listening ? <Square className="size-3.5 fill-current" /> : <Mic className="size-4" />}</Button>
                        <span className="hidden text-[11px] text-[#89958e] sm:inline">{listening ? "Fale agora. Toque para parar." : "Ditar observação"}</span>
                      </div>
                      <Button type="button" onClick={register} size="sm" className="rounded-xl bg-[#00BF63] font-semibold text-[#10221f] hover:bg-[#00d56e]">Registrar <Send /></Button>
                    </div>
                  </div>
                  <p className="mt-3 flex items-center gap-2 text-[11px] leading-5 text-[#8a958e]"><CircleAlert className="size-3.5 shrink-0" />A voz é transcrita no campo antes de salvar, então a Daiane pode revisar o texto.</p>
                </section>
              </div>
            </ScrollArea>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function MiniDetail({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return <div className="rounded-2xl border border-[#e5eae5] bg-[#fafbf9] p-3"><p className="text-[9px] font-bold uppercase tracking-[.1em] text-[#909a94]">{label}</p><p className={`mt-1 truncate text-sm font-semibold ${danger ? "text-[#a25f4d]" : "text-[#304138]"}`}>{value}</p></div>;
}
