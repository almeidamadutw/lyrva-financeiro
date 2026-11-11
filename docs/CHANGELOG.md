# Histórico da documentação | LYVRA

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
