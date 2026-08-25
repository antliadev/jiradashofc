# Operação

## Desenvolvimento Local

```bash
npm install
cp .env.example .env
npm run dev:all
```

Preencha a `.env` local com chaves reais fora do Git. A `.env` criada neste workspace contém apenas a URL oficial e campos vazios para segredos.

Frontend local:

- `http://localhost:5173`

Backend local:

- `http://localhost:3001`

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
- remover dados obsoletos;
- invalidar cache ao finalizar.

## Vercel

URLs de dev e produção ainda serão definidas. Antes de conectar ao Vercel:

- CI deve estar passando.
- Variáveis devem estar separadas por ambiente.
- `develop` deve publicar homologação/dev.
- `main` deve publicar produção.
- Produção só deve ser validada após aceite.

## Troubleshooting

- Supabase não configurado: revisar `SUPABASE_URL` e chave backend.
- Login indisponível: revisar `SUPABASE_ANON_KEY`, confirmação de email e domínio permitido.
- Sync sem credenciais: revisar variáveis Jira no ambiente do backend.
- RLS bloqueando jobs: confirmar uso de service role/secret no backend antes de endurecer policies.
- Dashboard vazio: confirmar último job de sync e tabelas Jira.
