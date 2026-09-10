"use client";

import { accessAuth } from "@/lib/access-auth";
import { AboveframeBrand } from "@/components/password-recovery";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { LYVRA_ICON_DATA_URL } from "@/lib/lyrva-icon-data";
import { CollectionsJourney } from "@/components/collections-journey";
import { FinancialJourney } from "@/components/financial-journey";
import { FinancialNotifications } from "@/components/financial-notifications";
import { DueTaskAlert } from "@/components/due-task-alert";
import { ManualPatientDialog } from "@/components/manual-patient-dialog";
import { NfWorkbookImportView } from "@/components/nf-workbook-import";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type View = "dashboard" | "journey" | "invoices" | "collections" | "patients" | "import" | "access" | "support" | "integrations";
type Role = "membro" | "gestora" | "ceo" | "suporte";

type UserAccount = {
  id: string;
  name: string;
  email: string;
  role: Role;
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
  };
};

const navItems: { id: View; label: string; icon: typeof LayoutDashboard; badge?: string }[] = [
  { id: "dashboard", label: "Visão geral", icon: LayoutDashboard },
  { id: "journey", label: "Jornada financeira", icon: Sparkles },
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
  dashboard: { eyebrow: "Operação financeira", title: "Visão geral" },
  journey: { eyebrow: "Operação financeira", title: "Jornada financeira" },
  invoices: { eyebrow: "Controle fiscal", title: "Notas fiscais" },
  collections: { eyebrow: "Jornada do financeiro", title: "Régua de cobrança" },
  patients: { eyebrow: "Base de cadastros", title: "Pacientes" },
  import: { eyebrow: "Carga inicial", title: "Importar planilha" },
  access: { eyebrow: "Equipe e segurança", title: "Gerenciar acessos" },
  support: { eyebrow: "Administração técnica", title: "Central de suporte" },
  integrations: { eyebrow: "Conexões do sistema", title: "Integrações" },
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
          <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#6f7e75]">Inteligência financeira</p>
        </header>

        <div className="login-ribbon" aria-label="Pagamentos, notas e rotinas">
          <span>Pagamentos</span><span className="login-ribbon-dot" aria-hidden="true" /><span>Notas</span><span className="login-ribbon-dot" aria-hidden="true" /><span>Rotinas</span>
        </div>

        <div className="login-card">
          <div className="text-center">
            <p className="eyebrow">ACESSO AO FINANCEIRO</p>
            <h1 className="font-display mt-3 text-3xl font-semibold tracking-tight text-[#172a21]">Bem-vindo de volta</h1>
            <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-[#75827a]">Entre com os dados fornecidos pela equipe responsável.</p>
          </div>

          <form className="mt-8 space-y-5" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="login-username" className="text-sm font-semibold text-[#33473c]">Usuário</Label>
              <Input id="login-username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value.toLowerCase())} placeholder="Ex.: daiane@lyvrafinanceiro" className="h-12 rounded-xl border-[#dce4de] bg-[#fbfcfa] px-4 shadow-none focus-visible:ring-[#00BF63]" required />
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
  const [reminderCount, setReminderCount] = useState(0);

  const loadProfile = useCallback(async (userId: string): Promise<UserAccount | null> => {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("user_id, full_name, email, role, is_active")
      .eq("user_id", userId)
      .single();

    if (error || !data?.is_active) return null;
    return {
      id: data.user_id,
      name: data.full_name,
      email: data.email,
      role: data.role as Role,
    };
  }, []);

  const loadFinancialData = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    setLoadingPatients(true);
    try {
      const tomorrow = new Date();
      tomorrow.setHours(0, 0, 0, 0);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const afterTomorrow = new Date(tomorrow);
      afterTomorrow.setDate(afterTomorrow.getDate() + 1);

      const [patientResult, obligationResult, reminderResult] = await Promise.all([
        supabase.from("patient_directory").select("*").order("full_name"),
        supabase.from("invoice_queue").select("*").order("period_end", { ascending: true }),
        supabase
          .from("financial_tasks")
          .select("id", { count: "exact", head: true })
          .eq("kind", "payment_reminder")
          .gte("due_at", tomorrow.toISOString())
          .lt("due_at", afterTomorrow.toISOString())
          .in("status", ["pending", "in_progress"]),
      ]);

      const firstError = patientResult.error ?? obligationResult.error ?? reminderResult.error;
      if (firstError) throw firstError;

      const paymentLabels: Record<string, string> = {
        boleto: "Boleto",
        card: "Cartão",
        pix: "Pix",
        cash: "Dinheiro",
        transfer: "Transferência",
        other: "Outro",
      };

      setPatients((patientResult.data ?? []).map((row) => {
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
      }); }));

      setObligations((obligationResult.data ?? []).map((row) => {
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
        };
      }));
      setReminderCount(reminderResult.count ?? 0);
    } catch (error) {
      setPatients([]);
      setObligations([]);
      setReminderCount(0);
      throw error;
    } finally {
      setLoadingPatients(false);
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

      if (active) setCurrentUser(account);
      try {
        await loadFinancialData();
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

  const unitFilter = <UnitSelect value={unit} onChange={setUnit} />;

  const markIssued = async (id: number) => {
    const supabase = getSupabaseBrowserClient();
    const timestamp = new Date().toISOString();
    const obligation = obligations.find((item) => item.id === id);
    const { error } = await supabase
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
    try {
      await loadFinancialData();
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

  const visibleNavItems = navItems.filter((item) => {
    if (item.id === "integrations") return currentUser.role === "suporte";
    if (item.id === "support") return currentUser.role === "suporte";
    if (item.id === "access") return ["gestora", "ceo", "suporte"].includes(currentUser.role);
    return true;
  });
  const userInitials = initials(currentUser.name);

  return (
    <SidebarProvider className="app-density">
      <Toaster position="top-right" richColors />
      <DueTaskAlert userId={currentUser.id} onOpenJourney={() => setView("journey")} />
      <Sidebar collapsible="icon" className="border-r-0 bg-[#10221f] text-white">
        <SidebarHeader className="px-4 pb-3 pt-5">
          <div className="flex items-center gap-3 overflow-hidden px-1">
            <LyvraMark />
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <p className="font-display text-[22px] font-semibold leading-none tracking-[0.18em]">LYVRA</p>
              <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.18em] text-white/45">inteligência financeira</p>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent className="px-2">
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.16em] text-white/35">Operação</SidebarGroupLabel>
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
            <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden"><p className="truncate text-sm font-medium text-white">{currentUser.name}</p><p className="truncate text-xs text-white/42">{roleLabels[currentUser.role]}</p></div>
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
            {unitFilter}
            <FinancialNotifications userId={currentUser.id} unit={unit} onOpenJourney={() => setView("journey")} />
          </div>
        </header>

        <main className="min-h-[calc(100svh-4.5rem)] bg-[#f7f8f4] p-4 md:p-7">
          <div className="mx-auto max-w-[1500px]">
            {view === "dashboard" && <DashboardView unit={unit} obligations={obligations} reminderCount={reminderCount} goTo={setView} />}
            {view === "journey" && <FinancialJourney unit={unit} />}
            {view === "invoices" && <InvoicesView unit={unit} obligations={obligations} onIssued={markIssued} />}
            {view === "collections" && <CollectionsJourney unit={unit} />}
            {view === "patients" && <PatientsView unit={unit} patients={patients} loading={loadingPatients} goTo={setView} onSaved={loadFinancialData} />}
            {view === "import" && <NfWorkbookImportView onImported={async () => { await loadFinancialData(); setView("patients"); }} />}
            {view === "access" && ["gestora", "ceo", "suporte"].includes(currentUser.role) && <AccessManagementView currentRole={currentUser.role} />}
            {view === "support" && currentUser.role === "suporte" && <SupportView goTo={setView} />}
            {view === "integrations" && currentUser.role === "suporte" && <IntegrationsView />}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

function UnitSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <Select value={value} onValueChange={onChange}><SelectTrigger aria-label="Selecionar unidade" className="h-10 w-10 rounded-xl border-[#dfe5df] bg-white px-0 text-[#25362e] shadow-none sm:min-w-39 sm:px-3"><Building2 className="size-4 text-[#6f7b74]" /><span className="hidden sm:inline"><SelectValue /></span></SelectTrigger><SelectContent><SelectItem value="todas">Todas as unidades</SelectItem><SelectItem value="sorocaba">Sorocaba</SelectItem><SelectItem value="salto">Salto de Pirapora</SelectItem></SelectContent></Select>;
}

function DashboardView({ unit, obligations, reminderCount, goTo }: { unit: string; obligations: InvoiceObligation[]; reminderCount: number; goTo: (view: View) => void }) {
  const allFiltered = obligations.filter((item) => unit === "todas" || (unit === "sorocaba" ? item.unit === "Sorocaba" : item.unit === "Salto de Pirapora"));
  const pending = allFiltered.filter((item) => item.rawStatus !== "issued" && item.rawStatus !== "cancelled").slice(0, 4);
  const ready = allFiltered.filter((item) => item.rawStatus === "ready");
  const waiting = allFiltered.filter((item) => ["forecast", "awaiting_payment", "payment_unconfirmed", "open"].includes(item.rawStatus));
  const issued = allFiltered.filter((item) => item.rawStatus === "issued");
  const total = (items: InvoiceObligation[]) => moneyValue(items.reduce((sum, item) => sum + item.amountValue, 0));
  return <div className="space-y-5">
    <section className="hero-panel overflow-hidden rounded-[28px] px-5 py-6 text-white md:px-8 md:py-7"><div className="relative z-10 flex flex-col justify-between gap-7 lg:flex-row lg:items-end"><div><Badge className="mb-4 border border-white/12 bg-white/8 px-3 py-1 text-[11px] font-medium text-white hover:bg-white/8"><span className="mr-1.5 size-1.5 rounded-full bg-[#00BF63]" />BASE REAL CONECTADA</Badge><h2 className="font-display max-w-2xl text-3xl font-medium leading-tight tracking-[-0.035em] md:text-[42px]">O financeiro organizado,<br className="hidden sm:block" /> sem nada escapar.</h2><p className="mt-3 max-w-xl text-sm leading-6 text-white/58 md:text-base">{allFiltered.length ? `${allFiltered.length} obrigação(ões) fiscal(is) carregada(s) da base.` : "A estrutura está pronta e aguarda a primeira importação de pacientes e pagamentos."}</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" className="h-11 rounded-xl border-white/15 bg-white/8 px-4 text-white shadow-none hover:bg-white/14 hover:text-white"><CalendarDays /> Dados em tempo real</Button><Button onClick={() => goTo("invoices")} className="h-11 rounded-xl bg-[#00BF63] px-5 text-[#10221f] shadow-none hover:bg-[#00D66F]">Ver notas a emitir <ChevronRight /></Button></div></div></section>
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Prontas para emissão" value={String(ready.length)} detail={total(ready)} icon={FileText} accent="lime" /><MetricCard label="Em acompanhamento" value={String(waiting.length)} detail={total(waiting)} icon={CircleDollarSign} accent="amber" /><MetricCard label="Notas emitidas" value={String(issued.length)} detail={total(issued)} icon={CheckCircle2} accent="blue" /><MetricCard label="Lembretes amanhã" value={String(reminderCount)} detail="Agendados" icon={MessageCircle} accent="violet" /></section>
    <section className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,.7fr)]"><ObligationsTable title="Pendências operacionais" description="Obrigações que pedem uma ação da equipe." obligations={pending} compact /><div className="space-y-5"><QuarterCard obligations={allFiltered} /><ActivityCard /></div></section>
  </div>;
}

function InvoicesView({ unit, obligations, onIssued }: { unit: string; obligations: InvoiceObligation[]; onIssued: (id: number) => void | Promise<void> }) {
  const [status, setStatus] = useState("todos");
  const filtered = obligations.filter((item) => (unit === "todas" || (unit === "sorocaba" ? item.unit === "Sorocaba" : item.unit === "Salto de Pirapora")) && (status === "todos" || item.tone === status));
  return <div className="space-y-5">
    <section className="flex flex-col justify-between gap-4 rounded-[24px] border border-[#dfe5df] bg-white p-5 md:flex-row md:items-center md:p-6"><div><p className="eyebrow">OBRIGAÇÕES REAIS</p><h2 className="font-display mt-2 text-2xl font-semibold text-[#192820]">Fila de emissão</h2><p className="mt-2 text-sm text-[#718078]">O paciente permanece aqui até a emissão ser concluída.</p></div><div className="flex flex-wrap gap-2"><Select value={status} onValueChange={setStatus}><SelectTrigger className="h-10 min-w-48 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todos">Todas as situações</SelectItem><SelectItem value="ready">Prontas para emissão</SelectItem><SelectItem value="waiting">Aguardando baixa</SelectItem><SelectItem value="cycle">Ciclo anterior</SelectItem><SelectItem value="issue">Com pendência</SelectItem><SelectItem value="done">Emitidas</SelectItem></SelectContent></Select><Button className="h-10 rounded-xl" onClick={() => toast.info("A emissão automática entra após definirmos o emissor fiscal.") }><ReceiptText /> Emitir selecionadas</Button></div></section>
    <ObligationsTable title="Obrigações fiscais" description={`${filtered.length} registros encontrados`} obligations={filtered} onIssued={onIssued} />
    <div className="grid gap-4 md:grid-cols-2"><RuleCard title="Cartão" label="1 NF por ano" description="A NF é prevista no primeiro recebimento do ano e considera as parcelas daquele ano-calendário." /><RuleCard title="Boleto" label="Fim do parcelamento ou 31/12" description="A NF é prevista no término do parcelamento ou em 31 de dezembro, o que acontecer primeiro. O restante segue para o ano seguinte." /></div>
  </div>;
}

function PatientsView({ unit, patients, loading, goTo, onSaved }: { unit: string; patients: Patient[]; loading: boolean; goTo: (view: View) => void; onSaved: () => Promise<void> }) {
  const [query, setQuery] = useState("");
  const filtered = patients.filter((patient) => (unit === "todas" || (unit === "sorocaba" ? patient.unit === "Sorocaba" : patient.unit === "Salto de Pirapora")) && patient.name.toLowerCase().includes(query.toLowerCase()));
  return <div className="space-y-5">
    <section className="surface-card overflow-hidden rounded-[24px]"><div className="flex flex-col gap-4 border-b border-[#e7ebe7] p-5 sm:flex-row sm:items-center sm:justify-between md:p-6"><div><h2 className="font-display text-xl font-semibold text-[#192820]">Pacientes cadastrados</h2><p className="mt-1 text-sm text-[#718078]">Somente quem estiver marcado para IR entra na rotina de notas.</p></div><div className="flex flex-wrap gap-2"><div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8b9690]" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar paciente" className="h-10 w-52 rounded-xl pl-9 shadow-none" /></div><ManualPatientDialog onSaved={onSaved} /><Button onClick={() => goTo("import")} variant="outline" className="h-10 rounded-xl"><UploadCloud /> Importar</Button></div></div>
      {loading ? <div className="grid min-h-64 place-items-center text-sm text-[#718078]"><LoaderCircle className="mr-2 inline size-4 animate-spin" />Carregando pacientes…</div> : filtered.length ? <Table><TableHeader><TableRow className="bg-[#fafbf8] hover:bg-[#fafbf8]"><TableHead className="pl-6">Paciente</TableHead><TableHead>Unidade</TableHead><TableHead>Pagamento</TableHead><TableHead>Periodicidade</TableHead><TableHead>Nota para IR</TableHead><TableHead className="w-12" /></TableRow></TableHeader><TableBody>{filtered.map((patient) => <TableRow key={`${patient.id}-${patient.name}`}><TableCell className="py-4 pl-6"><div><p className="font-medium text-[#213128]">{patient.name}</p><p className="mt-1 text-xs text-[#839087]">{patient.cpf || "CPF pendente"} • {patient.treatment || "Tratamento não informado"}</p></div></TableCell><TableCell>{patient.unit}</TableCell><TableCell><p>{patient.paymentMethod || "—"}</p><p className="mt-1 text-xs text-[#839087]">{money(patient.planAmountCents)}</p></TableCell><TableCell>{patient.invoiceDisabled ? <span className="text-[#a05a48]">Não emitir</span> : patient.invoiceFrequency || "Regra automática"}</TableCell><TableCell>{Boolean(patient.taxReceiptIr) ? <Badge className="bg-[#eaf5df] text-[#54752d] hover:bg-[#eaf5df]"><Check /> Sim</Badge> : <Badge variant="secondary">Não</Badge>}</TableCell><TableCell><Button variant="ghost" size="icon-sm"><MoreHorizontal /><span className="sr-only">Ações do paciente</span></Button></TableCell></TableRow>)}</TableBody></Table> : <div className="grid min-h-64 place-items-center px-6 text-center"><div><Users className="mx-auto size-9 text-[#b3bdb6]" /><p className="mt-4 font-medium text-[#4e5d54]">Nenhum paciente cadastrado</p><p className="mt-1 text-sm text-[#8a958e]">Importe a planilha oficial para iniciar a base real.</p><Button onClick={() => goTo("import")} variant="outline" className="mt-5 rounded-xl"><UploadCloud /> Importar planilha</Button></div></div>}
    </section>
  </div>;
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

type AccessUnit = { id: number; code: string; name: string; access_recovery_email: string };
type ManagedProfile = {
  user_id: string;
  username: string;
  full_name: string;
  role: Role;
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
      const result = await invokeAccessAdmin({ action: "invite", fullName, username, role, unitCode: recoveryUnit, unitCodes: selectedUnits });
      toast.success("Acesso criado", { description: result.message });
      setFullName(""); setUsername(""); setRole("membro");
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
        <div className="space-y-2"><Label htmlFor="access-username">Usuário de entrada</Label><div className="flex items-center rounded-md border border-input bg-transparent"><Input id="access-username" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/@lyvrafinanceiro$/, "").replace(/[^a-z0-9._-]/g, "").slice(0, 40))} placeholder="daiane" minLength={3} required className="border-0 shadow-none focus-visible:ring-0" /><span className="pr-3 text-sm text-[#718078]">@lyvrafinanceiro</span></div><p className="text-xs text-[#87928c]">Este será o login da pessoa no sistema.</p></div>
        <div className="space-y-2"><Label>Tipo de acesso</Label><Select value={role} onValueChange={(value) => setRole(value as Role)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="membro">Membro</SelectItem>{currentRole !== "gestora" && <><SelectItem value="gestora">Gestora</SelectItem><SelectItem value="ceo">CEO</SelectItem></>}</SelectContent></Select></div>
        <div className="space-y-2"><Label>Caixa de recuperação</Label><Select value={recoveryUnit} onValueChange={setRecoveryUnit}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{units.map((unit) => <SelectItem key={unit.code} value={unit.code}>{unit.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-2"><Label>Unidades liberadas</Label><div className="grid gap-2 sm:grid-cols-2">{units.map((unit) => <Button key={unit.code} type="button" variant={selectedUnits.includes(unit.code) ? "default" : "outline"} onClick={() => toggleUnit(unit.code)} className="justify-start rounded-xl">{selectedUnits.includes(unit.code) && <Check />}{unit.name}</Button>)}</div></div>
        <Button disabled={saving || !selectedUnits.length} className="h-11 w-full rounded-xl bg-[#183b32]">{saving ? <LoaderCircle className="animate-spin" /> : <UserCog />} Criar acesso e enviar código</Button>
      </form>
    </section>
    <section className="surface-card overflow-hidden rounded-[24px]"><div className="border-b border-[#e7ebe7] p-5 md:px-6"><p className="eyebrow">EQUIPE</p><h2 className="font-display mt-2 text-2xl font-semibold text-[#192820]">Acessos cadastrados</h2><p className="mt-2 text-sm text-[#718078]">A senha nunca fica visível. A recuperação vai para a caixa central.</p></div>
      {loading ? <div className="grid min-h-64 place-items-center"><LoaderCircle className="animate-spin text-[#00BF63]" /></div> : profiles.length ? <Table><TableHeader><TableRow><TableHead className="pl-6">Pessoa</TableHead><TableHead>Função</TableHead><TableHead>Recuperação</TableHead><TableHead /></TableRow></TableHeader><TableBody>{profiles.map((profile) => { const box = units.find((item) => item.id === profile.recovery_unit_id); return <TableRow key={profile.user_id}><TableCell className="py-4 pl-6"><p className="font-medium text-[#213128]">{profile.full_name}</p><p className="mt-1 text-xs text-[#839087]">{profile.username}@lyvrafinanceiro</p></TableCell><TableCell><Badge variant="secondary">{roleLabels[profile.role]}</Badge></TableCell><TableCell>{profile.role === "suporte" ? "E-mail pessoal" : box?.name ?? "—"}</TableCell><TableCell className="text-right"><Button variant="outline" size="sm" disabled={recovering === profile.user_id} onClick={() => void requestRecovery(profile)} className="rounded-xl">{recovering === profile.user_id ? <LoaderCircle className="animate-spin" /> : <Mail />} Recuperar senha</Button></TableCell></TableRow>; })}</TableBody></Table> : <div className="grid min-h-64 place-items-center px-6 text-center text-sm text-[#718078]">Nenhum acesso ativado ainda.</div>}
    </section>
  </div>;
}

function SupportView({ goTo }: { goTo: (view: View) => void }) {
  return <div className="space-y-5"><section className="hero-panel overflow-hidden rounded-[28px] px-6 py-7 text-white md:px-8"><AboveframeBrand /><p className="eyebrow mt-6 text-[#7deeb4]">SUPORTE LYRVA</p><h2 className="font-display mt-3 text-3xl font-medium">Controle técnico em um só lugar.</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-white/60">Gerencie acessos, envie recuperação de senha, acompanhe as conexões das unidades.</p></section><section className="grid gap-4 md:grid-cols-2"><button type="button" onClick={() => goTo("access")} className="surface-card rounded-[24px] p-6 text-left transition hover:-translate-y-0.5 hover:border-[#00BF63]"><UserCog className="size-6 text-[#00884a]" /><h3 className="font-display mt-5 text-xl font-semibold text-[#192820]">Usuários e senhas</h3><p className="mt-2 text-sm leading-6 text-[#718078]">Criar acessos, escolher unidades e solicitar recuperação pela caixa central.</p></button><button type="button" onClick={() => goTo("integrations")} className="surface-card rounded-[24px] p-6 text-left transition hover:-translate-y-0.5 hover:border-[#00BF63]"><Link2 className="size-6 text-[#00884a]" /><h3 className="font-display mt-5 text-xl font-semibold text-[#192820]">Integrações</h3><p className="mt-2 text-sm leading-6 text-[#718078]">Validar Clinicorp por unidade e acompanhar a saúde das conexões.</p></button></section></div>;
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

  const secondaryCards = [
    { name: "WhatsApp Business", icon: MessageCircle, status: "Aguardando configuração", description: "Lembrete D-1 e confirmação automática de pagamento.", accent: "#e6f4ef", color: "#26735d", next: "Conta Meta e número oficial" },
    { name: "Emissor de NFS-e", icon: ReceiptText, status: "Planejado", description: "Na primeira fase, o LYVRA controla a emissão manual.", accent: "#eeeafb", color: "#7261b9", next: "Definir emissor e certificado" },
  ];

  return <div className="space-y-5">
    <section className="hero-panel overflow-hidden rounded-[28px] p-6 text-white md:p-8"><div className="relative z-10 max-w-3xl"><Badge className="border border-white/12 bg-white/8 text-white hover:bg-white/8">CLINICORP • FASE DE LEITURA</Badge><h2 className="font-display mt-4 text-3xl font-medium md:text-4xl">Cada clínica conectada no seu próprio acesso.</h2><p className="mt-3 text-sm leading-6 text-white/60">Primeiro validamos Sorocaba e Salto separadamente. A leitura inicial identifica os campos e as baixas reais, mas ainda não cadastra nem altera nenhum pagamento.</p></div></section>

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
          {summary && <div className="mt-4 rounded-2xl border border-[#dfe7df] p-4"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#86918a]">Amostra dos últimos 7 dias</p><div className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><p className="text-[#7c8981]">Parcelas lançadas</p><p className="mt-1 text-lg font-semibold text-[#26372e]">{summary.posted.totalRows}</p></div><div><p className="text-[#7c8981]">Recebimentos</p><p className="mt-1 text-lg font-semibold text-[#26372e]">{summary.received.totalRows}</p></div><div><p className="text-[#7c8981]">Pacientes localizados</p><p className="mt-1 font-semibold text-[#26372e]">{summary.posted.uniquePatients}</p></div><div><p className="text-[#7c8981]">Valor recebido</p><p className="mt-1 font-semibold text-[#26372e]">{moneyValue(summary.received.totalAmount)}</p></div></div></div>}
          <div className="mt-6 flex flex-col gap-2 sm:flex-row"><Button disabled={busy || !response?.credentialsConfigured} onClick={() => void discover(item.code)} className="h-10 rounded-xl">{busy ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />} Validar conexão</Button><Button disabled={busy || !connected} onClick={() => void readPreview(item.code)} variant="outline" className="h-10 rounded-xl">{busy ? <LoaderCircle className="animate-spin" /> : <Eye />} Ler últimos 7 dias</Button></div>
          {!response?.credentialsConfigured && <p className="mt-3 text-xs leading-5 text-[#87928c]">Aguardando o Usuário API e o Token API desta assinatura nos segredos protegidos do servidor.</p>}
        </article>;
      })}
    </section>

    <section className="grid gap-4 lg:grid-cols-2">{secondaryCards.map((item) => <article key={item.name} className="surface-card rounded-[24px] p-6"><div className="flex items-start justify-between gap-4"><div className="grid size-12 place-items-center rounded-2xl" style={{ background: item.accent, color: item.color }}><item.icon className="size-5" /></div><Badge variant="outline" className="text-[10px]">{item.status}</Badge></div><h3 className="font-display mt-6 text-xl font-semibold text-[#1c2c23]">{item.name}</h3><p className="mt-2 min-h-12 text-sm leading-6 text-[#718078]">{item.description}</p><div className="mt-6 border-t border-[#edf0ed] pt-4"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#909a94]">Próximo passo</p><p className="mt-2 text-sm font-medium text-[#405148]">{item.next}</p></div></article>)}</section>
    <section className="surface-card rounded-[24px] p-6"><div className="flex items-start gap-4"><div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#fff2d9] text-[#946814]"><ShieldCheck /></div><div><h3 className="font-display text-lg font-semibold">Ordem segura de ativação</h3><p className="mt-1 text-sm leading-6 text-[#718078]">1. Cadastrar os dois acessos em segredo → 2. Validar cada assinatura → 3. Ler uma amostra sem gravar → 4. Aprovar o mapeamento → 5. Ativar a sincronização automática.</p></div></div></section>
  </div>;
}

function ObligationsTable({ title, description, obligations, compact = false, onIssued }: { title: string; description: string; obligations: InvoiceObligation[]; compact?: boolean; onIssued?: (id: number) => void | Promise<void> }) {
  return <div className="surface-card overflow-hidden rounded-[24px]"><div className="flex flex-col gap-4 border-b border-[#e7ebe7] p-5 sm:flex-row sm:items-center sm:justify-between md:px-6"><div><h3 className="font-display text-lg font-semibold text-[#192820]">{title}</h3><p className="mt-1 text-sm text-[#718078]">{description}</p></div>{compact && <div className="relative w-full sm:w-56"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8b9690]" /><Input placeholder="Buscar paciente" className="h-10 rounded-xl bg-[#fafbf8] pl-9 shadow-none" /></div>}</div><Table><TableHeader><TableRow className="bg-[#fafbf8] hover:bg-[#fafbf8]"><TableHead className="h-11 pl-5 text-[11px] uppercase tracking-[.08em] text-[#829087] md:pl-6">Paciente</TableHead><TableHead className="text-[11px] uppercase tracking-[.08em] text-[#829087]">Referência</TableHead><TableHead className="text-[11px] uppercase tracking-[.08em] text-[#829087]">Valor</TableHead><TableHead className="text-[11px] uppercase tracking-[.08em] text-[#829087]">Situação</TableHead><TableHead className="w-20" /></TableRow></TableHeader><TableBody>{obligations.map((item) => <TableRow key={item.id}><TableCell className="py-4 pl-5 md:pl-6"><div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-xl bg-[#edf2ed] text-xs font-semibold text-[#365146]">{item.initials}</div><div><p className="font-medium text-[#213128]">{item.patient}</p><p className="mt-0.5 text-xs text-[#849087]">{item.unit}</p></div></div></TableCell><TableCell><p>{item.reference}</p>{item.scheduledIssueDate && <p className="mt-1 text-xs text-[#839087]">Prevista {formatIsoDate(item.scheduledIssueDate)}</p>}</TableCell><TableCell className="font-semibold tabular-nums">{item.amount}</TableCell><TableCell><StatusBadge tone={item.tone}>{item.status}</StatusBadge></TableCell><TableCell>{onIssued && item.tone === "ready" ? <Button onClick={() => onIssued(item.id)} variant="outline" size="sm" className="rounded-lg">Emitir</Button> : <Button variant="ghost" size="icon-sm"><MoreHorizontal /><span className="sr-only">Mais opções</span></Button>}</TableCell></TableRow>)}</TableBody></Table>{!obligations.length && <div className="grid min-h-44 place-items-center text-sm text-[#7d8982]">Nenhuma obrigação neste filtro.</div>}</div>;
}

function MetricCard({ label, value, detail, icon: Icon, accent }: { label: string; value: string; detail: string; icon: typeof FileText; accent: string }) {
  return <article className="surface-card metric-card rounded-[22px] p-5"><div className="flex items-start justify-between"><div className={`metric-icon metric-${accent}`}><Icon /></div><span className="text-xs font-medium text-[#87928c]">BASE REAL</span></div><div className="mt-5 flex items-end justify-between gap-3"><div><p className="font-display text-[32px] font-semibold leading-none tracking-tight text-[#1a2b22]">{value}</p><p className="mt-2 text-sm text-[#68766e]">{label}</p></div><p className="mb-0.5 text-xs font-semibold tabular-nums text-[#506158]">{detail}</p></div></article>;
}

function QuarterCard({ obligations }: { obligations: InvoiceObligation[] }) {
  const open = obligations.filter((item) => !["issued", "cancelled"].includes(item.rawStatus));
  const amount = open.reduce((sum, item) => sum + item.amountValue, 0);
  const next = [...open].filter((item) => item.scheduledIssueDate).sort((a, b) => String(a.scheduledIssueDate).localeCompare(String(b.scheduledIssueDate)))[0];
  return <div className="surface-card rounded-[24px] p-5 md:p-6"><div className="flex items-start justify-between"><div><p className="eyebrow">AGENDA FISCAL</p><h3 className="font-display mt-2 text-xl font-semibold">Próximas emissões</h3></div><div className="grid size-10 place-items-center rounded-2xl bg-[#e4f8ee] text-[#00884a]"><CalendarDays className="size-5" /></div></div><div className="mt-6"><p className="text-sm text-[#78857e]">Valor previsto nas obrigações abertas</p><p className="font-display mt-1 text-3xl font-semibold tracking-tight">{moneyValue(amount)}</p></div><div className="mt-5 flex justify-between gap-3 border-t border-[#e9eee7] pt-4 text-xs text-[#849087]"><span>{open.length} obrigação(ões)</span><span>{next?.scheduledIssueDate ? `Próxima: ${formatIsoDate(next.scheduledIssueDate)}` : "Sem emissão prevista"}</span></div></div>;
}

function ActivityCard() {
  return <div className="surface-card rounded-[24px] p-5 md:p-6"><p className="eyebrow">ATIVIDADE</p><h3 className="font-display mt-2 text-lg font-semibold">Movimentações recentes</h3><div className="mt-5 grid min-h-24 place-items-center rounded-2xl border border-dashed border-[#dfe6df] px-4 text-center"><p className="text-sm leading-6 text-[#7d8982]">Nenhuma movimentação financeira registrada.</p></div></div>;
}

function RuleCard({ title, label, description }: { title: string; label: string; description: string }) {
  return <article className="surface-card flex items-start gap-4 rounded-[22px] p-5"><div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#edf4e7] text-[#5e793f]"><Building2 className="size-5" /></div><div><p className="text-sm font-semibold text-[#26372e]">{title}</p><p className="mt-1 text-xs font-semibold uppercase tracking-[.08em] text-[#77905e]">{label}</p><p className="mt-2 text-sm leading-6 text-[#718078]">{description}</p></div></article>;
}

function CheckLine({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2"><span className="grid size-5 place-items-center rounded-full bg-[#e4f8ee] text-[#00884a]"><Check className="size-3" /></span>{children}</div>;
}
