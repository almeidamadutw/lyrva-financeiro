-- Service-only commit after server exchanges code and verifies WABA and phone via Meta API.
CREATE OR REPLACE FUNCTION public.save_whatsapp_embedded_connection(
  p_unit_id bigint, p_waba_id text, p_phone_number_id text, p_phone_display text,
  p_token_cipher text, p_token_iv text, p_signup_event text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
 IF auth.role() <> 'service_role' THEN
   RAISE EXCEPTION USING errcode='42501',message='Integração restrita ao servidor.';
 END IF;
 IF p_waba_id !~ '^[0-9]{6,30}$' OR p_phone_number_id !~ '^[0-9]{6,30}$'
   OR p_token_cipher IS NULL OR p_token_iv IS NULL
   OR p_signup_event <> 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING' THEN
   RAISE EXCEPTION 'Resposta de cadastro incorporado inválida.';
 END IF;
 IF EXISTS (SELECT 1 FROM private.whatsapp_embedded_credentials c
            WHERE c.phone_number_id=p_phone_number_id AND c.unit_id<>p_unit_id) THEN
   RAISE EXCEPTION 'Este número já está vinculado a outra unidade.';
 END IF;
 INSERT INTO private.whatsapp_embedded_credentials(
   unit_id,waba_id,phone_number_id,phone_display,token_cipher,token_iv,signup_event
 ) VALUES (p_unit_id,p_waba_id,p_phone_number_id,p_phone_display,
           p_token_cipher,p_token_iv,p_signup_event)
 ON CONFLICT(unit_id) DO UPDATE SET
   waba_id=excluded.waba_id,phone_number_id=excluded.phone_number_id,
   phone_display=excluded.phone_display,token_cipher=excluded.token_cipher,
   token_iv=excluded.token_iv,signup_event=excluded.signup_event,updated_at=now();

 UPDATE public.integration_connections c
 SET status='pending', secret_reference=concat('private.whatsapp_embedded_credentials:',p_unit_id),
     non_secret_config=coalesce(c.non_secret_config,'{}'::jsonb) ||
       jsonb_build_object('waba_id',p_waba_id,'phone_number_id',p_phone_number_id,
          'phone_display',p_phone_display,'mode','coexistence',
          'onboarding_status','pending_internal_test','graph_version','v25.0',
          'configured_at',now()),
     last_error=NULL,updated_at=now()
 WHERE c.unit_id=p_unit_id AND c.provider='whatsapp';
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Conta WhatsApp da unidade não cadastrada.';
 END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.save_whatsapp_embedded_connection(bigint,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_whatsapp_embedded_connection(bigint,text,text,text,text,text,text) TO service_role;