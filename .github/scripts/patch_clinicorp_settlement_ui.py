from pathlib import Path

path = Path('components/lyvra-app.tsx')
source = path.read_text(encoding='utf-8')
start = source.index('function PatientsView(')
end = source.index('\nfunction ImportView(', start)

replacement = r'''type SettlementStatusRow = {
  patient_id: number;
  unit_id: number;
  unit_name: string;
  settlement_state: "open" | "requested" | "settled";
  settlement_request_id?: number | null;
  requested_at?: string | null;
  clinicorp_url?: string | null;
};

function PatientsView({ unit, patients, loading, goTo, onSaved, canEdit }: { unit: string; patients: Patient[]; loading: boolean; goTo: (view: View) => void; onSaved: () => Promise<void>; canEdit: boolean }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "requested" | "settled" | "all">("active");
  const [requestingId, setRequestingId] = useState<number | null>(null);
  const [settlementStates, setSettlementStates] = useState<Record<string, SettlementStatusRow>>({});

  const settlementKey = (patientId: number, unitName: string) => `${patientId}:${unitName}`;

  const loadSettlementStates = useCallback(async () => {
    const patientIds = [...new Set(patients.map((patient) => patient.id).filter((id): id is number => Boolean(id)))];
    if (!patientIds.length) {
      setSettlementStates({});
      return;
    }

    const supabase = getSupabaseBrowserClient();
    const { data, error } = await (supabase as any)
      .from("patient_settlement_status")
      .select("patient_id,unit_id,unit_name,settlement_state,settlement_request_id,requested_at,clinicorp_url")
      .in("patient_id", patientIds);
    if (error) throw error;

    const next: Record<string, SettlementStatusRow> = {};
    for (const row of (data ?? []) as SettlementStatusRow[]) {
      next[settlementKey(Number(row.patient_id), String(row.unit_name))] = row;
    }
    setSettlementStates(next);
  }, [patients]);

  useEffect(() => {
    void loadSettlementStates().catch(() => undefined);
  }, [loadSettlementStates]);

  const requestSettlement = async (patient: Patient) => {
    if (!patient.id) return;
    const state = settlementStates[settlementKey(patient.id, patient.unit)];
    const clinicorpUrl = state?.clinicorp_url || "https://sistema.clinicorp.com/";

    if (state?.settlement_state === "requested") {
      window.open(clinicorpUrl, "_blank", "noopener,noreferrer");
      return;
    }

    if (!state?.unit_id) {
      toast.error("Unidade do paciente não encontrada", { description: "Atualize a tela e tente novamente." });
      return;
    }

    setRequestingId(patient.id);
    const clinicorpWindow = window.open("about:blank", "_blank");
    if (clinicorpWindow) clinicorpWindow.opener = null;

    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await (supabase as any).rpc("request_clinicorp_settlement", {
        p_patient_id: patient.id,
        p_unit_id: state.unit_id,
        p_payment_plan_id: null,
      });
      if (error) throw error;

      const result = Array.isArray(data) ? data[0] : data;
      const targetUrl = String(result?.clinicorp_url || clinicorpUrl);
      if (clinicorpWindow) clinicorpWindow.location.href = targetUrl;
      else window.open(targetUrl, "_blank", "noopener,noreferrer");

      toast.success("Baixa solicitada", {
        description: "Faça a baixa no Clinicorp. O LYVRA confirmará automaticamente quando o pagamento aparecer na sincronização.",
      });
      await loadSettlementStates();
    } catch (error) {
      clinicorpWindow?.close();
      toast.error("Não foi possível iniciar a baixa", {
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
    } finally {
      setRequestingId(null);
    }
  };

  const filtered = patients.filter((patient) => {
    const unitMatches = unit === "todas" || (unit === "sorocaba" ? patient.unit === "Sorocaba" : patient.unit === "Salto de Pirapora");
    const queryMatches = patient.name.toLowerCase().includes(query.toLowerCase());
    const state = patient.id ? settlementStates[settlementKey(patient.id, patient.unit)] : undefined;
    const statusMatches = statusFilter === "all"
      || (statusFilter === "settled" ? Boolean(patient.settledAt) : false)
      || (statusFilter === "requested" ? state?.settlement_state === "requested" && !patient.settledAt : false)
      || (statusFilter === "active" ? !patient.settledAt : false);
    return unitMatches && queryMatches && statusMatches;
  });

  return <div className="space-y-5"><section className="surface-card overflow-hidden rounded-[24px]"><div className="flex flex-col gap-4 border-b border-[#e7ebe7] p-5 sm:flex-row sm:items-center sm:justify-between md:p-6"><div><h2 className="font-display text-xl font-semibold text-[#192820]">Pacientes cadastrados</h2><p className="mt-1 text-sm text-[#718078]">A baixa é feita no Clinicorp. O LYVRA acompanha a confirmação e encerra as cobranças sozinho quando o pagamento for confirmado.</p></div><div className="flex flex-wrap gap-2"><div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8b9690]"/><Input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar paciente" className="h-10 w-52 rounded-xl pl-9"/></div><Select value={statusFilter} onValueChange={v=>setStatusFilter(v as typeof statusFilter)}><SelectTrigger className="h-10 w-40 rounded-xl"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="active">Ativos</SelectItem><SelectItem value="requested">Baixa solicitada</SelectItem><SelectItem value="settled">Quitados</SelectItem><SelectItem value="all">Todos</SelectItem></SelectContent></Select>{canEdit&&<><ManualPatientDialog onSaved={onSaved}/><Button onClick={()=>goTo("import")} variant="outline" className="h-10 rounded-xl"><UploadCloud/> Importar</Button></>}</div></div>{loading?<div className="grid min-h-64 place-items-center"><LoaderCircle className="animate-spin"/></div>:filtered.length?<Table><TableHeader><TableRow className="bg-[#fafbf8]"><TableHead className="pl-6">Paciente</TableHead><TableHead>Unidade</TableHead><TableHead>Pagamento</TableHead><TableHead>Periodicidade</TableHead><TableHead>Nota para IR</TableHead><TableHead className="w-44">Baixa</TableHead></TableRow></TableHeader><TableBody>{filtered.map(patient=>{const state=patient.id?settlementStates[settlementKey(patient.id,patient.unit)]:undefined;const requested=state?.settlement_state==="requested"&&!patient.settledAt;return <TableRow key={`${patient.id}-${patient.name}`}><TableCell className="py-4 pl-6"><div><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{patient.name}</p>{patient.settledAt?<Badge className="bg-[#eaf5df] text-[#54752d]">Quitado</Badge>:requested?<Badge className="bg-[#fff3d8] text-[#8a651f] hover:bg-[#fff3d8]">Baixa solicitada</Badge>:null}</div><p className="mt-1 text-xs text-[#839087]">{patient.cpf||"CPF pendente"} • {patient.treatment||"Tratamento não informado"}{requested?" • aguardando confirmação do Clinicorp":""}</p></div></TableCell><TableCell>{patient.unit}</TableCell><TableCell><p>{patient.paymentMethod||"—"}</p><p className="mt-1 text-xs text-[#839087]">{money(patient.planAmountCents)}</p></TableCell><TableCell>{patient.invoiceDisabled?<span className="text-[#a05a48]">Não emitir</span>:patient.invoiceFrequency||"Regra automática"}</TableCell><TableCell>{Boolean(patient.taxReceiptIr)?<Badge className="bg-[#eaf5df] text-[#54752d]"><Check/> Sim</Badge>:<Badge variant="secondary">Não</Badge>}</TableCell><TableCell>{patient.settledAt?<span className="text-xs font-medium text-[#54752d]">Confirmado</span>:canEdit?<Button variant={requested?"outline":"default"} size="sm" disabled={requestingId===patient.id||!state} onClick={()=>void requestSettlement(patient)} className={requested?"rounded-xl":"rounded-xl bg-[#183b32] hover:bg-[#214d41]"}>{requestingId===patient.id?<LoaderCircle className="animate-spin"/>:<Link2/>}{requested?"Abrir Clinicorp":"Dar baixa"}</Button>:<span className="text-xs text-[#7b897f]">Em aberto</span>}</TableCell></TableRow>})}</TableBody></Table>:<div className="grid min-h-64 place-items-center text-sm text-[#7d8982]">Nenhum paciente neste filtro.</div>}</section></div>;
}'''

updated = source[:start] + replacement + source[end:]
path.write_text(updated, encoding='utf-8')
print('patched components/lyvra-app.tsx')
