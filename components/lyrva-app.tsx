"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  AlertCircle,
  Bell,
  BellRing,
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
  MessageCircle,
  MoreHorizontal,
  ReceiptText,
  Search,
  ShieldCheck,
  UploadCloud,
  Users,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

type View = "dashboard" | "invoices" | "collections" | "patients" | "import" | "integrations";
type Role = "financeiro" | "gestora" | "ceo" | "suporte";

type UserAccount = {
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
  startDate?: string | null;
  installments?: number | null;
  dueDay?: number | null;
  taxReceiptIr?: boolean | number;
  invoiceFrequency?: string;
  notes?: string | null;
};

type Obligation = {
  id: number;
  patient: string;
  initials: string;
  unit: string;
  reference: string;
  amount: string;
  status: string;
  tone: "ready" | "waiting" | "cycle" | "issue" | "done";
};

type CollectionReminder = {
  patientId: number;
  patient: string;
  amount: string;
  time: string;
  detail: string;
};

const navItems: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "Visão geral", icon: LayoutDashboard },
  { id: "invoices", label: "Notas fiscais", icon: FileText },
  { id: "collections", label: "Régua de cobrança", icon: WalletCards },
  { id: "patients", label: "Pacientes", icon: Users },
  { id: "import", label: "Importar planilha", icon: FileSpreadsheet },
  { id: "integrations", label: "Integrações", icon: Link2 },
];

const userAccounts: UserAccount[] = [
  { name: "Daiane", email: "daiane@lyvrafinanceiro.com.br", role: "financeiro" },
  { name: "Thaina", email: "thaina@lyvrafinanceiro.com.br", role: "financeiro" },
  { name: "Luciana", email: "luciana@lyvrafinanceiro.com.br", role: "ceo" },
  { name: "Mirelen", email: "mirelen@lyvrafinanceiro.com.br", role: "gestora" },
  { name: "Ana", email: "ana@lyvrafinanceiro.com.br", role: "gestora" },
  { name: "Maria Almeida", email: "maria.almeida@lyvrafinanceiro.com.br", role: "suporte" },
  { name: "Maria Eduarda", email: "maria..eduarda@lyvrafinanceiro.com.br", role: "financeiro" },
];

const roleLabels: Record<Role, string> = {
  financeiro: "Financeiro",
  gestora: "Gestora",
  ceo: "CEO",
  suporte: "Suporte",
};

const viewTitles: Record<View, { eyebrow: string; title: string }> = {
  dashboard: { eyebrow: "Hoje", title: "Visão geral" },
  invoices: { eyebrow: "Controle fiscal", title: "Notas fiscais" },
  collections: { eyebrow: "Jornada do financeiro", title: "Régua de cobrança" },
  patients: { eyebrow: "Base de cadastros", title: "Pacientes" },
  import: { eyebrow: "Carga inicial", title: "Importar planilha" },
  integrations: { eyebrow: "Conexões do sistema", title: "Integrações" },
};

