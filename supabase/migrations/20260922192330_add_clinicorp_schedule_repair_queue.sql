
create or replace function public.get_clinicorp_schedule_repair_days(
  p_unit_id bigint,
  p_limit integer default 8
)
returns table(
  post_date date,
  missing_installments bigint,
  incomplete_contracts bigint,
  overdue_contracts bigint
)
language sql
stable
security definer
set search_path=''
as $$
  with grouped as (
    select
      ((r.payload->>'PostDate')::timestamptz at time zone 'America/Sao_Paulo')::date as post_date,
      r.payload->>'PaymentHeaderId' as payment_header_id,
      max((r.payload->>'InstallmentsCount')::int) as expected_count,
      count(distinct r.payload->>'id') as captured_count,
      min(((r.payload->>'DueDate')::timestamptz at time zone 'America/Sao_Paulo')::date) as min_due,
      max(((r.payload->>'DueDate')::timestamptz at time zone 'America/Sao_Paulo')::date) as max_due
    from public.integration_source_records r
    where r.provider='clinicorp'
      and r.unit_id=p_unit_id
      and nullif(r.payload->>'PaymentHeaderId','') is not null
      and nullif(r.payload->>'PostDate','') is not null
      and nullif(r.payload->>'DueDate','') is not null
      and coalesce(r.payload->>'InstallmentsCount','') ~ '^[0-9]+$'
      and (r.payload->>'InstallmentsCount')::int > 1
      and nullif(r.payload->>'id','') is not null
    group by 1,2
  ),
  incomplete as (
    select *
    from grouped
    where expected_count > captured_count
      and max_due >= date_trunc('month',(now() at time zone 'America/Sao_Paulo'))::date
  )
  select
    post_date,
    sum(expected_count-captured_count)::bigint as missing_installments,
    count(*)::bigint as incomplete_contracts,
    count(*) filter (
      where min_due <= (now() at time zone 'America/Sao_Paulo')::date
        and max_due >= date_trunc('month',(now() at time zone 'America/Sao_Paulo'))::date
    )::bigint as overdue_contracts
  from incomplete
  group by post_date
  order by
    count(*) filter (
      where min_due <= (now() at time zone 'America/Sao_Paulo')::date
        and max_due >= date_trunc('month',(now() at time zone 'America/Sao_Paulo'))::date
    ) desc,
    sum(expected_count-captured_count) desc,
    post_date desc
  limit least(greatest(coalesce(p_limit,8),1),20);
$$;

revoke all on function public.get_clinicorp_schedule_repair_days(bigint,integer) from public,anon,authenticated;
grant execute on function public.get_clinicorp_schedule_repair_days(bigint,integer) to service_role;
