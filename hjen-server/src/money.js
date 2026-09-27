// Currency conversion — the single source of truth for USD→SAR.
//
// The whole product prices in USD (plans.js). Moyasar charges in SAR only, in
// the smallest unit (halalas: 100 halalas = 1 SAR). So at checkout we convert
// USD→SAR using a LIVE rate the owner keeps current, then CEIL to a whole riyal
// (no ugly fractional prices — $59 × 3.75 = 221.25 → 222 ﷼ → 22200 halalas).
//
// The rate is owner-editable at runtime (stored as a setting, no deploy). Order
// of precedence: settings.sarRate → env SAR_RATE → DEFAULT_SAR_RATE.

import { store } from './store.js';
import { config } from './config.js';

export const DEFAULT_SAR_RATE = 3.75; // SAR is pegged to USD at ~3.75.

/** The active VAT rate as a percent (e.g. 15). 0 = VAT off. Owner-set via
 *  VAT_PERCENT; the single source both the charge gross-up and the Qoyod invoice
 *  tax_percent read, so collected tax always equals declared tax. */
export function vatPercent() {
  const n = Number(config.vatPercent);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Gross a VAT-exclusive USD amount up by the active VAT rate. With VAT off
 *  (0%) this is a no-op, so charges are unchanged until the owner sets the rate. */
export function grossWithVat(usd, pct = vatPercent()) {
  const n = Number(usd);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n * (1 + pct / 100);
}

/** Current USD→SAR rate — owner-editable from /admin, falls back to env/default. */
export function getSarRate() {
  const fromSetting = Number(store.getSettings().sarRate);
  if (Number.isFinite(fromSetting) && fromSetting > 0) return fromSetting;
  const fromEnv = Number(process.env.SAR_RATE);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return DEFAULT_SAR_RATE;
}

/** Whole-riyal SAR price for a USD amount — ceil to the next riyal. */
export function usdToSarRiyals(usd, rate = getSarRate()) {
  const n = Number(usd);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n * rate);
}

/** SAR price in halalas (Moyasar's smallest-unit amount) for a USD amount. */
export function usdToSarHalalas(usd, rate = getSarRate()) {
  return usdToSarRiyals(usd, rate) * 100;
}
