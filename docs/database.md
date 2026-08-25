# Banco De Dados

## Supabase Oficial

Projeto alvo:

- `https://vzkiniwjhnhfximpfzuk.supabase.co`

## Modelo Alvo De Acesso

Tabelas a criar ou adaptar:

- `profiles`: perfil interno vinculado a `auth.users.id`.
- `roles`: perfis oficiais.
- `permissions`: permissões por módulo/ação.
- `user_roles`: vínculo de usuários com perfis.
- `role_permissions`: vínculo de perfis com permissões.
- `audit_logs`: auditoria administrativa.

Perfis oficiais:

- `full`
- `master`
- `visualizacao`
- `personalizado`

## Modelo Jira

Tabelas reaproveitáveis/adaptáveis:

- `jira_connections`
- `jira_issues`
- `jira_issue_comments`
- `jira_issue_changelog`
- `jira_worklogs`
- `jira_sync_jobs`

## Retenção

A versão oficial deve manter sempre a última sincronização ativa. A implementação pode usar upsert com remoção de obsoletos, snapshot ativo ou substituição transacional, desde que:

- não cresça sem necessidade;
- preserve auditoria mínima de sync;
- invalide cache após concluir;
- falhe de forma explícita quando a sincronização for incompleta.

## RLS

Todas as tabelas expostas devem ter RLS habilitado. Escritas sensíveis devem ser feitas apenas pelo backend com chave privilegiada ou por funções controladas.
