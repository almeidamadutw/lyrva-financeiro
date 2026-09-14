create or replace function private.normalize_match_text(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
    translate(
      lower(coalesce(p_value, '')),
      'áàãâäéèêëíìîïóòõôöúùûüç',
      'aaaaaeeeeiiiiooooouuuuc'
    ),
    '[^a-z0-9]', '', 'g'
  );
$$;

create or replace function public.apply_clinicorp_confirmed_payments(
  p_unit_id bigint,
  p_rows jsonb,
  p_sync_run_id bigint default null
)
returns table(
  processed_count integer,
  created_count integer,
  updated_count integer,
  skipped_count integer,
  failed_count integer,
  paid_installments integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_method text;
  v_ext_patient_id text;
  v_ext_installment_id text;
  v_ext_payment_id text;
  v_contract_id text;
  v_patient_name text;
  v_cpf text;
  v_due_date date;
  v_paid_at timestamptz;
  v_confirmed_at timestamptz;
  v_amount numeric(14,2);
  v_fee numeric(14,2);
  v_external_number integer;
  v_local_number integer;
  v_patient_unit_id bigint;
  v_patient_matches integer;
  v_installment_id bigint;
  v_plan_id bigint;
  v_installment_matches integer;
  v_existing_payment_id bigint;
  v_payment_id bigint;
  v_total_paid numeric(14,2);
  v_latest_paid_at timestamptz;
  v_latest_confirmed_at timestamptz;
  v_expected numeric(14,2);
  v_new_status text;
  v_action text;
  v_event_error text;
  v_processed integer := 0;
  v_created integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
  v_paid_count integer := 0;
  v_existing_plan_contract text;
  v_existing_installment_external text;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode='42501', message='Esta rotina é exclusiva da integração segura do LYVRA.';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception using errcode='22023', message='A carga do Clinicorp precisa ser uma lista JSON.';
  end if;

  if not exists(select 1 from public.units u where u.id = p_unit_id and u.is_active) then
    raise exception using errcode='22023', message='Unidade inválida para sincronização.';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_processed := v_processed + 1;
    v_event_error := null;

    begin
      if upper(coalesce(v_row ->> 'PaymentConfirmed', '')) <> 'X'
         or nullif(v_row ->> 'ConfirmedDate', '') is null then
        v_skipped := v_skipped + 1;
        v_event_error := 'Pagamento ainda não confirmado no Clinicorp.';
        if p_sync_run_id is not null then
          insert into public.sync_events(sync_run_id, unit_id, external_id, entity_type, action, status, error_message)
          values(p_sync_run_id, p_unit_id, nullif(v_row ->> 'id',''), 'payment', 'skip', 'skipped', v_event_error);
        end if;
        continue;
      end if;

      v_method := case
        when lower(coalesce(v_row ->> 'PaymentForm','')) like '%boleto%' then 'boleto'
        when lower(coalesce(v_row ->> 'PaymentForm','')) like '%cartão%'
          or lower(coalesce(v_row ->> 'PaymentForm','')) like '%cartao%' then 'card'
        else null
      end;

      if v_method is null then
        v_skipped := v_skipped + 1;
        v_event_error := 'Forma de pagamento fora do escopo atual do LYVRA.';
        if p_sync_run_id is not null then
          insert into public.sync_events(sync_run_id, unit_id, external_id, entity_type, action, status, error_message)
          values(p_sync_run_id, p_unit_id, nullif(v_row ->> 'id',''), 'payment', 'skip', 'skipped', v_event_error);
        end if;
        continue;
      end if;

      v_ext_patient_id := nullif(btrim(coalesce(v_row ->> 'PatientId','')), '');
      v_ext_installment_id := nullif(btrim(coalesce(v_row ->> 'id','')), '');
      v_ext_payment_id := coalesce(
        nullif(btrim(coalesce(v_row ->> 'ExternalTxId','')), ''),
        v_ext_installment_id
      );
      v_contract_id := coalesce(
        nullif(btrim(coalesce(v_row ->> 'PaymentHeaderId','')), ''),
        nullif(btrim(coalesce(v_row ->> 'TreatmentId','')), '')
      );
      v_patient_name := nullif(btrim(coalesce(v_row ->> 'PatientName','')), '');
      v_cpf := regexp_replace(
        coalesce(nullif(v_row ->> 'PayerCPF',''), nullif(v_row ->> 'OwnerCPF',''), ''),
        '\D', '', 'g'
      );

      if v_ext_payment_id is null or v_ext_patient_id is null then
        v_skipped := v_skipped + 1;
        v_event_error := 'Movimento sem identificador de paciente ou pagamento.';
        if p_sync_run_id is not null then
          insert into public.sync_events(sync_run_id, unit_id, external_id, entity_type, action, status, error_message)
          values(p_sync_run_id, p_unit_id, v_ext_payment_id, 'payment', 'skip', 'skipped', v_event_error);
        end if;
        continue;
      end if;

      v_amount := nullif(v_row ->> 'Amount','')::numeric;
      if v_amount is null or v_amount <= 0 then
        v_skipped := v_skipped + 1;
        v_event_error := 'Movimento confirmado sem valor positivo.';
        if p_sync_run_id is not null then
          insert into public.sync_events(sync_run_id, unit_id, external_id, entity_type, action, status, error_message)
          values(p_sync_run_id, p_unit_id, v_ext_payment_id, 'payment', 'skip', 'skipped', v_event_error);
        end if;
        continue;
      end if;

      v_fee := greatest(coalesce(nullif(v_row ->> 'Fee','')::numeric, 0), 0);
      v_confirmed_at := (v_row ->> 'ConfirmedDate')::timestamptz;
      v_paid_at := coalesce(
        nullif(v_row ->> 'PaymentDate','')::timestamptz,
        nullif(v_row ->> 'ReceivedDate','')::timestamptz,
        v_confirmed_at
      );
      v_due_date := case
        when nullif(v_row ->> 'DueDate','') is not null
          then ((v_row ->> 'DueDate')::timestamptz at time zone 'America/Sao_Paulo')::date
        else null
      end;
      v_external_number := case
        when coalesce(v_row ->> 'InstallmentNumber','') ~ '^[0-9]+$'
          then (v_row ->> 'InstallmentNumber')::integer
        else null
      end;
      v_local_number := case when v_external_number is not null then v_external_number + 1 else null end;

      v_patient_unit_id := null;
      select pu.id into v_patient_unit_id
      from public.patient_units pu
      where pu.unit_id = p_unit_id
        and pu.is_active
        and pu.clinicorp_patient_id = v_ext_patient_id
      limit 1;

      if v_patient_unit_id is null and length(v_cpf) >= 11 then
        select count(*), min(pu.id)
          into v_patient_matches, v_patient_unit_id
        from public.patient_units pu
        join public.patients p on p.id = pu.patient_id
        where pu.unit_id = p_unit_id
          and pu.is_active
          and p.archived_at is null
          and regexp_replace(coalesce(p.cpf,''), '\D','','g') = v_cpf;
        if v_patient_matches <> 1 then v_patient_unit_id := null; end if;
      end if;

      if v_patient_unit_id is null and v_patient_name is not null then
        select count(*), min(pu.id)
          into v_patient_matches, v_patient_unit_id
        from public.patient_units pu
        join public.patients p on p.id = pu.patient_id
        where pu.unit_id = p_unit_id
          and pu.is_active
          and p.archived_at is null
          and private.normalize_match_text(p.full_name) = private.normalize_match_text(v_patient_name);
        if v_patient_matches <> 1 then v_patient_unit_id := null; end if;
      end if;

      if v_patient_unit_id is null then
        v_skipped := v_skipped + 1;
        v_event_error := 'Paciente ainda não existe no LYVRA ou o cadastro ficou ambíguo.';
        if p_sync_run_id is not null then
          insert into public.sync_events(sync_run_id, unit_id, external_id, entity_type, action, status, error_message)
          values(p_sync_run_id, p_unit_id, v_ext_payment_id, 'payment', 'skip', 'skipped', v_event_error);
        end if;
        continue;
      end if;

      if exists(
        select 1 from public.patient_units pu
        where pu.id = v_patient_unit_id
          and pu.clinicorp_patient_id is not null
          and pu.clinicorp_patient_id <> v_ext_patient_id
      ) then
        v_skipped := v_skipped + 1;
        v_event_error := 'Paciente local já está vinculado a outro PatientId do Clinicorp.';
        if p_sync_run_id is not null then
          insert into public.sync_events(sync_run_id, unit_id, external_id, entity_type, action, status, error_message)
          values(p_sync_run_id, p_unit_id, v_ext_payment_id, 'payment', 'skip', 'skipped', v_event_error);
        end if;
        continue;
      end if;

      update public.patient_units
      set clinicorp_patient_id = coalesce(clinicorp_patient_id, v_ext_patient_id),
          metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('clinicorp_linked_at', now()),
          updated_at = now()
      where id = v_patient_unit_id;

      v_installment_id := null;
      v_plan_id := null;

      if v_ext_installment_id is not null then
        select i.id, i.payment_plan_id into v_installment_id, v_plan_id
        from public.installments i
        where i.unit_id = p_unit_id
          and i.clinicorp_installment_id = v_ext_installment_id
        limit 1;
      end if;

      if v_installment_id is null and v_contract_id is not null and v_local_number is not null then
        select i.id, i.payment_plan_id into v_installment_id, v_plan_id
        from public.installments i
        join public.payment_plans pp on pp.id = i.payment_plan_id and pp.unit_id = i.unit_id
        where pp.unit_id = p_unit_id
          and pp.patient_unit_id = v_patient_unit_id
          and pp.archived_at is null
          and pp.clinicorp_contract_id = v_contract_id
          and pp.payment_method = v_method
          and i.installment_number = v_local_number
        limit 1;
      end if;

      if v_installment_id is null and v_local_number is not null and v_due_date is not null then
        select count(*), min(i.id), min(i.payment_plan_id)
          into v_installment_matches, v_installment_id, v_plan_id
        from public.installments i
        join public.payment_plans pp on pp.id = i.payment_plan_id and pp.unit_id = i.unit_id
        where pp.unit_id = p_unit_id
          and pp.patient_unit_id = v_patient_unit_id
          and pp.archived_at is null
          and pp.payment_method = v_method
          and i.installment_number = v_local_number
          and i.due_date = v_due_date;
        if v_installment_matches <> 1 then
          v_installment_id := null;
          v_plan_id := null;
        end if;
      end if;

      if v_installment_id is null and v_local_number is not null then
        select count(*), min(i.id), min(i.payment_plan_id)
          into v_installment_matches, v_installment_id, v_plan_id
        from public.installments i
        join public.payment_plans pp on pp.id = i.payment_plan_id and pp.unit_id = i.unit_id
        where pp.unit_id = p_unit_id
          and pp.patient_unit_id = v_patient_unit_id
          and pp.archived_at is null
          and pp.payment_method = v_method
          and i.installment_number = v_local_number
          and abs(i.expected_amount - v_amount) <= 0.05;
        if v_installment_matches <> 1 then
          v_installment_id := null;
          v_plan_id := null;
        end if;
      end if;

      if v_installment_id is null or v_plan_id is null then
        v_skipped := v_skipped + 1;
        v_event_error := 'Parcela confirmada no Clinicorp sem correspondência segura no plano local.';
        if p_sync_run_id is not null then
          insert into public.sync_events(sync_run_id, unit_id, external_id, entity_type, action, status, error_message)
          values(p_sync_run_id, p_unit_id, v_ext_payment_id, 'payment', 'skip', 'skipped', v_event_error);
        end if;
        continue;
      end if;

      select pp.clinicorp_contract_id into v_existing_plan_contract
      from public.payment_plans pp where pp.id = v_plan_id;
      if v_existing_plan_contract is not null
         and v_contract_id is not null
         and v_existing_plan_contract <> v_contract_id then
        v_skipped := v_skipped + 1;
        v_event_error := 'Plano local já está vinculado a outro contrato do Clinicorp.';
        if p_sync_run_id is not null then
          insert into public.sync_events(sync_run_id, unit_id, external_id, entity_type, action, status, error_message)
          values(p_sync_run_id, p_unit_id, v_ext_payment_id, 'payment', 'skip', 'skipped', v_event_error);
        end if;
        continue;
      end if;

      select i.clinicorp_installment_id into v_existing_installment_external
      from public.installments i where i.id = v_installment_id;
      if v_existing_installment_external is not null
         and v_ext_installment_id is not null
         and v_existing_installment_external <> v_ext_installment_id then
        v_skipped := v_skipped + 1;
        v_event_error := 'Parcela local já está vinculada a outro identificador do Clinicorp.';
        if p_sync_run_id is not null then
          insert into public.sync_events(sync_run_id, unit_id, external_id, entity_type, action, status, error_message)
          values(p_sync_run_id, p_unit_id, v_ext_payment_id, 'payment', 'skip', 'skipped', v_event_error);
        end if;
        continue;
      end if;

      if v_contract_id is not null then
        update public.payment_plans
        set clinicorp_contract_id = coalesce(clinicorp_contract_id, v_contract_id),
            metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('clinicorp_linked_at', now()),
            updated_at = now()
        where id = v_plan_id;
      end if;

      select p.id into v_existing_payment_id
      from public.payments p
      where p.unit_id = p_unit_id and p.clinicorp_payment_id = v_ext_payment_id
      limit 1;

      if v_existing_payment_id is null then
        insert into public.payments(
          unit_id, installment_id, clinicorp_payment_id, payment_method,
          amount, fee_amount, net_amount, status, paid_at, confirmed_at,
          source, raw_data
        ) values (
          p_unit_id, v_installment_id, v_ext_payment_id, v_method,
          v_amount, v_fee, greatest(v_amount - v_fee, 0), 'confirmed',
          v_paid_at, v_confirmed_at, 'clinicorp', v_row
        ) returning id into v_payment_id;
        v_created := v_created + 1;
        v_action := 'create';
      else
        update public.payments
        set installment_id = v_installment_id,
            payment_method = v_method,
            amount = v_amount,
            fee_amount = v_fee,
            net_amount = greatest(v_amount - v_fee, 0),
            status = 'confirmed',
            paid_at = v_paid_at,
            confirmed_at = v_confirmed_at,
            source = 'clinicorp',
            raw_data = v_row,
            updated_at = now()
        where id = v_existing_payment_id
        returning id into v_payment_id;
        v_updated := v_updated + 1;
        v_action := 'update';
      end if;

      insert into public.payment_events(
        unit_id, installment_id, payment_id, source, event_type,
        external_event_id, payload, occurred_at, processed_at
      ) values (
        p_unit_id, v_installment_id, v_payment_id, 'clinicorp', 'payment_confirmed',
        concat('confirmed:', v_ext_payment_id), v_row, v_confirmed_at, now()
      )
      on conflict (source, external_event_id) where external_event_id is not null do update
        set payment_id = excluded.payment_id,
            installment_id = excluded.installment_id,
            payload = excluded.payload,
            occurred_at = excluded.occurred_at,
            processed_at = now();

      select coalesce(sum(p.amount),0), max(p.paid_at), max(p.confirmed_at)
        into v_total_paid, v_latest_paid_at, v_latest_confirmed_at
      from public.payments p
      where p.unit_id = p_unit_id
        and p.installment_id = v_installment_id
        and p.status = 'confirmed';

      select i.expected_amount into v_expected
      from public.installments i where i.id = v_installment_id;

      v_new_status := case
        when v_total_paid + 0.01 >= v_expected then 'paid'
        when (select i.due_date from public.installments i where i.id = v_installment_id) < (now() at time zone 'America/Sao_Paulo')::date then 'overdue'
        else 'pending'
      end;

      update public.installments i
      set clinicorp_installment_id = coalesce(i.clinicorp_installment_id, v_ext_installment_id),
          paid_amount = v_total_paid,
          paid_at = v_latest_paid_at,
          confirmed_at = v_latest_confirmed_at,
          last_synced_at = now(),
          boleto_url = case when v_method='boleto' then coalesce(nullif(v_row ->> 'BoletoUrl',''), i.boleto_url) else i.boleto_url end,
          status = v_new_status,
          source = case when i.source='clinicorp' then 'clinicorp' else i.source end,
          metadata = coalesce(i.metadata,'{}'::jsonb) || jsonb_build_object(
            'clinicorp_patient_id', v_ext_patient_id,
            'clinicorp_contract_id', v_contract_id,
            'last_payment_sync_at', now()
          )
      where i.id = v_installment_id;

      if v_new_status = 'paid' then
        v_paid_count := v_paid_count + 1;
      end if;

      if p_sync_run_id is not null then
        insert into public.sync_events(sync_run_id, unit_id, external_id, entity_type, action, status)
        values(p_sync_run_id, p_unit_id, v_ext_payment_id, 'payment', v_action, 'success');
      end if;

    exception when others then
      v_failed := v_failed + 1;
      if p_sync_run_id is not null then
        insert into public.sync_events(sync_run_id, unit_id, external_id, entity_type, action, status, error_message)
        values(
          p_sync_run_id, p_unit_id,
          coalesce(v_ext_payment_id, nullif(v_row ->> 'id','')),
          'payment', 'skip', 'failed', left(sqlerrm, 500)
        );
      end if;
    end;
  end loop;

  return query select v_processed, v_created, v_updated, v_skipped, v_failed, v_paid_count;
end;
$$;

revoke all on function public.apply_clinicorp_confirmed_payments(bigint,jsonb,bigint) from public, anon, authenticated;
grant execute on function public.apply_clinicorp_confirmed_payments(bigint,jsonb,bigint) to service_role;

create or replace function private.sync_installment_collection_schedule()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_payment_method text;
  v_patient_unit_id bigint;
  v_patient_id bigint;
  v_patient_name text;
  v_assignee uuid;
  v_days integer := 3;
  v_eligible_at date;
  v_case_id bigint;
begin
  select pp.payment_method, pp.patient_unit_id,
         u.collection_assignee_user_id,
         coalesce(u.collection_start_business_days, 3),
         pu.patient_id,
         p.full_name
    into v_payment_method, v_patient_unit_id, v_assignee, v_days, v_patient_id, v_patient_name
  from public.payment_plans pp
  join public.units u on u.id = pp.unit_id
  join public.patient_units pu on pu.id = pp.patient_unit_id and pu.unit_id = pp.unit_id
  join public.patients p on p.id = pu.patient_id
  where pp.id = new.payment_plan_id
    and pp.unit_id = new.unit_id
    and pp.archived_at is null;

  if new.status in ('paid', 'cancelled', 'refunded') then
    update public.collection_cases cc
       set status = case when new.status = 'paid' then 'paid' else 'closed' end,
           outcome = case when new.status = 'paid' then 'paid' else 'cancelled' end,
           closed_at = coalesce(cc.closed_at, now()),
           updated_at = now()
     where cc.installment_id = new.id
       and cc.unit_id = new.unit_id
       and cc.status not in ('paid', 'closed');

    update public.financial_tasks ft
       set status = 'cancelled', updated_at = now()
     where ft.installment_id = new.id
       and ft.kind in ('payment_reminder','collection_call','payment_promise')
       and ft.status in ('pending', 'in_progress');

    return new;
  end if;

  if v_payment_method is distinct from 'boleto' then
    update public.collection_cases cc
       set status = 'closed',
           outcome = 'cancelled',
           closed_at = coalesce(cc.closed_at, now()),
           updated_at = now()
     where cc.installment_id = new.id
       and cc.unit_id = new.unit_id
       and cc.status not in ('paid', 'closed');

    update public.financial_tasks ft
       set status = 'cancelled', updated_at = now()
     where ft.task_key = concat('collection_call:', new.id)
       and ft.status in ('pending', 'in_progress');

    return new;
  end if;

  if new.status not in ('pending', 'overdue') or v_assignee is null then
    return new;
  end if;

  v_eligible_at := private.add_business_days(new.due_date, v_days);

  insert into public.collection_cases (
    unit_id, patient_unit_id, installment_id, responsible_user_id,
    eligible_at, status, next_action_at, notes
  ) values (
    new.unit_id, v_patient_unit_id, new.id, v_assignee,
    v_eligible_at, 'pending_contact',
    (v_eligible_at::timestamp at time zone 'America/Sao_Paulo'),
    concat('Entrada automática na régua após ', v_days, ' dias úteis do vencimento.')
  )
  on conflict (installment_id) do update
    set responsible_user_id = excluded.responsible_user_id,
        eligible_at = excluded.eligible_at,
        next_action_at = case
          when public.collection_cases.status = 'pending_contact' then excluded.next_action_at
          else public.collection_cases.next_action_at
        end,
        updated_at = now()
  returning id into v_case_id;

  insert into public.financial_tasks (
    unit_id, patient_id, installment_id, collection_case_id, assigned_to,
    title, description, kind, status, due_at, task_key
  ) values (
    new.unit_id, v_patient_id, new.id, v_case_id, v_assignee,
    'Iniciar régua de cobrança',
    concat(coalesce(v_patient_name, 'Paciente'), ' • parcela ',
      coalesce(new.installment_number::text, '—'), ' • venceu em ',
      to_char(new.due_date, 'DD/MM/YYYY')),
    'collection_call', 'pending',
    (v_eligible_at::timestamp at time zone 'America/Sao_Paulo'),
    concat('collection_call:', new.id)
  )
  on conflict (task_key) where task_key is not null do update
    set assigned_to = excluded.assigned_to,
        collection_case_id = excluded.collection_case_id,
        patient_id = excluded.patient_id,
        installment_id = excluded.installment_id,
        description = excluded.description,
        due_at = excluded.due_at,
        status = case
          when public.financial_tasks.status = 'completed' then public.financial_tasks.status
          else 'pending'
        end,
        updated_at = now();

  return new;
end;
$$;
