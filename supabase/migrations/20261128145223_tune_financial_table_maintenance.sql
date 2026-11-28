-- Apply these settings only to tables accumulating dead tuples well before
-- the project-wide autovacuum threshold. No business records are changed.
set local lock_timeout = '2s';

alter table public.financial_tasks set (
  autovacuum_vacuum_scale_factor = 0.10,
  autovacuum_analyze_scale_factor = 0.05
);

alter table public.collection_cases set (
  autovacuum_vacuum_scale_factor = 0.10,
  autovacuum_analyze_scale_factor = 0.05
);

alter policy integration_source_records_read on public.integration_source_records
  using (
    (select private.current_user_is_financial_staff())
    and (
      (unit_id is not null and private.has_unit_access(unit_id))
      or (unit_id is null and created_by = (select auth.uid()))
    )
  );
