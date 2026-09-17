from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'marker not found: {label}')
    return text.replace(old, new, 1)


def replace_between(text: str, start_marker: str, end_marker: str, replacement: str, label: str) -> str:
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f'start marker not found: {label}')
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f'end marker not found: {label}')
    return text[:start] + replacement + text[end:]


# -----------------------------------------------------------------------------
# 1) Parser da planilha de NF: cada aba mensal vira uma obrigação fiscal real.
# -----------------------------------------------------------------------------
path = Path('lib/nf-workbook.ts')
s = path.read_text(encoding='utf-8')

s = replace_once(
    s,
    '  recordType: "financial_plan" | "patient_directory";\n',
    '  recordType: "financial_plan" | "patient_directory" | "invoice_record";\n',
    'record type',
)
s = replace_once(
    s,
    '  invoiceIssuedAmountCents?: number | null;\n',
    '  invoiceIssuedAmountCents?: number | null;\n  invoicePeriodAmountCents?: number | null;\n  paymentReceivedDate?: string | null;\n  competence?: string | null;\n  competenceStart?: string | null;\n  invoiceRecordKey?: string | null;\n',
    'invoice record fields',
)

competence_helper = r'''function competenceFromSheetName(sheetName: string) {
  const raw = text(sheetName);
  const numeric = raw.match(/\b(0?[1-9]|1[0-2])\s*[-/]\s*(20\d{2})\b/);
  if (numeric) {
    const month = Number(numeric[1]);
    const year = Number(numeric[2]);
    return {
      start: `${year}-${String(month).padStart(2, "0")}-01`,
      label: `${String(month).padStart(2, "0")}/${year}`,
    };
  }

  const yearMatch = raw.match(/\b(20\d{2})\b/);
  if (!yearMatch) return null;
  const year = Number(yearMatch[1]);
  const key = normalize(raw);
  const months: Array<[string, number]> = [
    ["janeiro", 1], ["fevereiro", 2], ["marco", 3], ["abril", 4],
    ["maio", 5], ["junho", 6], ["julho", 7], ["agosto", 8],
    ["setembro", 9], ["outubro", 10], ["novembro", 11], ["dezembro", 12],
  ];
  const found = months.find(([name]) => key.includes(name));
  if (!found) return null;
  const month = found[1];
  return {
    start: `${year}-${String(month).padStart(2, "0")}-01`,
    label: `${String(month).padStart(2, "0")}/${year}`,
  };
}

'''
s = replace_once(s, 'function legacyNote(\n', competence_helper + 'function legacyNote(\n', 'competence helper')

