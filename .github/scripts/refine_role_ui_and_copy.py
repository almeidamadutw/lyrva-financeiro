from pathlib import Path

app = Path('components/lyvra-app.tsx')
s = app.read_text(encoding='utf-8')

s = s.replace('import { AboveframeBrand } from "@/components/password-recovery";\n\n', '')
s = s.replace(
    'type Role = "membro" | "gestora" | "ceo" | "suporte";\n',
    'type Role = "membro" | "gestora" | "ceo" | "suporte";\n'
    'type OperationalArea = "none" | "reminders" | "collections" | "invoices" | "management" | "support";\n',
    1,
)
s = s.replace(
    '  role: Role;\n  canManageCollections: boolean;\n};',
    '  role: Role;\n  operationalArea: OperationalArea;\n  canManageCollections: boolean;\n};',
    1,
)

old_titles = '''const viewTitles: Record<View, { eyebrow: string; title: string }> = {
  dashboard: { eyebrow: "Operação financeira", title: "Visão geral" },
  journey: { eyebrow: "Operação financeira", title: "Jornada financeira" },
  invoices: { eyebrow: "Controle fiscal", title: "Notas fiscais" },
  collections: { eyebrow: "Jornada do financeiro", title: "Régua de cobrança" },
  patients: { eyebrow: "Base de cadastros", title: "Pacientes" },
  import: { eyebrow: "Carga inicial", title: "Importar planilha" },
  access: { eyebrow: "Equipe e segurança", title: "Gerenciar acessos" },
  support: { eyebrow: "Administração técnica", title: "Central de suporte" },
  integrations: { eyebrow: "Conexões do sistema", title: "Integrações" },
};'''
new_titles = '''const viewTitles: Record<View, { eyebrow: string; title: string }> = {
  dashboard: { eyebrow: "Confira primeiro o que precisa de ação", title: "Visão geral" },
  journey: { eyebrow: "Execute as tarefas pela data de vencimento", title: "Jornada financeira" },
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
  const byArea: Record<OperationalArea, View[]> = {
    none: ["patients"],
    reminders: ["journey", "patients"],
    collections: ["collections", "patients"],
    invoices: ["invoices", "patients", "import"],
    management: ["dashboard", "journey", "invoices", "collections", "patients", "import", "access"],
    support: ["support", "access", "integrations"],
  };
  return new Set<View>(byArea[user.operationalArea] ?? byArea.none);
};

const defaultViewFor = (user: UserAccount): View => {
  if (user.operationalArea === "support") return "support";
  if (user.operationalArea === "collections") return "collections";
  if (user.operationalArea === "reminders") return "journey";
  if (user.operationalArea === "invoices") return "invoices";
  if (user.operationalArea === "management") return "dashboard";
  return "patients";
};'''
if old_titles not in s:
    raise SystemExit('viewTitles não encontrado')
s = s.replace(old_titles, new_titles, 1)

s = s.replace(
    '.from("profiles")\n      .select("user_id, full_name, email, role, is_active")',
    '.from("profiles")\n      .select("*")',
    1,
)
s = s.replace(
    '      role: data.role as Role,\n      canManageCollections: Boolean(collectionUnits?.length),',
    '      role: data.role as Role,\n      operationalArea: (((data as unknown as { operational_area?: OperationalArea }).operational_area) ?? (data.role === "suporte" ? "support" : ["gestora", "ceo"].includes(data.role) ? "management" : Boolean(collectionUnits?.length) ? "collections" : "none")),\n      canManageCollections: Boolean(collectionUnits?.length),',
    1,
)

s = s.replace(
    '      if (active) setCurrentUser(account);\n      try {\n        await loadFinancialData();',
    '      if (active) { setCurrentUser(account); setView(defaultViewFor(account)); }\n      try {\n        if (account.operationalArea !== "support") await loadFinancialData();',
    1,
)
s = s.replace(
    '    setCurrentUser(account);\n    try {\n      await loadFinancialData();',
    '    setCurrentUser(account);\n    setView(defaultViewFor(account));\n    try {\n      if (account.operationalArea !== "support") await loadFinancialData();',
    1,
)

