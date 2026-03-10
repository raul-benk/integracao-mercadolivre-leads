import { useMemo, useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, XCircle } from 'lucide-react';

type CallbackStatus = 'success' | 'error';

interface CallbackResultModel {
  status: CallbackStatus;
  title: string;
  badge: string;
  headline: string;
  message: string;
  statusWord: string;
  userId: string;
  expiresAt: string;
  scopeCount: string;
  primaryHref: string;
  primaryLabel: string;
  secondaryHref: string;
  secondaryLabel: string;
  detailsTitle: string;
  details: string[];
}

declare global {
  interface Window {
    __CALLBACK_RESULT_MODEL__?: Partial<CallbackResultModel>;
  }
}

const CALLBACK_PATH = '/callback';

const DEFAULT_MODEL: CallbackResultModel = {
  status: 'success',
  title: 'Integração concluída',
  badge: 'OAuth',
  headline: 'Integração autorizada com sucesso',
  message: 'A conexão foi concluída. Você já pode retornar ao fluxo principal.',
  statusWord: 'Conexão concluída',
  userId: 'Não identificado',
  expiresAt: 'Não disponível',
  scopeCount: '0',
  primaryHref: '/auth/status',
  primaryLabel: 'Ver status',
  secondaryHref: '/',
  secondaryLabel: 'Voltar ao integrador',
  detailsTitle: 'Detalhes',
  details: [],
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const pickString = (
  record: Record<string, unknown>,
  key: string,
  fallback: string,
): string => {
  const value = record[key];
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
};

const pickStatus = (
  record: Record<string, unknown>,
  key: string,
  fallback: CallbackStatus,
): CallbackStatus => {
  const value = record[key];
  if (value === 'success' || value === 'error') {
    return value;
  }
  if (typeof value === 'string') {
    return value.trim().toLowerCase() === 'error' ? 'error' : fallback;
  }
  return fallback;
};

const pickStringArray = (
  record: Record<string, unknown>,
  key: string,
): string[] => {
  const value = record[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
};

const parsePathPrefix = (): string => {
  const pathname = window.location.pathname;
  const markerIndex = pathname.toLowerCase().indexOf(CALLBACK_PATH);
  if (markerIndex <= 0) {
    return '';
  }
  return pathname.slice(0, markerIndex).replace(/\/+$/, '');
};

const withPathPrefix = (href: string, pathPrefix: string): string => {
  if (!href.startsWith('/')) {
    return href;
  }
  if (!pathPrefix) {
    return href;
  }
  return `${pathPrefix}${href}`;
};

const parseCallbackResultModel = (): CallbackResultModel => {
  const params = new URLSearchParams(window.location.search);
  const statusParam = params.get('status')?.toLowerCase();
  const errorParam = params.get('error') ?? params.get('error_code') ?? '';

  const fromWindowRaw = window.__CALLBACK_RESULT_MODEL__;
  if (isRecord(fromWindowRaw)) {
    const details = pickStringArray(fromWindowRaw, 'details');
    return {
      status: pickStatus(fromWindowRaw, 'status', DEFAULT_MODEL.status),
      title: pickString(fromWindowRaw, 'title', DEFAULT_MODEL.title),
      badge: pickString(fromWindowRaw, 'badge', DEFAULT_MODEL.badge),
      headline: pickString(fromWindowRaw, 'headline', DEFAULT_MODEL.headline),
      message: pickString(fromWindowRaw, 'message', DEFAULT_MODEL.message),
      statusWord: pickString(fromWindowRaw, 'statusWord', DEFAULT_MODEL.statusWord),
      userId: pickString(fromWindowRaw, 'userId', DEFAULT_MODEL.userId),
      expiresAt: pickString(fromWindowRaw, 'expiresAt', DEFAULT_MODEL.expiresAt),
      scopeCount: pickString(fromWindowRaw, 'scopeCount', DEFAULT_MODEL.scopeCount),
      primaryHref: pickString(fromWindowRaw, 'primaryHref', DEFAULT_MODEL.primaryHref),
      primaryLabel: pickString(fromWindowRaw, 'primaryLabel', DEFAULT_MODEL.primaryLabel),
      secondaryHref: pickString(fromWindowRaw, 'secondaryHref', DEFAULT_MODEL.secondaryHref),
      secondaryLabel: pickString(fromWindowRaw, 'secondaryLabel', DEFAULT_MODEL.secondaryLabel),
      detailsTitle: pickString(fromWindowRaw, 'detailsTitle', DEFAULT_MODEL.detailsTitle),
      details: details.length > 0 ? details : DEFAULT_MODEL.details,
    };
  }

  const fallbackIsError = statusParam === 'error' || Boolean(errorParam);
  return {
    ...DEFAULT_MODEL,
    status: fallbackIsError ? 'error' : 'success',
    headline: fallbackIsError
      ? 'Não foi possível autorizar a integração'
      : DEFAULT_MODEL.headline,
    message: fallbackIsError
      ? 'O provedor retornou um erro durante a autenticação. Gere um novo link de autorização e tente novamente.'
      : DEFAULT_MODEL.message,
    statusWord: fallbackIsError ? 'Falha na autorização' : DEFAULT_MODEL.statusWord,
    details: fallbackIsError && errorParam
      ? [`Código retornado: ${errorParam}`]
      : [],
  };
};

export default function App() {
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [copied, setCopied] = useState(false);

  const pathPrefix = useMemo(() => parsePathPrefix(), []);
  const callbackModel = useMemo(() => parseCallbackResultModel(), []);

  const isError = callbackModel.status === 'error';
  const primaryHref = withPathPrefix(callbackModel.primaryHref, pathPrefix);
  const secondaryHref = withPathPrefix(callbackModel.secondaryHref, pathPrefix);

  const handleCloseWindow = () => {
    setFeedbackMessage('Tentando fechar a janela...');
    window.setTimeout(() => {
      try {
        window.close();
      } catch (error) {
        // noop
      }
      setFeedbackMessage('Se a aba continuar aberta, feche manualmente.');
      window.setTimeout(() => setFeedbackMessage(''), 4200);
    }, 160);
  };

  const handleCopySummary = async () => {
    const summary = [
      callbackModel.headline,
      `Resultado: ${callbackModel.statusWord}`,
      `Usuario: ${callbackModel.userId}`,
      `Expiracao: ${callbackModel.expiresAt}`,
      `Scopes: ${callbackModel.scopeCount}`,
    ].join(' | ');

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(summary);
      } else {
        window.prompt('Copie o resumo do callback:', summary);
      }
      setCopied(true);
      setFeedbackMessage('Resumo copiado para a área de transferência.');
      window.setTimeout(() => {
        setCopied(false);
        setFeedbackMessage('');
      }, 1600);
    } catch (error) {
      window.prompt('Copie o resumo do callback:', summary);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden font-[var(--font-body)] text-[var(--text-primary)]">
      <div className="pointer-events-none absolute inset-0">
        <div
          className={`absolute -left-28 -top-24 h-80 w-80 rounded-full blur-3xl ${
            isError ? 'bg-[rgba(229,57,53,0.24)]' : 'bg-[rgba(181,255,129,0.26)]'
          }`}
        />
        <div
          className={`absolute -bottom-20 -right-24 h-80 w-80 rounded-full blur-3xl ${
            isError ? 'bg-[rgba(204,51,102,0.18)]' : 'bg-[rgba(54,76,38,0.2)]'
          }`}
        />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-5xl items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-3xl overflow-hidden rounded-[1.75rem] border border-[var(--border-default)] bg-[rgba(255,255,255,0.9)] shadow-[0_24px_80px_rgba(20,20,20,0.08)] backdrop-blur-md">
          <header
            className={`relative overflow-hidden px-7 py-10 text-[var(--text-inverse)] sm:px-10 sm:py-12 ${
              isError
                ? 'bg-gradient-to-br from-[var(--neutral-900)] via-[var(--neutral-850)] to-[var(--system-error)]'
                : 'bg-gradient-to-br from-[var(--neutral-900)] via-[var(--neutral-850)] to-[var(--green-900)]'
            }`}
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.2),transparent_55%)]" />
            <div className="relative z-10 flex flex-col items-start text-left">
              <span className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[0.64rem] font-semibold uppercase tracking-[0.14em]">
                {callbackModel.badge}
              </span>
              <div
                className={`mt-6 inline-flex h-12 w-12 items-center justify-center rounded-full ${
                  isError
                    ? 'bg-[var(--system-error)] text-[var(--text-inverse)]'
                    : 'bg-[var(--green-400)] text-[var(--neutral-900)]'
                }`}
              >
                {isError ? <XCircle size={24} /> : <CheckCircle2 size={24} />}
              </div>
              <h1 className="mt-4 font-[var(--font-display)] text-[2rem] leading-[1.08] tracking-[-0.015em] !text-white sm:text-[2.4rem]">
                {callbackModel.headline}
              </h1>
              <p className="mt-3 max-w-2xl text-[0.96rem] leading-relaxed text-[rgba(255,255,255,0.82)]">
                {callbackModel.message}
              </p>
              <p className="mt-3 text-[0.82rem] text-[rgba(255,255,255,0.74)]">
                Estado: <strong>{callbackModel.statusWord}</strong>
              </p>
            </div>
          </header>

          <section className="grid gap-4 border-b border-[var(--border-default)] px-6 py-6 sm:grid-cols-3 sm:px-8">
            <div>
              <p className="text-[0.68rem] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Usuário</p>
              <p className="mt-1 text-sm font-medium text-[var(--text-primary)]">{callbackModel.userId}</p>
            </div>
            <div>
              <p className="text-[0.68rem] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Expiração</p>
              <p className="mt-1 text-sm font-medium text-[var(--text-primary)]">{callbackModel.expiresAt}</p>
            </div>
            <div>
              <p className="text-[0.68rem] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Scopes</p>
              <p className="mt-1 text-sm font-medium text-[var(--text-primary)]">{callbackModel.scopeCount}</p>
            </div>
          </section>

          <section className="px-6 py-6 sm:px-8">
            <h2 className="font-[var(--font-display)] text-xl">{callbackModel.detailsTitle}</h2>
            {callbackModel.details.length > 0 ? (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[var(--text-secondary)]">
                {callbackModel.details.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-[var(--text-secondary)]">
                Sem detalhes adicionais para este callback.
              </p>
            )}
          </section>

          <div className="px-6 pb-6 sm:px-8">
            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center">
              <a href={primaryHref} className="btn btn-primary w-full sm:w-auto">
                {callbackModel.primaryLabel}
              </a>
              <a href={secondaryHref} className="btn btn-outline w-full sm:w-auto">
                {callbackModel.secondaryLabel}
              </a>
              <button onClick={handleCopySummary} className="btn btn-secondary w-full sm:w-auto">
                <Copy size={16} />
                {copied ? 'Copiado' : 'Copiar resumo'}
              </button>
              <button onClick={handleCloseWindow} className="btn btn-outline w-full sm:w-auto">
                <ExternalLink size={16} />
                Fechar janela
              </button>
            </div>
            <div className="mt-3 flex h-6 items-center justify-center">
              <p
                className={`text-[0.9rem] font-medium transition-opacity duration-300 ${
                  feedbackMessage ? 'opacity-100' : 'opacity-0'
                } ${isError ? 'text-[var(--system-warning)]' : 'text-[var(--system-success)]'}`}
                aria-live="polite"
              >
                {feedbackMessage}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
