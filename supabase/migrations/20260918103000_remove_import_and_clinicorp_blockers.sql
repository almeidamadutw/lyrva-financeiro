-- Preserve every spreadsheet/API row and create safe technical targets instead of discarding data.

grant execute on function private.sync_invoice_obligations_for_plan(bigint) to authenticated, service_role;

create table if not exists private.clinicorp_inbox (
  id bigint generated always as identity primary key,
  unit_id bigint not null references public.units(id) on delete restrict,
  entity_type text not null,
  external_id text not null,
  status text not null default 'received',
  reason text,
  payload jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  applied_at timestamptz,
  constraint clinicorp_inbox_entity_check check (entity_type in ('payment','invoice')),
  constraint clinicorp_inbox_status_check check (status in ('received','pending','applied','error')),
  constraint clinicorp_inbox_unique unique(unit_id,entity_type,external_id)
);

alter table private.clinicorp_inbox enable row level security;
revoke all on private.clinicorp_inbox from public, anon, authenticated;
grant select, insert, update on private.clinicorp_inbox to service_role;

create or replace function private.match_or_create_clinicorp_patient(
  p_unit_id bigint,
  p_external_patient_id text,
  p_patient_name text,
  p_cpf text
)
returns table(patient_unit_id bigint, patient_id bigint)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_patient_id bigint;
  v_patient_unit_id bigint;
  v_matches integer;
  v_name text := coalesce(nullif(btrim(p_patient_name),''), concat('Paciente Clinicorp ', coalesce(nullif(btrim(p_external_patient_id),''),'sem identificação')));
  v_cpf text := nullif(regexp_replace(coalesce(p_cpf,''),'[^0-9]','','g'),'');
begin
  if v_cpf is not null and v_cpf !~ '^[0-9]{11}$' then v_cpf := null; end if;

  if nullif(btrim(p_external_patient_id),'') is not null then
    select pu.id,pu.patient_id into v_patient_unit_id,v_patient_id
    from public.patient_units pu
    where pu.unit_id=p_unit_id and pu.clinicorp_patient_id=btrim(p_external_patient_id)
    limit 1;
  end if;

  if v_patient_id is null and v_cpf is not null then
    select p.id,pu.id into v_patient_id,v_patient_unit_id
    from public.patients p
    left join public.patient_units pu on pu.patient_id=p.id and pu.unit_id=p_unit_id
    where p.cpf=v_cpf and p.archived_at is null
    order by p.updated_at desc,p.id desc limit 1;
  end if;

  if v_patient_id is null and length(btrim(v_name))>=2 then
    select count(*),min(p.id),min(pu.id) into v_matches,v_patient_id,v_patient_unit_id
    from public.patients p
    join public.patient_units pu on pu.patient_id=p.id
    where pu.unit_id=p_unit_id and pu.is_active and p.archived_at is null
      and private.normalize_match_text(p.full_name)=private.normalize_match_text(v_name);
    if v_matches<>1 then v_patient_id:=null; v_patient_unit_id:=null; end if;
  end if;

  if v_patient_id is null then
    insert into public.patients(full_name,cpf,tax_receipt_ir,status,source,notes)
    values(v_name,v_cpf,false,case when v_cpf is null then 'manual_review' else 'active' end,'clinicorp','Criado automaticamente pela sincronização do Clinicorp.')
    returning id into v_patient_id;
  else
    update public.patients p set
      full_name=case when p.full_name like 'Paciente Clinicorp %' then v_name else p.full_name end,
      cpf=coalesce(p.cpf,v_cpf),
      archived_at=null,
      updated_at=now()
    where p.id=v_patient_id;
  end if;

  if v_patient_unit_id is null then
    insert into public.patient_units(patient_id,unit_id,clinicorp_patient_id,is_active,source,metadata)
    values(
      v_patient_id,p_unit_id,
      case when nullif(btrim(p_external_patient_id),'') is not null
        and not exists(select 1 from public.patient_units x where x.unit_id=p_unit_id and x.clinicorp_patient_id=btrim(p_external_patient_id))
        then btrim(p_external_patient_id) else null end,
      true,'clinicorp',jsonb_build_object('clinicorp_auto_created',true,'clinicorp_last_patient_id',nullif(btrim(p_external_patient_id),''))
    )
    on conflict on constraint patient_units_patient_unit_unique do update set
      is_active=true,
      source=case when public.patient_units.source='manual' then 'manual' else 'clinicorp' end,
      metadata=coalesce(public.patient_units.metadata,'{}'::jsonb)||excluded.metadata,
      updated_at=now()
    returning id into v_patient_unit_id;
  end if;

  update public.patient_units pu set
    clinicorp_patient_id=case
      when pu.clinicorp_patient_id is null
        and nullif(btrim(p_external_patient_id),'') is not null
        and not exists(select 1 from public.patient_units x where x.unit_id=p_unit_id and x.id<>pu.id and x.clinicorp_patient_id=btrim(p_external_patient_id))
      then btrim(p_external_patient_id)
      else pu.clinicorp_patient_id end,
    metadata=coalesce(pu.metadata,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object('clinicorp_last_patient_id',nullif(btrim(p_external_patient_id),''),'clinicorp_linked_at',now())),
    updated_at=now()
  where pu.id=v_patient_unit_id;

  return query select v_patient_unit_id,v_patient_id;
