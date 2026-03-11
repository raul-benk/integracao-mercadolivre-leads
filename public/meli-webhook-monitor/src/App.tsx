import { useEffect, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Database,
  FileJson,
  LayoutDashboard,
  TerminalSquare,
} from 'lucide-react';

type WebhookStatusClass = 'is-success' | 'is-warning' | 'is-error' | 'is-pending';

interface WebhookProfile {
  store_nickname?: string | null;
  owner_name?: string | null;
  email?: string | null;
  cnpj_formatted?: string | null;
  cnpj?: string | null;
  city?: string | null;
  state?: string | null;
  account_type_label?: string | null;
  reputation_level?: string | null;
}

interface WebhookRecord {
  id: string;
  received_at?: string | null;
  topic?: string | null;
  resource?: string | null;
  status_label?: string | null;
  status_class?: string | null;
  resolved_user_id?: string | number | null;
  user_id?: string | number | null;
  profile?: WebhookProfile | null;
  event?: unknown;
  [key: string]: unknown;
}

interface RecentError {
  id: string;
  topic?: string | null;
  resource?: string | null;
  status?: string | null;
  received_at?: string | null;
}

interface DashboardPayload {
  configured: boolean;
  config_errors: string[];
  dashboard_path: string;
  public_dashboard_path: string;
  webhook_paths: string[];
  webhooks_file: string;
  webhook_events_file: string;
  webhook_process_log_file: string;
  total_received: number;
  total_processed: number;
  total_errors: number;
  total_pending: number;
  total_processing: number;
  total_with_profile: number;
  total_without_profile: number;
  unique_identified_clients: number;
  latest_received_at: string | null;
  latest_processed_at: string | null;
  webhooks: WebhookRecord[];
  recent_errors: RecentError[];
}

const WEBHOOK_DASHBOARD_PATH = '/integracoes/mercadolivre/webhooks';

const DEFAULT_PAYLOAD: DashboardPayload = {
  configured: false,
  config_errors: [],
  dashboard_path: WEBHOOK_DASHBOARD_PATH,
  public_dashboard_path: `/meli${WEBHOOK_DASHBOARD_PATH}`,
  webhook_paths: ['/notifications', '/mercadolivre/webhook'],
  webhooks_file: 'Nao informado',
  webhook_events_file: 'Nao informado',
  webhook_process_log_file: 'Nao informado',
  total_received: 0,
  total_processed: 0,
  total_errors: 0,
  total_pending: 0,
  total_processing: 0,
  total_with_profile: 0,
  total_without_profile: 0,
  unique_identified_clients: 0,
  latest_received_at: null,
  latest_processed_at: null,
  webhooks: [],
  recent_errors: [],
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const parsePathPrefix = (): string => {
  const pathname = window.location.pathname;
  const markerIndex = pathname.toLowerCase().indexOf(WEBHOOK_DASHBOARD_PATH);
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
    `${window.location.origin}${buildPrefixedPath(pathPrefix, `${WEBHOOK_DASHBOARD_PATH}/`)}`,
  );
  const token = params.get('token');
  if (token) {
    canonicalUrl.searchParams.set('token', token);
  }
  canonicalUrl.searchParams.set('format', 'json');
  candidates.push(canonicalUrl.toString());

  return Array.from(new Set(candidates));
};

const pickNumber = (record: Record<string, unknown>, key: string, fallback = 0): number => {
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
  return fallback;
};

const pickString = (record: Record<string, unknown>, key: string, fallback = ''): string => {
  const value = record[key];
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim();
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return fallback;
};

const toWebhookRecord = (item: unknown): WebhookRecord | null => {
  if (!isRecord(item)) {
    return null;
  }
  return {
    ...item,
    id: pickString(item, 'id', `wh-${Math.random().toString(36).slice(2)}`),
  };
};

const toRecentError = (item: unknown): RecentError | null => {
  if (!isRecord(item)) {
    return null;
  }
  return {
    id: pickString(item, 'id', `err-${Math.random().toString(36).slice(2)}`),
    topic: pickString(item, 'topic', 'Nao informado'),
    resource: pickString(item, 'resource', 'Nao informado'),
    status: pickString(item, 'status', 'Erro'),
    received_at: pickString(item, 'received_at', '') || null,
  };
};

