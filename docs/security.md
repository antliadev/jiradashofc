# Segurança

## Modelo De Identidade

O JiraDash utiliza Supabase Auth como provedor de identidade. Sessões são mantidas por cookies `HttpOnly` emitidos pelo backend, e todas as rotas protegidas validam usuário, status do perfil e permissões antes de retornar dados.

Regras de acesso:

- autenticação por email e senha;
- confirmação por email obrigatória;
- domínio permitido: `@antlia.com.br`;
- exceções administrativas controladas por configuração;
- SSO/Microsoft fora do escopo atual;
- perfis oficiais: `full`, `master`, `visualizacao` e `personalizado`.

## Autorização

Permissões são aplicadas em três camadas:

- frontend: controla navegação e visibilidade de ações;
- backend: bloqueia APIs por sessão, perfil e permissão;
- banco: RLS protege tabelas expostas.

O frontend nunca é a única barreira de segurança.

## Dados Sensíveis

Comentários, descrições, worklogs, tokens, emails, logs e metadados do Jira devem ser tratados como dados sensíveis. APIs devem retornar apenas o necessário para cada tela.

Logs não podem expor:

- senhas;
- cookies;
- JWTs;
- tokens Jira;
- headers `Authorization`;
- `SUPABASE_SERVICE_ROLE_KEY`;
- `SUPABASE_SECRET_KEY`.

## Variáveis Obrigatórias Em Produção

- `AUTH_PROVIDER=supabase`
- `AUTH_REQUIRE_API_AUTH=true`
- `AUTH_REQUIRE_EMAIL_CONFIRMATION=true`
- `AUTH_ALLOWED_DOMAIN=antlia.com.br`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` ou `SUPABASE_SECRET_KEY`
- `AUTH_SESSION_SECRET`
- `JIRA_BASE_URL`
- `JIRA_EMAIL`
- `JIRA_API_TOKEN`
- `JIRA_JQL`
- `JIRA_ENCRYPTION_KEY`
- `CRON_SECRET`

## Checklist De Segurança

- `.env` ignorado pelo Git.
- Nenhum segredo em diff, README, docs, logs ou commits.
- Varredura de segredos antes de commit/push.
- Security Advisor do Supabase sem lints acionáveis.
- APIs Jira protegidas em produção mesmo se configuração de bypass existir por engano.
- `GET /api/auth` sem sessão retorna `401`.
- Rotas administrativas sem sessão retornam `401`.
- Usuário sem permissão recebe `403`.
- Domínio externo é bloqueado.
- Email não confirmado não autentica.
- RLS validado com usuário comum, admin e anon.
