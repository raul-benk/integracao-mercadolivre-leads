# Integracao Mercado Livre Leads (OAuth + Notificacoes)

Projeto Node.js/Express para:

- autenticar conta do Mercado Livre via OAuth2;
- persistir e renovar `access_token`/`refresh_token`;
- registrar historico de autorizacoes para auditoria administrativa;
- receber notificacoes (webhook) da aplicacao;
- preparar deploy em VPS com Nginx + PM2.

Repositorio de destino no GitHub:

- `https://github.com/raul-benk/integracao-mercadolivre-leads.git`

## URLs oficiais da app (producao)

- Redirect URI:
  `https://integrador.zoitech.com.br/meli/callback`
- URL de notificacoes (somente minusculas):
  `https://integrador.zoitech.com.br/meli/notifications`

## Endpoints da API local

- `GET /` pagina HTML de redirect para OAuth (com estilo ZOI)
- `GET /?format=json` resumo e URL de autorizacao (modo API)
- `GET /auth/start` inicia OAuth
- `GET /callback` recebe `code`, salva tokens e mostra confirmacao HTML
- `POST /auth/refresh` renova token com `refresh_token`
- `GET /auth/status` status de configuracao/token
- `GET /admin/integrations` dashboard HTML/JSON das autorizacoes
- `GET /notifications` status do webhook
- `POST /notifications` recebe notificacoes
- `GET /health` healthcheck

## Variaveis de ambiente

Base local: `.env.example`  
Base VPS: `.env.vps.example`

Obrigatorias:

- `MELI_CLIENT_ID`
- `MELI_CLIENT_SECRET`
- `MELI_REDIRECT_URI`

Recomendadas:

- `PORT=7254`
- `MELI_TOKENS_FILE` caminho persistente do `tokens.json`
- `MELI_NOTIFICATIONS_PATH=/notifications`
- `MELI_NOTIFICATIONS_URL` URL publica em minusculas
- `MELI_NOTIFICATIONS_FILE` arquivo de log das notificacoes
- `MELI_AUTHORIZATIONS_FILE` historico JSON das autorizacoes realizadas
- `MELI_ADMIN_DASHBOARD_TOKEN` token usado no link administrativo

## Execucao local

```bash
cp .env.example .env
npm install
npm run check
npm run build:admin-ui
npm run build:callback-ui
npm start
```

Testes rapidos:

```bash
curl http://localhost:7254/health
curl http://localhost:7254/auth/status
curl http://localhost:7254/notifications
curl "http://localhost:7254/admin/integrations?token=SEU_TOKEN&format=json"
```

Fluxo OAuth:

1. Acesse `http://localhost:7254/auth/start`.
2. Autorize no Mercado Livre.
3. Callback chega em `/callback`.
4. Tokens sao salvos no arquivo configurado (`MELI_TOKENS_FILE` ou `tokens.json`).
5. No navegador, o callback responde com uma tela HTML de sucesso. Para JSON, use `?format=json`.
6. Cada autorizacao tambem entra no historico (`MELI_AUTHORIZATIONS_FILE`).

Build da interface React de callback:

```bash
npm run build:callback-ui
```

Obs: o servidor usa o build em `public/oauth-callback-result/dist`. Se o build nao existir, cai no template HTML legado.

## Dashboard administrativo

O projeto agora expoe uma visualizacao HTML para acompanhamento das contas que ja autorizaram a integracao.

- Rota local: `http://localhost:7254/admin/integrations?token=SEU_TOKEN`
- Rota publica na VPS: `https://integrador.zoitech.com.br/meli/admin/integrations?token=SEU_TOKEN`
- Versao JSON da mesma tela: adicione `&format=json`

Build da interface React do dashboard:

```bash
npm run build:admin-ui
```

Obs: o servidor usa o build em `public/mercado-livre-oauth-admin/dist`. Se o build nao existir, cai no template HTML legado.

Importante:

