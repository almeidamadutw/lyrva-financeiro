create or replace function public.get_clinicorp_superseded_recovery_ids(
  p_unit_id bigint,
  p_post_date date
)
returns table(clinicorp_installment_id text)
language sql
stable
security definer
set search_path=''
set statement_timeout='5s'
as $function$
  select distinct i.clinicorp_installment_id
  from public.installments i
  join public.clinicorp_payment_snapshot cps
    on cps.unit_id=i.unit_id
   and cps.clinicorp_payment_id=i.clinicorp_installment_id
  where i.unit_id=p_unit_id
    and i.source='clinicorp'
    and i.clinicorp_source_state='missing'
    and coalesce(i.metadata->>'clinicorp_superseded','false')='true'
    and i.clinicorp_installment_id is not null
    and substring(coalesce(cps.raw->>'PostDate','') from 1 for 10)=p_post_date::text;
$function$;

revoke all on function public.get_clinicorp_superseded_recovery_ids(bigint,date) from public,anon,authenticated;
grant execute on function public.get_clinicorp_superseded_recovery_ids(bigint,date) to service_role;

create or replace function public.restore_clinicorp_superseded_rows(
  p_unit_id bigint,
  p_rows jsonb
)
returns table(processed_count integer, restored_count integer, terminal_count integer, skipped_count integer)
language plpgsql
security definer
set search_path=''
set statement_timeout='15s'
as $function$
declare
  v_row jsonb;
  v_id text;
  v_form text;
  v_paid boolean;
  v_cancelled boolean;
  v_installment_id bigint;
  v_processed integer:=0;
  v_restored integer:=0;
  v_terminal integer:=0;
  v_skipped integer:=0;
begin
  if coalesce((select auth.jwt()->>'role'),'')<>'service_role' then
    raise exception using errcode='42501',message='Rotina exclusiva da integração do LYVRA.';
  end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' then
    raise exception using errcode='22023',message='A recuperação precisa receber uma lista JSON.';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_processed:=v_processed+1;
    v_id:=nullif(btrim(coalesce(v_row->>'id','')),'');
    if v_id is null then
      v_skipped:=v_skipped+1;
      continue;
    end if;

    select i.id into v_installment_id
    from public.installments i
    where i.unit_id=p_unit_id
      and i.source='clinicorp'
      and i.clinicorp_installment_id=v_id
      and i.clinicorp_source_state='missing'
      and coalesce(i.metadata->>'clinicorp_superseded','false')='true'
    limit 1;

    if v_installment_id is null then
      v_skipped:=v_skipped+1;
      continue;
    end if;

    v_cancelled :=
      upper(coalesce(v_row->>'Canceled',''))='X'
      or upper(coalesce(v_row->>'CancelInstallment',''))='X'
      or upper(coalesce(v_row->>'ExternalStatus','')) in ('CANCELED','CANCELLED');
    v_paid :=
      not v_cancelled and (
        upper(coalesce(v_row->>'PaymentReceived',''))='X'
        or upper(coalesce(v_row->>'PaymentConfirmed',''))='X'
      );
    v_form:=private.normalize_match_text(coalesce(v_row->>'PaymentForm',''));

    if v_paid then
      update public.installments
      set paid_amount=greatest(coalesce(paid_amount,0),expected_amount),
          status='paid',
          clinicorp_source_state='paid',
          last_synced_at=now(),
          metadata=(coalesce(metadata,'{}'::jsonb)
            - 'clinicorp_superseded'
            - 'clinicorp_superseded_detected_at'
            - 'clinicorp_source_reason')
            || jsonb_build_object('clinicorp_recovery_checked_at',now()),
          updated_at=now()
      where id=v_installment_id;
      v_terminal:=v_terminal+1;
    elsif v_cancelled then
      update public.installments
      set status='cancelled',
          clinicorp_source_state='cancelled',
          last_synced_at=now(),
          metadata=(coalesce(metadata,'{}'::jsonb)
            - 'clinicorp_superseded'
            - 'clinicorp_superseded_detected_at'
            - 'clinicorp_source_reason')
            || jsonb_build_object('clinicorp_recovery_checked_at',now()),
          updated_at=now()
      where id=v_installment_id;
      v_terminal:=v_terminal+1;
    elsif v_form like '%boleto%' then
      update public.installments
      set clinicorp_source_state='open',
          last_synced_at=now(),
          metadata=(coalesce(metadata,'{}'::jsonb)
            - 'clinicorp_superseded'
            - 'clinicorp_superseded_detected_at'
            - 'clinicorp_source_reason')
            || jsonb_build_object(
              'clinicorp_restored_after_exact_source_check',true,
              'clinicorp_restored_at',now()
            ),
          updated_at=now()
      where id=v_installment_id;
      update public.clinicorp_payment_snapshot
      set source_presence='present',source_presence_checked_at=now()
      where unit_id=p_unit_id and clinicorp_payment_id=v_id;
      v_restored:=v_restored+1;
    else
      v_skipped:=v_skipped+1;
    end if;

    v_installment_id:=null;
  end loop;

  return query select v_processed,v_restored,v_terminal,v_skipped;
end;
$function$;

revoke all on function public.restore_clinicorp_superseded_rows(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.restore_clinicorp_superseded_rows(bigint,jsonb) to service_role;
