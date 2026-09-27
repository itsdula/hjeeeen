import { useState, useEffect } from 'react';
import { useStoryboard } from '../../store/storyboardStore';
import type { StoryboardShot } from '../../types/storyboard';
import { SHOT_SIZES, ANGLES, MOVES, LENSES } from '../../lib/storyboardCamera';

const codeOf = (v?: string) => (v ?? '').split('(')[0].trim().toUpperCase();

function fileUrl(p?: string): string | undefined {
  return p ? `hjen-file://${encodeURI(p)}` : undefined;
}

async function pickOneImage(): Promise<string | null> {
  const files = await window.hjen.pickImageFiles();
  return files && files.length ? files[0] : null;
}

/** Step 2 — break the script into shots, lock the cast + places. */
export function BreakdownStep() {
  const data = useStoryboard(s => s.data);
  const setStep = useStoryboard(s => s.setStep);
  const addShot = useStoryboard(s => s.addShot);
  const reorderByDrag = useStoryboard(s => s.reorderByDrag);
  // Per-project, store-backed flags so progress survives navigation and one
  // project's run never disables another's button.
  const projectId = useStoryboard(s => s.projectId);
  const breakingDown = useStoryboard(s => !!projectId && s.breakingDownIds.includes(projectId));
  const findingCast = useStoryboard(s => !!projectId && s.findingCastIds.includes(projectId));
  const runBreakdownAction = useStoryboard(s => s.runBreakdown);
  const findCastAction = useStoryboard(s => s.findCast);
  const clearBreakdown = useStoryboard(s => s.clearBreakdown);
  const [err, setErr] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  if (!data) return null;

  const busy = breakingDown ? 'shots' : findingCast ? 'cast' : null;

  const runBreakdown = async () => {
    setErr(null);
    const r = await runBreakdownAction();
    if (!r.ok && r.message) setErr(r.message);
  };

  const runCast = async () => {
    setErr(null);
    const r = await findCastAction();
    if (!r.ok && r.message) setErr(r.message);
  };

  const onClear = () => {
    const n = data.shots.length + data.characters.length + data.places.length + data.elements.length;
    if (n === 0) return;
    if (window.confirm(`Clear the whole breakdown?\n\nThis erases all ${data.shots.length} shots and every cast member, place, and element on this page. The script is kept. This can’t be undone.`)) {
      clearBreakdown();
    }
  };

  return (
    <div className="sb-step sb-breakdown">
      <div className="sb-toolbar">
        <button className="btn-primary" onClick={runBreakdown} disabled={busy !== null || !data.scriptText.trim()}>
          {busy === 'shots' ? 'Breaking down…' : data.shots.length ? 'Re-break down with AI' : 'Break down with AI'}
        </button>
        <button className="sb-btn" onClick={runCast} disabled={busy !== null || !data.scriptText.trim()}>
          {busy === 'cast' ? 'Finding…' : 'Find cast & places'}
        </button>
        <button className="sb-btn" onClick={() => addShot()}>+ Add shot</button>
        <button className="sb-btn sb-btn--stop" onClick={onClear} disabled={busy !== null || (data.shots.length + data.characters.length + data.places.length + data.elements.length) === 0}>Clear</button>
        {err && <span className="sb-err">{err}</span>}
        <div className="sb-toolbar__spacer" />
        <span className="mono-label">{data.shots.length} shot{data.shots.length === 1 ? '' : 's'}</span>
        <button
          className="btn-primary"
          disabled={data.shots.length === 0}
          onClick={() => setStep(3)}
        >Approve → Make frames →</button>
      </div>

      <AiProgress kind={breakingDown ? 'breakdown' : findingCast ? 'cast' : null} />

      <div className="sb-breakdown__grid">
        {/* shots */}
        <div className="sb-shots">
          {data.shots.length === 0 ? (
            <div className="sb-empty">No shots yet. Break down the script, or add one by hand.</div>
          ) : (
            data.shots.map((shot, i) => (
              <ShotCard
                key={shot.id}
                shot={shot}
                index={i}
                total={data.shots.length}
                dragging={dragId === shot.id}
                onDragStart={() => setDragId(shot.id)}
                onDragEnd={() => setDragId(null)}
                onDropOn={() => { if (dragId) reorderByDrag(dragId, shot.id); setDragId(null); }}
              />
            ))
          )}
        </div>

        {/* refs sidebar */}
        <aside className="sb-refs">
          <RefGroup kind="characters" title="Cast" addLabel="+ Character" />
          <RefGroup kind="places" title="Places" addLabel="+ Place" />
          <RefGroup kind="elements" title="Continuity elements" addLabel="+ Element" />
        </aside>
      </div>

      <footer className="sb-foot">
        <button
          className="btn-primary"
          disabled={data.shots.length === 0}
          onClick={() => setStep(3)}
        >Approve → Make frames →</button>
      </footer>
    </div>
  );
}

