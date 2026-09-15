from pathlib import Path

path = Path('components/nf-workbook-import.tsx')
text = path.read_text(encoding='utf-8')

old = '      const callDirectoryRpc = (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<RpcResponse>);'
new = '      const callDirectoryRpc = supabase.rpc.bind(supabase) as unknown as (fn: string, args: Record<string, unknown>) => Promise<RpcResponse>;'
if old not in text:
    raise SystemExit('Trecho do RPC desacoplado não encontrado')
text = text.replace(old, new, 1)

anchor = '''  const setRowUnit = (row: ParsedNfPatient, unit: string) => {
    setRows((current) => current.map((item) => (
      item.sourceSheet === row.sourceSheet && item.sourceRow === row.sourceRow
        ? { ...item, unit }
        : item
    )));
  };
'''
addition = anchor + '''
  const setVisibleRowsUnit = (unit: string) => {
    const visibleKeys = new Set(
      visibleRows
        .filter((row) => !financialBlocking(row))
        .map((row) => `${row.sourceSheet}::${row.sourceRow}`),
    );
    if (!visibleKeys.size) {
      toast.info("Nenhum paciente visível pode receber unidade.");
      return;
    }
    setRows((current) => current.map((item) => (
      visibleKeys.has(`${item.sourceSheet}::${item.sourceRow}`)
        ? { ...item, unit }
        : item
    )));
    toast.success(`Unidade definida para ${visibleKeys.size} registro(s).`, {
      description: unit,
    });
  };
'''
if anchor not in text:
    raise SystemExit('Função setRowUnit não encontrada')
text = text.replace(anchor, addition, 1)

old_filter = '''            <Select value={unitFilter} onValueChange={(value) => setUnitFilter(value as typeof unitFilter)}>
              <SelectTrigger className="h-10 w-full rounded-xl sm:w-52">
                <SelectValue placeholder="Filtrar unidade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as unidades</SelectItem>
                <SelectItem value="missing">Sem unidade {unitPending.length ? `(${unitPending.length})` : ""}</SelectItem>
                <SelectItem value="Sorocaba">Sorocaba</SelectItem>
                <SelectItem value="Salto de Pirapora">Salto de Pirapora</SelectItem>
              </SelectContent>
            </Select>'''
new_filter = '''            <Select value={unitFilter} onValueChange={(value) => setUnitFilter(value as typeof unitFilter)}>
              <SelectTrigger className="h-10 w-full rounded-xl sm:w-52">
                <SelectValue placeholder="Filtrar unidade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as unidades</SelectItem>
                <SelectItem value="missing">Sem unidade {unitPending.length ? `(${unitPending.length})` : ""}</SelectItem>
                <SelectItem value="Sorocaba">Sorocaba</SelectItem>
                <SelectItem value="Salto de Pirapora">Salto de Pirapora</SelectItem>
              </SelectContent>
            </Select>
            <Select value="" onValueChange={(value) => setVisibleRowsUnit(value)}>
              <SelectTrigger className="h-10 w-full rounded-xl border-[#b8dbc7] bg-[#edf8f1] text-[#27704b] sm:w-48">
                <SelectValue placeholder="Definir unidade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Sorocaba">Aplicar Sorocaba</SelectItem>
                <SelectItem value="Salto de Pirapora">Aplicar Salto de Pirapora</SelectItem>
              </SelectContent>
            </Select>'''
if old_filter not in text:
    raise SystemExit('Filtro de unidade não encontrado')
text = text.replace(old_filter, new_filter, 1)

path.write_text(text, encoding='utf-8')

parser = Path('lib/nf-workbook.ts')
ptext = parser.read_text(encoding='utf-8')
old_key = '''    const importKey = [
      "nf-workbook",
      normalize(sheetName),
      normalize(name),'''
new_key = '''    const importKey = [
      "nf-workbook",
      normalize(name),'''
if old_key not in ptext:
    raise SystemExit('Import key detalhada não encontrada')
ptext = ptext.replace(old_key, new_key, 1)
parser.write_text(ptext, encoding='utf-8')
