-- Full source-day coverage, resumable payloads and fenced single-worker leases.
-- Source calls use Brazilian creation dates, not UTC substrings.
create or replace function private.clinicorp_posting_day(p_value text)
returns date language plpgsql immutable set search_path='' as $fn$
begin
  if p_value ~ '^\d{4}-\d{2}-\d{2}$' then return p_value::date; end if;
  if p_value ~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' then
    return (p_value::timestamptz at time zone 'America/Sao_Paulo')::date;
  end if;
  return null;
exception when invalid_datetime_format or datetime_field_overflow then return null;
end; $fn$;

alter table public.clinicorp_payment_snapshot add column if not exists posting_day date;
create index if not exists clinicorp_snapshot_posting_day_idx
  on public.clinicorp_payment_snapshot(unit_id,posting_day,clinicorp_payment_id);

create table private.clinicorp_sync_days (
  id bigint generated always as identity primary key,
  unit_id bigint not null references public.units(id),
  posting_day date not null,
  priority integer not null default 0,
  status text not null default 'pending' check(status in ('pending','working','retry','done')),
  phase text not null default 'fetch' check(phase in ('fetch','apply','verify')),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  attempts integer not null default 0,
  observed_at timestamptz,
  refresh_requested_at timestamptz,
  payload jsonb,
  apply_cursor integer not null default 0 check(apply_cursor>=0),
  returned_rows integer not null default 0,
  changed_rows integer not null default 0,
  missing_rows integer not null default 0,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(unit_id,posting_day)
);
alter table private.clinicorp_sync_days enable row level security;
revoke all on private.clinicorp_sync_days from public,anon,authenticated;
create index clinicorp_sync_days_ready_idx on private.clinicorp_sync_days(next_attempt_at,priority desc,id);
create index clinicorp_sync_days_lease_idx on private.clinicorp_sync_days(lease_until) where status='working';

create table private.clinicorp_sync_control (
  singleton boolean primary key default true check(singleton),
  last_unit_id bigint,
  claims bigint not null default 0,
  snapshot_unit_cursor bigint not null default 0,
  snapshot_id_cursor text not null default '',
  snapshot_backfill_done boolean not null default false,
  seeded_at timestamptz,
  enabled boolean not null default false
);
alter table private.clinicorp_sync_control enable row level security;
revoke all on private.clinicorp_sync_control from public,anon,authenticated;
insert into private.clinicorp_sync_control(singleton) values(true);

create or replace function private.require_clinicorp_service()
returns void language plpgsql stable set search_path='' as $fn$
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception using errcode='42501',message='Rotina exclusiva da integração segura.';
  end if;
end; $fn$;

create or replace function private.track_clinicorp_snapshot_day()
returns trigger language plpgsql security definer set search_path='' as $fn$
begin
  new.posting_day:=private.clinicorp_posting_day(new.raw->>'PostDate');
  return new;
end; $fn$;
create trigger clinicorp_snapshot_posting_day before insert or update of raw
  on public.clinicorp_payment_snapshot for each row execute function private.track_clinicorp_snapshot_day();

create or replace function private.enqueue_clinicorp_changed_day()
returns trigger language plpgsql security definer set search_path='' as $fn$
declare v_changed boolean;
begin
  if new.posting_day is null then return new; end if;
  if nullif(current_setting('lyvra.clinicorp_sync_job',true),'') is not null then return new; end if;
  if tg_op='INSERT' then v_changed:=true;
  else v_changed:=row(old.posting_day,old.amount,old.due_date,old.payment_form,old.payment_received,old.payment_confirmed,old.cancelled,old.clinicorp_patient_id)
    is distinct from row(new.posting_day,new.amount,new.due_date,new.payment_form,new.payment_received,new.payment_confirmed,new.cancelled,new.clinicorp_patient_id);
  end if;
  if not v_changed then return new; end if;
  insert into private.clinicorp_sync_days(unit_id,posting_day,priority,refresh_requested_at)
  values(new.unit_id,new.posting_day,200,clock_timestamp())
  on conflict(unit_id,posting_day) do update set
    priority=greatest(private.clinicorp_sync_days.priority,200),
    refresh_requested_at=excluded.refresh_requested_at,
    next_attempt_at=least(private.clinicorp_sync_days.next_attempt_at,now()),
    status=case when private.clinicorp_sync_days.status='working' then 'working' else 'pending' end,
    updated_at=now();
  return new;
end; $fn$;
create trigger clinicorp_snapshot_enqueue_change after insert or update of raw
  on public.clinicorp_payment_snapshot for each row execute function private.enqueue_clinicorp_changed_day();

