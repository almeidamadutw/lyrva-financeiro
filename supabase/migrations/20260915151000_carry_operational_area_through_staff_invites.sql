alter table public.staff_invitations
  add column if not exists operational_area text not null default 'none';

alter table public.staff_invitations
  drop constraint if exists staff_invitations_operational_area_check;

alter table public.staff_invitations
  add constraint staff_invitations_operational_area_check
  check (operational_area in ('none','reminders','collections','invoices','management'));

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched_invitation public.staff_invitations%rowtype;
begin
  select invitation.* into matched_invitation
  from public.staff_invitations invitation
  where invitation.email = lower(new.email)
    and invitation.status = 'pending'
    and (invitation.expires_at is null or invitation.expires_at > now())
  for update;

  if matched_invitation.id is null then
    raise exception 'Este acesso não possui convite ativo.';
  end if;

  insert into public.profiles (
    user_id, email, full_name, role, username, recovery_unit_id, last_unit_id, operational_area
  ) values (
    new.id,
    lower(new.email),
    matched_invitation.full_name,
    matched_invitation.role,
    matched_invitation.username,
    matched_invitation.recovery_unit_id,
    matched_invitation.recovery_unit_id,
    case
      when matched_invitation.role in ('gestora','ceo') then 'management'
      else matched_invitation.operational_area
    end
  );

  insert into public.profile_units (user_id, unit_id)
  select new.id, invitation_unit.unit_id
  from public.staff_invitation_units invitation_unit
  where invitation_unit.invitation_id = matched_invitation.id;

  if matched_invitation.role = 'membro' and matched_invitation.operational_area = 'collections' then
    update public.units u
    set collection_assignee_user_id = new.id
    where u.id in (
      select iu.unit_id from public.staff_invitation_units iu
      where iu.invitation_id = matched_invitation.id
    );
  elsif matched_invitation.role = 'membro' and matched_invitation.operational_area = 'reminders' then
    update public.units u
    set payment_reminder_assignee_user_id = new.id
    where u.id in (
      select iu.unit_id from public.staff_invitation_units iu
      where iu.invitation_id = matched_invitation.id
    );
  end if;

  update public.staff_invitations
  set status = 'accepted', accepted_at = now(), accepted_user_id = new.id
  where id = matched_invitation.id;

  return new;
end;
$$;
