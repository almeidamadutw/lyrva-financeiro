-- No-op financial updates stay no-ops; fresh source rows can repair old local states.
CREATE OR REPLACE FUNCTION public.refresh_clinicorp_payment_snapshot_rows(p_unit_id bigint, p_rows jsonb)
 RETURNS TABLE(processed_count integer, skipped_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '15s'
AS $function$
declare
  v_row jsonb;
  v_stored jsonb;
  v_id text;
  v_patient_id text;
  v_due_date date;
  v_amount numeric(14,2);
  v_processed integer := 0;
  v_skipped integer := 0;
begin
  if coalesce((select auth.jwt()->>'role'),'') <> 'service_role' then
    raise exception using errcode='42501', message='Esta rotina é exclusiva da integração segura do LYVRA.';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception using errcode='22023', message='A atualização do snapshot precisa receber uma lista JSON.';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_id := coalesce(
      nullif(btrim(coalesce(v_row->>'id','')), ''),
      nullif(btrim(coalesce(v_row->>'ExternalTxId','')), '')
    );

    if v_id is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select s.raw into v_stored from public.clinicorp_payment_snapshot s
      where s.unit_id=p_unit_id and s.clinicorp_payment_id=v_id for update;
    v_row:=private.clinicorp_newest_payload(v_stored,v_row);
    v_patient_id := nullif(btrim(coalesce(v_row->>'PatientId','')), '');

    begin
      v_due_date := case
        when substring(coalesce(v_row->>'DueDate','') from 1 for 10) ~ '^\d{4}-\d{2}-\d{2}$'
          then private.clinicorp_posting_day(v_row->>'DueDate')
        else null
      end;
    exception when others then
      v_due_date := null;
    end;

    begin
      v_amount := case
        when replace(coalesce(v_row->>'Amount',''), ',', '.') ~ '^[-]?[0-9]+([.][0-9]+)?$'
          then replace(v_row->>'Amount', ',', '.')::numeric
        else null
      end;
    exception when others then
      v_amount := null;
    end;

    insert into public.clinicorp_payment_snapshot(
      unit_id,
      clinicorp_payment_id,
      clinicorp_patient_id,
      patient_name,
      due_date,
      amount,
      payment_form,
      payment_received,
      payment_confirmed,
      cancelled,
      last_seen_at,
      raw
    ) values (
      p_unit_id,
      v_id,
      v_patient_id,
      nullif(btrim(coalesce(v_row->>'PatientName','')), ''),
      v_due_date,
      v_amount,
      nullif(btrim(coalesce(v_row->>'PaymentForm','')), ''),
      upper(coalesce(v_row->>'PaymentReceived','')) = 'X',
      upper(coalesce(v_row->>'PaymentConfirmed','')) = 'X',
      upper(coalesce(v_row->>'Canceled','')) = 'X'
        or upper(coalesce(v_row->>'CancelInstallment','')) = 'X' or upper(coalesce(v_row->>'ExternalStatus','')) in ('CANCELED','CANCELLED'),
      now(),
      v_row
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
        raw = case when public.clinicorp_payment_snapshot.raw=excluded.raw then public.clinicorp_payment_snapshot.raw else excluded.raw end;

    v_processed := v_processed + 1;
  end loop;

  return query select v_processed, v_skipped;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.upsert_clinicorp_boleto_receivables(p_unit_id bigint, p_rows jsonb, p_sync_run_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(processed_count integer, created_count integer, updated_count integer, paid_count integer, open_count integer, skipped_count integer, failed_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '60s'
AS $function$
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
  v_affected integer := 0;
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
    v_row:=private.clinicorp_newest_payload((select s.raw from public.clinicorp_payment_snapshot s
      where s.unit_id=p_unit_id and s.clinicorp_payment_id=coalesce(nullif(v_row->>'id',''),v_row->>'ExternalTxId')),v_row);
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
          then private.clinicorp_posting_day(v_row ->> 'DueDate')
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
        or upper(coalesce(v_row ->> 'CancelInstallment','')) = 'X' or upper(coalesce(v_row ->> 'ExternalStatus','')) in ('CANCELED','CANCELLED');

      v_received:=v_received and not v_cancelled;

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
            paid_amount = case when v_received then v_amount else 0 end,
            status = v_status,
            paid_at = case
              when not v_received then null
              when nullif(v_row ->> 'ReceivedDate','') is not null then (v_row ->> 'ReceivedDate')::timestamptz
              when nullif(v_row ->> 'PaymentDate','') is not null then (v_row ->> 'PaymentDate')::timestamptz
              when nullif(v_row ->> 'ConfirmedDate','') is not null then (v_row ->> 'ConfirmedDate')::timestamptz
              else i.paid_at
            end,
            confirmed_at = case
              when v_received and nullif(v_row ->> 'ConfirmedDate','') is not null
                then (v_row ->> 'ConfirmedDate')::timestamptz
              else null
            end,
            boleto_url = coalesce(nullif(v_row ->> 'BoletoUrl',''), i.boleto_url),
            source = 'clinicorp',
            clinicorp_source_state = v_state,
            metadata = (coalesce(i.metadata,'{}'::jsonb)-'clinicorp_superseded'-'clinicorp_superseded_by')
              || jsonb_build_object('clinicorp_absence_count',0,'clinicorp_absence_reason',null)
              || jsonb_strip_nulls(jsonb_build_object(
              'clinicorp_patient_id', v_ext_patient_id,
              'clinicorp_payment_header_id', nullif(btrim(coalesce(v_row ->> 'PaymentHeaderId','')), ''),
              'clinicorp_treatment_id', nullif(btrim(coalesce(v_row ->> 'TreatmentId','')), ''),
              'clinicorp_receivable_id', v_ext_row_id,
              'clinicorp_raw_installment_number', nullif(btrim(coalesce(v_row ->> 'InstallmentNumber','')), ''),
              'clinicorp_installments_count', nullif(btrim(coalesce(v_row ->> 'InstallmentsCount','')), '')
            )),
            last_synced_at = now(),
            updated_at = now()
        where i.id = v_installment_id and (
          row(i.due_date,i.expected_amount,i.paid_amount,i.status,i.clinicorp_source_state,i.boleto_url)
          is distinct from row(v_due_date,v_amount,case when v_received then v_amount else 0 end,v_status,v_state,coalesce(nullif(v_row->>'BoletoUrl',''),i.boleto_url))
          or coalesce(i.metadata->>'clinicorp_superseded','false')='true'
          or coalesce(i.metadata->>'clinicorp_absence_count','0')<>'0'
        );
        get diagnostics v_affected=row_count;

        -- A bill refresh must not rewrite shared contracts or invoice preferences.
        update public.payment_plans pp
        set total_amount=v_amount,installment_amount=v_amount,
            start_date=v_due_date,end_date=v_due_date,due_day=extract(day from v_due_date)::smallint,
            updated_at=now()
        where pp.id=v_plan_id and pp.clinicorp_contract_id is null and pp.installment_count=1
          and pp.metadata->>'clinicorp_receivable_id'=v_ext_row_id
          and row(pp.total_amount,pp.installment_amount,pp.start_date,pp.end_date)
            is distinct from row(v_amount,v_amount,v_due_date,v_due_date);

        v_updated := v_updated + v_affected;
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
$function$
;

create or replace function private.clinicorp_newest_payload(p_stored jsonb,p_incoming jsonb)
returns jsonb language plpgsql immutable set search_path='' as $fn$
declare a text; b text;
begin
 if p_stored is null then return p_incoming; end if;
 a:=p_stored->>'Version'; b:=p_incoming->>'Version';
 if a~'^[0-9]{1,18}$' and b~'^[0-9]{1,18}$' and a::numeric>b::numeric then return p_stored; end if;
 a:=p_stored->>'z_LastChange_Date'; b:=p_incoming->>'z_LastChange_Date';
 if a~'^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' and b~'^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$'
   and a::timestamptz>b::timestamptz then return p_stored; end if;
 return p_incoming;
exception when invalid_datetime_format or datetime_field_overflow then return p_incoming;
end; $fn$;

create or replace function public.apply_clinicorp_sync_batch(p_job_id bigint,p_lease_token uuid,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='15s' as $fn$
declare
 v_job private.clinicorp_sync_days%rowtype; v_rows jsonb; v_boleto jsonb:='[]'; v_row jsonb; v_result record;
 v_count integer; v_changed integer:=0; v_state text; v_id text; v_pu bigint; v_existing_pu bigint;
 v_ledger jsonb:='[]'; v_method text; v_payment_key text;
 v_plan bigint; v_installment bigint; v_amount numeric; v_due date; v_paid boolean; v_cancelled boolean;
begin
 perform private.require_clinicorp_service();
 select * into v_job from private.clinicorp_sync_days where id=p_job_id for update;
 if not found or v_job.status<>'working' or v_job.lease_token is distinct from p_lease_token or v_job.lease_until<clock_timestamp() then
   raise exception using errcode='55000',message='A concessão de processamento expirou.';
 end if;
 if v_job.phase<>'apply' then return jsonb_build_object('phase',v_job.phase,'rows',0); end if;
 perform set_config('lyvra.clinicorp_sync_job',p_job_id::text,true);
 select coalesce(jsonb_agg(v_job.payload->n),'[]') into v_rows from generate_series(v_job.apply_cursor,
   least(v_job.returned_rows-1,v_job.apply_cursor+least(greatest(coalesce(p_limit,25),1),50)-1)) n;
 perform 1 from public.clinicorp_payment_snapshot s where s.unit_id=v_job.unit_id
   and s.clinicorp_payment_id in (select r->>'id' from jsonb_array_elements(v_rows) r)
   order by s.clinicorp_payment_id for update;
 select coalesce(jsonb_agg(private.clinicorp_newest_payload(s.raw,r.value)||jsonb_build_object('id',r.value->>'id') order by r.ordinality),'[]') into v_rows
   from jsonb_array_elements(v_rows) with ordinality r(value,ordinality)
   left join public.clinicorp_payment_snapshot s on s.unit_id=v_job.unit_id and s.clinicorp_payment_id=r.value->>'id';
 v_count:=jsonb_array_length(v_rows);
 if v_count>0 then
   select * into v_result from public.refresh_clinicorp_payment_snapshot_rows(v_job.unit_id,v_rows);
   if v_result.processed_count<>v_count or v_result.skipped_count<>0 then raise exception 'Snapshot incompleto; lote preservado para repetição.'; end if;
 end if;
 for v_row in select value from jsonb_array_elements(v_rows) loop
   v_id:=v_row->>'id';
   v_paid:=upper(coalesce(v_row->>'PaymentReceived',''))='X' or upper(coalesce(v_row->>'PaymentConfirmed',''))='X';
   v_cancelled:=upper(coalesce(v_row->>'Canceled',''))='X' or upper(coalesce(v_row->>'CancelInstallment',''))='X'
     or upper(coalesce(v_row->>'ExternalStatus','')) in ('CANCELLED','CANCELED');
   v_paid:=v_paid and not v_cancelled;
   v_state:=case when v_paid then 'paid' when v_cancelled then 'cancelled' else 'open' end;
   v_amount:=replace(coalesce(v_row->>'Amount','0'),',','.')::numeric;
   v_due:=private.clinicorp_posting_day(v_row->>'DueDate');
   if lower(v_row->>'PaymentForm') like '%boleto%' and v_amount>0 then
     select pu.id into v_pu from public.patient_units pu
       where pu.unit_id=v_job.unit_id and pu.clinicorp_patient_id=v_row->>'PatientId' and pu.is_active;
     if v_pu is null then
       select * into v_result from public.upsert_clinicorp_financial_directory(v_job.unit_id,jsonb_build_array(v_row),null);
       select pu.id into v_pu from public.patient_units pu
         where pu.unit_id=v_job.unit_id and pu.clinicorp_patient_id=v_row->>'PatientId' and pu.is_active;
       if v_pu is null then raise exception 'PatientId % sem vínculo único; o lote não foi confirmado.',v_row->>'PatientId'; end if;
     end if;
     select i.id,i.payment_plan_id,pp.patient_unit_id into v_installment,v_plan,v_existing_pu
       from public.installments i join public.payment_plans pp on pp.id=i.payment_plan_id and pp.unit_id=i.unit_id
       where i.unit_id=v_job.unit_id and i.clinicorp_installment_id=v_id;
     if v_installment is not null and v_existing_pu is distinct from v_pu then
       -- Exact source ID proves ownership; isolate this receipt without moving other patients' contracts.
       insert into public.payment_plans(unit_id,patient_unit_id,treatment,payment_method,total_amount,installment_amount,
         installment_count,due_day,start_date,end_date,issue_invoice_for_ir,invoice_disabled,invoice_disabled_reason,status,source,metadata)
       values(v_job.unit_id,v_pu,'Recebível Clinicorp','boleto',v_amount,v_amount,1,extract(day from v_due)::smallint,v_due,v_due,
         false,true,'Recebível técnico da Régua de Cobrança sincronizado diretamente do Clinicorp','active','clinicorp',
         jsonb_build_object('clinicorp_receivable',true,'clinicorp_receivable_id',v_id,'collection_only',true,'clinicorp_schedule_complete',false)) returning id into v_plan;
       update public.collection_cases set patient_unit_id=v_pu where installment_id=v_installment and unit_id=v_job.unit_id;
       update public.installments set payment_plan_id=v_plan,installment_number=1 where id=v_installment;
     end if;
     v_boleto:=v_boleto||jsonb_build_array(v_row);
   else
     v_method:=case when private.normalize_match_text(v_row->>'PaymentForm') like '%cartao%' then 'card'
       when lower(v_row->>'PaymentForm') like '%pix%' then 'pix'
       when private.normalize_match_text(v_row->>'PaymentForm') like '%dinheiro%' then 'cash'
       when lower(v_row->>'PaymentForm') like '%transfer%' then 'transfer' else 'other' end;
     select i.id,i.payment_plan_id,pp.patient_unit_id into v_installment,v_plan,v_existing_pu
       from public.installments i join public.payment_plans pp on pp.id=i.payment_plan_id
       where i.unit_id=v_job.unit_id and i.clinicorp_installment_id=v_id;
     if v_installment is null and v_amount>0 and v_due is not null and nullif(v_row->>'PatientId','') is not null then
       select pu.id into v_pu from public.patient_units pu where pu.unit_id=v_job.unit_id and pu.clinicorp_patient_id=v_row->>'PatientId';
       if v_pu is null then
         perform public.upsert_clinicorp_financial_directory(v_job.unit_id,jsonb_build_array(v_row),null);
         select pu.id into v_pu from public.patient_units pu where pu.unit_id=v_job.unit_id and pu.clinicorp_patient_id=v_row->>'PatientId';
       end if;
       if v_pu is null then raise exception 'PatientId % sem vínculo único.',v_row->>'PatientId'; end if;
       insert into public.payment_plans(unit_id,patient_unit_id,treatment,payment_method,total_amount,installment_amount,
         installment_count,due_day,start_date,end_date,issue_invoice_for_ir,invoice_disabled,invoice_disabled_reason,status,source,metadata)
       values(v_job.unit_id,v_pu,coalesce(nullif(v_row->>'PaymentDescription',''),'Recebível Clinicorp'),v_method,v_amount,v_amount,
         1,extract(day from v_due)::smallint,v_due,v_due,false,true,'Recebível técnico do Clinicorp','active','clinicorp',
         jsonb_build_object('clinicorp_receivable',true,'clinicorp_receivable_id',v_id,'clinicorp_payment_header_id',v_row->>'PaymentHeaderId',
           'collection_only',false,'clinicorp_schedule_complete',false)) returning id into v_plan;
       insert into public.installments(unit_id,payment_plan_id,clinicorp_installment_id,installment_number,due_date,expected_amount,
         paid_amount,status,source,clinicorp_source_state,metadata)
       values(v_job.unit_id,v_plan,v_id,1,v_due,v_amount,case when v_paid then v_amount else 0 end,
         case when v_paid then 'paid' when v_cancelled then 'cancelled' when v_due<(now() at time zone 'America/Sao_Paulo')::date then 'overdue' else 'pending' end,
         'clinicorp',v_state,jsonb_build_object('clinicorp_patient_id',v_row->>'PatientId','clinicorp_payment_header_id',v_row->>'PaymentHeaderId'))
       returning id into v_installment;
     end if;
     -- Non-boleto rows still close stale boleto cases, and paid rows retain their exact source identity.
     update public.installments i set
       expected_amount=greatest(v_amount,0),
       due_date=coalesce(v_due,i.due_date),
       paid_amount=case when v_paid then greatest(v_amount,0) else 0 end,
       status=case when v_paid then 'paid' when v_cancelled then 'cancelled'
         when coalesce(v_due,i.due_date)<(now() at time zone 'America/Sao_Paulo')::date then 'overdue' else 'pending' end,
       clinicorp_source_state=case when v_state='open' and lower(v_row->>'PaymentForm') not like '%boleto%'
         and exists(select 1 from public.payment_plans pp where pp.id=i.payment_plan_id and pp.payment_method='boleto') then 'missing' else v_state end,
       metadata=coalesce(i.metadata,'{}')||jsonb_build_object('clinicorp_absence_count',0,
         'clinicorp_absence_reason',case when v_state='open' and lower(v_row->>'PaymentForm') not like '%boleto%'
           and exists(select 1 from public.payment_plans pp where pp.id=i.payment_plan_id and pp.payment_method='boleto') then 'payment_form_changed' else null end),
       last_synced_at=now()
     where i.unit_id=v_job.unit_id and i.clinicorp_installment_id=v_id and i.source='clinicorp'
       and (row(i.expected_amount,i.due_date,i.paid_amount,i.clinicorp_source_state) is distinct from
         row(greatest(v_amount,0),coalesce(v_due,i.due_date),case when v_paid then greatest(v_amount,0) else 0 end,
           case when v_state='open' and lower(v_row->>'PaymentForm') not like '%boleto%'
             and exists(select 1 from public.payment_plans pp where pp.id=i.payment_plan_id and pp.payment_method='boleto') then 'missing' else v_state end));
   end if;
   v_payment_key:=coalesce(nullif(v_row->>'ExternalTxId',''),v_id);
   if not v_paid then
     update public.payments p set status=case when v_cancelled then 'reversed' else 'processing' end,
       reversed_at=case when v_cancelled then coalesce(p.reversed_at,now()) else null end,raw_data=v_row,updated_at=now()
       where p.unit_id=v_job.unit_id and p.clinicorp_payment_id=v_payment_key and p.source='clinicorp'
         and p.status is distinct from case when v_cancelled then 'reversed' else 'processing' end;
   elsif upper(coalesce(v_row->>'PaymentConfirmed',''))='X' and nullif(v_row->>'ConfirmedDate','') is not null and v_amount>0 and v_due is not null
     and not exists(select 1 from public.payments p where p.unit_id=v_job.unit_id and p.clinicorp_payment_id=v_payment_key
       and p.status='confirmed' and p.amount=v_amount and p.raw_data->>'id'=v_id
       and p.installment_id=(select i.id from public.installments i where i.unit_id=v_job.unit_id and i.clinicorp_installment_id=v_id)) then
     v_ledger:=v_ledger||jsonb_build_array(v_row);
   end if;
   update public.clinicorp_payment_snapshot set source_presence='present',source_presence_checked_at=v_job.observed_at
     where unit_id=v_job.unit_id and clinicorp_payment_id=v_id;
 end loop;
 if jsonb_array_length(v_boleto)>0 then
   select * into v_result from public.upsert_clinicorp_boleto_receivables(v_job.unit_id,v_boleto,null);
   if v_result.failed_count<>0 or v_result.skipped_count<>0 or v_result.processed_count<>jsonb_array_length(v_boleto) then
     raise exception 'Aplicação incompleta: % falhas, % ignorados. O lote será repetido.',v_result.failed_count,v_result.skipped_count;
   end if;
   v_changed:=v_result.created_count+v_result.updated_count;
 end if;
 if jsonb_array_length(v_ledger)>0 then
   select * into v_result from public.ingest_clinicorp_payments(v_job.unit_id,v_ledger,null);
   if v_result.failed_count>0 then raise exception 'O livro de recebimentos não foi aplicado integralmente.'; end if;
 end if;
 update private.clinicorp_sync_days set apply_cursor=apply_cursor+v_count,changed_rows=changed_rows+v_changed,
   phase=case when apply_cursor+v_count>=returned_rows then 'verify' else 'apply' end,
   lease_until=clock_timestamp()+interval '2 minutes',updated_at=now() where id=p_job_id;
 return jsonb_build_object('phase',case when v_job.apply_cursor+v_count>=v_job.returned_rows then 'verify' else 'apply' end,
   'rows',v_count,'changed',v_changed,'cursor',v_job.apply_cursor+v_count,'total',v_job.returned_rows);
end; $fn$;

create or replace function public.finish_clinicorp_sync_job(p_job_id bigint,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='15s' as $fn$
declare v_job private.clinicorp_sync_days%rowtype; v_source_ids text[]; v_missing integer; v_first integer; v_rows integer;
begin
 perform private.require_clinicorp_service();
 select * into v_job from private.clinicorp_sync_days where id=p_job_id for update;
 if not found or v_job.status<>'working' or v_job.lease_token is distinct from p_lease_token or v_job.lease_until<clock_timestamp() then
   raise exception using errcode='55000',message='A concessão de processamento expirou.';
 end if;
 if v_job.phase<>'verify' or v_job.apply_cursor<>v_job.returned_rows then raise exception 'O lote ainda não terminou de aplicar os registros.'; end if;
 select coalesce(array_agg(r->>'id'),array[]::text[]) into v_source_ids from jsonb_array_elements(v_job.payload) r;
 -- Only a new, independently fetched observation counts as another absence.
 with absent as materialized (
   select i.id,i.metadata,s.clinicorp_payment_id,
     case when coalesce(i.metadata->>'clinicorp_absence_count','')~'^[0-9]+$' then (i.metadata->>'clinicorp_absence_count')::integer else 0 end n,
     nullif(i.metadata->>'clinicorp_absence_observed_at','')::timestamptz previous_observation
   from public.clinicorp_payment_snapshot s join public.installments i
     on i.unit_id=s.unit_id and i.clinicorp_installment_id=s.clinicorp_payment_id
   where s.unit_id=v_job.unit_id and s.posting_day=v_job.posting_day
     and i.source='clinicorp' and i.clinicorp_source_state='open' and i.status not in ('paid','cancelled','refunded')
     and not (s.clinicorp_payment_id=any(v_source_ids))
     -- A newer received/payment observation wins over an older staged creation-day snapshot.
     and s.last_seen_at<=v_job.observed_at
 ), changed as (
   update public.installments i set
     clinicorp_source_state=case when a.n>=1 and a.previous_observation<v_job.observed_at-interval '2 minutes' then 'missing' else 'open' end,
     metadata=coalesce(i.metadata,'{}')||jsonb_build_object(
       'clinicorp_absence_count',case when a.n>=1 and a.previous_observation<v_job.observed_at-interval '2 minutes' then a.n+1 else 1 end,
       'clinicorp_absence_reason',case when a.n>=1 and a.previous_observation<v_job.observed_at-interval '2 minutes'
         then 'absent_from_exact_postdate_recheck' else 'first_absence_from_exact_postdate_recheck' end,
       'clinicorp_absence_observed_at',v_job.observed_at,'clinicorp_postdate_checked_at',v_job.observed_at),updated_at=now()
     from absent a where i.id=a.id and (a.previous_observation is null or a.previous_observation<v_job.observed_at-interval '2 minutes')
     returning i.clinicorp_source_state
 ) select count(*) filter(where clinicorp_source_state='missing'),count(*) filter(where clinicorp_source_state='open') into v_missing,v_first from changed;
 update public.clinicorp_payment_snapshot s set source_presence='missing',source_presence_checked_at=v_job.observed_at
   from public.installments i where i.unit_id=v_job.unit_id and i.clinicorp_source_state='missing'
     and s.unit_id=i.unit_id and s.clinicorp_payment_id=i.clinicorp_installment_id and s.posting_day=v_job.posting_day
     and not(s.clinicorp_payment_id=any(v_source_ids));
 -- Verification covers every source row, including rows not present locally before the fetch.
 select count(*) into v_rows from public.clinicorp_payment_snapshot s
   where s.unit_id=v_job.unit_id and s.clinicorp_payment_id=any(v_source_ids) and s.source_presence='present'
     and s.source_presence_checked_at=v_job.observed_at;
 if v_rows<>v_job.returned_rows then raise exception 'A conferência da fonte não terminou.'; end if;
 update private.clinicorp_sync_days set status=case when v_first>0 or refresh_requested_at>v_job.observed_at then 'pending' else 'done' end,
   phase='fetch',payload=null,apply_cursor=0,lease_token=null,lease_until=null,attempts=0,
   next_attempt_at=case when v_first>0 then now()+interval '3 minutes' when refresh_requested_at>v_job.observed_at then now()
     when priority>=50 then now()+interval '12 hours' when returned_rows>0 then now()+interval '7 days' else now()+interval '30 days' end,
   missing_rows=coalesce(v_missing,0),last_success_at=case when v_first>0 then last_success_at else now() end,
   last_error=null,updated_at=now() where id=p_job_id;
 return jsonb_build_object('source_rows',v_job.returned_rows,'changed_rows',v_job.changed_rows,'missing_rows',coalesce(v_missing,0),'pending_absences',coalesce(v_first,0));
end; $fn$;

revoke all on function public.apply_clinicorp_sync_batch(bigint,uuid,integer),public.finish_clinicorp_sync_job(bigint,uuid) from public,anon,authenticated;
grant execute on function public.apply_clinicorp_sync_batch(bigint,uuid,integer),public.finish_clinicorp_sync_job(bigint,uuid) to service_role;

CREATE OR REPLACE FUNCTION private.set_clinicorp_installment_source_state()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_state text;
begin
  if new.source is distinct from 'clinicorp' then
    new.clinicorp_source_state := 'unknown';
    return new;
  end if;

  if new.status = 'paid' then
    new.clinicorp_source_state := 'paid';
    return new;
  end if;

  if new.status in ('cancelled','refunded') then
    new.clinicorp_source_state := 'cancelled';
    return new;
  end if;

  -- An explicit state from an exact source row wins over old import payloads.
  if new.clinicorp_source_state in ('open','paid','cancelled','missing') then return new; end if;
  select case when s.cancelled then 'cancelled'
    when s.payment_received or s.payment_confirmed then 'paid' when s.source_presence='missing' then 'missing' else 'open' end
    into v_state from public.clinicorp_payment_snapshot s
    where s.unit_id=new.unit_id and s.clinicorp_payment_id=new.clinicorp_installment_id;
  new.clinicorp_source_state:=coalesce(v_state,'unknown');
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ingest_clinicorp_payments(p_unit_id bigint, p_rows jsonb, p_sync_run_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(processed_count integer, created_count integer, updated_count integer, skipped_count integer, failed_count integer, paid_installments integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '15s'
AS $function$
declare
  v_row jsonb;
  v_inbox_id text;
  v_ext_patient_id text;
  v_ext_payment_id text;
  v_ext_installment_id text;
  v_contract_id text;
  v_patient_name text;
  v_cpf text;
  v_method text;
  v_amount numeric(14,2);
  v_fee numeric(14,2);
  v_confirmed_at timestamptz;
  v_paid_at timestamptz;
  v_due_date date;
  v_external_number integer;
  v_local_number integer;
  v_patient_unit_id bigint;
  v_patient_id bigint;
  v_plan_id bigint;
  v_installment_id bigint;
  v_existing_payment_id bigint;
  v_payment_id bigint;
  v_total_paid numeric(14,2);
  v_expected numeric(14,2);
  v_new_status text;
  v_action text;
  v_sync_key text;
  v_processed integer:=0;
  v_created integer:=0;
  v_updated integer:=0;
  v_pending integer:=0;
  v_failed integer:=0;
  v_paid_count integer:=0;
begin
  if coalesce((select auth.jwt()->>'role'),'')<>'service_role' then
    raise exception using errcode='42501',message='Esta rotina é exclusiva da integração segura do LYVRA.';
  end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' then
    raise exception using errcode='22023',message='A carga do Clinicorp precisa ser uma lista JSON.';
  end if;
  if not exists(select 1 from public.units u where u.id=p_unit_id and u.is_active) then
    raise exception using errcode='22023',message='Unidade inválida para sincronização.';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_row:=private.clinicorp_newest_payload((select s.raw from public.clinicorp_payment_snapshot s
      where s.unit_id=p_unit_id and s.clinicorp_payment_id=coalesce(nullif(v_row->>'id',''),v_row->>'ExternalTxId')),v_row);
    v_processed:=v_processed+1;
    v_inbox_id:=coalesce(nullif(btrim(v_row->>'ExternalTxId'),''),nullif(btrim(v_row->>'id'),''),concat('derived:',md5(v_row::text)));
    insert into private.clinicorp_inbox(unit_id,entity_type,external_id,status,payload)
    values(p_unit_id,'payment',v_inbox_id,'received',v_row)
    on conflict(unit_id,entity_type,external_id) do update set payload=excluded.payload,last_seen_at=now(),status='received',reason=null;

    begin
      if upper(coalesce(v_row->>'Canceled',''))='X' or upper(coalesce(v_row->>'CancelInstallment',''))='X'
        or upper(coalesce(v_row->>'ExternalStatus','')) in ('CANCELED','CANCELLED') then
        update public.payments set status='reversed',reversed_at=coalesce(reversed_at,now()),raw_data=v_row,updated_at=now()
          where unit_id=p_unit_id and clinicorp_payment_id=v_inbox_id and source='clinicorp' and status<>'reversed';
        update private.clinicorp_inbox set status='pending',reason='Recebimento cancelado na fonte',last_seen_at=now()
          where unit_id=p_unit_id and entity_type='payment' and external_id=v_inbox_id;
        v_pending:=v_pending+1;
        continue;
      end if;
      if upper(coalesce(v_row->>'PaymentConfirmed',''))<>'X' or nullif(v_row->>'ConfirmedDate','') is null then
        v_pending:=v_pending+1;
        update private.clinicorp_inbox set status='pending',reason='Aguardando confirmação do Clinicorp',last_seen_at=now() where unit_id=p_unit_id and entity_type='payment' and external_id=v_inbox_id;
        if p_sync_run_id is not null then
          insert into public.sync_events(sync_run_id,unit_id,external_id,entity_type,action,status,error_message)
          values(p_sync_run_id,p_unit_id,v_inbox_id,'payment','receive','success','Preservado e aguardando confirmação.') on conflict do nothing;
        end if;
        continue;
      end if;

      v_method:=case
        when private.normalize_match_text(v_row->>'PaymentForm') like '%boleto%' then 'boleto'
        when private.normalize_match_text(v_row->>'PaymentForm') like '%cartao%' then 'card'
        when private.normalize_match_text(v_row->>'PaymentForm') like '%pix%' then 'pix'
        when private.normalize_match_text(v_row->>'PaymentForm') like '%dinheiro%' then 'cash'
        when private.normalize_match_text(v_row->>'PaymentForm') like '%transfer%' then 'transfer'
        else 'other' end;
      v_ext_patient_id:=nullif(btrim(v_row->>'PatientId'),'');
      v_ext_payment_id:=v_inbox_id;
      v_ext_installment_id:=coalesce(nullif(btrim(v_row->>'id'),''),v_ext_payment_id);
      v_contract_id:=coalesce(nullif(btrim(v_row->>'PaymentHeaderId'),''),nullif(btrim(v_row->>'TreatmentId'),''));
      v_patient_name:=nullif(btrim(v_row->>'PatientName'),'');
      v_cpf:=coalesce(nullif(v_row->>'PayerCPF',''),nullif(v_row->>'OwnerCPF',''));
      v_amount:=case when replace(coalesce(v_row->>'Amount',''),',','.')~'^[-]?[0-9]+([.][0-9]+)?$' then replace(v_row->>'Amount',',','.')::numeric else null end;
      if v_amount is null or v_amount<=0 then
        v_pending:=v_pending+1;
        update private.clinicorp_inbox set status='pending',reason='Movimento sem valor positivo',last_seen_at=now() where unit_id=p_unit_id and entity_type='payment' and external_id=v_inbox_id;
        continue;
      end if;
      v_fee:=case when replace(coalesce(v_row->>'Fee',''),',','.')~'^[0-9]+([.][0-9]+)?$' then replace(v_row->>'Fee',',','.')::numeric else 0 end;
      v_confirmed_at:=case when coalesce(v_row->>'ConfirmedDate','')<>'' then (v_row->>'ConfirmedDate')::timestamptz else now() end;
      v_paid_at:=case
        when coalesce(v_row->>'PaymentDate','')<>'' then (v_row->>'PaymentDate')::timestamptz
        when coalesce(v_row->>'ReceivedDate','')<>'' then (v_row->>'ReceivedDate')::timestamptz
        else v_confirmed_at end;
      v_due_date:=coalesce(private.clinicorp_posting_day(v_row->>'DueDate'),(v_paid_at at time zone 'America/Sao_Paulo')::date);
      v_external_number:=case when coalesce(v_row->>'InstallmentNumber','')~'^[0-9]+$' then (v_row->>'InstallmentNumber')::integer else 0 end;
      v_local_number:=v_external_number+1;

      select x.patient_unit_id,x.patient_id into v_patient_unit_id,v_patient_id
      from private.match_or_create_clinicorp_patient(p_unit_id,v_ext_patient_id,v_patient_name,v_cpf) x;

      v_sync_key:=case when v_contract_id is not null then concat('contract:',v_contract_id) else concat('payment:',v_ext_payment_id) end;
      v_plan_id:=null;
      if v_contract_id is not null then
        select pp.id into v_plan_id from public.payment_plans pp
        where pp.unit_id=p_unit_id and pp.patient_unit_id=v_patient_unit_id and pp.clinicorp_contract_id=v_contract_id and pp.archived_at is null limit 1;
      end if;
      if v_plan_id is null then
        select pp.id into v_plan_id from public.payment_plans pp
        where pp.unit_id=p_unit_id and pp.patient_unit_id=v_patient_unit_id and pp.metadata->>'clinicorp_sync_key'=v_sync_key and pp.archived_at is null limit 1;
      end if;
      if v_plan_id is null then
        insert into public.payment_plans(unit_id,patient_unit_id,clinicorp_contract_id,payment_method,total_amount,installment_amount,installment_count,due_day,start_date,end_date,issue_invoice_for_ir,invoice_disabled,invoice_disabled_reason,status,source,metadata)
        values(p_unit_id,v_patient_unit_id,
          case when v_contract_id is not null and not exists(select 1 from public.payment_plans x where x.unit_id=p_unit_id and x.clinicorp_contract_id=v_contract_id) then v_contract_id else null end,
          v_method,v_amount,v_amount,greatest(v_local_number,1),extract(day from v_due_date)::smallint,v_due_date,v_due_date,false,true,'Plano técnico criado pela sincronização do Clinicorp','active','clinicorp',
          jsonb_build_object('clinicorp_sync_only',true,'clinicorp_sync_key',v_sync_key,'clinicorp_contract_id',v_contract_id))
        returning id into v_plan_id;
      end if;

      v_installment_id:=null;
      select i.id into v_installment_id from public.installments i where i.unit_id=p_unit_id and i.clinicorp_installment_id=v_ext_installment_id limit 1;
      if v_installment_id is null then
        select i.id into v_installment_id from public.installments i
        where i.unit_id=p_unit_id and i.payment_plan_id=v_plan_id and i.installment_number=v_local_number and i.clinicorp_installment_id is null limit 1;
      end if;
      if v_installment_id is null and exists(select 1 from public.installments i
        where i.unit_id=p_unit_id and i.payment_plan_id=v_plan_id and i.installment_number=v_local_number and i.clinicorp_installment_id is not null) then
        v_pending:=v_pending+1;
        update private.clinicorp_inbox set status='pending',reason='Aguardando recebível canônico por ID exato',last_seen_at=now()
          where unit_id=p_unit_id and entity_type='payment' and external_id=v_inbox_id;
        continue;
      end if;
      if v_installment_id is null then
        insert into public.installments(unit_id,payment_plan_id,clinicorp_installment_id,installment_number,due_date,expected_amount,paid_amount,status,source,metadata)
        values(p_unit_id,v_plan_id,v_ext_installment_id,v_local_number,v_due_date,v_amount,0,case when v_due_date<(now() at time zone 'America/Sao_Paulo')::date then 'overdue' else 'pending' end,'clinicorp',jsonb_build_object('clinicorp_auto_created',true,'clinicorp_patient_id',v_ext_patient_id,'clinicorp_contract_id',v_contract_id))
        returning id into v_installment_id;
      else
        update public.installments set clinicorp_installment_id=coalesce(clinicorp_installment_id,v_ext_installment_id),expected_amount=greatest(expected_amount,v_amount),last_synced_at=now(),updated_at=now() where id=v_installment_id;
      end if;

      select p.id into v_existing_payment_id from public.payments p where p.unit_id=p_unit_id and p.clinicorp_payment_id=v_ext_payment_id limit 1;
      if v_existing_payment_id is null then
        insert into public.payments(unit_id,installment_id,clinicorp_payment_id,payment_method,amount,fee_amount,net_amount,status,paid_at,confirmed_at,source,raw_data)
        values(p_unit_id,v_installment_id,v_ext_payment_id,v_method,v_amount,greatest(v_fee,0),greatest(v_amount-greatest(v_fee,0),0),'confirmed',v_paid_at,v_confirmed_at,'clinicorp',v_row)
        returning id into v_payment_id;
        v_created:=v_created+1; v_action:='create';
      else
        update public.payments set installment_id=v_installment_id,payment_method=v_method,amount=v_amount,fee_amount=greatest(v_fee,0),net_amount=greatest(v_amount-greatest(v_fee,0),0),status='confirmed',paid_at=v_paid_at,confirmed_at=v_confirmed_at,source='clinicorp',raw_data=v_row,updated_at=now()
        where id=v_existing_payment_id returning id into v_payment_id;
        v_updated:=v_updated+1; v_action:='update';
      end if;

      insert into public.payment_events(unit_id,installment_id,payment_id,source,event_type,external_event_id,payload,occurred_at,processed_at)
      values(p_unit_id,v_installment_id,v_payment_id,'clinicorp','payment_confirmed',concat('confirmed:',v_ext_payment_id),v_row,v_confirmed_at,now())
      on conflict(source,external_event_id) where external_event_id is not null do update set payment_id=excluded.payment_id,installment_id=excluded.installment_id,payload=excluded.payload,occurred_at=excluded.occurred_at,processed_at=now();

      select coalesce(sum(p.amount),0) into v_total_paid from public.payments p where p.unit_id=p_unit_id and p.installment_id=v_installment_id and p.status='confirmed';
      select i.expected_amount into v_expected from public.installments i where i.id=v_installment_id;
      v_new_status:='paid';
      update public.installments set expected_amount=v_amount,paid_amount=v_amount,paid_at=v_paid_at,confirmed_at=v_confirmed_at,last_synced_at=now(),status='paid',clinicorp_source_state='paid',source='clinicorp',updated_at=now()
        where id=v_installment_id and row(expected_amount,paid_amount,status,paid_at,confirmed_at) is distinct from row(v_amount,v_amount,'paid',v_paid_at,v_confirmed_at);
      -- Contract totals are independent from a single receipt.
      if v_new_status='paid' then v_paid_count:=v_paid_count+1; end if;
      update private.clinicorp_inbox set status='applied',reason=null,applied_at=now(),last_seen_at=now() where unit_id=p_unit_id and entity_type='payment' and external_id=v_inbox_id;
      if p_sync_run_id is not null then
        insert into public.sync_events(sync_run_id,unit_id,external_id,entity_type,action,status)
        values(p_sync_run_id,p_unit_id,v_ext_payment_id,'payment',v_action,'success') on conflict do nothing;
      end if;
    exception when others then
      v_failed:=v_failed+1;
      update private.clinicorp_inbox set status='error',reason=left(sqlerrm,500),last_seen_at=now() where unit_id=p_unit_id and entity_type='payment' and external_id=v_inbox_id;
      if p_sync_run_id is not null then
        insert into public.sync_events(sync_run_id,unit_id,external_id,entity_type,action,status,error_message)
        values(p_sync_run_id,p_unit_id,v_inbox_id,'payment','receive','failed',left(sqlerrm,500)) on conflict do nothing;
      end if;
    end;
  end loop;
  return query select v_processed,v_created,v_updated,v_pending,v_failed,v_paid_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.reconcile_clinicorp_terminal_rows(p_unit_id bigint, p_rows jsonb)
 RETURNS TABLE(processed_count integer, paid_count integer, cancelled_count integer, updated_count integer, ambiguous_count integer, skipped_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '20s'
AS $function$
declare
  v_row jsonb;
  v_source_id text;
  v_patient_external_id text;
  v_due_date date;
  v_amount numeric(14,2);
  v_paid boolean;
  v_cancelled boolean;
  v_installment_id bigint;
  v_candidates integer;
  v_processed integer:=0;
  v_paid_count integer:=0;
  v_cancelled_count integer:=0;
  v_updated integer:=0;
  v_ambiguous integer:=0;
  v_skipped integer:=0;
begin
  if coalesce((select auth.jwt()->>'role'),'')<>'service_role' then
    raise exception using errcode='42501',message='Esta rotina é exclusiva da integração segura do LYVRA.';
  end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' then
    raise exception using errcode='22023',message='A reconciliação do Clinicorp precisa receber uma lista JSON.';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_row:=private.clinicorp_newest_payload((select s.raw from public.clinicorp_payment_snapshot s
      where s.unit_id=p_unit_id and s.clinicorp_payment_id=coalesce(nullif(v_row->>'id',''),v_row->>'ExternalTxId')),v_row);
    v_processed:=v_processed+1;

    v_cancelled:=
      upper(coalesce(v_row->>'Canceled',''))='X'
      or upper(coalesce(v_row->>'CancelInstallment',''))='X'
      or upper(coalesce(v_row->>'ExternalStatus','')) in ('CANCELED','CANCELLED');

    v_paid:=not v_cancelled and (
      upper(coalesce(v_row->>'PaymentReceived',''))='X'
      or upper(coalesce(v_row->>'PaymentConfirmed',''))='X'
    );

    if not v_paid and not v_cancelled then
      v_skipped:=v_skipped+1;
      continue;
    end if;

    v_source_id:=coalesce(
      nullif(btrim(coalesce(v_row->>'id','')),''),
      nullif(btrim(coalesce(v_row->>'ExternalTxId','')),'')
    );

    v_installment_id:=null;
    v_candidates:=0;

    if v_source_id is not null then
      select min(i.id),count(*)::integer
      into v_installment_id,v_candidates
      from public.installments i
      where i.unit_id=p_unit_id
        and i.source='clinicorp'
        and i.clinicorp_installment_id=v_source_id
        and i.status not in ('paid','cancelled','refunded');

      if v_candidates>1 then
        v_ambiguous:=v_ambiguous+1;
        continue;
      end if;
    end if;

    if v_candidates=0 then
      v_patient_external_id:=nullif(btrim(coalesce(v_row->>'PatientId','')),'');
      v_due_date:=case
        when substring(coalesce(v_row->>'DueDate','') from 1 for 10)~'^\d{4}-\d{2}-\d{2}$'
          then substring(v_row->>'DueDate' from 1 for 10)::date
        else null
      end;
      v_amount:=case
        when replace(coalesce(v_row->>'Amount',''),',','.')~'^[-]?[0-9]+([.][0-9]+)?$'
          then replace(v_row->>'Amount',',','.')::numeric
        else null
      end;

      if v_patient_external_id is null or v_due_date is null or v_amount is null or v_amount<=0 then
        v_skipped:=v_skipped+1;
        continue;
      end if;

      select min(i.id),count(*)::integer
      into v_installment_id,v_candidates
      from public.patient_units pu
      join public.payment_plans pp
        on pp.patient_unit_id=pu.id
       and pp.unit_id=pu.unit_id
       and pp.archived_at is null
       and pp.source='clinicorp'
      join public.installments i
        on i.payment_plan_id=pp.id
       and i.unit_id=pp.unit_id
       and i.source='clinicorp'
      join public.collection_cases cc
        on cc.installment_id=i.id
       and cc.unit_id=i.unit_id
       and cc.status not in ('paid','closed')
      where pu.unit_id=p_unit_id
        and pu.is_active
        and pu.clinicorp_patient_id=v_patient_external_id
        and i.clinicorp_installment_id is null
        and i.due_date=v_due_date
        and abs(i.expected_amount-v_amount)<0.02
        and i.status not in ('paid','cancelled','refunded');

      if v_candidates=0 then
        v_skipped:=v_skipped+1;
        continue;
      end if;
      if v_candidates>1 then
        v_ambiguous:=v_ambiguous+1;
        continue;
      end if;
    end if;

    if v_cancelled then
      update public.installments i
      set status='cancelled',
          clinicorp_source_state='cancelled',
          last_synced_at=now(),
          metadata=coalesce(i.metadata,'{}'::jsonb)||jsonb_build_object(
            'clinicorp_cancelled_at',now(),
            'clinicorp_cancelled_raw_id',nullif(v_row->>'id','')
          ),
          updated_at=now()
      where i.id=v_installment_id;
      v_cancelled_count:=v_cancelled_count+1;
    else
      update public.installments i
      set paid_amount=greatest(coalesce(i.paid_amount,0),i.expected_amount),
          status='paid',
          clinicorp_source_state='paid',
          paid_at=coalesce(
            case when nullif(v_row->>'ReceivedDate','') is not null then (v_row->>'ReceivedDate')::timestamptz end,
            case when nullif(v_row->>'PaymentDate','') is not null then (v_row->>'PaymentDate')::timestamptz end,
            case when nullif(v_row->>'ConfirmedDate','') is not null then (v_row->>'ConfirmedDate')::timestamptz end,
            i.paid_at,
            now()
          ),
          confirmed_at=coalesce(
            case when nullif(v_row->>'ConfirmedDate','') is not null then (v_row->>'ConfirmedDate')::timestamptz end,
            i.confirmed_at
          ),
          last_synced_at=now(),
          metadata=coalesce(i.metadata,'{}'::jsonb)||jsonb_build_object(
            'payment_incremental_reconciled_at',now()
          ),
          updated_at=now()
      where i.id=v_installment_id;
      v_paid_count:=v_paid_count+1;
    end if;

    v_updated:=v_updated+1;
  end loop;

  return query select v_processed,v_paid_count,v_cancelled_count,v_updated,v_ambiguous,v_skipped;
end;
$function$
;


