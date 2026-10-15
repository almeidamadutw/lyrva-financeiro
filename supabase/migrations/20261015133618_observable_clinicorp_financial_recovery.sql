-- One bounded worker replaces overlapping historical financial scans.
create or replace function private.dispatch_clinicorp_financial_sync()
returns bigint language plpgsql security definer set search_path='' as $fn$
declare v_request bigint;
begin
 if not (select enabled from private.clinicorp_sync_control where singleton) then return null; end if;
 -- Keep new unpaid bills visible even when they do not appear in the receipt feed.
 insert into private.clinicorp_sync_days(unit_id,posting_day,priority)
 select u.id,d::date,300 from public.units u
 join public.integration_connections c on c.unit_id=u.id and c.provider='clinicorp' and c.status='connected'
 cross join lateral generate_series((now() at time zone 'America/Sao_Paulo')::date-1,
   (now() at time zone 'America/Sao_Paulo')::date,'1 day'::interval) d where u.is_active
 on conflict(unit_id,posting_day) do update set next_attempt_at=least(private.clinicorp_sync_days.next_attempt_at,now()),
   priority=greatest(private.clinicorp_sync_days.priority,300)
 where private.clinicorp_sync_days.last_success_at<now()-interval '15 minutes'
   and private.clinicorp_sync_days.status<>'working';
 if exists(select 1 from private.clinicorp_sync_days where status='working' and lease_until>clock_timestamp()) then return null; end if;
 if not exists(select 1 from private.clinicorp_sync_days where next_attempt_at<=now()
   and posting_day<=(now() at time zone 'America/Sao_Paulo')::date) then return null; end if;
 select net.http_post(url:='https://mzungwfjrhauyirmjvxi.supabase.co/functions/v1/clinicorp-financial-sync',
   headers:=jsonb_build_object('Content-Type','application/json','x-lyvra-cron-key',
     (select secret from public.system_secrets where key='clinicorp_auto_sync_key')),
   body:='{}'::jsonb,timeout_milliseconds:=60000) into v_request;
 return v_request;
end; $fn$;
revoke all on function private.dispatch_clinicorp_financial_sync() from public,anon,authenticated;

create or replace function public.get_clinicorp_sync_status(p_unit_code text default null)
returns jsonb language sql stable security definer set search_path='' set statement_timeout='5s' as $fn$
 select jsonb_build_object('enabled',(select enabled from private.clinicorp_sync_control where singleton),
   'checked_at',now(),'units',coalesce(jsonb_agg(to_jsonb(stats)),'[]'::jsonb)) from (
   select u.code,u.name,count(j.id) filter(where j.posting_day<=(now() at time zone 'America/Sao_Paulo')::date) total_days,
     count(j.id) filter(where j.last_success_at is not null) verified_days,
     count(j.id) filter(where j.status='retry') error_days,
     count(j.id) filter(where j.status='working') working_days,
     count(j.id) filter(where j.priority>=50 and j.last_success_at is null) pending_financial_days,
     max(j.last_success_at) last_verified_at,
     coalesce(sum(j.returned_rows) filter(where j.last_success_at is not null),0) verified_source_rows
   from public.units u left join private.clinicorp_sync_days j on j.unit_id=u.id
   where u.is_active and private.has_unit_access(u.id)
     and (p_unit_code is null or p_unit_code in ('','todas') or u.code=p_unit_code)
   group by u.id,u.code,u.name
 ) stats;
$fn$;
revoke all on function public.get_clinicorp_sync_status(text) from public,anon;
grant execute on function public.get_clinicorp_sync_status(text) to authenticated,service_role;

-- Missing source IDs and the current collection period are recovered first.
update private.clinicorp_sync_days j set priority=500
where exists(select 1 from public.clinicorp_payment_snapshot s
 where s.unit_id=j.unit_id and s.posting_day=j.posting_day and lower(s.payment_form) like '%boleto%'
   and s.amount>0 and not s.payment_received and not s.payment_confirmed and not s.cancelled
   and not exists(select 1 from public.installments i where i.unit_id=s.unit_id and i.clinicorp_installment_id=s.clinicorp_payment_id));
update private.clinicorp_sync_days j set priority=greatest(j.priority,400)
where exists(select 1 from public.clinicorp_payment_snapshot s where s.unit_id=j.unit_id and s.posting_day=j.posting_day
 and lower(s.payment_form) like '%boleto%' and s.due_date>=(date_trunc('month',now() at time zone 'America/Sao_Paulo')-interval '1 month')::date
 and s.due_date<=(now() at time zone 'America/Sao_Paulo')::date and s.amount>0
 and not s.payment_received and not s.payment_confirmed and not s.cancelled);

select cron.schedule('lyvra_clinicorp_financial_sync','30 seconds','select private.dispatch_clinicorp_financial_sync()');
do $cron$ declare job record; begin for job in select jobid from cron.job where jobname in ('lyvra_clinicorp_directory_sync','lyvra_clinicorp_collection_reconcile','lyvra_clinicorp_schedule_repair') loop perform cron.alter_job(job_id:=job.jobid,active:=false); end loop; end $cron$;
update private.clinicorp_sync_control set enabled=true where singleton;
