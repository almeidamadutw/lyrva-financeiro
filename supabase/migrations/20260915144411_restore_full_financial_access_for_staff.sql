create or replace function private.current_user_can_edit_any_financial_setup()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = (select auth.uid())
      and p.is_active
      and p.role <> 'suporte'
  );
$$;

create or replace function private.current_user_can_edit_financial_setup(target_unit_id bigint)
returns boolean
language sql
stable
security definer
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
        and p.role <> 'suporte'
        and u.is_active
        and pu.unit_id = target_unit_id
    )
  end;
$$;

create or replace function private.current_user_can_manage_collections(target_unit_id bigint)
returns boolean
language sql
stable
security definer
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
        and p.role <> 'suporte'
    )
  end;
$$;

create or replace function private.current_user_can_access_task(target_unit_id bigint, target_kind text, target_assigned_to uuid)
returns boolean
language sql
stable
security definer
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
        and p.role <> 'suporte'
    )
  end;
$$;
