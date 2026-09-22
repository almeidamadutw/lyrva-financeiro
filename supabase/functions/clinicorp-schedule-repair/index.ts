import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type UnitCode="sorocaba"|"salto_de_pirapora";
type Row=Record<string,unknown>;

const API_BASE="https://api.clinicorp.com/rest/v1";
const DIRECTORY_BATCH=80;
const PAYMENT_BATCH=35;
const RECEIVABLE_BATCH=100;
const SECRETS:Record<UnitCode,{username:string;token:string}>={
  sorocaba:{username:"CLINICORP_SOROCABA_USERNAME",token:"CLINICORP_SOROCABA_TOKEN"},
  salto_de_pirapora:{username:"CLINICORP_SALTO_USERNAME",token:"CLINICORP_SALTO_TOKEN"},
};

const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
function chunks<T>(rows:T[],size:number){const out:T[][]=[];for(let i=0;i<rows.length;i+=size)out.push(rows.slice(i,i+size));return out}
function rowsOf(payload:unknown):Row[]{if(Array.isArray(payload))return payload.filter((r):r is Row=>!!r&&typeof r==="object"&&!Array.isArray(r));if(!payload||typeof payload!=="object"||Array.isArray(payload))return[];const x=payload as Row;for(const key of ["data","Data","items","Items","results","Results"]){const value=x[key];if(Array.isArray(value))return value.filter((r):r is Row=>!!r&&typeof r==="object"&&!Array.isArray(r))}return[x]}
const rowId=(r:Row)=>String(r.id??r.ExternalTxId??"").trim();
function dedupe(rows:Row[]){const m=new Map<string,Row>();for(const r of rows)m.set(rowId(r)||JSON.stringify(r),r);return[...m.values()]}
function confirmed(rows:Row[]){const m=new Map<string,Row>();for(const r of rows){const id=rowId(r);if(id&&String(r.PatientId??"").trim()&&String(r.PaymentConfirmed??"").toUpperCase()==="X"&&String(r.ConfirmedDate??"").trim())m.set(id,r)}return[...m.values()]}