const collectionReminders: CollectionReminder[] = [];

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const money = (cents = 0) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "");
const authSessionKey = "lyvra-dashboard-session";
const displayTimeZone = "America/Sao_Paulo";
const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const currentDate = () => new Date();
const currentMonthLabel = () => capitalize(new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: displayTimeZone }).format(currentDate()));
const currentPeriodLabel = () => {
  const date = currentDate();
  const month = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: displayTimeZone }).format(date).replace(".", "").toUpperCase();
  const year = new Intl.DateTimeFormat("pt-BR", { year: "2-digit", timeZone: displayTimeZone }).format(date);
  return `${month}/${year}`;
};
const todayLabel = () => capitalize(new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long", timeZone: displayTimeZone }).format(currentDate()));

function LyvraMark() {
  return <div className="lyvra-mark" aria-hidden="true"><img src={LYVRA_ICON_DATA_URL} alt="" /></div>;
}

function StatusBadge({ tone, children }: { tone: Obligation["tone"]; children: React.ReactNode }) {
  return <Badge variant="outline" className={`status-badge status-${tone}`}><span className="status-dot" />{children}</Badge>;
}

function LoginScreen({ onLogin }: { onLogin: (email: string) => boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim() || password.length < 6) {
      setError("Preencha um e-mail válido e uma senha com pelo menos 6 caracteres.");
      return;
    }
    if (!onLogin(email.trim().toLowerCase())) {
      setError("Este e-mail ainda não possui acesso ao LYVRA.");
      return;
    }
    setError("");
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
              <Label htmlFor="login-email" className="text-sm font-semibold text-[#33473c]">E-mail</Label>
              <Input id="login-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nome@lyvrafinanceiro.com.br" className="h-12 rounded-xl border-[#dce4de] bg-[#fbfcfa] px-4 shadow-none focus-visible:ring-[#00BF63]" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="login-password" className="text-sm font-semibold text-[#33473c]">Senha</Label>
              <div className="relative">
                <Input id="login-password" type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Digite sua senha" className="h-12 rounded-xl border-[#dce4de] bg-[#fbfcfa] px-4 pr-12 shadow-none focus-visible:ring-[#00BF63]" minLength={6} required />
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => setShowPassword((current) => !current)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg text-[#7d8a82] hover:bg-[#eef4ef] hover:text-[#183b32]" aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}>
                  {showPassword ? <EyeOff /> : <Eye />}
                </Button>
              </div>
            </div>
            {error && <p className="rounded-xl bg-[#fae8e3] px-4 py-3 text-sm text-[#934e3f]" role="alert">{error}</p>}
            <Button type="submit" className="h-12 w-full rounded-xl bg-[#00BF63] font-bold text-[#10221f] shadow-none hover:bg-[#00d56e]">Entrar no LYVRA <LogIn /></Button>
          </form>

          <div className="mt-7 border-t border-[#e8ece8] pt-5 text-center">
            <a href="/primeiro-acesso" className="inline-flex items-center gap-2 text-sm font-semibold text-[#007d46] transition hover:text-[#00a958] hover:underline hover:underline-offset-4">
              Primeiro acesso? Ative sua conta
              <ChevronRight className="size-4" />
            </a>
            <p className="mt-3 text-xs leading-5 text-[#8a958e]">Problemas para acessar? Solicite ajuda ao suporte responsável.</p>
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
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [collectionReminder, setCollectionReminder] = useState<CollectionReminder | null>(null);
  const [collectionPatientId, setCollectionPatientId] = useState<number | null>(null);
  const reminderSnoozeUntil = useRef(0);

  const loadPatients = async () => {
    setLoadingPatients(true);
    try {
      const response = await fetch("/api/patients");
      const data = await response.json() as { patients?: Patient[] };
      if (response.ok) setPatients(data.patients ?? []);
    } catch {
      setPatients([]);
    } finally {
      setLoadingPatients(false);
    }
  };

  useEffect(() => {
    const savedEmail = window.sessionStorage.getItem(authSessionKey);
    setCurrentUser(userAccounts.find((account) => account.email === savedEmail) ?? null);
    setAuthReady(true);
    void loadPatients();
  }, []);

  useEffect(() => {
    if (currentUser?.email !== "daiane@lyvrafinanceiro.com.br") {
      setCollectionReminder(null);
      return;
    }

    const checkCollectionSchedule = () => {
      const now = new Date();
      if (now.getTime() < reminderSnoozeUntil.current) return;

      const reminder = collectionReminders.find((item) => {
        const [hours, minutes] = item.time.split(":").map(Number);
        const scheduled = new Date(now);
        scheduled.setHours(hours, minutes, 0, 0);
        const distance = now.getTime() - scheduled.getTime();
        return distance >= -10 * 60_000 && distance <= 20 * 60_000;
      });

      if (!reminder) return;
      const dayKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
      const storageKey = `lyvra-collection-reminder-${dayKey}-${reminder.patientId}`;
      if (window.sessionStorage.getItem(storageKey)) return;

      window.sessionStorage.setItem(storageKey, "shown");
      setCollectionReminder(reminder);
    };

    checkCollectionSchedule();
    const timer = window.setInterval(checkCollectionSchedule, 30_000);
    return () => window.clearInterval(timer);
  }, [currentUser?.email]);

  const unitFilter = <UnitSelect value={unit} onChange={setUnit} />;

  const markIssued = (id: number) => {
    setObligations((current) => current.map((item) => item.id === id ? { ...item, status: "Emitida", tone: "done" } : item));
    toast.success("Nota marcada como emitida", { description: "O histórico desta obrigação foi atualizado." });
  };

  const login = (email: string) => {
    const account = userAccounts.find((item) => item.email === email);
    if (!account) return false;
    window.sessionStorage.setItem(authSessionKey, account.email);
    setCurrentUser(account);
    return true;
  };

  const logout = () => {
    window.sessionStorage.removeItem(authSessionKey);
    setCurrentUser(null);
    setView("dashboard");
  };

  const clearCollectionPatient = useCallback(() => setCollectionPatientId(null), []);

  const openReminderNegotiation = () => {
    if (!collectionReminder) return;
    setCollectionPatientId(collectionReminder.patientId);
    setView("collections");
    setCollectionReminder(null);
  };

  const snoozeCollectionReminder = () => {
    if (!collectionReminder) return;
    const now = new Date();
    const dayKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    window.sessionStorage.removeItem(`lyvra-collection-reminder-${dayKey}-${collectionReminder.patientId}`);
    reminderSnoozeUntil.current = now.getTime() + 5 * 60_000;
    setCollectionReminder(null);
    toast.info("Tudo certo, Daiane", { description: "Vou lembrar novamente em 5 minutos." });
  };

  if (!authReady) {
    return <main className="login-shell grid place-items-center"><LoaderCircle className="size-7 animate-spin text-[#00BF63]" /><span className="sr-only">Carregando LYVRA</span></main>;
  }

  if (!currentUser) return <LoginScreen onLogin={login} />;

  const visibleNavItems = navItems.filter((item) => item.id !== "integrations" || currentUser.role === "suporte");
  const userInitials = currentUser.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="app-density">
    <SidebarProvider>
      <Toaster position="top-right" richColors />
      <CollectionReminderDialog reminder={collectionReminder} onClose={() => setCollectionReminder(null)} onOpenNegotiation={openReminderNegotiation} onSnooze={snoozeCollectionReminder} />
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
        <SidebarContent className="sidebar-scroll-clean px-2">
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.16em] text-white/35">Operação</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleNavItems.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton onClick={() => setView(item.id)} isActive={view === item.id} tooltip={item.label} className="h-10 rounded-xl px-3 text-white/62 hover:bg-white/8 hover:text-white data-[active=true]:bg-[#00BF63] data-[active=true]:text-[#10221f]">
                      <item.icon /><span>{item.label}</span>
                    </SidebarMenuButton>
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

      <SidebarInset className="min-w-0 overflow-x-hidden">
        <header className="sticky top-0 z-20 flex h-18 items-center justify-between border-b border-[#dfe5df] bg-[#f7f8f4]/92 px-4 backdrop-blur-xl md:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <SidebarTrigger className="size-9 rounded-xl border border-[#dfe5df] bg-white" />
            <div className="hidden h-7 w-px bg-[#dfe5df] md:block" />
            <div><p className="text-xs font-medium text-[#6b756f]">{view === "dashboard" ? todayLabel() : viewTitles[view].eyebrow}</p><h1 className="font-display text-xl font-semibold tracking-tight text-[#16241f]">{viewTitles[view].title}</h1></div>
          </div>
          <div className="flex items-center gap-2">
            {unitFilter}
            <Button variant="outline" size="icon" className="relative size-10 rounded-xl border-[#dfe5df] bg-white shadow-none"><Bell className="size-4" /><span className="absolute right-2 top-2 size-1.5 rounded-full bg-[#d56b52]" /><span className="sr-only">Notificações</span></Button>
          </div>
        </header>

        <main className="min-h-[calc(100svh-4.5rem)] bg-[#f7f8f4] p-4 md:p-7">
          <div className="mx-auto max-w-[1500px]">
            {view === "dashboard" && <DashboardView unit={unit} obligations={obligations} goTo={setView} />}
            {view === "invoices" && <InvoicesView unit={unit} obligations={obligations} onIssued={markIssued} />}
            {view === "collections" && <CollectionsJourney unit={unit} openPatientId={collectionPatientId} onPatientOpened={clearCollectionPatient} />}
            {view === "patients" && <PatientsView unit={unit} patients={patients} loading={loadingPatients} goTo={setView} />}
            {view === "import" && <ImportView onImported={async () => { await loadPatients(); setView("patients"); }} />}
            {view === "integrations" && currentUser.role === "suporte" && <IntegrationsView />}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
    </div>
  );
}

function CollectionReminderDialog({ reminder, onClose, onOpenNegotiation, onSnooze }: { reminder: CollectionReminder | null; onClose: () => void; onOpenNegotiation: () => void; onSnooze: () => void }) {
  return (
    <Dialog open={Boolean(reminder)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="overflow-hidden border-0 bg-[#10221f] p-0 text-white shadow-[0_30px_90px_rgba(7,22,17,.42)] sm:max-w-[520px] [&>button]:right-5 [&>button]:top-5 [&>button]:text-white/55 [&>button]:hover:text-white">
        {reminder && <>
          <div className="h-1.5 bg-[#00BF63]" />
          <div className="p-6 sm:p-7">
            <DialogHeader className="text-left">
              <div className="mb-5 flex items-center justify-between pr-8">
                <div className="grid size-12 place-items-center rounded-2xl bg-[#00BF63] text-[#10221f]"><BellRing className="size-6 animate-pulse" /></div>
                <Badge className="border border-white/10 bg-white/8 text-[10px] text-white hover:bg-white/8">LEMBRETE DA RÉGUA</Badge>
              </div>
              <DialogTitle className="font-display text-3xl font-semibold leading-tight text-white">Daiane, ligação às {reminder.time}</DialogTitle>
              <DialogDescription className="mt-2 text-sm leading-6 text-white/55">O horário combinado está chegando. Abra a negociação para registrar o contato.</DialogDescription>
            </DialogHeader>

            <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.055] p-4">
              <div className="flex items-center justify-between gap-3"><div><p className="font-semibold text-white">{reminder.patient}</p><p className="mt-1 text-xs text-white/48">{reminder.detail}</p></div><p className="shrink-0 font-display text-xl font-semibold text-[#68d88a]">{reminder.amount}</p></div>
            </div>

            <div className="mt-6 grid gap-2 sm:grid-cols-[1fr_auto]">
              <Button onClick={onOpenNegotiation} className="h-12 rounded-xl bg-[#00BF63] font-bold text-[#10221f] hover:bg-[#00d56e]">Abrir negociação <ChevronRight /></Button>
              <Button onClick={onSnooze} variant="outline" className="h-12 rounded-xl border-white/12 bg-white/7 px-5 text-white hover:bg-white/12 hover:text-white">Lembrar em 5 min</Button>
            </div>
          </div>
        </>}
      </DialogContent>
    </Dialog>
  );
}

function UnitSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <Select value={value} onValueChange={onChange}><SelectTrigger aria-label="Selecionar unidade" className="h-10 w-10 rounded-xl border-[#dfe5df] bg-white px-0 text-[#25362e] shadow-none sm:min-w-39 sm:px-3"><Building2 className="size-4 text-[#6f7b74]" /><span className="hidden sm:inline"><SelectValue /></span></SelectTrigger><SelectContent><SelectItem value="todas">Todas as unidades</SelectItem><SelectItem value="sorocaba">Sorocaba</SelectItem><SelectItem value="salto">Salto de Pirapora</SelectItem></SelectContent></Select>;
}

function DashboardView({ unit, obligations, goTo }: { unit: string; obligations: Obligation[]; goTo: (view: View) => void }) {
  const filtered = obligations.filter((item) => unit === "todas" || (unit === "sorocaba" ? item.unit === "Sorocaba" : item.unit === "Salto de Pirapora")).slice(0, 4);
  return <div className="space-y-5">
    <section className="hero-panel overflow-hidden rounded-[28px] px-5 py-6 text-white md:px-8 md:py-7"><div className="relative z-10 flex flex-col justify-between gap-7 lg:flex-row lg:items-end"><div><Badge className="mb-4 border border-white/12 bg-white/8 px-3 py-1 text-[11px] font-medium text-white hover:bg-white/8"><span className="mr-1.5 size-1.5 rounded-full bg-[#00BF63]" />AMBIENTE PREPARADO</Badge><h2 className="font-display max-w-2xl text-3xl font-medium leading-tight tracking-[-0.035em] md:text-[42px]">O financeiro do mês,<br className="hidden sm:block" /> sem nada escapar.</h2><p className="mt-3 max-w-xl text-sm leading-6 text-white/58 md:text-base">Assim que os dados forem importados ou sincronizados, pagamentos, baixas e notas aparecerão aqui.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" className="h-11 rounded-xl border-white/15 bg-white/8 px-4 text-white shadow-none hover:bg-white/14 hover:text-white"><CalendarDays /> {currentMonthLabel()}</Button><Button onClick={() => goTo("invoices")} className="h-11 rounded-xl bg-[#00BF63] px-5 text-[#10221f] shadow-none hover:bg-[#00D66F]">Ver notas a emitir <ChevronRight /></Button></div></div></section>
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Prontas para emissão" value="0" detail="R$ 0,00" icon={FileText} accent="lime" /><MetricCard label="Aguardando baixa" value="0" detail="R$ 0,00" icon={CircleDollarSign} accent="amber" /><MetricCard label="Notas emitidas" value="0" detail="R$ 0,00" icon={CheckCircle2} accent="blue" /><MetricCard label="Lembretes amanhã" value="0" detail="Sem envios" icon={MessageCircle} accent="violet" /></section>
    <section className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,.7fr)]"><ObligationsTable title="Acompanhamentos do financeiro" description="Tudo que ainda pede uma ação da equipe." obligations={filtered} compact /><div className="space-y-5"><QuarterCard /><ActivityCard /></div></section>
  </div>;
}

function InvoicesView({ unit, obligations, onIssued }: { unit: string; obligations: Obligation[]; onIssued: (id: number) => void }) {
  const [status, setStatus] = useState("todos");
  const filtered = obligations.filter((item) => (unit === "todas" || (unit === "sorocaba" ? item.unit === "Sorocaba" : item.unit === "Salto de Pirapora")) && (status === "todos" || item.tone === status));
  return <div className="space-y-5">
    <section className="flex flex-col justify-between gap-4 rounded-[24px] border border-[#dfe5df] bg-white p-5 md:flex-row md:items-center md:p-6"><div><p className="eyebrow">{currentMonthLabel().toUpperCase()}</p><h2 className="font-display mt-2 text-2xl font-semibold text-[#192820]">Fila de emissão</h2><p className="mt-2 text-sm text-[#718078]">O paciente permanece aqui até a emissão ser concluída.</p></div><div className="flex flex-wrap gap-2"><Select value={status} onValueChange={setStatus}><SelectTrigger className="h-10 min-w-48 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todos">Todas as situações</SelectItem><SelectItem value="ready">Prontas para emissão</SelectItem><SelectItem value="waiting">Aguardando baixa</SelectItem><SelectItem value="cycle">Quadrimestre</SelectItem><SelectItem value="issue">Com pendência</SelectItem><SelectItem value="done">Emitidas</SelectItem></SelectContent></Select><Button disabled={!filtered.length} className="h-10 rounded-xl" onClick={() => toast.info("A emissão automática entra após definirmos o emissor fiscal.") }><ReceiptText /> Emitir selecionadas</Button></div></section>
    <ObligationsTable title="Obrigações fiscais" description={`${filtered.length} registros encontrados`} obligations={filtered} onIssued={onIssued} />
    <div className="grid gap-4 md:grid-cols-2"><RuleCard title="Sorocaba" label="Emissão mensal" description="A nota é liberada após a baixa e considera o total pago no mês." /><RuleCard title="Salto de Pirapora" label="Emissão quadrimestral" description="O LYVRA acumula quatro meses pagos e cria uma única obrigação no fechamento." /></div>
  </div>;
}

function PatientsView({ unit, patients, loading, goTo }: { unit: string; patients: Patient[]; loading: boolean; goTo: (view: View) => void }) {
  const [query, setQuery] = useState("");
  const filtered = patients.filter((patient) => (unit === "todas" || (unit === "sorocaba" ? patient.unit === "Sorocaba" : patient.unit === "Salto de Pirapora")) && patient.name.toLowerCase().includes(query.toLowerCase()));
  return <div className="space-y-5">
    <section className="surface-card overflow-hidden rounded-[24px]"><div className="flex flex-col gap-4 border-b border-[#e7ebe7] p-5 sm:flex-row sm:items-center sm:justify-between md:p-6"><div><h2 className="font-display text-xl font-semibold text-[#192820]">Pacientes cadastrados</h2><p className="mt-1 text-sm text-[#718078]">Somente quem estiver marcado para IR entra na rotina de notas.</p></div><div className="flex flex-col gap-2 sm:flex-row"><div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8b9690]" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar paciente" className="h-10 w-full rounded-xl pl-9 shadow-none sm:w-52" /></div><Button onClick={() => goTo("import")} className="h-10 rounded-xl"><UploadCloud /> Importar</Button></div></div>
      {loading ? <div className="grid min-h-64 place-items-center text-sm text-[#718078]"><div className="flex items-center gap-2"><LoaderCircle className="size-4 animate-spin" />Carregando pacientes…</div></div> : filtered.length ? <div className="overflow-x-auto"><Table><TableHeader><TableRow className="bg-[#fafbf8] hover:bg-[#fafbf8]"><TableHead className="pl-6">Paciente</TableHead><TableHead>Unidade</TableHead><TableHead>Pagamento</TableHead><TableHead>Periodicidade</TableHead><TableHead>Nota para IR</TableHead><TableHead className="w-12" /></TableRow></TableHeader><TableBody>{filtered.map((patient) => <TableRow key={`${patient.id}-${patient.name}`}><TableCell className="py-4 pl-6"><div><p className="font-medium text-[#213128]">{patient.name}</p><p className="mt-1 text-xs text-[#839087]">{patient.cpf || "CPF pendente"} • {patient.treatment || "Tratamento não informado"}</p></div></TableCell><TableCell>{patient.unit}</TableCell><TableCell><p>{patient.paymentMethod || "—"}</p><p className="mt-1 text-xs text-[#839087]">{money(patient.planAmountCents)}</p></TableCell><TableCell>{patient.invoiceFrequency || (patient.unit === "Sorocaba" ? "Mensal" : "Quadrimestral")}</TableCell><TableCell>{Boolean(patient.taxReceiptIr) ? <Badge className="bg-[#eaf5df] text-[#54752d] hover:bg-[#eaf5df]"><Check /> Sim</Badge> : <Badge variant="secondary">Não</Badge>}</TableCell><TableCell><Button variant="ghost" size="icon-sm"><MoreHorizontal /><span className="sr-only">Ações do paciente</span></Button></TableCell></TableRow>)}</TableBody></Table></div> : <div className="grid min-h-72 place-items-center px-6 py-10 text-center"><div className="max-w-sm"><div className="mx-auto grid size-14 place-items-center rounded-2xl bg-[#eaf8f0] text-[#00884a]"><Users className="size-6" /></div><h3 className="font-display mt-4 text-xl font-semibold text-[#26372e]">{query ? "Nenhum paciente encontrado" : "Nenhum paciente cadastrado"}</h3><p className="mt-2 text-sm leading-6 text-[#7d8982]">{query ? "Tente buscar por outro nome." : "Importe a planilha inicial para começar a montar a base real do financeiro."}</p>{!query && <Button onClick={() => goTo("import")} className="mt-5 h-10 rounded-xl"><UploadCloud /> Importar planilha</Button>}</div></div>}
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
          startDate: String(pick("data de inicio", "inicio") ?? "") || null,
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
      const response = await fetch("/api/patients", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fileName, patients: valid }) });
      const data = await response.json() as { imported?: number; error?: string };
      if (!response.ok) throw new Error(data.error || "Falha ao importar.");
      toast.success(`${data.imported ?? valid.length} pacientes importados`, { description: "A base do LYVRA foi atualizada com sucesso." });
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

