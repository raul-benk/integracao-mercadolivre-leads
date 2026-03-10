# Integracao Mercado Livre Leads (OAuth + Notificacoes)

Projeto Node.js/Express para:

- autenticar conta do Mercado Livre via OAuth2;
- persistir e renovar `access_token`/`refresh_token`;
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
- `GET /callback` recebe `code` e salva tokens
- `POST /auth/refresh` renova token com `refresh_token`
- `GET /auth/status` status de configuracao/token
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

## Execucao local

```bash
cp .env.example .env
npm install
npm run check
npm start
```

Testes rapidos:

```bash
curl http://localhost:7254/health
curl http://localhost:7254/auth/status
curl http://localhost:7254/notifications
```

Fluxo OAuth:

1. Acesse `http://localhost:7254/auth/start`.
2. Autorize no Mercado Livre.
3. Callback chega em `/callback`.
4. Tokens sao salvos no arquivo configurado (`MELI_TOKENS_FILE` ou `tokens.json`).

## Estrutura de deploy na VPS

Diretorio base:

- `/var/www/integrador.zoitech.com.br/meli-oauth`

Estrutura recomendada:

- `/var/www/integrador.zoitech.com.br/meli-oauth/releases`
- `/var/www/integrador.zoitech.com.br/meli-oauth/current`
- `/var/www/integrador.zoitech.com.br/meli-oauth/shared/config/.env`
- `/var/www/integrador.zoitech.com.br/meli-oauth/shared/tokens/tokens.json`
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

### 1. Publicar release

No seu computador local:

```bash
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