create or replace function public.backfill_clinicorp_posting_days(p_limit integer default 5000)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_control private.clinicorp_sync_control%rowtype; v_count integer; v_unit bigint; v_id text;
begin
  perform private.require_clinicorp_service();
  select * into v_control from private.clinicorp_sync_control where singleton for update;
  if v_control.snapshot_backfill_done then return jsonb_build_object('done',true,'processed',0); end if;
  with picked as materialized (
    select unit_id,clinicorp_payment_id from public.clinicorp_payment_snapshot
    where (unit_id,clinicorp_payment_id)>(v_control.snapshot_unit_cursor,v_control.snapshot_id_cursor)
    order by unit_id,clinicorp_payment_id limit least(greatest(coalesce(p_limit,5000),1),5000)
  ), changed as (
    update public.clinicorp_payment_snapshot s set posting_day=private.clinicorp_posting_day(s.raw->>'PostDate')
    from picked p where s.unit_id=p.unit_id and s.clinicorp_payment_id=p.clinicorp_payment_id
    returning s.unit_id,s.clinicorp_payment_id
  ) select count(*),(array_agg(unit_id order by unit_id desc,clinicorp_payment_id desc))[1],
      (array_agg(clinicorp_payment_id order by unit_id desc,clinicorp_payment_id desc))[1]
    into v_count,v_unit,v_id from changed;
  update private.clinicorp_sync_control set
    snapshot_unit_cursor=coalesce(v_unit,snapshot_unit_cursor),snapshot_id_cursor=coalesce(v_id,snapshot_id_cursor),
    snapshot_backfill_done=(v_count=0) where singleton;
  return jsonb_build_object('done',v_count=0,'processed',v_count);
end; $fn$;

create or replace function public.seed_clinicorp_sync_jobs()
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_inserted integer; v_prioritized integer;
begin
  perform private.require_clinicorp_service();
  if not (select snapshot_backfill_done from private.clinicorp_sync_control where singleton) then
    raise exception 'O índice de datas ainda está sendo preparado.';
  end if;
  -- Calendar gaps are covered too: a source-only record cannot disappear from coverage.
  with connected as (
    select distinct u.id,least(coalesce(private.clinicorp_posting_day(c.non_secret_config->>'directory_backfill_floor'),'2015-01-01'::date),
      coalesce((select min(s.posting_day) from public.clinicorp_payment_snapshot s where s.unit_id=u.id),'2015-01-01'::date)) first_day
    from public.units u join public.integration_connections c on c.unit_id=u.id and c.provider='clinicorp' and c.status='connected'
    where u.is_active
  ), source_days as (
    select c.id unit_id,d::date posting_day from connected c
    cross join lateral generate_series(c.first_day,(now() at time zone 'America/Sao_Paulo')::date,'1 day'::interval) d
    union select unit_id,posting_day from public.clinicorp_payment_snapshot where posting_day is not null
  ) insert into private.clinicorp_sync_days(unit_id,posting_day)
    select unit_id,posting_day from source_days on conflict(unit_id,posting_day) do nothing;
  get diagnostics v_inserted=row_count;
  with priorities as (
    select s.unit_id,s.posting_day,max(case
      when lower(coalesce(s.payment_form,'')) like '%boleto%' and not s.payment_received and not s.payment_confirmed and not s.cancelled then
        case when s.due_date<(now() at time zone 'America/Sao_Paulo')::date then 100
          else 50 end
      else 0 end) priority
    from public.clinicorp_payment_snapshot s where s.posting_day is not null group by 1,2
  ) update private.clinicorp_sync_days j set priority=greatest(j.priority,p.priority)
    from priorities p where j.unit_id=p.unit_id and j.posting_day=p.posting_day and j.priority<p.priority;
  get diagnostics v_prioritized=row_count;
  update private.clinicorp_sync_control set seeded_at=now() where singleton;
  return jsonb_build_object('inserted',v_inserted,'prioritized',v_prioritized);
end; $fn$;

