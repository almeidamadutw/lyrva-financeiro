-- Read-only regression for the financial task policy and notification queries.
begin;
set local statement_timeout = '15s';

do $scope$
declare
  v_subject record;
  v_units bigint[];
  v_expected text;
  v_actual text;
  v_expected_count bigint;
  v_actual_count bigint;
begin
  for v_subject in
    select user_id from public.profiles
    union all
    select '00000000-0000-0000-0000-000000000000'::uuid
    union all
    select null::uuid
  loop
    perform set_config('request.jwt.claim.sub', coalesce(v_subject.user_id::text, ''), true);
    perform set_config('request.jwt.claims',
      case when v_subject.user_id is null then '{}' else jsonb_build_object('sub', v_subject.user_id, 'role', 'authenticated')::text end,
      true);
    -- The former policy grants task reads exactly when has_unit_access is true.
    select array_agg(u.id) into v_units from public.units u where private.has_unit_access(u.id);
    select count(*), md5(string_agg(t.id::text, ',' order by t.id))
      into v_expected_count, v_expected
    from public.financial_tasks t where t.unit_id = any(v_units);

    execute 'set local role authenticated';
    select count(*), md5(string_agg(t.id::text, ',' order by t.id))
      into v_actual_count, v_actual
    from public.financial_tasks t;
    assert v_actual_count = v_expected_count, 'Task count differs from allowed unit membership';
    assert v_actual is not distinct from v_expected, 'Task identities differ from allowed unit membership';
    execute 'reset role';
  end loop;

  assert not has_table_privilege('anon', 'public.financial_tasks', 'select'), 'Anonymous task read access';
  assert has_function_privilege('authenticated',
    'public.get_collection_queue_filtered(text,integer,integer,date,date,integer,integer)', 'execute'),
    'Collection RPC access lost';
  assert not has_function_privilege('anon',
    'public.get_collection_queue_filtered(text,integer,integer,date,date,integer,integer)', 'execute'),
    'Anonymous collection RPC access';
end;
$scope$;

rollback;
select 'Task scope matches unit access for every profile, unknown user and missing identity.' as result;
