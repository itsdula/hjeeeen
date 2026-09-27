// Moyasar rail — no-key structural tests. Runs WITHOUT any Moyasar keys or
// network: it exercises the two pure/local pieces (USD→SAR ceiling conversion
// and the webhook secret_token gate). The full live smoke (real invoice + paid
// webhook) needs test keys and is documented at the bottom.
//
//   Run:  MOYASAR_WEBHOOK_SECRET=test-secret ./run.sh src/test-moyasar.js
//   (the env var is needed only so the webhook-verify test has a secret to check)

import assert from 'node:assert';
import { usdToSarRiyals, usdToSarHalalas } from './money.js';
import { verifyMoyasarWebhook } from './moyasar.js';
import { config } from './config.js';

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n      ${e.message}`); }
}

const RATE = 3.75;

console.log('\nUSD→SAR conversion (ceil to whole riyal → halalas, rate 3.75):');
// Real plan prices from plans.js.
t('Pro monthly $59 → 222 ﷼ / 22200 halalas', () => {
  assert.strictEqual(usdToSarRiyals(59, RATE), 222);          // ceil(221.25)
  assert.strictEqual(usdToSarHalalas(59, RATE), 22200);
});
t('Pro annual $39 → 147 ﷼ / 14700 halalas', () => {
  assert.strictEqual(usdToSarRiyals(39, RATE), 147);          // ceil(146.25)
  assert.strictEqual(usdToSarHalalas(39, RATE), 14700);
});
t('Team monthly $79 → 297 ﷼ / 29700 halalas', () => {
  assert.strictEqual(usdToSarRiyals(79, RATE), 297);          // ceil(296.25)
  assert.strictEqual(usdToSarHalalas(79, RATE), 29700);
});
t('Team annual $59 → 222 ﷼', () => {
  assert.strictEqual(usdToSarRiyals(59, RATE), 222);
});
t('integer result is unchanged ($4 → 15 ﷼)', () => {
  assert.strictEqual(usdToSarRiyals(4, RATE), 15);            // 4*3.75 = 15 exactly
});
t('zero / invalid → 0', () => {
  assert.strictEqual(usdToSarHalalas(0, RATE), 0);
  assert.strictEqual(usdToSarHalalas(-5, RATE), 0);
  assert.strictEqual(usdToSarHalalas('x', RATE), 0);
});

console.log('\nWebhook secret_token gate:');
if (!config.moyasarWebhookSecret) {
  console.log('  ⚠ skipped — set MOYASAR_WEBHOOK_SECRET to run these (see header).');
} else {
  const secret = config.moyasarWebhookSecret;
  t('accepts a matching secret_token', () => {
    assert.strictEqual(verifyMoyasarWebhook({ secret_token: secret, type: 'payment_paid' }), true);
  });
  t('rejects a wrong secret_token', () => {
    assert.strictEqual(verifyMoyasarWebhook({ secret_token: secret + 'x' }), false);
  });
  t('rejects a missing secret_token', () => {
    assert.strictEqual(verifyMoyasarWebhook({ type: 'payment_paid' }), false);
  });
  t('rejects an empty body', () => {
    assert.strictEqual(verifyMoyasarWebhook({}), false);
    assert.strictEqual(verifyMoyasarWebhook(null), false);
  });
}

console.log(`\n${fail ? '✗' : '✓'} ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

// ── Live smoke (needs test keys) ─────────────────────────────────────────────
// Once MOYASAR_SECRET_KEY (sk_test_…) is in .env and the server is running:
//   1. Sign in to the studio → open /upgrade → toggle ﷼ SAR → "Upgrade to Pro".
//   2. You're redirected to Moyasar's hosted page. Pay with a TEST card
//      (e.g. 4111 1111 1111 1111, any future expiry, CVC 123, 3DS password 123).
//   3. Moyasar redirects to /api/moyasar/callback → server re-verifies → 302 to
//      /upgrade?done=1. Refresh the studio: plan = Pro, 200 makes, 30-day expiry.
//   4. Configure the dashboard webhook → https://<host>/api/moyasar/webhook with
//      the SAME secret_token as MOYASAR_WEBHOOK_SECRET, subscribed to payment_paid.
//      Re-run a payment and confirm the grant also lands via the webhook alone
//      (close the tab before the redirect) — it must be idempotent (no double grant).
