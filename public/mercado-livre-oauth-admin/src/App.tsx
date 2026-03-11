import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Activity,
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Database,
  Key,
  Link as LinkIcon,
  RefreshCw,
  Search,
  ShieldCheck,
  TerminalSquare,
  XCircle,
} from 'lucide-react';

type IntegrationStatus = 'Ativa' | 'Expirada' | 'Sem expiracao';
type IntegrationFilterStatus = IntegrationStatus | 'Todas' | 'Token atual';

interface Integration {
  id: string;
  userName: string;
  userId: string;
  avatarUrl: string;
  integrationName: string;
  status: IntegrationStatus;
  authDate: string;
  expDate: string | null;
  scopes: string[];
  scopeSummary: string;
  accessToken: string;
  refreshToken: string;
  isCurrentToken: boolean;
  storeNickname: string;
  ownerName: string;
  ownerFirstName: string;
  ownerLastName: string;
  email: string;
  businessName: string;
  brandName: string;
  accountType: string;
  cnpj: string;
  city: string;
  state: string;
  reputationLevel: string;
  sellerExperience: string;
  accountCreatedAt: string | null;
  profileSyncedAt: string | null;
}

interface DashboardMeta {
  configured: boolean;
  configErrors: string[];
  dashboardPath: string;
  publicDashboardPath: string;
  webhookDashboardPath: string;
  publicWebhookDashboardPath: string;
  webhookPaths: string[];
  authorizationsFile: string;
  latestUserId: string;
  latestAuthorizedAt: string | null;
  currentTokenStatus: string;
  currentTokenUserId: string;
  currentTokenExpiresAt: string | null;
  currentScopeCount: number;
  currentScopeSummary: string;
  currentAccessToken: string;
  currentRefreshToken: string;
  integrationsFile: string;
  meliApiLogsFile: string;
  totalProfiles: number;
  profilesWithCnpj: number;
  latestProfileSyncAt: string | null;
  latestMeliApiCallAt: string | null;
}

interface DashboardMetrics {
  total: number;
  uniqueUsers: number;
  active: number;
  expired: number;
  noExp: number;
}

interface ParsedDashboardPayload {
  integrations: Integration[];
  meta: DashboardMeta;
  metrics: DashboardMetrics | null;
}

const FILTER_OPTIONS: Array<{ label: string; value: IntegrationFilterStatus }> = [
  { label: 'Todas', value: 'Todas' },
  { label: 'Ativas', value: 'Ativa' },
  { label: 'Expiradas', value: 'Expirada' },
  { label: 'Sem expiracao', value: 'Sem expiracao' },
  { label: 'Token atual', value: 'Token atual' },
];

const ADMIN_DASHBOARD_PATH = '/admin/integrations';
const FALLBACK_AVATAR_URL = 'https://i.pravatar.cc/160?u=oauth-default';

const DEFAULT_META: DashboardMeta = {
  configured: true,
  configErrors: [],
  dashboardPath: ADMIN_DASHBOARD_PATH,
  publicDashboardPath: '/meli/admin/integrations',
  webhookDashboardPath: '/integracoes/mercadolivre/webhooks',
  publicWebhookDashboardPath: '/meli/integracoes/mercadolivre/webhooks',
  webhookPaths: ['/notifications', '/mercadolivre/webhook'],
  authorizationsFile: 'Nao informado',
  latestUserId: 'Nao identificado',
  latestAuthorizedAt: null,
  currentTokenStatus: 'Sem token ativo',
  currentTokenUserId: 'Nao identificado',
  currentTokenExpiresAt: null,
  currentScopeCount: 0,
  currentScopeSummary: 'Nenhum scope informado',
  currentAccessToken: 'Nao disponivel',
  currentRefreshToken: 'Nao disponivel',
  integrationsFile: 'Nao informado',
  meliApiLogsFile: 'Nao informado',
  totalProfiles: 0,
  profilesWithCnpj: 0,
  latestProfileSyncAt: null,
  latestMeliApiCallAt: null,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const pickString = (
  record: Record<string, unknown>,
  keys: string[],
  fallback = '',
): string => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
    if (typeof value === 'number') {
      return String(value);
    }
  }
  return fallback;
};

const pickNumber = (
  record: Record<string, unknown>,
  keys: string[],
  fallback = 0,
): number => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return fallback;
};

const pickBoolean = (
  record: Record<string, unknown>,
  keys: string[],
  fallback = false,
): boolean => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return value === 1;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['1', 'true', 'yes', 'sim'].includes(normalized)) {
        return true;
      }
      if (['0', 'false', 'no', 'nao', 'não'].includes(normalized)) {
        return false;
      }
    }
  }
  return fallback;
};

const pickStringArray = (
  record: Record<string, unknown>,
  keys: string[],
): string[] => {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter(Boolean);
    }
  }
  return [];
};

const pickStringWithNested = (
  record: Record<string, unknown>,
  nestedRecord: Record<string, unknown> | null,
  keys: string[],
  fallback = '',
): string => {
  const directValue = pickString(record, keys, '');
  if (directValue) {
    return directValue;
  }

  if (nestedRecord) {
    return pickString(nestedRecord, keys, fallback);
  }

  return fallback;
};

const normalizeDate = (
  value: unknown,
  fallback: string | null = null,
): string | null => {
  if (typeof value !== 'string' || value.trim() === '') {
    return fallback;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }
  return parsed.toISOString();
};

const formatDateTime = (value: string | null): string => {
  if (!value) {
    return 'Nao disponivel';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString('pt-BR');
};

const formatYear = (value: string | null): string => {
  if (!value) {
    return 'Nao informado';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Nao informado';
  }
  return String(parsed.getUTCFullYear());
};

const summarizeScopes = (scopes: string[], maxItems = 4): string => {
  if (scopes.length === 0) {
    return 'Nenhum scope informado';
  }
  const visible = scopes.slice(0, maxItems);
  const remaining = scopes.length - visible.length;
  return remaining > 0 ? `${visible.join(' • ')} +${remaining}` : visible.join(' • ');
};

const parseScopes = (record: Record<string, unknown>): string[] => {
  const candidates = [
    record.scopes,
    record.scope,
    record.permissions,
    record.permission,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      const parsed = candidate
        .map((scope) => (typeof scope === 'string' ? scope.trim() : ''))
        .filter(Boolean);
      if (parsed.length > 0) {
        return parsed;
      }
    }

    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return candidate
        .split(/[,\s]+/)
        .map((scope) => scope.trim())
        .filter(Boolean);
    }
  }

  return [];
};

