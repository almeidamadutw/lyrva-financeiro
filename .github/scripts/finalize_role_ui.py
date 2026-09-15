from pathlib import Path

app = Path('components/lyvra-app.tsx')
s = app.read_text(encoding='utf-8')

# Remove o subtítulo genérico da lateral.
s = s.replace('              <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.18em] text-white/45">inteligência financeira</p>\n', '', 1)

# Cadastro de acesso: escolhe a rotina real do membro.
s = s.replace(
    '  const [role, setRole] = useState<Role>("membro");\n  const [recoveryUnit, setRecoveryUnit] = useState("");',
    '  const [role, setRole] = useState<Role>("membro");\n  const [operationalArea, setOperationalArea] = useState<OperationalArea>("invoices");\n  const [recoveryUnit, setRecoveryUnit] = useState("");',
    1,
)
s = s.replace(
    'const result = await invokeAccessAdmin({ action: "invite", fullName, username, role, unitCode: recoveryUnit, unitCodes: selectedUnits });',
    'const result = await invokeAccessAdmin({ action: "invite", fullName, username, role, operationalArea: role === "membro" ? operationalArea : "management", unitCode: recoveryUnit, unitCodes: selectedUnits });',
    1,
)
s = s.replace(
    '      setFullName(""); setUsername(""); setRole("membro");',
    '      setFullName(""); setUsername(""); setRole("membro"); setOperationalArea("invoices");',
    1,
)
old_role = '<div className="space-y-2"><Label>Tipo de acesso</Label><Select value={role} onValueChange={(value) => setRole(value as Role)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="membro">Membro</SelectItem>{currentRole !== "gestora" && <><SelectItem value="gestora">Gestora</SelectItem><SelectItem value="ceo">CEO</SelectItem></>}</SelectContent></Select></div>'
new_role = '<div className="space-y-2"><Label>Tipo de acesso</Label><Select value={role} onValueChange={(value) => setRole(value as Role)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="membro">Membro</SelectItem>{currentRole !== "gestora" && <><SelectItem value="gestora">Gestora</SelectItem><SelectItem value="ceo">CEO</SelectItem></>}</SelectContent></Select></div>{role === "membro" && <div className="space-y-2"><Label>Rotina da pessoa</Label><Select value={operationalArea} onValueChange={(value) => setOperationalArea(value as OperationalArea)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="reminders">Lembretes D-1</SelectItem><SelectItem value="collections">Régua de cobrança</SelectItem><SelectItem value="invoices">Notas fiscais</SelectItem></SelectContent></Select><p className="text-xs leading-5 text-[#87928c]">Essa escolha define as telas da lateral. D-1 e cobrança também definem a pessoa responsável nas unidades selecionadas quando o acesso for ativado.</p></div>}'
if old_role not in s:
    raise SystemExit('Seletor de tipo de acesso não encontrado')
s = s.replace(old_role, new_role, 1)

# Remove cards de integrações futuras e onboarding já ultrapassado.
start = '  const secondaryCards = ['
end = '  return <div className="space-y-5">'
if start in s:
    before, rest = s.split(start, 1)
    _, after = rest.split(end, 1)
    s = before + end + after

future_section = '    <section className="grid gap-4 lg:grid-cols-2">{secondaryCards.map((item) => <article key={item.name} className="surface-card rounded-[24px] p-6"><div className="flex items-start justify-between gap-4"><div className="grid size-12 place-items-center rounded-2xl" style={{ background: item.accent, color: item.color }}><item.icon className="size-5" /></div><Badge variant="outline" className="text-[10px]">{item.status}</Badge></div><h3 className="font-display mt-6 text-xl font-semibold text-[#1c2c23]">{item.name}</h3><p className="mt-2 min-h-12 text-sm leading-6 text-[#718078]">{item.description}</p><div className="mt-6 border-t border-[#edf0ed] pt-4"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#909a94]">Próximo passo</p><p className="mt-2 text-sm font-medium text-[#405148]">{item.next}</p></div></article>)}</section>\n'
s = s.replace(future_section, '', 1)
order_section = '    <section className="surface-card rounded-[24px] p-6"><div className="flex items-start gap-4"><div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#fff2d9] text-[#946814]"><ShieldCheck /></div><div><h3 className="font-display text-lg font-semibold">Ordem segura de ativação</h3><p className="mt-1 text-sm leading-6 text-[#718078]">1. Cadastrar os dois acessos em segredo → 2. Validar cada assinatura → 3. Ler uma amostra sem gravar → 4. Aprovar o mapeamento → 5. Ativar a sincronização automática.</p></div></div></section>\n'
s = s.replace(order_section, '', 1)

# Remova microcopy genérica em cards de gestão.
s = s.replace('<span className="text-xs font-medium text-[#87928c]">BASE REAL</span>', '', 1)
s = s.replace('description="Obrigações que pedem uma ação da equipe."', 'description="Abra a obrigação para conferir o que precisa ser feito."', 1)

# Jornada: Maria vê apenas a sua rotina, gestão vê o fluxo inteiro.
s = s.replace(
    '{view === "journey" && allowedViews.has("journey") && <FinancialJourney unit={unit} />}',
    '{view === "journey" && allowedViews.has("journey") && <FinancialJourney unit={unit} mode={currentUser.operationalArea === "reminders" ? "reminders" : "management"} />}',
    1,
)

app.write_text(s, encoding='utf-8')

