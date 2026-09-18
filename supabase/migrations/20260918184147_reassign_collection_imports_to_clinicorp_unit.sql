-- A antiga importação da régua recebia uma unidade fixa no frontend. Quando o
-- Clinicorp já identifica outra unidade, ele é a fonte canônica do vínculo.

lock table public.patient_directory in access exclusive mode;

-- O recálculo interno pode transformar o último vínculo ativo em totalmente
-- quitado. O lock da tabela impede escrita concorrente enquanto o guard é pausado.
alter table public.patients disable trigger preserve_settled_patient;

do $$
declare
  r record;
  v_source_case public.collection_cases%rowtype;
  v_target_case_id bigint;
  v_target_installment_id bigint;
  v_target_plan_id bigint;
  v_target_assignee uuid;
  v_latest_outcome text;
  v_latest_next_action timestamptz;
  v_target_case_status text;
  v_target_case_next_action timestamptz;
begin
  for r in
    with canonical_targets as (
      select
        pu_import.id as source_patient_unit_id,
        pu_import.unit_id as source_unit_id,
        min(pu_target.id) as target_patient_unit_id,
        min(pu_target.unit_id) as target_unit_id
      from public.patient_units pu_import
      join public.patient_units pu_target
        on pu_target.patient_id = pu_import.patient_id
       and pu_target.clinicorp_patient_id is not null
       and pu_target.unit_id <> pu_import.unit_id
      where pu_import.source = 'import'
        and coalesce((pu_import.metadata ->> 'collection_workbook')::boolean, false)
      group by pu_import.id, pu_import.unit_id
      having count(distinct pu_target.unit_id) = 1
    )
    select
      ct.*,
      pu.patient_id,
      pp.id as source_plan_id,
      pp.payment_method,
      pp.created_by,
      pp.updated_by,
      i.id as source_installment_id,
      i.installment_number,
      i.due_date,
      i.expected_amount,
      i.paid_amount,
      i.status as installment_status,
      i.paid_at,
      i.confirmed_at,
      i.metadata as installment_metadata
    from canonical_targets ct
    join public.patient_units pu on pu.id = ct.source_patient_unit_id
    join public.payment_plans pp
      on pp.patient_unit_id = ct.source_patient_unit_id
     and pp.unit_id = ct.source_unit_id
     and coalesce((pp.metadata ->> 'collection_only')::boolean, false)
    join public.installments i
      on i.payment_plan_id = pp.id
     and i.unit_id = pp.unit_id
     and i.status not in ('cancelled', 'refunded')
    order by pu.patient_id, i.due_date, i.id
  loop
    v_target_installment_id := null;
    v_target_plan_id := null;
    v_target_case_id := null;
    v_source_case := null;
    v_latest_outcome := null;
    v_latest_next_action := null;

    select i.id, pp.id
      into v_target_installment_id, v_target_plan_id
    from public.payment_plans pp
    join public.installments i
      on i.payment_plan_id = pp.id
     and i.unit_id = pp.unit_id
    where pp.patient_unit_id = r.target_patient_unit_id
      and pp.unit_id = r.target_unit_id
      and pp.archived_at is null
      and i.status not in ('cancelled', 'refunded')
      and i.due_date = r.due_date
      and abs(i.expected_amount - r.expected_amount) < 0.01
    order by (pp.source = 'clinicorp') desc, i.id
    limit 1;

    if v_target_installment_id is null then
      insert into public.payment_plans(
        unit_id, patient_unit_id, payment_method, total_amount, installment_amount,
        installment_count, due_day, start_date, end_date, issue_invoice_for_ir,
        invoice_disabled, invoice_disabled_reason, status, source, metadata,
        created_by, updated_by
      ) values (
        r.target_unit_id, r.target_patient_unit_id, coalesce(r.payment_method, 'boleto'),
        r.expected_amount, r.expected_amount, 1, extract(day from r.due_date)::smallint,
        r.due_date, r.due_date, false, true,
        'Histórico de cobrança transferido para a unidade canônica do Clinicorp',
        'suspended', 'import',
        jsonb_build_object(
          'collection_only', true,
          'source', 'collection_workbook',
          'unit_corrected_from', r.source_unit_id,
          'reassigned_from_plan_id', r.source_plan_id
        ),
        r.created_by, r.updated_by
      ) returning id into v_target_plan_id;

      insert into public.installments(
        unit_id, payment_plan_id, installment_number, due_date, expected_amount,
        paid_amount, status, paid_at, confirmed_at, source, metadata
      ) values (
        r.target_unit_id, v_target_plan_id, 1, r.due_date, r.expected_amount,
        r.paid_amount, r.installment_status, r.paid_at, r.confirmed_at, 'import',
        coalesce(r.installment_metadata, '{}'::jsonb) || jsonb_build_object(
          'unit_corrected_from', r.source_unit_id,
          'reassigned_from_installment_id', r.source_installment_id
        )
      ) returning id into v_target_installment_id;
    end if;

    select cc.* into v_source_case
    from public.collection_cases cc
    where cc.installment_id = r.source_installment_id;

    if v_source_case.id is not null then
      select u.collection_assignee_user_id into v_target_assignee
      from public.units u where u.id = r.target_unit_id;

      insert into public.collection_cases(
        unit_id, patient_unit_id, installment_id, responsible_user_id, eligible_at,
        status, opened_at, next_action_at, protested_at, closed_at, outcome, notes
      ) values (
        r.target_unit_id, r.target_patient_unit_id, v_target_installment_id,
        coalesce(v_target_assignee, v_source_case.responsible_user_id),
        v_source_case.eligible_at, v_source_case.status, v_source_case.opened_at,
        v_source_case.next_action_at, v_source_case.protested_at,
        v_source_case.closed_at, v_source_case.outcome,
        concat_ws(E'\n', v_source_case.notes,
          'Histórico transferido da unidade incorreta após conferência com o Clinicorp.')
      )
      on conflict (installment_id) do update
      set notes = case
            when public.collection_cases.notes is null then excluded.notes
            when position('Histórico transferido da unidade incorreta' in public.collection_cases.notes) = 0
              then concat_ws(E'\n', public.collection_cases.notes, excluded.notes)
            else public.collection_cases.notes
          end,
          responsible_user_id = coalesce(public.collection_cases.responsible_user_id, excluded.responsible_user_id),
          updated_at = now()
      returning id into v_target_case_id;

      update public.collection_interactions ci
      set unit_id = r.target_unit_id,
          collection_case_id = v_target_case_id
      where ci.collection_case_id = v_source_case.id;

      update public.collection_promises cp
      set unit_id = r.target_unit_id,
          collection_case_id = v_target_case_id,
          updated_at = now()
      where cp.collection_case_id = v_source_case.id;

      update public.financial_tasks ft
      set status = 'cancelled', updated_at = now()
      where ft.collection_case_id = v_source_case.id
        and ft.status in ('pending', 'in_progress');

      select ci.outcome, ci.next_action_at
        into v_latest_outcome, v_latest_next_action
      from public.collection_interactions ci
      where ci.collection_case_id = v_target_case_id
      order by ci.occurred_at desc, ci.id desc
      limit 1;

      if r.installment_status not in ('paid', 'cancelled', 'refunded')
         and not exists (
           select 1 from public.patient_units pu
           where pu.id = r.target_patient_unit_id and pu.settled_at is not null
         ) then
        update public.collection_cases cc
        set status = case
              when v_latest_outcome = 'promise' then 'promise'
              when v_latest_outcome = 'protest' then 'protested'
              when v_latest_outcome = 'no_contact' then 'pending_contact'
              when v_latest_outcome is not null then 'negotiating'
              when v_source_case.status in ('pending_contact', 'negotiating', 'promise', 'protested') then v_source_case.status
              else 'pending_contact'
            end,
            outcome = case
              when v_latest_outcome = 'promise' then 'agreement'
              when v_latest_outcome = 'protest' then 'protested'
              when v_latest_outcome is not null then null
              when v_source_case.status = 'promise' then 'agreement'
              when v_source_case.status = 'protested' then 'protested'
              else null
            end,
            next_action_at = coalesce(v_latest_next_action, v_source_case.next_action_at),
            closed_at = null,
            updated_at = now()
        where cc.id = v_target_case_id;
      end if;

      select cc.status, cc.next_action_at
        into v_target_case_status, v_target_case_next_action
      from public.collection_cases cc where cc.id = v_target_case_id;

      if v_target_case_status not in ('paid', 'closed')
         and not exists (
           select 1 from public.financial_tasks ft
           where ft.collection_case_id = v_target_case_id
             and ft.status in ('pending', 'in_progress')
         ) then
        insert into public.financial_tasks(
          unit_id, patient_id, installment_id, collection_case_id, assigned_to,
          title, description, kind, status, due_at, task_key
        ) values (
          r.target_unit_id, r.patient_id, v_target_installment_id, v_target_case_id,
          coalesce(v_target_assignee, v_source_case.responsible_user_id),
          case when v_target_case_status = 'promise' then 'Confirmar promessa de pagamento' else 'Retomar cobrança' end,
          'Caso transferido para a unidade confirmada pelo Clinicorp.',
          case when v_target_case_status = 'promise' then 'payment_promise' else 'collection_call' end,
          'pending',
          coalesce(v_target_case_next_action, v_source_case.eligible_at::timestamp at time zone 'America/Sao_Paulo'),
          concat('collection_unit_correction:', v_source_case.id)
        ) on conflict (task_key) where task_key is not null do nothing;
      end if;

      update public.collection_cases cc
      set status = 'closed', outcome = 'cancelled', closed_at = coalesce(cc.closed_at, now()),
          next_action_at = null,
          notes = concat_ws(E'\n', cc.notes,
            'Duplicidade encerrada: o Clinicorp confirmou o paciente em outra unidade.'),
          updated_at = now()
      where cc.id = v_source_case.id;
    end if;

    update public.installments i
    set status = 'cancelled',
        metadata = coalesce(i.metadata, '{}'::jsonb) || jsonb_build_object(
          'unit_correction', true,
          'canonical_unit_id', r.target_unit_id,
          'canonical_installment_id', v_target_installment_id
        ),
        updated_at = now()
    where i.id = r.source_installment_id;
  end loop;

  update public.payment_plans pp
  set status = 'cancelled', archived_at = coalesce(pp.archived_at, now()),
      metadata = coalesce(pp.metadata, '{}'::jsonb) || jsonb_build_object('unit_correction', true),
      updated_at = now()
  where coalesce((pp.metadata ->> 'collection_only')::boolean, false)
    and not exists (
      select 1 from public.installments i
      where i.payment_plan_id = pp.id and i.status not in ('cancelled', 'refunded')
    );

  update public.patient_units pu
  set is_active = false,
      metadata = coalesce(pu.metadata, '{}'::jsonb) || jsonb_build_object(
        'unit_correction', true,
        'unit_correction_reason', 'Clinicorp possui vínculo canônico em outra unidade'
      ),
      updated_at = now()
  where pu.source = 'import'
    and coalesce((pu.metadata ->> 'collection_workbook')::boolean, false)
    and not exists (
      select 1 from public.payment_plans pp
      where pp.patient_unit_id = pu.id and pp.archived_at is null and pp.status <> 'cancelled'
    )
    and exists (
      select 1 from public.patient_units canonical
      where canonical.patient_id = pu.patient_id
        and canonical.clinicorp_patient_id is not null
        and canonical.unit_id <> pu.unit_id
    );