end;
$$;

revoke all on function private.match_or_create_clinicorp_patient(bigint,text,text,text) from public,anon,authenticated;

create or replace function public.ingest_clinicorp_payments(
  p_unit_id bigint,
  p_rows jsonb,
  p_sync_run_id bigint default null
)
returns table(processed_count integer,created_count integer,updated_count integer,skipped_count integer,failed_count integer,paid_installments integer)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_row jsonb;
  v_inbox_id text;
  v_ext_patient_id text;
  v_ext_payment_id text;
  v_ext_installment_id text;
  v_contract_id text;
  v_patient_name text;
  v_cpf text;
  v_method text;
  v_amount numeric(14,2);
  v_fee numeric(14,2);
  v_confirmed_at timestamptz;
  v_paid_at timestamptz;
  v_due_date date;
  v_external_number integer;
  v_local_number integer;
  v_patient_unit_id bigint;
  v_patient_id bigint;
  v_plan_id bigint;
  v_installment_id bigint;
  v_existing_payment_id bigint;
  v_payment_id bigint;
  v_total_paid numeric(14,2);
  v_expected numeric(14,2);
  v_new_status text;
  v_action text;
  v_sync_key text;
  v_processed integer:=0;
  v_created integer:=0;
  v_updated integer:=0;
  v_pending integer:=0;
  v_failed integer:=0;
  v_paid_count integer:=0;
