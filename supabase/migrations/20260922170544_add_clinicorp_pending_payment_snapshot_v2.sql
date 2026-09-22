
create table if not exists public.clinicorp_payment_snapshot (
  unit_id bigint not null references public.units(id) on delete cascade,
  clinicorp_payment_id text not null,
  clinicorp_patient_id text,
  patient_name text,
  due_date date,
  amount numeric(14,2),
  payment_form text,
  payment_received boolean not null default false,
  payment_confirmed boolean not null default false,
  cancelled boolean not null default false,
  last_seen_at timestamptz not null default now(),
  raw jsonb not null default '{}'::jsonb,
  primary key (unit_id, clinicorp_payment_id)
);

create index if not exists clinicorp_payment_snapshot_due_idx
  on public.clinicorp_payment_snapshot(unit_id, due_date)
  where not payment_received and not payment_confirmed and not cancelled;

alter table public.clinicorp_payment_snapshot enable row level security;

drop policy if exists clinicorp_payment_snapshot_read on public.clinicorp_payment_snapshot;
create policy clinicorp_payment_snapshot_read
on public.clinicorp_payment_snapshot
for select
to authenticated
using (private.has_unit_access(unit_id));

create or replace function private.sync_clinicorp_payment_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_due_date date;
  v_amount numeric(14,2);
begin
  if new.provider <> 'clinicorp' then
    return new;
  end if;

  if nullif(btrim(coalesce(new.payload ->> 'id','')), '') is null then
    return new;
  end if;

  begin
    v_due_date := case
      when nullif(new.payload ->> 'DueDate','') is not null
        then ((new.payload ->> 'DueDate')::timestamptz at time zone 'America/Sao_Paulo')::date
      else null
    end;
  exception when others then
    v_due_date := null;
  end;

  begin
    v_amount := case
      when replace(coalesce(new.payload ->> 'Amount',''), ',', '.') ~ '^[-]?[0-9]+([.][0-9]+)?$'
        then replace(new.payload ->> 'Amount', ',', '.')::numeric
      else null
    end;
  exception when others then
    v_amount := null;
  end;

  insert into public.clinicorp_payment_snapshot(
    unit_id, clinicorp_payment_id, clinicorp_patient_id, patient_name,
    due_date, amount, payment_form, payment_received, payment_confirmed,
    cancelled, last_seen_at, raw
  ) values (
    new.unit_id,
    new.payload ->> 'id',
    nullif(btrim(coalesce(new.payload ->> 'PatientId','')), ''),
    nullif(btrim(coalesce(new.payload ->> 'PatientName','')), ''),
    v_due_date,
    v_amount,
    nullif(btrim(coalesce(new.payload ->> 'PaymentForm','')), ''),
    upper(coalesce(new.payload ->> 'PaymentReceived','')) = 'X',
    upper(coalesce(new.payload ->> 'PaymentConfirmed','')) = 'X',
    upper(coalesce(new.payload ->> 'Canceled','')) = 'X'
      or upper(coalesce(new.payload ->> 'CancelInstallment','')) = 'X',
    coalesce(new.last_seen_at, now()),
    new.payload
  )
  on conflict (unit_id, clinicorp_payment_id) do update
  set clinicorp_patient_id = excluded.clinicorp_patient_id,
      patient_name = excluded.patient_name,
      due_date = excluded.due_date,
      amount = excluded.amount,
      payment_form = excluded.payment_form,
      payment_received = excluded.payment_received,
      payment_confirmed = excluded.payment_confirmed,
      cancelled = excluded.cancelled,
      last_seen_at = excluded.last_seen_at,
      raw = excluded.raw
  where excluded.last_seen_at >= public.clinicorp_payment_snapshot.last_seen_at;

  return new;
end;
$$;

drop trigger if exists sync_clinicorp_payment_snapshot on public.integration_source_records;
create trigger sync_clinicorp_payment_snapshot
after insert or update of payload,last_seen_at
on public.integration_source_records
for each row
when (new.provider = 'clinicorp')
execute function private.sync_clinicorp_payment_snapshot();