old_nav = '''  const visibleNavItems = navItems.filter((item) => {
    if (item.id === "collections") return currentUser.canManageCollections || ["gestora", "ceo", "suporte"].includes(currentUser.role);
    if (item.id === "integrations") return currentUser.role === "suporte";
    if (item.id === "support") return currentUser.role === "suporte";
    if (item.id === "access") return ["gestora", "ceo", "suporte"].includes(currentUser.role);
    return true;
  });'''
new_nav = '''  const allowedViews = allowedViewsFor(currentUser);
  const visibleNavItems = navItems.filter((item) => allowedViews.has(item.id));'''
if old_nav not in s:
    raise SystemExit('visibleNavItems não encontrado')
s = s.replace(old_nav, new_nav, 1)

s = s.replace(
    '<SidebarGroupLabel className="text-[10px] uppercase tracking-[0.16em] text-white/35">Operação</SidebarGroupLabel>',
    '<SidebarGroupLabel className="text-[10px] uppercase tracking-[0.16em] text-white/35">{areaLabels[currentUser.operationalArea]}</SidebarGroupLabel>',
    1,
)
s = s.replace(
    '{currentUser.role === "membro" && currentUser.canManageCollections ? "Cobrança" : roleLabels[currentUser.role]}',
    '{areaLabels[currentUser.operationalArea]}',
    1,
)
s = s.replace(
    '            {unitFilter}\n            <FinancialNotifications userId={currentUser.id} unit={unit} onOpenJourney={() => setView("journey")} onOpenCollections={() => setView("collections")} />',
    '            {currentUser.operationalArea !== "support" && unitFilter}\n            {currentUser.operationalArea !== "support" && <FinancialNotifications userId={currentUser.id} unit={unit} onOpenJourney={() => allowedViews.has("journey") && setView("journey")} onOpenCollections={() => allowedViews.has("collections") && setView("collections")} />}',
    1,
)
s = s.replace(
    '<DueTaskAlert userId={currentUser.id} onOpenJourney={() => setView("journey")} onOpenCollections={() => setView("collections")} />',
    '{currentUser.operationalArea !== "support" && <DueTaskAlert userId={currentUser.id} onOpenJourney={() => allowedViews.has("journey") && setView("journey")} onOpenCollections={() => allowedViews.has("collections") && setView("collections")} />}',
    1,
)

s = s.replace(
    '{view === "dashboard" && <DashboardView unit={unit} obligations={obligations} reminderCount={reminderCount} goTo={setView} />}',
    '{view === "dashboard" && allowedViews.has("dashboard") && <DashboardView unit={unit} obligations={obligations} reminderCount={reminderCount} goTo={setView} />}',
    1,
)
s = s.replace('{view === "journey" && <FinancialJourney unit={unit} />}', '{view === "journey" && allowedViews.has("journey") && <FinancialJourney unit={unit} />}', 1)
s = s.replace('{view === "invoices" && <InvoicesView unit={unit} obligations={obligations} onIssued={markIssued} />}', '{view === "invoices" && allowedViews.has("invoices") && <InvoicesView unit={unit} obligations={obligations} onIssued={markIssued} />}', 1)
s = s.replace('{view === "collections" && <CollectionsJourney unit={unit} />}', '{view === "collections" && allowedViews.has("collections") && <CollectionsJourney unit={unit} />}', 1)
s = s.replace(
    '{view === "patients" && <PatientsView unit={unit} patients={patients} loading={loadingPatients} goTo={setView} onSaved={loadFinancialData} />}',
    '{view === "patients" && allowedViews.has("patients") && <PatientsView unit={unit} patients={patients} loading={loadingPatients} goTo={setView} onSaved={loadFinancialData} canEdit={["invoices", "management"].includes(currentUser.operationalArea)} />}',
    1,
)
s = s.replace('{view === "import" && <NfWorkbookImportView', '{view === "import" && allowedViews.has("import") && <NfWorkbookImportView', 1)
s = s.replace('{view === "access" && ["gestora", "ceo", "suporte"].includes(currentUser.role)', '{view === "access" && allowedViews.has("access")', 1)
s = s.replace('{view === "support" && currentUser.role === "suporte"', '{view === "support" && allowedViews.has("support")', 1)
s = s.replace('{view === "integrations" && currentUser.role === "suporte"', '{view === "integrations" && allowedViews.has("integrations")', 1)

