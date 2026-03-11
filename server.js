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
const WEBHOOK_PATH_RAW = process.env.MELI_WEBHOOK_PATH || "/mercadolivre/webhook";
const WEBHOOK_PATH = WEBHOOK_PATH_RAW.toLowerCase();
const WEBHOOK_DASHBOARD_PATH = "/integracoes/mercadolivre/webhooks";
const PUBLIC_WEBHOOK_DASHBOARD_PATH = `/meli${WEBHOOK_DASHBOARD_PATH}`;

const TOKENS_FILE = path.resolve(
  process.env.MELI_TOKENS_FILE || path.join(__dirname, "tokens.json")
);
const AUTHORIZATIONS_FILE = path.resolve(
  process.env.MELI_AUTHORIZATIONS_FILE || path.join(__dirname, "authorizations.json")
);
const NOTIFICATIONS_FILE = path.resolve(
  process.env.MELI_NOTIFICATIONS_FILE || path.join(__dirname, "notifications.log")
);
const INTEGRATIONS_FILE = path.resolve(
  process.env.MELI_INTEGRATIONS_FILE || path.join(path.dirname(AUTHORIZATIONS_FILE), "integrations.json")
);
const MELI_API_LOGS_FILE = path.resolve(
  process.env.MELI_API_LOGS_FILE || path.join(path.dirname(NOTIFICATIONS_FILE), "meli-api-logs.json")
);
const WEBHOOKS_FILE = path.resolve(
  process.env.MELI_WEBHOOKS_FILE || path.join(path.dirname(TOKENS_FILE), "webhooks.json")
);
const WEBHOOK_EVENTS_FILE = path.resolve(
  process.env.MELI_WEBHOOK_EVENTS_FILE || path.join(path.dirname(TOKENS_FILE), "webhook-events.json")
);
const WEBHOOK_PROCESS_LOG_FILE = path.resolve(
  process.env.MELI_WEBHOOK_PROCESS_LOG_FILE || path.join(path.dirname(NOTIFICATIONS_FILE), "webhook-process.log")
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
const WEBHOOK_DASHBOARD_FILE = path.resolve(__dirname, "public", "webhooks-dashboard.html");
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
const WEBHOOK_MONITOR_APP_DIST_DIR = path.resolve(
  __dirname,
  "public",
  "meli-webhook-monitor",
  "dist"
);
const WEBHOOK_MONITOR_APP_INDEX_FILE = path.resolve(
  WEBHOOK_MONITOR_APP_DIST_DIR,
  "index.html"
);
const WEBHOOK_MONITOR_APP_ASSETS_DIR = path.resolve(
  WEBHOOK_MONITOR_APP_DIST_DIR,
  "assets"
);
const AUTH_URL = "https://auth.mercadolivre.com.br/authorization";
const TOKEN_URL = "https://api.mercadolibre.com/oauth/token";
const MELI_API_BASE_URL = "https://api.mercadolibre.com";
const STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;
const WEBHOOK_ROUTE_PATHS = [...new Set([NOTIFICATIONS_PATH, WEBHOOK_PATH])];
const WEBHOOK_ROUTE_PATHS_NORMALIZED = WEBHOOK_ROUTE_PATHS.map((routePath) =>
  routePath.replace(/\/+$/, "") || "/"
);

const pendingStates = new Map();
app.use("/assets/zoi", express.static(ZOI_STYLES_DIR));
app.use(
  `${ADMIN_DASHBOARD_PATH}/assets`,
  express.static(ADMIN_DASHBOARD_APP_ASSETS_DIR, {
    maxAge: "7d",
    immutable: true,
  })
);
app.use(
  `${WEBHOOK_DASHBOARD_PATH}/assets`,
  express.static(WEBHOOK_MONITOR_APP_ASSETS_DIR, {
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

  if (WEBHOOK_PATH_RAW !== WEBHOOK_PATH) {
    errors.push("MELI_WEBHOOK_PATH deve usar apenas minusculas");
  }

  if (!WEBHOOK_PATH.startsWith("/")) {
    errors.push("MELI_WEBHOOK_PATH deve iniciar com /");
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
    access_token: toNullableString(tokens.access_token),
    refresh_token: toNullableString(tokens.refresh_token),
  };
}

function appendAuthorizationRecord(tokens) {
  const records = readAuthorizations();
  const record = buildAuthorizationRecord(tokens);
  records.push(record);
  writeAuthorizations(records);
  return record;
}

function readIntegrations() {
  const records = readJsonFile(INTEGRATIONS_FILE, []);
  if (Array.isArray(records)) {
    return records;
  }

  throw new Error("Arquivo de integracoes invalido: esperado um array JSON");
}

function writeIntegrations(records) {
  fs.mkdirSync(path.dirname(INTEGRATIONS_FILE), { recursive: true });
  fs.writeFileSync(INTEGRATIONS_FILE, JSON.stringify(records, null, 2), "utf8");
  return records;
}

function readMeliApiLogs() {
  const records = readJsonFile(MELI_API_LOGS_FILE, []);
  if (Array.isArray(records)) {
    return records;
  }

  throw new Error("Arquivo de logs da API ML invalido: esperado um array JSON");
}

function writeMeliApiLogs(records) {
  fs.mkdirSync(path.dirname(MELI_API_LOGS_FILE), { recursive: true });
  fs.writeFileSync(MELI_API_LOGS_FILE, JSON.stringify(records, null, 2), "utf8");
  return records;
}

function appendMeliApiLog(logRecord) {
  const records = readMeliApiLogs();
  records.push(logRecord);
  const maxRecords = 5000;
  if (records.length > maxRecords) {
    records.splice(0, records.length - maxRecords);
  }
  writeMeliApiLogs(records);
  return logRecord;
}

function generateRecordId() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
}

function readWebhookRecords() {
  const records = readJsonFile(WEBHOOKS_FILE, []);
  if (Array.isArray(records)) {
    return records;
  }

  throw new Error("Arquivo de webhooks invalido: esperado um array JSON");
}

function writeWebhookRecords(records) {
  fs.mkdirSync(path.dirname(WEBHOOKS_FILE), { recursive: true });
  fs.writeFileSync(WEBHOOKS_FILE, JSON.stringify(records, null, 2), "utf8");
  return records;
}

function readWebhookEvents() {
  const records = readJsonFile(WEBHOOK_EVENTS_FILE, []);
  if (Array.isArray(records)) {
    return records;
  }

  throw new Error("Arquivo de eventos de webhook invalido: esperado um array JSON");
}

function writeWebhookEvents(records) {
  fs.mkdirSync(path.dirname(WEBHOOK_EVENTS_FILE), { recursive: true });
  fs.writeFileSync(WEBHOOK_EVENTS_FILE, JSON.stringify(records, null, 2), "utf8");
  return records;
}

function appendWebhookRecord(record) {
  const records = readWebhookRecords();
  records.push(record);
  writeWebhookRecords(records);
  return record;
}

function getWebhookRecordById(webhookId) {
  const records = readWebhookRecords();
  return records.find((record) => record.id === webhookId) || null;
}

function updateWebhookRecord(webhookId, patch) {
  const records = readWebhookRecords();
  const index = records.findIndex((record) => record.id === webhookId);
  if (index === -1) {
    return null;
  }

  const currentRecord = records[index];
  const updatedRecord = {
    ...currentRecord,
    ...patch,
  };

  records[index] = updatedRecord;
  writeWebhookRecords(records);
  return updatedRecord;
}

function appendWebhookEvent(eventRecord) {
  const records = readWebhookEvents();
  records.push(eventRecord);
  writeWebhookEvents(records);
  return eventRecord;
}

function appendWebhookProcessLog(eventType, payload) {
  const logRecord = {
    event: eventType,
    timestamp: new Date().toISOString(),
    payload,
  };

  fs.mkdirSync(path.dirname(WEBHOOK_PROCESS_LOG_FILE), { recursive: true });
  fs.appendFileSync(WEBHOOK_PROCESS_LOG_FILE, `${JSON.stringify(logRecord)}\n`, "utf8");
}

function validateWebhookPayload(payload) {
  const errors = [];

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    errors.push("payload_deve_ser_objeto_json");
    return errors;
  }

  if (typeof payload.topic !== "string" || payload.topic.trim() === "") {
    errors.push("topic_obrigatorio");
  }

  if (typeof payload.resource !== "string" || payload.resource.trim() === "") {
    errors.push("resource_obrigatorio");
  }

  return errors;
}

function parseWebhookNumericField(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : value;
}

function getRequestIp(req) {
  const realIp = typeof req.headers["x-real-ip"] === "string" ? req.headers["x-real-ip"] : "";
  if (realIp) {
    return realIp.trim();
  }

  const forwarded = typeof req.headers["x-forwarded-for"] === "string" ? req.headers["x-forwarded-for"] : "";
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }

  return req.socket?.remoteAddress || null;
}

