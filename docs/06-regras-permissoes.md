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

- Gestora e CEO acessam o módulo nas unidades ativas que já têm atribuídas. A equipe de operação pode receber liberação específica por unidade, em `private.professional_pay_operators`, vinculada à atribuição da unidade. As tabelas e RPCs verificam esse acesso no banco.
- Cada profissional tem uma linha por data e unidade. Dia em branco fica sem lançamento. Uma pendência pode registrar os vistos já conferidos e fica fora do total a pagar.
- A validação é manual e exige os dois vistos da folha física. O sistema seleciona a regra vigente na data. Na modalidade diária, planejamento selecionado tem prioridade, seguido da diária especial de sábado, quando configurada, e da diária comum. Procedimento e entrega exigem valor e descrição do serviço.
- Alterações de regra preservam a versão aplicada em cada diária validada. Se a regra mudar durante uma conferência, o responsável precisa reabrir o dia e conferir o novo valor.
- O estado **Pago** exige um lançamento validado e a data efetiva do pagamento. O pagamento é realizado fora do módulo. Lançamentos pagos ficam preservados para auditoria. Uma reabertura anterior ao pagamento exige motivo e nova conferência do visto financeiro.
