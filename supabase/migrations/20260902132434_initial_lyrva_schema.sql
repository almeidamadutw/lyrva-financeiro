-- Migração 20260902132434 — esquema inicial do banco financeiro da Casal Odonto.
-- Não contém pacientes, pagamentos, notas ou movimentações fictícias.

create schema if not exists private;

comment on schema private is
  'Funções internas da LYRVA. Este schema não deve ser exposto pela Data API.';

create table public.units (
  id bigint generated always as identity primary key,
  code text not null unique,
  name text not null unique,
  city text not null,
  state text not null default 'SP',
  clinicorp_business_id text,
  invoice_frequency text not null,
  invoice_cycle_mode text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint units_code_format_check check (code = lower(code) and code ~ '^[a-z0-9_]+$'),
  constraint units_state_check check (state ~ '^[A-Z]{2}$'),
  constraint units_invoice_frequency_check check (
    invoice_frequency in ('monthly', 'four_monthly')
  ),
  constraint units_invoice_cycle_mode_check check (
    invoice_cycle_mode in ('calendar', 'patient_start', 'pending_definition')
  )
);

create unique index units_clinicorp_business_id_unique
  on public.units (clinicorp_business_id)
  where clinicorp_business_id is not null;

create table public.staff_invitations (
  id bigint generated always as identity primary key,
  email text not null unique,
  full_name text not null,
  role text not null,
  status text not null default 'pending',
  expires_at timestamptz,
  accepted_at timestamptz,
  accepted_user_id uuid references auth.users (id) on delete set null,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_invitations_email_lowercase_check check (email = lower(email)),
  constraint staff_invitations_role_check check (
    role in ('membro', 'gestora', 'ceo', 'suporte')
  ),
  constraint staff_invitations_status_check check (
    status in ('pending', 'accepted', 'revoked', 'expired')
  )
);

