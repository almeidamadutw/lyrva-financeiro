-- Migração 20260902133603 — importação transacional limitada à sessão autenticada.

create or replace function public.import_patients(
  p_unit_code text,
  p_file_name text,
  p_rows jsonb
)
returns table (
  import_run_id bigint,
  imported_count integer,
  updated_count integer,
  error_count integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_unit_id bigint;
  v_unit_frequency text;
  v_import_run_id bigint;
  v_row jsonb;
  v_row_number integer;
  v_patient_id bigint;
  v_patient_unit_id bigint;
  v_payment_plan_id bigint;
  v_name text;
  v_cpf text;
  v_phone text;
  v_email text;
  v_clinicorp_patient_id text;
  v_treatment text;
  v_payment_method text;
  v_plan_amount numeric(14, 2);
  v_start_date date;
  v_installment_count integer;
  v_due_day smallint;
  v_tax_receipt_ir boolean;
  v_was_existing boolean;
  v_imported integer := 0;
  v_updated integer := 0;
  v_errors integer := 0;
begin
  if v_user_id is null or not (select private.current_user_active()) then
    raise exception using
      errcode = '42501',
      message = 'É necessário entrar no LYVRA para importar pacientes.';
  end if;

  select unit.id, unit.invoice_frequency
  into v_unit_id, v_unit_frequency
  from public.units unit
  where unit.code = lower(btrim(p_unit_code))
    and unit.is_active;

  if v_unit_id is null or not (select private.has_unit_access(v_unit_id)) then
    raise exception using
      errcode = '42501',
      message = 'Você não possui acesso à unidade informada.';
  end if;

  if jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) = 0
    or jsonb_array_length(p_rows) > 1000
  then
    raise exception using
      errcode = '22023',
      message = 'A importação deve conter entre 1 e 1.000 pacientes.';
  end if;

  insert into public.import_runs (
    unit_id,
    file_name,
    status,
    total_rows,
    created_by
  ) values (
    v_unit_id,
    coalesce(nullif(btrim(p_file_name), ''), 'planilha'),
    'importing',
    jsonb_array_length(p_rows),
    v_user_id
  )
  returning id into v_import_run_id;

  for v_row, v_row_number in
    select item.value, item.ordinality::integer
    from jsonb_array_elements(p_rows) with ordinality as item(value, ordinality)
  loop
    begin
      v_name := btrim(coalesce(v_row ->> 'name', ''));
      if length(v_name) < 2 then
        raise exception using
          errcode = '22023',
          message = 'O nome do paciente é obrigatório.';
      end if;

      v_cpf := nullif(regexp_replace(coalesce(v_row ->> 'cpf', ''), '[^0-9]', '', 'g'), '');
      if v_cpf is not null and v_cpf !~ '^[0-9]{11}$' then
        raise exception using
          errcode = '22023',
          message = 'O CPF precisa conter 11 dígitos.';
      end if;

      v_phone := nullif(regexp_replace(coalesce(v_row ->> 'phone', ''), '[^0-9]', '', 'g'), '');
      if v_phone is not null and v_phone !~ '^[0-9]{10,13}$' then
        v_phone := null;
      end if;

      v_email := nullif(lower(btrim(coalesce(v_row ->> 'email', ''))), '');
      v_clinicorp_patient_id := nullif(btrim(coalesce(v_row ->> 'clinicorpId', '')), '');
      v_treatment := nullif(btrim(coalesce(v_row ->> 'treatment', '')), '');

      v_payment_method := case
        when lower(coalesce(v_row ->> 'paymentMethod', '')) like '%boleto%' then 'boleto'
        when lower(coalesce(v_row ->> 'paymentMethod', '')) like '%cart%' then 'card'
        when lower(coalesce(v_row ->> 'paymentMethod', '')) like '%pix%' then 'pix'
        when lower(coalesce(v_row ->> 'paymentMethod', '')) like '%dinheir%'
          or lower(coalesce(v_row ->> 'paymentMethod', '')) = 'cash' then 'cash'
        when lower(coalesce(v_row ->> 'paymentMethod', '')) like '%transfer%' then 'transfer'
        else 'other'
      end;

      v_plan_amount := case
        when coalesce(v_row ->> 'planAmountCents', '') ~ '^[0-9]+([.][0-9]+)?$'
          then greatest((v_row ->> 'planAmountCents')::numeric, 0) / 100
        else 0
      end;

      v_start_date := case
        when coalesce(v_row ->> 'startDate', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          then (v_row ->> 'startDate')::date
        else null
      end;

      v_installment_count := case
        when coalesce(v_row ->> 'installments', '') ~ '^[0-9]+$'
          and (v_row ->> 'installments')::integer > 0
          then (v_row ->> 'installments')::integer
        else null
      end;

      v_due_day := case
        when coalesce(v_row ->> 'dueDay', '') ~ '^[0-9]+$'
          and (v_row ->> 'dueDay')::integer between 1 and 31
          then (v_row ->> 'dueDay')::smallint
        else null
      end;

      v_tax_receipt_ir := lower(coalesce(v_row ->> 'taxReceiptIr', 'false'))
        in ('true', '1', 'sim', 's', 'x');

      v_patient_id := null;
      v_patient_unit_id := null;
      v_payment_plan_id := null;

      if v_clinicorp_patient_id is not null then
        select patient_unit.patient_id, patient_unit.id
        into v_patient_id, v_patient_unit_id
        from public.patient_units patient_unit
        where patient_unit.unit_id = v_unit_id
          and patient_unit.clinicorp_patient_id = v_clinicorp_patient_id
        limit 1;
      end if;

      if v_patient_id is null and v_cpf is not null then
        select patient.id
        into v_patient_id
        from public.patients patient
        where patient.cpf = v_cpf
          and patient.archived_at is null
        limit 1;
      end if;

      v_was_existing := v_patient_id is not null;

      if v_patient_id is null then
        insert into public.patients (
          full_name,
          cpf,
          phone,
          email,
          tax_receipt_ir,
          status,
          source,
          notes,
          created_by,
          updated_by
        ) values (
          v_name,
          v_cpf,
          v_phone,
          v_email,
          v_tax_receipt_ir,
          case when v_cpf is null then 'manual_review' else 'active' end,
          'import',
          nullif(btrim(coalesce(v_row ->> 'notes', '')), ''),
          v_user_id,
          v_user_id
        )
        returning id into v_patient_id;
      else
        update public.patients patient
        set
          full_name = v_name,
          cpf = coalesce(v_cpf, patient.cpf),
          phone = coalesce(v_phone, patient.phone),
          email = coalesce(v_email, patient.email),
          tax_receipt_ir = v_tax_receipt_ir,
          status = case
            when coalesce(v_cpf, patient.cpf) is null then 'manual_review'
            else 'active'
          end,
          source = 'import',
          notes = coalesce(nullif(btrim(coalesce(v_row ->> 'notes', '')), ''), patient.notes),
          updated_by = v_user_id,
          archived_at = null
        where patient.id = v_patient_id;
      end if;

      insert into public.patient_units (
        patient_id,
        unit_id,
        clinicorp_patient_id,
        treatment,
        started_at,
        source,
        created_by,
        updated_by
      ) values (
        v_patient_id,
        v_unit_id,
        v_clinicorp_patient_id,
        v_treatment,
        v_start_date,
        'import',
        v_user_id,
        v_user_id
      )
      on conflict (patient_id, unit_id) do update
      set
        clinicorp_patient_id = coalesce(excluded.clinicorp_patient_id, patient_units.clinicorp_patient_id),
        treatment = coalesce(excluded.treatment, patient_units.treatment),
        started_at = coalesce(excluded.started_at, patient_units.started_at),
        is_active = true,
        source = 'import',
        updated_by = v_user_id
      returning id into v_patient_unit_id;

      select plan.id
      into v_payment_plan_id
      from public.payment_plans plan
      where plan.patient_unit_id = v_patient_unit_id
        and plan.status = 'active'
        and plan.archived_at is null
      order by plan.created_at desc, plan.id desc
      limit 1;

      if v_payment_plan_id is null then
        insert into public.payment_plans (
          unit_id,
          patient_unit_id,
          treatment,
          payment_method,
          total_amount,
          installment_count,
          due_day,
          start_date,
          issue_invoice_for_ir,
          invoice_frequency_override,
          source,
          created_by,
          updated_by
        ) values (
          v_unit_id,
          v_patient_unit_id,
          v_treatment,
          v_payment_method,
          v_plan_amount,
          v_installment_count,
          v_due_day,
          v_start_date,
          v_tax_receipt_ir,
          v_unit_frequency,
          'import',
          v_user_id,
          v_user_id
        );
      else
        update public.payment_plans plan
        set
          treatment = coalesce(v_treatment, plan.treatment),
          payment_method = v_payment_method,
          total_amount = v_plan_amount,
          installment_count = v_installment_count,
          due_day = v_due_day,
          start_date = coalesce(v_start_date, plan.start_date),
          issue_invoice_for_ir = v_tax_receipt_ir,
          invoice_frequency_override = v_unit_frequency,
          source = 'import',
          updated_by = v_user_id,
          archived_at = null
        where plan.id = v_payment_plan_id;
      end if;

      insert into public.import_rows (
        unit_id,
        import_run_id,
        row_number,
        status,
        raw_data,
        normalized_data,
        patient_id
      ) values (
        v_unit_id,
        v_import_run_id,
        v_row_number,
        'imported',
        v_row,
        jsonb_build_object(
          'name', v_name,
          'cpf', v_cpf,
          'phone', v_phone,
          'clinicorpId', v_clinicorp_patient_id,
          'paymentMethod', v_payment_method
        ),
        v_patient_id
      );

      if v_was_existing then
        v_updated := v_updated + 1;
      else
        v_imported := v_imported + 1;
      end if;
    exception when others then
      v_errors := v_errors + 1;

      insert into public.import_rows (
        unit_id,
        import_run_id,
        row_number,
        status,
        raw_data,
        errors
      ) values (
        v_unit_id,
        v_import_run_id,
        v_row_number,
        'invalid',
        v_row,
        jsonb_build_array(sqlerrm)
      );
    end;
  end loop;

  update public.import_runs run
  set
    status = case
      when v_errors = 0 then 'completed'
      when v_imported + v_updated > 0 then 'partial'
      else 'failed'
    end,
    valid_rows = v_imported + v_updated,
    imported_rows = v_imported + v_updated,
    duplicate_rows = v_updated,
    error_rows = v_errors,
    report = jsonb_build_object(
      'created', v_imported,
      'updated', v_updated,
      'errors', v_errors
    ),
    completed_at = now()
  where run.id = v_import_run_id;

  return query
  select v_import_run_id, v_imported, v_updated, v_errors;
end;
$$;

comment on function public.import_patients(text, text, jsonb) is
  'Importa até 1.000 pacientes por unidade usando RLS e a sessão autenticada.';

revoke all on function public.import_patients(text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.import_patients(text, text, jsonb)
  to authenticated;
