import { useEffect, useRef, useState } from 'react';

/* ────────────────────────────────────────────────────────────────────────
 *  Sync — cloud-first mirror. The server is the source of truth; this pulls
 *  the signed-in account's deliverables down into a folder on this Mac and
 *  keeps it in sync, account-isolated. Desktop only — on web the files
 *  already live in the cloud (browsed via Files), so the section is hidden.
 *
 *  Drives the already-built PULL engine over window.hjen.sync* — this file
 *  is only the UI. Reuses the shared Settings row/section/button/segmented
 *  vocabulary; it invents no parallel style system.
 * ──────────────────────────────────────────────────────────────────────── */

interface SyncConfig { enabled: boolean; root: string }
type LastSync = { downloaded: number; deleted: number } | null;

/** "3 new · 1 removed" / "3 new" / "already up to date" — a compact tally. */
function tally(downloaded: number, deleted: number): string {
  const parts: string[] = [];
  if (downloaded) parts.push(`${downloaded} new`);
  if (deleted) parts.push(`${deleted} removed`);
  return parts.length ? parts.join(' · ') : 'already up to date';
}

export function SyncSettings() {
  const [cfg, setCfg] = useState<SyncConfig | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [lastSync, setLastSync] = useState<LastSync>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    void window.hjen.syncGetConfig().then(c => { if (alive.current) setCfg(c); });
    // Passive "last synced" line — fires after every pull the engine runs.
    const off = window.hjen.onSyncProgress(d => {
      if (alive.current) setLastSync({ downloaded: d.downloaded, deleted: d.deleted });
    });
    return () => { alive.current = false; off(); };
  }, []);

  if (!cfg) return (
    <>
      <h1 className="settings-page__h1">Sync</h1>
      <p className="settings-page__lede">Loading…</p>
    </>
  );

  const hasFolder = !!cfg.root;

  const pickFolder = async () => {
    const res = await window.hjen.syncPickFolder();
    if (!alive.current || res.cancelled || !res.ok || !res.config) return;
    setCfg(res.config);
    setStatus(null);
  };

  const setEnabled = async (enabled: boolean) => {
    if (!hasFolder || enabled === cfg.enabled) return;
    const next = await window.hjen.syncSetEnabled(enabled);
    if (alive.current) setCfg(next);
  };

  const syncNow = async () => {
    if (syncing || !hasFolder) return;
    setSyncing(true);
    setStatus(null);
    try {
      const r = await window.hjen.syncPullNow();
      if (!alive.current) return;
      if (r.ok) setStatus({ ok: true, text: `Synced · ${tally(r.downloaded ?? 0, r.deleted ?? 0)}` });
      else setStatus({ ok: false, text: r.message || 'Could not sync. Try again.' });
    } catch {
      if (alive.current) setStatus({ ok: false, text: 'Could not sync. Try again.' });
    } finally {
      if (alive.current) setSyncing(false);
    }
  };

  return (
    <>
      <h1 className="settings-page__h1">Sync</h1>
      <p className="settings-page__lede">
        The cloud is the source of truth. Sync mirrors your account's makes into a folder on this
        Mac and keeps it in step — account-isolated, so only your files land here.
      </p>

      {/* ── Folder ─────────────────────────────────────────────────────── */}
      <div className="settings-section__label">HJEN Studio folder</div>
      <div className="setting-row">
        <input
          className="setting-input"
          value={cfg.root || ''}
          readOnly
          placeholder="Not set yet"
          spellCheck={false}
        />
        <button className="btn-primary" onClick={pickFolder}>
          {hasFolder ? 'Change folder…' : 'Choose folder…'}
        </button>
      </div>
      <div className="setting-meta">
        {hasFolder
          ? 'Your account’s deliverables are mirrored into this folder and refreshed automatically.'
          : 'Pick a folder to mirror your account’s deliverables onto this Mac. The first sync starts right away.'}
      </div>

      {/* ── Enable ─────────────────────────────────────────────────────── */}
      <div className="settings-section__label">Keep in sync</div>
      <div
        className={`segmented${hasFolder ? '' : ' segmented--off'}`}
        role="radiogroup"
        aria-label="Keep in sync"
      >
        {[{ v: true, l: 'On' }, { v: false, l: 'Off' }].map(o => (
          <button
            key={o.l}
            role="radio"
            aria-checked={cfg.enabled === o.v}
            disabled={!hasFolder}
            className={`segmented__opt${cfg.enabled === o.v ? ' segmented__opt--on' : ''}`}
            onClick={() => setEnabled(o.v)}
          >{o.l}</button>
        ))}
      </div>
      <div className="setting-meta">
        {!hasFolder
          ? 'Choose a folder first to turn syncing on.'
          : cfg.enabled
            ? 'Syncing is on — new makes flow down as they land on the server.'
            : 'Syncing is off. Your folder keeps what it has; nothing new is pulled until you turn it back on.'}
      </div>

      {/* ── Sync now ───────────────────────────────────────────────────── */}
      <div className="settings-section__label">Sync now</div>
      <div className="setting-row">
        <button
          className="btn-primary"
          onClick={syncNow}
          disabled={!hasFolder || syncing}
        >{syncing ? 'Syncing…' : 'Sync now'}</button>
      </div>
      {status && (
        <div className={status.ok ? 'setting-saved' : 'setting-error-line'}>{status.text}</div>
      )}
      {lastSync && !status && (
        <div className="setting-meta">Last synced · {tally(lastSync.downloaded, lastSync.deleted)}</div>
      )}

      <div className="setting-footnote mono-label">
        Files live under the folder you chose, one account per folder. Sync only ever pulls from the
        cloud — it never uploads or changes what is on the server.
      </div>
    </>
  );
}
