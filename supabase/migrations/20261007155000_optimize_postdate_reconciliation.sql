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
    (count(*) filter (
      where nullif(i.metadata->>'clinicorp_postdate_checked_at','') is null
    ) > 0) desc,
    min(
      case
        when nullif(i.metadata->>'clinicorp_postdate_checked_at','') is not null
          then (i.metadata->>'clinicorp_postdate_checked_at')::timestamptz
        else null
      end
    ) asc nulls first,
    max(i.due_date) desc,
    1 desc
  limit least(greatest(coalesce(p_limit,12),1),20);
$function$;

revoke all on function public.get_collection_postdate_reconciliation_days(bigint,integer) from public;
revoke all on function public.get_collection_postdate_reconciliation_days(bigint,integer) from anon;
revoke all on function public.get_collection_postdate_reconciliation_days(bigint,integer) from authenticated;
grant execute on function public.get_collection_postdate_reconciliation_days(bigint,integer) to service_role;

create or replace function public.get_collection_postdate_active_ids(
  p_unit_id bigint,
  p_post_date date
)
returns table(clinicorp_installment_id text)
language sql
security definer
set search_path=''
as $function$
  select distinct i.clinicorp_installment_id
  from public.collection_cases cc
  join public.installments i on i.id=cc.installment_id and i.unit_id=cc.unit_id
  join public.payment_plans pp on pp.id=i.payment_plan_id and pp.unit_id=i.unit_id
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
    and substring(coalesce(s.raw->>'PostDate','') from 1 for 10)=p_post_date::text
    and i.clinicorp_installment_id is not null;
$function$;

revoke all on function public.get_collection_postdate_active_ids(bigint,date) from public;
revoke all on function public.get_collection_postdate_active_ids(bigint,date) from anon;
revoke all on function public.get_collection_postdate_active_ids(bigint,date) from authenticated;
grant execute on function public.get_collection_postdate_active_ids(bigint,date) to service_role;
