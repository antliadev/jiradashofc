# Regras De Negócio

## Acesso

- Apenas emails `@antlia.com.br` podem acessar, exceto a conta administrativa geral definida.
- Usuário sem confirmação de email não acessa rotas protegidas.
- Usuário desativado perde acesso real no backend e no banco.
- O frontend pode ocultar menus, mas nunca é a única barreira.

## Perfis

- `full`: acesso administrativo amplo.
- `master`: acesso amplo operacional, sem assumir automaticamente administração total do sistema.
- `visualizacao`: leitura dos módulos permitidos.
- `personalizado`: permissões específicas por módulo, menu, projeto ou ação.

## Jira

- Jira é a origem externa dos dados.
- Supabase é o banco operacional para dashboards.
- Comentários e descrições devem ser persistidos, com acesso restrito.
- Dados obsoletos da sincronização anterior devem ser removidos, sobrescritos ou desativados.

## Performance

- Home deve ser leve.
- Consultas pesadas exigem filtro, projeto, período ou paginação.
- Listagens gerais não devem enviar campos pesados sem necessidade.
- Cache deve ter TTL documentado e invalidação após sync.
