-- LYVRA: fila real da régua de cobrança para a interface da Daiane.

create or replace view public.collection_queue
with (security_invoker=true)
as
select
  cc.id,
  cc.unit_id,
  u.name as unit_name,
  p.id as patient_id,
  p.full_name as patient_name,
  p.phone,
  pu.clinicorp_patient_id,
  cc.installment_id,
  i.due_date,
  greatest(i.expected_amount - i.paid_amount, 0::numeric) as open_amount,
  cc.eligible_at,
  cc.status,
  cc.responsible_user_id,
  cc.next_action_at,
  cc.protested_at,
  cc.notes,
  cc.updated_at,
  u.code as unit_code,
  i.installment_number,
  i.expected_amount,
  i.paid_amount,
  i.status as installment_status,
  cc.outcome,
  coalesce(pr.full_name, 'Sem responsável') as responsible_name,
  cc.opened_at
from public.collection_cases cc
join public.installments i
  on i.id = cc.installment_id and i.unit_id = cc.unit_id
join public.patient_units pu
  on pu.id = cc.patient_unit_id and pu.unit_id = cc.unit_id
join public.patients p on p.id = pu.patient_id
join public.units u on u.id = cc.unit_id
left join public.profiles pr on pr.user_id = cc.responsible_user_id;

grant select on public.collection_queue to authenticated;

comment on view public.collection_queue is
  'Fila operacional da régua de cobrança com paciente, parcela, saldo aberto, prazo e responsável.';
