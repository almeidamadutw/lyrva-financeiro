"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  LayoutDashboard,
  Link2,
  LoaderCircle,
  MessageCircle,
  MoreHorizontal,
  ReceiptText,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  Users,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
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

type View = "dashboard" | "invoices" | "patients" | "import" | "integrations";

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

type DemoObligation = {
  id: number;
  patient: string;
  initials: string;
  unit: string;
  reference: string;
  amount: string;
  status: string;
  tone: "ready" | "waiting" | "cycle" | "issue" | "done";
};

const navItems: { id: View; label: string; icon: typeof LayoutDashboard; badge?: string }[] = [
  { id: "dashboard", label: "Visão geral", icon: LayoutDashboard },
  { id: "invoices", label: "Notas fiscais", icon: FileText, badge: "8" },
  { id: "patients", label: "Pacientes", icon: Users },
  { id: "import", label: "Importar planilha", icon: FileSpreadsheet },
  { id: "integrations", label: "Integrações", icon: Link2 },
];

const viewTitles: Record<View, { eyebrow: string; title: string }> = {
  dashboard: { eyebrow: "Quarta-feira, 26 de agosto", title: "Visão geral" },
  invoices: { eyebrow: "Controle fiscal", title: "Notas fiscais" },
  patients: { eyebrow: "Base de cadastros", title: "Pacientes" },
  import: { eyebrow: "Carga inicial", title: "Importar planilha" },
  integrations: { eyebrow: "Conexões do sistema", title: "Integrações" },
};

const demoObligations: DemoObligation[] = [
  { id: 1, patient: "Helena Martins", initials: "HM", unit: "Sorocaba", reference: "Ago/26", amount: "R$ 680,00", status: "Pronta para emissão", tone: "ready" },
  { id: 2, patient: "Lucas Ribeiro", initials: "LR", unit: "Sorocaba", reference: "Ago/26", amount: "R$ 450,00", status: "Aguardando baixa", tone: "waiting" },
  { id: 3, patient: "Camila Nunes", initials: "CN", unit: "Salto de Pirapora", reference: "Mai–Ago/26", amount: "R$ 1.920,00", status: "Quadrimestre em andamento", tone: "cycle" },
  { id: 4, patient: "Rafael Azevedo", initials: "RA", unit: "Sorocaba", reference: "Ago/26", amount: "R$ 520,00", status: "Dados incompletos", tone: "issue" },
  { id: 5, patient: "Beatriz Carvalho", initials: "BC", unit: "Sorocaba", reference: "Ago/26", amount: "R$ 790,00", status: "Emitida", tone: "done" },
];

const demoPatients: Patient[] = [
  { id: 1, name: "Helena Martins", cpf: "347.***.***-10", phone: "(15) 9****-2041", unit: "Sorocaba", treatment: "Ortodontia", paymentMethod: "Boleto", planAmountCents: 68000, taxReceiptIr: true, invoiceFrequency: "Mensal" },
  { id: 2, name: "Lucas Ribeiro", cpf: "421.***.***-07", phone: "(15) 9****-8830", unit: "Sorocaba", treatment: "Implante", paymentMethod: "Boleto", planAmountCents: 45000, taxReceiptIr: true, invoiceFrequency: "Mensal" },
  { id: 3, name: "Camila Nunes", cpf: "286.***.***-44", phone: "(15) 9****-1162", unit: "Salto de Pirapora", treatment: "Prótese", paymentMethod: "Cartão", planAmountCents: 48000, taxReceiptIr: true, invoiceFrequency: "Quadrimestral" },
  { id: 4, name: "Rafael Azevedo", cpf: null, phone: "(15) 9****-5521", unit: "Sorocaba", treatment: "Ortodontia", paymentMethod: "Boleto", planAmountCents: 52000, taxReceiptIr: true, invoiceFrequency: "Mensal" },
];

const activities = [
  { icon: CheckCircle2, title: "Pagamento confirmado", detail: "Boleto de Helena Martins • R$ 680,00", time: "há 12 min", color: "emerald" },
  { icon: MessageCircle, title: "Confirmação enviada", detail: "WhatsApp entregue para Helena Martins", time: "há 11 min", color: "violet" },
  { icon: FileText, title: "Nota fiscal emitida", detail: "NF 2026/00384 • Beatriz Carvalho", time: "há 1h", color: "blue" },
];

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const money = (cents = 0) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "");

