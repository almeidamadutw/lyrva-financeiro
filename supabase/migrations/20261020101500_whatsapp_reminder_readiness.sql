-- Etapa de prévia: estado da conexão WhatsApp, sem expor tokens e sem enviar mensagens.
CREATE OR REPLACE FUNCTION public.get_whatsapp_reminder_readiness(p_unit_code text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = '' SET statement_timeout = '5s'
AS $$
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'code', u.code,
      'name', u.name,
      'connectionStatus', coalesce(c.status, 'not_configured'),
      'phoneConfigured', nullif(c.non_secret_config->>'phone_number_id','') IS NOT NULL,
      'wabaConfigured', nullif(c.non_secret_config->>'waba_id','') IS NOT NULL,
      'templateName', coalesce(nullif(c.non_secret_config->>'template_boleto_d1',''), 'boleto_d1'),
      'templateApproved', upper(coalesce(c.non_secret_config->>'template_boleto_d1_status','')) = 'APPROVED',
      'canTest', (
        c.status = 'connected'
        AND nullif(c.non_secret_config->>'phone_number_id','') IS NOT NULL
        AND nullif(c.non_secret_config->>'waba_id','') IS NOT NULL
        AND upper(coalesce(c.non_secret_config->>'template_boleto_d1_status','')) = 'APPROVED'
      )
    ) ORDER BY u.name
  ),'[]'::jsonb)
  FROM public.units u
  LEFT JOIN public.integration_connections c
    ON c.unit_id=u.id AND c.provider='whatsapp'
  WHERE u.is_active
    AND auth.uid() IS NOT NULL
    AND private.current_user_active()
    AND private.has_unit_access(u.id)
    AND (p_unit_code IS NULL OR p_unit_code IN ('todas','') OR u.code=p_unit_code);
$$;
REVOKE ALL ON FUNCTION public.get_whatsapp_reminder_readiness(text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.get_whatsapp_reminder_readiness(text) TO authenticated;