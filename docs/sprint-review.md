# Sprint Review (P1-1849)

## Referencias e escopo

Requisitos_Funcionais_Projetos_Sprint_Review_Revisado_v1.1.docx e
Projetos Sprint Review.html, anexos do P1-1849. O HTML e demonstrativo:
seus percentuais e cards nao sao fixtures de producao.

Skills aplicadas: DevPromptArchitect (requisitos, criterios e verificacao),
find-skills (descoberta local), architecture e webapp-testing.

## Arquitetura

- `src/data/sprint-review.js`: dominio puro compartilhado, sem chamadas de rede.
  Reconstrucao reversa por ID de campo e status, corte inclusivo, escopos
  separados, deltas, agrupamentos, confianca e Preflight.
- `lib/sprintReviewJira.js`: adapter Jira paginado, concorrencia limitada,
  retry de rate limit e timeout. Resolve projeto/board/sprint por ID.
- `lib/sprintReviewBaseline.js`: captura de baselines das sprints ativas apos
  sincronizacoes completas, somente para perfis configurados. Preserva os
  atributos reconstruidos no inicio, registrando tambem quando foram capturados.
- `lib/sprintReviewAI.js`: NVIDIA NIM, contexto humano filtrado, lotes limitados,
  citacao literal e IDs de evidencia obrigatorios. Sugestoes sao interpretacoes
  revisaveis; numeros e conclusoes incompatíveis sao rejeitados. Falhas mantem
  o texto deterministico. A cobertura parcial e explicitada.
- `lib/ai/`: politica executada pelo servidor, candidatos literais com contexto,
  schemas e verificador de suporte. Parafrases somente substituem a extracao
  quando recebem parecer de suporte; continuam exigindo revisao humana.
  Falha, duvida ou contradicao preservam a citacao atribuida, nao a parafrase.
  Parecer de outro modelo nao equivale a prova. Raciocinio interno nao e salvo.
- `lib/sprintReviewValidation.js`: reexecuta os calculos no servidor antes de
  aprovar. Nao aceita metricas enviadas pelo navegador. Confirma avisos,
  agrupamento, evidencias do goal e limites dos textos.
- `lib/sprintReviewStore.js`: registros append-only de regras, coleta, baseline,
  review e arte. Snapshot referencia fonte imutavel, regras e template.
- `server/routes/sprint-review.js`: mesma API no Express e na Vercel,
  autenticacao obrigatoria mesmo em desenvolvimento. Requer a permissao
  `projects.sprint-review`; regras exigem perfil Full.
- `src/pages/sprint-review.js`: selecao, configuracao, revisao, busca,
  paginacao 10/25/50/100, evidencias, links Jira, confirmacao e versoes.
- `src/utils/sprint-review-render.js`: template deterministico 1600x900,
  PNG 2400x1350, resumo executivo, datas e blocos revisaveis. Conteudo extenso
  usa continuacoes; todas as paginas sao geradas e persistidas antes do download.
- `lib/sprintReviewArt.js`: decodificacao real de PNG, CRC, limites de expansao,
  hashes e manifesto. Mesmo conteudo e idempotente; pagina divergente exige
  nova versao. O manifesto declara `semanticIntegrity: false`: validacao dos
  bytes nao comprova correspondencia visual com os dados aprovados.

## Decisoes

1. Nao consultar somente `sprint = ID`: isso pode omitir os removidos. A coleta
   inspeciona o historico de todo o projeto selecionado. Ela nao atualiza os
   demais modulos nem sincroniza o site inteiro. O custo depende do tamanho
   do projeto, nao apenas da sprint.
2. O baseline salvo tem preferencia. Sem ele, a reconstrução historica e
   explicita. Cards que se tornaram inacessiveis depois de um baseline salvo
   bloqueiam a aprovacao, em vez de diminuir silenciosamente o denominador.
3. Comparacoes usam instantes ISO com offset explicito. O timezone IANA do
   perfil e salvo e usado na apresentacao. Timestamp igual ao corte entra.
