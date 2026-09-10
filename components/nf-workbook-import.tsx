"use client";

import { useRef, useState } from "react";
import { AlertCircle, Check, Database, FileSpreadsheet, LoaderCircle, ShieldCheck, UploadCloud } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { parseNfWorkbook, type ParsedNfPatient } from "@/lib/nf-workbook";

type Props = { onImported: () => Promise<void> };

const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const isBlocking = (row: ParsedNfPatient) => !row.name || !row.startDate || !row.installments || row.installmentAmountCents <= 0;

export function NfWorkbookImportView({ onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ParsedNfPatient[]>([]);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [fallbackUnit, setFallbackUnit] = useState("");
  const [parseError, setParseError] = useState("");
  const [importing, setImporting] = useState(false);

  const parseFile = async (file: File) => {
    setParseError("");
    setRows([]);
    setFileName(file.name);
    try {
      const result = await parseNfWorkbook(file);
      setRows(result.rows);
      setSheetNames(result.sheets);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "Não foi possível ler a planilha.");
    }
  };

  const blocking = rows.filter(isBlocking);
  const warnings = rows.filter((row) => !isBlocking(row) && row.reviewReason);
  const ready = rows.filter((row) => !isBlocking(row));
  const withoutUnit = ready.filter((row) => !row.unit).length;

  const submit = async () => {
    if (!ready.length) return;
    if (withoutUnit && !fallbackUnit) {
      toast.error("Defina a unidade padrão", { description: `${withoutUnit} paciente(s) não têm Sorocaba/Salto identificado na planilha.` });
      return;
    }

    setImporting(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const grouped = new Map<string, ParsedNfPatient[]>();

      for (const row of ready) {
        const resolvedUnit = row.unit || fallbackUnit;
        const unitCode = resolvedUnit === "Salto de Pirapora" ? "salto_de_pirapora" : "sorocaba";
        const payload = { ...row, unit: resolvedUnit };
        grouped.set(unitCode, [...(grouped.get(unitCode) ?? []), payload]);
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
        toast.warning(`${created + updated} pacientes processados`, { description: `${errors} linha(s) ficaram no relatório de importação para revisão.` });
      } else {
        toast.success(`${created + updated} pacientes processados`, { description: `${created} novo(s), ${updated} atualizado(s). As parcelas e NFs foram recalculadas pelo LYVRA.` });
      }
      await onImported();
    } catch (error) {
      toast.error("Importação não concluída", { description: error instanceof Error ? error.message : "Tente novamente." });
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

        <div className="mt-6 space-y-2">
          <label className="text-sm font-semibold text-[#33473c]">Unidade padrão da planilha</label>
          <Select value={fallbackUnit} onValueChange={setFallbackUnit}>
            <SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder="Escolha Sorocaba ou Salto" /></SelectTrigger>
            <SelectContent><SelectItem value="Sorocaba">Sorocaba</SelectItem><SelectItem value="Salto de Pirapora">Salto de Pirapora</SelectItem></SelectContent>
          </Select>
          <p className="text-xs leading-5 text-[#87928c]">Só será usada nas linhas em que a própria planilha não informa a unidade.</p>
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
          <CheckLine>Recalcula término, parcelas anuais e NF</CheckLine>
          <CheckLine>Preserva status e emissão real já preenchidos</CheckLine>
        </div>
      </div>

      <div className="surface-card overflow-hidden rounded-[24px]">
        <div className="border-b border-[#e7ebe7] p-5 md:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow">CONFERÊNCIA</p><h2 className="font-display mt-2 text-xl font-semibold text-[#192820]">Antes de gravar</h2></div>{rows.length > 0 && <Badge variant="secondary">{rows.length} registros</Badge>}</div>
          {sheetNames.length > 0 && <p className="mt-2 text-xs text-[#87928c]">Abas lidas: {sheetNames.join(", ")}</p>}
        </div>

        {parseError ? <div className="m-6 flex gap-3 rounded-2xl bg-[#fae8e3] p-4 text-sm text-[#934e3f]"><AlertCircle className="mt-0.5 size-4 shrink-0" />{parseError}</div> : rows.length ? <>
          <div className="grid grid-cols-2 gap-px bg-[#e8ece8] sm:grid-cols-4">
            <Summary value={rows.length} label="Encontrados" />
            <Summary value={ready.length} label="Dados financeiros OK" />
            <Summary value={blocking.length} label="Incompletos" warning={blocking.length > 0} />
            <Summary value={warnings.length} label="Com alerta" warning={warnings.length > 0} />
          </div>
          <div className="overflow-x-auto"><Table><TableHeader><TableRow className="bg-[#fafbf8] hover:bg-[#fafbf8]"><TableHead className="pl-6">Paciente</TableHead><TableHead>Origem</TableHead><TableHead>Pagamento</TableHead><TableHead>Plano</TableHead><TableHead>Situação</TableHead></TableRow></TableHeader><TableBody>
            {rows.slice(0, 10).map((row) => <TableRow key={`${row.sourceSheet}-${row.sourceRow}`} className={isBlocking(row) ? "bg-[#fff7f4]" : ""}><TableCell className="py-4 pl-6"><p className="font-medium text-[#26372e]">{row.name}</p><p className="mt-1 text-xs text-[#87928c]">{row.unit || fallbackUnit || "Unidade a definir"}</p></TableCell><TableCell className="text-xs">{row.sourceSheet} • linha {row.sourceRow}</TableCell><TableCell>{row.paymentMethod}</TableCell><TableCell><p>{row.installments ? `${row.installments}x de ${money(row.installmentAmountCents)}` : "Incompleto"}</p><p className="mt-1 text-xs text-[#87928c]">{row.startDate || "Sem data inicial"}</p></TableCell><TableCell>{isBlocking(row) ? <Badge className="bg-[#fae8e3] text-[#934e3f] hover:bg-[#fae8e3]">Revisar</Badge> : row.reviewReason ? <Badge className="bg-[#fff2d9] text-[#946814] hover:bg-[#fff2d9]">Alerta</Badge> : <Badge className="bg-[#eaf5df] text-[#54752d] hover:bg-[#eaf5df]">Pronto</Badge>}</TableCell></TableRow>)}
          </TableBody></Table></div>
          {rows.length > 10 && <p className="border-t border-[#edf0ed] p-4 text-center text-xs text-[#7d8982]">Mais {rows.length - 10} registro(s) na conferência.</p>}
          {(blocking.length > 0 || warnings.length > 0) && <div className="border-t border-[#e7ebe7] bg-[#fffaf3] px-5 py-4 text-sm text-[#765a32] md:px-6"><strong>{blocking.length} linha(s) incompleta(s)</strong> não serão importadas. Alertas não bloqueiam o cadastro, mas ficam preservados nas observações.</div>}
          <div className="flex flex-col gap-3 border-t border-[#e7ebe7] bg-[#fafbf8] p-5 sm:flex-row sm:items-center sm:justify-between md:px-6"><p className="text-sm text-[#65736b]">{withoutUnit ? `${withoutUnit} registro(s) usarão a unidade padrão escolhida.` : "Todas as unidades foram identificadas."}</p><Button disabled={importing || !ready.length || (withoutUnit > 0 && !fallbackUnit)} onClick={() => void submit()} className="h-11 rounded-xl bg-[#183b32] px-5">{importing ? <LoaderCircle className="animate-spin" /> : <Database />} Importar {ready.length} pacientes</Button></div>
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