s = s.replace('>Inteligência financeira</p>', '>Financeiro Casal Odonto</p>', 1)
ribbon = '''        <div className="login-ribbon" aria-label="Pagamentos, notas e rotinas">
          <span>Pagamentos</span><span className="login-ribbon-dot" aria-hidden="true" /><span>Notas</span><span className="login-ribbon-dot" aria-hidden="true" /><span>Rotinas</span>
        </div>

'''
s = s.replace(ribbon, '', 1)
s = s.replace('>Bem-vindo de volta</h1>', '>Acesse sua rotina</h1>', 1)
s = s.replace('Entre com os dados fornecidos pela equipe responsável.', 'Use o usuário e a senha do seu acesso ao LYVRA.', 1)

old_hero = '''    <section className="hero-panel overflow-hidden rounded-[28px] px-5 py-6 text-white md:px-8 md:py-7"><div className="relative z-10 flex flex-col justify-between gap-7 lg:flex-row lg:items-end"><div><Badge className="mb-4 border border-white/12 bg-white/8 px-3 py-1 text-[11px] font-medium text-white hover:bg-white/8"><span className="mr-1.5 size-1.5 rounded-full bg-[#00BF63]" />BASE REAL CONECTADA</Badge><h2 className="font-display max-w-2xl text-3xl font-medium leading-tight tracking-[-0.035em] md:text-[42px]">O financeiro organizado,<br className="hidden sm:block" /> sem nada escapar.</h2><p className="mt-3 max-w-xl text-sm leading-6 text-white/58 md:text-base">{allFiltered.length ? `${allFiltered.length} obrigação(ões) fiscal(is) carregada(s) da base.` : "A estrutura está pronta e aguarda a primeira importação de pacientes e pagamentos."}</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" className="h-11 rounded-xl border-white/15 bg-white/8 px-4 text-white shadow-none hover:bg-white/14 hover:text-white"><CalendarDays /> Dados em tempo real</Button><Button onClick={() => goTo("invoices")} className="h-11 rounded-xl bg-[#00BF63] px-5 text-[#10221f] shadow-none hover:bg-[#00D66F]">Ver notas a emitir <ChevronRight /></Button></div></div></section>'''
new_hero = '''    <section className="hero-panel overflow-hidden rounded-[28px] px-5 py-6 text-white md:px-8 md:py-7"><div className="relative z-10 flex flex-col justify-between gap-6 lg:flex-row lg:items-end"><div><Badge className="mb-4 border border-white/12 bg-white/8 px-3 py-1 text-[11px] font-medium text-white hover:bg-white/8">COMECE POR AQUI</Badge><h2 className="font-display max-w-2xl text-3xl font-medium leading-tight tracking-[-0.035em] md:text-[38px]">Confira as pendências com prazo mais próximo.</h2><p className="mt-3 max-w-xl text-sm leading-6 text-white/65">Use os cards para acompanhar a operação. Entre na tela específica para executar a tarefa e registrar a conclusão.</p></div><Button onClick={() => goTo("invoices")} className="h-11 rounded-xl bg-[#00BF63] px-5 text-[#10221f] shadow-none hover:bg-[#00D66F]">Abrir notas fiscais <ChevronRight /></Button></div></section>'''
s = s.replace(old_hero, new_hero, 1)