const parsePayload = (raw: unknown): DashboardPayload => {
  if (!isRecord(raw)) {
    return DEFAULT_PAYLOAD;
  }

  const webhooksRaw = Array.isArray(raw.webhooks) ? raw.webhooks : [];
  const recentErrorsRaw = Array.isArray(raw.recent_errors) ? raw.recent_errors : [];
  const webhookPathsRaw = Array.isArray(raw.webhook_paths) ? raw.webhook_paths : [];
  const configErrorsRaw = Array.isArray(raw.config_errors) ? raw.config_errors : [];

  const webhooks = webhooksRaw
    .map((item) => toWebhookRecord(item))
    .filter((item): item is WebhookRecord => item !== null);
  const recentErrors = recentErrorsRaw
    .map((item) => toRecentError(item))
    .filter((item): item is RecentError => item !== null);

  return {
    configured: Boolean(raw.configured),
    config_errors: configErrorsRaw
      .map((item) => (typeof item === 'string' ? item : ''))
      .filter(Boolean),
    dashboard_path: pickString(raw, 'dashboard_path', DEFAULT_PAYLOAD.dashboard_path),
    public_dashboard_path: pickString(raw, 'public_dashboard_path', DEFAULT_PAYLOAD.public_dashboard_path),
    webhook_paths: webhookPathsRaw
      .map((item) => (typeof item === 'string' ? item : ''))
      .filter(Boolean),
    webhooks_file: pickString(raw, 'webhooks_file', DEFAULT_PAYLOAD.webhooks_file),
    webhook_events_file: pickString(raw, 'webhook_events_file', DEFAULT_PAYLOAD.webhook_events_file),
    webhook_process_log_file: pickString(raw, 'webhook_process_log_file', DEFAULT_PAYLOAD.webhook_process_log_file),
    total_received: pickNumber(raw, 'total_received'),
    total_processed: pickNumber(raw, 'total_processed'),
    total_errors: pickNumber(raw, 'total_errors'),
    total_pending: pickNumber(raw, 'total_pending') + pickNumber(raw, 'total_processing'),
    total_processing: pickNumber(raw, 'total_processing'),
    total_with_profile: pickNumber(raw, 'total_with_profile'),
    total_without_profile: pickNumber(raw, 'total_without_profile'),
    unique_identified_clients: pickNumber(raw, 'unique_identified_clients'),
    latest_received_at: pickString(raw, 'latest_received_at', '') || null,
    latest_processed_at: pickString(raw, 'latest_processed_at', '') || null,
    webhooks,
    recent_errors: recentErrors,
  };
};

