// One clip's numbers, editable. Everything here is a value the exporter will
// actually honour — the per-clip x/y/scale/rotate the model carries is
// preview-only and is deliberately NOT offered.

import { CLIP_MIN, clipEnd, snap, type TlClip, type TlSequence } from '../../lib/timeline/model';

export function ClipInspector({ seq, clip, edit, onRemove }: {
  seq: TlSequence;
  clip: TlClip;
  edit: (patch: Partial<TlClip>) => void;
  onRemove: () => void;
}) {
  const srcIn = clip.srcIn ?? 0;
  const gain = clip.gain ?? 1;
  const num = (v: string) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0);

  return (
    <aside className="tlw-insp">
      <div className="mono-label tlw-insp__eyebrow">{clip.kind.toUpperCase()}</div>
      <div className="tlw-insp__name" title={clip.src}>{clip.label || clip.src.split('/').pop()}</div>

      <label className="tlw-insp__field">
        <span className="mono-label">START</span>
        <input
          type="number" step="0.1" min={0} value={round(clip.start)}
          onChange={e => edit({ start: Math.max(0, snap(num(e.target.value), seq.fps)) })}
        />
      </label>

      <label className="tlw-insp__field">
        <span className="mono-label">LENGTH</span>
        <input
          type="number" step="0.1" min={CLIP_MIN}
          value={round(clip.dur)}
          onChange={e => {
            // A still has no source to run out of; a video does.
            const room = clip.srcDur === undefined ? Infinity : clip.srcDur - srcIn;
            edit({ dur: snap(Math.max(CLIP_MIN, Math.min(room, num(e.target.value))), seq.fps) });
          }}
        />
      </label>

      {clip.kind !== 'image' && (
        <label className="tlw-insp__field">
          <span className="mono-label">IN-POINT</span>
          <input
            type="number" step="0.1" min={0}
            value={round(srcIn)}
            onChange={e => {
              const max = clip.srcDur === undefined ? Infinity : Math.max(0, clip.srcDur - clip.dur);
              edit({ srcIn: snap(Math.max(0, Math.min(max, num(e.target.value))), seq.fps) });
            }}
          />
        </label>
      )}

      {clip.kind === 'audio' && (
        <label className="tlw-insp__field tlw-insp__field--wide">
          <span className="mono-label">LEVEL · {Math.round(gain * 100)}%</span>
          {/* Capped at 1: HTMLMediaElement.volume is, so anything above it would
              be a promise the preview cannot keep. */}
          <input
            type="range" min={0} max={1} step={0.01} value={gain}
            onChange={e => edit({ gain: parseFloat(e.target.value) })}
          />
        </label>
      )}

      <div className="tlw-insp__out mono-label">
        OUT {round(clipEnd(clip))}s
        {clip.srcDur !== undefined && ` · SOURCE ${round(clip.srcDur)}s`}
        {clip.kind !== 'audio' && clip.hasAudio === false && ' · SILENT FILE'}
      </div>

      <div className="tlw-insp__row">
        <button className="pp-btn pp-btn--ghost" onClick={() => void window.hjen.revealInFinder(clip.src)}>
          Reveal
        </button>
        <button className="pp-btn pp-btn--ghost tlw-insp__del" onClick={onRemove}>Remove</button>
      </div>
    </aside>
  );
}

const round = (n: number) => Math.round(n * 100) / 100;