function LyvraMark() {
  return <div className="lyvra-mark" aria-hidden="true"><img src="/lyrva-icon.png" alt="" /></div>;
}

function StatusBadge({ tone, children }: { tone: DemoObligation["tone"]; children: React.ReactNode }) {
  return <Badge variant="outline" className={`status-badge status-${tone}`}><span className="status-dot" />{children}</Badge>;
}

export function LyvraApp() {
  const [view, setView] = useState<View>("dashboard");
  const [unit, setUnit] = useState("todas");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loadingPatients, setLoadingPatients] = useState(true);
  const [obligations, setObligations] = useState(demoObligations);

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

  useEffect(() => { void loadPatients(); }, []);

  const shownPatients = patients.length ? patients : demoPatients;
  const isDemo = patients.length === 0;
  const unitFilter = <UnitSelect value={unit} onChange={setUnit} />;

  const markIssued = (id: number) => {
    setObligations((current) => current.map((item) => item.id === id ? { ...item, status: "Emitida", tone: "done" } : item));
    toast.success("Nota marcada como emitida", { description: "O histórico desta obrigação foi atualizado." });
  };

  return (
    <SidebarProvider>
      <Toaster position="top-right" richColors />
      <Sidebar collapsible="icon" className="border-r-0 bg-[#10221f] text-white">
        <SidebarHeader className="px-4 pb-3 pt-5">
          <div className="flex items-center gap-3 overflow-hidden px-1">
            <LyvraMark />
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <p className="font-display text-[22px] font-semibold leading-none tracking-[0.18em]">LYRVA</p>
              <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.18em] text-white/45">inteligência financeira</p>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent className="px-2">
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.16em] text-white/35">Operação</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map((item) => (
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
          <SidebarGroup className="mt-3">
            <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.16em] text-white/35">Aguardando estrutura</SidebarGroupLabel>
            <SidebarGroupContent><SidebarMenu>
              <SidebarMenuItem><SidebarMenuButton tooltip="Régua de cobrança" className="h-10 rounded-xl px-3 text-white/38"><WalletCards /><span>Régua de cobrança</span></SidebarMenuButton></SidebarMenuItem>
              <SidebarMenuItem><SidebarMenuButton tooltip="Jornada financeira" className="h-10 rounded-xl px-3 text-white/38"><Sparkles /><span>Jornada financeira</span></SidebarMenuButton></SidebarMenuItem>
            </SidebarMenu></SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="p-3">
          <div className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.045] p-3 group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-1">
            <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#00BF63] text-xs font-bold text-[#10221f]">CO</div>
            <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden"><p className="truncate text-sm font-medium text-white">Equipe Financeira</p><p className="truncate text-xs text-white/42">Casal Odonto</p></div>
            <Settings className="size-4 text-white/35 group-data-[collapsible=icon]:hidden" />
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
            <Button variant="outline" size="icon" className="relative size-10 rounded-xl border-[#dfe5df] bg-white shadow-none"><Bell className="size-4" /><span className="absolute right-2 top-2 size-1.5 rounded-full bg-[#d56b52]" /><span className="sr-only">Notificações</span></Button>
          </div>
        </header>

        <main className="min-h-[calc(100svh-4.5rem)] bg-[#f7f8f4] p-4 md:p-7">
          <div className="mx-auto max-w-[1500px]">
            {view === "dashboard" && <DashboardView unit={unit} obligations={obligations} goTo={setView} />}
            {view === "invoices" && <InvoicesView unit={unit} obligations={obligations} onIssued={markIssued} />}
            {view === "patients" && <PatientsView unit={unit} patients={shownPatients} demo={isDemo} loading={loadingPatients} goTo={setView} />}
            {view === "import" && <ImportView onImported={async () => { await loadPatients(); setView("patients"); }} />}
            {view === "integrations" && <IntegrationsView />}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

function UnitSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <Select value={value} onValueChange={onChange}><SelectTrigger aria-label="Selecionar unidade" className="h-10 w-10 rounded-xl border-[#dfe5df] bg-white px-0 text-[#25362e] shadow-none sm:min-w-39 sm:px-3"><Building2 className="size-4 text-[#6f7b74]" /><span className="hidden sm:inline"><SelectValue /></span></SelectTrigger><SelectContent><SelectItem value="todas">Todas as unidades</SelectItem><SelectItem value="sorocaba">Sorocaba</SelectItem><SelectItem value="salto">Salto de Pirapora</SelectItem></SelectContent></Select>;
}

