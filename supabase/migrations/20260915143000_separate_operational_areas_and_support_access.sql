alter table public.profiles
  add column if not exists operational_area text not null default 'none';

alter table public.profiles
  drop constraint if exists profiles_operational_area_check;

alter table public.profiles
  add constraint profiles_operational_area_check
  check (operational_area in ('none','reminders','collections','invoices','management','support'));

update public.profiles
set operational_area = case
  when role = 'suporte' then 'support'
  when role in ('gestora','ceo') then 'management'
  when user_id in (
    select collection_assignee_user_id from public.units where collection_assignee_user_id is not null
  ) then 'collections'
  when user_id in (
    select payment_reminder_assignee_user_id from public.units where payment_reminder_assignee_user_id is not null
  ) then 'reminders'
  when username = 'thaina' then 'invoices'
  else operational_area
end;

create or replace function private.has_unit_access(target_unit_id bigint)
returns boolean
language sql
stable security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null then false
    else exists (
      select 1
      from public.profile_units pu
      join public.profiles p on p.user_id = pu.user_id
      join public.units u on u.id = pu.unit_id
      where pu.user_id = (select auth.uid())
        and pu.unit_id = target_unit_id
        and p.is_active
        and p.role <> 'suporte'
        and u.is_active
    )
  end;
$$;

create or replace function private.can_view_management_data()
returns boolean
language sql
stable security definer
set search_path = ''
as $$
  select coalesce((select private.current_user_role()) in ('gestora', 'ceo'), false);
$$;

create or replace function private.current_user_can_manage_collections(target_unit_id bigint)
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
      join public.profile_units pu
        on pu.user_id = p.user_id
       and pu.unit_id = target_unit_id
      join public.units u
        on u.id = target_unit_id
       and u.is_active
      where p.user_id = (select auth.uid())
        and p.is_active
        and (
          p.role in ('gestora','ceo')
          or u.collection_assignee_user_id = p.user_id
        )
    )
  end;
$$;

comment on column public.profiles.operational_area is
  'Área operacional usada para limitar menus e rotinas: reminders, collections, invoices, management, support ou none.';