async function fetchExactDay(subscriber:string,credentials:{username:string;token:string},date:string){
  const url=new URL(`${API_BASE}/payment/list`);
  for(const [k,v] of Object.entries({subscriber_id:subscriber,from:date,to:date,include_total_amount:"X",get_amount_with_discounts:"X",date_type:"postDate"}))url.searchParams.set(k,v);
  const response=await fetch(url,{headers:{accept:"application/json",authorization:`Basic ${btoa(`${credentials.username}:${credentials.token}`)}`},signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`Clinicorp HTTP ${response.status}`);
  const text=await response.text();
  if(text.length>6000000)throw new Error("Resposta do Clinicorp excedeu o limite seguro.");
  return dedupe(rowsOf(JSON.parse(text) as unknown));
}

async function syncDirectory(admin:ReturnType<typeof createClient>,unitId:number,rows:Row[]){
  let processed=0,created=0,updated=0,review=0,invalid=0;
  for(const batch of chunks(rows,DIRECTORY_BATCH)){
    const {data,error}=await admin.rpc("upsert_clinicorp_financial_directory",{p_unit_id:unitId,p_rows:batch,p_sync_run_id:null});
    if(error)throw new Error(`Diretório: ${error.message}`);
    const r=data?.[0]??{};
    processed+=Number(r.processed_count??0);created+=Number(r.created_patients??0);
    updated+=Number(r.updated_patients??0)+Number(r.linked_patients??0);
    review+=Number(r.review_count??0);invalid+=Number(r.invalid_count??0);
  }
  return{processed,created,updated,review,invalid};
}

async function syncPayments(admin:ReturnType<typeof createClient>,unitId:number,rows:Row[]){
  let processed=0,created=0,updated=0,failed=0,paid=0;
  for(const batch of chunks(confirmed(rows),PAYMENT_BATCH)){
    const {data,error}=await admin.rpc("ingest_clinicorp_payments",{p_unit_id:unitId,p_rows:batch,p_sync_run_id:null});
    if(error){processed+=batch.length;failed+=batch.length;continue}
    const r=data?.[0]??{};
    processed+=Number(r.processed_count??0);created+=Number(r.created_count??0);
    updated+=Number(r.updated_count??0);failed+=Number(r.failed_count??0);paid+=Number(r.paid_installments??0);
  }
  return{processed,created,updated,failed,paid};
}

async function syncReceivables(admin:ReturnType<typeof createClient>,unitId:number,rows:Row[]){
  let processed=0,created=0,updated=0,open=0,paid=0,skipped=0,failed=0;
  for(const batch of chunks(rows,RECEIVABLE_BATCH)){
    const {data,error}=await admin.rpc("upsert_clinicorp_boleto_receivables",{p_unit_id:unitId,p_rows:batch,p_sync_run_id:null});
    if(error)throw new Error(`Recebíveis: ${error.message}`);
    const r=data?.[0]??{};
    processed+=Number(r.processed_count??0);created+=Number(r.created_count??0);
    updated+=Number(r.updated_count??0);open+=Number(r.open_count??0);
    paid+=Number(r.paid_count??0);skipped+=Number(r.skipped_count??0);failed+=Number(r.failed_count??0);
  }
  return{processed,created,updated,open,paid,skipped,failed};
}

Deno.serve(async(req)=>{
  if(req.method!=="POST")return reply({ok:false,message:"Use POST."},405);
  const url=Deno.env.get("SUPABASE_URL")??"",key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
  if(!url||!key)return reply({ok:false,message:"Configuração interna indisponível."},500);
  const admin=createClient(url,key,{auth:{persistSession:false}});
  const incoming=req.headers.get("x-lyvra-cron-key")??"";
  const {data:secret}=await admin.from("system_secrets").select("secret").eq("key","clinicorp_auto_sync_key").maybeSingle();
  if(!secret?.secret||incoming!==secret.secret)return reply({ok:false,message:"Chamada não autorizada."},401);

  const results=[] as Row[];
  for(const unitCode of ["sorocaba","salto_de_pirapora"] as UnitCode[]){
    let runId:number|null=null;
    try{
      const {data:unit,error:unitError}=await admin.from("units").select("id,name").eq("code",unitCode).eq("is_active",true).single();
      if(unitError||!unit)throw new Error("Unidade não encontrada.");
      const {data:connection,error:connectionError}=await admin.from("integration_connections").select("id,status,non_secret_config").eq("provider","clinicorp").eq("unit_id",unit.id).maybeSingle();
      if(connectionError||!connection||connection.status!=="connected")throw new Error("Clinicorp não conectado.");
      const config=(connection.non_secret_config??{}) as Row;
      const subscriber=String(config.subscriber_id??"").trim();
      const names=SECRETS[unitCode],username=Deno.env.get(names.username)?.trim()??"",token=Deno.env.get(names.token)?.trim()??"";
      if(!subscriber||!username||!token)throw new Error("Credenciais incompletas.");

      const {data:days,error:daysError}=await admin.rpc("get_clinicorp_schedule_repair_days",{p_unit_id:Number(unit.id),p_limit:1});
      if(daysError)throw new Error(`Fila: ${daysError.message}`);
      const target=days?.[0] as Row|undefined;
      if(!target){results.push({unit:unit.name,ok:true,repaired:false});continue}
      const postDate=String(target.post_date);

      const {data:run,error:runError}=await admin.from("sync_runs").insert({
        connection_id:connection.id,unit_id:unit.id,entity_type:"clinicorp_schedule_repair",
        direction:"inbound",status:"running",metadata:{post_date:postDate}
      }).select("id").single();
      if(runError||!run)throw new Error("Não foi possível registrar o reparo.");
      runId=Number(run.id);

      const rows=await fetchExactDay(subscriber,{username,token},postDate);
      const directory=await syncDirectory(admin,Number(unit.id),rows);
      const payments=await syncPayments(admin,Number(unit.id),rows);
      const receivables=await syncReceivables(admin,Number(unit.id),rows);
      const completedAt=new Date().toISOString();
      const errorCount=payments.failed+receivables.failed;

      await admin.from("clinicorp_schedule_repair_log").upsert({
        unit_id:unit.id,post_date:postDate,last_repaired_at:completedAt,row_count:rows.length,
        attempts:1,last_error:null,updated_at:completedAt
      },{onConflict:"unit_id,post_date"});

      await admin.from("sync_runs").update({
        status:errorCount?"partial":"completed",
        processed_count:directory.processed,
        created_count:directory.created+payments.created+receivables.created,
        updated_count:directory.updated+payments.updated+receivables.updated,
        skipped_count:directory.review+directory.invalid+receivables.skipped,
        error_count:errorCount,
        metadata:{post_date:postDate,row_count:rows.length,directory,payments,receivables},
        completed_at:completedAt
      }).eq("id",runId);

      results.push({unit:unit.name,ok:true,repaired:true,postDate,rowCount:rows.length,errorCount});
    }catch(error){
      const message=error instanceof Error?error.message.slice(0,500):"Falha no reparo.";
      if(runId)await admin.from("sync_runs").update({status:"failed",error_count:1,error_summary:message,completed_at:new Date().toISOString()}).eq("id",runId);
      results.push({unit:unitCode,ok:false,message});
    }
  }
  return reply({ok:results.every((r)=>r.ok),results});
});
