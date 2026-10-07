create or replace function public.refresh_clinicorp_payment_snapshot_rows(
  p_unit_id bigint,
  p_rows jsonb
)
returns table(processed_count integer, skipped_count integer)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '15s'
as $function$
declare
  v_row jsonb;
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

    v_patient_id := nullif(btrim(coalesce(v_row->>'PatientId','')), '');

    begin
      v_due_date := case
        when substring(coalesce(v_row->>'DueDate','') from 1 for 10) ~ '^\d{4}-\d{2}-\d{2}$'
          then substring(v_row->>'DueDate' from 1 for 10)::date
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
      unit_id, clinicorp_payment_id, clinicorp_patient_id, patient_name,
      due_date, amount, payment_form, payment_received, payment_confirmed,
      cancelled, last_seen_at, raw
    ) values (
      p_unit_id, v_id, v_patient_id,
      nullif(btrim(coalesce(v_row->>'PatientName','')), ''),
      v_due_date, v_amount,
      nullif(btrim(coalesce(v_row->>'PaymentForm','')), ''),
      upper(coalesce(v_row->>'PaymentReceived','')) = 'X',
      upper(coalesce(v_row->>'PaymentConfirmed','')) = 'X',
      upper(coalesce(v_row->>'Canceled','')) = 'X'
        or upper(coalesce(v_row->>'CancelInstallment','')) = 'X',
      now(), v_row
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
        raw = excluded.raw;

    v_processed := v_processed + 1;
  end loop;

  return query select v_processed, v_skipped;
end;
$function$;

revoke all on function public.refresh_clinicorp_payment_snapshot_rows(bigint,jsonb) from public;
revoke all on function public.refresh_clinicorp_payment_snapshot_rows(bigint,jsonb) from anon;
revoke all on function public.refresh_clinicorp_payment_snapshot_rows(bigint,jsonb) from authenticated;
grant execute on function public.refresh_clinicorp_payment_snapshot_rows(bigint,jsonb) to service_role;