create table public.staff_invitation_units (
  invitation_id bigint not null references public.staff_invitations (id) on delete cascade,
  unit_id bigint not null references public.units (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (invitation_id, unit_id)
);

create index staff_invitation_units_unit_id_idx
  on public.staff_invitation_units (unit_id);

create unique index staff_invitations_accepted_user_unique
  on public.staff_invitations (accepted_user_id)
  where accepted_user_id is not null;

create index staff_invitations_invited_by_idx
  on public.staff_invitations (invited_by)
  where invited_by is not null;

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  full_name text not null,
  role text not null,
  is_active boolean not null default true,
  last_unit_id bigint references public.units (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_email_lowercase_check check (email = lower(email)),
  constraint profiles_role_check check (
    role in ('membro', 'gestora', 'ceo', 'suporte')
  )
);

create index profiles_last_unit_id_idx on public.profiles (last_unit_id);
create index profiles_active_role_idx on public.profiles (is_active, role);

create table public.profile_units (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  unit_id bigint not null references public.units (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, unit_id)
);

create index profile_units_unit_id_idx on public.profile_units (unit_id);

create table public.patients (
  id bigint generated always as identity primary key,
  full_name text not null,
  cpf text,
  phone text,
  email text,
  tax_receipt_ir boolean not null default false,
  status text not null default 'active',
  source text not null default 'manual',
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patients_full_name_check check (length(btrim(full_name)) >= 2),
  constraint patients_cpf_check check (cpf is null or cpf ~ '^[0-9]{11}$'),
  constraint patients_phone_check check (phone is null or phone ~ '^[0-9]{10,13}$'),
  constraint patients_status_check check (status in ('active', 'inactive', 'manual_review')),
  constraint patients_source_check check (source in ('manual', 'import', 'clinicorp'))
);

create unique index patients_cpf_unique
  on public.patients (cpf)
  where cpf is not null and archived_at is null;

create index patients_phone_idx
  on public.patients (phone)
  where phone is not null and archived_at is null;

create index patients_email_lower_idx
  on public.patients (lower(email))
  where email is not null and archived_at is null;

create index patients_name_lower_idx
  on public.patients (lower(full_name));
create index patients_created_by_idx on public.patients (created_by)
  where created_by is not null;
create index patients_updated_by_idx on public.patients (updated_by)
  where updated_by is not null;

create table public.patient_units (
  id bigint generated always as identity primary key,
  patient_id bigint not null references public.patients (id) on delete restrict,
  unit_id bigint not null references public.units (id) on delete restrict,
  clinicorp_patient_id text,
  treatment text,
  started_at date,
  is_active boolean not null default true,
  source text not null default 'manual',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patient_units_source_check check (source in ('manual', 'import', 'clinicorp')),
  constraint patient_units_patient_unit_unique unique (patient_id, unit_id),
  constraint patient_units_id_unit_unique unique (id, unit_id)
);

create index patient_units_patient_id_idx on public.patient_units (patient_id);
create index patient_units_unit_active_idx on public.patient_units (unit_id, is_active);
create index patient_units_created_by_idx on public.patient_units (created_by)
  where created_by is not null;
create index patient_units_updated_by_idx on public.patient_units (updated_by)
  where updated_by is not null;

create unique index patient_units_clinicorp_patient_unique
  on public.patient_units (unit_id, clinicorp_patient_id)
  where clinicorp_patient_id is not null;

create table public.payment_plans (
  id bigint generated always as identity primary key,
  unit_id bigint not null references public.units (id) on delete restrict,
  patient_unit_id bigint not null,
  clinicorp_contract_id text,
  treatment text,
  payment_method text not null default 'other',
  total_amount numeric(14, 2) not null default 0,
  installment_count integer,
  due_day smallint,
  start_date date,
  end_date date,
  issue_invoice_for_ir boolean not null default false,
  invoice_frequency_override text,
  status text not null default 'active',
  source text not null default 'manual',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_plans_patient_unit_fk
    foreign key (patient_unit_id, unit_id)
    references public.patient_units (id, unit_id)
    on delete restrict,
  constraint payment_plans_id_unit_unique unique (id, unit_id),
  constraint payment_plans_amount_check check (total_amount >= 0),
  constraint payment_plans_installment_count_check check (
    installment_count is null or installment_count > 0
  ),
  constraint payment_plans_due_day_check check (due_day is null or due_day between 1 and 31),
  constraint payment_plans_dates_check check (
    end_date is null or start_date is null or end_date >= start_date
  ),
  constraint payment_plans_payment_method_check check (
    payment_method in ('boleto', 'card', 'pix', 'cash', 'transfer', 'other')
  ),
  constraint payment_plans_invoice_frequency_check check (
    invoice_frequency_override is null
    or invoice_frequency_override in ('monthly', 'four_monthly')
  ),
  constraint payment_plans_status_check check (
    status in ('active', 'completed', 'cancelled', 'suspended')
  ),
  constraint payment_plans_source_check check (source in ('manual', 'import', 'clinicorp'))
);

create index payment_plans_patient_unit_id_idx on public.payment_plans (patient_unit_id);
create index payment_plans_unit_status_idx on public.payment_plans (unit_id, status);
create index payment_plans_created_by_idx on public.payment_plans (created_by)
  where created_by is not null;
create index payment_plans_updated_by_idx on public.payment_plans (updated_by)
  where updated_by is not null;

create unique index payment_plans_clinicorp_contract_unique
  on public.payment_plans (unit_id, clinicorp_contract_id)
  where clinicorp_contract_id is not null;

create table public.installments (
  id bigint generated always as identity primary key,
  unit_id bigint not null references public.units (id) on delete restrict,
  payment_plan_id bigint not null,
  clinicorp_installment_id text,
  installment_number integer,
  due_date date not null,
  expected_amount numeric(14, 2) not null,
  paid_amount numeric(14, 2) not null default 0,
  currency text not null default 'BRL',
  status text not null default 'pending',
  paid_at timestamptz,
  confirmed_at timestamptz,
  last_synced_at timestamptz,
  boleto_url text,
  source text not null default 'clinicorp',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint installments_payment_plan_fk
    foreign key (payment_plan_id, unit_id)
    references public.payment_plans (id, unit_id)
    on delete restrict,
  constraint installments_id_unit_unique unique (id, unit_id),
  constraint installments_plan_number_unique unique (payment_plan_id, installment_number),
  constraint installments_number_check check (
    installment_number is null or installment_number > 0
  ),
  constraint installments_amounts_check check (expected_amount >= 0 and paid_amount >= 0),
  constraint installments_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint installments_status_check check (
    status in ('pending', 'processing', 'paid', 'overdue', 'cancelled', 'refunded', 'chargeback')
  ),
  constraint installments_source_check check (source in ('manual', 'import', 'clinicorp'))
);

create index installments_payment_plan_id_idx on public.installments (payment_plan_id);
create index installments_unit_status_due_idx on public.installments (unit_id, status, due_date);
create index installments_pending_due_idx on public.installments (due_date)
  where status in ('pending', 'overdue');

create unique index installments_clinicorp_id_unique
  on public.installments (unit_id, clinicorp_installment_id)
  where clinicorp_installment_id is not null;

create table public.payments (
  id bigint generated always as identity primary key,
  unit_id bigint not null references public.units (id) on delete restrict,
  installment_id bigint not null,
  clinicorp_payment_id text,
  payment_method text not null,
  amount numeric(14, 2) not null,
  fee_amount numeric(14, 2) not null default 0,
  net_amount numeric(14, 2),
  status text not null default 'confirmed',
  paid_at timestamptz not null,
  confirmed_at timestamptz,
  reversed_at timestamptz,
  source text not null default 'clinicorp',
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_installment_fk
    foreign key (installment_id, unit_id)
    references public.installments (id, unit_id)
    on delete restrict,
  constraint payments_id_unit_unique unique (id, unit_id),
  constraint payments_amounts_check check (
    amount > 0 and fee_amount >= 0 and (net_amount is null or net_amount >= 0)
  ),
  constraint payments_method_check check (
    payment_method in ('boleto', 'card', 'pix', 'cash', 'transfer', 'other')
  ),
  constraint payments_status_check check (
    status in ('processing', 'confirmed', 'reversed', 'refunded', 'chargeback')
  ),
  constraint payments_source_check check (source in ('manual', 'import', 'clinicorp'))
);

create index payments_installment_id_idx on public.payments (installment_id);
create index payments_unit_paid_at_idx on public.payments (unit_id, paid_at desc);
create index payments_confirmed_paid_at_idx on public.payments (paid_at desc)
  where status = 'confirmed';

create unique index payments_clinicorp_id_unique
  on public.payments (unit_id, clinicorp_payment_id)
  where clinicorp_payment_id is not null;

create table public.payment_events (
  id bigint generated always as identity primary key,
  unit_id bigint not null references public.units (id) on delete restrict,
  installment_id bigint not null,
  payment_id bigint,
  source text not null,
  event_type text not null,
  external_event_id text,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint payment_events_installment_fk
    foreign key (installment_id, unit_id)
    references public.installments (id, unit_id)
    on delete restrict,
  constraint payment_events_payment_fk
    foreign key (payment_id, unit_id)
    references public.payments (id, unit_id)
    on delete restrict,
  constraint payment_events_source_check check (source in ('manual', 'clinicorp', 'webhook', 'sync'))
);

create index payment_events_installment_id_idx on public.payment_events (installment_id);
create index payment_events_payment_id_idx on public.payment_events (payment_id)
  where payment_id is not null;
create index payment_events_unit_occurred_idx on public.payment_events (unit_id, occurred_at desc);

create unique index payment_events_external_unique
  on public.payment_events (source, external_event_id)
  where external_event_id is not null;

create table public.invoice_obligations (
  id bigint generated always as identity primary key,
  unit_id bigint not null references public.units (id) on delete restrict,
  patient_unit_id bigint not null,
  payment_plan_id bigint not null,
  period_start date not null,
  period_end date not null,
  competence text not null,
  frequency text not null,
  status text not null default 'forecast',
  expected_amount numeric(14, 2) not null default 0,
  paid_amount numeric(14, 2) not null default 0,
  invoice_number text,
  invoice_issued_at timestamptz,
  invoice_file_url text,
  responsible_user_id uuid references auth.users (id) on delete set null,
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_obligations_patient_unit_fk
    foreign key (patient_unit_id, unit_id)
    references public.patient_units (id, unit_id)
    on delete restrict,
  constraint invoice_obligations_payment_plan_fk
    foreign key (payment_plan_id, unit_id)
    references public.payment_plans (id, unit_id)
    on delete restrict,
  constraint invoice_obligations_id_unit_unique unique (id, unit_id),
  constraint invoice_obligations_period_check check (period_end >= period_start),
  constraint invoice_obligations_amounts_check check (expected_amount >= 0 and paid_amount >= 0),
  constraint invoice_obligations_frequency_check check (frequency in ('monthly', 'four_monthly')),
  constraint invoice_obligations_status_check check (
    status in (
      'forecast',
      'awaiting_payment',
      'payment_unconfirmed',
      'ready',
      'missing_data',
      'open',
      'issued',
      'divergence',
      'cycle_in_progress',
      'cancelled'
    )
  ),
  constraint invoice_obligations_plan_period_unique unique (
    payment_plan_id,
    period_start,
    period_end
  )
);

create index invoice_obligations_patient_unit_id_idx
  on public.invoice_obligations (patient_unit_id);
create index invoice_obligations_payment_plan_id_idx
  on public.invoice_obligations (payment_plan_id);
create index invoice_obligations_responsible_user_id_idx
  on public.invoice_obligations (responsible_user_id)
  where responsible_user_id is not null;
create index invoice_obligations_unit_status_period_idx
  on public.invoice_obligations (unit_id, status, period_end);
create index invoice_obligations_open_idx
  on public.invoice_obligations (unit_id, period_end)
  where status not in ('issued', 'cancelled');

create table public.invoice_obligation_payments (
  unit_id bigint not null references public.units (id) on delete restrict,
  invoice_obligation_id bigint not null,
  payment_id bigint not null unique,
  allocated_amount numeric(14, 2) not null,
  created_at timestamptz not null default now(),
  primary key (invoice_obligation_id, payment_id),
  constraint invoice_obligation_payments_obligation_fk
    foreign key (invoice_obligation_id, unit_id)
    references public.invoice_obligations (id, unit_id)
    on delete cascade,
  constraint invoice_obligation_payments_payment_fk
    foreign key (payment_id, unit_id)
    references public.payments (id, unit_id)
    on delete restrict,
  constraint invoice_obligation_payments_amount_check check (allocated_amount > 0)
);

create index invoice_obligation_payments_unit_id_idx
  on public.invoice_obligation_payments (unit_id);

create table public.message_events (
  id bigint generated always as identity primary key,
  unit_id bigint not null references public.units (id) on delete restrict,
  patient_id bigint not null references public.patients (id) on delete restrict,
  installment_id bigint,
  kind text not null,
  channel text not null default 'whatsapp',
  template_name text,
  status text not null default 'scheduled',
  idempotency_key text not null unique,
  external_message_id text,
  scheduled_for timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  attempt_count integer not null default 0,
  last_error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint message_events_installment_fk
    foreign key (installment_id, unit_id)
    references public.installments (id, unit_id)
    on delete restrict,
  constraint message_events_kind_check check (
    kind in ('boleto_reminder', 'payment_confirmation', 'collection', 'manual')
  ),
  constraint message_events_channel_check check (channel = 'whatsapp'),
  constraint message_events_status_check check (
    status in ('scheduled', 'processing', 'sent', 'delivered', 'read', 'failed', 'cancelled', 'skipped')
  ),
  constraint message_events_attempt_count_check check (attempt_count >= 0)
);

create index message_events_patient_id_idx on public.message_events (patient_id);
create index message_events_installment_id_idx on public.message_events (installment_id)
  where installment_id is not null;
create index message_events_unit_status_scheduled_idx
  on public.message_events (unit_id, status, scheduled_for);

create unique index message_events_automatic_once_unique
  on public.message_events (installment_id, kind)
  where installment_id is not null
    and kind in ('boleto_reminder', 'payment_confirmation');

create unique index message_events_external_message_unique
  on public.message_events (external_message_id)
  where external_message_id is not null;

create table public.collection_cases (
  id bigint generated always as identity primary key,
  unit_id bigint not null references public.units (id) on delete restrict,
  patient_unit_id bigint not null,
  installment_id bigint not null,
  responsible_user_id uuid references auth.users (id) on delete set null,
  eligible_at date not null,
  status text not null default 'pending_contact',
  opened_at timestamptz not null default now(),
  next_action_at timestamptz,
  protested_at timestamptz,
  closed_at timestamptz,
  outcome text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint collection_cases_patient_unit_fk
    foreign key (patient_unit_id, unit_id)
    references public.patient_units (id, unit_id)
    on delete restrict,
  constraint collection_cases_installment_fk
    foreign key (installment_id, unit_id)
    references public.installments (id, unit_id)
    on delete restrict,
  constraint collection_cases_id_unit_unique unique (id, unit_id),
  constraint collection_cases_installment_unique unique (installment_id),
  constraint collection_cases_status_check check (
    status in ('pending_contact', 'negotiating', 'promise', 'protested', 'paid', 'closed')
  ),
  constraint collection_cases_outcome_check check (
    outcome is null or outcome in ('paid', 'agreement', 'protested', 'cancelled', 'other')
  )
);

create index collection_cases_patient_unit_id_idx on public.collection_cases (patient_unit_id);
create index collection_cases_responsible_user_id_idx
  on public.collection_cases (responsible_user_id)
  where responsible_user_id is not null;
create index collection_cases_unit_status_action_idx
  on public.collection_cases (unit_id, status, next_action_at);
create index collection_cases_open_queue_idx
  on public.collection_cases (eligible_at, next_action_at)
  where status not in ('paid', 'closed');

create table public.collection_interactions (
  id bigint generated always as identity primary key,
  unit_id bigint not null references public.units (id) on delete restrict,
  collection_case_id bigint not null,
  performed_by uuid references auth.users (id) on delete set null,
  channel text not null,
  outcome text not null,
  notes text not null,
  voice_transcript text,
  occurred_at timestamptz not null default now(),
  next_action_at timestamptz,
  created_at timestamptz not null default now(),
  constraint collection_interactions_case_fk
    foreign key (collection_case_id, unit_id)
    references public.collection_cases (id, unit_id)
    on delete cascade,
  constraint collection_interactions_channel_check check (
    channel in ('call', 'whatsapp', 'in_person', 'email', 'system')
  ),
  constraint collection_interactions_outcome_check check (
    outcome in ('contact', 'no_contact', 'promise', 'negotiation', 'payment', 'protest', 'note')
  )
);

create index collection_interactions_case_occurred_idx
  on public.collection_interactions (collection_case_id, occurred_at desc);
create index collection_interactions_unit_occurred_idx
  on public.collection_interactions (unit_id, occurred_at desc);
create index collection_interactions_performed_by_idx
  on public.collection_interactions (performed_by)
  where performed_by is not null;

create table public.collection_promises (
  id bigint generated always as identity primary key,
  unit_id bigint not null references public.units (id) on delete restrict,
  collection_case_id bigint not null,
  promised_amount numeric(14, 2),
  promised_for date not null,
  status text not null default 'pending',
  created_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint collection_promises_case_fk
    foreign key (collection_case_id, unit_id)
    references public.collection_cases (id, unit_id)
    on delete cascade,
  constraint collection_promises_amount_check check (
    promised_amount is null or promised_amount > 0
  ),
  constraint collection_promises_status_check check (
    status in ('pending', 'kept', 'broken', 'cancelled')
  )
);

create index collection_promises_case_id_idx on public.collection_promises (collection_case_id);
create index collection_promises_created_by_idx on public.collection_promises (created_by)
  where created_by is not null;
create index collection_promises_unit_status_date_idx
  on public.collection_promises (unit_id, status, promised_for);

create table public.financial_tasks (
  id bigint generated always as identity primary key,
  unit_id bigint not null references public.units (id) on delete restrict,
  patient_id bigint references public.patients (id) on delete restrict,
  installment_id bigint,
  collection_case_id bigint,
  assigned_to uuid references auth.users (id) on delete set null,
  title text not null,
  description text,
  kind text not null,
  status text not null default 'pending',
  due_at timestamptz not null,
  completed_at timestamptz,
  seen_at timestamptz,
  dismissed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financial_tasks_installment_fk
    foreign key (installment_id, unit_id)
    references public.installments (id, unit_id)
    on delete restrict,
  constraint financial_tasks_collection_case_fk
    foreign key (collection_case_id, unit_id)
    references public.collection_cases (id, unit_id)
    on delete restrict,
  constraint financial_tasks_title_check check (length(btrim(title)) > 0),
  constraint financial_tasks_kind_check check (
    kind in ('collection_call', 'payment_promise', 'invoice', 'reconciliation', 'manual')
  ),
  constraint financial_tasks_status_check check (
    status in ('pending', 'in_progress', 'completed', 'cancelled')
  )
);

create index financial_tasks_patient_id_idx on public.financial_tasks (patient_id)
  where patient_id is not null;
create index financial_tasks_installment_id_idx on public.financial_tasks (installment_id)
  where installment_id is not null;
create index financial_tasks_collection_case_id_idx on public.financial_tasks (collection_case_id)
  where collection_case_id is not null;
create index financial_tasks_assignee_due_idx
  on public.financial_tasks (assigned_to, status, due_at);
create index financial_tasks_created_by_idx on public.financial_tasks (created_by)
  where created_by is not null;
create index financial_tasks_unit_pending_due_idx
  on public.financial_tasks (unit_id, due_at)
  where status in ('pending', 'in_progress');

create table public.integration_connections (
  id bigint generated always as identity primary key,
  unit_id bigint references public.units (id) on delete restrict,
  provider text not null,
  display_name text not null,
  status text not null default 'disconnected',
  non_secret_config jsonb not null default '{}'::jsonb,
  secret_reference text,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_connections_provider_check check (
    provider in ('clinicorp', 'whatsapp', 'nfse')
  ),
  constraint integration_connections_status_check check (
    status in ('disconnected', 'pending', 'connected', 'error', 'paused')
  )
);

create unique index integration_connections_provider_unit_unique
  on public.integration_connections (provider, unit_id)
  where unit_id is not null;

create unique index integration_connections_global_provider_unique
  on public.integration_connections (provider)
  where unit_id is null;

create index integration_connections_unit_id_idx
  on public.integration_connections (unit_id)
  where unit_id is not null;

create table public.sync_runs (
  id bigint generated always as identity primary key,
  connection_id bigint not null references public.integration_connections (id) on delete cascade,
  unit_id bigint references public.units (id) on delete restrict,
  entity_type text not null,
  direction text not null,
  status text not null default 'running',
  cursor_value text,
  processed_count integer not null default 0,
  created_count integer not null default 0,
  updated_count integer not null default 0,
  skipped_count integer not null default 0,
  error_count integer not null default 0,
  error_summary text,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint sync_runs_direction_check check (direction in ('inbound', 'outbound')),
  constraint sync_runs_status_check check (
    status in ('running', 'completed', 'partial', 'failed', 'cancelled')
  ),
  constraint sync_runs_counts_check check (
    processed_count >= 0
    and created_count >= 0
    and updated_count >= 0
    and skipped_count >= 0
    and error_count >= 0
  )
);

create index sync_runs_connection_started_idx
  on public.sync_runs (connection_id, started_at desc);
create index sync_runs_unit_status_idx on public.sync_runs (unit_id, status)
  where unit_id is not null;

create table public.sync_events (
  id bigint generated always as identity primary key,
  sync_run_id bigint not null references public.sync_runs (id) on delete cascade,
  unit_id bigint references public.units (id) on delete restrict,
  external_id text,
  entity_type text not null,
  action text not null,
  status text not null,
  payload_hash text,
  error_message text,
  created_at timestamptz not null default now(),
  constraint sync_events_action_check check (
    action in ('create', 'update', 'skip', 'delete', 'send', 'receive')
  ),
  constraint sync_events_status_check check (status in ('success', 'failed', 'skipped'))
);

create index sync_events_run_id_idx on public.sync_events (sync_run_id);
create index sync_events_unit_created_idx on public.sync_events (unit_id, created_at desc)
  where unit_id is not null;

create unique index sync_events_idempotency_unique
  on public.sync_events (sync_run_id, entity_type, external_id, action)
  where external_id is not null;

create table public.import_runs (
  id bigint generated always as identity primary key,
  unit_id bigint not null references public.units (id) on delete restrict,
  file_name text not null,
  status text not null default 'validating',
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  imported_rows integer not null default 0,
  duplicate_rows integer not null default 0,
  error_rows integer not null default 0,
  column_mapping jsonb not null default '{}'::jsonb,
  report jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint import_runs_id_unit_unique unique (id, unit_id),
  constraint import_runs_status_check check (
    status in ('validating', 'ready', 'importing', 'completed', 'partial', 'failed', 'cancelled')
  ),
  constraint import_runs_counts_check check (
    total_rows >= 0
    and valid_rows >= 0
    and imported_rows >= 0
    and duplicate_rows >= 0
    and error_rows >= 0
  )
);

create index import_runs_unit_created_idx on public.import_runs (unit_id, created_at desc);
create index import_runs_created_by_idx on public.import_runs (created_by)
  where created_by is not null;

create table public.import_rows (
  id bigint generated always as identity primary key,
  unit_id bigint not null references public.units (id) on delete restrict,
  import_run_id bigint not null,
  row_number integer not null,
  status text not null,
  raw_data jsonb not null default '{}'::jsonb,
  normalized_data jsonb not null default '{}'::jsonb,
  patient_id bigint references public.patients (id) on delete set null,
  errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint import_rows_run_fk
    foreign key (import_run_id, unit_id)
    references public.import_runs (id, unit_id)
    on delete cascade,
  constraint import_rows_run_number_unique unique (import_run_id, row_number),
  constraint import_rows_number_check check (row_number > 0),
  constraint import_rows_status_check check (
    status in ('valid', 'invalid', 'duplicate', 'imported', 'ignored')
  )
);

create index import_rows_patient_id_idx on public.import_rows (patient_id)
  where patient_id is not null;
create index import_rows_unit_status_idx on public.import_rows (unit_id, status);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users (id) on delete set null,
  unit_id bigint references public.units (id) on delete set null,
  table_name text not null,
  record_id text,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  occurred_at timestamptz not null default now(),
  constraint audit_logs_action_check check (action in ('INSERT', 'UPDATE', 'DELETE'))
);

