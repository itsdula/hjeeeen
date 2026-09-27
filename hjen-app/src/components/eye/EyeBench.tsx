// The Eye · Bench — الميزان. Phase 0 of the Eye rebuild.
//
// Drop ONE frame. The eye reads it on ten axes. You grade each axis ✓/✗ and
// correct the ones it got wrong. Corrections are signed into the golden set,
// which is simultaneously the few-shot corpus for the next EYE_READ_SYS and the
// regression suite for every version after it.
//
// WHY PER-AXIS. "The read was wrong" teaches nothing. "It nails light and lens
// but invents an inside state" is a fixable note — and it is the only way to
// know WHICH layer is failing before we run this over 8,745 frames.
//
// House law: dumb terminal. No prompt, no scoring, no validation here — all of
// it lives in electron/eye.ts. This file renders a read and records a verdict.

import { useEffect, useRef, useState } from 'react';
// contextagents.css carries the shared lab chrome (.ca-top / .ca-back / .ca-btn);
// the Eye is that family's next surface, so it inherits rather than re-declares.
import '../../styles/contextagents.css';
import '../../styles/eye.css';
import { useStore } from '../../store';
import { hjenFileUrl } from '../../lib/theme/apply';
import { eyeRead, eyeGoldenWrite, eyeStatus } from '../../lib/eye/engine';
import { EYE_AXES, type EyeRead, type EyeAxisKey, type AxisGrade, type EyeStatusResult } from '../../lib/eye/types';
import { MODEL_CATALOG } from '../../lib/models/registry';
// The same picker the Assistant, Camera Angles and Film Space use — GENERATIONS
// of any project (frames, storyboard takes, every logged make) plus the shared
// LIBRARY. The bench must grade the frames the studio actually produced, not
// only whatever happens to be loose on disk.
import { ProjectAssetPicker } from '../ProjectAssetPicker';

const LAYER_LABEL: Record<number, { name: string; note: string }> = {
  1: { name: 'What is in the frame', note: 'denotation — the part search needs' },
  2: { name: 'The craft', note: 'what a gaffer, a DOP and a stylist read' },
  3: { name: "The director's eye", note: 'the axes that decide whether this is an eye — grade hardest' },
  4: { name: 'The search key', note: 'how this frame gets found again' },
};

/** Turn one axis of a read into displayable lines. The nested axes (light, lens,
 *  colour) are flattened here for reading, never for storage. */
function axisLines(read: EyeRead, key: EyeAxisKey): string[] {
  switch (key) {
    case 'objects':
      return read.objects.length ? [read.objects.join(' · ')] : [];
    case 'light':
      return [
        read.light.key && `key — ${read.light.key}`,
        read.light.fill && `fill — ${read.light.fill}`,
        read.light.accent && `accent — ${read.light.accent}`,
        read.light.kelvin && `kelvin — ${read.light.kelvin}`,
        read.light.state && `state — ${read.light.state}`,
      ].filter(Boolean) as string[];
    case 'lens':
      return [
        [read.lens.size, read.lens.angle, read.lens.height, read.lens.focal].filter(Boolean).join(' · '),
        read.lens.depth && `depth — ${read.lens.depth}`,
      ].filter(Boolean) as string[];
    case 'colour':
      return [
        [read.colour.dominant, read.colour.second, read.colour.accent].filter(Boolean).join(' / '),
        read.colour.behaviour,
      ].filter(Boolean) as string[];
    case 'searchPhrase':
      return [
        read.searchPhrase && `EN — ${read.searchPhrase}`,
        read.searchPhraseAr && `AR — ${read.searchPhraseAr}`,
        read.tags.length ? read.tags.join(' · ') : '',
      ].filter(Boolean) as string[];
    default:
      return [String(read[key as keyof EyeRead] ?? '')].filter(Boolean);
  }
}