// ─── shot card ────────────────────────────────────────────────────
function ShotCard({ shot, index, total, dragging, onDragStart, onDragEnd, onDropOn }: {
  shot: StoryboardShot; index: number; total: number;
  dragging: boolean; onDragStart: () => void; onDragEnd: () => void; onDropOn: () => void;
}) {
  const data = useStoryboard(s => s.data)!;
  const updateShot = useStoryboard(s => s.updateShot);
  const removeShot = useStoryboard(s => s.removeShot);
  const moveShot = useStoryboard(s => s.moveShot);
  const [open, setOpen] = useState(false);

  const toggleId = (field: 'characterIds' | 'placeIds' | 'elementIds', id: string) => {
    const cur = shot[field] ?? [];
    updateShot(shot.id, { [field]: cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id] } as Partial<StoryboardShot>);
  };

  return (
    <div
      className={`sb-shot ${dragging ? 'is-dragging' : ''}`}
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); onDropOn(); }}
    >
      <div className="sb-shot__head">
        <span
          className="sb-drag-handle"
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          title="Drag to reorder"
        >⠿</span>
        <span className="sb-shot__num mono-label" title="Frame number (order)">{String(index + 1).padStart(2, '0')}</span>
        <span className="sb-shot__id mono-label" title="Scene + panel">{shot.scene}{shot.letter}</span>
        <select
          className="sb-shot__sel"
          value={codeOf(shot.shot)}
          onChange={e => updateShot(shot.id, { shot: e.target.value })}
          title="Shot size — drives the framing"
        >
          <option value="">SHOT</option>
          {SHOT_SIZES.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
        </select>
        <select
          className="sb-shot__sel"
          value={codeOf(shot.angle)}
          onChange={e => updateShot(shot.id, { angle: e.target.value })}
          title="Camera angle — drives the framing"
        >
          <option value="">ANGLE</option>
          {ANGLES.map(a => <option key={a.code} value={a.code}>{a.label}</option>)}
        </select>
        {shot.priority && <span className={`sb-shot__pri sb-shot__pri--${shot.priority}`}>{shot.priority}</span>}
        <div className="sb-shot__spacer" />
        <button className="sb-icon" onClick={() => moveShot(shot.id, -1)} disabled={index === 0} title="Move up">↑</button>
        <button className="sb-icon" onClick={() => moveShot(shot.id, 1)} disabled={index === total - 1} title="Move down">↓</button>
        <button className="sb-icon sb-icon--danger" onClick={() => removeShot(shot.id)} title="Delete shot">×</button>
      </div>

      <textarea
        className="sb-shot__desc"
        value={shot.description}
        onChange={e => updateShot(shot.id, { description: e.target.value })}
        placeholder="What we see — one concrete line a board artist could draw cold."
        rows={2}
      />

      <div className="sb-shot__tags">
        {data.characters.map(c => (
          <button
            key={c.id}
            className={`sb-tag ${shot.characterIds?.includes(c.id) ? 'is-on' : ''}`}
            onClick={() => toggleId('characterIds', c.id)}
          >{c.name || 'character'}</button>
        ))}
        {data.places.map(p => (
          <button
            key={p.id}
            className={`sb-tag sb-tag--place ${shot.placeIds?.includes(p.id) ? 'is-on' : ''}`}
            onClick={() => toggleId('placeIds', p.id)}
          >{p.name || 'place'}</button>
        ))}
        {data.elements.map(el => (
          <button
            key={el.id}
            className={`sb-tag sb-tag--element ${shot.elementIds?.includes(el.id) ? 'is-on' : ''}`}
            onClick={() => toggleId('elementIds', el.id)}
          >{el.name || 'element'}</button>
        ))}
      </div>

      <button className="sb-shot__more mono-label" onClick={() => setOpen(o => !o)}>
        {open ? '− less' : '+ lens · move · light · dialogue'}
      </button>
      {open && (
        <div className="sb-shot__detail">
          <Row label="Lens">
            <select className="sb-input" value={LENSES.some(l => l.code === shot.lens) ? shot.lens : ''} onChange={e => updateShot(shot.id, { lens: e.target.value })}>
              <option value="">— lens —</option>
              {LENSES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </Row>
          <Row label="Move">
            <select className="sb-input" value={MOVES.some(m => m.code === shot.move) ? shot.move : ''} onChange={e => updateShot(shot.id, { move: e.target.value })}>
              <option value="">— move —</option>
              {MOVES.map(m => <option key={m.code} value={m.code}>{m.label}</option>)}
            </select>
          </Row>
          <Row label="Duration"><input className="sb-input" value={shot.duration ?? ''} onChange={e => updateShot(shot.id, { duration: e.target.value })} placeholder="2.5s" /></Row>
          <Row label="Dialogue"><input className="sb-input" value={shot.dialogue ?? ''} onChange={e => updateShot(shot.id, { dialogue: e.target.value })} placeholder="≤12 words" /></Row>
          <Row label="Light"><input className="sb-input" value={shot.light ?? ''} onChange={e => updateShot(shot.id, { light: e.target.value })} placeholder="key + ambient + event-light" /></Row>
          <Row label="Frame furn."><input className="sb-input" value={shot.frameFurniture ?? ''} onChange={e => updateShot(shot.id, { frameFurniture: e.target.value })} placeholder="FG / MG / BG + cultural-truth object" /></Row>
        </div>
      )}
    </div>
  );
}

