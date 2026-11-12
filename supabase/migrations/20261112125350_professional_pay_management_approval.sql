alter table public.professional_attendance
  add column approved_at timestamptz,
  add column approved_by uuid,
  add constraint professional_attendance_approval_pair
    check ((approved_at is null) = (approved_by is null)),
  add constraint professional_attendance_approval_status
    check (approved_at is null or status in ('validated', 'paid'));

create index professional_attendance_pending_approval_idx
  on public.professional_attendance (work_date, id)
  where status = 'validated' and approved_at is null;

-- Preserve historical payments and enforce the approval on new payment transitions.
create function private.enforce_professional_attendance_approval()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('pending', 'cancelled') then
    new.approved_at := null;
    new.approved_by := null;
  elsif new.status = 'paid' and old.status is distinct from 'paid' and new.approved_at is null then
    raise exception 'Aguarde a aprovação da diária antes de registrar o pagamento.';
  end if;
  return new;
end;
$$;

create trigger professional_attendance_approval_guard
before insert or update on public.professional_attendance
for each row execute function private.enforce_professional_attendance_approval();

create function public.get_pending_professional_pay_approvals(p_unit_code text default null, p_offset integer default 0)
returns table (
  id bigint, unit_id bigint, unit_name text, professional_id bigint, professional_name text,
  work_date date, service_kind text, amount_cents integer, notes text, priced_items jsonb, revision integer
)
language sql stable
set search_path = ''
as $$
  select a.id, a.unit_id, u.name, a.professional_id, p.name,
    a.work_date, a.service_kind, a.amount_cents, a.notes, a.priced_items, a.revision
  from public.professional_attendance a
  join public.professional_pay_profiles p on p.unit_id = a.unit_id and p.id = a.professional_id
  join public.units u on u.id = a.unit_id
  where (select private.current_user_role()) in ('gestora', 'ceo')
    and a.status = 'validated' and a.approved_at is null
    and (p_unit_code is null or u.code = p_unit_code)
  order by a.work_date, a.id
  limit 31 offset greatest(p_offset, 0);
$$;

create function private.approve_professional_attendance(p_unit_id bigint, p_attendance_id bigint, p_revision integer)
returns bigint
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_row public.professional_attendance%rowtype;
begin
  if private.current_user_role() in ('gestora', 'ceo') is not true
    or private.can_manage_professional_pay(p_unit_id) is not true then
    raise exception 'Você não tem acesso para aprovar diárias desta unidade.' using errcode = '42501';
  end if;

  -- Lock in the same order as the attendance and compensation rule RPCs.
  perform 1
  from public.professional_pay_profiles p
  join public.professional_attendance a on a.unit_id = p.unit_id and a.professional_id = p.id
  where a.unit_id = p_unit_id and a.id = p_attendance_id
  for update of p;

  update public.professional_attendance
  set approved_at = now(), approved_by = v_actor, updated_at = now(), updated_by = v_actor, revision = revision + 1
  where id = p_attendance_id and unit_id = p_unit_id and revision = p_revision
    and status = 'validated' and approved_at is null
  returning * into v_row;

  if not found then
    raise exception 'A diária mudou ou já foi aprovada. Atualize a fila.';
  end if;

  insert into public.professional_attendance_history (unit_id, attendance_id, actor_name, snapshot)
  select p_unit_id, v_row.id, full_name, to_jsonb(v_row) || '{"approval_event":"approved"}'::jsonb
  from public.profiles where user_id = v_actor;

  return v_row.id;
end;
$$;

create function public.approve_professional_attendance(p_unit_id bigint, p_attendance_id bigint, p_revision integer)
returns bigint
language sql
set search_path = ''
as $$
  select private.approve_professional_attendance(p_unit_id, p_attendance_id, p_revision);
$$;

revoke all on function private.enforce_professional_attendance_approval() from public, anon, authenticated;
revoke all on function public.get_pending_professional_pay_approvals(text, integer),
  private.approve_professional_attendance(bigint, bigint, integer),
  public.approve_professional_attendance(bigint, bigint, integer) from public, anon, authenticated;
grant execute on function public.get_pending_professional_pay_approvals(text, integer),
  private.approve_professional_attendance(bigint, bigint, integer),
  public.approve_professional_attendance(bigint, bigint, integer) to authenticated;
