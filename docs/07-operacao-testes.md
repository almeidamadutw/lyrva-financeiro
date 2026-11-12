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

## Publicação de Diárias

1. Execute o build e os testes da aplicação. Valide `tests/professional-pay.sql` após aplicar as migrações `20261111143255_professional_pay_attendance.sql`, `20261111143512_scope_professional_pay_operator_access.sql`, `20261111184909_professional_pay_item_calculator.sql` e `20261112125350_professional_pay_management_approval.sql` em um banco isolado. Os lançamentos de teste são sintéticos e a transação usa rollback.
2. Aplique a migração aditiva antes de publicar a interface. Para liberar Diárias a uma conta de Lembretes, Cobrança, Notas fiscais ou Suporte, registre em `private.professional_pay_operators` as unidades ativas já atribuídas à conta. Confira o acesso pelo RPC `get_professional_pay_units` no contexto dessa conta.
3. Cadastre os profissionais e as regras aprovadas nas unidades em que trabalham, com as vigências correspondentes. Os valores são dados operacionais e ficam no ambiente da clínica.
4. Para reverter a publicação da interface, restaure a versão anterior e mantenha as tabelas e o histórico já registrado.
