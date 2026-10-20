-- Contagem de candidatos para ensaio, sem destinatários e sem enviar nada.
CREATE OR REPLACE FUNCTION public.get_boleto_reminder_preflight(
  p_day date,
  p_unit_code text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = '' SET statement_timeout = '8s'
AS $fn$
DECLARE v_report jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT private.current_user_active() THEN
   RAISE EXCEPTION USING errcode='42501',message='Acesso não autorizado.';
 END IF;
 IF p_day IS NULL OR p_day < (now() at time zone 'America/Sao_Paulo')::date - 31
   OR p_day > (now() at time zone 'America/Sao_Paulo')::date + 31 THEN
   RETURN jsonb_build_object('available',false,'reason','Selecione uma data no intervalo de 31 dias.');
 END IF;
 WITH tasks AS (
   SELECT t.id,t.status as task_status,t.unit_id,i.id as installment_id,i.due_date,
          pu.is_active,pu.settled_at,coalesce(p.reminder_opt_out,false) AS opt_out_patient,
          coalesce(pu.reminder_opt_out,false) AS opt_out_unit,
          regexp_replace(coalesce(p.phone,''),'[^0-9]','','g') AS phone,
          pp.status AS plan_status,pp.archived_at AS plan_archived,
          private.clinicorp_verified_open_boleto_installment(i.id) as source_valid,
          s.source_presence_checked_at
   FROM public.financial_tasks t
   JOIN public.units u ON u.id=t.unit_id AND u.is_active
   JOIN public.installments i ON i.id=t.installment_id AND i.unit_id=t.unit_id
   JOIN public.payment_plans pp ON pp.id=i.payment_plan_id AND pp.unit_id=i.unit_id
   JOIN public.patient_units pu ON pu.id=pp.patient_unit_id AND pu.unit_id=t.unit_id
   JOIN public.patients p ON p.id=pu.patient_id
   LEFT JOIN public.clinicorp_payment_snapshot s
     ON s.unit_id=i.unit_id AND s.clinicorp_payment_id=i.clinicorp_installment_id
   WHERE t.kind='payment_reminder'
     AND t.status IN ('pending','in_progress')
     AND private.has_unit_access(t.unit_id)
     AND (p_unit_code IS NULL OR p_unit_code IN ('todas','') OR u.code=p_unit_code)
     AND (t.due_at AT TIME ZONE 'America/Sao_Paulo')::date=p_day
 ), classified AS (
 SELECT *,
   (task_status='pending' AND due_date=p_day+1 AND plan_status='active'
    AND plan_archived IS NULL AND is_active
    AND settled_at IS NULL AND NOT opt_out_patient AND NOT opt_out_unit
    AND source_valid
    AND source_presence_checked_at >= now()-interval '24 hours'
    AND (phone ~ '^55[1-9][0-9]{9,10}$' OR phone ~ '^[1-9][0-9]{9,10}$')
   ) as technically_eligible
 FROM tasks
 )
 SELECT jsonb_build_object(
   'available',true,'date',p_day,
   'totalTasks',count(*),
   'eligiblePreview',count(*) FILTER(WHERE technically_eligible),
   'missingPhone',count(*) FILTER(WHERE phone !~ '^55[1-9][0-9]{9,10}$' AND phone !~ '^[1-9][0-9]{9,10}$'),
   'sourceUnverified',count(*) FILTER(WHERE NOT source_valid OR source_presence_checked_at < now()-interval '24 hours' OR source_presence_checked_at IS NULL),
   'excluded',count(*) FILTER(WHERE opt_out_patient OR opt_out_unit OR settled_at IS NOT NULL OR NOT is_active),
   'wrongDay',count(*) FILTER(WHERE due_date<>p_day+1),
   'alreadyApproved',count(*) FILTER(WHERE task_status='in_progress')
 ) INTO v_report
 FROM classified;
 RETURN v_report;
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_boleto_reminder_preflight(date,text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.get_boleto_reminder_preflight(date,text) TO authenticated;