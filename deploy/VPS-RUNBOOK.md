# VPS Runbook (integrador.zoitech.com.br)

Referencias atuais de producao para este projeto.

## Ambiente atual

- Host SSH: `root@72.60.137.105`
- Dominio: `integrador.zoitech.com.br`
- App base: `/var/www/integrador.zoitech.com.br/meli-oauth`
- Release ativo (symlink): `/var/www/integrador.zoitech.com.br/meli-oauth/current`
- PM2 app: `meli-oauth`

## Links oficiais

- Cliente (iniciar autorizacao): `https://integrador.zoitech.com.br/meli/auth/start`
- Health: `https://integrador.zoitech.com.br/meli/health`
- Status OAuth: `https://integrador.zoitech.com.br/meli/auth/status`
- Webhook principal (ML): `https://integrador.zoitech.com.br/meli/mercadolivre/webhook`
- Webhook legacy (alias): `https://integrador.zoitech.com.br/meli/notifications`
- Admin dashboard (HTML): `https://integrador.zoitech.com.br/meli/admin/integrations/?token=<TOKEN>`
- Admin dashboard (JSON): `https://integrador.zoitech.com.br/meli/admin/integrations/?token=<TOKEN>&format=json`
- Enriquecer perfil atual (POST): `https://integrador.zoitech.com.br/meli/admin/integrations/enrich?token=<TOKEN>`
- Webhooks dashboard (HTML): `https://integrador.zoitech.com.br/meli/integracoes/mercadolivre/webhooks/?token=<TOKEN>`
- Webhooks dashboard (JSON): `https://integrador.zoitech.com.br/meli/integracoes/mercadolivre/webhooks/?token=<TOKEN>&format=json`

Para imprimir o link administrativo com o token atual salvo no servidor:

```bash
echo "https://integrador.zoitech.com.br/meli/admin/integrations/?token=$(cat /root/.meli_admin_token)"
```

## Deploy (local -> VPS)

Rodar no computador local, na raiz do repositorio:

```bash
bash deploy/deploy-release.sh root@72.60.137.105 integrador.zoitech.com.br meli-oauth meli-oauth
```

Esse comando executa check/build local, envia release via `rsync`, instala dependencias na VPS e reinicia o PM2.

## Validacao pos deploy (na VPS)

```bash
set -euo pipefail
APP_BASE="/var/www/integrador.zoitech.com.br/meli-oauth"

pm2 status
pm2 logs meli-oauth --lines 80 --nostream
curl -i http://127.0.0.1:7254/health
curl -i https://integrador.zoitech.com.br/meli/health
curl -i https://integrador.zoitech.com.br/meli/auth/status
curl -i https://integrador.zoitech.com.br/meli/mercadolivre/webhook
```

Forcar enriquecimento da conta atual:

```bash
TOKEN="$(cat /root/.meli_admin_token)"
curl -i -X POST "https://integrador.zoitech.com.br/meli/admin/integrations/enrich?token=${TOKEN}"
```

Atualizacao diaria (cron sugerido):

```bash
crontab -e
# 03:10 todos os dias
10 3 * * * TOKEN="$(cat /root/.meli_admin_token)" && curl -s -X POST "https://integrador.zoitech.com.br/meli/admin/integrations/enrich?token=${TOKEN}" >/dev/null 2>&1
```

Teste rapido de webhook (simulado):

```bash
curl -i -X POST https://integrador.zoitech.com.br/meli/mercadolivre/webhook \
  -H "Content-Type: application/json" \
  -d '{"topic":"questions","resource":"/questions/123456789","user_id":123456}'
```

## Rotacionar token admin do dashboard

```bash
set -euo pipefail

APP_BASE="/var/www/integrador.zoitech.com.br/meli-oauth"
ENV_FILE="$APP_BASE/shared/config/.env"
TOKEN_FILE="/root/.meli_admin_token"
TOKEN="$(openssl rand -hex 32)"

cp "$ENV_FILE" "${ENV_FILE}.bak.$(date +%Y%m%d_%H%M%S)"

if grep -q '^MELI_ADMIN_DASHBOARD_TOKEN=' "$ENV_FILE"; then
  sed -i "s/^MELI_ADMIN_DASHBOARD_TOKEN=.*/MELI_ADMIN_DASHBOARD_TOKEN=${TOKEN}/" "$ENV_FILE"
else
  printf '\nMELI_ADMIN_DASHBOARD_TOKEN=%s\n' "$TOKEN" >> "$ENV_FILE"
fi

printf '%s\n' "$TOKEN" > "$TOKEN_FILE"
chmod 600 "$TOKEN_FILE"

cd "$APP_BASE/current"
set -a
source "$ENV_FILE"
set +a

pm2 restart meli-oauth --update-env
pm2 save
echo "https://integrador.zoitech.com.br/meli/admin/integrations/?token=$(cat "$TOKEN_FILE")"
```

## Zerar tokens OAuth (opcional)

Zera token ativo e historico de autorizacoes:

```bash
set -euo pipefail

APP_BASE="/var/www/integrador.zoitech.com.br/meli-oauth"
TOKENS_FILE="$APP_BASE/shared/tokens/tokens.json"
AUTH_FILE="$APP_BASE/shared/tokens/authorizations.json"
TS="$(date +%Y%m%d_%H%M%S)"

cp -a "$TOKENS_FILE" "${TOKENS_FILE}.bak.${TS}" 2>/dev/null || true
cp -a "$AUTH_FILE" "${AUTH_FILE}.bak.${TS}" 2>/dev/null || true

printf '{}\n' > "$TOKENS_FILE"
printf '[]\n' > "$AUTH_FILE"

cd "$APP_BASE/current"
pm2 restart meli-oauth --update-env
pm2 save
curl -sS https://integrador.zoitech.com.br/meli/auth/status
```