create index audit_logs_actor_occurred_idx
  on public.audit_logs (actor_user_id, occurred_at desc)
  where actor_user_id is not null;
create index audit_logs_unit_occurred_idx on public.audit_logs (unit_id, occurred_at desc)
  where unit_id is not null;
create index audit_logs_record_idx on public.audit_logs (table_name, record_id, occurred_at desc);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function private.current_user_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null then false
    else exists (
      select 1
      from public.profiles p
      where p.user_id = (select auth.uid())
        and p.is_active
    )
  end;
$$;

create or replace function private.current_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null then null
    else (
      select p.role
      from public.profiles p
      where p.user_id = (select auth.uid())
        and p.is_active
      limit 1
    )
  end;
$$;

create or replace function private.has_unit_access(target_unit_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null then false
    else exists (
      select 1
      from public.profile_units pu
      join public.profiles p on p.user_id = pu.user_id
      join public.units u on u.id = pu.unit_id
      where pu.user_id = (select auth.uid())
        and pu.unit_id = target_unit_id
        and p.is_active
        and u.is_active
    )
  end;
$$;

create or replace function private.has_patient_access(target_patient_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null then false
    else exists (
      select 1
      from public.patient_units patient_unit
      join public.profile_units member_unit
        on member_unit.unit_id = patient_unit.unit_id
      join public.profiles p on p.user_id = member_unit.user_id
      where patient_unit.patient_id = target_patient_id
        and member_unit.user_id = (select auth.uid())
        and p.is_active
    )
  end;
$$;

create or replace function private.can_manage_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select private.current_user_role()) in ('ceo', 'suporte'), false);
$$;

