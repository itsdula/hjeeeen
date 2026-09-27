// Provider retry policy shared by the async image gateway.
//
// A provider 429 can mean two very different things:
//   1. transient organization rate pressure — wait inside the SAME requested
//      take; the rejected call was not billed;
//   2. hard provider-account quota exhaustion — waiting cannot repair it.
// Keeping that distinction here prevents both premature failed takes and long,
// pointless waits when the server account itself needs funding.

const HARD_QUOTA = /credit_balance_exhausted|insufficient_quota|no credits remaining|billing_hard_limit_reached/i;
const RATE_RETRY_LIMIT = 12;
const RATE_WAIT_CAP_MS = 4 * 60 * 1000;
const TRANSIENT_RETRY_LIMIT = 4;
const TRANSIENT_WAIT_CAP_MS = 70 * 1000;

export function isHardProviderQuota(body) {
  return HARD_QUOTA.test(String(body || ''));
}

function durationMs(value) {
  const s = String(value || '').trim();
  if (!s) return 0;
  if (/^\d+(?:\.\d+)?$/.test(s)) return Math.ceil(Number(s) * 1000);
  let total = 0;
  let found = false;
  for (const match of s.matchAll(/(\d+(?:\.\d+)?)\s*(ms|s|m|h)/gi)) {
    found = true;
    const n = Number(match[1]);
    const unit = match[2].toLowerCase();
    total += unit === 'ms' ? n : unit === 's' ? n * 1000 : unit === 'm' ? n * 60_000 : n * 3_600_000;
  }
  return found ? Math.ceil(total) : 0;
}

function retryHintMs(headers, body) {
  const retryAfter = headers?.get?.('retry-after');
  if (retryAfter) {
    const seconds = durationMs(retryAfter);
    if (seconds) return seconds;
    const at = Date.parse(retryAfter);
    if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  }

  // Image endpoints are inconsistent: use whichever reset clock they expose.
  for (const name of ['x-ratelimit-reset-images', 'x-ratelimit-reset-input-images', 'x-ratelimit-reset-requests']) {
    const hinted = durationMs(headers?.get?.(name));
    if (hinted) return hinted;
  }

  const match = String(body || '').match(/try again in\s+((?:\d+(?:\.\d+)?\s*(?:ms|s|m|h)\s*)+)/i);
  return match ? durationMs(match[1]) : 0;
}

export function providerRetryDecision({ status, body = '', headers, attempt = 0, waitedMs = 0 }) {
  if (status === 429) {
    if (isHardProviderQuota(body)) return { retry: false, delayMs: 0, kind: 'quota' };
    const hinted = retryHintMs(headers, body);
    const delayMs = (hinted || Math.min(5_000 * (attempt + 1), 30_000)) + 300;
    const retry = attempt < RATE_RETRY_LIMIT && waitedMs + delayMs <= RATE_WAIT_CAP_MS;
    return { retry, delayMs: retry ? delayMs : 0, kind: 'rate_limit' };
  }

  if (status >= 500 && status <= 599) {
    const hinted = retryHintMs(headers, body);
    const delayMs = (hinted || Math.min(2_000 * (attempt + 1), 8_000)) + 300;
    const retry = attempt < TRANSIENT_RETRY_LIMIT && waitedMs + delayMs <= TRANSIENT_WAIT_CAP_MS;
    return { retry, delayMs: retry ? delayMs : 0, kind: 'transient' };
  }

  return { retry: false, delayMs: 0, kind: 'fatal' };
}

export function providerFailureMessage(status, body = '') {
  if (status === 429 && isHardProviderQuota(body)) {
    return 'HJEN\'s OpenAI image provider account has no API quota. Your HJEN credits were not charged. Choose Nano Banana Pro or contact support.';
  }
  if (status === 429) {
    return 'OpenAI\'s shared image rate limit stayed busy after HJEN waited and retried this same take. Your HJEN credits were not charged. Try Make again in one minute or choose Nano Banana Pro.';
  }
  return `Provider error (${status}) — you were not charged.`;
}
