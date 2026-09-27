/* ────────────────────────────────────────────────────────────────────────
 *  Gateway client — the single door the shared renderer uses to reach the
 *  HJEN account/credit/pricing/profile server, identically on desktop
 *  (Electron on a gateway) and web (getGateway returns { url: origin, token }).
 *
 *  The account lives on the gateway, so every account-aware surface gates on
 *  "a gateway is configured" — never on the host. When getGateway() returns
 *  null (desktop on its own API keys) these helpers return null and callers
 *  fall back to the local-workspace presentation.
 * ──────────────────────────────────────────────────────────────────────── */

export interface GatewayConn { base: string; token: string; }

/** Resolve the configured gateway, or null when none is set. */
export async function getGatewayConn(): Promise<GatewayConn | null> {
  try {
    const g = await window.hjen?.getGateway?.();
    const base = g?.url?.replace(/\/$/, '');
    const token = g?.token;
    if (!base || !token) return null;
    return { base, token };
  } catch {
    return null;
  }
}

/** GET a gateway JSON endpoint, or null when unreachable / no gateway. */
export async function gatewayGet<T>(path: string): Promise<T | null> {
  const c = await getGatewayConn();
  if (!c) return null;
  try {
    const res = await fetch(`${c.base}${path}`, {
      headers: { Authorization: `Bearer ${c.token}` },
    });
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** POST JSON to a gateway endpoint, or null when unreachable / no gateway. */
export async function gatewayPost<T>(path: string, body: unknown): Promise<T | null> {
  const c = await getGatewayConn();
  if (!c) return null;
  try {
    const res = await fetch(`${c.base}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${c.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/* ─── Shared response shapes (mirror the live gateway) ─────────────────── */

export interface PricingPlan {
  id: string;
  name: string;
  tagline: string;
  badge?: string;
  priceMonthly: number;
  priceAnnual: number;
  credits: number;
  creditsPeriod: string;
  highlight?: boolean;
  features: string[];
}
export interface TopUpPack { credits: number; price: number; }
export interface BoostStep { add: number; price: number; }
export interface UnlimitedPlan { id: string; name: string; price: number; blurb: string; }
export interface FaqItem { q: string; a: string; }

export interface Pricing {
  currency: string;
  plans: PricingPlan[];
  topUp: TopUpPack[];
  boost: { steps: BoostStep[]; note?: string };
  unlimited: UnlimitedPlan[];
  faq: FaqItem[];
}
export interface PricingResponse {
  ok: boolean;
  pricing: Pricing;
  account: { plan: string; remaining: number; genLimit: number };
}

export interface ProfileSocials {
  x?: string;
  instagram?: string;
  youtube?: string;
  tiktok?: string;
}
export interface Profile {
  username: string;
  headline: string;
  bio: string;
  location: string;
  socials: ProfileSocials;
  email: string;
  avatar: string | null;
}
export interface ProfileResponse { ok: boolean; profile: Profile; }
export interface AvatarResponse { ok: boolean; avatar: string; }

/** Paddle price ids for one subscription plan, per billing cycle. */
export interface BillingPrice { plan: string; monthly: string; annual: string; }
/** Whole-riyal SAR display prices for one plan (computed from USD at the live
 *  rate). Shown only if we ever want to preview SAR — the app displays USD and
 *  lets Moyasar's hosted page reveal the SAR amount. */
export interface MoyasarSarPrice { plan: string; monthly: number; annual: number; }
/** GET /api/billing/config — checkout wiring. The Saudi rail (Moyasar) is the
 *  only customer checkout: `moyasar.enabled` is the go/coming-soon signal. USD
 *  is the display currency everywhere in the app; SAR appears only on Moyasar's
 *  hosted page. (Paddle fields remain for backward-compat but are unused.) */
export interface BillingConfig {
  ok: boolean;
  env: 'sandbox' | 'live';
  clientToken: string | null;
  acc: string;
  email: string;
  plan: string;
  prices: BillingPrice[];
  moyasar?: {
    enabled: boolean;
    env: string;
    currency: string;
    rate: number;
    publishableKey: string | null;
    sar: MoyasarSarPrice[];
  };
}
/** POST /api/moyasar/checkout → the hosted invoice URL to redirect the payer to. */
export interface MoyasarCheckout { ok: boolean; url?: string; id?: string; message?: string }
/** POST /api/moyasar/intent → server-authoritative values for the in-app
 *  Moyasar.js card form (amount in halalas, publishable key, callback, metadata). */
export interface MoyasarIntent {
  ok: boolean;
  amount?: number;
  currency?: string;
  description?: string;
  publishableKey?: string;
  callbackUrl?: string;
  metadata?: Record<string, string>;
  message?: string;
}
