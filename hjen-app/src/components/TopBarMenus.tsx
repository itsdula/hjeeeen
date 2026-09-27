import { useState, useRef, useEffect, useCallback } from 'react';
import { useStore } from '../store';
import type { WebAccount } from '../types/hjen-bridge';
import { ProfileModal, PricingModal, BillingResultModal, type PricingTab, type BillingStatus } from './AccountModals';

/* ────────────────────────────────────────────────────────────────────────
 *  Top-bar menus — Learn · Support · Account
 *  The right cluster is Learn · Support · Account▾, and the account
 *  dropdown is where identity,
 *  usage/credits, billing and settings all live. HJEN adapts this to a
 *  local BYOK workspace — no cloud session, so no Invite / Connect / Log out.
 * ──────────────────────────────────────────────────────────────────────── */

// Local edition identity. No auth in a BYOK/offline app — these are the
// presentational stand-ins for a cloud account header. Edit here
// when real accounts land.
export const PROFILE = {
  name: 'HJEN Studio',
  email: 'Local workspace · Offline',
  plan: 'PRO',
};

/** Close-on-outside-click + Escape for any popover. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

/* ─── Studio — jump to the product hub (sits by Learn & Support) ──────── */

export function StudioLink() {
  const setActiveView = useStore(s => s.setActiveView);
  const active = useStore(s => s.activeView);
  // Studio glows while inside the hub or any product workspace (e.g. frame).
  const on = active === 'studio' || active === 'frame';
  return (
    <button
      className={`topbar-link ${on ? 'topbar-link--on' : ''}`}
      onClick={() => setActiveView('studio')}
      title="Studio"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="14" rx="2" />
        <path d="M3 9h18" /><path d="M8 21h8" /><path d="M12 18v3" />
      </svg>
      Studio
    </button>
  );
}

/* ─── App — the standalone-tools hub (sits right after Studio) ────────── */

export function AppLink() {
  const setActiveView = useStore(s => s.setActiveView);
  const active = useStore(s => s.activeView);
  // Glows while inside the App hub or any standalone tool it hosts (Cuts).
  const on = active === 'apphub' || active === 'cuts';
  return (
    <button
      className={`topbar-link ${on ? 'topbar-link--on' : ''}`}
      onClick={() => setActiveView('apphub')}
      title="App — standalone tools"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1.6" />
        <rect x="14" y="3" width="7" height="7" rx="1.6" />
        <rect x="3" y="14" width="7" height="7" rx="1.6" />
        <rect x="14" y="14" width="7" height="7" rx="1.6" />
      </svg>
      App
    </button>
  );
}

/* ─── Learn — navigates to the Learn page (the Learn hub) ─────────── */

export function LearnMenu() {
  const setActiveView = useStore(s => s.setActiveView);
  const active = useStore(s => s.activeView);
  return (
    <button
      className={`topbar-link ${active === 'learn' ? 'topbar-link--on' : ''}`}
      onClick={() => setActiveView('learn')}
      title="Learn"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6.5A2 2 0 0 1 5 5h5a2 2 0 0 1 2 2v12a1.5 1.5 0 0 0-1.5-1.5H5A2 2 0 0 1 3 15.5z" />
        <path d="M21 6.5A2 2 0 0 0 19 5h-5a2 2 0 0 0-2 2v12a1.5 1.5 0 0 1 1.5-1.5H19a2 2 0 0 0 2-2z" />
      </svg>
      Learn
    </button>
  );
}

/* ─── Support — in-app tickets, no email ─────────────────────────────── */

