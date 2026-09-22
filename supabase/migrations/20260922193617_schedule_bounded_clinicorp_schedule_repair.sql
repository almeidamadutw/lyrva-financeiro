
insert into public.clinicorp_schedule_repair_log(
  unit_id,post_date,last_repaired_at,row_count,attempts,last_error,updated_at
) values
((select id from public.units where code='sorocaba'),date '2025-03-10',now(),0,1,null,now()),
((select id from public.units where code='sorocaba'),date '2023-10-24',now(),0,1,null,now()),
((select id from public.units where code='sorocaba'),date '2025-03-21',now(),0,1,null,now()),
((select id from public.units where code='sorocaba'),date '2024-11-11',now(),0,1,null,now()),
((select id from public.units where code='sorocaba'),date '2026-06-10',now(),0,1,null,now()),
((select id from public.units where code='sorocaba'),date '2024-10-28',now(),0,1,null,now()),
((select id from public.units where code='sorocaba'),date '2024-10-31',now(),0,1,null,now()),
((select id from public.units where code='sorocaba'),date '2026-05-10',now(),0,1,null,now()),
((select id from public.units where code='sorocaba'),date '2025-03-13',now(),0,1,null,now()),
((select id from public.units where code='sorocaba'),date '2025-05-10',now(),0,1,null,now()),
((select id from public.units where code='sorocaba'),date '2025-03-24',now(),0,1,null,now()),
((select id from public.units where code='sorocaba'),date '2026-05-15',now(),0,1,null,now())
on conflict(unit_id,post_date) do update
set last_repaired_at=excluded.last_repaired_at,
    last_error=null,
    updated_at=excluded.updated_at;

do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='lyvra_clinicorp_schedule_repair' limit 1;
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule(
    'lyvra_clinicorp_schedule_repair',
    '3,13,23,33,43,53 * * * *',
    $cron$
      select net.http_post(
        url := 'https://mzungwfjrhauyirmjvxi.supabase.co/functions/v1/clinicorp-schedule-repair',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'x-lyvra-cron-key',(select secret from public.system_secrets where key='clinicorp_auto_sync_key')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      );
    $cron$
  );
end;
$$;
