revoke execute on function public.request_clinicorp_settlement(bigint,bigint,bigint) from public, anon;
revoke execute on function public.cancel_clinicorp_settlement_request(bigint,text) from public, anon;
grant execute on function public.request_clinicorp_settlement(bigint,bigint,bigint) to authenticated;
grant execute on function public.cancel_clinicorp_settlement_request(bigint,text) to authenticated;

alter view public.patient_settlement_status set (security_invoker = true);
alter view public.collection_queue set (security_invoker = true);
