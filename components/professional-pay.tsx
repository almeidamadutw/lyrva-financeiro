"use client";

import { useEffect, useState, type FormEvent } from "react";
import { LoaderCircle, Plus } from "lucide-react";
import { toast } from "sonner";

import { AttendancePriceCalculator, DeliveryPriceFields, normalizePayItemName } from "@/components/professional-pay-calculator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  attendanceLabels,
  formatAttendanceDay,
  formatPayAmount,
  isAttendanceSaturday,
  payCents,
  payMonthDays,
  payToday,
  pricedAttendanceTotal,
  serviceLabels,
} from "@/lib/professional-pay";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database, Json, ProfessionalAttendance, ProfessionalAttendancePriceItem, ProfessionalPayMode, ProfessionalPayUnit } from "@/lib/supabase/database.types";

type Profile = Database["public"]["Tables"]["professional_pay_profiles"]["Row"];
type Rule = Database["public"]["Tables"]["professional_pay_rules"]["Row"];
type History = Database["public"]["Tables"]["professional_attendance_history"]["Row"];
type AttendanceAction = Database["public"]["Functions"]["save_professional_attendance"]["Args"]["p_action"];
type MonthData = { profiles: Profile[]; rows: ProfessionalAttendance[] };
type AttendanceTotals = { pending: number; validated: number; paid: number; awaitingApproval: number };

const selectClass = "h-9 w-full rounded-md border border-input bg-white px-3 text-sm";
const emptyTotals: AttendanceTotals = { pending: 0, validated: 0, paid: 0, awaitingApproval: 0 };
const statusClasses = {
  pending: "border-amber-200 bg-amber-50 text-amber-900",
  validated: "border-sky-200 bg-sky-50 text-sky-900",
  paid: "border-emerald-200 bg-emerald-50 text-emerald-900",
  cancelled: "border-stone-200 bg-stone-100 text-stone-700",
};
const historyDate = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
const dateLabel = (date: string) => date.split("-").reverse().join("/");
const editableAmount = (cents: number | null | undefined) => cents == null ? "" : (cents / 100).toFixed(2).replace(".", ",");
const awaitsApproval = (row: ProfessionalAttendance) => row.status === "validated" && !row.approved_at;

function failMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "Tente novamente em instantes.";
}

async function listMonth(unitId: number, month: string): Promise<MonthData> {
  const supabase = getSupabaseBrowserClient();
  const days = payMonthDays(month);
  const profiles: Profile[] = [];
  const rows: ProfessionalAttendance[] = [];
  const pageSize = 500;

  const loadProfiles = async () => {
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase.from("professional_pay_profiles").select("*")
        .eq("unit_id", unitId).order("name").order("id").range(offset, offset + pageSize - 1);
      if (error) throw error;
      profiles.push(...data);
      if (data.length < pageSize) return;
    }
  };
  const loadRows = async () => {
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase.from("professional_attendance").select("*")
        .eq("unit_id", unitId).gte("work_date", days[0]).lte("work_date", days[days.length - 1])
        .order("id").range(offset, offset + pageSize - 1);
      if (error) throw error;
      rows.push(...data);
      if (data.length < pageSize) return;
    }
  };
  await Promise.all([loadProfiles(), loadRows()]);
  return { profiles, rows };
}

