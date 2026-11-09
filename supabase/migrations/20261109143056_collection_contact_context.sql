create function public.get_collection_contact_context(p_case_ids bigint[])
returns table(
  collection_case_id bigint,
  latest_interaction jsonb,
  last_action_outcome text,
  last_action_next_at timestamptz,
  has_patient_contact boolean,
  patient_contact_outcome text
)
language sql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
  with requested as (
    select distinct unnest(p_case_ids[1:500]) as id
  ), allowed as materialized (
    select cc.id, cc.unit_id, cc.patient_unit_id
    from requested r
    join public.collection_cases cc on cc.id = r.id
    where private.has_unit_access(cc.unit_id)
  ), patient_units as (
    select distinct a.unit_id, a.patient_unit_id from allowed a
  ), open_case_actions as materialized (
    select cc.id, cc.unit_id, cc.patient_unit_id, cc.status, cc.updated_at,
           action.id as interaction_id, action.outcome, action.occurred_at, action.next_action_at
    from patient_units pu
    join public.collection_cases cc using (unit_id, patient_unit_id)
    join public.installments i on i.id = cc.installment_id and i.unit_id = cc.unit_id
    join public.payment_plans pp on pp.id = i.payment_plan_id and pp.unit_id = i.unit_id
    left join lateral (
      select ci.id, ci.outcome, ci.occurred_at, ci.next_action_at
      from public.collection_interactions ci
      where ci.collection_case_id = cc.id and ci.unit_id = cc.unit_id
        and (ci.outcome <> 'note' or ci.channel <> 'system')
      order by ci.occurred_at desc, ci.id desc
      limit 1
    ) action on true
    where cc.status not in ('paid', 'closed')
      and cc.eligible_at <= (now() at time zone 'America/Sao_Paulo')::date
      and pp.source = 'clinicorp' and pp.archived_at is null and pp.status = 'active'
      and (pp.payment_method = 'boleto' or private.clinicorp_verified_open_boleto_installment(i.id))
      and i.source = 'clinicorp' and i.clinicorp_source_state = 'open'
      and i.status not in ('paid', 'cancelled', 'refunded') and i.expected_amount > i.paid_amount
  ), patient_contact as (
    select distinct on (a.unit_id, a.patient_unit_id) a.unit_id, a.patient_unit_id, a.status, a.outcome
    from open_case_actions a
    where a.interaction_id is not null or a.status <> 'pending_contact'
    order by a.unit_id, a.patient_unit_id, a.occurred_at desc nulls last,
             a.interaction_id desc nulls last, a.updated_at desc, a.id desc
  )
  select a.id, to_jsonb(latest), action.outcome, action.next_action_at,
         pc.patient_unit_id is not null,
         case when pc.status <> 'protested' then pc.outcome end
  from allowed a
  left join public.get_collection_latest_interactions(p_case_ids[1:500]) latest
    on latest.collection_case_id = a.id
  left join open_case_actions action on action.id = a.id
  left join patient_contact pc on pc.unit_id = a.unit_id and pc.patient_unit_id = a.patient_unit_id;
$function$;

revoke all on function public.get_collection_contact_context(bigint[]) from public, anon;
grant execute on function public.get_collection_contact_context(bigint[]) to authenticated;
