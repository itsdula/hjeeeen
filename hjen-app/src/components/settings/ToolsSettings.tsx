import { useCallback, useEffect, useRef, useState } from 'react';
import type { HjenToolStatus } from '../../types/hjen-bridge';

/* ────────────────────────────────────────────────────────────────────────
 *  Tools — the programs HJEN Studio uses but does not ship.
 *
 *  Cuts, Ad Breakdown, Emulsion video and Transcription do their heavy work
 *  through ffmpeg, yt-dlp and whisper. Those are not part of the download, so
 *  a Mac that doesn't have them fails — and it used to fail as a raw
 *  `spawn yt-dlp ENOENT` in a status bar, which tells the user nothing.
 *
 *  This page is the answer to "does this machine have what it needs?" — one
 *  row per program, what it powers, and the command that installs it. Check
 *  again re-probes, so an install is picked up without restarting the app.
 *
 *  Desktop only: on the web the work happens on the server, which has its own.
 * ──────────────────────────────────────────────────────────────────────── */

export function ToolsSettings() {
  const [tools, setTools] = useState<HjenToolStatus[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const alive = useRef(true);

  const load = useCallback(async (recheck = false) => {
    setChecking(true);
    const res = recheck ? await window.hjen.toolsRecheck() : await window.hjen.toolsStatus();
    if (!alive.current) return;
    setTools(res.tools);
    setChecking(false);
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => { alive.current = false; };
  }, [load]);

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(text);
    setTimeout(() => { if (alive.current) setCopied(null); }, 1600);
  };

  if (!tools) return (
    <>
      <h1 className="settings-page__h1">Tools</h1>
      <p className="settings-page__lede">Checking this Mac…</p>
    </>
  );

  const missingRequired = tools.filter(t => t.required && !t.found);

  return (
    <>
      <h1 className="settings-page__h1">Tools</h1>
      <p className="settings-page__lede">
        Cuts, Ad Breakdown, Emulsion video and Transcription do their heavy work through separate
        programs. ffmpeg and yt-dlp now ship inside HJEN Studio, so there is nothing to install for
        those. The rest are optional — anything missing installs with one line in Terminal.
      </p>

      {missingRequired.length > 0 ? (
        <div className="setting-error-line">
          {missingRequired.length === 1
            ? `${missingRequired[0].label} is missing — the tools that need it will not run on this Mac.`
            : `${missingRequired.map(t => t.label).join(' and ')} are missing — the tools that need them will not run on this Mac.`}
        </div>
      ) : (
        <div className="setting-saved">Everything HJEN Studio needs is installed.</div>
      )}

      {tools.map(t => (
        <div key={t.id}>
          <div className="setting-row">
            <span style={{ flex: 1 }}>
              {t.label}
              {!t.required && <span className="setting-meta" style={{ margin: 0, marginInlineStart: 8 }}>optional</span>}
            </span>
            <span className={t.found ? 'setting-saved' : t.required ? 'setting-error-line' : 'setting-meta'} style={{ margin: 0 }}>
              {t.bundled ? 'Included' : t.found ? 'Installed' : t.required ? 'Missing' : 'Not installed'}
            </span>
          </div>
          <div className="setting-meta">
            {t.powers}.
            {t.bundled
              ? <> Ships inside HJEN Studio — nothing to install. <span className="mono-label">{t.version}</span></>
              : t.found
                ? <> <span className="mono-label">{t.version || t.path}</span></>
                : <> Install with <code>{t.install}</code></>}
          </div>
          {!t.found && (
            <div className="setting-row">
              <input className="setting-input" value={t.install} readOnly spellCheck={false} />
              <button className="btn-ghost" onClick={() => copy(t.install)}>
                {copied === t.install ? 'Copied' : 'Copy'}
              </button>
            </div>
          )}
        </div>
      ))}

      <div className="setting-row">
        <button className="btn-primary" onClick={() => void load(true)} disabled={checking}>
          {checking ? 'Checking…' : 'Check again'}
        </button>
      </div>

      <div className="setting-footnote mono-label">
        HJEN Studio looks in Homebrew’s folders and your own ~/.local/bin, whether the app was opened
        from the Dock or a terminal. Installing a program and pressing Check again is enough — there
        is no path to configure and no restart.
      </div>
    </>
  );
}
