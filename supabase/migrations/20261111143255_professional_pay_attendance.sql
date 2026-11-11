-- Folha de ponto e remuneração de profissionais por unidade.
create table private.professional_pay_operators (
  user_id uuid not null,
  unit_id bigint not null,
  primary key (user_id, unit_id),
  foreign key (user_id, unit_id) references public.profile_units (user_id, unit_id) on delete cascade
);

create function private.can_manage_professional_pay(p_unit_id bigint)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.has_unit_access(p_unit_id) and (
    private.current_user_role() in ('gestora', 'ceo')
    or exists (
      select 1 from private.professional_pay_operators
      where user_id = (select auth.uid()) and unit_id = p_unit_id
    )
  );
$$;

create table public.professional_pay_profiles (
  id bigint generated always as identity primary key,
  unit_id bigint not null references public.units (id),
  name text not null check (char_length(name) between 2 and 120),
  unique (unit_id, id)
);

create unique index professional_pay_profiles_unit_name_idx
  on public.professional_pay_profiles (unit_id, lower(name));

create table public.professional_pay_rules (
  id bigint generated always as identity primary key,
  unit_id bigint not null,
  professional_id bigint not null,
  effective_from date not null,
  mode text not null check (mode in ('daily', 'procedure', 'delivery')),
  daily_cents integer check (daily_cents > 0),
  planning_cents integer check (planning_cents > 0),
  saturday_cents integer check (saturday_cents > 0),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  foreign key (unit_id, professional_id) references public.professional_pay_profiles (unit_id, id),
  check (
    (mode = 'daily' and daily_cents is not null)
    or (mode <> 'daily' and daily_cents is null and planning_cents is null and saturday_cents is null)
  )
);

create index professional_pay_rules_lookup_idx
  on public.professional_pay_rules (unit_id, professional_id, effective_from desc, id desc);

create table public.professional_attendance (
  id bigint generated always as identity primary key,
  unit_id bigint not null,
  professional_id bigint not null,
  work_date date not null,
  status text not null check (status in ('pending', 'validated', 'paid', 'cancelled')),
  service_kind text not null check (service_kind in ('daily', 'planning', 'saturday', 'procedure', 'delivery')),
  professional_signed boolean not null,
  finance_signed boolean not null,
  notes text check (char_length(notes) <= 600),
  rule_id bigint references public.professional_pay_rules (id),
  amount_cents integer check (amount_cents > 0),
  proposed_amount_cents integer check (proposed_amount_cents > 0),
  validated_by uuid,
  validated_at timestamptz,
  paid_on date check (paid_on >= work_date),
  payment_reference text check (char_length(payment_reference) <= 180),
  change_reason text check (char_length(change_reason) <= 600),
  updated_by uuid not null,
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  foreign key (unit_id, professional_id) references public.professional_pay_profiles (unit_id, id),
  unique (unit_id, professional_id, work_date),
  unique (unit_id, id),
  check (
    (status in ('validated', 'paid') and professional_signed and finance_signed
      and rule_id is not null and amount_cents is not null and validated_by is not null and validated_at is not null)
    or (status in ('pending', 'cancelled')
      and rule_id is null and amount_cents is null and validated_by is null and validated_at is null)
  ),
  check ((status = 'paid') = (paid_on is not null))
);

create index professional_attendance_unit_month_idx
  on public.professional_attendance (unit_id, work_date, id);

-- O histórico da folha tem retenção própria e acompanha a transação do lançamento.
create table public.professional_attendance_history (
  id bigint generated always as identity primary key,
  unit_id bigint not null,
  attendance_id bigint not null,
  actor_name text not null,
  occurred_at timestamptz not null default now(),
  snapshot jsonb not null,
  foreign key (unit_id, attendance_id) references public.professional_attendance (unit_id, id)
);

create index professional_attendance_history_lookup_idx
  on public.professional_attendance_history (unit_id, attendance_id, id desc);

