
alter table public.clinicorp_payment_snapshot
  add column if not exists source_presence text not null default 'unknown',
  add column if not exists source_presence_checked_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid='public.clinicorp_payment_snapshot'::regclass
      and conname='clinicorp_payment_snapshot_source_presence_check'
  ) then
    alter table public.clinicorp_payment_snapshot
      add constraint clinicorp_payment_snapshot_source_presence_check
      check (source_presence in ('unknown','present','missing'));
  end if;
end $$;

create or replace function public.get_collection_postdate_reconciliation_days(
  p_unit_id bigint,
  p_limit integer default 12
)
returns table(
  post_date date,
  active_cases bigint,
  pending_absence bigint,
  max_due_date date
)
language sql
security definer
set search_path = ''
as $function$
  select
    substring(s.raw->>'PostDate' from 1 for 10)::date as post_date,
    count(*)::bigint as active_cases,
    count(*) filter (
      where coalesce(
        case
          when coalesce(i.metadata->>'clinicorp_absence_count','') ~ '^[0-9]+$'
            then (i.metadata->>'clinicorp_absence_count')::integer
          else 0
        end,0
      ) >= 1
    )::bigint as pending_absence,
    max(i.due_date) as max_due_date
  from public.collection_cases cc
  join public.installments i
    on i.id=cc.installment_id and i.unit_id=cc.unit_id
  join public.payment_plans pp
    on pp.id=i.payment_plan_id and pp.unit_id=i.unit_id
  join public.clinicorp_payment_snapshot s
    on s.unit_id=i.unit_id and s.clinicorp_payment_id=i.clinicorp_installment_id
  where cc.unit_id=p_unit_id
    and cc.status not in ('paid','closed')
    and i.source='clinicorp'
    and i.clinicorp_source_state='open'
    and i.status not in ('paid','cancelled','refunded')
    and i.due_date < (now() at time zone 'America/Sao_Paulo')::date
    and pp.source='clinicorp'
    and pp.payment_method='boleto'
    and pp.archived_at is null
    and pp.status='active'
    and substring(coalesce(s.raw->>'PostDate','') from 1 for 10) ~ '^\d{4}-\d{2}-\d{2}$'
  group by 1
  order by
    (count(*) filter (
      where coalesce(
        case
          when coalesce(i.metadata->>'clinicorp_absence_count','') ~ '^[0-9]+$'
            then (i.metadata->>'clinicorp_absence_count')::integer
          else 0
        end,0
      ) >= 1
    ) > 0) desc,
    max(i.due_date) desc,
    1 desc
  limit least(greatest(coalesce(p_limit,12),1),20);
$function$;

revoke all on function public.get_collection_postdate_reconciliation_days(bigint,integer) from public;
revoke all on function public.get_collection_postdate_reconciliation_days(bigint,integer) from anon;
revoke all on function public.get_collection_postdate_reconciliation_days(bigint,integer) from authenticated;
grant execute on function public.get_collection_postdate_reconciliation_days(bigint,integer) to service_role;