create or replace function private.can_view_management_data()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select private.current_user_role()) in ('gestora', 'ceo', 'suporte'),
    false
  );
$$;

create or replace function private.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_before jsonb;
  row_after jsonb;
  row_for_identity jsonb;
  audit_unit_id bigint;
  audit_record_id text;
begin
  row_before := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  row_after := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  row_for_identity := coalesce(row_after, row_before, '{}'::jsonb);

  if coalesce(row_for_identity ->> 'unit_id', '') ~ '^[0-9]+$' then
    audit_unit_id := (row_for_identity ->> 'unit_id')::bigint;
  end if;

  audit_record_id := coalesce(
    row_for_identity ->> 'id',
    row_for_identity ->> 'user_id',
    row_for_identity ->> 'patient_id'
  );

  insert into public.audit_logs (
    actor_user_id,
    unit_id,
    table_name,
    record_id,
    action,
    old_data,
    new_data
  ) values (
    (select auth.uid()),
    audit_unit_id,
    tg_table_name,
    audit_record_id,
    tg_op,
    row_before,
    row_after
  );

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched_invitation public.staff_invitations%rowtype;
  initial_unit_id bigint;
begin
  if new.email is null then
    raise exception using
      errcode = 'P0001',
      message = 'A conta precisa possuir um e-mail autorizado pela LYRVA.';
  end if;

  select invitation.*
  into matched_invitation
  from public.staff_invitations invitation
  where invitation.email = lower(new.email)
    and invitation.status = 'pending'
    and (invitation.expires_at is null or invitation.expires_at > now())
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'Este e-mail não possui um convite ativo para a LYRVA.';
  end if;

  select min(invitation_unit.unit_id)
  into initial_unit_id
  from public.staff_invitation_units invitation_unit
  where invitation_unit.invitation_id = matched_invitation.id;

  insert into public.profiles (
    user_id,
    email,
    full_name,
    role,
    last_unit_id
  ) values (
    new.id,
    lower(new.email),
    matched_invitation.full_name,
    matched_invitation.role,
    initial_unit_id
  );

  insert into public.profile_units (user_id, unit_id)
  select new.id, invitation_unit.unit_id
  from public.staff_invitation_units invitation_unit
  where invitation_unit.invitation_id = matched_invitation.id;

  update public.staff_invitations
  set
    status = 'accepted',
    accepted_at = now(),
    accepted_user_id = new.id,
    updated_at = now()
  where id = matched_invitation.id;

  return new;
