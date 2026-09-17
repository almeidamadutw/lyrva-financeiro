revoke execute on function public.mark_patient_settled(bigint) from public, anon, authenticated;

create or replace function private.preserve_settled_patient()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.settled_at is null
     and new.settled_at is not null
     and coalesce(auth.role(),'') <> 'service_role' then
    raise exception using errcode='42501', message='A quitação precisa ser confirmada pelo Clinicorp antes de encerrar o paciente no LYVRA.';
  end if;

  if old.settled_at is not null and new.settled_at is not null then
    new.status := 'inactive';
    new.settled_at := old.settled_at;
    new.settled_by := old.settled_by;
    new.settled_reason := old.settled_reason;
  end if;
  return new;
end;
$$;