const normalizeStatus = (
  rawStatus: unknown,
  expDate: string | null,
): IntegrationStatus => {
  if (typeof rawStatus === 'string') {
    const status = rawStatus.trim().toLowerCase();
    if (status.includes('ativa') || status.includes('ativo') || status === 'active') {
      return 'Ativa';
    }
    if (status.includes('expir') || status === 'expired') {
      return 'Expirada';
    }
    if (status.includes('sem exp') || status.includes('never') || status.includes('no exp')) {
      return 'Sem expiracao';
    }
  }

  if (!expDate) {
    return 'Sem expiracao';
  }

  return new Date(expDate).getTime() > Date.now() ? 'Ativa' : 'Expirada';
};

const statusLabel = (status: IntegrationStatus): string => {
  if (status === 'Sem expiracao') {
    return 'Sem expiracao';
  }
  return status;
};

const parsePathPrefix = (): string => {
  const pathname = window.location.pathname;
  const markerIndex = pathname.toLowerCase().indexOf(ADMIN_DASHBOARD_PATH);
  if (markerIndex <= 0) {
    return '';
  }
  return pathname.slice(0, markerIndex).replace(/\/+$/, '');
};

const buildPrefixedPath = (prefix: string, routePath: string): string => {
  const normalizedPrefix = prefix.replace(/\/+$/, '');
  return `${normalizedPrefix}${routePath}`;
};

const buildApiCandidates = (pathPrefix: string): string[] => {
  const candidates: string[] = [];
  const params = new URLSearchParams(window.location.search);
  const explicitApi = params.get('api');

  if (explicitApi) {
    candidates.push(explicitApi);
  }

  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.set('format', 'json');
  candidates.push(currentUrl.toString());

  const canonicalUrl = new URL(
    `${window.location.origin}${buildPrefixedPath(pathPrefix, `${ADMIN_DASHBOARD_PATH}/`)}`,
  );
  const token = params.get('token');
  if (token) {
    canonicalUrl.searchParams.set('token', token);
  }
  canonicalUrl.searchParams.set('format', 'json');
  candidates.push(canonicalUrl.toString());

  return Array.from(new Set(candidates));
};

const buildProtectedApiUrl = (pathPrefix: string, routePath: string): string => {
  const url = new URL(
    `${window.location.origin}${buildPrefixedPath(pathPrefix, routePath)}`,
  );

  const token = new URLSearchParams(window.location.search).get('token');
  if (token) {
    url.searchParams.set('token', token);
  }

  return url.toString();
};

const extractArrayFromPayload = (payload: unknown): unknown[] => {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!isRecord(payload)) {
    return [];
  }

  const candidates = [
    payload.authorizations,
    payload.integrations,
    payload.data,
    payload.items,
    payload.results,
    payload.logs,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
};

const mapIntegration = (
  rawItem: unknown,
  index: number,
  currentTokenUserId: string,
): Integration | null => {
  if (!isRecord(rawItem)) {
    return null;
  }

  const expDate = normalizeDate(
    rawItem.expDate ??
      rawItem.exp_date ??
      rawItem.expiresAt ??
      rawItem.expirationDate ??
      rawItem.tokenExpiration ??
      rawItem.expires_at,
    null,
  );

  const authDate =
    normalizeDate(
      rawItem.authDate ??
        rawItem.auth_date ??
        rawItem.authorizedAt ??
        rawItem.authorized_at ??
        rawItem.createdAt,
      null,
    ) ?? new Date().toISOString();

  const id = pickString(
    rawItem,
    ['id', '_id', 'integrationId', 'tokenId'],
    `integration-${index + 1}`,
  );

  const userId = pickString(
    rawItem,
    ['userId', 'user_id', 'sellerId', 'accountId'],
    'Nao identificado',
  );

  const profileRecord = isRecord(rawItem.profile) ? rawItem.profile : null;
  const storeNickname = pickStringWithNested(
    rawItem,
    profileRecord,
    ['store_nickname', 'storeNickname', 'nickname', 'sellerNickname'],
    'Nao informado',
  );
  const ownerFirstName = pickStringWithNested(
    rawItem,
    profileRecord,
    ['owner_first_name', 'ownerFirstName', 'first_name', 'firstName'],
    '',
  );
  const ownerLastName = pickStringWithNested(
    rawItem,
    profileRecord,
    ['owner_last_name', 'ownerLastName', 'last_name', 'lastName'],
    '',
  );
  const ownerName = pickStringWithNested(
    rawItem,
    profileRecord,
    ['owner_name', 'ownerName'],
    `${ownerFirstName} ${ownerLastName}`.trim() || 'Nao informado',
  );
  const email = pickStringWithNested(
    rawItem,
    profileRecord,
    ['email'],
    'Nao informado',
  );
  const businessName = pickStringWithNested(
    rawItem,
    profileRecord,
    ['business_name', 'businessName'],
    'Nao informado',
  );
  const brandName = pickStringWithNested(
    rawItem,
    profileRecord,
    ['brand_name', 'brandName'],
    'Nao informado',
  );
  const accountType = pickStringWithNested(
    rawItem,
    profileRecord,
    ['account_type_label', 'account_type', 'accountType'],
    'Nao informado',
  );
  const cnpj = pickStringWithNested(
    rawItem,
    profileRecord,
    ['cnpj_formatted', 'cnpj'],
    'Nao informado',
  );
  const city = pickStringWithNested(
    rawItem,
    profileRecord,
    ['city'],
    'Nao informado',
  );
  const state = pickStringWithNested(
    rawItem,
    profileRecord,
    ['state'],
    'Nao informado',
  );
  const reputationLevel = pickStringWithNested(
    rawItem,
    profileRecord,
    ['reputation_level', 'reputationLevel'],
    'Nao informado',
  );
  const sellerExperience = pickStringWithNested(
    rawItem,
    profileRecord,
    ['seller_experience', 'sellerExperience'],
    'Nao informado',
  );
  const accountCreatedAt = normalizeDate(
    (rawItem.account_created_at ??
      rawItem.accountCreatedAt ??
      profileRecord?.account_created_at ??
      profileRecord?.accountCreatedAt) as unknown,
    null,
  );
  const profileSyncedAt = normalizeDate(
    (rawItem.profile_synced_at ??
      rawItem.last_enriched_at ??
      profileRecord?.last_enriched_at ??
      profileRecord?.lastEnrichedAt) as unknown,
    null,
  );

  const userName = pickStringWithNested(
    rawItem,
    profileRecord,
    ['userName', 'user_name', 'name'],
    ownerName !== 'Nao informado' ? ownerName : `Conta ${userId}`,
  );

  const integrationName = pickString(
    rawItem,
    ['integrationName', 'integration_name', 'appName', 'applicationName', 'clientName'],
    storeNickname !== 'Nao informado'
      ? storeNickname
      : brandName !== 'Nao informado'
        ? brandName
        : `Conta ${userId}`,
  );

  const avatarUrl = pickString(
    rawItem,
    ['avatarUrl', 'avatar_url', 'picture', 'userAvatar'],
    FALLBACK_AVATAR_URL,
  );

  const accessToken = pickString(
    rawItem,
    ['accessToken', 'access_token', 'access_token_preview', 'token'],
    'Nao disponivel',
  );

  const refreshToken = pickString(
    rawItem,
    ['refreshToken', 'refresh_token', 'refresh_token_preview'],
    'Nao disponivel',
  );

  const scopes = parseScopes(rawItem);
  const scopeSummary = pickString(
    rawItem,
    ['scope_summary'],
    summarizeScopes(scopes),
  );

  const isCurrentFromPayload = pickBoolean(
    rawItem,
    ['isCurrentToken', 'is_current_token', 'current', 'isCurrent'],
    false,
  );

  const isCurrentByUserId =
    currentTokenUserId !== '' &&
    String(userId).toLowerCase() === String(currentTokenUserId).toLowerCase();

  return {
    id,
    userName,
    userId,
    avatarUrl,
    integrationName,
    status: normalizeStatus(rawItem.status ?? rawItem.state, expDate),
    authDate,
    expDate,
    scopes,
    scopeSummary,
    accessToken,
    refreshToken,
    isCurrentToken: isCurrentFromPayload || isCurrentByUserId,
    storeNickname,
    ownerName,
    ownerFirstName: ownerFirstName || 'Nao informado',
    ownerLastName: ownerLastName || 'Nao informado',
    email,
    businessName,
    brandName,
    accountType,
    cnpj,
    city,
    state,
    reputationLevel,
    sellerExperience,
    accountCreatedAt,
    profileSyncedAt,
  };
};