legacy_block = r'''function parseLegacyBlock(
  sheetName: string,
  rows: unknown[][],
  headerIndex: number,
  offset: number,
  paymentMethod: "Cartão" | "Boleto",
  sourceSystem: "Clinicorp",
  fileUnit: string,
  XLSX: typeof import("xlsx"),
) {
  const parsed: ParsedNfPatient[] = [];
  const competence = competenceFromSheetName(sheetName);

  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const rawName = text(row[offset]);
    if (!rawName || isPatientHeader(rawName)) continue;
    if (/\b(?:pago|paga|quitado|quitada)\b/i.test(rawName)) continue;
    const key = normalize(rawName);
    if (!key || key.startsWith("total") || key.startsWith("soma")) continue;

    const name = cleanLegacyPatientName(rawName);
    if (name.length < 2) continue;

    const invoiceStatus = text(row[offset + 3]).toUpperCase() || null;
    const amount = moneyNumber(row[offset + 2]);
    const amountCents = amount !== null ? Math.max(Math.round(amount * 100), 0) : 0;
    const paymentReceivedDate = parseDate(row[offset + 1], XLSX);
    const invoiceIssuedDate = parseDate(row[offset + 4], XLSX);
    const note = legacyNote(sourceSystem, paymentMethod, row, offset, sheetName);
    const unit = fileUnit || detectUnit(note);
    const review: string[] = [];
    if (!competence) review.push("competência da aba não identificada");

    const invoiceRecordKey = [
      "nf-workbook-record",
      normalize(name),
      normalize(unit || "sem-unidade"),
      competence?.start?.slice(0, 7) ?? normalize(sheetName),
      paymentMethod === "Boleto" ? "boleto" : "card",
    ].join("|");

    parsed.push({
      name,
      unit,
      paymentMethod,
      sourceSystem,
      recordType: "invoice_record",
      planAmountCents: 0,
      installmentAmountCents: 0,
      installments: null,
      startDate: null,
      endDate: null,
      dueDay: null,
      taxReceiptIr: true,
      invoiceScheduleMode: "automatic",
      invoiceIntervalMonths: 12,
      invoiceStatus,
      invoiceIssuedDate,
      invoiceIssuedAmountCents: amountCents || null,
      invoicePeriodAmountCents: amountCents,
      paymentReceivedDate,
      competence: competence?.label ?? null,
      competenceStart: competence?.start ?? null,
      invoiceRecordKey,
      invoiceRecipientName: null,
      invoiceDisabled: false,
      invoiceDisabledReason: null,
      notes: note,
      source: "import",
      importKey: invoiceRecordKey,
      sourceSheet: sheetName,
      sourceRow: index + 1,
      reviewReason: review.length ? review.join(", ") : null,
    });
  }

  return parsed;
}

'''
s = replace_between(s, 'function parseLegacyBlock(\n', 'function mergeDirectoryRows(', legacy_block, 'legacy block')
s = s.replace('parseLegacyBlock(sheetName, rows, legacyHeaderIndex, 0, "Boleto", "Clinicorp", fileUnit)', 'parseLegacyBlock(sheetName, rows, legacyHeaderIndex, 0, "Boleto", "Clinicorp", fileUnit, XLSX)')
s = s.replace('parseLegacyBlock(sheetName, rows, legacyHeaderIndex, 7, "Cartão", "Clinicorp", fileUnit)', 'parseLegacyBlock(sheetName, rows, legacyHeaderIndex, 7, "Cartão", "Clinicorp", fileUnit, XLSX)')

old_ready = '''  const readyCount = mergedRows.filter((row) => (\n    row.recordType === "patient_directory"\n      ? Boolean(row.name)\n      : !row.reviewReason && Boolean(row.startDate) && Boolean(row.installments) && row.installmentAmountCents > 0\n  )).length;'''
new_ready = '''  const readyCount = mergedRows.filter((row) => {\n    if (!row.name) return false;\n    if (row.recordType === "patient_directory") return true;\n    if (row.recordType === "invoice_record") return Boolean(row.competenceStart);\n    return !row.reviewReason && Boolean(row.startDate) && Boolean(row.installments) && row.installmentAmountCents > 0;\n  }).length;'''
s = replace_once(s, old_ready, new_ready, 'ready count')
path.write_text(s, encoding='utf-8')


# -----------------------------------------------------------------------------
# 2) Importador de NF: não ignora quitados, não bloqueia lote inteiro e grava
#    obrigações mensais no RPC fiscal.
# -----------------------------------------------------------------------------
path = Path('components/nf-workbook-import.tsx')
s = path.read_text(encoding='utf-8')
s = s.replace('const patientKey = (value: string) => value.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");\n', '')

old_blocking = '''const financialBlocking = (row: ParsedNfPatient) => row.recordType === "patient_directory"\n  ? !row.name\n  : !row.name || !row.startDate || !row.installments || row.installmentAmountCents <= 0;'''
new_blocking = '''const financialBlocking = (row: ParsedNfPatient) => {\n  if (!row.name) return true;\n  if (row.recordType === "patient_directory") return false;\n  if (row.recordType === "invoice_record") return !row.competenceStart;\n  return !row.startDate || !row.installments || row.installmentAmountCents <= 0;\n};'''
s = replace_once(s, old_blocking, new_blocking, 'financial blocking')

