# Plano De Implementação

## Fase 0 - Base Limpa

- Clonar `https://github.com/antliadev/jiradashofc.git`.
- Copiar apenas código ativo do legado.
- Remover artefatos temporários, cookies, `.env`, build e contexto antigo.
- Criar `.gitignore`, `.env.example`, documentação inicial e CI.
- Validar com comandos reais.

## Fase 1 - Inventário Técnico

- Revisar rotas e módulos copiados.
- Marcar código legado de auth para substituição.
- Mapear tabelas usadas.
- Confirmar payloads pesados.
- Manter testes existentes passando.

## Fase 2 - Supabase Auth

- Login Supabase Auth preparado no backend com cookie `HttpOnly`.
- Confirmação por email exigida por configuração.
- Bloqueio de domínio `@antlia.com.br` preparado no backend.
- Exceção admin documentável por `AUTH_ADMIN_EXCEPTION_EMAILS`.
- Convite de usuários via Supabase Auth Admin preparado no painel de acessos.
- Próximo passo: aplicar migration oficial no Supabase e validar fluxos reais.

## Fase 3 - Permissões E RLS

- Criar migrations de `profiles`, `roles`, `permissions`, `user_roles`, `role_permissions` e `audit_logs`.
- Implementar middleware de sessão/permissão.
- Aplicar RLS.
- Testar usuário comum, admin e sem permissão.

## Fase 4 - Performance

- Tornar home leve.
- Exigir filtros em telas pesadas.
- Paginar endpoints.
- Minimizar payloads.
- Criar ou validar índices.
- Medir antes/depois.

## Fase 5 - DevSecOps

- Refinar ESLint.
- Integrar Sonar escolhido.
- Configurar proteção de branch.
- Confirmar Dependabot e secret scanning.
- Preparar Vercel dev/prod.

## Fase 6 - Homologação E Produção

- Deploy dev por `develop`.
- Homologação com equipe.
- Correções em `develop`.
- Merge aprovado para `main`.
- Deploy produção e validação pós-deploy.
