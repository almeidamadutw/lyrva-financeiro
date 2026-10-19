-- Recovery for MIXED Clinicorp contracts only. Preserve every payment plan's method and value.
-- Database maintenance reopens only auto-cancelled D+3 cases with a freshly verified boleto source.
CREATE OR REPLACE FUNCTION private.reactivate_verified_mixed_boleto_cases(p_limit integer DEFAULT 20)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '' SET statement_timeout = '10s'
AS $function$
DECLARE v_restored integer := 0;
BEGIN
  WITH candidates AS MATERIALIZED (
    SELECT i.id
    FROM public.collection_cases cc
    JOIN public.installments i ON i.id = cc.installment_id AND i.unit_id = cc.unit_id
    JOIN public.payment_plans pp ON pp.id = i.payment_plan_id AND pp.unit_id = i.unit_id
    JOIN public.clinicorp_payment_snapshot s
      ON s.unit_id = i.unit_id AND s.clinicorp_payment_id = i.clinicorp_installment_id
    WHERE cc.status = 'closed'
      AND cc.outcome = 'cancelled'
      AND cc.notes LIKE '%Encerrado automaticamente: a Régua de Cobrança opera somente boletos em aberto no Clinicorp.%'
      AND cc.eligible_at <= (now() at time zone 'America/Sao_Paulo')::date
      AND i.due_date < (now() at time zone 'America/Sao_Paulo')::date
      AND i.source = 'clinicorp'
      AND i.clinicorp_source_state = 'open'
      AND i.status = 'overdue'
      AND pp.source = 'clinicorp'
      AND pp.payment_method <> 'boleto'
      AND pp.status = 'active'
      AND pp.archived_at IS NULL
      AND s.source_presence = 'present'
      AND s.source_presence_checked_at >= now() - interval '24 hours'
      AND private.clinicorp_verified_open_boleto_installment(i.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.collection_interactions ci WHERE ci.collection_case_id = cc.id
      )
    ORDER BY cc.eligible_at, i.id
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 20)
    FOR UPDATE OF i SKIP LOCKED
  ), repaired AS (
    UPDATE public.installments i
    SET clinicorp_source_state = i.clinicorp_source_state
    FROM candidates c
    WHERE i.id = c.id
    RETURNING i.id
  )
  SELECT count(*) INTO v_restored FROM repaired;
  RETURN v_restored;
END;
$function$;
REVOKE ALL ON FUNCTION private.reactivate_verified_mixed_boleto_cases(integer)
  FROM public, anon, authenticated;

DO $schedule$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lyvra_clinicorp_mixed_boleto_repair') THEN
    PERFORM cron.schedule(
      'lyvra_clinicorp_mixed_boleto_repair',
      '12 * * * *',
      'select private.reactivate_verified_mixed_boleto_cases(20);'
    );
  END IF;
END;
$schedule$;