4. Comentarios editados apos o fechamento sao excluidos: a API nao oferece
   o corpo anterior com garantia historica. Nomes/contas/padroes de automacao
   e duplicatas sao filtrados antes de qualquer envio a NVIDIA.
5. Parent e filhos elegiveis nao entram juntos no denominador. A conclusao
   exige todos os cards obrigatorios. Adicionais nunca elevam o atingimento
   do baseline. O usuario confirma os agrupamentos sugeridos por parent.
6. Filtros de lista nao alteram os indicadores. Alterar agrupamento recalcula
   apenas a fonte ja coletada, sem consultar o Jira novamente.
7. Regerar textos usa a mesma coleta e cria outra fonte versionada. Alterar
   uma review aprovada exige criar nova versao. Nenhuma escrita ocorre no Jira.
8. Sem provedor/cota ou com resposta rejeitada, a review deterministica segue
   utilizavel. Nao existe sucesso simulado nem afirmacao de causa por status.
9. PNG e enviado ao servidor antes do download de cada pagina. Se falhar no
   meio, a exportacao reporta erro; arte incompleta nao e tratada como completa.
10. Bloqueio ocorrido e bloqueio vigente sao distintos. Destino de continuidade
    nao confirmado fica desconhecido, nao se converte em ausencia comprovada.
    Dados `current_only` sao visiveis como complemento, nao prova do fechamento.
11. Edicoes efetivas de textos exigem nova confirmacao e ficam identificadas
    como humanas, sem herdar verificacao automatica. O servidor recalcula fatos
    e a quantidade de paginas; nao confia no manifesto enviado pelo navegador.

## Configuracao e operacao

Aplicar `sql/migration-sprint-review.sql` no banco do ambiente. O armazenamento
tem RLS, sem grants diretos para anon/authenticated, somente leitura/insercao
para service_role e trigger que impede UPDATE/DELETE. Nao usar localStorage
para evidencias ou snapshots. A migration foi aplicada ao banco oficial e a
imutabilidade foi validada em transacao com rollback, sem deixar fixtures.

A revisao de integridade requer tambem
`sql/migration-sprint-review-art-integrity.sql`. Esta migration aditiva ainda
nao foi aplicada nesta implementacao local. Ela garante unicidade de pagina
v2 entre processos. Testes de concorrencia usam armazenamento simulado;
validar tambem em PostgreSQL antes da implantacao.
Versoes antigas sem manifesto nao sao regeneradas silenciosamente. O usuario
deve criar uma nova versao para usar o template atual; registros antigos nao
sao apagados. Somente o autor da aprovacao pode anexar a arte dessa versao.

Um usuario Full seleciona o projeto/board, configura os IDs de status,
tipos elegiveis, campo Sprint, checklist quando existir e agrupamento.
Status historicos desconhecidos aparecem para mapeamento depois da analise.
O usuario confirma os agrupamentos e os avisos antes de salvar/exportar.

Credenciais Jira seguem as variaveis de ambiente ja usadas pela sincronizacao
ou a conexao ativa. A API do modulo nao retorna tokens.

Para IA, configurar somente no servidor:

```
NVIDIA_API_KEY=<chave do ambiente>
NVIDIA_MODEL=nvidia/nemotron-3-super-120b-a12b
```

Nunca usar prefixo VITE_ nem armazenar chave em perfis/snapshots. A chave de
teste foi usada apenas em processos de validacao, nao persistida. Cotas e
disponibilidade do catalogo NVIDIA devem ser verificadas na conta; a API de
avaliacao nao deve ser presumida ilimitada nem ter SLA de producao.

Referencias oficiais verificadas:
- https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/
- https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/
- https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-super-120b-a12b-infer

## Criterios e evidencias

- Testes de dominio: baseline, adicional, removido, fechamento inclusivo,
  conclusao posterior, carry-over, 3/4 obrigatorios, parent/filhos, deltas,
  automacoes, comentario editado apos corte, duplicatas, confianca N/A,
  status desconhecido e historico incompleto.