old_parse = '''    try {\n      const result = await parseNfWorkbook(file);\n      const supabase = getSupabaseBrowserClient();\n      const settledResult = await (supabase as any).from("patients").select("full_name,cpf").not("settled_at", "is", null);\n      if (settledResult.error) throw settledResult.error;\n      const settledNames = new Set(((settledResult.data ?? []) as any[]).map((item) => patientKey(String(item.full_name ?? ""))));\n      const settledCpfs = new Set(((settledResult.data ?? []) as any[]).map((item) => String(item.cpf ?? "").replace(/\\D/g, "")).filter(Boolean));\n      const filteredRows = result.rows.filter((row) => !(settledNames.has(patientKey(row.name)) || (row.cpf && settledCpfs.has(String(row.cpf).replace(/\\D/g, "")))));\n      const ignored = result.rows.length - filteredRows.length;\n      setRows(filteredRows); setSheetNames(result.sheets);\n      if (ignored) toast.info(`${ignored} paciente(s) quitado(s) foram ignorados`, { description: "Uma planilha antiga não reativa quem já foi marcado como quitado no LYVRA." });\n    } catch (error) {'''
new_parse = '''    try {\n      const result = await parseNfWorkbook(file);\n      setRows(result.rows);\n      setSheetNames(result.sheets);\n    } catch (error) {'''
s = replace_once(s, old_parse, new_parse, 'settled filter removal')

old_counts = '''  const blocking = rows.filter(financialBlocking);\n  const unitPending = rows.filter((row) => !financialBlocking(row) && !row.unit);\n  const ready = rows.filter((row) => !financialBlocking(row) && Boolean(row.unit));\n  const warnings = ready.filter((row) => Boolean(row.reviewReason));'''
new_counts = '''  const blocking = rows.filter(financialBlocking);\n  const unitPending = rows.filter((row) => Boolean(row.name) && !row.unit);\n  const ready = rows.filter((row) => Boolean(row.name) && Boolean(row.unit));\n  const warnings = ready.filter((row) => Boolean(row.reviewReason) || financialBlocking(row));'''
s = replace_once(s, old_counts, new_counts, 'import counters')
s = s.replace('.filter((row) => !financialBlocking(row))\n        .map((row) => `${row.sourceSheet}::${row.sourceRow}`)', '.filter((row) => Boolean(row.name))\n        .map((row) => `${row.sourceSheet}::${row.sourceRow}`)', 1)

submit_replacement = r'''  const submit = async () => {
    if (!ready.length) return;

    setImporting(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const grouped = new Map<string, ParsedNfPatient[]>();

      for (const row of ready) {
        const unitCode = row.unit === "Salto de Pirapora" ? "salto_de_pirapora" : "sorocaba";
        grouped.set(unitCode, [...(grouped.get(unitCode) ?? []), row]);
      }

      let created = 0;
      let updated = 0;
      let errors = 0;
      type ImportResult = { imported_count?: number; updated_count?: number; error_count?: number };
      type RpcResponse = { data: ImportResult[] | null; error: { message: string } | null };
      const callImportRpc = supabase.rpc.bind(supabase) as unknown as (fn: string, args: Record<string, unknown>) => Promise<RpcResponse>;

      const runBatches = async (fn: string, unitCode: string, unitRows: ParsedNfPatient[], batchSize: number, fallbackName: string) => {
        for (let offset = 0; offset < unitRows.length; offset += batchSize) {
          const batch = unitRows.slice(offset, offset + batchSize);
          const { data, error } = await callImportRpc(fn, {
            p_unit_code: unitCode,
            p_file_name: fileName || fallbackName,
            p_rows: JSON.parse(JSON.stringify(batch)),
          });
          if (error) throw new Error(error.message);
          const result = data?.[0];
          created += result?.imported_count ?? 0;
          updated += result?.updated_count ?? 0;
          errors += result?.error_count ?? 0;
        }
      };

      for (const [unitCode, unitRows] of grouped) {
        const planRows = unitRows.filter((row) => row.recordType === "financial_plan");
        const invoiceRows = unitRows.filter((row) => row.recordType === "invoice_record");
        const directoryRows = unitRows.filter((row) => row.recordType === "patient_directory");

        if (planRows.length) await runBatches("import_patients", unitCode, planRows, 10, "planilha NF");
        if (invoiceRows.length) await runBatches("import_invoice_workbook_records", unitCode, invoiceRows, 50, "planilha mensal de NF");
        if (directoryRows.length) await runBatches("import_patient_directory", unitCode, directoryRows, 25, "planilha de pacientes");
      }

      const notSent = unitPending.length + rows.filter((row) => !row.name).length;
      if (errors || notSent) {
        toast.warning(`${created + updated} registro(s) processado(s)`, {
          description: `${errors} linha(s) ficaram registradas para revisão e ${notSent} ainda precisam de nome/unidade antes do envio. Nenhuma linha enviada foi descartada silenciosamente.`,
        });
      } else {
        toast.success(`${created + updated} registro(s) processado(s)`, {
          description: `${created} novo(s) e ${updated} atualizado(s). As abas mensais agora alimentam a tela de Notas Fiscais pela competência correta.`,
        });
      }
      await onImported();
    } catch (error) {
      toast.error("Importação não concluída", {
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
    } finally {
      setImporting(false);
    }
  };

'''
s = replace_between(s, '  const submit = async () => {\n', '  return <div className="space-y-5">', submit_replacement, 'submit importer')

