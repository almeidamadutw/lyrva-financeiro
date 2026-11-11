# Arquitetura técnica

## Stack identificada
- React 19, Next.js/Vinext, Vite, TypeScript e Tailwind.
- Supabase (Postgres, autenticação, RLS e Edge Functions).
- Trabalhadores de integração Clinicorp e sincronização financeira.
- Interface modular em `components/`; helpers em `lib/`.
- Scripts de instalação, build, testes e diagnóstico no projeto.

## Camadas
```text
app/page.tsx                    # entrada do app
components/lyvra-app.tsx        # shell e menu
components/financial-journey.tsx
components/collections-journey-real.tsx
components/collection-analytics.tsx
components/payment-reminder-review.tsx
components/nf-workbook-import.tsx
components/clinicorp-sync-status.tsx
lib/collection-contact.ts
lib/collection-analytics.ts
supabase/functions/
  clinicorp-financial-sync/     # reconciliação durável
  clinicorp-auto-sync/          # conciliação periódica
  clinicorp-sync/               # integração de recebimentos
  access-auth/ e access-admin/ # identidade/administração
  whatsapp-webhook/             # infraestrutura de mensagens
supabase/migrations/            # contratos e políticas SQL
tests/                          # testes automáticos
```

## Separação de responsabilidades
- Frontend apresenta tarefas/estados; não deve ser fonte autoritativa de baixa.
- Backend/banco controla elegibilidade, identidade do título, pagamentos e acesso.
- Clinicorp é consultado por unidade e o resultado é reconciliado conservadoramente.
- Rotinas podem operar em cadências distintas; consultar [conferência Clinicorp](clinicorp-financial-recovery.md) antes de alterar o trabalhador.

## Segurança
Segredos de API somente em ambiente protegido. Revisões de banco precisam preservar RLS, vínculos de unidade e rastreabilidade.
