do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname='lyvra_clinicorp_directory_sync' limit 1;
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;

  perform cron.schedule(
    'lyvra_clinicorp_directory_sync',
    '7,22,37,52 * * * *',
    $cron$
    select net.http_post(
      url := 'https://mzungwfjrhauyirmjvxi.supabase.co/functions/v1/clinicorp-directory-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-lyvra-cron-key', (select secret from public.system_secrets where key = 'clinicorp_auto_sync_key')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
    $cron$
  );
end;
$$;