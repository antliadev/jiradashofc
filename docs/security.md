# Segurança

## Decisões Obrigatórias

- Identidade oficial via Supabase Auth.
- Email+senha com confirmação por email.
- Domínio permitido: `@antlia.com.br`.
- Exceção: conta administrativa geral existente, com auditoria e documentação.
- SSO/Microsoft fora desta fase.
- Perfis oficiais: `full`, `master`, `visualizacao`, `personalizado`.

## Estado Atual

O código inicial ainda contém fallback legado de autenticação para preservar funcionamento durante a migração. Esse fallback não possui credenciais padrão e exige variáveis explícitas. Ele deve ser substituído na fase de Auth.

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
