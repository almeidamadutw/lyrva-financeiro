-- Valores de entrega versionados e itens conferidos preservados com cada lançamento.
alter table public.professional_pay_rules
  add column price_items jsonb not null default '[]'
    check (jsonb_typeof(price_items) = 'array' and (mode = 'delivery' or price_items = '[]'::jsonb));

alter table public.professional_attendance
  add column priced_items jsonb not null default '[]'
    check (jsonb_typeof(priced_items) = 'array' and (service_kind in ('procedure', 'delivery') or priced_items = '[]'::jsonb));

create index professional_attendance_procedure_prices_idx
  on public.professional_attendance (unit_id, professional_id, validated_at desc, id desc)
  where service_kind = 'procedure' and status in ('validated', 'paid') and priced_items <> '[]'::jsonb;

create function public.get_professional_procedure_prices(p_unit_id bigint, p_professional_id bigint)
returns table (name text, unit_cents integer)
language sql stable
set search_path = ''
as $$
  select price.name, price.unit_cents
  from (
    select distinct on (lower(item.value ->> 'name'))
      item.value ->> 'name' as name, (item.value ->> 'unit_cents')::integer as unit_cents
    from public.professional_attendance a
    cross join lateral jsonb_array_elements(a.priced_items) as item(value)
    where a.unit_id = p_unit_id and a.professional_id = p_professional_id
      and a.service_kind = 'procedure' and a.status in ('validated', 'paid') and a.priced_items <> '[]'::jsonb
    order by lower(item.value ->> 'name'), a.validated_at desc, a.id desc
  ) as price
  order by price.name;
$$;

revoke all on function public.get_professional_procedure_prices(bigint, bigint) from public, anon, authenticated;
grant execute on function public.get_professional_procedure_prices(bigint, bigint) to authenticated;

create or replace function private.save_professional_pay_rule(p_unit_id bigint, p_input jsonb)
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
  v_prices jsonb := '[]';
  v_item jsonb;
  v_item_name text;
  v_item_cents integer;
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

  if p_input ? 'price_items' then
    if jsonb_typeof(p_input -> 'price_items') is distinct from 'array'
      or (v_mode <> 'delivery' and p_input -> 'price_items' <> '[]'::jsonb) then
      raise exception 'A tabela de valores padrão é exclusiva de entregas.';
    end if;
    for v_item in select value from jsonb_array_elements(p_input -> 'price_items') loop
      v_item_name := btrim(regexp_replace(v_item ->> 'name', '[[:space:]]+', ' ', 'g'));
      v_item_cents := (v_item ->> 'unit_cents')::integer;
      if jsonb_typeof(v_item -> 'name') is distinct from 'string'
        or char_length(v_item_name) not between 2 and 120
        or coalesce(v_item_cents, 0) <= 0
        or exists (select 1 from jsonb_array_elements(v_prices) as item(value)
          where lower(item.value ->> 'name') = lower(v_item_name)) then
        raise exception 'Informe nomes diferentes e valores positivos para as entregas.';
      end if;
      v_prices := v_prices || jsonb_build_array(jsonb_build_object('name', v_item_name, 'unit_cents', v_item_cents));
    end loop;
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
    where professional_id = v_id and unit_id = p_unit_id and effective_from <= v_effective
    order by effective_from desc, id desc limit 1;
    if v_mode = 'delivery' and v_previous.mode = 'delivery' and not (p_input ? 'price_items') then
      v_prices := v_previous.price_items;
    end if;
    if v_previous.effective_from = v_effective
      and row(v_previous.mode, v_previous.daily_cents, v_previous.planning_cents, v_previous.saturday_cents, v_previous.price_items)
      is not distinct from row(v_mode, v_daily, v_planning, v_saturday, v_prices) then
      return v_id;
    end if;
  end if;

  insert into public.professional_pay_rules (
    unit_id, professional_id, effective_from, mode, daily_cents, planning_cents, saturday_cents, price_items, created_by
  ) values (p_unit_id, v_id, v_effective, v_mode, v_daily, v_planning, v_saturday, v_prices, auth.uid());
  return v_id;
end;
$$;

