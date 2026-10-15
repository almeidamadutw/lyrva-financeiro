"use client";

import {useEffect,useState} from "react";
import {getSupabaseBrowserClient} from "@/lib/supabase/client";

type UnitProgress={code:string;name:string;total_days:number;verified_days:number;error_days:number;pending_financial_days:number;last_verified_at:string|null;api_resume_at?:string|null};
type Progress={enabled:boolean;units:UnitProgress[]};

export function ClinicorpSyncStatus({unit}:{unit:string}) {
  const [progress,setProgress]=useState<Progress|null>(null);
  const [failed,setFailed]=useState(false);
  useEffect(()=>{
    let active=true;
    setProgress(null);setFailed(false);
    const load=async()=>{
      if(document.visibilityState==="hidden")return;
      const {data,error}=await (getSupabaseBrowserClient() as any).rpc("get_clinicorp_sync_status",{
        p_unit_code:unit==="salto"?"salto_de_pirapora":unit==="todas"?null:unit,
      });
      if(!active)return;
      setFailed(Boolean(error));if(!error)setProgress(data as Progress);
    };
    void load();const timer=window.setInterval(()=>void load(),60_000);
    return()=>{active=false;window.clearInterval(timer);};
  },[unit]);
  const total=progress?.units.reduce((sum,u)=>sum+Number(u.total_days),0)??0;
  const verified=progress?.units.reduce((sum,u)=>sum+Number(u.verified_days),0)??0;
  const errors=progress?.units.reduce((sum,u)=>sum+Number(u.error_days),0)??0;
  const paused=progress?.units.filter(u=>u.api_resume_at&&new Date(u.api_resume_at).getTime()>Date.now())??[];
  const complete=Boolean(progress?.enabled)&&total>0&&verified>=total&&errors===0&&!failed&&paused.length===0;
  return <aside role="status" className={`mb-5 rounded-2xl border px-4 py-3 text-sm ${complete?"border-[#cce6d7] bg-[#edf8f1] text-[#235d3b]":"border-[#ebdbad] bg-[#fff9e9] text-[#765c21]"}`}>
    <p className="font-semibold">{complete?"Conferência inicial do Clinicorp concluída":"Valores em conferência com o Clinicorp"}</p>
    <p className="mt-1 text-xs leading-relaxed">{failed?"Não foi possível confirmar a atualização agora. Os totais ainda precisam de conferência.":!progress?"Consultando o andamento da atualização financeira…":!progress.enabled?"A atualização financeira está pausada. Os totais ainda precisam de conferência.":complete?"O histórico passou pela conferência inicial. A atualização automática continua em segundo plano.":`${verified.toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")} dias revisados. A recuperação continua automaticamente; os totais ainda estão em conferência.${errors?" Alguns períodos aguardam nova tentativa automática.":""}`}</p>
    {paused.length>0&&<p className="mt-2 text-xs leading-relaxed">A atualização de {paused.map(u=>u.name).join(" e ")} está aguardando o Clinicorp. Nova tentativa automática a partir de {new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",hour:"2-digit",minute:"2-digit"}).format(new Date(paused.map(u=>u.api_resume_at!).sort()[0]))}.</p>}
  </aside>;
}
