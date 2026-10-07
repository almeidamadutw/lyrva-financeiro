create index if not exists clinicorp_payment_snapshot_unit_postdate_idx
  on public.clinicorp_payment_snapshot(
    unit_id,
    (substring(coalesce(raw->>'PostDate','') from 1 for 10))
  );

create index if not exists installments_clinicorp_open_due_idx
  on public.installments(unit_id,due_date,clinicorp_installment_id)
  where source='clinicorp'
    and clinicorp_source_state='open'
    and status not in ('paid','cancelled','refunded');

create index if not exists collection_cases_open_installment_idx
  on public.collection_cases(unit_id,installment_id)
  where status not in ('paid','closed');
