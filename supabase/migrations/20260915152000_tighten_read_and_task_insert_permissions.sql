drop policy if exists import_runs_select_for_members on public.import_runs;
create policy import_runs_select_for_financial_setup on public.import_runs for select
to authenticated using (private.current_user_can_edit_financial_setup(unit_id));

drop policy if exists import_rows_select_for_members on public.import_rows;
create policy import_rows_select_for_financial_setup on public.import_rows for select
to authenticated using (private.current_user_can_edit_financial_setup(unit_id));

drop policy if exists invoice_obligations_select_for_members on public.invoice_obligations;
create policy invoice_obligations_select_for_financial_setup on public.invoice_obligations for select
to authenticated using (private.current_user_can_edit_financial_setup(unit_id));

drop policy if exists payments_select_for_members on public.payments;
create policy payments_select_for_financial_setup on public.payments for select
to authenticated using (private.current_user_can_edit_financial_setup(unit_id));

drop policy if exists financial_tasks_insert_for_members on public.financial_tasks;
create policy financial_tasks_insert_for_operational_staff on public.financial_tasks for insert
to authenticated with check (
  private.current_user_can_edit_financial_setup(unit_id)
  or private.current_user_can_manage_collections(unit_id)
);