end;
$$;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'units',
    'staff_invitations',
    'profiles',
    'patients',
    'patient_units',
    'payment_plans',
    'installments',
    'payments',
    'invoice_obligations',
    'message_events',
    'collection_cases',
    'collection_promises',
    'financial_tasks',
    'integration_connections',
    'import_runs'
  ]
  loop
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()',
      target_table
    );
  end loop;
end;
$$;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'patients',
    'patient_units',
    'payment_plans',
    'installments',
    'payments',
    'invoice_obligations',
    'message_events',
    'collection_cases',
    'collection_promises',
    'financial_tasks',
    'integration_connections'
  ]
  loop
    execute format(
      'create trigger write_audit_log after insert or update or delete on public.%I for each row execute function private.write_audit_log()',
      target_table
    );
  end loop;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

create view public.patient_directory
with (security_invoker = true)
as
select
  patient_unit.id as patient_unit_id,
  patient.id as patient_id,
  patient_unit.clinicorp_patient_id,
  patient.full_name,
  patient.cpf,
  patient.phone,
  patient.email,
  unit.id as unit_id,
  unit.code as unit_code,
  unit.name as unit_name,
  coalesce(active_plan.treatment, patient_unit.treatment) as treatment,
  active_plan.payment_method,
  active_plan.total_amount as plan_amount,
  active_plan.installment_count,
  active_plan.due_day,
  active_plan.start_date,
  coalesce(active_plan.issue_invoice_for_ir, patient.tax_receipt_ir) as tax_receipt_ir,
  coalesce(active_plan.invoice_frequency_override, unit.invoice_frequency) as invoice_frequency,
  patient.notes,
  patient_unit.is_active,
  patient.created_at,
  patient.updated_at
