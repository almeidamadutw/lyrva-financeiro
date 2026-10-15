-- Integration regression: run against an authorized LYVRA database; every fixture is rolled back.
begin; select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $test$
declare r jsonb; before_owner jsonb; after_owner jsonb; owner_id bigint; actual_id bigint; actual_cpf text; result record;
 j bigint; token uuid:=gen_random_uuid(); other_before jsonb; other_after jsonb; p jsonb;
begin
 select s.raw into r from public.clinicorp_payment_snapshot s where s.unit_id=1
 and private.normalize_match_text(s.raw->>'PatientName')<>private.normalize_match_text(s.raw->>'OwnerName')
 and exists(select 1 from public.patients p where p.cpf=regexp_replace(s.raw->>'OwnerCPF','[^0-9]','','g') and p.archived_at is null)
 order by s.last_seen_at desc limit 1;
 if r is null then raise exception 'Source identity fixture unavailable'; end if;
 r:=r||jsonb_build_object('PatientId','identity-test-'||token,'PatientName','Paciente de teste '||token,
   'id','identity-payment-'||token,'ExternalTxId','identity-payment-'||token);
 if private.normalize_match_text(r->>'PatientName')=private.normalize_match_text(r->>'OwnerName') then raise exception 'Fixture does not separate patient and owner'; end if;
 select id,to_jsonb(patients) into owner_id,before_owner from public.patients where cpf=regexp_replace(r->>'OwnerCPF','[^0-9]','','g') and archived_at is null;
 select * into result from public.upsert_clinicorp_financial_directory(1,jsonb_build_array(r),null);
 select pu.patient_id,pt.cpf into actual_id,actual_cpf from public.patient_units pu join public.patients pt on pt.id=pu.patient_id
 where pu.unit_id=1 and pu.clinicorp_patient_id=r->>'PatientId';
 if actual_id is null or actual_id=owner_id or actual_cpf is not null then raise exception 'Patient was not isolated from the financial owner'; end if;
 select to_jsonb(patients) into after_owner from public.patients where id=owner_id;
 if before_owner is distinct from after_owner then raise exception 'Financial owner record changed'; end if;
 if result.review_count<>0 or result.invalid_count<>0 then raise exception 'Canonical identity still needs review'; end if;

 select to_jsonb(l) into other_before from private.clinicorp_sync_unit_limits l where unit_id=2 for update;
 insert into private.clinicorp_sync_days(unit_id,posting_day,status,phase,lease_token,lease_until)
 values(1,'2098-01-01','working','fetch',token,clock_timestamp()+interval '2 minutes') returning id into j;
 perform public.record_clinicorp_source_result(j,token,429,300);
 if not exists(select 1 from private.clinicorp_sync_unit_limits where unit_id=1 and last_status=429 and next_source_at>=now()+interval '5 minutes') then
  raise exception 'Provider pause was not persisted'; end if;
 select to_jsonb(l) into other_after from private.clinicorp_sync_unit_limits l where unit_id=2;
 if other_before is distinct from other_after then raise exception 'One unit paused the other unit'; end if;
 begin
  perform public.record_clinicorp_source_result(j,gen_random_uuid(),200,null);
  raise exception 'Expired request lease accepted';
 exception when sqlstate '55000' then null; end;
 update private.clinicorp_sync_days set phase='apply',payload=jsonb_build_array(r||jsonb_build_object('id',r->>'id')),
  apply_cursor=0,returned_rows=1,observed_at=clock_timestamp() where id=j;
 p:=public.apply_clinicorp_sync_batch(j,token,25);
 if p->>'phase'<>'verify' or (p->>'rows')::integer<>1 then raise exception 'Staged payload cannot resume during a source pause'; end if;
 if has_function_privilege('authenticated','public.record_clinicorp_source_result(bigint,uuid,integer,integer)','execute') then
  raise exception 'Rate state can be changed by the browser'; end if;
end $test$;

do $priority_test$
declare target bigint; token uuid; result jsonb;
begin
 perform 1 from private.clinicorp_sync_control where singleton for update;
 update private.clinicorp_sync_days set status='pending',lease_token=null,lease_until=null where status='working';
 update private.clinicorp_sync_control set enabled=true,claims=0 where singleton;
 update private.clinicorp_sync_unit_limits set next_source_at='-infinity' where unit_id=1;
 insert into private.clinicorp_sync_days(unit_id,posting_day,status,phase,priority,last_success_at,observed_at,refresh_requested_at,next_attempt_at)
 values(1,'2098-01-02','pending','fetch',2000000000,now(),now()-interval '1 hour',clock_timestamp(),now())
 returning id into target;
 result:=public.claim_clinicorp_sync_job();
 if (result->>'id')::bigint is distinct from target then raise exception 'A requested fresh check was ignored after a recent success'; end if;
end $priority_test$;

rollback;
