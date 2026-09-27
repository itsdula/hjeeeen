import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  gatewayGet, gatewayPost, getGatewayConn,
  type Pricing, type PricingResponse,
  type Profile, type ProfileResponse, type AvatarResponse,
  type TopUpPack, type BoostStep, type UnlimitedPlan, type FaqItem, type PricingPlan,
  type BillingConfig, type MoyasarIntent,
} from '../lib/gateway';

/* ─── Moyasar.js — the in-app card form (Saudi rail) ──────────────────────────
 * Checkout happens INSIDE the studio: a modal hosts Moyasar's embedded form, so
 * the card page never feels like leaving the app. Prices show in USD; the SAR
 * amount is set server-side (intent) and re-verified on grant. The 3-DS bank
 * step is the issuer's own page (unavoidable), then it returns to the studio. */
declare global {
  interface Window { Moyasar?: { init: (opts: Record<string, unknown>) => void } }
}
const MYSR_VER = '1.19.0';
let moyasarLoad: Promise<void> | null = null;
function ensureMoyasar(): Promise<void> {
  if (window.Moyasar) return Promise.resolve();
  if (moyasarLoad) return moyasarLoad;
  moyasarLoad = new Promise<void>((resolve, reject) => {
    if (!document.querySelector('link[data-mysr]')) {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = `https://cdn.moyasar.com/mpf/${MYSR_VER}/moyasar.css`;
      css.setAttribute('data-mysr', '1');
      document.head.appendChild(css);
    }
    const s = document.createElement('script');
    s.src = `https://cdn.moyasar.com/mpf/${MYSR_VER}/moyasar.js`;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { moyasarLoad = null; reject(new Error('moyasar_load_failed')); };
    document.head.appendChild(s);
  });
  return moyasarLoad;
}

/* ────────────────────────────────────────────────────────────────────────
 *  Account modals — Profile editor + Pricing/offers.
 *  All data comes from the gateway (getGateway → /api/*). HJEN-branded,
 *  token-driven, works on desktop-on-gateway and web alike. Checkout is a
 *  deferred stub — no payment provider is wired yet.
 * ──────────────────────────────────────────────────────────────────────── */

/** Escape-to-close for any modal. */
function useEscClose(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
}

/* ═══════════════════════════ Profile modal ══════════════════════════════ */

const BIO_MAX = 300;
const SOCIALS: Array<{ key: 'x' | 'instagram' | 'youtube' | 'tiktok'; prefix: string }> = [
  { key: 'x',         prefix: 'x.com/' },
  { key: 'instagram', prefix: 'instagram.com/' },
  { key: 'youtube',   prefix: 'youtube.com/@' },
  { key: 'tiktok',    prefix: 'tiktok.com/@' },
];

