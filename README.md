# LYVRA

Sistema financeiro interno para acompanhar pagamentos, lembretes pelo WhatsApp e obrigações de emissão de notas fiscais da Casal Odonto.

## Escopo atual

- painel mensal de pagamentos e notas a emitir;
- controle mensal para Sorocaba e quadrimestral para Salto de Pirapora;
- cadastro único de pacientes por planilha Excel ou CSV;
- preparação para integração com Clinicorp e WhatsApp Business;
- banco de dados D1 para os pacientes importados.

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

Next.js/Vinext, React, TypeScript, Tailwind CSS, Cloudflare D1 e Drizzle ORM.

Projeto privado da Casal Odonto. Integrações externas permanecem desativadas até a configuração das credenciais oficiais.

## Deploy

- ChatGPT Sites/Cloudflare: aplicação completa com banco D1;
- Vercel: interface em modo demonstrativo até a conexão do banco definitivo;
- branch `main`: vinculada ao deploy automático de produção na Vercel.
