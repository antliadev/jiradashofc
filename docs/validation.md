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
