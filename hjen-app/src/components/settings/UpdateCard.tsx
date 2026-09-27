import { useEffect, useRef, useState } from 'react';
import type { HjenUpdateCheck } from '../../types/hjen-bridge';

/* ────────────────────────────────────────────────────────────────────────
 *  Update — the button that asks.
 *
 *  HJEN Studio already checks on its own: at launch, every few hours while it
 *  stays open, and whenever you come back to the window. But someone who has
 *  just been told "that's fixed in the new version" wants to ASK, now, and be
 *  answered — and a silent updater is indistinguishable from a broken one.
 *
 *  It reports the version actually running, so "up to date" is something the
 *  user can check rather than a claim they have to believe.
 * ──────────────────────────────────────────────────────────────────────── */

export function UpdateCard() {
  const [res, setRes] = useState<HjenUpdateCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [percent, setPercent] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    // Ask once on open so the card always shows the running version, and follow
    // the background download if one is already in flight.
    void (async () => {
      const r = await window.hjen.checkForUpdates();
      if (alive.current) setRes(r);
    })();
    const offP = window.hjen.onUpdateProgress?.(d => { if (alive.current) setPercent(d?.percent || 0); });
    const offR = window.hjen.onUpdateReady?.(d => {
      if (alive.current) setRes(p => ({ ...(p as HjenUpdateCheck), state: 'ready', version: d?.version }));
    });
    return () => { alive.current = false; try { offP?.(); offR?.(); } catch { /* ignore */ } };
  }, []);

  const check = async () => {
    setBusy(true);
    const r = await window.hjen.checkForUpdates();
    if (!alive.current) return;
    setRes(r);
    setBusy(false);
  };

  const restart = async () => {
    setRestarting(true);
    try { await window.hjen.restartToUpdate(); } catch { setRestarting(false); }
  };

  const line = (): string => {
    if (busy) return 'Checking the release feed…';
    if (!res) return 'Checking…';
    switch (res.state) {
      case 'ready': return `Version ${res.version} is downloaded and ready. Restart to use it.`;
      case 'downloading': return `Version ${res.version} is downloading in the background${percent ? ` — ${percent}%` : ''}. You can keep working; it installs on restart.`;
      case 'available': return `Version ${res.version} is available and will download in the background.`;
      case 'current': return 'You are on the latest version.';
      case 'dev': return res.message || 'Development build.';
      case 'unsupported': return res.message || 'This build cannot update itself.';
      case 'error': return `Could not reach the release feed. ${res.message ?? ''}`;
      default: return '';
    }
  };

  const bad = res?.state === 'error' || res?.state === 'unsupported';

  return (
    <>
      <div className="settings-section__label">Update</div>
      <div className="setting-row">
        <span style={{ flex: 1 }}>
          HJEN Studio <span className="mono-label">{res?.current ? `v${res.current}` : ''}</span>
        </span>
        {res?.state === 'ready' ? (
          <button className="btn-primary" onClick={restart} disabled={restarting}>
            {restarting ? 'Restarting…' : 'Restart to update'}
          </button>
        ) : (
          <button className="btn-primary" onClick={check} disabled={busy}>
            {busy ? 'Checking…' : 'Check for updates'}
          </button>
        )}
      </div>
      <div className={bad ? 'setting-error-line' : res?.state === 'current' ? 'setting-saved' : 'setting-meta'}>
        {line()}
      </div>
      <div className="setting-meta">
        Updates download by themselves in the background — at launch, every few hours, and when you
        come back to the window. This button is for when you would rather not wait.
      </div>
    </>
  );
}
