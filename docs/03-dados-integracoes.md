# Dados, integrações e consistência

## Entidades operacionais
Pacientes, planos/contratos financeiros, parcelas, pagamentos/baixas, obrigações fiscais, tarefas, cobranças, interações, promessas, usuários/perfis, unidades, integrações e auditoria. Para nomes exatos e cardinalidades, consultar as migrações SQL e as consultas da UI antes de modificar.

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