old_invoice_header = '''    <section className="flex flex-col justify-between gap-4 rounded-[24px] border border-[#dfe5df] bg-white p-5 md:flex-row md:items-center md:p-6"><div><p className="eyebrow">OBRIGAÇÕES REAIS</p><h2 className="font-display mt-2 text-2xl font-semibold text-[#192820]">Fila de emissão</h2><p className="mt-2 text-sm text-[#718078]">O paciente permanece aqui até a emissão ser concluída.</p></div><div className="flex flex-wrap gap-2"><Select value={status} onValueChange={setStatus}><SelectTrigger className="h-10 min-w-48 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todos">Todas as situações</SelectItem><SelectItem value="ready">Prontas para emissão</SelectItem><SelectItem value="waiting">Aguardando baixa</SelectItem><SelectItem value="cycle">Ciclo anterior</SelectItem><SelectItem value="issue">Com pendência</SelectItem><SelectItem value="done">Emitidas</SelectItem></SelectContent></Select><Button className="h-10 rounded-xl" onClick={() => toast.info("A emissão automática entra após definirmos o emissor fiscal.") }><ReceiptText /> Emitir selecionadas</Button></div></section>'''
new_invoice_header = '''    <section className="flex flex-col justify-between gap-4 rounded-[24px] border border-[#dfe5df] bg-white p-5 md:flex-row md:items-center md:p-6"><div><p className="eyebrow">COMO USAR</p><h2 className="font-display mt-2 text-2xl font-semibold text-[#192820]">Notas que precisam de ação</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-[#718078]">Filtre a situação, emita a NF fora do LYVRA e só depois marque a obrigação como emitida aqui.</p></div><Select value={status} onValueChange={setStatus}><SelectTrigger className="h-10 min-w-48 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todos">Todas as situações</SelectItem><SelectItem value="ready">Prontas para emissão</SelectItem><SelectItem value="waiting">Aguardando baixa</SelectItem><SelectItem value="cycle">Ciclo anterior</SelectItem><SelectItem value="issue">Com pendência</SelectItem><SelectItem value="done">Emitidas</SelectItem></SelectContent></Select></section>'''
s = s.replace(old_invoice_header, new_invoice_header, 1)

s = s.replace(
    'function PatientsView({ unit, patients, loading, goTo, onSaved }: { unit: string; patients: Patient[]; loading: boolean; goTo: (view: View) => void; onSaved: () => Promise<void> }) {',
    'function PatientsView({ unit, patients, loading, goTo, onSaved, canEdit }: { unit: string; patients: Patient[]; loading: boolean; goTo: (view: View) => void; onSaved: () => Promise<void>; canEdit: boolean }) {',
    1,
)
s = s.replace(
    'Somente quem estiver marcado para IR entra na rotina de notas.',
    'Pesquise o nome antes de qualquer cadastro. Use esta tela para conferir unidade, pagamento e dados do paciente.',
    1,
)
s = s.replace(
    '</div><ManualPatientDialog onSaved={onSaved} /><Button onClick={() => goTo("import")} variant="outline" className="h-10 rounded-xl"><UploadCloud /> Importar</Button></div></div>',
    '</div>{canEdit && <><ManualPatientDialog onSaved={onSaved} /><Button onClick={() => goTo("import")} variant="outline" className="h-10 rounded-xl"><UploadCloud /> Importar</Button></>}</div></div>',
    1,
)
s = s.replace(
    '<p className="mt-1 text-sm text-[#8a958e]">Importe a planilha oficial para iniciar a base real.</p><Button onClick={() => goTo("import")} variant="outline" className="mt-5 rounded-xl"><UploadCloud /> Importar planilha</Button>',
    '<p className="mt-1 text-sm text-[#8a958e]">Confira se o filtro de unidade está correto.</p>{canEdit && <Button onClick={() => goTo("import")} variant="outline" className="mt-5 rounded-xl"><UploadCloud /> Importar planilha</Button>}',
    1,
)

s = s.replace(
    '  role: Role;\n  is_active: boolean;',
    '  role: Role;\n  operational_area?: OperationalArea;\n  is_active: boolean;',
    1,
)
old_badges = '<Badge variant="secondary">{roleLabels[profile.role]}</Badge>{units.some((unit) => unit.collection_assignee_user_id === profile.user_id) && <Badge className="bg-[#fff1d8] text-[#8a6118] hover:bg-[#fff1d8]">Régua de cobrança</Badge>}'
new_badges = '<Badge variant="secondary">{roleLabels[profile.role]}</Badge><Badge className="bg-[#edf8f1] text-[#27704b] hover:bg-[#edf8f1]">{areaLabels[profile.operational_area ?? (profile.role === "suporte" ? "support" : ["gestora", "ceo"].includes(profile.role) ? "management" : "none")]}</Badge>'
s = s.replace(old_badges, new_badges, 1)

