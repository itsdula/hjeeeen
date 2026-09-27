// Customer-facing plans & pricing — the single source the client renders (plans,
// top-up credit packs, concurrency boost, unlimited offers, FAQ). Stored as a
// settings doc so it can be edited live from /admin (dynamic pricing) WITHOUT a
// deploy. This is HJEN's OWN pricing surface — structure only; every label +
// number below is a placeholder the owner tunes. No third-party names in here.

import { store } from './store.js';

// ── the seeded default (English UI · HJEN branding) ──────────────────────────
export const DEFAULT_PRICING = {
  version: 1,
  currency: 'USD',
  // Recurring subscription tiers. ids match the governance PLANS in store.js —
  // the webhook maps a Paddle purchase straight onto the enforcement plan.
  // paddle.{monthly,annual} are SANDBOX price ids; swap for live ids at launch.
  plans: [
    {
      id: 'trial', name: 'Trial', tagline: 'Try the studio', badge: null,
      priceMonthly: 0, priceAnnual: 0, credits: 40, creditsPeriod: 'trial',
      highlight: false, paddle: null,
      features: ['40 makes to start', '15-day trial', 'All core tools', 'Cloud projects'],
    },
    {
      id: 'pro', name: 'Pro', tagline: 'For consistent creation', badge: 'Best value',
      priceMonthly: 59, priceAnnual: 39, credits: 200, creditsPeriod: 'month',
      highlight: true,
      paddle: {
        monthly: 'pri_01kyb6zrjc981jhg4vf4n79za6',
        annual: 'pri_01kyb6zs41w47gxbsje1ee2qd1',
      },
      features: ['200 makes / month', 'All models & tools',
        'Priority rendering', 'Cloud projects'],
    },
    {
      id: 'team', name: 'Team', tagline: 'Per seat — for studios & agencies', badge: null,
      priceMonthly: 79, priceAnnual: 59, credits: 500, creditsPeriod: 'month',
      highlight: false,
      paddle: {
        monthly: 'pri_01kyb6zsmda546a1dmqah2fxqc',
        annual: 'pri_01kyb6zt3aq2gmxf7hx3dxnqj2',
      },
      features: ['500 makes / month per seat', 'Shared team pool',
        'Organization accounts', 'All models & tools'],
    },
  ],
  // One-off credit packs (Top-up).
  topUp: [
    { credits: 500, price: 12 },
    { credits: 1000, price: 22 },
    { credits: 1500, price: 30 },
    { credits: 2000, price: 38 },
    { credits: 2500, price: 46 },
    { credits: 3000, price: 54 },
  ],
  // Concurrency boost — more parallel generations.
  boost: {
    steps: [
      { add: 4, price: 19 },
      { add: 8, price: 35 },
      { add: 12, price: 49 },
      { add: 16, price: 63 },
    ],
    note: 'Run more generations in parallel — applies to every model.',
  },
  // Unlimited access offers (per model / tier).
  unlimited: [
    { id: 'all', name: 'All top models', price: 99, blurb: 'Unlimited access to every top model for a fixed window.' },
    { id: 'image', name: 'Image models', price: 35, blurb: 'Unlimited image generations.' },
    { id: 'video', name: 'Video models', price: 73, blurb: 'Unlimited video generations.' },
  ],
  faq: [
    { q: 'How do credits work?', a: 'Each generation spends credits based on the model, resolution and length. Your balance shows in the top-right menu.' },
    { q: 'Is my subscription automatically renewed?', a: 'Yes — it renews at the end of each billing period. You can change or cancel anytime.' },
    { q: 'How many images or videos can I generate?', a: 'As many as your credit balance allows; each plan includes a monthly credit grant.' },
    { q: 'How can I purchase extra credits?', a: 'Use Top-up in the account menu to add a one-off credit pack anytime.' },
    { q: 'Can I change my plan after purchase?', a: 'Yes — upgrade, downgrade or change commitment from the plans page.' },
  ],
};

export function getPricing() {
  const s = store.getSettings();
  const p = s.pricing;
  return (p && p.version) ? p : DEFAULT_PRICING;
}

export function setPricing(config) {
  if (!config || typeof config !== 'object') return { ok: false, reason: 'bad_config' };
  store.setSetting('pricing', config);
  return { ok: true, pricing: config };
}
