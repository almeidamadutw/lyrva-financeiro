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