create or replace function public.reconcile_clinicorp_postdate_day(
  p_unit_id bigint,
  p_post_date date,
  p_rows jsonb
)
returns table(
  local_active_before integer,
  returned_rows integer,
  live_open_rows integer,
  terminal_rows integer,
  missing_rows integer
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '30s'
as $function$
declare
  v_returned_ids text[] := '{}'::text[];
  v_local_active integer := 0;
  v_returned integer := 0;
  v_live_open integer := 0;
  v_terminal integer := 0;
  v_confirmed_missing_ids bigint[] := '{}'::bigint[];
  v_first_missing_ids bigint[] := '{}'::bigint[];
  v_non_boleto_ids bigint[] := '{}'::bigint[];
  v_missing integer := 0;
begin
  if coalesce((select auth.jwt()->>'role'),'') <> 'service_role' then
    raise exception using errcode='42501', message='Esta rotina é exclusiva da integração segura do LYVRA.';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception using errcode='22023', message='A reconciliação precisa receber uma lista JSON.';
  end if;

  select coalesce(
    array_agg(distinct coalesce(nullif(btrim(value->>'id'),''),nullif(btrim(value->>'ExternalTxId'),'')))
      filter (where coalesce(nullif(btrim(value->>'id'),''),nullif(btrim(value->>'ExternalTxId'),'')) is not null),
    '{}'::text[]
  )
  into v_returned_ids
  from jsonb_array_elements(p_rows);

  v_returned := coalesce(array_length(v_returned_ids,1),0);

  select count(*)::integer
  into v_live_open
  from jsonb_array_elements(p_rows) r(value)
  where private.normalize_match_text(coalesce(value->>'PaymentForm','')) like '%boleto%'
    and upper(coalesce(value->>'PaymentReceived','')) <> 'X'
    and upper(coalesce(value->>'PaymentConfirmed','')) <> 'X'
    and upper(coalesce(value->>'Canceled','')) <> 'X'
    and upper(coalesce(value->>'CancelInstallment','')) <> 'X'
    and replace(coalesce(value->>'Amount',''),',','.') ~ '^[-]?[0-9]+([.][0-9]+)?$'
    and replace(value->>'Amount',',','.')::numeric > 0;

  v_terminal := v_returned - v_live_open;

  update public.clinicorp_payment_snapshot cps
  set source_presence='present',
      source_presence_checked_at=now()
  where cps.unit_id=p_unit_id
    and cps.clinicorp_payment_id = any(v_returned_ids);

  select count(*)::integer
  into v_local_active
  from public.collection_cases cc
  join public.installments i on i.id=cc.installment_id and i.unit_id=cc.unit_id
  join public.payment_plans pp on pp.id=i.payment_plan_id and pp.unit_id=i.unit_id
  join public.clinicorp_payment_snapshot cps
    on cps.unit_id=i.unit_id and cps.clinicorp_payment_id=i.clinicorp_installment_id
  where cc.unit_id=p_unit_id
    and cc.status not in ('paid','closed')
    and pp.source='clinicorp'
    and pp.payment_method='boleto'
    and pp.archived_at is null
    and pp.status='active'
    and i.source='clinicorp'
    and i.clinicorp_source_state='open'
    and i.status not in ('paid','cancelled','refunded')
    and greatest(i.expected_amount-i.paid_amount,0::numeric)>0
    and substring(coalesce(cps.raw->>'PostDate','') from 1 for 10)=p_post_date::text;

  select coalesce(array_agg(c.installment_id), '{}'::bigint[])
  into v_non_boleto_ids
  from (
    select i.id as installment_id,i.clinicorp_installment_id
    from public.collection_cases cc
    join public.installments i on i.id=cc.installment_id and i.unit_id=cc.unit_id
    join public.payment_plans pp on pp.id=i.payment_plan_id and pp.unit_id=i.unit_id
    join public.clinicorp_payment_snapshot cps
      on cps.unit_id=i.unit_id and cps.clinicorp_payment_id=i.clinicorp_installment_id
    where cc.unit_id=p_unit_id
      and cc.status not in ('paid','closed')
      and pp.source='clinicorp'
      and pp.payment_method='boleto'
      and pp.archived_at is null
      and pp.status='active'
      and i.source='clinicorp'
      and i.clinicorp_source_state='open'
      and i.status not in ('paid','cancelled','refunded')
      and substring(coalesce(cps.raw->>'PostDate','') from 1 for 10)=p_post_date::text
  ) c
  where exists (
    select 1
    from jsonb_array_elements(p_rows) r(value)
    where coalesce(nullif(btrim(value->>'id'),''),nullif(btrim(value->>'ExternalTxId'),''))=c.clinicorp_installment_id
      and private.normalize_match_text(coalesce(value->>'PaymentForm','')) not like '%boleto%'
  );

  if coalesce(array_length(v_non_boleto_ids,1),0)>0 then
    update public.installments i
    set clinicorp_source_state='missing',
        last_synced_at=now(),
        metadata=coalesce(i.metadata,'{}'::jsonb) || jsonb_build_object(
          'clinicorp_postdate_checked_at',now(),
          'clinicorp_absence_count',0,
          'clinicorp_absence_reason','payment_form_changed'
        ),
        updated_at=now()
    where i.id=any(v_non_boleto_ids);
  end if;

  update public.installments i
  set metadata=coalesce(i.metadata,'{}'::jsonb) || jsonb_build_object(
        'clinicorp_postdate_checked_at',now(),
        'clinicorp_absence_count',0,
        'clinicorp_absence_reason',null
      ),
      updated_at=now()
  where i.unit_id=p_unit_id
    and i.clinicorp_installment_id=any(v_returned_ids)
    and not (i.id=any(v_non_boleto_ids));

  select
    coalesce(array_agg(i.id) filter (
      where not (
        coalesce(i.metadata->>'clinicorp_absence_count','') ~ '^[0-9]+$'
        and (i.metadata->>'clinicorp_absence_count')::integer >= 1
      )
    ), '{}'::bigint[]),
    coalesce(array_agg(i.id) filter (
      where coalesce(i.metadata->>'clinicorp_absence_count','') ~ '^[0-9]+$'
        and (i.metadata->>'clinicorp_absence_count')::integer >= 1
    ), '{}'::bigint[])
  into v_first_missing_ids,v_confirmed_missing_ids
  from public.collection_cases cc
  join public.installments i on i.id=cc.installment_id and i.unit_id=cc.unit_id
  join public.payment_plans pp on pp.id=i.payment_plan_id and pp.unit_id=i.unit_id
  join public.clinicorp_payment_snapshot cps
    on cps.unit_id=i.unit_id and cps.clinicorp_payment_id=i.clinicorp_installment_id
  where cc.unit_id=p_unit_id
    and cc.status not in ('paid','closed')
    and pp.source='clinicorp'
    and pp.payment_method='boleto'
    and pp.archived_at is null
    and pp.status='active'
    and i.source='clinicorp'
    and i.clinicorp_source_state='open'
    and i.status not in ('paid','cancelled','refunded')
    and substring(coalesce(cps.raw->>'PostDate','') from 1 for 10)=p_post_date::text
    and not (coalesce(i.clinicorp_installment_id,'')=any(v_returned_ids));

  if coalesce(array_length(v_first_missing_ids,1),0)>0 then
    update public.installments i
    set metadata=coalesce(i.metadata,'{}'::jsonb) || jsonb_build_object(
          'clinicorp_postdate_checked_at',now(),
          'clinicorp_absence_count',1,
          'clinicorp_absence_reason','first_absence_from_exact_postdate_recheck'
        ),
        updated_at=now()
    where i.id=any(v_first_missing_ids);
  end if;

  if coalesce(array_length(v_confirmed_missing_ids,1),0)>0 then
    update public.installments i
    set clinicorp_source_state='missing',
        metadata=coalesce(i.metadata,'{}'::jsonb) || jsonb_build_object(
          'clinicorp_postdate_checked_at',now(),
          'clinicorp_absence_count',
            greatest(
              case when coalesce(i.metadata->>'clinicorp_absence_count','') ~ '^[0-9]+$'
                then (i.metadata->>'clinicorp_absence_count')::integer else 1 end,
              1
            ) + 1,
          'clinicorp_absence_reason','absent_from_exact_postdate_recheck',
          'clinicorp_absence_confirmed_at',now()
        ),
        updated_at=now()
    where i.id=any(v_confirmed_missing_ids);

    update public.clinicorp_payment_snapshot cps
    set source_presence='missing',
        source_presence_checked_at=now()
    where cps.unit_id=p_unit_id
      and exists(
        select 1 from public.installments i
        where i.id=any(v_confirmed_missing_ids)
          and i.clinicorp_installment_id=cps.clinicorp_payment_id
      );
  end if;

  v_missing :=
    coalesce(array_length(v_confirmed_missing_ids,1),0)
    + coalesce(array_length(v_non_boleto_ids,1),0);

  return query select v_local_active,v_returned,v_live_open,v_terminal,v_missing;
end;
$function$;
