# Visão geral do LYVRA

## Missão
Acompanhar obrigações financeiras das unidades Sorocaba e Salto de Pirapora, incluindo pacientes, parcelas, pagamentos, boletos, cobrança, emissão de notas e indicadores.

## Papéis
- Gestão financeira: carteira, indicadores e acompanhamento.
- Equipe de lembretes: preparação/verificação do vencimento.
- Cobrança: contato, negociação, promessa de pagamento e registro de desfecho.
- Suporte e liderança: administração de acessos, rastreio e incidentes conforme perfil.

## Limites
- O LYVRA organiza obrigações e apresenta dados locais reconciliados com o Clinicorp.
- A sincronização do Clinicorp não deve ser confundida com envio de mensagens e nem com emissão automática de nota fiscal.
- O sistema distingue **valor conhecido e confirmado** de **valor sob conferência**.
- Regras recentes ainda não implementadas devem permanecer em [pendências](08-pendencias.md), inclusive a proposta do módulo de diárias de profissionais.

## Fonte de verdade
Código da UI em `components/`, lógica de domínio em `lib/`, worker/Edge Functions em `supabase/functions/`, migrações em `supabase/migrations/`, testes em `tests/`.
