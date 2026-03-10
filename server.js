const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT || 7254);
const CLIENT_ID = process.env.MELI_CLIENT_ID || "";
const CLIENT_SECRET = process.env.MELI_CLIENT_SECRET || "";
const REDIRECT_URI =
  process.env.MELI_REDIRECT_URI || `http://localhost:${PORT}/callback`;
const NOTIFICATIONS_PATH_RAW = process.env.MELI_NOTIFICATIONS_PATH || "/notifications";
const NOTIFICATIONS_PATH = NOTIFICATIONS_PATH_RAW.toLowerCase();
const NOTIFICATIONS_URL = process.env.MELI_NOTIFICATIONS_URL || "";

const TOKENS_FILE = path.resolve(
  process.env.MELI_TOKENS_FILE || path.join(__dirname, "tokens.json")
);
const AUTHORIZATIONS_FILE = path.resolve(
  process.env.MELI_AUTHORIZATIONS_FILE || path.join(__dirname, "authorizations.json")
);
const NOTIFICATIONS_FILE = path.resolve(
  process.env.MELI_NOTIFICATIONS_FILE || path.join(__dirname, "notifications.log")
);
const ADMIN_DASHBOARD_TOKEN = process.env.MELI_ADMIN_DASHBOARD_TOKEN || "";
const ADMIN_DASHBOARD_PATH = "/admin/integrations";
const PUBLIC_DASHBOARD_PATH = `/meli${ADMIN_DASHBOARD_PATH}`;
const ZOI_STYLES_DIR = path.resolve(
  __dirname,
  "node_modules",
  "@zoitechnologies",
  "ds",
  "styles"
);
const REDIRECT_PAGE_FILE = path.resolve(__dirname, "public", "redirect.html");
const ADMIN_DASHBOARD_FILE = path.resolve(__dirname, "public", "admin-integrations.html");
const CALLBACK_RESULT_FILE = path.resolve(__dirname, "public", "callback-result.html");
const CALLBACK_RESULT_APP_DIST_DIR = path.resolve(
  __dirname,
  "public",
  "oauth-callback-result",
  "dist"
);
const CALLBACK_RESULT_APP_INDEX_FILE = path.resolve(
  CALLBACK_RESULT_APP_DIST_DIR,
  "index.html"
);
const ADMIN_DASHBOARD_APP_DIST_DIR = path.resolve(
  __dirname,
  "public",
  "mercado-livre-oauth-admin",
  "dist"
);
const ADMIN_DASHBOARD_APP_INDEX_FILE = path.resolve(
  ADMIN_DASHBOARD_APP_DIST_DIR,
  "index.html"
);
const ADMIN_DASHBOARD_APP_ASSETS_DIR = path.resolve(
  ADMIN_DASHBOARD_APP_DIST_DIR,
  "assets"
);
const AUTH_URL = "https://auth.mercadolivre.com.br/authorization";
const TOKEN_URL = "https://api.mercadolibre.com/oauth/token";
const STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;

const pendingStates = new Map();
app.use("/assets/zoi", express.static(ZOI_STYLES_DIR));
app.use(
  `${ADMIN_DASHBOARD_PATH}/assets`,
  express.static(ADMIN_DASHBOARD_APP_ASSETS_DIR, {
    maxAge: "7d",
    immutable: true,
  })
);

function getConfigErrors() {
  const errors = [];

  if (!CLIENT_ID) {
    errors.push("MELI_CLIENT_ID não configurado");
  }

  if (!CLIENT_SECRET) {
    errors.push("MELI_CLIENT_SECRET não configurado");
  }

  if (!REDIRECT_URI) {
    errors.push("MELI_REDIRECT_URI não configurado");
  }

  if (NOTIFICATIONS_PATH_RAW !== NOTIFICATIONS_PATH) {
    errors.push("MELI_NOTIFICATIONS_PATH deve usar apenas minúsculas");
  }

  if (NOTIFICATIONS_URL && /[A-Z]/.test(NOTIFICATIONS_URL)) {
    errors.push("MELI_NOTIFICATIONS_URL deve usar apenas minúsculas");
  }

  return errors;
}

function readJsonFile(filePath, fallbackValue) {
  if (!fs.existsSync(filePath)) {
    return fallbackValue;
  }

  const content = fs.readFileSync(filePath, "utf8").trim();
  if (!content) {
    return fallbackValue;
  }

  return JSON.parse(content);
}

function readTokens() {
  return readJsonFile(TOKENS_FILE, null);
}

function writeTokens(tokenPayload) {
  const now = Date.now();
  const expiresIn = Number(tokenPayload.expires_in || 0);
  const expiresAt =
    expiresIn > 0 ? new Date(now + expiresIn * 1000).toISOString() : null;

  const normalized = {
    ...tokenPayload,
    obtained_at: new Date(now).toISOString(),
    expires_at: expiresAt,
  };

  fs.mkdirSync(path.dirname(TOKENS_FILE), { recursive: true });
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}

function readAuthorizations() {
  const records = readJsonFile(AUTHORIZATIONS_FILE, []);
  if (Array.isArray(records)) {
    return records;
  }

  throw new Error("Arquivo de autorizacoes invalido: esperado um array JSON");
}

