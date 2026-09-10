-- Centraliza criação e recuperação de acessos nas caixas de cada unidade.

alter table public.units
  add column if not exists access_recovery_email text;

update public.units
set access_recovery_email = case code
  when 'sorocaba' then 'gestaocasalodonto@gmail.com'
  when 'salto_de_pirapora' then 'casalodontosalto@gmail.com'
end
where code in ('sorocaba', 'salto_de_pirapora');

alter table public.units
  add constraint units_access_recovery_email_check
  check (access_recovery_email is null or access_recovery_email = lower(access_recovery_email));

alter table public.staff_invitations
  add column if not exists username text,
  add column if not exists recovery_unit_id bigint references public.units(id) on delete restrict;

alter table public.profiles
  add column if not exists username text,
  add column if not exists recovery_unit_id bigint references public.units(id) on delete restrict;

create unique index if not exists staff_invitations_username_unique
  on public.staff_invitations (lower(username)) where username is not null;
create unique index if not exists profiles_username_unique
  on public.profiles (lower(username)) where username is not null;
create index if not exists staff_invitations_recovery_unit_idx
  on public.staff_invitations (recovery_unit_id) where recovery_unit_id is not null;
create index if not exists profiles_recovery_unit_idx
  on public.profiles (recovery_unit_id) where recovery_unit_id is not null;

alter table public.staff_invitations
  add constraint staff_invitations_username_check
  check (username is null or username ~ '^[a-z0-9][a-z0-9._-]{2,39}$');
alter table public.profiles
  add constraint profiles_username_check
  check (username is null or username ~ '^[a-z0-9][a-z0-9._-]{2,39}$');

create table public.access_management_events (
  id bigint generated always as identity primary key,
  action text not null check (action in ('invite', 'recovery', 'deactivate', 'reactivate')),
  target_user_id uuid references auth.users(id) on delete set null,
  target_username text not null,
  unit_id bigint not null references public.units(id) on delete restrict,
  requested_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index access_management_events_requested_by_idx on public.access_management_events(requested_by, created_at desc);
create index access_management_events_target_user_idx on public.access_management_events(target_user_id, created_at desc) where target_user_id is not null;
create index access_management_events_unit_idx on public.access_management_events(unit_id, created_at desc);

alter table public.access_management_events enable row level security;
alter table public.access_management_events force row level security;

create policy access_management_events_select_for_management
  on public.access_management_events for select to authenticated
  using (
    private.current_user_active()
    and private.can_view_management_data()
    and private.has_unit_access(unit_id)
  );

revoke all on public.access_management_events from public, anon, authenticated;
grant select on public.access_management_events to authenticated;
grant all on public.access_management_events to service_role;

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

  insert into public.profiles (user_id, email, full_name, role, username, recovery_unit_id, last_unit_id)
  values (
    new.id,
    lower(new.email),
    matched_invitation.full_name,
    matched_invitation.role,
    matched_invitation.username,
    matched_invitation.recovery_unit_id,
    matched_invitation.recovery_unit_id
  );

  insert into public.profile_units (user_id, unit_id)
  select new.id, invitation_unit.unit_id
  from public.staff_invitation_units invitation_unit
  where invitation_unit.invitation_id = matched_invitation.id;

  update public.staff_invitations
  set status = 'accepted', accepted_at = now(), accepted_user_id = new.id
  where id = matched_invitation.id;

  return new;
end;
$$;

revoke all on function private.handle_new_auth_user() from public, anon, authenticated;
grant execute on function private.handle_new_auth_user() to service_role;

-- The personal support mailbox already exists in Auth; never publish it in source.
update public.profiles set username = 'suporte' where role = 'suporte' and username is null;
update public.staff_invitations i set username = p.username
from public.profiles p where i.accepted_user_id = p.user_id and p.role = 'suporte';

-- All new grants go through the scoped access-admin service.
revoke insert, update, delete on public.staff_invitations from authenticated;
revoke select on public.staff_invitations from authenticated;
revoke insert, update, delete on public.staff_invitation_units from authenticated;
revoke select on public.staff_invitation_units from authenticated;
revoke insert, update, delete on public.profile_units from authenticated;

-- Management must not see the support owner's private mailbox.
drop policy profiles_select_own_or_management on public.profiles;
create policy profiles_select_own_or_management on public.profiles for select to authenticated using (
  user_id = (select auth.uid()) or (
    private.current_user_active() and private.can_view_management_data() and role <> 'suporte'
    and exists(select 1 from public.profile_units pu where pu.user_id = profiles.user_id and private.has_unit_access(pu.unit_id))
  )
);

create table private.access_attempts (
  key_hash text primary key,
  attempts integer not null default 1,
  window_started_at timestamptz not null default now()
);
alter table private.access_attempts enable row level security;
alter table private.access_attempts force row level security;
grant all on private.access_attempts to service_role;
create policy access_attempts_service on private.access_attempts for all to service_role using (true) with check (true);

create or replace function public.consume_access_attempt(p_key text, p_limit integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare attempt_count integer;
begin
  if length(p_key) <> 64 or p_limit not between 1 and 30 then return false; end if;
  delete from private.access_attempts where window_started_at < now() - interval '1 day';
  insert into private.access_attempts as current (key_hash, attempts, window_started_at)
  values (p_key, 1, now())
  on conflict (key_hash) do update set
    attempts = case when current.window_started_at < now() - interval '15 minutes' then 1 else current.attempts + 1 end,
    window_started_at = case when current.window_started_at < now() - interval '15 minutes' then now() else current.window_started_at end
  returning attempts into attempt_count;
  return attempt_count <= p_limit;
end; $$;
revoke all on function public.consume_access_attempt(text, integer) from public, anon, authenticated;
grant execute on function public.consume_access_attempt(text, integer) to service_role;

create or replace function public.access_session_active(p_session_id uuid, p_user_id uuid)
returns boolean language sql security invoker set search_path = '' as $$
  select exists(select 1 from auth.sessions where id = p_session_id and user_id = p_user_id);
$$;
revoke all on function public.access_session_active(uuid, uuid) from public, anon, authenticated;
grant execute on function public.access_session_active(uuid, uuid) to service_role;

-- This invoker-only service RPC needs only these two session columns.
grant select (id, user_id) on auth.sessions to service_role;
-- Retire unused invitations for the old, non-deliverable corporate addresses.
-- Staff are invited from the management screen with their chosen unit mailbox.
update public.staff_invitations set status = 'revoked', updated_at = now()
where status = 'pending' and username is null and email like '%@lyvrafinanceiro.com.br';
-- Display-only metadata for personalized authentication messages.
update auth.users u set raw_user_meta_data = coalesce(u.raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('username', p.username)
from public.profiles p where p.user_id = u.id and p.username is not null;