old_support = '''function SupportView({ goTo }: { goTo: (view: View) => void }) {
  return <div className="space-y-5"><section className="hero-panel overflow-hidden rounded-[28px] px-6 py-7 text-white md:px-8"><AboveframeBrand /><p className="eyebrow mt-6 text-[#7deeb4]">SUPORTE LYVRA</p><h2 className="font-display mt-3 text-3xl font-medium">Controle técnico em um só lugar.</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-white/60">Gerencie acessos, envie recuperação de senha, acompanhe as conexões das unidades.</p></section><section className="grid gap-4 md:grid-cols-2"><button type="button" onClick={() => goTo("access")} className="surface-card rounded-[24px] p-6 text-left transition hover:-translate-y-0.5 hover:border-[#00BF63]"><UserCog className="size-6 text-[#00884a]" /><h3 className="font-display mt-5 text-xl font-semibold text-[#192820]">Usuários e senhas</h3><p className="mt-2 text-sm leading-6 text-[#718078]">Criar acessos, escolher unidades e solicitar recuperação pela caixa central.</p></button><button type="button" onClick={() => goTo("integrations")} className="surface-card rounded-[24px] p-6 text-left transition hover:-translate-y-0.5 hover:border-[#00BF63]"><Link2 className="size-6 text-[#00884a]" /><h3 className="font-display mt-5 text-xl font-semibold text-[#192820]">Integrações</h3><p className="mt-2 text-sm leading-6 text-[#718078]">Validar Clinicorp por unidade e acompanhar a saúde das conexões.</p></button></section></div>;
}'''
new_support = '''function SupportView({ goTo }: { goTo: (view: View) => void }) {
  return <div className="space-y-5"><section className="rounded-[24px] border border-[#dfe5df] bg-white p-6"><p className="eyebrow">O QUE FAZER AQUI</p><h2 className="font-display mt-2 text-2xl font-semibold text-[#192820]">Corrija acesso ou integração</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-[#718078]">Se o problema for login, senha ou unidade liberada, abra Gerenciar acessos. Se os dados não estiverem sincronizando, abra Integrações.</p></section><section className="grid gap-4 md:grid-cols-2"><button type="button" onClick={() => goTo("access")} className="surface-card rounded-[24px] p-6 text-left transition hover:border-[#00BF63]"><UserCog className="size-6 text-[#00884a]" /><h3 className="font-display mt-5 text-xl font-semibold text-[#192820]">Gerenciar acessos</h3><p className="mt-2 text-sm leading-6 text-[#718078]">Criar usuário, conferir unidades liberadas e enviar recuperação de senha.</p></button><button type="button" onClick={() => goTo("integrations")} className="surface-card rounded-[24px] p-6 text-left transition hover:border-[#00BF63]"><Link2 className="size-6 text-[#00884a]" /><h3 className="font-display mt-5 text-xl font-semibold text-[#192820]">Ver integrações</h3><p className="mt-2 text-sm leading-6 text-[#718078]">Conferir Clinicorp e sincronizar as baixas de Sorocaba ou Salto quando necessário.</p></button></section></div>;
}'''
if old_support not in s:
    raise SystemExit('SupportView não encontrado')
s = s.replace(old_support, new_support, 1)

old_integration_hero = '''    <section className="hero-panel overflow-hidden rounded-[28px] p-6 text-white md:p-8"><div className="relative z-10 max-w-3xl"><Badge className="border border-white/12 bg-white/8 text-white hover:bg-white/8">CLINICORP • FASE DE LEITURA</Badge><h2 className="font-display mt-4 text-3xl font-medium md:text-4xl">Cada clínica conectada no seu próprio acesso.</h2><p className="mt-3 text-sm leading-6 text-white/60">Primeiro validamos Sorocaba e Salto separadamente. A leitura inicial identifica os campos e as baixas reais, mas ainda não cadastra nem altera nenhum pagamento.</p></div></section>'''
new_integration_hero = '''    <section className="rounded-[24px] border border-[#dfe5df] bg-white p-6"><p className="eyebrow">COMO USAR</p><h2 className="font-display mt-2 text-2xl font-semibold text-[#192820]">Clinicorp por unidade</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-[#718078]">Use “Sincronizar baixas” quando precisar atualizar pagamentos. Faça uma unidade por vez e confira a mensagem final antes de iniciar a próxima.</p></section>'''
s = s.replace(old_integration_hero, new_integration_hero, 1)