// Staged progress for the single AI call — the % eases toward ~94% while the
// request is in flight, then snaps to 100% when it returns. The task label
// advances through the stages so the user sees what's happening.
function AiProgress({ kind }: { kind: 'breakdown' | 'cast' | null }) {
  const [pct, setPct] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (kind) {
      setVisible(true);
      setPct(p => (p >= 94 ? 8 : Math.max(p, 8)));
      const id = window.setInterval(() => {
        setPct(p => Math.min(94, p + Math.max(0.4, (94 - p) * 0.06)));
      }, 350);
      return () => window.clearInterval(id);
    }
    setPct(100);
    const t = window.setTimeout(() => { setVisible(false); setPct(0); }, 700);
    return () => window.clearTimeout(t);
  }, [kind]);

  if (!visible) return null;
  const stages = kind === 'cast'
    ? ['Scanning the script', 'Finding the cast', 'Finding the places & elements', 'Linking each shot']
    : ['Reading the script', 'Cutting into shots', 'Writing the shot stack', 'Finalizing the board'];
  const idx = Math.min(stages.length - 1, Math.floor((pct / 100) * stages.length));
  const label = pct >= 100 ? 'Done' : stages[idx];
  return (
    <div className="ai-progress">
      <div className="ai-progress__head">
        <span className="ai-progress__task mono-label">{kind === 'cast' ? 'FIND CAST & PLACES' : 'BREAK DOWN'} · {label}</span>
        <span className="ai-progress__pct mono-label">{Math.round(pct)}%</span>
      </div>
      <div className="ai-progress__track"><div className="ai-progress__fill" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="sb-row">
      <span className="sb-row__label mono-label">{label}</span>
      {children}
    </label>
  );
}

// ─── cast / places ────────────────────────────────────────────────
function RefGroup({ kind, title, addLabel }: { kind: 'characters' | 'places' | 'elements'; title: string; addLabel: string }) {
  const data = useStoryboard(s => s.data)!;
  const addRef = useStoryboard(s => s.addRef);
  const updateRef = useStoryboard(s => s.updateRef);
  const removeRef = useStoryboard(s => s.removeRef);
  const list = data[kind];

  const attach = async (id: string) => {
    const p = await pickOneImage();
    if (p) updateRef(kind, id, { refImagePath: p });
  };

  return (
    <div className="sb-refgroup">
      <div className="sb-refgroup__head">
        <span className="mono-label">{title}</span>
        <button className="sb-btn sb-btn--sm" onClick={() => addRef(kind)}>{addLabel}</button>
      </div>
      {list.length === 0 && <div className="sb-refgroup__empty mono-label">none yet</div>}
      {list.map(r => {
        // Show what was MADE in the Storyboard assets stage: a character's
        // generated face, a place/element's generated plate. Falls back to a
        // manually attached reference, else the + to attach one.
        const src = kind === 'characters'
          ? (r.faceThumbPath ?? r.faceImagePath ?? r.refImagePath)
          : (r.thumbPath ?? r.refImagePath);
        const made = r.assetStatus === 'made';
        return (
        <div className="sb-ref" key={r.id}>
          <button className={`sb-ref__thumb ${made ? 'is-made' : ''}`} onClick={() => attach(r.id)} title="Attach / replace reference image">
            {src ? <img src={fileUrl(src)} alt="" /> : <span className="sb-ref__plus">+</span>}
            {made && <span className="sb-ref__made" title="Made in Storyboard">✓</span>}
          </button>
          <div className="sb-ref__body">
            <input
              className="sb-input sb-input--name"
              value={r.name}
              onChange={e => updateRef(kind, r.id, { name: e.target.value })}
              placeholder={kind === 'characters' ? 'Name' : kind === 'places' ? 'Place' : 'Object'}
            />
            <input
              className="sb-input"
              value={r.note ?? ''}
              onChange={e => updateRef(kind, r.id, { note: e.target.value })}
              placeholder="one-line note"
            />
            <button className="sb-ref__clear mono-label" onClick={() => removeRef(kind, r.id)}>remove</button>
          </div>
        </div>
        );
      })}
    </div>
  );
}