create or replace function public.claim_clinicorp_sync_job()
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_job private.clinicorp_sync_days%rowtype; v_control private.clinicorp_sync_control%rowtype; v_token uuid;
begin
  perform private.require_clinicorp_service();
  select * into v_control from private.clinicorp_sync_control where singleton for update;
  if not v_control.enabled then return null; end if;
  if exists(select 1 from private.clinicorp_sync_days where status='working' and lease_until>clock_timestamp()) then return null; end if;
  select * into v_job from private.clinicorp_sync_days j
    where j.next_attempt_at<=now() and (j.status<>'working' or j.lease_until<=clock_timestamp())
      and j.posting_day<=(now() at time zone 'America/Sao_Paulo')::date
    order by
      (j.phase<>'fetch' and j.status in ('working','retry')) desc,
      -- Every fifth claim reserves capacity for never-scanned history.
      (v_control.claims%5=4 and j.last_success_at is null) desc,
      case when j.last_success_at is null or j.last_success_at<now()-interval '12 hours' then j.priority else 0 end desc,
      (j.unit_id is distinct from v_control.last_unit_id) desc,
      j.last_success_at asc nulls first,j.next_attempt_at,j.id
    limit 1 for update skip locked;
  if not found then return null; end if;
  v_token:=gen_random_uuid();
  update private.clinicorp_sync_days set status='working',lease_token=v_token,lease_until=clock_timestamp()+interval '2 minutes',
    attempts=attempts+1,last_error=null,updated_at=now() where id=v_job.id;
  update private.clinicorp_sync_control set last_unit_id=v_job.unit_id,claims=claims+1 where singleton;
  return jsonb_build_object('id',v_job.id,'unit_id',v_job.unit_id,'unit_code',(select code from public.units where id=v_job.unit_id),
    'posting_day',v_job.posting_day,'phase',v_job.phase,'lease_token',v_token,'cursor',v_job.apply_cursor,'returned_rows',v_job.returned_rows);
end; $fn$;

create or replace function public.stage_clinicorp_sync_job(p_job_id bigint,p_lease_token uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_job private.clinicorp_sync_days%rowtype; v_count integer;
begin
  perform private.require_clinicorp_service();
  select * into v_job from private.clinicorp_sync_days where id=p_job_id for update;
  if not found or v_job.status<>'working' or v_job.lease_token is distinct from p_lease_token or v_job.lease_until<clock_timestamp() then
    raise exception using errcode='55000',message='A concessão de processamento expirou.';
  end if;
  if v_job.phase<>'fetch' then raise exception 'O lote já foi recebido.'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or octet_length(p_rows::text)>8000000 then raise exception 'Lote inválido ou maior que o limite seguro.'; end if;
  v_count:=jsonb_array_length(p_rows);
  if v_count>15000 or exists(select 1 from jsonb_array_elements(p_rows) r where jsonb_typeof(r)<>'object'
     or coalesce(btrim(r->>'id'),'')='' or coalesce(btrim(r->>'PaymentForm'),'')=''
     or private.clinicorp_posting_day(r->>'PostDate') is distinct from v_job.posting_day) then
    raise exception 'A resposta não comprova os registros da data solicitada.';
  end if;
  if (select count(distinct r->>'id') from jsonb_array_elements(p_rows) r)<>v_count then raise exception 'IDs duplicados na resposta.'; end if;
  update private.clinicorp_sync_days set payload=p_rows,returned_rows=v_count,apply_cursor=0,changed_rows=0,missing_rows=0,
    observed_at=clock_timestamp(),phase='apply',lease_until=clock_timestamp()+interval '2 minutes',updated_at=now() where id=p_job_id;
  return jsonb_build_object('rows',v_count,'phase','apply');
end; $fn$;

create or replace function public.release_clinicorp_sync_job(p_job_id bigint,p_lease_token uuid,p_error text default null)
returns boolean language plpgsql security definer set search_path='' as $fn$
begin
  perform private.require_clinicorp_service();
  update private.clinicorp_sync_days set status=case when p_error is null then 'pending' else 'retry' end,
    next_attempt_at=case when p_error is null then now() else now()+make_interval(secs=>least(1800,10*power(2,least(attempts,8)))::integer) end,
    lease_token=null,lease_until=null,last_error=left(p_error,500),updated_at=now()
    where id=p_job_id and status='working' and lease_token=p_lease_token;
  return found;
end; $fn$;

revoke all on function public.backfill_clinicorp_posting_days(integer),public.seed_clinicorp_sync_jobs(),
 public.claim_clinicorp_sync_job(),public.stage_clinicorp_sync_job(bigint,uuid,jsonb),public.release_clinicorp_sync_job(bigint,uuid,text)
 from public,anon,authenticated;
grant execute on function public.backfill_clinicorp_posting_days(integer),public.seed_clinicorp_sync_jobs(),
 public.claim_clinicorp_sync_job(),public.stage_clinicorp_sync_job(bigint,uuid,jsonb),public.release_clinicorp_sync_job(bigint,uuid,text) to service_role;
