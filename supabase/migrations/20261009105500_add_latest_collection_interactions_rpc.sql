-- Parte 3: carregar somente a última interação necessária para cada caso da Régua.

create or replace function public.get_collection_latest_interactions(
  p_case_ids bigint[]
)
returns table(
  id bigint,
  collection_case_id bigint,
  performed_by uuid,
  channel text,
  outcome text,
  notes text,
  occurred_at timestamptz,
  next_action_at timestamptz
)
language sql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
  with requested as (
    select distinct unnest(coalesce(p_case_ids, '{}'::bigint[])) as id
  ),
  allowed as (
    select cc.id
    from requested r
    join public.collection_cases cc on cc.id = r.id
    where private.has_unit_access(cc.unit_id)
  )
  select distinct on (ci.collection_case_id)
    ci.id,
    ci.collection_case_id,
    ci.performed_by,
    ci.channel,
    ci.outcome,
    ci.notes,
    ci.occurred_at,
    ci.next_action_at
  from public.collection_interactions ci
  join allowed a on a.id = ci.collection_case_id
  order by ci.collection_case_id, ci.occurred_at desc, ci.id desc;
$function$;

revoke all on function public.get_collection_latest_interactions(bigint[]) from public;
revoke all on function public.get_collection_latest_interactions(bigint[]) from anon;
grant execute on function public.get_collection_latest_interactions(bigint[]) to authenticated;
