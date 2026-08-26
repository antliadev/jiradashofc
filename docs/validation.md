# Validação

## Comandos Locais

```bash
npm test
npm run lint
npm run build
npm audit --audit-level=moderate
```

## Varredura De Segredos

Antes de commit/push:

- confirmar que `.env` está ignorado;
- revisar arquivos staged;
- procurar tokens, JWTs, cookies, service keys e credenciais.

## Smoke Test Produção

```bash
curl -I https://jiradashofc.vercel.app/
curl -i https://jiradashofc.vercel.app/api/auth
curl -i https://jiradashofc.vercel.app/api/jira/system/status
curl -i https://jiradashofc.vercel.app/api/access/users
```

Resultados esperados sem sessão:

- `/`: `200`
- `/api/auth`: `401`
- `/api/jira/system/status`: `401`
- `/api/access/users`: `401`

## Evidência Produção - 2026-08-26

Deploy validado:

- Vercel deployment: `dpl_4qcJV4ReCrAfRddELPbJMDjSiX5Q`
- URL pública: `https://jiradashofc.vercel.app`

Resultados sem sessão:

- `GET /`: `200`
- `GET /api/debug`: `404`
- `GET /api/auth`: `401`
- `GET /api/jira/system/status`: `401`
- `GET /api/jira/dashboard`: `401`
- `GET /api/access/users`: `401`

Resultados com sessão `pedro.fernandes@antlia.com.br`:

- `POST /api/auth`: `200`
- cookies emitidos com `HttpOnly`, `Secure` e `SameSite=Lax`
- `GET /api/auth`: `200`
- `GET /api/access/users`: `200`
- `GET /api/jira/system/status`: `200`, Supabase `configured=true`, `privileged=true`
- `GET /api/jira/dashboard`: `200`, `3529` issues e `15` projetos
- Playwright autenticado carregou a home em produção sem erros de console

Bloqueios validados:

- Login com domínio externo retornou `403`.
- APIs protegidas retornaram `401` sem cookie de sessão.

Email:

- Supabase enviou email de redefinição de senha para `pedro.fernandes@antlia.com.br`.
- Gmail confirmou recebimento em `2026-08-26T13:16:43+00:00`, assunto `Reset your password`.

Limitações conhecidas:

- Conta Vercel Hobby não permite cron a cada 30 minutos; o sync recorrente exige upgrade para Vercel Pro ou scheduler externo.
- Supabase Security Advisor apontou `auth_leaked_password_protection` como `WARN`.

## Fluxos Manuais

- Login com email `@antlia.com.br` confirmado.
- Bloqueio de domínio externo.
- Bloqueio de usuário sem confirmação de email.
- Permissões por perfil.
- Acesso negado para APIs administrativas sem perfil `full`.
- Dashboard com filtro/projeto.
- Sync Jira com job registrado.
- Consulta de dados sensíveis somente por usuários autorizados.

## Banco

- RLS habilitado em tabelas públicas.
- Usuário anon sem acesso a tabelas sensíveis.
- Usuário comum sem acesso a auditoria.
- Service role escreve dados de sync.
- Advisors do Supabase sem lints de segurança acionáveis.
