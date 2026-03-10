# Dashboard OAuth Admin (Mercado Livre)

Frontend React/Vite do painel administrativo de integracoes OAuth.

## Desenvolvimento

```bash
npm install
npm run dev
```

## Build de producao

```bash
npm run build
```

O build e gerado em `dist/` e servido pelo backend Node principal na rota:

- `/admin/integrations` (com protecao por token no servidor)

## Fonte de dados

A interface consome o mesmo endpoint em modo JSON:

- `/admin/integrations?format=json`

Se a URL atual tiver `?token=...`, esse token e preservado automaticamente na chamada da API.
