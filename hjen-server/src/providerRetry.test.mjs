import assert from 'node:assert/strict';
import { providerRetryDecision, providerFailureMessage } from './providerRetry.js';

const headers = (values = {}) => ({ get: (key) => values[key.toLowerCase()] ?? null });

const rateLimited = providerRetryDecision({
  status: 429,
  body: '{"error":{"type":"rate_limit_error","message":"Rate limit reached. Please try again in 5s."}}',
  headers: headers(),
  attempt: 4,
  waitedMs: 21_200,
});
assert.equal(rateLimited.retry, true, 'the fifth transient 429 must stay inside the same requested take');
assert.equal(rateLimited.kind, 'rate_limit');
assert.equal(rateLimited.delayMs, 5_300);

const longReset = providerRetryDecision({
  status: 429,
  body: 'Rate limit reached. Please try again in 1m 12s.',
  headers: headers(),
  attempt: 0,
  waitedMs: 0,
});
assert.equal(longReset.retry, true);
assert.equal(longReset.delayMs, 72_300, 'minute reset hints must not be misread as one second');

const headerReset = providerRetryDecision({
  status: 429,
  body: 'rate limited',
  headers: headers({ 'retry-after': '45' }),
  attempt: 0,
  waitedMs: 0,
});
assert.equal(headerReset.delayMs, 45_300);

for (const body of [
  '{"error":{"code":"credit_balance_exhausted"}}',
  '{"error":{"type":"insufficient_quota"}}',
  'You have no credits remaining. Add credits to continue using the API.',
]) {
  const exhausted = providerRetryDecision({ status: 429, body, headers: headers(), attempt: 0, waitedMs: 0 });
  assert.equal(exhausted.retry, false, 'hard provider quota must fail immediately instead of waiting');
  assert.equal(exhausted.kind, 'quota');
  assert.match(providerFailureMessage(429, body), /provider account/i);
}

const transient5xx = providerRetryDecision({ status: 502, body: '', headers: headers(), attempt: 4, waitedMs: 20_000 });
assert.equal(transient5xx.retry, false, '5xx keeps its bounded retry budget');

const badRequest = providerRetryDecision({ status: 400, body: 'bad request', headers: headers(), attempt: 0, waitedMs: 0 });
assert.equal(badRequest.retry, false);

console.log('provider retry policy: 10/10 passed');