function writeAuthorizations(records) {
  fs.mkdirSync(path.dirname(AUTHORIZATIONS_FILE), { recursive: true });
  fs.writeFileSync(AUTHORIZATIONS_FILE, JSON.stringify(records, null, 2), "utf8");
  return records;
}

function buildAuthorizationRecord(tokens) {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex"),
    user_id: tokens.user_id || null,
    scope: tokens.scope || null,
    authorized_at: tokens.obtained_at || new Date().toISOString(),
    expires_at: tokens.expires_at || null,
    access_token_preview: maskToken(tokens.access_token),
    refresh_token_preview: maskToken(tokens.refresh_token),
  };
}

function appendAuthorizationRecord(tokens) {
  const records = readAuthorizations();
  const record = buildAuthorizationRecord(tokens);
  records.push(record);
  writeAuthorizations(records);
  return record;
}

function appendNotification(notificationPayload) {
  const event = {
    received_at: new Date().toISOString(),
    payload: notificationPayload,
  };

  fs.mkdirSync(path.dirname(NOTIFICATIONS_FILE), { recursive: true });
  fs.appendFileSync(NOTIFICATIONS_FILE, `${JSON.stringify(event)}\n`, "utf8");
}

function tokenIsExpired(tokens) {
  if (!tokens || !tokens.expires_at) {
    return true;
  }

  const expiry = new Date(tokens.expires_at).getTime();
  return Date.now() >= expiry - TOKEN_EXPIRY_BUFFER_MS;
}

function maskToken(token) {
  if (!token || typeof token !== "string") {
    return null;
  }

  if (token.length <= 10) {
    return `${token[0]}***${token[token.length - 1]}`;
  }

  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

function buildAuthorizationUrl(state) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    state,
  });

  return `${AUTH_URL}?${params.toString()}`;
}

function generateState() {
  const state = crypto.randomBytes(24).toString("hex");
  pendingStates.set(state, Date.now() + STATE_TTL_MS);
  return state;
}

function cleanupStates() {
  const now = Date.now();

  for (const [state, expiresAt] of pendingStates.entries()) {
    if (expiresAt < now) {
      pendingStates.delete(state);
    }
  }
}