export function SupportMenu() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'Feature request' | 'Bug' | 'Question'>('Feature request');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useDismiss(open, () => setOpen(false));

  // Reset the panel each time it opens.
  useEffect(() => { if (open) { setSent(false); setErr(null); } }, [open]);

  const send = async () => {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    setErr(null);
    try {
      const res = await window.hjen.submitSupport({
        kind,
        message,
        user: { name: PROFILE.name, email: PROFILE.email, plan: PROFILE.plan },
      });
      if (res.ok) {
        setSent(true);
        setText('');
      } else {
        setErr(res.reason || 'Could not send');
      }
    } catch (e: any) {
      setErr(e?.message || 'Could not send');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="topbar-menu" ref={ref}>
      <button
        className={`topbar-link ${open ? 'topbar-link--on' : ''}`}
        onClick={() => setOpen(o => !o)}
        title="Support"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H8l-4 3V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" />
        </svg>
        Support
      </button>
      {open && (
        <div className="topbar-pop topbar-pop--support">
          {sent ? (
            <div className="support-sent">
              <div className="support-sent__check">✓</div>
              <div className="support-sent__title">Sent</div>
              <p className="support-sent__meta">Your {kind.toLowerCase()} is logged in your workspace. No email needed.</p>
              <button className="btn-primary" onClick={() => setOpen(false)}>Done</button>
            </div>
          ) : (
            <>
              <div className="support-kinds">
                {(['Feature request', 'Bug', 'Question'] as const).map(k => (
                  <button
                    key={k}
                    className={`support-kind ${kind === k ? 'support-kind--on' : ''}`}
                    onClick={() => setKind(k)}
                  >{k}</button>
                ))}
              </div>
              <textarea
                className="support-text"
                placeholder="What can we help with?"
                value={text}
                onChange={e => setText(e.target.value)}
                rows={4}
              />
              {err && <div className="support-err">{err}</div>}
              <div className="support-foot">
                <span className="support-foot__meta mono-label">Sent straight to HJEN — no email</span>
                <button className="btn-primary" onClick={send} disabled={!text.trim() || sending}>
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Account ────────────────────────────────────────────────────────── */

// undefined = still loading · null = signed out / unreachable · object = live.
type WebAccountState = WebAccount | null | undefined;

/** The signed-in account + live credit, sourced from the gateway server —
 *  the same path on BOTH desktop (Electron on a gateway) and web. The account
 *  lives on the gateway, so the gate is "a gateway is configured", not the
 *  host. When no gateway is set (desktop on its own API keys) the hook stays
 *  inert (hasGateway=false) and the menu renders its local-workspace form. */
function useGatewayAccount(open: boolean) {
  // undefined = gateway status not yet known · false/true once resolved.
  const [hasGateway, setHasGateway] = useState<boolean | undefined>(undefined);
  const [account, setAccount] = useState<WebAccountState>(undefined);

  const refresh = useCallback(async () => {
    try {
      const g = await window.hjen?.getGateway?.();
      const url = g?.url?.replace(/\/$/, '');
      const token = g?.token;
      if (!url || !token) { setHasGateway(false); setAccount(null); return; }
      setHasGateway(true);
      const res = await fetch(`${url}/api/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as WebAccount;
      setAccount(data && data.ok ? data : null);
    } catch {
      // Transient network/parse error — keep last-good so the chip doesn't blink.
      setAccount(prev => (prev === undefined ? null : prev));
    }
  }, []);

  // Mount + 10s poll while the app is live.
  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 10_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  // Freshen the moment the menu opens.
  useEffect(() => { if (open) refresh(); }, [open, refresh]);

  return { hasGateway: !!hasGateway, account, refresh };
}

/** The credit token — a struck coin with the HJEN gem as its face. Keeps the
 *  ◆ the chip has always carried, but reads as currency at 12px, which a bare
 *  diamond never did. Mono-line so it sits in the same icon language as the
 *  rest of the top bar. */
const COIN = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
    <circle cx="12" cy="12" r="8.4" stroke="currentColor" strokeWidth="2" />
    <path d="M12 6.9l3 5.1-3 5.1-3-5.1z" fill="currentColor" />
  </svg>
);

export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const setActiveView = useStore(s => s.setActiveView);
  const { hasGateway, account, refresh } = useGatewayAccount(open);

  // Modal open-state — kept local; the modals mount as fixed overlays so they
  // outlive the dropdown (which closes on outside click).
  const [profileOpen, setProfileOpen] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [pricingTab, setPricingTab] = useState<PricingTab>('plan');

  // Payment return — Moyasar redirects back into the studio with
  // ?checkout=success|failed|cancelled. Every outcome shows a clear message; on
  // success we refresh the account (new plan + credits). Strip the flag after so
  // a later refresh doesn't re-open the modal.
  const [resultOpen, setResultOpen] = useState(false);
  const [resultStatus, setResultStatus] = useState<BillingStatus>('success');
  const [resultPlan, setResultPlan] = useState<string | undefined>(undefined);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const c = params.get('checkout');
    if (c !== 'success' && c !== 'failed' && c !== 'cancelled') return;
    setResultStatus(c);
    setResultPlan(params.get('plan') || undefined);
    setResultOpen(true);
    if (c === 'success') void refresh();
    params.delete('checkout'); params.delete('plan');
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = (v: 'usage' | 'pricing') => { setActiveView(v); setOpen(false); };
  const settings = () => { setActiveView('settings'); setOpen(false); };
  const openPricing = (tab: PricingTab) => { setPricingTab(tab); setPricingOpen(true); setOpen(false); };
  const openProfile = () => { setProfileOpen(true); setOpen(false); };
  const signOut = () => { window.hjen?.webSignOut?.(); };
  // Sign out is a web-session concept; on desktop-on-gateway the gateway is
  // managed in Settings, so the row appears only when the host exposes it.
  const canSignOut = !!window.hjen?.webSignOut;

  // Identity shown in trigger + header. Without a gateway the menu keeps the
  // local-workspace stand-in; on a gateway it shows the real account (or a
  // graceful placeholder while it resolves).
  const signedIn = hasGateway && !!account;
  const name = signedIn ? account!.name : PROFILE.name;
  const plan = signedIn ? account!.plan : PROFILE.plan;
  const email = signedIn ? account!.email : PROFILE.email;
  const remaining = signedIn ? account!.remaining : null;
  const genLimit = signedIn ? account!.genLimit : 0;
  const avatarUrl = signedIn ? account!.avatar || null : null;
  const avatarStyle = avatarUrl ? { backgroundImage: `url(${avatarUrl})`, backgroundSize: 'cover' as const } : undefined;
  const creditPct = genLimit > 0 && remaining !== null
    ? Math.max(0, Math.min(100, Math.round((remaining / genLimit) * 100)))
    : 0;

  return (
    <div className="topbar-menu" ref={ref}>
      {/* Credit chip — gateway accounts only, readable at a glance without
          opening the menu, and a one-click route to the top-up tab: the moment
          the number worries you is the moment you want to add credit, so the
          number itself is the door. */}
      {hasGateway && (
        remaining !== null ? (
          <button
            type="button"
            className="account-credit"
            onClick={() => openPricing('topup')}
            title={`${remaining} of ${account!.genLimit} credits left · ${account!.daysLeft}d — click to top up`}
          >
            <span className="account-credit__coin" aria-hidden>{COIN}</span>
            <span className="account-credit__n">{remaining}</span>
            <span className="account-credit__unit">left</span>
          </button>
        ) : (
          <button
            type="button"
            className="account-credit account-credit--idle"
            onClick={() => openPricing('topup')}
            title="Credits — click to top up"
          >
            <span className="account-credit__coin" aria-hidden>{COIN}</span>
            <span className="account-credit__unit">—</span>
          </button>
        )
      )}

      <button
        className={`account-trigger ${open ? 'account-trigger--on' : ''}`}
        onClick={() => setOpen(o => !o)}
        title="Account"
      >
        <span className="account-avatar" style={avatarStyle} aria-hidden />
        <span className="account-trigger__name">{name}</span>
        <span className="account-badge">{plan}</span>
        <svg className="account-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="topbar-pop topbar-pop--account">
          <div className="account-head">
            <span className="account-avatar account-avatar--lg" style={avatarStyle} aria-hidden />
            <div className="account-head__id">
              <div className="account-head__name">
                {name}
                <span className="account-badge account-badge--head">{plan}</span>
              </div>
              <div className="account-head__email">{email}</div>
            </div>
          </div>

          {hasGateway ? (
            <>
              {/* Credits — the WHOLE block is clickable → opens the plan tab. */}
              <button
                type="button"
                className="account-credits"
                role="button"
                onClick={() => openPricing('plan')}
                title="View plans & credits"
              >
                <div className="account-credits__row">
                  <span className="account-credits__label mono-label">Credits</span>
                  {signedIn ? (
                    <span className="account-credits__count">
                      <b>{remaining}</b> left
                    </span>
                  ) : (
                    <span className="account-credits__count account-credits__count--idle">Checking…</span>
                  )}
                  <svg className="account-credits__chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>
                <div className="account-credits__bar" aria-hidden>
                  <span className="account-credits__fill" style={{ width: `${creditPct}%` }} />
                </div>
                {signedIn && (
                  <div className="account-credits__meta">{remaining} of {genLimit} · resets in {account!.daysLeft}d</div>
                )}
              </button>

              {/* Primary CTA — the obvious, clearly-labeled way to plans. */}
              <button className="account-item account-item--upgrade" onClick={() => openPricing('plan')}>
                <AcctIcon d="M12 3 4 10h5v8h6v-8h5z" />
                <span>Upgrade plan</span>
                <span className="account-item__cta">Plans</span>
              </button>

              {/* Quick offers — each opens pricing to its tab. */}
              <button className="account-offer" onClick={() => openPricing('topup')}>
                <AcctIcon d="M12 5v14 M5 12h14" />
                <span className="account-offer__label">Top-up credits</span>
                <span className="account-offer__get">Get</span>
              </button>
              <button className="account-offer" onClick={() => openPricing('topup')}>
                <AcctIcon d="M13 2 3 14h7l-1 8 10-12h-7z" />
                <span className="account-offer__label">Boost speed</span>
                <span className="account-offer__get">Get</span>
              </button>
              <button className="account-offer" onClick={() => openPricing('unlimited')}>
                <AcctIcon d="M18.178 8c5.096 0 5.096 8 0 8-5.095 0-7.133-8-12.739-8-4.585 0-4.585 8 0 8 5.606 0 7.644-8 12.74-8z" />
                <span className="account-offer__label">Unlimited models</span>
                <span className="account-offer__get">Get</span>
              </button>

              <div className="account-sep" />

              <button className="account-item" onClick={openProfile}>
                <AcctIcon d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
                <span>View profile</span>
              </button>
              <button className="account-item" onClick={settings}>
                <AcctIcon d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                <span>Manage account</span>
              </button>
              {canSignOut && (
                <button className="account-item account-item--signout" onClick={signOut}>
                  <AcctIcon d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9" />
                  <span>Sign out</span>
                </button>
              )}
            </>
          ) : (
            /* Local workspace (no gateway) — unchanged from the original menu. */
            <>
              <div className="account-sep" />
              <button className="account-item" onClick={() => go('usage')}>
                <AcctIcon d="M3 3v18h18 M7 14l3-3 3 3 4-5" />
                <span>Usage</span>
              </button>
              <button className="account-item" onClick={() => go('pricing')}>
                <AcctIcon d="M3 10h18 M6 15h4 M5 6h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z" />
                <span>Billing</span>
              </button>
              <button className="account-item" onClick={settings}>
                <AcctIcon d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                <span>Settings</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* Overlays — mounted outside the dropdown so they survive its dismissal. */}
      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
      <PricingModal open={pricingOpen} onClose={() => setPricingOpen(false)} initialTab={pricingTab} />
      <BillingResultModal
        open={resultOpen}
        onClose={() => setResultOpen(false)}
        status={resultStatus}
        plan={resultPlan || account?.plan}
        credits={account?.genLimit}
        onRetry={() => { setPricingTab('plan'); setPricingOpen(true); }}
      />
    </div>
  );
}

function AcctIcon({ d }: { d: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}
