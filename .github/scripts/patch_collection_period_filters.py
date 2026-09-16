from pathlib import Path

path = Path('components/collections-journey-real.tsx')
text = path.read_text()

old = '  const [internalSelectedId, setSelectedId] = useState<number | null>(null);\n'
new = '''  const [internalSelectedId, setSelectedId] = useState<number | null>(null);\n  const [dateFrom, setDateFrom] = useState("");\n  const [dateTo, setDateTo] = useState("");\n  const [monthFilter, setMonthFilter] = useState("all");\n  const [yearFilter, setYearFilter] = useState("all");\n  const [quickPeriod, setQuickPeriod] = useState("all");\n'''
if old not in text:
    raise SystemExit('state marker not found')
text = text.replace(old, new, 1)

old = '''  const selectedUnit = useMemo(() => patients.filter((patient) => unit === "todas" || (unit === "sorocaba" ? patient.unit === "Sorocaba" : patient.unit === "Salto de Pirapora")), [patients, unit]);\n  const todayKey = saoPauloDayKey();\n  const now = Date.now();\n\n  const actionable = selectedUnit.filter((patient) => {\n'''
new = '''  const selectedUnit = useMemo(() => patients.filter((patient) => unit === "todas" || (unit === "sorocaba" ? patient.unit === "Sorocaba" : patient.unit === "Salto de Pirapora")), [patients, unit]);\n  const todayKey = saoPauloDayKey();\n  const now = Date.now();\n  const availableYears = useMemo(() => [...new Set(selectedUnit.map((patient) => patient.dueDateIso.slice(0, 4)))].sort((a, b) => b.localeCompare(a)), [selectedUnit]);\n  const periodFiltered = useMemo(() => {\n    let quickStart = "";\n    if (quickPeriod !== "all") {\n      const start = new Date(`${todayKey}T12:00:00-03:00`);\n      start.setDate(start.getDate() - (Number(quickPeriod) - 1));\n      quickStart = saoPauloDayKey(start);\n    }\n    return selectedUnit.filter((patient) => {\n      const due = patient.dueDateIso;\n      if (quickStart && (due < quickStart || due > todayKey)) return false;\n      if (dateFrom && due < dateFrom) return false;\n      if (dateTo && due > dateTo) return false;\n      if (yearFilter !== "all" && due.slice(0, 4) !== yearFilter) return false;\n      if (monthFilter !== "all" && due.slice(5, 7) !== monthFilter) return false;\n      return true;\n    });\n  }, [selectedUnit, quickPeriod, todayKey, dateFrom, dateTo, yearFilter, monthFilter]);\n\n  const clearPeriodFilters = () => {\n    setQuickPeriod("all");\n    setDateFrom("");\n    setDateTo("");\n    setMonthFilter("all");\n    setYearFilter("all");\n  };\n\n  const setQuick = (days: string) => {\n    setQuickPeriod(days);\n    setDateFrom("");\n    setDateTo("");\n    setMonthFilter("all");\n    setYearFilter("all");\n  };\n\n  const actionable = periodFiltered.filter((patient) => {\n'''
if old not in text:
    raise SystemExit('period marker not found')
text = text.replace(old, new, 1)

