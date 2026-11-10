-- Read only the selected case while the existing Clinicorp worker verifies its source data.
create function private.get_clinicorp_case_verification(p_case_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_case record;
begin
  if auth.uid() is null or not private.current_user_active() then
    raise exception using errcode = '42501', message = 'Entre no LYVRA.';
  end if;

  select
    cc.status as case_status,
    i.source,
    i.status as installment_status,
    i.clinicorp_source_state,
    i.expected_amount,
    i.due_date,
    s.posting_day,
    s.source_presence_checked_at
  into v_case
  from public.collection_cases cc
  join public.installments i on i.id = cc.installment_id and i.unit_id = cc.unit_id
  left join public.clinicorp_payment_snapshot s
    on s.unit_id = i.unit_id and s.clinicorp_payment_id = i.clinicorp_installment_id
  where cc.id = p_case_id and private.has_unit_access(cc.unit_id);

  if not found then
    raise exception using errcode = '42501', message = 'Caso indisponível para este acesso.';
  end if;

  if v_case.case_status in ('paid', 'closed')
    or v_case.installment_status in ('paid', 'cancelled', 'refunded')
    or v_case.source is distinct from 'clinicorp'
    or v_case.clinicorp_source_state is distinct from 'open' then
    return jsonb_build_object('state', 'closed');
  end if;

  if private.is_clinicorp_case_verified(p_case_id, interval '5 minutes') then
    return jsonb_build_object(
      'state', 'ready',
      'open_amount', v_case.expected_amount,
      'due_date', v_case.due_date,
      'valid_for_ms', floor(extract(epoch from (v_case.source_presence_checked_at + interval '5 minutes' - now())) * 1000)
    );
  end if;

  if v_case.posting_day is null then
    return jsonb_build_object('state', 'missing_reference');
  end if;

  return jsonb_build_object('state', 'pending');
end;
$function$;

revoke all on function private.get_clinicorp_case_verification(bigint) from public, anon, authenticated;
grant execute on function private.get_clinicorp_case_verification(bigint) to authenticated;

create function public.get_clinicorp_case_verification(p_case_id bigint)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select private.get_clinicorp_case_verification(p_case_id);
$function$;

revoke all on function public.get_clinicorp_case_verification(bigint) from public, anon, authenticated;
grant execute on function public.get_clinicorp_case_verification(bigint) to authenticated;