end;
$$;

alter table public.patients enable trigger preserve_settled_patient;

create or replace function private.guard_collection_import_unit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_canonical_unit_id bigint;
  v_canonical_unit_name text;
  v_canonical_unit_count integer;
begin
  if new.source = 'import'
     and coalesce((new.metadata ->> 'collection_workbook')::boolean, false) then
    select min(pu.unit_id), min(u.name), count(distinct pu.unit_id)
      into v_canonical_unit_id, v_canonical_unit_name, v_canonical_unit_count
    from public.patient_units pu
    join public.units u on u.id = pu.unit_id
    where pu.patient_id = new.patient_id
      and pu.clinicorp_patient_id is not null;

    if v_canonical_unit_count = 1 and v_canonical_unit_id <> new.unit_id then
      raise exception using
        errcode = '22023',
        message = concat('Unidade divergente: o Clinicorp vincula este paciente a ', v_canonical_unit_name, '.');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_collection_import_unit on public.patient_units;
create trigger guard_collection_import_unit
before insert or update of unit_id, source, metadata on public.patient_units
for each row execute function private.guard_collection_import_unit();

create or replace view public.patient_directory with (security_invoker=true) as
select
  pu.id as patient_unit_id, p.id as patient_id, pu.clinicorp_patient_id, p.full_name, p.cpf, p.phone, p.email,
  u.id as unit_id, u.code as unit_code, u.name as unit_name, coalesce(ap.treatment, pu.treatment) as treatment,
  ap.payment_method, ap.total_amount as plan_amount, ap.installment_count, ap.due_day, ap.start_date,
  coalesce(ap.issue_invoice_for_ir, p.tax_receipt_ir) as tax_receipt_ir, ap.invoice_frequency_override as invoice_frequency,
  p.notes, pu.is_active, p.created_at, p.updated_at, ap.installment_amount, ap.end_date, ap.first_invoice_date,
  ap.invoice_interval_months, ap.invoice_schedule_mode, ap.invoice_recipient_name, ap.invoice_disabled, ap.invoice_disabled_reason,
  pu.settled_at, pu.settled_reason,
  (coalesce(pu.reminder_opt_out, false)
    or (coalesce(p.reminder_opt_out, false) and p.reminder_opt_out_reason is distinct from 'Paciente quitado')) as reminder_opt_out,
  coalesce(
    pu.reminder_opt_out_reason,
    case when p.reminder_opt_out_reason is distinct from 'Paciente quitado' then p.reminder_opt_out_reason end
  ) as reminder_opt_out_reason
from public.patient_units pu
join public.patients p on p.id = pu.patient_id
join public.units u on u.id = pu.unit_id
left join lateral (
  select pp.*
  from public.payment_plans pp
  where pp.patient_unit_id = pu.id and pp.status = 'active' and pp.archived_at is null
  order by pp.created_at desc, pp.id desc
  limit 1
) ap on true
where pu.is_active;

grant select on public.patient_directory to authenticated;
