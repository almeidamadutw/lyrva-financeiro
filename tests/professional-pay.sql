-- Run after the migration on an isolated LYVRA database. Fixtures are rolled back.
begin;

insert into public.staff_invitations (email, full_name, role) values
  ('professional-pay-manager@example.invalid', 'Gestão de teste', 'gestora'),
  ('professional-pay-executive@example.invalid', 'Direção de teste', 'ceo'),
  ('professional-pay-operator@example.invalid', 'Operador de teste', 'suporte'),
  ('professional-pay-member@example.invalid', 'Membro de teste', 'membro');
insert into public.staff_invitation_units (invitation_id, unit_id)
select i.id, u.id from public.staff_invitations i cross join public.units u
where i.email like 'professional-pay-%@example.invalid' and u.code in ('sorocaba', 'salto_de_pirapora')
  and (i.role <> 'ceo' or u.code = 'sorocaba');
insert into auth.users (id, email) values
  ('e0000000-0000-0000-0000-000000000001', 'professional-pay-manager@example.invalid'),
  ('e0000000-0000-0000-0000-000000000002', 'professional-pay-operator@example.invalid'),
  ('e0000000-0000-0000-0000-000000000003', 'professional-pay-member@example.invalid'),
  ('e0000000-0000-0000-0000-000000000004', 'professional-pay-executive@example.invalid');
insert into private.professional_pay_operators (user_id, unit_id)
select 'e0000000-0000-0000-0000-000000000002', id from public.units where code = 'sorocaba';

select set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', true);
set local role authenticated;

do $test$
declare
  unit_id_for_test bigint := (select id from public.get_professional_pay_units() where code = 'sorocaba');
  other_unit bigint := (select id from public.get_professional_pay_units() where code = 'salto_de_pirapora');
  professional bigint;
  variable_professional bigint;
  delivery_professional bigint;
  fixed_day_professional bigint;
  persistent_professional bigint;
  persistent_rule bigint;
  daily_rule bigint;
  updated_rule bigint;
  attendance bigint;
  priced_attendance bigint;
  input jsonb;
  rates jsonb := '{"name":"Profissional de teste","effective_from":"2026-01-01","mode":"daily","daily_cents":10000,"planning_cents":6000,"saturday_cents":7000}';
