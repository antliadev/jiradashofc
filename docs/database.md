# Banco De Dados

## Supabase

O JiraDash usa Supabase Postgres para armazenar perfis, permissões, auditoria administrativa e dados operacionais sincronizados do Jira.

Projeto:

- `https://vzkiniwjhnhfximpfzuk.supabase.co`

## Acesso E Permissões

Tabelas principais:

- `profiles`: perfil interno vinculado a `auth.users.id`.
- `roles`: perfis oficiais.
- `permissions`: permissões por módulo/ação.
- `user_roles`: vínculo de usuários com perfis.
- `role_permissions`: vínculo de perfis com permissões.
- `user_permissions`: permissões extras para perfil `personalizado`.
- `audit_logs`: auditoria administrativa.
- `user_effective_permissions`: view consolidada de permissões.

Perfis:

- `full`
- `master`
- `visualizacao`
- `personalizado`

## Dados Jira

Tabelas operacionais:

- `jira_connections`
- `jira_issues`
- `jira_issue_comments`
- `jira_issue_changelog`
- `jira_worklogs`
- `jira_sync_jobs`
- `jira_project_metadata`

## Retenção

O JiraDash mantém sempre a última sincronização como estado operacional ativo. A implementação deve:

- evitar crescimento desnecessário;
- preservar auditoria mínima de sync;
- invalidar cache após concluir;
- falhar de forma explícita quando a sincronização for incompleta.

## RLS

Todas as tabelas públicas expostas devem ter RLS habilitado. Escritas sensíveis devem ser feitas apenas pelo backend com chave privilegiada ou por funções controladas.

Migrations oficiais:

- [migration-official-core-jira-schema.sql](../sql/migration-official-core-jira-schema.sql)
- [migration-official-auth-rls.sql](../sql/migration-official-auth-rls.sql)
- [migration-official-advisor-fixes.sql](../sql/migration-official-advisor-fixes.sql)
