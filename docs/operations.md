# Operação

## Ambientes

- Produção: `https://jiradashofc.vercel.app`
- API: `https://jiradashofc.vercel.app/api/*`
- Desenvolvimento local: `http://localhost:5173` e `http://localhost:3001`

## Desenvolvimento Local

```bash
npm install
cp .env.example .env
npm run dev:all
```

Valores reais devem ficar somente em `.env` local ou em variáveis do ambiente de deploy.

## Validação Local

```bash
npm test
npm run lint
npm run build
npm audit --audit-level=moderate
```

## Sync Jira

O sync deve:

- usar credenciais somente no backend;
- validar conexão antes de sincronizar;
- registrar job;
- atualizar Supabase em lote;
- remover, substituir ou desativar dados obsoletos;
- invalidar cache ao finalizar;
- falhar com erro explícito quando a sincronização for incompleta.

## Monitoramento Operacional

Validar periodicamente:

- status do último job de sync;
- erros de runtime na Vercel;
- Supabase Advisors;
- falhas de autenticação;
- tentativas de acesso sem permissão;
- crescimento das tabelas sincronizadas;
- tempo de resposta das APIs pesadas.

## Troubleshooting

- Login indisponível: revisar Supabase Auth, `SUPABASE_ANON_KEY`, confirmação de email e domínio permitido.
- API retorna `401`: sessão ausente, expirada ou inválida.
- API retorna `403`: usuário autenticado sem permissão suficiente.
- Sync sem dados: revisar credenciais Jira, JQL, `CRON_SECRET` e último job.
- Dashboard vazio: confirmar último job de sync e tabelas Jira.
- Produção sem Supabase: revisar variáveis do projeto Vercel.
