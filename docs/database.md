# Banco De Dados

## Supabase Oficial

Projeto alvo:

- `https://vzkiniwjhnhfximpfzuk.supabase.co`

## Modelo Alvo De Acesso

Tabelas criadas pela migration oficial:

- `profiles`: perfil interno vinculado a `auth.users.id`.
- `roles`: perfis oficiais.
- `permissions`: permissões por módulo/ação.
- `user_roles`: vínculo de usuários com perfis.
- `role_permissions`: vínculo de perfis com permissões.
- `audit_logs`: auditoria administrativa.
- `user_permissions`: permissões extras para perfil `personalizado`.
- `user_effective_permissions`: view consolidada de permissões por perfil e usuário.

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

Migrations oficiais iniciais:

- [migration-official-core-jira-schema.sql](../sql/migration-official-core-jira-schema.sql)
- [migration-official-auth-rls.sql](../sql/migration-official-auth-rls.sql)
- [migration-official-advisor-fixes.sql](../sql/migration-official-advisor-fixes.sql)

Estado em 2026-08-25:

- migrations aplicadas no Supabase oficial: `official_core_jira_schema`, `official_auth_rls`, `official_advisor_fixes`;
- Advisor de segurança: sem lints;
- Advisor de performance: apenas `INFO` de índices ainda não utilizados em banco recém-criado, sem `WARN`/`ERROR` acionável após as correções.
