-- LYVRA: transforma a planilha de NF em regra nativa do sistema.
-- Cartão: uma NF por ano, prevista no primeiro recebimento daquele ano.
-- Boleto: uma NF por ano, prevista no fim do parcelamento ou em 31/12, o que vier primeiro.

alter table public.payment_plans
  add column if not exists invoice_schedule_mode text not null default 'automatic',
  add column if not exists invoice_recipient_name text,
  add column if not exists invoice_disabled boolean not null default false,
  add column if not exists invoice_disabled_reason text;

alter table public.payment_plans drop constraint if exists payment_plans_invoice_schedule_mode_check;
alter table public.payment_plans add constraint payment_plans_invoice_schedule_mode_check
  check (invoice_schedule_mode in ('automatic','manual'));

alter table public.payment_plans drop constraint if exists payment_plans_invoice_frequency_check;
alter table public.payment_plans add constraint payment_plans_invoice_frequency_check
  check (invoice_frequency_override is null or invoice_frequency_override in ('monthly','four_monthly','yearly','custom'));

update public.payment_plans
set invoice_frequency_override='yearly',
    invoice_interval_months=coalesce(invoice_interval_months,12),
    invoice_schedule_mode=coalesce(invoice_schedule_mode,'automatic')
where payment_method in ('card','boleto') and invoice_schedule_mode='automatic';

alter table public.invoice_obligations
  add column if not exists scheduled_issue_date date,
  add column if not exists issued_amount numeric(14,2) not null default 0,
  add column if not exists rule_code text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.invoice_obligations drop constraint if exists invoice_obligations_frequency_check;
alter table public.invoice_obligations add constraint invoice_obligations_frequency_check
  check (frequency in ('monthly','four_monthly','yearly','custom'));

alter table public.invoice_obligations drop constraint if exists invoice_obligations_issued_amount_check;
alter table public.invoice_obligations add constraint invoice_obligations_issued_amount_check
  check (issued_amount >= 0);

create or replace function private.sync_invoice_obligations_for_plan(p_payment_plan_id bigint)
returns void
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_plan public.payment_plans%rowtype;
  v_plan_end date;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_year integer;
  v_year_start date;
  v_year_end date;
  v_period_start date;
  v_period_end date;
  v_issue_date date;
  v_expected numeric(14,2);
  v_paid numeric(14,2);
  v_frequency text;
  v_rule text;
  v_cycle_start date;
  v_cycle_end date;
  v_interval integer;
  v_import_status text;
  v_import_issue_date date;
  v_import_issue_amount numeric(14,2);
  v_first_year integer;
