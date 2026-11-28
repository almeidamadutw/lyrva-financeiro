# Histórico da documentação | LYVRA

## 2026-11-28 — Manutenção de dados da régua

O Supabase passou a usar limiares menores de autovacuum e autoanalyze para tarefas e casos de cobrança. A política de leitura de registros de integração reutiliza a identidade da sessão sem modificar seu escopo. O teste isolado conferiu quatro cenários de RLS: membro autorizado, outra unidade, autoria e perfil sem acesso financeiro. A migração foi aplicada no Supabase e os parâmetros foram conferidos no catálogo.


## 2026-11-27 — Confirmação de registro na Régua de cobrança

- O formulário fecha após a confirmação do registro e a tela atualiza a lista em segundo plano. Se a recarga automática atingir o tempo limite, a lista mantém os últimos dados recebidos. Código em `components/collections-journey-real.tsx`.
- Erros de gravação preservam a observação e os campos do formulário. A conferência do Clinicorp continua obrigatória e é renovada quando expira.
- Validados build Vinext, TypeScript, os 49 testes da aplicação e seis cenários de interface com dados sintéticos, incluindo falha da recarga após o salvamento e nova conferência do Clinicorp com o texto preservado.

## 2026-11-24 — Filtro de exatamente dois boletos vencidos

- A Régua de cobrança oferece **Exatamente 2 vencidos** no filtro **Boletos vencidos**, ao lado das carteiras existentes. Usa a contagem completa de boletos vencidos e abertos do paciente na unidade, independente do período da lista. Código em `components/collections-journey-real.tsx`.
- O filtro reaproveita os dados carregados e aplica-se às abas sem alterar responsável, histórico ou estado de protesto.
- Executados build Vinext, TypeScript e os 49 testes da aplicação. Um fluxo com dados fictícios em DOM simulado conferiu contagens de um, dois, três e quatro vencidos, duas páginas de banco, ambas as unidades, primeiro contato, aguardando resposta, promessas, limpeza do filtro e ausência de novas consultas ao alterná-lo.

## 2026-11-18 — Custo das leituras ao abrir o sistema

- A fila fiscal e os contadores do painel são carregados ao abrir **Visão geral** ou **Notas fiscais**. Eventos simultâneos de foco compartilham a leitura em andamento. Ao trocar de tela, a consulta anterior para de buscar páginas e de atualizar o estado.
- Os callbacks dos alertas permanecem estáveis durante atualizações dos dados. O alerta de tarefas aguarda a aba ficar visível para consultar novamente.
- A migração `20261118180011_reduce_financial_read_cost.sql` calcula as unidades permitidas uma vez por leitura de tarefas e adiciona índice para as notificações pendentes do responsável. A régua localiza o plano de cada parcela pela chave primária.
- Validados o build Vinext, os 49 testes existentes, TypeScript e um fluxo com dados fictícios de entrada, troca de telas, paginação e retomada de foco. `tests/financial-read-scope.sql` confirmou os mesmos IDs de tarefas autorizados para todos os perfis, conta desconhecida e sessão sem identidade.
- Em leituras de produção com o perfil da cobrança, 50 notificações responderam em 6 ms e a página do mês da régua respondeu em 2,7 s. Os registros e valores da régua foram comparados com a consulta anterior nas duas unidades e em páginas consolidadas.

## 2026-11-17 — Prioridade para os primeiros contatos da Duda

- A aba **Todos** da Régua de Cobrança exibe primeiro os pacientes da carteira da Duda que aguardam o primeiro contato. A ordem dentro de cada carteira segue a entrada na régua. Código em `components/collections-journey-real.tsx`.
- Validados o build Vinext, a checagem TypeScript e os 49 testes da aplicação. O teste com dados fictícios conferiu a prioridade entre páginas, os filtros de responsável e a mudança para **Hoje** ao registrar um contato aguardando resposta.

## 2026-11-17 — Carregamento da Régua de Cobrança

- A migração [speed_up_collection_queue](../supabase/migrations/20261117135835_speed_up_collection_queue.sql) resolve a elegibilidade pela unidade, pelo vínculo do paciente e pelo caso. A consulta busca a parcela correspondente e pagina antes de carregar os detalhes de exibição.
- Comparados os resultados completos e a ordem das páginas para Salto, Sorocaba e ambas as unidades. Em produção, as duas páginas sem filtros testadas com o perfil de cobrança responderam em 427 e 498 ms.
- Executados o build Vinext, os 49 testes da aplicação e `tests/collection-analytics.sql`. A conferência incluiu o total da fila, os estados de confirmação do Clinicorp e o acesso por perfil.

## 2026-11-13 — Controle de Entrada de Vendas

- Adicionado o [fluxo de entrada programada, baixas confirmadas e previsão de aprovação](entrada-de-vendas.md).
- Build Vinext e testes existentes da versão publicada executados. O cenário do banco do AVERA foi conferido com dados fictícios.

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
