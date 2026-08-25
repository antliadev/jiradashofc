# Segurança

## Decisões Obrigatórias

- Identidade oficial via Supabase Auth.
- Email+senha com confirmação por email.
- Domínio permitido: `@antlia.com.br`.
- Exceção: conta administrativa geral existente, com auditoria e documentação.
- SSO/Microsoft fora desta fase.
- Perfis oficiais: `full`, `master`, `visualizacao`, `personalizado`.

## Estado Atual

O backend já foi preparado para usar Supabase Auth como provedor padrão (`AUTH_PROVIDER=supabase`) e emitir sessão em cookies `HttpOnly`. O fallback legado permanece apenas para transição controlada com `AUTH_PROVIDER=legacy`, sem credenciais padrão.

Para funcionar em ambiente real, o projeto precisa de:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` ou `SUPABASE_SECRET_KEY` somente no backend
- `AUTH_ALLOWED_DOMAIN=antlia.com.br`
- `AUTH_ADMIN_EXCEPTION_EMAILS` com a conta administrativa geral, se ela não for `@antlia.com.br`

## Controles Alvo

- Middleware backend valida sessão Supabase em toda rota protegida.
- Permissões são verificadas no frontend, backend e banco.
- `localStorage` pode guardar preferências visuais, mas não é fonte de verdade de acesso.
- Tabelas expostas usam RLS.
- Ações administrativas geram auditoria.
- Logs não podem expor tokens, cookies, senhas, JWTs, headers Authorization ou service-role keys.

## Dados Sensíveis

Comentários, descrições e worklogs do Jira devem ser tratados como potencialmente sensíveis. O acesso deve ser protegido por RLS, permissão backend e payload minimizado.

## Checklist De Segurança

- Nenhum segredo em diff.
- `.env` ignorado.
- Varredura de segredos antes de commit/push.
- `SUPABASE_SERVICE_ROLE_KEY` somente no backend.
- Security Advisor do Supabase sem alerta crítico de RLS.
- Teste de domínio permitido e bloqueio de domínio externo.
- Teste de API protegida sem permissão.
- Teste de RLS com usuário comum e admin.

## Migration Oficial

A migration [migration-official-auth-rls.sql](../sql/migration-official-auth-rls.sql) define `profiles`, `roles`, `permissions`, `user_roles`, `role_permissions`, `user_permissions`, `audit_logs`, view de permissões efetivas e policies iniciais de RLS.

Não aplicar em produção sem:

- backup ou ambiente de homologação;
- chave backend privilegiada configurada;
- teste de usuário comum/admin;
- revisão do Security Advisor do Supabase.