old = '''    </section>\n\n    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">\n'''
new = '''    </section>\n\n    <section className="surface-card rounded-[24px] p-5 md:p-6">\n      <div className="flex flex-col gap-4">\n        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">\n          <div><div className="flex items-center gap-2"><CalendarClock className="size-4 text-[#00884a]" /><p className="text-sm font-semibold text-[#2d3e34]">Filtrar por vencimento</p></div><p className="mt-1 text-xs text-[#87928c]">Use um período rápido, mês/ano ou escolha as datas exatas.</p></div>\n          <div className="flex flex-wrap gap-2">\n            <Button type="button" size="sm" variant={quickPeriod === "7" ? "default" : "outline"} onClick={() => setQuick("7")} className="rounded-xl">7 dias</Button>\n            <Button type="button" size="sm" variant={quickPeriod === "30" ? "default" : "outline"} onClick={() => setQuick("30")} className="rounded-xl">30 dias</Button>\n            <Button type="button" size="sm" variant={quickPeriod === "90" ? "default" : "outline"} onClick={() => setQuick("90")} className="rounded-xl">90 dias</Button>\n            <Button type="button" size="sm" variant="ghost" onClick={clearPeriodFilters} className="rounded-xl">Limpar</Button>\n          </div>\n        </div>\n        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">\n          <div><Label className="mb-1.5 block text-xs text-[#718078]">De</Label><Input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setQuickPeriod("all"); }} className="h-10 rounded-xl" /></div>\n          <div><Label className="mb-1.5 block text-xs text-[#718078]">Até</Label><Input type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setQuickPeriod("all"); }} className="h-10 rounded-xl" /></div>\n          <div><Label className="mb-1.5 block text-xs text-[#718078]">Mês</Label><Select value={monthFilter} onValueChange={(value) => { setMonthFilter(value); setQuickPeriod("all"); }}><SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos os meses</SelectItem><SelectItem value="01">Janeiro</SelectItem><SelectItem value="02">Fevereiro</SelectItem><SelectItem value="03">Março</SelectItem><SelectItem value="04">Abril</SelectItem><SelectItem value="05">Maio</SelectItem><SelectItem value="06">Junho</SelectItem><SelectItem value="07">Julho</SelectItem><SelectItem value="08">Agosto</SelectItem><SelectItem value="09">Setembro</SelectItem><SelectItem value="10">Outubro</SelectItem><SelectItem value="11">Novembro</SelectItem><SelectItem value="12">Dezembro</SelectItem></SelectContent></Select></div>\n          <div><Label className="mb-1.5 block text-xs text-[#718078]">Ano</Label><Select value={yearFilter} onValueChange={(value) => { setYearFilter(value); setQuickPeriod("all"); }}><SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos os anos</SelectItem>{availableYears.map((year) => <SelectItem key={year} value={year}>{year}</SelectItem>)}</SelectContent></Select></div>\n        </div>\n        <div className="flex flex-wrap items-center gap-2 text-xs text-[#718078]"><Badge variant="secondary">{periodFiltered.length} caso(s) no período</Badge>{dateFrom && <span>De {dateOnly(dateFrom)}</span>}{dateTo && <span>até {dateOnly(dateTo)}</span>}{monthFilter !== "all" && <span>Mês {monthFilter}</span>}{yearFilter !== "all" && <span>Ano {yearFilter}</span>}</div>\n      </div>\n    </section>\n\n    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">\n'''
if old not in text:
    raise SystemExit('filter ui marker not found')
text = text.replace(old, new, 1)

old = '<Tabs defaultValue="today">'
new = '<Tabs defaultValue="all">'
if old not in text:
    raise SystemExit('tabs default marker not found')
text = text.replace(old, new, 1)

old = '<TabsList className="h-10 w-full justify-start overflow-x-auto rounded-xl bg-[#f1f4f0] p-1 md:w-auto"><TabsTrigger value="today" className="rounded-lg px-3">Hoje <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1.5">{today.length}</Badge></TabsTrigger>'
new = '<TabsList className="h-10 w-full justify-start overflow-x-auto rounded-xl bg-[#f1f4f0] p-1 md:w-auto"><TabsTrigger value="all" className="rounded-lg px-3">Todos <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1.5">{actionable.length}</Badge></TabsTrigger><TabsTrigger value="today" className="rounded-lg px-3">Hoje <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1.5">{today.length}</Badge></TabsTrigger>'
if old not in text:
    raise SystemExit('tabs list marker not found')
text = text.replace(old, new, 1)

old = '          <TabsContent value="today" className="m-0"><CollectionTable patients={today} onOpen={setSelectedId} loading={loading} /></TabsContent>\n'
new = '          <TabsContent value="all" className="m-0"><CollectionTable patients={actionable} onOpen={setSelectedId} loading={loading} /></TabsContent>\n          <TabsContent value="today" className="m-0"><CollectionTable patients={today} onOpen={setSelectedId} loading={loading} /></TabsContent>\n'
if old not in text:
    raise SystemExit('tabs content marker not found')
text = text.replace(old, new, 1)

path.write_text(text)
