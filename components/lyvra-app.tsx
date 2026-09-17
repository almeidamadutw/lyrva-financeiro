"use client";

import { accessAuth } from "@/lib/access-auth";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  AlertCircle,
  Bell,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Database,
  FileSpreadsheet,
  FileText,
  Eye,
  EyeOff,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  LogIn,
  LogOut,
  Mail,
  MessageCircle,
  MoreHorizontal,
  ReceiptText,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  UserCog,
  Users,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Toaster } from "@/components/ui/sonner";
import { LYVRA_ICON_DATA_URL } from "@/lib/lyvra-icon-data";
import { CollectionsJourney } from "@/components/collections-journey";
import { FinancialJourney } from "@/components/financial-journey";
import { FinancialNotifications } from "@/components/financial-notifications";
import { DueTaskAlert } from "@/components/due-task-alert";
import { ManualPatientDialog } from "@/components/manual-patient-dialog";
import { WorkbookImportHub } from "@/components/workbook-import-hub";
import { PaymentReminderReview } from "@/components/payment-reminder-review";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type View = "dashboard" | "journey" | "reminders" | "invoices" | "collections" | "patients" | "import" | "access" | "support" | "integrations";
type Role = "membro" | "gestora" | "ceo" | "suporte";
type OperationalArea = "none" | "reminders" | "collections" | "invoices" | "management" | "support";

type UserAccount = {
  id: string;
  name: string;
  email: string;
  role: Role;
  operationalArea: OperationalArea;
  canManageCollections: boolean;
};

type Patient = {
  id?: number;
  clinicorpId?: string | null;
  name: string;
  cpf?: string | null;
  phone?: string | null;
  email?: string | null;
  unit: string;
  treatment?: string | null;
  paymentMethod?: string | null;
  planAmountCents?: number;
  installmentAmountCents?: number;
  startDate?: string | null;
  endDate?: string | null;
  installments?: number | null;
  dueDay?: number | null;
  taxReceiptIr?: boolean | number;
  invoiceFrequency?: string;
  invoiceScheduleMode?: string | null;
  firstInvoiceDate?: string | null;
  invoiceIntervalMonths?: number | null;
  invoiceRecipientName?: string | null;
  invoiceDisabled?: boolean;
  invoiceDisabledReason?: string | null;
  notes?: string | null;
  settledAt?: string | null;
  settledReason?: string | null;
  reminderOptOut?: boolean;
  reminderOptOutReason?: string | null;
};

type InvoiceObligation = {
  id: number;
  patient: string;
  initials: string;
  unit: string;
  reference: string;
  amount: string;
  amountValue: number;
  status: string;
  tone: "ready" | "waiting" | "cycle" | "issue" | "done";
  rawStatus: string;
  frequency: string;
  scheduledIssueDate?: string | null;
  ruleCode?: string | null;
  issuedAmount?: number;
  issuedAt?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  sourceType?: string | null;
};

type ClinicorpUnitCode = "sorocaba" | "salto_de_pirapora";

type ClinicorpPaymentSummary = {
  totalRows: number;
  uniquePatients: number;
  totalAmount: number;
  rowsWithDueDate: number;
  rowsWithReceivedDate: number;
  rowsWithConfirmedDate: number;
  paymentReceivedValues: string[];
  paymentConfirmedValues: string[];
  paymentForms: string[];
  fieldNames: string[];
};

type ClinicorpMappingSummary = {
  supportedMethods: string[];
  eligiblePlans: number;
  eligiblePatients: number;
  eligibleInstallments: number;
  eligibleReceipts: number;
  skippedInstallments: number;
  skippedReceipts: number;
  postedByMethod: { boleto: number; card: number; ignored: number };
  receivedByMethod: { boleto: number; card: number; ignored: number };
};

type ClinicorpFunctionResponse = {
  ok: boolean;
  code?: string;
  message?: string;
  credentialsConfigured?: boolean;
  connection?: {
    status: string;
    subscriberId?: string | null;
    businessId?: string | null;
    businessName?: string | null;
    lastSyncAt?: string | null;
    lastError?: string | null;
  } | null;
  preview?: {
    posted: ClinicorpPaymentSummary;
    received: ClinicorpPaymentSummary;
    mapping: ClinicorpMappingSummary;
  };
  sync?: {
    processedCount: number;
    createdCount: number;
    updatedCount: number;
    skippedCount: number;
    failedCount: number;
    paidInstallments: number;
  };
  bootstrap?: boolean;
  alreadyComplete?: boolean;
  windows?: number;
  from?: string;
  to?: string;
};

const navItems: { id: View; label: string; icon: typeof LayoutDashboard; badge?: string }[] = [
  { id: "dashboard", label: "Visão geral", icon: LayoutDashboard },
  { id: "journey", label: "Jornada financeira", icon: Sparkles },
  { id: "reminders", label: "Lembretes de boleto", icon: Bell },
  { id: "invoices", label: "Notas fiscais", icon: FileText },
  { id: "collections", label: "Régua de cobrança", icon: WalletCards },
  { id: "patients", label: "Pacientes", icon: Users },
  { id: "import", label: "Importar planilha", icon: FileSpreadsheet },
  { id: "access", label: "Gerenciar acessos", icon: UserCog },
  { id: "support", label: "Central de suporte", icon: Settings },
  { id: "integrations", label: "Integrações", icon: Link2 },
];

const roleLabels: Record<Role, string> = {
  membro: "Membro",
  gestora: "Gestora",
  ceo: "CEO",
  suporte: "Suporte",
};

const viewTitles: Record<View, { eyebrow: string; title: string }> = {
  dashboard: { eyebrow: "Confira primeiro o que precisa de ação", title: "Visão geral" },
  journey: { eyebrow: "Execute as tarefas pela data de vencimento", title: "Jornada financeira" },
  reminders: { eyebrow: "Revise a lista antes de autorizar qualquer envio", title: "Lembretes de boleto" },
  invoices: { eyebrow: "Emita e marque como concluída somente após emitir", title: "Notas fiscais" },
  collections: { eyebrow: "Registre cada contato antes de seguir para o próximo", title: "Régua de cobrança" },
  patients: { eyebrow: "Pesquise antes de cadastrar para evitar duplicidade", title: "Pacientes" },
  import: { eyebrow: "Revise paciente e unidade antes de confirmar", title: "Importar planilha" },
  access: { eyebrow: "Libere somente as telas necessárias para cada função", title: "Gerenciar acessos" },
  support: { eyebrow: "Use esta área para acessos e problemas de integração", title: "Central de suporte" },
  integrations: { eyebrow: "Sincronize uma unidade por vez e confira o resultado", title: "Integrações" },
};

const areaLabels: Record<OperationalArea, string> = {
  none: "Sem rotina definida",
  reminders: "Lembretes D-1",
  collections: "Régua de cobrança",
  invoices: "Notas fiscais",
  management: "Gestão financeira",
  support: "Suporte técnico",
};

const allowedViewsFor = (user: UserAccount) => {
  const financialViews: View[] = ["dashboard", "journey", "reminders", "invoices", "collections", "patients", "import"];
  const supportViews: View[] = ["support", "access", "integrations"];
  return new Set<View>(user.role === "suporte" || user.operationalArea === "support" ? supportViews : financialViews);
};

