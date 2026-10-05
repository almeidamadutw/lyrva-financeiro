create or replace function public.get_overdue_boleto_counts(p_unit_code text default null)
returns table(
  unit_id bigint,
  patient_id bigint,
  overdue_count bigint,
  overdue_amount numeric
)
language sql
stable
security definer
set search_path = ''
as $function$
  with allowed_units as (
    select u.id
    from public.units u
    where u.is_active
      and private.has_unit_access(u.id)
      and (
        p_unit_code is null
        or p_unit_code = ''
        or p_unit_code = 'todas'
        or u.code = p_unit_code
      )
  )
  select
    pu.unit_id,
    pu.patient_id,
    count(i.id)::bigint as overdue_count,
    coalesce(sum(greatest(i.expected_amount - i.paid_amount, 0::numeric)), 0::numeric) as overdue_amount
  from public.patient_units pu
  join allowed_units au on au.id = pu.unit_id
  join public.payment_plans pp
    on pp.patient_unit_id = pu.id
   and pp.unit_id = pu.unit_id
  join public.installments i
    on i.payment_plan_id = pp.id
   and i.unit_id = pp.unit_id
  where pu.settled_at is null
    and pu.is_active
    and pu.clinicorp_patient_id is not null
    and pp.source = 'clinicorp'
    and pp.payment_method = 'boleto'
    and pp.archived_at is null
    and pp.status = 'active'
    and i.source = 'clinicorp'
    and i.clinicorp_source_state = 'open'
    and i.status not in ('paid', 'cancelled', 'refunded')
    and greatest(i.expected_amount - i.paid_amount, 0::numeric) > 0
    and i.due_date < (now() at time zone 'America/Sao_Paulo')::date
  group by pu.unit_id, pu.patient_id;
$function$;

revoke all on function public.get_overdue_boleto_counts(text) from public;
revoke all on function public.get_overdue_boleto_counts(text) from anon;
grant execute on function public.get_overdue_boleto_counts(text) to authenticated;
grant execute on function public.get_overdue_boleto_counts(text) to postgres;