s = s.replace('Planos detalhados geram parcelas/NFs; planilhas mensais cadastram o paciente sem inventar parcelamento.', 'Planos detalhados geram parcelas. Abas mensais geram obrigações de NF por competência, sem inventar parcelamento.')
s = s.replace('<CheckLine>Recalcula término, parcelas anuais e NF</CheckLine>', '<CheckLine>Abas mensais viram competências reais de NF</CheckLine>')
s = s.replace('{financialBlocking(row) ? <span className="text-xs text-[#a0a8a3]">Defina após corrigir os dados</span> : <Select value={row.unit || undefined} onValueChange={(value) => setRowUnit(row, value)}>', '{!row.name ? <span className="text-xs text-[#a0a8a3]">Nome não identificado</span> : <Select value={row.unit || undefined} onValueChange={(value) => setRowUnit(row, value)}>')
s = s.replace('''                  <TableCell>{row.recordType === "patient_directory"
                    ? <><p className="font-medium text-[#405148]">Cadastro de paciente</p><p className="mt-1 text-xs text-[#87928c]">Sem inventar parcelamento</p></>
                    : <><p>{row.installments ? `${row.installments}x de ${money(row.installmentAmountCents)}` : "Incompleto"}</p><p className="mt-1 text-xs text-[#87928c]">{row.startDate || "Sem data inicial"}</p></>}</TableCell>''', '''                  <TableCell>{row.recordType === "patient_directory"
                    ? <><p className="font-medium text-[#405148]">Cadastro de paciente</p><p className="mt-1 text-xs text-[#87928c]">Sem inventar parcelamento</p></>
                    : row.recordType === "invoice_record"
                      ? <><p className="font-medium text-[#405148]">NF {row.competence || row.sourceSheet}</p><p className="mt-1 text-xs text-[#87928c]">{money(row.invoicePeriodAmountCents ?? 0)} • {row.invoiceStatus || "Sem status"}</p></>
                      : <><p>{row.installments ? `${row.installments}x de ${money(row.installmentAmountCents)}` : "Incompleto"}</p><p className="mt-1 text-xs text-[#87928c]">{row.startDate || "Sem data inicial"}</p></>}</TableCell>''')
s = s.replace('''            {unitPending.length > 0 && <p><strong>{unitPending.length} paciente(s) válido(s) ainda precisam de unidade.</strong> O botão de importação fica bloqueado até separar Sorocaba e Salto.</p>}
            {blocking.length > 0 && <p className={unitPending.length ? "mt-1" : ""}><strong>{blocking.length} linha(s) com dados financeiros incompletos</strong> serão ignoradas na importação.</p>}''', '''            {unitPending.length > 0 && <p><strong>{unitPending.length} registro(s) ainda precisam de unidade.</strong> Os registros já identificados podem ser importados sem bloquear o lote inteiro.</p>}
            {blocking.length > 0 && <p className={unitPending.length ? "mt-1" : ""}><strong>{blocking.length} linha(s) precisam de revisão.</strong> Quando tiverem nome e unidade, elas são enviadas e ficam registradas no relatório, mesmo se algum dado fiscal estiver incompleto.</p>}''')
