do $$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='import_patients'
  limit 1;

  if v_def is null then
    raise exception 'import_patients não encontrada';
  end if;

  v_old := '  v_was_existing boolean;';
  v_new := '  v_was_existing boolean;' || E'\n  v_plan_matches integer;';
  if position(v_old in v_def)=0 then raise exception 'declaração de import_patients não encontrada'; end if;
  v_def := replace(v_def,v_old,v_new);

  v_old := 'and lower(btrim(p.full_name))=lower(v_name)';
  v_new := 'and private.normalize_match_text(p.full_name)=private.normalize_match_text(v_name)';
  if position(v_old in v_def)=0 then raise exception 'comparação de nome antiga não encontrada'; end if;
  v_def := replace(v_def,v_old,v_new);

  v_old := E'      if v_payment_plan_id is null then\n        insert into public.payment_plans(';
  v_new := E'      if v_payment_plan_id is null then\n        select count(*), min(pp.id) into v_plan_matches, v_payment_plan_id\n        from public.payment_plans pp\n        where pp.unit_id=v_unit_id\n          and pp.patient_unit_id=v_patient_unit_id\n          and pp.archived_at is null\n          and pp.payment_method=v_payment_method\n          and pp.start_date=v_start_date\n          and pp.installment_count=v_installment_count\n          and abs(coalesce(pp.installment_amount,0)-coalesce(v_installment_amount,0)) <= 0.01;\n\n        if v_plan_matches > 1 then\n          raise exception using errcode=''22023'', message=''Mais de um plano existente corresponde a esta linha. Revise o paciente antes de importar.'';\n        end if;\n      end if;\n\n      if v_payment_plan_id is null then\n        insert into public.payment_plans(';
  if position(v_old in v_def)=0 then raise exception 'ponto de criação de plano não encontrado'; end if;
  v_def := replace(v_def,v_old,v_new);

  execute v_def;
end $$;
