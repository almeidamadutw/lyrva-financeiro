do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname='sync_payment_plan_operational_schedule'
  limit 1;

  if v_def is null then
    raise exception 'sync_payment_plan_operational_schedule não encontrada';
  end if;

  if position('if new.source = ''clinicorp'' then' in v_def) = 0 then
    v_def := replace(
      v_def,
      'if new.archived_at is not null or new.status <> ''active'' then',
      'if new.source = ''clinicorp'' then return new; end if;

  if new.archived_at is not null or new.status <> ''active'' then'
    );
    execute v_def;
  end if;
end;
$$;

create or replace function private.sync_installment_payment_reminder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.payment_plans%rowtype;
  v_patient_id bigint;
  v_patient_name text;
  v_assignee uuid;
  v_days integer := 1;
  v_patient_blocked boolean := false;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select pp.* into v_plan
  from public.payment_plans pp
  where pp.id=new.payment_plan_id and pp.unit_id=new.unit_id;
  if not found then return new; end if;

  select p.id,p.full_name,(p.settled_at is not null or coalesce(p.reminder_opt_out,false))
    into v_patient_id,v_patient_name,v_patient_blocked
  from public.patient_units pu
  join public.patients p on p.id=pu.patient_id
  where pu.id=v_plan.patient_unit_id and pu.unit_id=new.unit_id;

  select u.payment_reminder_assignee_user_id,coalesce(u.payment_reminder_days_before,1)
    into v_assignee,v_days
  from public.units u where u.id=new.unit_id;

  if v_plan.status='active'
     and v_plan.archived_at is null
     and v_plan.payment_method='boleto'
     and not coalesce(v_patient_blocked,false)
     and v_assignee is not null
     and new.status in ('pending','processing','overdue')
     and new.due_date > v_today then
    insert into public.financial_tasks(
      unit_id,patient_id,installment_id,assigned_to,title,description,
      kind,status,due_at,created_by,task_key
    ) values (
      new.unit_id,v_patient_id,new.id,v_assignee,
      'Lembrete D-1 do boleto',
      concat(coalesce(v_patient_name,'Paciente'),' • parcela ',coalesce(new.installment_number::text,'?'),' • vencimento ',to_char(new.due_date,'DD/MM/YYYY')),
      'payment_reminder','pending',
      ((new.due_date-v_days)::timestamp at time zone 'America/Sao_Paulo'),
      coalesce(v_plan.updated_by,v_plan.created_by),
      concat('payment_reminder:',new.id)
    )
    on conflict (task_key) where task_key is not null do update
    set assigned_to=excluded.assigned_to,
        patient_id=excluded.patient_id,
        installment_id=excluded.installment_id,
        title=excluded.title,
        description=excluded.description,
        due_at=excluded.due_at,
        status=case when public.financial_tasks.status='completed' then 'completed' else 'pending' end;
  else
    update public.financial_tasks ft
    set status='cancelled'
    where ft.task_key=concat('payment_reminder:',new.id)
      and ft.status in ('pending','in_progress');
  end if;

  return new;
end;
$$;

drop trigger if exists sync_installment_payment_reminder on public.installments;
create trigger sync_installment_payment_reminder
after insert or update of due_date,status,expected_amount,payment_plan_id on public.installments
for each row execute function private.sync_installment_payment_reminder();

create or replace function private.reconcile_clinicorp_plan_settlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.payment_plans%rowtype;
  v_patient_id bigint;
  v_has_open_installment boolean;
  v_has_other_active_plan boolean;
  v_now timestamptz := now();
begin
  if new.payment_plan_id is null then return new; end if;

  if new.confirmed_at is null
     or (new.clinicorp_installment_id is null and coalesce(new.metadata ->> 'clinicorp_patient_id','')='') then
    return new;
  end if;

  select pp.* into v_plan
  from public.payment_plans pp
  where pp.id=new.payment_plan_id;
  if not found then return new; end if;

  if v_plan.source='clinicorp'
     and coalesce(v_plan.metadata ->> 'clinicorp_schedule_complete','false') <> 'true' then
    return new;
  end if;

  select exists(
    select 1
    from public.installments i
    where i.payment_plan_id=v_plan.id
      and i.status not in ('cancelled','refunded')
      and (i.status<>'paid' or coalesce(i.paid_amount,0)+0.01<coalesce(i.expected_amount,0))
  ) into v_has_open_installment;

  if v_has_open_installment then return new; end if;

  update public.payment_plans
  set status='completed',updated_at=v_now
  where id=v_plan.id and status='active';

  update public.clinicorp_settlement_requests
  set status='confirmed',confirmed_at=coalesce(confirmed_at,v_now),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('confirmed_by','clinicorp_sync','confirmed_installment_id',new.id)
  where payment_plan_id=v_plan.id and status='requested';

  select pu.patient_id into v_patient_id
  from public.patient_units pu where pu.id=v_plan.patient_unit_id;
  if v_patient_id is null then return new; end if;

  select exists(
    select 1
    from public.payment_plans pp
    join public.patient_units pu on pu.id=pp.patient_unit_id
    where pu.patient_id=v_patient_id
      and pp.archived_at is null
      and pp.status='active'
  ) into v_has_other_active_plan;

  if not v_has_other_active_plan then
    update public.patients p
    set status='inactive',
        settled_at=coalesce(p.settled_at,v_now),
        settled_reason=coalesce(p.settled_reason,'Quitação confirmada pelo Clinicorp'),
        reminder_opt_out=true,
        reminder_opt_out_reason='Paciente quitado',
        reminder_opt_out_at=coalesce(p.reminder_opt_out_at,v_now),
        updated_at=v_now
    where p.id=v_patient_id;
  end if;

  return new;