s = s.replace('<p className="text-sm text-[#65736b]">{unitPending.length ? "Separe as unidades para continuar." : blocking.length ? `${ready.length} paciente(s) prontos; ${blocking.length} linha(s) incompleta(s) serão ignoradas.` : "Todas as unidades estão definidas. Pronto para importar."}</p>', '<p className="text-sm text-[#65736b]">{unitPending.length ? `${ready.length} registro(s) podem ser processados agora; ${unitPending.length} aguardam unidade.` : "Os registros identificados estão prontos para processamento."}</p>')
s = s.replace('<Button disabled={importing || !ready.length || unitPending.length > 0} onClick={() => void submit()}', '<Button disabled={importing || !ready.length} onClick={() => void submit()}')
s = s.replace('Importar {ready.length} pacientes', 'Importar {ready.length} registros')
s = s.replace('O valor total, término do parcelamento, quantidade de parcelas no ano, valor da NF e data prevista passam a ser calculados pelo próprio LYVRA.', 'Planos detalhados continuam calculados pelo LYVRA. Nas planilhas mensais, competência, valor e status da NF são preservados como informação fiscal, sem criar um parcelamento fictício.')
path.write_text(s, encoding='utf-8')


# -----------------------------------------------------------------------------
# 3) App principal: dashboard e NF usam a mesma competência; lembretes respeitam
#    unidade e o card deixa de misturar períodos.
# -----------------------------------------------------------------------------
path = Path('components/lyvra-app.tsx')
s = path.read_text(encoding='utf-8')
s = s.replace('import { useCallback, useEffect, useRef, useState } from "react";', 'import { useCallback, useEffect, useMemo, useRef, useState } from "react";', 1)
s = replace_once(s, '  issuedAt?: string | null;\n};', '  issuedAt?: string | null;\n  periodStart?: string | null;\n  periodEnd?: string | null;\n  sourceType?: string | null;\n};', 'obligation period fields')
s = replace_once(s, '  const [reminderCount, setReminderCount] = useState(0);', '  const [reminderCounts, setReminderCounts] = useState<Record<string, number>>({ todas: 0, sorocaba: 0, salto: 0 });', 'reminder state')

load_start = s.index('      const tomorrow = new Date();', s.index('const loadFinancialData'))
load_end_marker = '      if (firstError) throw firstError;\n'
load_end = s.index(load_end_marker, load_start) + len(load_end_marker)
new_load_head = r'''      const todayKey = saoPauloDate(new Date());
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
'''
s = s[:load_start] + new_load_head + s[load_end:]

s = replace_once(s, '          issuedAt: row.invoice_issued_at ?? null,\n', '          issuedAt: row.invoice_issued_at ?? null,\n          periodStart: row.period_start ?? null,\n          periodEnd: row.period_end ?? null,\n          sourceType: row.source_type ?? null,\n', 'obligation mapper')
old_reminder_set = '      setReminderCount(reminderResult.count ?? 0);'
new_reminder_set = '''      const unitCodeById = new Map(((unitResult.data ?? []) as any[]).map((item) => [Number(item.id), String(item.code)]));\n      const reminderRows = (reminderResult.data ?? []) as any[];\n      const nextReminderCounts: Record<string, number> = { todas: reminderRows.length, sorocaba: 0, salto: 0 };\n      for (const row of reminderRows) {\n        const code = unitCodeById.get(Number(row.unit_id));\n        if (code === "sorocaba") nextReminderCounts.sorocaba += 1;\n        if (code === "salto_de_pirapora") nextReminderCounts.salto += 1;\n      }\n      setReminderCounts(nextReminderCounts);'''
s = replace_once(s, old_reminder_set, new_reminder_set, 'reminder counters')
s = s.replace('      setReminderCount(0);', '      setReminderCounts({ todas: 0, sorocaba: 0, salto: 0 });', 1)
s = s.replace('<DashboardView unit={unit} obligations={obligations} reminderCount={reminderCount} goTo={setView} />', '<DashboardView unit={unit} obligations={obligations} reminderCount={reminderCounts[unit] ?? reminderCounts.todas} goTo={setView} />', 1)