- O dashboard lista todas as autorizacoes registradas no callback.
- O arquivo `tokens.json` continua representando apenas o token ativo mais recente.
- O token do link administrativo deve ser forte e mantido fora do Git.

## Estrutura de deploy na VPS

Runbook operacional com comandos prontos (host atual, links e operacao diaria):

- [deploy/VPS-RUNBOOK.md](deploy/VPS-RUNBOOK.md)

Diretorio base:

- `/var/www/integrador.zoitech.com.br/meli-oauth`

Estrutura recomendada:

- `/var/www/integrador.zoitech.com.br/meli-oauth/releases`
- `/var/www/integrador.zoitech.com.br/meli-oauth/current`
- `/var/www/integrador.zoitech.com.br/meli-oauth/shared/config/.env`
- `/var/www/integrador.zoitech.com.br/meli-oauth/shared/tokens/tokens.json`
- `/var/www/integrador.zoitech.com.br/meli-oauth/shared/tokens/authorizations.json`
- `/var/www/integrador.zoitech.com.br/meli-oauth/shared/logs/`

Bootstrap da estrutura:

```bash
bash deploy/prepare-vps-dir.sh integrador.zoitech.com.br meli-oauth <usuario_linux>
```

## Nginx (subpath /meli)

No server `integrador.zoitech.com.br`, use:

```nginx
location /meli/ {
    proxy_pass http://127.0.0.1:7254/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
}
```

Obs: com essa regra, rota publica `/meli/notifications` vira `/notifications` no Node.

## PM2 (producao)

### Deploy automatizado (recomendado)

No seu computador local:

```bash
bash deploy/deploy-release.sh root@SEU_HOST integrador.zoitech.com.br meli-oauth meli-oauth
```

Parametros:

1. `root@SEU_HOST`: usuario e host SSH da VPS
2. `integrador.zoitech.com.br`: dominio usado no path `/var/www/<dominio>/<app>`
3. `meli-oauth`: nome da aplicacao no path da VPS
4. `meli-oauth`: nome do processo PM2

O script executa:

- `npm run check`
- `npm run build:admin-ui`
- `npm run build:callback-ui`
- `rsync` para novo release
- `npm ci --omit=dev` na VPS
- troca do symlink `current`
- `pm2 restart` (ou `pm2 start` se nao existir) com `--update-env`
- `pm2 save`

### 1. Publicar release

No seu computador local:

```bash
npm run build:admin-ui
npm run build:callback-ui
REL=$(date +%Y%m%d_%H%M%S)
rsync -av --exclude node_modules --exclude .env --exclude tokens.json \
  ./ root@srv1183543:/var/www/integrador.zoitech.com.br/meli-oauth/releases/$REL/
```

Na VPS:

```bash
APP_BASE="/var/www/integrador.zoitech.com.br/meli-oauth"
REL=$(ls -1 "$APP_BASE/releases" | tail -n1)

cd "$APP_BASE/releases/$REL"
npm ci --omit=dev
ln -sfn "$APP_BASE/releases/$REL" "$APP_BASE/current"
```

### 2. Iniciar com PM2 usando .env da pasta shared

```bash
APP_BASE="/var/www/integrador.zoitech.com.br/meli-oauth"
cd "$APP_BASE/current"

set -a
source "$APP_BASE/shared/config/.env"
set +a

pm2 start server.js --name meli-oauth --update-env
pm2 save
pm2 startup
```

### 3. Validar

```bash
pm2 status
pm2 logs meli-oauth --lines 100
curl -i https://integrador.zoitech.com.br/meli/health
curl -i https://integrador.zoitech.com.br/meli/auth/status
```

### 4. Atualizar deploy (novo release)

```bash
APP_BASE="/var/www/integrador.zoitech.com.br/meli-oauth"
cd "$APP_BASE/current"

set -a
source "$APP_BASE/shared/config/.env"
set +a

pm2 restart meli-oauth --update-env
pm2 save
```