end;
$$;

create or replace function public.upsert_clinicorp_financial_structure(
  p_unit_id bigint,
  p_rows jsonb,
  p_schedule_observation boolean default false,
  p_sync_run_id bigint default null
)
returns table(
  processed_count integer,
  created_plans integer,
  updated_plans integer,
  created_installments integer,
  updated_installments integer,
  completed_schedules integer,
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
  v_contract_id text;
  v_installment_ext_id text;
  v_method text;
  v_treatment text;
  v_due_date date;
  v_post_date date;
  v_amount numeric(14,2);
  v_total_amount numeric(14,2);
  v_external_number integer;
  v_local_number integer;
  v_cancelled boolean;
  v_patient_unit_id bigint;
  v_plan_id bigint;
  v_plan_matches integer;
  v_installment_id bigint;
  v_existing_installment_id bigint;
  v_existing_contract text;
  v_existing_installment_ext text;
  v_processed integer := 0;
  v_created_plans integer := 0;
  v_updated_plans integer := 0;
  v_created_installments integer := 0;
  v_updated_installments integer := 0;
  v_completed_schedules integer := 0;
  v_review integer := 0;
  v_invalid integer := 0;
  v_touched_plan bigint;
  v_touch_count integer;
  v_touch_min integer;
  v_touch_max integer;
  v_schedule_count integer;
  v_schedule_start date;
  v_schedule_end date;
  v_schedule_total numeric(14,2);
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501', message='Esta rotina é exclusiva da integração segura do LYVRA.';
  end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' then
    raise exception using errcode='22023', message='A carga financeira do Clinicorp precisa ser uma lista JSON.';
  end if;
  if not exists(select 1 from public.units u where u.id=p_unit_id and u.is_active) then
    raise exception using errcode='22023', message='Unidade inválida para a estrutura financeira.';
  end if;

  create temporary table if not exists clinicorp_structure_touched(
    plan_id bigint not null,
    installment_number integer not null,
    primary key(plan_id,installment_number)
  ) on commit delete rows;
  truncate pg_temp.clinicorp_structure_touched;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_processed := v_processed+1;
    begin
      v_ext_patient_id:=nullif(btrim(coalesce(v_row->>'PatientId','')),'');
      v_contract_id:=coalesce(nullif(btrim(coalesce(v_row->>'PaymentHeaderId','')),''),nullif(btrim(coalesce(v_row->>'TreatmentId','')),''));
      v_installment_ext_id:=nullif(btrim(coalesce(v_row->>'id','')),'');
      v_method:=case
        when lower(coalesce(v_row->>'PaymentForm','')) like '%boleto%' then 'boleto'
        when lower(coalesce(v_row->>'PaymentForm','')) like '%cartão%' or lower(coalesce(v_row->>'PaymentForm','')) like '%cartao%' then 'card'
        else null
      end;
      v_treatment:=coalesce(nullif(btrim(coalesce(v_row->>'PaymentDescription','')),''),'Tratamento Odontológico');
      v_external_number:=case when coalesce(v_row->>'InstallmentNumber','') ~ '^[0-9]+$' then (v_row->>'InstallmentNumber')::integer else null end;
      v_local_number:=case when v_external_number is not null then v_external_number+1 else null end;
      v_amount:=case when coalesce(v_row->>'Amount','') ~ '^-?[0-9]+([.][0-9]+)?$' then (v_row->>'Amount')::numeric else null end;
      v_total_amount:=case when coalesce(v_row->>'TotalAmount','') ~ '^-?[0-9]+([.][0-9]+)?$' then (v_row->>'TotalAmount')::numeric else null end;
      v_due_date:=case when nullif(v_row->>'DueDate','') is not null then ((v_row->>'DueDate')::timestamptz at time zone 'America/Sao_Paulo')::date else null end;
      v_post_date:=case when nullif(v_row->>'PostDate','') is not null then ((v_row->>'PostDate')::timestamptz at time zone 'America/Sao_Paulo')::date else null end;
      v_cancelled:=upper(coalesce(v_row->>'Canceled',''))='X' or upper(coalesce(v_row->>'CancelInstallment',''))='X';

      if v_method is null then
        continue;
      end if;
      if v_ext_patient_id is null or v_contract_id is null or v_installment_ext_id is null
         or v_local_number is null or v_due_date is null or v_amount is null or v_amount<0 then
        v_invalid:=v_invalid+1;
        continue;
      end if;

      select pu.id into v_patient_unit_id
      from public.patient_units pu
      where pu.unit_id=p_unit_id and pu.clinicorp_patient_id=v_ext_patient_id
      limit 1;
      if v_patient_unit_id is null then
        v_review:=v_review+1;
        continue;
      end if;

      v_plan_id:=null;
      select pp.id into v_plan_id
      from public.payment_plans pp
      where pp.unit_id=p_unit_id and pp.clinicorp_contract_id=v_contract_id
      limit 1;

      if v_plan_id is null then
        select count(distinct i.payment_plan_id),min(i.payment_plan_id)
          into v_plan_matches,v_plan_id
        from public.installments i
        join public.payment_plans pp on pp.id=i.payment_plan_id and pp.unit_id=i.unit_id
        where pp.unit_id=p_unit_id
          and pp.patient_unit_id=v_patient_unit_id
          and pp.archived_at is null
          and pp.clinicorp_contract_id is null
          and pp.payment_method=v_method
          and i.installment_number=v_local_number
          and i.due_date=v_due_date
          and abs(i.expected_amount-v_amount)<=0.05;
        if v_plan_matches<>1 then v_plan_id:=null; end if;
      end if;

      if v_plan_id is null and v_total_amount is not null and v_total_amount>0 then
        select count(*),min(pp.id)
          into v_plan_matches,v_plan_id
        from public.payment_plans pp
        where pp.unit_id=p_unit_id
          and pp.patient_unit_id=v_patient_unit_id
          and pp.archived_at is null
          and pp.status in ('active','suspended')
          and pp.clinicorp_contract_id is null
          and pp.payment_method=v_method
          and abs(pp.total_amount-v_total_amount)<=0.05;
        if v_plan_matches<>1 then v_plan_id:=null; end if;
      end if;

      if v_plan_id is null then
        insert into public.payment_plans(
          unit_id,patient_unit_id,clinicorp_contract_id,treatment,payment_method,total_amount,
          installment_count,due_day,start_date,end_date,issue_invoice_for_ir,status,source,metadata
        ) values (
          p_unit_id,v_patient_unit_id,v_contract_id,v_treatment,v_method,greatest(coalesce(v_total_amount,0),coalesce(v_amount,0)),
          null,extract(day from v_due_date)::integer,v_due_date,v_due_date,false,'active','clinicorp',
          jsonb_strip_nulls(jsonb_build_object(
            'clinicorp_canonical',true,
            'clinicorp_schedule_complete',false,
            'clinicorp_first_seen_at',now(),
            'clinicorp_last_seen_at',now(),
            'clinicorp_post_date',v_post_date,
            'clinicorp_total_amount',v_total_amount
          ))
        ) returning id into v_plan_id;
        v_created_plans:=v_created_plans+1;
      else
        select pp.clinicorp_contract_id into v_existing_contract from public.payment_plans pp where pp.id=v_plan_id;
        if v_existing_contract is not null and v_existing_contract<>v_contract_id then
          v_review:=v_review+1;
          continue;
        end if;

        update public.payment_plans pp
        set clinicorp_contract_id=coalesce(pp.clinicorp_contract_id,v_contract_id),
            treatment=coalesce(nullif(pp.treatment,''),v_treatment),
            payment_method=v_method,
            total_amount=greatest(coalesce(pp.total_amount,0),coalesce(v_total_amount,0),coalesce(v_amount,0)),
            due_day=coalesce(pp.due_day,extract(day from v_due_date)::integer),
            start_date=case when pp.start_date is null then v_due_date else least(pp.start_date,v_due_date) end,
            end_date=case when pp.end_date is null then v_due_date else greatest(pp.end_date,v_due_date) end,
            source='clinicorp',
            metadata=coalesce(pp.metadata,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object(
              'clinicorp_canonical',true,
              'clinicorp_last_seen_at',now(),
              'clinicorp_post_date',v_post_date,
              'clinicorp_total_amount',v_total_amount
            )),
            updated_at=now()
        where pp.id=v_plan_id;
        v_updated_plans:=v_updated_plans+1;
      end if;

      select i.id,i.clinicorp_installment_id into v_existing_installment_id,v_existing_installment_ext
      from public.installments i
      where i.payment_plan_id=v_plan_id and i.installment_number=v_local_number
      limit 1;

      if v_existing_installment_ext is not null and v_existing_installment_ext<>v_installment_ext_id then
        v_review:=v_review+1;
        continue;
      end if;

      if v_existing_installment_id is null then
        insert into public.installments(
          unit_id,payment_plan_id,clinicorp_installment_id,installment_number,due_date,expected_amount,
          paid_amount,status,boleto_url,source,metadata,last_synced_at
        ) values (
          p_unit_id,v_plan_id,v_installment_ext_id,v_local_number,v_due_date,v_amount,
          0,case when v_cancelled then 'cancelled' else 'pending' end,
          case when v_method='boleto' then nullif(v_row->>'BoletoUrl','') else null end,
          'clinicorp',jsonb_strip_nulls(jsonb_build_object(
            'clinicorp_patient_id',v_ext_patient_id,
            'clinicorp_contract_id',v_contract_id,
            'clinicorp_post_date',v_post_date,
            'clinicorp_schedule_observation',p_schedule_observation
          )),now()
        ) returning id into v_installment_id;
        v_created_installments:=v_created_installments+1;
      else
        update public.installments i
        set clinicorp_installment_id=coalesce(i.clinicorp_installment_id,v_installment_ext_id),
            due_date=v_due_date,
            expected_amount=v_amount,
            status=case when v_cancelled and i.status not in ('paid','refunded') then 'cancelled' else i.status end,
            boleto_url=case when v_method='boleto' then coalesce(nullif(v_row->>'BoletoUrl',''),i.boleto_url) else i.boleto_url end,
            source='clinicorp',
            metadata=coalesce(i.metadata,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object(
              'clinicorp_patient_id',v_ext_patient_id,
              'clinicorp_contract_id',v_contract_id,
              'clinicorp_post_date',v_post_date,
              'clinicorp_schedule_observation',p_schedule_observation
            )),
            last_synced_at=now(),
            updated_at=now()
        where i.id=v_existing_installment_id
        returning id into v_installment_id;
        v_updated_installments:=v_updated_installments+1;
      end if;

      if p_schedule_observation and not v_cancelled then
        insert into pg_temp.clinicorp_structure_touched(plan_id,installment_number)
        values(v_plan_id,v_local_number)
        on conflict do nothing;
      end if;
    exception when unique_violation then
      v_review:=v_review+1;
    when others then
      v_invalid:=v_invalid+1;
    end;
  end loop;

  if p_schedule_observation then
    for v_touched_plan in select distinct plan_id from pg_temp.clinicorp_structure_touched
    loop
      select count(*),min(installment_number),max(installment_number)
        into v_touch_count,v_touch_min,v_touch_max
      from pg_temp.clinicorp_structure_touched
      where plan_id=v_touched_plan;

      if v_touch_count>0 and v_touch_min=1 and v_touch_count=v_touch_max then
        select count(*),min(i.due_date),max(i.due_date),coalesce(sum(i.expected_amount),0)
          into v_schedule_count,v_schedule_start,v_schedule_end,v_schedule_total
        from public.installments i
        where i.payment_plan_id=v_touched_plan
          and i.installment_number between 1 and v_touch_max
          and i.clinicorp_installment_id is not null
          and i.status not in ('cancelled','refunded');

        if v_schedule_count=v_touch_max then
          update public.installments i
          set status='cancelled',updated_at=now()
          where i.payment_plan_id=v_touched_plan
            and i.installment_number>v_touch_max
            and i.clinicorp_installment_id is null
            and i.status in ('pending','processing','overdue');

          update public.payment_plans pp
          set installment_count=v_touch_max,
              start_date=v_schedule_start,
              end_date=v_schedule_end,
              total_amount=greatest(coalesce(pp.total_amount,0),v_schedule_total),
              source='clinicorp',
              metadata=coalesce(pp.metadata,'{}'::jsonb)||jsonb_build_object(
                'clinicorp_schedule_complete',true,
                'clinicorp_schedule_completed_at',now(),
                'clinicorp_schedule_installments',v_touch_max
              ),
              updated_at=now()
          where pp.id=v_touched_plan;
          v_completed_schedules:=v_completed_schedules+1;
        end if;
      end if;
    end loop;
  end if;

  return query select v_processed,v_created_plans,v_updated_plans,v_created_installments,v_updated_installments,v_completed_schedules,v_review,v_invalid;
end;
$$;

revoke execute on function public.upsert_clinicorp_financial_structure(bigint,jsonb,boolean,bigint) from public,anon,authenticated;
grant execute on function public.upsert_clinicorp_financial_structure(bigint,jsonb,boolean,bigint) to service_role;