import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSourceDay,processJob} from '../supabase/functions/clinicorp-financial-sync/worker.mjs';

const day='2026-09-15';
const row={id:123,PatientId:456,PaymentForm:'Boleto',PostDate:'2026-09-16T01:00:00Z',DueDate:'2026-10-15',Amount:250,PaymentReceived:'',PaymentConfirmed:''};
test('creation dates use Sao Paulo and exact decimal source amounts',()=>{
  const [result]=validateSourceDay([{...row,Amount:'250,01'}],day);
  assert.equal(result.id,'123');assert.equal(result.Amount,'250,01');
});
test('error responses, incomplete pages and invalid money cannot reach financial writes',()=>{
  for(const payload of [{error:'failure'},{data:[row],hasMore:true},[{...row,Amount:'1.000,00'}],[{...row,id:9007199254740992}],[{...row,PaymentConfirmed:'yes'}],[{...row,PatientId:null}],[{...row,PostDate:'2026-09-15T01:00:00Z'}]]) {
    assert.throws(()=>validateSourceDay(payload,day));
  }
});
test('conflicting duplicates are rejected and an authentic empty day is accepted',()=>{
  assert.throws(()=>validateSourceDay([row,{...row,Amount:251}],day));
  assert.deepEqual(validateSourceDay([],day),[]);
});
test('a resumed payload applies the committed cursor without fetching source again',async()=>{
  const calls=[];
  const result=await processJob({id:1,lease_token:'lease',phase:'apply'},{remainingMs:()=>30000,fetchDay:()=>assert.fail('Unexpected source refetch'),rpc:async(name)=>{
    calls.push(name);return name==='apply_clinicorp_sync_batch'?{phase:'verify',rows:25,changed:2}:{source_rows:100};
  }});
  assert.equal(result.complete,true);assert.equal(result.processed,25);
  assert.deepEqual(calls,['apply_clinicorp_sync_batch','finish_clinicorp_sync_job']);
});
test('time budget releases the lease without losing the staged cursor',async()=>{
  const calls=[];
  const result=await processJob({id:1,lease_token:'lease',phase:'apply'},{remainingMs:()=>1000,fetchDay:()=>assert.fail(),rpc:async(name,args)=>calls.push([name,args])});
  assert.equal(result.deferred,true);assert.equal(calls[0][0],'release_clinicorp_sync_job');assert.equal(calls[0][1].p_error,null);
});
test('a rejected lease cannot advance to verification',async()=>{
  const calls=[];
  await assert.rejects(()=>processJob({id:1,lease_token:'expired',phase:'apply'},{remainingMs:()=>30000,fetchDay:()=>assert.fail(),rpc:async(name)=>{calls.push(name);throw new Error('lease expired');}}),/lease expired/);
  assert.deepEqual(calls,['apply_clinicorp_sync_batch']);
});
test('zero progress cannot be recorded as successful completion',async()=>{
  await assert.rejects(()=>processJob({id:1,lease_token:'lease',phase:'apply'},{remainingMs:()=>30000,fetchDay:()=>assert.fail(),rpc:async()=>({phase:'apply',rows:0})}),/avanço/);
});

test('Clinicorp may omit both blank payment flags on an unpaid row',()=>{
 const input={...row};delete input.PaymentReceived;delete input.PaymentConfirmed;
 assert.equal(validateSourceDay([input],day).length,1);
});