const defaultViewFor = (user: UserAccount): View => {
  if (user.operationalArea === "support") return "support";
  if (user.operationalArea === "collections") return "collections";
  if (user.operationalArea === "reminders") return "reminders";
  if (user.operationalArea === "invoices") return "invoices";
  if (user.operationalArea === "management") return "dashboard";
  return "patients";
};

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const money = (cents = 0) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const moneyValue = (value = 0) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const formatIsoDate = (value?: string | null) => value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`)) : "—";
const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "");

const clinicorpUnits: { code: ClinicorpUnitCode; name: string }[] = [
  { code: "sorocaba", name: "Sorocaba" },
  { code: "salto_de_pirapora", name: "Salto de Pirapora" },
];

const clinicorpStatusLabel = (response?: ClinicorpFunctionResponse | null) => {
  if (!response) return "Consultando";
  if (response.connection?.status === "connected") return "Conectado";
  if (response.connection?.status === "error") return "Atenção necessária";
  if (response.credentialsConfigured) return "Pronto para validar";
  return "Aguardando credenciais";
};

const saoPauloDate = (date: Date) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(date);

async function clinicorpErrorMessage(error: unknown) {
  if (error && typeof error === "object" && "context" in error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      try {
        const payload = await context.clone().json() as { message?: string };
        if (payload.message) return payload.message;
      } catch {
        // Mantém a mensagem genérica quando a resposta não contém JSON.
      }
    }
  }
  return error instanceof Error ? error.message : "Não foi possível falar com a integração.";
}

async function invokeClinicorp(body: Record<string, unknown>) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.functions.invoke<ClinicorpFunctionResponse>("clinicorp-sync", { body });
  if (error) throw new Error(await clinicorpErrorMessage(error));
  if (!data?.ok) throw new Error(data?.message ?? "A integração não concluiu a solicitação.");
  return data;
}

async function invokeClinicorpBootstrap(unitCode: ClinicorpUnitCode) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.functions.invoke<ClinicorpFunctionResponse>("clinicorp-bootstrap", {
    body: { unitCode },
  });
  if (error) throw new Error(await clinicorpErrorMessage(error));
  if (!data?.ok) throw new Error(data?.message ?? "A conciliação histórica não foi concluída.");
  return data;
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

const invoiceStatus = (status: string): Pick<InvoiceObligation, "status" | "tone"> => {
  const statuses: Record<string, Pick<InvoiceObligation, "status" | "tone">> = {
    forecast: { status: "Prevista", tone: "waiting" },
    awaiting_payment: { status: "Aguardando pagamento", tone: "waiting" },
    payment_unconfirmed: { status: "Pagamento não confirmado", tone: "waiting" },
    ready: { status: "Pronta para emissão", tone: "ready" },
    missing_data: { status: "Dados incompletos", tone: "issue" },
    open: { status: "Em aberto", tone: "waiting" },
    issued: { status: "Emitida", tone: "done" },
    divergence: { status: "Com divergência", tone: "issue" },
    cycle_in_progress: { status: "Quadrimestre em andamento", tone: "cycle" },
    cancelled: { status: "Cancelada", tone: "done" },
  };
  return statuses[status] ?? { status: status || "Sem situação", tone: "waiting" };
};

function LyvraMark() {
  return <div className="lyvra-mark" aria-hidden="true"><img src={LYVRA_ICON_DATA_URL} alt="" /></div>;
}

function StatusBadge({ tone, children }: { tone: InvoiceObligation["tone"]; children: React.ReactNode }) {
  return <Badge variant="outline" className={`status-badge status-${tone}`}><span className="status-dot" />{children}</Badge>;
}

function LoginScreen({ onLogin }: { onLogin: (username: string, password: string) => Promise<string | null> }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!username.trim() || password.length < 8) {
      setError("Preencha seu usuário e uma senha com pelo menos 8 caracteres.");
      return;
    }
    setLoading(true);
    setError("");
    const loginError = await onLogin(username.trim().toLowerCase(), password);
    setError(loginError ?? "");
    setLoading(false);
  };

  return (
    <main className="login-shell">
      <div className="login-grid" aria-hidden="true" />
      <div className="login-glow" aria-hidden="true" />
      <section className="login-access">
        <header className="login-brand" aria-label="LYVRA Inteligência Financeira">
          <div className="login-logo" aria-hidden="true"><img src={LYVRA_ICON_DATA_URL} alt="" /></div>
          <p className="font-display text-[30px] font-semibold leading-none tracking-[0.24em] text-[#102d23]">LYVRA</p>
          <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#6f7e75]">Financeiro Casal Odonto</p>
        </header>

        <div className="login-card">
          <div className="text-center">
            <p className="eyebrow">ACESSO AO FINANCEIRO</p>
            <h1 className="font-display mt-3 text-3xl font-semibold tracking-tight text-[#172a21]">Acesse sua rotina</h1>
            <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-[#75827a]">Use o usuário e a senha do seu acesso ao LYVRA.</p>
          </div>

          <form className="mt-8 space-y-5" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="login-username" className="text-sm font-semibold text-[#33473c]">Usuário</Label>
              <Input id="login-username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value.toLowerCase())} placeholder="usuario@lyvrafinanceiro" className="h-12 rounded-xl border-[#dce4de] bg-[#fbfcfa] px-4 shadow-none focus-visible:ring-[#00BF63]" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="login-password" className="text-sm font-semibold text-[#33473c]">Senha</Label>
              <div className="relative">
              <Input id="login-password" type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Digite sua senha" className="h-12 rounded-xl border-[#dce4de] bg-[#fbfcfa] px-4 pr-12 shadow-none focus-visible:ring-[#00BF63]" minLength={8} required />
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => setShowPassword((current) => !current)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg text-[#7d8a82] hover:bg-[#eef4ef] hover:text-[#183b32]" aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}>
                  {showPassword ? <EyeOff /> : <Eye />}
                </Button>
              </div>
            </div>
            {error && <p className="rounded-xl bg-[#fae8e3] px-4 py-3 text-sm text-[#934e3f]" role="alert">{error}</p>}
            <Button type="submit" disabled={loading} className="h-12 w-full rounded-xl bg-[#00BF63] font-bold text-[#10221f] shadow-none hover:bg-[#00d56e]">{loading ? <LoaderCircle className="animate-spin" /> : <LogIn />} {loading ? "Entrando…" : "Entrar no LYVRA"}</Button>
          </form>

          <div className="mt-7 border-t border-[#e8ece8] pt-5 text-center">
            <a href="/ativar-acesso" className="inline-flex items-center gap-2 text-sm font-semibold text-[#007d46] transition hover:text-[#00a958] hover:underline hover:underline-offset-4">Recebi meu código de primeiro acesso <ChevronRight className="size-4" /></a>
            <a href="/nova-senha" className="mt-3 block text-sm text-[#537060] hover:underline">Esqueceu a senha? Recuperar acesso</a>
          </div>
        </div>

        <p className="login-footer">Uso interno • Casal Odonto</p>
      </section>
    </main>
  );
}

export function LyvraApp() {
  const [authReady, setAuthReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [unit, setUnit] = useState("todas");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loadingPatients, setLoadingPatients] = useState(true);
  const [obligations, setObligations] = useState<InvoiceObligation[]>([]);
  const [reminderCounts, setReminderCounts] = useState<Record<string, number>>({ todas: 0, sorocaba: 0, salto: 0 });

  const loadProfile = useCallback(async (userId: string): Promise<UserAccount | null> => {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (error || !data?.is_active) return null;

    const { data: collectionUnits, error: collectionUnitsError } = await supabase
      .from("units")
      .select("id")
      .eq("collection_assignee_user_id", userId)
      .eq("is_active", true)
      .limit(1);

    if (collectionUnitsError) return null;

    return {
      id: data.user_id,
      name: data.full_name,
      email: data.email,
      role: data.role as Role,
      operationalArea: (((data as unknown as { operational_area?: OperationalArea }).operational_area) ?? (data.role === "suporte" ? "support" : ["gestora", "ceo"].includes(data.role) ? "management" : Boolean(collectionUnits?.length) ? "collections" : "none")),
      canManageCollections: Boolean(collectionUnits?.length),
    };
  }, []);

  const loadFinancialData = useCallback(async (silent = false) => {
    const supabase = getSupabaseBrowserClient();
    if (!silent) setLoadingPatients(true);
    try {
      const todayKey = saoPauloDate(new Date());
      const tomorrowDate = new Date(`${todayKey}T12:00:00Z`);
      tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
      const tomorrowKey = saoPauloDate(tomorrowDate);
      const reminderStart = `${todayKey}T00:00:00-03:00`;
      const reminderEnd = `${tomorrowKey}T00:00:00-03:00`;

      const [patientResult, obligationResult, reminderResult, patientStateResult, unitResult] = await Promise.all([
        supabase.from("patient_directory").select("*").order("full_name"),
        supabase.from("invoice_queue").select("*").order("period_end", { ascending: true }),
        supabase
          .from("financial_tasks")
          .select("id,unit_id")
          .eq("kind", "payment_reminder")
          .gte("due_at", reminderStart)
          .lt("due_at", reminderEnd)
          .in("status", ["pending", "in_progress"]),
        (supabase as any).from("patients").select("id,settled_at,settled_reason,reminder_opt_out,reminder_opt_out_reason"),
        supabase.from("units").select("id,code").eq("is_active", true),
      ]);

      const firstError = patientResult.error ?? obligationResult.error ?? reminderResult.error ?? patientStateResult.error ?? unitResult.error;
      if (firstError) throw firstError;

      const paymentLabels: Record<string, string> = {
        boleto: "Boleto",
        card: "Cartão",
        pix: "Pix",
        cash: "Dinheiro",
        transfer: "Transferência",
        other: "Outro",
      };

      const patientStateMap = new Map(((patientStateResult.data ?? []) as any[]).map((item) => [Number(item.id), item]));

      setPatients(((patientResult.data ?? []) as unknown as any[]).map((row) => {
        if (row.patient_id === null || row.full_name === null || row.unit_name === null) throw new Error("Cadastro de paciente incompleto no banco.");
        return ({
        id: row.patient_id,
        clinicorpId: row.clinicorp_patient_id,
        name: row.full_name,
        cpf: row.cpf,
        phone: row.phone,
        email: row.email,
        unit: row.unit_name,
        treatment: row.treatment,
        paymentMethod: row.payment_method ? paymentLabels[row.payment_method] ?? row.payment_method : null,
        planAmountCents: Math.round(Number(row.plan_amount ?? 0) * 100),
        installmentAmountCents: Math.round(Number(row.installment_amount ?? 0) * 100),
        startDate: row.start_date,
        endDate: row.end_date,
        installments: row.installment_count,
        dueDay: row.due_day,
        taxReceiptIr: row.tax_receipt_ir ?? undefined,
        invoiceFrequency: row.invoice_frequency === "yearly" ? "Anual" : row.invoice_frequency === "four_monthly" ? "Quadrimestral" : row.invoice_frequency === "monthly" ? "Mensal" : row.invoice_frequency === "custom" ? "Personalizada" : "Regra automática",
        invoiceScheduleMode: row.invoice_schedule_mode,
        firstInvoiceDate: row.first_invoice_date,
        invoiceIntervalMonths: row.invoice_interval_months,
        invoiceRecipientName: row.invoice_recipient_name,
        invoiceDisabled: Boolean(row.invoice_disabled),
        invoiceDisabledReason: row.invoice_disabled_reason,
        notes: row.notes,
        settledAt: patientStateMap.get(Number(row.patient_id))?.settled_at ?? null,
        settledReason: patientStateMap.get(Number(row.patient_id))?.settled_reason ?? null,
        reminderOptOut: Boolean(patientStateMap.get(Number(row.patient_id))?.reminder_opt_out),
        reminderOptOutReason: patientStateMap.get(Number(row.patient_id))?.reminder_opt_out_reason ?? null,
      }); }));

      setObligations(((obligationResult.data ?? []) as unknown as any[]).map((row) => {
        if (row.id === null || row.patient_name === null || row.unit_name === null || row.competence === null || row.status === null || row.frequency === null) throw new Error("Obrigação financeira incompleta no banco.");
        const meta = invoiceStatus(row.status);
        const amountValue = Number(row.status === "issued" ? (row.issued_amount || row.expected_amount || 0) : (row.expected_amount || row.paid_amount || 0));
        return {
          id: row.id,
          patient: row.patient_name,
          initials: initials(row.patient_name),
          unit: row.unit_name,
          reference: row.competence,
          amount: moneyValue(amountValue),
          amountValue,
          status: meta.status,
          tone: meta.tone,
          rawStatus: row.status,
          frequency: row.frequency,
          scheduledIssueDate: row.scheduled_issue_date,
          ruleCode: row.rule_code,
          issuedAmount: Number(row.issued_amount ?? 0),
          issuedAt: row.invoice_issued_at ?? null,
          periodStart: row.period_start ?? null,
          periodEnd: row.period_end ?? null,
          sourceType: row.source_type ?? null,
        };
      }));
      const unitCodeById = new Map(((unitResult.data ?? []) as any[]).map((item) => [Number(item.id), String(item.code)]));
      const reminderRows = (reminderResult.data ?? []) as any[];
      const nextReminderCounts: Record<string, number> = { todas: reminderRows.length, sorocaba: 0, salto: 0 };
      for (const row of reminderRows) {
        const code = unitCodeById.get(Number(row.unit_id));
        if (code === "sorocaba") nextReminderCounts.sorocaba += 1;
        if (code === "salto_de_pirapora") nextReminderCounts.salto += 1;
      }
      setReminderCounts(nextReminderCounts);
    } catch (error) {
      setPatients([]);
      setObligations([]);
      setReminderCounts({ todas: 0, sorocaba: 0, salto: 0 });
      throw error;
    } finally {
      if (!silent) setLoadingPatients(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const supabase = getSupabaseBrowserClient();

    const initialize = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        if (active) setAuthReady(true);
        return;
      }

      const account = await loadProfile(data.session.user.id);
      if (!account) {
        await supabase.auth.signOut();
        if (active) setAuthReady(true);
        return;
      }

      if (active) { setCurrentUser(account); setView(defaultViewFor(account)); }
      try {
        if (account.operationalArea !== "support") await loadFinancialData();
      } catch {
        if (active) toast.error("Não foi possível carregar a base financeira.");
      } finally {
        if (active) setAuthReady(true);
      }
    };

    void initialize();
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" && active) setCurrentUser(null);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [loadFinancialData, loadProfile]);

  useEffect(() => {
    if (!currentUser || currentUser.operationalArea === "support") return;
    const refresh = () => { void loadFinancialData(true).catch(() => undefined); };
    const interval = window.setInterval(refresh, 60_000);
    const onVisibility = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", refresh);
    };
  }, [currentUser, loadFinancialData]);

  const unitFilter = <UnitSelect value={unit} onChange={setUnit} />;

  const markIssued = async (id: number) => {
    const supabase = getSupabaseBrowserClient();
    const timestamp = new Date().toISOString();
    const obligation = obligations.find((item) => item.id === id);
    const { error } = await (supabase as any)
      .from("invoice_obligations")
      .update({ status: "issued", invoice_issued_at: timestamp, completed_at: timestamp, issued_amount: obligation?.amountValue ?? 0 })
      .eq("id", id);

    if (error) {
      toast.error("Não foi possível atualizar a nota", { description: error.message });
      return;
    }
    await loadFinancialData();
    toast.success("Nota marcada como emitida", { description: "O histórico real desta obrigação foi atualizado." });
  };

  const login = async (username: string, password: string) => {
    const supabase = getSupabaseBrowserClient();
    let session;
    try {
      const result = await accessAuth({ action: "login", username, password });
      session = result.session;
    } catch (error) { return error instanceof Error ? error.message : "Não foi possível entrar agora."; }
    if (!session) return "Usuário ou senha inválidos.";
    const { data, error } = await supabase.auth.setSession(session);
    if (error || !data.user) return "Não foi possível iniciar sua sessão.";

    const account = await loadProfile(data.user.id);
    if (!account) {
      await supabase.auth.signOut();
      return "Este acesso não está ativo no LYVRA.";
    }

    setCurrentUser(account);
    setView(defaultViewFor(account));
    try {
      if (account.operationalArea !== "support") await loadFinancialData();
    } catch {
      return "A conta entrou, mas a base financeira não pôde ser carregada.";
    }
    return null;
  };

  const logout = async () => {
    await getSupabaseBrowserClient().auth.signOut();
    setCurrentUser(null);
    setPatients([]);
    setObligations([]);
    setView("dashboard");
  };

  if (!authReady) {
    return <main className="login-shell grid place-items-center"><LoaderCircle className="size-7 animate-spin text-[#00BF63]" /><span className="sr-only">Carregando LYVRA</span></main>;
  }

  if (!currentUser) return <LoginScreen onLogin={login} />;

  const allowedViews = allowedViewsFor(currentUser);
  const visibleNavItems = navItems.filter((item) => allowedViews.has(item.id));
  const userInitials = initials(currentUser.name);

  return (
    <SidebarProvider className="app-density">
      <Toaster position="top-right" richColors />
      {currentUser.operationalArea !== "support" && <DueTaskAlert userId={currentUser.id} onOpenJourney={() => allowedViews.has("journey") && setView("journey")} onOpenCollections={() => allowedViews.has("collections") && setView("collections")} />}
      <Sidebar collapsible="icon" className="border-r-0 bg-[#10221f] text-white">
        <SidebarHeader className="px-4 pb-3 pt-5">
          <div className="flex items-center gap-3 overflow-hidden px-1">
            <LyvraMark />
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <p className="font-display text-[22px] font-semibold leading-none tracking-[0.18em]">LYVRA</p>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent className="sidebar-scroll-clean px-2">
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.16em] text-white/35">{currentUser.operationalArea === "support" ? "Suporte" : "Financeiro"}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleNavItems.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton onClick={() => setView(item.id)} isActive={view === item.id} tooltip={item.label} className="h-10 rounded-xl px-3 text-white/62 hover:bg-white/8 hover:text-white data-[active=true]:bg-[#00BF63] data-[active=true]:text-[#10221f]">
                      <item.icon /><span>{item.label}</span>
                    </SidebarMenuButton>
                    {item.badge && <SidebarMenuBadge className="right-2 top-2.5 bg-white/10 text-white/70 group-data-[collapsible=icon]:hidden">{item.badge}</SidebarMenuBadge>}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="p-3">
          <div className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.045] p-3 group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-1">
            <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#00BF63] text-xs font-bold text-[#10221f]">{userInitials}</div>
            <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden"><p className="truncate text-sm font-medium text-white">{currentUser.name}</p><p className="truncate text-xs text-white/42">{areaLabels[currentUser.operationalArea]}</p></div>
            <Button onClick={logout} variant="ghost" size="icon-sm" className="rounded-lg text-white/35 hover:bg-white/10 hover:text-white" aria-label="Sair do LYVRA"><LogOut /></Button>
          </div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header className="sticky top-0 z-20 flex h-18 items-center justify-between border-b border-[#dfe5df] bg-[#f7f8f4]/92 px-4 backdrop-blur-xl md:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <SidebarTrigger className="size-9 rounded-xl border border-[#dfe5df] bg-white" />
            <div className="hidden h-7 w-px bg-[#dfe5df] md:block" />
            <div><p className="text-xs font-medium text-[#6b756f]">{viewTitles[view].eyebrow}</p><h1 className="font-display text-xl font-semibold tracking-tight text-[#16241f]">{viewTitles[view].title}</h1></div>
          </div>
          <div className="flex items-center gap-2">
            {currentUser.operationalArea !== "support" && unitFilter}
            {currentUser.operationalArea !== "support" && <FinancialNotifications userId={currentUser.id} unit={unit} onOpenJourney={() => allowedViews.has("journey") && setView("journey")} onOpenCollections={() => allowedViews.has("collections") && setView("collections")} />}
          </div>
        </header>

        <main className="lyvra-page min-h-[calc(100svh-4.5rem)] bg-[#f7f8f4]">
          <div className="lyvra-page-inner">
            {view === "dashboard" && allowedViews.has("dashboard") && <DashboardView unit={unit} obligations={obligations} reminderCount={reminderCounts[unit] ?? reminderCounts.todas} goTo={setView} />}
            {view === "journey" && allowedViews.has("journey") && <FinancialJourney unit={unit} mode="management" />}
            {view === "reminders" && allowedViews.has("reminders") && <PaymentReminderReview unit={unit} />}
            {view === "invoices" && allowedViews.has("invoices") && <InvoicesView unit={unit} obligations={obligations} onIssued={markIssued} />}
            {view === "collections" && allowedViews.has("collections") && <CollectionsJourney unit={unit} />}
            {view === "patients" && allowedViews.has("patients") && <PatientsView unit={unit} patients={patients} loading={loadingPatients} goTo={setView} onSaved={loadFinancialData} canEdit={currentUser.operationalArea !== "support"} />}
            {view === "import" && allowedViews.has("import") && <WorkbookImportHub onImported={async () => { await loadFinancialData(); }} />}
            {view === "access" && allowedViews.has("access") && <AccessManagementView currentRole={currentUser.role} />}
            {view === "support" && allowedViews.has("support") && <SupportView goTo={setView} />}
            {view === "integrations" && allowedViews.has("integrations") && <IntegrationsView />}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

function UnitSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <Select value={value} onValueChange={onChange}><SelectTrigger aria-label="Selecionar unidade" className="h-10 w-10 rounded-xl border-[#dfe5df] bg-white px-0 text-[#25362e] shadow-none sm:w-[190px] sm:px-3"><Building2 className="size-4 shrink-0 text-[#6f7b74]" /><span className="hidden min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left sm:inline"><SelectValue /></span></SelectTrigger><SelectContent><SelectItem value="todas">Todas as unidades</SelectItem><SelectItem value="sorocaba">Sorocaba</SelectItem><SelectItem value="salto">Salto de Pirapora</SelectItem></SelectContent></Select>;
}

const obligationMonthKey = (item: InvoiceObligation) => {
  if (item.sourceType === "workbook" && item.periodStart) return item.periodStart.slice(0, 7);
  return item.scheduledIssueDate?.slice(0, 7)
    ?? item.periodEnd?.slice(0, 7)
    ?? item.periodStart?.slice(0, 7)
    ?? (item.issuedAt ? saoPauloDate(new Date(item.issuedAt)).slice(0, 7) : null);
};

const competenceLabel = (key: string) => {
  const [year, month] = key.split("-").map(Number);
  if (!year || !month) return key;
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
};

function DashboardView({ unit, obligations, reminderCount, goTo }: { unit: string; obligations: InvoiceObligation[]; reminderCount: number; goTo: (view: View) => void }) {
  const currentMonthKey = saoPauloDate(new Date()).slice(0, 7);
  const unitFiltered = useMemo(() => obligations.filter((item) => unit === "todas" || (unit === "sorocaba" ? item.unit === "Sorocaba" : item.unit === "Salto de Pirapora")), [obligations, unit]);
  const monthKeys = useMemo(() => [...new Set([currentMonthKey, ...unitFiltered.map(obligationMonthKey).filter((value): value is string => Boolean(value))])].sort((a, b) => b.localeCompare(a)), [currentMonthKey, unitFiltered]);
  const [competence, setCompetence] = useState(currentMonthKey);

  useEffect(() => {
    if (!monthKeys.includes(competence)) setCompetence(monthKeys[0] ?? currentMonthKey);
  }, [competence, currentMonthKey, monthKeys]);

  const scoped = unitFiltered.filter((item) => obligationMonthKey(item) === competence);
  const pending = scoped.filter((item) => item.rawStatus !== "issued" && item.rawStatus !== "cancelled").slice(0, 4);
  const ready = scoped.filter((item) => item.rawStatus === "ready");
  const waiting = scoped.filter((item) => ["forecast", "awaiting_payment", "payment_unconfirmed", "open", "missing_data", "divergence", "cycle_in_progress"].includes(item.rawStatus));
  const issued = scoped.filter((item) => item.rawStatus === "issued");
  const total = (items: InvoiceObligation[]) => moneyValue(items.reduce((sum, item) => sum + item.amountValue, 0));

  return <div className="space-y-5">
    <section className="hero-panel overflow-hidden rounded-[28px] px-5 py-6 text-white md:px-8 md:py-7"><div className="relative z-10 flex flex-col justify-between gap-6 lg:flex-row lg:items-end"><div><Badge className="mb-4 border border-white/12 bg-white/8 px-3 py-1 text-[11px] font-medium text-white hover:bg-white/8">COMPETÊNCIA {competenceLabel(competence).toUpperCase()}</Badge><h2 className="font-display max-w-2xl text-3xl font-medium leading-tight tracking-[-0.035em] md:text-[38px]">Confira o financeiro do mês selecionado.</h2><p className="mt-3 max-w-xl text-sm leading-6 text-white/65">Todos os cards fiscais abaixo usam a mesma competência. Troque o mês para consultar o histórico sem misturar períodos.</p></div><div className="flex flex-col gap-2 sm:flex-row"><Select value={competence} onValueChange={setCompetence}><SelectTrigger className="h-11 min-w-52 rounded-xl border-white/15 bg-white/10 text-white"><SelectValue /></SelectTrigger><SelectContent>{monthKeys.map((key) => <SelectItem key={key} value={key}>{competenceLabel(key)}</SelectItem>)}</SelectContent></Select><Button onClick={() => goTo("invoices")} className="h-11 rounded-xl bg-[#00BF63] px-5 text-[#10221f] shadow-none hover:bg-[#00D66F]">Abrir notas fiscais <ChevronRight /></Button></div></div></section>
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Prontas para emissão" value={String(ready.length)} detail={total(ready)} icon={FileText} accent="lime" /><MetricCard label="Em acompanhamento" value={String(waiting.length)} detail={total(waiting)} icon={CircleDollarSign} accent="amber" /><MetricCard label="Emitidas na competência" value={String(issued.length)} detail={total(issued)} icon={CheckCircle2} accent="blue" /><MetricCard label="Lembretes de hoje" value={String(reminderCount)} detail="D-1 do boleto" icon={MessageCircle} accent="violet" /></section>
    <section className="lyvra-split-dashboard"><ObligationsTable title="Pendências da competência" description={`${pending.length} pendência(s) em ${competenceLabel(competence)}`} obligations={pending} compact /><div className="space-y-5"><QuarterCard obligations={scoped} /><ActivityCard obligations={scoped} /></div></section>
  </div>;
}

function InvoicesView({ unit, obligations, onIssued }: { unit: string; obligations: InvoiceObligation[]; onIssued: (id: number) => void | Promise<void> }) {
  const [status, setStatus] = useState("todos");
  const currentMonthKey = saoPauloDate(new Date()).slice(0, 7);
  const unitFiltered = useMemo(() => obligations.filter((item) => unit === "todas" || (unit === "sorocaba" ? item.unit === "Sorocaba" : item.unit === "Salto de Pirapora")), [obligations, unit]);
  const monthKeys = useMemo(() => [...new Set([currentMonthKey, ...unitFiltered.map(obligationMonthKey).filter((value): value is string => Boolean(value))])].sort((a, b) => b.localeCompare(a)), [currentMonthKey, unitFiltered]);
  const [competence, setCompetence] = useState(currentMonthKey);
  const filtered = unitFiltered.filter((item) => (competence === "all" || obligationMonthKey(item) === competence) && (status === "todos" || item.tone === status));
  const competenceText = competence === "all" ? "todas as competências" : competenceLabel(competence);

  return <div className="space-y-5">
    <section className="flex flex-col justify-between gap-4 rounded-[24px] border border-[#dfe5df] bg-white p-5 md:flex-row md:items-center md:p-6"><div><p className="eyebrow">COMPETÊNCIA FISCAL</p><h2 className="font-display mt-2 text-2xl font-semibold text-[#192820]">Notas fiscais</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-[#718078]">A planilha mensal e os planos financeiros aparecem juntos, mas cada registro permanece na competência correta.</p></div><div className="flex flex-col gap-2 sm:flex-row"><Select value={competence} onValueChange={setCompetence}><SelectTrigger className="h-10 min-w-52 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todas as competências</SelectItem>{monthKeys.map((key) => <SelectItem key={key} value={key}>{competenceLabel(key)}</SelectItem>)}</SelectContent></Select><Select value={status} onValueChange={setStatus}><SelectTrigger className="h-10 min-w-48 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todos">Todas as situações</SelectItem><SelectItem value="ready">Prontas para emissão</SelectItem><SelectItem value="waiting">Aguardando / em aberto</SelectItem><SelectItem value="cycle">Ciclo em andamento</SelectItem><SelectItem value="issue">Com pendência</SelectItem><SelectItem value="done">Emitidas</SelectItem></SelectContent></Select></div></section>
    <ObligationsTable title="Obrigações fiscais" description={`${filtered.length} registro(s) em ${competenceText}`} obligations={filtered} onIssued={onIssued} />
    <div className="grid gap-4 md:grid-cols-2"><RuleCard title="Planilha mensal" label="Competência preservada" description="Cada aba mensal vira uma obrigação fiscal do próprio mês, mantendo valor e status informados na planilha." /><RuleCard title="Planos detalhados" label="Agenda automática" description="Quando o parcelamento está completo no LYVRA, as obrigações continuam sendo calculadas pelas regras cadastradas no plano, sem misturar com a planilha mensal." /></div>
  </div>;
}

type SettlementStatusRow = {
  patient_id: number;
  unit_id: number;
  unit_name: string;
  settlement_state: "open" | "requested" | "settled";
  settlement_request_id?: number | null;
  requested_at?: string | null;
  clinicorp_url?: string | null;
};

function PatientsView({ unit, patients, loading, goTo, onSaved, canEdit }: { unit: string; patients: Patient[]; loading: boolean; goTo: (view: View) => void; onSaved: () => Promise<void>; canEdit: boolean }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "requested" | "settled" | "all">("active");
  const [requestingId, setRequestingId] = useState<number | null>(null);
  const [settlementStates, setSettlementStates] = useState<Record<string, SettlementStatusRow>>({});

  const settlementKey = (patientId: number, unitName: string) => `${patientId}:${unitName}`;

  const loadSettlementStates = useCallback(async () => {
    const patientIds = [...new Set(patients.map((patient) => patient.id).filter((id): id is number => Boolean(id)))];
    if (!patientIds.length) {
      setSettlementStates({});
      return;
    }

    const supabase = getSupabaseBrowserClient();
    const { data, error } = await (supabase as any)
      .from("patient_settlement_status")
      .select("patient_id,unit_id,unit_name,settlement_state,settlement_request_id,requested_at,clinicorp_url")
      .in("patient_id", patientIds);
    if (error) throw error;

    const next: Record<string, SettlementStatusRow> = {};
    for (const row of (data ?? []) as SettlementStatusRow[]) {
      next[settlementKey(Number(row.patient_id), String(row.unit_name))] = row;
    }
    setSettlementStates(next);
  }, [patients]);

  useEffect(() => {
    void loadSettlementStates().catch(() => undefined);
  }, [loadSettlementStates]);

  const requestSettlement = async (patient: Patient) => {
    if (!patient.id) return;
    const state = settlementStates[settlementKey(patient.id, patient.unit)];
    const clinicorpUrl = state?.clinicorp_url || "https://sistema.clinicorp.com/";

    if (state?.settlement_state === "requested") {
      window.open(clinicorpUrl, "_blank", "noopener,noreferrer");
      return;
    }

    if (!state?.unit_id) {
      toast.error("Unidade do paciente não encontrada", { description: "Atualize a tela e tente novamente." });
      return;
    }

    setRequestingId(patient.id);
    const clinicorpWindow = window.open("about:blank", "_blank");
    if (clinicorpWindow) clinicorpWindow.opener = null;

    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await (supabase as any).rpc("request_clinicorp_settlement", {
        p_patient_id: patient.id,
        p_unit_id: state.unit_id,
        p_payment_plan_id: null,
      });
      if (error) throw error;

      const result = Array.isArray(data) ? data[0] : data;
      const targetUrl = String(result?.clinicorp_url || clinicorpUrl);
      if (clinicorpWindow) clinicorpWindow.location.href = targetUrl;
      else window.open(targetUrl, "_blank", "noopener,noreferrer");

      toast.success("Baixa solicitada", {
        description: "Faça a baixa no Clinicorp. O LYVRA confirmará automaticamente quando o pagamento aparecer na sincronização.",
      });
      await loadSettlementStates();
    } catch (error) {
      clinicorpWindow?.close();
      toast.error("Não foi possível iniciar a baixa", {
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
    } finally {
      setRequestingId(null);
    }
  };

  const filtered = patients.filter((patient) => {
    const unitMatches = unit === "todas" || (unit === "sorocaba" ? patient.unit === "Sorocaba" : patient.unit === "Salto de Pirapora");
    const queryMatches = patient.name.toLowerCase().includes(query.toLowerCase());
    const state = patient.id ? settlementStates[settlementKey(patient.id, patient.unit)] : undefined;
    const statusMatches = statusFilter === "all"
      || (statusFilter === "settled" ? Boolean(patient.settledAt) : false)
      || (statusFilter === "requested" ? state?.settlement_state === "requested" && !patient.settledAt : false)
      || (statusFilter === "active" ? !patient.settledAt && state?.settlement_state !== "requested" : false);
    return unitMatches && queryMatches && statusMatches;
  });

  return <div className="space-y-5"><section className="surface-card overflow-hidden rounded-[24px]"><div className="flex flex-col gap-4 border-b border-[#e7ebe7] p-5 sm:flex-row sm:items-center sm:justify-between md:p-6"><div><h2 className="font-display text-xl font-semibold text-[#192820]">Pacientes cadastrados</h2><p className="mt-1 text-sm text-[#718078]">A baixa é feita no Clinicorp. O LYVRA acompanha a confirmação e encerra as cobranças sozinho quando o pagamento for confirmado.</p></div><div className="flex flex-wrap gap-2"><div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8b9690]"/><Input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar paciente" className="h-10 w-52 rounded-xl pl-9"/></div><Select value={statusFilter} onValueChange={v=>setStatusFilter(v as typeof statusFilter)}><SelectTrigger className="h-10 w-40 rounded-xl"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="active">Ativos</SelectItem><SelectItem value="requested">Baixa solicitada</SelectItem><SelectItem value="settled">Quitados</SelectItem><SelectItem value="all">Todos</SelectItem></SelectContent></Select>{canEdit&&<><ManualPatientDialog onSaved={onSaved}/><Button onClick={()=>goTo("import")} variant="outline" className="h-10 rounded-xl"><UploadCloud/> Importar</Button></>}</div></div>{loading?<div className="grid min-h-64 place-items-center"><LoaderCircle className="animate-spin"/></div>:filtered.length?<Table><TableHeader><TableRow className="bg-[#fafbf8]"><TableHead className="pl-6">Paciente</TableHead><TableHead>Unidade</TableHead><TableHead>Pagamento</TableHead><TableHead>Periodicidade</TableHead><TableHead>Nota para IR</TableHead><TableHead className="w-44">Baixa</TableHead></TableRow></TableHeader><TableBody>{filtered.map(patient=>{const state=patient.id?settlementStates[settlementKey(patient.id,patient.unit)]:undefined;const requested=state?.settlement_state==="requested"&&!patient.settledAt;return <TableRow key={`${patient.id}-${patient.name}`}><TableCell className="py-4 pl-6"><div><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{patient.name}</p>{patient.settledAt?<Badge className="bg-[#eaf5df] text-[#54752d]">Quitado</Badge>:requested?<Badge className="bg-[#fff3d8] text-[#8a651f] hover:bg-[#fff3d8]">Baixa solicitada</Badge>:null}</div><p className="mt-1 text-xs text-[#839087]">{patient.cpf||"CPF pendente"} • {patient.treatment||"Tratamento não informado"}{requested?" • aguardando confirmação do Clinicorp":""}</p></div></TableCell><TableCell>{patient.unit}</TableCell><TableCell><p>{patient.paymentMethod||"—"}</p><p className="mt-1 text-xs text-[#839087]">{money(patient.planAmountCents)}</p></TableCell><TableCell>{patient.invoiceDisabled?<span className="text-[#a05a48]">Não emitir</span>:patient.invoiceFrequency||"Regra automática"}</TableCell><TableCell>{Boolean(patient.taxReceiptIr)?<Badge className="bg-[#eaf5df] text-[#54752d]"><Check/> Sim</Badge>:<Badge variant="secondary">Não</Badge>}</TableCell><TableCell>{patient.settledAt?<span className="text-xs font-medium text-[#54752d]">Confirmado</span>:canEdit?<Button variant={requested?"outline":"default"} size="sm" disabled={requestingId===patient.id||!state} onClick={()=>void requestSettlement(patient)} className={requested?"rounded-xl":"rounded-xl bg-[#183b32] hover:bg-[#214d41]"}>{requestingId===patient.id?<LoaderCircle className="animate-spin"/>:<Link2/>}{requested?"Abrir Clinicorp":"Dar baixa"}</Button>:<span className="text-xs text-[#7b897f]">Em aberto</span>}</TableCell></TableRow>})}</TableBody></Table>:<div className="grid min-h-64 place-items-center text-sm text-[#7d8982]">Nenhum paciente neste filtro.</div>}</section></div>;
}
function ImportView({ onImported }: { onImported: () => Promise<void> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Patient[]>([]);
  const [parseError, setParseError] = useState("");
  const [importing, setImporting] = useState(false);

  const parseFile = async (file: File) => {
    setParseError(""); setRows([]); setFileName(file.name);
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      if (!raw.length) throw new Error("A planilha está vazia.");

      const parsed = raw.map((original) => {
        const row = Object.fromEntries(Object.entries(original).map(([key, value]) => [normalize(key), value]));
        const pick = (...keys: string[]) => keys.map(normalize).map((key) => row[key]).find((value) => value !== undefined && value !== "");
        const unitRaw = String(pick("unidade", "clinica") ?? "Sorocaba");
        const unitName = normalize(unitRaw).includes("salto") ? "Salto de Pirapora" : "Sorocaba";
        const valueRaw = pick("valor", "valor mensal", "valor parcela", "mensalidade");
        const amount = typeof valueRaw === "number" ? Math.round(valueRaw * 100) : Math.round(Number(String(valueRaw ?? "0").replace(/[^0-9,-]/g, "").replace(".", "").replace(",", ".")) * 100) || 0;
        const irRaw = normalize(String(pick("emitir nota para ir", "nota ir", "emite nf", "nota fiscal", "ir") ?? "nao"));
        const startRaw = pick("data de inicio", "inicio");
        const startDate = startRaw instanceof Date
          ? startRaw.toISOString().slice(0, 10)
          : String(startRaw ?? "").match(/^\d{2}\/\d{2}\/\d{4}$/)
            ? String(startRaw).replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, "$3-$2-$1")
            : String(startRaw ?? "") || null;
        return {
          clinicorpId: String(pick("id clinicorp", "clinicorp id", "codigo clinicorp") ?? "") || null,
          name: String(pick("nome", "nome completo", "paciente") ?? "").trim(),
          cpf: digits(pick("cpf")) || null,
          phone: String(pick("telefone", "celular", "whatsapp") ?? "") || null,
          email: String(pick("email", "e-mail") ?? "") || null,
          unit: unitName,
          treatment: String(pick("tratamento", "servico", "procedimento") ?? "") || null,
          paymentMethod: String(pick("forma de pagamento", "pagamento") ?? "") || null,
          planAmountCents: amount,
          startDate,
          installments: Number(pick("parcelas", "quantidade de parcelas")) || null,
          dueDay: Number(pick("dia do vencimento", "vencimento") ?? 0) || null,
          taxReceiptIr: ["sim", "s", "true", "1", "x"].includes(irRaw),
          invoiceFrequency: unitName === "Sorocaba" ? "Mensal" : "Quadrimestral",
          notes: String(pick("observacoes", "observacao") ?? "") || null,
        } satisfies Patient;
      });
      setRows(parsed);
      if (!parsed.some((row) => row.name)) setParseError("Não encontrei uma coluna de nome. Use ‘Nome’, ‘Nome completo’ ou ‘Paciente’. ");
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "Não foi possível ler a planilha.");
    }
  };

  const submit = async () => {
    const valid = rows.filter((row) => row.name);
    if (!valid.length) return;
    setImporting(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const grouped = new Map<string, Patient[]>();
      for (const patient of valid) {
        const unitCode = patient.unit === "Salto de Pirapora" ? "salto_de_pirapora" : "sorocaba";
        grouped.set(unitCode, [...(grouped.get(unitCode) ?? []), patient]);
      }

      let created = 0;
      let updated = 0;
      let errors = 0;
      for (const [unitCode, unitRows] of grouped) {
        const { data, error } = await supabase.rpc("import_patients", {
          p_unit_code: unitCode,
          p_file_name: fileName || "planilha",
          p_rows: JSON.parse(JSON.stringify(unitRows)),
        });
        if (error) throw error;
        const result = data?.[0];
        created += result?.imported_count ?? 0;
        updated += result?.updated_count ?? 0;
        errors += result?.error_count ?? 0;
      }

      const processed = created + updated;
      if (errors) {
        toast.warning(`${processed} pacientes processados`, { description: `${errors} linha(s) ficaram no relatório para revisão.` });
      } else {
        toast.success(`${processed} pacientes processados`, { description: `${created} novo(s) e ${updated} atualizado(s) na base real.` });
      }
      await onImported();
    } catch (error) {
      toast.error("Importação não concluída", { description: error instanceof Error ? error.message : "Tente novamente." });
    } finally { setImporting(false); }
  };

  const invalid = rows.filter((row) => !row.name).length;
  return <div className="space-y-5"><section className="grid gap-5 xl:grid-cols-[.8fr_1.2fr]"><div className="surface-card rounded-[24px] p-5 md:p-7"><p className="eyebrow">ETAPA 1</p><h2 className="font-display mt-2 text-2xl font-semibold text-[#192820]">Envie sua planilha</h2><p className="mt-2 text-sm leading-6 text-[#718078]">O LYVRA aceita Excel ou CSV, lê a primeira aba e mostra uma conferência antes de cadastrar.</p><input ref={inputRef} className="sr-only" type="file" accept=".xlsx,.xls,.csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void parseFile(file); }} /><button type="button" onClick={() => inputRef.current?.click()} className="mt-6 flex min-h-56 w-full flex-col items-center justify-center rounded-[22px] border border-dashed border-[#b7c4ba] bg-[#fafbf8] px-6 text-center transition hover:border-[#00BF63] hover:bg-[#f2fbf7]"><div className="grid size-14 place-items-center rounded-2xl bg-[#e4f8ee] text-[#00884a]"><UploadCloud className="size-6" /></div><p className="mt-4 font-medium text-[#26382e]">{fileName || "Clique para escolher a planilha"}</p><p className="mt-1 text-xs text-[#87928c]">XLSX, XLS ou CSV • até 1.000 pacientes por vez</p></button><div className="mt-5 space-y-3 text-sm text-[#65736b]"><CheckLine>Prévia antes do cadastro</CheckLine><CheckLine>Detecção de CPF e Clinicorp ID</CheckLine><CheckLine>Periodicidade definida pela unidade</CheckLine></div></div>
      <div className="surface-card overflow-hidden rounded-[24px]"><div className="flex items-center justify-between border-b border-[#e7ebe7] p-5 md:px-6"><div><p className="eyebrow">ETAPA 2</p><h2 className="font-display mt-2 text-xl font-semibold text-[#192820]">Conferência dos dados</h2></div>{rows.length > 0 && <Badge variant="secondary">{rows.length} linhas encontradas</Badge>}</div>{parseError ? <div className="m-6 flex gap-3 rounded-2xl bg-[#fae8e3] p-4 text-sm text-[#934e3f]"><AlertCircle className="mt-0.5 size-4 shrink-0" />{parseError}</div> : rows.length ? <><Table><TableHeader><TableRow className="bg-[#fafbf8] hover:bg-[#fafbf8]"><TableHead className="pl-6">Paciente</TableHead><TableHead>Unidade</TableHead><TableHead>Pagamento</TableHead><TableHead>IR</TableHead></TableRow></TableHeader><TableBody>{rows.slice(0, 6).map((row, index) => <TableRow key={`${row.name}-${index}`} className={!row.name ? "bg-[#fff7f4]" : ""}><TableCell className="py-4 pl-6"><p className="font-medium">{row.name || "Nome não identificado"}</p><p className="mt-1 text-xs text-[#839087]">{row.cpf || "CPF não informado"}</p></TableCell><TableCell>{row.unit}</TableCell><TableCell>{row.paymentMethod || "—"}</TableCell><TableCell>{row.taxReceiptIr ? "Sim" : "Não"}</TableCell></TableRow>)}</TableBody></Table>{rows.length > 6 && <p className="border-t p-4 text-center text-xs text-[#7d8982]">Mais {rows.length - 6} linhas serão incluídas na importação.</p>}<div className="flex flex-col gap-3 border-t border-[#e7ebe7] bg-[#fafbf8] p-5 sm:flex-row sm:items-center sm:justify-between md:px-6"><p className="text-sm text-[#65736b]">{invalid ? `${invalid} linha(s) com erro serão ignoradas.` : "Tudo certo para continuar."}</p><Button disabled={importing || rows.length === invalid} onClick={() => void submit()} className="h-11 rounded-xl bg-[#183b32] px-5">{importing ? <LoaderCircle className="animate-spin" /> : <Database />} Importar {rows.length - invalid} pacientes</Button></div></> : <div className="grid min-h-96 place-items-center px-6 text-center"><div><FileSpreadsheet className="mx-auto size-10 text-[#b3bdb6]" /><p className="mt-4 font-medium text-[#4e5d54]">A prévia aparecerá aqui</p><p className="mt-1 text-sm text-[#8a958e]">Nenhum dado será salvo sem sua confirmação.</p></div></div>}</div>
    </section><section className="rounded-[22px] border border-[#dfe5df] bg-[#eef4e9] p-5"><div className="flex gap-3"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-[#51713d]" /><div><p className="font-medium text-[#2c432f]">Importação protegida contra duplicidades</p><p className="mt-1 text-sm leading-6 text-[#657a66]">O CPF é a chave principal. Quando um CPF já existir, o cadastro será atualizado em vez de duplicado.</p></div></div></section></div>;
}

type AccessUnit = { id: number; code: string; name: string; access_recovery_email: string; collection_assignee_user_id?: string | null };
type ManagedProfile = {
  user_id: string;
  username: string;
  full_name: string;
  role: Role;
  operational_area?: OperationalArea;
  is_active: boolean;
  recovery_unit_id: number;
  profile_units: { unit_id: number }[];
};
type AccessAdminResponse = { ok: boolean; message?: string; units?: AccessUnit[]; profiles?: ManagedProfile[] };

async function invokeAccessAdmin(body: Record<string, unknown>) {
  const { data, error } = await getSupabaseBrowserClient().functions.invoke<AccessAdminResponse>("access-admin", { body });
  if (error) throw new Error(await clinicorpErrorMessage(error));
  if (!data?.ok) throw new Error(data?.message ?? "A operação de acesso não foi concluída.");
  return data;
}

function AccessManagementView({ currentRole }: { currentRole: Role }) {
  const [units, setUnits] = useState<AccessUnit[]>([]);
  const [profiles, setProfiles] = useState<ManagedProfile[]>([]);
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<Role>("membro");
  const [operationalArea, setOperationalArea] = useState<OperationalArea>("invoices");
  const [recoveryUnit, setRecoveryUnit] = useState("");
  const [selectedUnits, setSelectedUnits] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recovering, setRecovering] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invokeAccessAdmin({ action: "list" });
      setUnits(result.units ?? []);
      setProfiles(result.profiles ?? []);
      if (result.units?.[0]) {
        setRecoveryUnit((current) => current || result.units![0].code);
        setSelectedUnits((current) => current.length ? current : [result.units![0].code]);
      }
    } catch (error) {
      toast.error("Não foi possível carregar os acessos", { description: error instanceof Error ? error.message : undefined });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);

  const createAccess = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true);
    try {
      const result = await invokeAccessAdmin({ action: "invite", fullName, username, role, operationalArea: role === "membro" ? operationalArea : "management", unitCode: recoveryUnit, unitCodes: selectedUnits });
      toast.success("Acesso criado", { description: result.message });
      setFullName(""); setUsername(""); setRole("membro"); setOperationalArea("invoices");
      await load();
    } catch (error) {
      toast.error("Acesso não criado", { description: error instanceof Error ? error.message : undefined });
    } finally { setSaving(false); }
  };

  const requestRecovery = async (profile: ManagedProfile) => {
    const unit = units.find((item) => item.id === profile.recovery_unit_id);
    if (!unit && profile.role !== "suporte") return;
    setRecovering(profile.user_id);
    try {
      const result = await invokeAccessAdmin({ action: "recover", username: profile.username, unitCode: unit?.code });
      toast.success("Recuperação enviada", { description: result.message });
    } catch (error) {
      toast.error("Não foi possível enviar", { description: error instanceof Error ? error.message : undefined });
    } finally { setRecovering(null); }
  };

  const toggleUnit = (code: string) => setSelectedUnits((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code]);

  return <div className="grid gap-5 xl:grid-cols-[.72fr_1.28fr]">
    <section className="surface-card rounded-[24px] p-5 md:p-6"><p className="eyebrow">NOVO ACESSO</p><h2 className="font-display mt-2 text-2xl font-semibold text-[#192820]">Cadastrar integrante</h2><p className="mt-2 text-sm leading-6 text-[#718078]">O convite será enviado para a caixa responsável escolhida abaixo.</p>
      <form className="mt-6 space-y-4" onSubmit={createAccess}>
        <div className="space-y-2"><Label htmlFor="access-name">Nome completo</Label><Input id="access-name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nome da pessoa" required /></div>
        <div className="space-y-2"><Label htmlFor="access-username">Usuário de entrada</Label><div className="flex items-center rounded-md border border-input bg-transparent"><Input id="access-username" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/@lyvrafinanceiro$/, "").replace(/[^a-z0-9._-]/g, "").slice(0, 40))} placeholder="usuario" minLength={3} required className="border-0 shadow-none focus-visible:ring-0" /><span className="pr-3 text-sm text-[#718078]">@lyvrafinanceiro</span></div><p className="text-xs text-[#87928c]">Este será o login da pessoa no sistema.</p></div>
        <div className="space-y-2"><Label>Tipo de acesso</Label><Select value={role} onValueChange={(value) => setRole(value as Role)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="membro">Membro</SelectItem>{currentRole !== "gestora" && <><SelectItem value="gestora">Gestora</SelectItem><SelectItem value="ceo">CEO</SelectItem></>}</SelectContent></Select></div>{role === "membro" && <div className="space-y-2"><Label>Rotina da pessoa</Label><Select value={operationalArea} onValueChange={(value) => setOperationalArea(value as OperationalArea)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="reminders">Lembretes D-1</SelectItem><SelectItem value="collections">Régua de cobrança</SelectItem><SelectItem value="invoices">Notas fiscais</SelectItem></SelectContent></Select><p className="text-xs leading-5 text-[#87928c]">Essa escolha define as telas da lateral. D-1 e cobrança também definem a pessoa responsável nas unidades selecionadas quando o acesso for ativado.</p></div>}
        <div className="space-y-2"><Label>Caixa de recuperação</Label><Select value={recoveryUnit} onValueChange={setRecoveryUnit}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{units.map((unit) => <SelectItem key={unit.code} value={unit.code}>{unit.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-2"><Label>Unidades liberadas</Label><div className="grid gap-2 sm:grid-cols-2">{units.map((unit) => <Button key={unit.code} type="button" variant={selectedUnits.includes(unit.code) ? "default" : "outline"} onClick={() => toggleUnit(unit.code)} className="justify-start rounded-xl">{selectedUnits.includes(unit.code) && <Check />}{unit.name}</Button>)}</div></div>
        <Button disabled={saving || !selectedUnits.length} className="h-11 w-full rounded-xl bg-[#183b32]">{saving ? <LoaderCircle className="animate-spin" /> : <UserCog />} Criar acesso e enviar código</Button>
      </form>
    </section>
    <section className="surface-card overflow-hidden rounded-[24px]"><div className="border-b border-[#e7ebe7] p-5 md:px-6"><p className="eyebrow">EQUIPE</p><h2 className="font-display mt-2 text-2xl font-semibold text-[#192820]">Acessos cadastrados</h2><p className="mt-2 text-sm text-[#718078]">A senha nunca fica visível. A recuperação vai para a caixa central.</p></div>
      {loading ? <div className="grid min-h-64 place-items-center"><LoaderCircle className="animate-spin text-[#00BF63]" /></div> : profiles.length ? <Table><TableHeader><TableRow><TableHead className="pl-6">Pessoa</TableHead><TableHead>Função e permissões</TableHead><TableHead>Recuperação</TableHead><TableHead /></TableRow></TableHeader><TableBody>{profiles.map((profile) => { const box = units.find((item) => item.id === profile.recovery_unit_id); return <TableRow key={profile.user_id}><TableCell className="py-4 pl-6"><p className="font-medium text-[#213128]">{profile.full_name}</p><p className="mt-1 text-xs text-[#839087]">{profile.username}@lyvrafinanceiro</p></TableCell><TableCell><div className="flex flex-wrap gap-1.5"><Badge variant="secondary">{roleLabels[profile.role]}</Badge><Badge className="bg-[#edf8f1] text-[#27704b] hover:bg-[#edf8f1]">{areaLabels[profile.operational_area ?? (profile.role === "suporte" ? "support" : ["gestora", "ceo"].includes(profile.role) ? "management" : "none")]}</Badge></div></TableCell><TableCell>{profile.role === "suporte" ? "E-mail pessoal" : box?.name ?? "—"}</TableCell><TableCell className="text-right"><Button variant="outline" size="sm" disabled={recovering === profile.user_id} onClick={() => void requestRecovery(profile)} className="rounded-xl">{recovering === profile.user_id ? <LoaderCircle className="animate-spin" /> : <Mail />} Recuperar senha</Button></TableCell></TableRow>; })}</TableBody></Table> : <div className="grid min-h-64 place-items-center px-6 text-center text-sm text-[#718078]">Nenhum acesso ativado ainda.</div>}
    </section>
  </div>;
}

function SupportView({ goTo }: { goTo: (view: View) => void }) {
  return <div className="space-y-5"><section className="rounded-[24px] border border-[#dfe5df] bg-white p-6"><p className="eyebrow">O QUE FAZER AQUI</p><h2 className="font-display mt-2 text-2xl font-semibold text-[#192820]">Corrija acesso ou integração</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-[#718078]">Se o problema for login, senha ou unidade liberada, abra Gerenciar acessos. Se os dados não estiverem sincronizando, abra Integrações.</p></section><section className="grid gap-4 md:grid-cols-2"><button type="button" onClick={() => goTo("access")} className="surface-card rounded-[24px] p-6 text-left transition hover:border-[#00BF63]"><UserCog className="size-6 text-[#00884a]" /><h3 className="font-display mt-5 text-xl font-semibold text-[#192820]">Gerenciar acessos</h3><p className="mt-2 text-sm leading-6 text-[#718078]">Criar usuário, conferir unidades liberadas e enviar recuperação de senha.</p></button><button type="button" onClick={() => goTo("integrations")} className="surface-card rounded-[24px] p-6 text-left transition hover:border-[#00BF63]"><Link2 className="size-6 text-[#00884a]" /><h3 className="font-display mt-5 text-xl font-semibold text-[#192820]">Ver integrações</h3><p className="mt-2 text-sm leading-6 text-[#718078]">Conferir Clinicorp e sincronizar as baixas de Sorocaba ou Salto quando necessário.</p></button></section></div>;
}

function IntegrationsView() {
  const [statuses, setStatuses] = useState<Partial<Record<ClinicorpUnitCode, ClinicorpFunctionResponse>>>({});
  const [busyUnit, setBusyUnit] = useState<ClinicorpUnitCode | null>(null);
  const [preview, setPreview] = useState<Partial<Record<ClinicorpUnitCode, ClinicorpFunctionResponse["preview"]>>>({});

  const loadStatuses = useCallback(async () => {
    const results = await Promise.all(clinicorpUnits.map(async (item) => {
      try {
        const result = await invokeClinicorp({ action: "status", unitCode: item.code });
        return [item.code, result] as const;
      } catch (error) {
        return [item.code, {
          ok: false,
          message: await clinicorpErrorMessage(error),
          credentialsConfigured: false,
          connection: null,
        }] as const;
      }
    }));
    setStatuses(Object.fromEntries(results));
  }, []);

  useEffect(() => {
    const pendingLoad = window.setTimeout(() => {
      void loadStatuses();
    }, 0);
    return () => window.clearTimeout(pendingLoad);
  }, [loadStatuses]);

  const discover = async (unitCode: ClinicorpUnitCode) => {
    setBusyUnit(unitCode);
    try {
      const result = await invokeClinicorp({ action: "discover", unitCode });
      toast.success("Conexão Clinicorp validada", {
        description: result.connection?.businessName ?? "A unidade foi identificada e separada na base.",
      });
      await loadStatuses();
    } catch (error) {
      toast.error("Não foi possível validar o Clinicorp", { description: await clinicorpErrorMessage(error) });
    } finally {
      setBusyUnit(null);
    }
  };

  const readPreview = async (unitCode: ClinicorpUnitCode) => {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - 6);
    setBusyUnit(unitCode);
    try {
      const result = await invokeClinicorp({
        action: "preview_payments",
        unitCode,
        from: saoPauloDate(from),
        to: saoPauloDate(to),
      });
      setPreview((current) => ({ ...current, [unitCode]: result.preview }));
      toast.success("Leitura real concluída", {
        description: "A amostra foi analisada sem cadastrar pacientes ou pagamentos.",
      });
      await loadStatuses();
    } catch (error) {
      toast.error("A leitura não foi concluída", { description: await clinicorpErrorMessage(error) });
    } finally {
      setBusyUnit(null);
    }
  };

  const syncPayments = async (unitCode: ClinicorpUnitCode) => {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - 6);
    setBusyUnit(unitCode);
    try {
      const bootstrap = await invokeClinicorpBootstrap(unitCode);
      if (bootstrap.bootstrap && !bootstrap.alreadyComplete) {
        const sync = bootstrap.sync;
        if (!sync) throw new Error("O resumo da conciliação histórica não foi retornado.");
        toast.success("Histórico do Clinicorp conciliado", {
          description: `${sync.paidInstallments} parcela(s) ficaram pagas • ${sync.createdCount + sync.updatedCount} pagamento(s) vinculados • ${sync.skippedCount} item(ns) ficaram para revisão.`,
        });
        await loadStatuses();
        return;
      }

      const result = await invokeClinicorp({
        action: "sync_existing_payments",
        unitCode,
        from: saoPauloDate(from),
        to: saoPauloDate(to),
      });
      const sync = result.sync;
      if (!sync) throw new Error("O resumo da sincronização não foi retornado.");

      const changed = sync.createdCount + sync.updatedCount;
      if (changed > 0) {
        toast.success("Baixas sincronizadas", {
          description: `${sync.paidInstallments} parcela(s) ficaram pagas • ${changed} pagamento(s) vinculados.`,
        });
      } else {
        toast.info("Nenhuma baixa vinculada", {
          description: sync.skippedCount
            ? `${sync.skippedCount} movimento(s) foram ignorados porque ainda não há correspondência segura no LYVRA.`
            : "Não há novas baixas confirmadas para os pacientes cadastrados.",
        });
      }
      if (sync.failedCount) {
        toast.warning(`${sync.failedCount} movimento(s) precisam de revisão técnica.`);
      }
      await loadStatuses();
    } catch (error) {
      toast.error("As baixas não foram sincronizadas", { description: await clinicorpErrorMessage(error) });
    } finally {
      setBusyUnit(null);
    }
  };

  return <div className="space-y-5">
    <section className="rounded-[24px] border border-[#dfe5df] bg-white p-6"><p className="eyebrow">COMO USAR</p><h2 className="font-display mt-2 text-2xl font-semibold text-[#192820]">Clinicorp por unidade</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-[#718078]">Use “Sincronizar baixas” quando precisar atualizar pagamentos. Faça uma unidade por vez e confira a mensagem final antes de iniciar a próxima.</p></section>

    <section className="grid gap-4 xl:grid-cols-2">
      {clinicorpUnits.map((item) => {
        const response = statuses[item.code];
        const connection = response?.connection;
        const summary = preview[item.code];
        const busy = busyUnit === item.code;
        const connected = connection?.status === "connected";
        return <article key={item.code} className="surface-card rounded-[24px] p-6">
          <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-center gap-3"><div className="grid size-12 place-items-center rounded-2xl bg-[#e7f2e8] text-[#39704a]"><Database className="size-5" /></div><div><p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#8a958e]">Clinicorp</p><h3 className="font-display mt-1 text-xl font-semibold text-[#1c2c23]">{item.name}</h3></div></div><Badge variant="outline" className={connected ? "border-[#b8dbc7] bg-[#edf8f1] text-[#27704b]" : "text-[#6f7d75]"}>{clinicorpStatusLabel(response)}</Badge></div>
          <div className="mt-6 grid gap-3 rounded-2xl bg-[#fafbf8] p-4 text-sm text-[#65736b] sm:grid-cols-2"><div><p className="text-[10px] font-bold uppercase tracking-[.1em] text-[#929c96]">Assinante</p><p className="mt-1 font-medium text-[#405148]">{connection?.subscriberId ?? "A identificar"}</p></div><div><p className="text-[10px] font-bold uppercase tracking-[.1em] text-[#929c96]">Clínica</p><p className="mt-1 font-medium text-[#405148]">{connection?.businessId ?? "A identificar"}</p></div></div>
          {response?.message && !response.ok && <p className="mt-4 rounded-xl bg-[#fff6ee] px-4 py-3 text-sm text-[#8a5b35]">{response.message}</p>}
          {connection?.lastError && <p className="mt-4 rounded-xl bg-[#fae8e3] px-4 py-3 text-sm text-[#934e3f]">{connection.lastError}</p>}
          {summary && <div className="mt-4 space-y-3 rounded-2xl border border-[#dfe7df] p-4"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#86918a]">Amostra dos últimos 7 dias</p><div className="grid grid-cols-2 gap-3 text-sm"><div><p className="text-[#7c8981]">Parcelas lançadas</p><p className="mt-1 text-lg font-semibold text-[#26372e]">{summary.posted.totalRows}</p></div><div><p className="text-[#7c8981]">Recebimentos</p><p className="mt-1 text-lg font-semibold text-[#26372e]">{summary.received.totalRows}</p></div><div><p className="text-[#7c8981]">Pacientes com novos acordos</p><p className="mt-1 font-semibold text-[#26372e]">{summary.posted.uniquePatients}</p></div><div><p className="text-[#7c8981]">Pacientes com baixas</p><p className="mt-1 font-semibold text-[#26372e]">{summary.received.uniquePatients}</p></div><div><p className="text-[#7c8981]">Valor recebido</p><p className="mt-1 font-semibold text-[#26372e]">{moneyValue(summary.received.totalAmount)}</p></div></div><div className="rounded-xl bg-[#edf8f1] px-3 py-3 text-xs leading-5 text-[#326249]"><strong>Mapeamento financeiro pronto:</strong> {summary.mapping.eligibleInstallments} parcelas e {summary.mapping.eligibleReceipts} baixas de boleto/cartão. {summary.mapping.skippedInstallments + summary.mapping.skippedReceipts} movimentações de Pix, dinheiro ou transferência ficarão fora do LYVRA.</div></div>}
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap"><Button disabled={busy || !response?.credentialsConfigured} onClick={() => void discover(item.code)} className="h-10 rounded-xl">{busy ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />} Validar conexão</Button><Button disabled={busy || !connected} onClick={() => void readPreview(item.code)} variant="outline" className="h-10 rounded-xl">{busy ? <LoaderCircle className="animate-spin" /> : <Eye />} Ler últimos 7 dias</Button><Button disabled={busy || !connected} onClick={() => void syncPayments(item.code)} variant="outline" className="h-10 rounded-xl border-[#b8dbc7] bg-[#edf8f1] text-[#27704b] hover:bg-[#e2f4e9]">{busy ? <LoaderCircle className="animate-spin" /> : <CheckCircle2 />} Sincronizar baixas</Button></div><p className="mt-3 text-xs leading-5 text-[#718078]">A primeira sincronização concilia o histórico desde o início dos planos. Depois, o LYVRA atualiza somente o período recente. Nenhum paciente novo é criado pelo Clinicorp, e a baixa só é aplicada quando o pagamento está confirmado.</p>
          {!response?.credentialsConfigured && <p className="mt-3 text-xs leading-5 text-[#87928c]">Aguardando o Usuário API e o Token API desta assinatura nos segredos protegidos do servidor.</p>}
        </article>;
      })}
    </section>

  </div>;
}

function ObligationsTable({ title, description, obligations, compact = false, onIssued }: { title: string; description: string; obligations: InvoiceObligation[]; compact?: boolean; onIssued?: (id: number) => void | Promise<void> }) {
  return <div className="surface-card overflow-hidden rounded-[24px]"><div className="flex flex-col gap-4 border-b border-[#e7ebe7] p-5 sm:flex-row sm:items-center sm:justify-between md:px-6"><div><h3 className="font-display text-lg font-semibold text-[#192820]">{title}</h3><p className="mt-1 text-sm text-[#718078]">{description}</p></div>{compact&&<div className="relative w-full sm:w-56"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8b9690]"/><Input placeholder="Buscar paciente" className="h-10 rounded-xl bg-[#fafbf8] pl-9"/></div>}</div><Table><TableHeader><TableRow className="bg-[#fafbf8]"><TableHead className="pl-6">Paciente</TableHead><TableHead>Referência</TableHead><TableHead>Valor</TableHead><TableHead>Situação</TableHead><TableHead className="w-20"/></TableRow></TableHeader><TableBody>{obligations.map(item=><TableRow key={item.id}><TableCell className="py-4 pl-6"><p className="font-medium">{item.patient}</p><p className="mt-1 text-xs text-[#849087]">{item.unit}</p></TableCell><TableCell>{item.reference}{item.scheduledIssueDate&&<p className="mt-1 text-xs text-[#839087]">Prevista {formatIsoDate(item.scheduledIssueDate)}</p>}</TableCell><TableCell className="font-semibold">{item.amount}</TableCell><TableCell><StatusBadge tone={item.tone}>{item.status}</StatusBadge></TableCell><TableCell>{onIssued&&["ready","open"].includes(item.rawStatus)?<Button onClick={()=>onIssued(item.id)} variant="outline" size="sm">Marcar emitida</Button>:<AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" size="icon-sm"><MoreHorizontal/><span className="sr-only">Ver detalhes</span></Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{item.patient}</AlertDialogTitle><AlertDialogDescription>Confira os dados desta obrigação.</AlertDialogDescription></AlertDialogHeader><div className="grid gap-3 rounded-xl bg-[#f7f9f6] p-4 text-sm"><div className="flex justify-between"><span>Unidade</span><strong>{item.unit}</strong></div><div className="flex justify-between"><span>Referência</span><strong>{item.reference}</strong></div><div className="flex justify-between"><span>Valor</span><strong>{item.amount}</strong></div><div className="flex justify-between"><span>Situação</span><strong>{item.status}</strong></div>{item.scheduledIssueDate&&<div className="flex justify-between"><span>Emissão prevista</span><strong>{formatIsoDate(item.scheduledIssueDate)}</strong></div>}</div><AlertDialogFooter><AlertDialogCancel>Fechar</AlertDialogCancel></AlertDialogFooter></AlertDialogContent></AlertDialog>}</TableCell></TableRow>)}</TableBody></Table>{!obligations.length&&<div className="grid min-h-44 place-items-center text-sm text-[#7d8982]">Nenhuma obrigação neste filtro.</div>}</div>;
}

function MetricCard({ label, value, detail, icon: Icon, accent }: { label: string; value: string; detail: string; icon: typeof FileText; accent: string }) {
  return <article className="surface-card metric-card rounded-[22px] p-5"><div className="flex items-start justify-between"><div className={`metric-icon metric-${accent}`}><Icon /></div></div><div className="mt-5 flex items-end justify-between gap-3"><div><p className="font-display text-[32px] font-semibold leading-none tracking-tight text-[#1a2b22]">{value}</p><p className="mt-2 text-sm text-[#68766e]">{label}</p></div><p className="mb-0.5 text-xs font-semibold tabular-nums text-[#506158]">{detail}</p></div></article>;
}

function QuarterCard({ obligations }: { obligations: InvoiceObligation[] }) {
  const open = obligations.filter((item) => !["issued", "cancelled"].includes(item.rawStatus));
  const amount = open.reduce((sum, item) => sum + item.amountValue, 0);
  const next = [...open].filter((item) => item.scheduledIssueDate).sort((a, b) => String(a.scheduledIssueDate).localeCompare(String(b.scheduledIssueDate)))[0];
  return <div className="surface-card rounded-[24px] p-5 md:p-6"><div className="flex items-start justify-between"><div><p className="eyebrow">AGENDA FISCAL</p><h3 className="font-display mt-2 text-xl font-semibold">Próximas emissões</h3></div><div className="grid size-10 place-items-center rounded-2xl bg-[#e4f8ee] text-[#00884a]"><CalendarDays className="size-5" /></div></div><div className="mt-6"><p className="text-sm text-[#78857e]">Valor previsto nas obrigações abertas</p><p className="font-display mt-1 text-3xl font-semibold tracking-tight">{moneyValue(amount)}</p></div><div className="mt-5 flex justify-between gap-3 border-t border-[#e9eee7] pt-4 text-xs text-[#849087]"><span>{open.length} obrigação(ões)</span><span>{next?.scheduledIssueDate ? `Próxima: ${formatIsoDate(next.scheduledIssueDate)}` : "Sem emissão prevista"}</span></div></div>;
}

function ActivityCard({ obligations }: { obligations: InvoiceObligation[] }) {
  const issued = obligations.filter((item) => item.rawStatus === "issued").length;
  const pending = obligations.filter((item) => !["issued", "cancelled"].includes(item.rawStatus)).length;
  const amount = obligations.reduce((sum, item) => sum + item.amountValue, 0);
  return <div className="surface-card rounded-[24px] p-5 md:p-6"><p className="eyebrow">RESUMO DA COMPETÊNCIA</p><h3 className="font-display mt-2 text-lg font-semibold">Leitura do período</h3><div className="mt-5 grid grid-cols-2 gap-3 text-sm"><div className="rounded-2xl bg-[#f7f9f6] p-4"><p className="text-xs text-[#7d8982]">Emitidas</p><p className="mt-1 text-xl font-semibold text-[#26372e]">{issued}</p></div><div className="rounded-2xl bg-[#f7f9f6] p-4"><p className="text-xs text-[#7d8982]">Pendentes</p><p className="mt-1 text-xl font-semibold text-[#26372e]">{pending}</p></div></div><p className="mt-4 text-xs text-[#849087]">Valor total registrado na competência: <strong>{moneyValue(amount)}</strong></p></div>;
}

function RuleCard({ title, label, description }: { title: string; label: string; description: string }) {
  return <article className="surface-card flex items-start gap-4 rounded-[22px] p-5"><div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#edf4e7] text-[#5e793f]"><Building2 className="size-5" /></div><div><p className="text-sm font-semibold text-[#26372e]">{title}</p><p className="mt-1 text-xs font-semibold uppercase tracking-[.08em] text-[#77905e]">{label}</p><p className="mt-2 text-sm leading-6 text-[#718078]">{description}</p></div></article>;
}

function CheckLine({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2"><span className="grid size-5 place-items-center rounded-full bg-[#e4f8ee] text-[#00884a]"><Check className="size-3" /></span>{children}</div>;
}
