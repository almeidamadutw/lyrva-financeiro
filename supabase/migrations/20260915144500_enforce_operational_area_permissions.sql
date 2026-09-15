create or replace function private.current_user_operational_area()
returns text
language sql
stable security definer
set search_path = ''
as $$
  select p.operational_area
  from public.profiles p
  where p.user_id = (select auth.uid())
    and p.is_active
  limit 1;
$$;

create or replace function private.current_user_can_edit_financial_setup(target_unit_id bigint)
returns boolean
language sql
stable security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null then false
    else exists (
      select 1
      from public.profiles p
      join public.profile_units pu on pu.user_id = p.user_id
      join public.units u on u.id = pu.unit_id
      where p.user_id = (select auth.uid())
        and p.is_active
        and u.is_active
        and pu.unit_id = target_unit_id
        and (p.role in ('gestora','ceo') or p.operational_area = 'invoices')
    )
  end;
$$;

create or replace function private.current_user_can_edit_any_financial_setup()
returns boolean
language sql
stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = (select auth.uid())
      and p.is_active
      and (p.role in ('gestora','ceo') or p.operational_area = 'invoices')
  );
$$;

create or replace function private.current_user_can_access_task(
  target_unit_id bigint,
  target_kind text,
  target_assigned_to uuid
)
returns boolean
language sql
stable security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null then false
    else exists (
      select 1
      from public.profiles p
      join public.profile_units pu on pu.user_id = p.user_id and pu.unit_id = target_unit_id
      join public.units u on u.id = target_unit_id and u.is_active
      where p.user_id = (select auth.uid())
        and p.is_active
        and (
          p.role in ('gestora','ceo')
          or (
            p.operational_area = 'reminders'
            and target_kind = 'payment_reminder'
            and target_assigned_to = p.user_id
          )
          or (
            p.operational_area = 'collections'
            and target_kind in ('collection_call','payment_promise')
            and u.collection_assignee_user_id = p.user_id
          )
          or (
            p.operational_area = 'invoices'
            and target_kind = 'invoice'
          )
        )
    )
  end;
$$;

drop policy if exists import_runs_insert_for_members on public.import_runs;
create policy import_runs_insert_for_financial_setup on public.import_runs for insert
to authenticated with check (
  private.current_user_can_edit_financial_setup(unit_id)
  and created_by = (select auth.uid())
);

drop policy if exists import_runs_update_for_members on public.import_runs;
create policy import_runs_update_for_financial_setup on public.import_runs for update
to authenticated using (private.current_user_can_edit_financial_setup(unit_id))
with check (private.current_user_can_edit_financial_setup(unit_id));

drop policy if exists import_rows_insert_for_members on public.import_rows;
create policy import_rows_insert_for_financial_setup on public.import_rows for insert
to authenticated with check (private.current_user_can_edit_financial_setup(unit_id));

drop policy if exists import_rows_update_for_members on public.import_rows;
create policy import_rows_update_for_financial_setup on public.import_rows for update
to authenticated using (private.current_user_can_edit_financial_setup(unit_id))
with check (private.current_user_can_edit_financial_setup(unit_id));

drop policy if exists patient_units_insert_for_members on public.patient_units;
create policy patient_units_insert_for_financial_setup on public.patient_units for insert
to authenticated with check (private.current_user_can_edit_financial_setup(unit_id));

drop policy if exists patient_units_update_for_members on public.patient_units;
create policy patient_units_update_for_financial_setup on public.patient_units for update
to authenticated using (private.current_user_can_edit_financial_setup(unit_id))
with check (private.current_user_can_edit_financial_setup(unit_id));

drop policy if exists payment_plans_insert_for_members on public.payment_plans;
create policy payment_plans_insert_for_financial_setup on public.payment_plans for insert
to authenticated with check (private.current_user_can_edit_financial_setup(unit_id));

drop policy if exists payment_plans_update_for_members on public.payment_plans;
create policy payment_plans_update_for_financial_setup on public.payment_plans for update
to authenticated using (private.current_user_can_edit_financial_setup(unit_id))
with check (private.current_user_can_edit_financial_setup(unit_id));

drop policy if exists installments_insert_for_members on public.installments;
create policy installments_insert_for_financial_setup on public.installments for insert
to authenticated with check (private.current_user_can_edit_financial_setup(unit_id));

drop policy if exists installments_update_for_members on public.installments;
create policy installments_update_for_financial_setup on public.installments for update
to authenticated using (private.current_user_can_edit_financial_setup(unit_id))
with check (private.current_user_can_edit_financial_setup(unit_id));

drop policy if exists payments_insert_for_members on public.payments;
create policy payments_insert_for_financial_setup on public.payments for insert
to authenticated with check (private.current_user_can_edit_financial_setup(unit_id));

drop policy if exists payments_update_for_members on public.payments;
create policy payments_update_for_financial_setup on public.payments for update
to authenticated using (private.current_user_can_edit_financial_setup(unit_id))
with check (private.current_user_can_edit_financial_setup(unit_id));

drop policy if exists invoice_obligations_insert_for_members on public.invoice_obligations;
create policy invoice_obligations_insert_for_financial_setup on public.invoice_obligations for insert
to authenticated with check (private.current_user_can_edit_financial_setup(unit_id));

drop policy if exists invoice_obligations_update_for_members on public.invoice_obligations;
create policy invoice_obligations_update_for_financial_setup on public.invoice_obligations for update
to authenticated using (private.current_user_can_edit_financial_setup(unit_id))
with check (private.current_user_can_edit_financial_setup(unit_id));

drop policy if exists patients_insert_for_authorized_staff on public.patients;
create policy patients_insert_for_financial_setup on public.patients for insert
to authenticated with check (
  private.current_user_can_edit_any_financial_setup()
  and created_by = (select auth.uid())
);

drop policy if exists patients_update_for_authorized_staff on public.patients;
create policy patients_update_for_financial_setup on public.patients for update
to authenticated using (
  private.current_user_can_edit_any_financial_setup()
  and (private.has_patient_access(id) or created_by = (select auth.uid()))
)
with check (
  private.current_user_can_edit_any_financial_setup()
  and (private.has_patient_access(id) or created_by = (select auth.uid()))
);

drop policy if exists financial_tasks_select_for_members on public.financial_tasks;
create policy financial_tasks_select_by_operational_area on public.financial_tasks for select
to authenticated using (
  private.current_user_can_access_task(unit_id, kind, assigned_to)
);

drop policy if exists financial_tasks_update_for_members on public.financial_tasks;
create policy financial_tasks_update_by_operational_area on public.financial_tasks for update
to authenticated using (
  private.current_user_can_access_task(unit_id, kind, assigned_to)
)
with check (
  private.current_user_can_access_task(unit_id, kind, assigned_to)
);
