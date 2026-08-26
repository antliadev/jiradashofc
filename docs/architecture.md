# Arquitetura

## Visão Geral

O JiraDash opera com o fluxo Jira -> backend -> Supabase -> dashboards. O Jira é a origem externa dos dados, enquanto o Supabase mantém o estado operacional usado pela aplicação web e pelos relatórios.

## Camadas

1. Browser renderiza a SPA publicada na Vercel.
2. SPA chama somente endpoints `/api/*`.
3. Backend Express/Vercel valida sessão, perfil e permissões.
4. Backend acessa Jira e Supabase usando variáveis de ambiente do servidor.
5. Supabase armazena usuários, permissões, dados sincronizados e aplica RLS.

## Identidade E Sessão

1. Administrador convida o usuário pelo painel de acessos.
2. Backend usa Supabase Auth Admin para criar ou convidar em `auth.users`.
3. Perfil interno é persistido em `public.profiles`.
4. Usuário confirma o convite e define senha.
5. Login usa Supabase Auth.
6. Backend emite sessão via cookie `HttpOnly`.
7. Rotas protegidas validam sessão e permissões antes de retornar dados.

## Dados Jira

1. Sync busca os campos necessários no Jira.
2. Backend normaliza issues, comentários, changelog, worklogs e metadados.
3. Supabase recebe upserts e remoção/substituição de dados obsoletos.
4. Cache operacional é invalidado após sincronização bem-sucedida.
5. Dashboards leem Supabase/cache operacional, não o Jira diretamente.

## Restrições

- Chave privilegiada Supabase nunca chega ao browser.
- Comentários, descrições e worklogs são dados sensíveis.
- Listagens gerais devem evitar campos pesados sem necessidade.
- Rotas pesadas devem usar filtros, paginação ou seleção de projeto/período.
- Produção deve proteger todas as rotas `/api/jira/*` por sessão e permissão.
