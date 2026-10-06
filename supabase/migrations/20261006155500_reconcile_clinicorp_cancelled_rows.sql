create or replace function public.reconcile_clinicorp_terminal_rows(
  p_unit_id bigint,
  p_rows jsonb
)
returns table(
  processed_count integer,
  paid_count integer,
  cancelled_count integer,
  updated_count integer,
  ambiguous_count integer,
  skipped_count integer
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '20s'
as $function$
declare
  v_row jsonb;
  v_patient_external_id text;
  v_due_date date;
  v_amount numeric(14,2);
  v_paid boolean;
  v_cancelled boolean;
  v_installment_id bigint;
  v_candidates integer;
  v_processed integer := 0;
  v_paid_count integer := 0;
  v_cancelled_count integer := 0;
  v_updated integer := 0;
  v_ambiguous integer := 0;
  v_skipped integer := 0;
begin
  if coalesce((select auth.jwt()->>'role'),'') <> 'service_role' then
    raise exception using errcode='42501', message='Esta rotina é exclusiva da integração segura do LYVRA.';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception using errcode='22023', message='A reconciliação do Clinicorp precisa receber uma lista JSON.';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_processed := v_processed + 1;

    v_cancelled :=
      upper(coalesce(v_row->>'Canceled','')) = 'X'
      or upper(coalesce(v_row->>'CancelInstallment','')) = 'X';

    v_paid :=
      not v_cancelled
      and (
        upper(coalesce(v_row->>'PaymentReceived','')) = 'X'
        or upper(coalesce(v_row->>'PaymentConfirmed','')) = 'X'
      );

    if not v_paid and not v_cancelled then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_patient_external_id := nullif(btrim(coalesce(v_row->>'PatientId','')), '');
    v_due_date := case
      when substring(coalesce(v_row->>'DueDate','') from 1 for 10) ~ '^\d{4}-\d{2}-\d{2}$'
        then substring(v_row->>'DueDate' from 1 for 10)::date
      else null
    end;
    v_amount := case
      when replace(coalesce(v_row->>'Amount',''), ',', '.') ~ '^[-]?[0-9]+([.][0-9]+)?$'
        then replace(v_row->>'Amount', ',', '.')::numeric
      else null
    end;

    if v_patient_external_id is null or v_due_date is null or v_amount is null or v_amount <= 0 then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select min(i.id), count(*)::integer
    into v_installment_id, v_candidates
    from public.patient_units pu
    join public.payment_plans pp
      on pp.patient_unit_id = pu.id
     and pp.unit_id = pu.unit_id
     and pp.archived_at is null
     and pp.source = 'clinicorp'
    join public.installments i
      on i.payment_plan_id = pp.id
     and i.unit_id = pp.unit_id
     and i.source = 'clinicorp'
    join public.collection_cases cc
      on cc.installment_id = i.id
     and cc.unit_id = i.unit_id
     and cc.status not in ('paid','closed')
    where pu.unit_id = p_unit_id
      and pu.is_active
      and pu.clinicorp_patient_id = v_patient_external_id
      and i.due_date = v_due_date
      and abs(i.expected_amount - v_amount) < 0.02
      and i.status not in ('paid','cancelled','refunded');

    if v_candidates = 0 then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v_candidates > 1 then
      v_ambiguous := v_ambiguous + 1;
      continue;
    end if;

    if v_cancelled then
      update public.installments i
      set status = 'cancelled',
          clinicorp_source_state = 'cancelled',
          last_synced_at = now(),
          metadata = coalesce(i.metadata,'{}'::jsonb)
            || jsonb_build_object(
              'clinicorp_cancelled_at', now(),
              'clinicorp_cancelled_raw_id', nullif(v_row->>'id','')
            ),
          updated_at = now()
      where i.id = v_installment_id;
      v_cancelled_count := v_cancelled_count + 1;
    else
      update public.installments i
      set paid_amount = greatest(coalesce(i.paid_amount,0), i.expected_amount),
          status = 'paid',
          clinicorp_source_state = 'paid',
          paid_at = coalesce(
            case when nullif(v_row->>'ReceivedDate','') is not null then (v_row->>'ReceivedDate')::timestamptz end,
            case when nullif(v_row->>'PaymentDate','') is not null then (v_row->>'PaymentDate')::timestamptz end,
            case when nullif(v_row->>'ConfirmedDate','') is not null then (v_row->>'ConfirmedDate')::timestamptz end,
            i.paid_at,
            now()
          ),
          confirmed_at = coalesce(
            case when nullif(v_row->>'ConfirmedDate','') is not null then (v_row->>'ConfirmedDate')::timestamptz end,
            i.confirmed_at
          ),
          last_synced_at = now(),
          metadata = coalesce(i.metadata,'{}'::jsonb)
            || jsonb_build_object('payment_incremental_reconciled_at', now()),
          updated_at = now()
      where i.id = v_installment_id;
      v_paid_count := v_paid_count + 1;
    end if;

    v_updated := v_updated + 1;
  end loop;

  return query
  select v_processed, v_paid_count, v_cancelled_count, v_updated, v_ambiguous, v_skipped;
end;
$function$;

revoke all on function public.reconcile_clinicorp_terminal_rows(bigint,jsonb) from public;
revoke all on function public.reconcile_clinicorp_terminal_rows(bigint,jsonb) from anon;
revoke all on function public.reconcile_clinicorp_terminal_rows(bigint,jsonb) from authenticated;
grant execute on function public.reconcile_clinicorp_terminal_rows(bigint,jsonb) to service_role;
