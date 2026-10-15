-- Prefer actual contracts; a technical bill must not become the patient's treatment total.
create or replace view public.patient_directory with(security_invoker=true) as  SELECT pu.id AS patient_unit_id,
    p.id AS patient_id,
    pu.clinicorp_patient_id,
    p.full_name,
    p.cpf,
    p.phone,
    p.email,
    u.id AS unit_id,
    u.code AS unit_code,
    u.name AS unit_name,
    COALESCE(ap.treatment, pu.treatment) AS treatment,
    ap.payment_method,
    (case when coalesce(ap.metadata->>'clinicorp_receivable','false')='true' or coalesce(ap.metadata->>'clinicorp_sync_only','false')='true' or coalesce(ap.metadata->>'collection_only','false')='true' then null else ap.total_amount end)::numeric(14,2) AS plan_amount,
    ap.installment_count,
    ap.due_day,
    ap.start_date,
    COALESCE(ap.issue_invoice_for_ir, p.tax_receipt_ir) AS tax_receipt_ir,
    ap.invoice_frequency_override AS invoice_frequency,
    p.notes,
    pu.is_active,
    p.created_at,
    p.updated_at,
    ap.installment_amount,
    ap.end_date,
    ap.first_invoice_date,
    ap.invoice_interval_months,
    ap.invoice_schedule_mode,
    ap.invoice_recipient_name,
    ap.invoice_disabled,
    ap.invoice_disabled_reason,
    pu.settled_at,
    pu.settled_reason,
    COALESCE(pu.reminder_opt_out, false) OR COALESCE(p.reminder_opt_out, false) AS reminder_opt_out,
    COALESCE(pu.reminder_opt_out_reason, p.reminder_opt_out_reason) AS reminder_opt_out_reason
   FROM patient_units pu
     JOIN patients p ON p.id = pu.patient_id
     JOIN units u ON u.id = pu.unit_id
     LEFT JOIN LATERAL ( SELECT pp.id,
            pp.unit_id,
            pp.patient_unit_id,
            pp.clinicorp_contract_id,
            pp.treatment,
            pp.payment_method,
            pp.total_amount,
            pp.installment_count,
            pp.due_day,
            pp.start_date,
            pp.end_date,
            pp.issue_invoice_for_ir,
            pp.invoice_frequency_override,
            pp.status,
            pp.source,
            pp.metadata,
            pp.created_by,
            pp.updated_by,
            pp.archived_at,
            pp.created_at,
            pp.updated_at,
            pp.installment_amount,
            pp.first_invoice_date,
            pp.invoice_interval_months,
            pp.invoice_schedule_mode,
            pp.invoice_recipient_name,
            pp.invoice_disabled,
            pp.invoice_disabled_reason
           FROM payment_plans pp
          WHERE pp.patient_unit_id = pu.id AND pp.source = 'clinicorp'::text AND pp.archived_at IS NULL
          ORDER BY (coalesce(pp.metadata->>'clinicorp_receivable','false')='true' or coalesce(pp.metadata->>'clinicorp_sync_only','false')='true' or coalesce(pp.metadata->>'collection_only','false')='true'), (
                CASE
                    WHEN pp.status = 'active'::text THEN 0
                    ELSE 1
                END), pp.updated_at DESC, pp.id DESC
         LIMIT 1) ap ON true
  WHERE pu.is_active AND pu.clinicorp_patient_id IS NOT NULL;

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
    cc.next_action_at,cc.protested_at,cc.notes,i.status,cc.updated_at,s.source_presence_checked_at
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
