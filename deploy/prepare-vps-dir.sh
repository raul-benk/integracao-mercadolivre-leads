#!/usr/bin/env bash
set -euo pipefail

APP_DOMAIN="${1:-integrador.zoitech.com.br}"
APP_NAME="${2:-meli-oauth}"
APP_USER="${3:-$USER}"
BASE_DIR="/var/www/${APP_DOMAIN}/${APP_NAME}"
SHARED_DIR="${BASE_DIR}/shared"
RELEASES_DIR="${BASE_DIR}/releases"
CURRENT_DIR="${BASE_DIR}/current"

echo "Preparing directory structure at: ${BASE_DIR}"

sudo mkdir -p "${SHARED_DIR}/config"
sudo mkdir -p "${SHARED_DIR}/tokens"
sudo mkdir -p "${SHARED_DIR}/integrations"
sudo mkdir -p "${SHARED_DIR}/webhooks"
sudo mkdir -p "${SHARED_DIR}/logs"
sudo mkdir -p "${RELEASES_DIR}"
sudo chown -R "${APP_USER}:${APP_USER}" "${BASE_DIR}"

if [ ! -f "${SHARED_DIR}/tokens/tokens.json" ]; then
  echo "{}" | sudo tee "${SHARED_DIR}/tokens/tokens.json" >/dev/null
fi

if [ ! -f "${SHARED_DIR}/tokens/authorizations.json" ]; then
  echo "[]" | sudo tee "${SHARED_DIR}/tokens/authorizations.json" >/dev/null
fi

if [ ! -f "${SHARED_DIR}/integrations/integrations.json" ]; then
  echo "[]" | sudo tee "${SHARED_DIR}/integrations/integrations.json" >/dev/null
fi

if [ ! -f "${SHARED_DIR}/webhooks/webhooks.json" ]; then
  echo "[]" | sudo tee "${SHARED_DIR}/webhooks/webhooks.json" >/dev/null
fi

if [ ! -f "${SHARED_DIR}/webhooks/webhook-events.json" ]; then
  echo "[]" | sudo tee "${SHARED_DIR}/webhooks/webhook-events.json" >/dev/null
fi

if [ ! -f "${SHARED_DIR}/logs/meli-api-logs.json" ]; then
  echo "[]" | sudo tee "${SHARED_DIR}/logs/meli-api-logs.json" >/dev/null
fi

if [ ! -f "${SHARED_DIR}/config/.env" ]; then
  sudo tee "${SHARED_DIR}/config/.env" >/dev/null <<'EOF'
PORT=7254
MELI_CLIENT_ID=SEU_APP_ID
MELI_CLIENT_SECRET=SEU_CLIENT_SECRET
MELI_REDIRECT_URI=https://integrador.zoitech.com.br/meli/callback
MELI_TOKENS_FILE=/var/www/integrador.zoitech.com.br/meli-oauth/shared/tokens/tokens.json
MELI_NOTIFICATIONS_PATH=/notifications
MELI_WEBHOOK_PATH=/mercadolivre/webhook
MELI_NOTIFICATIONS_URL=https://integrador.zoitech.com.br/meli/notifications
MELI_NOTIFICATIONS_FILE=/var/www/integrador.zoitech.com.br/meli-oauth/shared/logs/notifications.log
MELI_AUTHORIZATIONS_FILE=/var/www/integrador.zoitech.com.br/meli-oauth/shared/tokens/authorizations.json
MELI_INTEGRATIONS_FILE=/var/www/integrador.zoitech.com.br/meli-oauth/shared/integrations/integrations.json
MELI_API_LOGS_FILE=/var/www/integrador.zoitech.com.br/meli-oauth/shared/logs/meli-api-logs.json
MELI_WEBHOOKS_FILE=/var/www/integrador.zoitech.com.br/meli-oauth/shared/webhooks/webhooks.json
MELI_WEBHOOK_EVENTS_FILE=/var/www/integrador.zoitech.com.br/meli-oauth/shared/webhooks/webhook-events.json
MELI_WEBHOOK_PROCESS_LOG_FILE=/var/www/integrador.zoitech.com.br/meli-oauth/shared/logs/webhook-process.log
MELI_ADMIN_DASHBOARD_TOKEN=troque-por-um-token-forte
EOF
fi

echo
echo "Directory structure prepared."
echo "Base: ${BASE_DIR}"
echo "Shared env: ${SHARED_DIR}/config/.env"
echo "Shared tokens: ${SHARED_DIR}/tokens/tokens.json"
echo "Shared authorizations: ${SHARED_DIR}/tokens/authorizations.json"
echo "Shared integrations: ${SHARED_DIR}/integrations/integrations.json"
echo "Shared ML API logs: ${SHARED_DIR}/logs/meli-api-logs.json"
echo "Shared webhooks: ${SHARED_DIR}/webhooks/webhooks.json"
echo "Shared webhook events: ${SHARED_DIR}/webhooks/webhook-events.json"
echo
echo "Next step: copy project files to a release dir and point current symlink to that release."
echo "Example:"
echo "  sudo ln -sfn ${RELEASES_DIR}/2026-03-05_01 ${CURRENT_DIR}"
