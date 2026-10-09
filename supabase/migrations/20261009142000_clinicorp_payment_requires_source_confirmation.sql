alter table public.collection_interactions
drop constraint if exists collection_interactions_outcome_check;

alter table public.collection_interactions
add constraint collection_interactions_outcome_check
check (outcome = any (array[
  'contact'::text,
  'no_contact'::text,
  'promise'::text,
  'negotiation'::text,
  'renegotiated'::text,
  'payment'::text,
  'payment_reported'::text,
  'protest'::text,
  'note'::text
]));

create or replace function public.register_collection_interaction(
  p_case_id bigint,
  p_outcome text,
  p_notes text,
  p_next_action_at timestamptz default null,
  p_channel text default 'call'
)
returns bigint
language plpgsql
security definer
set search_path=''
as $function$
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
$function$;
