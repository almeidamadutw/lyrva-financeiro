-- LYVRA: gera parcelas operacionais a partir do plano de pagamento
-- e cria o lembrete interno D-1 de boletos para a responsável configurada por unidade.

alter table public.units
  add column if not exists payment_reminder_assignee_user_id uuid references auth.users(id) on delete set null,
  add column if not exists payment_reminder_days_before smallint not null default 1;

alter table public.units drop constraint if exists units_payment_reminder_days_before_check;
alter table public.units
  add constraint units_payment_reminder_days_before_check
  check (payment_reminder_days_before between 1 and 30);

update public.units
set payment_reminder_assignee_user_id = (
  select p.user_id
  from public.profiles p
  where p.username = 'suporte'
    and p.full_name = 'Maria Eduarda'
    and p.is_active
  limit 1
)
where code in ('sorocaba', 'salto_de_pirapora')
  and payment_reminder_assignee_user_id is null;

create index if not exists units_payment_reminder_assignee_user_id_idx
  on public.units (payment_reminder_assignee_user_id)
  where payment_reminder_assignee_user_id is not null;

alter table public.financial_tasks
  add column if not exists task_key text;

alter table public.financial_tasks drop constraint if exists financial_tasks_kind_check;
alter table public.financial_tasks
  add constraint financial_tasks_kind_check
  check (kind = any (array[
    'payment_reminder'::text,
    'collection_call'::text,
    'payment_promise'::text,
    'invoice'::text,
    'reconciliation'::text,
    'manual'::text
  ]));

create unique index if not exists financial_tasks_task_key_unique
  on public.financial_tasks (task_key)
  where task_key is not null;

create or replace function private.sync_payment_plan_operational_schedule()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_i integer;
  v_month date;
  v_last_day date;
  v_due_day integer;
  v_due_date date;
  v_installment_amount numeric(14,2);
  v_expected_amount numeric(14,2);
  v_installment_id bigint;
  v_assignee uuid;
  v_reminder_days integer := 1;
  v_patient_id bigint;
  v_patient_name text;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if new.archived_at is not null or new.status <> 'active' then
    return new;
  end if;

  if new.installment_count is null or new.installment_count < 1
     or new.start_date is null or new.total_amount <= 0 then
    return new;
  end if;

  select u.payment_reminder_assignee_user_id,
         coalesce(u.payment_reminder_days_before, 1)
    into v_assignee, v_reminder_days
  from public.units u
  where u.id = new.unit_id;

  select p.id, p.full_name
    into v_patient_id, v_patient_name
  from public.patient_units pu
  join public.patients p on p.id = pu.patient_id
  where pu.id = new.patient_unit_id
    and pu.unit_id = new.unit_id;

  v_due_day := coalesce(new.due_day, extract(day from new.start_date)::integer);
  v_installment_amount := coalesce(
    new.installment_amount,
    round(new.total_amount / new.installment_count, 2)
  );

  for v_i in 1..new.installment_count loop
    v_month := date_trunc('month', new.start_date + make_interval(months => v_i - 1))::date;
    v_last_day := (v_month + interval '1 month - 1 day')::date;
    v_due_date := make_date(
      extract(year from v_month)::integer,
      extract(month from v_month)::integer,
      least(v_due_day, extract(day from v_last_day)::integer)
    );

    if v_i = new.installment_count then
      v_expected_amount := greatest(
        round(new.total_amount - (v_installment_amount * (new.installment_count - 1)), 2),
        0
      );
    else
      v_expected_amount := v_installment_amount;
    end if;

    v_installment_id := null;

    insert into public.installments (
      unit_id,
      payment_plan_id,
      installment_number,
      due_date,
      expected_amount,
      status,
      source,
      metadata
    ) values (
      new.unit_id,
      new.id,
      v_i,
      v_due_date,
      v_expected_amount,
      'pending',
      new.source,
      jsonb_build_object('generated_by', 'payment_plan_schedule')
    )
    on conflict (payment_plan_id, installment_number) do update
      set due_date = excluded.due_date,
          expected_amount = excluded.expected_amount,
          source = excluded.source,
          metadata = coalesce(public.installments.metadata, '{}'::jsonb)
            || jsonb_build_object('generated_by', 'payment_plan_schedule')
      where public.installments.status in ('pending', 'overdue')
    returning id into v_installment_id;

    if v_installment_id is null then
      select i.id into v_installment_id
      from public.installments i
      where i.payment_plan_id = new.id
        and i.installment_number = v_i
      limit 1;
    end if;

    if new.payment_method = 'boleto'
       and v_assignee is not null
       and v_due_date > v_today then
      insert into public.financial_tasks (
        unit_id,
        patient_id,
        installment_id,
        assigned_to,
        title,
        description,
        kind,
        status,
        due_at,
        created_by,
        task_key
      ) values (
        new.unit_id,
        v_patient_id,
        v_installment_id,
        v_assignee,
        'Lembrete D-1 do boleto',
        concat(
          coalesce(v_patient_name, 'Paciente'),
          ' • parcela ', v_i, '/', new.installment_count,
          ' • vencimento ', to_char(v_due_date, 'DD/MM/YYYY')
        ),
        'payment_reminder',
        'pending',
        ((v_due_date - v_reminder_days)::timestamp at time zone 'America/Sao_Paulo'),
        coalesce(new.updated_by, new.created_by, auth.uid()),
        concat('payment_reminder:', v_installment_id)
      )
      on conflict (task_key) where task_key is not null do update
        set assigned_to = excluded.assigned_to,
            patient_id = excluded.patient_id,
            installment_id = excluded.installment_id,
            title = excluded.title,
            description = excluded.description,
            due_at = excluded.due_at,
            status = case
              when public.financial_tasks.status = 'completed' then public.financial_tasks.status
              else 'pending'
            end;
    else
      update public.financial_tasks ft
      set status = 'cancelled'
      where ft.task_key = concat('payment_reminder:', v_installment_id)
        and ft.status in ('pending', 'in_progress');
    end if;
  end loop;

  update public.financial_tasks ft
  set status = 'cancelled'
  where ft.installment_id in (
    select i.id
    from public.installments i
    where i.payment_plan_id = new.id
      and i.installment_number > new.installment_count
  )
    and ft.kind = 'payment_reminder'
    and ft.status in ('pending', 'in_progress');

  update public.installments i
  set status = 'cancelled'
  where i.payment_plan_id = new.id
    and i.installment_number > new.installment_count
    and i.status in ('pending', 'overdue');

  return new;
end;
$function$;

drop trigger if exists sync_operational_schedule on public.payment_plans;
create trigger sync_operational_schedule
after insert or update of
  payment_method,
  total_amount,
  installment_amount,
  installment_count,
  due_day,
  start_date,
  status,
  archived_at,
  patient_unit_id,
  unit_id
on public.payment_plans
for each row
execute function private.sync_payment_plan_operational_schedule();
