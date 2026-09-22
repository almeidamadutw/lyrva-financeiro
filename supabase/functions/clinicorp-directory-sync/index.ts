import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type UnitCode = "sorocaba" | "salto_de_pirapora";
type Row = Record<string, unknown>;
type DirectorySummary = { processedCount:number; createdPatients:number; linkedPatients:number; updatedPatients:number; reviewCount:number; invalidCount:number };
type ReceivableSummary = { processedCount:number; createdCount:number; updatedCount:number; paidCount:number; openCount:number; skippedCount:number; failedCount:number };
type PaymentSummary = { processedCount:number; createdCount:number; updatedCount:number; skippedCount:number; failedCount:number; paidInstallments:number };

const API_BASE="https://api.clinicorp.com/rest/v1";
const HISTORY_FLOOR="2015-01-01";
const RPC_BATCH=80;
const PAYMENT_BATCH=35;
const RECEIVABLE_BATCH=100;
const SCHEDULE_REPAIR_DAYS=8;
const SECRETS:Record<UnitCode,{username:string;token:string}>={
  sorocaba:{username:"CLINICORP_SOROCABA_USERNAME",token:"CLINICORP_SOROCABA_TOKEN"},
  salto_de_pirapora:{username:"CLINICORP_SALTO_USERNAME",token:"CLINICORP_SALTO_TOKEN"},
};

