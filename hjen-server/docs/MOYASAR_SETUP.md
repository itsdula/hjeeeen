# Moyasar — the Saudi payment rail (SAR)

Moyasar runs alongside Paddle. **Paddle = global / USD** (merchant of record,
recurring). **Moyasar = Saudi / SAR** (mada · card · Apple Pay · STC Pay), hosted
invoice, **one-off purchase = one paid month**. USD is the single source of truth;
SAR is derived at checkout.

## How it works

1. `/upgrade` → toggle **﷼ SAR** → *Upgrade to Pro/Team*.
2. Client `POST /api/moyasar/checkout {plan, cycle}` → server fixes the amount
   (never trusts the client), converts USD→SAR, creates a **hosted invoice**, and
   returns its `url`. Client redirects there.
3. Payer pays on Moyasar's page (card/mada/Apple Pay/STC Pay), 3-DS included.
4. Moyasar redirects to `/api/moyasar/callback?id=<payment>` → server **re-fetches
   the payment from Moyasar** and grants only on real `paid` → `302 /upgrade?done=1`.
5. In parallel, the dashboard **webhook** hits `/api/moyasar/webhook` (secret_token
   gate + the same server-side re-verify) as the authoritative async grant.
   Both paths funnel through one idempotent apply (`data/moyasar_seen.json`).

**Security:** the browser return and the webhook body are never trusted for
`paid` — the server always GETs the payment from `api.moyasar.com` with the secret
key and checks the status before granting. A forged request cannot grant a plan.

## Pricing (USD → SAR)

- Plans stay **USD** in `src/plans.js`. No SAR numbers are hardcoded.
- At checkout: `SAR = ceil(USD × rate)` whole riyals, then `× 100` halalas
  (Moyasar's smallest unit). e.g. $59 × 3.75 = 221.25 → **222 ﷼** → `22200`.
- Rate precedence: `settings.sarRate` → env `SAR_RATE` → `3.75`.
- Owner updates the rate live (no deploy): `POST /api/admin/sar-rate {rate}`
  (admin token). Read it with `GET /api/admin/sar-rate`.

## Go-live checklist (Anwar)

1. **Keys** — Moyasar dashboard → API keys. Put in `server/.env`:
   ```
   MOYASAR_ENV=test
   MOYASAR_SECRET_KEY=sk_test_…      # server-only (Basic auth user)
   MOYASAR_PUBLISHABLE_KEY=pk_test_… # public; unused by hosted flow, kept for parity
   MOYASAR_WEBHOOK_SECRET=<pick a long random string>
   SAR_RATE=3.75
   ```
2. **Webhook** — dashboard → Webhooks → add
   `https://demo.hjen.ai/api/moyasar/webhook`, set its **Secret Token** to the
   SAME value as `MOYASAR_WEBHOOK_SECRET`, subscribe to **payment_paid** (add
   payment_failed / payment_refunded later for logging).
3. **Deploy** — copy the new `MOYASAR_*` + `SAR_RATE` into the Frankfurt server's
   `.env`, `git pull`, restart the service.
4. **Test** — `/upgrade` → ﷼ SAR → Pro → pay with a Moyasar **test card**
   (`4111 1111 1111 1111`, future expiry, CVC `123`, 3-DS password `123`). Confirm
   the studio shows plan = Pro, 200 makes, 30-day expiry.
5. **Live** — flip `MOYASAR_ENV=live`, swap to `sk_live_…`/`pk_live_…`, add the
   live webhook, re-test with a real low-value charge.

## No-key test (runs today)

```
MOYASAR_WEBHOOK_SECRET=test-secret ./run.sh src/test-moyasar.js
```
Checks the USD→SAR ceiling and the webhook secret_token gate. The live smoke
(real invoice + paid webhook) is documented at the bottom of that file.

## Deferred (fast-follow)

- **Auto-renew** — Moyasar has no native subscriptions. Save the card **token** on
  first payment and charge it monthly via `src/scheduler.js` (+ failed-charge
  dunning). Until then, a purchase is one paid month; the account falls back to
  trial on expiry unless the user buys again.
- **Top-up / boost / unlimited** via Moyasar (plans only for now — Paddle parity).
- **Country-aware default rail** (SAR for Gulf, USD elsewhere) — today the user
  picks with the ﷼/$ toggle; default is SAR when Moyasar is configured.

## Files

`src/money.js` (USD→SAR) · `src/moyasar.js` (gateway) · `src/store.js`
(`applyMoyasarPurchase`) · `src/server.js` (`/api/moyasar/{checkout,webhook,callback}`,
`/api/admin/sar-rate`, `/api/billing/config` moyasar block) · `public/upgrade.html`
(﷼/$ toggle) · `src/test-moyasar.js`.
