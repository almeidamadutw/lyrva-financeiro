# Política de documentação viva

## Definição de pronto
Todo novo recurso, correção relevante, regra financeira, fluxo de atendimento ou integração precisa de documentação alterada no mesmo commit/PR.

## Checklist
1. Atualizar `04-funcionalidades.md` e `05-fluxos.md` ao mudar UI/comportamento.
2. Revisar `03-dados-integracoes.md` e o documento especializado Clinicorp ao mudar sincronização, pagamentos, IDs e schemas.
3. Revisar `06-regras-permissoes.md` com qualquer regra de valor, prazo, unidade, status ou acesso.
4. Registrar validação, migrações, limitações e rollback em `07-operacao-testes.md`.
5. Marcar requisitos novos como planejados até a entrega; ajustar `08-pendencias.md`.
6. Escrever uma entrada datada no `CHANGELOG.md` e manter os índices válidos.

## Proteção de dados
Não subir nomes/CPF/telefone de pacientes, valores individuais reais, tokens, payloads financeiros ou planilhas com registros para o GitHub. Documentar regras abstratamente. Testes com massa sintética e sem disparos reais.

Markdown no repositório é a fonte viva; PDF apenas quando solicitado.
