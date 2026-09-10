-- LYVRA: importador definitivo para a planilha oficial de NF e cadastro manual.

create or replace function public.import_patients(p_unit_code text, p_file_name text, p_rows jsonb)
returns table(import_run_id bigint, imported_count integer, updated_count integer, error_count integer)
language plpgsql
set search_path=''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_unit_id bigint;
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
  v_total_amount numeric(14,2);
  v_installment_amount numeric(14,2);
  v_installment_count integer;
  v_start_date date;
  v_end_date date;
  v_first_invoice_date date;
  v_due_day smallint;
  v_invoice_interval smallint;
  v_invoice_schedule_mode text;
  v_invoice_frequency text;
  v_invoice_recipient_name text;
  v_invoice_disabled boolean;
  v_invoice_disabled_reason text;
  v_tax_receipt_ir boolean;
  v_source text;
  v_import_key text;
  v_invoice_status text;
  v_invoice_issued_date date;
  v_invoice_issued_amount_cents numeric;
  v_notes text;
  v_was_existing boolean;
  v_imported integer:=0;
  v_updated integer:=0;
  v_errors integer:=0;
begin
  if v_user_id is null or not (select private.current_user_active()) then
    raise exception using errcode='42501',message='É necessário entrar no LYVRA para cadastrar pacientes.';
  end if;

  select u.id into v_unit_id from public.units u
  where u.code=lower(btrim(p_unit_code)) and u.is_active;
  if v_unit_id is null or not (select private.has_unit_access(v_unit_id)) then
    raise exception using errcode='42501',message='Você não possui acesso à unidade informada.';
  end if;

  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 or jsonb_array_length(p_rows)>1000 then
    raise exception using errcode='22023',message='A operação deve conter entre 1 e 1.000 pacientes.';
  end if;

  insert into public.import_runs(unit_id,file_name,status,total_rows,created_by)
  values(v_unit_id,coalesce(nullif(btrim(p_file_name),''),'planilha'),'importing',jsonb_array_length(p_rows),v_user_id)
  returning id into v_import_run_id;

  for v_row,v_row_number in
    select item.value,item.ordinality::integer
    from jsonb_array_elements(p_rows) with ordinality item(value,ordinality)
  loop
    begin
      v_name:=btrim(coalesce(v_row->>'name',''));
      if length(v_name)<2 then raise exception using errcode='22023',message='O nome do paciente é obrigatório.'; end if;

      v_cpf:=nullif(regexp_replace(coalesce(v_row->>'cpf',''),'[^0-9]','','g'),'');
      if v_cpf is not null and v_cpf!~'^[0-9]{11}$' then raise exception using errcode='22023',message='O CPF precisa conter 11 dígitos.'; end if;
      v_phone:=nullif(regexp_replace(coalesce(v_row->>'phone',''),'[^0-9]','','g'),'');
      if v_phone is not null and v_phone!~'^[0-9]{10,13}$' then v_phone:=null; end if;
      v_email:=nullif(lower(btrim(coalesce(v_row->>'email',''))),'');
      v_clinicorp_patient_id:=nullif(btrim(coalesce(v_row->>'clinicorpId','')),'');
      v_treatment:=nullif(btrim(coalesce(v_row->>'treatment','')),'');
      v_notes:=nullif(btrim(coalesce(v_row->>'notes','')),'');
      v_source:=case when lower(coalesce(v_row->>'source',''))='manual' then 'manual' else 'import' end;

      v_payment_method:=case
        when lower(coalesce(v_row->>'paymentMethod','')) in ('card','cartao','cartão') or lower(coalesce(v_row->>'paymentMethod','')) like '%cart%' then 'card'
        when lower(coalesce(v_row->>'paymentMethod','')) like '%boleto%' then 'boleto'
        else null end;
      if v_payment_method is null then raise exception using errcode='22023',message='A forma de pagamento deve ser Cartão ou Boleto.'; end if;

      v_installment_count:=case when coalesce(v_row->>'installments','')~'^[0-9]+$' and (v_row->>'installments')::integer>0 then (v_row->>'installments')::integer else null end;
      if v_installment_count is null then raise exception using errcode='22023',message='O número de parcelas é obrigatório.'; end if;

      v_installment_amount:=case when coalesce(v_row->>'installmentAmountCents','')~'^[0-9]+([.][0-9]+)?$' then round((v_row->>'installmentAmountCents')::numeric/100,2) else null end;
      v_total_amount:=case
        when coalesce(v_row->>'planAmountCents','')~'^[0-9]+([.][0-9]+)?$' then round((v_row->>'planAmountCents')::numeric/100,2)
        when v_installment_amount is not null then round(v_installment_amount*v_installment_count,2)
        else 0 end;
      if v_total_amount<=0 then raise exception using errcode='22023',message='O valor do tratamento ou da parcela é obrigatório.'; end if;
      if v_installment_amount is null then v_installment_amount:=round(v_total_amount/v_installment_count,2); end if;

      v_start_date:=case when coalesce(v_row->>'startDate','')~'^\d{4}-\d{2}-\d{2}$' then (v_row->>'startDate')::date else null end;
      if v_start_date is null then raise exception using errcode='22023',message='A data da primeira parcela é obrigatória.'; end if;
      v_end_date:=case when coalesce(v_row->>'endDate','')~'^\d{4}-\d{2}-\d{2}$' then (v_row->>'endDate')::date else (v_start_date+make_interval(months=>greatest(v_installment_count-1,0)))::date end;
      v_due_day:=case when coalesce(v_row->>'dueDay','')~'^[0-9]+$' and (v_row->>'dueDay')::integer between 1 and 31 then (v_row->>'dueDay')::smallint else extract(day from v_start_date)::smallint end;

      v_first_invoice_date:=case when coalesce(v_row->>'firstInvoiceDate','')~'^\d{4}-\d{2}-\d{2}$' then (v_row->>'firstInvoiceDate')::date else null end;
      v_invoice_interval:=case when coalesce(v_row->>'invoiceIntervalMonths','')~'^[0-9]+$' and (v_row->>'invoiceIntervalMonths')::integer between 1 and 24 then (v_row->>'invoiceIntervalMonths')::smallint else 12 end;
      v_invoice_schedule_mode:=case when lower(coalesce(v_row->>'invoiceScheduleMode',''))='manual' then 'manual' else 'automatic' end;
      if v_invoice_schedule_mode='manual' and v_first_invoice_date is null then raise exception using errcode='22023',message='Na agenda personalizada, informe a primeira data da NF.'; end if;
      v_invoice_frequency:=case when v_invoice_schedule_mode='automatic' then 'yearly' when v_invoice_interval=1 then 'monthly' when v_invoice_interval=4 then 'four_monthly' when v_invoice_interval=12 then 'yearly' else 'custom' end;

      v_invoice_recipient_name:=nullif(btrim(coalesce(v_row->>'invoiceRecipientName','')),'');
      v_invoice_disabled:=lower(coalesce(v_row->>'invoiceDisabled','false')) in ('true','1','sim','s','x');
      v_invoice_disabled_reason:=nullif(btrim(coalesce(v_row->>'invoiceDisabledReason','')),'');
      v_tax_receipt_ir:=lower(coalesce(v_row->>'taxReceiptIr','true')) in ('true','1','sim','s','x') and not v_invoice_disabled;

      v_invoice_status:=upper(btrim(coalesce(v_row->>'invoiceStatus','')));
      v_invoice_issued_date:=case when coalesce(v_row->>'invoiceIssuedDate','')~'^\d{4}-\d{2}-\d{2}$' then (v_row->>'invoiceIssuedDate')::date else null end;
      v_invoice_issued_amount_cents:=case when coalesce(v_row->>'invoiceIssuedAmountCents','')~'^[0-9]+([.][0-9]+)?$' then (v_row->>'invoiceIssuedAmountCents')::numeric else null end;

      v_import_key:=nullif(btrim(coalesce(v_row->>'importKey','')),'');
      if v_import_key is null then v_import_key:=md5(concat_ws('|',lower(v_name),v_payment_method,v_start_date,v_total_amount,v_installment_count)); end if;

      v_patient_id:=null; v_patient_unit_id:=null; v_payment_plan_id:=null;
      if v_clinicorp_patient_id is not null then
        select pu.patient_id,pu.id into v_patient_id,v_patient_unit_id from public.patient_units pu
        where pu.unit_id=v_unit_id and pu.clinicorp_patient_id=v_clinicorp_patient_id limit 1;
      end if;
      if v_patient_id is null and v_cpf is not null then
        select p.id into v_patient_id from public.patients p where p.cpf=v_cpf and p.archived_at is null limit 1;
      end if;
      if v_patient_id is null then
        select p.id,pu.id into v_patient_id,v_patient_unit_id
        from public.patients p join public.patient_units pu on pu.patient_id=p.id
        where pu.unit_id=v_unit_id and pu.is_active and p.archived_at is null and lower(btrim(p.full_name))=lower(v_name)
        order by p.updated_at desc,p.id desc limit 1;
      end if;
      v_was_existing:=v_patient_id is not null;

      if v_patient_id is null then
        insert into public.patients(full_name,cpf,phone,email,tax_receipt_ir,status,source,notes,created_by,updated_by)
        values(v_name,v_cpf,v_phone,v_email,v_tax_receipt_ir,case when v_cpf is null then 'manual_review' else 'active' end,v_source,v_notes,v_user_id,v_user_id)
        returning id into v_patient_id;
      else
        update public.patients p set full_name=v_name,cpf=coalesce(v_cpf,p.cpf),phone=coalesce(v_phone,p.phone),email=coalesce(v_email,p.email),
          tax_receipt_ir=v_tax_receipt_ir,status=case when coalesce(v_cpf,p.cpf) is null then 'manual_review' else 'active' end,
          source=case when v_source='manual' then 'manual' else p.source end,notes=coalesce(v_notes,p.notes),updated_by=v_user_id,archived_at=null
        where p.id=v_patient_id;
      end if;

      insert into public.patient_units(patient_id,unit_id,clinicorp_patient_id,treatment,started_at,source,created_by,updated_by)
      values(v_patient_id,v_unit_id,v_clinicorp_patient_id,v_treatment,v_start_date,v_source,v_user_id,v_user_id)
      on conflict(patient_id,unit_id) do update set
        clinicorp_patient_id=coalesce(excluded.clinicorp_patient_id,public.patient_units.clinicorp_patient_id),
        treatment=coalesce(excluded.treatment,public.patient_units.treatment),started_at=least(coalesce(public.patient_units.started_at,excluded.started_at),excluded.started_at),
        is_active=true,source=case when excluded.source='manual' then 'manual' else public.patient_units.source end,updated_by=v_user_id
      returning id into v_patient_unit_id;

      select pp.id into v_payment_plan_id from public.payment_plans pp
      where pp.unit_id=v_unit_id and pp.patient_unit_id=v_patient_unit_id and pp.metadata->>'import_key'=v_import_key and pp.archived_at is null limit 1;

      if v_payment_plan_id is null then
        insert into public.payment_plans(
          unit_id,patient_unit_id,treatment,payment_method,total_amount,installment_amount,installment_count,due_day,start_date,end_date,
          issue_invoice_for_ir,invoice_frequency_override,first_invoice_date,invoice_interval_months,invoice_schedule_mode,invoice_recipient_name,
          invoice_disabled,invoice_disabled_reason,status,source,metadata,created_by,updated_by
        ) values(
          v_unit_id,v_patient_unit_id,v_treatment,v_payment_method,v_total_amount,v_installment_amount,v_installment_count,v_due_day,v_start_date,v_end_date,
          v_tax_receipt_ir,v_invoice_frequency,v_first_invoice_date,v_invoice_interval,v_invoice_schedule_mode,v_invoice_recipient_name,v_invoice_disabled,
          v_invoice_disabled_reason,'active',v_source,jsonb_strip_nulls(jsonb_build_object(
            'import_key',v_import_key,'invoice_schedule_source',case when v_source='manual' then 'manual' else 'spreadsheet' end,
            'invoice_status',nullif(v_invoice_status,''),'invoice_issued_date',v_invoice_issued_date,
            'invoice_issued_amount_cents',v_invoice_issued_amount_cents,'invoice_import_note',v_notes,'invoice_until_installment_end',true
          )),v_user_id,v_user_id
        ) returning id into v_payment_plan_id;
      else
        update public.payment_plans pp set treatment=coalesce(v_treatment,pp.treatment),payment_method=v_payment_method,total_amount=v_total_amount,
          installment_amount=v_installment_amount,installment_count=v_installment_count,due_day=v_due_day,start_date=v_start_date,end_date=v_end_date,
          issue_invoice_for_ir=v_tax_receipt_ir,invoice_frequency_override=v_invoice_frequency,first_invoice_date=v_first_invoice_date,
          invoice_interval_months=v_invoice_interval,invoice_schedule_mode=v_invoice_schedule_mode,invoice_recipient_name=v_invoice_recipient_name,
          invoice_disabled=v_invoice_disabled,invoice_disabled_reason=v_invoice_disabled_reason,status='active',
          source=case when v_source='manual' then 'manual' else pp.source end,
          metadata=coalesce(pp.metadata,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object(
            'import_key',v_import_key,'invoice_schedule_source',case when v_source='manual' then 'manual' else 'spreadsheet' end,
            'invoice_status',nullif(v_invoice_status,''),'invoice_issued_date',v_invoice_issued_date,
            'invoice_issued_amount_cents',v_invoice_issued_amount_cents,'invoice_import_note',v_notes,'invoice_until_installment_end',true
          )),updated_by=v_user_id,archived_at=null
        where pp.id=v_payment_plan_id;
      end if;

      perform private.sync_invoice_obligations_for_plan(v_payment_plan_id);

      insert into public.import_rows(unit_id,import_run_id,row_number,status,raw_data,normalized_data,patient_id)
      values(v_unit_id,v_import_run_id,v_row_number,'imported',v_row,jsonb_strip_nulls(jsonb_build_object(
        'name',v_name,'cpf',v_cpf,'phone',v_phone,'clinicorpId',v_clinicorp_patient_id,'paymentMethod',v_payment_method,
        'installments',v_installment_count,'installmentAmount',v_installment_amount,'startDate',v_start_date,'endDate',v_end_date,
        'invoiceScheduleMode',v_invoice_schedule_mode,'invoiceDisabled',v_invoice_disabled,'importKey',v_import_key
      )),v_patient_id);

      if v_was_existing then v_updated:=v_updated+1; else v_imported:=v_imported+1; end if;
    exception when others then
      v_errors:=v_errors+1;
      insert into public.import_rows(unit_id,import_run_id,row_number,status,raw_data,errors)
      values(v_unit_id,v_import_run_id,v_row_number,'invalid',v_row,jsonb_build_array(sqlerrm));
    end;
  end loop;

  update public.import_runs r set
    status=case when v_errors=0 then 'completed' when v_imported+v_updated>0 then 'partial' else 'failed' end,
    valid_rows=v_imported+v_updated,imported_rows=v_imported+v_updated,duplicate_rows=v_updated,error_rows=v_errors,
    report=jsonb_build_object('created',v_imported,'updated',v_updated,'errors',v_errors),completed_at=now()
  where r.id=v_import_run_id;

  return query select v_import_run_id,v_imported,v_updated,v_errors;
end;
$function$;