new_dashboard_invoices = r'''const obligationMonthKey = (item: InvoiceObligation) => {
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

'''
s = replace_between(s, 'function DashboardView(', 'type SettlementStatusRow = {', new_dashboard_invoices, 'dashboard and invoices')
s = s.replace('|| (statusFilter === "active" ? !patient.settledAt : false);', '|| (statusFilter === "active" ? !patient.settledAt && state?.settlement_state !== "requested" : false);', 1)
s = s.replace('onIssued&&item.tone==="ready"?', 'onIssued&&["ready","open"].includes(item.rawStatus)?', 1)
s = s.replace('>Emitir</Button>', '>Marcar emitida</Button>', 1)

old_activity = '''function ActivityCard() {\n  return <div className="surface-card rounded-[24px] p-5 md:p-6"><p className="eyebrow">ATIVIDADE</p><h3 className="font-display mt-2 text-lg font-semibold">Movimentações recentes</h3><div className="mt-5 grid min-h-24 place-items-center rounded-2xl border border-dashed border-[#dfe6df] px-4 text-center"><p className="text-sm leading-6 text-[#7d8982]">Nenhuma movimentação financeira registrada.</p></div></div>;\n}'''
new_activity = '''function ActivityCard({ obligations }: { obligations: InvoiceObligation[] }) {\n  const issued = obligations.filter((item) => item.rawStatus === "issued").length;\n  const pending = obligations.filter((item) => !["issued", "cancelled"].includes(item.rawStatus)).length;\n  const amount = obligations.reduce((sum, item) => sum + item.amountValue, 0);\n  return <div className="surface-card rounded-[24px] p-5 md:p-6"><p className="eyebrow">RESUMO DA COMPETÊNCIA</p><h3 className="font-display mt-2 text-lg font-semibold">Leitura do período</h3><div className="mt-5 grid grid-cols-2 gap-3 text-sm"><div className="rounded-2xl bg-[#f7f9f6] p-4"><p className="text-xs text-[#7d8982]">Emitidas</p><p className="mt-1 text-xl font-semibold text-[#26372e]">{issued}</p></div><div className="rounded-2xl bg-[#f7f9f6] p-4"><p className="text-xs text-[#7d8982]">Pendentes</p><p className="mt-1 text-xl font-semibold text-[#26372e]">{pending}</p></div></div><p className="mt-4 text-xs text-[#849087]">Valor total registrado na competência: <strong>{moneyValue(amount)}</strong></p></div>;\n}'''
s = replace_once(s, old_activity, new_activity, 'activity card')
path.write_text(s, encoding='utf-8')


# -----------------------------------------------------------------------------
# 4) Jornada financeira: pagina todos os registros, e filtra a unidade no banco
#    antes de montar os indicadores.
# -----------------------------------------------------------------------------
path = Path('components/financial-journey.tsx')
s = path.read_text(encoding='utf-8')
new_load = r'''  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const supabase = getSupabaseBrowserClient();
    try {
      const [unitResult, profileResult] = await Promise.all([
        supabase.from("units").select("id,code,name").eq("is_active", true).order("name"),
        supabase.from("profiles").select("user_id,full_name").eq("is_active", true),
      ]);
      if (unitResult.error) throw unitResult.error;
      if (profileResult.error) throw profileResult.error;

      const unitRows = (unitResult.data ?? []) as UnitRow[];
      const selectedCode = unit === "salto" ? "salto_de_pirapora" : unit;
      const selectedUnit = selectedCode === "todas" ? null : unitRows.find((item) => item.code === selectedCode);
      const taskRows: JourneyTask[] = [];
      const pageSize = 500;

      for (let offset = 0; ; offset += pageSize) {
        let query = supabase
          .from("financial_tasks")
          .select("id,unit_id,title,description,kind,status,due_at,assigned_to")
          .in("status", ["pending", "in_progress"])
          .order("due_at", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (selectedUnit) query = query.eq("unit_id", selectedUnit.id);
        const result = await query;
        if (result.error) throw result.error;
        const page = (result.data ?? []) as JourneyTask[];
        taskRows.push(...page);
        if (page.length < pageSize) break;
      }

      setTasks(taskRows);
      setUnits(unitRows);
      setProfiles((profileResult.data ?? []) as ProfileRow[]);
    } catch (error) {
      toast.error("Não foi possível carregar a jornada financeira", {
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
    } finally {
      if (!silent) setLoading(false);
    }
  }, [unit]);

'''
s = replace_between(s, '  const load = useCallback(async (silent = false) => {\n', '  useEffect(() => {\n    void load();', new_load, 'financial journey load')
path.write_text(s, encoding='utf-8')


