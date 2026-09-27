import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  isProviderCreditExhausted,
  isTransientProviderFailure,
  readableProviderError,
  shouldRetryLlmReason,
  shouldRetrySameLlmRoute,
  frameSkillModelRoutes,
  runLlmWithFallback,
} = require('../dist-electron/providerFallback.js');

assert.equal(isProviderCreditExhausted(429, '{"error":{"code":"credit_balance_exhausted"}}'), true);
assert.equal(isProviderCreditExhausted(429, '{"error":{"type":"insufficient_quota"}}'), true);
assert.equal(isProviderCreditExhausted(429, 'You have no credits remaining.'), true);
assert.equal(isProviderCreditExhausted(429, '{"error":{"code":"rate_limit_exceeded"}}'), false);
assert.equal(isProviderCreditExhausted(401, '{"error":{"code":"credit_balance_exhausted"}}'), false);

assert.equal(isTransientProviderFailure(500), true);
assert.equal(isTransientProviderFailure(502), true);
assert.equal(isTransientProviderFailure(503), true);
assert.equal(isTransientProviderFailure(429), false);
assert.equal(shouldRetryLlmReason('provider_unavailable'), true);
assert.equal(shouldRetryLlmReason('provider_quota'), true);
assert.equal(shouldRetryLlmReason('auth_error'), true);
assert.equal(shouldRetryLlmReason('no_key'), true);
assert.equal(shouldRetryLlmReason('api_error'), false);
assert.equal(shouldRetrySameLlmRoute('provider_unavailable'), true);
assert.equal(shouldRetrySameLlmRoute('auth_error'), false);
assert.deepEqual(
  frameSkillModelRoutes('claude-sonnet-4-6', 'gpt-5.2'),
  ['claude-sonnet-4-6', 'gpt-5.2', 'gemini-3.6-flash'],
);
const scripted = new Map([
  ['claude-sonnet-4-6', [
    { ok: false, reason: 'provider_unavailable', message: 'temporary 500' },
    { ok: false, reason: 'provider_unavailable', message: 'temporary 500' },
  ]],
  ['gpt-5.2', [{ ok: true, text: 'recovered' }]],
]);
const routed = await runLlmWithFallback({
  models: ['claude-sonnet-4-6', 'gpt-5.2'],
  run: async model => scripted.get(model).shift(),
  wait: async () => {},
});
assert.equal(routed.result.ok, true);
assert.equal(routed.model, 'gpt-5.2');
assert.deepEqual(routed.attempts, ['claude-sonnet-4-6', 'claude-sonnet-4-6', 'gpt-5.2']);

let fatalCalls = 0;
const fatal = await runLlmWithFallback({
  models: ['claude-sonnet-4-6', 'gpt-5.2'],
  run: async () => { fatalCalls += 1; return { ok: false, reason: 'api_error', message: 'bad request' }; },
  wait: async () => {},
});
assert.equal(fatal.result.ok, false);
assert.equal(fatalCalls, 1);
assert.equal(readableProviderError('anthropic', 502, '<!DOCTYPE html><title>Bad gateway</title>'), 'Anthropic is temporarily unavailable (502). HJEN will try another available route.');
assert.equal(readableProviderError('anthropic', 500, '500 Internal Server Error nginx/1.30.3'), 'Anthropic is temporarily unavailable (500). HJEN will try another available route.');
assert.equal(readableProviderError('openai', 400, '{"error":{"message":"Bad request shape"}}'), 'Openai 400: Bad request shape');
assert.equal(readableProviderError('google', 500, '<html>secret proxy page</html>').includes('<html>'), false);

console.log('provider fallback classifier + Frame Skill routing: 27/27 passed');