async function readRule(unitId: number, professionalId: number, workDate?: string) {
  let query = getSupabaseBrowserClient().from("professional_pay_rules").select("*")
    .eq("unit_id", unitId).eq("professional_id", professionalId);
  if (workDate) query = query.lte("effective_from", workDate);
  const { data, error } = await query.order("effective_from", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

function Status({ row }: { row?: ProfessionalAttendance }) {
  if (!row) return <span className="text-muted-foreground">Em branco</span>;
  const awaiting = awaitsApproval(row);
  return <Badge variant="outline" className={statusClasses[awaiting ? "pending" : row.status]}>
    {awaiting ? "Aguardando aprovação" : attendanceLabels[row.status]}
  </Badge>;
}

export function ProfessionalPayView({ units }: { units: ProfessionalPayUnit[] }) {
  const [unitId, setUnitId] = useState(units[0]?.id);
  const [month, setMonth] = useState(() => payToday().slice(0, 7));
  const [showAll, setShowAll] = useState(false);
  const unit = units.find((item) => item.id === unitId) ?? units[0];
  if (!unit) return null;

  return (
    <div className="space-y-5">
      <section className="surface-card flex flex-wrap gap-4 rounded-[24px] p-5">
        <div className="w-full space-y-1.5 sm:w-56">
          <Label htmlFor="professional-pay-unit">Unidade</Label>
          <select id="professional-pay-unit" className={selectClass} value={unit.id} onChange={(event) => setUnitId(Number(event.target.value))}>
            {units.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
        <div className="w-full space-y-1.5 sm:w-48">
          <Label htmlFor="professional-pay-month">Competência</Label>
          <Input id="professional-pay-month" type="month" value={month} min="2000-01" max={payToday().slice(0, 7)}
            onChange={(event) => {
              const value = event.target.value;
              if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value >= "2000-01" && value <= payToday().slice(0, 7)) setMonth(value);
            }} />
        </div>
      </section>
      <MonthlyAttendance key={unit.id + ":" + month} unit={unit} month={month} showAll={showAll} setShowAll={setShowAll} />
    </div>
  );
}

function MonthlyAttendance({ unit, month, showAll, setShowAll }: {
  unit: ProfessionalPayUnit; month: string; showAll: boolean; setShowAll: (value: boolean) => void;
}) {
  const [data, setData] = useState<MonthData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [professionalId, setProfessionalId] = useState<number>();
  const [ruleDialog, setRuleDialog] = useState<"new" | "edit" | null>(null);
  const [openDate, setOpenDate] = useState<string | null>(null);
  const openProfessional = (id: number) => {
    setProfessionalId(id);
    setShowAll(false);
  };
  const refresh = () => {
    setLoading(true);
    setError("");
    setReload((value) => value + 1);
  };

  useEffect(() => {
    let active = true;
    void listMonth(unit.id, month).then(
      (result) => { if (active) setData(result); },
      () => { if (active) setError("Não foi possível carregar a folha desta unidade."); },
    ).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [unit.id, month, reload]);

  if (loading) return <div role="status" className="surface-card flex items-center gap-3 rounded-[24px] p-5"><LoaderCircle className="size-4 animate-spin" /> Carregando folha de ponto…</div>;
  if (error || !data) {
    return <section role="alert" className="surface-card flex flex-wrap items-center gap-3 rounded-[24px] p-5">
      {error} <Button variant="outline" size="sm" onClick={refresh}>Tentar novamente</Button>
    </section>;
  }

  const professional = showAll ? undefined : (data.profiles.find((item) => item.id === professionalId) ?? data.profiles[0]);
  const rowsByDate = new Map<string, ProfessionalAttendance>();
  const totals = { ...emptyTotals };
  const totalsByProfessional = new Map<number, AttendanceTotals>();
  for (const row of data.rows) {
    if (row.professional_id === professional?.id) rowsByDate.set(row.work_date, row);
    if (row.status === "cancelled") continue;
    const value = row.status === "pending" ? 1 : (row.amount_cents ?? 0);
    totals[row.status] += value;
    const subtotal = totalsByProfessional.get(row.professional_id) ?? { ...emptyTotals };
    subtotal[row.status] += value;
    if (awaitsApproval(row)) {
      totals.awaitingApproval += value;
      subtotal.awaitingApproval += value;
    }
    totalsByProfessional.set(row.professional_id, subtotal);
  }
  const professionalTotals = professional ? (totalsByProfessional.get(professional.id) ?? emptyTotals) : emptyTotals;
  const summaryCards = [
    { label: "Pendentes de conferência", value: totals.pending, awaitingApproval: 0 },
    { label: "A pagar na unidade", value: formatPayAmount(totals.validated), awaitingApproval: totals.awaitingApproval },
    ...(professional ? [{ label: "A pagar para o profissional", value: formatPayAmount(professionalTotals.validated), awaitingApproval: professionalTotals.awaitingApproval }] : []),
    { label: "Pago na unidade", value: formatPayAmount(totals.paid), awaitingApproval: 0 },
  ];
  const today = payToday();

  return (
    <>
      <dl aria-label="Totais de diárias na competência" className={"grid gap-3 " + (professional ? "sm:grid-cols-2 xl:grid-cols-4" : "sm:grid-cols-3")}>
        {summaryCards.map((item) => (
          <div key={item.label} className="surface-card rounded-[20px] p-4">
            <dt className="text-sm text-muted-foreground">{item.label}</dt>
            <dd className="mt-1">
              <span className="font-display text-xl font-semibold tabular-nums">{item.value}</span>
              {item.awaitingApproval > 0 && <span className="block text-xs text-muted-foreground">{formatPayAmount(item.awaitingApproval)} aguardando aprovação</span>}
            </dd>
          </div>
        ))}
      </dl>
      <section className="surface-card overflow-hidden rounded-[24px]">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b p-5">
          {data.profiles.length > 0 ? (
            <div className="w-full space-y-1.5 sm:w-64">
              <Label htmlFor="professional-pay-profile">Profissional</Label>
              <select id="professional-pay-profile" className={selectClass} value={showAll ? "all" : professional?.id}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === "all") setShowAll(true);
                  else openProfessional(Number(value));
                }}>
                <option value="all">Todos</option>
                {data.profiles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              {professional && <p className="text-xs text-muted-foreground">Pago para o profissional {formatPayAmount(professionalTotals.paid)}</p>}
            </div>
          ) : <p className="text-sm text-muted-foreground">Nenhum profissional cadastrado nesta unidade.</p>}
          <div className="flex flex-wrap gap-2">
            {professional && <Button variant="outline" onClick={() => setRuleDialog("edit")}>Regra de remuneração</Button>}
            <Button onClick={() => setRuleDialog("new")}><Plus /> Cadastrar profissional</Button>
          </div>
        </div>
        {showAll && data.profiles.length > 0 && (
          <Table className="min-w-[580px]" aria-label="Resumo de diárias por profissional">
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead className="pl-5">Profissional</TableHead>
                <TableHead className="text-right">Dias pendentes</TableHead>
                <TableHead className="text-right">A pagar</TableHead>
                <TableHead className="text-right">Pago</TableHead>
                <TableHead className="pr-5 text-right"><span className="sr-only">Ação</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.profiles.map((profile) => {
                const subtotal = totalsByProfessional.get(profile.id) ?? emptyTotals;
                return <TableRow key={profile.id}>
                  <TableCell className="pl-5 font-medium">{profile.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{subtotal.pending}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatPayAmount(subtotal.validated)}
                    {subtotal.awaitingApproval > 0 && <span className="block text-xs text-muted-foreground">{formatPayAmount(subtotal.awaitingApproval)} aguardando aprovação</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatPayAmount(subtotal.paid)}</TableCell>
                  <TableCell className="pr-5 text-right">
                    <Button variant="outline" size="sm" aria-label={"Abrir folha de " + profile.name}
                      onClick={() => openProfessional(profile.id)}>Abrir folha</Button>
                  </TableCell>
                </TableRow>;
              })}
            </TableBody>
          </Table>
        )}
        {professional && (
          <Table className="min-w-[630px]">
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead className="pl-5">Dia</TableHead>
                <TableHead>Assinaturas</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="pr-5 text-right"><span className="sr-only">Ação</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payMonthDays(month).map((date) => {
                const row = rowsByDate.get(date);
                return <TableRow key={date}>
                  <TableCell className="pl-5 font-medium">{formatAttendanceDay(date)}</TableCell>
                  <TableCell>{row ? Number(row.professional_signed) + Number(row.finance_signed) + " de 2" : "—"}</TableCell>
                  <TableCell><Status row={row} /></TableCell>
                  <TableCell className="text-right tabular-nums">{row?.amount_cents ? formatPayAmount(row.amount_cents) : "—"}</TableCell>
                  <TableCell className="pr-5 text-right">
                    {date <= today && <Button variant="outline" size="sm" aria-label={(row ? "Ver" : "Lançar") + " dia " + dateLabel(date)}
                      onClick={() => setOpenDate(date)}>{row ? "Ver dia" : "Lançar"}</Button>}
                  </TableCell>
                </TableRow>;
              })}
            </TableBody>
          </Table>
        )}
      </section>
      {ruleDialog && <RuleDialog unit={unit} profile={ruleDialog === "edit" ? professional : undefined}
        onClose={() => setRuleDialog(null)} onSaved={(id) => { openProfessional(id); setRuleDialog(null); refresh(); }} />}
      {professional && openDate && <AttendanceDialog unit={unit} profile={professional} date={openDate}
        row={rowsByDate.get(openDate)} onClose={() => { setOpenDate(null); refresh(); }}
        onSaved={() => { setOpenDate(null); refresh(); }} />}
    </>
  );
}

