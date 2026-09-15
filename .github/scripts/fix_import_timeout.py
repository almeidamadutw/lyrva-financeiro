from pathlib import Path

path = Path('components/nf-workbook-import.tsx')
text = path.read_text(encoding='utf-8')

old_plan = '''        if (planRows.length) {
          const { data, error } = await supabase.rpc("import_patients", {
            p_unit_code: unitCode,
            p_file_name: fileName || "planilha NF",
            p_rows: JSON.parse(JSON.stringify(planRows)),
          });
          if (error) throw error;
          const result = data?.[0];
          created += result?.imported_count ?? 0;
          updated += result?.updated_count ?? 0;
          errors += result?.error_count ?? 0;
        }
'''
new_plan = '''        if (planRows.length) {
          const batchSize = 10;
          for (let offset = 0; offset < planRows.length; offset += batchSize) {
            const batch = planRows.slice(offset, offset + batchSize);
            const { data, error } = await supabase.rpc("import_patients", {
              p_unit_code: unitCode,
              p_file_name: fileName || "planilha NF",
              p_rows: JSON.parse(JSON.stringify(batch)),
            });
            if (error) throw error;
            const result = data?.[0];
            created += result?.imported_count ?? 0;
            updated += result?.updated_count ?? 0;
            errors += result?.error_count ?? 0;
          }
        }
'''
if old_plan not in text:
    raise SystemExit('Bloco de planos não encontrado')
text = text.replace(old_plan, new_plan, 1)

old_directory = '''        if (directoryRows.length) {
          const { data, error } = await callDirectoryRpc("import_patient_directory", {
            p_unit_code: unitCode,
            p_file_name: fileName || "planilha mensal de NF",
            p_rows: JSON.parse(JSON.stringify(directoryRows)),
          });
          if (error) throw new Error(error.message);
          const result = data?.[0];
          created += result?.imported_count ?? 0;
          updated += result?.updated_count ?? 0;
          errors += result?.error_count ?? 0;
        }
'''
new_directory = '''        if (directoryRows.length) {
          const batchSize = 25;
          for (let offset = 0; offset < directoryRows.length; offset += batchSize) {
            const batch = directoryRows.slice(offset, offset + batchSize);
            const { data, error } = await callDirectoryRpc("import_patient_directory", {
              p_unit_code: unitCode,
              p_file_name: fileName || "planilha mensal de NF",
              p_rows: JSON.parse(JSON.stringify(batch)),
            });
            if (error) throw new Error(error.message);
            const result = data?.[0];
            created += result?.imported_count ?? 0;
            updated += result?.updated_count ?? 0;
            errors += result?.error_count ?? 0;
          }
        }
'''
if old_directory not in text:
    raise SystemExit('Bloco de diretório não encontrado')
text = text.replace(old_directory, new_directory, 1)

old_loading = '''            <Button disabled={importing || !ready.length || unitPending.length > 0} onClick={() => void submit()} className="h-11 rounded-xl bg-[#183b32] px-5">{importing ? <LoaderCircle className="animate-spin" /> : <Database />} Importar {ready.length} pacientes</Button>'''
new_loading = '''            <Button disabled={importing || !ready.length || unitPending.length > 0} onClick={() => void submit()} className="h-11 rounded-xl bg-[#183b32] px-5">{importing ? <><LoaderCircle className="animate-spin" /> Importando em lotes...</> : <><Database /> Importar {ready.length} pacientes</>}</Button>'''
if old_loading in text:
    text = text.replace(old_loading, new_loading, 1)

path.write_text(text, encoding='utf-8')