async function requestToken(payload) {
  const params = new URLSearchParams(payload);

  const response = await axios.post(TOKEN_URL, params, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  return response.data;
}

function formatAxiosError(error) {
  if (axios.isAxiosError(error) && error.response) {
    return {
      status: error.response.status,
      data: error.response.data,
    };
  }

  return {
    status: 500,
    data: { message: error.message || "Erro inesperado" },
  };
}

function ensureConfigured(res) {
  const errors = getConfigErrors();
  if (errors.length === 0) {
    return true;
  }

  res.status(500).json({
    error: "missing_configuration",
    details: errors,
  });
  return false;
}

function tokenPreview(tokens) {
  if (!tokens) {
    return null;
  }

  return {
    access_token: maskToken(tokens.access_token),
    refresh_token: maskToken(tokens.refresh_token),
    user_id: tokens.user_id || null,
    scope: tokens.scope || null,
    expires_at: tokens.expires_at || null,
  };
}

function hasUsableTokens(tokens) {
  return Boolean(tokens && tokens.access_token);
}

function formatTimestamp(value) {
  if (!value) {
    return "Nao disponivel";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toISOString().replace("T", " ").replace("Z", " UTC");
}

function getAuthorizationStatus(record) {
  if (!record || !record.expires_at) {
    return "Sem expiracao";
  }

  return tokenIsExpired(record) ? "Expirado" : "Ativo";
}

function countScopes(scopeValue) {
  if (!scopeValue || typeof scopeValue !== "string") {
    return 0;
  }

  return scopeValue
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

function summarizeScope(scopeValue, maxItems = 3) {
  if (!scopeValue || typeof scopeValue !== "string") {
    return "Nenhum scope informado";
  }

  const scopes = scopeValue
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (scopes.length === 0) {
    return "Nenhum scope informado";
  }

  const visibleScopes = scopes.slice(0, maxItems);
  const remainingCount = scopes.length - visibleScopes.length;

  return remainingCount > 0
    ? `${visibleScopes.join(" • ")} +${remainingCount}`
    : visibleScopes.join(" • ");
}

function toPercent(part, total) {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }

  return Math.round((part / total) * 100);
}

function buildUserBadge(userId) {
  const normalized = String(userId || "ml").replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (!normalized) {
    return "ML";
  }

  return normalized.slice(-2).padStart(2, "0");
}

function getAdminRequestToken(req) {
  if (typeof req.query.token === "string" && req.query.token.trim()) {
    return req.query.token.trim();
  }

  if (typeof req.headers["x-admin-token"] === "string") {
    return req.headers["x-admin-token"].trim();
  }

  return "";
}

function requestWantsJson(req) {
  const format = typeof req.query.format === "string" ? req.query.format.toLowerCase() : "";
  if (format === "json") {
    return true;
  }

  return req.accepts(["html", "json"]) === "json";
}

function sendAdminAccessError(req, res, statusCode, errorCode, message) {
  if (requestWantsJson(req)) {
    res.status(statusCode).json({
      error: errorCode,
      message,
      dashboard_path: ADMIN_DASHBOARD_PATH,
    });
    return;
  }

  res.status(statusCode).type("html").send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Acesso restrito</title>
  <style>
    body { font-family: sans-serif; padding: 2rem; background: #f5f7f8; color: #111; }
    main { max-width: 40rem; margin: 0 auto; background: #fff; padding: 2rem; border-radius: 1rem; }
    code { background: #f0f2f4; padding: 0.125rem 0.375rem; border-radius: 0.375rem; }
  </style>
</head>
<body>
  <main>
    <h1>Acesso restrito</h1>
    <p>${escapeHtml(message)}</p>
    <p>Use <code>?token=SEU_TOKEN</code> ou envie o header <code>x-admin-token</code>.</p>
  </main>
</body>
</html>`);
}

function ensureAdminDashboardAccess(req, res) {
  if (!ADMIN_DASHBOARD_TOKEN) {
    sendAdminAccessError(
      req,
      res,
      503,
      "admin_dashboard_not_configured",
      "Configure MELI_ADMIN_DASHBOARD_TOKEN para habilitar a visualizacao administrativa."
    );
    return false;
  }

  if (getAdminRequestToken(req) !== ADMIN_DASHBOARD_TOKEN) {
    sendAdminAccessError(
      req,
      res,
      403,
      "forbidden",
      "Token administrativo invalido ou ausente."
    );
    return false;
  }

  return true;
}

function buildRootPayload(configErrors = getConfigErrors()) {
  if (configErrors.length > 0) {
    return {
      message: "Configure as variaveis de ambiente para iniciar o OAuth",
      configured: false,
      config_errors: configErrors,
      status: "/auth/status",
    };
  }

  cleanupStates();
  const state = generateState();
  const authorizationUrl = buildAuthorizationUrl(state);

  return {
    message: "OAuth Mercado Livre pronto",
    authorization_url: authorizationUrl,
    start_oauth: "/auth/start",
    callback: "/callback",
    notifications_path: NOTIFICATIONS_PATH,
    notifications_url: NOTIFICATIONS_URL || null,
    admin_dashboard_path: ADMIN_DASHBOARD_PATH,
    admin_dashboard_enabled: Boolean(ADMIN_DASHBOARD_TOKEN),
    refresh: "POST /auth/refresh",
    status: "/auth/status",
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function applyTemplate(template, replacements) {
  let filled = template;

  for (const [token, value] of Object.entries(replacements)) {
    filled = filled.split(token).join(String(value));
  }

  return filled;
}

function renderRedirectPage(configErrors) {
  const hasConfigErrors = configErrors.length > 0;
  const redirectTarget = hasConfigErrors ? "auth/status" : "auth/start";
  const redirectDelayMs = hasConfigErrors ? 2600 : 1800;
  const pageTitle = hasConfigErrors
    ? "Configuracao pendente | Integrador Mercado Livre"
    : "Redirecionando | Integrador Mercado Livre";
  const mainTitle = hasConfigErrors ? "Configuracao pendente" : "Conectando Mercado Livre";
  const subtitle = hasConfigErrors
    ? "Detectamos pendencias no ambiente. Voce sera redirecionado para o diagnostico."
    : "Estamos preparando o fluxo OAuth. O redirecionamento iniciara em instantes.";
  const ctaLabel = hasConfigErrors ? "Abrir diagnostico" : "Iniciar OAuth agora";
  const errorsList = hasConfigErrors
    ? configErrors.map((message) => `<li>${escapeHtml(message)}</li>`).join("")
    : "<li>Nenhuma pendencia detectada.</li>";
  const errorSectionClass = hasConfigErrors ? "" : "is-hidden";
  const template = fs.readFileSync(REDIRECT_PAGE_FILE, "utf8");

  return applyTemplate(template, {
    "__PAGE_TITLE__": escapeHtml(pageTitle),
    "__MAIN_TITLE__": escapeHtml(mainTitle),
    "__MAIN_SUBTITLE__": escapeHtml(subtitle),
    "__CTA_LABEL__": escapeHtml(ctaLabel),
    "__REDIRECT_TARGET__": escapeHtml(redirectTarget),
    "__REDIRECT_DELAY_MS__": String(redirectDelayMs),
    "__ERROR_SECTION_CLASS__": errorSectionClass,
    "__CONFIG_ERRORS__": errorsList,
  });
}

function buildCallbackResultModel({
  status = "success",
  title,
  badge,
  headline,
  message,
  userId = null,
  expiresAt = null,
  scopeCount = 0,
  primaryHref = "/",
  primaryLabel = "Voltar ao integrador",
  secondaryHref = "/auth/status",
  secondaryLabel = "Ver status",
  detailsTitle = "Resumo da autorização",
  details = [],
}) {
  return {
    status,
    title,
    badge,
    headline,
    message,
    userId,
    expiresAt,
    scopeCount,
    primaryHref,
    primaryLabel,
    secondaryHref,
    secondaryLabel,
    detailsTitle,
    details,
  };
}

function renderCallbackResultPage(model) {
  const template = fs.readFileSync(CALLBACK_RESULT_FILE, "utf8");
  const detailsMarkup = model.details.length > 0
    ? model.details.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
    : "<li>Nenhuma informacao adicional disponivel.</li>";
  const statusClass = model.status === "success" ? "is-success" : "is-error";
  const statusWord = model.status === "success" ? "Conexao concluida" : "Falha na autorizacao";

  return applyTemplate(template, {
    "__PAGE_TITLE__": escapeHtml(model.title),
    "__STATUS_CLASS__": statusClass,
    "__BADGE__": escapeHtml(model.badge),
    "__HEADLINE__": escapeHtml(model.headline),
    "__MESSAGE__": escapeHtml(model.message),
    "__STATUS_WORD__": escapeHtml(statusWord),
    "__USER_ID__": escapeHtml(String(model.userId || "Nao identificado")),
    "__EXPIRES_AT__": escapeHtml(formatTimestamp(model.expiresAt)),
    "__SCOPE_COUNT__": escapeHtml(String(model.scopeCount)),
    "__PRIMARY_HREF__": escapeHtml(model.primaryHref),
    "__PRIMARY_LABEL__": escapeHtml(model.primaryLabel),
    "__SECONDARY_HREF__": escapeHtml(model.secondaryHref),
    "__SECONDARY_LABEL__": escapeHtml(model.secondaryLabel),
    "__DETAILS_TITLE__": escapeHtml(model.detailsTitle),
    "__DETAILS_ITEMS__": detailsMarkup,
  });
}

function buildCallbackResultViewModel(model) {
  const status = model.status === "error" ? "error" : "success";
  const statusWord = status === "success" ? "Conexao concluida" : "Falha na autorizacao";
  const details = Array.isArray(model.details)
    ? model.details.map((item) => String(item))
    : [];

  return {
    status,
    title: String(model.title || "Resultado do callback"),
    badge: String(model.badge || "OAuth"),
    headline: String(model.headline || "Resultado da autorizacao"),
    message: String(model.message || ""),
    statusWord,
    userId: String(model.userId || "Nao identificado"),
    expiresAt: formatTimestamp(model.expiresAt),
    scopeCount: String(model.scopeCount || 0),
    primaryHref: String(model.primaryHref || "/"),
    primaryLabel: String(model.primaryLabel || "Voltar ao integrador"),
    secondaryHref: String(model.secondaryHref || "/auth/status"),
    secondaryLabel: String(model.secondaryLabel || "Ver status"),
    detailsTitle: String(model.detailsTitle || "Detalhes"),
    details: details.length > 0
      ? details
      : ["Nenhuma informacao adicional disponivel."],
  };
}

function toSafeJsonForInlineScript(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function getCallbackResultAppBundle() {
  if (!fs.existsSync(CALLBACK_RESULT_APP_INDEX_FILE)) {
    return null;
  }

  const indexTemplate = fs.readFileSync(CALLBACK_RESULT_APP_INDEX_FILE, "utf8");
  const cssMatch = indexTemplate.match(/<link[^>]+href="([^"]+\.css)"[^>]*>/i);
  const jsMatch = indexTemplate.match(/<script[^>]+src="([^"]+\.js)"[^>]*><\/script>/i);

  if (!cssMatch || !jsMatch) {
    return null;
  }

  const cssRelativePath = cssMatch[1].replace(/^\.\//, "");
  const jsRelativePath = jsMatch[1].replace(/^\.\//, "");
  const cssFilePath = path.resolve(CALLBACK_RESULT_APP_DIST_DIR, cssRelativePath);
  const jsFilePath = path.resolve(CALLBACK_RESULT_APP_DIST_DIR, jsRelativePath);
  const distPrefix = `${CALLBACK_RESULT_APP_DIST_DIR}${path.sep}`;
  const isCssInsideDist = cssFilePath.startsWith(distPrefix);
  const isJsInsideDist = jsFilePath.startsWith(distPrefix);

  if (!isCssInsideDist || !isJsInsideDist) {
    return null;
  }

  if (!fs.existsSync(cssFilePath) || !fs.existsSync(jsFilePath)) {
    return null;
  }

  return {
    indexTemplate,
    cssFilePath,
    jsFilePath,
  };
}

function renderCallbackResultApp(model) {
  const bundle = getCallbackResultAppBundle();
  if (!bundle) {
    return null;
  }

  const viewModel = buildCallbackResultViewModel(model);
  const serializedModel = toSafeJsonForInlineScript(viewModel);
  let html = bundle.indexTemplate;

  html = html.replace(/<html[^>]*lang="[^"]*"[^>]*>/i, '<html lang="pt-BR">');
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(viewModel.title)}</title>`);
  html = html.replace(
    /<link[^>]+href="[^"]+\.css"[^>]*>/i,
    '<link rel="stylesheet" href="callback/assets/css">'
  );

  const scriptMarkup = `<script>window.__CALLBACK_RESULT_MODEL__=${serializedModel};</script><script type="module" src="callback/assets/js"></script>`;
  if (/<script[^>]+src="[^"]+\.js"[^>]*><\/script>/i.test(html)) {
    html = html.replace(/<script[^>]+src="[^"]+\.js"[^>]*><\/script>/i, scriptMarkup);
  } else {
    html = html.replace("</body>", `${scriptMarkup}</body>`);
  }

  return html;
}

function sendCallbackResponse(req, res, statusCode, model, jsonPayload) {
  if (requestWantsJson(req)) {
    res.status(statusCode).json(jsonPayload);
    return;
  }

  const appHtml = renderCallbackResultApp(model);
  if (appHtml) {
    res.status(statusCode).type("html").send(appHtml);
    return;
  }

  res.status(statusCode).type("html").send(renderCallbackResultPage(model));
}

function buildAdminDashboardPayload(authorizations, tokens, configErrors = getConfigErrors()) {
  const sortedAuthorizations = [...authorizations].sort((left, right) => {
    const leftTime = new Date(left.authorized_at || 0).getTime();
    const rightTime = new Date(right.authorized_at || 0).getTime();
    return rightTime - leftTime;
  });
  const statusCounters = sortedAuthorizations.reduce(
    (counters, record) => {
      const status = getAuthorizationStatus(record);

      if (status === "Ativo") {
        counters.active += 1;
      } else if (status === "Expirado") {
        counters.expired += 1;
      } else {
        counters.timeless += 1;
      }

      return counters;
    },
    { active: 0, expired: 0, timeless: 0 }
  );

  const totalAuthorizations = sortedAuthorizations.length;
  const uniqueUsers = new Set(
    sortedAuthorizations
      .filter((record) => record.user_id !== null && record.user_id !== undefined)
      .map((record) => String(record.user_id))
  ).size;
  const activePercent = toPercent(statusCounters.active, totalAuthorizations);
  const expiredPercent = toPercent(statusCounters.expired, totalAuthorizations);
  const timelessPercent = toPercent(statusCounters.timeless, totalAuthorizations);

  return {
    configured: configErrors.length === 0,
    config_errors: configErrors,
    dashboard_path: ADMIN_DASHBOARD_PATH,
    public_dashboard_path: PUBLIC_DASHBOARD_PATH,
    dashboard_enabled: Boolean(ADMIN_DASHBOARD_TOKEN),
    authorizations_file: AUTHORIZATIONS_FILE,
    total_authorizations: totalAuthorizations,
    unique_users: uniqueUsers,
    active_authorizations: statusCounters.active,
    expired_authorizations: statusCounters.expired,
    timeless_authorizations: statusCounters.timeless,
    active_percent: activePercent,
    expired_percent: expiredPercent,
    timeless_percent: timelessPercent,
    latest_authorized_at: sortedAuthorizations[0]?.authorized_at || null,
    latest_user_id: sortedAuthorizations[0]?.user_id || null,
    has_current_token: hasUsableTokens(tokens),
    current_token_expired: tokenIsExpired(tokens),
    current_token_user_id: tokens?.user_id || null,
    current_scope_count: countScopes(tokens?.scope || ""),
    current_scope_summary: summarizeScope(tokens?.scope || "", 4),
    current_token: tokenPreview(tokens),
    authorizations: sortedAuthorizations.map((record) => ({
      ...record,
      status: getAuthorizationStatus(record),
      scope_count: countScopes(record.scope || ""),
      scope_summary: summarizeScope(record.scope || "", 4),
    })),
  };
}

function renderAdminDashboard(payload) {
  const template = fs.readFileSync(ADMIN_DASHBOARD_FILE, "utf8");
  const cards = payload.authorizations.length > 0
    ? payload.authorizations.map((record) => {
        const isCurrentUser =
          payload.current_token_user_id !== null &&
          payload.current_token_user_id !== undefined &&
          String(payload.current_token_user_id) === String(record.user_id);
        const userId = String(record.user_id || "Nao identificado");
        const scope = String(record.scope || "Nao informado");
        const searchText = [userId, record.status, scope, record.access_token_preview, record.refresh_token_preview]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        const statusClass =
          record.status === "Ativo"
            ? "is-active"
            : record.status === "Expirado"
              ? "is-expired"
              : "is-timeless";

        return `<article class="integration-card ${isCurrentUser ? "is-current" : ""}" data-record-card="true" data-status="${escapeHtml(record.status)}" data-current="${isCurrentUser ? "true" : "false"}" data-search="${escapeHtml(searchText)}">
          <div class="integration-card__header">
            <div class="integration-card__identity">
              <span class="user-badge">${escapeHtml(buildUserBadge(record.user_id))}</span>
              <div>
                <p class="integration-card__eyebrow">${isCurrentUser ? "Token operacional atual" : "Historico de autorizacao"}</p>
                <h3 class="integration-card__title">Conta ${escapeHtml(userId)}</h3>
              </div>
            </div>
            <span class="status-pill ${statusClass}">${escapeHtml(record.status)}</span>
          </div>

          <div class="integration-card__grid">
            <div class="info-tile">
              <span class="info-tile__label">Autorizado em</span>
              <strong class="info-tile__value">${escapeHtml(formatTimestamp(record.authorized_at))}</strong>
            </div>
            <div class="info-tile">
              <span class="info-tile__label">Expira em</span>
              <strong class="info-tile__value">${escapeHtml(formatTimestamp(record.expires_at))}</strong>
            </div>
            <div class="info-tile">
              <span class="info-tile__label">Scopes liberados</span>
              <strong class="info-tile__value">${escapeHtml(String(record.scope_count))}</strong>
            </div>
          </div>

          <div class="integration-card__scope">
            <span class="integration-card__eyebrow">Resumo dos scopes</span>
            <p class="integration-card__scope-text">${escapeHtml(record.scope_summary)}</p>
          </div>

          <details class="integration-card__details">
            <summary>Detalhes tecnicos</summary>
            <div class="details-grid">
              <div class="detail-chip">
                <span>Access token</span>
                <code>${escapeHtml(record.access_token_preview || "Nao disponivel")}</code>
              </div>
              <div class="detail-chip">
                <span>Refresh token</span>
                <code>${escapeHtml(record.refresh_token_preview || "Nao disponivel")}</code>
              </div>
              <div class="detail-chip detail-chip--wide">
                <span>Scopes completos</span>
                <code>${escapeHtml(scope)}</code>
              </div>
            </div>
          </details>
        </article>`;
      }).join("")
    : "";

  const currentTokenStatus = !payload.has_current_token
    ? "Sem token ativo"
    : payload.current_token_expired
      ? "Token expirado"
      : "Token ativo";

  return applyTemplate(template, {
    "__PAGE_TITLE__": "Painel administrativo | Integracoes Mercado Livre",
    "__TOTAL_AUTHORIZATIONS__": String(payload.total_authorizations),
    "__UNIQUE_USERS__": String(payload.unique_users),
    "__ACTIVE_AUTHORIZATIONS__": String(payload.active_authorizations),
    "__EXPIRED_AUTHORIZATIONS__": String(payload.expired_authorizations),
    "__TIMELESS_AUTHORIZATIONS__": String(payload.timeless_authorizations),
    "__ACTIVE_PERCENT__": String(payload.active_percent),
    "__EXPIRED_PERCENT__": String(payload.expired_percent),
    "__TIMELESS_PERCENT__": String(payload.timeless_percent),
    "__LATEST_AUTHORIZED_AT__": escapeHtml(formatTimestamp(payload.latest_authorized_at)),
    "__LATEST_USER_ID__": escapeHtml(String(payload.latest_user_id || "Nao identificado")),
    "__CURRENT_TOKEN_STATUS__": escapeHtml(currentTokenStatus),
    "__CURRENT_USER_ID__": escapeHtml(String(payload.current_token_user_id || "Nao identificado")),
    "__CURRENT_SCOPE_COUNT__": escapeHtml(String(payload.current_scope_count)),
    "__CURRENT_SCOPE_SUMMARY__": escapeHtml(payload.current_scope_summary),
    "__CURRENT_SCOPE__": escapeHtml(payload.current_token?.scope || "Nao informado"),
    "__CURRENT_EXPIRES_AT__": escapeHtml(formatTimestamp(payload.current_token?.expires_at)),
    "__CURRENT_ACCESS_TOKEN__": escapeHtml(payload.current_token?.access_token || "Nao disponivel"),
    "__CURRENT_REFRESH_TOKEN__": escapeHtml(payload.current_token?.refresh_token || "Nao disponivel"),
    "__AUTHORIZATIONS_FILE__": escapeHtml(AUTHORIZATIONS_FILE),
    "__CONFIG_STATUS__": payload.configured ? "Configurado" : "Pendencias detectadas",
    "__PUBLIC_DASHBOARD_PATH__": escapeHtml(PUBLIC_DASHBOARD_PATH),
    "__DISTRIBUTION_CLASS__": payload.total_authorizations > 0 ? "" : "is-empty",
    "__CONFIG_ERRORS__": payload.config_errors.length > 0
      ? payload.config_errors.map((message) => `<li>${escapeHtml(message)}</li>`).join("")
      : "<li>Nenhuma pendencia de configuracao.</li>",
    "__INTEGRATION_CARDS__": cards,
    "__DASHBOARD_PATH__": escapeHtml(ADMIN_DASHBOARD_PATH),
  });
}

function renderAdminDashboardApp() {
  if (!fs.existsSync(ADMIN_DASHBOARD_APP_INDEX_FILE)) {
    return null;
  }

  return fs.readFileSync(ADMIN_DASHBOARD_APP_INDEX_FILE, "utf8");
}

app.get("/", (req, res) => {
  const configErrors = getConfigErrors();
  if (requestWantsJson(req)) {
    res.json(buildRootPayload(configErrors));
    return;
  }

  try {
    const html = renderRedirectPage(configErrors);
    res.type("html").send(html);
  } catch (errorObj) {
    const redirectTarget = configErrors.length > 0 ? "auth/status" : "auth/start";
    console.error(`Falha ao renderizar pagina de redirect: ${errorObj.message}`);
    res.redirect(redirectTarget);
  }
});

app.get("/auth/start", (req, res) => {
  if (!ensureConfigured(res)) {
    return;
  }

  cleanupStates();
  const state = generateState();
  const authorizationUrl = buildAuthorizationUrl(state);
  res.redirect(authorizationUrl);
});

app.get("/callback/assets/:assetType", (req, res) => {
  const bundle = getCallbackResultAppBundle();
  if (!bundle) {
    res.status(404).json({
      error: "callback_result_app_not_built",
      message: "Build da interface de callback nao encontrado.",
    });
    return;
  }

  const assetType = String(req.params.assetType || "").toLowerCase();
  const filePath = assetType === "css"
    ? bundle.cssFilePath
    : assetType === "js"
      ? bundle.jsFilePath
      : null;

  if (!filePath) {
    res.status(404).type("text/plain").send("Asset nao encontrado");
    return;
  }

  const contentType = assetType === "css" ? "text/css; charset=utf-8" : "application/javascript; charset=utf-8";
  const content = fs.readFileSync(filePath, "utf8");

  res.set("Cache-Control", "no-store");
  res.type(contentType).send(content);
});

app.get("/callback", async (req, res) => {
  if (!ensureConfigured(res)) {
    return;
  }

  const { code, state, error, error_description: errorDescription } = req.query;

  if (error) {
    sendCallbackResponse(
      req,
      res,
      400,
      buildCallbackResultModel({
        status: "error",
        title: "Autorizacao recusada | Integrador Mercado Livre",
        badge: "Mercado Livre",
        headline: "A autorizacao nao foi concluida",
        message: errorDescription || "O Mercado Livre retornou uma recusa durante o fluxo OAuth.",
        primaryHref: "/auth/start",
        primaryLabel: "Tentar novamente",
        secondaryHref: "/auth/status",
        secondaryLabel: "Ver diagnostico",
        detailsTitle: "Detalhes do retorno",
        details: [`Erro: ${error}`, `Descricao: ${errorDescription || "Autorizacao negada"}`],
      }),
      {
        error,
        error_description: errorDescription || "Autorização negada",
      }
    );
    return;
  }

  if (!code) {
    sendCallbackResponse(
      req,
      res,
      400,
      buildCallbackResultModel({
        status: "error",
        title: "Codigo ausente | Integrador Mercado Livre",
        badge: "Mercado Livre",
        headline: "Nao recebemos o codigo do OAuth",
        message: "O callback chegou sem o parametro code. Reinicie a autorizacao para continuar.",
        primaryHref: "/auth/start",
        primaryLabel: "Iniciar OAuth novamente",
        secondaryHref: "/auth/status",
        secondaryLabel: "Ver diagnostico",
        detailsTitle: "O que verificar",
        details: [
          "O callback precisa receber o parametro code enviado pelo Mercado Livre.",
          "Se a janela foi reutilizada, gere um novo fluxo em /auth/start.",
        ],
      }),
      { error: "missing_code", message: "Parâmetro code ausente" }
    );
    return;
  }

  if (!state || !pendingStates.has(state)) {
    sendCallbackResponse(
      req,
      res,
      400,
      buildCallbackResultModel({
        status: "error",
        title: "State invalido | Integrador Mercado Livre",
        badge: "Mercado Livre",
        headline: "O state expirou ou nao confere",
        message: "Essa resposta de callback nao corresponde a um fluxo OAuth ativo no servidor.",
        primaryHref: "/auth/start",
        primaryLabel: "Gerar nova autorizacao",
        secondaryHref: "/auth/status",
        secondaryLabel: "Ver diagnostico",
        detailsTitle: "Causas comuns",
        details: [
          "O link de autorizacao ficou aberto por muito tempo.",
          "A pagina de callback foi recarregada apos o primeiro uso.",
        ],
      }),
      { error: "invalid_state", message: "State inválido ou expirado" }
    );
    return;
  }

  pendingStates.delete(state);

  try {
    const tokenResponse = await requestToken({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code: String(code),
      redirect_uri: REDIRECT_URI,
    });

    const savedTokens = writeTokens(tokenResponse);
    appendAuthorizationRecord(savedTokens);
    sendCallbackResponse(
      req,
      res,
      200,
      buildCallbackResultModel({
        status: "success",
        title: "Conta conectada | Integrador Mercado Livre",
        badge: "OAuth concluido",
        headline: "Conta Mercado Livre conectada com sucesso",
        message: "A autorizacao foi concluida. O token ja foi salvo no servidor e a integracao esta pronta para operacao.",
        userId: savedTokens.user_id || null,
        expiresAt: savedTokens.expires_at || null,
        scopeCount: countScopes(savedTokens.scope || ""),
        primaryHref: "/auth/status",
        primaryLabel: "Ver status da integracao",
        secondaryHref: "/",
        secondaryLabel: "Voltar ao integrador",
        detailsTitle: "Proximos passos",
        details: [
          "Voce pode fechar esta janela se o fluxo foi aberto em outra aba.",
          "A equipe operacional ja consegue acompanhar a autorizacao no painel administrativo.",
          `Scopes liberados: ${countScopes(savedTokens.scope || "")}`,
        ],
      }),
      {
        message: "Token salvo com sucesso",
        tokens: tokenPreview(savedTokens),
      }
    );
  } catch (errorObj) {
    const formatted = formatAxiosError(errorObj);
    sendCallbackResponse(
      req,
      res,
      formatted.status,
      buildCallbackResultModel({
        status: "error",
        title: "Falha ao trocar token | Integrador Mercado Livre",
        badge: "OAuth interrompido",
        headline: "Nao foi possivel concluir a troca do codigo por token",
        message: "O Mercado Livre respondeu com erro durante a etapa final da autorizacao.",
        primaryHref: "/auth/start",
        primaryLabel: "Gerar nova tentativa",
        secondaryHref: "/auth/status",
        secondaryLabel: "Ver diagnostico",
        detailsTitle: "Resposta recebida",
        details: [JSON.stringify(formatted.data)],
      }),
      {
        error: "token_exchange_failed",
        details: formatted.data,
      }
    );
  }
});

app.post("/auth/refresh", async (req, res) => {
  if (!ensureConfigured(res)) {
    return;
  }

  try {
    const storedTokens = readTokens();
    if (!storedTokens || !storedTokens.refresh_token) {
      res.status(400).json({
        error: "missing_refresh_token",
        message: "Nenhum refresh_token encontrado em tokens.json",
      });
      return;
    }

    const refreshResponse = await requestToken({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: storedTokens.refresh_token,
    });

    const mergedTokens = {
      ...storedTokens,
      ...refreshResponse,
    };

    const savedTokens = writeTokens(mergedTokens);
    res.json({
      message: "Token renovado com sucesso",
      tokens: tokenPreview(savedTokens),
      expired: tokenIsExpired(savedTokens),
    });
  } catch (errorObj) {
    const formatted = formatAxiosError(errorObj);
    res.status(formatted.status).json({
      error: "token_refresh_failed",
      details: formatted.data,
    });
  }
});

app.get("/auth/status", (req, res) => {
  try {
    const tokens = readTokens();
    const configErrors = getConfigErrors();

    res.json({
      configured: configErrors.length === 0,
      config_errors: configErrors,
      has_tokens: hasUsableTokens(tokens),
      expired: tokenIsExpired(tokens),
      notifications_path: NOTIFICATIONS_PATH,
      notifications_url: NOTIFICATIONS_URL || null,
      notifications_file: NOTIFICATIONS_FILE,
      authorizations_file: AUTHORIZATIONS_FILE,
      admin_dashboard_path: ADMIN_DASHBOARD_PATH,
      admin_dashboard_enabled: Boolean(ADMIN_DASHBOARD_TOKEN),
      total_authorizations: readAuthorizations().length,
      tokens: tokenPreview(tokens),
    });
  } catch (errorObj) {
    res.status(500).json({
      error: "invalid_storage_file",
      message: errorObj.message,
    });
  }
});

app.get(NOTIFICATIONS_PATH, (req, res) => {
  res.json({
    message: "Endpoint de notificações ativo",
    method: "POST",
    notifications_path: NOTIFICATIONS_PATH,
    notifications_url: NOTIFICATIONS_URL || null,
  });
});

app.get(ADMIN_DASHBOARD_PATH, (req, res) => {
  if (!ensureAdminDashboardAccess(req, res)) {
    return;
  }

  const wantsJson = requestWantsJson(req);
  if (!wantsJson && !req.path.endsWith("/")) {
    const queryIndex = req.originalUrl.indexOf("?");
    const querySuffix = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : "";
    res.redirect(302, `integrations/${querySuffix}`);
    return;
  }

  try {
    const tokens = readTokens();
    const authorizations = readAuthorizations();
    const payload = buildAdminDashboardPayload(authorizations, tokens);

    if (wantsJson) {
      res.json(payload);
      return;
    }

    const appHtml = renderAdminDashboardApp();
    if (appHtml) {
      res.type("html").send(appHtml);
      return;
    }

    const html = renderAdminDashboard(payload);
    res.type("html").send(html);
  } catch (errorObj) {
    res.status(500).json({
      error: "admin_dashboard_failed",
      message: errorObj.message,
    });
  }
});

app.post(NOTIFICATIONS_PATH, (req, res) => {
  try {
    appendNotification({
      body: req.body || null,
      query: req.query || null,
      headers: {
        "x-request-id": req.headers["x-request-id"] || null,
        "x-real-ip": req.headers["x-real-ip"] || null,
        "x-forwarded-for": req.headers["x-forwarded-for"] || null,
        "user-agent": req.headers["user-agent"] || null,
      },
    });

    // Mercado Livre espera resposta rápida da URL de notificações.
    res.status(200).json({ ok: true });
  } catch (errorObj) {
    res.status(500).json({
      ok: false,
      error: "notification_persist_failed",
      message: errorObj.message,
    });
  }
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
  });
});

function startServer(port = PORT) {
  return app.listen(port, () => {
    console.log(`Servidor rodando em http://localhost:${port}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  startServer,
};