function RuleDialog({ unit, profile, onClose, onSaved }: {
  unit: ProfessionalPayUnit; profile?: Profile; onClose: () => void; onSaved: (id: number) => void;
}) {
  const [mode, setMode] = useState<ProfessionalPayMode>("daily");
  const [previous, setPrevious] = useState<Rule | null>(null);
  const [loading, setLoading] = useState(Boolean(profile));
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const profileId = profile?.id;

  useEffect(() => {
    if (!profileId) return;
    let active = true;
    void readRule(unit.id, profileId).then((rule) => {
      if (active) {
        setPrevious(rule);
        if (rule) setMode(rule.mode);
      }
    }, () => { if (active) setLoadError("Não foi possível carregar a regra atual."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [unit.id, profileId]);

  async function saveRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    const daily = String(fields.get("daily") ?? "");
    const planning = String(fields.get("planning") ?? "");
    const saturday = String(fields.get("saturday") ?? "");
    if (mode === "daily" && (!payCents(daily) || (planning.trim() && !payCents(planning)) || (saturday.trim() && !payCents(saturday)))) {
      setSaveError("Informe valores positivos em reais. Use vírgula para os centavos.");
      return;
    }
    const deliveryPrices = fields.getAll("delivery-price");
    const priceItems = fields.getAll("delivery-name").map((entry, index) => ({
      name: normalizePayItemName(entry.toString()),
      unit_cents: payCents(deliveryPrices[index]?.toString() ?? ""),
    }));
    if (priceItems.some((item) => item.name.length < 2 || !item.unit_cents)
      || new Set(priceItems.map((item) => item.name.toLowerCase())).size !== priceItems.length) {
      setSaveError("Informe nomes diferentes e valores positivos para as entregas.");
      return;
    }
    setBusy(true);
    setSaveError("");
    try {
      const { data, error } = await getSupabaseBrowserClient().rpc("save_professional_pay_rule", {
        p_unit_id: unit.id,
        p_input: {
          professional_id: profile?.id ?? null,
          name: fields.get("name")?.toString() ?? null,
          effective_from: fields.get("effective")?.toString() ?? null,
          mode,
          daily_cents: mode === "daily" ? payCents(daily) : null,
          planning_cents: mode === "daily" ? payCents(planning) : null,
          saturday_cents: mode === "daily" ? payCents(saturday) : null,
          price_items: priceItems,
        },
      });
      if (error) throw error;
      toast.success(profile ? "Nova regra salva" : "Profissional cadastrado");
      onSaved(data);
    } catch (error) {
      setSaveError(failMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{profile ? "Regra de remuneração" : "Cadastrar profissional"}</DialogTitle>
          <DialogDescription>{profile ? profile.name + " · " + unit.name : unit.name}</DialogDescription>
        </DialogHeader>
        {loading && <p role="status" className="text-sm">Carregando regra…</p>}
        {loadError && <p role="alert" className="text-sm text-destructive">{loadError}</p>}
        {!loading && !loadError && <form onSubmit={saveRule} className="space-y-4">
          {!profile && <div className="space-y-1.5"><Label htmlFor="pay-profile-name">Nome do profissional</Label>
            <Input name="name" id="pay-profile-name" minLength={2} maxLength={120} required /></div>}
          <div className="space-y-1.5"><Label htmlFor="pay-mode">Forma de remuneração</Label>
            <select id="pay-mode" className={selectClass} value={mode} onChange={(event) => setMode(event.target.value as ProfessionalPayMode)}>
              <option value="daily">Diária</option><option value="procedure">Por procedimento</option><option value="delivery">Por entrega</option>
            </select>
          </div>
          <div className="space-y-1.5"><Label htmlFor="pay-effective">Válida a partir de</Label>
            <Input name="effective" id="pay-effective" type="date" min="2000-01-01" max="2099-12-31" defaultValue={payToday()} required />
            {previous && <p className="text-xs text-muted-foreground">Última regra cadastrada com vigência em {dateLabel(previous.effective_from)}.</p>}
          </div>
          {mode === "daily" && <div className="space-y-3">
            <MoneyField id="pay-daily" name="daily" label="Valor da diária (R$)" initial={previous?.daily_cents} required />
            <MoneyField id="pay-planning" name="planning" label="Planejamento (R$, opcional)" initial={previous?.planning_cents} />
            <MoneyField id="pay-saturday" name="saturday" label="Sábado (R$, opcional)" initial={previous?.saturday_cents} />
          </div>}
          {mode === "delivery" && <DeliveryPriceFields items={previous?.price_items ?? []} />}
          {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
          <div className="flex justify-end"><Button disabled={busy} type="submit">{busy ? "Salvando…" : "Salvar regra"}</Button></div>
        </form>}
      </DialogContent>
    </Dialog>
  );
}

function MoneyField({ id, name, label, initial, required }: {
  id: string; name: string; label: string; initial?: number | null; required?: boolean;
}) {
  return <div className="space-y-1.5">
    <Label htmlFor={id}>{label}</Label>
    <Input id={id} name={name} inputMode="decimal" placeholder="0,00" defaultValue={editableAmount(initial)} required={required} maxLength={14} />
  </div>;
}

function AttendanceDialog({ unit, profile, date, row, onClose, onSaved }: {
  unit: ProfessionalPayUnit; profile: Profile; date: string; row?: ProfessionalAttendance;
  onClose: () => void; onSaved: () => void;
}) {
  const editable = !row || row.status === "pending";
  const [rule, setRule] = useState<Rule | null>(null);
  const [history, setHistory] = useState<History[]>([]);
  const [historyError, setHistoryError] = useState(false);
  const [planning, setPlanning] = useState(row?.service_kind === "planning");
  const [professionalSigned, setProfessionalSigned] = useState(row?.professional_signed ?? false);
  const [financeSigned, setFinanceSigned] = useState(row?.finance_signed ?? false);
  const [notes, setNotes] = useState(row?.notes ?? "");
  const [amount, setAmount] = useState(editableAmount(row?.proposed_amount_cents));
  const [appliedItems, setAppliedItems] = useState<ProfessionalAttendancePriceItem[]>(row?.priced_items ?? []);
  const [appliedMode, setAppliedMode] = useState(row?.service_kind);
  const [loading, setLoading] = useState(editable);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<"pay" | "reopen" | "cancel" | null>(null);
  const attendanceId = row?.id;
  const professionalId = profile.id;

  useEffect(() => {
    let active = true;
    if (editable) {
      void readRule(unit.id, professionalId, date).then(
        (value) => { if (active) setRule(value); },
        () => { if (active) setLoadError("Não foi possível consultar a regra de remuneração."); },
      ).finally(() => { if (active) setLoading(false); });
    }
    if (attendanceId) {
      void getSupabaseBrowserClient().from("professional_attendance_history").select("*")
        .eq("unit_id", unit.id).eq("attendance_id", attendanceId).order("id", { ascending: false })
        .then(({ data, error }) => {
          if (active) {
            setHistoryError(Boolean(error));
            setHistory(data ?? []);
          }
        });
    }
    return () => { active = false; };
  }, [unit.id, professionalId, date, editable, attendanceId]);

  const hasPlanning = rule?.mode === "daily" && rule.planning_cents !== null;
  const selectedPlanning = hasPlanning && planning;
  const hasSaturday = rule?.mode === "daily" && rule.saturday_cents !== null && isAttendanceSaturday(date);
  const service = rule?.mode === "daily" ? (selectedPlanning ? "planning" : hasSaturday ? "saturday" : "daily") : rule?.mode;
  const fixedAmount = selectedPlanning ? rule?.planning_cents : hasSaturday ? rule?.saturday_cents : rule?.daily_cents;
  const variableMode = rule?.mode === "daily" ? undefined : rule?.mode;
  const catalog = rule?.price_items ?? [];
  const outdatedItems = Boolean(variableMode && appliedItems.length && (appliedMode !== variableMode
    || (variableMode === "delivery" && appliedItems.some((item) => !catalog.some((price) => price.name === item.name && price.unit_cents === item.unit_cents)))));
  const currentItems = variableMode && !outdatedItems ? appliedItems : [];
  const calculatedAmount = currentItems.length ? pricedAttendanceTotal(currentItems) : null;
  const allowManual = (variableMode === "delivery" && !catalog.length)
    || (variableMode === "procedure" && row?.service_kind === "procedure" && Boolean(row.proposed_amount_cents) && !row.priced_items?.length);
  const amountCents = calculatedAmount ?? (allowManual ? payCents(amount) : null);
  const invalidManualAmount = Boolean(allowManual && calculatedAmount === null && amount.trim() && !amountCents);
  const canValidate = !busy && professionalSigned && financeSigned && !outdatedItems
    && (!variableMode || Boolean(amountCents && notes.trim()));

  async function save(nextAction: AttendanceAction, extra: Record<string, Json> = {}) {
    if (busy) return;
    setBusy(true);
    setSaveError("");
    try {
      const { error } = await getSupabaseBrowserClient().rpc("save_professional_attendance", {
        p_unit_id: unit.id,
        p_action: nextAction,
        p_input: {
          professional_id: profile.id,
          work_date: date,
          revision: row?.revision ?? 0,
          rule_id: rule?.id ?? null,
          planning: selectedPlanning,
          professional_signed: professionalSigned,
          finance_signed: financeSigned,
          notes,
          amount_cents: amountCents,
          priced_items: currentItems,
          ...extra,
        },
      });
      if (error) throw error;
      const messages = { pending: "Pendência salva", validate: "Comparecimento enviado para aprovação", pay: "Pagamento registrado", reopen: "Dia reaberto", cancel: "Lançamento cancelado" };
      toast.success(messages[nextAction]);
      onSaved();
    } catch (error) {
      setSaveError(failMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action) return;
    const fields = new FormData(event.currentTarget);
    void save(action, {
      paid_on: fields.get("paid_on")?.toString() ?? null,
      payment_reference: fields.get("payment_reference")?.toString() ?? null,
      reason: fields.get("reason")?.toString() ?? null,
    });
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{profile.name}</DialogTitle>
          <DialogDescription>{dateLabel(date)} · {unit.name}</DialogDescription>
        </DialogHeader>
        {row && <div className="flex flex-wrap items-center gap-3 text-sm">
          <Status row={row} />
          {!editable && <span>{serviceLabels[row.service_kind]}</span>}
          {row.amount_cents && <strong className="tabular-nums">{formatPayAmount(row.amount_cents)}</strong>}
        </div>}
        {row?.paid_on && <p className="text-sm">Pagamento em {dateLabel(row.paid_on)}{row.payment_reference && " · " + row.payment_reference}</p>}
        {!editable && row?.notes && <p className="text-sm">{row.notes}</p>}
        {!editable && Boolean(row?.priced_items?.length) && <ul className="space-y-1 text-sm text-muted-foreground">
          {row?.priced_items.map((item) => <li key={item.name}>{item.quantity} × {item.name} · {formatPayAmount(item.unit_cents)} cada</li>)}
        </ul>}
        {loading && <p role="status" className="text-sm">Consultando regra da data…</p>}
        {loadError && <p role="alert" className="text-sm text-destructive">{loadError}</p>}
        {editable && !loading && !loadError && !rule && <p className="text-sm">Cadastre uma regra com vigência nesta data para lançar o comparecimento.</p>}
        {editable && rule && !action && <form className="space-y-4" onSubmit={(event) => {
          event.preventDefault();
          if (canValidate) void save("validate");
        }}>
          <p className="text-sm">{service && serviceLabels[service]}{fixedAmount && " · " + formatPayAmount(fixedAmount)}</p>
          {hasPlanning && <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={planning} onChange={(event) => setPlanning(event.target.checked)} /> Dia de planejamento
          </label>}
          <fieldset className="space-y-2 rounded-xl border p-3">
            <legend className="px-1 text-sm font-medium">Assinaturas na folha física</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={professionalSigned} onChange={(event) => setProfessionalSigned(event.target.checked)} /> Assinatura do profissional conferida
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={financeSigned} onChange={(event) => setFinanceSigned(event.target.checked)} /> Visto do financeiro conferido
            </label>
          </fieldset>
          {variableMode && <div className="space-y-1.5">
            <Label htmlFor="attendance-amount">Valor total conferido no dia (R$)</Label>
            <Input id="attendance-amount" inputMode="decimal" placeholder="0,00" value={calculatedAmount !== null ? editableAmount(calculatedAmount) : allowManual ? amount : ""}
              maxLength={14} readOnly={!allowManual || calculatedAmount !== null} onChange={(event) => setAmount(event.target.value)} />
            <AttendancePriceCalculator mode={variableMode} unitId={unit.id} professionalId={profile.id} catalog={catalog}
              appliedItems={currentItems} disabled={busy} onApply={(items) => { setAppliedItems(items); setAppliedMode(variableMode); }} />
            {currentItems.length > 0 && <p className="text-xs text-muted-foreground">{currentItems.map((item) => `${item.quantity} × ${item.name}`).join(" · ")}</p>}
            {outdatedItems && <p role="alert" className="text-xs text-destructive">A regra mudou. Calcule o valor novamente com os itens da regra atual.</p>}
            {outdatedItems && !catalog.length && variableMode === "delivery" && <Button type="button" size="sm" variant="outline"
              onClick={() => { setAppliedItems([]); setAmount(""); }}>Limpar cálculo anterior</Button>}
            {invalidManualAmount && <p className="text-xs text-destructive">Informe um valor positivo. Use vírgula para os centavos.</p>}
          </div>}
          <div className="space-y-1.5"><Label htmlFor="attendance-notes">{variableMode ? "Procedimentos ou entregas conferidos" : "Observação (opcional)"}</Label>
            <Textarea id="attendance-notes" value={notes} maxLength={600} onChange={(event) => setNotes(event.target.value)} />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy || outdatedItems || invalidManualAmount} onClick={() => void save("pending")}>Salvar pendência</Button>
            <Button type="submit" disabled={!canValidate}>
              {busy ? "Salvando…" : "Validar comparecimento"}
            </Button>
          </div>
        </form>}
        {row && !action && row.status !== "paid" && <div className="flex flex-wrap justify-end gap-2">
          {(row.status === "validated" || row.status === "cancelled") && <Button variant="outline" disabled={busy} onClick={() => { setSaveError(""); setAction("reopen"); }}>Reabrir dia</Button>}
          {row.status !== "cancelled" && <Button variant="ghost" disabled={busy} onClick={() => { setSaveError(""); setAction("cancel"); }}>Cancelar lançamento</Button>}
          {row.status === "validated" && row.approved_at && <Button disabled={busy} onClick={() => { setSaveError(""); setAction("pay"); }}>Registrar pagamento</Button>}
        </div>}
        {action && <form onSubmit={confirm} className="space-y-4 rounded-xl border p-3">
          {action === "pay" ? <>
            <div className="space-y-1.5"><Label htmlFor="attendance-paid-on">Data do pagamento efetuado</Label>
              <Input id="attendance-paid-on" name="paid_on" type="date" min={date} max={payToday()} defaultValue={payToday()} required />
            </div>
            <div className="space-y-1.5"><Label htmlFor="attendance-reference">Referência do comprovante (opcional)</Label>
              <Input id="attendance-reference" name="payment_reference" maxLength={180} />
            </div>
          </> : <div className="space-y-1.5"><Label htmlFor="attendance-reason">{action === "cancel" ? "Motivo do cancelamento" : "Motivo da reabertura"}</Label>
            <Textarea id="attendance-reason" name="reason" required maxLength={600} />
          </div>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => { setAction(null); setSaveError(""); }}>Voltar</Button>
            <Button type="submit" disabled={busy}>{busy ? "Salvando…" : action === "pay" ? "Confirmar pagamento" : action === "cancel" ? "Confirmar cancelamento" : "Confirmar reabertura"}</Button>
          </div>
        </form>}
        {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
        {historyError && <p role="alert" className="text-sm text-destructive">Não foi possível carregar o histórico.</p>}
        {history.length > 0 && <details className="border-t pt-3 text-sm">
          <summary className="cursor-pointer font-medium">Histórico deste dia</summary>
          <ol className="mt-2 space-y-2">
            {history.map((entry) => <li key={entry.id} className="text-muted-foreground">
              {historyDate.format(new Date(entry.occurred_at))} · {entry.actor_name} · {entry.snapshot.approval_event === "approved" ? "Diária aprovada" : entry.snapshot.status === "validated" ? "Comparecimento validado" : attendanceLabels[entry.snapshot.status]}
              {entry.snapshot.amount_cents && " · " + formatPayAmount(entry.snapshot.amount_cents)}
              {entry.snapshot.change_reason && <p>{entry.snapshot.change_reason}</p>}
            </li>)}
          </ol>
        </details>}
      </DialogContent>
    </Dialog>
  );
}