alter table public.professional_pay_profiles enable row level security;
alter table public.professional_pay_rules enable row level security;
alter table public.professional_attendance enable row level security;
alter table public.professional_attendance_history enable row level security;

revoke all on public.professional_pay_profiles, public.professional_pay_rules,
  public.professional_attendance, public.professional_attendance_history from public, anon, authenticated;
grant select on public.professional_pay_profiles, public.professional_pay_rules,
  public.professional_attendance, public.professional_attendance_history to authenticated;

create policy professional_pay_profiles_read on public.professional_pay_profiles
  for select to authenticated using ((select private.can_manage_professional_pay(unit_id)));
create policy professional_pay_rules_read on public.professional_pay_rules
  for select to authenticated using ((select private.can_manage_professional_pay(unit_id)));
create policy professional_attendance_read on public.professional_attendance
  for select to authenticated using ((select private.can_manage_professional_pay(unit_id)));
create policy professional_attendance_history_read on public.professional_attendance_history
  for select to authenticated using ((select private.can_manage_professional_pay(unit_id)));

create function public.get_professional_pay_units()
returns table (id bigint, code text, name text)
language sql stable
set search_path = ''
as $$
  select u.id, u.code, u.name
  from public.units u
  where private.can_manage_professional_pay(u.id)
  order by u.name;
$$;

create function private.save_professional_pay_rule(p_unit_id bigint, p_input jsonb)
returns bigint
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id bigint := (p_input ->> 'professional_id')::bigint;
  v_name text := regexp_replace(btrim(p_input ->> 'name'), '[[:space:]]+', ' ', 'g');
  v_effective date := (p_input ->> 'effective_from')::date;
  v_mode text := p_input ->> 'mode';
  v_daily integer := (p_input ->> 'daily_cents')::integer;
  v_planning integer := (p_input ->> 'planning_cents')::integer;
  v_saturday integer := (p_input ->> 'saturday_cents')::integer;
  v_previous public.professional_pay_rules%rowtype;
begin
  if private.can_manage_professional_pay(p_unit_id) is not true then
    raise exception 'Você não tem acesso às diárias desta unidade.' using errcode = '42501';
  end if;

  if v_effective is null or v_effective < date '2000-01-01' or v_effective >= date '2100-01-01'
    or v_mode is null or v_mode not in ('daily', 'procedure', 'delivery')
    or (v_mode = 'daily' and (coalesce(v_daily, 0) <= 0 or v_planning <= 0 or v_saturday <= 0))
    or (v_mode <> 'daily' and (v_daily is not null or v_planning is not null or v_saturday is not null))
  then
    raise exception 'Preencha a vigência e os valores da regra corretamente.';
  end if;

  if v_id is null then
    if v_name is null or char_length(v_name) not between 2 and 120 then
      raise exception 'Informe o nome do profissional.';
    end if;
    insert into public.professional_pay_profiles (unit_id, name)
    values (p_unit_id, v_name)
    on conflict (unit_id, lower(name)) do nothing
    returning id into v_id;
    if v_id is null then
      raise exception 'Já existe um profissional com esse nome nesta unidade. Atualize a regra no cadastro existente.';
    end if;
  else
    perform 1 from public.professional_pay_profiles
    where id = v_id and unit_id = p_unit_id for update;
    if not found then raise exception 'Profissional não encontrado nesta unidade.'; end if;

    select * into v_previous from public.professional_pay_rules
    where professional_id = v_id and unit_id = p_unit_id and effective_from = v_effective
    order by id desc limit 1;
    if found and row(v_previous.mode, v_previous.daily_cents, v_previous.planning_cents, v_previous.saturday_cents)
      is not distinct from row(v_mode, v_daily, v_planning, v_saturday) then
      return v_id;
    end if;
  end if;

  insert into public.professional_pay_rules (
    unit_id, professional_id, effective_from, mode, daily_cents, planning_cents, saturday_cents, created_by
  ) values (p_unit_id, v_id, v_effective, v_mode, v_daily, v_planning, v_saturday, auth.uid());
  return v_id;
end;
$$;

