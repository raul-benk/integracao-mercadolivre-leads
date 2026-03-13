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
- URL principal de webhook (Mercado Livre):
  `https://integrador.zoitech.com.br/meli/mercadolivre/webhook`
- URL legacy de notificacoes (alias):
  `https://integrador.zoitech.com.br/meli/notifications`
- URL de entrada de leads Doin Motors:
  `https://integrador.zoitech.com.br/meli/doin-motors/leads`

## Endpoints da API local

- `GET /` pagina HTML de redirect para OAuth (com estilo ZOI)
- `GET /?format=json` resumo e URL de autorizacao (modo API)
- `GET /auth/start` inicia OAuth
- `GET /callback` recebe `code`, salva tokens e mostra confirmacao HTML
- `POST /auth/refresh` renova token com `refresh_token`
- `GET /auth/status` status de configuracao/token
- `GET /admin/integrations` dashboard HTML/JSON das autorizacoes
- `POST /admin/integrations/enrich` forca enriquecimento dos dados da conta atual via `/users/me`
- `POST /admin/integrations/webhook-forward` atualiza/remova webhook de direcionamento por `user_id`
- `GET /integracoes/mercadolivre/webhooks` dashboard HTML/JSON dos webhooks
- `GET /mercadolivre/webhook` status do endpoint principal de webhook
- `POST /mercadolivre/webhook` recebe webhook e processa recurso em background
- `GET /notifications` status do endpoint legacy (alias)
- `POST /notifications` alias legado para recepcao de webhook
- `GET /doin-motors/leads` status do endpoint de entrada Doin Motors
- `POST /doin-motors/leads` recebe lead da Doin Motors e encaminha para o webhook configurado
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
- `MELI_WEBHOOK_PATH=/mercadolivre/webhook`
- `MELI_NOTIFICATIONS_URL` URL publica em minusculas
- `MELI_NOTIFICATIONS_FILE` arquivo de log das notificacoes
- `MELI_AUTHORIZATIONS_FILE` historico JSON das autorizacoes realizadas
- `MELI_INTEGRATIONS_FILE` perfis enriquecidos da conta (`/users/me`)
- `MELI_API_LOGS_FILE` historico de chamadas para API do Mercado Livre
- `MELI_WEBHOOKS_FILE` arquivo JSON dos webhooks recebidos
- `MELI_WEBHOOK_EVENTS_FILE` arquivo JSON dos eventos completos consultados na API
- `MELI_WEBHOOK_PROCESS_LOG_FILE` log NDJSON com `webhook_recebido`, `webhook_processado` e `erro_consulta_api`
- `MELI_FORWARD_TIMEOUT_MS` timeout do repasse para webhook por integracao (default: `15000`)
- `MELI_FORWARD_RETRIES` retries do repasse para webhook por integracao em 429/5xx (default: `2`)
- `MELI_ADMIN_DASHBOARD_TOKEN` token usado no link administrativo
- `DOIN_MOTORS_LEADS_PATH` rota de recepcao dos leads (default: `/doin-motors/leads`)
- `DOIN_MOTORS_WEBHOOK_URL` webhook de destino para encaminhar cada lead recebido
- `DOIN_MOTORS_FORWARD_TIMEOUT_MS` timeout da chamada para o webhook de destino (default: `15000`)
- `DOIN_MOTORS_FORWARD_RETRIES` quantidade de retries para 429/5xx (default: `2`)
- `DOIN_MOTORS_FORWARD_LOG_FILE` arquivo NDJSON de auditoria do encaminhamento
- `DOIN_MOTORS_INBOUND_TOKEN` token opcional para proteger a rota de entrada (`x-doin-token` ou `Authorization: Bearer`)

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
curl http://localhost:7254/mercadolivre/webhook
curl http://localhost:7254/doin-motors/leads
curl -X POST "http://localhost:7254/admin/integrations/webhook-forward?token=SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"user_id":123456789,"webhook_url":"https://seu-endpoint.com/webhook"}'
curl -X POST http://localhost:7254/doin-motors/leads \
  -H "Content-Type: application/json" \
  -d '{"name":"Lead Teste","phone":"+5511999999999","source":"doin_motors"}'
curl "http://localhost:7254/admin/integrations?token=SEU_TOKEN&format=json"
curl -X POST "http://localhost:7254/admin/integrations/enrich?token=SEU_TOKEN"
curl "http://localhost:7254/integracoes/mercadolivre/webhooks?token=SEU_TOKEN&format=json"
```

## Como visualizar localmente antes do deploy

1. Configure um token administrativo no `.env`:
   - `MELI_ADMIN_DASHBOARD_TOKEN=admin-local-teste`
2. Suba o backend:
   - `npm start`
3. (Opcional) Gere o build da UI React do admin:
   - `npm run build:admin-ui`
4. Abra o dashboard:
   - `http://localhost:7254/admin/integrations?token=admin-local-teste`
