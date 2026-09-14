-- Mantém a marca atualizada também nas instalações que já executaram a base inicial.
comment on schema private is
  'Funções internas da LYVRA. Este schema não deve ser exposto pela Data API.';

comment on table public.financial_tasks is
  'Lembretes operacionais da equipe. A LYVRA não usa nível de prioridade; a ordem é definida pelo vencimento.';

do $$
declare
  definition text;
begin
  select pg_get_functiondef('private.handle_new_auth_user()'::regprocedure)
  into definition;

  if position('LYRVA' in definition) > 0 then
    execute replace(definition, 'LYRVA', 'LYVRA');
  end if;
end;
$$;
