from pathlib import Path

path = Path('components/collections-workbook-import.tsx')
text = path.read_text()

old = 'const submit=async()=>{if(!openRows.length)return;setImporting(true);try{const supabase=getSupabaseBrowserClient();const[pRes,planRes,instRes,uRes]=await Promise.all(['
new = 'const submit=async()=>{if(!openRows.length)return;setImporting(true);try{const supabase=getSupabaseBrowserClient();let preparedCreated=0,preparedUpdated=0,preparedInstallments=0,preparedSkipped=0;for(const g of chunks(openRows,100)){const prep=await (supabase as any).rpc("prepare_collection_import_targets",{p_unit_code:"sorocaba",p_rows:JSON.parse(JSON.stringify(g))});if(prep.error)throw prep.error;const summary=prep.data?.[0];preparedCreated+=Number(summary?.created_patients??0);preparedUpdated+=Number(summary?.updated_patients??0);preparedInstallments+=Number(summary?.created_installments??0);preparedSkipped+=Number(summary?.skipped_settled??0)}const[pRes,planRes,instRes,uRes]=await Promise.all(['
if old not in text:
    raise SystemExit('submit marker not found')
text = text.replace(old, new, 1)

old = 'plans.filter(p=>["active","completed"].includes(p.status))'
new = 'plans.filter(p=>["active","completed","suspended"].includes(p.status))'
if old not in text:
    raise SystemExit('plan status marker not found')
text = text.replace(old, new, 1)

old = 'toast.success("Régua importada",{description:`${mapped.length} caso(s) vinculados • ${interactions.length} histórico(s) trazidos • ${settled.length} quitado(s) fora da cobrança • ${unmatched.length} para revisão.`});if(unmatched.length)toast.warning(`${unmatched.length} registro(s) não foram vinculados`,{description:"Eles não criaram pacientes nem cobranças novas."});'
new = 'toast.success("Régua importada",{description:`${mapped.length} caso(s) vinculados • ${preparedCreated} paciente(s) criado(s) • ${preparedUpdated} atualizado(s) • ${preparedInstallments} parcela(s) técnica(s) criada(s) • ${interactions.length} histórico(s) trazidos • ${settled.length} quitado(s) fora da cobrança.`});if(preparedSkipped)toast.info(`${preparedSkipped} paciente(s) quitado(s) foram ignorados.`);if(unmatched.length)toast.warning(`${unmatched.length} registro(s) ficaram para revisão`,{description:"Não foi possível vincular esses registros com segurança."});'
if old not in text:
    raise SystemExit('toast marker not found')
text = text.replace(old, new, 1)

text = text.replace('Importe primeiro os pacientes/NF. Depois esta planilha localiza as parcelas existentes e traz o histórico da Dai sem criar pacientes.','A Régua procura primeiro os pacientes e parcelas já cadastrados. Quando faltar cadastro ou parcela, ela cria/atualiza o necessário sem duplicar e traz o histórico da Dai.',1)
text = text.replace('A régua nunca cria paciente. Só vincula quem já existe.','A Régua atualiza pacientes existentes e cria somente o que estiver faltando. Pacientes quitados continuam fora da cobrança.',1)

path.write_text(text)