app.write_text(s, encoding='utf-8')

journey = Path('components/financial-journey.tsx')
j = journey.read_text(encoding='utf-8')
j = j.replace('''            <Badge className="border border-white/12 bg-white/8 text-white hover:bg-white/8">JORNADA ATIVA</Badge>
            <h2 className="font-display mt-4 text-3xl font-medium tracking-tight md:text-[40px]">O que precisa acontecer,<br className="hidden sm:block" /> na hora certa.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/60">A jornada organiza lembretes, cobrança e próximas ações. Não existe nível de prioridade: a ordem é definida pelo prazo.</p>''', '''            <Badge className="border border-white/12 bg-white/8 text-white hover:bg-white/8">COMO COMEÇAR</Badge>
            <h2 className="font-display mt-4 text-3xl font-medium tracking-tight md:text-[38px]">Faça primeiro o que está vencido ou vence hoje.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/65">Abra a tarefa, confira o paciente, execute o contato indicado e marque como concluída somente depois de terminar.</p>''', 1)
j = j.replace('Maria Eduarda do financeiro recebe a tarefa de lembrete um dia antes do vencimento. O envio automático pelo WhatsApp entra na etapa de integração.', 'Um dia antes do vencimento, confira o paciente, faça o lembrete indicado e conclua a tarefa depois do contato.', 1)
j = j.replace('As etapas abaixo são operacionais e alimentam as tarefas reais do sistema.', 'Use este fluxo para entender por que cada tarefa aparece e quem deve executá-la.', 1)
j = j.replace('Quando pacientes e parcelas entrarem na base, a jornada será alimentada automaticamente.', 'Se não houver tarefa aqui, não há ação pendente neste filtro.', 1)
journey.write_text(j, encoding='utf-8')

collections = Path('components/collections-journey-real.tsx')
c = collections.read_text(encoding='utf-8')
c = c.replace('A cobrança começa 3 dias úteis após o vencimento', 'Comece pelos casos liberados para contato', 1)
c = c.replace('O LYVRA só libera o caso no prazo correto. Cada tentativa, acordo, promessa e retorno fica gravado no histórico.', 'Antes de ligar, confira vencimento, valor e telefone. Depois do contato, registre o resultado e a próxima ação no histórico.', 1)
c = c.replace('<Badge variant="outline" className="w-fit border-[#b9dbc7] bg-[#edf8f1] px-3 py-1.5 text-[#27704b]">BASE REAL</Badge>', '', 1)
collections.write_text(c, encoding='utf-8')

imp = Path('components/nf-workbook-import.tsx')
i = imp.read_text(encoding='utf-8')
i = i.replace('<p className="eyebrow">PLANILHA OFICIAL</p>', '<p className="eyebrow">ANTES DE IMPORTAR</p>', 1)
i = i.replace('O LYVRA lê o modelo detalhado e também a planilha mensal com dois blocos lado a lado. No modelo mensal, esquerda é Boleto e direita é Cartão. As baixas dos dois são conciliadas pelo Clinicorp.', 'Selecione a planilha, confira os pacientes e defina a unidade de quem estiver sem Sorocaba ou Salto. Só confirme quando a conferência estiver correta.', 1)
i = i.replace('<p className="eyebrow">CONFERÊNCIA</p>', '<p className="eyebrow">CONFIRA ANTES DE SALVAR</p>', 1)
imp.write_text(i, encoding='utf-8')

access = Path('supabase/functions/access-admin/index.ts')
a = access.read_text(encoding='utf-8')
a = a.replace('select("user_id,username,full_name,role,is_active,recovery_unit_id,profile_units(unit_id)")', 'select("user_id,username,full_name,role,operational_area,is_active,recovery_unit_id,profile_units(unit_id)")', 1)
access.write_text(a, encoding='utf-8')
