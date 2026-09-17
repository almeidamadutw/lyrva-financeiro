create table if not exists public.clinicorp_settlement_requests (
  id bigint generated always as identity primary key,
  patient_id bigint not null references public.patients(id) on delete cascade,
  unit_id bigint not null references public.units(id) on delete cascade,
  patient_unit_id bigint not null references public.patient_units(id) on delete cascade,
  payment_plan_id bigint references public.payment_plans(id) on delete set null,
  requested_by uuid not null,
  status text not null default 'requested' check (status in ('requested','confirmed','cancelled')),
  clinicorp_patient_id text,
  clinicorp_contract_id text,
  clinicorp_url text not null default 'https://sistema.clinicorp.com/',
  requested_at timestamptz not null default now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists clinicorp_settlement_requests_one_open_per_plan
  on public.clinicorp_settlement_requests (patient_unit_id, coalesce(payment_plan_id, 0))
  where status = 'requested';

create index if not exists clinicorp_settlement_requests_patient_idx
  on public.clinicorp_settlement_requests (patient_id, status, requested_at desc);

create index if not exists clinicorp_settlement_requests_plan_idx
  on public.clinicorp_settlement_requests (payment_plan_id, status)
  where payment_plan_id is not null;

alter table public.clinicorp_settlement_requests enable row level security;

drop policy if exists clinicorp_settlement_requests_read on public.clinicorp_settlement_requests;
create policy clinicorp_settlement_requests_read
on public.clinicorp_settlement_requests
for select
to authenticated
using (
  private.current_user_is_financial_staff()
  and private.has_patient_access(patient_id)
);

revoke insert, update, delete on public.clinicorp_settlement_requests from authenticated;
grant select on public.clinicorp_settlement_requests to authenticated;

drop trigger if exists set_updated_at on public.clinicorp_settlement_requests;
create trigger set_updated_at
before update on public.clinicorp_settlement_requests
for each row execute function private.set_updated_at();

create or replace function public.request_clinicorp_settlement(
  p_patient_id bigint,
  p_unit_id bigint,
  p_payment_plan_id bigint default null
)
returns table(request_id bigint, clinicorp_url text, settlement_state text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_patient_unit public.patient_units%rowtype;
  v_plan public.payment_plans%rowtype;
  v_plan_count integer;
  v_request_id bigint;
begin
  if v_user_id is null or not private.current_user_is_financial_staff() then
    raise exception using errcode='42501', message='Este acesso não pode solicitar baixa no Clinicorp.';
  end if;
  if not private.has_patient_access(p_patient_id) then
    raise exception using errcode='42501', message='Você não tem acesso a este paciente.';
  end if;

  select pu.* into v_patient_unit
  from public.patient_units pu
  where pu.patient_id = p_patient_id
    and pu.unit_id = p_unit_id
    and pu.is_active
  order by pu.id desc
  limit 1;

  if not found then
    raise exception using errcode='22023', message='Paciente não vinculado a esta unidade.';
  end if;

  if p_payment_plan_id is null then
    select count(*), min(pp.id)
      into v_plan_count, p_payment_plan_id
    from public.payment_plans pp
    where pp.patient_unit_id = v_patient_unit.id
      and pp.unit_id = p_unit_id
      and pp.status = 'active'
      and pp.archived_at is null;

    if v_plan_count = 0 then
      raise exception using errcode='22023', message='Não existe tratamento financeiro ativo para solicitar baixa.';
    elsif v_plan_count > 1 then
      raise exception using errcode='22023', message='Este paciente possui mais de um tratamento ativo. Selecione qual tratamento será baixado.';
    end if;
  end if;

  select pp.* into v_plan
  from public.payment_plans pp
  where pp.id = p_payment_plan_id
    and pp.patient_unit_id = v_patient_unit.id
    and pp.unit_id = p_unit_id
    and pp.status = 'active'
    and pp.archived_at is null;

  if not found then
    raise exception using errcode='22023', message='Tratamento financeiro ativo não encontrado para este paciente.';
  end if;

  insert into public.clinicorp_settlement_requests (
    patient_id, unit_id, patient_unit_id, payment_plan_id, requested_by,
    clinicorp_patient_id, clinicorp_contract_id, metadata
  ) values (
    p_patient_id, p_unit_id, v_patient_unit.id, v_plan.id, v_user_id,
    v_patient_unit.clinicorp_patient_id, v_plan.clinicorp_contract_id,
    jsonb_build_object('source','lyvra','requested_from','patient_financial_flow')
  )
  on conflict (patient_unit_id, coalesce(payment_plan_id, 0)) where status = 'requested'
  do update set
    requested_by = excluded.requested_by,
    requested_at = now(),
    clinicorp_patient_id = coalesce(excluded.clinicorp_patient_id, public.clinicorp_settlement_requests.clinicorp_patient_id),
    clinicorp_contract_id = coalesce(excluded.clinicorp_contract_id, public.clinicorp_settlement_requests.clinicorp_contract_id),
    updated_at = now()
  returning id into v_request_id;

  return query
  select v_request_id, 'https://sistema.clinicorp.com/'::text, 'requested'::text;
end;
$$;

grant execute on function public.request_clinicorp_settlement(bigint,bigint,bigint) to authenticated;

create or replace function public.cancel_clinicorp_settlement_request(
  p_request_id bigint,
  p_reason text default 'Baixa não concluída no Clinicorp'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient_id bigint;
begin
  if auth.uid() is null or not private.current_user_is_financial_staff() then
    raise exception using errcode='42501', message='Este acesso não pode cancelar solicitação de baixa.';
  end if;

  select r.patient_id into v_patient_id
  from public.clinicorp_settlement_requests r
  where r.id = p_request_id and r.status = 'requested';

  if v_patient_id is null then return false; end if;
  if not private.has_patient_access(v_patient_id) then
    raise exception using errcode='42501', message='Você não tem acesso a este paciente.';
  end if;

  update public.clinicorp_settlement_requests
  set status='cancelled', cancelled_at=now(), cancellation_reason=nullif(btrim(coalesce(p_reason,'')),'')
  where id=p_request_id and status='requested';
  return found;
end;
$$;

grant execute on function public.cancel_clinicorp_settlement_request(bigint,text) to authenticated;

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
     or (new.clinicorp_installment_id is null and coalesce(new.metadata ->> 'clinicorp_patient_id','') = '') then
    return new;
  end if;

  select pp.* into v_plan
  from public.payment_plans pp
  where pp.id = new.payment_plan_id;
  if not found then return new; end if;

  select exists(
    select 1
    from public.installments i
    where i.payment_plan_id = v_plan.id
      and i.status not in ('cancelled','refunded')
      and (i.status <> 'paid' or coalesce(i.paid_amount,0) + 0.01 < coalesce(i.expected_amount,0))
  ) into v_has_open_installment;

  if v_has_open_installment then return new; end if;

  update public.payment_plans
  set status='completed', updated_at=v_now
  where id=v_plan.id and status='active';

  update public.clinicorp_settlement_requests
  set status='confirmed', confirmed_at=coalesce(confirmed_at,v_now),
      metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object('confirmed_by','clinicorp_sync','confirmed_installment_id',new.id)
  where payment_plan_id=v_plan.id and status='requested';

  select pu.patient_id into v_patient_id
  from public.patient_units pu
  where pu.id=v_plan.patient_unit_id;

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

drop trigger if exists reconcile_clinicorp_plan_settlement on public.installments;
create trigger reconcile_clinicorp_plan_settlement
after insert or update of status, paid_amount, confirmed_at, clinicorp_installment_id on public.installments
for each row execute function private.reconcile_clinicorp_plan_settlement();

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname='sync_invoice_obligations_for_plan'
  limit 1;

  if v_def is null then
    raise exception 'sync_invoice_obligations_for_plan não encontrada';
  end if;

  if position('or v_plan.status <> ''active''' in v_def) > 0 then
    v_def := replace(v_def,
      'or v_plan.status <> ''active''',
      'or v_plan.status not in (''active'',''completed'')'
    );
    execute v_def;
  end if;
end;
$$;

create or replace view public.patient_settlement_status as
select
  pu.patient_id,
  pu.id as patient_unit_id,
  pu.unit_id,
  case
    when p.settled_at is not null then 'settled'
    when req.id is not null then 'requested'
    else 'open'
  end as settlement_state,
  req.id as settlement_request_id,
  req.payment_plan_id,
  req.requested_at,
  req.clinicorp_url,
  p.settled_at,
  p.settled_reason
from public.patient_units pu
join public.patients p on p.id=pu.patient_id
left join lateral (
  select r.id,r.payment_plan_id,r.requested_at,r.clinicorp_url
  from public.clinicorp_settlement_requests r
  where r.patient_unit_id=pu.id and r.status='requested'
  order by r.requested_at desc,r.id desc
  limit 1
) req on true;

grant select on public.patient_settlement_status to authenticated;