function isWebhookRoutePath(pathValue) {
  const normalizedPath = String(pathValue || "").toLowerCase().replace(/\/+$/, "") || "/";
  return WEBHOOK_ROUTE_PATHS_NORMALIZED.includes(normalizedPath);
}

function buildWebhookRecord(payload, req, validationErrors) {
  const safePayload = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  const topic = safePayload && typeof safePayload.topic === "string" ? safePayload.topic.trim() : "";
  const resource = safePayload && typeof safePayload.resource === "string"
    ? safePayload.resource.trim()
    : "";

  return {
    id: generateRecordId(),
    topic: topic || null,
    resource: resource || null,
    user_id: parseWebhookNumericField(safePayload?.user_id),
    application_id: parseWebhookNumericField(safePayload?.application_id),
    attempts: parseWebhookNumericField(safePayload?.attempts),
    sent: safePayload && typeof safePayload.sent === "string" ? safePayload.sent : null,
    received_at: new Date().toISOString(),
    processed: false,
    process_status: validationErrors.length > 0 ? "invalid_payload" : "pending",
    processed_at: null,
    error_message: null,
    resource_status_code: null,
    resource_latency_ms: null,
    validation_errors: validationErrors,
    payload: payload || null,
    request_meta: {
      ip: getRequestIp(req),
      user_agent: req.headers["user-agent"] || null,
      x_request_id: req.headers["x-request-id"] || null,
      x_forwarded_for: req.headers["x-forwarded-for"] || null,
      x_real_ip: req.headers["x-real-ip"] || null,
    },
  };
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

async function refreshTokenBundle(storedTokens, persistOnDisk = true) {
  if (!storedTokens || !storedTokens.refresh_token) {
    throw new Error("refresh_token_ausente");
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

  if (persistOnDisk) {
    return writeTokens(mergedTokens);
  }

  return mergedTokens;
}

async function refreshStoredTokens(storedTokens) {
  return refreshTokenBundle(storedTokens, true);
}

async function getUsableTokens() {
  const storedTokens = readTokens();
  if (!storedTokens || !storedTokens.access_token) {
    throw new Error("access_token_ausente");
  }

  if (!tokenIsExpired(storedTokens)) {
    return storedTokens;
  }

  return refreshStoredTokens(storedTokens);
}

function normalizeWebhookResource(resourceValue) {
  if (typeof resourceValue !== "string" || resourceValue.trim() === "") {
    throw new Error("resource_invalido");
  }

  const trimmed = resourceValue.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    const parsed = new URL(trimmed);
    if (parsed.hostname !== "api.mercadolibre.com") {
      throw new Error("resource_host_invalido");
    }

    const normalizedPath = `${parsed.pathname}${parsed.search || ""}`;
    return {
      path: normalizedPath || "/",
      url: parsed.toString(),
    };
  }

  const normalizedPath = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return {
    path: normalizedPath,
    url: `${MELI_API_BASE_URL}${normalizedPath}`,
  };
}

function extractResourceId(resourcePath) {
  if (!resourcePath || typeof resourcePath !== "string") {
    return null;
  }

  const normalizedPath = resourcePath.split("?")[0];
  const parts = normalizedPath.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

function compactErrorMessage(value, maxLength = 320) {
  if (!value) {
    return "erro_desconhecido";
  }

  let raw = "";
  if (typeof value === "string") {
    raw = value;
  } else if (typeof value.message === "string") {
    raw = value.message;
  } else {
    try {
      raw = JSON.stringify(value);
    } catch (_errorObj) {
      raw = String(value);
    }
  }

  if (raw.length <= maxLength) {
    return raw;
  }

  return `${raw.slice(0, maxLength)}...`;
}

function isObjectRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNullableString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return null;
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractAddressState(addressStateValue) {
  if (typeof addressStateValue === "string") {
    return addressStateValue;
  }

  if (isObjectRecord(addressStateValue)) {
    const stateId = toNullableString(addressStateValue.id);
    if (stateId) {
      return stateId;
    }

    return toNullableString(addressStateValue.name);
  }

  return null;
}

function inferAccountType(identificationType, businessName, firstName, lastName) {
  const normalizedIdentificationType = String(identificationType || "").trim().toUpperCase();
  if (normalizedIdentificationType === "CNPJ") {
    return "empresa";
  }

  if (normalizedIdentificationType === "CPF") {
    return "pessoa";
  }

  if (toNullableString(businessName)) {
    return "empresa";
  }

  if (toNullableString(firstName) || toNullableString(lastName)) {
    return "pessoa";
  }

  return "nao_informado";
}

function buildOwnerName(firstName, lastName) {
  const first = toNullableString(firstName) || "";
  const last = toNullableString(lastName) || "";
  const fullName = `${first} ${last}`.trim();
  return fullName || null;
}

function normalizeCnpj(identificationType, identificationNumber) {
  const normalizedType = String(identificationType || "").trim().toUpperCase();
  if (normalizedType !== "CNPJ") {
    return null;
  }

  const rawNumber = toNullableString(identificationNumber);
  if (!rawNumber) {
    return null;
  }

  const digits = rawNumber.replace(/\D/g, "");
  return digits || rawNumber;
}

function formatCnpj(cnpjValue) {
  const cnpj = toNullableString(cnpjValue);
  if (!cnpj) {
    return null;
  }

  const digits = cnpj.replace(/\D/g, "");
  if (digits.length !== 14) {
    return cnpj;
  }

  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

function buildIntegrationProfileFromUserMe(userPayload, tokens, existingRecord = null) {
  const nowIso = new Date().toISOString();
  const userRecord = isObjectRecord(userPayload) ? userPayload : {};
  const addressRecord = isObjectRecord(userRecord.address) ? userRecord.address : {};
  const reputationRecord = isObjectRecord(userRecord.seller_reputation) ? userRecord.seller_reputation : {};
  const businessRecord = isObjectRecord(userRecord.seller_business_info) ? userRecord.seller_business_info : {};
  const identificationRecord = isObjectRecord(businessRecord.identification)
    ? businessRecord.identification
    : {};

  const firstName = toNullableString(userRecord.first_name);
  const lastName = toNullableString(userRecord.last_name);
  const businessName = toNullableString(businessRecord.business_name);
  const brandName = toNullableString(businessRecord.brand_name);
  const identificationType = toNullableString(identificationRecord.type);
  const identificationNumber = toNullableString(identificationRecord.number);
  const accountType = inferAccountType(identificationType, businessName, firstName, lastName);

  return {
    id: existingRecord?.id || generateRecordId(),
    client_id: toNullableString(existingRecord?.client_id) || null,
    mercadolivre_user_id: toNullableNumber(userRecord.id) ?? toNullableNumber(tokens?.user_id),
    store_nickname: toNullableString(userRecord.nickname),
    owner_first_name: firstName,
    owner_last_name: lastName,
    owner_name: buildOwnerName(firstName, lastName),
    email: toNullableString(userRecord.email),
    business_name: businessName,
    brand_name: brandName,
    account_type: accountType,
    identification_type: identificationType,
    cnpj: normalizeCnpj(identificationType, identificationNumber),
    city: toNullableString(addressRecord.city),
    state: extractAddressState(addressRecord.state),
    reputation_level: toNullableString(reputationRecord.level_id),
    seller_experience: toNullableString(userRecord.seller_experience),
    account_created_at: toNullableString(userRecord.registration_date),
    access_token_preview: maskToken(tokens?.access_token),
    refresh_token_preview: maskToken(tokens?.refresh_token),
    token_expires_at: toNullableString(tokens?.expires_at),
    scope: toNullableString(tokens?.scope),
    integration_status: tokenIsExpired(tokens) ? "Expirada" : "Ativa",
    source: "users/me",
    raw_user_payload: userPayload || null,
    created_at: toNullableString(existingRecord?.created_at) || nowIso,
    updated_at: nowIso,
    last_enriched_at: nowIso,
  };
}

function upsertIntegrationProfileFromUserMe(userPayload, tokens) {
  const records = readIntegrations();
  const userId = toNullableNumber(isObjectRecord(userPayload) ? userPayload.id : null) ??
    toNullableNumber(tokens?.user_id);
  const userKey = userId === null ? null : String(userId);
  const index = userKey === null
    ? -1
    : records.findIndex((record) => String(record?.mercadolivre_user_id || "") === userKey);
  const existingRecord = index >= 0 ? records[index] : null;
  const normalizedRecord = buildIntegrationProfileFromUserMe(userPayload, tokens, existingRecord);

  if (index >= 0) {
    records[index] = normalizedRecord;
  } else {
    records.push(normalizedRecord);
  }

  writeIntegrations(records);
  return normalizedRecord;
}

function buildIntegrationProfileProjection(profileRecord) {
  if (!profileRecord) {
    return null;
  }

  const accountType = toNullableString(profileRecord.account_type) || "nao_informado";
  return {
    mercadolivre_user_id: profileRecord.mercadolivre_user_id ?? null,
    store_nickname: toNullableString(profileRecord.store_nickname),
    owner_first_name: toNullableString(profileRecord.owner_first_name),
    owner_last_name: toNullableString(profileRecord.owner_last_name),
    owner_name: toNullableString(profileRecord.owner_name),
    email: toNullableString(profileRecord.email),
    business_name: toNullableString(profileRecord.business_name),
    brand_name: toNullableString(profileRecord.brand_name),
    account_type: accountType,
    account_type_label: accountType === "empresa"
      ? "Empresa"
      : accountType === "pessoa"
        ? "Pessoa"
        : "Nao informado",
    identification_type: toNullableString(profileRecord.identification_type),
    cnpj: toNullableString(profileRecord.cnpj),
    cnpj_formatted: formatCnpj(profileRecord.cnpj),
    city: toNullableString(profileRecord.city),
    state: toNullableString(profileRecord.state),
    reputation_level: toNullableString(profileRecord.reputation_level),
    seller_experience: toNullableString(profileRecord.seller_experience),
    account_created_at: toNullableString(profileRecord.account_created_at),
    token_expires_at: toNullableString(profileRecord.token_expires_at),
    integration_status: toNullableString(profileRecord.integration_status),
    last_enriched_at: toNullableString(profileRecord.last_enriched_at),
  };
}

function buildIntegrationProfilesMap(records) {
  const profilesMap = new Map();

  for (const record of records) {
    const userId = toNullableNumber(record?.mercadolivre_user_id);
    if (userId === null) {
      continue;
    }

    profilesMap.set(String(userId), record);
  }

  return profilesMap;
}

function resolveWebhookUserId(record, latestEvent) {
  const payloadRecord = isObjectRecord(record?.payload) ? record.payload : {};
  const eventData = isObjectRecord(latestEvent?.data) ? latestEvent.data : {};
  const buyerRecord = isObjectRecord(eventData?.buyer) ? eventData.buyer : {};
  const sellerRecord = isObjectRecord(eventData?.seller) ? eventData.seller : {};
  const fromRecord = isObjectRecord(eventData?.from) ? eventData.from : {};
  const toRecord = isObjectRecord(eventData?.to) ? eventData.to : {};

  const candidates = [
    record?.user_id,
    payloadRecord.user_id,
    payloadRecord.seller_id,
    payloadRecord.receiver_id,
    eventData.user_id,
    eventData.seller_id,
    eventData.buyer_id,
    eventData.receiver_id,
    buyerRecord.id,
    sellerRecord.id,
    fromRecord.user_id,
    toRecord.user_id,
  ];

  for (const candidate of candidates) {
    const normalized = toNullableNumber(candidate);
    if (normalized !== null) {
      return normalized;
    }
  }

  return null;
}

async function requestUsersMe(accessToken) {
  return axios.get(`${MELI_API_BASE_URL}/users/me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    timeout: 15000,
  });
}

function appendUsersMeApiLog({
  integrationId = null,
  statusCode = null,
  requestTime,
  responseTimeMs,
  success,
  source,
  errorMessage = null,
}) {
  appendMeliApiLog({
    id: generateRecordId(),
    integration_id: integrationId,
    endpoint: "/users/me",
    request_time: requestTime,
    status_code: statusCode,
    response_time: responseTimeMs,
    response_time_ms: responseTimeMs,
    success,
    source: source || "unknown",
    error_message: errorMessage,
    created_at: new Date().toISOString(),
  });
}

async function enrichIntegrationProfileFromTokens(initialTokens = null, source = "manual", options = {}) {
  const persistRefreshToMainStore = options.persistRefreshToMainStore !== false;
  let refreshedToken = false;
  let tokens = initialTokens && (initialTokens.access_token || initialTokens.refresh_token)
    ? initialTokens
    : await getUsableTokens();

  if (!tokens.access_token && tokens.refresh_token) {
    tokens = await refreshTokenBundle(tokens, persistRefreshToMainStore);
    refreshedToken = true;
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const requestStartedAt = Date.now();
    const requestTime = new Date(requestStartedAt).toISOString();

    try {
      const response = await requestUsersMe(tokens.access_token);
      const responseTimeMs = Date.now() - requestStartedAt;
      const profileRecord = upsertIntegrationProfileFromUserMe(response.data, tokens);

      appendUsersMeApiLog({
        integrationId: toNullableNumber(response.data?.id) ?? toNullableNumber(tokens.user_id),
        statusCode: response.status,
        requestTime,
        responseTimeMs,
        success: true,
        source,
      });

      return {
        profile: profileRecord,
        tokens,
        refreshed: refreshedToken || attempt > 0,
        status_code: response.status,
        response_time_ms: responseTimeMs,
      };
    } catch (errorObj) {
      const formattedError = formatAxiosError(errorObj);
      const responseTimeMs = Date.now() - requestStartedAt;

      appendUsersMeApiLog({
        integrationId: toNullableNumber(tokens.user_id),
        statusCode: formattedError.status || null,
        requestTime,
        responseTimeMs,
        success: false,
        source,
        errorMessage: compactErrorMessage(formattedError.data || errorObj.message || "users_me_failed"),
      });

      const shouldRetryWithRefresh =
        formattedError.status === 401 &&
        attempt === 0 &&
        Boolean(tokens.refresh_token);

      if (!shouldRetryWithRefresh) {
        throw errorObj;
      }

      tokens = await refreshTokenBundle(tokens, persistRefreshToMainStore);
      refreshedToken = true;
    }
  }

  throw new Error("users_me_enrichment_failed");
}

function buildAuthorizationEnrichmentCandidates(authorizations, currentTokens = null) {
  const currentUserId = toNullableNumber(currentTokens?.user_id);
  const sortedAuthorizations = [...authorizations].sort((left, right) => {
    const leftTime = new Date(left.authorized_at || 0).getTime();
    const rightTime = new Date(right.authorized_at || 0).getTime();
    return rightTime - leftTime;
  });
  const candidates = [];
  const skipped = [];
  const dedupeKeys = new Set();

  for (const record of sortedAuthorizations) {
    const userId = toNullableNumber(record?.user_id);
    const accessToken = toNullableString(record?.access_token) || toNullableString(record?.accessToken);
    const refreshToken = toNullableString(record?.refresh_token) || toNullableString(record?.refreshToken);
    let tokenBundle = null;
    let source = "authorization_record";

    if (accessToken || refreshToken) {
      tokenBundle = {
        access_token: accessToken,
        refresh_token: refreshToken,
        user_id: userId,
        scope: toNullableString(record?.scope),
        expires_at: toNullableString(record?.expires_at),
        obtained_at: toNullableString(record?.authorized_at),
      };
    } else if (
      currentTokens &&
      currentTokens.access_token &&
      userId !== null &&
      currentUserId !== null &&
      userId === currentUserId
    ) {
      tokenBundle = {
        ...currentTokens,
        user_id: currentUserId,
      };
      source = "current_tokens_fallback";
    }

    if (!tokenBundle) {
      skipped.push({
        user_id: userId,
        authorization_id: toNullableString(record?.id),
        reason: "token_ausente_no_historico",
      });
      continue;
    }

    const dedupeKey = userId !== null
      ? `user:${userId}`
      : `token:${tokenBundle.refresh_token || tokenBundle.access_token}`;
    if (!dedupeKey || dedupeKeys.has(dedupeKey)) {
      continue;
    }

    dedupeKeys.add(dedupeKey);
    candidates.push({
      user_id: userId,
      authorization_id: toNullableString(record?.id),
      source,
      persist_refresh: source === "current_tokens_fallback",
      token_bundle: tokenBundle,
    });
  }

  if (currentTokens && currentTokens.access_token) {
    const fallbackKey = currentUserId !== null
      ? `user:${currentUserId}`
      : `token:${currentTokens.refresh_token || currentTokens.access_token}`;
    if (fallbackKey && !dedupeKeys.has(fallbackKey)) {
      candidates.unshift({
        user_id: currentUserId,
        authorization_id: null,
        source: "current_tokens",
        persist_refresh: true,
        token_bundle: currentTokens,
      });
    }
  }

  return {
    candidates,
    skipped,
  };
}

async function enrichIntegrationProfilesFromAuthorizations(authorizations, currentTokens = null, source = "admin_bulk") {
  const { candidates, skipped } = buildAuthorizationEnrichmentCandidates(authorizations, currentTokens);
  const enriched = [];
  const failed = [];
  let refreshedCount = 0;

  for (const candidate of candidates) {
    try {
      const enrichment = await enrichIntegrationProfileFromTokens(
        candidate.token_bundle,
        source,
        {
          persistRefreshToMainStore: candidate.persist_refresh,
        }
      );
      if (enrichment.refreshed) {
        refreshedCount += 1;
      }

      enriched.push({
        user_id: candidate.user_id ?? toNullableNumber(enrichment.profile?.mercadolivre_user_id),
        source: candidate.source,
        authorization_id: candidate.authorization_id,
        refreshed_token: enrichment.refreshed,
        status_code: enrichment.status_code,
        response_time_ms: enrichment.response_time_ms,
        profile: buildIntegrationProfileProjection(enrichment.profile),
      });
    } catch (errorObj) {
      failed.push({
        user_id: candidate.user_id,
        source: candidate.source,
        authorization_id: candidate.authorization_id,
        message: compactErrorMessage(errorObj?.message || errorObj),
      });
    }
  }

  return {
    total_candidates: candidates.length,
    total_enriched: enriched.length,
    total_failed: failed.length,
    total_skipped: skipped.length,
    refreshed_count: refreshedCount,
    enriched,
    failed,
    skipped,
  };
}

async function fetchWebhookResource(resourceValue) {
  const normalizedResource = normalizeWebhookResource(resourceValue);
  let usableTokens = await getUsableTokens();

  try {
    const response = await axios.get(normalizedResource.url, {
      headers: {
        Authorization: `Bearer ${usableTokens.access_token}`,
      },
      timeout: 15000,
    });

    return {
      response,
      normalizedResource,
      tokenUserId: usableTokens.user_id || null,
    };
  } catch (errorObj) {
    const isUnauthorized = axios.isAxiosError(errorObj) && errorObj.response?.status === 401;
    if (!isUnauthorized) {
      throw errorObj;
    }

    usableTokens = await refreshStoredTokens(usableTokens);
    const retryResponse = await axios.get(normalizedResource.url, {
      headers: {
        Authorization: `Bearer ${usableTokens.access_token}`,
      },
      timeout: 15000,
    });

    return {
      response: retryResponse,
      normalizedResource,
      tokenUserId: usableTokens.user_id || null,
    };
  }
}

async function processWebhookRecord(webhookId) {
  const currentRecord = getWebhookRecordById(webhookId);
  if (!currentRecord) {
    return;
  }

  if (currentRecord.process_status === "invalid_payload") {
    appendWebhookProcessLog("erro_consulta_api", {
      webhook_id: webhookId,
      reason: "payload_invalido",
      validation_errors: currentRecord.validation_errors || [],
    });
    return;
  }

  updateWebhookRecord(webhookId, {
    process_status: "processing",
  });

  const processingStartedAt = Date.now();

  try {
    const { response, normalizedResource } = await fetchWebhookResource(currentRecord.resource);
    const nowIso = new Date().toISOString();
    const latencyMs = Date.now() - processingStartedAt;

    appendWebhookEvent({
      id: generateRecordId(),
      webhook_id: webhookId,
      topic: currentRecord.topic || null,
      resource: normalizedResource.path,
      resource_id: extractResourceId(normalizedResource.path),
      status_code: response.status,
      data: response.data,
      created_at: nowIso,
    });

    updateWebhookRecord(webhookId, {
      resource: normalizedResource.path,
      processed: true,
      process_status: "processed",
      processed_at: nowIso,
      resource_status_code: response.status,
      resource_latency_ms: latencyMs,
      error_message: null,
    });

    appendWebhookProcessLog("webhook_processado", {
      webhook_id: webhookId,
      topic: currentRecord.topic || null,
      resource: normalizedResource.path,
      status_code: response.status,
      latency_ms: latencyMs,
    });
  } catch (errorObj) {
    const formattedError = formatAxiosError(errorObj);
    const nowIso = new Date().toISOString();
    const latencyMs = Date.now() - processingStartedAt;
    const errorMessage = compactErrorMessage(formattedError.data || errorObj.message || "erro_desconhecido");

    updateWebhookRecord(webhookId, {
      processed: false,
      process_status: "error",
      processed_at: nowIso,
      resource_status_code: formattedError.status || null,
      resource_latency_ms: latencyMs,
      error_message: errorMessage,
    });

    appendWebhookProcessLog("erro_consulta_api", {
      webhook_id: webhookId,
      topic: currentRecord.topic || null,
      resource: currentRecord.resource || null,
      status_code: formattedError.status || null,
      details: formattedError.data || errorMessage,
      latency_ms: latencyMs,
    });
  }
}

function queueWebhookProcessing(webhookId) {
  setImmediate(() => {
    processWebhookRecord(webhookId).catch((errorObj) => {
      appendWebhookProcessLog("erro_consulta_api", {
        webhook_id: webhookId,
        reason: "falha_inesperada_worker",
        details: compactErrorMessage(errorObj.message || errorObj),
      });
    });
  });
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

function getWebhookStatusLabel(statusValue) {
  if (statusValue === "processed") {
    return "Processado";
  }

  if (statusValue === "processing") {
    return "Processando";
  }

  if (statusValue === "pending") {
    return "Pendente";
  }

  if (statusValue === "invalid_payload") {
    return "Payload invalido";
  }

  if (statusValue === "error") {
    return "Erro";
  }

  return "Nao processado";
}

function getWebhookStatusClass(statusValue) {
  if (statusValue === "processed") {
    return "is-success";
  }

  if (statusValue === "processing") {
    return "is-warning";
  }

  if (statusValue === "pending") {
    return "is-pending";
  }

  if (statusValue === "invalid_payload" || statusValue === "error") {
    return "is-error";
  }

  return "is-pending";
}

function resolveWebhookStatus(record) {
  if (record && typeof record.process_status === "string" && record.process_status) {
    return record.process_status;
  }

  return record && record.processed ? "processed" : "pending";
}

function summarizeWebhookRecords(records) {
  return records.reduce(
    (counters, record) => {
      const statusValue = resolveWebhookStatus(record);

      if (statusValue === "processed") {
        counters.processed += 1;
      } else if (statusValue === "processing") {
        counters.processing += 1;
      } else if (statusValue === "invalid_payload") {
        counters.invalid += 1;
      } else if (statusValue === "error") {
        counters.error += 1;
      } else {
        counters.pending += 1;
      }

      return counters;
    },
    {
      processed: 0,
      processing: 0,
      pending: 0,
      invalid: 0,
      error: 0,
    }
  );
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
    webhook_path: WEBHOOK_PATH,
    webhook_paths: WEBHOOK_ROUTE_PATHS,
    notifications_url: NOTIFICATIONS_URL || null,
    webhook_dashboard_path: WEBHOOK_DASHBOARD_PATH,
    webhook_dashboard_enabled: Boolean(ADMIN_DASHBOARD_TOKEN),
    admin_dashboard_path: ADMIN_DASHBOARD_PATH,
    admin_dashboard_enabled: Boolean(ADMIN_DASHBOARD_TOKEN),
    admin_enrichment_path: `${ADMIN_DASHBOARD_PATH}/enrich`,
    integrations_file: INTEGRATIONS_FILE,
    meli_api_logs_file: MELI_API_LOGS_FILE,
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

function buildWebhookDashboardPayload(
  webhookRecords,
  webhookEvents,
  integrationProfiles = [],
  configErrors = getConfigErrors()
) {
  const sortedWebhooks = [...webhookRecords].sort((left, right) => {
    const leftTime = new Date(left.received_at || 0).getTime();
    const rightTime = new Date(right.received_at || 0).getTime();
    return rightTime - leftTime;
  });

  const sortedEvents = [...webhookEvents].sort((left, right) => {
    const leftTime = new Date(left.created_at || 0).getTime();
    const rightTime = new Date(right.created_at || 0).getTime();
    return rightTime - leftTime;
  });

  const latestEventByWebhook = new Map();
  for (const eventRecord of sortedEvents) {
    if (!latestEventByWebhook.has(eventRecord.webhook_id)) {
      latestEventByWebhook.set(eventRecord.webhook_id, eventRecord);
    }
  }

  const statusCounters = summarizeWebhookRecords(sortedWebhooks);
  const profilesByUserId = buildIntegrationProfilesMap(integrationProfiles);

  const totalReceived = sortedWebhooks.length;
  const totalErrors = statusCounters.error + statusCounters.invalid;
  const maxRows = 200;
  const hasMoreRows = totalReceived > maxRows;
  const visibleWebhooks = sortedWebhooks.slice(0, maxRows).map((record) => {
    const statusValue = resolveWebhookStatus(record);
    const latestEvent = latestEventByWebhook.get(record.id) || null;
    const resolvedUserId = resolveWebhookUserId(record, latestEvent);
    const profileRecord = resolvedUserId === null
      ? null
      : profilesByUserId.get(String(resolvedUserId)) || null;
    const profileProjection = buildIntegrationProfileProjection(profileRecord);

    return {
      ...record,
      user_id: resolvedUserId ?? record.user_id ?? null,
      resolved_user_id: resolvedUserId,
      process_status: statusValue,
      status_label: getWebhookStatusLabel(statusValue),
      status_class: getWebhookStatusClass(statusValue),
      has_profile: Boolean(profileProjection),
      profile: profileProjection,
      validation_errors: Array.isArray(record.validation_errors) ? record.validation_errors : [],
      event: latestEvent
        ? {
            id: latestEvent.id,
            topic: latestEvent.topic || null,
            resource: latestEvent.resource || null,
            resource_id: latestEvent.resource_id || null,
            status_code: latestEvent.status_code || null,
            created_at: latestEvent.created_at || null,
            data: latestEvent.data || null,
          }
        : null,
    };
  });

  const profileCoverage = sortedWebhooks.reduce(
    (accumulator, record) => {
      const latestEvent = latestEventByWebhook.get(record.id) || null;
      const resolvedUserId = resolveWebhookUserId(record, latestEvent);
      if (resolvedUserId === null) {
        accumulator.without_profile += 1;
        return accumulator;
      }

      const hasProfile = profilesByUserId.has(String(resolvedUserId));
      if (hasProfile) {
        accumulator.with_profile += 1;
        accumulator.unique_clients.add(String(resolvedUserId));
      } else {
        accumulator.without_profile += 1;
      }

      return accumulator;
    },
    {
      with_profile: 0,
      without_profile: 0,
      unique_clients: new Set(),
    }
  );

  const recentErrors = visibleWebhooks
    .filter((record) => record.process_status === "error" || record.process_status === "invalid_payload")
    .slice(0, 10)
    .map((record) => ({
      id: record.id,
      topic: record.topic || "Nao informado",
      resource: record.resource || "Nao informado",
      status: record.status_label,
      received_at: record.received_at,
      error_message: record.error_message || (record.validation_errors || []).join(", "),
    }));

  return {
    configured: configErrors.length === 0,
    config_errors: configErrors,
    dashboard_path: WEBHOOK_DASHBOARD_PATH,
    public_dashboard_path: PUBLIC_WEBHOOK_DASHBOARD_PATH,
    dashboard_enabled: Boolean(ADMIN_DASHBOARD_TOKEN),
    webhook_paths: WEBHOOK_ROUTE_PATHS,
    webhooks_file: WEBHOOKS_FILE,
    webhook_events_file: WEBHOOK_EVENTS_FILE,
    webhook_process_log_file: WEBHOOK_PROCESS_LOG_FILE,
    total_received: totalReceived,
    total_processed: statusCounters.processed,
    total_errors: totalErrors,
    total_pending: statusCounters.pending,
    total_processing: statusCounters.processing,
    total_invalid_payload: statusCounters.invalid,
    total_with_profile: profileCoverage.with_profile,
    total_without_profile: profileCoverage.without_profile,
    unique_identified_clients: profileCoverage.unique_clients.size,
    latest_received_at: sortedWebhooks[0]?.received_at || null,
    latest_processed_at: sortedEvents[0]?.created_at || null,
    webhooks_truncated: hasMoreRows,
    webhooks: visibleWebhooks,
    recent_errors: recentErrors,
  };
}

function renderWebhookDashboard(payload) {
  const template = fs.readFileSync(WEBHOOK_DASHBOARD_FILE, "utf8");
  const rowsMarkup = payload.webhooks.length > 0
    ? payload.webhooks.map((record) => {
      const clientLabel = record.profile?.store_nickname ||
        record.profile?.brand_name ||
        record.profile?.business_name ||
        record.profile?.owner_name ||
        "Nao identificado";
      const ownerLabel = record.profile?.owner_name || "Nao informado";
      const emailLabel = record.profile?.email || "Nao informado";
      const cnpjLabel = record.profile?.cnpj_formatted || record.profile?.cnpj || "Nao informado";
      const cityStateLabel = [record.profile?.city, record.profile?.state]
        .filter(Boolean)
        .join(" / ") || "Nao informado";
      const accountTypeLabel = record.profile?.account_type_label || "Nao informado";
      const reputationLabel = record.profile?.reputation_level || "Nao informado";

      return `<tr data-webhook-id="${escapeHtml(record.id)}">
        <td>${escapeHtml(formatTimestamp(record.received_at))}</td>
        <td>${escapeHtml(record.topic || "Nao informado")}</td>
        <td><code>${escapeHtml(record.resource || "Nao informado")}</code></td>
        <td><span class="status-pill ${escapeHtml(record.status_class)}">${escapeHtml(record.status_label)}</span></td>
        <td>${escapeHtml(String(record.resolved_user_id || record.user_id || "Nao informado"))}</td>
        <td>
          <div class="cell-stack">
            <strong>${escapeHtml(clientLabel)}</strong>
            <small class="cell-muted">${escapeHtml(ownerLabel)}</small>
          </div>
        </td>
        <td>
          <div class="cell-stack">
            <strong>${escapeHtml(emailLabel)}</strong>
            <small class="cell-muted">${escapeHtml(cnpjLabel)}</small>
          </div>
        </td>
        <td>
          <div class="cell-stack">
            <strong>${escapeHtml(cityStateLabel)}</strong>
            <small class="cell-muted">${escapeHtml(accountTypeLabel)} • ${escapeHtml(reputationLabel)}</small>
          </div>
        </td>
        <td><button type="button" class="btn-detail" data-webhook-detail="${escapeHtml(record.id)}">Ver JSON</button></td>
      </tr>`;
    }).join("")
    : `<tr class="is-empty">
        <td colspan="9">Nenhum webhook recebido ate o momento.</td>
      </tr>`;

  const serializedWebhooks = toSafeJsonForInlineScript(payload.webhooks);
  const configErrorsMarkup = payload.config_errors.length > 0
    ? payload.config_errors.map((errorValue) => `<li>${escapeHtml(errorValue)}</li>`).join("")
    : "<li>Nenhuma pendencia de configuracao.</li>";
  const recentErrorsMarkup = payload.recent_errors.length > 0
    ? payload.recent_errors.map((errorRecord) => `<li>
        <strong>${escapeHtml(errorRecord.status)}</strong>
        <span>${escapeHtml(errorRecord.topic)} • ${escapeHtml(errorRecord.resource)}</span>
        <small>${escapeHtml(formatTimestamp(errorRecord.received_at))}</small>
      </li>`).join("")
    : "<li>Nenhum erro recente.</li>";
  const truncationNotice = payload.webhooks_truncated
    ? "<p class=\"notice\">Exibindo os 200 webhooks mais recentes. Use format=json para extracao completa.</p>"
    : "";

  return applyTemplate(template, {
    "__PAGE_TITLE__": "Painel de webhooks | Integracoes Mercado Livre",
    "__TOTAL_RECEIVED__": String(payload.total_received),
    "__TOTAL_PROCESSED__": String(payload.total_processed),
    "__TOTAL_ERRORS__": String(payload.total_errors),
    "__TOTAL_PENDING__": String(payload.total_pending + payload.total_processing),
    "__TOTAL_WITH_PROFILE__": String(payload.total_with_profile),
    "__TOTAL_WITHOUT_PROFILE__": String(payload.total_without_profile),
    "__UNIQUE_IDENTIFIED_CLIENTS__": String(payload.unique_identified_clients),
    "__LATEST_RECEIVED_AT__": escapeHtml(formatTimestamp(payload.latest_received_at)),
    "__LATEST_PROCESSED_AT__": escapeHtml(formatTimestamp(payload.latest_processed_at)),
    "__WEBHOOK_PATHS__": escapeHtml(payload.webhook_paths.join(", ")),
    "__WEBHOOKS_FILE__": escapeHtml(payload.webhooks_file),
    "__WEBHOOK_EVENTS_FILE__": escapeHtml(payload.webhook_events_file),
    "__WEBHOOK_PROCESS_LOG_FILE__": escapeHtml(payload.webhook_process_log_file),
    "__CONFIG_STATUS__": payload.configured ? "Configurado" : "Pendencias detectadas",
    "__PUBLIC_DASHBOARD_PATH__": escapeHtml(payload.public_dashboard_path),
    "__DASHBOARD_PATH__": escapeHtml(payload.dashboard_path),
    "__CONFIG_ERRORS__": configErrorsMarkup,
    "__RECENT_ERRORS__": recentErrorsMarkup,
    "__WEBHOOK_ROWS__": rowsMarkup,
    "__WEBHOOK_DATA_JSON__": serializedWebhooks,
    "__TRUNCATION_NOTICE__": truncationNotice,
  });
}

function buildAdminDashboardPayload(
  authorizations,
  tokens,
  integrationProfiles = [],
  apiLogs = [],
  configErrors = getConfigErrors()
) {
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
  const sortedProfiles = [...integrationProfiles].sort((left, right) => {
    const leftTime = new Date(left.last_enriched_at || left.updated_at || 0).getTime();
    const rightTime = new Date(right.last_enriched_at || right.updated_at || 0).getTime();
    return rightTime - leftTime;
  });
  const profilesByUserId = buildIntegrationProfilesMap(sortedProfiles);
  const uniqueUsers = new Set(
    sortedAuthorizations
      .filter((record) => record.user_id !== null && record.user_id !== undefined)
      .map((record) => String(record.user_id))
  ).size;
  const activePercent = toPercent(statusCounters.active, totalAuthorizations);
  const expiredPercent = toPercent(statusCounters.expired, totalAuthorizations);
  const timelessPercent = toPercent(statusCounters.timeless, totalAuthorizations);
  const currentTokenUserId = toNullableNumber(tokens?.user_id);
  const currentProfile = currentTokenUserId === null
    ? null
    : buildIntegrationProfileProjection(profilesByUserId.get(String(currentTokenUserId)) || null);
  const latestMeliApiCallAt = [...apiLogs].reduce((latestValue, logRecord) => {
    const candidate = toNullableString(logRecord?.created_at) || toNullableString(logRecord?.request_time);
    if (!candidate) {
      return latestValue;
    }

    if (!latestValue) {
      return candidate;
    }

    const latestTime = new Date(latestValue).getTime();
    const candidateTime = new Date(candidate).getTime();
    if (Number.isNaN(candidateTime)) {
      return latestValue;
    }

    if (Number.isNaN(latestTime) || candidateTime > latestTime) {
      return candidate;
    }

    return latestValue;
  }, null);
  const profilesWithCnpj = sortedProfiles.filter((profileRecord) => toNullableString(profileRecord?.cnpj)).length;
  const authorizationsWithProfile = sortedAuthorizations.filter((record) => {
    const userId = toNullableNumber(record?.user_id);
    return userId !== null && profilesByUserId.has(String(userId));
  }).length;
  const mappedAuthorizations = sortedAuthorizations.map((record) => {
    const userId = toNullableNumber(record?.user_id);
    const profileRecord = userId === null ? null : profilesByUserId.get(String(userId)) || null;
    const profileProjection = buildIntegrationProfileProjection(profileRecord);
    const accessTokenPreview = toNullableString(record?.access_token_preview) || maskToken(record?.access_token);
    const refreshTokenPreview = toNullableString(record?.refresh_token_preview) || maskToken(record?.refresh_token);

    return {
      id: toNullableString(record?.id) || generateRecordId(),
      user_id: userId,
      scope: toNullableString(record?.scope),
      authorized_at: toNullableString(record?.authorized_at),
      expires_at: toNullableString(record?.expires_at),
      access_token_preview: accessTokenPreview,
      refresh_token_preview: refreshTokenPreview,
      has_saved_tokens: Boolean(toNullableString(record?.access_token) || toNullableString(record?.refresh_token)),
      status: getAuthorizationStatus(record),
      scope_count: countScopes(record.scope || ""),
      scope_summary: summarizeScope(record.scope || "", 4),
      has_profile: Boolean(profileProjection),
      profile_synced_at: profileProjection?.last_enriched_at || null,
      profile: profileProjection,
      store_nickname: profileProjection?.store_nickname || null,
      owner_name: profileProjection?.owner_name || null,
      owner_first_name: profileProjection?.owner_first_name || null,
      owner_last_name: profileProjection?.owner_last_name || null,
      email: profileProjection?.email || null,
      business_name: profileProjection?.business_name || null,
      brand_name: profileProjection?.brand_name || null,
      account_type: profileProjection?.account_type || null,
      account_type_label: profileProjection?.account_type_label || null,
      cnpj: profileProjection?.cnpj || null,
      cnpj_formatted: profileProjection?.cnpj_formatted || null,
      city: profileProjection?.city || null,
      state: profileProjection?.state || null,
      reputation_level: profileProjection?.reputation_level || null,
      seller_experience: profileProjection?.seller_experience || null,
      account_created_at: profileProjection?.account_created_at || null,
    };
  });

  return {
    configured: configErrors.length === 0,
    config_errors: configErrors,
    dashboard_path: ADMIN_DASHBOARD_PATH,
    public_dashboard_path: PUBLIC_DASHBOARD_PATH,
    dashboard_enabled: Boolean(ADMIN_DASHBOARD_TOKEN),
    webhook_dashboard_path: WEBHOOK_DASHBOARD_PATH,
    public_webhook_dashboard_path: PUBLIC_WEBHOOK_DASHBOARD_PATH,
    webhook_paths: WEBHOOK_ROUTE_PATHS,
    authorizations_file: AUTHORIZATIONS_FILE,
    integrations_file: INTEGRATIONS_FILE,
    meli_api_logs_file: MELI_API_LOGS_FILE,
    total_authorizations: totalAuthorizations,
    authorizations_with_profile: authorizationsWithProfile,
    unique_users: uniqueUsers,
    active_authorizations: statusCounters.active,
    expired_authorizations: statusCounters.expired,
    timeless_authorizations: statusCounters.timeless,
    active_percent: activePercent,
    expired_percent: expiredPercent,
    timeless_percent: timelessPercent,
    total_profiles: sortedProfiles.length,
    profiles_with_cnpj: profilesWithCnpj,
    latest_profile_sync_at: sortedProfiles[0]?.last_enriched_at || sortedProfiles[0]?.updated_at || null,
    total_meli_api_calls: apiLogs.length,
    latest_meli_api_call_at: latestMeliApiCallAt,
    latest_authorized_at: sortedAuthorizations[0]?.authorized_at || null,
    latest_user_id: sortedAuthorizations[0]?.user_id || null,
    has_current_token: hasUsableTokens(tokens),
    current_token_expired: tokenIsExpired(tokens),
    current_token_user_id: tokens?.user_id || null,
    current_scope_count: countScopes(tokens?.scope || ""),
    current_scope_summary: summarizeScope(tokens?.scope || "", 4),
    current_token: tokenPreview(tokens),
    current_profile: currentProfile,
    authorizations: mappedAuthorizations,
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

function renderWebhookDashboardApp() {
  if (!fs.existsSync(WEBHOOK_MONITOR_APP_INDEX_FILE)) {
    return null;
  }

  return fs.readFileSync(WEBHOOK_MONITOR_APP_INDEX_FILE, "utf8");
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
    let enrichedProfile = null;
    let enrichmentWarning = null;

    try {
      const enrichment = await enrichIntegrationProfileFromTokens(savedTokens, "oauth_callback");
      enrichedProfile = buildIntegrationProfileProjection(enrichment.profile);
    } catch (enrichmentError) {
      enrichmentWarning = compactErrorMessage(
        enrichmentError?.message || enrichmentError,
        240
      );
    }

    const callbackDetails = [
      "Voce pode fechar esta janela se o fluxo foi aberto em outra aba.",
      "A equipe operacional ja consegue acompanhar a autorizacao no painel administrativo.",
      `Scopes liberados: ${countScopes(savedTokens.scope || "")}`,
    ];

    if (enrichedProfile) {
      callbackDetails.push("Dados da conta Mercado Livre sincronizados via /users/me.");
    }

    if (enrichmentWarning) {
      callbackDetails.push(`Aviso de enriquecimento: ${enrichmentWarning}`);
    }

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
        details: callbackDetails,
      }),
      {
        message: "Token salvo com sucesso",
        tokens: tokenPreview(savedTokens),
        integration_profile: enrichedProfile,
        enrichment_warning: enrichmentWarning,
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

    const savedTokens = await refreshStoredTokens(storedTokens);
    let enrichedProfile = null;
    let enrichmentWarning = null;

    try {
      const enrichment = await enrichIntegrationProfileFromTokens(savedTokens, "token_refresh");
      enrichedProfile = buildIntegrationProfileProjection(enrichment.profile);
    } catch (enrichmentError) {
      enrichmentWarning = compactErrorMessage(
        enrichmentError?.message || enrichmentError,
        240
      );
    }

    res.json({
      message: "Token renovado com sucesso",
      tokens: tokenPreview(savedTokens),
      expired: tokenIsExpired(savedTokens),
      integration_profile: enrichedProfile,
      enrichment_warning: enrichmentWarning,
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
    const webhookRecords = readWebhookRecords();
    const webhookEvents = readWebhookEvents();
    const integrations = readIntegrations();
    const apiLogs = readMeliApiLogs();
    const currentUserProfile = integrations.find((profile) => {
      const profileUserId = toNullableNumber(profile?.mercadolivre_user_id);
      const currentUserId = toNullableNumber(tokens?.user_id);
      return profileUserId !== null && currentUserId !== null && profileUserId === currentUserId;
    }) || null;
    const webhookCounters = summarizeWebhookRecords(webhookRecords);

    res.json({
      configured: configErrors.length === 0,
      config_errors: configErrors,
      has_tokens: hasUsableTokens(tokens),
      expired: tokenIsExpired(tokens),
      notifications_path: NOTIFICATIONS_PATH,
      webhook_path: WEBHOOK_PATH,
      webhook_paths: WEBHOOK_ROUTE_PATHS,
      notifications_url: NOTIFICATIONS_URL || null,
      notifications_file: NOTIFICATIONS_FILE,
      webhooks_file: WEBHOOKS_FILE,
      webhook_events_file: WEBHOOK_EVENTS_FILE,
      webhook_process_log_file: WEBHOOK_PROCESS_LOG_FILE,
      integrations_file: INTEGRATIONS_FILE,
      meli_api_logs_file: MELI_API_LOGS_FILE,
      webhook_dashboard_path: WEBHOOK_DASHBOARD_PATH,
      webhook_dashboard_enabled: Boolean(ADMIN_DASHBOARD_TOKEN),
      total_webhooks_received: webhookRecords.length,
      total_webhooks_processed: webhookCounters.processed,
      total_webhooks_pending: webhookCounters.pending + webhookCounters.processing,
      total_webhooks_errors: webhookCounters.error + webhookCounters.invalid,
      total_webhook_events: webhookEvents.length,
      total_integrations_profiles: integrations.length,
      total_meli_api_logs: apiLogs.length,
      latest_meli_api_call_at: apiLogs[apiLogs.length - 1]?.created_at || null,
      current_integration_profile: buildIntegrationProfileProjection(currentUserProfile),
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

WEBHOOK_ROUTE_PATHS.forEach((routePath) => {
  app.get(routePath, (req, res) => {
    res.json({
      message: "Endpoint de webhook ativo",
      method: "POST",
      route_path: routePath,
      webhook_path: WEBHOOK_PATH,
      webhook_paths: WEBHOOK_ROUTE_PATHS,
      notifications_path: NOTIFICATIONS_PATH,
      notifications_url: NOTIFICATIONS_URL || null,
    });
  });
});

app.get(WEBHOOK_DASHBOARD_PATH, (req, res) => {
  if (!ensureAdminDashboardAccess(req, res)) {
    return;
  }

  const wantsJson = requestWantsJson(req);
  if (!wantsJson && !req.path.endsWith("/")) {
    const queryIndex = req.originalUrl.indexOf("?");
    const querySuffix = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : "";
    res.redirect(302, `${WEBHOOK_DASHBOARD_PATH}/${querySuffix}`);
    return;
  }

  try {
    const webhookRecords = readWebhookRecords();
    const webhookEvents = readWebhookEvents();
    const integrationProfiles = readIntegrations();
    const payload = buildWebhookDashboardPayload(
      webhookRecords,
      webhookEvents,
      integrationProfiles
    );

    if (wantsJson) {
      res.json(payload);
      return;
    }

    const appHtml = renderWebhookDashboardApp();
    if (appHtml) {
      res.type("html").send(appHtml);
      return;
    }

    const html = renderWebhookDashboard(payload);
    res.type("html").send(html);
  } catch (errorObj) {
    res.status(500).json({
      error: "webhook_dashboard_failed",
      message: errorObj.message,
    });
  }
});

app.post(`${ADMIN_DASHBOARD_PATH}/enrich`, async (req, res) => {
  if (!ensureAdminDashboardAccess(req, res)) {
    return;
  }

  try {
    const mode = typeof req.query.mode === "string" ? req.query.mode.toLowerCase() : "all";
    const storedTokens = readTokens();
    if (!storedTokens || (!storedTokens.access_token && !storedTokens.refresh_token)) {
      res.status(400).json({
        ok: false,
        error: "missing_access_token",
        message: "Nenhum token disponivel para enriquecer os dados das contas.",
      });
      return;
    }

    if (mode === "current") {
      const enrichment = await enrichIntegrationProfileFromTokens(storedTokens, "admin_manual_current", {
        persistRefreshToMainStore: true,
      });
      res.json({
        ok: true,
        mode: "current",
        message: "Dados da conta atual foram atualizados com sucesso.",
        refreshed_token: enrichment.refreshed,
        status_code: enrichment.status_code,
        response_time_ms: enrichment.response_time_ms,
        profile: buildIntegrationProfileProjection(enrichment.profile),
      });
      return;
    }

    const authorizations = readAuthorizations();
    const summary = await enrichIntegrationProfilesFromAuthorizations(
      authorizations,
      storedTokens,
      "admin_manual_all"
    );
    res.json({
      ok: true,
      mode: "all",
      message: `Enriquecimento concluido: ${summary.total_enriched} perfil(is) atualizado(s), ${summary.total_failed} falha(s), ${summary.total_skipped} ignorado(s).`,
      ...summary,
    });
  } catch (errorObj) {
    const formatted = formatAxiosError(errorObj);
    const statusCode = formatted.status && Number.isFinite(formatted.status)
      ? formatted.status
      : 500;
    res.status(statusCode).json({
      ok: false,
      error: "integration_enrichment_failed",
      message: compactErrorMessage(errorObj?.message || errorObj),
      details: formatted.data,
    });
  }
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
    const integrationProfiles = readIntegrations();
    const apiLogs = readMeliApiLogs();
    const payload = buildAdminDashboardPayload(authorizations, tokens, integrationProfiles, apiLogs);

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

WEBHOOK_ROUTE_PATHS.forEach((routePath) => {
  app.post(routePath, (req, res) => {
    let webhookRecord = null;

    try {
      const validationErrors = validateWebhookPayload(req.body);
      webhookRecord = buildWebhookRecord(req.body, req, validationErrors);

      if (validationErrors.length > 0) {
        webhookRecord.processed = true;
        webhookRecord.processed_at = webhookRecord.received_at;
        webhookRecord.error_message = validationErrors.join(", ");
      }

      appendWebhookRecord(webhookRecord);
      appendNotification({
        route_path: routePath,
        webhook_id: webhookRecord.id,
        process_status: webhookRecord.process_status,
        body: req.body || null,
        query: req.query || null,
        headers: {
          "x-request-id": req.headers["x-request-id"] || null,
          "x-real-ip": req.headers["x-real-ip"] || null,
          "x-forwarded-for": req.headers["x-forwarded-for"] || null,
          "user-agent": req.headers["user-agent"] || null,
        },
      });

      appendWebhookProcessLog("webhook_recebido", {
        webhook_id: webhookRecord.id,
        route_path: routePath,
        topic: webhookRecord.topic,
        resource: webhookRecord.resource,
        user_id: webhookRecord.user_id,
        process_status: webhookRecord.process_status,
      });

      if (validationErrors.length > 0) {
        appendWebhookProcessLog("erro_consulta_api", {
          webhook_id: webhookRecord.id,
          route_path: routePath,
          reason: "payload_invalido",
          validation_errors: validationErrors,
        });
      }
    } catch (errorObj) {
      console.error(`Falha ao persistir webhook em ${routePath}: ${errorObj.message}`);
      try {
        appendWebhookProcessLog("erro_consulta_api", {
          route_path: routePath,
          reason: "falha_persistencia_webhook",
          details: compactErrorMessage(errorObj.message || errorObj),
        });
      } catch (logError) {
        console.error(`Falha ao gravar log de erro do webhook: ${logError.message}`);
      }
    }

    // Mercado Livre espera resposta rapida e pode reenviar em caso de erro HTTP.
    res.status(200).end();

    if (webhookRecord && webhookRecord.process_status === "pending") {
      queueWebhookProcessing(webhookRecord.id);
    }
  });
});

app.use((error, req, res, next) => {
  const isJsonSyntaxError =
    error instanceof SyntaxError &&
    error.status === 400 &&
    Object.prototype.hasOwnProperty.call(error, "body");

  if (isJsonSyntaxError && isWebhookRoutePath(req.path)) {
    try {
      appendWebhookProcessLog("erro_consulta_api", {
        route_path: req.path,
        reason: "json_invalido",
        details: compactErrorMessage(error.message || "json_invalido"),
      });
    } catch (_logError) {
      // No-op: fallback para garantir resposta 200 ao provedor de webhook.
    }

    res.status(200).end();
    return;
  }

  next(error);
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