from public.patient_units patient_unit
join public.patients patient on patient.id = patient_unit.patient_id
join public.units unit on unit.id = patient_unit.unit_id
left join lateral (
  select plan.*
  from public.payment_plans plan
  where plan.patient_unit_id = patient_unit.id
    and plan.status = 'active'
    and plan.archived_at is null
  order by plan.created_at desc, plan.id desc
  limit 1
) active_plan on true;

create view public.invoice_queue
with (security_invoker = true)
as
select
  obligation.id,
  obligation.unit_id,
  unit.name as unit_name,
  patient.id as patient_id,
  patient.full_name as patient_name,
  patient.cpf,
  patient_unit.clinicorp_patient_id,
  obligation.payment_plan_id,
  obligation.period_start,
  obligation.period_end,
  obligation.competence,
  obligation.frequency,
  obligation.status,
  obligation.expected_amount,
  obligation.paid_amount,
  obligation.invoice_number,
  obligation.invoice_issued_at,
  obligation.responsible_user_id,
  obligation.notes,
  obligation.updated_at
from public.invoice_obligations obligation
join public.patient_units patient_unit on patient_unit.id = obligation.patient_unit_id
join public.patients patient on patient.id = patient_unit.patient_id
join public.units unit on unit.id = obligation.unit_id;

create view public.collection_queue
with (security_invoker = true)
as
select
  collection_case.id,
  collection_case.unit_id,
  unit.name as unit_name,
  patient.id as patient_id,
  patient.full_name as patient_name,
  patient.phone,
  patient_unit.clinicorp_patient_id,
  collection_case.installment_id,
  installment.due_date,
  greatest(installment.expected_amount - installment.paid_amount, 0) as open_amount,
  collection_case.eligible_at,
  collection_case.status,
  collection_case.responsible_user_id,
  collection_case.next_action_at,
  collection_case.protested_at,
  collection_case.notes,
  collection_case.updated_at
from public.collection_cases collection_case
join public.installments installment on installment.id = collection_case.installment_id
join public.patient_units patient_unit on patient_unit.id = collection_case.patient_unit_id
join public.patients patient on patient.id = patient_unit.patient_id
join public.units unit on unit.id = collection_case.unit_id;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'units',
    'staff_invitations',
    'staff_invitation_units',
    'profiles',
    'profile_units',
    'patients',
    'patient_units',
    'payment_plans',
    'installments',
    'payments',
    'payment_events',
    'invoice_obligations',
    'invoice_obligation_payments',
    'message_events',
    'collection_cases',
    'collection_interactions',
    'collection_promises',
    'financial_tasks',
    'integration_connections',
    'sync_runs',
    'sync_events',
    'import_runs',
    'import_rows',
    'audit_logs'
  ]
  loop
    execute format('alter table public.%I enable row level security', target_table);
    execute format('alter table public.%I force row level security', target_table);
  end loop;
end;
$$;

create policy units_select_for_members
  on public.units for select to authenticated
  using ((select private.has_unit_access(id)));

create policy profiles_select_own_or_management
  on public.profiles for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.can_view_management_data())
  );

create policy profiles_update_own
  on public.profiles for update to authenticated
  using (user_id = (select auth.uid()) and is_active)
  with check (user_id = (select auth.uid()) and is_active);

