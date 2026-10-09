import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type UnitCode = "sorocaba" | "salto_de_pirapora";
type Row = Record<string, unknown>;

const API_BASE="https://api.clinicorp.com/rest/v1";
const SECRETS:Record<UnitCode,{username:string;token:string}>={
  sorocaba:{username:"CLINICORP_SOROCABA_USERNAME",token:"CLINICORP_SOROCABA_TOKEN"},
  salto_de_pirapora:{username:"CLINICORP_SALTO_USERNAME",token:"CLINICORP_SALTO_TOKEN"},
};

const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
function rowsOf(payload:unknown):Row[]{
  if(Array.isArray(payload))return payload.filter((r):r is Row=>!!r&&typeof r==="object"&&!Array.isArray(r));
  if(!payload||typeof payload!=="object"||Array.isArray(payload))return[];
  const x=payload as Row;
  for(const key of ["data","Data","items","Items","results","Results"]){
    const value=x[key];
    if(Array.isArray(value))return value.filter((r):r is Row=>!!r&&typeof r==="object"&&!Array.isArray(r));
  }
  return[x];
}
function rowId(r:Row){return String(r.id??r.ExternalTxId??"").trim()}
function dedupe(rows:Row[]){
  const map=new Map<string,Row>();
  for(const row of rows)map.set(rowId(row)||JSON.stringify(row),row);
  return[...map.values()];
}
function chunks<T>(rows:T[],size:number){const out:T[][]=[];for(let i=0;i<rows.length;i+=size)out.push(rows.slice(i,i+size));return out}

async function fetchPostDate(subscriber:string,credentials:{username:string;token:string},postDate:string){
  const url=new URL(`${API_BASE}/payment/list`);
  url.searchParams.set("subscriber_id",subscriber);
  url.searchParams.set("from",postDate);
  url.searchParams.set("to",postDate);
  url.searchParams.set("date_type","postDate");
  url.searchParams.set("include_total_amount","X");
  url.searchParams.set("get_amount_with_discounts","X");
  const response=await fetch(url,{
    headers:{
      accept:"application/json",
      authorization:`Basic ${btoa(`${credentials.username}:${credentials.token}`)}`,
    },
    signal:AbortSignal.timeout(25000),
  });
  const text=await response.text();
  if(!response.ok)throw new Error(`Clinicorp HTTP ${response.status}: ${text.slice(0,200)}`);
  if(text.length>6000000)throw new Error("Resposta do Clinicorp excedeu o limite seguro.");
  try{return dedupe(rowsOf(JSON.parse(text) as unknown))}
  catch{throw new Error("O Clinicorp retornou uma resposta inválida.")}
}

async function refreshSnapshot(admin:ReturnType<typeof createClient>,unitId:number,rows:Row[]){
  for(const batch of chunks(rows,100)){
    const {error}=await admin.rpc("refresh_clinicorp_payment_snapshot_rows",{p_unit_id:unitId,p_rows:batch});
    if(error)throw new Error(`Snapshot: ${error.message}`);
  }
}

async function syncReceivables(admin:ReturnType<typeof createClient>,unitId:number,rows:Row[]){
  for(const batch of chunks(rows,1)){
    const {error}=await admin.rpc("upsert_clinicorp_boleto_receivables",{p_unit_id:unitId,p_rows:batch,p_sync_run_id:null});
    if(error)throw new Error(`Recebíveis: ${error.message}`);
  }
}

async function reconcileTerminal(admin:ReturnType<typeof createClient>,unitId:number,rows:Row[]){
  const terminal=rows.filter((row)=>{
    const paid=String(row.PaymentReceived??"").toUpperCase()==="X"||String(row.PaymentConfirmed??"").toUpperCase()==="X";
    const cancelled=String(row.Canceled??"").toUpperCase()==="X"||String(row.CancelInstallment??"").toUpperCase()==="X"||["CANCELED","CANCELLED"].includes(String(row.ExternalStatus??"").toUpperCase());
    return paid||cancelled;
  });
  for(const batch of chunks(terminal,80)){
    const {error}=await admin.rpc("reconcile_clinicorp_terminal_rows",{p_unit_id:unitId,p_rows:batch});
    if(error)throw new Error(`Terminais: ${error.message}`);
  }
}

