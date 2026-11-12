# Telas e funcionalidades

Menu identificado em `components/lyvra-app.tsx`:

| Tela | Objetivo | Estado |
| --- | --- | --- |
| Visão geral | Indicadores e prioridades do financeiro | Implementada no frontend |
| Jornada financeira | Tarefas operacionais por prazo e responsável | Implementada |
| Lembretes de boleto | Revisar remessas e pendências de vencimento | Implementada; envio externo requer confirmação de integração |
| Notas fiscais | Acompanhar obrigações e marcar emissão | Implementada; não emitir automaticamente por dedução |
| Régua de cobrança | Separar carteiras, contatos, negociações e promessas | Implementada |
| Gráficos | Para renegociar, dívida renegociada, quitados em atraso | Implementada com critérios descritos no README |
| Diárias | Conferir folha de ponto mensal, regras de remuneração, pendências e pagamentos de profissionais | Implementada para perfis autorizados por unidade |
| Pacientes | Buscar, conferir cadastro e situação financeira | Implementada |
| Gerenciar acessos | Perfis, unidades e ativação | Restrita |
| Central de suporte | Problemas e operações autorizadas | Restrita |
| Integrações | Clinicorp, status e diagnóstico | Depende de credenciais/ambiente |
| Importar planilha | Entrada assistida de registros com conferência | Presente no sistema |

### Régua de cobrança
A interface `components/collections-journey-real.tsx` separa:
- **Todos:** casos sem primeiro contato;
- **Hoje:** aguardando resposta;
- **Promessas:** pagamento com data combinada;
- **Negociações** e **Protestados:** situações específicas.

Além da lista filtrada, existe conferência de estado externo do Clinicorp para evitar cobrar valores incorretos.

### Gráficos
Não somar indicadores com bases distintas. Consultar critérios no README original e `lib/collection-analytics.ts`.

### Painel da direção

A tela inicial do perfil **CEO** mostra o acompanhamento de notas fiscais da competência atual, lembretes D-1 em aberto hoje e desempenho de cobrança. O filtro de unidade serve para a leitura consolidada ou por unidade atribuída. Os gráficos abrem no mês atual e permitem trocar o período.

### Diárias

A tela mostra os dias da competência por profissional e unidade. Permite cadastrar regras, salvar pendências, validar o comparecimento com as duas assinaturas, registrar o pagamento já efetuado e consultar o histórico do dia. O resumo mostra **A pagar na unidade** e **A pagar para o profissional** em cartões separados. O valor pago ao profissional aparece abaixo do filtro individual.

No filtro **Profissional**, **Todos** mostra uma linha por profissional da unidade selecionada, com dias pendentes, valor a pagar e valor pago na competência. A opção **Abrir folha** leva aos lançamentos daquele profissional. A troca entre o resumo e a folha individual usa os dados já carregados.

Em remuneração por entrega ou procedimento, o botão **Calcular valores** fica abaixo do campo de valor e abre uma janela sobre o lançamento. A calculadora soma os itens conferidos por quantidade e transfere o total para a diária. Entregas usam valores da regra vigente. Procedimentos podem sugerir um valor de uma validação anterior.
