"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, CalendarClock, CheckCircle2, LoaderCircle, WalletCards } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type FinancialTask = {
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

type Props = {
  userId: string;
  unit: string;
  onOpenJourney: () => void;
};

const taskLabels: Record<string, string> = {
  payment_reminder: "Lembrete D-1",
  collection_call: "Cobrança",
  payment_promise: "Promessa",
  invoice: "Nota fiscal",
  reconciliation: "Conferência",
  manual: "Tarefa",
};

function formatDue(value: string) {
  const date = new Date(value);
  const today = new Date();
  const sameDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(date)
    === new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(today);
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    ...(sameDay ? { hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit", year: "numeric" }),
  }).format(date);
}

function unitMatches(filter: string, code: string) {
  return filter === "todas"
    || (filter === "sorocaba" && code === "sorocaba")
    || (filter === "salto" && code === "salto_de_pirapora");
}

export function FinancialNotifications({ userId, unit, onOpenJourney }: Props) {
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<FinancialTask[]>([]);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const [taskResult, unitResult] = await Promise.all([
        supabase
          .from("financial_tasks")
          .select("id,unit_id,title,description,kind,status,due_at,assigned_to")
          .eq("assigned_to", userId)
          .in("status", ["pending", "in_progress"])
          .order("due_at", { ascending: true })
          .limit(50),
        supabase.from("units").select("id,code,name").eq("is_active", true),
      ]);
      if (taskResult.error) throw taskResult.error;
      if (unitResult.error) throw unitResult.error;
      setTasks((taskResult.data ?? []) as FinancialTask[]);
      setUnits((unitResult.data ?? []) as UnitRow[]);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const unitById = useMemo(() => new Map(units.map((item) => [item.id, item])), [units]);
  const visible = useMemo(() => tasks.filter((task) => {
    const taskUnit = unitById.get(task.unit_id);
    return taskUnit ? unitMatches(unit, taskUnit.code) : unit === "todas";
  }), [tasks, unit, unitById]);

  const now = Date.now();
  const attention = visible.filter((task) => new Date(task.due_at).getTime() <= now).length;

  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button variant="outline" size="icon" className="relative size-10 rounded-xl border-[#dfe5df] bg-white shadow-none" aria-label="Notificações financeiras">
        <Bell className="size-4" />
        {visible.length > 0 && <span className={`absolute right-2 top-2 size-1.5 rounded-full ${attention ? "bg-[#d56b52]" : "bg-[#e1a441]"}`} />}
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-[min(92vw,390px)] overflow-hidden rounded-2xl border-[#dfe5df] p-0 shadow-[0_18px_55px_rgba(25,52,39,.16)]">
      <div className="border-b border-[#e7ebe7] bg-[#fafbf8] px-5 py-4">
        <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.13em] text-[#87938c]">AGENDA FINANCEIRA</p><h3 className="font-display mt-1 text-lg font-semibold text-[#1c2d24]">Suas notificações</h3></div><Badge variant="secondary">{visible.length}</Badge></div>
        <p className="mt-1 text-xs text-[#7f8b84]">A ordem é pelo prazo, sem nível de prioridade.</p>
      </div>

      {loading && !visible.length ? <div className="grid min-h-40 place-items-center"><LoaderCircle className="size-5 animate-spin text-[#00BF63]" /></div> : visible.length ? <div className="max-h-[390px] overflow-y-auto divide-y divide-[#edf0ed]">
        {visible.slice(0, 8).map((task) => {
          const due = new Date(task.due_at).getTime();
          const overdue = due <= now;
          const taskUnit = unitById.get(task.unit_id);
          return <div key={task.id} className="px-5 py-4">
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl ${task.kind === "collection_call" ? "bg-[#fff1d8] text-[#946614]" : "bg-[#e4f8ee] text-[#00884a]"}`}>{task.kind === "collection_call" ? <WalletCards className="size-4" /> : <CalendarClock className="size-4" />}</div>
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold text-[#526259]">{taskLabels[task.kind] ?? "Tarefa"}</span>{overdue && <Badge className="h-5 bg-[#fae8e3] px-1.5 text-[10px] text-[#9b4d3e] hover:bg-[#fae8e3]">Agora</Badge>}</div><p className="mt-1 text-sm font-medium text-[#24352c]">{task.title}</p>{task.description && <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#7b8881]">{task.description}</p>}<p className="mt-2 text-[11px] font-medium text-[#86928b]">{formatDue(task.due_at)}{taskUnit?.name ? ` • ${taskUnit.name}` : ""}</p></div>
            </div>
          </div>;
        })}
      </div> : <div className="grid min-h-44 place-items-center px-6 text-center"><div><CheckCircle2 className="mx-auto size-8 text-[#83a88d]" /><p className="mt-3 text-sm font-medium text-[#425249]">Nada pendente para você</p><p className="mt-1 text-xs leading-5 text-[#87928c]">Quando uma tarefa entrar no seu prazo, ela aparece aqui.</p></div></div>}

      <div className="border-t border-[#e7ebe7] bg-[#fafbf8] p-3"><Button variant="ghost" className="h-10 w-full justify-center rounded-xl text-[#32634e]" onClick={() => { setOpen(false); onOpenJourney(); }}>Abrir Jornada financeira</Button></div>
    </PopoverContent>
  </Popover>;
}
