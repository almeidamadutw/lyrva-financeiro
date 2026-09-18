-- Clinicorp spells its successful status as "Autorized" and can also return
-- "ErrorAutorized". Error must win over the substring "Autorized".
-- Reconcile exact legacy obligations without deleting their audit trail.

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.ingest_clinicorp_invoices(bigint,jsonb,bigint)'::regprocedure)
  into v_definition;

  v_definition := replace(
    v_definition,
    $old$      v_status:=case
        when v_status_raw like '%autorized%' or v_status_raw like '%authorized%' or v_status_raw like '%autorizad%' then 'issued'
        when v_status_raw like '%cancel%' then 'cancelled'
        when v_status_raw like '%error%' then 'divergence'
        else 'open' end;$old$,
    $new$      v_status:=case
        when v_status_raw like '%error%' then 'divergence'
        when v_status_raw like '%autorized%' or v_status_raw like '%authorized%' or v_status_raw like '%autorizad%' then 'issued'
        when v_status_raw like '%cancel%' then 'cancelled'
        else 'open' end;$new$
  );

  v_definition := replace(
    v_definition,
    $old$      update private.clinicorp_inbox set status='applied',reason=null,applied_at=now(),last_seen_at=now() where unit_id=p_unit_id and entity_type='invoice' and external_id=v_external_id;$old$,
    $new$      update public.invoice_obligations existing set
        status='cancelled',
        completed_at=coalesce(existing.completed_at,now()),
        metadata=coalesce(existing.metadata,'{}'::jsonb)||jsonb_build_object(
          'replaced_by_clinicorp_invoice_id',v_external_id,
          'reconciled_at',now()
        ),
        updated_at=now()
      where existing.unit_id=p_unit_id
        and existing.patient_unit_id=v_patient_unit_id
        and existing.id<>v_obligation_id
        and existing.rule_code is distinct from 'clinicorp_invoice'
        and (
          existing.scheduled_issue_date=v_date
          or (existing.period_start<=v_date and existing.period_end>=v_date)
        )
        and abs(existing.expected_amount-v_amount)<=0.01;
      update private.clinicorp_inbox set status='applied',reason=null,applied_at=now(),last_seen_at=now() where unit_id=p_unit_id and entity_type='invoice' and external_id=v_external_id;$new$
  );

  execute v_definition;
end;
$$;

update public.invoice_obligations o
set
  status='divergence',
  completed_at=null,
  issued_amount=0,
  invoice_issued_at=null,
  metadata=coalesce(o.metadata,'{}'::jsonb)||jsonb_build_object('clinicorp_status_corrected_at',now()),
  updated_at=now()
where o.rule_code='clinicorp_invoice'
  and private.normalize_match_text(o.metadata->>'clinicorp_status') like '%error%';

with exact_duplicates as (
  select distinct on (existing.id)
    existing.id,
    ci.metadata->>'clinicorp_invoice_id' as clinicorp_invoice_id
  from public.invoice_obligations ci
  join public.invoice_obligations existing
    on existing.unit_id=ci.unit_id
   and existing.patient_unit_id=ci.patient_unit_id
   and existing.id<>ci.id
   and existing.rule_code is distinct from 'clinicorp_invoice'
   and (
     existing.scheduled_issue_date=ci.scheduled_issue_date
     or (existing.period_start<=ci.scheduled_issue_date and existing.period_end>=ci.scheduled_issue_date)
   )
   and abs(existing.expected_amount-ci.expected_amount)<=0.01
  where ci.rule_code='clinicorp_invoice'
  order by existing.id,ci.id
)
update public.invoice_obligations existing
set
  status='cancelled',
  completed_at=coalesce(existing.completed_at,now()),
  metadata=coalesce(existing.metadata,'{}'::jsonb)||jsonb_build_object(
    'replaced_by_clinicorp_invoice_id',d.clinicorp_invoice_id,
    'reconciled_at',now()
  ),
  updated_at=now()
from exact_duplicates d
where existing.id=d.id;

revoke all on function public.ingest_clinicorp_invoices(bigint,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.ingest_clinicorp_invoices(bigint,jsonb,bigint) to service_role;