insert into public.clinicorp_payment_snapshot(
  unit_id, clinicorp_payment_id, clinicorp_patient_id, patient_name,
  due_date, amount, payment_form, payment_received, payment_confirmed,
  cancelled, last_seen_at, raw
)
select
  x.unit_id,
  x.payload ->> 'id',
  nullif(btrim(coalesce(x.payload ->> 'PatientId','')), ''),
  nullif(btrim(coalesce(x.payload ->> 'PatientName','')), ''),
  case
    when nullif(x.payload ->> 'DueDate','') is not null
      then ((x.payload ->> 'DueDate')::timestamptz at time zone 'America/Sao_Paulo')::date
    else null
  end,
  case
    when replace(coalesce(x.payload ->> 'Amount',''), ',', '.') ~ '^[-]?[0-9]+([.][0-9]+)?$'
      then replace(x.payload ->> 'Amount', ',', '.')::numeric
    else null
  end,
  nullif(btrim(coalesce(x.payload ->> 'PaymentForm','')), ''),
  upper(coalesce(x.payload ->> 'PaymentReceived','')) = 'X',
  upper(coalesce(x.payload ->> 'PaymentConfirmed','')) = 'X',
  upper(coalesce(x.payload ->> 'Canceled','')) = 'X'
    or upper(coalesce(x.payload ->> 'CancelInstallment','')) = 'X',
  x.last_seen_at,
  x.payload
from (
  select distinct on (r.unit_id, r.payload ->> 'id')
    r.unit_id,
    r.payload,
    r.last_seen_at,
    r.id
  from public.integration_source_records r
  where r.provider='clinicorp'
    and r.unit_id is not null
    and nullif(btrim(coalesce(r.payload ->> 'id','')), '') is not null
  order by r.unit_id, r.payload ->> 'id', r.last_seen_at desc, r.id desc
) x
on conflict (unit_id, clinicorp_payment_id) do update
set clinicorp_patient_id = excluded.clinicorp_patient_id,
    patient_name = excluded.patient_name,
    due_date = excluded.due_date,
    amount = excluded.amount,
    payment_form = excluded.payment_form,
    payment_received = excluded.payment_received,
    payment_confirmed = excluded.payment_confirmed,
    cancelled = excluded.cancelled,
    last_seen_at = excluded.last_seen_at,
    raw = excluded.raw
where excluded.last_seen_at >= public.clinicorp_payment_snapshot.last_seen_at;

create or replace function public.get_clinicorp_pending_total(
  p_unit_code text default null,
  p_ranges jsonb default '[]'::jsonb
)
returns table(
  pending_amount numeric,
  pending_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with ranges as (
    select
      x.from_date::date as from_date,
      x.to_date::date as to_date
    from jsonb_to_recordset(
      case
        when jsonb_typeof(coalesce(p_ranges,'[]'::jsonb))='array'
          then coalesce(p_ranges,'[]'::jsonb)
        else '[]'::jsonb
      end
    ) as x(from_date text, to_date text)
    where x.from_date ~ '^\d{4}-\d{2}-\d{2}$'
      and x.to_date ~ '^\d{4}-\d{2}-\d{2}$'
      and x.from_date <= x.to_date
  ),
  eligible as (
    select s.*
    from public.clinicorp_payment_snapshot s
    join public.units u on u.id=s.unit_id
    where private.has_unit_access(s.unit_id)
      and (
        p_unit_code is null
        or p_unit_code=''
        or p_unit_code='todas'
        or u.code=p_unit_code
      )
      and s.amount is not null
      and s.amount > 0
      and s.due_date is not null
      and not s.payment_received
      and not s.payment_confirmed
      and not s.cancelled
      and exists (
        select 1
        from ranges r
        where s.due_date between r.from_date and r.to_date
      )
  )
  select
    coalesce(sum(amount),0)::numeric as pending_amount,
    count(*)::bigint as pending_count
  from eligible;
$$;

revoke all on function public.get_clinicorp_pending_total(text,jsonb) from public,anon;
grant execute on function public.get_clinicorp_pending_total(text,jsonb) to authenticated;