# -----------------------------------------------------------------------------
# 5) Régua de cobrança: remove o limite implícito de 1.000 linhas e filtra a
#    unidade antes de paginar.
# -----------------------------------------------------------------------------
path = Path('components/collections-journey-real.tsx')
s = path.read_text(encoding='utf-8')
new_collection_load = r'''  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const selectedCode = unit === "salto" ? "salto_de_pirapora" : unit;
      const pageSize = 500;
      const queueRows: QueueRow[] = [];
      const interactionRows: InteractionRow[] = [];

      for (let offset = 0; ; offset += pageSize) {
        let query = supabase
          .from("collection_queue")
          .select("*")
          .order("eligible_at", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (selectedCode !== "todas") query = query.eq("unit_code", selectedCode);
        const result = await query;
        if (result.error) throw result.error;
        const page = (result.data ?? []) as unknown as QueueRow[];
        queueRows.push(...page);
        if (page.length < pageSize) break;
      }

      for (let offset = 0; ; offset += pageSize) {
        const result = await supabase
          .from("collection_interactions")
          .select("id,collection_case_id,performed_by,channel,outcome,notes,occurred_at,next_action_at")
          .order("occurred_at", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (result.error) throw result.error;
        const page = (result.data ?? []) as unknown as InteractionRow[];
        interactionRows.push(...page);
        if (page.length < pageSize) break;
      }

      const profileResult = await supabase.from("profiles").select("user_id,full_name").eq("is_active", true);
      if (profileResult.error) throw profileResult.error;
      setQueue(queueRows);
      setInteractions(interactionRows);
      setProfiles((profileResult.data ?? []) as unknown as ProfileRow[]);
    } catch (error) {
      toast.error("Não foi possível carregar a régua de cobrança", { description: error instanceof Error ? error.message : "Tente novamente." });
    } finally {
      if (!silent) setLoading(false);
    }
  }, [unit]);

'''
s = replace_between(s, '  const load = useCallback(async (silent = false) => {\n', '  useEffect(() => { void load(); }, [load]);', new_collection_load, 'collection load')
path.write_text(s, encoding='utf-8')