begin
  select * into v_plan from public.payment_plans where id=p_payment_plan_id;
  if not found then return; end if;

  select max(i.due_date) into v_plan_end
  from public.installments i
  where i.payment_plan_id=v_plan.id and i.status<>'cancelled';
  v_plan_end:=coalesce(v_plan.end_date,v_plan_end,v_plan.start_date);

  if v_plan.archived_at is not null or v_plan.status<>'active'
     or not coalesce(v_plan.issue_invoice_for_ir,true)
     or coalesce(v_plan.invoice_disabled,false)
     or v_plan.start_date is null or v_plan_end is null then
    update public.invoice_obligations o
       set status=case when o.status='issued' then o.status else 'cancelled' end,
           notes=coalesce(o.notes,v_plan.invoice_disabled_reason),updated_at=now()
     where o.payment_plan_id=v_plan.id and o.unit_id=v_plan.unit_id;
    return;
  end if;

  delete from public.invoice_obligations o
  where o.payment_plan_id=v_plan.id and o.unit_id=v_plan.unit_id and o.status<>'issued';

  if v_plan.invoice_schedule_mode='manual' and v_plan.first_invoice_date is not null then
    v_interval:=greatest(coalesce(v_plan.invoice_interval_months,12),1);
    v_frequency:=case v_interval when 1 then 'monthly' when 4 then 'four_monthly' when 12 then 'yearly' else 'custom' end;
    v_rule:='manual_schedule';
    v_cycle_start:=v_plan.start_date;
    v_issue_date:=greatest(v_plan.first_invoice_date,v_plan.start_date);

    while v_cycle_start<=v_plan_end loop
      v_cycle_end:=least(v_issue_date,v_plan_end);
      if v_cycle_end<v_cycle_start then v_cycle_end:=v_cycle_start; end if;
      select coalesce(sum(i.expected_amount),0),coalesce(sum(i.paid_amount),0)
        into v_expected,v_paid
      from public.installments i
      where i.payment_plan_id=v_plan.id and i.status<>'cancelled'
        and i.due_date between v_cycle_start and v_cycle_end;

      if v_expected>0 then
        insert into public.invoice_obligations(
          unit_id,patient_unit_id,payment_plan_id,period_start,period_end,competence,frequency,status,
          expected_amount,paid_amount,scheduled_issue_date,rule_code,metadata
        ) values(
          v_plan.unit_id,v_plan.patient_unit_id,v_plan.id,v_cycle_start,v_cycle_end,to_char(v_cycle_end,'MM/YYYY'),v_frequency,
          case when v_issue_date>v_today then 'forecast' else 'open' end,
          v_expected,v_paid,v_issue_date,v_rule,jsonb_build_object('schedule_mode','manual','interval_months',v_interval)
        ) on conflict (payment_plan_id,period_start,period_end) do update set
          expected_amount=excluded.expected_amount,paid_amount=excluded.paid_amount,
          scheduled_issue_date=excluded.scheduled_issue_date,frequency=excluded.frequency,
          rule_code=excluded.rule_code,metadata=excluded.metadata,
          status=case when public.invoice_obligations.status='issued' then 'issued' else excluded.status end,
          updated_at=now();
      end if;

      v_cycle_start:=v_cycle_end+1;
      if v_cycle_start>v_plan_end then exit; end if;
      v_issue_date:=least((v_issue_date+make_interval(months=>v_interval))::date,v_plan_end);
    end loop;
  else
    v_frequency:='yearly';
    v_rule:=case when v_plan.payment_method='boleto' then 'boleto_year_end_or_finish' else 'card_yearly_at_first_receipt' end;

    for v_year in
      select distinct extract(year from i.due_date)::integer
      from public.installments i
      where i.payment_plan_id=v_plan.id and i.status<>'cancelled'
      order by 1
    loop
      v_year_start:=make_date(v_year,1,1);
      v_year_end:=make_date(v_year,12,31);
      v_period_start:=greatest(v_plan.start_date,v_year_start);
      v_period_end:=least(v_plan_end,v_year_end);

      select coalesce(sum(i.expected_amount),0),coalesce(sum(i.paid_amount),0),min(i.due_date)
        into v_expected,v_paid,v_issue_date
      from public.installments i
      where i.payment_plan_id=v_plan.id and i.status<>'cancelled'
        and i.due_date between v_year_start and v_year_end;

      if v_expected<=0 then continue; end if;
      if v_plan.payment_method='boleto' then v_issue_date:=least(v_plan_end,v_year_end); end if;

      insert into public.invoice_obligations(
        unit_id,patient_unit_id,payment_plan_id,period_start,period_end,competence,frequency,status,
        expected_amount,paid_amount,scheduled_issue_date,rule_code,metadata
      ) values(
        v_plan.unit_id,v_plan.patient_unit_id,v_plan.id,v_period_start,v_period_end,v_year::text,v_frequency,
        case when v_issue_date>v_today then 'forecast' else 'open' end,
        v_expected,v_paid,v_issue_date,v_rule,jsonb_build_object('schedule_mode','automatic','payment_method',v_plan.payment_method)
      ) on conflict (payment_plan_id,period_start,period_end) do update set
        expected_amount=excluded.expected_amount,paid_amount=excluded.paid_amount,
        scheduled_issue_date=excluded.scheduled_issue_date,frequency=excluded.frequency,
        rule_code=excluded.rule_code,metadata=excluded.metadata,
        status=case when public.invoice_obligations.status='issued' then 'issued' else excluded.status end,
        updated_at=now();
    end loop;
  end if;

  v_import_status:=upper(btrim(coalesce(v_plan.metadata->>'invoice_status','')));
  v_import_issue_date:=case when coalesce(v_plan.metadata->>'invoice_issued_date','')~'^\d{4}-\d{2}-\d{2}$' then (v_plan.metadata->>'invoice_issued_date')::date else null end;
  v_import_issue_amount:=case when coalesce(v_plan.metadata->>'invoice_issued_amount_cents','')~'^[0-9]+([.][0-9]+)?$' then (v_plan.metadata->>'invoice_issued_amount_cents')::numeric/100 else 0 end;

  if v_import_status in ('EMITIDA','EMITIDO') then
    v_first_year:=extract(year from v_plan.start_date)::integer;
    update public.invoice_obligations o set
      status='issued',
      invoice_issued_at=coalesce(v_import_issue_date,o.scheduled_issue_date)::timestamp at time zone 'America/Sao_Paulo',
      issued_amount=case when v_import_issue_amount>0 then v_import_issue_amount else o.expected_amount end,
      completed_at=coalesce(v_import_issue_date,o.scheduled_issue_date)::timestamp at time zone 'America/Sao_Paulo',
      notes=coalesce(o.notes,nullif(v_plan.metadata->>'invoice_import_note','')),updated_at=now()
    where o.id=(
      select x.id from public.invoice_obligations x
      where x.payment_plan_id=v_plan.id and extract(year from x.period_start)::integer=v_first_year
      order by x.period_start limit 1
    );
  end if;
