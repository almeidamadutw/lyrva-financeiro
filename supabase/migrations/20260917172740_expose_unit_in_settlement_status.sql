drop view if exists public.patient_settlement_status;

create view public.patient_settlement_status with (security_invoker=true) as
select
  pu.patient_id,
  pu.id as patient_unit_id,
  pu.unit_id,
  u.code as unit_code,
  u.name as unit_name,
  case
    when p.settled_at is not null then 'settled'
    when req.id is not null then 'requested'
    else 'open'
  end as settlement_state,
  req.id as settlement_request_id,
  req.payment_plan_id,
  req.requested_at,
  req.clinicorp_url,
  p.settled_at,
  p.settled_reason
from public.patient_units pu
join public.patients p on p.id=pu.patient_id
join public.units u on u.id=pu.unit_id
left join lateral (
  select r.id,r.payment_plan_id,r.requested_at,r.clinicorp_url
  from public.clinicorp_settlement_requests r
  where r.patient_unit_id=pu.id and r.status='requested'
  order by r.requested_at desc,r.id desc
  limit 1
) req on true;

grant select on public.patient_settlement_status to authenticated;
