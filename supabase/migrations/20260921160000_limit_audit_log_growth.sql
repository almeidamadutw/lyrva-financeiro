-- Keep the technical audit trail useful without allowing it to fill the database.

create or replace function private.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_before jsonb;
  row_after jsonb;
  row_for_identity jsonb;
  audit_unit_id bigint;
  audit_record_id text;
begin
  -- Synchronizations frequently touch updated_at even when no business field changes.
  -- Those timestamp-only updates do not add useful audit information.
  if tg_op = 'UPDATE'
     and (to_jsonb(old) - 'updated_at') is not distinct from (to_jsonb(new) - 'updated_at') then
    return new;
  end if;

  row_before := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  row_after := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  row_for_identity := coalesce(row_after, row_before, '{}'::jsonb);

  if coalesce(row_for_identity ->> 'unit_id', '') ~ '^[0-9]+$' then
    audit_unit_id := (row_for_identity ->> 'unit_id')::bigint;
  end if;

  audit_record_id := coalesce(
    row_for_identity ->> 'id',
    row_for_identity ->> 'user_id',
    row_for_identity ->> 'patient_id'
  );

  insert into public.audit_logs (
    actor_user_id,
    unit_id,
    table_name,
    record_id,
    action,
    old_data,
    new_data
  ) values (
    (select auth.uid()),
    audit_unit_id,
    tg_table_name,
    audit_record_id,
    tg_op,
    row_before,
    row_after
  );

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

do $$
declare
  existing_job_id bigint;
begin
  select jobid
  into existing_job_id
  from cron.job
  where jobname = 'prune-lyrva-audit-logs';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'prune-lyrva-audit-logs',
    '15 3 * * *',
    $cron$delete from public.audit_logs where occurred_at < now() - interval '7 days'$cron$
  );
end;
$$;
