
create or replace function public.upsert_clinicorp_boleto_receivables(
  p_unit_id bigint,
  p_rows jsonb,
  p_sync_run_id bigint default null
)
returns table(
  processed_count integer,
  created_count integer,
  updated_count integer,
  paid_count integer,
  open_count integer,
  skipped_count integer,
  failed_count integer
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '60s'
as $$
declare
  v_row jsonb;
  v_ext_patient_id text;
  v_ext_row_id text;
  v_patient_unit_id bigint;
  v_plan_id bigint;
  v_installment_id bigint;
  v_method text;
  v_due_date date;
  v_amount numeric(14,2);
  v_received boolean;
  v_cancelled boolean;
  v_state text;
  v_status text;
  v_processed integer := 0;
  v_created integer := 0;
  v_updated integer := 0;
  v_paid integer := 0;
  v_open integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode='42501', message='Esta rotina é exclusiva da integração segura do LYVRA.';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception using errcode='22023', message='A carga de recebíveis do Clinicorp precisa ser uma lista JSON.';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_processed := v_processed + 1;

    begin
      v_method := private.normalize_match_text(coalesce(v_row ->> 'PaymentForm',''));
      if v_method not like '%boleto%' then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      v_ext_patient_id := nullif(btrim(coalesce(v_row ->> 'PatientId','')), '');
      v_ext_row_id := nullif(btrim(coalesce(v_row ->> 'id','')), '');

      if v_ext_patient_id is null or v_ext_row_id is null then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      v_due_date := case
        when nullif(v_row ->> 'DueDate','') is not null
          then ((v_row ->> 'DueDate')::timestamptz at time zone 'America/Sao_Paulo')::date
        else null
      end;

      v_amount := case
        when replace(coalesce(v_row ->> 'Amount',''), ',', '.') ~ '^[-]?[0-9]+([.][0-9]+)?$'
          then replace(v_row ->> 'Amount', ',', '.')::numeric
        else null
      end;

      if v_due_date is null or v_amount is null or v_amount <= 0 then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      select pu.id
      into v_patient_unit_id
      from public.patient_units pu
      where pu.unit_id = p_unit_id
        and pu.is_active
        and pu.clinicorp_patient_id = v_ext_patient_id
      limit 1;

      if v_patient_unit_id is null then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      v_received :=
        upper(coalesce(v_row ->> 'PaymentReceived','')) = 'X'
        or upper(coalesce(v_row ->> 'PaymentConfirmed','')) = 'X';

      v_cancelled :=
        upper(coalesce(v_row ->> 'Canceled','')) = 'X'
        or upper(coalesce(v_row ->> 'CancelInstallment','')) = 'X';

      v_state := case
        when v_received then 'paid'
        when v_cancelled then 'cancelled'
        else 'open'
      end;

      v_status := case
        when v_received then 'paid'
        when v_cancelled then 'cancelled'
        when v_due_date < v_today then 'overdue'
        else 'pending'
      end;

      select i.id, i.payment_plan_id
      into v_installment_id, v_plan_id
      from public.installments i
      where i.unit_id = p_unit_id
        and i.clinicorp_installment_id = v_ext_row_id
      limit 1;

      if v_installment_id is null then
        insert into public.payment_plans(
          unit_id,
          patient_unit_id,
          clinicorp_contract_id,
          treatment,
          payment_method,
          total_amount,
          installment_amount,
          installment_count,
          due_day,
          start_date,
          end_date,
          issue_invoice_for_ir,
          invoice_disabled,
          invoice_disabled_reason,
          status,
          source,
          metadata
        ) values (
          p_unit_id,
          v_patient_unit_id,
          null,
          coalesce(nullif(btrim(coalesce(v_row ->> 'PaymentDescription','')), ''), 'Recebível Clinicorp'),
          'boleto',
          v_amount,
          v_amount,
          1,
          extract(day from v_due_date)::smallint,
          v_due_date,
          v_due_date,
          false,
          true,
          'Recebível técnico da Régua de Cobrança sincronizado diretamente do Clinicorp',
          'active',
          'clinicorp',
          jsonb_strip_nulls(jsonb_build_object(
            'clinicorp_receivable', true,
            'clinicorp_receivable_id', v_ext_row_id,
            'clinicorp_payment_header_id', nullif(btrim(coalesce(v_row ->> 'PaymentHeaderId','')), ''),
            'clinicorp_treatment_id', nullif(btrim(coalesce(v_row ->> 'TreatmentId','')), ''),
            'clinicorp_schedule_complete', false,
            'collection_only', true,
            'clinicorp_last_seen_at', now()
          ))
        )
        returning id into v_plan_id;

        insert into public.installments(
          unit_id,
          payment_plan_id,
          clinicorp_installment_id,
          installment_number,
          due_date,
          expected_amount,
          paid_amount,
          status,
          paid_at,
          confirmed_at,
          boleto_url,
          source,
          metadata,
          last_synced_at,
          clinicorp_source_state
        ) values (
          p_unit_id,
          v_plan_id,
          v_ext_row_id,
          1,
          v_due_date,
          v_amount,
          case when v_received then v_amount else 0 end,
          v_status,
          case
            when v_received and nullif(v_row ->> 'ReceivedDate','') is not null then (v_row ->> 'ReceivedDate')::timestamptz
            when v_received and nullif(v_row ->> 'PaymentDate','') is not null then (v_row ->> 'PaymentDate')::timestamptz
            when v_received and nullif(v_row ->> 'ConfirmedDate','') is not null then (v_row ->> 'ConfirmedDate')::timestamptz
            else null
          end,
          case when v_received and nullif(v_row ->> 'ConfirmedDate','') is not null then (v_row ->> 'ConfirmedDate')::timestamptz else null end,
          nullif(v_row ->> 'BoletoUrl',''),
          'clinicorp',
          jsonb_strip_nulls(jsonb_build_object(
            'clinicorp_patient_id', v_ext_patient_id,
            'clinicorp_payment_header_id', nullif(btrim(coalesce(v_row ->> 'PaymentHeaderId','')), ''),
            'clinicorp_treatment_id', nullif(btrim(coalesce(v_row ->> 'TreatmentId','')), ''),
            'clinicorp_receivable_id', v_ext_row_id,
            'clinicorp_raw_installment_number', nullif(btrim(coalesce(v_row ->> 'InstallmentNumber','')), ''),
            'clinicorp_installments_count', nullif(btrim(coalesce(v_row ->> 'InstallmentsCount','')), '')
          )),
          now(),
          v_state
        )
        returning id into v_installment_id;

        v_created := v_created + 1;
      else
        update public.installments i
        set due_date = v_due_date,
            expected_amount = v_amount,
            paid_amount = case when v_received then greatest(coalesce(i.paid_amount,0), v_amount) else i.paid_amount end,
            status = case
              when v_received then 'paid'
              when v_cancelled then 'cancelled'
              when i.status in ('paid','refunded') then i.status
              when v_due_date < v_today then 'overdue'
              else 'pending'
            end,
            paid_at = case
              when not v_received then i.paid_at
              when nullif(v_row ->> 'ReceivedDate','') is not null then (v_row ->> 'ReceivedDate')::timestamptz
              when nullif(v_row ->> 'PaymentDate','') is not null then (v_row ->> 'PaymentDate')::timestamptz
              when nullif(v_row ->> 'ConfirmedDate','') is not null then (v_row ->> 'ConfirmedDate')::timestamptz
              else i.paid_at
            end,
            confirmed_at = case
              when v_received and nullif(v_row ->> 'ConfirmedDate','') is not null
                then (v_row ->> 'ConfirmedDate')::timestamptz
              else i.confirmed_at
            end,
            boleto_url = coalesce(nullif(v_row ->> 'BoletoUrl',''), i.boleto_url),
            source = 'clinicorp',
            clinicorp_source_state = v_state,
            metadata = coalesce(i.metadata,'{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
              'clinicorp_patient_id', v_ext_patient_id,
              'clinicorp_payment_header_id', nullif(btrim(coalesce(v_row ->> 'PaymentHeaderId','')), ''),
              'clinicorp_treatment_id', nullif(btrim(coalesce(v_row ->> 'TreatmentId','')), ''),
              'clinicorp_receivable_id', v_ext_row_id,
              'clinicorp_raw_installment_number', nullif(btrim(coalesce(v_row ->> 'InstallmentNumber','')), ''),
              'clinicorp_installments_count', nullif(btrim(coalesce(v_row ->> 'InstallmentsCount','')), '')
            )),
            last_synced_at = now(),
            updated_at = now()
        where i.id = v_installment_id;

        update public.payment_plans pp
        set source = 'clinicorp',
            payment_method = 'boleto',
            total_amount = greatest(coalesce(pp.total_amount,0), v_amount),
            installment_amount = v_amount,
            invoice_disabled = true,
            invoice_disabled_reason = 'Recebível técnico da Régua de Cobrança sincronizado diretamente do Clinicorp',
            metadata = coalesce(pp.metadata,'{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
              'clinicorp_receivable', true,
              'clinicorp_receivable_id', v_ext_row_id,
              'clinicorp_payment_header_id', nullif(btrim(coalesce(v_row ->> 'PaymentHeaderId','')), ''),
              'clinicorp_treatment_id', nullif(btrim(coalesce(v_row ->> 'TreatmentId','')), ''),
              'clinicorp_schedule_complete', false,
              'collection_only', true,
              'clinicorp_last_seen_at', now()
            )),
            updated_at = now()
        where pp.id = v_plan_id;

        v_updated := v_updated + 1;
      end if;

      if v_received then
        v_paid := v_paid + 1;
      elsif v_state = 'open' then
        v_open := v_open + 1;
      end if;

      if p_sync_run_id is not null then
        insert into public.sync_events(
          sync_run_id, unit_id, external_id, entity_type, action, status, error_message
        ) values (
          p_sync_run_id, p_unit_id, v_ext_row_id, 'receivable',
          case when v_created + v_updated > 0 then 'upsert' else 'skip' end,
          'success', null
        )
        on conflict do nothing;
      end if;

    exception when others then
      v_failed := v_failed + 1;

      if p_sync_run_id is not null then
        insert into public.sync_events(
          sync_run_id, unit_id, external_id, entity_type, action, status, error_message
        ) values (
          p_sync_run_id, p_unit_id, coalesce(v_ext_row_id, nullif(v_row ->> 'id','')),
          'receivable', 'upsert', 'failed', left(sqlerrm,500)
        )
        on conflict do nothing;
      end if;
    end;
  end loop;

  return query
  select v_processed, v_created, v_updated, v_paid, v_open, v_skipped, v_failed;
end;
$$;

revoke all on function public.upsert_clinicorp_boleto_receivables(bigint,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.upsert_clinicorp_boleto_receivables(bigint,jsonb,bigint) to service_role;
