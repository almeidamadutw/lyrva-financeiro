"use client";

import { useMemo, useRef, useState } from "react";
import { AlertCircle, Check, Database, FileSpreadsheet, LoaderCircle, Search, ShieldCheck, UploadCloud } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { parseNfWorkbook, type ParsedNfPatient } from "@/lib/nf-workbook";

type Props = { onImported: () => Promise<void> };

const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const financialBlocking = (row: ParsedNfPatient) => !row.name || !row.startDate || !row.installments || row.installmentAmountCents <= 0;
const needsReview = (row: ParsedNfPatient) => financialBlocking(row) || !row.unit;

export function NfWorkbookImportView({ onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ParsedNfPatient[]>([]);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [parseError, setParseError] = useState("");
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState("");
  const [onlyMissingUnit, setOnlyMissingUnit] = useState(false);

  const parseFile = async (file: File) => {
    setParseError("");
    setRows([]);
    setSearch("");
    setOnlyMissingUnit(false);
    setFileName(file.name);
    try {
      const result = await parseNfWorkbook(file);
      setRows(result.rows);
      setSheetNames(result.sheets);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "Não foi possível ler a planilha.");
    }
  };

  const blocking = rows.filter(financialBlocking);
  const unitPending = rows.filter((row) => !financialBlocking(row) && !row.unit);
  const ready = rows.filter((row) => !financialBlocking(row) && Boolean(row.unit));
  const warnings = ready.filter((row) => Boolean(row.reviewReason));

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows
      .filter((row) => {
        if (onlyMissingUnit && (row.unit || financialBlocking(row))) return false;
        if (!term) return true;
        return `${row.name} ${row.sourceSheet} ${row.paymentMethod}`.toLowerCase().includes(term);
      })
      .sort((a, b) => Number(Boolean(a.unit)) - Number(Boolean(b.unit)));
  }, [rows, search, onlyMissingUnit]);

  const setRowUnit = (row: ParsedNfPatient, unit: string) => {
    setRows((current) => current.map((item) => (
      item.sourceSheet === row.sourceSheet && item.sourceRow === row.sourceRow
        ? { ...item, unit }
        : item
    )));
  };

  const submit = async () => {
    if (!ready.length) return;
    if (unitPending.length) {
      toast.error("Ainda existem pacientes sem unidade", {
        description: `Defina Sorocaba ou Salto de Pirapora para ${unitPending.length} paciente(s) antes de importar.`,
      });
      return;
    }

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
      for (const [unitCode, unitRows] of grouped) {
        const { data, error } = await supabase.rpc("import_patients", {
          p_unit_code: unitCode,
          p_file_name: fileName || "planilha NF",
          p_rows: JSON.parse(JSON.stringify(unitRows)),
        });
        if (error) throw error;
        const result = data?.[0];
        created += result?.imported_count ?? 0;
        updated += result?.updated_count ?? 0;
        errors += result?.error_count ?? 0;
      }

      if (errors) {
        toast.warning(`${created + updated} pacientes processados`, {
          description: `${errors} linha(s) ficaram no relatório de importação para revisão.`,
        });
      } else {
        toast.success(`${created + updated} pacientes processados`, {
          description: `${created} novo(s), ${updated} atualizado(s). As parcelas e NFs foram recalculadas pelo LYVRA.`,
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

  return <div className="space-y-5">
    <section className="grid gap-5 xl:grid-cols-[.72fr_1.28fr]">
      <div className="surface-card rounded-[24px] p-5 md:p-7">
        <p className="eyebrow">PLANILHA OFICIAL</p>
        <h2 className="font-display mt-2 text-2xl font-semibold text-[#192820]">Importar controle de NF</h2>
        <p className="mt-2 text-sm leading-6 text-[#718078]">O LYVRA lê CARTÃO, BOLETO e variações dessas abas. As colunas calculadas da planilha são ignoradas e refeitas pelo sistema.</p>

        <div className="mt-6 rounded-2xl border border-[#f0dcae] bg-[#fff9eb] p-4">
          <p className="text-sm font-semibold text-[#6e5723]">Planilha com Sorocaba e Salto misturados</p>
          <p className="mt-1 text-xs leading-5 text-[#8a7443]">O sistema não vai presumir a unidade. Quando ela não estiver identificada na própria linha, você escolhe a clínica na conferência antes de gravar.</p>
        </div>

        <input ref={inputRef} className="sr-only" type="file" accept=".xlsx,.xls" onChange={(event) => { const file = event.target.files?.[0]; if (file) void parseFile(file); }} />
        <button type="button" onClick={() => inputRef.current?.click()} className="mt-5 flex min-h-48 w-full flex-col items-center justify-center rounded-[22px] border border-dashed border-[#b7c4ba] bg-[#fafbf8] px-6 text-center transition hover:border-[#00BF63] hover:bg-[#f2fbf7]">
          <div className="grid size-14 place-items-center rounded-2xl bg-[#e4f8ee] text-[#00884a]"><UploadCloud className="size-6" /></div>
          <p className="mt-4 font-medium text-[#26382e]">{fileName || "Clique para escolher a planilha"}</p>
          <p className="mt-1 text-xs text-[#87928c]">XLSX ou XLS • até 1.000 linhas por operação</p>
        </button>

        <div className="mt-5 space-y-3 text-sm text-[#65736b]">
          <CheckLine>Reconhece “Paciente” como nome</CheckLine>
          <CheckLine>Forma de pagamento pela aba</CheckLine>
          <CheckLine>Separa Sorocaba e Salto antes de salvar</CheckLine>
          <CheckLine>Recalcula término, parcelas anuais e NF</CheckLine>
          <CheckLine>Preserva status e emissão real já preenchidos</CheckLine>
        </div>
      </div>

      <div className="surface-card overflow-hidden rounded-[24px]">
        <div className="border-b border-[#e7ebe7] p-5 md:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="eyebrow">CONFERÊNCIA</p><h2 className="font-display mt-2 text-xl font-semibold text-[#192820]">Antes de gravar</h2></div>
            {rows.length > 0 && <Badge variant="secondary">{rows.length} registros</Badge>}
          </div>
          {sheetNames.length > 0 && <p className="mt-2 text-xs text-[#87928c]">Abas lidas: {sheetNames.join(", ")}</p>}
        </div>

        {parseError ? <div className="m-6 flex gap-3 rounded-2xl bg-[#fae8e3] p-4 text-sm text-[#934e3f]"><AlertCircle className="mt-0.5 size-4 shrink-0" />{parseError}</div> : rows.length ? <>
          <div className="grid grid-cols-2 gap-px bg-[#e8ece8] sm:grid-cols-4">
            <Summary value={rows.length} label="Encontrados" />
            <Summary value={ready.length} label="Prontos" />
            <Summary value={unitPending.length} label="Sem unidade" warning={unitPending.length > 0} />
            <Summary value={blocking.length} label="Dados incompletos" warning={blocking.length > 0} />
          </div>

          <div className="flex flex-col gap-3 border-b border-[#edf0ed] p-4 sm:flex-row sm:items-center md:px-6">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#9aa49e]" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar paciente ou aba" className="h-10 rounded-xl pl-9" />
            </div>
            <Button type="button" variant={onlyMissingUnit ? "default" : "outline"} onClick={() => setOnlyMissingUnit((current) => !current)} className="h-10 rounded-xl">
              Sem unidade {unitPending.length ? `(${unitPending.length})` : ""}
            </Button>
          </div>

          <div className="max-h-[560px] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-[#fafbf8]"><TableRow className="bg-[#fafbf8] hover:bg-[#fafbf8]"><TableHead className="pl-6">Paciente</TableHead><TableHead className="min-w-44">Unidade</TableHead><TableHead>Origem</TableHead><TableHead>Pagamento</TableHead><TableHead>Plano</TableHead><TableHead>Situação</TableHead></TableRow></TableHeader>
              <TableBody>
                {visibleRows.map((row) => <TableRow key={`${row.sourceSheet}-${row.sourceRow}`} className={needsReview(row) ? "bg-[#fffaf6]" : ""}>
                  <TableCell className="py-4 pl-6"><p className="font-medium text-[#26372e]">{row.name}</p>{row.reviewReason && <p className="mt-1 max-w-64 text-xs text-[#9a7b43]">{row.reviewReason}</p>}</TableCell>
                  <TableCell>
                    {financialBlocking(row) ? <span className="text-xs text-[#a0a8a3]">Defina após corrigir os dados</span> : <Select value={row.unit || undefined} onValueChange={(value) => setRowUnit(row, value)}>
                      <SelectTrigger className={`h-9 min-w-40 rounded-lg ${!row.unit ? "border-[#e6b75c] bg-[#fff9eb]" : ""}`}><SelectValue placeholder="Escolha a unidade" /></SelectTrigger>
                      <SelectContent><SelectItem value="Sorocaba">Sorocaba</SelectItem><SelectItem value="Salto de Pirapora">Salto de Pirapora</SelectItem></SelectContent>
                    </Select>}
                  </TableCell>
                  <TableCell className="text-xs">{row.sourceSheet} • linha {row.sourceRow}</TableCell>
                  <TableCell>{row.paymentMethod}</TableCell>
                  <TableCell><p>{row.installments ? `${row.installments}x de ${money(row.installmentAmountCents)}` : "Incompleto"}</p><p className="mt-1 text-xs text-[#87928c]">{row.startDate || "Sem data inicial"}</p></TableCell>
                  <TableCell>{financialBlocking(row) ? <Badge className="bg-[#fae8e3] text-[#934e3f] hover:bg-[#fae8e3]">Revisar dados</Badge> : !row.unit ? <Badge className="bg-[#fff2d9] text-[#946814] hover:bg-[#fff2d9]">Definir unidade</Badge> : row.reviewReason ? <Badge className="bg-[#fff2d9] text-[#946814] hover:bg-[#fff2d9]">Alerta</Badge> : <Badge className="bg-[#eaf5df] text-[#54752d] hover:bg-[#eaf5df]">Pronto</Badge>}</TableCell>
                </TableRow>)}
              </TableBody>
            </Table>
            {!visibleRows.length && <div className="grid min-h-40 place-items-center px-6 text-center text-sm text-[#87928c]">Nenhum registro corresponde ao filtro.</div>}
          </div>

          {(blocking.length > 0 || warnings.length > 0 || unitPending.length > 0) && <div className="border-t border-[#e7ebe7] bg-[#fffaf3] px-5 py-4 text-sm text-[#765a32] md:px-6">
            {unitPending.length > 0 && <p><strong>{unitPending.length} paciente(s) válido(s) ainda precisam de unidade.</strong> O botão de importação fica bloqueado até separar Sorocaba e Salto.</p>}
            {blocking.length > 0 && <p className={unitPending.length ? "mt-1" : ""}><strong>{blocking.length} linha(s) com dados financeiros incompletos</strong> serão ignoradas na importação.</p>}
            {warnings.length > 0 && <p className={unitPending.length || blocking.length ? "mt-1" : ""}>{warnings.length} registro(s) têm alerta de conferência, mas podem ser importados.</p>}
          </div>}

          <div className="flex flex-col gap-3 border-t border-[#e7ebe7] bg-[#fafbf8] p-5 sm:flex-row sm:items-center sm:justify-between md:px-6">
            <p className="text-sm text-[#65736b]">{unitPending.length ? "Separe as unidades para continuar." : blocking.length ? `${ready.length} paciente(s) prontos; ${blocking.length} linha(s) incompleta(s) serão ignoradas.` : "Todas as unidades estão definidas. Pronto para importar."}</p>
            <Button disabled={importing || !ready.length || unitPending.length > 0} onClick={() => void submit()} className="h-11 rounded-xl bg-[#183b32] px-5">{importing ? <LoaderCircle className="animate-spin" /> : <Database />} Importar {ready.length} pacientes</Button>
          </div>
        </> : <div className="grid min-h-96 place-items-center px-6 text-center"><div><FileSpreadsheet className="mx-auto size-10 text-[#b3bdb6]" /><p className="mt-4 font-medium text-[#4e5d54]">A conferência aparecerá aqui</p><p className="mt-1 text-sm text-[#8a958e]">Nada é salvo antes da sua confirmação.</p></div></div>}
      </div>
    </section>

    <section className="rounded-[22px] border border-[#dfe5df] bg-[#eef4e9] p-5"><div className="flex gap-3"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-[#51713d]" /><div><p className="font-medium text-[#2c432f]">Fórmulas do Excel não entram no banco</p><p className="mt-1 text-sm leading-6 text-[#657a66]">O valor total, término do parcelamento, quantidade de parcelas no ano, valor da NF e data prevista passam a ser calculados pelo próprio LYVRA.</p></div></div></section>
  </div>;
}

function Summary({ value, label, warning = false }: { value: number; label: string; warning?: boolean }) {
  return <div className="bg-white p-4 text-center"><p className={`font-display text-2xl font-semibold ${warning && value ? "text-[#a15a45]" : "text-[#213128]"}`}>{value}</p><p className="mt-1 text-xs text-[#7c8981]">{label}</p></div>;
}

function CheckLine({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2"><span className="grid size-5 place-items-center rounded-full bg-[#e4f8ee] text-[#00884a]"><Check className="size-3" /></span>{children}</div>;
}
