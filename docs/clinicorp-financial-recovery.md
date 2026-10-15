# Conferência financeira do Clinicorp

Implantação de 15/10/2026. A conferência inicial do histórico está em andamento; não representa certificação de igualdade de todo o banco.

## Operação automática

- `clinicorp-financial-sync` consulta um dia de criação por vez, no fuso de São Paulo. A resposta inteira é validada antes de aplicar valores.
- O banco guarda o conteúdo, a etapa e a posição confirmada. Cada transação aplica até 25 registros; interrupções retomam o conteúdo salvo.
- Uma concessão de dois minutos impede trabalhadores simultâneos. Tokens vencidos não podem confirmar alterações.
- O agendamento a cada 30 segundos só despacha quando há trabalho e nenhuma concessão ativa. O processamento tem orçamento de 42 segundos e não depende de uma tela aberta.
- As varreduras antigas de diretório, cobrança e reparo de histórico estão desativadas. A integração de recebimentos e notas continua separada.
- Datas com títulos ausentes no LYVRA e o período recente de cobrança têm prioridade. O restante do calendário desde 2015 também é coberto, inclusive dias sem registros locais.
- Ausência na fonte precisa de duas consultas independentes, separadas por pelo menos dois minutos. Ausência não equivale a pagamento.
- O Clinicorp continua sendo consultado somente para leitura. Nenhum envio de mensagem foi introduzido.
- Cada unidade tem intervalo persistente de 30 segundos entre consultas. Respostas 429 pausam a unidade inteira, com espera progressiva e respeito ao `Retry-After`; falhas de rede e servidor também recebem espera. Conteúdo já salvo pode continuar sendo aplicado durante a pausa, sem novas consultas.
- Pedidos de conferência ao abrir um caso recebem prioridade mesmo após uma consulta anterior bem-sucedida. Os dias atuais voltam à prioridade após 15 minutos; a reserva para histórico e a pausa da API continuam valendo.

## Valores e identidade

O ID externo exato, dentro da unidade, vincula cada parcela. Data e valor iguais não autorizam associar duas parcelas com IDs externos diferentes. Versões antigas não substituem versões mais recentes do snapshot. Cancelamento prevalece sobre flags de recebimento.

Uma linha validada corrige o valor, vencimento e situação da parcela. Recebimentos ficam preservados no livro de pagamentos; um recebimento isolado não redefine o total de um contrato. Planos técnicos deixam de sobrescrever preferências fiscais e totais de contratos compartilhados. Valores sem comprovação do contrato aparecem como a conferir. Na régua, títulos sem correspondência validada de ID, valor, vencimento e situação exibem “Em conferência”. O cartão identifica explicitamente totais parciais. Ao abrir um caso, a verificação recebe prioridade; registros de negociação exigem conferência de até cinco minutos também no banco.

O CPF do responsável financeiro só identifica o paciente quando o nome do responsável e o nome do paciente coincidem. Com identidades distintas, o paciente recebe vínculo pelo ID externo e permanece sem CPF próprio quando a fonte não o informa. Isso preserva o cadastro do responsável. A correção liberou o lote bloqueado de Sorocaba: 89 registros processados, 53 alterados e 30 vínculos antigos resolvidos, sem conflitos restantes para aquele paciente. Em 15/10 às 16:16, as duas unidades tinham zero dias financeiros prioritários sem primeira conferência; isso não certifica o histórico inteiro.

## Leitura da interface

A régua inicia no mês atual e aplica mês, ano e intervalo de vencimento no servidor, em páginas de 300 registros. A divisão Duda/Daiane considera todos os boletos vencidos do paciente na unidade, independentemente do período exibido. Contagens são devolvidas em um resultado JSON para evitar o limite padrão de linhas da API.

Pacientes e notas têm leitura paginada e ordenação estável, evitando totais ou listas cortados silenciosamente. Respostas de uma consulta anterior não substituem a unidade/período atual da régua. O aviso global informa a cobertura inicial e as tentativas pendentes.

## Acompanhamento

`public.get_clinicorp_sync_status(p_unit_code)` respeita as unidades do usuário autenticado. Detalhes operacionais e respostas completas ficam restritos ao serviço:

```sql
select unit_id,status,phase,count(*) as days,
  sum(returned_rows) as source_rows,max(last_error) as error
from private.clinicorp_sync_days
group by unit_id,status,phase;
```

Para pausar o novo trabalhador, um administrador pode definir `private.clinicorp_sync_control.enabled=false`. O conteúdo e a posição permanecem salvos. Não reativar as varreduras antigas junto com o novo trabalhador.

## Validação

Passaram a compilação Next.js de produção, TypeScript, oito testes do trabalhador e os testes existentes de acesso e integração. A validação transacional no banco confirmou importação de um título ausente, valor igual à fonte, repetição sem regravação financeira, rejeição de concessão inválida e conferência final, com rollback da massa de teste. Os RPCs de leitura foram comparados com a fila canônica e tiveram permissões verificadas.

A suíte antiga de verificações textuais da interface já apresentava três falhas no commit base. Foram reproduzidas sem as alterações deste pacote; não são evidência de falha nova de execução. A conferência inicial da base continua automaticamente após a publicação.

Na correção de limites e identidade, passaram 19 testes direcionados e a compilação Next.js/TypeScript. O teste transacional `tests/clinicorp-rate-and-identity.sql` verifica paciente distinto do responsável sem alterar seu cadastro, pausa isolada por unidade, rejeição de concessão inválida, aplicação de conteúdo salvo durante a pausa, permissão exclusiva do serviço e prioridade de nova conferência após sucesso recente. Todas as massas são revertidas. O trabalhador remoto está na versão 3.

A conferência final em dois lotes recentes comparou 122 boletos: 79 de Sorocaba e 43 de Salto de Pirapora. Não houve divergência de ID/vínculo, valor ou vencimento; os saldos da fonte e locais coincidiram em R$ 13.462,92 e R$ 9.687,50, respectivamente. Trata-se de amostra de lotes, não de todo o histórico. O banco também recusou, em teste com rollback, registrar uma interação após retirar a comprovação recente da parcela.