begin
  if coalesce((select auth.jwt()->>'role'),'')<>'service_role' then
    raise exception using errcode='42501',message='Esta rotina é exclusiva da integração segura do LYVRA.';
  end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' then
    raise exception using errcode='22023',message='A carga do Clinicorp precisa ser uma lista JSON.';
  end if;
  if not exists(select 1 from public.units u where u.id=p_unit_id and u.is_active) then
    raise exception using errcode='22023',message='Unidade inválida para sincronização.';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_processed:=v_processed+1;
    v_inbox_id:=coalesce(nullif(btrim(v_row->>'ExternalTxId'),''),nullif(btrim(v_row->>'id'),''),concat('derived:',md5(v_row::text)));
    insert into private.clinicorp_inbox(unit_id,entity_type,external_id,status,payload)
    values(p_unit_id,'payment',v_inbox_id,'received',v_row)
    on conflict(unit_id,entity_type,external_id) do update set payload=excluded.payload,last_seen_at=now(),status='received',reason=null;

    begin
      if upper(coalesce(v_row->>'PaymentConfirmed',''))<>'X' or nullif(v_row->>'ConfirmedDate','') is null then
        v_pending:=v_pending+1;
        update private.clinicorp_inbox set status='pending',reason='Aguardando confirmação do Clinicorp',last_seen_at=now() where unit_id=p_unit_id and entity_type='payment' and external_id=v_inbox_id;
        if p_sync_run_id is not null then
          insert into public.sync_events(sync_run_id,unit_id,external_id,entity_type,action,status,error_message)
          values(p_sync_run_id,p_unit_id,v_inbox_id,'payment','receive','success','Preservado e aguardando confirmação.') on conflict do nothing;
        end if;
        continue;
      end if;

      v_method:=case
        when private.normalize_match_text(v_row->>'PaymentForm') like '%boleto%' then 'boleto'
        when private.normalize_match_text(v_row->>'PaymentForm') like '%cartao%' then 'card'
        when private.normalize_match_text(v_row->>'PaymentForm') like '%pix%' then 'pix'
        when private.normalize_match_text(v_row->>'PaymentForm') like '%dinheiro%' then 'cash'
        when private.normalize_match_text(v_row->>'PaymentForm') like '%transfer%' then 'transfer'
        else 'other' end;
      v_ext_patient_id:=nullif(btrim(v_row->>'PatientId'),'');
      v_ext_payment_id:=v_inbox_id;
      v_ext_installment_id:=coalesce(nullif(btrim(v_row->>'id'),''),v_ext_payment_id);
      v_contract_id:=coalesce(nullif(btrim(v_row->>'PaymentHeaderId'),''),nullif(btrim(v_row->>'TreatmentId'),''));
      v_patient_name:=nullif(btrim(v_row->>'PatientName'),'');
      v_cpf:=coalesce(nullif(v_row->>'PayerCPF',''),nullif(v_row->>'OwnerCPF',''));
      v_amount:=case when replace(coalesce(v_row->>'Amount',''),',','.')~'^[-]?[0-9]+([.][0-9]+)?$' then replace(v_row->>'Amount',',','.')::numeric else null end;
      if v_amount is null or v_amount<=0 then
        v_pending:=v_pending+1;
        update private.clinicorp_inbox set status='pending',reason='Movimento sem valor positivo',last_seen_at=now() where unit_id=p_unit_id and entity_type='payment' and external_id=v_inbox_id;
        continue;
      end if;
      v_fee:=case when replace(coalesce(v_row->>'Fee',''),',','.')~'^[0-9]+([.][0-9]+)?$' then replace(v_row->>'Fee',',','.')::numeric else 0 end;
      v_confirmed_at:=case when coalesce(v_row->>'ConfirmedDate','')<>'' then (v_row->>'ConfirmedDate')::timestamptz else now() end;
      v_paid_at:=case
        when coalesce(v_row->>'PaymentDate','')<>'' then (v_row->>'PaymentDate')::timestamptz
        when coalesce(v_row->>'ReceivedDate','')<>'' then (v_row->>'ReceivedDate')::timestamptz
        else v_confirmed_at end;
      v_due_date:=case when substring(coalesce(v_row->>'DueDate','') from 1 for 10)~'^\d{4}-\d{2}-\d{2}$' then substring(v_row->>'DueDate' from 1 for 10)::date else (v_paid_at at time zone 'America/Sao_Paulo')::date end;
      v_external_number:=case when coalesce(v_row->>'InstallmentNumber','')~'^[0-9]+$' then (v_row->>'InstallmentNumber')::integer else 0 end;
      v_local_number:=v_external_number+1;

      select x.patient_unit_id,x.patient_id into v_patient_unit_id,v_patient_id
      from private.match_or_create_clinicorp_patient(p_unit_id,v_ext_patient_id,v_patient_name,v_cpf) x;

      v_sync_key:=case when v_contract_id is not null then concat('contract:',v_contract_id) else concat('payment:',v_ext_payment_id) end;
      v_plan_id:=null;
      if v_contract_id is not null then
        select pp.id into v_plan_id from public.payment_plans pp
        where pp.unit_id=p_unit_id and pp.patient_unit_id=v_patient_unit_id and pp.clinicorp_contract_id=v_contract_id and pp.archived_at is null limit 1;
      end if;
      if v_plan_id is null then
        select pp.id into v_plan_id from public.payment_plans pp
        where pp.unit_id=p_unit_id and pp.patient_unit_id=v_patient_unit_id and pp.metadata->>'clinicorp_sync_key'=v_sync_key and pp.archived_at is null limit 1;
      end if;
      if v_plan_id is null then
        insert into public.payment_plans(unit_id,patient_unit_id,clinicorp_contract_id,payment_method,total_amount,installment_amount,installment_count,due_day,start_date,end_date,issue_invoice_for_ir,invoice_disabled,invoice_disabled_reason,status,source,metadata)
        values(p_unit_id,v_patient_unit_id,
          case when v_contract_id is not null and not exists(select 1 from public.payment_plans x where x.unit_id=p_unit_id and x.clinicorp_contract_id=v_contract_id) then v_contract_id else null end,
          v_method,v_amount,v_amount,greatest(v_local_number,1),extract(day from v_due_date)::smallint,v_due_date,v_due_date,false,true,'Plano técnico criado pela sincronização do Clinicorp','active','clinicorp',
          jsonb_build_object('clinicorp_sync_only',true,'clinicorp_sync_key',v_sync_key,'clinicorp_contract_id',v_contract_id))
        returning id into v_plan_id;
      end if;

      v_installment_id:=null;
      select i.id into v_installment_id from public.installments i where i.unit_id=p_unit_id and i.clinicorp_installment_id=v_ext_installment_id limit 1;
      if v_installment_id is null then
        select i.id into v_installment_id from public.installments i
        where i.unit_id=p_unit_id and i.payment_plan_id=v_plan_id and i.installment_number=v_local_number limit 1;
      end if;
      if v_installment_id is null then
        insert into public.installments(unit_id,payment_plan_id,clinicorp_installment_id,installment_number,due_date,expected_amount,paid_amount,status,source,metadata)
        values(p_unit_id,v_plan_id,v_ext_installment_id,v_local_number,v_due_date,v_amount,0,case when v_due_date<(now() at time zone 'America/Sao_Paulo')::date then 'overdue' else 'pending' end,'clinicorp',jsonb_build_object('clinicorp_auto_created',true,'clinicorp_patient_id',v_ext_patient_id,'clinicorp_contract_id',v_contract_id))
        returning id into v_installment_id;
      else
        update public.installments set clinicorp_installment_id=coalesce(clinicorp_installment_id,v_ext_installment_id),expected_amount=greatest(expected_amount,v_amount),last_synced_at=now(),updated_at=now() where id=v_installment_id;
      end if;

      select p.id into v_existing_payment_id from public.payments p where p.unit_id=p_unit_id and p.clinicorp_payment_id=v_ext_payment_id limit 1;
      if v_existing_payment_id is null then
        insert into public.payments(unit_id,installment_id,clinicorp_payment_id,payment_method,amount,fee_amount,net_amount,status,paid_at,confirmed_at,source,raw_data)
        values(p_unit_id,v_installment_id,v_ext_payment_id,v_method,v_amount,greatest(v_fee,0),greatest(v_amount-greatest(v_fee,0),0),'confirmed',v_paid_at,v_confirmed_at,'clinicorp',v_row)
        returning id into v_payment_id;
        v_created:=v_created+1; v_action:='create';
      else
        update public.payments set installment_id=v_installment_id,payment_method=v_method,amount=v_amount,fee_amount=greatest(v_fee,0),net_amount=greatest(v_amount-greatest(v_fee,0),0),status='confirmed',paid_at=v_paid_at,confirmed_at=v_confirmed_at,source='clinicorp',raw_data=v_row,updated_at=now()
        where id=v_existing_payment_id returning id into v_payment_id;
        v_updated:=v_updated+1; v_action:='update';
      end if;

      insert into public.payment_events(unit_id,installment_id,payment_id,source,event_type,external_event_id,payload,occurred_at,processed_at)
      values(p_unit_id,v_installment_id,v_payment_id,'clinicorp','payment_confirmed',concat('confirmed:',v_ext_payment_id),v_row,v_confirmed_at,now())
      on conflict(source,external_event_id) where external_event_id is not null do update set payment_id=excluded.payment_id,installment_id=excluded.installment_id,payload=excluded.payload,occurred_at=excluded.occurred_at,processed_at=now();

      select coalesce(sum(p.amount),0) into v_total_paid from public.payments p where p.unit_id=p_unit_id and p.installment_id=v_installment_id and p.status='confirmed';
      select i.expected_amount into v_expected from public.installments i where i.id=v_installment_id;
      v_new_status:=case when v_total_paid+0.01>=v_expected then 'paid' when v_due_date<(now() at time zone 'America/Sao_Paulo')::date then 'overdue' else 'pending' end;
      update public.installments set paid_amount=v_total_paid,paid_at=v_paid_at,confirmed_at=v_confirmed_at,last_synced_at=now(),status=v_new_status,source='clinicorp',updated_at=now() where id=v_installment_id;
      update public.payment_plans set total_amount=greatest(total_amount,v_amount),installment_amount=greatest(coalesce(installment_amount,0),v_amount),updated_at=now() where id=v_plan_id;
      if v_new_status='paid' then v_paid_count:=v_paid_count+1; end if;
      update private.clinicorp_inbox set status='applied',reason=null,applied_at=now(),last_seen_at=now() where unit_id=p_unit_id and entity_type='payment' and external_id=v_inbox_id;
      if p_sync_run_id is not null then
        insert into public.sync_events(sync_run_id,unit_id,external_id,entity_type,action,status)
        values(p_sync_run_id,p_unit_id,v_ext_payment_id,'payment',v_action,'success') on conflict do nothing;
      end if;
    exception when others then
      v_failed:=v_failed+1;
      update private.clinicorp_inbox set status='error',reason=left(sqlerrm,500),last_seen_at=now() where unit_id=p_unit_id and entity_type='payment' and external_id=v_inbox_id;
      if p_sync_run_id is not null then
        insert into public.sync_events(sync_run_id,unit_id,external_id,entity_type,action,status,error_message)
        values(p_sync_run_id,p_unit_id,v_inbox_id,'payment','receive','failed',left(sqlerrm,500)) on conflict do nothing;
      end if;
    end;
  end loop;
  return query select v_processed,v_created,v_updated,v_pending,v_failed,v_paid_count;