# -----------------------------------------------------------------------------
# 6) Sino de notificações: o filtro de unidade acontece antes do limite e o
#    contador usa a contagem real do banco.
# -----------------------------------------------------------------------------
path = Path('components/financial-notifications.tsx')
s = path.read_text(encoding='utf-8')
s = replace_once(s, '  const [loading, setLoading] = useState(false);', '  const [loading, setLoading] = useState(false);\n  const [totalCount, setTotalCount] = useState(0);', 'notification count state')
new_notification_load = r'''  const load = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const unitResult = await supabase.from("units").select("id,code,name").eq("is_active", true);
      if (unitResult.error) throw unitResult.error;
      const unitRows = (unitResult.data ?? []) as UnitRow[];
      const selectedCode = unit === "salto" ? "salto_de_pirapora" : unit;
      const selectedUnit = selectedCode === "todas" ? null : unitRows.find((item) => item.code === selectedCode);

      let listQuery = supabase
        .from("financial_tasks")
        .select("id,unit_id,title,description,kind,status,due_at,assigned_to")
        .eq("assigned_to", userId)
        .in("status", ["pending", "in_progress"])
        .order("due_at", { ascending: true })
        .limit(50);
      let countQuery = supabase
        .from("financial_tasks")
        .select("id", { count: "exact", head: true })
        .eq("assigned_to", userId)
        .in("status", ["pending", "in_progress"]);
      if (selectedUnit) {
        listQuery = listQuery.eq("unit_id", selectedUnit.id);
        countQuery = countQuery.eq("unit_id", selectedUnit.id);
      }

      const [taskResult, countResult] = await Promise.all([listQuery, countQuery]);
      if (taskResult.error) throw taskResult.error;
      if (countResult.error) throw countResult.error;
      setTasks((taskResult.data ?? []) as FinancialTask[]);
      setUnits(unitRows);
      setTotalCount(countResult.count ?? taskResult.data?.length ?? 0);
    } catch {
      setTasks([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [unit, userId]);

'''
s = replace_between(s, '  const load = useCallback(async () => {\n', '  useEffect(() => {\n    void load();', new_notification_load, 'notifications load')
s = s.replace('<Badge variant="secondary">{visible.length}</Badge>', '<Badge variant="secondary">{totalCount}</Badge>', 1)
path.write_text(s, encoding='utf-8')


# -----------------------------------------------------------------------------
# 7) Alerta tipo jumpscare: pagina tarefas vencidas para não ficar preso nas
#    mesmas primeiras 20 para sempre.
# -----------------------------------------------------------------------------
path = Path('components/due-task-alert.tsx')
s = path.read_text(encoding='utf-8')
old_due = '''      const { data, error } = await supabase\n        .from("financial_tasks")\n        .select("id,title,description,due_at,kind")\n        .eq("assigned_to", userId)\n        .in("status", ["pending", "in_progress"])\n        .lte("due_at", new Date().toISOString())\n        .order("due_at", { ascending: true })\n        .limit(20);\n\n      if (error) return;\n      const due = (data ?? []) as DueTask[];\n      const unseen = due.filter((task) => {\n        const key = `lyvra:task-alert:${userId}:${task.id}:${task.due_at}`;\n        return window.localStorage.getItem(key) !== "1";\n      });'''
new_due = '''      const unseen: DueTask[] = [];\n      const pageSize = 100;\n      for (let offset = 0; unseen.length < 20; offset += pageSize) {\n        const { data, error } = await supabase\n          .from("financial_tasks")\n          .select("id,title,description,due_at,kind")\n          .eq("assigned_to", userId)\n          .in("status", ["pending", "in_progress"])\n          .lte("due_at", new Date().toISOString())\n          .order("due_at", { ascending: true })\n          .order("id", { ascending: true })\n          .range(offset, offset + pageSize - 1);\n        if (error) return;\n        const page = (data ?? []) as DueTask[];\n        unseen.push(...page.filter((task) => {\n          const key = `lyvra:task-alert:${userId}:${task.id}:${task.due_at}`;\n          return window.localStorage.getItem(key) !== "1";\n        }));\n        if (page.length < pageSize || offset > 5000) break;\n      }\n      unseen.splice(20);'''
s = replace_once(s, old_due, new_due, 'due alert pagination')
path.write_text(s, encoding='utf-8')


# -----------------------------------------------------------------------------
# 8) Texto da central de importação alinhado ao comportamento real.
# -----------------------------------------------------------------------------
path = Path('components/workbook-import-hub.tsx')
s = path.read_text(encoding='utf-8')
s = s.replace('Importe primeiro a planilha atualizada de pacientes/NF. Depois, use a planilha da régua para trazer o histórico da Dai sem criar pacientes novos.', 'Importe a planilha de pacientes/NF para atualizar cadastro e competências fiscais. A planilha da régua complementa o histórico de cobrança e mantém os registros vinculados à mesma base de pacientes.')
path.write_text(s, encoding='utf-8')

print('LYVRA data-flow audit patches applied')
