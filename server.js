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
const NOTIFICATIONS_FILE = path.resolve(
  process.env.MELI_NOTIFICATIONS_FILE || path.join(__dirname, "notifications.log")
);
const AUTH_URL = "https://auth.mercadolivre.com.br/authorization";
const TOKEN_URL = "https://api.mercadolibre.com/oauth/token";
const STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;

const pendingStates = new Map();

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

function readTokens() {
  if (!fs.existsSync(TOKENS_FILE)) {
    return null;
  }

  const content = fs.readFileSync(TOKENS_FILE, "utf8").trim();
  if (!content) {
    return null;
  }

  return JSON.parse(content);
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

app.get("/", (req, res) => {
  const configErrors = getConfigErrors();
  if (configErrors.length > 0) {
    res.json({
      message: "Configure as variáveis de ambiente para iniciar o OAuth",
      configured: false,
      config_errors: configErrors,
      status: "/auth/status",
    });
    return;
  }

  cleanupStates();
  const state = generateState();
  const authorizationUrl = buildAuthorizationUrl(state);

  res.json({
    message: "OAuth Mercado Livre pronto",
    authorization_url: authorizationUrl,
    start_oauth: "/auth/start",
    callback: "/callback",
    notifications_path: NOTIFICATIONS_PATH,
    notifications_url: NOTIFICATIONS_URL || null,
    refresh: "POST /auth/refresh",
    status: "/auth/status",
  });
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

app.get("/callback", async (req, res) => {
  if (!ensureConfigured(res)) {
    return;
  }

  const { code, state, error, error_description: errorDescription } = req.query;

  if (error) {
    res.status(400).json({
      error,
      error_description: errorDescription || "Autorização negada",
    });
    return;
  }

  if (!code) {
    res.status(400).json({ error: "missing_code", message: "Parâmetro code ausente" });
    return;
  }

  if (!state || !pendingStates.has(state)) {
    res.status(400).json({ error: "invalid_state", message: "State inválido ou expirado" });
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

    res.json({
      message: "Token salvo com sucesso",
      tokens: tokenPreview(savedTokens),
    });
  } catch (errorObj) {
    const formatted = formatAxiosError(errorObj);
    res.status(formatted.status).json({
      error: "token_exchange_failed",
      details: formatted.data,
    });
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
      tokens: tokenPreview(tokens),
    });
  } catch (errorObj) {
    res.status(500).json({
      error: "invalid_tokens_file",
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
