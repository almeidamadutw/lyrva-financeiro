drop policy if exists financial_tasks_select_for_members on public.financial_tasks;
create policy financial_tasks_select_for_members
on public.financial_tasks
for select
to authenticated
using (
  (select private.has_unit_access(financial_tasks.unit_id))
  and (
    financial_tasks.kind not in ('collection_call','payment_promise')
    or (select private.current_user_can_manage_collections(financial_tasks.unit_id))
  )
);

drop policy if exists financial_tasks_insert_for_members on public.financial_tasks;
create policy financial_tasks_insert_for_members
on public.financial_tasks
for insert
to authenticated
with check (
  (select private.has_unit_access(financial_tasks.unit_id))
  and (
    financial_tasks.kind not in ('collection_call','payment_promise')
    or (select private.current_user_can_manage_collections(financial_tasks.unit_id))
  )
);

drop policy if exists financial_tasks_update_for_members on public.financial_tasks;
create policy financial_tasks_update_for_members
on public.financial_tasks
for update
to authenticated
using (
  (select private.has_unit_access(financial_tasks.unit_id))
  and (
    financial_tasks.kind not in ('collection_call','payment_promise')
    or (select private.current_user_can_manage_collections(financial_tasks.unit_id))
  )
)
with check (
  (select private.has_unit_access(financial_tasks.unit_id))
  and (
    financial_tasks.kind not in ('collection_call','payment_promise')
    or (select private.current_user_can_manage_collections(financial_tasks.unit_id))
  )
);