create policy profile_units_select_own_or_management
  on public.profile_units for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.can_view_management_data())
  );

create policy profile_units_manage_access
  on public.profile_units for all to authenticated
  using ((select private.can_manage_access()))
  with check ((select private.can_manage_access()));

create policy staff_invitations_manage_access
  on public.staff_invitations for all to authenticated
  using ((select private.can_manage_access()))
  with check ((select private.can_manage_access()));

create policy staff_invitation_units_manage_access
  on public.staff_invitation_units for all to authenticated
  using ((select private.can_manage_access()))
  with check ((select private.can_manage_access()));

create policy patients_select_for_authorized_staff
  on public.patients for select to authenticated
  using (
    (select private.has_patient_access(id))
    or created_by = (select auth.uid())
  );

create policy patients_insert_for_authorized_staff
  on public.patients for insert to authenticated
  with check (
    (select private.current_user_active())
    and created_by = (select auth.uid())
  );

create policy patients_update_for_authorized_staff
  on public.patients for update to authenticated
  using (
    (select private.has_patient_access(id))
    or created_by = (select auth.uid())
  )
  with check (
    (select private.has_patient_access(id))
    or created_by = (select auth.uid())
  );

create policy patient_units_select_for_members
  on public.patient_units for select to authenticated
  using ((select private.has_unit_access(unit_id)));

create policy patient_units_insert_for_members
  on public.patient_units for insert to authenticated
  with check ((select private.has_unit_access(unit_id)));

create policy patient_units_update_for_members
  on public.patient_units for update to authenticated
  using ((select private.has_unit_access(unit_id)))
  with check ((select private.has_unit_access(unit_id)));

create policy payment_plans_select_for_members
  on public.payment_plans for select to authenticated
  using ((select private.has_unit_access(unit_id)));

create policy payment_plans_insert_for_members
  on public.payment_plans for insert to authenticated
  with check ((select private.has_unit_access(unit_id)));

create policy payment_plans_update_for_members
  on public.payment_plans for update to authenticated
  using ((select private.has_unit_access(unit_id)))
  with check ((select private.has_unit_access(unit_id)));

create policy installments_select_for_members
  on public.installments for select to authenticated
  using ((select private.has_unit_access(unit_id)));

create policy installments_insert_for_members
  on public.installments for insert to authenticated
  with check ((select private.has_unit_access(unit_id)));

create policy installments_update_for_members
  on public.installments for update to authenticated
  using ((select private.has_unit_access(unit_id)))
  with check ((select private.has_unit_access(unit_id)));

create policy payments_select_for_members
  on public.payments for select to authenticated
  using ((select private.has_unit_access(unit_id)));

create policy payments_insert_for_members
  on public.payments for insert to authenticated
  with check ((select private.has_unit_access(unit_id)));

create policy payments_update_for_members
  on public.payments for update to authenticated
  using ((select private.has_unit_access(unit_id)))
  with check ((select private.has_unit_access(unit_id)));

create policy payment_events_select_for_members
  on public.payment_events for select to authenticated
  using ((select private.has_unit_access(unit_id)));

create policy payment_events_insert_for_members
  on public.payment_events for insert to authenticated
  with check ((select private.has_unit_access(unit_id)));

create policy invoice_obligations_select_for_members
  on public.invoice_obligations for select to authenticated
  using ((select private.has_unit_access(unit_id)));

create policy invoice_obligations_insert_for_members
  on public.invoice_obligations for insert to authenticated
  with check ((select private.has_unit_access(unit_id)));

create policy invoice_obligations_update_for_members
  on public.invoice_obligations for update to authenticated
  using ((select private.has_unit_access(unit_id)))
  with check ((select private.has_unit_access(unit_id)));

create policy invoice_obligation_payments_select_for_members
  on public.invoice_obligation_payments for select to authenticated
  using ((select private.has_unit_access(unit_id)));

create policy invoice_obligation_payments_insert_for_members
  on public.invoice_obligation_payments for insert to authenticated
  with check ((select private.has_unit_access(unit_id)));

create policy invoice_obligation_payments_delete_for_members
  on public.invoice_obligation_payments for delete to authenticated
  using ((select private.has_unit_access(unit_id)));

create policy message_events_select_for_members
  on public.message_events for select to authenticated
  using ((select private.has_unit_access(unit_id)));

create policy message_events_insert_for_members
  on public.message_events for insert to authenticated
  with check ((select private.has_unit_access(unit_id)));

create policy message_events_update_for_members
  on public.message_events for update to authenticated
  using ((select private.has_unit_access(unit_id)))
  with check ((select private.has_unit_access(unit_id)));

create policy collection_cases_select_for_members
  on public.collection_cases for select to authenticated
  using ((select private.has_unit_access(unit_id)));

create policy collection_cases_insert_for_members
  on public.collection_cases for insert to authenticated
  with check ((select private.has_unit_access(unit_id)));

create policy collection_cases_update_for_members
  on public.collection_cases for update to authenticated
  using ((select private.has_unit_access(unit_id)))
  with check ((select private.has_unit_access(unit_id)));

create policy collection_interactions_select_for_members
  on public.collection_interactions for select to authenticated
  using ((select private.has_unit_access(unit_id)));

create policy collection_interactions_insert_for_members
  on public.collection_interactions for insert to authenticated
  with check (
    (select private.has_unit_access(unit_id))
    and performed_by = (select auth.uid())
  );

create policy collection_promises_select_for_members
  on public.collection_promises for select to authenticated
  using ((select private.has_unit_access(unit_id)));

create policy collection_promises_insert_for_members
  on public.collection_promises for insert to authenticated
  with check (
    (select private.has_unit_access(unit_id))
    and created_by = (select auth.uid())
  );

create policy collection_promises_update_for_members
  on public.collection_promises for update to authenticated
  using ((select private.has_unit_access(unit_id)))
  with check ((select private.has_unit_access(unit_id)));

create policy financial_tasks_select_for_members
  on public.financial_tasks for select to authenticated
  using ((select private.has_unit_access(unit_id)));

