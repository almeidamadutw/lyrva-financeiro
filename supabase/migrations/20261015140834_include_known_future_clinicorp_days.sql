-- Cover the full calendar through today and every known source date, including future posting days.
CREATE OR REPLACE FUNCTION public.claim_clinicorp_sync_job()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_job private.clinicorp_sync_days%rowtype; v_control private.clinicorp_sync_control%rowtype; v_token uuid;
begin
  perform private.require_clinicorp_service();
  select * into v_control from private.clinicorp_sync_control where singleton for update;
  if not v_control.enabled then return null; end if;
  if exists(select 1 from private.clinicorp_sync_days where status='working' and lease_until>clock_timestamp()) then return null; end if;
  select * into v_job from private.clinicorp_sync_days j
    where j.next_attempt_at<=now() and (j.status<>'working' or j.lease_until<=clock_timestamp())
    order by
      (j.phase<>'fetch' and j.status in ('working','retry')) desc,
      -- Every fifth claim reserves capacity for never-scanned history.
      (v_control.claims%5=4 and j.last_success_at is null) desc,
      case when j.last_success_at is null or j.last_success_at<now()-interval '12 hours' then j.priority else 0 end desc,
      (j.unit_id is distinct from v_control.last_unit_id) desc,
      j.last_success_at asc nulls first,j.next_attempt_at,j.id
    limit 1 for update skip locked;
  if not found then return null; end if;
  v_token:=gen_random_uuid();
  update private.clinicorp_sync_days set status='working',lease_token=v_token,lease_until=clock_timestamp()+interval '2 minutes',
    attempts=attempts+1,last_error=null,updated_at=now() where id=v_job.id;
  update private.clinicorp_sync_control set last_unit_id=v_job.unit_id,claims=claims+1 where singleton;
  return jsonb_build_object('id',v_job.id,'unit_id',v_job.unit_id,'unit_code',(select code from public.units where id=v_job.unit_id),
    'posting_day',v_job.posting_day,'phase',v_job.phase,'lease_token',v_token,'cursor',v_job.apply_cursor,'returned_rows',v_job.returned_rows);
end; $function$;

CREATE OR REPLACE FUNCTION public.get_clinicorp_sync_status(p_unit_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '5s'
AS $function$
 select jsonb_build_object('enabled',(select enabled from private.clinicorp_sync_control where singleton),
   'checked_at',now(),'units',coalesce(jsonb_agg(to_jsonb(stats)),'[]'::jsonb)) from (
   select u.code,u.name,count(j.id) total_days,
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
$function$;

CREATE OR REPLACE FUNCTION private.dispatch_clinicorp_financial_sync()
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 if not exists(select 1 from private.clinicorp_sync_days where next_attempt_at<=now()) then return null; end if;
 select net.http_post(url:='https://mzungwfjrhauyirmjvxi.supabase.co/functions/v1/clinicorp-financial-sync',
   headers:=jsonb_build_object('Content-Type','application/json','x-lyvra-cron-key',
     (select secret from public.system_secrets where key='clinicorp_auto_sync_key')),
   body:='{}'::jsonb,timeout_milliseconds:=60000) into v_request;
 return v_request;
end; $function$;
