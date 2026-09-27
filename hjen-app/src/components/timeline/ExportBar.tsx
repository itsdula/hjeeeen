// Getting the piece out — a render, or an XML for a real edit suite.
//
// Two honesty rules live here:
//  · anything the exporter will NOT carry is named before the render, not
//    discovered after it (a hidden track, a silent file on an audio lane)
//  · a render that takes minutes shows what it is doing and can be stopped

import { useEffect, useState } from 'react';
import { toExportSpec } from '../../lib/timeline/exportPayload';
import type { TlSequence } from '../../lib/timeline/model';

/** 1080 and 720 only — the user asked for those two, and everything above them
 *  is a promise about source quality this tool cannot make. */
const SIZES: Array<{ label: string; w: number; h: number }> = [
  { label: '1080', w: 1920, h: 1080 },
  { label: '720', w: 1280, h: 720 },
];

export function ExportBar({ seq, projectName, onToast }: {
  seq: TlSequence;
  projectName: string;
  onToast: (m: string) => void;
}) {
  const [busy, setBusy] = useState<'mp4' | 'xml' | null>(null);
  const [pct, setPct] = useState<number | null>(null);

  useEffect(() => {
    const off = window.hjen.onExportProgress?.(d => setPct(d.pct));
    return off;
  }, []);

  const spec = toExportSpec(seq);
  const empty = spec.clips.length === 0;

  const run = async (kind: 'mp4' | 'xml', w?: number, h?: number) => {
    if (busy) return;
    if (empty) { onToast('Nothing on the timeline yet.'); return; }
    if (spec.dropped.length) {
      // Say it BEFORE the render, so a missing clip is a decision and not a
      // surprise in the finished file.
      onToast(`Leaving out ${spec.dropped.length}: ${spec.dropped.slice(0, 3).map(d => `${d.label} (${d.reason})`).join(', ')}${spec.dropped.length > 3 ? '…' : ''}`);
    }
    setBusy(kind);
    setPct(null);
    try {
      const args = {
        clips: spec.clips,
        width: w ?? spec.width, height: h ?? spec.height,
        fps: spec.fps, total: spec.total, projectName,
      };
      const res = kind === 'mp4'
        ? await window.hjen.exportSequenceMp4(args)
        : await window.hjen.exportSequenceFcpxml(args);
      if (res.ok) onToast(`Saved · ${res.path.split('/').pop()}`);
      else if (res.reason !== 'cancelled') onToast(res.message || `Export failed (${res.reason}).`);
    } finally {
      setBusy(null);
      setPct(null);
    }
  };

  return (
    <div className="tlw-export">
      <span className="mono-label tlw-export__len">
        {fmtLen(spec.total)}{spec.dropped.length > 0 && ` · ${spec.dropped.length} left out`}
      </span>
      <span className="tlw-export__spacer" />

      {busy === 'mp4' ? (
        <>
          <div className="tlw-export__meter">
            <span className="tlw-export__fill" style={{ width: `${Math.round((pct ?? 0) * 100)}%` }} />
          </div>
          <span className="mono-label tlw-export__pct">
            {/* -progress is silent until the first frame lands, which on a big
                graph is several seconds of apparent nothing. */}
            {pct === null ? 'PREPARING…' : `${Math.round(pct * 100)}%`}
          </span>
          <button className="pp-btn pp-btn--ghost" onClick={() => void window.hjen.exportCancel()}>Cancel</button>
        </>
      ) : (
        <>
          {SIZES.map(s => (
            <button
              key={s.label}
              className="pp-btn pp-btn--ghost"
              disabled={!!busy || empty}
              onClick={() => void run('mp4', s.w, s.h)}
              title={`Render an MP4 at ${s.w}×${s.h}`}
            >MP4 · {s.label}</button>
          ))}
          <button
            className="pp-btn pp-btn--accent"
            disabled={!!busy || empty}
            onClick={() => void run('xml')}
            title="An XML for Resolve, Premiere or Final Cut — the edit, not the render"
          >{busy === 'xml' ? 'Writing…' : 'XML'}</button>
        </>
      )}
    </div>
  );
}

function fmtLen(t: number): string {
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
