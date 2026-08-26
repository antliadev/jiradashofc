# Notas Internas De Implementação

Este arquivo registra decisões e pendências técnicas de execução. Ele não faz parte da documentação principal do produto.

## Estado Operacional

- Branch de produção: `main`.
- Branch de desenvolvimento/homologação: `develop`.
- Produção pública: `https://jiradashofc.vercel.app`.
- Supabase oficial: `https://vzkiniwjhnhfximpfzuk.supabase.co`.

## Validações Registradas

- Migrations aplicadas no Supabase: `official_core_jira_schema`, `official_auth_rls`, `official_advisor_fixes`.
- Supabase Security Advisor: sem lints após as correções aplicadas.
- Perfil inicial criado para `pedro.fernandes@antlia.com.br` com perfil `full`.
- Convite recebido via Supabase Auth no Gmail conectado.

## Bloqueios De Produção

- Produção Vercel respondeu `supabase.configured=false` em `/api/jira/system/status`.
- Vercel conectado ao conector disponível não listou o projeto `jiradashofc`.
- Não há `.vercel/project.json` local para configurar variáveis via CLI neste workspace.

## Pendências Técnicas

- Configurar variáveis de produção no projeto Vercel correto.
- Validar login real em produção após aceite do convite.
- Validar cookies de sessão em produção.
- Validar RLS com tokens reais de usuário comum e admin.
- Validar sync Jira em produção com job real.
- Definir agendador de 30 minutos. Vercel Hobby bloqueia cron mais frequente que diário.
- Revisar remoção definitiva de artefatos SQL antigos que não fazem parte do fluxo oficial.