function DashboardView({ unit, obligations, goTo }: { unit: string; obligations: DemoObligation[]; goTo: (view: View) => void }) {
  const filtered = obligations.filter((item) => unit === "todas" || (unit === "sorocaba" ? item.unit === "Sorocaba" : item.unit === "Salto de Pirapora")).slice(0, 4);
  return <div className="space-y-5">
    <section className="hero-panel overflow-hidden rounded-[28px] px-5 py-6 text-white md:px-8 md:py-7"><div className="relative z-10 flex flex-col justify-between gap-7 lg:flex-row lg:items-end"><div><Badge className="mb-4 border border-white/12 bg-white/8 px-3 py-1 text-[11px] font-medium text-white hover:bg-white/8"><span className="mr-1.5 size-1.5 rounded-full bg-[#00BF63]" />DADOS DEMONSTRATIVOS</Badge><h2 className="font-display max-w-2xl text-3xl font-medium leading-tight tracking-[-0.035em] md:text-[42px]">O financeiro do mês,<br className="hidden sm:block" /> sem nada escapar.</h2><p className="mt-3 max-w-xl text-sm leading-6 text-white/58 md:text-base">Agosto fecha com 8 notas prontas e 3 pagamentos que ainda precisam da sua atenção.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" className="h-11 rounded-xl border-white/15 bg-white/8 px-4 text-white shadow-none hover:bg-white/14 hover:text-white"><CalendarDays /> Agosto de 2026</Button><Button onClick={() => goTo("invoices")} className="h-11 rounded-xl bg-[#00BF63] px-5 text-[#10221f] shadow-none hover:bg-[#00D66F]">Ver notas a emitir <ChevronRight /></Button></div></div></section>
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Prontas para emissão" value="8" detail="R$ 7.840,00" icon={FileText} accent="lime" /><MetricCard label="Aguardando baixa" value="3" detail="R$ 1.650,00" icon={CircleDollarSign} accent="amber" /><MetricCard label="Notas emitidas" value="34" detail="R$ 24.380,00" icon={CheckCircle2} accent="blue" /><MetricCard label="Lembretes amanhã" value="11" detail="Envio às 10h" icon={MessageCircle} accent="violet" /></section>
    <section className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,.7fr)]"><ObligationsTable title="Pendências prioritárias" description="Obrigações que pedem uma ação da equipe." obligations={filtered} compact /><div className="space-y-5"><QuarterCard /><ActivityCard /></div></section>
  </div>;
}

function InvoicesView({ unit, obligations, onIssued }: { unit: string; obligations: DemoObligation[]; onIssued: (id: number) => void }) {
  const [status, setStatus] = useState("todos");
  const filtered = obligations.filter((item) => (unit === "todas" || (unit === "sorocaba" ? item.unit === "Sorocaba" : item.unit === "Salto de Pirapora")) && (status === "todos" || item.tone === status));
  return <div className="space-y-5">
    <section className="flex flex-col justify-between gap-4 rounded-[24px] border border-[#dfe5df] bg-white p-5 md:flex-row md:items-center md:p-6"><div><p className="eyebrow">AGOSTO DE 2026</p><h2 className="font-display mt-2 text-2xl font-semibold text-[#192820]">Fila de emissão</h2><p className="mt-2 text-sm text-[#718078]">O paciente permanece aqui até a emissão ser concluída.</p></div><div className="flex flex-wrap gap-2"><Select value={status} onValueChange={setStatus}><SelectTrigger className="h-10 min-w-48 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todos">Todas as situações</SelectItem><SelectItem value="ready">Prontas para emissão</SelectItem><SelectItem value="waiting">Aguardando baixa</SelectItem><SelectItem value="cycle">Quadrimestre</SelectItem><SelectItem value="issue">Com pendência</SelectItem><SelectItem value="done">Emitidas</SelectItem></SelectContent></Select><Button className="h-10 rounded-xl" onClick={() => toast.info("A emissão automática entra após definirmos o emissor fiscal.") }><ReceiptText /> Emitir selecionadas</Button></div></section>
    <ObligationsTable title="Obrigações fiscais" description={`${filtered.length} registros encontrados`} obligations={filtered} onIssued={onIssued} />
    <div className="grid gap-4 md:grid-cols-2"><RuleCard title="Sorocaba" label="Emissão mensal" description="A nota é liberada após a baixa e considera o total pago no mês." /><RuleCard title="Salto de Pirapora" label="Emissão quadrimestral" description="O LYRVA acumula quatro meses pagos e cria uma única obrigação no fechamento." /></div>
  </div>;
}