- Testes de API: paginacao, retry, nao progresso, board trocado, inputs,
  perfil, permissao e rejeicao de metricas fornecidas pelo cliente.
- Testes de IA: evidencia inventada, conclusao indevida, percentuais,
  resposta fora do contrato, falta de chave, cota e indisponibilidade.
- `node tests/sprint-review.browser.js` com Vite local: selecao, links Jira,
  busca, tamanho de pagina, modal, Preflight, snapshot, PNG e viewport mobile.
  As respostas dessa suite sao sinteticas, sem sessao real.
- `node tests/sprint-review-front.browser.js`: composicao executiva equivalente
  a referencia, seis entregas em uma lamina, edicao, evidencias e responsividade.
- Testes adicionais: afirmacao sem relacao com citacao, verificacao de suporte
  indisponivel/contraditoria, metadados PNG comprimidos, streams concatenados,
  arquivos truncados, pagina divergente e edicao sem nova confirmacao.
- Validacao real, somente leitura, no DEVOPS board 643 / sprint 3278:
  coleta de 149 issues do projeto em aproximadamente 20 segundos; IDs e
  completeDate confirmados na API. Nao foi presumido o resultado ilustrativo
  do HTML. O perfil de teste nao foi salvo como configuracao de negocio.
- NVIDIA real com chave temporaria: resposta em aproximadamente 5 segundos,
  tres sugestoes aceitas, quatro rejeitadas, todas as aceitas rastreaveis;
  metricas identicas antes/depois. A cobertura parcial ficou sinalizada.
- APIs anonimas verificadas por HTTP: 401 para projetos, perfil, analise,
  sintese, snapshots e arte.

## Limites explicitos

- A chave definitiva NVIDIA e o perfil de negocio precisam ser configurados
  no ambiente. Os testes nao substituem a confirmacao humana das entregas
  principais. Nao ativar um mapeamento de teste como regra de producao.
- Captura automatica ocorre no ciclo de sync completo e reconstroi o instante
  inicial; nao e um webhook instantaneo de sprint_started. Falha tem aviso e
  fallback historico. O ciclo recorrente ainda exige acompanhamento operacional.
- A coleta historica nao recupera issues apagadas ou inacessiveis a conta Jira.
  Baseline anterior permite detectar ausencias conhecidas, mas nao revela
  retrospectivamente cards apagados antes de qualquer captura do RJA.
- Checklist implementado: campo textual com [x]/[ ]. Apps proprietarios sem
  mapeamento confiavel ficam N/A, ou geram aviso quando obrigatorios.
- Hibrido sugere parent e prefixos comuns de nomes, sempre com confirmacao
  manual. Nao usa embeddings para aproximar nomes semanticamente distintos.
  Excecao de pai/filho como entregas distintas exige perfil explicito em modo
  Card/Manual. Prioridades criticas limitam a classificacao, nao o percentual.
- Visao reprocessada com dados atuais possui corte, rotulo e fonte separados.
  Ela exige confirmacao e nunca substitui o snapshot historico existente.
- Goal admite avaliacao humana com evidencias e confirmacao separada antes
  de entrar na arte. A politica de IA atual se abstem de classificar o objetivo
  como atingido: pode sinalizar evidencia insuficiente, nunca aprova por lote.
  Faixas de confianca sao configuraveis no perfil.
- Textos excepcionalmente longos podem exigir ajuste manual de agrupamento;
  overflow bloqueia o download em vez de cortar o conteudo.
- A politica/verificador novos foram testados com transporte simulado. A
  qualidade com modelo real, latencia para 100 cards e homologacao autenticada
  precisam ser medidas no ambiente, com chave e perfil aprovados. Captura de
  baseline ainda depende do ciclo de sync; nao ha garantia de webhook imediato.
- Testes locais, integracoes pontuais e push nao equivalem a homologacao
  completa da interface autenticada em producao. Nao considerar o card
  integralmente concluido sem conferir estes limites com o responsavel.
