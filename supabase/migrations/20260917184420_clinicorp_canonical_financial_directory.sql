create table if not exists public.integration_source_records (
  id bigint generated always as identity primary key,
  unit_id bigint references public.units(id) on delete restrict,
  provider text not null check (provider in ('clinicorp','nf_workbook','collections_workbook')),
  entity_type text not null,
  source_file text,
  source_sheet text,
  source_row integer,
  external_id text,
  source_key text not null,
  payload jsonb not null default '{}'::jsonb,
  patient_id bigint references public.patients(id) on delete set null,
  patient_unit_id bigint references public.patient_units(id) on delete set null,
  link_status text not null default 'review' check (link_status in ('linked','review','invalid','conflict')),
  match_method text,
  last_error text,
  created_by uuid references auth.users(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists integration_source_records_source_unique
  on public.integration_source_records(provider, coalesce(unit_id,0), source_key);
create index if not exists integration_source_records_patient_idx
  on public.integration_source_records(patient_id, last_seen_at desc)
  where patient_id is not null;
create index if not exists integration_source_records_review_idx
  on public.integration_source_records(provider, link_status, last_seen_at desc)
  where link_status <> 'linked';

alter table public.integration_source_records enable row level security;

drop policy if exists integration_source_records_read on public.integration_source_records;
create policy integration_source_records_read
on public.integration_source_records
for select
to authenticated
using (
  private.current_user_is_financial_staff()
  and (
    (unit_id is not null and private.has_unit_access(unit_id))
    or (unit_id is null and created_by = auth.uid())
  )
);

revoke insert, update, delete on public.integration_source_records from authenticated;
grant select on public.integration_source_records to authenticated;

drop trigger if exists set_updated_at on public.integration_source_records;
create trigger set_updated_at
before update on public.integration_source_records
for each row execute function private.set_updated_at();

create or replace function public.capture_workbook_source_rows(
  p_provider text,
  p_file_name text,
  p_rows jsonb
)
returns table(captured_count integer, review_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_row jsonb;
  v_unit_id bigint;
  v_unit_text text;
  v_source_sheet text;
  v_source_row integer;
  v_source_key text;
  v_status text;
  v_captured integer := 0;
  v_review integer := 0;
begin
  if v_user_id is null or not private.current_user_is_financial_staff() then
    raise exception using errcode='42501', message='Este acesso não pode registrar fontes de importação.';
  end if;
  if p_provider not in ('nf_workbook','collections_workbook') then
    raise exception using errcode='22023', message='Origem de planilha inválida.';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 2000 then
    raise exception using errcode='22023', message='A captura deve conter entre 1 e 2.000 registros.';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_unit_id := null;
    v_unit_text := private.normalize_match_text(coalesce(v_row->>'unit',''));
    if v_unit_text <> '' then
      select u.id into v_unit_id
      from public.units u
      where u.is_active
        and (
          (v_unit_text like '%sorocaba%' and u.code='sorocaba')
          or ((v_unit_text like '%salto%') and u.code='salto_de_pirapora')
          or private.normalize_match_text(u.name)=v_unit_text
          or private.normalize_match_text(u.code)=v_unit_text
        )
      limit 1;
      if v_unit_id is not null and not private.has_unit_access(v_unit_id) then
        v_unit_id := null;
      end if;
    end if;

    v_source_sheet := nullif(btrim(coalesce(v_row->>'sourceSheet','')),'');
    v_source_row := case when coalesce(v_row->>'sourceRow','') ~ '^[0-9]+$' then (v_row->>'sourceRow')::integer else null end;
    v_source_key := concat(
      coalesce(nullif(btrim(p_file_name),''),'planilha'), '|',
      coalesce(v_source_sheet,'sem-aba'), '|',
      coalesce(v_source_row::text, md5(v_row::text))
    );
    v_status := case
      when v_unit_id is null or length(btrim(coalesce(v_row->>'name',v_row->>'patientName',''))) < 2 then 'review'
      else 'linked'
    end;

    insert into public.integration_source_records(
      unit_id, provider, entity_type, source_file, source_sheet, source_row,
      source_key, payload, link_status, match_method, created_by, last_seen_at
    ) values (
      v_unit_id, p_provider, 'workbook_row', nullif(btrim(p_file_name),''), v_source_sheet, v_source_row,
      v_source_key, v_row, v_status,
      case when v_status='linked' then 'workbook_ready' else 'needs_review' end,
      v_user_id, now()
    )
    on conflict (provider, coalesce(unit_id,0), source_key) do update
    set payload=excluded.payload,
        source_file=excluded.source_file,
        source_sheet=excluded.source_sheet,
        source_row=excluded.source_row,
        link_status=excluded.link_status,
        match_method=excluded.match_method,
        last_error=null,
        last_seen_at=now(),
        updated_at=now();

    v_captured := v_captured + 1;
    if v_status='review' then v_review := v_review + 1; end if;
  end loop;

  return query select v_captured, v_review;
end;
$$;

revoke execute on function public.capture_workbook_source_rows(text,text,jsonb) from public, anon;
grant execute on function public.capture_workbook_source_rows(text,text,jsonb) to authenticated;

create or replace function public.upsert_clinicorp_financial_directory(
  p_unit_id bigint,
  p_rows jsonb,
  p_sync_run_id bigint default null
)
returns table(
  processed_count integer,
  created_patients integer,
  linked_patients integer,
  updated_patients integer,
  review_count integer,
  invalid_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
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

    v_cpf := regexp_replace(coalesce(nullif(v_row->>'OwnerCPF',''),''),'[^0-9]','','g');
    if length(v_cpf) <> 11 then v_cpf := null; end if;
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

    if p_sync_run_id is not null then
      insert into public.sync_events(sync_run_id,unit_id,external_id,entity_type,action,status,error_message)
      values(p_sync_run_id,p_unit_id,v_ext_patient_id,'patient','upsert','success',null)
      on conflict do nothing;
    end if;
  end loop;

  return query select v_processed,v_created,v_linked,v_updated,v_review,v_invalid;
end;
$$;

revoke execute on function public.upsert_clinicorp_financial_directory(bigint,jsonb,bigint) from public, anon, authenticated;
grant execute on function public.upsert_clinicorp_financial_directory(bigint,jsonb,bigint) to service_role;

create or replace view public.clinicorp_directory_status
with (security_invoker=true)
as
select
  u.id as unit_id,
  u.code as unit_code,
  u.name as unit_name,
  count(*) filter (where r.provider='clinicorp') as source_records,
  count(distinct r.patient_id) filter (where r.provider='clinicorp' and r.link_status='linked') as linked_patients,
  count(*) filter (where r.provider='clinicorp' and r.link_status in ('review','invalid','conflict')) as review_records,
  max(r.last_seen_at) filter (where r.provider='clinicorp') as last_seen_at,
  count(*) filter (where pu.clinicorp_patient_id is not null) as patient_links
from public.units u
left join public.integration_source_records r on r.unit_id=u.id
left join public.patient_units pu on pu.unit_id=u.id and pu.is_active
group by u.id,u.code,u.name;

grant select on public.clinicorp_directory_status to authenticated;