"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BellRing,
  CalendarClock,
  Check,
  CheckCircle2,
  CircleDollarSign,
  LoaderCircle,
  PhoneCall,
  ReceiptText,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type JourneyTask = {
  id: number;
  unit_id: number;
  title: string;
  description: string | null;
  kind: string;
  status: string;
  due_at: string;
  assigned_to: string | null;
};

type UnitRow = { id: number; code: string; name: string };
type ProfileRow = { user_id: string; full_name: string };

type FinancialJourneyProps = {
  unit: string;
};

const unitMatches = (filter: string, code: string) =>
  filter === "todas" ||
  (filter === "sorocaba" && code === "sorocaba") ||
  (filter === "salto" && code === "salto_de_pirapora");

const taskLabel: Record<string, string> = {
  payment_reminder: "Lembrete D-1",
  collection_call: "Cobrança",
  payment_promise: "Promessa de pagamento",
  invoice: "Nota fiscal",
  reconciliation: "Conferência",
  manual: "Tarefa manual",
};

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));

export function FinancialJourney({ unit }: FinancialJourneyProps) {
  const [tasks, setTasks] = useState<JourneyTask[]>([]);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabaseBrowserClient();
    try {
      const [taskResult, unitResult, profileResult] = await Promise.all([
        supabase
          .from("financial_tasks")
          .select("id,unit_id,title,description,kind,status,due_at,assigned_to")
          .in("status", ["pending", "in_progress"])
          .order("due_at", { ascending: true })
          .limit(200),
        supabase.from("units").select("id,code,name").eq("is_active", true).order("name"),
        supabase.from("profiles").select("user_id,full_name").eq("is_active", true),
      ]);

      const firstError = taskResult.error ?? unitResult.error ?? profileResult.error;
      if (firstError) throw firstError;

      setTasks((taskResult.data ?? []) as JourneyTask[]);
      setUnits((unitResult.data ?? []) as UnitRow[]);
      setProfiles((profileResult.data ?? []) as ProfileRow[]);
    } catch (error) {
      toast.error("Não foi possível carregar a jornada financeira", {
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const unitById = useMemo(() => new Map(units.map((item) => [item.id, item])), [units]);
  const profileById = useMemo(() => new Map(profiles.map((item) => [item.user_id, item.full_name])), [profiles]);

  const visibleTasks = useMemo(
    () => tasks.filter((task) => {
      const taskUnit = unitById.get(task.unit_id);
      return taskUnit ? unitMatches(unit, taskUnit.code) : unit === "todas";
    }),
    [tasks, unit, unitById],
  );

  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const overdue = visibleTasks.filter((task) => new Date(task.due_at) < new Date(new Date().setHours(0, 0, 0, 0))).length;
  const todayCount = visibleTasks.filter((task) => {
    const date = new Date(task.due_at);
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return date >= start && date <= today;
  }).length;
  const reminderCount = visibleTasks.filter((task) => task.kind === "payment_reminder").length;
  const collectionCount = visibleTasks.filter((task) => task.kind === "collection_call" || task.kind === "payment_promise").length;

  const complete = async (task: JourneyTask) => {
    setSavingId(task.id);
    const supabase = getSupabaseBrowserClient();
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("financial_tasks")
      .update({ status: "completed", completed_at: now, seen_at: now })
      .eq("id", task.id);

    if (error) {
      toast.error("Não foi possível concluir a tarefa", { description: error.message });
    } else {
      toast.success("Tarefa concluída");
      await load();
    }
    setSavingId(null);
  };

  const stages = [
    {
      eyebrow: "D-1 DO VENCIMENTO",
      title: "Lembrete do boleto",
      description: "Maria Eduarda do financeiro recebe a tarefa de lembrete um dia antes do vencimento. O envio automático pelo WhatsApp entra na etapa de integração.",
      owner: "Maria Eduarda",
      icon: BellRing,
    },
    {
      eyebrow: "DIA DO VENCIMENTO",
      title: "Aguardar baixa",
      description: "No dia do vencimento não existe cobrança automática. O LYVRA acompanha a baixa e encerra as próximas ações quando o pagamento é confirmado.",
      owner: "Sistema",
      icon: CalendarClock,
    },
    {
      eyebrow: "D+3 DIAS ÚTEIS",
      title: "Entrada na régua de cobrança",
      description: "Se o boleto continuar em aberto, o caso entra automaticamente na régua e a primeira tarefa de cobrança fica com a Daiane.",
      owner: "Daiane",
      icon: PhoneCall,
    },
    {
      eyebrow: "APÓS O CONTATO",
      title: "Negociação e desfecho",
      description: "O caso permanece acompanhado até pagamento, negociação, promessa, protesto ou encerramento, sem perder o histórico do paciente.",
      owner: "Daiane",
      icon: CircleDollarSign,
    },
  ];

  return (
    <div className="space-y-5">
      <section className="hero-panel overflow-hidden rounded-[28px] px-5 py-6 text-white md:px-8 md:py-7">
        <div className="relative z-10 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <Badge className="border border-white/12 bg-white/8 text-white hover:bg-white/8">JORNADA ATIVA</Badge>
            <h2 className="font-display mt-4 text-3xl font-medium tracking-tight md:text-[40px]">O que precisa acontecer,<br className="hidden sm:block" /> na hora certa.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/60">A jornada organiza lembretes, cobrança e próximas ações. Não existe nível de prioridade: a ordem é definida pelo prazo.</p>
          </div>
          <Button variant="outline" onClick={() => void load()} disabled={loading} className="h-11 rounded-xl border-white/15 bg-white/8 text-white shadow-none hover:bg-white/14 hover:text-white">
            {loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />} Atualizar jornada
          </Button>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <JourneyMetric label="Vencidas" value={overdue} detail="Pedem ação" />
        <JourneyMetric label="Para hoje" value={todayCount} detail="Na agenda" />
        <JourneyMetric label="Lembretes D-1" value={reminderCount} detail="Maria Eduarda" />
        <JourneyMetric label="Em cobrança" value={collectionCount} detail="Daiane" />
      </section>

      <section className="surface-card rounded-[24px] p-5 md:p-6">
        <div className="flex items-start gap-3">
          <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#e4f8ee] text-[#00884a]"><ReceiptText className="size-5" /></div>
          <div>
            <p className="eyebrow">FLUXO DEFINIDO</p>
            <h3 className="font-display mt-1 text-xl font-semibold text-[#192820]">Do lembrete ao desfecho</h3>
            <p className="mt-1 text-sm leading-6 text-[#718078]">As etapas abaixo são operacionais e alimentam as tarefas reais do sistema.</p>
          </div>
        </div>
        <div className="mt-6 grid gap-3 xl:grid-cols-4">
          {stages.map((stage, index) => {
            const Icon = stage.icon;
            return <article key={stage.title} className="relative rounded-[20px] border border-[#e2e8e2] bg-[#fafbf8] p-5">
              <div className="flex items-center justify-between gap-3"><div className="grid size-9 place-items-center rounded-xl bg-white text-[#37705c] shadow-sm"><Icon className="size-4" /></div><span className="text-xs font-semibold tabular-nums text-[#98a29c]">0{index + 1}</span></div>
              <p className="mt-5 text-[10px] font-bold uppercase tracking-[.12em] text-[#71847a]">{stage.eyebrow}</p>
              <h4 className="mt-2 font-display text-lg font-semibold text-[#203129]">{stage.title}</h4>
              <p className="mt-2 text-sm leading-6 text-[#718078]">{stage.description}</p>
              <div className="mt-4 border-t border-[#e7ece7] pt-3 text-xs text-[#738078]"><span className="font-semibold text-[#415349]">Responsável:</span> {stage.owner}</div>
            </article>;
          })}
        </div>
      </section>

      <section className="surface-card overflow-hidden rounded-[24px]">
        <div className="flex flex-col gap-3 border-b border-[#e7ebe7] p-5 sm:flex-row sm:items-center sm:justify-between md:px-6">
          <div><p className="eyebrow">AGENDA OPERACIONAL</p><h3 className="font-display mt-1 text-xl font-semibold text-[#192820]">Tarefas abertas</h3><p className="mt-1 text-sm text-[#718078]">Ordenadas pela data. O que vence primeiro aparece primeiro.</p></div>
          <Badge variant="secondary">{visibleTasks.length} aberta(s)</Badge>
        </div>
        {loading ? (
          <div className="grid min-h-56 place-items-center text-sm text-[#718078]"><LoaderCircle className="size-5 animate-spin" /></div>
        ) : visibleTasks.length ? (
          <div className="divide-y divide-[#edf0ed]">
            {visibleTasks.map((task) => {
              const taskUnit = unitById.get(task.unit_id);
              const owner = task.assigned_to ? profileById.get(task.assigned_to) : null;
              const isLate = new Date(task.due_at) < new Date(new Date().setHours(0, 0, 0, 0));
              return <div key={task.id} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between md:px-6">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className={isLate ? "border-[#e8c5bb] bg-[#fff2ee] text-[#a04f3d]" : ""}>{taskLabel[task.kind] ?? task.kind}</Badge><span className="text-xs text-[#8a958e]">{taskUnit?.name ?? "Unidade"}</span></div>
                  <p className="mt-2 font-medium text-[#25372e]">{task.title}</p>
                  {task.description && <p className="mt-1 text-sm text-[#718078]">{task.description}</p>}
                  <p className="mt-2 text-xs text-[#87928c]">{formatDateTime(task.due_at)} • {owner ?? "Sem responsável"}</p>
                </div>
                <Button variant="outline" disabled={savingId === task.id} onClick={() => void complete(task)} className="shrink-0 rounded-xl">
                  {savingId === task.id ? <LoaderCircle className="animate-spin" /> : <Check />} Concluir
                </Button>
              </div>;
            })}
          </div>
        ) : (
          <div className="grid min-h-56 place-items-center px-6 text-center"><div><CheckCircle2 className="mx-auto size-9 text-[#88ad93]" /><p className="mt-3 font-medium text-[#405148]">Nenhuma tarefa aberta neste filtro</p><p className="mt-1 text-sm text-[#87928c]">Quando pacientes e parcelas entrarem na base, a jornada será alimentada automaticamente.</p></div></div>
        )}
      </section>
    </div>
  );
}

function JourneyMetric({ label, value, detail }: { label: string; value: number; detail: string }) {
  return <article className="surface-card rounded-[22px] p-5"><div className="flex items-end justify-between gap-3"><div><p className="font-display text-[30px] font-semibold leading-none text-[#1a2b22]">{value}</p><p className="mt-2 text-sm text-[#66756d]">{label}</p></div><p className="text-xs font-semibold text-[#7c8981]">{detail}</p></div></article>;
}