export default function EyeBench() {
  const setActiveView = useStore(s => s.setActiveView);

  const [imagePath, setImagePath] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [model, setModel] = useState('');           // '' = the eye-read task default
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [read, setRead] = useState<EyeRead | null>(null);
  const [thin, setThin] = useState<EyeAxisKey[]>([]);
  const [meta, setMeta] = useState<{ model?: string; ms?: number; imageHash?: string } | null>(null);

  const [grades, setGrades] = useState<Partial<Record<EyeAxisKey, AxisGrade>>>({});
  const [corrections, setCorrections] = useState<Partial<Record<EyeAxisKey, string>>>({});
  const [signed, setSigned] = useState(false);

  const [status, setStatus] = useState<EyeStatusResult | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { void eyeStatus().then(setStatus); }, []);

  const reset = () => {
    setRead(null); setThin([]); setMeta(null);
    setGrades({}); setCorrections({}); setSigned(false); setError(null);
  };

  const loadImage = (p: string) => { setImagePath(p); reset(); };

  const pick = async () => {
    const paths = await window.hjen.pickImageFiles();
    if (paths && paths[0]) loadImage(paths[0]);
  };

  // One frame at a time on the bench — a read is graded axis by axis, so a
  // multi-pick would only throw away everything after the first.
  const pickFromProject = (paths: string[]) => {
    setPickerOpen(false);
    if (paths && paths.length) loadImage(paths[0]);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files?.[0] as (File & { path?: string }) | undefined;
    if (f?.path) loadImage(f.path);
  };

  const look = async () => {
    if (!imagePath || busy) return;
    setBusy(true); reset();
    const r = await eyeRead({ imagePath, note: note.trim(), model: model || undefined });
    setBusy(false);
    if (!r.ok || !r.read) { setError(r.message || r.reason || 'The eye could not look.'); return; }
    setRead(r.read); setThin(r.thin ?? []);
    setMeta({ model: r.model, ms: r.ms, imageHash: r.imageHash });
  };

  const grade = (key: EyeAxisKey, g: AxisGrade) => {
    setGrades(prev => (prev[key] === g ? { ...prev, [key]: undefined } : { ...prev, [key]: g }));
    setSigned(false);
  };

  const sign = async () => {
    if (!read || !imagePath) return;
    const clean: Partial<Record<EyeAxisKey, string>> = {};
    for (const [k, v] of Object.entries(corrections)) if (v && v.trim()) clean[k as EyeAxisKey] = v.trim();
    const r = await eyeGoldenWrite({
      imagePath, imageHash: meta?.imageHash ?? '', model: meta?.model ?? '',
      read, axisGrades: grades, corrections: clean, signedBy: 'anwar',
    });
    if (r.ok) { setSigned(true); void eyeStatus().then(setStatus); }
    else setError(r.message || 'Could not sign this read.');
  };

  const gradedCount = Object.values(grades).filter(Boolean).length;
  // The layer-3 axes are the ones that decide whether this is an eye at all.
  const L3: EyeAxisKey[] = ['inside', 'craftMove', 'culturalTruth', 'refusal'];
  const l3Ok = L3.filter(k => grades[k] === 'ok').length;

  return (
    <div className="eye">
      {/* ── chrome ─────────────────────────────────────────────────────────── */}
      <div className="ca-top">
        <button className="ca-back" onClick={() => setActiveView('apphub')}>← Programs</button>
        <div className="eye-title">
          <span className="eye-title__name">The Eye · Bench</span>
          <span className="eye-title__sub mono-label">read one frame · grade every axis · correct what it missed</span>
        </div>
        <span className="eye-golden mono-label" title="signed reads · graded axes">
          golden {status?.golden ?? 0} · axes {status?.gradedAxes ?? 0}
        </span>
      </div>

      <div className="eye-body">
        {/* ── left: the frame + the controls ──────────────────────────────── */}
        <div className="eye-left">
          <div
            ref={dropRef}
            className={`eye-drop${dragging ? ' is-over' : ''}${imagePath ? ' has-img' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => { if (!imagePath) void pick(); }}
          >
            {imagePath
              ? <img src={hjenFileUrl(imagePath)} alt="" />
              : (
                <div className="eye-drop__empty">
                  <p className="eye-drop__hd">Drop a frame here</p>
                  <p className="mono-label">or choose a file · or pull one from a project</p>
                </div>
              )}
          </div>

          {/* Two sources, always reachable: the disk, and everything the studio
           *  has already made. */}
          <div className="eye-src">
            <button className="ca-btn ca-btn--ghost" onClick={() => void pick()}>
              {imagePath ? 'Change frame' : 'Choose file'}
            </button>
            <button className="ca-btn ca-btn--ghost" onClick={() => setPickerOpen(true)}>
              From project
            </button>
          </div>

          {imagePath && (
            <p className="eye-srcline mono-label selectable" title={imagePath}>
              {imagePath.split('/').pop()}
            </p>
          )}

          <label className="eye-field">
            <span className="mono-label">context (optional)</span>
            <textarea
              value={note} onChange={e => setNote(e.target.value)} rows={2} dir="auto"
              placeholder="what you already know about this frame — sharpens the read, never overrides the pixels"
            />
          </label>

          <label className="eye-field">
            <span className="mono-label">model</span>
            <select value={model} onChange={e => setModel(e.target.value)}>
              <option value="">task default (Settings → Models)</option>
              {MODEL_CATALOG.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>

          <button className="ca-btn ca-btn--primary eye-look" onClick={() => void look()} disabled={!imagePath || busy}>
            {busy ? 'The eye is looking…' : 'Look'}
          </button>

          {meta && (
            <p className="eye-meta mono-label">
              {meta.model} · {meta.ms ? `${(meta.ms / 1000).toFixed(1)}s` : '—'}
              {thin.length > 0 && <span className="eye-meta__thin"> · {thin.length} thin {thin.length === 1 ? 'axis' : 'axes'}</span>}
            </p>
          )}
          {error && <p className="eye-error selectable">{error}</p>}
        </div>

        {/* ── right: the read, axis by axis ───────────────────────────────── */}
        <div className="eye-right">
          {!read && !busy && (
            <div className="eye-idle">
              <p className="eye-idle__lede">
                The eye reads one frame on fourteen axes — what is in it, how it was made, what is
                happening inside it, and how it gets found again.
              </p>
              <p className="eye-idle__note mono-label">
                Layers 1 and 2 are what any captioner gives you. Layer 3 — the inside state, the craft
                decision, the cultural truth and the refusal — is what makes it an eye. Grade those hardest.
              </p>
            </div>
          )}

          {read && [1, 2, 3, 4].map(layer => (
            <section key={layer} className={`eye-layer eye-layer--${layer}`}>
              <header className="eye-layer__head">
                <span className="eye-layer__name">{LAYER_LABEL[layer].name}</span>
                <span className="eye-layer__note mono-label">{LAYER_LABEL[layer].note}</span>
              </header>

              {EYE_AXES.filter(a => a.layer === layer).map(axis => {
                const key = axis.key as EyeAxisKey;
                const lines = axisLines(read, key);
                const isThin = thin.includes(key);
                const g = grades[key];
                return (
                  <article key={key} className={`eye-axis${isThin ? ' is-thin' : ''}${g ? ` is-${g}` : ''}`}>
                    <div className="eye-axis__head">
                      <div className="eye-axis__id">
                        <span className="eye-axis__name">{axis.en}</span>
                        <span className="eye-axis__hint mono-label">{axis.hint}</span>
                      </div>
                      {isThin && <span className="eye-axis__flag mono-label" title="the validator found this empty or evasive">thin</span>}
                      <div className="eye-axis__grade">
                        <button
                          className={`eye-g eye-g--ok${g === 'ok' ? ' is-on' : ''}`}
                          onClick={() => grade(key, 'ok')} aria-label={`${axis.en} is right`}
                        >✓</button>
                        <button
                          className={`eye-g eye-g--no${g === 'wrong' ? ' is-on' : ''}`}
                          onClick={() => grade(key, 'wrong')} aria-label={`${axis.en} is wrong`}
                        >✗</button>
                      </div>
                    </div>

                    {lines.length === 0
                      ? <p className="eye-axis__none mono-label">the eye said nothing here</p>
                      : lines.map((l, i) => <p key={i} className="eye-axis__line selectable" dir="auto">{l}</p>)}

                    {g === 'wrong' && (
                      <textarea
                        className="eye-axis__fix" dir="auto" rows={2}
                        value={corrections[key] ?? ''}
                        onChange={e => setCorrections(p => ({ ...p, [key]: e.target.value }))}
                        placeholder="what it should have said — your words become the next version's evidence"
                      />
                    )}
                  </article>
                );
              })}
            </section>
          ))}

          {read && (
            <div className="eye-sign">
              <div className="eye-sign__count mono-label">
                {gradedCount} of {EYE_AXES.length} axes graded · layer 3: {l3Ok}/4 right
              </div>
              <button className="ca-btn ca-btn--primary" onClick={() => void sign()} disabled={gradedCount === 0 || signed}>
                {signed ? 'signed ✓' : 'Sign into the golden set'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Pull a frame from any project's generations — or the shared library. */}
      {pickerOpen && <ProjectAssetPicker onClose={() => setPickerOpen(false)} onAttach={pickFromProject} />}
    </div>
  );
}