end;
$function$;

revoke all on function private.sync_invoice_obligations_for_plan(bigint) from public,anon,authenticated;

create or replace function private.sync_invoice_obligations_from_installment()
returns trigger language plpgsql security definer set search_path='' as $function$
begin perform private.sync_invoice_obligations_for_plan(new.payment_plan_id); return new; end;
$function$;

create or replace function private.sync_invoice_obligations_from_plan()
returns trigger language plpgsql security definer set search_path='' as $function$
begin perform private.sync_invoice_obligations_for_plan(new.id); return new; end;
$function$;

revoke all on function private.sync_invoice_obligations_from_installment() from public,anon,authenticated;
revoke all on function private.sync_invoice_obligations_from_plan() from public,anon,authenticated;

drop trigger if exists sync_invoice_obligations_installment on public.installments;
create trigger sync_invoice_obligations_installment
after insert or update of due_date,expected_amount,paid_amount,status on public.installments
for each row execute function private.sync_invoice_obligations_from_installment();

drop trigger if exists zz_sync_invoice_obligations_plan on public.payment_plans;
create trigger zz_sync_invoice_obligations_plan
after insert or update of payment_method,start_date,end_date,issue_invoice_for_ir,first_invoice_date,
  invoice_interval_months,invoice_schedule_mode,invoice_recipient_name,invoice_disabled,invoice_disabled_reason,
  status,archived_at,metadata on public.payment_plans
for each row execute function private.sync_invoice_obligations_from_plan();

create or replace view public.invoice_queue with (security_invoker=true) as
select
  o.id,o.unit_id,u.name as unit_name,p.id as patient_id,p.full_name as patient_name,p.cpf,pu.clinicorp_patient_id,
  o.payment_plan_id,o.period_start,o.period_end,o.competence,o.frequency,o.status,o.expected_amount,o.paid_amount,
  o.invoice_number,o.invoice_issued_at,o.responsible_user_id,o.notes,o.updated_at,
  o.issued_amount,o.scheduled_issue_date,o.rule_code,pp.payment_method,pp.invoice_schedule_mode,
  pp.invoice_recipient_name,pp.invoice_disabled,pp.invoice_disabled_reason
from public.invoice_obligations o
join public.patient_units pu on pu.id=o.patient_unit_id
join public.patients p on p.id=pu.patient_id
join public.units u on u.id=o.unit_id
join public.payment_plans pp on pp.id=o.payment_plan_id;

create or replace view public.patient_directory with (security_invoker=true) as
select
  pu.id as patient_unit_id,p.id as patient_id,pu.clinicorp_patient_id,p.full_name,p.cpf,p.phone,p.email,
  u.id as unit_id,u.code as unit_code,u.name as unit_name,coalesce(ap.treatment,pu.treatment) as treatment,
  ap.payment_method,ap.total_amount as plan_amount,ap.installment_count,ap.due_day,ap.start_date,
  coalesce(ap.issue_invoice_for_ir,p.tax_receipt_ir) as tax_receipt_ir,ap.invoice_frequency_override as invoice_frequency,
  p.notes,pu.is_active,p.created_at,p.updated_at,ap.installment_amount,ap.end_date,ap.first_invoice_date,
  ap.invoice_interval_months,ap.invoice_schedule_mode,ap.invoice_recipient_name,ap.invoice_disabled,ap.invoice_disabled_reason
from public.patient_units pu
join public.patients p on p.id=pu.patient_id
join public.units u on u.id=pu.unit_id
left join lateral(
  select pp.* from public.payment_plans pp
  where pp.patient_unit_id=pu.id and pp.status='active' and pp.archived_at is null
  order by pp.created_at desc,pp.id desc limit 1
) ap on true;
