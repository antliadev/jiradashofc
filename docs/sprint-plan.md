# Sprint Plan

Implementação do requisito v1.1 de `Projetos > Sprint Plan`.

## Regras preservadas

- A sequência é resolvida por board, IDs e timestamps; nomes de sprint não determinam precedência.
- Sprint futura produz Draft; sprint ativa produz baseline no `startDate`; visão corrente mantém o baseline e registra deltas.
- A composição no instante do baseline vem do Jira/changelog. Um Sprint Review aprovado tem precedência apenas para evidências históricas do fechamento anterior.
- Cada unidade possui uma origem primária exclusiva: `carry_over`, `replanned_before_close` ou `new_planned`.
- Multissprint é atributo do carry-over. Proveniência de backlog/criação é atributo de item novo.
- Pendências anteriores fora da sprint alvo são exibidas separadamente e não somem do histórico.
- Comentários automáticos, duplicados e posteriores à janela de planejamento não entram nas evidências.
- A prontidão é determinística e independente de previsão de sucesso. Status não mapeado, histórico incompleto e denominador vazio bloqueiam aprovação.
- Continuidades podem ser repetidas visualmente na arte, mas cada unidade é contada uma única vez.
- A arte é HTML/CSS 16:9 e os fatos não dependem de IA.

## Persistência e segurança

`sql/migration-sprint-plan.sql` cria perfis e snapshots append-only com RLS. O navegador não acessa essas tabelas diretamente; as operações passam por sessão autenticada e autorização `projects.sprint-plan` no backend. Snapshots são idempotentes por usuário e `requestId`, e `UPDATE`/`DELETE` são bloqueados.

Antes de habilitar salvamento em um ambiente, aplique a migration com a credencial administrativa fora do repositório e valide leitura, criação idempotente, isolamento entre usuários e rejeição de alteração/remoção. A migration não é aplicada automaticamente pelo build.

## Validação

- Testes de domínio: classificação, fronteiras temporais, baseline imutável, deltas, prontidão e preflight.
- Testes de API: board/sprints, autenticação, rotas e propriedades da migration.
- Teste de navegador: seleção Projeto → Board → Sprint, abas, snapshot, responsividade e prévia 16:9 sem overflow.
- Validações globais: testes, lint, build, auditoria de dependências e inspeção do diff.

## Limites operacionais atuais

- A migration precisa ser aplicada e validada no Supabase de cada ambiente.
- A qualidade de dados depende do perfil correto de status, tipos elegíveis, timezone e campo de data executiva.
- Planos com conteúdo acima da capacidade de uma lâmina precisam de paginação visual adicional; itens não podem ser truncados nem removidos do denominador para caber.
