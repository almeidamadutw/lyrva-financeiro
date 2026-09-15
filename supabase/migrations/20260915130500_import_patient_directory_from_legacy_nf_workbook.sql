create or replace function public.import_patient_directory(
  p_unit_code text,
  p_file_name text,
  p_rows jsonb
)
returns table(
  import_run_id bigint,
  imported_count integer,
  updated_count integer,
  error_count integer
)
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_unit_id bigint;
  v_import_run_id bigint;
  v_row jsonb;
  v_row_number integer;
  v_patient_id bigint;
  v_patient_unit_id bigint;
  v_name text;
  v_cpf text;
  v_phone text;
  v_email text;
  v_clinicorp_patient_id text;
  v_source_system text;
  v_payment_method text;
  v_source_sheet text;
  v_source_row integer;
  v_invoice_status text;
  v_notes text;
  v_metadata jsonb;
  v_was_existing boolean;
  v_imported integer := 0;
  v_updated integer := 0;
  v_errors integer := 0;
begin
  if v_user_id is null or not (select private.current_user_active()) then
    raise exception using errcode='42501', message='É necessário entrar no LYVRA para cadastrar pacientes.';
  end if;

  select u.id into v_unit_id
  from public.units u
  where u.code = lower(btrim(p_unit_code)) and u.is_active;

  if v_unit_id is null or not (select private.has_unit_access(v_unit_id)) then
    raise exception using errcode='42501', message='Você não possui acesso à unidade informada.';
  end if;

  if p_rows is null
     or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) = 0
     or jsonb_array_length(p_rows) > 1000 then
    raise exception using errcode='22023', message='A operação deve conter entre 1 e 1.000 pacientes.';
  end if;

  insert into public.import_runs(unit_id,file_name,status,total_rows,created_by,column_mapping)
  values(
    v_unit_id,
    coalesce(nullif(btrim(p_file_name),''),'planilha de pacientes'),
    'importing',
    jsonb_array_length(p_rows),
    v_user_id,
    jsonb_build_object('mode','patient_directory','source','legacy_nf_workbook')
  )
  returning id into v_import_run_id;

  for v_row, v_row_number in
    select item.value, item.ordinality::integer
    from jsonb_array_elements(p_rows) with ordinality item(value,ordinality)
  loop
    begin
      v_name := btrim(coalesce(v_row->>'name',''));
      if length(v_name) < 2 then
        raise exception using errcode='22023', message='O nome do paciente é obrigatório.';
      end if;

      v_cpf := nullif(regexp_replace(coalesce(v_row->>'cpf',''),'[^0-9]','','g'),'');
      if v_cpf is not null and v_cpf !~ '^[0-9]{11}$' then v_cpf := null; end if;
      v_phone := nullif(regexp_replace(coalesce(v_row->>'phone',''),'[^0-9]','','g'),'');
      if v_phone is not null and v_phone !~ '^[0-9]{10,13}$' then v_phone := null; end if;

      v_email := nullif(lower(btrim(coalesce(v_row->>'email',''))),'');
      v_clinicorp_patient_id := nullif(btrim(coalesce(v_row->>'clinicorpId','')),'');
      v_source_system := nullif(btrim(coalesce(v_row->>'sourceSystem','')),'');
      v_payment_method := nullif(btrim(coalesce(v_row->>'paymentMethod','')),'');
      v_source_sheet := nullif(btrim(coalesce(v_row->>'sourceSheet','')),'');
      v_source_row := case when coalesce(v_row->>'sourceRow','') ~ '^[0-9]+$' then (v_row->>'sourceRow')::integer else null end;
      v_invoice_status := nullif(btrim(coalesce(v_row->>'invoiceStatus','')),'');
      v_notes := nullif(btrim(coalesce(v_row->>'notes','')),'');

      v_metadata := jsonb_strip_nulls(jsonb_build_object(
        'directory_import', true,
        'source_system', v_source_system,
        'payment_origin', v_payment_method,
        'source_sheet', v_source_sheet,
        'source_row', v_source_row,
        'invoice_status', v_invoice_status,
        'last_directory_import_at', now()
      ));

      v_patient_id := null;
      v_patient_unit_id := null;

      if v_clinicorp_patient_id is not null then
        select pu.patient_id, pu.id into v_patient_id, v_patient_unit_id
        from public.patient_units pu
        where pu.unit_id = v_unit_id
          and pu.clinicorp_patient_id = v_clinicorp_patient_id
        limit 1;
      end if;

      if v_patient_id is null and v_cpf is not null then
        select p.id into v_patient_id
        from public.patients p
        where p.cpf = v_cpf
          and p.archived_at is null
        limit 1;
      end if;

      if v_patient_id is null then
        select p.id, pu.id into v_patient_id, v_patient_unit_id
        from public.patients p
        join public.patient_units pu on pu.patient_id = p.id
        where pu.unit_id = v_unit_id
          and pu.is_active
          and p.archived_at is null
          and private.normalize_match_text(p.full_name) = private.normalize_match_text(v_name)
        order by p.updated_at desc, p.id desc
        limit 1;
      end if;

      v_was_existing := v_patient_id is not null;

      if v_patient_id is null then
        insert into public.patients(
          full_name, cpf, phone, email, tax_receipt_ir, status, source, notes, created_by, updated_by
        ) values (
          v_name, v_cpf, v_phone, v_email, true,
          case when v_cpf is null then 'manual_review' else 'active' end,
          'import', v_notes, v_user_id, v_user_id
        ) returning id into v_patient_id;
      else
        update public.patients p
        set full_name = v_name,
            cpf = coalesce(v_cpf, p.cpf),
            phone = coalesce(v_phone, p.phone),
            email = coalesce(v_email, p.email),
            notes = coalesce(v_notes, p.notes),
            updated_by = v_user_id,
            archived_at = null
        where p.id = v_patient_id;
      end if;

      insert into public.patient_units(
        patient_id, unit_id, clinicorp_patient_id, is_active, source, metadata, created_by, updated_by
      ) values (
        v_patient_id, v_unit_id, v_clinicorp_patient_id, true, 'import', v_metadata, v_user_id, v_user_id
      )
      on conflict (patient_id, unit_id) do update
      set clinicorp_patient_id = coalesce(excluded.clinicorp_patient_id, public.patient_units.clinicorp_patient_id),
          is_active = true,
          source = case when public.patient_units.source = 'manual' then 'manual' else 'import' end,
          metadata = coalesce(public.patient_units.metadata,'{}'::jsonb) || excluded.metadata,
          updated_by = v_user_id,
          updated_at = now()
      returning id into v_patient_unit_id;

      insert into public.import_rows(
        unit_id, import_run_id, row_number, status, raw_data, normalized_data, patient_id
      ) values (
        v_unit_id, v_import_run_id, v_row_number, 'imported', v_row,
        jsonb_strip_nulls(jsonb_build_object(
          'name', v_name,
          'cpf', v_cpf,
          'phone', v_phone,
          'clinicorpId', v_clinicorp_patient_id,
          'sourceSystem', v_source_system,
          'paymentMethod', v_payment_method,
          'sourceSheet', v_source_sheet,
          'sourceRow', v_source_row,
          'mode', 'patient_directory'
        )),
        v_patient_id
      );

      if v_was_existing then v_updated := v_updated + 1; else v_imported := v_imported + 1; end if;
    exception when others then
      v_errors := v_errors + 1;
      insert into public.import_rows(unit_id,import_run_id,row_number,status,raw_data,errors)
      values(v_unit_id,v_import_run_id,v_row_number,'invalid',v_row,jsonb_build_array(sqlerrm));
    end;
  end loop;

  update public.import_runs r
  set status = case when v_errors = 0 then 'completed' when v_imported + v_updated > 0 then 'partial' else 'failed' end,
      valid_rows = v_imported + v_updated,
      imported_rows = v_imported + v_updated,
      duplicate_rows = v_updated,
      error_rows = v_errors,
      report = jsonb_build_object('mode','patient_directory','created',v_imported,'updated',v_updated,'errors',v_errors),
      completed_at = now()
  where r.id = v_import_run_id;

  return query select v_import_run_id, v_imported, v_updated, v_errors;
end;
$$;

grant execute on function public.import_patient_directory(text,text,jsonb) to authenticated;
