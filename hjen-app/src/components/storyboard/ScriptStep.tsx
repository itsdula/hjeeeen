import { useState } from 'react';
import { useStoryboard } from '../../store/storyboardStore';
import type { StoryboardClient } from '../../types/storyboard';

function fileUrl(p?: string): string | undefined { return p ? `hjen-file://${encodeURI(p)}` : undefined; }
async function pickOneImage(): Promise<string | null> {
  const files = await window.hjen.pickImageFiles();
  return files && files.length ? files[0] : null;
}

/** Step 1 — paste the script + set project/client identity (for the PDF). */
export function ScriptStep() {
  const data = useStoryboard(s => s.data);
  const patch = useStoryboard(s => s.patch);
  const setStep = useStoryboard(s => s.setStep);
  if (!data) return null;

  const words = data.scriptText.trim() ? data.scriptText.trim().split(/\s+/).length : 0;
  const client = data.client ?? {};
  const setClient = (p: Partial<StoryboardClient>) => patch({ client: { ...client, ...p } });

  const [loadNote, setLoadNote] = useState<string | null>(null);
  const loadFromFile = async () => {
    setLoadNote(null);
    const res = await window.hjen.pickTextDocument?.({ title: 'Load script from file' });
    if (!res) return;
    if (res.unsupported || !res.text.trim()) {
      setLoadNote(`Can't read "${res.name}" as text — export it to .txt / .fountain / .md, or paste it below.`);
      return;
    }
    // Replace an empty field; append (never wipe) if the user already has script.
    const next = data.scriptText.trim() ? `${data.scriptText.trimEnd()}\n\n${res.text}` : res.text;
    const p: { scriptText: string; title?: string } = { scriptText: next };
    if (!data.title?.trim()) p.title = res.name.replace(/\.[^.]+$/, '');
    patch(p);
    setLoadNote(`Loaded "${res.name}".`);
  };

  return (
    <div className="sb-step sb-script">
      <div className="sb-field">
        <div className="sb-field__head"><label className="sb-field__label mono-label">Title (optional)</label></div>
        <input className="sb-input" type="text" value={data.title ?? ''} onChange={e => patch({ title: e.target.value })} placeholder="Working title for the board…" />
      </div>

      {/* project + client identity → PDF */}
      <details className="sb-client" open={false}>
        <summary className="sb-client__summary">
          <span className="mono-label">Project & client</span>
          <small>Names + logos placed on the exported PDF cover.</small>
        </summary>
        <div className="sb-client__grid">
          <label className="sb-set"><span className="mono-label">Client</span>
            <input className="sb-input" value={client.client ?? ''} onChange={e => setClient({ client: e.target.value })} placeholder="Saudia · SAR · NEOM…" /></label>
          <label className="sb-set"><span className="mono-label">Agency</span>
            <input className="sb-input" value={client.agency ?? ''} onChange={e => setClient({ agency: e.target.value })} placeholder="Agency name" /></label>
          <label className="sb-set"><span className="mono-label">Brand</span>
            <input className="sb-input" value={client.brand ?? ''} onChange={e => setClient({ brand: e.target.value })} placeholder="Brand / product" /></label>
        </div>
        <div className="sb-client__logos">
          <LogoSlot label="Client logo" path={client.clientLogoPath} onPick={p => setClient({ clientLogoPath: p })} onClear={() => setClient({ clientLogoPath: undefined })} />
          <LogoSlot label="Agency logo" path={client.agencyLogoPath} onPick={p => setClient({ agencyLogoPath: p })} onClear={() => setClient({ agencyLogoPath: undefined })} />
          <LogoSlot label="Brand logo" path={client.brandLogoPath} onPick={p => setClient({ brandLogoPath: p })} onClear={() => setClient({ brandLogoPath: undefined })} />
        </div>
      </details>

      <div className="sb-field sb-field--grow">
        <div className="sb-field__head">
          <label className="sb-field__label mono-label">Script</label>
          <span className="sb-field__hint">Paste the screenplay, the ad script, the treatment — anything with scenes and action.</span>
          <button className="btn-ghost sb-load-file" onClick={() => void loadFromFile()} title="Load a script file from your computer">↑ Upload file</button>
        </div>
        {loadNote && <div className="sb-load-note mono-label">{loadNote}</div>}
        <textarea
          className="sb-script__text"
          value={data.scriptText}
          onChange={e => patch({ scriptText: e.target.value })}
          placeholder={'INT. BEDROOM — NIGHT\n\nMUBARAK, 28, sits on the floor, a controller in his hands. The TV glow flickers on his face…'}
          spellCheck={false}
        />
        <div className="sb-script__foot">
          <span className="mono-label">{words} word{words === 1 ? '' : 's'}</span>
          <button className="btn-primary" disabled={!data.scriptText.trim()} onClick={() => setStep(2)}>Break it down →</button>
        </div>
      </div>
    </div>
  );
}

function LogoSlot({ label, path, onPick, onClear }: { label: string; path?: string; onPick: (p: string) => void; onClear: () => void }) {
  const attach = async () => { const p = await pickOneImage(); if (p) onPick(p); };
  return (
    <div className="sb-logo">
      <button className="sb-logo__thumb" onClick={attach} title={`Attach ${label}`}>
        {path ? <img src={fileUrl(path)} alt="" /> : <span className="sb-ref__plus">+</span>}
      </button>
      <span className="mono-label">{label}</span>
      {path && <button className="sb-ref__clear mono-label" onClick={onClear}>remove</button>}
    </div>
  );
}