export function ProfileModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEscClose(open, onClose);

  // Load current values whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    setErr(null);
    gatewayGet<ProfileResponse>('/api/profile').then(res => {
      if (!live) return;
      if (res && res.ok) setProfile(res.profile);
      else setErr('Could not load your profile.');
      setLoading(false);
    });
    return () => { live = false; };
  }, [open]);

  const patch = <K extends keyof Profile>(k: K, v: Profile[K]) =>
    setProfile(p => (p ? { ...p, [k]: v } : p));
  const patchSocial = (k: 'x' | 'instagram' | 'youtube' | 'tiktok', v: string) =>
    setProfile(p => (p ? { ...p, socials: { ...p.socials, [k]: v } } : p));

  const pickAvatar = () => fileRef.current?.click();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    setUploading(true);
    setErr(null);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error('read failed'));
        r.readAsDataURL(file);
      });
      const base64 = dataUrl.replace(/^data:[^;]*;base64,/, '');
      const ext = (file.name.split('.').pop() || file.type.split('/').pop() || 'png').toLowerCase();
      const res = await gatewayPost<AvatarResponse>('/api/profile/avatar', { base64, ext });
      if (res && res.ok) patch('avatar', res.avatar);
      else setErr('Avatar upload failed.');
    } catch {
      setErr('Avatar upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!profile || saving) return;
    setSaving(true);
    setErr(null);
    const res = await gatewayPost<ProfileResponse>('/api/profile', {
      username: profile.username,
      headline: profile.headline,
      bio: profile.bio,
      location: profile.location,
      socials: profile.socials,
    });
    setSaving(false);
    if (res && res.ok) onClose();
    else setErr('Could not save. Try again.');
  };

  if (!open) return null;

  // Portal to <body> so the modal escapes the fixed, stacking-context topbar
  // (.top-chrome, z-index 120) it is triggered from and layers over everything.
  return createPortal(
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal--narrow acct-modal" role="dialog" aria-modal="true" aria-label="Edit profile">
        <div className="modal__header">
          <span className="mono-label">Profile</span>
          <span style={{ flex: 1 }} />
          <button className="modal__close" onClick={onClose}>Close</button>
        </div>

        <div className="acct-modal__body">
          {loading || !profile ? (
            <div className="acct-empty">{err ?? 'Loading…'}</div>
          ) : (
            <>
              {/* Avatar */}
              <div className="pf-avatar-row">
                <div
                  className="pf-avatar"
                  style={profile.avatar ? { backgroundImage: `url(${profile.avatar})` } : undefined}
                  aria-hidden
                >
                  {!profile.avatar && (profile.username?.[0]?.toUpperCase() || '·')}
                </div>
                <div className="pf-avatar-actions">
                  <button className="btn-secondary" onClick={pickAvatar} disabled={uploading}>
                    {uploading ? 'Uploading…' : 'Upload'}
                  </button>
                  <span className="pf-hint">PNG or JPG, square works best.</span>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  onChange={onFile}
                  style={{ display: 'none' }}
                />
              </div>

              <label className="pf-field">
                <span className="mono-label">Username</span>
                <input className="acct-input" value={profile.username} onChange={e => patch('username', e.target.value)} placeholder="username" />
              </label>

              <label className="pf-field">
                <span className="mono-label">Headline</span>
                <input className="acct-input" value={profile.headline} onChange={e => patch('headline', e.target.value)} placeholder="What you make" />
              </label>

              <label className="pf-field">
                <span className="mono-label">Bio</span>
                <textarea
                  className="acct-textarea"
                  value={profile.bio}
                  maxLength={BIO_MAX}
                  onChange={e => patch('bio', e.target.value)}
                  rows={3}
                  placeholder="A line or two about your work."
                />
                <span className="pf-counter">{profile.bio.length}/{BIO_MAX}</span>
              </label>

              <label className="pf-field">
                <span className="mono-label">Location</span>
                <input className="acct-input" value={profile.location} onChange={e => patch('location', e.target.value)} placeholder="City, Country" />
              </label>

              <div className="pf-field">
                <span className="mono-label">Socials</span>
                <div className="pf-socials">
                  {SOCIALS.map(s => (
                    <div className="pf-social" key={s.key}>
                      <span className="pf-social__prefix">{s.prefix}</span>
                      <input
                        className="acct-input pf-social__input"
                        value={profile.socials[s.key] ?? ''}
                        onChange={e => patchSocial(s.key, e.target.value)}
                        placeholder="handle"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {err && <div className="acct-error">{err}</div>}
            </>
          )}
        </div>

        <div className="acct-modal__foot">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={!profile || saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ═══════════════════════════ Pricing modal ══════════════════════════════ */

export type PricingTab = 'plan' | 'topup' | 'unlimited';

const TABS: Array<{ id: PricingTab; label: string }> = [
  { id: 'plan',      label: 'Upgrade Plan' },
  { id: 'topup',     label: 'Top-up Credits' },
  { id: 'unlimited', label: 'Unlimited Models' },
];

function money(currency: string, amount: number): string {
  const sym = currency === 'USD' ? '$' : currency === 'SAR' ? 'SAR ' : `${currency} `;
  return `${sym}${amount % 1 === 0 ? amount : amount.toFixed(2)}`;
}

export function PricingModal({
  open, onClose, initialTab = 'plan',
}: { open: boolean; onClose: () => void; initialTab?: PricingTab }) {
  const [data, setData] = useState<Pricing | null>(null);
  const [billing, setBilling] = useState<BillingConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<PricingTab>(initialTab);
  const [annual, setAnnual] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  // The in-app payment modal for a chosen plan (web); null when not paying.
  const [payFor, setPayFor] = useState<{ plan: string; cycle: 'monthly' | 'annual' } | null>(null);

  useEscClose(open, onClose);
  useEffect(() => { if (open) setTab(initialTab); }, [open, initialTab]);

  // Pricing catalogue + checkout wiring (Moyasar), both fetched once on open.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    setErr(null);
    Promise.all([
      gatewayGet<PricingResponse>('/api/pricing'),
      gatewayGet<BillingConfig>('/api/billing/config'),
    ]).then(([pr, bc]) => {
      if (!live) return;
      if (pr && pr.ok) setData(pr.pricing);
      else setErr('Could not load pricing.');
      setBilling(bc && bc.ok ? bc : null);
      setLoading(false);
    });
    return () => { live = false; };
  }, [open]);

  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  const flashNotice = useCallback((msg: string) => {
    setNotice(msg);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3600);
  }, []);

  // Checkout is live only once the Saudi rail (Moyasar) is configured.
  const moyasarReady = !!billing?.moyasar?.enabled;

  // Top-up packs + unlimited offers aren't wired yet — always deferred.
  const onComingSoon = useCallback(() => {
    flashNotice('Checkout for this is coming soon.');
  }, [flashNotice]);

  // Subscription PLAN checkout — Moyasar (Saudi rail). USD shows here; the SAR
  // amount appears only on Moyasar's hosted page after the redirect.
  const onPlanCheckout = useCallback(async (plan: PricingPlan) => {
    if (!billing?.moyasar?.enabled) { flashNotice('Payments are being set up — checkout is coming soon.'); return; }

    // Desktop (Electron): hand off to the browser /upgrade page (carrying the
    // token so it's signed in), which runs the same redirect.
    if (!window.hjen?.__web) {
      const g = await getGatewayConn();
      if (g) window.hjen?.openExternalUrl?.(`${g.base}/upgrade?token=${encodeURIComponent(g.token)}`);
      else flashNotice('Could not open checkout.');
      return;
    }

    // Web: open the in-app card form (embedded Moyasar.js) — no external redirect.
    setPayFor({ plan: plan.id, cycle: annual ? 'annual' : 'monthly' });
  }, [billing, annual, flashNotice]);

  if (!open) return null;

  const cur = data?.currency ?? 'USD';

  // Portal to <body> — same reason as ProfileModal: escape the topbar's
  // fixed z-index:120 stacking context so the modal is never clipped or buried.
  return createPortal(
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal acct-modal pricing-modal" role="dialog" aria-modal="true" aria-label="Plans and credits">
        <div className="modal__header pricing-modal__header">
          <span className="mono-label">Plans &amp; Credits</span>
          <div className="pricing-tabs">
            {TABS.map(t => (
              <button
                key={t.id}
                className={`pricing-tab ${tab === t.id ? 'pricing-tab--on' : ''}`}
                onClick={() => setTab(t.id)}
              >{t.label}</button>
            ))}
          </div>
          <button className="modal__close" onClick={onClose}>Close</button>
        </div>

        <div className="acct-modal__body pricing-modal__body">
          {loading || !data ? (
            <div className="acct-empty">{err ?? 'Loading…'}</div>
          ) : (
            <>
              {/* ── Upgrade Plan ── */}
              {tab === 'plan' && (
                <>
                  <div className="pricing-billing-toggle">
                    <button className={`pbt ${!annual ? 'pbt--on' : ''}`} onClick={() => setAnnual(false)}>Monthly</button>
                    <button className={`pbt ${annual ? 'pbt--on' : ''}`} onClick={() => setAnnual(true)}>Annual</button>
                  </div>
                  <div className="plan-grid">
                    {data.plans.map(p => (
                      <PlanCard key={p.id} plan={p} annual={annual} currency={cur} ready={moyasarReady} onCheckout={onPlanCheckout} />
                    ))}
                  </div>
                </>
              )}

              {/* ── Top-up Credits ── */}
              {tab === 'topup' && (
                <>
                  <div className="offer-section-label mono-label">One-time credit packs</div>
                  <div className="topup-grid">
                    {data.topUp.map((pk, i) => (
                      <TopUpCard key={i} pack={pk} currency={cur} onCheckout={onComingSoon} />
                    ))}
                  </div>

                  <div className="offer-section-label mono-label">Boost making speed</div>
                  {data.boost.note && <p className="offer-note">{data.boost.note}</p>}
                  <div className="boost-grid">
                    {data.boost.steps.map((b, i) => (
                      <BoostCard key={i} step={b} currency={cur} onCheckout={onComingSoon} />
                    ))}
                  </div>
                </>
              )}

              {/* ── Unlimited Models ── */}
              {tab === 'unlimited' && (
                <div className="unlimited-grid">
                  {data.unlimited.map(u => (
                    <UnlimitedCard key={u.id} plan={u} currency={cur} onCheckout={onComingSoon} />
                  ))}
                </div>
              )}

              {/* ── FAQ ── */}
              {data.faq.length > 0 && (
                <div className="faq">
                  <div className="offer-section-label mono-label">Questions</div>
                  {data.faq.map((f, i) => (
                    <FaqRow key={i} item={f} open={openFaq === i} onToggle={() => setOpenFaq(openFaq === i ? null : i)} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {notice && <div className="pricing-notice" role="status">{notice}</div>}
      </div>
      {payFor && (
        <PaymentModal plan={payFor.plan} cycle={payFor.cycle} onClose={() => setPayFor(null)} />
      )}
    </div>,
    document.body,
  );
}

/* ─── In-app payment modal (embedded Moyasar.js card form) ────────────────── */
function PaymentModal({
  plan, cycle, onClose,
}: { plan: string; cycle: 'monthly' | 'annual'; onClose: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEscClose(true, onClose);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const intent = await gatewayPost<MoyasarIntent>(
        '/api/moyasar/intent', { plan, cycle, returnTo: window.location.pathname },
      );
      if (cancelled) return;
      if (!intent?.ok || !intent.amount || !intent.publishableKey) {
        setErr(intent?.message || 'Could not start payment. Please try again.');
        return;
      }
      try {
        await ensureMoyasar();
        if (cancelled) return;
        window.Moyasar?.init({
          element: '.mysr-form',
          amount: intent.amount,
          currency: intent.currency || 'SAR',
          description: intent.description || 'HJEN Studio',
          publishable_api_key: intent.publishableKey,
          callback_url: intent.callbackUrl,
          methods: ['creditcard'],
          supported_networks: ['mada', 'visa', 'mastercard'],
          metadata: intent.metadata,
          language: 'en',
        });
        setReady(true);
      } catch {
        setErr('Could not load the secure form. Check your connection and try again.');
      }
    })();
    return () => { cancelled = true; };
  }, [plan, cycle]);

  return createPortal(
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal--narrow payment-modal" role="dialog" aria-modal="true" aria-label="Secure payment">
        <div className="modal__header">
          <span className="mono-label">Secure payment</span>
          <button className="modal__close" onClick={onClose}>Close</button>
        </div>
        <div className="payment-modal__body">
          {err ? (
            <div className="payment-modal__err">{err}</div>
          ) : (
            <>
              {!ready && <div className="payment-modal__loading">Loading secure form…</div>}
              <div className="mysr-form" />
            </>
          )}
        </div>
        <p className="payment-modal__note">
          Card details are processed securely by Moyasar. You’ll confirm the payment with your bank.
        </p>
      </div>
    </div>,
    document.body,
  );
}

/* ─── Payment-result modal ────────────────────────────────────────────────
 * Fires when the studio loads back from Moyasar with ?checkout=<status>. Every
 * outcome gets a clear customer message: success (plan + credits added), a
 * declined/failed payment (card not charged, try again), or a cancelled
 * checkout (no charge). Never a silent redirect. */
export type BillingStatus = 'success' | 'failed' | 'cancelled';
export function BillingResultModal({
  open, onClose, status, plan, credits, onRetry,
}: {
  open: boolean; onClose: () => void; status: BillingStatus;
  plan?: string; credits?: number; onRetry?: () => void;
}) {
  useEscClose(open, onClose);
  if (!open) return null;
  const planName = plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : null;

  const view = status === 'success'
    ? {
        mod: 'is-success',
        icon: 'M20 6L9 17l-5-5',
        title: planName ? `You’re on ${planName}` : 'Payment received',
        sub: typeof credits === 'number'
          ? `${credits.toLocaleString()} makes were added to your account for this month. Your plan renews when you buy again.`
          : 'Your plan is now active — your new balance shows in the account menu.',
      }
    : status === 'cancelled'
    ? {
        mod: 'is-neutral',
        icon: 'M18 6L6 18M6 6l12 12',
        title: 'Checkout cancelled',
        sub: 'No charge was made. You can choose a plan whenever you’re ready.',
      }
    : {
        mod: 'is-error',
        icon: 'M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
        title: 'Payment not completed',
        sub: 'Your card wasn’t charged. Please try again or use a different card.',
      };

  return createPortal(
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal modal--narrow billing-result ${view.mod}`} role="dialog" aria-modal="true" aria-label={view.title}>
        <div className="billing-result__icon" aria-hidden="true">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d={view.icon} /></svg>
        </div>
        <h2 className="billing-result__title">{view.title}</h2>
        <p className="billing-result__sub">{view.sub}</p>
        <div className="billing-result__actions">
          {status !== 'success' && onRetry && (
            <button className="billing-result__cta" onClick={() => { onClose(); onRetry(); }}>Try again</button>
          )}
          <button
            className={`billing-result__cta${status === 'success' ? '' : ' billing-result__cta--ghost'}`}
            onClick={onClose}
          >{status === 'success' ? 'Continue' : 'Close'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ─── Buy button — real when `soon` is false, placeholder when true ──────── */
function BuyButton({ label, onClick, primary, soon }: { label: string; onClick: () => void; primary?: boolean; soon?: boolean }) {
  return (
    <button
      className={`buy-btn ${primary ? 'buy-btn--primary' : ''} ${soon ? 'buy-btn--soon-state' : ''}`}
      onClick={onClick}
      title={soon ? 'Checkout coming soon' : label}
    >
      {label}
      {soon && <span className="buy-btn__soon">Coming soon</span>}
    </button>
  );
}

function PlanCard({ plan, annual, currency, ready, onCheckout }: { plan: PricingPlan; annual: boolean; currency: string; ready: boolean; onCheckout: (plan: PricingPlan) => void }) {
  const price = annual ? plan.priceAnnual : plan.priceMonthly;
  return (
    <div className={`plan-card ${plan.highlight ? 'plan-card--hl' : ''}`}>
      <div className="plan-card__top">
        <span className="plan-card__name">{plan.name}</span>
        {plan.badge && <span className="plan-badge">{plan.badge}</span>}
      </div>
      <div className="plan-card__tagline">{plan.tagline}</div>
      <div className="plan-card__price">
        <span className="plan-card__amt">{money(currency, price)}</span>
        <span className="plan-card__per">/ {annual ? 'yr' : 'mo'}</span>
      </div>
      <div className="plan-card__credits">{plan.credits.toLocaleString()} credits / {plan.creditsPeriod}</div>
      <ul className="plan-features">
        {plan.features.map((f, i) => (
          <li key={i}><FeatureTick />{f}</li>
        ))}
      </ul>
      {/* Plans are the only checkout path (Moyasar) — `soon` only when it isn't ready yet. */}
      <BuyButton label={`Choose ${plan.name}`} primary={plan.highlight} soon={!ready} onClick={() => onCheckout(plan)} />
    </div>
  );
}

function TopUpCard({ pack, currency, onCheckout }: { pack: TopUpPack; currency: string; onCheckout: () => void }) {
  return (
    <div className="offer-card">
      <div className="offer-card__lead">{pack.credits.toLocaleString()}</div>
      <div className="offer-card__unit mono-label">credits</div>
      <div className="offer-card__price">{money(currency, pack.price)}</div>
      {/* No price id yet → always the coming-soon placeholder. */}
      <BuyButton label="Buy" soon onClick={onCheckout} />
    </div>
  );
}

function BoostCard({ step, currency, onCheckout }: { step: BoostStep; currency: string; onCheckout: () => void }) {
  return (
    <div className="offer-card offer-card--boost">
      <div className="offer-card__lead">+{step.add}</div>
      <div className="offer-card__unit mono-label">speed</div>
      <div className="offer-card__price">{money(currency, step.price)}</div>
      <BuyButton label="Add" soon onClick={onCheckout} />
    </div>
  );
}

function UnlimitedCard({ plan, currency, onCheckout }: { plan: UnlimitedPlan; currency: string; onCheckout: () => void }) {
  return (
    <div className="unlimited-card">
      <div className="unlimited-card__name">{plan.name}</div>
      <div className="unlimited-card__blurb">{plan.blurb}</div>
      <div className="unlimited-card__price">
        <span className="plan-card__amt">{money(currency, plan.price)}</span>
        <span className="plan-card__per">/ mo</span>
      </div>
      <BuyButton label="Get" primary soon onClick={onCheckout} />
    </div>
  );
}

function FaqRow({ item, open, onToggle }: { item: FaqItem; open: boolean; onToggle: () => void }) {
  return (
    <div className={`faq-row ${open ? 'faq-row--open' : ''}`}>
      <button className="faq-q" onClick={onToggle} aria-expanded={open}>
        <span>{item.q}</span>
        <svg className="faq-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && <div className="faq-a selectable">{item.a}</div>}
    </div>
  );
}

function FeatureTick() {
  return (
    <svg className="feat-tick" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
