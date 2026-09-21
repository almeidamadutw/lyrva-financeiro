"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BellRing, CheckCircle2, LoaderCircle, RefreshCw, ShieldOff } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type ReminderRow = {
  taskId: number;
  taskStatus: "pending" | "in_progress";
  unitId: number;
  unitName: string;
  patientId: number;
  patientName: string;
  phone: string | null;
  installmentId: number;
  installmentNumber: number | null;
  dueDate: string;
  amount: number;
  selected: boolean;
};

type ReminderException = {
  id: number;
  full_name: string;
  reminder_opt_out_reason: string | null;
};

const MANUAL_REMINDER_EXCEPTION_REASON = "Exceção definida ao desmarcar na lista de lembrete";

const money = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

const dateLabel = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));

const dayKey = (date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

function nextDay(iso: string) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function PaymentReminderReview({ unit }: { unit: string }) {
  const [date, setDate] = useState(dayKey());
  const [rows, setRows] = useState<ReminderRow[]>([]);
  const [exceptions, setExceptions] = useState<ReminderException[]>([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);

      try {
        const supabase = getSupabaseBrowserClient();
        const start = `${date}T00:00:00-03:00`;
        const end = `${nextDay(date)}T00:00:00-03:00`;

        let query = supabase
          .from("financial_tasks")
          .select("id,unit_id,patient_id,installment_id,due_at,status")
          .eq("kind", "payment_reminder")
          .in("status", ["pending", "in_progress"])
          .gte("due_at", start)
          .lt("due_at", end)
          .order("due_at", { ascending: true });

        if (unit !== "todas") {
          const code = unit === "salto" ? "salto_de_pirapora" : "sorocaba";
          const unitResult = await supabase.from("units").select("id").eq("code", code).maybeSingle();
          if (unitResult.error) throw unitResult.error;
          if (unitResult.data) query = query.eq("unit_id", Number((unitResult.data as { id: number }).id));
        }

        const taskResult = await query;
        if (taskResult.error) throw taskResult.error;

        const tasks = (taskResult.data ?? []) as unknown as Array<{
          id: number;
          unit_id: number;
          patient_id: number;
          installment_id: number;
          status: "pending" | "in_progress";
        }>;

        const patientIds = [...new Set(tasks.map((item) => item.patient_id).filter(Boolean))];
        const installmentIds = [...new Set(tasks.map((item) => item.installment_id).filter(Boolean))];
        const unitIds = [...new Set(tasks.map((item) => item.unit_id).filter(Boolean))];

        const [patientResult, installmentResult, unitResult, exceptionResult] = await Promise.all([
          patientIds.length
            ? (supabase as any)
                .from("patients")
                .select("id,full_name,phone,reminder_opt_out,reminder_opt_out_reason,settled_at")
                .in("id", patientIds)
            : Promise.resolve({ data: [], error: null }),
          installmentIds.length
            ? supabase
                .from("installments")
                .select("id,installment_number,due_date,expected_amount")
                .in("id", installmentIds)
            : Promise.resolve({ data: [], error: null }),
          unitIds.length
            ? supabase.from("units").select("id,code,name").in("id", unitIds)
            : Promise.resolve({ data: [], error: null }),
          (supabase as any)
            .from("patients")
            .select("id,full_name,reminder_opt_out_reason")
            .eq("reminder_opt_out", true)
            .eq("reminder_opt_out_reason", MANUAL_REMINDER_EXCEPTION_REASON)
            .order("full_name"),
        ]);

        const firstError = patientResult.error ?? installmentResult.error ?? unitResult.error ?? exceptionResult.error;
        if (firstError) throw firstError;

        const patients = new Map(((patientResult.data ?? []) as any[]).map((item) => [Number(item.id), item]));
        const installments = new Map(((installmentResult.data ?? []) as any[]).map((item) => [Number(item.id), item]));
        const units = new Map(((unitResult.data ?? []) as any[]).map((item) => [Number(item.id), item]));

        setRows(
          tasks.flatMap((task) => {
            const patient = patients.get(task.patient_id);
            const installment = installments.get(task.installment_id);
            const taskUnit = units.get(task.unit_id);

            if (!patient || !installment || !taskUnit || patient.settled_at || patient.reminder_opt_out) return [];

            return [
              {
                taskId: task.id,
                taskStatus: task.status,
                unitId: task.unit_id,
                unitName: taskUnit.name,
                patientId: task.patient_id,
                patientName: patient.full_name,
                phone: patient.phone,
                installmentId: task.installment_id,
                installmentNumber: installment.installment_number,
                dueDate: installment.due_date,
                amount: Number(installment.expected_amount ?? 0),
                selected: task.status === "pending" && Boolean(patient.phone),
              },
            ];
          }),
        );

        setExceptions((exceptionResult.data ?? []) as ReminderException[]);
      } catch (error) {
        toast.error("Não foi possível preparar os lembretes", {
          description: error instanceof Error ? error.message : "Tente novamente.",
        });
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [date, unit],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const refresh = () => {
      void load(true);
    };
    const interval = window.setInterval(refresh, 60_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", refresh);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

  const selected = rows.filter((row) => row.taskStatus === "pending" && row.selected);
  const approvedCount = rows.filter((row) => row.taskStatus === "in_progress").length;
  const total = useMemo(() => selected.reduce((sum, row) => sum + row.amount, 0), [selected]);

  const toggle = async (row: ReminderRow, checked: boolean) => {
    if (row.taskStatus !== "pending") return;

    if (checked) {
      setRows((current) => current.map((item) => (item.taskId === row.taskId ? { ...item, selected: true } : item)));
      return;
    }

    const supabase = getSupabaseBrowserClient();
    const { data: userData } = await supabase.auth.getUser();
    const result = await (supabase as any)
      .from("patients")
      .update({
        reminder_opt_out: true,
        reminder_opt_out_reason: MANUAL_REMINDER_EXCEPTION_REASON,
        reminder_opt_out_at: new Date().toISOString(),
        reminder_opt_out_by: userData.user?.id ?? null,
      })
      .eq("id", row.patientId);

    if (result.error) {
      toast.error("Não foi possível salvar a exceção", { description: result.error.message });
      return;
    }

    toast.success(`${row.patientName} virou exceção permanente`, {
      description: "Ele não volta para as próximas listas até você remover a exceção.",
    });
    await load();
  };

  const restore = async (patientId: number) => {
    const supabase = getSupabaseBrowserClient();
    const result = await (supabase as any)
      .from("patients")
      .update({
        reminder_opt_out: false,
        reminder_opt_out_reason: null,
        reminder_opt_out_at: null,
        reminder_opt_out_by: null,
      })
      .eq("id", patientId);

    if (result.error) {
      toast.error("Não foi possível remover a exceção", { description: result.error.message });
      return;
    }

    toast.success("Paciente liberado para os próximos lembretes.");
    await load();
  };

  const approve = async () => {
    if (!selected.length) return;
    setApproving(true);

    try {
      const supabase = getSupabaseBrowserClient();
      const now = new Date().toISOString();
      const events = selected.map((row) => ({
        unit_id: row.unitId,
        patient_id: row.patientId,
        installment_id: row.installmentId,
        kind: "boleto_reminder",
        channel: "whatsapp",
        template_name: "boleto_d1",
        status: "scheduled",
        idempotency_key: `boleto_d1:${row.installmentId}:${row.dueDate}`,
        scheduled_for: now,
        payload: {
          approved_in_lyvra: true,
          approved_at: now,
          requires_script_and_image: true,
        },
      }));

      const eventResult = await (supabase as any)
        .from("message_events")
        .upsert(events, { onConflict: "idempotency_key", ignoreDuplicates: true });
      if (eventResult.error) throw eventResult.error;

      const taskResult = await supabase
        .from("financial_tasks")
        .update({ status: "in_progress" })
        .in(
          "id",
          selected.map((row) => row.taskId),
        );
      if (taskResult.error) throw taskResult.error;

      toast.success(`${selected.length} lembrete(s) aprovado(s) no LYVRA`, {
        description: "Agora eles ficam travados como aprovados e aguardam o disparo pelo WhatsApp.",
      });
      await load();
    } catch (error) {
      toast.error("Não foi possível aprovar a lista", {
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
    } finally {
      setApproving(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="surface-card rounded-[24px] p-5 md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <div className="grid size-12 place-items-center rounded-2xl bg-[#e4f8ee] text-[#00884a]">
              <BellRing className="size-5" />
            </div>
            <div>
              <p className="eyebrow">APROVAÇÃO OBRIGATÓRIA</p>
              <h2 className="font-display mt-2 text-2xl font-semibold text-[#192820]">Lembretes de boleto</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[#718078]">
                Confira a lista antes do envio. Ao desmarcar alguém, esse paciente vira exceção permanente até você liberar novamente. Depois de aprovado, o lembrete fica travado aguardando o WhatsApp e não pode ser aprovado duas vezes.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="w-40" />
            <Button variant="outline" size="icon" onClick={() => void load()} aria-label="Atualizar lembretes">
              <RefreshCw />
            </Button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric value={rows.length} label="Na lista" />
        <Metric value={selected.length} label="Selecionados" />
        <Metric value={approvedCount} label="Aprovados" />
        <Metric value={money(total)} label="Valor selecionado" />
      </section>

      <section className="surface-card overflow-hidden rounded-[24px]">
        <div className="flex flex-col gap-3 border-b border-[#e7ebe7] p-5 sm:flex-row sm:items-center sm:justify-between md:px-6">
          <div>
            <h3 className="font-display text-lg font-semibold text-[#192820]">Quem receberá hoje</h3>
            <p className="mt-1 text-sm text-[#718078]">
              Sem telefone não entra selecionado. Exceções permanentes não aparecem aqui. Itens já aprovados ficam somente para acompanhamento.
            </p>
          </div>
          <Button onClick={() => void approve()} disabled={approving || !selected.length} className="rounded-xl">
            {approving ? (
              <>
                <LoaderCircle className="animate-spin" /> Aprovando…
              </>
            ) : (
              <>
                <CheckCircle2 /> Aprovar {selected.length} envio(s)
              </>
            )}
          </Button>
        </div>

        {loading ? (
          <div className="grid min-h-56 place-items-center">
            <LoaderCircle className="animate-spin" />
          </div>
        ) : rows.length ? (
          <Table>
            <TableHeader>
              <TableRow className="bg-[#fafbf8]">
                <TableHead className="w-14 pl-6">Enviar</TableHead>
                <TableHead>Paciente</TableHead>
                <TableHead>Unidade</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const approved = row.taskStatus === "in_progress";
                return (
                  <TableRow key={row.taskId}>
                    <TableCell className="pl-6">
                      <input
                        aria-label={approved ? `${row.patientName} já aprovado` : `Enviar lembrete para ${row.patientName}`}
                        type="checkbox"
                        checked={!approved && row.selected}
                        disabled={approved}
                        onChange={(event) => void toggle(row, event.target.checked)}
                        className="size-4 accent-[#00BF63] disabled:cursor-not-allowed disabled:opacity-40"
                      />
                    </TableCell>
                    <TableCell className="font-medium">{row.patientName}</TableCell>
                    <TableCell>{row.unitName}</TableCell>
                    <TableCell>{dateLabel(row.dueDate)}</TableCell>
                    <TableCell className="font-semibold">{money(row.amount)}</TableCell>
                    <TableCell>{row.phone || <span className="text-[#a05a48]">Não informado</span>}</TableCell>
                    <TableCell>
                      {approved ? (
                        <span className="inline-flex rounded-full bg-[#e7f7ee] px-2.5 py-1 text-xs font-semibold text-[#26734f]">
                          Aprovado · aguardando envio
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-[#f4f5f2] px-2.5 py-1 text-xs font-semibold text-[#66736b]">
                          Aguardando aprovação
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <div className="grid min-h-44 place-items-center text-sm text-[#7d8982]">Nenhum lembrete nesta data.</div>
        )}
      </section>

      <section className="surface-card overflow-hidden rounded-[24px]">
        <div className="border-b border-[#e7ebe7] p-5 md:px-6">
          <div className="flex items-center gap-3">
            <ShieldOff className="size-5 text-[#a05a48]" />
            <div>
              <h3 className="font-display text-lg font-semibold text-[#192820]">Exceções permanentes</h3>
              <p className="mt-1 text-sm text-[#718078]">Quem você desmarcar fica fora das listas futuras.</p>
            </div>
          </div>
        </div>

        {exceptions.length ? (
          <div className="divide-y divide-[#edf0ed]">
            {exceptions.map((patient) => (
              <div key={patient.id} className="flex items-center justify-between gap-4 px-5 py-4 md:px-6">
                <div>
                  <p className="font-medium">{patient.full_name}</p>
                  <p className="mt-1 text-xs text-[#87928c]">{patient.reminder_opt_out_reason || "Exceção de lembrete"}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => void restore(patient.id)}>
                  Remover exceção
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-6 text-sm text-[#7d8982]">Nenhuma exceção cadastrada.</div>
        )}
      </section>
    </div>
  );
}

function Metric({ value, label }: { value: string | number; label: string }) {
  return (
    <article className="surface-card rounded-[22px] p-5">
      <p className="font-display text-3xl font-semibold text-[#192820]">{value}</p>
      <p className="mt-2 text-sm text-[#718078]">{label}</p>
    </article>
  );
}
