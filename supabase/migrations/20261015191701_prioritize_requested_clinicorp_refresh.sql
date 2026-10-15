-- Honor a requested source refresh even after an earlier successful scan, preserving unit cooldowns and history fairness.
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
  select j.* into v_job from private.clinicorp_sync_days j
    left join private.clinicorp_sync_unit_limits limits on limits.unit_id=j.unit_id
    where (j.phase<>'fetch' or coalesce(limits.next_source_at,'-infinity'::timestamptz)<=clock_timestamp())
      and j.next_attempt_at<=now() and (j.status<>'working' or j.lease_until<=clock_timestamp())
    order by
      (j.phase<>'fetch' and j.status in ('working','retry')) desc,
      -- Every fifth claim reserves capacity for never-scanned history.
      (v_control.claims%5=4 and j.last_success_at is null) desc,
      case when j.last_success_at is null or j.last_success_at<now()-interval '12 hours'
        or j.refresh_requested_at>coalesce(j.observed_at,'-infinity'::timestamptz)
        or (j.priority>=300 and j.last_success_at<now()-interval '15 minutes')
        then j.priority else 0 end desc,
      (j.unit_id is distinct from v_control.last_unit_id) desc,
      j.last_success_at asc nulls first,j.next_attempt_at,j.id
    limit 1 for update of j skip locked;
  if not found then return null; end if;
  v_token:=gen_random_uuid();
  update private.clinicorp_sync_days set status='working',lease_token=v_token,lease_until=clock_timestamp()+interval '2 minutes',
    attempts=attempts+1,last_error=null,updated_at=now() where id=v_job.id;
  if v_job.phase='fetch' then
    insert into private.clinicorp_sync_unit_limits(unit_id,next_source_at)
      values(v_job.unit_id,clock_timestamp()+interval '30 seconds')
    on conflict(unit_id) do update set next_source_at=greatest(private.clinicorp_sync_unit_limits.next_source_at,excluded.next_source_at),updated_at=now();
  end if;
  update private.clinicorp_sync_control set last_unit_id=v_job.unit_id,claims=claims+1 where singleton;
  return jsonb_build_object('id',v_job.id,'unit_id',v_job.unit_id,'unit_code',(select code from public.units where id=v_job.unit_id),
    'posting_day',v_job.posting_day,'phase',v_job.phase,'lease_token',v_token,'cursor',v_job.apply_cursor,'returned_rows',v_job.returned_rows);
end; $function$;