function IntegrationsView() {
  const cards = [
    { name: "Clinicorp", icon: Database, status: "Aguardando credenciais", description: "Pacientes, boletos, parcelas e baixas de pagamento.", accent: "#e7f2e8", color: "#39704a", next: "Usuário e token da API" },
    { name: "WhatsApp Business", icon: MessageCircle, status: "Aguardando configuração", description: "Lembrete D-1 e confirmação automática de pagamento.", accent: "#e6f4ef", color: "#26735d", next: "Conta Meta e número oficial" },
    { name: "Emissor de NFS-e", icon: ReceiptText, status: "Planejado", description: "Na primeira fase, o LYVRA controla a emissão manual.", accent: "#eeeafb", color: "#7261b9", next: "Definir emissor e certificado" },
  ];
  return <div className="space-y-5"><section className="hero-panel overflow-hidden rounded-[28px] p-6 text-white md:p-8"><div className="relative z-10 max-w-2xl"><Badge className="border border-white/12 bg-white/8 text-white hover:bg-white/8">MAPA DE CONEXÕES</Badge><h2 className="font-display mt-4 text-3xl font-medium md:text-4xl">A base está pronta para conversar com o financeiro real.</h2><p className="mt-3 text-sm leading-6 text-white/60">As conexões ficam desligadas até recebermos os acessos oficiais. Assim nenhum dado real é movimentado antes da hora.</p></div></section><section className="grid gap-4 lg:grid-cols-3">{cards.map((item) => <article key={item.name} className="surface-card rounded-[24px] p-6"><div className="flex items-start justify-between gap-4"><div className="grid size-12 place-items-center rounded-2xl" style={{ background: item.accent, color: item.color }}><item.icon className="size-5" /></div><Badge variant="outline" className="text-[10px]">{item.status}</Badge></div><h3 className="font-display mt-6 text-xl font-semibold text-[#1c2c23]">{item.name}</h3><p className="mt-2 min-h-12 text-sm leading-6 text-[#718078]">{item.description}</p><div className="mt-6 border-t border-[#edf0ed] pt-4"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#909a94]">Próximo passo</p><p className="mt-2 text-sm font-medium text-[#405148]">{item.next}</p></div></article>)}</section><section className="surface-card rounded-[24px] p-6"><div className="flex items-start gap-4"><div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#fff2d9] text-[#946814]"><ShieldCheck /></div><div><h3 className="font-display text-lg font-semibold">Ordem segura de ativação</h3><p className="mt-1 text-sm text-[#718078]">1. Conectar em modo leitura → 2. Validar baixas → 3. Aprovar modelos do WhatsApp → 4. Ativar mensagens → 5. Integrar emissão fiscal.</p></div></div></section></div>;
}

function ObligationsTable({ title, description, obligations, compact = false, onIssued }: { title: string; description: string; obligations: Obligation[]; compact?: boolean; onIssued?: (id: number) => void }) {
  return <div className="surface-card overflow-hidden rounded-[24px]"><div className="flex flex-col gap-4 border-b border-[#e7ebe7] p-5 sm:flex-row sm:items-center sm:justify-between md:px-6"><div><h3 className="font-display text-lg font-semibold text-[#192820]">{title}</h3><p className="mt-1 text-sm text-[#718078]">{description}</p></div>{compact && obligations.length > 0 && <div className="relative w-full sm:w-56"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8b9690]" /><Input placeholder="Buscar paciente" className="h-10 rounded-xl bg-[#fafbf8] pl-9 shadow-none" /></div>}</div>{obligations.length ? <div className="overflow-x-auto"><Table><TableHeader><TableRow className="bg-[#fafbf8] hover:bg-[#fafbf8]"><TableHead className="h-11 pl-5 text-[11px] uppercase tracking-[.08em] text-[#829087] md:pl-6">Paciente</TableHead><TableHead className="text-[11px] uppercase tracking-[.08em] text-[#829087]">Referência</TableHead><TableHead className="text-[11px] uppercase tracking-[.08em] text-[#829087]">Valor</TableHead><TableHead className="text-[11px] uppercase tracking-[.08em] text-[#829087]">Situação</TableHead><TableHead className="w-20" /></TableRow></TableHeader><TableBody>{obligations.map((item) => <TableRow key={item.id}><TableCell className="py-4 pl-5 md:pl-6"><div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-xl bg-[#edf2ed] text-xs font-semibold text-[#365146]">{item.initials}</div><div><p className="font-medium text-[#213128]">{item.patient}</p><p className="mt-0.5 text-xs text-[#849087]">{item.unit}</p></div></div></TableCell><TableCell>{item.reference}</TableCell><TableCell className="font-semibold tabular-nums">{item.amount}</TableCell><TableCell><StatusBadge tone={item.tone}>{item.status}</StatusBadge></TableCell><TableCell>{onIssued && item.tone === "ready" ? <Button onClick={() => onIssued(item.id)} variant="outline" size="sm" className="rounded-lg">Emitir</Button> : <Button variant="ghost" size="icon-sm"><MoreHorizontal /><span className="sr-only">Mais opções</span></Button>}</TableCell></TableRow>)}</TableBody></Table></div> : <div className="grid min-h-52 place-items-center px-6 py-8 text-center"><div className="max-w-sm"><div className="mx-auto grid size-12 place-items-center rounded-2xl bg-[#eef5ef] text-[#668077]"><FileText className="size-5" /></div><p className="mt-4 font-medium text-[#405148]">Nenhuma obrigação registrada</p><p className="mt-1 text-sm leading-6 text-[#87928c]">As notas aparecerão aqui depois da importação ou sincronização dos pagamentos.</p></div></div>}</div>;
}

function MetricCard({ label, value, detail, icon: Icon, accent }: { label: string; value: string; detail: string; icon: typeof FileText; accent: string }) {
  return <article className="surface-card metric-card rounded-[22px] p-5"><div className="flex items-start justify-between"><div className={`metric-icon metric-${accent}`}><Icon /></div><span className="text-xs font-medium text-[#87928c]">{currentPeriodLabel()}</span></div><div className="mt-5 flex items-end justify-between gap-3"><div><p className="font-display text-[32px] font-semibold leading-none tracking-tight text-[#1a2b22]">{value}</p><p className="mt-2 text-sm text-[#68766e]">{label}</p></div><p className="mb-0.5 text-xs font-semibold tabular-nums text-[#506158]">{detail}</p></div></article>;
}

function QuarterCard() {
  return <div className="surface-card rounded-[24px] p-5 md:p-6"><div className="flex items-start justify-between"><div><p className="eyebrow">SALTO DE PIRAPORA</p><h3 className="font-display mt-2 text-xl font-semibold">Quadrimestre atual</h3></div><div className="grid size-10 place-items-center rounded-2xl bg-[#e4f8ee] text-[#00884a]"><CalendarDays className="size-5" /></div></div><div className="mt-6 rounded-2xl border border-dashed border-[#d8e1d9] bg-[#fafbf9] px-4 py-5"><p className="font-display text-2xl font-semibold tracking-tight text-[#304138]">R$ 0,00</p><p className="mt-2 text-sm leading-6 text-[#7d8982]">O acumulado aparecerá quando os pagamentos de Salto forem sincronizados.</p></div></div>;
}

function ActivityCard() {
  return <div className="surface-card rounded-[24px] p-5 md:p-6"><p className="eyebrow">ATIVIDADE</p><h3 className="font-display mt-2 text-lg font-semibold">O que acabou de acontecer</h3><div className="mt-5 flex items-start gap-3 rounded-2xl bg-[#fafbf9] p-4"><div className="activity-icon activity-emerald"><CheckCircle2 /></div><div><p className="text-sm font-medium text-[#405148]">Nenhuma atividade registrada</p><p className="mt-1 text-xs leading-5 text-[#87928c]">Pagamentos, mensagens e emissões aparecerão neste histórico.</p></div></div></div>;
}

function RuleCard({ title, label, description }: { title: string; label: string; description: string }) {
  return <article className="surface-card flex items-start gap-4 rounded-[22px] p-5"><div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#edf4e7] text-[#5e793f]"><Building2 className="size-5" /></div><div><p className="text-sm font-semibold text-[#26372e]">{title}</p><p className="mt-1 text-xs font-semibold uppercase tracking-[.08em] text-[#77905e]">{label}</p><p className="mt-2 text-sm leading-6 text-[#718078]">{description}</p></div></article>;
}

function CheckLine({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2"><span className="grid size-5 place-items-center rounded-full bg-[#e4f8ee] text-[#00884a]"><Check className="size-3" /></span>{children}</div>;
}