const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
const day=(date=new Date())=>new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
function addDays(value:string,days:number){const d=new Date(`${value}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
const maxDate=(a:string,b:string)=>a>b?a:b;
function chunks<T>(rows:T[],size:number){const out:T[][]=[];for(let i=0;i<rows.length;i+=size)out.push(rows.slice(i,i+size));return out}
function rowsOf(payload:unknown):Row[]{if(Array.isArray(payload))return payload.filter((r):r is Row=>!!r&&typeof r==="object"&&!Array.isArray(r));if(!payload||typeof payload!=="object"||Array.isArray(payload))return[];const x=payload as Row;for(const key of ["data","Data","items","Items","results","Results"]){const value=x[key];if(Array.isArray(value))return value.filter((r):r is Row=>!!r&&typeof r==="object"&&!Array.isArray(r))}return[x]}
const rowId=(r:Row)=>String(r.id??r.ExternalTxId??"").trim();
function confirmed(rows:Row[]){const m=new Map<string,Row>();for(const r of rows){const id=rowId(r);if(id&&String(r.PatientId??"").trim()&&String(r.PaymentConfirmed??"").toUpperCase()==="X"&&String(r.ConfirmedDate??"").trim())m.set(id,r)}return[...m.values()]}
function dedupe(rows:Row[]){const m=new Map<string,Row>();for(const r of rows)m.set(rowId(r)||JSON.stringify(r),r);return[...m.values()]}
async function fetchPayments(subscriber:string,credentials:{username:string;token:string},from:string,to:string,dateType?:string){
  const url=new URL(`${API_BASE}/payment/list`);
  for(const [k,v] of Object.entries({subscriber_id:subscriber,from,to,include_total_amount:"X",get_amount_with_discounts:"X",date_type:dateType}))if(v)url.searchParams.set(k,v);
  const response=await fetch(url,{headers:{accept:"application/json",authorization:`Basic ${btoa(`${credentials.username}:${credentials.token}`)}`},signal:AbortSignal.timeout(25000)});
  if(!response.ok){if([401,403].includes(response.status))throw new Error("O Clinicorp recusou as credenciais desta unidade.");throw new Error(`O Clinicorp respondeu com HTTP ${response.status}.`)}
  const text=await response.text();if(text.length>6000000)throw new Error("Uma janela financeira do Clinicorp excedeu o limite seguro de leitura.");
  try{return JSON.parse(text) as unknown}catch{throw new Error("O Clinicorp retornou uma resposta inválida.")}
}

const emptyDirectory=():DirectorySummary=>({processedCount:0,createdPatients:0,linkedPatients:0,updatedPatients:0,reviewCount:0,invalidCount:0});
const emptyReceivables=():ReceivableSummary=>({processedCount:0,createdCount:0,updatedCount:0,paidCount:0,openCount:0,skippedCount:0,failedCount:0});
const emptyPayments=():PaymentSummary=>({processedCount:0,createdCount:0,updatedCount:0,skippedCount:0,failedCount:0,paidInstallments:0});
function addDirectory(a:DirectorySummary,b:DirectorySummary){for(const k of Object.keys(a) as (keyof DirectorySummary)[])a[k]+=b[k]}
function addReceivables(a:ReceivableSummary,b:ReceivableSummary){for(const k of Object.keys(a) as (keyof ReceivableSummary)[])a[k]+=b[k]}
function addPayments(a:PaymentSummary,b:PaymentSummary){for(const k of Object.keys(a) as (keyof PaymentSummary)[])a[k]+=b[k]}

async function syncDirectory(admin:ReturnType<typeof createClient>,unitId:number,rows:Row[]){const total=emptyDirectory();for(const batch of chunks(rows,RPC_BATCH)){const {data,error}=await admin.rpc("upsert_clinicorp_financial_directory",{p_unit_id:unitId,p_rows:batch,p_sync_run_id:null});if(error)throw new Error(`A base canônica não pôde ser atualizada: ${error.message}`);const r=data?.[0]??{};addDirectory(total,{processedCount:Number(r.processed_count??0),createdPatients:Number(r.created_patients??0),linkedPatients:Number(r.linked_patients??0),updatedPatients:Number(r.updated_patients??0),reviewCount:Number(r.review_count??0),invalidCount:Number(r.invalid_count??0)})}return total}
async function syncReceivables(admin:ReturnType<typeof createClient>,unitId:number,rows:Row[]){const total=emptyReceivables();for(const batch of chunks(rows,RECEIVABLE_BATCH)){const {data,error}=await admin.rpc("upsert_clinicorp_boleto_receivables",{p_unit_id:unitId,p_rows:batch,p_sync_run_id:null});if(error)throw new Error(`Os boletos do Clinicorp não puderam ser atualizados: ${error.message}`);const r=data?.[0]??{};addReceivables(total,{processedCount:Number(r.processed_count??0),createdCount:Number(r.created_count??0),updatedCount:Number(r.updated_count??0),paidCount:Number(r.paid_count??0),openCount:Number(r.open_count??0),skippedCount:Number(r.skipped_count??0),failedCount:Number(r.failed_count??0)})}return total}
async function syncPayments(admin:ReturnType<typeof createClient>,unitId:number,rows:Row[]){const total=emptyPayments();for(const batch of chunks(confirmed(rows),PAYMENT_BATCH)){const {data,error}=await admin.rpc("ingest_clinicorp_payments",{p_unit_id:unitId,p_rows:batch,p_sync_run_id:null});if(error){total.processedCount+=batch.length;total.failedCount+=batch.length;continue}const r=data?.[0]??{};addPayments(total,{processedCount:Number(r.processed_count??0),createdCount:Number(r.created_count??0),updatedCount:Number(r.updated_count??0),skippedCount:Number(r.skipped_count??0),failedCount:Number(r.failed_count??0),paidInstallments:Number(r.paid_installments??0)})}return total}
async function openOverdueSnapshotRows(admin:ReturnType<typeof createClient>,unitId:number,today:string){
  const rows:Row[]=[];
  for(let offset=0;;offset+=1000){
    const {data,error}=await admin
      .from("clinicorp_payment_snapshot")
      .select("raw")
      .eq("unit_id",unitId)
      .eq("payment_received",false)
      .eq("payment_confirmed",false)
      .eq("cancelled",false)
      .ilike("payment_form","%Boleto%")
      .gt("amount",0)
      .lte("due_date",today)
      .order("due_date",{ascending:true})
      .range(offset,offset+999);
    if(error)throw new Error(`Os recebíveis vencidos do Clinicorp não puderam ser conferidos: ${error.message}`);
    const page=(data??[]).map((item:Row)=>(item.raw??{}) as Row).filter((item:Row)=>rowId(item));
    rows.push(...page);
    if((data??[]).length<1000)break;
  }
  return dedupe(rows);
}

async function repairScheduleDays(
  admin:ReturnType<typeof createClient>,
  unitId:number,
  subscriber:string,
  credentials:{username:string;token:string},
  directory:DirectorySummary,
  receivables:ReceivableSummary,
  payments:PaymentSummary,
  explicitDates?:string[],
){
  let dates:string[]=[];
  if(explicitDates?.length){
    dates=[...new Set(explicitDates.filter((value)=>/^\d{4}-\d{2}-\d{2}$/.test(value)))].slice(0,20);
  }else{
    const {data,error}=await admin.rpc("get_clinicorp_schedule_repair_days",{p_unit_id:unitId,p_limit:SCHEDULE_REPAIR_DAYS});
    if(error)throw new Error(`A fila de reparo financeiro não pôde ser consultada: ${error.message}`);
    dates=(data??[]).map((row:Row)=>String(row.post_date??"")).filter(Boolean);
  }

  let repairedRows=0,failedDays=0;
  const repairedDates:string[]=[];
  for(const repairDate of dates){
    try{
      const exact=dedupe(rowsOf(await fetchPayments(subscriber,credentials,repairDate,repairDate,"postDate")));
      if(!exact.length)continue;
      addDirectory(directory,await syncDirectory(admin,unitId,exact));
      addPayments(payments,await syncPayments(admin,unitId,exact));
      addReceivables(receivables,await syncReceivables(admin,unitId,exact));
      repairedRows+=exact.length;
      repairedDates.push(repairDate);
    }catch{
      failedDays+=1;
    }
  }
  return{requestedDays:dates.length,repairedDays:repairedDates.length,repairedRows,failedDays,repairedDates};
}

Deno.serve(async req=>{
  if(req.method!=="POST")return reply({ok:false,message:"Use POST."},405);
  const url=Deno.env.get("SUPABASE_URL")??"",key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";if(!url||!key)return reply({ok:false,message:"Configuração interna indisponível."},500);
  const admin=createClient(url,key,{auth:{persistSession:false}});
  const incoming=req.headers.get("x-lyvra-cron-key")??"";
  const {data:secret,error:secretError}=await admin.from("system_secrets").select("secret").eq("key","clinicorp_auto_sync_key").maybeSingle();if(secretError||!secret?.secret||incoming!==secret.secret)return reply({ok:false,message:"Chamada não autorizada."},401);
  let requestBody:Row={};try{requestBody=await req.json()}catch{}
  const today=day(),recentFrom=addDays(today,-7);

  const syncUnit=async(unitCode:UnitCode)=>{let runId:number|null=null,connectionId:number|null=null;try{
    const {data:unit,error:unitError}=await admin.from("units").select("id,code,name,is_active").eq("code",unitCode).eq("is_active",true).maybeSingle();if(unitError||!unit)throw new Error("Unidade não encontrada.");
    const {data:connection,error:connectionError}=await admin.from("integration_connections").select("id,status,non_secret_config").eq("provider","clinicorp").eq("unit_id",unit.id).maybeSingle();if(connectionError||!connection||connection.status!=="connected")throw new Error("Conexão do Clinicorp não está ativa.");connectionId=Number(connection.id);
    const config=(connection.non_secret_config??{}) as Row,subscriber=String(config.subscriber_id??"").trim();if(!subscriber)throw new Error("Assinante do Clinicorp não identificado.");
    const names=SECRETS[unitCode],username=Deno.env.get(names.username)?.trim()??"",token=Deno.env.get(names.token)?.trim()??"";if(!username||!token)throw new Error("Credenciais da unidade não estão configuradas.");const credentials={username,token};
    const {data:run,error:runError}=await admin.from("sync_runs").insert({connection_id:connection.id,unit_id:unit.id,entity_type:"patient_directory_auto_sync",direction:"inbound",status:"running",metadata:{mode:"clinicorp_canonical_financial_structure",recent_from:recentFrom,recent_to:today}}).select("id").single();if(runError||!run)throw new Error("Não foi possível registrar a sincronização canônica.");runId=Number(run.id);

    const directory=emptyDirectory(),receivables=emptyReceivables(),payments=emptyPayments();
    const [receivedPayload,postedPayload]=await Promise.all([fetchPayments(subscriber,credentials,recentFrom,today),fetchPayments(subscriber,credentials,recentFrom,today,"postDate")]);
    const received=rowsOf(receivedPayload),posted=rowsOf(postedPayload),combined=dedupe([...received,...posted]);
    addDirectory(directory,await syncDirectory(admin,Number(unit.id),combined));
    addPayments(payments,await syncPayments(admin,Number(unit.id),combined));
    addReceivables(receivables,await syncReceivables(admin,Number(unit.id),posted));

    // Broad PostDate windows can truncate long installment schedules in Clinicorp.
    // Re-fetch a few incomplete creation days exactly so every real installment
    // is recovered without inventing data from spreadsheets.
    const requestedRepairDates=String(requestBody.repair_unit_code??"")===unitCode&&Array.isArray(requestBody.repair_post_dates)
      ? (requestBody.repair_post_dates as unknown[]).map(String)
      : undefined;
    const scheduleRepair=await repairScheduleDays(admin,Number(unit.id),subscriber,credentials,directory,receivables,payments,requestedRepairDates);

    // Reconcile every overdue open boleto already known by Clinicorp, not only
    // rows created in the last seven days. This covers long payment plans whose
    // PostDate is months/years older than the current due date.
    const overdueSnapshot=await openOverdueSnapshotRows(admin,Number(unit.id),today);
    addDirectory(directory,await syncDirectory(admin,Number(unit.id),overdueSnapshot));
    addReceivables(receivables,await syncReceivables(admin,Number(unit.id),overdueSnapshot));

    let cursor=String(config.directory_backfill_before??today),completed=Boolean(config.directory_backfill_completed_at);const windows:Array<{from:string;to:string;rows:number}>=[];
    if(!completed&&cursor>=HISTORY_FLOOR){const daysBack=unitCode==="salto_de_pirapora"?7:14;const windowTo=cursor,windowFrom=maxDate(HISTORY_FLOOR,addDays(windowTo,-daysBack));const history=rowsOf(await fetchPayments(subscriber,credentials,windowFrom,windowTo,"postDate"));addDirectory(directory,await syncDirectory(admin,Number(unit.id),history));addPayments(payments,await syncPayments(admin,Number(unit.id),history));addReceivables(receivables,await syncReceivables(admin,Number(unit.id),history));windows.push({from:windowFrom,to:windowTo,rows:history.length});cursor=addDays(windowFrom,-1);completed=cursor<HISTORY_FLOOR}

    const finishedAt=new Date().toISOString(),result={directory,receivables,payments};const nextConfig:Row={...config,directory_source:"payment/list",directory_last_sync_at:finishedAt,directory_recent_from:recentFrom,directory_recent_to:today,directory_backfill_floor:HISTORY_FLOOR,directory_backfill_before:cursor,directory_backfill_last_windows:windows,directory_backfill_completed_at:completed?(config.directory_backfill_completed_at??finishedAt):null,directory_last_summary:directory,collection_receivables_last_summary:receivables,collection_receivables_last_sync_at:finishedAt};
    await Promise.all([admin.from("sync_runs").update({status:payments.failedCount||receivables.failedCount?"partial":"completed",processed_count:directory.processedCount,created_count:directory.createdPatients+receivables.createdCount+payments.createdCount,updated_count:directory.updatedPatients+directory.linkedPatients+receivables.updatedCount+payments.updatedCount,skipped_count:directory.reviewCount+directory.invalidCount+receivables.skippedCount+payments.skippedCount,error_count:payments.failedCount+receivables.failedCount,metadata:{mode:"clinicorp_canonical_collection_receivables",recent_from:recentFrom,recent_to:today,schedule_repair:scheduleRepair,overdue_snapshot_rows:overdueSnapshot.length,historical_windows:windows,backfill_before:cursor,backfill_completed:completed,result},completed_at:finishedAt}).eq("id",run.id),admin.from("integration_connections").update({non_secret_config:nextConfig,last_error:null}).eq("id",connection.id)]);
    return{unit:unit.name,ok:true,backfillCompleted:completed,backfillBefore:cursor,scheduleRepair,windows,result};
  }catch(error){const message=error instanceof Error?error.message.slice(0,500):"Falha na sincronização canônica.",finishedAt=new Date().toISOString();if(runId)await admin.from("sync_runs").update({status:"failed",error_count:1,error_summary:message,completed_at:finishedAt}).eq("id",runId);if(connectionId)await admin.from("integration_connections").update({last_error:message}).eq("id",connectionId);return{unit:unitCode,ok:false,message}}};

  const results=await Promise.all([syncUnit("sorocaba"),syncUnit("salto_de_pirapora")]);return reply({ok:results.every(r=>r.ok),recentFrom,today,results});
});
