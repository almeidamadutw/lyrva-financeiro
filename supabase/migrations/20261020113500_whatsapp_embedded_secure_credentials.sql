-- Only the service role can use the encrypted credentials.
-- These entries are onboarding-stage only. No message dispatch is enabled here.
CREATE TABLE IF NOT EXISTS private.whatsapp_embedded_credentials (
  unit_id bigint PRIMARY KEY REFERENCES public.units(id) ON DELETE RESTRICT,
  waba_id text NOT NULL CHECK (waba_id ~ '^[0-9]{6,30}$'),
  phone_number_id text NOT NULL UNIQUE CHECK (phone_number_id ~ '^[0-9]{6,30}$'),
  phone_display text NOT NULL,
  token_cipher text NOT NULL,
  token_iv text NOT NULL,
  signup_event text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE private.whatsapp_embedded_credentials FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE private.whatsapp_embedded_credentials TO service_role;

-- Do not trust status labels or identifiers posted directly from the browser.
-- The Edge Function validates them against the Graph API before inserting.
COMMENT ON TABLE private.whatsapp_embedded_credentials IS
  'Meta Embedded Signup onboarding secrets, AES-GCM encrypted with server-only META_TOKEN_ENCRYPTION_KEY. Pending validation/test, never used for automated sends by default.';