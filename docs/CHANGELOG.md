# Histórico da documentação | LYVRA

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
