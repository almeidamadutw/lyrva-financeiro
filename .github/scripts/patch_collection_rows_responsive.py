from pathlib import Path
import re

# Replace rigid table with responsive grid rows
p = Path('components/collections-journey-real.tsx')
s = p.read_text()
pattern = re.compile(r'function CollectionTable\(\{ patients, onOpen, loading \}: \{ patients: CollectionPatient\[\]; onOpen: \(id: number\) => void; loading: boolean \}\) \{.*?\n\}\n\nfunction ProtestedBlock', re.S)
replacement = '''function CollectionTable({ patients, onOpen, loading }: { patients: CollectionPatient[]; onOpen: (id: number) => void; loading: boolean }) {
  if (loading) return <div className="grid min-h-56 place-items-center"><LoaderCircle className="size-5 animate-spin text-[#00BF63]" /></div>;
  if (!patients.length) return <div className="grid min-h-56 place-items-center p-6 text-sm text-[#7d8982]">Nenhum paciente nesta etapa.</div>;
  return <div className="collection-responsive-list divide-y divide-[#e7ebe7]">{patients.map((patient) => <div key={patient.id} className="collection-responsive-row">
    <div className="collection-field collection-patient-field">
      <span className="collection-field-label">Paciente</span>
      <div className="flex min-w-0 items-center gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#edf2ed] text-xs font-semibold text-[#365146]">{patient.initials}</div><div className="min-w-0"><p className="truncate font-medium text-[#213128]">{patient.name}</p><p className="mt-0.5 truncate text-xs text-[#849087]">{patient.unit} • {patient.owner}</p></div></div>
    </div>
    <div className="collection-field"><span className="collection-field-label">Vencimento</span><p className="text-sm text-[#2c3b33]">{patient.dueDate}</p><p className="mt-1 text-xs text-[#a25f4d]">{patient.delay}</p></div>
    <div className="collection-field"><span className="collection-field-label">Valor</span><p className="font-semibold tabular-nums text-[#2c3b33]">{patient.amount}</p></div>
    <div className="collection-field"><span className="collection-field-label">Situação</span><div><Badge className={`border-0 font-medium hover:opacity-100 ${stageTone[patient.stage]}`}>{patient.status}</Badge></div></div>
    <div className="collection-field collection-next-field"><span className="collection-field-label">Próxima ação</span><p className="break-words text-sm font-medium leading-5 text-[#405148]">{patient.nextAction}</p></div>
    <div className="collection-action-field"><Button onClick={() => onOpen(patient.id)} variant="outline" size="sm" className="w-full rounded-lg whitespace-nowrap">Negociar <ChevronRight /></Button></div>
  </div>)}</div>;
}

function ProtestedBlock'''
new, count = pattern.subn(replacement, s)
if count != 1:
    raise SystemExit(f'CollectionTable replacement count={count}')
p.write_text(new)

# Responsive row CSS driven by actual app container width
p = Path('app/globals.css')
s = p.read_text()
marker = '.lyvra-split-dashboard,.lyvra-split-collections{display:grid;grid-template-columns:minmax(0,1fr);gap:1.25rem}'
addition = '''\n.collection-responsive-list{width:100%;min-width:0;overflow:hidden}\n.collection-responsive-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:.9rem 1rem;padding:1rem 1.25rem;align-items:center}\n.collection-responsive-row>*{min-width:0}\n.collection-patient-field{grid-column:1/-1}\n.collection-next-field{grid-column:1/-1}\n.collection-action-field{grid-column:1/-1}\n.collection-field-label{display:block;margin-bottom:.35rem;font-size:.625rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#98a29c}\n@container (min-width:820px){.collection-responsive-row{grid-template-columns:minmax(220px,1.6fr) minmax(125px,.72fr) minmax(100px,.55fr) minmax(110px,.7fr);padding:1rem 1.5rem}.collection-patient-field{grid-column:auto}.collection-next-field{grid-column:1/4}.collection-action-field{grid-column:4;align-self:end}}\n@container (min-width:1260px){.collection-responsive-row{grid-template-columns:minmax(230px,1.55fr) minmax(125px,.7fr) minmax(100px,.55fr) minmax(115px,.65fr) minmax(180px,1.1fr) auto;gap:1rem 1.25rem}.collection-next-field,.collection-action-field{grid-column:auto}.collection-action-field{align-self:center}.collection-field-label{display:none}}'''
if addition.strip() not in s:
    s = s.replace(marker, marker + addition)
p.write_text(s)
