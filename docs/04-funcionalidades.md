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

### Não implementado nesta revisão
Módulo específico de **Diárias / Pagamentos de Profissionais** não apareceu na navegação verificada; é requisito a desenvolver e está registrado em `08-pendencias.md`.
