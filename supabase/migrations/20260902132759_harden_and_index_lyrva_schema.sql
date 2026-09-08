-- Migração 20260902132759 — correções dos advisors após a migração inicial.

-- A função foi criada fora da migração da LYRVA. Ela é administrativa e não
-- deve ficar exposta pela Data API a visitantes ou usuários autenticados.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- Índices que cobrem integralmente as chaves estrangeiras compostas.
create index collection_cases_installment_unit_idx
  on public.collection_cases (installment_id, unit_id);
create index collection_cases_patient_unit_unit_idx
  on public.collection_cases (patient_unit_id, unit_id);
create index collection_interactions_case_unit_idx
  on public.collection_interactions (collection_case_id, unit_id);
create index collection_promises_case_unit_idx
  on public.collection_promises (collection_case_id, unit_id);
create index financial_tasks_collection_case_unit_idx
  on public.financial_tasks (collection_case_id, unit_id);
create index financial_tasks_installment_unit_idx
  on public.financial_tasks (installment_id, unit_id);
create index import_rows_run_unit_idx
  on public.import_rows (import_run_id, unit_id);
create index installments_payment_plan_unit_idx
  on public.installments (payment_plan_id, unit_id);
create index invoice_obligation_payments_obligation_unit_idx
  on public.invoice_obligation_payments (invoice_obligation_id, unit_id);
create index invoice_obligation_payments_payment_unit_idx
  on public.invoice_obligation_payments (payment_id, unit_id);
create index invoice_obligations_patient_unit_unit_idx
  on public.invoice_obligations (patient_unit_id, unit_id);
create index invoice_obligations_payment_plan_unit_idx
  on public.invoice_obligations (payment_plan_id, unit_id);
create index message_events_installment_unit_idx
  on public.message_events (installment_id, unit_id);
create index payment_events_installment_unit_idx
  on public.payment_events (installment_id, unit_id);
create index payment_events_payment_unit_idx
  on public.payment_events (payment_id, unit_id);
create index payment_plans_patient_unit_unit_idx
  on public.payment_plans (patient_unit_id, unit_id);
create index payments_installment_unit_idx
  on public.payments (installment_id, unit_id);

-- Evita políticas permissivas duplicadas no SELECT. A política de leitura
-- permanece única; as operações administrativas ficam separadas por comando.
drop policy profile_units_manage_access on public.profile_units;

create policy profile_units_insert_for_access_admins
  on public.profile_units for insert to authenticated
  with check ((select private.can_manage_access()));

create policy profile_units_update_for_access_admins
  on public.profile_units for update to authenticated
  using ((select private.can_manage_access()))
  with check ((select private.can_manage_access()));

create policy profile_units_delete_for_access_admins
  on public.profile_units for delete to authenticated
  using ((select private.can_manage_access()));

drop policy integration_connections_manage_for_access_admins
  on public.integration_connections;

create policy integration_connections_insert_for_access_admins
  on public.integration_connections for insert to authenticated
  with check (
    (select private.can_manage_access())
    and (unit_id is null or (select private.has_unit_access(unit_id)))
  );

create policy integration_connections_update_for_access_admins
  on public.integration_connections for update to authenticated
  using (
    (select private.can_manage_access())
    and (unit_id is null or (select private.has_unit_access(unit_id)))
  )
  with check (
    (select private.can_manage_access())
    and (unit_id is null or (select private.has_unit_access(unit_id)))
  );

create policy integration_connections_delete_for_access_admins
  on public.integration_connections for delete to authenticated
  using (
    (select private.can_manage_access())
    and (unit_id is null or (select private.has_unit_access(unit_id)))
  );
