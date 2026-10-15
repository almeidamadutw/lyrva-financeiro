-- A source snapshot only certifies a collection amount when identity, money and state agree.
create or replace function private.is_clinicorp_case_verified(p_case_id bigint,p_max_age interval default null)
returns boolean language sql stable security definer set search_path='' as $fn$
 select exists(select 1 from public.collection_cases cc
 join public.installments i on i.id=cc.installment_id and i.unit_id=cc.unit_id
 join public.payment_plans pp on pp.id=i.payment_plan_id and pp.unit_id=i.unit_id
 join public.patient_units pu on pu.id=pp.patient_unit_id and pu.unit_id=i.unit_id
 join public.clinicorp_payment_snapshot s on s.unit_id=i.unit_id and s.clinicorp_payment_id=i.clinicorp_installment_id
 where cc.id=p_case_id and cc.status not in ('paid','closed') and i.source='clinicorp'
 and i.clinicorp_source_state='open' and i.status not in ('paid','cancelled','refunded') and i.paid_amount=0
 and s.source_presence='present' and s.amount=i.expected_amount and s.due_date=i.due_date
 and s.clinicorp_patient_id=pu.clinicorp_patient_id and not s.payment_received and not s.payment_confirmed and not s.cancelled
 and s.source_presence_checked_at>=(select seeded_at from private.clinicorp_sync_control where singleton)
 and (p_max_age is null or s.source_presence_checked_at>=now()-p_max_age));
$fn$;
revoke all on function private.is_clinicorp_case_verified(bigint,interval) from public,anon,authenticated;

create or replace function public.request_clinicorp_case_verification(p_case_id bigint)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_unit bigint; v_day date; v_job bigint;
begin
 if auth.uid() is null or not private.current_user_active() then raise exception using errcode='42501',message='Entre no LYVRA.'; end if;
 select cc.unit_id,s.posting_day into v_unit,v_day from public.collection_cases cc
 join public.installments i on i.id=cc.installment_id and i.unit_id=cc.unit_id
 left join public.clinicorp_payment_snapshot s on s.unit_id=i.unit_id and s.clinicorp_payment_id=i.clinicorp_installment_id
 where cc.id=p_case_id and private.has_unit_access(cc.unit_id);
 if v_unit is null then raise exception using errcode='42501',message='Caso indisponível para este acesso.'; end if;
 if private.is_clinicorp_case_verified(p_case_id,interval '5 minutes') then return jsonb_build_object('ready',true); end if;
 if v_day is null then return jsonb_build_object('ready',false,'reason','source_reference_pending'); end if;
 insert into private.clinicorp_sync_days(unit_id,posting_day,priority,refresh_requested_at)
 values(v_unit,v_day,1000,clock_timestamp()) on conflict(unit_id,posting_day) do update
 set priority=greatest(private.clinicorp_sync_days.priority,1000),refresh_requested_at=excluded.refresh_requested_at,
 next_attempt_at=least(private.clinicorp_sync_days.next_attempt_at,now()),
 status=case when private.clinicorp_sync_days.status='working' then 'working' else 'pending' end
 returning id into v_job;
 perform private.dispatch_clinicorp_financial_sync();
 return jsonb_build_object('ready',false,'requested',true);
end; $fn$;
revoke all on function public.request_clinicorp_case_verification(bigint) from public,anon;
grant execute on function public.request_clinicorp_case_verification(bigint) to authenticated;

