# Regras de negócio e permissões

## Perfis
O código declara `membro`, `gestora`, `ceo` e `suporte`. O conjunto de telas é filtrado pelo perfil/área operacional; a permissão real também deve ser aplicada pelo backend e por RLS. Cada usuário acessa unidades autorizadas.

## Parcela e cobrança
- A documentação legada descreve um lembrete **D-1**, sem lembrete automático no vencimento, e início da cobrança em **D+3 dias úteis**. Qualquer alteração posterior desejada precisa ser conferida e implementada explicitamente, não alterada apenas neste documento.
- Pagamento informado por telefone **não** é baixa confirmada.
- Pagamento efetivo do Clinicorp requer marcadores de confirmação e identidade da parcela.
- Cancelados, quitados e status externos conflitantes exigem conferência e não cobrança automática.
- Um título pago cancela tarefas futuras de cobrança e lembrete daquele título.

## Unidade e identidade
- Separação obrigatória por unidade.
- Identificação por ID externo/CPF quando aplicável; não associar parcelas apenas por coincidência de valores e datas.
- Valores divergentes ficam com sinalização de conferência, sem mascarar indicadores parciais.

## Auditoria
Registrar ator, momento e desfecho de contato. Alterações de acesso e correções financeiras devem ser rastreáveis e respeitar autorização.

## Fiscal
Não marcar NF como emitida antes da emissão real.

## Diárias e pagamentos de profissionais

- Gestora e CEO acessam o módulo nas unidades ativas que já têm atribuídas. A equipe ativa de Lembretes, Cobrança, Notas fiscais e Suporte tem liberação para operar Diárias nas suas unidades atribuídas. A liberação dessas áreas é registrada por conta e unidade em `private.professional_pay_operators`. As tabelas e RPCs verificam esse acesso no banco.
- A fila de **Aprovações** e a decisão de aprovar são restritas aos perfis ativos **Gestora** e **CEO** nas unidades que cada conta acessa. Uma aprovação libera a baixa e registra responsável e data. A validação do comparecimento envia o lançamento à fila.
- Cada profissional tem uma linha por data e unidade. Dia em branco fica sem lançamento. Uma pendência pode registrar os vistos já conferidos e fica fora do total a pagar.
- O cadastro fica ativo entre competências. Arquivar ou reativar exige acesso ao módulo na unidade. Novos lançamentos exigem cadastro ativo. Os lançamentos já existentes continuam disponíveis para conferência, aprovação e registro de pagamento.
- A validação é manual e exige os dois vistos da folha física. O sistema seleciona a regra vigente na data. Na modalidade diária, planejamento selecionado tem prioridade, seguido da diária especial de sábado, quando configurada, e da diária comum. Procedimento e entrega exigem valor e descrição do serviço.
- O banco recalcula os itens da calculadora e confere o total enviado. Em entregas tabeladas, cada valor unitário precisa corresponder à regra vigente. Entregas sem tabela e pendências antigas por procedimento com valor avulso mantêm a opção manual.
- **Valor fixo por serviço do dia** aceita um serviço tabelado por lançamento diário na unidade. O valor independe da quantidade de atendimentos e é conferido pela regra vigente no banco. Dias sem serviço com valor confirmado podem ficar pendentes e ficam fora do valor a pagar e da fila de aprovação até a validação.
- Procedimentos sugerem o último valor unitário validado ou pago do mesmo nome para o profissional naquela unidade. Um valor ajustado passa a ser sugerido após validação. Pendências e cancelamentos ficam fora das sugestões.
- Alterações de regra preservam a versão aplicada em cada diária validada. Se a regra mudar durante uma conferência, o responsável precisa reabrir o dia e conferir o novo valor.
- O estado **Pago** exige um lançamento validado, aprovado e com a data efetiva do pagamento. O pagamento é realizado fora do módulo. Lançamentos pagos antes da implantação ficam preservados para auditoria. Os lançamentos validados ainda em aberto entram na fila. Reabrir um lançamento exige motivo, remove a aprovação anterior e requer nova conferência do visto financeiro.