create function private.save_professional_attendance(p_unit_id bigint, p_action text, p_input jsonb)
returns bigint
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_professional_id bigint := (p_input ->> 'professional_id')::bigint;
  v_date date := (p_input ->> 'work_date')::date;
  v_revision integer := (p_input ->> 'revision')::integer;
  v_reason text := nullif(btrim(p_input ->> 'reason'), '');
  v_existing public.professional_attendance%rowtype;
  v_row public.professional_attendance%rowtype;
  v_rule public.professional_pay_rules%rowtype;
begin
  if private.can_manage_professional_pay(p_unit_id) is not true then
    raise exception 'Você não tem acesso às diárias desta unidade.' using errcode = '42501';
  end if;
  if v_date is null or v_date < date '2000-01-01' or v_date > v_today then
    raise exception 'Informe uma data de comparecimento até hoje.';
  end if;

  -- A mesma trava é usada pelo cadastro de regras e serializa gravações concorrentes.
  perform 1 from public.professional_pay_profiles
  where id = v_professional_id and unit_id = p_unit_id for update;
  if not found then raise exception 'Profissional não encontrado nesta unidade.'; end if;

  select * into v_existing from public.professional_attendance
  where unit_id = p_unit_id and professional_id = v_professional_id and work_date = v_date;
  if v_revision is distinct from coalesce(v_existing.revision, 0) then
    raise exception 'Este dia foi alterado. Atualize a folha antes de continuar.';
  end if;
  v_row := v_existing;
  v_row.change_reason := null;

  case p_action
    when 'pending', 'validate' then
      if v_existing.status is not null and v_existing.status <> 'pending' then
        raise exception 'Apenas lançamentos pendentes podem ser conferidos.';
      end if;

      select * into v_rule from public.professional_pay_rules
      where unit_id = p_unit_id and professional_id = v_professional_id and effective_from <= v_date
      order by effective_from desc, id desc limit 1;
      if not found then raise exception 'Cadastre uma regra de remuneração vigente para esta data.'; end if;

      v_row.professional_signed := coalesce((p_input ->> 'professional_signed')::boolean, false);
      v_row.finance_signed := coalesce((p_input ->> 'finance_signed')::boolean, false);
      v_row.notes := nullif(btrim(p_input ->> 'notes'), '');
      v_row.status := 'pending';

      v_row.proposed_amount_cents := null;
      if v_rule.mode <> 'daily' then
        v_row.service_kind := v_rule.mode;
        v_row.proposed_amount_cents := (p_input ->> 'amount_cents')::integer;
      elsif (p_input ->> 'planning')::boolean is true then
        if v_rule.planning_cents is null then raise exception 'Planejamento não está configurado para esta data.'; end if;
        v_row.service_kind := 'planning';
      elsif extract(isodow from v_date) = 6 and v_rule.saturday_cents is not null then
        v_row.service_kind := 'saturday';
      else
        v_row.service_kind := 'daily';
      end if;

      if p_action = 'validate' then
        if (p_input ->> 'rule_id')::bigint is distinct from v_rule.id then
          raise exception 'A regra desta data mudou. Reabra o lançamento e confira o valor.';
        end if;
        if not (v_row.professional_signed and v_row.finance_signed) then
          raise exception 'Confirme as assinaturas do profissional e do financeiro antes de validar.';
        end if;
        v_row.amount_cents := case v_row.service_kind
          when 'daily' then v_rule.daily_cents
          when 'planning' then v_rule.planning_cents
          when 'saturday' then v_rule.saturday_cents
          else v_row.proposed_amount_cents
        end;
        if v_row.amount_cents is null or v_row.amount_cents <= 0
          or (v_rule.mode <> 'daily' and v_row.notes is null) then
          raise exception 'Informe o valor e descreva o procedimento ou a entrega.';
        end if;
        v_row.rule_id := v_rule.id;
        v_row.validated_at := now();
        v_row.validated_by := v_actor;
        v_row.status := 'validated';
      end if;

    when 'pay' then
      if v_existing.status is distinct from 'validated' then
        raise exception 'Apenas lançamentos validados podem ser marcados como pagos.';
      end if;
      v_row.paid_on := (p_input ->> 'paid_on')::date;
      if v_row.paid_on is null or v_row.paid_on < v_date or v_row.paid_on > v_today then
        raise exception 'Informe uma data de pagamento entre o comparecimento e hoje.';
      end if;
      v_row.payment_reference := nullif(btrim(p_input ->> 'payment_reference'), '');
      v_row.status := 'paid';

    when 'reopen', 'cancel' then
      if v_existing.status is null or v_existing.status = 'paid'
        or (p_action = 'reopen' and v_existing.status = 'pending')
        or (p_action = 'cancel' and v_existing.status = 'cancelled') then
        raise exception 'Este lançamento não pode mudar para o status solicitado.';
      end if;
      if v_reason is null then raise exception 'Informe o motivo da correção.'; end if;

      v_row.change_reason := v_reason;
      v_row.amount_cents := null;
      v_row.rule_id := null;
      v_row.validated_by := null;
      v_row.validated_at := null;
      v_row.status := case when p_action = 'cancel' then 'cancelled' else 'pending' end;
      if p_action = 'reopen' then v_row.finance_signed := false; end if;

    else
      raise exception 'Ação de comparecimento inválida.';
  end case;

  if v_existing.id is null then
    insert into public.professional_attendance (
      unit_id, professional_id, work_date, status, service_kind, professional_signed, finance_signed,
      notes, rule_id, amount_cents, proposed_amount_cents, validated_by, validated_at, updated_by
    ) values (
      p_unit_id, v_professional_id, v_date, v_row.status, v_row.service_kind, v_row.professional_signed,
      v_row.finance_signed, v_row.notes, v_row.rule_id, v_row.amount_cents, v_row.proposed_amount_cents,
      v_row.validated_by, v_row.validated_at, v_actor
    ) returning * into v_row;
  else
    update public.professional_attendance set
      status = v_row.status, service_kind = v_row.service_kind, professional_signed = v_row.professional_signed,
      finance_signed = v_row.finance_signed, notes = v_row.notes, rule_id = v_row.rule_id, amount_cents = v_row.amount_cents,
      proposed_amount_cents = v_row.proposed_amount_cents, validated_by = v_row.validated_by, validated_at = v_row.validated_at, paid_on = v_row.paid_on,
      payment_reference = v_row.payment_reference, change_reason = v_row.change_reason,
      updated_by = v_actor, updated_at = now(), revision = v_existing.revision + 1
    where id = v_existing.id returning * into v_row;
  end if;

  insert into public.professional_attendance_history (unit_id, attendance_id, actor_name, snapshot)
  select p_unit_id, v_row.id, full_name, to_jsonb(v_row)
  from public.profiles where user_id = v_actor;
  return v_row.id;
end;
$$;

create function public.save_professional_pay_rule(p_unit_id bigint, p_input jsonb)
returns bigint language sql set search_path = ''
as $$ select private.save_professional_pay_rule(p_unit_id, p_input); $$;

create function public.save_professional_attendance(p_unit_id bigint, p_action text, p_input jsonb)
returns bigint language sql set search_path = ''
as $$ select private.save_professional_attendance(p_unit_id, p_action, p_input); $$;

revoke all on function private.can_manage_professional_pay(bigint),
  private.save_professional_pay_rule(bigint, jsonb), private.save_professional_attendance(bigint, text, jsonb),
  public.get_professional_pay_units(), public.save_professional_pay_rule(bigint, jsonb),
  public.save_professional_attendance(bigint, text, jsonb) from public, anon, authenticated;
grant execute on function private.can_manage_professional_pay(bigint),
  private.save_professional_pay_rule(bigint, jsonb), private.save_professional_attendance(bigint, text, jsonb),
  public.get_professional_pay_units(), public.save_professional_pay_rule(bigint, jsonb),
  public.save_professional_attendance(bigint, text, jsonb) to authenticated;
