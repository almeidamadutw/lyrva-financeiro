-- Delegação das diárias para perfis operacionais sem acesso às demais rotinas financeiras.
create function private.get_professional_pay_units()
returns table (id bigint, code text, name text)
language sql stable security definer
set search_path = ''
as $$
  select u.id, u.code, u.name
  from public.profiles p
  join public.profile_units pu on pu.user_id = p.user_id
  join public.units u on u.id = pu.unit_id
  where p.user_id = (select auth.uid()) and p.is_active and u.is_active
    and (p.role in ('gestora', 'ceo') or exists (
      select 1 from private.professional_pay_operators o
      where o.user_id = p.user_id and o.unit_id = u.id
    ))
  order by u.name;
$$;

create or replace function private.can_manage_professional_pay(p_unit_id bigint)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.get_professional_pay_units() u where u.id = p_unit_id
  );
$$;

create or replace function public.get_professional_pay_units()
returns table (id bigint, code text, name text)
language sql stable
set search_path = ''
as $$
  select * from private.get_professional_pay_units();
$$;

revoke all on function private.get_professional_pay_units() from public, anon, authenticated;
grant execute on function private.get_professional_pay_units() to authenticated;