journey = Path('components/financial-journey.tsx')
j = journey.read_text(encoding='utf-8')
j = j.replace(
    'type FinancialJourneyProps = {\n  unit: string;\n};',
    'type FinancialJourneyProps = {\n  unit: string;\n  mode?: "reminders" | "management";\n};',
    1,
)
j = j.replace(
    'export function FinancialJourney({ unit }: FinancialJourneyProps) {',
    'export function FinancialJourney({ unit, mode = "management" }: FinancialJourneyProps) {',
    1,
)
old_metrics = '''      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <JourneyMetric label="Vencidas" value={overdue} detail="Pedem ação" />
        <JourneyMetric label="Para hoje" value={todayCount} detail="Na agenda" />
        <JourneyMetric label="Lembretes D-1" value={reminderCount} detail="Maria Eduarda" />
        <JourneyMetric label="Em cobrança" value={collectionCount} detail="Daiane" />
      </section>'''
new_metrics = '''      <section className={`grid gap-4 sm:grid-cols-2 ${mode === "reminders" ? "xl:grid-cols-3" : "xl:grid-cols-4"}`}>
        <JourneyMetric label="Vencidas" value={overdue} detail="Faça primeiro" />
        <JourneyMetric label="Para hoje" value={todayCount} detail="Faça em seguida" />
        <JourneyMetric label="Lembretes D-1" value={reminderCount} detail="Sua fila" />
        {mode === "management" && <JourneyMetric label="Em cobrança" value={collectionCount} detail="Régua da Daiane" />}
      </section>'''
if old_metrics not in j:
    raise SystemExit('Métricas da jornada não encontradas')
j = j.replace(old_metrics, new_metrics, 1)

flow_open = '      <section className="surface-card rounded-[24px] p-5 md:p-6">\n        <div className="flex items-start gap-3">'
flow_close = '      </section>\n\n      <section className="surface-card overflow-hidden rounded-[24px]">'
if flow_open not in j or flow_close not in j:
    raise SystemExit('Fluxo da jornada não encontrado')
pre, rest = j.split(flow_open, 1)
flow_body, post = rest.split(flow_close, 1)
flow_section = flow_open + flow_body + '      </section>\n'
replacement = '''      {mode === "management" ? <>
''' + flow_section + '''      </> : <section className="surface-card rounded-[24px] p-5 md:p-6">
        <p className="eyebrow">LEMBRETE D-1</p>
        <h3 className="font-display mt-2 text-xl font-semibold text-[#192820]">Como concluir sua tarefa</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl bg-[#fafbf8] p-4"><p className="text-xs font-bold text-[#71847a]">1. CONFIRA</p><p className="mt-2 text-sm leading-6 text-[#65736b]">Abra a tarefa e confirme paciente, unidade e vencimento do boleto.</p></div>
          <div className="rounded-2xl bg-[#fafbf8] p-4"><p className="text-xs font-bold text-[#71847a]">2. FAÇA O CONTATO</p><p className="mt-2 text-sm leading-6 text-[#65736b]">Envie o lembrete pelo canal definido pela clínica.</p></div>
          <div className="rounded-2xl bg-[#fafbf8] p-4"><p className="text-xs font-bold text-[#71847a]">3. CONCLUA</p><p className="mt-2 text-sm leading-6 text-[#65736b]">Marque a tarefa como concluída somente depois de fazer o contato.</p></div>
        </div>
      </section>}

      <section className="surface-card overflow-hidden rounded-[24px]">'''
j = pre + replacement + post
journey.write_text(j, encoding='utf-8')

# access-admin recebe e grava a rotina escolhida.
access = Path('supabase/functions/access-admin/index.ts')
a = access.read_text(encoding='utf-8')
a = a.replace(
    '    const role = body.role ?? "membro";\n    const fullName = String(body.fullName ?? "").trim();',
    '    const role = body.role ?? "membro";\n    const requestedOperationalArea = String(body.operationalArea ?? "");\n    const operationalArea = role === "membro" ? requestedOperationalArea : "management";\n    const fullName = String(body.fullName ?? "").trim();',
    1,
)
a = a.replace(
    '    if (fullName.length < 2 || fullName.length > 120 || !["membro", "gestora", "ceo"].includes(role) || username === "suporte" || (actor.role === "gestora" && role !== "membro")) return json({ ok: false, message: "Você não pode criar este tipo de acesso." }, 403);',
    '    if (fullName.length < 2 || fullName.length > 120 || !["membro", "gestora", "ceo"].includes(role) || username === "suporte" || (actor.role === "gestora" && role !== "membro")) return json({ ok: false, message: "Você não pode criar este tipo de acesso." }, 403);\n    if (role === "membro" && !["reminders", "collections", "invoices"].includes(operationalArea)) return json({ ok: false, message: "Escolha a rotina que esta pessoa vai executar no LYVRA." }, 400);',
    1,
)
a = a.replace(
    'const { data: invitation, error: insertError } = await admin.from("staff_invitations").insert({ email, full_name: fullName, role, username, recovery_unit_id: recoveryUnit.id, invited_by: user.id, status: "pending", expires_at:',
    'const { data: invitation, error: insertError } = await admin.from("staff_invitations").insert({ email, full_name: fullName, role, operational_area: operationalArea, username, recovery_unit_id: recoveryUnit.id, invited_by: user.id, status: "pending", expires_at:',
    1,
)
access.write_text(a, encoding='utf-8')
