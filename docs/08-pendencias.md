# Backlog e pendências

## Requisito novo: Diárias / Pagamentos de Profissionais
**Status: especificação inicial / não identificado como módulo implementado na navegação consultada em 2026-11-11.** Não lançar como entregue.

Objetivo: registrar comparecimento de dentistas/profissionais, unidade, data, tipo de serviço, diária ou regra de remuneração, assinaturas de comparecimento e aprovação do responsável financeiro. Valores de diárias e exceções devem ser configuráveis e versionados, jamais fixos em código. Evitar dupla contabilização por data/profissional/unidade; apoiar fechamento por competência e trilha de alterações. Regras nominais e tabelas de valores só entram em configuração operacional após revisão e autorização, sem expor remuneração individual em documentação pública.

### Critérios de aceite propostos
1. Perfis autorizados gerenciam profissionais e regras editáveis.
2. Check-in registra data, unidade, serviço e evidências de aprovação/assinatura.
3. Cálculo distingue diária comum, sábado, planejamento e exceção.
4. Alteração de tabela preserva histórico e não recalcula pagamentos fechados sem ação auditada.
5. Financeiro revisa e aprova antes de considerar pago.
6. Testes cobrem duplicidade, acesso, unidades, cancelamento e relatório.

## Outras pendências
| Item | Estado | Próxima ação |
| --- | --- | --- |
| Regra de envio de lembretes vs. últimos pedidos operacionais | A reconciliar | Confirmar regra vigente e alinhar código, templates e documentação |
| Integração WhatsApp Meta para disparos | Código de base presente; ativação a validar | Conferir aprovação, custo, consentimento e testes |
| Conciliação histórica Clinicorp | Processo documentado | Continuar monitorando cobertura e divergências |
| Emissão fiscal automatizada | Não considerada ativa | Desenhar integração segura e homologação |
| Rastreio de todas as rotinas e telas em produção | Não homologado nesta revisão | Executar smoke tests por papel/unidade |

Uma pendência só vira concluída com código publicado, verificação e registro no changelog.
