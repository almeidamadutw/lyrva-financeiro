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

### Aprovações

Tela da direção e das gestoras para revisar os lançamentos que exigem decisão. A fila começa com as diárias conferidas e mostra profissional, unidade, data e valor. Em **Revisar**, a gestora ou a direção pode aprovar para pagamento ou devolver ao financeiro com o motivo. O Painel da direção tem um atalho para a fila.

### Diárias

A tela mostra os dias da competência por profissional e unidade. Permite cadastrar regras, salvar pendências, validar o comparecimento com as duas assinaturas, registrar o pagamento já efetuado e consultar o histórico do dia. O resumo mostra **A pagar na unidade** e **A pagar para o profissional** em cartões separados. O valor pago ao profissional aparece abaixo do filtro individual.

O cadastro é feito uma vez por unidade e continua disponível nas próximas competências. **Arquivar profissional** retira o cadastro da lista ativa. **Arquivados** permite abrir as folhas anteriores, concluir lançamentos existentes e reativar o cadastro quando necessário. Os totais da unidade incluem os lançamentos dos profissionais arquivados.

No filtro **Profissional**, **Todos** mostra uma linha por profissional da unidade selecionada, com dias pendentes, valor a pagar e valor pago na competência. A opção **Abrir folha** leva aos lançamentos daquele profissional. A troca entre o resumo e a folha individual usa os dados já carregados.

Em remuneração por entrega ou procedimento, o botão **Calcular valores** fica abaixo do campo de valor e abre uma janela sobre o lançamento. A calculadora soma os itens conferidos por quantidade e transfere o total para a diária. Entregas usam valores da regra vigente. Procedimentos podem sugerir um valor de uma validação anterior.

Em **Valor fixo por serviço do dia**, selecione o serviço realizado no lançamento. A folha exibe o serviço e preenche o valor tabelado. Use **A confirmar** e **Salvar pendência** se ainda faltar definir o serviço ou o valor.

## Controle de Entrada de Vendas
Consulte [a tela e seus indicadores](entrada-de-vendas.md).
