alter table public.professional_pay_profiles
  add column archived_at timestamptz;

create trigger professional_pay_profile_archive_audit
after update of archived_at on public.professional_pay_profiles
for each row when (old.archived_at is distinct from new.archived_at)
execute function private.write_audit_log();

create function private.set_professional_pay_profile_archived(p_unit_id bigint, p_professional_id bigint, p_archived boolean)
returns bigint
language plpgsql security definer
set search_path = ''
as $$
begin
  if private.can_manage_professional_pay(p_unit_id) is not true then
    raise exception 'Você não tem acesso às diárias desta unidade.' using errcode = '42501';
  end if;
  if p_archived is null then
    raise exception 'Informe se o profissional deve ser arquivado ou reativado.';
  end if;

  update public.professional_pay_profiles p
  set archived_at = case when p_archived then now() else null end
  where p.id = p_professional_id and p.unit_id = p_unit_id
    and (p.archived_at is null) = p_archived;

  if not found and not exists (
    select 1 from public.professional_pay_profiles p
    where p.id = p_professional_id and p.unit_id = p_unit_id
  ) then
    raise exception 'Profissional não encontrado nesta unidade.';
  end if;

  return p_professional_id;
end;
$$;

create function public.set_professional_pay_profile_archived(p_unit_id bigint, p_professional_id bigint, p_archived boolean)
returns bigint
language sql
set search_path = ''
as $$
  select private.set_professional_pay_profile_archived(p_unit_id, p_professional_id, p_archived);
$$;

create function private.prevent_attendance_for_archived_professional()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_archived_at timestamptz;
begin
  select p.archived_at into v_archived_at from public.professional_pay_profiles p
  where p.id = new.professional_id and p.unit_id = new.unit_id
  for share;

  if v_archived_at is not null then
    raise exception 'Reative o profissional para criar um novo lançamento.';
  end if;

  return new;
end;
$$;

create trigger professional_attendance_archived_profile_guard
before insert on public.professional_attendance
for each row execute function private.prevent_attendance_for_archived_professional();

revoke all on function private.prevent_attendance_for_archived_professional() from public, anon, authenticated;
revoke all on function private.set_professional_pay_profile_archived(bigint, bigint, boolean),
  public.set_professional_pay_profile_archived(bigint, bigint, boolean) from public, anon, authenticated;
grant execute on function private.set_professional_pay_profile_archived(bigint, bigint, boolean),
  public.set_professional_pay_profile_archived(bigint, bigint, boolean) to authenticated;