5. Em um card de integracao, preencha "Webhook de direcionamento" e clique em salvar.
6. Confirme no JSON da API:
   - `http://localhost:7254/admin/integrations?token=admin-local-teste&format=json`
7. Envie um webhook de teste para `/mercadolivre/webhook` e verifique o repasse no endpoint configurado.

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
- O dashboard tambem mostra dados enriquecidos via `/users/me` (loja, proprietario, email, cidade/UF, CNPJ, reputacao e experiencia).
- O arquivo `tokens.json` continua representando apenas o token ativo mais recente.
- O token do link administrativo deve ser forte e mantido fora do Git.

## Webhooks Mercado Livre

Configuracao recomendada na app do Mercado Livre:

- Callback URL: `https://integrador.zoitech.com.br/meli/mercadolivre/webhook`
- Topics sugeridos: `questions`, `orders`, `messages`, `items`, `shipments`, `payments`

Fluxo implementado:

1. `POST /mercadolivre/webhook` recebe o payload.
2. O payload bruto e salvo no arquivo `MELI_WEBHOOKS_FILE`.
3. A API responde `HTTP 200` imediatamente.
4. O processamento ocorre em background:
   - valida payload;
   - consulta `https://api.mercadolibre.com{resource}` com `Bearer`;
   - tenta refresh de token automaticamente em 401/expiracao;
   - identifica a integracao (por `user_id`) e, se houver `webhook_forward_url` configurado, repassa o evento processado para esse endpoint;
   - salva evento completo em `MELI_WEBHOOK_EVENTS_FILE`;
   - registra logs em `MELI_WEBHOOK_PROCESS_LOG_FILE`.

Dashboard de webhooks:

- Rota local: `http://localhost:7254/integracoes/mercadolivre/webhooks?token=SEU_TOKEN`
- Rota publica: `https://integrador.zoitech.com.br/meli/integracoes/mercadolivre/webhooks?token=SEU_TOKEN`
- Versao JSON: adicione `&format=json`

## Webhook de direcionamento por integracao

Configuracao:

1. Acesse `GET /admin/integrations?token=SEU_TOKEN`.
2. Em cada card de integracao, preencha o campo "Webhook de direcionamento".
3. Clique em "Salvar webhook".
4. Para remover, deixe o campo em branco e salve novamente.

API de configuracao (alternativa ao frontend):

- Endpoint: `POST /admin/integrations/webhook-forward?token=SEU_TOKEN`
- Body:

```json
{
  "user_id": 123456789,
  "webhook_url": "https://seu-endpoint.com/webhook"
}
```

Observacoes:

- `webhook_url` aceita apenas HTTP(S).
- Se `webhook_url` for vazio/nulo, a configuracao e removida.
- O repasse usa `MELI_FORWARD_TIMEOUT_MS` e `MELI_FORWARD_RETRIES`.

## Repasse de leads Doin Motors

Fluxo implementado:

1. `POST /doin-motors/leads` recebe o payload JSON da Doin Motors.
2. O backend registra auditoria em `DOIN_MOTORS_FORWARD_LOG_FILE` (`lead_recebido`, `lead_encaminhado`, `erro_encaminhamento_lead`).
3. O payload recebido e encaminhado em modo pass-through para `DOIN_MOTORS_WEBHOOK_URL`.
4. Em caso de falha `429`/`5xx`, o backend tenta novamente conforme `DOIN_MOTORS_FORWARD_RETRIES`.
5. Se todas as tentativas falharem, a API responde `HTTP 502` para permitir nova tentativa no provedor de origem.

Seguranca opcional:

- Defina `DOIN_MOTORS_INBOUND_TOKEN` para exigir token na entrada.
- Header aceito: `x-doin-token: SEU_TOKEN` (ou `Authorization: Bearer SEU_TOKEN`).

## Enriquecimento de conta (/users/me)

Quando o OAuth e concluido (ou quando `POST /admin/integrations/enrich` e executado), o backend consulta:

- `GET https://api.mercadolibre.com/users/me`

Campos enriquecidos no payload do dashboard/admin:

- `store_nickname`
- `owner_name`, `owner_first_name`, `owner_last_name`
- `email`
- `business_name`, `brand_name`
- `account_type`, `cnpj`
- `city`, `state`
- `reputation_level`, `seller_experience`
- `account_created_at`
- `last_enriched_at`

Persistencia:

- Perfis: `MELI_INTEGRATIONS_FILE`
- Logs de API: `MELI_API_LOGS_FILE`

Atualizacao periodica recomendada:

- Cron diario chamando `POST /admin/integrations/enrich?token=SEU_TOKEN`

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
- `/var/www/integrador.zoitech.com.br/meli-oauth/shared/integrations/integrations.json`
- `/var/www/integrador.zoitech.com.br/meli-oauth/shared/webhooks/webhooks.json`
- `/var/www/integrador.zoitech.com.br/meli-oauth/shared/webhooks/webhook-events.json`
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

Obs: com essa regra, rota publica `/meli/mercadolivre/webhook` vira `/mercadolivre/webhook` no Node.

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