end;
$$;

revoke all on function public.ingest_clinicorp_payments(bigint,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.ingest_clinicorp_payments(bigint,jsonb,bigint) to service_role;

create or replace function public.ingest_clinicorp_invoices(
  p_unit_id bigint,
  p_rows jsonb,
  p_sync_run_id bigint default null
)
returns table(processed_count integer,created_count integer,updated_count integer,skipped_count integer,failed_count integer)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_row jsonb;
  v_external_id text;
  v_patient_unit_id bigint;
  v_patient_id bigint;
  v_plan_id bigint;
  v_obligation_id bigint;
  v_date date;
  v_amount numeric(14,2);
  v_status_raw text;
  v_status text;
  v_action text;
  v_processed integer:=0;
  v_created integer:=0;
  v_updated integer:=0;
  v_pending integer:=0;
  v_failed integer:=0;
begin
  if coalesce((select auth.jwt()->>'role'),'')<>'service_role' then raise exception using errcode='42501',message='Esta rotina é exclusiva da integração segura do LYVRA.'; end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception using errcode='22023',message='A carga de notas precisa ser uma lista JSON.'; end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_processed:=v_processed+1;
    v_external_id:=coalesce(nullif(btrim(v_row->>'InvoiceId'),''),nullif(btrim(v_row->>'ReferenceId'),''),concat('derived:',md5(v_row::text)));
    insert into private.clinicorp_inbox(unit_id,entity_type,external_id,status,payload)
    values(p_unit_id,'invoice',v_external_id,'received',v_row)
    on conflict(unit_id,entity_type,external_id) do update set payload=excluded.payload,last_seen_at=now(),status='received',reason=null;
    begin
      v_date:=case when substring(coalesce(v_row->>'Date','') from 1 for 10)~'^\d{4}-\d{2}-\d{2}$' then substring(v_row->>'Date' from 1 for 10)::date else null end;
      v_amount:=case when replace(coalesce(v_row->>'Amount',''),',','.')~'^[-]?[0-9]+([.][0-9]+)?$' then replace(v_row->>'Amount',',','.')::numeric else null end;
      if v_date is null or v_amount is null or v_amount<0 then
        v_pending:=v_pending+1;
        update private.clinicorp_inbox set status='pending',reason='Nota sem data ou valor válido',last_seen_at=now() where unit_id=p_unit_id and entity_type='invoice' and external_id=v_external_id;
        continue;
      end if;

      select x.patient_unit_id,x.patient_id into v_patient_unit_id,v_patient_id
      from private.match_or_create_clinicorp_patient(p_unit_id,nullif(v_row->>'PatientId',''),nullif(v_row->>'PatientName',''),null) x;
      select pp.id into v_plan_id from public.payment_plans pp
      where pp.unit_id=p_unit_id and pp.patient_unit_id=v_patient_unit_id and pp.metadata->>'clinicorp_invoice_key'=v_external_id and pp.archived_at is null limit 1;
      if v_plan_id is null then
        insert into public.payment_plans(unit_id,patient_unit_id,payment_method,total_amount,installment_amount,installment_count,due_day,start_date,end_date,issue_invoice_for_ir,invoice_disabled,invoice_disabled_reason,status,source,metadata)
        values(p_unit_id,v_patient_unit_id,'other',v_amount,v_amount,1,extract(day from v_date)::smallint,v_date,v_date,false,true,'Registro técnico de NF sincronizada do Clinicorp','completed','clinicorp',jsonb_build_object('clinicorp_invoice_only',true,'clinicorp_invoice_key',v_external_id))
        returning id into v_plan_id;
      end if;

      v_status_raw:=private.normalize_match_text(v_row->>'Status');
      v_status:=case
        when v_status_raw like '%error%' then 'divergence'
        when v_status_raw like '%autorized%' or v_status_raw like '%authorized%' or v_status_raw like '%autorizad%' then 'issued'
        when v_status_raw like '%cancel%' then 'cancelled'
        else 'open' end;
      select o.id into v_obligation_id from public.invoice_obligations o where o.unit_id=p_unit_id and o.metadata->>'clinicorp_invoice_id'=v_external_id limit 1;
      if v_obligation_id is null then
        insert into public.invoice_obligations(unit_id,patient_unit_id,payment_plan_id,period_start,period_end,competence,frequency,status,expected_amount,paid_amount,invoice_number,invoice_issued_at,completed_at,scheduled_issue_date,issued_amount,rule_code,metadata)
        values(p_unit_id,v_patient_unit_id,v_plan_id,v_date,v_date,to_char(v_date,'MM/YYYY'),'monthly',v_status,v_amount,case when coalesce(v_row->>'PaymentConfirmed','')='X' then v_amount else 0 end,v_external_id,case when v_status='issued' then (v_date::text||'T12:00:00-03:00')::timestamptz else null end,case when v_status in ('issued','cancelled') then now() else null end,v_date,case when v_status='issued' then v_amount else 0 end,'clinicorp_invoice',jsonb_build_object('clinicorp_invoice_id',v_external_id,'clinicorp_reference_id',v_row->>'ReferenceId','clinicorp_status',v_row->>'Status','source','clinicorp'))
        returning id into v_obligation_id;
        v_created:=v_created+1; v_action:='create';
      else
        update public.invoice_obligations set status=v_status,expected_amount=v_amount,paid_amount=case when coalesce(v_row->>'PaymentConfirmed','')='X' then v_amount else paid_amount end,invoice_number=v_external_id,invoice_issued_at=case when v_status='issued' then (v_date::text||'T12:00:00-03:00')::timestamptz else invoice_issued_at end,completed_at=case when v_status in ('issued','cancelled') then coalesce(completed_at,now()) else null end,scheduled_issue_date=v_date,issued_amount=case when v_status='issued' then v_amount else 0 end,metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('clinicorp_status',v_row->>'Status','last_sync_at',now()),updated_at=now() where id=v_obligation_id;
        v_updated:=v_updated+1; v_action:='update';
      end if;
      update public.invoice_obligations existing set
        status='cancelled',
        completed_at=coalesce(existing.completed_at,now()),
        metadata=coalesce(existing.metadata,'{}'::jsonb)||jsonb_build_object(
          'replaced_by_clinicorp_invoice_id',v_external_id,
          'reconciled_at',now()
        ),
        updated_at=now()
      where existing.unit_id=p_unit_id
        and existing.patient_unit_id=v_patient_unit_id
        and existing.id<>v_obligation_id
        and existing.rule_code is distinct from 'clinicorp_invoice'
        and (
          existing.scheduled_issue_date=v_date
          or (existing.period_start<=v_date and existing.period_end>=v_date)
        )
        and abs(existing.expected_amount-v_amount)<=0.01;
      update private.clinicorp_inbox set status='applied',reason=null,applied_at=now(),last_seen_at=now() where unit_id=p_unit_id and entity_type='invoice' and external_id=v_external_id;
      if p_sync_run_id is not null then
        insert into public.sync_events(sync_run_id,unit_id,external_id,entity_type,action,status)
        values(p_sync_run_id,p_unit_id,v_external_id,'invoice',v_action,'success') on conflict do nothing;
      end if;
    exception when others then
      v_failed:=v_failed+1;
      update private.clinicorp_inbox set status='error',reason=left(sqlerrm,500),last_seen_at=now() where unit_id=p_unit_id and entity_type='invoice' and external_id=v_external_id;
    end;
  end loop;
  return query select v_processed,v_created,v_updated,v_pending,v_failed;
end;
$$;

revoke all on function public.ingest_clinicorp_invoices(bigint,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.ingest_clinicorp_invoices(bigint,jsonb,bigint) to service_role;