CREATE OR REPLACE FUNCTION public.get_collection_queue_filtered(p_unit_code text DEFAULT NULL::text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 300, p_date_from date DEFAULT NULL, p_date_to date DEFAULT NULL, p_month integer DEFAULT NULL, p_year integer DEFAULT NULL)
 RETURNS TABLE(id bigint, unit_id bigint, unit_name text, unit_code text, patient_id bigint, patient_name text, phone text, installment_id bigint, installment_number integer, due_date date, open_amount numeric, eligible_at date, status text, responsible_user_id uuid, responsible_name text, next_action_at timestamp with time zone, protested_at timestamp with time zone, notes text, installment_status text, updated_at timestamptz, source_verified_at timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with allowed_units as (
    select u.id,u.code,u.name
    from public.units u
    where u.is_active
      and private.has_unit_access(u.id)
      and (p_unit_code is null or p_unit_code='' or p_unit_code='todas' or u.code=p_unit_code)
  )
  select
    cc.id,cc.unit_id,u.name,u.code,p.id,p.full_name,p.phone,cc.installment_id,
    i.installment_number,i.due_date,greatest(i.expected_amount-i.paid_amount,0::numeric),
    cc.eligible_at,cc.status,cc.responsible_user_id,coalesce(pr.full_name,'Sem responsável'::text),
    cc.next_action_at,cc.protested_at,cc.notes,i.status,cc.updated_at,case when s.source_presence='present' and s.source_presence_checked_at>=(select seeded_at from private.clinicorp_sync_control where singleton) and s.amount=i.expected_amount and i.paid_amount=0 and s.due_date=i.due_date and s.clinicorp_patient_id=pu.clinicorp_patient_id and not s.payment_received and not s.payment_confirmed and not s.cancelled then s.source_presence_checked_at else null end
  from public.collection_cases cc
  join allowed_units u on u.id=cc.unit_id
  join public.installments i on i.id=cc.installment_id and i.unit_id=cc.unit_id
  join public.payment_plans pp on pp.id=i.payment_plan_id and pp.unit_id=i.unit_id
  join public.patient_units pu on pu.id=cc.patient_unit_id and pu.unit_id=cc.unit_id
  join public.patients p on p.id=pu.patient_id
  left join public.clinicorp_payment_snapshot s on s.unit_id=i.unit_id and s.clinicorp_payment_id=i.clinicorp_installment_id
  left join public.profiles pr on pr.user_id=cc.responsible_user_id
  where pu.settled_at is null
    and pu.is_active
    and pu.clinicorp_patient_id is not null
    and pp.source='clinicorp'
    and pp.payment_method='boleto'
    and pp.archived_at is null
    and pp.status='active'
    and cc.status not in ('paid','closed')
    and i.source='clinicorp'
    and i.clinicorp_source_state='open'
    and i.status not in ('paid','cancelled','refunded')
    and greatest(i.expected_amount-i.paid_amount,0::numeric)>0
    and cc.eligible_at <= (now() at time zone 'America/Sao_Paulo')::date
    and (p_date_from is null or i.due_date>=p_date_from)
    and (p_date_to is null or i.due_date<=p_date_to)
    and (p_month is null or extract(month from i.due_date)=p_month)
    and (p_year is null or extract(year from i.due_date)=p_year)
  order by cc.eligible_at asc,cc.id asc
  offset greatest(coalesce(p_offset,0),0)
  limit least(greatest(coalesce(p_limit,500),1),1000);
$function$;
revoke all on function public.get_collection_queue_filtered(text,integer,integer,date,date,integer,integer) from public,anon;
grant execute on function public.get_collection_queue_filtered(text,integer,integer,date,date,integer,integer) to authenticated,service_role;

CREATE OR REPLACE FUNCTION public.register_collection_interaction(p_case_id bigint, p_outcome text, p_notes text, p_next_action_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_channel text DEFAULT 'call'::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_case public.collection_cases%rowtype;
  v_interaction_id bigint;
  v_new_status text;
  v_case_outcome text;
  v_task_kind text;
  v_task_key text;
  v_title text;
  v_patient_id bigint;
  v_patient_name text;
  v_installment_source text;
  v_source_state text;
  v_payment_pending_confirmation boolean := false;
  v_interaction_outcome text;
  v_terminal_payment boolean := false;
begin
  if v_user_id is null or not private.current_user_active() then
    raise exception using errcode='42501', message='Entre no LYVRA para registrar a cobrança.';
  end if;

  if p_outcome not in ('contact','no_contact','promise','negotiation','renegotiated','payment','protest','note') then
    raise exception using errcode='22023', message='Resultado da cobrança inválido.';
  end if;
  if p_channel not in ('call','whatsapp','in_person','email','system') then
    raise exception using errcode='22023', message='Canal de contato inválido.';
  end if;
  if length(btrim(coalesce(p_notes,''))) < 2 then
    raise exception using errcode='22023', message='Descreva o que aconteceu no contato.';
  end if;

  select * into v_case
  from public.collection_cases
  where id=p_case_id
  for update;

  if not found then
    raise exception using errcode='22023', message='Caso de cobrança não encontrado.';
  end if;

  if not private.current_user_can_manage_collections(v_case.unit_id) then
    raise exception using errcode='42501', message='Este acesso não possui permissão para operar a régua de cobrança desta unidade.';
  end if;

  if v_case.status in ('paid','closed') then
    raise exception using errcode='22023', message='Este caso já foi encerrado.';
  end if;

  select i.source,i.clinicorp_source_state
    into v_installment_source,v_source_state
  from public.installments i
  where i.id=v_case.installment_id
    and i.unit_id=v_case.unit_id;

  if v_installment_source='clinicorp' and not private.is_clinicorp_case_verified(p_case_id,interval '5 minutes') then
    raise exception using errcode='55000',message='Este título está em conferência com o Clinicorp. O registro será liberado após a atualização automática.';
  end if;

  v_payment_pending_confirmation :=
    p_outcome='payment'
    and v_installment_source='clinicorp'
    and coalesce(v_source_state,'unknown') <> 'paid';

  v_terminal_payment :=
    p_outcome='payment'
    and not v_payment_pending_confirmation;

  v_interaction_outcome :=
    case when v_payment_pending_confirmation then 'payment_reported' else p_outcome end;

  insert into public.collection_interactions(
    unit_id,collection_case_id,performed_by,channel,outcome,notes,next_action_at
  ) values (
    v_case.unit_id,v_case.id,v_user_id,p_channel,v_interaction_outcome,btrim(p_notes),
    case when p_outcome in ('payment','renegotiated') then null else p_next_action_at end
  ) returning id into v_interaction_id;

  v_new_status := case
    when v_payment_pending_confirmation then 'promise'
    when p_outcome='promise' then 'promise'
    when p_outcome='protest' then 'protested'
    when p_outcome='payment' then 'paid'
    when p_outcome='renegotiated' then 'closed'
    when p_outcome='no_contact' then 'pending_contact'
    else 'negotiating'
  end;

  v_case_outcome := case
    when v_payment_pending_confirmation then 'agreement'
    when p_outcome='payment' then 'paid'
    when p_outcome in ('promise','renegotiated') then 'agreement'
    when p_outcome='protest' then 'protested'
    else null
  end;

  update public.collection_cases cc
  set status=v_new_status,
      next_action_at=case when p_outcome in ('payment','renegotiated') then null else p_next_action_at end,
      protested_at=case when p_outcome='protest' then coalesce(cc.protested_at,now()) else cc.protested_at end,
      closed_at=case
        when v_terminal_payment or p_outcome='renegotiated' then coalesce(cc.closed_at,now())
        else cc.closed_at
      end,
      outcome=coalesce(v_case_outcome,cc.outcome),
      updated_at=now()
  where cc.id=v_case.id;

  update public.financial_tasks ft
  set status='completed',completed_at=coalesce(ft.completed_at,now()),updated_at=now()
  where ft.collection_case_id=v_case.id
    and ft.status in ('pending','in_progress')
    and (
      v_terminal_payment
      or p_outcome in ('protest','renegotiated')
      or ft.due_at <= now()+interval '1 day'
    );

  if p_next_action_at is not null
     and p_outcome not in ('payment','protest','renegotiated') then
    select pu.patient_id,p.full_name
      into v_patient_id,v_patient_name
    from public.patient_units pu
    join public.patients p on p.id=pu.patient_id
    where pu.id=v_case.patient_unit_id
      and pu.unit_id=v_case.unit_id;

    v_task_kind:=case when p_outcome='promise' then 'payment_promise' else 'collection_call' end;
    v_title:=case when p_outcome='promise' then 'Confirmar promessa de pagamento' else 'Retomar cobrança' end;
    v_task_key:=concat(
      'collection_followup:',v_case.id,':',v_task_kind,':',
      to_char(p_next_action_at at time zone 'America/Sao_Paulo','YYYYMMDDHH24MI')
    );

    insert into public.financial_tasks(
      unit_id,patient_id,installment_id,collection_case_id,assigned_to,
      title,description,kind,status,due_at,created_by,task_key
    ) values (
      v_case.unit_id,v_patient_id,v_case.installment_id,v_case.id,
      coalesce(v_case.responsible_user_id,v_user_id),
      v_title,concat(coalesce(v_patient_name,'Paciente'),' • retorno da régua de cobrança'),
      v_task_kind,'pending',p_next_action_at,v_user_id,v_task_key
    )
    on conflict (task_key) where task_key is not null do update
      set assigned_to=excluded.assigned_to,
          due_at=excluded.due_at,
          description=excluded.description,
          status=case when public.financial_tasks.status='completed' then 'completed' else 'pending' end,
          updated_at=now();
  end if;

  return v_interaction_id;
end;
$function$