const ensureCurrentMarker = (integrations: Integration[]): Integration[] => {
  if (integrations.length === 0) {
    return integrations;
  }

  if (integrations.some((item) => item.isCurrentToken)) {
    return integrations;
  }

  const firstActiveIndex = integrations.findIndex((item) => item.status === 'Ativa');
  const currentIndex = firstActiveIndex >= 0 ? firstActiveIndex : 0;

  return integrations.map((item, index) => ({
    ...item,
    isCurrentToken: index === currentIndex,
  }));
};

const parseDashboardPayload = (payload: unknown): ParsedDashboardPayload => {
  const payloadRecord = isRecord(payload) ? payload : null;

  const currentTokenUserId = payloadRecord
    ? pickString(payloadRecord, ['current_token_user_id'], '')
    : '';

  const integrations = ensureCurrentMarker(
    extractArrayFromPayload(payload)
      .map((item, index) => mapIntegration(item, index, currentTokenUserId))
      .filter((item): item is Integration => item !== null),
  );

  let currentTokenExpiresAt: string | null = null;
  let currentAccessToken = 'Nao disponivel';
  let currentRefreshToken = 'Nao disponivel';
  let currentScopeSummary = 'Nenhum scope informado';
  let currentScopeCount = 0;

  if (payloadRecord && isRecord(payloadRecord.current_token)) {
    const currentTokenRecord = payloadRecord.current_token;
    currentTokenExpiresAt = normalizeDate(currentTokenRecord.expires_at, null);
    currentAccessToken = pickString(currentTokenRecord, ['access_token'], currentAccessToken);
    currentRefreshToken = pickString(currentTokenRecord, ['refresh_token'], currentRefreshToken);
    const currentScope = pickString(currentTokenRecord, ['scope'], '');
    if (currentScope) {
      const scopes = currentScope
        .split(/\s+/)
        .map((scope) => scope.trim())
        .filter(Boolean);
      if (scopes.length > 0) {
        currentScopeSummary = summarizeScopes(scopes);
        currentScopeCount = scopes.length;
      }
    }
  }

  if (payloadRecord) {
    currentScopeSummary = pickString(
      payloadRecord,
      ['current_scope_summary'],
      currentScopeSummary,
    );
    currentScopeCount = pickNumber(
      payloadRecord,
      ['current_scope_count'],
      currentScopeCount,
    );
  }

  const hasCurrentToken = payloadRecord
    ? pickBoolean(payloadRecord, ['has_current_token'], false)
    : false;
  const currentTokenExpired = payloadRecord
    ? pickBoolean(payloadRecord, ['current_token_expired'], false)
    : false;

  const currentTokenStatus = !hasCurrentToken
    ? 'Sem token ativo'
    : currentTokenExpired
      ? 'Token expirado'
      : 'Token ativo';

  const configErrors = payloadRecord
    ? pickStringArray(payloadRecord, ['config_errors'])
    : [];
  const configured = payloadRecord
    ? pickBoolean(payloadRecord, ['configured'], configErrors.length === 0)
    : true;
  const webhookPaths = payloadRecord
    ? pickStringArray(payloadRecord, ['webhook_paths'])
    : [];

  const meta: DashboardMeta = {
    configured,
    configErrors,
    dashboardPath: payloadRecord
      ? pickString(payloadRecord, ['dashboard_path'], DEFAULT_META.dashboardPath)
      : DEFAULT_META.dashboardPath,
    publicDashboardPath: payloadRecord
      ? pickString(
          payloadRecord,
          ['public_dashboard_path'],
          DEFAULT_META.publicDashboardPath,
        )
      : DEFAULT_META.publicDashboardPath,
    webhookDashboardPath: payloadRecord
      ? pickString(
          payloadRecord,
          ['webhook_dashboard_path'],
          DEFAULT_META.webhookDashboardPath,
        )
      : DEFAULT_META.webhookDashboardPath,
    publicWebhookDashboardPath: payloadRecord
      ? pickString(
          payloadRecord,
          ['public_webhook_dashboard_path'],
          DEFAULT_META.publicWebhookDashboardPath,
        )
      : DEFAULT_META.publicWebhookDashboardPath,
    webhookPaths: webhookPaths.length > 0 ? webhookPaths : DEFAULT_META.webhookPaths,
    authorizationsFile: payloadRecord
      ? pickString(
          payloadRecord,
          ['authorizations_file'],
          DEFAULT_META.authorizationsFile,
        )
      : DEFAULT_META.authorizationsFile,
    latestUserId: payloadRecord
      ? pickString(payloadRecord, ['latest_user_id'], DEFAULT_META.latestUserId)
      : DEFAULT_META.latestUserId,
    latestAuthorizedAt: payloadRecord
      ? normalizeDate(payloadRecord.latest_authorized_at, null)
      : null,
    currentTokenStatus,
    currentTokenUserId: payloadRecord
      ? pickString(payloadRecord, ['current_token_user_id'], DEFAULT_META.currentTokenUserId)
      : DEFAULT_META.currentTokenUserId,
    currentTokenExpiresAt,
    currentScopeCount,
    currentScopeSummary,
    currentAccessToken,
    currentRefreshToken,
    integrationsFile: payloadRecord
      ? pickString(payloadRecord, ['integrations_file'], DEFAULT_META.integrationsFile)
      : DEFAULT_META.integrationsFile,
    meliApiLogsFile: payloadRecord
      ? pickString(payloadRecord, ['meli_api_logs_file'], DEFAULT_META.meliApiLogsFile)
      : DEFAULT_META.meliApiLogsFile,
    totalProfiles: payloadRecord
      ? pickNumber(payloadRecord, ['total_profiles'], DEFAULT_META.totalProfiles)
      : DEFAULT_META.totalProfiles,
    profilesWithCnpj: payloadRecord
      ? pickNumber(payloadRecord, ['profiles_with_cnpj'], DEFAULT_META.profilesWithCnpj)
      : DEFAULT_META.profilesWithCnpj,
    latestProfileSyncAt: payloadRecord
      ? normalizeDate(payloadRecord.latest_profile_sync_at, null)
      : null,
    latestMeliApiCallAt: payloadRecord
      ? normalizeDate(payloadRecord.latest_meli_api_call_at, null)
      : null,
  };

  const metrics = payloadRecord
    ? {
        total: pickNumber(payloadRecord, ['total_authorizations'], integrations.length),
        uniqueUsers: pickNumber(
          payloadRecord,
          ['unique_users'],
          new Set(integrations.map((item) => item.userId)).size,
        ),
        active: pickNumber(
          payloadRecord,
          ['active_authorizations'],
          integrations.filter((item) => item.status === 'Ativa').length,
        ),
        expired: pickNumber(
          payloadRecord,
          ['expired_authorizations'],
          integrations.filter((item) => item.status === 'Expirada').length,
        ),
        noExp: pickNumber(
          payloadRecord,
          ['timeless_authorizations'],
          integrations.filter((item) => item.status === 'Sem expiracao').length,
        ),
      }
    : null;

  return {
    integrations,
    meta,
    metrics,
  };
};

