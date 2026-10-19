-- Conciliação leve e auditável: espelho financeiro da fonte != fila operacional D+3.
-- Apenas leitura. Não altera Clinicorp, parcelas, casos nem histórico.
CREATE OR REPLACE FUNCTION public.get_clinicorp_collection_reconciliation(
  p_unit_code text DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_month integer DEFAULT NULL,
  p_year integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_from date;
  v_to date;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT private.current_user_active() THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'Acesso financeiro não autorizado.';
  END IF;
  IF (p_month IS NOT NULL AND (p_month < 1 OR p_month > 12))
    OR (p_year IS NOT NULL AND (p_year < 2015 OR p_year > 2100)) THEN
    RAISE EXCEPTION 'Filtro de competência inválido.';
  END IF;

  v_from := COALESCE(p_date_from,
    CASE WHEN p_year IS NOT NULL THEN make_date(p_year, COALESCE(p_month, 1), 1) END);
  v_to := COALESCE(p_date_to,
    CASE WHEN p_year IS NOT NULL THEN
      (make_date(p_year, COALESCE(p_month, 12), 1) + INTERVAL '1 month - 1 day')::date END);

  IF v_from IS NULL OR v_to IS NULL THEN
    RETURN jsonb_build_object('available', false, 'reason', 'Selecione um ano ou um intervalo completo para conciliar.');
  END IF;
  IF v_from > v_to OR v_to - v_from > 366 THEN
    RETURN jsonb_build_object('available', false, 'reason', 'A conciliação aceita períodos de até 366 dias.');
  END IF;

  WITH allowed_units AS (
    SELECT u.id
    FROM public.units u
    WHERE u.is_active AND private.has_unit_access(u.id)
      AND (p_unit_code IS NULL OR p_unit_code IN ('', 'todas') OR u.code = p_unit_code)
  ),
  source AS (
    SELECT s.unit_id, s.clinicorp_payment_id, s.clinicorp_patient_id,
      s.due_date, s.amount, s.source_presence, s.source_presence_checked_at
    FROM public.clinicorp_payment_snapshot s
    JOIN allowed_units u ON u.id = s.unit_id
    WHERE s.due_date >= v_from
      AND s.due_date <= LEAST(v_to, v_today - 1)
      AND (p_month IS NULL OR EXTRACT(month FROM s.due_date) = p_month)
      AND (p_year IS NULL OR EXTRACT(year FROM s.due_date) = p_year)
      AND LOWER(s.payment_form) LIKE '%boleto%'
      AND NOT s.payment_received AND NOT s.payment_confirmed AND NOT s.cancelled
      AND s.amount > 0
  ),
  classified AS (
    SELECT s.amount, s.source_presence, s.source_presence_checked_at,
      CASE
        WHEN s.source_presence IS DISTINCT FROM 'present' THEN 'not_confirmed'
        WHEN i.id IS NULL OR i.source IS DISTINCT FROM 'clinicorp'
          OR i.clinicorp_source_state IS DISTINCT FROM 'open'
          OR i.status IN ('paid','cancelled','refunded')
          OR i.expected_amount IS DISTINCT FROM s.amount
          OR i.due_date IS DISTINCT FROM s.due_date
          OR i.paid_amount <> 0
          OR pp.source IS DISTINCT FROM 'clinicorp'
          OR pp.payment_method IS DISTINCT FROM 'boleto'
          OR pp.status IS DISTINCT FROM 'active'
          OR pp.archived_at IS NOT NULL
          OR pu.is_active IS DISTINCT FROM true
          OR pu.settled_at IS NOT NULL
          OR pu.clinicorp_patient_id IS DISTINCT FROM s.clinicorp_patient_id
          OR cc.id IS NULL OR cc.status IN ('paid','closed')
          THEN 'divergent'
        WHEN cc.eligible_at > v_today THEN 'waiting'
        ELSE 'in_collection'
      END AS bucket
    FROM source s
    LEFT JOIN public.installments i
      ON i.unit_id = s.unit_id AND i.clinicorp_installment_id = s.clinicorp_payment_id
    LEFT JOIN public.payment_plans pp ON pp.id = i.payment_plan_id AND pp.unit_id = i.unit_id
    LEFT JOIN public.patient_units pu ON pu.id = pp.patient_unit_id AND pu.unit_id = pp.unit_id
    LEFT JOIN public.collection_cases cc ON cc.installment_id = i.id AND cc.unit_id = i.unit_id
  )
  SELECT jsonb_build_object(
    'available', true,
    'from', v_from,
    'to', LEAST(v_to, v_today - 1),
    'clinicorpCount', COUNT(*) FILTER (WHERE source_presence = 'present'),
    'clinicorpAmount', COALESCE(SUM(amount) FILTER (WHERE source_presence = 'present'), 0),
    'inCollectionCount', COUNT(*) FILTER (WHERE bucket = 'in_collection'),
    'inCollectionAmount', COALESCE(SUM(amount) FILTER (WHERE bucket = 'in_collection'), 0),
    'waitingCount', COUNT(*) FILTER (WHERE bucket = 'waiting'),
    'waitingAmount', COALESCE(SUM(amount) FILTER (WHERE bucket = 'waiting'), 0),
    'divergentCount', COUNT(*) FILTER (WHERE bucket = 'divergent'),
    'divergentAmount', COALESCE(SUM(amount) FILTER (WHERE bucket = 'divergent'), 0),
    'notConfirmedCount', COUNT(*) FILTER (WHERE bucket = 'not_confirmed'),
    'notConfirmedAmount', COALESCE(SUM(amount) FILTER (WHERE bucket = 'not_confirmed'), 0),
    'oldestCheckedAt', MIN(source_presence_checked_at) FILTER (WHERE source_presence = 'present'),
    'lastCheckedAt', MAX(source_presence_checked_at) FILTER (WHERE source_presence = 'present')
  ) INTO v_result
  FROM classified;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_clinicorp_collection_reconciliation(text,date,date,integer,integer)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_clinicorp_collection_reconciliation(text,date,date,integer,integer)
  TO authenticated;