Deno.serve(async(req)=>{
  if(req.method!=="POST")return reply({ok:false,message:"Use POST."},405);

  const supabaseUrl=Deno.env.get("SUPABASE_URL")??"";
  const serviceRole=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
  if(!supabaseUrl||!serviceRole)return reply({ok:false,message:"Configuração interna indisponível."},500);

  const admin=createClient(supabaseUrl,serviceRole,{auth:{persistSession:false}});
  const incoming=req.headers.get("x-lyvra-cron-key")??"";
  const {data:secret,error:secretError}=await admin.from("system_secrets").select("secret").eq("key","clinicorp_auto_sync_key").maybeSingle();
  if(secretError||!secret?.secret||incoming!==secret.secret)return reply({ok:false,message:"Chamada não autorizada."},401);

  let requestBody:Row={};
  try{requestBody=await req.json()}catch{}
  const requestedUnit=String(requestBody.unit_code??"").trim();
  const requestedDates=Array.isArray(requestBody.post_dates)
    ? requestBody.post_dates.map((value)=>String(value)).filter((value)=>/^\d{4}-\d{2}-\d{2}$/.test(value)).slice(0,8)
    : [];
  const unitCodes:UnitCode[]=requestedUnit==="sorocaba"||requestedUnit==="salto_de_pirapora"
    ? [requestedUnit as UnitCode]
    : ["sorocaba","salto_de_pirapora"];

  const results:Row[]=[];

  for(const unitCode of unitCodes){
    try{
      const {data:unit,error:unitError}=await admin.from("units").select("id,code,name").eq("code",unitCode).eq("is_active",true).maybeSingle();
      if(unitError||!unit)throw new Error("Unidade não encontrada.");

      const {data:connection,error:connectionError}=await admin.from("integration_connections").select("status,non_secret_config").eq("provider","clinicorp").eq("unit_id",unit.id).maybeSingle();
      if(connectionError||!connection||connection.status!=="connected")throw new Error("Clinicorp não conectado.");

      const config=(connection.non_secret_config??{}) as Row;
      const subscriber=String(config.subscriber_id??"").trim();
      const names=SECRETS[unitCode];
      const username=Deno.env.get(names.username)?.trim()??"";
      const token=Deno.env.get(names.token)?.trim()??"";
      if(!subscriber||!username||!token)throw new Error("Configuração do Clinicorp incompleta.");

      let dayList:Row[]=[];
      if(requestedDates.length){
        dayList=requestedDates.map((postDate)=>({post_date:postDate,active_cases:0,pending_absence:0}));
      }else{
        const {data:days,error:daysError}=await admin.rpc("get_collection_postdate_reconciliation_days",{p_unit_id:unit.id,p_limit:1});
        if(daysError)throw new Error(`Fila de reconciliação: ${daysError.message}`);
        dayList=(days??[]) as Row[];
      }
      const fetched=await Promise.all(dayList.map(async(item)=>{
        const postDate=String(item.post_date??"");
        try{
          const rows=await fetchPostDate(subscriber,{username,token},postDate);
          return{postDate,item,rows,error:null as string|null};
        }catch(error){
          return{postDate,item,rows:[] as Row[],error:error instanceof Error?error.message:"Falha"};
        }
      }));

      const summary={
        unit:unit.name,
        checkedDays:0,
        failedDays:0,
        checkedCases:0,
        missingRows:0,
        terminalRows:0,
        days:[] as Row[],
      };

      for(const item of fetched){
        if(item.error){
          summary.failedDays+=1;
          summary.days.push({postDate:item.postDate,error:item.error});
          continue;
        }

        const {data:activeIds,error:activeIdsError}=await admin.rpc("get_collection_postdate_active_ids",{
          p_unit_id:unit.id,
          p_post_date:item.postDate,
        });
        if(activeIdsError){
          summary.failedDays+=1;
          summary.days.push({postDate:item.postDate,error:activeIdsError.message});
          continue;
        }

        const activeSet=new Set(
          ((activeIds??[]) as Row[])
            .map((row)=>String(row.clinicorp_installment_id??"").trim())
            .filter(Boolean),
        );
        const exactById=new Map(item.rows.map((row)=>[rowId(row),row]));
        const relevantRows=item.rows.filter((row)=>activeSet.has(rowId(row)));
        const presenceRows=[...activeSet].map((id)=>{
          const source=exactById.get(id);
          if(!source)return{id,present:false};
          return{
            id,
            present:true,
            payment_form:String(source.PaymentForm??""),
            paid:String(source.PaymentReceived??"").toUpperCase()==="X"||String(source.PaymentConfirmed??"").toUpperCase()==="X",
            cancelled:String(source.Canceled??"").toUpperCase()==="X"||String(source.CancelInstallment??"").toUpperCase()==="X"||["CANCELED","CANCELLED"].includes(String(source.ExternalStatus??"").toUpperCase()),
          };
        });

        await refreshSnapshot(admin,Number(unit.id),relevantRows);
        await syncReceivables(admin,Number(unit.id),relevantRows);
        await reconcileTerminal(admin,Number(unit.id),relevantRows);

        const {data:reconciled,error:reconcileError}=await admin.rpc("reconcile_clinicorp_postdate_day",{
          p_unit_id:unit.id,
          p_post_date:item.postDate,
          p_rows:presenceRows,
        });
        if(reconcileError){
          summary.failedDays+=1;
          summary.days.push({postDate:item.postDate,error:reconcileError.message});
          continue;
        }

        const row=(reconciled?.[0]??{}) as Row;
        summary.checkedDays+=1;
        summary.checkedCases+=Number(row.local_active_before??0);
        summary.missingRows+=Number(row.missing_rows??0);
        summary.terminalRows+=Number(row.terminal_rows??0);
        summary.days.push({
          postDate:item.postDate,
          activeCases:Number(item.item.active_cases??0),
          pendingAbsence:Number(item.item.pending_absence??0),
          returnedRows:item.rows.length,
          relevantRows:relevantRows.length,
          presenceRows:presenceRows.length,
          missingRows:Number(row.missing_rows??0),
        });
      }

      results.push({ok:true,...summary});
    }catch(error){
      results.push({ok:false,unit:unitCode,message:error instanceof Error?error.message:"Falha"});
    }
  }

  return reply({ok:results.every((item)=>item.ok),results});
});
