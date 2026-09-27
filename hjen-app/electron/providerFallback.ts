/** A gateway can have healthy HJEN credits while its upstream provider account
 * is out of vendor credit. Only that exact upstream billing failure is safe to
 * retry against an explicitly configured desktop key. Ordinary 429 rate limits
 * must keep their normal backoff semantics. */
export function isProviderCreditExhausted(status: number, body: string): boolean {
  return status === 429
    && /credit_balance_exhausted|insufficient_quota|no credits remaining/i.test(body);
}

/** Gateway/proxy failures that are safe to retry against an explicitly saved
 * local provider key. 500 is included because reverse proxies commonly use it
 * for a transient upstream crash. Do not include ordinary 429s: they may be
 * rate limits and need provider-specific backoff rather than an immediate duplicate. */
export function isTransientProviderFailure(status: number): boolean {
  return status === 408 || status === 425 || status === 500 || status === 502 || status === 503 || status === 504;
}

/** Never surface a reverse-proxy HTML document in the product UI. Preserve a
 * vendor's useful JSON message when one exists; otherwise return a short,
 * actionable service error. */
export function readableProviderError(provider: string, status: number, body: string): string {
  const label = provider ? `${provider[0].toUpperCase()}${provider.slice(1)}` : 'The AI provider';
  if (isTransientProviderFailure(status)) return `${label} is temporarily unavailable (${status}). HJEN will try another available route.`;
  try {
    const parsed = JSON.parse(body);
    const message = parsed?.error?.message ?? parsed?.message;
    if (typeof message === 'string' && message.trim()) return `${label} ${status}: ${message.trim().slice(0, 260)}`;
  } catch { /* non-JSON provider response */ }
  const plain = String(body || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return plain ? `${label} ${status}: ${plain.slice(0, 260)}` : `${label} request failed (${status}).`;
}

export function shouldRetryLlmReason(reason?: string): boolean {
  return reason === 'provider_unavailable' || reason === 'provider_quota'
    || reason === 'auth_error' || reason === 'no_key'
    || reason === 'network' || reason === 'timeout';
}

/** A network/proxy failure may clear on the same route. Auth, quota and missing
 * key failures cannot, so they should move to the next configured provider
 * immediately instead of repeating a request that is guaranteed to fail. */
export function shouldRetrySameLlmRoute(reason?: string): boolean {
  return reason === 'provider_unavailable' || reason === 'network' || reason === 'timeout';
}

/** Frame Skills are the last text step before a paid image make. Keep the
 * Settings-selected model first, then cross provider boundaries so one vendor
 * outage cannot discard the frame. De-duplicate because an override may name
 * one of the standard fallback models. */
export function frameSkillModelRoutes(primaryModel: string, fallbackOverride?: string | null): string[] {
  const standardFallbacks = /^claude/i.test(primaryModel)
    ? ['gpt-5.2', 'gemini-3.6-flash']
    : /^gpt|^o\d/i.test(primaryModel)
      ? ['claude-sonnet-4-6', 'gemini-3.6-flash']
      : ['gpt-5.2', 'claude-sonnet-4-6'];
  return [primaryModel, fallbackOverride || '', ...standardFallbacks]
    .map(model => String(model || '').trim())
    .filter((model, index, all) => !!model && all.indexOf(model) === index);
}

export interface LlmFallbackResult {
  ok: boolean;
  reason?: string;
  message?: string;
}

/** Run one bounded same-route retry for transient transport failures, then
 * cross to the next provider. Fatal request/content errors stop immediately.
 * `wait` is injectable so the regression test stays instant. */
export async function runLlmWithFallback<T extends LlmFallbackResult>(args: {
  models: string[];
  run: (model: string) => Promise<T>;
  wait?: (ms: number) => Promise<void>;
  retryDelayMs?: number;
}): Promise<{ result: T; model: string; attempts: string[] }> {
  const wait = args.wait ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const attempts: string[] = [];
  let lastResult: T | null = null;
  let lastModel = args.models[0] || '';

  for (const model of args.models) {
    lastModel = model;
    let result = await args.run(model);
    attempts.push(model);
    if (result.ok) return { result, model, attempts };

    if (shouldRetrySameLlmRoute(result.reason)) {
      await wait(args.retryDelayMs ?? 400);
      result = await args.run(model);
      attempts.push(model);
      if (result.ok) return { result, model, attempts };
    }

    lastResult = result;
    if (!shouldRetryLlmReason(result.reason)) return { result, model, attempts };
  }

  // Callers always pass at least the primary model. Keep a defensive fallback
  // so a future empty route list fails readably rather than throwing.
  const result = lastResult ?? ({ ok: false, reason: 'no_route', message: 'No AI text route is configured.' } as T);
  return { result, model: lastModel, attempts };
}
