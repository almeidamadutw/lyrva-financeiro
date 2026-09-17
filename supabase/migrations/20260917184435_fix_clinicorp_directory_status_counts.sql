create or replace view public.clinicorp_directory_status
with (security_invoker=true)
as
select
  u.id as unit_id,
  u.code as unit_code,
  u.name as unit_name,
  coalesce(r.source_records,0) as source_records,
  coalesce(r.linked_patients,0) as linked_patients,
  coalesce(r.review_records,0) as review_records,
  r.last_seen_at,
  coalesce(p.patient_links,0) as patient_links
from public.units u
left join lateral (
  select
    count(*) as source_records,
    count(distinct sr.patient_id) filter (where sr.link_status='linked') as linked_patients,
    count(*) filter (where sr.link_status in ('review','invalid','conflict')) as review_records,
    max(sr.last_seen_at) as last_seen_at
  from public.integration_source_records sr
  where sr.unit_id=u.id and sr.provider='clinicorp'
) r on true
left join lateral (
  select count(*) as patient_links
  from public.patient_units pu
  where pu.unit_id=u.id and pu.is_active and pu.clinicorp_patient_id is not null
) p on true;

grant select on public.clinicorp_directory_status to authenticated;