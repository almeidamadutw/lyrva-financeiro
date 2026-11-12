# Histórico da documentação | LYVRA

## 2026-11-12 — Cadastro de profissionais entre competências

- Formalizado o reaproveitamento do cadastro por unidade nas competências seguintes. Adicionadas as ações **Arquivar profissional** e **Reativar profissional**, com consulta dos lançamentos em **Arquivados** e registro na auditoria.
- A folha da unidade inclui as diárias de profissionais arquivados nos totais. Os lançamentos já abertos continuam disponíveis para conferência e pagamento.
- Código em `components/professional-pay.tsx` e migração `20261112180711_professional_pay_profile_archiving.sql`.
- Validados os builds Next.js e Vinext, os 49 testes da aplicação, o fluxo em DOM simulado e a regressão SQL isolada de virada de competência, arquivamento, auditoria e reativação.

## 2026-11-12 — Valor fixo por serviço do dia

- Adicionada a forma de remuneração **Valor fixo por serviço do dia**. O lançamento aceita um serviço tabelado e guarda o valor vigente com o histórico. A folha e a fila exibem o serviço selecionado.
- A opção **A confirmar** permite salvar uma pendência sem valor para conferência. Os lançamentos confirmados seguem a fila existente de aprovações.
- Código em `components/professional-pay.tsx` e migração `20261112173236_professional_pay_fixed_day_services.sql`.
- Validados os builds Next.js e Vinext, os 49 testes da aplicação, o formulário em DOM simulado e a regressão SQL isolada para preço tabelado, quantidade, pendência e aprovação.

## 2026-11-12 — Fila de aprovações

- Adicionada a tela **Aprovações** para perfis ativos CEO e Gestora, com filtro por unidade e atalho no Painel da direção. A primeira fila reúne diárias conferidas para aprovação ou devolução com motivo.
- Novos registros de pagamento exigem a aprovação da diária. A decisão guarda responsável, data e revisão. Reabrir exige nova conferência e nova aprovação. Os valores em aberto continuam nos totais com indicação do montante que aguarda decisão.
- Código em `components/finance-approvals.tsx` e `components/professional-pay.tsx`. Regra e consulta na migração `20261112125350_professional_pay_management_approval.sql`.
- Validados os builds Next.js e Vinext, os 49 testes da aplicação, a fila em DOM simulado, a regressão SQL isolada e a consulta em produção nos perfis CEO, Gestora e operacional.

## 2026-11-12 — Resumo de diárias e painel da direção

- Adicionado o filtro **Todos** em Diárias, com pendências e valores por profissional, e o cartão **A pagar para o profissional** na folha individual. A troca de profissional reaproveita a consulta da competência e unidade.
- Adicionado o **Painel da direção** como tela inicial do perfil CEO, com indicadores de notas fiscais e lembretes e os gráficos existentes de cobrança. Código em `components/professional-pay.tsx`, `components/lyvra-app.tsx` e `components/collection-analytics.tsx`.
- Validados os builds Next.js e Vinext, os 49 testes da aplicação, o filtro e os totais de diárias em DOM simulado e a consulta de cobrança em produção para o perfil CEO nas duas unidades.

## 2026-11-11 — Calculadora de entregas e procedimentos

- Adicionado **Calcular valores** abaixo do valor do lançamento, com seleção dos itens, quantidade e aplicação do total à diária. A validação continua exigindo descrição e as duas assinaturas.
- Entregas usam valores da regra vigente. Procedimentos sugerem o último valor unitário validado ou pago por profissional e unidade. Cada lançamento preserva seus itens, quantidades e valores unitários.
- Código em `components/professional-pay-calculator.tsx` e `components/professional-pay.tsx`. Regras de cálculo, armazenamento e consulta na migração `20261111184909_professional_pay_item_calculator.sql`.
- Validados os builds Next.js e Vinext, a checagem TypeScript, os 49 testes da aplicação, as interações da folha em DOM simulado e a regressão SQL isolada, incluindo valores alterados, sugestões e escopo de acesso.

## 2026-11-11 — Acesso da equipe a Diárias

- Liberado o módulo para as contas operacionais ativas de Lembretes, Cobrança e Notas fiscais nas unidades já atribuídas, por meio de `private.professional_pay_operators`.
- Confirmadas em produção as duas unidades retornadas por `get_professional_pay_units` para cada conta ativa, em transações de leitura no contexto autenticado de cada perfil.

## 2026-11-11 — Folha de ponto e diárias

- Adicionada a aba **Diárias** com folha mensal, conferência manual, regras com vigência e registro de pagamento.
- Adicionadas proteção de acesso por unidade, bloqueio de duplicidade, proteção do valor já validado e histórico de alterações.
- Código em `components/professional-pay.tsx` e migrações `20261111143255_professional_pay_attendance.sql` e `20261111143512_scope_professional_pay_operator_access.sql`.
- Validados os builds Next.js e Vinext, a checagem TypeScript, os 49 testes da aplicação e a regressão SQL em PostgreSQL local com dados sintéticos.

## 2026-11-11 — Documentação viva padronizada
- Preservado o conteúdo técnico anterior do README e incluído índice oficial.
- Criados capítulos de visão geral, arquitetura, Clinicorp/dados, telas, fluxos, regras, testes e backlog.
- Preservado `clinicorp-financial-recovery.md` como documento técnico de referência.
- Registrada a nova demanda de Diárias/Pagamentos de Profissionais como **planejada, não implementada**.
- Registrada necessidade de conciliar possíveis mudanças na regra de lembretes.
- Nenhum dado financeiro ou comportamento da aplicação foi alterado.

Atualizar este histórico com data, módulo, regra alterada, migração/função impactada e testes executados.
