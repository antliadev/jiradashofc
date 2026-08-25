# Arquitetura

## Objetivo

O JiraDash oficial deve manter o fluxo operacional Jira -> Supabase -> dashboards, mas com autenticação, autorização e RLS próprias da versão oficial.

## Camadas

1. Browser/Vite renderiza a SPA.
2. SPA chama somente endpoints `/api/*`.
3. Backend Express/Vercel valida sessão Supabase e permissões.
4. Backend acessa Supabase e Jira usando variáveis de ambiente.
5. Supabase guarda dados sincronizados e aplica RLS nas tabelas expostas.
6. Jira continua sendo fonte externa de origem.

## Fluxo De Identidade Alvo

1. Admin convida ou cria usuário pelo painel.
2. Backend usa Admin API do Supabase para criar/convidar o usuário em `auth.users`.
3. Perfil interno é criado em `public.profiles`.
4. Usuário confirma email.
5. Login usa Supabase Auth.
6. Backend valida sessão em todas as rotas protegidas.
7. RLS usa `auth.uid()` e permissões persistidas.

## Fluxo De Dados Jira

1. Sync busca campos necessários no Jira.
2. Backend normaliza dados.
3. Supabase recebe upsert de issues, worklogs, comentários e changelog necessários.
4. Registros obsoletos são removidos ou substituídos para manter a última sincronização ativa.
5. Cache de API é invalidado após sync.
6. Dashboards leem Supabase/cache operacional, não Jira diretamente.

## Restrições

- Service role nunca deve chegar ao browser.
- Comentários e descrições completas não devem ser enviados em listagens gerais.
- Home não deve carregar dataset global pesado.
- Rotas pesadas devem exigir filtros, paginação ou seleção de projeto/período.
