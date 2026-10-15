import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {createClient} from 'npm:@supabase/supabase-js@2.113.0';
import {processJob} from './worker.mjs';
import {retryAfterSeconds} from './source-rate.mjs';

const UNIT_SECRETS:Record<string,{username:string;token:string}>={
  sorocaba:{username:'CLINICORP_SOROCABA_USERNAME',token:'CLINICORP_SOROCABA_TOKEN'},
  salto_de_pirapora:{username:'CLINICORP_SALTO_USERNAME',token:'CLINICORP_SALTO_TOKEN'},
};
type Job={id:number;unit_id:number;unit_code:string;posting_day:string;phase:string;lease_token:string};
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});

Deno.serve(async req=>{
  if(req.method!=='POST')return reply({ok:false,message:'Use POST.'},405);
  const url=Deno.env.get('SUPABASE_URL')??'',key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
  if(!url||!key)return reply({ok:false,message:'Configuração interna indisponível.'},500);
  const admin=createClient(url,key,{auth:{persistSession:false}});
  const {data:secret,error:secretError}=await admin.from('system_secrets').select('secret').eq('key','clinicorp_auto_sync_key').maybeSingle();
  if(secretError||!secret?.secret||req.headers.get('x-lyvra-cron-key')!==secret.secret)return reply({ok:false,message:'Chamada não autorizada.'},401);
  const start=Date.now(),results:unknown[]=[];
  const rpc=async(name:string,params:Record<string,unknown>)=>{
    const {data,error}=await admin.rpc(name,params);
    if(error)throw new Error(`${name}: ${error.message}`);
    return data;
  };
  for(let turn=0;turn<12&&Date.now()-start<35_000;turn++){
    let job:Job|null=null;
    try{
      job=await rpc('claim_clinicorp_sync_job',{}) as Job|null;
      if(!job)break;
      const current=job;
      const result=await processJob(current,{
        rpc,
        remainingMs:()=>42_000-(Date.now()-start),
        fetchDay:async()=>{
          const names=UNIT_SECRETS[current.unit_code];
          if(!names)throw new Error('Unidade inválida.');
          const username=Deno.env.get(names.username)?.trim()??'',token=Deno.env.get(names.token)?.trim()??'';
          const {data:connection,error}=await admin.from('integration_connections').select('status,non_secret_config')
            .eq('provider','clinicorp').eq('unit_id',current.unit_id).maybeSingle();
          const subscriber=String(connection?.non_secret_config?.subscriber_id??'').trim();
          if(error||connection?.status!=='connected'||!subscriber||!username||!token)throw new Error('Configuração da fonte indisponível.');
          const endpoint=new URL('https://api.clinicorp.com/rest/v1/payment/list');
          endpoint.search=new URLSearchParams({subscriber_id:subscriber,from:current.posting_day,to:current.posting_day,
            date_type:'postDate',include_total_amount:'X',get_amount_with_discounts:'X'}).toString();
          let response:Response;
          try {
            response=await fetch(endpoint,{headers:{accept:'application/json',authorization:`Basic ${btoa(`${username}:${token}`)}`},signal:AbortSignal.timeout(20_000)});
          } catch(error) {
            await rpc('record_clinicorp_source_result',{p_job_id:current.id,p_lease_token:current.lease_token,p_status:0,p_retry_after_seconds:null});
            throw error;
          }
          await rpc('record_clinicorp_source_result',{p_job_id:current.id,p_lease_token:current.lease_token,
            p_status:response.status,p_retry_after_seconds:retryAfterSeconds(response.headers.get('retry-after'))});
          if(response.status!==200)throw new Error(`Clinicorp HTTP ${response.status}.`);
          const text=await response.text();
          if(text.length>6_000_000)throw new Error('Resposta maior que o limite seguro.');
          try{return JSON.parse(text);}catch{throw new Error('Resposta JSON inválida da fonte.');}
        },
      });
      results.push({job:current.id,unit:current.unit_code,postingDay:current.posting_day,...result});
      if(result.deferred)break;
    }catch(error){
      const message=error instanceof Error?error.message:'Falha no processamento.';
      if(job)await rpc('release_clinicorp_sync_job',{p_job_id:job.id,p_lease_token:job.lease_token,p_error:message}).catch(()=>undefined);
      results.push({job:job?.id??null,ok:false,error:message});
      break;
    }
  }
  return reply({ok:!results.some(r=>(r as {ok?:boolean}).ok===false),elapsedMs:Date.now()-start,results});
});
