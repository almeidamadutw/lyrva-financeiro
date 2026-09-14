# LYVRA

Sistema financeiro interno da Casal Odonto para acompanhar pacientes, parcelas, baixas, cobrança, tarefas financeiras e obrigações de nota fiscal das unidades de Sorocaba e Salto de Pirapora.

## Escopo atual

- dashboard e Jornada Financeira alimentados por tarefas reais do banco;
- cadastro manual de pacientes e importação de planilha Excel com conferência antes da gravação;
- separação obrigatória de Sorocaba e Salto de Pirapora por paciente;
- geração automática de parcelas a partir do plano financeiro;
- controle de nota fiscal conforme forma de pagamento e cronograma do plano;
- lembrete D-1 de boleto atribuído à Maria Eduarda do financeiro;
- régua de cobrança de boleto em aberto iniciada em D+3 dias úteis e atribuída à Daiane;
- integração Clinicorp separada por unidade para leitura e baixa de pagamentos confirmados;
- banco PostgreSQL no Supabase com autenticação, perfis, RLS, auditoria e histórico de sincronização;
- integração com WhatsApp Business preparada como próxima fase, sem disparos automáticos antes da aprovação do roteiro e da configuração oficial da Meta.

## Regras principais

- boleto gera um único lembrete D-1;
- não há lembrete automático no dia do vencimento;
- se o boleto continuar em aberto, entra na régua da Daiane em D+3 dias úteis;
- o Clinicorp só considera uma baixa efetiva quando `PaymentConfirmed = X` e existe data de confirmação;
- a sincronização do Clinicorp não cria pacientes novos: ela vincula e atualiza apenas pacientes, planos e parcelas já existentes no LYVRA;
- nesta fase, a baixa automática do Clinicorp contempla boleto e cartão; outras formas são ignoradas e registradas no histórico da sincronização;
- quando uma parcela fica paga, lembretes D-1 e tarefas futuras de cobrança daquela parcela são cancelados;
- a emissão de NF é controlada pelo LYVRA, mas a emissão fiscal automática ainda não está ativa;
- não existe prioridade manual entre tarefas: a ordem operacional é determinada pelo prazo.

## Cadastro e importação

A planilha oficial pode conter pacientes de Sorocaba e Salto misturados. O importador lê as abas de cartão e boleto, reconhece `Paciente` como nome e recalcula os campos derivados no LYVRA em vez de confiar em fórmulas do Excel.

Quando a unidade não puder ser identificada de forma segura, o usuário deve selecionar Sorocaba ou Salto de Pirapora na conferência. O botão de importação permanece bloqueado enquanto houver paciente financeiramente válido sem unidade definida.

O CPF é a principal chave de duplicidade quando disponível. O sistema também usa identificadores do Clinicorp e dados do cadastro para impedir duplicações.

## Clinicorp

Cada unidade utiliza sua própria assinatura, Usuário API e Token API, armazenados somente nos segredos da Edge Function:

- `CLINICORP_SOROCABA_USERNAME` e `CLINICORP_SOROCABA_TOKEN`;
- `CLINICORP_SALTO_USERNAME` e `CLINICORP_SALTO_TOKEN`.

A Edge Function `clinicorp-sync` mantém as duas unidades separadas e possui dois modos operacionais:

1. **Ler últimos 7 dias**: diagnóstico somente leitura, sem persistir pacientes ou pagamentos;
2. **Sincronizar baixas**: processa pagamentos confirmados de boleto/cartão e tenta vinculá-los somente a registros já existentes no LYVRA.

O vínculo é conservador. Quando paciente ou parcela não possuem correspondência segura, o movimento é ignorado e o motivo fica registrado no histórico técnico, sem criar dados automaticamente.

## Jornada financeira

Fluxo operacional atual do boleto:

1. **D-1**: tarefa de lembrete para Maria Eduarda do financeiro;
2. **Dia do vencimento**: aguardar baixa, sem cobrança automática;
3. **D+3 dias úteis**: se ainda estiver em aberto, entrada automática na régua da Daiane;
4. **Após contato**: acompanhamento até pagamento, negociação ou encerramento;
5. **Pagamento confirmado**: parcela atualizada e tarefas futuras daquela cobrança canceladas.

## Desenvolvimento

Requisitos: Node.js 22.13 ou superior.

```bash
npm ci
npm run dev
```

Validação completa:

```bash
npm test
```

## Tecnologias

Next.js/Vinext, React, TypeScript, Tailwind CSS e Supabase (PostgreSQL + Auth + Edge Functions).

As migrações versionadas ficam em `supabase/migrations`. O navegador usa somente a chave publicável; credenciais do Clinicorp e demais segredos permanecem no servidor.

## Deploy

O `main` é publicado na Vercel. Antes de considerar uma versão pronta, o build/teste precisa passar e o deployment deve estar verde.

## Acessos e e-mails

- Login individual: `nome@lyvrafinanceiro`;
- `/ativar-acesso`: primeiro acesso por código temporário;
- `/nova-senha`: recuperação por código temporário;
- as caixas de recuperação das unidades permanecem separadas das identidades internas dos usuários;
- `access-auth` controla login, recuperação e limite de tentativas;
- `access-admin` controla criação de acesso, unidades liberadas e recuperação administrativa conforme função;
- senha e token nunca são exibidos nem armazenados no código do navegador.
