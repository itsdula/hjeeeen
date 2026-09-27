import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store';
import type { HjenClipperPrefs, HjenClipperStatus, HjenClipperTarget } from '../../types/hjen-bridge';

/** "2 minutes ago" / "yesterday" — a browser list is only useful if you can
 *  tell at a glance which one you still actually use. */
function ago(iso: string): string {
  const ms = Date.now() - Date.parse(iso || '');
  if (!isFinite(ms) || ms < 0) return 'just now';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/* ────────────────────────────────────────────────────────────────────────
 *  Browser — the clipper door. HJEN Studio opens a small door on this Mac
 *  (127.0.0.1) that the HJEN Clipper browser extension posts through: any
 *  image or GIF the user finds while browsing lands in a project's
 *  References, annotated with the page it came from.
 *
 *  THE APP OWNS THE BEHAVIOUR. Which save methods are live is decided here,
 *  not in the extension — the browser side asks the door what it may do on
 *  every ping. One place to change it, and it survives a reinstall of the
 *  extension or a second browser.
 *
 *  Desktop only — the door is a localhost server, and on web the browser
 *  already IS the app. Reuses the shared Settings row/section/button
 *  vocabulary; it invents no parallel style system.
 * ──────────────────────────────────────────────────────────────────────── */

/** The three builds one source produces. Labelled by the browsers a user
 *  actually names, not by the folder they live in. */
const DOWNLOADS: Array<{ target: HjenClipperTarget; label: string }> = [
  { target: 'chrome', label: 'Chrome · Edge · Arc · Brave' },
  { target: 'firefox', label: 'Firefox' },
  { target: 'safari', label: 'Safari' },
];

const METHODS: Array<{ key: keyof HjenClipperPrefs; label: string; meta: string }> = [
  { key: 'contextMenu', label: 'Right-click menu', meta: 'Save to HJEN Studio appears on any image, with a submenu of your projects.' },
  { key: 'hoverBadge', label: 'Hover badge', meta: 'A Save badge appears in the corner of an image while the cursor is on it.' },
  { key: 'shortcut', label: 'Keyboard shortcut', meta: 'Alt+Shift+S saves whatever image is under the cursor.' },
  { key: 'notify', label: 'System notification', meta: 'A macOS notification per save. The in-page confirmation always shows.' },
];

export function BrowserSettings() {
  const projects = useStore(s => s.projects);
  const [st, setSt] = useState<HjenClipperStatus | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState<HjenClipperTarget | null>(null);
  const [dl, setDl] = useState<{ ok: boolean; text: string } | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    void window.hjen.clipperStatus().then(s => { if (alive.current) setSt(s); });
    return () => { alive.current = false; };
  }, []);

  if (!st) return (
    <>
      <h1 className="settings-page__h1">Browser</h1>
      <p className="settings-page__lede">Loading…</p>
    </>
  );

  const prefs = st.prefs;
  const setPrefs = async (patch: Partial<HjenClipperPrefs>) => {
    const next = await window.hjen.clipperSetPrefs(patch);
    if (alive.current) setSt(next);
  };

  const signOut = async (id: string, label: string) => {
    const next = await window.hjen.clipperRevoke({ id });
    if (!alive.current) return;
    setSt(next);
    setNote(`${label} signed out.`);
  };

  const signOutAll = async () => {
    if (!confirmAll) { setConfirmAll(true); return; }
    const next = await window.hjen.clipperRevokeAll();
    if (!alive.current) return;
    setSt(next);
    setConfirmAll(false);
    setNote('Every browser signed out.');
  };

  const download = async (target: HjenClipperTarget, label: string) => {
    setBusy(target);
    setDl(null);
    const res = await window.hjen.clipperDownload({ target });
    if (!alive.current) return;
    setBusy(null);
    setDl(res.ok
      ? { ok: true, text: `${label} — saved to Downloads as ${res.path?.split('/').pop()}` }
      : { ok: false, text: res.error || 'The download could not be written.' });
  };

  const noMethod = !prefs.contextMenu && !prefs.hoverBadge && !prefs.shortcut;

  return (
    <>
      <h1 className="settings-page__h1">Browser</h1>
      <p className="settings-page__lede">
        Save any image or GIF you find while browsing straight into a project’s References. Install
        HJEN Clipper in your browser, sign it in with one click, then choose how you want to save —
        everything the extension does is switched on and off from this page.
      </p>

      {/* ── How to save ────────────────────────────────────────────────── */}
      <div className="settings-section__label">How to save</div>
      {METHODS.map(m => (
        <div key={m.key}>
          <div className="setting-row">
            <span style={{ flex: 1 }}>{m.label}</span>
            <div className="segmented" role="radiogroup" aria-label={m.label}>
              {[{ v: true, l: 'On' }, { v: false, l: 'Off' }].map(o => (
                <button
                  key={o.l}
                  role="radio"
                  aria-checked={prefs[m.key] === o.v}
                  className={`segmented__opt${prefs[m.key] === o.v ? ' segmented__opt--on' : ''}`}
                  onClick={() => void setPrefs({ [m.key]: o.v } as Partial<HjenClipperPrefs>)}
                >{o.l}</button>
              ))}
            </div>
          </div>
          <div className="setting-meta">{m.meta}</div>
        </div>
      ))}
      {noMethod && (
        <div className="setting-error-line">
          Every save method is off — the extension is installed but has no way to save anything.
        </div>
      )}

      {/* ── Where it lands ─────────────────────────────────────────────── */}
      <div className="settings-section__label">Where clips land</div>
      <div className="setting-row">
        <select
          className="setting-input"
          value={projects.some(p => p.id === prefs.projectId) ? prefs.projectId : ''}
          onChange={e => void setPrefs({ projectId: e.target.value })}
        >
          <option value="">The project you have open</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="setting-meta">
        Pin a project and every clip goes there whatever you have open. The right-click submenu can
        still send one clip somewhere else without changing this.
      </div>

      <div className="settings-section__label">Smallest image the badge appears on</div>
      <div className="setting-row">
        <input
          className="setting-input"
          type="number"
          min={60}
          max={1200}
          step={20}
          value={prefs.minSize}
          onChange={e => void setPrefs({ minSize: Number(e.target.value) || 200 })}
        />
        <span className="setting-meta" style={{ margin: 0 }}>px</span>
      </div>
      <div className="setting-meta">
        Icons, avatars and spacers stay out of the way. The right-click menu still works on anything.
      </div>

      {/* ── Door ───────────────────────────────────────────────────────── */}
      <div className="settings-section__label">Door</div>
      <div className="setting-row">
        <input className="setting-input" value={st.running ? st.url : 'Not running'} readOnly spellCheck={false} />
      </div>
      <div className="setting-meta">
        {st.running
          ? 'The door listens on this Mac only. Nothing is exposed to the network, and no image leaves your machine.'
          : 'The door could not bind a port. Restart HJEN Studio; if it persists, another app is holding 47615–47624.'}
      </div>

      {/* ── Signed-in browsers ─────────────────────────────────────────── */}
      <div className="settings-section__label">Signed-in browsers</div>
      {st.browsers.length === 0 ? (
        <div className="setting-meta">
          No browser is signed in yet. Install HJEN Clipper, click <strong>Sign in to HJEN Studio</strong>
          {' '}inside it, and approve the request that appears here. There is nothing to copy or paste.
        </div>
      ) : (
        st.browsers.map(b => (
          <div key={b.id}>
            <div className="setting-row">
              <span style={{ flex: 1 }}>{b.browser}</span>
              <button className="btn-ghost" onClick={() => void signOut(b.id, b.browser)}>Sign out</button>
            </div>
            <div className="setting-meta">Last save {ago(b.lastUsedAt)} · signed in {ago(b.createdAt)}</div>
          </div>
        ))
      )}
      {st.browsers.length > 1 && (
        <div className="setting-row">
          <button className="btn-ghost" onClick={signOutAll}>
            {confirmAll ? 'Confirm — sign every browser out' : 'Sign out everywhere…'}
          </button>
          {confirmAll && <button className="btn-ghost" onClick={() => setConfirmAll(false)}>Cancel</button>}
        </div>
      )}
      <div className="setting-meta">
        Each browser holds its own key, granted by that Allow dialog and never shown to anyone. Signing
        one out leaves the others working.
      </div>
      {note && <div className="setting-saved">{note}</div>}

      {/* ── Download ───────────────────────────────────────────────────── */}
      <div className="settings-section__label">Download HJEN Clipper</div>
      <div className="setting-meta">
        Pick your browser. A .zip lands in Downloads with the install steps inside it — unzip it
        anywhere, on this Mac or another one.
      </div>
      <div className="setting-row" style={{ flexWrap: 'wrap' }}>
        {DOWNLOADS.map(d => (
          <button
            key={d.target}
            className={d.target === 'chrome' ? 'btn-primary' : 'btn-ghost'}
            disabled={busy !== null}
            onClick={() => void download(d.target, d.label)}
          >
            {busy === d.target ? 'Packing…' : d.label}
          </button>
        ))}
      </div>
      {dl && <div className={dl.ok ? 'setting-saved' : 'setting-error-line'}>{dl.text}</div>}

      {/* ── Install ────────────────────────────────────────────────────── */}
      <div className="settings-section__label">Then install it</div>
      <ol className="setting-meta" style={{ paddingInlineStart: '1.2em', lineHeight: 1.9 }}>
        <li><strong>Chrome · Edge · Arc · Brave</strong> — open <code>chrome://extensions</code>, turn on Developer mode, Load unpacked → the unzipped folder.</li>
        <li><strong>Firefox</strong> — open <code>about:debugging</code> → This Firefox → Load Temporary Add-on → <code>manifest.json</code> inside it, then grant browsing access when asked.</li>
        <li><strong>Safari</strong> — needs a one-time Xcode conversion. The steps are in <code>SAFARI.md</code> inside the download.</li>
        <li>Open the extension, click <strong>Sign in to HJEN Studio</strong>, and approve the request that appears here.</li>
      </ol>
      <div className="setting-row">
        <input className="setting-input" value={st.extensionDir} readOnly spellCheck={false} />
        <button className="btn-ghost" onClick={() => void window.hjen.revealInFinder(st.extensionDir)}>
          Show folder
        </button>
      </div>
      <div className="setting-meta">
        The same three builds also sit unzipped in that folder, rewritten every time HJEN Studio
        starts. Load one from there and it stays current with the app on its own — a download is a
        frozen copy of this version.
      </div>

      <div className="setting-footnote mono-label">
        Clipped frames land in that project’s References with the page they came from attached. Every
        one arrives without a Why or Leave line on purpose — a clipped frame is a candidate, not a
        signed reference.
      </div>
    </>
  );
}
