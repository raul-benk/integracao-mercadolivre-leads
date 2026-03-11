#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

SSH_TARGET="${1:-root@integrador.zoitech.com.br}"
APP_DOMAIN="${2:-integrador.zoitech.com.br}"
APP_NAME="${3:-meli-oauth}"
PM2_NAME="${4:-meli-oauth}"
REL="${REL:-$(date +%Y%m%d_%H%M%S)}"

APP_BASE="/var/www/${APP_DOMAIN}/${APP_NAME}"
RELEASE_DIR="${APP_BASE}/releases/${REL}"

echo "==> Project root: ${PROJECT_ROOT}"
echo "==> SSH target:   ${SSH_TARGET}"
echo "==> App base:     ${APP_BASE}"
echo "==> Release:      ${REL}"
echo

cd "${PROJECT_ROOT}"

echo "==> Running local checks/builds"
npm run check
npm run build:admin-ui
npm run build:callback-ui

echo
echo "==> Uploading release with rsync"
rsync -av \
  --exclude ".git" \
  --exclude ".DS_Store" \
  --exclude "node_modules" \
  --exclude ".env" \
  --exclude ".env.local" \
  --exclude "tokens.json" \
  --exclude "authorizations.json" \
  --exclude "notifications.log" \
  --exclude "npm-debug.log*" \
  "${PROJECT_ROOT}/" \
  "${SSH_TARGET}:${RELEASE_DIR}/"

echo
echo "==> Installing dependencies and switching current symlink on VPS"
ssh "${SSH_TARGET}" "bash -s" -- "${APP_BASE}" "${REL}" "${PM2_NAME}" <<'REMOTE_SCRIPT'
set -euo pipefail

APP_BASE="$1"
REL="$2"
PM2_NAME="$3"

RELEASE_DIR="${APP_BASE}/releases/${REL}"
CURRENT_DIR="${APP_BASE}/current"
SHARED_ENV="${APP_BASE}/shared/config/.env"

if [ ! -d "${RELEASE_DIR}" ]; then
  echo "Release directory not found: ${RELEASE_DIR}" >&2
  exit 1
fi

cd "${RELEASE_DIR}"
npm ci --omit=dev
ln -sfn "${RELEASE_DIR}" "${CURRENT_DIR}"

cd "${CURRENT_DIR}"
if [ -f "${SHARED_ENV}" ]; then
  set -a
  # shellcheck disable=SC1090
  source "${SHARED_ENV}"
  set +a
else
  echo "Shared env file not found: ${SHARED_ENV}" >&2
  exit 1
fi

if pm2 describe "${PM2_NAME}" >/dev/null 2>&1; then
  pm2 restart "${PM2_NAME}" --update-env
else
  pm2 start server.js --name "${PM2_NAME}" --update-env
fi

pm2 save
REMOTE_SCRIPT

echo
echo "==> Deploy finished"
echo "Public health check: https://${APP_DOMAIN}/meli/health"
echo "Public status check: https://${APP_DOMAIN}/meli/auth/status"
echo "Webhook endpoint:    https://${APP_DOMAIN}/meli/mercadolivre/webhook"
echo "Admin dashboard:     https://${APP_DOMAIN}/meli/admin/integrations?token=SEU_TOKEN"
echo "Enrich endpoint:     https://${APP_DOMAIN}/meli/admin/integrations/enrich?token=SEU_TOKEN"
echo "Webhook dashboard:   https://${APP_DOMAIN}/meli/integracoes/mercadolivre/webhooks?token=SEU_TOKEN"
