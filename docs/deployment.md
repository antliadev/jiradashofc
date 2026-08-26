# Deploy

## Produção

- URL: `https://jiradashofc.vercel.app`
- Branch de produção: `main`
- Plataforma: Vercel
- API: Vercel Functions em `/api/*`

## Homologação

- Branch de homologação/desenvolvimento: `develop`
- URLs de preview devem ser validadas antes de merge para `main`.

## Variáveis Vercel

Configurar no ambiente de produção:

- `AUTH_PROVIDER=supabase`
- `AUTH_REQUIRE_API_AUTH=true`
- `AUTH_REQUIRE_EMAIL_CONFIRMATION=true`
- `AUTH_ALLOWED_DOMAIN=antlia.com.br`
- `AUTH_ADMIN_EXCEPTION_EMAILS`
- `AUTH_SESSION_SECRET`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` ou `SUPABASE_SECRET_KEY`
- `JIRA_BASE_URL`
- `JIRA_EMAIL`
- `JIRA_API_TOKEN`
- `JIRA_JQL`
- `JIRA_ENCRYPTION_KEY`
- `CRON_SECRET`

Segredos devem ser cadastrados somente no painel/CLI da Vercel ou em secret manager aprovado.

## Pós-Deploy

Validar em produção:

- `GET /` retorna `200`.
- `GET /api/auth` sem sessão retorna `401`.
- `GET /api/jira/system/status` sem sessão retorna `401`.
- `GET /api/jira/dashboard` sem sessão retorna `401`.
- Login com domínio externo retorna `403`.
- Login com usuário Antlia confirmado retorna sessão com cookie `HttpOnly`, `Secure` e `SameSite=Lax`.
- Perfil `full` acessa gestão de usuários.
- Perfil `visualizacao` não acessa gestão de usuários nem sync.
- Supabase Security Advisor sem lints acionáveis.
- Logs de runtime sem segredos.

## Agendamento

O `vercel.json` define um cron a cada 30 minutos para:

- `/api/jira/sync/worker`

O endpoint valida `Authorization: Bearer CRON_SECRET`. A variável `CRON_SECRET` precisa estar configurada no ambiente de produção da Vercel.
