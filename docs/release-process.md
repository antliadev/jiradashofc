# Processo De Release

## Branches

- `develop`: desenvolvimento e homologação.
- `main`: produção.

## Fluxo

1. Criar branch de trabalho a partir de `develop`.
2. Implementar mudança pequena e rastreável.
3. Rodar validações locais.
4. Abrir PR para `develop`.
5. CI precisa passar.
6. Homologar em ambiente dev.
7. Após aceite, abrir PR de `develop` para `main`.
8. Publicar produção apenas após checks e validação.

## Checks Obrigatórios

- `npm test`
- `npm run lint`
- `npm run build`
- `npm audit --audit-level=moderate`
- varredura de segredos
- validação manual dos fluxos afetados

## Pós-Deploy

Validar explicitamente:

- login;
- bloqueio de domínio externo;
- permissões por perfil;
- home;
- dashboard com filtro/projeto;
- sync;
- rotas protegidas;
- logs sem segredos.