create policy financial_tasks_insert_for_members
  on public.financial_tasks for insert to authenticated
  with check ((select private.has_unit_access(unit_id)));

create policy financial_tasks_update_for_members
  on public.financial_tasks for update to authenticated
  using ((select private.has_unit_access(unit_id)))
  with check ((select private.has_unit_access(unit_id)));

create policy integration_connections_select_for_management
  on public.integration_connections for select to authenticated
  using (
    (select private.can_view_management_data())
    and (unit_id is null or (select private.has_unit_access(unit_id)))
  );

create policy integration_connections_manage_for_access_admins
  on public.integration_connections for all to authenticated
  using (
    (select private.can_manage_access())
    and (unit_id is null or (select private.has_unit_access(unit_id)))
  )
  with check (
    (select private.can_manage_access())
    and (unit_id is null or (select private.has_unit_access(unit_id)))
  );

create policy sync_runs_select_for_management
  on public.sync_runs for select to authenticated
  using (
    (select private.can_view_management_data())
    and (unit_id is null or (select private.has_unit_access(unit_id)))
  );

create policy sync_events_select_for_management
  on public.sync_events for select to authenticated
  using (
    (select private.can_view_management_data())
    and (unit_id is null or (select private.has_unit_access(unit_id)))
  );

create policy import_runs_select_for_members
  on public.import_runs for select to authenticated
  using ((select private.has_unit_access(unit_id)));

create policy import_runs_insert_for_members
  on public.import_runs for insert to authenticated
  with check (
    (select private.has_unit_access(unit_id))
    and created_by = (select auth.uid())
  );

create policy import_runs_update_for_members
  on public.import_runs for update to authenticated
  using ((select private.has_unit_access(unit_id)))
  with check ((select private.has_unit_access(unit_id)));

create policy import_rows_select_for_members
  on public.import_rows for select to authenticated
  using ((select private.has_unit_access(unit_id)));

create policy import_rows_insert_for_members
  on public.import_rows for insert to authenticated
  with check ((select private.has_unit_access(unit_id)));

create policy import_rows_update_for_members
  on public.import_rows for update to authenticated
  using ((select private.has_unit_access(unit_id)))
  with check ((select private.has_unit_access(unit_id)));

create policy audit_logs_select_for_management
  on public.audit_logs for select to authenticated
  using (
    (select private.can_view_management_data())
    and (unit_id is null or (select private.has_unit_access(unit_id)))
  );

revoke all on schema private from public, anon;
revoke all on all functions in schema private from public, anon, authenticated;

grant usage on schema private to authenticated, service_role;
grant execute on function private.current_user_active() to authenticated;
grant execute on function private.current_user_role() to authenticated;
grant execute on function private.has_unit_access(bigint) to authenticated;
grant execute on function private.has_patient_access(bigint) to authenticated;
grant execute on function private.can_manage_access() to authenticated;
grant execute on function private.can_view_management_data() to authenticated;
grant execute on all functions in schema private to service_role;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant usage on schema public to authenticated, service_role;

grant select on public.units to authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, last_unit_id) on public.profiles to authenticated;
grant select, insert, update, delete on public.profile_units to authenticated;
grant select, insert, update, delete on public.staff_invitations to authenticated;
grant select, insert, update, delete on public.staff_invitation_units to authenticated;

grant select, insert, update on public.patients to authenticated;
grant select, insert, update on public.patient_units to authenticated;
grant select, insert, update on public.payment_plans to authenticated;
grant select, insert, update on public.installments to authenticated;
grant select, insert, update on public.payments to authenticated;
grant select, insert on public.payment_events to authenticated;
grant select, insert, update on public.invoice_obligations to authenticated;
grant select, insert, delete on public.invoice_obligation_payments to authenticated;
grant select, insert, update on public.message_events to authenticated;
grant select, insert, update on public.collection_cases to authenticated;
grant select, insert on public.collection_interactions to authenticated;
grant select, insert, update on public.collection_promises to authenticated;
grant select, insert, update on public.financial_tasks to authenticated;
grant select, insert, update on public.integration_connections to authenticated;
grant select on public.sync_runs, public.sync_events to authenticated;
grant select, insert, update on public.import_runs, public.import_rows to authenticated;
grant select on public.audit_logs to authenticated;
grant select on public.patient_directory, public.invoice_queue, public.collection_queue to authenticated;

grant usage, select on all sequences in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

insert into public.units (
  code,
  name,
  city,
  invoice_frequency,
  invoice_cycle_mode
) values
  ('sorocaba', 'Sorocaba', 'Sorocaba', 'monthly', 'calendar'),
  (
    'salto_de_pirapora',
    'Salto de Pirapora',
    'Salto de Pirapora',
    'four_monthly',
    'pending_definition'
  );

insert into public.staff_invitations (email, full_name, role) values
  ('daiane@lyvrafinanceiro.com.br', 'Daiane', 'membro'),
  ('thaina@lyvrafinanceiro.com.br', 'Thaina', 'membro'),
  ('luciana@lyvrafinanceiro.com.br', 'Luciana', 'ceo'),
  ('mirelen@lyvrafinanceiro.com.br', 'Mirelen', 'gestora'),
  ('ana@lyvrafinanceiro.com.br', 'Ana', 'gestora'),
  ('maria.eduarda@lyvrafinanceiro.com.br', 'Maria Eduarda', 'suporte');

insert into public.staff_invitation_units (invitation_id, unit_id)
select invitation.id, unit.id
from public.staff_invitations invitation
cross join public.units unit;

comment on table public.financial_tasks is
  'Lembretes operacionais da equipe. A LYRVA não usa nível de prioridade; a ordem é definida pelo vencimento.';

comment on column public.units.invoice_cycle_mode is
  'Salto permanece pending_definition até a equipe confirmar se o quadrimestre é fixo ou individual por paciente.';

comment on column public.integration_connections.secret_reference is
  'Referência para segredo armazenado fora das tabelas públicas; nunca gravar token ou senha em texto aberto.';
