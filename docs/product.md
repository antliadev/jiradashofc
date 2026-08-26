# Produto

## Objetivo

JiraDash centraliza indicadores operacionais e executivos do Jira para apoiar acompanhamento de projetos, contratos, cards, horas e profissionais da Antlia.

## Módulos

- Dashboard executivo.
- Monitoramento de cards.
- Projetos e visão Kanban.
- Gantt e cronograma.
- Relatórios gerenciais.
- Indicadores de horas por contrato.
- Análise de profissionais.
- Gestão de acessos.

## Perfis

- `full`: administração ampla do sistema.
- `master`: operação ampla dos módulos funcionais.
- `visualizacao`: leitura dos módulos permitidos.
- `personalizado`: permissões específicas por módulo ou ação.

## Fluxos Principais

- Usuário autentica com email Antlia confirmado.
- Sistema aplica permissões e libera menus autorizados.
- Backend sincroniza dados do Jira para Supabase.
- Dashboards consultam dados persistidos e cache operacional.
- Administradores gerenciam usuários, perfis e permissões.