begin
  if unit_id_for_test is null or other_unit is null then raise exception 'Gestora sem acesso às unidades autorizadas.'; end if;
  professional := public.save_professional_pay_rule(unit_id_for_test, rates);
  perform public.save_professional_pay_rule(other_unit, rates);
  select id into strict daily_rule from public.professional_pay_rules where professional_id = professional;
  input := jsonb_build_object('professional_id', professional, 'work_date', '2026-11-07',
    'revision', 0, 'professional_signed', true, 'finance_signed', false, 'rule_id', daily_rule);
  attendance := public.save_professional_attendance(unit_id_for_test, 'pending', input);

  begin
    perform public.save_professional_attendance(unit_id_for_test, 'validate', input || '{"revision":1}');
    raise exception 'Ausência de assinatura aceita.';
  exception when raise_exception then
    if sqlerrm <> 'Confirme as assinaturas do profissional e do financeiro antes de validar.' then raise; end if;
  end;
  begin
    perform public.save_professional_attendance(unit_id_for_test, 'pay', input || '{"revision":1,"paid_on":"2026-11-09"}');
    raise exception 'Pendência marcada como paga.';
  exception when raise_exception then
    if sqlerrm <> 'Apenas lançamentos validados podem ser marcados como pagos.' then raise; end if;
  end;

  perform public.save_professional_attendance(unit_id_for_test, 'validate', input || '{"revision":1,"finance_signed":true}');
  if not exists (select 1 from public.professional_attendance where id = attendance and status = 'validated'
    and amount_cents = 7000 and service_kind = 'saturday' and paid_on is null) then
    raise exception 'Diária de sábado ou estado de validação incorreto.';
  end if;
  begin
    perform public.save_professional_attendance(unit_id_for_test, 'validate', input || '{"finance_signed":true}');
    raise exception 'Tentativa duplicada aceita.';
  exception when raise_exception then
    if sqlerrm <> 'Este dia foi alterado. Atualize a folha antes de continuar.' then raise; end if;
  end;

  perform public.save_professional_pay_rule(unit_id_for_test, rates || jsonb_build_object('professional_id', professional, 'daily_cents', 12000, 'saturday_cents', 9000));
  select max(id) into strict updated_rule from public.professional_pay_rules where professional_id = professional;
  if not exists (select 1 from public.get_pending_professional_pay_approvals('sorocaba') where id = attendance and amount_cents = 7000)
    or exists (select 1 from public.get_pending_professional_pay_approvals('salto_de_pirapora') where id = attendance) then
    raise exception 'Fila da gestão retornou unidade ou valor incorreto.';
  end if;
  begin
    perform public.save_professional_attendance(unit_id_for_test, 'pay', input || '{"revision":2,"paid_on":"2026-11-09"}');
    raise exception 'Pagamento aceito antes da aprovação.';
  exception when raise_exception then
    if sqlerrm <> 'Aguarde a aprovação da diária antes de registrar o pagamento.' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000002', true);
  if exists (select 1 from public.get_pending_professional_pay_approvals()) then
    raise exception 'Operador acessou a fila da gestão.';
  end if;
  begin
    perform public.approve_professional_attendance(unit_id_for_test, attendance, 2);
    raise exception 'Operador aprovou uma diária.';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', true);
  perform public.approve_professional_attendance(unit_id_for_test, attendance, 2);
  if exists (select 1 from public.get_pending_professional_pay_approvals() where id = attendance)
    or not exists (select 1 from public.professional_attendance_history where attendance_id = attendance
      and snapshot ->> 'approval_event' = 'approved' and actor_name = 'Gestão de teste') then
    raise exception 'Aprovação permaneceu na fila ou faltou a trilha de auditoria.';
  end if;
  begin
    perform public.approve_professional_attendance(unit_id_for_test, attendance, 2);
    raise exception 'Aprovação duplicada aceita.';
  exception when raise_exception then
    if sqlerrm <> 'A diária mudou ou já foi aprovada. Atualize a fila.' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000002', true);
  perform public.save_professional_attendance(unit_id_for_test, 'pay', input || '{"revision":3,"paid_on":"2026-11-09"}');
  perform set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', true);
  if not exists (select 1 from public.professional_attendance where id = attendance and status = 'paid'
    and amount_cents = 7000 and rule_id = daily_rule and paid_on = '2026-11-09' and approved_by is not null) then
    raise exception 'Reajuste alterou valor validado ou pagamento ficou incorreto.';
  end if;
  begin
    perform public.save_professional_attendance(unit_id_for_test, 'cancel', input || '{"revision":4,"reason":"Teste"}');
    raise exception 'Pagamento cancelado indevidamente.';
  exception when raise_exception then
    if sqlerrm <> 'Este lançamento não pode mudar para o status solicitado.' then raise; end if;
  end;
  if (select count(*) from public.professional_attendance_history where attendance_id = attendance) <> 4 then
    raise exception 'Trilha da diária incompleta.';
  end if;

  input := input || '{"work_date":"2026-11-09","finance_signed":true,"planning":true}';
  begin
    perform public.save_professional_attendance(unit_id_for_test, 'validate', input);
    raise exception 'Regra desatualizada aceita.';
  exception when raise_exception then
    if sqlerrm <> 'A regra desta data mudou. Reabra o lançamento e confira o valor.' then raise; end if;
  end;
  attendance := public.save_professional_attendance(unit_id_for_test, 'validate', input || jsonb_build_object('rule_id', updated_rule));
  if not exists (select 1 from public.professional_attendance where id = attendance and service_kind = 'planning' and amount_cents = 6000) then
    raise exception 'Valor de planejamento incorreto.';
  end if;
  perform set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000004', true);
  begin
    perform public.approve_professional_attendance(other_unit, attendance, 1);
    raise exception 'CEO aprovou fora da unidade atribuída.';
  exception when insufficient_privilege then null;
  end;
  perform public.approve_professional_attendance(unit_id_for_test, attendance, 1);
  perform set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', true);
  perform public.save_professional_attendance(unit_id_for_test, 'reopen', input || '{"revision":2,"reason":"Revisar papel"}');
  if exists (select 1 from public.professional_attendance where id = attendance and (approved_at is not null or approved_by is not null)) then
    raise exception 'Reabertura preservou uma aprovação anterior.';
  end if;
  perform public.save_professional_attendance(unit_id_for_test, 'cancel', input || '{"revision":3,"reason":"Linha incorreta"}');
  if not exists (select 1 from public.professional_attendance where id = attendance and status = 'cancelled' and amount_cents is null) then
    raise exception 'Cancelamento não retirou o valor em aberto.';
  end if;
  perform public.save_professional_attendance(unit_id_for_test, 'reopen', input || '{"revision":4,"reason":"Linha recuperada"}');
  if not exists (select 1 from public.professional_attendance where id = attendance and status = 'pending' and not finance_signed) then
    raise exception 'Reabertura liberou valor sem reconferência.';
  end if;

  variable_professional := public.save_professional_pay_rule(unit_id_for_test, '{"name":"Procedimento teste","effective_from":"2026-01-01","mode":"procedure"}');
  delivery_professional := public.save_professional_pay_rule(unit_id_for_test, '{"name":"Entrega teste","effective_from":"2026-01-01","mode":"delivery"}');
  for professional in select unnest(array[variable_professional, delivery_professional]) loop
    select id into strict updated_rule from public.professional_pay_rules where professional_id = professional;
    input := jsonb_build_object('professional_id', professional, 'work_date', '2026-11-09', 'revision', 0,
      'professional_signed', true, 'finance_signed', true, 'rule_id', updated_rule, 'amount_cents', 12345);
    begin
      perform public.save_professional_attendance(unit_id_for_test, 'validate', input);
      raise exception 'Remuneração variável sem descrição aceita.';
    exception when raise_exception then
      if sqlerrm <> 'Informe o valor e descreva o procedimento ou a entrega.' then raise; end if;
    end;
    attendance := public.save_professional_attendance(unit_id_for_test, 'validate', input || '{"notes":"Serviço de teste"}');
    if not exists (select 1 from public.professional_attendance where id = attendance and amount_cents = 12345
      and service_kind = case when professional = variable_professional then 'procedure' else 'delivery' end) then
      raise exception 'Lançamento variável incorreto.';
    end if;
  end loop;

  perform public.save_professional_pay_rule(unit_id_for_test, jsonb_build_object('professional_id', delivery_professional,
    'effective_from', '2026-01-01', 'mode', 'delivery', 'price_items',
    '[{"name":"Lente teste","unit_cents":30000},{"name":"Onlay teste","unit_cents":15000}]'::jsonb));
  select max(id) into updated_rule from public.professional_pay_rules where professional_id = delivery_professional;
  input := jsonb_build_object('professional_id', delivery_professional, 'work_date', '2026-11-10', 'revision', 0,
    'professional_signed', true, 'finance_signed', true, 'rule_id', updated_rule, 'notes', 'Entregas conferidas', 'amount_cents', 75000,
    'priced_items', '[{"name":"Lente teste","unit_cents":30000,"quantity":2},{"name":"Onlay teste","unit_cents":15000,"quantity":1}]'::jsonb);
  begin
    perform public.save_professional_attendance(unit_id_for_test, 'validate', input || '{"amount_cents":1}');
    raise exception 'Total adulterado aceito.';
  exception when raise_exception then
    if sqlerrm <> 'O total não corresponde aos itens da calculadora.' then raise; end if;
  end;
  begin
    perform public.save_professional_attendance(unit_id_for_test, 'validate', input || '{"priced_items":[{"name":"Lente teste","unit_cents":1,"quantity":1}]}');
    raise exception 'Valor unitário da entrega adulterado aceito.';
  exception when raise_exception then
    if sqlerrm <> 'A entrega ou o valor unitário não corresponde à regra desta data.' then raise; end if;
  end;
  begin
    perform public.save_professional_attendance(unit_id_for_test, 'validate', input - 'priced_items');
    raise exception 'Entrega tabelada aceita com valor manual.';
  exception when raise_exception then
    if sqlerrm <> 'Selecione as entregas conferidas na calculadora.' then raise; end if;
  end;
  priced_attendance := public.save_professional_attendance(unit_id_for_test, 'validate', input);
  if not exists (select 1 from public.professional_attendance a where a.id = priced_attendance
    and amount_cents = 75000 and priced_items = input -> 'priced_items') then
    raise exception 'Total ou itens de entrega incorretos.';
  end if;
  if not exists (select 1 from public.professional_attendance_history where attendance_id = priced_attendance
    and snapshot -> 'priced_items' = input -> 'priced_items') then
    raise exception 'Itens da entrega ausentes no histórico.';
  end if;

  select max(id) into updated_rule from public.professional_pay_rules where professional_id = variable_professional;
  input := jsonb_build_object('professional_id', variable_professional, 'work_date', '2026-11-10', 'revision', 0,
    'professional_signed', true, 'finance_signed', true, 'rule_id', updated_rule, 'notes', 'Procedimento conferido', 'amount_cents', 45690,
    'priced_items', '[{"name":"Procedimento reutilizável","unit_cents":22845,"quantity":2}]'::jsonb);
  priced_attendance := public.save_professional_attendance(unit_id_for_test, 'pending', input);
  if exists (select 1 from public.get_professional_procedure_prices(unit_id_for_test, variable_professional)) then
    raise exception 'Pendência entrou no histórico de preços.';
  end if;
  perform public.save_professional_attendance(unit_id_for_test, 'validate', input || '{"revision":1}');
  if not exists (select 1 from public.get_professional_procedure_prices(unit_id_for_test, variable_professional)
    where name = 'Procedimento reutilizável' and unit_cents = 22845) then
    raise exception 'Procedimento validado não disponibilizou o valor unitário.';
  end if;
  if exists (select 1 from public.get_professional_procedure_prices(unit_id_for_test, delivery_professional)) then
    raise exception 'O histórico misturou procedimentos com entregas.';
  end if;
  perform public.save_professional_attendance(unit_id_for_test, 'validate', input || '{"work_date":"2026-11-11","amount_cents":25000,
    "priced_items":[{"name":"procedimento reutilizável","unit_cents":25000,"quantity":1}]}');
  if (select unit_cents from public.get_professional_procedure_prices(unit_id_for_test, variable_professional)) <> 25000 then
    raise exception 'Reajuste não foi sugerido para o próximo lançamento.';
  end if;
  if not exists (select 1 from public.professional_attendance where id = priced_attendance and amount_cents = 45690) then
    raise exception 'Novo valor alterou procedimento validado anteriormente.';
  end if;

  begin
    perform public.save_professional_pay_rule(unit_id_for_test, '{"name":"Regra vazia de teste","effective_from":"2026-01-01","mode":"fixed_day"}');
    raise exception 'Regra fixa sem tabela aceita.';
  exception when raise_exception then
    if sqlerrm <> 'Inclua ao menos um serviço com valor fixo.' then raise; end if;
  end;
  fixed_day_professional := public.save_professional_pay_rule(unit_id_for_test, '{"name":"Serviço fixo de teste","effective_from":"2026-01-01",
    "mode":"fixed_day","price_items":[{"name":"Serviço A","unit_cents":21500},{"name":"Serviço B","unit_cents":58500}]}');
  select id into strict updated_rule from public.professional_pay_rules where professional_id = fixed_day_professional;
  input := jsonb_build_object('professional_id', fixed_day_professional, 'work_date', '2026-11-07', 'revision', 0,
    'professional_signed', true, 'finance_signed', true, 'rule_id', updated_rule);
  attendance := public.save_professional_attendance(unit_id_for_test, 'pending', input || '{"notes":"Valor a confirmar"}');
  if not exists (select 1 from public.professional_attendance where id = attendance and status = 'pending'
    and service_kind = 'fixed_day' and amount_cents is null and proposed_amount_cents is null)
    or exists (select 1 from public.get_pending_professional_pay_approvals() where id = attendance) then
    raise exception 'Serviço sem valor confirmado entrou no financeiro.';
  end if;
  input := input || '{"revision":1}';
  begin
    perform public.save_professional_attendance(unit_id_for_test, 'validate', input || '{"amount_cents":21500}');
    raise exception 'Valor manual aceito em regra fixa.';
  exception when raise_exception then
    if sqlerrm <> 'Selecione o serviço do dia com valor confirmado.' then raise; end if;
  end;
  begin
    perform public.save_professional_attendance(unit_id_for_test, 'validate', input || '{"amount_cents":43000,
      "priced_items":[{"name":"Serviço A","unit_cents":21500,"quantity":2}]}');
    raise exception 'Serviço fixo foi multiplicado.';
  exception when raise_exception then
    if sqlerrm <> 'O valor fixo do serviço é cobrado uma vez no dia.' then raise; end if;
  end;
  begin
    perform public.save_professional_attendance(unit_id_for_test, 'validate', input || '{"amount_cents":80000,
      "priced_items":[{"name":"Serviço A","unit_cents":21500,"quantity":1},{"name":"Serviço B","unit_cents":58500,"quantity":1}]}');
    raise exception 'Dois serviços fixos somados no dia.';
  exception when raise_exception then
    if sqlerrm <> 'Selecione um único serviço para o dia.' then raise; end if;
  end;
  begin
    perform public.save_professional_attendance(unit_id_for_test, 'validate', input || '{"amount_cents":1,
      "priced_items":[{"name":"Serviço A","unit_cents":1,"quantity":1}]}');
    raise exception 'Valor fixo alterado no cliente.';
  exception when raise_exception then
    if sqlerrm <> 'O serviço ou o valor fixo não corresponde à regra desta data.' then raise; end if;
  end;
  perform public.save_professional_attendance(unit_id_for_test, 'validate', input || '{"amount_cents":21500,
    "priced_items":[{"name":"Serviço A","unit_cents":21500,"quantity":1}]}');
  priced_attendance := public.save_professional_attendance(unit_id_for_test, 'validate', input || '{"work_date":"2026-11-10","revision":0,
    "amount_cents":58500,"priced_items":[{"name":"Serviço B","unit_cents":58500,"quantity":1}]}');
  if not exists (select 1 from public.get_pending_professional_pay_approvals() where id = attendance and amount_cents = 21500)
    or not exists (select 1 from public.get_pending_professional_pay_approvals() where id = priced_attendance and amount_cents = 58500) then
    raise exception 'Serviço fixo não seguiu para aprovação pelo valor tabelado.';
  end if;

  rates := rates || '{"name":"Cadastro mensal de teste","effective_from":"2026-10-01"}';
  persistent_professional := public.save_professional_pay_rule(unit_id_for_test, rates);
  select id into strict persistent_rule from public.professional_pay_rules where professional_id = persistent_professional;
  input := jsonb_build_object('professional_id', persistent_professional, 'work_date', '2026-10-30', 'revision', 0,
    'professional_signed', true, 'finance_signed', true, 'rule_id', persistent_rule);
  perform public.save_professional_attendance(unit_id_for_test, 'validate', input);
  input := input || '{"work_date":"2026-11-02"}';
  attendance := public.save_professional_attendance(unit_id_for_test, 'validate', input);
  if (select count(*) from public.professional_attendance where professional_id = persistent_professional and rule_id = persistent_rule) <> 2 then
    raise exception 'Cadastro ou regra não foi reaproveitado na competência seguinte.';
  end if;

  perform public.set_professional_pay_profile_archived(unit_id_for_test, persistent_professional, true);
  perform public.set_professional_pay_profile_archived(unit_id_for_test, persistent_professional, true);
  if not exists (select 1 from public.professional_pay_profiles where id = persistent_professional and archived_at is not null)
    or not exists (select 1 from public.get_pending_professional_pay_approvals() where id = attendance) then
    raise exception 'Arquivamento não preservou a folha e o pagamento pendente.';
  end if;
  begin
    perform public.save_professional_attendance(unit_id_for_test, 'pending', input || '{"work_date":"2026-11-03"}');
    raise exception 'Novo lançamento aceito para profissional arquivado.';
  exception when raise_exception then
    if sqlerrm <> 'Reative o profissional para criar um novo lançamento.' then raise; end if;
  end;
  perform public.approve_professional_attendance(unit_id_for_test, attendance, 1);
  perform public.save_professional_attendance(unit_id_for_test, 'pay', input || '{"revision":2,"paid_on":"2026-11-03"}');
  perform public.set_professional_pay_profile_archived(unit_id_for_test, persistent_professional, false);
  perform public.save_professional_attendance(unit_id_for_test, 'pending', input || '{"work_date":"2026-11-03"}');
  if not exists (select 1 from public.professional_pay_profiles where id = persistent_professional and archived_at is null)
    or not exists (select 1 from public.professional_attendance where id = attendance and status = 'paid') then
    raise exception 'Reativação não preservou o cadastro e seu histórico.';
  end if;

  begin
    update public.professional_attendance set amount_cents = 1 where id = attendance;
    raise exception 'Escrita direta por usuário autenticado aceita.';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000002', true);
  if exists (select 1 from public.units)
    or (select count(*) from public.get_professional_pay_units()) <> 1
    or exists (select 1 from public.professional_pay_profiles where unit_id = other_unit) then
    raise exception 'Acesso delegado vazou dados de outra unidade.';
  end if;
  begin
    perform public.save_professional_pay_rule(other_unit, rates);
    raise exception 'Operador gravou fora da unidade liberada.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_professional_pay_profile_archived(other_unit, persistent_professional, true);
    raise exception 'Operador arquivou fora da unidade liberada.';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000003', true);
  if exists (select 1 from public.get_professional_pay_units())
    or exists (select 1 from public.get_professional_procedure_prices(unit_id_for_test, variable_professional))
    or exists (select 1 from public.professional_attendance)
    or exists (select 1 from public.professional_attendance_history) then
    raise exception 'Perfil financeiro sem permissão acessou a folha.';
  end if;
end
$test$;

reset role;
do $audit_test$
begin
  if (select count(*) from public.audit_logs a
    join public.professional_pay_profiles p on p.id::text = a.record_id and p.unit_id = a.unit_id
    where p.name = 'Cadastro mensal de teste' and a.table_name = 'professional_pay_profiles'
      and a.action = 'UPDATE' and a.actor_user_id = 'e0000000-0000-0000-0000-000000000001') <> 2 then
    raise exception 'Arquivamento e reativação devem gerar um evento de auditoria por mudança.';
  end if;
end
$audit_test$;
rollback;
