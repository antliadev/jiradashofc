# Padroes operacionais da tela de saude

Referencias internas: Cards/Issues e monitoramento (links Jira, filtros, ordenacao,
exportacao, estado vazio e sincronizacao scoped); Horas (paginacao e feedback).

- O score e as dimensoes usam todos os cards elegiveis do projeto. Os filtros
  alteram somente a lista de risco e a aba Cards pendentes do Excel.
- O Excel inclui todos os resultados filtrados e ordenados, mesmo fora da pagina
  atual. As abas de resumo conservam os totais completos, como indicado na tela.
- Atualizar sincroniza o projeto selecionado, pois limitar a pagina ou ao risco
  existente impediria descobrir novos riscos. A leitura posterior do cache do
  dashboard continua utilizando a API compartilhada existente.
- Se outra sincronizacao estiver rodando, sua conclusao nao e tratada como
  atualizacao deste projeto: o escopo e solicitado novamente. Job ausente,
  falha e timeout nunca exibem sucesso.
- A troca de tela durante a atualizacao nao permite que sua conclusao sobrescreva
  a pagina atual. Repeticao de cliques e bloqueada durante a requisicao.
- Configuracoes de pesos sao lidas por projeto, inclusive no resumo do portfolio.
- Historico e configuracoes locais continuam com a limitacao de persistencia
  no navegador documentada anteriormente; esta entrega nao migra esses dados.

Validacao: testes de filtros, ordenacao e contrato de sincronizacao em
`tests/health-list.test.js`; ensaio local Playwright com dados sinteticos para
digitacao continua, paginacao, links, download Excel, estados vazios, filtro por
responsavel e requisicao scoped. Viewport movel 390px sem overflow horizontal da
pagina. A chamada ao Jira real nao e executada pelo ensaio sintetico.
