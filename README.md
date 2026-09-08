# LYVRA

Sistema financeiro interno para acompanhar pagamentos, lembretes pelo WhatsApp e obrigações de emissão de notas fiscais da Casal Odonto.

## Escopo atual

- painel mensal de pagamentos e notas a emitir;
- controle mensal para Sorocaba e quadrimestral para Salto de Pirapora;
- cadastro único de pacientes por planilha Excel ou CSV;
- preparação para integração com Clinicorp e WhatsApp Business;
- banco PostgreSQL no Supabase com autenticação, perfis, unidades, RLS e auditoria;
- importação transacional de pacientes e planos, sem dados financeiros fictícios.

## Regras principais

- o lembrete do boleto é enviado somente um dia antes do vencimento;
- não há envio no vencimento ou depois dele;
- pagamento confirmado entra na fila de nota fiscal;
- pacientes permanecem recorrentes enquanto o tratamento estiver ativo;
- cobrança em aberto fica registrada no LYVRA, sem novo envio automático.

## Desenvolvimento

Requisitos: Node.js 22.13 ou superior.

```bash
npm ci
npm run dev
```

Para validar a versão de produção:

```bash
npm run build
```

## Tecnologias

Next.js/Vinext, React, TypeScript, Tailwind CSS e Supabase (PostgreSQL + Auth).

Projeto privado da Casal Odonto. Integrações externas permanecem desativadas até a configuração das credenciais oficiais.

As migrações versionadas estão em `supabase/migrations`. O cliente usa somente a chave publicável; todas as permissões de dados são aplicadas pelo RLS.

## Clinicorp

A primeira fase usa a Edge Function `clinicorp-sync` em modo somente leitura. Cada assinatura possui seu próprio Usuário API e Token API, armazenados apenas como segredos do servidor:

- `CLINICORP_SOROCABA_USERNAME` e `CLINICORP_SOROCABA_TOKEN`;
- `CLINICORP_SALTO_USERNAME` e `CLINICORP_SALTO_TOKEN`.

A função identifica o assinante e a clínica, mantém Sorocaba e Salto de Pirapora separadas e lê uma amostra de pagamentos sem persistir pacientes, parcelas ou baixas. A gravação automática só deve ser ativada depois da validação dos status reais retornados pela API.

## Deploy

- ChatGPT Sites/Cloudflare e Vercel: aplicação conectada ao mesmo projeto oficial do Supabase.
