-- A single JSON result avoids the API's default row cap on patient counts.
create or replace function public.get_overdue_boleto_count_map(p_unit_code text default null)
returns jsonb language sql stable security definer set search_path='' set statement_timeout='10s' as $fn$
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from public.get_overdue_boleto_counts(p_unit_code) t;
$fn$;
revoke all on function public.get_overdue_boleto_count_map(text) from public,anon;
grant execute on function public.get_overdue_boleto_count_map(text) to authenticated,service_role;