create or replace function private.save_professional_attendance(p_unit_id bigint, p_action text, p_input jsonb)
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
  v_items jsonb := coalesce(p_input -> 'priced_items', '[]'::jsonb);
  v_item jsonb;
  v_item_name text;
  v_item_cents integer;
  v_quantity integer;
  v_total bigint := 0;
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

      if jsonb_typeof(v_items) is distinct from 'array' then
        raise exception 'Informe uma lista válida de itens.';
      end if;
      if (p_action = 'validate' or v_items <> '[]'::jsonb)
        and (p_input ->> 'rule_id')::bigint is distinct from v_rule.id then
        raise exception 'A regra desta data mudou. Reabra o lançamento e confira o valor.';
      end if;

      v_row.proposed_amount_cents := null;
      v_row.priced_items := '[]';
      if v_rule.mode <> 'daily' then
        v_row.service_kind := v_rule.mode;
        if v_items <> '[]'::jsonb then
          for v_item in select value from jsonb_array_elements(v_items) loop
            v_item_name := btrim(regexp_replace(v_item ->> 'name', '[[:space:]]+', ' ', 'g'));
            v_quantity := (v_item ->> 'quantity')::integer;
            if jsonb_typeof(v_item -> 'name') is distinct from 'string'
              or char_length(v_item_name) not between 2 and 120
              or coalesce(v_quantity, 0) <= 0
              or exists (select 1 from jsonb_array_elements(v_row.priced_items) as previous(value)
                where lower(previous.value ->> 'name') = lower(v_item_name)) then
              raise exception 'Confira o nome e a quantidade de cada item. Use uma linha por item.';
            end if;

            if v_rule.mode = 'delivery' then
              select (price.value ->> 'unit_cents')::integer into v_item_cents
              from jsonb_array_elements(v_rule.price_items) as price(value)
              where price.value ->> 'name' = v_item_name;
              if not found or v_item_cents is distinct from (v_item ->> 'unit_cents')::integer then
                raise exception 'A entrega ou o valor unitário não corresponde à regra desta data.';
              end if;
            else
              v_item_cents := (v_item ->> 'unit_cents')::integer;
            end if;
            if coalesce(v_item_cents, 0) <= 0 then
              raise exception 'Informe o valor unitário de cada procedimento.';
            end if;

            v_total := v_total + v_item_cents::bigint * v_quantity;
            if v_total > 2147483647 then
              raise exception 'O total ultrapassa o valor permitido para um lançamento.';
            end if;
            v_row.priced_items := v_row.priced_items || jsonb_build_array(jsonb_build_object(
              'name', v_item_name, 'unit_cents', v_item_cents, 'quantity', v_quantity));
          end loop;
          if v_total is distinct from (p_input ->> 'amount_cents')::bigint then
            raise exception 'O total não corresponde aos itens da calculadora.';
          end if;
          v_row.proposed_amount_cents := v_total;
        elsif v_rule.price_items = '[]'::jsonb then
          v_row.proposed_amount_cents := (p_input ->> 'amount_cents')::integer;
        elsif p_action = 'validate' then
          raise exception 'Selecione as entregas conferidas na calculadora.';
        end if;
      elsif (p_input ->> 'planning')::boolean is true then
        if v_rule.planning_cents is null then raise exception 'Planejamento não está configurado para esta data.'; end if;
        v_row.service_kind := 'planning';
      elsif extract(isodow from v_date) = 6 and v_rule.saturday_cents is not null then
        v_row.service_kind := 'saturday';
      else
        v_row.service_kind := 'daily';
      end if;

      if p_action = 'validate' then
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
      notes, rule_id, amount_cents, proposed_amount_cents, priced_items, validated_by, validated_at, updated_by
    ) values (
      p_unit_id, v_professional_id, v_date, v_row.status, v_row.service_kind, v_row.professional_signed,
      v_row.finance_signed, v_row.notes, v_row.rule_id, v_row.amount_cents, v_row.proposed_amount_cents, v_row.priced_items,
      v_row.validated_by, v_row.validated_at, v_actor
    ) returning * into v_row;
  else
    update public.professional_attendance set
      status = v_row.status, service_kind = v_row.service_kind, professional_signed = v_row.professional_signed,
      finance_signed = v_row.finance_signed, notes = v_row.notes, rule_id = v_row.rule_id, amount_cents = v_row.amount_cents,
      proposed_amount_cents = v_row.proposed_amount_cents, priced_items = v_row.priced_items, validated_by = v_row.validated_by, validated_at = v_row.validated_at, paid_on = v_row.paid_on,
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
