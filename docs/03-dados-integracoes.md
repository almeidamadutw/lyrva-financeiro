# Dados, integrações e consistência

## Entidades operacionais
Pacientes, planos/contratos financeiros, parcelas, pagamentos/baixas, obrigações fiscais, tarefas, cobranças, interações, promessas, usuários/perfis, unidades, integrações e auditoria. Para nomes exatos e cardinalidades, consultar as migrações SQL e as consultas da UI antes de modificar.

## Folha de ponto dos profissionais

O Supabase guarda o cadastro por unidade em `professional_pay_profiles`, as regras por vigência em `professional_pay_rules` e o lançamento de cada dia em `professional_attendance`. A regra e o valor em centavos são gravados na validação. `professional_attendance_history` guarda as versões do lançamento, com usuário e horário, em trilha própria. As alterações usam RPCs autenticadas e transações do PostgreSQL.

Os valores padrão de entrega e de serviço do dia ficam na versão da regra em `price_items`. Cada cálculo salvo guarda nome, quantidade e valor em `priced_items` no lançamento e no histórico. No modo `fixed_day`, a quantidade é sempre um e o valor corresponde ao serviço na tabela vigente. A RPC `get_professional_procedure_prices` consulta o último valor unitário validado ou pago de cada procedimento para o profissional e a unidade selecionados.

As diárias validadas sem `approved_at` entram na consulta paginada `get_pending_professional_pay_approvals`. A RPC `approve_professional_attendance` confere o perfil, a unidade e a revisão do lançamento, grava `approved_at` e `approved_by` e adiciona a decisão ao histórico na mesma transação. A regra de transição da folha exige aprovação para novos registros de pagamento.

A folha física é a fonte da conferência. O cadastro e a agenda do Clinicorp ficam fora desse fluxo nesta versão. Os lançamentos de profissionais são registrados nas tabelas próprias da folha.

## Clinicorp
- Integração separada por unidade; não cruzar Sorocaba e Salto por nome ou data.
- Consultas são de leitura e não autorizam escrever de volta no Clinicorp.
- A baixa de parcela depende de comprovante/estado confirmado na fonte, não de mera anotação de contato.
- O mecanismo conservador não deve duplicar pacientes/títulos nem unificar parcelas apenas por valor e data.
- Reconciliação do histórico usa controle de cursor, limite de API, concessão de trabalho e verificações de status externo. Detalhes em [clinicorp-financial-recovery.md](clinicorp-financial-recovery.md).

## Pagamentos e nota fiscal
Os estados financeiros e fiscais são persistidos no Supabase. A emissão de NF é acompanhada pelo sistema, mas **não está documentada como emissão fiscal automática ativa**.

## WhatsApp
Existem Edge Functions e infraestrutura de webhook/revisão para integração Meta. A existência do código **não equivale a disparo automatizado habilitado, aprovação de templates ou cobrança configurada**. Conferir ambiente, consentimento, template e logs antes de ativar.

## Proteção
CPF, telefone, valores, tokens e payloads de API são dados sensíveis. Não incluir amostras reais em commits, testes ou documentação.