const formatDateTime = (value: string | null | undefined): string => {
  if (!value) {
    return 'Nao disponivel';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  return parsed.toLocaleString('pt-BR');
};

const statusBadgeClasses = (statusClass: string | null | undefined): string => {
  if (statusClass === 'is-success') {
    return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  }
  if (statusClass === 'is-warning') {
    return 'bg-amber-100 text-amber-700 border-amber-200';
  }
  if (statusClass === 'is-error') {
    return 'bg-rose-100 text-rose-700 border-rose-200';
  }
  return 'bg-blue-100 text-blue-700 border-blue-200';
};

const statusLabel = (record: WebhookRecord): string => record.status_label || 'Pendente';

const toClientLabel = (record: WebhookRecord): string => {
  const profile = isRecord(record.profile) ? record.profile as WebhookProfile : null;
  return (
    profile?.store_nickname ||
    profile?.owner_name ||
    'Nao identificado'
  );
};

const toOwnerLabel = (record: WebhookRecord): string => {
  const profile = isRecord(record.profile) ? record.profile as WebhookProfile : null;
  return profile?.owner_name || 'Nao informado';
};

const toEmailLabel = (record: WebhookRecord): string => {
  const profile = isRecord(record.profile) ? record.profile as WebhookProfile : null;
  return profile?.email || 'Nao informado';
};

const toCnpjLabel = (record: WebhookRecord): string => {
  const profile = isRecord(record.profile) ? record.profile as WebhookProfile : null;
  return profile?.cnpj_formatted || profile?.cnpj || 'Nao informado';
};

const toCityLabel = (record: WebhookRecord): string => {
  const profile = isRecord(record.profile) ? record.profile as WebhookProfile : null;
  const city = profile?.city || '';
  const state = profile?.state || '';
  if (!city && !state) {
    return 'Nao informado';
  }
  return [city, state].filter(Boolean).join(' / ');
};

const toAccountLabel = (record: WebhookRecord): string => {
  const profile = isRecord(record.profile) ? record.profile as WebhookProfile : null;
  const accountType = profile?.account_type_label || 'Nao informado';
  const reputation = profile?.reputation_level || 'Nao informado';
  return `${accountType} • ${reputation}`;
};

export default function App() {
  const [payload, setPayload] = useState<DashboardPayload>(DEFAULT_PAYLOAD);
  const [selectedWebhook, setSelectedWebhook] = useState<WebhookRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let isDisposed = false;
    const controller = new AbortController();
    const pathPrefix = parsePathPrefix();
    const candidates = buildApiCandidates(pathPrefix);

    const run = async () => {
      setIsLoading(true);
      setLoadError(null);
      let lastError = 'Nao foi possivel carregar os dados do monitoramento.';

      for (const candidate of candidates) {
        try {
          const response = await fetch(candidate, {
            headers: {
              Accept: 'application/json',
            },
            signal: controller.signal,
          });

          if (!response.ok) {
            lastError = `Erro ${response.status} ao consultar ${candidate}.`;
            continue;
          }

          const contentType = (response.headers.get('content-type') || '').toLowerCase();
          if (!contentType.includes('application/json')) {
            lastError = `O endpoint ${candidate} nao retornou JSON.`;
            continue;
          }

          const jsonPayload = await response.json();
          const parsed = parsePayload(jsonPayload);

          if (!isDisposed) {
            setPayload(parsed);
            setSelectedWebhook((current) => {
              if (!current) {
                return parsed.webhooks[0] || null;
              }
              const found = parsed.webhooks.find((item) => item.id === current.id);
              return found || parsed.webhooks[0] || null;
            });
            setIsLoading(false);
            setLoadError(null);
          }
          return;
        } catch (errorObj) {
          if (errorObj instanceof DOMException && errorObj.name === 'AbortError') {
            return;
          }
          lastError = `Falha de rede ao consultar ${candidate}.`;
        }
      }

      if (!isDisposed) {
        setPayload(DEFAULT_PAYLOAD);
        setSelectedWebhook(null);
        setLoadError(lastError);
        setIsLoading(false);
      }
    };

    void run();

    return () => {
      isDisposed = true;
      controller.abort();
    };
  }, []);

  const stats = [
    { label: 'Recebidos', value: String(payload.total_received), color: 'text-slate-800' },
    { label: 'Processados', value: String(payload.total_processed), color: 'text-slate-800' },
    { label: 'Erros', value: String(payload.total_errors), color: 'text-rose-600' },
    { label: 'Pendentes', value: String(payload.total_pending), color: 'text-blue-600' },
    { label: 'Com cliente identificado', value: String(payload.total_with_profile), color: 'text-slate-800' },
    { label: 'Sem vinculo de cliente', value: String(payload.total_without_profile), color: 'text-amber-600' },
    { label: 'Clientes unicos no webhook', value: String(payload.unique_identified_clients), color: 'text-slate-800' },
    { label: 'Ultimo recebido', value: formatDateTime(payload.latest_received_at), color: 'text-slate-800' },
    { label: 'Ultimo processado', value: formatDateTime(payload.latest_processed_at), color: 'text-slate-800' },
  ];

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_0%_0%,rgba(181,255,129,0.28),transparent_28%),linear-gradient(180deg,#f6fbf4_0%,#fcfdfb_40%,#ffffff_100%)] text-slate-900">
      <header className="bg-gradient-to-r from-[#121619] via-[#1f262a] to-[#121619] text-white pt-12 pb-20 px-6 lg:px-8 border-b border-white/10">
        <div className="max-w-[1400px] mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/20 text-xs font-medium mb-6">
            <Database className="w-3.5 h-3.5" />
            Mercado Livre / Admin
          </div>
          <h1 className="text-4xl font-semibold tracking-tight mb-4">Painel de Webhooks</h1>
          <p className="text-slate-300 max-w-2xl text-base mb-8">
            Monitoramento operacional dos webhooks recebidos com contexto de cliente enriquecido para acelerar triagem e suporte.
          </p>

          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/20 text-sm text-slate-200">
              <LayoutDashboard className="w-4 h-4 text-slate-300" />
              <span className="font-mono text-xs">{payload.public_dashboard_path}</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/20 text-sm text-slate-200">
              <Activity className="w-4 h-4 text-slate-300" />
              <span className="font-mono text-xs">{payload.webhook_paths.join(', ')}</span>
            </div>
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${
              payload.configured
                ? 'bg-emerald-500/15 border border-emerald-400/30 text-emerald-300'
                : 'bg-rose-500/15 border border-rose-400/30 text-rose-300'
            }`}>
              {payload.configured ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              <span className="text-xs font-medium">{payload.configured ? 'Configurado' : 'Pendencias detectadas'}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-6 lg:px-8 -mt-10 pb-12 space-y-6">
        <section className="bg-white/90 backdrop-blur-md border border-slate-200/70 shadow-sm rounded-2xl p-6">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-slate-800">Resumo de recebimento</h2>
            <p className="text-sm text-slate-500">Indicadores de processamento, cobertura de identificacao e volume por cliente.</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {stats.map((stat) => (
              <div key={stat.label} className="bg-slate-50/70 border border-slate-200 rounded-xl p-4">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">{stat.label}</div>
                <div className={`text-xl font-semibold ${stat.color}`}>{stat.value}</div>
              </div>
            ))}
          </div>
        </section>

        {loadError && (
          <section className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-4 py-3 text-sm">
            {loadError}
          </section>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 space-y-6">
            <section className="bg-white/90 backdrop-blur-md border border-slate-200/70 shadow-sm rounded-2xl overflow-hidden flex flex-col h-[820px]">
              <div className="p-6 border-b border-slate-100">
                <h2 className="text-lg font-semibold text-slate-800">Tabela de webhooks recebidos</h2>
                <p className="text-sm text-slate-500">Clique em "Ver JSON" para abrir payload bruto e evento processado.</p>
              </div>
              <div className="flex-1 overflow-auto">
                <table className="w-full text-sm text-left whitespace-nowrap min-w-[1050px]">
                  <thead className="text-xs text-slate-500 uppercase bg-slate-50/90 sticky top-0 z-10 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3 font-medium">Recebido em</th>
                      <th className="px-4 py-3 font-medium">Topic</th>
                      <th className="px-4 py-3 font-medium">Resource</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">User ID</th>
                      <th className="px-4 py-3 font-medium">Cliente / Proprietario</th>
                      <th className="px-4 py-3 font-medium">Email / CNPJ</th>
                      <th className="px-4 py-3 font-medium">Cidade / Conta</th>
                      <th className="px-4 py-3 font-medium text-right">Detalhes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {!isLoading && payload.webhooks.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                          Nenhum webhook recebido ate o momento.
                        </td>
                      </tr>
                    )}
                    {isLoading && (
                      <tr>
                        <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                          Carregando webhooks...
                        </td>
                      </tr>
                    )}
                    {payload.webhooks.map((record) => (
                      <tr
                        key={record.id}
                        className={`hover:bg-slate-50 transition-colors ${
                          selectedWebhook?.id === record.id ? 'bg-indigo-50/60 hover:bg-indigo-50/80' : ''
                        }`}
                      >
                        <td className="px-4 py-3 text-slate-600">{formatDateTime(String(record.received_at || ''))}</td>
                        <td className="px-4 py-3 font-medium text-slate-700">{record.topic || 'Nao informado'}</td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-500">{record.resource || 'Nao informado'}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded-md text-xs font-medium border ${statusBadgeClasses(record.status_class)}`}>
                            {statusLabel(record)}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600">
                          {String(record.resolved_user_id || record.user_id || 'Nao informado')}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          <div>{toClientLabel(record)}</div>
                          <div className="text-xs text-slate-500">{toOwnerLabel(record)}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          <div>{toEmailLabel(record)}</div>
                          <div className="text-xs text-slate-500">{toCnpjLabel(record)}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          <div>{toCityLabel(record)}</div>
                          <div className="text-xs text-slate-500">{toAccountLabel(record)}</div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => setSelectedWebhook(record)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors border border-indigo-100"
                          >
                            Ver JSON
                            <ChevronRight className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <div className="space-y-6">
            <section className="bg-white/90 backdrop-blur-md border border-slate-200/70 shadow-sm rounded-2xl overflow-hidden flex flex-col h-[450px]">
              <div className="p-4 border-b border-slate-100 flex items-center gap-2 bg-slate-50/60">
                <FileJson className="w-4 h-4 text-slate-500" />
                <h2 className="font-semibold text-slate-800">JSON completo do webhook</h2>
              </div>
              <div className="flex-1 bg-[#0d1117] p-4 overflow-auto">
                {selectedWebhook ? (
                  <pre className="text-xs font-mono text-[#7ee787] leading-relaxed">
                    {JSON.stringify(selectedWebhook, null, 2)}
                  </pre>
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-500 text-sm font-mono">
                    // Selecione um webhook na tabela para visualizar
                  </div>
                )}
              </div>
            </section>

            <section className="bg-white/90 backdrop-blur-md border border-slate-200/70 shadow-sm rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <AlertCircle className="w-4 h-4 text-rose-500" />
                <h2 className="font-semibold text-slate-800">Erros recentes</h2>
              </div>
              <div className="space-y-3">
                {payload.recent_errors.length === 0 ? (
                  <p className="text-sm text-slate-500">Nenhum erro recente.</p>
                ) : (
                  payload.recent_errors.map((errorRecord) => (
                    <div key={errorRecord.id} className="p-3 rounded-lg bg-rose-50 border border-rose-100 text-sm">
                      <div className="font-mono text-xs text-rose-400 mb-1">{formatDateTime(errorRecord.received_at || null)}</div>
                      <div className="text-rose-700">{errorRecord.status || 'Erro'} • {errorRecord.topic || 'N/A'} • {errorRecord.resource || 'N/A'}</div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="bg-white/90 backdrop-blur-md border border-slate-200/70 shadow-sm rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <TerminalSquare className="w-4 h-4 text-slate-500" />
                <h2 className="font-semibold text-slate-800">Arquivos e diagnostico</h2>
              </div>
              <div className="space-y-3">
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-slate-500 uppercase">Dashboard path interno</span>
                  <code className="text-xs font-mono bg-slate-100 text-slate-700 px-2 py-1 rounded">{payload.dashboard_path}</code>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-slate-500 uppercase">Arquivo de webhooks</span>
                  <code className="text-xs font-mono bg-slate-100 text-slate-700 px-2 py-1 rounded">{payload.webhooks_file}</code>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-slate-500 uppercase">Eventos processados</span>
                  <code className="text-xs font-mono bg-slate-100 text-slate-700 px-2 py-1 rounded">{payload.webhook_events_file}</code>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-slate-500 uppercase">Log de processamento</span>
                  <code className="text-xs font-mono bg-slate-100 text-slate-700 px-2 py-1 rounded">{payload.webhook_process_log_file}</code>
                </div>
                {payload.config_errors.length > 0 && (
                  <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                    {payload.config_errors.map((item) => (
                      <div key={item}>• {item}</div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </main>

      <footer className="max-w-[1400px] mx-auto px-6 lg:px-8 py-8 text-center border-t border-slate-200/60 mt-8">
        <p className="text-sm text-slate-500">
          Para resposta estruturada via API, use <code className="font-mono bg-slate-200/50 px-1.5 py-0.5 rounded text-slate-700">?format=json</code> na URL.
        </p>
      </footer>
    </div>
  );
}