function PatientsView({ unit, patients, demo, loading, goTo }: { unit: string; patients: Patient[]; demo: boolean; loading: boolean; goTo: (view: View) => void }) {
  const [query, setQuery] = useState("");
  const filtered = patients.filter((patient) => (unit === "todas" || (unit === "sorocaba" ? patient.unit === "Sorocaba" : patient.unit === "Salto de Pirapora")) && patient.name.toLowerCase().includes(query.toLowerCase()));
  return <div className="space-y-5">
    {demo && <DemoBanner />}
    <section className="surface-card overflow-hidden rounded-[24px]"><div className="flex flex-col gap-4 border-b border-[#e7ebe7] p-5 sm:flex-row sm:items-center sm:justify-between md:p-6"><div><h2 className="font-display text-xl font-semibold text-[#192820]">Pacientes cadastrados</h2><p className="mt-1 text-sm text-[#718078]">Somente quem estiver marcado para IR entra na rotina de notas.</p></div><div className="flex gap-2"><div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8b9690]" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar paciente" className="h-10 w-52 rounded-xl pl-9 shadow-none" /></div><Button onClick={() => goTo("import")} className="h-10 rounded-xl"><UploadCloud /> Importar</Button></div></div>
      {loading ? <div className="grid min-h-64 place-items-center text-sm text-[#718078]"><LoaderCircle className="mr-2 inline size-4 animate-spin" />Carregando pacientes…</div> : <Table><TableHeader><TableRow className="bg-[#fafbf8] hover:bg-[#fafbf8]"><TableHead className="pl-6">Paciente</TableHead><TableHead>Unidade</TableHead><TableHead>Pagamento</TableHead><TableHead>Periodicidade</TableHead><TableHead>Nota para IR</TableHead><TableHead className="w-12" /></TableRow></TableHeader><TableBody>{filtered.map((patient) => <TableRow key={`${patient.id}-${patient.name}`}><TableCell className="py-4 pl-6"><div><p className="font-medium text-[#213128]">{patient.name}</p><p className="mt-1 text-xs text-[#839087]">{patient.cpf || "CPF pendente"} • {patient.treatment || "Tratamento não informado"}</p></div></TableCell><TableCell>{patient.unit}</TableCell><TableCell><p>{patient.paymentMethod || "—"}</p><p className="mt-1 text-xs text-[#839087]">{money(patient.planAmountCents)}</p></TableCell><TableCell>{patient.invoiceFrequency || (patient.unit === "Sorocaba" ? "Mensal" : "Quadrimestral")}</TableCell><TableCell>{Boolean(patient.taxReceiptIr) ? <Badge className="bg-[#eaf5df] text-[#54752d] hover:bg-[#eaf5df]"><Check /> Sim</Badge> : <Badge variant="secondary">Não</Badge>}</TableCell><TableCell><Button variant="ghost" size="icon-sm"><MoreHorizontal /><span className="sr-only">Ações do paciente</span></Button></TableCell></TableRow>)}</TableBody></Table>}
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
      toast.success(`${data.imported ?? valid.length} pacientes importados`, { description: "A base do LYRVA foi atualizada com sucesso." });
      await onImported();
    } catch (error) {
      toast.error("Importação não concluída", { description: error instanceof Error ? error.message : "Tente novamente." });
    } finally { setImporting(false); }
  };

  const invalid = rows.filter((row) => !row.name).length;
  return <div className="space-y-5"><section className="grid gap-5 xl:grid-cols-[.8fr_1.2fr]"><div className="surface-card rounded-[24px] p-5 md:p-7"><p className="eyebrow">ETAPA 1</p><h2 className="font-display mt-2 text-2xl font-semibold text-[#192820]">Envie sua planilha</h2><p className="mt-2 text-sm leading-6 text-[#718078]">O LYRVA aceita Excel ou CSV, lê a primeira aba e mostra uma conferência antes de cadastrar.</p><input ref={inputRef} className="sr-only" type="file" accept=".xlsx,.xls,.csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void parseFile(file); }} /><button type="button" onClick={() => inputRef.current?.click()} className="mt-6 flex min-h-56 w-full flex-col items-center justify-center rounded-[22px] border border-dashed border-[#b7c4ba] bg-[#fafbf8] px-6 text-center transition hover:border-[#00BF63] hover:bg-[#f2fbf7]"><div className="grid size-14 place-items-center rounded-2xl bg-[#e4f8ee] text-[#00884a]"><UploadCloud className="size-6" /></div><p className="mt-4 font-medium text-[#26382e]">{fileName || "Clique para escolher a planilha"}</p><p className="mt-1 text-xs text-[#87928c]">XLSX, XLS ou CSV • até 1.000 pacientes por vez</p></button><div className="mt-5 space-y-3 text-sm text-[#65736b]"><CheckLine>Prévia antes do cadastro</CheckLine><CheckLine>Detecção de CPF e Clinicorp ID</CheckLine><CheckLine>Periodicidade definida pela unidade</CheckLine></div></div>
      <div className="surface-card overflow-hidden rounded-[24px]"><div className="flex items-center justify-between border-b border-[#e7ebe7] p-5 md:px-6"><div><p className="eyebrow">ETAPA 2</p><h2 className="font-display mt-2 text-xl font-semibold text-[#192820]">Conferência dos dados</h2></div>{rows.length > 0 && <Badge variant="secondary">{rows.length} linhas encontradas</Badge>}</div>{parseError ? <div className="m-6 flex gap-3 rounded-2xl bg-[#fae8e3] p-4 text-sm text-[#934e3f]"><AlertCircle className="mt-0.5 size-4 shrink-0" />{parseError}</div> : rows.length ? <><Table><TableHeader><TableRow className="bg-[#fafbf8] hover:bg-[#fafbf8]"><TableHead className="pl-6">Paciente</TableHead><TableHead>Unidade</TableHead><TableHead>Pagamento</TableHead><TableHead>IR</TableHead></TableRow></TableHeader><TableBody>{rows.slice(0, 6).map((row, index) => <TableRow key={`${row.name}-${index}`} className={!row.name ? "bg-[#fff7f4]" : ""}><TableCell className="py-4 pl-6"><p className="font-medium">{row.name || "Nome não identificado"}</p><p className="mt-1 text-xs text-[#839087]">{row.cpf || "CPF não informado"}</p></TableCell><TableCell>{row.unit}</TableCell><TableCell>{row.paymentMethod || "—"}</TableCell><TableCell>{row.taxReceiptIr ? "Sim" : "Não"}</TableCell></TableRow>)}</TableBody></Table>{rows.length > 6 && <p className="border-t p-4 text-center text-xs text-[#7d8982]">Mais {rows.length - 6} linhas serão incluídas na importação.</p>}<div className="flex flex-col gap-3 border-t border-[#e7ebe7] bg-[#fafbf8] p-5 sm:flex-row sm:items-center sm:justify-between md:px-6"><p className="text-sm text-[#65736b]">{invalid ? `${invalid} linha(s) com erro serão ignoradas.` : "Tudo certo para continuar."}</p><Button disabled={importing || rows.length === invalid} onClick={() => void submit()} className="h-11 rounded-xl bg-[#183b32] px-5">{importing ? <LoaderCircle className="animate-spin" /> : <Database />} Importar {rows.length - invalid} pacientes</Button></div></> : <div className="grid min-h-96 place-items-center px-6 text-center"><div><FileSpreadsheet className="mx-auto size-10 text-[#b3bdb6]" /><p className="mt-4 font-medium text-[#4e5d54]">A prévia aparecerá aqui</p><p className="mt-1 text-sm text-[#8a958e]">Nenhum dado será salvo sem sua confirmação.</p></div></div>}</div>
    </section><section className="rounded-[22px] border border-[#dfe5df] bg-[#eef4e9] p-5"><div className="flex gap-3"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-[#51713d]" /><div><p className="font-medium text-[#2c432f]">Importação protegida contra duplicidades</p><p className="mt-1 text-sm leading-6 text-[#657a66]">O CPF é a chave principal. Quando um CPF já existir, o cadastro será atualizado em vez de duplicado.</p></div></div></section></div>;
}

function IntegrationsView() {
  const cards = [
    { name: "Clinicorp", icon: Database, status: "Aguardando credenciais", description: "Pacientes, boletos, parcelas e baixas de pagamento.", accent: "#e7f2e8", color: "#39704a", next: "Usuário e token da API" },
    { name: "WhatsApp Business", icon: MessageCircle, status: "Aguardando configuração", description: "Lembrete D-1 e confirmação automática de pagamento.", accent: "#e6f4ef", color: "#26735d", next: "Conta Meta e número oficial" },
    { name: "Emissor de NFS-e", icon: ReceiptText, status: "Planejado", description: "Na primeira fase, o LYRVA controla a emissão manual.", accent: "#eeeafb", color: "#7261b9", next: "Definir emissor e certificado" },
  ];
  return <div className="space-y-5"><section className="hero-panel overflow-hidden rounded-[28px] p-6 text-white md:p-8"><div className="relative z-10 max-w-2xl"><Badge className="border border-white/12 bg-white/8 text-white hover:bg-white/8">MAPA DE CONEXÕES</Badge><h2 className="font-display mt-4 text-3xl font-medium md:text-4xl">A base está pronta para conversar com o financeiro real.</h2><p className="mt-3 text-sm leading-6 text-white/60">As conexões ficam desligadas até recebermos os acessos oficiais. Assim nenhum dado real é movimentado antes da hora.</p></div></section><section className="grid gap-4 lg:grid-cols-3">{cards.map((item) => <article key={item.name} className="surface-card rounded-[24px] p-6"><div className="flex items-start justify-between gap-4"><div className="grid size-12 place-items-center rounded-2xl" style={{ background: item.accent, color: item.color }}><item.icon className="size-5" /></div><Badge variant="outline" className="text-[10px]">{item.status}</Badge></div><h3 className="font-display mt-6 text-xl font-semibold text-[#1c2c23]">{item.name}</h3><p className="mt-2 min-h-12 text-sm leading-6 text-[#718078]">{item.description}</p><div className="mt-6 border-t border-[#edf0ed] pt-4"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#909a94]">Próximo passo</p><p className="mt-2 text-sm font-medium text-[#405148]">{item.next}</p></div></article>)}</section><section className="surface-card rounded-[24px] p-6"><div className="flex items-start gap-4"><div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#fff2d9] text-[#946814]"><ShieldCheck /></div><div><h3 className="font-display text-lg font-semibold">Ordem segura de ativação</h3><p className="mt-1 text-sm text-[#718078]">1. Conectar em modo leitura → 2. Validar baixas → 3. Aprovar modelos do WhatsApp → 4. Ativar mensagens → 5. Integrar emissão fiscal.</p></div></div></section></div>;
}

function ObligationsTable({ title, description, obligations, compact = false, onIssued }: { title: string; description: string; obligations: DemoObligation[]; compact?: boolean; onIssued?: (id: number) => void }) {
  return <div className="surface-card overflow-hidden rounded-[24px]"><div className="flex flex-col gap-4 border-b border-[#e7ebe7] p-5 sm:flex-row sm:items-center sm:justify-between md:px-6"><div><h3 className="font-display text-lg font-semibold text-[#192820]">{title}</h3><p className="mt-1 text-sm text-[#718078]">{description}</p></div>{compact && <div className="relative w-full sm:w-56"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8b9690]" /><Input placeholder="Buscar paciente" className="h-10 rounded-xl bg-[#fafbf8] pl-9 shadow-none" /></div>}</div><Table><TableHeader><TableRow className="bg-[#fafbf8] hover:bg-[#fafbf8]"><TableHead className="h-11 pl-5 text-[11px] uppercase tracking-[.08em] text-[#829087] md:pl-6">Paciente</TableHead><TableHead className="text-[11px] uppercase tracking-[.08em] text-[#829087]">Referência</TableHead><TableHead className="text-[11px] uppercase tracking-[.08em] text-[#829087]">Valor</TableHead><TableHead className="text-[11px] uppercase tracking-[.08em] text-[#829087]">Situação</TableHead><TableHead className="w-20" /></TableRow></TableHeader><TableBody>{obligations.map((item) => <TableRow key={item.id}><TableCell className="py-4 pl-5 md:pl-6"><div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-xl bg-[#edf2ed] text-xs font-semibold text-[#365146]">{item.initials}</div><div><p className="font-medium text-[#213128]">{item.patient}</p><p className="mt-0.5 text-xs text-[#849087]">{item.unit}</p></div></div></TableCell><TableCell>{item.reference}</TableCell><TableCell className="font-semibold tabular-nums">{item.amount}</TableCell><TableCell><StatusBadge tone={item.tone}>{item.status}</StatusBadge></TableCell><TableCell>{onIssued && item.tone === "ready" ? <Button onClick={() => onIssued(item.id)} variant="outline" size="sm" className="rounded-lg">Emitir</Button> : <Button variant="ghost" size="icon-sm"><MoreHorizontal /><span className="sr-only">Mais opções</span></Button>}</TableCell></TableRow>)}</TableBody></Table>{!obligations.length && <div className="grid min-h-44 place-items-center text-sm text-[#7d8982]">Nenhuma obrigação neste filtro.</div>}</div>;
}

function MetricCard({ label, value, detail, icon: Icon, accent }: { label: string; value: string; detail: string; icon: typeof FileText; accent: string }) {
  return <article className="surface-card metric-card rounded-[22px] p-5"><div className="flex items-start justify-between"><div className={`metric-icon metric-${accent}`}><Icon /></div><span className="text-xs font-medium text-[#87928c]">AGO/26</span></div><div className="mt-5 flex items-end justify-between gap-3"><div><p className="font-display text-[32px] font-semibold leading-none tracking-tight text-[#1a2b22]">{value}</p><p className="mt-2 text-sm text-[#68766e]">{label}</p></div><p className="mb-0.5 text-xs font-semibold tabular-nums text-[#506158]">{detail}</p></div></article>;
}

function QuarterCard() {
  return <div className="surface-card rounded-[24px] p-5 md:p-6"><div className="flex items-start justify-between"><div><p className="eyebrow">SALTO DE PIRAPORA</p><h3 className="font-display mt-2 text-xl font-semibold">Quadrimestre atual</h3></div><div className="grid size-10 place-items-center rounded-2xl bg-[#e4f8ee] text-[#00884a]"><CalendarDays className="size-5" /></div></div><div className="mt-6 flex items-end justify-between"><div><p className="text-sm text-[#78857e]">Maio — Agosto</p><p className="font-display mt-1 text-3xl font-semibold tracking-tight">R$ 18.420</p></div><p className="mb-1 text-sm font-semibold text-[#007a43]">82%</p></div><Progress value={82} className="mt-4 h-2 bg-[#e9eee7] [&_[data-slot=progress-indicator]]:bg-[#00BF63]" /><div className="mt-4 flex justify-between text-xs text-[#849087]"><span>26 pacientes</span><span>Fecha em 5 dias</span></div></div>;
}

function ActivityCard() {
  return <div className="surface-card rounded-[24px] p-5 md:p-6"><p className="eyebrow">ATIVIDADE</p><h3 className="font-display mt-2 text-lg font-semibold">O que acabou de acontecer</h3><div className="mt-5 space-y-5">{activities.map((item) => <div key={item.title} className="flex gap-3"><div className={`activity-icon activity-${item.color}`}><item.icon /></div><div className="min-w-0 flex-1"><p className="text-sm font-medium">{item.title}</p><p className="mt-1 truncate text-xs text-[#7d8982]">{item.detail}</p></div><span className="shrink-0 text-[11px] text-[#9aa39e]">{item.time}</span></div>)}</div></div>;
}

function RuleCard({ title, label, description }: { title: string; label: string; description: string }) {
  return <article className="surface-card flex items-start gap-4 rounded-[22px] p-5"><div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#edf4e7] text-[#5e793f]"><Building2 className="size-5" /></div><div><p className="text-sm font-semibold text-[#26372e]">{title}</p><p className="mt-1 text-xs font-semibold uppercase tracking-[.08em] text-[#77905e]">{label}</p><p className="mt-2 text-sm leading-6 text-[#718078]">{description}</p></div></article>;
}

function DemoBanner() {
  return <div className="flex flex-col justify-between gap-3 rounded-[20px] border border-[#dce8d3] bg-[#f1f7ea] px-5 py-4 sm:flex-row sm:items-center"><div className="flex items-center gap-3"><Sparkles className="size-5 text-[#648143]" /><div><p className="text-sm font-semibold text-[#38502b]">Você está vendo cadastros demonstrativos</p><p className="mt-0.5 text-xs text-[#6f8067]">Importe a planilha para substituir esta visualização pela base real.</p></div></div><Badge className="bg-[#dcebc8] text-[#49642f] hover:bg-[#dcebc8]">DEMONSTRAÇÃO</Badge></div>;
}

function CheckLine({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2"><span className="grid size-5 place-items-center rounded-full bg-[#e4f8ee] text-[#00884a]"><Check className="size-3" /></span>{children}</div>;
}
