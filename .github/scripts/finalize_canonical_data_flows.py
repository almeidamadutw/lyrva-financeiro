from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"marker not found: {label}")
    return text.replace(old, new, 1)


# NF workbook: preserve every parsed source row before operational processing.
path = Path("components/nf-workbook-import.tsx")
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    "  const submit = async () => {\n    if (!ready.length) return;\n\n    setImporting(true);",
    "  const submit = async () => {\n    if (!rows.length) return;\n\n    setImporting(true);",
    "nf submit guard",
)
text = replace_once(
    text,
    "      const supabase = getSupabaseBrowserClient();\n      const grouped = new Map<string, ParsedNfPatient[]>();",
    "      const supabase = getSupabaseBrowserClient();\n      const sourceCapture = await (supabase as any).rpc(\"capture_workbook_source_rows\", {\n        p_provider: \"nf_workbook\",\n        p_file_name: fileName || \"planilha NF\",\n        p_rows: JSON.parse(JSON.stringify(rows)),\n      });\n      if (sourceCapture.error) throw sourceCapture.error;\n\n      const grouped = new Map<string, ParsedNfPatient[]>();",
    "nf source capture",
)
text = replace_once(
    text,
    '<Button disabled={importing || !ready.length} onClick={() => void submit()} className="h-11 rounded-xl bg-[#183b32] px-5">{importing ? <><LoaderCircle className="animate-spin" /> Importando em lotes...</> : <><Database /> Importar {ready.length} registros</>}</Button>',
    '<Button disabled={importing || !rows.length} onClick={() => void submit()} className="h-11 rounded-xl bg-[#183b32] px-5">{importing ? <><LoaderCircle className="animate-spin" /> Importando em lotes...</> : <><Database /> {ready.length ? `Importar ${ready.length} registros` : `Registrar ${rows.length} para revisão`}</>}</Button>',
    "nf import button",
)
text = text.replace(
    "Nenhuma linha enviada foi descartada silenciosamente.",
    "Todas as linhas da planilha ficaram preservadas na origem, inclusive as que ainda aguardam revisão.",
)
path.write_text(text, encoding="utf-8")


# Collection workbook: preserve open, settled and negotiation rows before matching.
path = Path("components/collections-workbook-import.tsx")
text = path.read_text(encoding="utf-8")
old = 'const submit=async()=>{if(!openRows.length)return;setImporting(true);try{const supabase=getSupabaseBrowserClient();let preparedCreated=0,preparedUpdated=0,preparedInstallments=0,preparedSkipped=0;'
new = '''const submit=async()=>{if(!rows.length&&!negotiations.length)return;setImporting(true);try{const supabase=getSupabaseBrowserClient();const sourceRows=[...rows.map(row=>({...row,name:row.patientName,unit:"Sorocaba",sourceType:"collection_row"})),...negotiations.map((row,index)=>({...row,name:row.patientName,unit:"Sorocaba",sourceType:"negotiation",sourceSheet:"NEGOCIACOES",sourceRow:index+1}))];for(const group of chunks(sourceRows,500)){const captured=await (supabase as any).rpc("capture_workbook_source_rows",{p_provider:"collections_workbook",p_file_name:fileName||"régua de cobrança",p_rows:JSON.parse(JSON.stringify(group))});if(captured.error)throw captured.error}let preparedCreated=0,preparedUpdated=0,preparedInstallments=0,preparedSkipped=0;'''
text = replace_once(text, old, new, "collection source capture")
text = text.replace("disabled={importing||!openRows.length}", "disabled={importing||(!rows.length&&!negotiations.length)}")
text = text.replace("disabled={importing || !openRows.length}", "disabled={importing || (!rows.length && !negotiations.length)}")
path.write_text(text, encoding="utf-8")

print("canonical workbook source capture patches applied")