const statusFromTokenHealth = (
  currentTokenStatus: string,
): IntegrationStatus | null => {
  const normalized = currentTokenStatus.trim().toLowerCase();
  if (normalized.includes('sem token') || normalized.includes('nenhum')) {
    return null;
  }
  if (normalized.includes('expir')) {
    return 'Expirada';
  }
  if (normalized.includes('ativo')) {
    return 'Ativa';
  }
  return null;
};

const truncateTokenPreview = (tokenValue: string): string => {
  if (!tokenValue || tokenValue === 'Nao disponivel') {
    return 'Nao disponivel';
  }
  if (tokenValue.length <= 40) {
    return tokenValue;
  }
  return `${tokenValue.slice(0, 30)}...${tokenValue.slice(-8)}`;
};

const StatusBadge = ({ status }: { status: IntegrationStatus }) => {
  if (status === 'Ativa') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
        <CheckCircle2 className="w-3.5 h-3.5" />
        {statusLabel(status)}
      </span>
    );
  }

  if (status === 'Expirada') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
        <XCircle className="w-3.5 h-3.5" />
        {statusLabel(status)}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
      <Clock className="w-3.5 h-3.5" />
      {statusLabel(status)}
    </span>
  );
};

const GlassCard = ({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) => (
  <div
    className={`bg-slate-900/40 backdrop-blur-xl border border-slate-800/60 rounded-2xl shadow-xl ${className}`}
  >
    {children}
  </div>
);

export default function App() {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<IntegrationFilterStatus>('Todas');
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [meta, setMeta] = useState<DashboardMeta>(DEFAULT_META);
  const [serverMetrics, setServerMetrics] = useState<DashboardMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);
  const [isEnriching, setIsEnriching] = useState(false);
  const [enrichFeedback, setEnrichFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const pathPrefix = useMemo(() => parsePathPrefix(), []);
  const authStartHref = useMemo(
    () => buildPrefixedPath(pathPrefix, '/auth/start'),
    [pathPrefix],
  );
  const statusHref = useMemo(
    () => buildPrefixedPath(pathPrefix, '/auth/status'),
    [pathPrefix],
  );
  const webhookDashboardHref = useMemo(
    () => buildProtectedApiUrl(pathPrefix, meta.webhookDashboardPath || DEFAULT_META.webhookDashboardPath),
    [meta.webhookDashboardPath, pathPrefix],
  );
  const enrichPath = useMemo(
    () => `${ADMIN_DASHBOARD_PATH}/enrich`,
    [],
  );

  const handleCopyUrl = async () => {
    const currentUrl = window.location.href;

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(currentUrl);
      } else {
        window.prompt('Copie a URL protegida:', currentUrl);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (error) {
      window.prompt('Copie a URL protegida:', currentUrl);
    }
  };

  const refreshIntegrations = () => {
    setReloadCount((count) => count + 1);
  };

  const enrichCurrentAccount = async () => {
    setIsEnriching(true);
    setEnrichFeedback(null);

    try {
      const response = await fetch(
        buildProtectedApiUrl(pathPrefix, enrichPath),
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
          },
        },
      );

      const contentType = response.headers.get('content-type') || '';
      const payload: unknown = contentType.toLowerCase().includes('application/json')
        ? await response.json()
        : null;

      if (!response.ok) {
        const message = isRecord(payload)
          ? pickString(payload, ['message', 'error'], `Erro ${response.status} ao atualizar perfil.`)
          : `Erro ${response.status} ao atualizar perfil.`;
        throw new Error(message);
      }

      const message = isRecord(payload)
        ? pickString(payload, ['message'], 'Dados das contas atualizados com sucesso.')
        : 'Dados das contas atualizados com sucesso.';

      setEnrichFeedback({
        type: 'success',
        message,
      });
      refreshIntegrations();
    } catch (error) {
      setEnrichFeedback({
        type: 'error',
        message: error instanceof Error
          ? error.message
          : 'Falha ao atualizar os dados da conta.',
      });
    } finally {
      setIsEnriching(false);
    }
  };

  const toggleCard = (id: string) => {
    setExpandedCards((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  useEffect(() => {
    let isDisposed = false;
    const controller = new AbortController();

    const fetchIntegrations = async () => {
      setIsLoading(true);
      setLoadError(null);

      const candidates = buildApiCandidates(pathPrefix);
      let lastError = 'Nao foi possivel carregar integracoes a partir da API.';

      for (const candidate of candidates) {
        try {
          const response = await fetch(candidate, {
            headers: { Accept: 'application/json' },
            signal: controller.signal,
          });

          if (!response.ok) {
            lastError = `Erro ${response.status} ao consultar ${candidate}.`;
            continue;
          }

          const contentType = response.headers.get('content-type') ?? '';
          if (!contentType.toLowerCase().includes('application/json')) {
            lastError = `O endpoint ${candidate} nao retornou JSON.`;
            continue;
          }

          const payload = await response.json();
          const parsed = parseDashboardPayload(payload);

          if (!isDisposed) {
            setIntegrations(parsed.integrations);
            setMeta(parsed.meta);
            setServerMetrics(parsed.metrics);
            setIsLoading(false);
            setLoadError(null);
          }

          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            return;
          }
          lastError = `Falha de rede ao consultar ${candidate}.`;
        }
      }

      if (!isDisposed) {
        setIntegrations([]);
        setMeta(DEFAULT_META);
        setServerMetrics(null);
        setIsLoading(false);
        setLoadError(lastError);
      }
    };

    void fetchIntegrations();

    return () => {
      isDisposed = true;
      controller.abort();
    };
  }, [pathPrefix, reloadCount]);

  useEffect(() => {
    setExpandedCards((current) => {
      const validIds = new Set(integrations.map((item) => item.id));
      return new Set([...current].filter((id) => validIds.has(id)));
    });
  }, [integrations]);

  const filteredIntegrations = useMemo(() => {
    const normalizedSearch = searchTerm.toLowerCase().trim();

    return integrations.filter((integration) => {
      const matchesSearch = normalizedSearch === ''
        ? true
        : integration.userName.toLowerCase().includes(normalizedSearch) ||
          integration.storeNickname.toLowerCase().includes(normalizedSearch) ||
          integration.ownerName.toLowerCase().includes(normalizedSearch) ||
          integration.email.toLowerCase().includes(normalizedSearch) ||
          integration.businessName.toLowerCase().includes(normalizedSearch) ||
          integration.brandName.toLowerCase().includes(normalizedSearch) ||
          integration.city.toLowerCase().includes(normalizedSearch) ||
          integration.state.toLowerCase().includes(normalizedSearch) ||
          integration.cnpj.toLowerCase().includes(normalizedSearch) ||
          integration.reputationLevel.toLowerCase().includes(normalizedSearch) ||
          integration.sellerExperience.toLowerCase().includes(normalizedSearch) ||
          integration.accountType.toLowerCase().includes(normalizedSearch) ||
          integration.userId.toLowerCase().includes(normalizedSearch) ||
          integration.scopeSummary.toLowerCase().includes(normalizedSearch) ||
          integration.scopes.some((scope) => scope.toLowerCase().includes(normalizedSearch)) ||
          integration.accessToken.toLowerCase().includes(normalizedSearch) ||
          integration.refreshToken.toLowerCase().includes(normalizedSearch);

      const matchesStatus = filterStatus === 'Todas'
        ? true
        : filterStatus === 'Token atual'
          ? integration.isCurrentToken
          : integration.status === filterStatus;

      return matchesSearch && matchesStatus;
    });
  }, [filterStatus, integrations, searchTerm]);

  const computedMetrics = useMemo<DashboardMetrics>(() => {
    return {
      total: integrations.length,
      uniqueUsers: new Set(integrations.map((item) => item.userId)).size,
      active: integrations.filter((item) => item.status === 'Ativa').length,
      expired: integrations.filter((item) => item.status === 'Expirada').length,
      noExp: integrations.filter((item) => item.status === 'Sem expiracao').length,
    };
  }, [integrations]);

  const metrics = serverMetrics ?? computedMetrics;
  const currentToken = integrations.find((item) => item.isCurrentToken) ?? null;
  const currentTokenBadgeStatus = currentToken
    ? currentToken.status
    : statusFromTokenHealth(meta.currentTokenStatus);

  const getPercentage = (value: number) =>
    metrics.total > 0 ? Math.round((value / metrics.total) * 100) : 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-300 font-sans selection:bg-indigo-500/30 pb-20">
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-900/10 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-emerald-900/5 blur-[120px]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <header className="space-y-6">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800/50 border border-slate-700/50 text-xs font-medium text-slate-400 mb-2">
                <Database className="w-3.5 h-3.5 text-indigo-400" />
                Mercado Livre / Admin
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
                Integracoes OAuth
              </h1>
              <p className="text-slate-400 max-w-2xl text-sm sm:text-base">
                Visao direta do estado atual: token ativo, historico de autorizacoes e dados enriquecidos da conta.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <a
                href={authStartHref}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-slate-900 text-sm font-semibold rounded-lg transition-colors shadow-lg shadow-indigo-500/20"
              >
                <Key className="w-4 h-4" />
                Nova autorizacao
              </a>
              <a
                href={statusHref}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-lg border border-slate-700 transition-colors"
              >
                <Activity className="w-4 h-4" />
                Diagnostico
              </a>
              <a
                href={webhookDashboardHref}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 text-sm font-medium rounded-lg border border-sky-500/30 transition-colors"
              >
                <Database className="w-4 h-4" />
                Webhooks
              </a>
              <button
                onClick={enrichCurrentAccount}
                disabled={isEnriching}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-sm font-medium rounded-lg border border-emerald-500/30 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <RefreshCw className={`w-4 h-4 ${isEnriching ? 'animate-spin' : ''}`} />
                {isEnriching ? 'Atualizando contas...' : 'Atualizar dados das contas'}
              </button>
              <button
                onClick={handleCopyUrl}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-slate-800/50 hover:bg-slate-700/50 text-slate-300 text-sm font-medium rounded-lg border border-slate-700/50 transition-colors"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <LinkIcon className="w-4 h-4" />}
                Copiar URL protegida
              </button>
            </div>
          </div>

          {enrichFeedback && (
            <div
              className={`rounded-lg border px-3 py-2 text-sm ${
                enrichFeedback.type === 'success'
                  ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                  : 'border-rose-500/20 bg-rose-500/10 text-rose-400'
              }`}
            >
              {enrichFeedback.message}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-slate-900/50 border border-slate-800">
              <span className="text-slate-500">Ultimo usuario:</span>
              <span className="font-mono text-slate-300">{meta.latestUserId}</span>
            </div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-slate-900/50 border border-slate-800">
              <span className="text-slate-500">Ultimo callback:</span>
              <span className="font-mono text-slate-300">{formatDateTime(meta.latestAuthorizedAt)}</span>
            </div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-slate-900/50 border border-slate-800">
              <span className="text-slate-500">Subpath publico:</span>
              <span className="font-mono text-slate-300">{meta.publicDashboardPath}</span>
            </div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-slate-900/50 border border-slate-800">
              <span className="text-slate-500">Webhooks:</span>
              <span className="font-mono text-slate-300">{meta.publicWebhookDashboardPath}</span>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">
            <GlassCard className="p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                    <Activity className="w-5 h-5 text-indigo-400" />
                    Resumo rapido
                  </h2>
                  <p className="text-sm text-slate-400 mt-1">Estado do historico e do token operacional atual.</p>
                </div>
                <div className="flex items-center gap-3 bg-slate-950/50 px-4 py-2 rounded-lg border border-slate-800">
                  <span className="text-sm text-slate-400">Token atual:</span>
                  {currentTokenBadgeStatus ? (
                    <StatusBadge status={currentTokenBadgeStatus} />
                  ) : (
                    <span className="text-sm text-slate-500">{meta.currentTokenStatus}</span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-8">
                <div className="space-y-1">
                  <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Autorizacoes</p>
                  <p className="text-3xl font-light text-white">{metrics.total}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Usuarios unicos</p>
                  <p className="text-3xl font-light text-white">{metrics.uniqueUsers}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Ativas</p>
                  <p className="text-3xl font-light text-emerald-400">{metrics.active}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Expiradas</p>
                  <p className="text-3xl font-light text-rose-400">{metrics.expired}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Sem expiracao</p>
                  <p className="text-3xl font-light text-amber-400">{metrics.noExp}</p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <div className="w-24 text-xs text-slate-400">Ativas</div>
                  <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${getPercentage(metrics.active)}%` }}
                      className="h-full bg-emerald-500"
                    />
                  </div>
                  <div className="w-12 text-right text-xs font-mono text-slate-300">
                    {getPercentage(metrics.active)}%
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-24 text-xs text-slate-400">Expiradas</div>
                  <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${getPercentage(metrics.expired)}%` }}
                      className="h-full bg-rose-500"
                    />
                  </div>
                  <div className="w-12 text-right text-xs font-mono text-slate-300">
                    {getPercentage(metrics.expired)}%
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-24 text-xs text-slate-400">Sem expiracao</div>
                  <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${getPercentage(metrics.noExp)}%` }}
                      className="h-full bg-amber-500"
                    />
                  </div>
                  <div className="w-12 text-right text-xs font-mono text-slate-300">
                    {getPercentage(metrics.noExp)}%
                  </div>
                </div>
              </div>
            </GlassCard>

            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-white">Historico de autorizacoes</h2>
                <p className="text-sm text-slate-400 mt-1">Filtre por status, conta ou termos de scope.</p>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Buscar por usuario, scope ou token..."
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-slate-900/50 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all"
                  />
                </div>

                <div className="text-sm text-slate-400 font-medium">
                  {filteredIntegrations.length} integracoes visiveis
                </div>
              </div>

              {isLoading && (
                <div className="inline-flex items-center gap-2 text-sm text-slate-400">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Carregando integracoes...
                </div>
              )}

              {loadError && !isLoading && (
                <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
                  {loadError}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {FILTER_OPTIONS.map((option) => (
                  <button
                    key={option.label}
                    onClick={() => setFilterStatus(option.value)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                      filterStatus === option.value
                        ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                        : 'bg-slate-800/50 text-slate-400 border-slate-700/50 hover:bg-slate-800 hover:text-slate-300'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <div className="space-y-4">
                <AnimatePresence mode="popLayout">
                  {filteredIntegrations.length > 0 ? (
                    filteredIntegrations.map((integration) => (
                      <motion.div
                        layout
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96 }}
                        key={integration.id}
                      >
                        {(() => {
                          const clientLabel = integration.businessName !== 'Nao informado'
                            ? integration.businessName
                            : integration.brandName !== 'Nao informado'
                              ? integration.brandName
                              : integration.integrationName;
                          return (
                        <GlassCard className="overflow-hidden transition-colors hover:border-slate-700">
                          <div className="p-5">
                            <div className="flex items-start justify-between gap-4 mb-4">
                              <div className="flex items-center gap-3 min-w-0">
                                <img
                                  src={integration.avatarUrl}
                                  alt={integration.userName}
                                  className="w-10 h-10 rounded-full border border-slate-700"
                                />
                                <div className="min-w-0">
                                  <h3 className="text-base font-medium text-white flex items-center gap-2 truncate">
                                    {integration.integrationName}
                                    {integration.isCurrentToken && (
                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-400 uppercase tracking-wider">
                                        Atual
                                      </span>
                                    )}
                                  </h3>
                                  <p className="text-sm text-slate-400">{integration.userName}</p>
                                </div>
                              </div>
                              <StatusBadge status={integration.status} />
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-4 border-y border-slate-800/60 mb-4">
                              <div>
                                <p className="text-xs text-slate-500 mb-1">ID do usuario</p>
                                <p className="text-sm font-mono text-slate-300 break-all">{integration.userId}</p>
                              </div>
                              <div>
                                <p className="text-xs text-slate-500 mb-1">Loja Mercado Livre</p>
                                <p className="text-sm text-slate-300 break-all">{integration.storeNickname}</p>
                              </div>
                              <div>
                                <p className="text-xs text-slate-500 mb-1">Autorizado em</p>
                                <p className="text-sm text-slate-300">{formatDateTime(integration.authDate)}</p>
                              </div>
                              <div>
                                <p className="text-xs text-slate-500 mb-1">Expira em</p>
                                <p className="text-sm text-slate-300">{formatDateTime(integration.expDate)}</p>
                              </div>
                              <div>
                                <p className="text-xs text-slate-500 mb-1">Qtd. scopes</p>
                                <p className="text-sm text-slate-300">{integration.scopes.length}</p>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pb-4 border-b border-slate-800/60 mb-4">
                              <div>
                                <p className="text-xs text-slate-500 mb-1">Cliente</p>
                                <p className="text-sm text-slate-300 break-words">{clientLabel}</p>
                              </div>
                              <div>
                                <p className="text-xs text-slate-500 mb-1">Loja Mercado Livre</p>
                                <p className="text-sm text-slate-300 break-words">{integration.storeNickname}</p>
                              </div>
                              <div>
                                <p className="text-xs text-slate-500 mb-1">Proprietario</p>
                                <p className="text-sm text-slate-300 break-words">{integration.ownerName}</p>
                              </div>
                              <div>
                                <p className="text-xs text-slate-500 mb-1">Email</p>
                                <p className="text-sm text-slate-300 break-all">{integration.email}</p>
                              </div>
                              <div>
                                <p className="text-xs text-slate-500 mb-1">Cidade</p>
                                <p className="text-sm text-slate-300">
                                  {integration.city}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs text-slate-500 mb-1">CNPJ</p>
                                <p className="text-sm text-slate-300">{integration.cnpj}</p>
                              </div>
                              <div>
                                <p className="text-xs text-slate-500 mb-1">Reputacao</p>
                                <p className="text-sm text-slate-300">{integration.reputationLevel}</p>
                              </div>
                              <div>
                                <p className="text-xs text-slate-500 mb-1">Experiencia</p>
                                <p className="text-sm text-slate-300">{integration.sellerExperience}</p>
                              </div>
                              <div>
                                <p className="text-xs text-slate-500 mb-1">Conta criada</p>
                                <p className="text-sm text-slate-300">{formatYear(integration.accountCreatedAt)}</p>
                              </div>
                            </div>

                            <div className="mb-4">
                              <p className="text-xs text-slate-500 mb-2">Resumo dos scopes</p>
                              {integration.scopes.length > 0 ? (
                                <div className="flex flex-wrap gap-1.5">
                                  {integration.scopes.map((scope) => (
                                    <span
                                      key={scope}
                                      className="px-2 py-1 rounded bg-slate-800 text-xs text-slate-300 font-mono"
                                    >
                                      {scope}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs text-slate-500">{integration.scopeSummary}</p>
                              )}
                            </div>

                            <button
                              onClick={() => toggleCard(integration.id)}
                              className="flex items-center gap-2 text-sm text-indigo-400 hover:text-indigo-300 transition-colors font-medium"
                            >
                              {expandedCards.has(integration.id) ? (
                                <ChevronUp className="w-4 h-4" />
                              ) : (
                                <ChevronDown className="w-4 h-4" />
                              )}
                              Ver detalhes
                            </button>

                            <AnimatePresence>
                              {expandedCards.has(integration.id) && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  className="overflow-hidden"
                                >
                                  <div className="pt-4 mt-4 border-t border-slate-800/60 space-y-4">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                      <div>
                                        <p className="text-xs text-slate-500 mb-1">Razao social / Nome empresarial</p>
                                        <p className="text-xs text-slate-300 break-words">{integration.businessName}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-slate-500 mb-1">Marca da loja</p>
                                        <p className="text-xs text-slate-300 break-words">{integration.brandName}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-slate-500 mb-1">Data da conta no Mercado Livre</p>
                                        <p className="text-xs text-slate-300">{formatDateTime(integration.accountCreatedAt)}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-slate-500 mb-1">Ultima sincronizacao de perfil</p>
                                        <p className="text-xs text-slate-300">{formatDateTime(integration.profileSyncedAt)}</p>
                                      </div>
                                    </div>
                                    <div>
                                      <p className="text-xs text-slate-500 mb-1">Access token</p>
                                      <div className="p-2 bg-slate-950 rounded border border-slate-800 font-mono text-xs text-slate-400 break-all">
                                        {integration.accessToken}
                                      </div>
                                    </div>
                                    <div>
                                      <p className="text-xs text-slate-500 mb-1">Refresh token</p>
                                      <div className="p-2 bg-slate-950 rounded border border-slate-800 font-mono text-xs text-slate-400 break-all">
                                        {integration.refreshToken}
                                      </div>
                                    </div>
                                    <div>
                                      <p className="text-xs text-slate-500 mb-1">Scope completo</p>
                                      <p className="text-xs text-slate-400 break-all">
                                        {integration.scopes.join(' ') || 'Nao informado'}
                                      </p>
                                    </div>
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        </GlassCard>
                          );
                        })()}
                      </motion.div>
                    ))
                  ) : (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="py-12 text-center border border-dashed border-slate-700 rounded-2xl bg-slate-900/20"
                    >
                      {isLoading ? (
                        <RefreshCw className="w-8 h-8 text-slate-500 mx-auto mb-3 animate-spin" />
                      ) : (
                        <Search className="w-8 h-8 text-slate-600 mx-auto mb-3" />
                      )}
                      <h3 className="text-lg font-medium text-white mb-1">
                        {isLoading
                          ? 'Carregando registros...'
                          : loadError
                            ? 'Falha ao carregar os dados'
                            : 'Nenhum registro encontrado'}
                      </h3>
                      <p className="text-sm text-slate-400 mb-6">
                        {isLoading
                          ? 'Aguarde enquanto as integracoes sao consultadas.'
                          : loadError
                            ? 'Verifique o endpoint da API e tente novamente.'
                            : 'Tente ajustar os filtros ou termo de busca.'}
                      </p>
                      {!isLoading && (
                        <div className="flex items-center justify-center gap-3">
                          <button
                            onClick={() => {
                              setSearchTerm('');
                              setFilterStatus('Todas');
                            }}
                            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium rounded-lg transition-colors"
                          >
                            Limpar busca e filtros
                          </button>
                          {loadError ? (
                            <button
                              onClick={refreshIntegrations}
                              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-slate-900 text-sm font-semibold rounded-lg transition-colors"
                            >
                              Tentar novamente
                            </button>
                          ) : (
                            <a
                              href={authStartHref}
                              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-slate-900 text-sm font-semibold rounded-lg transition-colors"
                            >
                              Nova autorizacao
                            </a>
                          )}
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <GlassCard className="p-5">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-4 uppercase tracking-wider">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Token em uso
              </h3>

              {(currentToken || meta.currentTokenStatus !== 'Sem token ativo') ? (
                <div className="space-y-4">
                  <div className="flex justify-between items-center gap-3">
                    <span className="text-sm text-slate-400">Status</span>
                    {currentTokenBadgeStatus ? (
                      <StatusBadge status={currentTokenBadgeStatus} />
                    ) : (
                      <span className="text-sm text-slate-300">{meta.currentTokenStatus}</span>
                    )}
                  </div>
                  <div className="flex justify-between items-center gap-3">
                    <span className="text-sm text-slate-400">Usuario atual</span>
                    <span className="text-sm font-medium text-white">
                      {currentToken?.userId || meta.currentTokenUserId}
                    </span>
                  </div>
                  <div className="flex justify-between items-center gap-3">
                    <span className="text-sm text-slate-400">Expira em</span>
                    <span className="text-sm text-slate-300">
                      {formatDateTime(currentToken?.expDate || meta.currentTokenExpiresAt)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center gap-3">
                    <span className="text-sm text-slate-400">Numero de scopes</span>
                    <span className="text-sm font-mono text-slate-300">
                      {currentToken?.scopes.length ?? meta.currentScopeCount}
                    </span>
                  </div>
                  <div>
                    <span className="text-sm text-slate-400 block mb-2">Resumo de scopes</span>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      {currentToken?.scopeSummary || meta.currentScopeSummary}
                    </p>
                  </div>
                  {currentToken && (
                    <div className="pt-3 border-t border-slate-800/60 grid grid-cols-1 gap-2">
                      <div className="flex justify-between items-center gap-3">
                        <span className="text-sm text-slate-400">Loja</span>
                        <span className="text-sm text-slate-300">{currentToken.storeNickname}</span>
                      </div>
                      <div className="flex justify-between items-center gap-3">
                        <span className="text-sm text-slate-400">Proprietario</span>
                        <span className="text-sm text-slate-300">{currentToken.ownerName}</span>
                      </div>
                      <div className="flex justify-between items-center gap-3">
                        <span className="text-sm text-slate-400">Email</span>
                        <span className="text-sm text-slate-300 break-all text-right">{currentToken.email}</span>
                      </div>
                      <div className="flex justify-between items-center gap-3">
                        <span className="text-sm text-slate-400">CNPJ</span>
                        <span className="text-sm text-slate-300">{currentToken.cnpj}</span>
                      </div>
                      <div className="flex justify-between items-center gap-3">
                        <span className="text-sm text-slate-400">Ultima sync perfil</span>
                        <span className="text-sm text-slate-300">{formatDateTime(currentToken.profileSyncedAt)}</span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-500">Nenhum token ativo no momento.</p>
              )}
            </GlassCard>

            <GlassCard className="p-5">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-4 uppercase tracking-wider">
                <TerminalSquare className="w-4 h-4 text-indigo-400" />
                Configuracao
              </h3>

              {meta.configured ? (
                <div className="flex items-start gap-3 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-emerald-400">Ambiente configurado</p>
                    <p className="text-xs text-emerald-400/70 mt-1">
                      Credenciais e callback em estado operacional.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg">
                    <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-rose-400">Pendencias de configuracao</p>
                      <p className="text-xs text-rose-400/70 mt-1">
                        Corrija os itens abaixo antes de depender de novos callbacks.
                      </p>
                    </div>
                  </div>
                  <ul className="text-xs text-rose-300/90 list-disc list-inside space-y-1">
                    {meta.configErrors.length > 0 ? (
                      meta.configErrors.map((item) => <li key={item}>{item}</li>)
                    ) : (
                      <li>Falha de configuracao detectada, mas sem detalhes no payload.</li>
                    )}
                  </ul>
                </div>
              )}
            </GlassCard>

            <GlassCard className="p-5">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-4 uppercase tracking-wider">
                <Database className="w-4 h-4 text-slate-400" />
                Referencia tecnica
              </h3>
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-slate-500 mb-1">Rota protegida do dashboard</p>
                  <p className="text-sm font-mono text-slate-300 bg-slate-950 p-1.5 rounded border border-slate-800 break-all">
                    {meta.dashboardPath}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Rota protegida de webhooks</p>
                  <p className="text-sm font-mono text-slate-300 bg-slate-950 p-1.5 rounded border border-slate-800 break-all">
                    {meta.webhookDashboardPath}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Endpoints de webhook aceitos</p>
                  <p className="text-sm font-mono text-slate-300 bg-slate-950 p-1.5 rounded border border-slate-800 break-all">
                    {meta.webhookPaths.join(' • ')}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Arquivo de historico</p>
                  <p className="text-sm font-mono text-slate-300 bg-slate-950 p-1.5 rounded border border-slate-800 break-all">
                    {meta.authorizationsFile}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Arquivo de perfis enriquecidos</p>
                  <p className="text-sm font-mono text-slate-300 bg-slate-950 p-1.5 rounded border border-slate-800 break-all">
                    {meta.integrationsFile}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Arquivo de logs da API ML</p>
                  <p className="text-sm font-mono text-slate-300 bg-slate-950 p-1.5 rounded border border-slate-800 break-all">
                    {meta.meliApiLogsFile}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Perfis sincronizados</p>
                    <p className="text-sm text-slate-300">{meta.totalProfiles}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Perfis com CNPJ</p>
                    <p className="text-sm text-slate-300">{meta.profilesWithCnpj}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Ultima sync de perfil</p>
                    <p className="text-xs text-slate-300">{formatDateTime(meta.latestProfileSyncAt)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Ultima chamada API ML</p>
                    <p className="text-xs text-slate-300">{formatDateTime(meta.latestMeliApiCallAt)}</p>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Resumo dos scopes atuais</p>
                  <p className="text-xs text-slate-400 leading-relaxed">{meta.currentScopeSummary}</p>
                </div>

                <div className="pt-4 border-t border-slate-800/60">
                  <details className="group">
                    <summary className="flex items-center justify-between cursor-pointer list-none text-sm font-medium text-indigo-400 hover:text-indigo-300">
                      Preview do token atual
                      <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="mt-3 space-y-3">
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                          Access token
                        </p>
                        <div className="p-2 bg-slate-950 rounded border border-slate-800 font-mono text-[10px] text-slate-400 break-all">
                          {truncateTokenPreview(meta.currentAccessToken)}
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                          Refresh token
                        </p>
                        <div className="p-2 bg-slate-950 rounded border border-slate-800 font-mono text-[10px] text-slate-400 break-all">
                          {truncateTokenPreview(meta.currentRefreshToken)}
                        </div>
                      </div>
                    </div>
                  </details>
                </div>
              </div>
            </GlassCard>
          </div>
        </div>

        <footer className="pt-8 border-t border-slate-800/60 text-center">
          <p className="text-xs text-slate-500 flex items-center justify-center gap-2">
            <TerminalSquare className="w-3.5 h-3.5" />
            Para resposta estruturada via API, use{' '}
            <code className="font-mono bg-slate-800 px-1 py-0.5 rounded text-slate-300">
              ?format=json
            </code>{' '}
            na URL.
          </p>
        </footer>
      </div>
    </div>
  );
}
