
create table if not exists public.clinicorp_schedule_repair_log (
  unit_id bigint not null references public.units(id) on delete cascade,
  post_date date not null,
  last_repaired_at timestamptz,
  row_count integer not null default 0,
  attempts integer not null default 0,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key(unit_id,post_date)
);

alter table public.clinicorp_schedule_repair_log enable row level security;
revoke all on public.clinicorp_schedule_repair_log from public,anon,authenticated;
grant select,insert,update on public.clinicorp_schedule_repair_log to service_role;

drop function if exists public.get_clinicorp_schedule_repair_days(bigint,integer);

create function public.get_clinicorp_schedule_repair_days(
  p_unit_id bigint,
  p_limit integer default 2
)
returns table(
  post_date date,
  source_rows bigint,
  min_due date,
  max_due date
)
language sql
stable
security definer
set search_path=''
set statement_timeout='60s'
as $$
  with days as (
    select
      ((r.payload->>'PostDate')::timestamptz at time zone 'America/Sao_Paulo')::date as post_date,
      count(*)::bigint as source_rows,
      min(((r.payload->>'DueDate')::timestamptz at time zone 'America/Sao_Paulo')::date) as min_due,
      max(((r.payload->>'DueDate')::timestamptz at time zone 'America/Sao_Paulo')::date) as max_due
    from public.integration_source_records r
    where r.provider='clinicorp'
      and r.unit_id=p_unit_id
      and nullif(r.payload->>'PostDate','') is not null
      and nullif(r.payload->>'DueDate','') is not null
    group by 1
  )
  select d.post_date,d.source_rows,d.min_due,d.max_due
  from days d
  left join public.clinicorp_schedule_repair_log l
    on l.unit_id=p_unit_id and l.post_date=d.post_date
  where d.min_due <= (date_trunc('month',(now() at time zone 'America/Sao_Paulo')) + interval '1 month - 1 day')::date
    and d.max_due >= date_trunc('month',(now() at time zone 'America/Sao_Paulo'))::date
    and (
      l.last_repaired_at is null
      or (l.last_error is not null and l.updated_at < now()-interval '30 minutes')
    )
  order by
    case when d.min_due <= (now() at time zone 'America/Sao_Paulo')::date
              and d.max_due >= date_trunc('month',(now() at time zone 'America/Sao_Paulo'))::date
         then 0 else 1 end,
    d.source_rows asc,
    d.post_date desc
  limit least(greatest(coalesce(p_limit,2),1),10);
$$;

revoke all on function public.get_clinicorp_schedule_repair_days(bigint,integer) from public,anon,authenticated;
grant execute on function public.get_clinicorp_schedule_repair_days(bigint,integer) to service_role;

update public.sync_runs
set status='failed',
    error_count=greatest(error_count,1),
    error_summary=coalesce(error_summary,'Sincronização interrompida antes da conclusão.'),
    completed_at=coalesce(completed_at,now())
where status='running'
  and started_at < now()-interval '10 minutes';
