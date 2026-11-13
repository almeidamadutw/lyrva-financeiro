# Controle de Entrada de Vendas

1. Abra **Entrada de Vendas**, escolha a unidade e o mês.
2. Confira **Vendas negociadas no mês**, **Entradas recebidas no mês**, **Entradas em aberto com vencimento no mês** e os dois totais referentes ao saldo.
3. Localize uma negociação e abra **Parcelas**. Informe a data real e confirme o recebimento do valor integral da parcela conferida.
4. Use **Corrigir** ou **Estornar** para corrigir uma baixa, com o motivo. Use **Reprogramar** para atualizar o vencimento de um boleto em aberto. A tela do AVERA consulta o resultado ao atualizar.
5. Confira **Falta para aprovar** e a situação da aprovação. Ao atingir a entrada exigida, o orçamento aparece como apto para o responsável no AVERA.

## Indicadores

| Indicador | Critério |
| --- | --- |
| Vendas negociadas | Valor do orçamento, no mês em que a negociação foi registrada |
| Recebido | Somatório das baixas pelo dia efetivo do recebimento, com entrada e saldo em cartões próprios |
| Em aberto no mês | Boletos e valores no ato sem baixa, pelo vencimento |
| Ticket médio de entrada | Entradas confirmadas no mês ÷ número de pacientes distintos com baixa de entrada no mês |
| Meta, falta e percentual | R$ 80.000 para Salto de Pirapora, de junho a dezembro de 2026, conforme a planilha. A tela informa quando não há meta de referência |
| Faixa de entrada na venda | OK a partir de 30%, Atenção a partir de 20% e abaixo de 30%, Baixo abaixo de 20% |
| Apto para aprovação | Valor no ato e boletos da entrada confirmados suficientes para alcançar o percentual exigido naquela negociação |

A planilha **Controle de Entrada de Vendas** é referência para métricas e meta. Os cálculos usam o orçamento e as baixas do módulo. Algumas fórmulas das abas antigas referenciam colunas ou intervalos inconsistentes. O arquivo permanece como referência histórica, e seus valores requerem conferência antes de lançamento. O histórico de parcelas do Clinicorp continua no fluxo próprio de conciliação.

## Integração com o AVERA

As negociações chegam da aba **Entrada Programada**, com um vínculo por orçamento e unidade. As consultas e baixas usam o ID das parcelas do AVERA. A função verifica a sessão LYVRA e a unidade. Membro, gestora e CEO ativos podem operar em unidades atribuídas. Suporte tem leitura. Confirmações, correções, estornos e novos vencimentos são auditados. A tela registra a baixa manual e não emite títulos.
