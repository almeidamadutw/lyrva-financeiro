alter function public.upsert_clinicorp_financial_directory(bigint,jsonb,bigint) set statement_timeout='60s';
alter function public.upsert_clinicorp_financial_structure(bigint,jsonb,boolean,bigint) set statement_timeout='60s';
alter function public.apply_clinicorp_confirmed_payments(bigint,jsonb,bigint) set statement_timeout='60s';