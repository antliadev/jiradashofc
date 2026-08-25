# JiraDash Oficial

Base oficial limpa do JiraDash para dashboards executivos, Kanban, relatórios de horas e auditoria de dados Jira da Antlia.

Este repositório foi iniciado a partir de uma auditoria do projeto legado em `/Users/PedroOliveira/Documents/repos/Dashboard-jira`. O legado continua sendo referência operacional, mas este repositório deve evoluir com arquitetura, segurança, documentação e esteira de qualidade próprias.

## Estado Atual

Fase atual: base oficial inicial.

Já preparado:

- Repositório limpo clonado de `https://github.com/antliadev/jiradashofc.git`.
- Código funcional do legado copiado sem artefatos gerados, cookies, `.env`, `.local-data` ou páginas temporárias.
- `.gitignore` e `.env.example` oficiais.
- Scripts de teste, build e lint.
- CI inicial com lint, teste, build, auditoria de dependências e varredura de segredos.
- Dependabot e configuração inicial de Sonar.

Ainda não concluído:

- Migração de autenticação para Supabase Auth.
- RLS final por perfis/permissões.
- Remoção completa do fallback legado de autenticação.
- Validação com Supabase oficial e Jira real.
- Deploy Vercel dev/prod.

## Stack

- Frontend: Vite + JavaScript.
- Backend: Node.js, Express e Vercel Functions.
- Banco/Auth alvo: Supabase.
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
- `develop`: desenvolvimento/homologação.

Alterações devem passar por CI antes de merge em `main`.

## Documentação

- [Arquitetura](docs/architecture.md)
- [Segurança](docs/security.md)
- [Banco de Dados](docs/database.md)
- [Regras de Negócio](docs/business-rules.md)
- [Operação](docs/operations.md)
- [Release](docs/release-process.md)
- [Plano de Implementação](docs/implementation-plan.md)
