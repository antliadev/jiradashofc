# JiraDash

JiraDash é a plataforma interna da Antlia para acompanhamento executivo e operacional de dados do Jira. O sistema reúne dashboards, indicadores de projetos, relatórios de horas, visão de cards, análise por profissionais e gestão de acessos.

O Jira permanece como origem externa dos dados. O backend sincroniza e normaliza as informações necessárias, o Supabase mantém o estado operacional usado pelas telas, e a interface web consome somente APIs protegidas do próprio sistema.

## Ambientes

- Produção: `https://jiradashofc.vercel.app`
- Aplicação web: SPA Vite publicada na Vercel.
- API: endpoints `/api/*` publicados no mesmo projeto Vercel.
- Banco/Auth: Supabase.

## Stack

- Frontend: Vite + JavaScript.
- Backend: Node.js, Express e Vercel Functions.
- Banco e autenticação: Supabase Auth, Postgres e RLS.
- Integração: Jira REST API v3.
- Qualidade: Node test runner, ESLint, npm audit, GitHub Actions, Gitleaks e Sonar.

## Comandos

```bash
npm install
npm run dev:all
npm test
npm run lint
npm run build
npm audit --audit-level=moderate
```

## Variáveis De Ambiente

Use `.env.example` como referência. Valores reais devem ficar somente em `.env` local, Vercel Environment Variables, GitHub Secrets ou Supabase Secret Manager.

Nunca versionar:

- senhas;
- tokens Jira;
- cookies;
- JWTs;
- logs reais;
- `SUPABASE_SERVICE_ROLE_KEY`;
- `SUPABASE_SECRET_KEY`.

## Branches

- `main`: produção.
- `develop`: desenvolvimento e homologação.

Alterações devem passar por validação local e CI antes de merge para `main`.

## Documentação

- [Produto](docs/product.md)
- [Arquitetura](docs/architecture.md)
- [Segurança](docs/security.md)
- [Banco de Dados](docs/database.md)
- [Regras de Negócio](docs/business-rules.md)
- [Operação](docs/operations.md)
- [Deploy](docs/deployment.md)
- [Release](docs/release-process.md)
- [Validação](docs/validation.md)
