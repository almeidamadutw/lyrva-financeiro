# Operação, validação e testes

## Requisitos
Node.js >= 22.13.0. Os comandos fazem parte do fluxo Vinext/Vite previsto em `package.json`.

```bash
npm run dev
npm run lint
npm test
```

`npm test` chama build e testes `tests/*.test.mjs`. Os scripts de instalação verificada e build têm lógica própria em `scripts/`; utilizar o fluxo documentado para o ambiente antes de forçar instalações concorrentes.

## Checklist de homologação
- Abrir com cada papel: membro, gestora, CEO e suporte.
- Validar filtro por unidade e perfis em frontend, funções e RLS.
- Simular uma parcela paga, atrasada, cancelada e divergente em ambiente de testes.
- Confirmar que pagamento informado não contabiliza baixa.
- Verificar as abas Todos/Hoje/Promessas/Negociações/Protestados.
- Conciliar notas fiscais com dados externos sem emissão duplicada.
- Testar logs, retentativas, limites e pausa do worker Clinicorp.
- Verificar que mensagens Meta não são disparadas indevidamente.

## Mudanças em integrações
Ler `docs/clinicorp-financial-recovery.md`, preservar checkpoints e executar testes do trabalhador antes de deploy. Migrações devem ser revisadas e reversões planejadas.

A publicação real e integridade financeira de toda a carteira não foram testadas nesta alteração documental.
