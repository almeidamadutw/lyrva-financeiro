-- Persist request pacing and provider cooldowns per unit, including across Edge invocations.
create table private.clinicorp_sync_unit_limits(
 unit_id bigint primary key references public.units(id),
 next_source_at timestamptz not null default '-infinity',
 consecutive_failures integer not null default 0,
 last_status integer not null default 200,
 updated_at timestamptz not null default now()
);
alter table private.clinicorp_sync_unit_limits enable row level security;
revoke all on private.clinicorp_sync_unit_limits from public,anon,authenticated;
insert into private.clinicorp_sync_unit_limits(unit_id,next_source_at,last_status)
 select u.id,case when exists(select 1 from private.clinicorp_sync_days j where j.unit_id=u.id and j.status='retry'
 and j.last_error like 'Clinicorp HTTP 429%') then now()+interval '2 minutes' else '-infinity'::timestamptz end,
 case when exists(select 1 from private.clinicorp_sync_days j where j.unit_id=u.id and j.status='retry'
 and j.last_error like 'Clinicorp HTTP 429%') then 429 else 200 end
 from public.units u where u.is_active;
create index if not exists clinicorp_source_patient_links_idx
 on public.integration_source_records(unit_id,(payload->>'PatientId')) where provider='clinicorp';

create or replace function public.record_clinicorp_source_result(p_job_id bigint,p_lease_token uuid,p_status integer,p_retry_after_seconds integer default null)
returns boolean language plpgsql security definer set search_path='' as $fn$
declare j private.clinicorp_sync_days%rowtype; failures integer; delay_seconds integer;
begin
 perform private.require_clinicorp_service();
 select * into j from private.clinicorp_sync_days where id=p_job_id for update;
 if not found or j.status<>'working' or j.phase<>'fetch' or j.lease_token is distinct from p_lease_token or j.lease_until<clock_timestamp() then
  raise exception using errcode='55000',message='A concessão de consulta expirou.';
 end if;
 if p_status is null or p_status<0 or p_status>599 then raise exception 'Situação HTTP inválida.'; end if;
 insert into private.clinicorp_sync_unit_limits(unit_id) values(j.unit_id) on conflict do nothing;
 select consecutive_failures+1 into failures from private.clinicorp_sync_unit_limits where unit_id=j.unit_id for update;
 delay_seconds:=case when p_status=429 then least(1800,120*power(2,least(failures-1,4)))::integer
  when p_status in (401,403) then 900
  when p_status=0 or p_status>=500 then least(600,30*power(2,least(failures-1,5)))::integer
  else 30 end;
 delay_seconds:=greatest(delay_seconds,least(greatest(coalesce(p_retry_after_seconds,0),0),604800));
 update private.clinicorp_sync_unit_limits set
  consecutive_failures=case when p_status=200 then 0 else failures end,last_status=p_status,
  next_source_at=greatest(next_source_at,clock_timestamp()+make_interval(secs=>delay_seconds)),updated_at=now()
  where unit_id=j.unit_id;
 return true;
