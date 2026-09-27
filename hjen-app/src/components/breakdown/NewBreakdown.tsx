import { useCallback, useState } from 'react';

// NEW BREAKDOWN — the entry. Paste an ad link OR choose/drop a local video, name
// it (optional — pulled from the source otherwise), and start the run. House
// vocabulary: MAKE, never "generate".

export interface NewBreakdownInput { url?: string; filePath?: string; brand?: string; title?: string }

const VIDEO_EXT = /\.(mp4|mov|webm|mkv|m4v|avi)$/i;

export function NewBreakdown({ onStart, onBack }: { onStart: (i: NewBreakdownInput) => void; onBack: () => void }) {
  const [url, setUrl] = useState('');
  const [filePath, setFilePath] = useState('');
  const [brand, setBrand] = useState('');
  const [title, setTitle] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const fileName = filePath ? filePath.split('/').pop() || filePath : '';
  const ready = !!url.trim() || !!filePath;

  const choose = useCallback(async () => {
    const p = await window.hjen.pickVideoFile();
    if (p) { setFilePath(p); setUrl(''); }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    const p = window.hjen.pathForFile(f);
    if (p && VIDEO_EXT.test(p)) { setFilePath(p); setUrl(''); }
  }, []);

  const start = () => {
    if (!ready) return;
    const u = url.trim();
    // a pasted absolute path / file:// URL is a local file, not a download
    const asLocal = filePath || (/^(\/|file:\/\/)/.test(u) ? u.replace(/^file:\/\//, '') : '');
    onStart({
      url: asLocal ? undefined : u,
      filePath: asLocal || undefined,
      brand: brand.trim() || undefined,
      title: title.trim() || undefined,
    });
  };

  return (
    <div className="bd-new">
      <div className="bd-new__inner">
        <div className="bd-new__head">
          <div className="bd-eyebrow">REVERSE-READ · تشريح الإعلان</div>
          <h1>New breakdown</h1>
          <div className="bd-desc">
            Point at a world-class ad. BREAKDOWN reads it back as if HJEN had <b>MADE</b> it — one
            MAKE prompt per craft axis, and the full pre-production package it would have taken to the client.
          </div>
        </div>

        {/* source — link */}
        <label className="bd-field">
          <span className="mono-label">AD LINK</span>
          <input
            className="bd-input" type="text" inputMode="url" spellCheck={false}
            placeholder="Paste a YouTube / Vimeo / ad URL"
            value={url}
            onChange={e => { setUrl(e.target.value); if (e.target.value) setFilePath(''); }}
            onKeyDown={e => { if (e.key === 'Enter' && ready) start(); }}
          />
        </label>

        <div className="bd-new__or"><span>OR</span></div>

        {/* source — local file / drop */}
        <div
          className={`bd-drop${dragOver ? ' is-over' : ''}${filePath ? ' is-set' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={choose}
          role="button" tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
            <rect x="3" y="4" width="18" height="14" rx="2" /><path d="M10 9l5 3-5 3z" />
          </svg>
          {filePath
            ? <span className="bd-drop__name selectable">{fileName}</span>
            : <span className="bd-drop__hint">Drop a video here, or <b>choose a file</b></span>}
        </div>

        {/* naming (optional) */}
        <div className="bd-new__two">
          <label className="bd-field">
            <span className="mono-label">BRAND <i>optional</i></span>
            <input className="bd-input" type="text" placeholder="e.g. Nike" value={brand} onChange={e => setBrand(e.target.value)} />
          </label>
          <label className="bd-field">
            <span className="mono-label">TITLE <i>optional</i></span>
            <input className="bd-input" type="text" placeholder="pulled from the source if left blank" value={title} onChange={e => setTitle(e.target.value)} />
          </label>
        </div>

        <div className="bd-new__actions">
          <button className="bd-actbtn ghost" onClick={onBack}>‹ BACK</button>
          <button className="bd-actbtn primary" onClick={start} disabled={!ready}>MAKE THE BREAKDOWN →</button>
        </div>
        <div className="bd-new__note">
          Runs locally on this machine — frames, audio and captions never leave it except the analysis calls to the model you set in <b>Settings → Models</b>.
        </div>
      </div>
    </div>
  );
}