end; $fn$;
revoke all on function public.record_clinicorp_source_result(bigint,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.record_clinicorp_source_result(bigint,uuid,integer,integer) to service_role;

CREATE OR REPLACE FUNCTION public.claim_clinicorp_sync_job()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_job private.clinicorp_sync_days%rowtype; v_control private.clinicorp_sync_control%rowtype; v_token uuid;
begin
  perform private.require_clinicorp_service();
  select * into v_control from private.clinicorp_sync_control where singleton for update;
  if not v_control.enabled then return null; end if;
  if exists(select 1 from private.clinicorp_sync_days where status='working' and lease_until>clock_timestamp()) then return null; end if;
  select j.* into v_job from private.clinicorp_sync_days j
    left join private.clinicorp_sync_unit_limits limits on limits.unit_id=j.unit_id
    where (j.phase<>'fetch' or coalesce(limits.next_source_at,'-infinity'::timestamptz)<=clock_timestamp())
      and j.next_attempt_at<=now() and (j.status<>'working' or j.lease_until<=clock_timestamp())
    order by
      (j.phase<>'fetch' and j.status in ('working','retry')) desc,
      -- Every fifth claim reserves capacity for never-scanned history.
      (v_control.claims%5=4 and j.last_success_at is null) desc,
      case when j.last_success_at is null or j.last_success_at<now()-interval '12 hours' then j.priority else 0 end desc,
      (j.unit_id is distinct from v_control.last_unit_id) desc,
      j.last_success_at asc nulls first,j.next_attempt_at,j.id
    limit 1 for update of j skip locked;
  if not found then return null; end if;
  v_token:=gen_random_uuid();
  update private.clinicorp_sync_days set status='working',lease_token=v_token,lease_until=clock_timestamp()+interval '2 minutes',
    attempts=attempts+1,last_error=null,updated_at=now() where id=v_job.id;
  if v_job.phase='fetch' then
    insert into private.clinicorp_sync_unit_limits(unit_id,next_source_at)
      values(v_job.unit_id,clock_timestamp()+interval '30 seconds')
    on conflict(unit_id) do update set next_source_at=greatest(private.clinicorp_sync_unit_limits.next_source_at,excluded.next_source_at),updated_at=now();
  end if;
  update private.clinicorp_sync_control set last_unit_id=v_job.unit_id,claims=claims+1 where singleton;
  return jsonb_build_object('id',v_job.id,'unit_id',v_job.unit_id,'unit_code',(select code from public.units where id=v_job.unit_id),
    'posting_day',v_job.posting_day,'phase',v_job.phase,'lease_token',v_token,'cursor',v_job.apply_cursor,'returned_rows',v_job.returned_rows);
end; $function$;

CREATE OR REPLACE FUNCTION public.get_clinicorp_sync_status(p_unit_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '5s'
AS $function$
 select jsonb_build_object('enabled',(select enabled from private.clinicorp_sync_control where singleton),
   'checked_at',now(),'units',coalesce(jsonb_agg(to_jsonb(stats)),'[]'::jsonb)) from (
   select u.code,u.name,count(j.id) total_days,
     count(j.id) filter(where j.last_success_at is not null) verified_days,
     count(j.id) filter(where j.status='retry') error_days,
     count(j.id) filter(where j.status='working') working_days,
     count(j.id) filter(where j.priority>=50 and j.last_success_at is null) pending_financial_days,
     max(j.last_success_at) last_verified_at,
     max(case when limits.last_status is distinct from 200 and limits.next_source_at>now() then limits.next_source_at end) api_resume_at,
     coalesce(sum(j.returned_rows) filter(where j.last_success_at is not null),0) verified_source_rows
   from public.units u left join private.clinicorp_sync_days j on j.unit_id=u.id
   left join private.clinicorp_sync_unit_limits limits on limits.unit_id=u.id
   where u.is_active and private.has_unit_access(u.id)
     and (p_unit_code is null or p_unit_code in ('','todas') or u.code=p_unit_code)
   group by u.id,u.code,u.name
 ) stats;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_clinicorp_financial_directory(p_unit_id bigint, p_rows jsonb, p_sync_run_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(processed_count integer, created_patients integer, linked_patients integer, updated_patients integer, review_count integer, invalid_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '60s'
AS $function$
declare
  v_row jsonb;
  v_ext_patient_id text;
  v_ext_row_id text;
  v_contract_id text;
  v_name text;
  v_payer_name text;
  v_cpf text;
  v_phone text;
  v_email text;
  v_method text;
  v_source_key text;
  v_patient_id bigint;
  v_patient_unit_id bigint;
  v_candidate_id bigint;
  v_candidate_count integer;
  v_match_method text;
  v_conflict text;
  v_processed integer := 0;
  v_created integer := 0;
  v_linked integer := 0;
  v_updated integer := 0;
  v_review integer := 0;
  v_invalid integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode='42501', message='Esta rotina é exclusiva da integração segura do LYVRA.';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception using errcode='22023', message='A carga do Clinicorp precisa ser uma lista JSON.';
  end if;
  if not exists(select 1 from public.units u where u.id=p_unit_id and u.is_active) then
    raise exception using errcode='22023', message='Unidade inválida para a base canônica.';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_processed := v_processed + 1;
    v_ext_patient_id := nullif(btrim(coalesce(v_row->>'PatientId','')),'');
    v_ext_row_id := coalesce(
      nullif(btrim(coalesce(v_row->>'ExternalTxId','')),''),
      nullif(btrim(coalesce(v_row->>'id','')),'')
    );
    v_contract_id := coalesce(
      nullif(btrim(coalesce(v_row->>'PaymentHeaderId','')),''),
      nullif(btrim(coalesce(v_row->>'TreatmentId','')),'')
    );
    v_name := nullif(btrim(coalesce(v_row->>'PatientName',v_row->>'OwnerName',v_row->>'PayerName','')),'');
    v_payer_name := nullif(btrim(coalesce(v_row->>'PayerName','')),'');
    v_method := nullif(btrim(coalesce(v_row->>'PaymentForm','')),'');
    v_conflict := null;
    v_patient_id := null;
    v_patient_unit_id := null;
    v_candidate_id := null;
    v_match_method := null;

    -- The financial owner can be a parent/guardian, not the patient.
    v_cpf := null;
    if v_name is not null and nullif(btrim(v_row->>'OwnerName'),'') is not null
       and private.normalize_match_text(v_row->>'OwnerName')=private.normalize_match_text(v_name) then
      v_cpf := regexp_replace(coalesce(nullif(v_row->>'OwnerCPF',''),''),'[^0-9]','','g');
      if length(v_cpf) <> 11 then v_cpf := null; end if;
    end if;
    if v_cpf is null and v_payer_name is not null and v_name is not null
       and private.normalize_match_text(v_payer_name)=private.normalize_match_text(v_name) then
      v_cpf := regexp_replace(coalesce(nullif(v_row->>'PayerCPF',''),nullif(v_row->>'PayerDocumentNumber',''),''),'[^0-9]','','g');
      if length(v_cpf) <> 11 then v_cpf := null; end if;
    end if;

    if v_payer_name is not null and v_name is not null
       and private.normalize_match_text(v_payer_name)=private.normalize_match_text(v_name) then
      v_phone := regexp_replace(coalesce(v_row->>'PayerPhone',''),'[^0-9]','','g');
      if length(v_phone) < 10 or length(v_phone) > 13 then v_phone := null; end if;
      v_email := nullif(lower(btrim(coalesce(v_row->>'PayerEmail',''))),'');
    else
      v_phone := null;
      v_email := null;
    end if;

    v_source_key := coalesce(
      v_ext_row_id,
      concat('patient:',coalesce(v_ext_patient_id,'sem-id'),'|contract:',coalesce(v_contract_id,'sem-contrato'),'|due:',coalesce(v_row->>'DueDate','sem-data'),'|n:',coalesce(v_row->>'InstallmentNumber','sem-numero'),'|',md5(v_row::text))
    );

    if v_ext_patient_id is null or v_name is null or length(v_name) < 2 then
      v_invalid := v_invalid + 1;
      insert into public.integration_source_records(
        unit_id,provider,entity_type,external_id,source_key,payload,link_status,match_method,last_error,last_seen_at
      ) values (
        p_unit_id,'clinicorp','payment',v_ext_row_id,v_source_key,v_row,'invalid','clinicorp_payload',
        case when v_ext_patient_id is null then 'Linha sem PatientId do Clinicorp.' else 'Linha sem nome de paciente.' end,now()
      )
      on conflict (provider, coalesce(unit_id,0), source_key) do update
      set payload=excluded.payload,link_status='invalid',match_method=excluded.match_method,last_error=excluded.last_error,last_seen_at=now(),updated_at=now();
      continue;
    end if;

    select pu.id, pu.patient_id into v_patient_unit_id, v_patient_id
    from public.patient_units pu
    where pu.unit_id=p_unit_id and pu.clinicorp_patient_id=v_ext_patient_id
    limit 1;
    if v_patient_id is not null then v_match_method := 'clinicorp_patient_id'; end if;

    if v_patient_id is null and v_cpf is not null then
      select count(*), min(p.id)
        into v_candidate_count, v_candidate_id
      from public.patients p
      where p.archived_at is null and p.cpf=v_cpf;
      if v_candidate_count=1 then
        if exists(
          select 1 from public.patient_units pu
          where pu.patient_id=v_candidate_id and pu.unit_id=p_unit_id
            and pu.clinicorp_patient_id is not null and pu.clinicorp_patient_id<>v_ext_patient_id
        ) then
          v_conflict := 'CPF localizado, mas o cadastro local já está ligado a outro PatientId do Clinicorp.';
        else
          v_patient_id := v_candidate_id;
          v_match_method := 'cpf';
        end if;
      end if;
    end if;

    if v_patient_id is null and v_phone is not null and v_conflict is null then
      select count(*), min(p.id)
        into v_candidate_count, v_candidate_id
      from public.patients p
      join public.patient_units pu on pu.patient_id=p.id
      where p.archived_at is null
        and pu.unit_id=p_unit_id
        and regexp_replace(coalesce(p.phone,''),'[^0-9]','','g')=v_phone
        and (pu.clinicorp_patient_id is null or pu.clinicorp_patient_id=v_ext_patient_id);
      if v_candidate_count=1 then
        v_patient_id := v_candidate_id;
        v_match_method := 'phone';
      end if;
    end if;

    if v_patient_id is null and v_conflict is null then
      select count(*), min(p.id)
        into v_candidate_count, v_candidate_id
      from public.patients p
      join public.patient_units pu on pu.patient_id=p.id
      where p.archived_at is null
        and pu.unit_id=p_unit_id
        and private.normalize_match_text(p.full_name)=private.normalize_match_text(v_name)
        and (pu.clinicorp_patient_id is null or pu.clinicorp_patient_id=v_ext_patient_id);
      if v_candidate_count=1 then
        v_patient_id := v_candidate_id;
        v_match_method := 'exact_name';
      elsif v_candidate_count>1 then
        v_review := v_review + 1;
        v_conflict := 'Mais de um paciente local possui o mesmo nome nesta unidade.';
      end if;
    end if;

    if v_patient_id is null and v_conflict is null then
      begin
        insert into public.patients(full_name,cpf,phone,email,tax_receipt_ir,status,source,notes)
        values(v_name,v_cpf,v_phone,v_email,false,'active','clinicorp',null)
        returning id into v_patient_id;
        v_created := v_created + 1;
        v_match_method := 'created_from_clinicorp';
      exception when unique_violation then
        v_cpf := null;
        insert into public.patients(full_name,cpf,phone,email,tax_receipt_ir,status,source,notes)
        values(v_name,null,v_phone,v_email,false,'active','clinicorp',null)
        returning id into v_patient_id;
        v_created := v_created + 1;
        v_match_method := 'created_from_clinicorp_cpf_conflict';
      end;
    end if;

    if v_patient_id is null then
      insert into public.integration_source_records(
        unit_id,provider,entity_type,external_id,source_key,payload,link_status,match_method,last_error,last_seen_at
      ) values (
        p_unit_id,'clinicorp','payment',v_ext_row_id,v_source_key,v_row,
        case when v_conflict is null then 'review' else 'conflict' end,
        'manual_review',coalesce(v_conflict,'Paciente não pôde ser vinculado com segurança.'),now()
      )
      on conflict (provider, coalesce(unit_id,0), source_key) do update
      set payload=excluded.payload,link_status=excluded.link_status,match_method=excluded.match_method,last_error=excluded.last_error,last_seen_at=now(),updated_at=now();
      continue;
    end if;

    select pu.id into v_patient_unit_id
    from public.patient_units pu
    where pu.patient_id=v_patient_id and pu.unit_id=p_unit_id
    limit 1;

    if v_patient_unit_id is null then
      insert into public.patient_units(
        patient_id,unit_id,clinicorp_patient_id,is_active,source,metadata
      ) values (
        v_patient_id,p_unit_id,v_ext_patient_id,true,'clinicorp',
        jsonb_strip_nulls(jsonb_build_object(
          'clinicorp_canonical',true,
          'clinicorp_last_seen_at',now(),
          'last_payment_form',v_method,
          'last_contract_id',v_contract_id
        ))
      ) returning id into v_patient_unit_id;
      v_linked := v_linked + 1;
    else
      if exists(
        select 1 from public.patient_units pu
        where pu.id=v_patient_unit_id
          and pu.clinicorp_patient_id is not null
          and pu.clinicorp_patient_id<>v_ext_patient_id
      ) then
        v_review := v_review + 1;
        insert into public.integration_source_records(
          unit_id,provider,entity_type,external_id,source_key,payload,patient_id,patient_unit_id,link_status,match_method,last_error,last_seen_at
        ) values (
          p_unit_id,'clinicorp','payment',v_ext_row_id,v_source_key,v_row,v_patient_id,v_patient_unit_id,'conflict',v_match_method,
          'O paciente local já está ligado a outro PatientId do Clinicorp.',now()
        )
        on conflict (provider, coalesce(unit_id,0), source_key) do update
        set payload=excluded.payload,patient_id=excluded.patient_id,patient_unit_id=excluded.patient_unit_id,link_status='conflict',match_method=excluded.match_method,last_error=excluded.last_error,last_seen_at=now(),updated_at=now();
        continue;
      end if;

      update public.patient_units pu
      set clinicorp_patient_id=coalesce(pu.clinicorp_patient_id,v_ext_patient_id),
          is_active=true,
          source='clinicorp',
          metadata=coalesce(pu.metadata,'{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
            'clinicorp_canonical',true,
            'clinicorp_last_seen_at',now(),
            'last_payment_form',v_method,
            'last_contract_id',v_contract_id
          )),
          updated_at=now()
      where pu.id=v_patient_unit_id;
      if v_match_method <> 'clinicorp_patient_id' then v_linked := v_linked + 1; end if;
    end if;

    update public.patients p
    set full_name=v_name,
        cpf=case
          when v_cpf is null then p.cpf
          when p.cpf=v_cpf then p.cpf
          when p.cpf is null and not exists(select 1 from public.patients p2 where p2.id<>p.id and p2.archived_at is null and p2.cpf=v_cpf) then v_cpf
          else p.cpf
        end,
        phone=coalesce(v_phone,p.phone),
        email=coalesce(v_email,p.email),
        status=case when p.settled_at is not null then 'inactive' else 'active' end,
        updated_at=now()
    where p.id=v_patient_id;
    v_updated := v_updated + 1;

    insert into public.integration_source_records(
      unit_id,provider,entity_type,external_id,source_key,payload,patient_id,patient_unit_id,link_status,match_method,last_error,last_seen_at
    ) values (
      p_unit_id,'clinicorp','payment',v_ext_row_id,v_source_key,v_row,v_patient_id,v_patient_unit_id,'linked',v_match_method,null,now()
    )
    on conflict (provider, coalesce(unit_id,0), source_key) do update
    set payload=excluded.payload,patient_id=excluded.patient_id,patient_unit_id=excluded.patient_unit_id,link_status='linked',match_method=excluded.match_method,last_error=null,last_seen_at=now(),updated_at=now();

    -- Resolve old review rows by the exact canonical ID without changing the payer.
    update public.integration_source_records r set patient_id=v_patient_id,patient_unit_id=v_patient_unit_id,
      link_status='linked',match_method='clinicorp_patient_id',last_error=null,updated_at=now()
    where r.provider='clinicorp' and r.unit_id=p_unit_id and r.payload->>'PatientId'=v_ext_patient_id
      and (r.patient_id is null or r.patient_id=v_patient_id)
      and r.link_status in ('review','conflict');

    if p_sync_run_id is not null then
      insert into public.sync_events(sync_run_id,unit_id,external_id,entity_type,action,status,error_message)
      values(p_sync_run_id,p_unit_id,v_ext_patient_id,'patient','upsert','success',null)
      on conflict do nothing;
    end if;
  end loop;

  return query select v_processed,v_created,v_linked,v_updated,v_review,v_invalid;
end;
$function$;
