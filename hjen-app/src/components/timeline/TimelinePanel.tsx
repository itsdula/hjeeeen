// The timeline panel — monitor, transport, tracks, inspector, export.
//
// THE CLOCK. Cuts has a master <video> that owns time and is read every frame.
// This timeline has no master source at all — a sequence of references is
// assembled, not analysed — so the clock is wall-time, like TimelineDock. What
// it borrows from Cuts instead is the DISCIPLINE TimelineDock lacks: the
// playhead is moved by writing style.left on a ref at 60 Hz, and React state is
// throttled to ~12 Hz. TimelineDock calls setPlayhead every frame, which is why
// it feels heavy on a long timeline.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hjenFileUrl } from '../../lib/theme/apply';
import { Monitor } from './Monitor';
import { ClipAudio } from './ClipAudio';
import { ClipInspector } from './ClipInspector';
import { ExportBar } from './ExportBar';
import { TimelineTracks } from './TimelineTracks';
import {
  CLIP_MIN, DEFAULT_IMAGE_DUR, FPS_CHOICES, clipEnd, insertClip, newClipId, patchClip,
  removeClips, sequenceDuration, snap, splitAt,
  type TlClip, type TlSequence,
} from '../../lib/timeline/model';
import { classifyPath } from '../../lib/timeline/dnd';
import type { PendingMedia } from '../../lib/dock/dragPayload';
import {
  activeAudioClipsAt, nextEdgeAfter, prevEdgeBefore, topVideoClipAt, underVideoClipAt,
} from '../../lib/timeline/query';
import '../../styles/timeline.css';

/** How often the React tree learns the time. Anything the eye reads (the
 *  monitor, the readout) is fine at this rate; the playhead is not, which is
 *  why it bypasses React entirely. */
const STATE_HZ = 12;

export function TimelinePanel({ seq, edit, setInteracting, onToast, pending, onPendingConsumed }: {
  seq: TlSequence;
  edit: (fn: (d: TlSequence) => TlSequence) => void;
  setInteracting: (v: boolean) => void;
  /** Accepted for symmetry with the mood board and deliberately unused: the
   *  timeline references media in place rather than copying it into the
   *  project, so a 400 MB source is not duplicated to make a 20-second cut. */
  projectId?: string | null;
  onToast: (m: string) => void;
  /** Frames handed over WITHOUT a drag — the "Send to Timeline" route. */
  pending?: PendingMedia[] | null;
  onPendingConsumed?: () => void;
}) {
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pxs, setPxs] = useState(48);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [muted, setMuted] = useState(false);

  const tRef = useRef(0);                 // the TRUE time, 60 Hz
  const rafRef = useRef<number | null>(null);
  const lastWallRef = useRef(0);
  const lastStateRef = useRef(0);
  const playheadElRef = useRef<HTMLDivElement | null>(null);
  const pxsRef = useRef(pxs);
  const seqRef = useRef(seq);

  pxsRef.current = pxs;
  seqRef.current = seq;

  const duration = useMemo(() => sequenceDuration(seq), [seq]);

  const paintPlayhead = useCallback((t: number) => {
    const el = playheadElRef.current;
    if (el) el.style.left = `${t * pxsRef.current}px`;
  }, []);

  const seek = useCallback((t: number) => {
    const clamped = Math.max(0, Math.min(Math.max(duration, 0.1), t));
    tRef.current = clamped;
    paintPlayhead(clamped);
    setPlayhead(clamped);
  }, [duration, paintPlayhead]);

  // ── the transport ──
  useEffect(() => {
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }
    lastWallRef.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - lastWallRef.current) / 1000;
      lastWallRef.current = now;
      const next = tRef.current + dt;
      const end = sequenceDuration(seqRef.current);
      if (next >= end) {
        tRef.current = end;
        paintPlayhead(end);
        setPlayhead(end);
        setPlaying(false);
        return;
      }
      tRef.current = next;
      paintPlayhead(next);                                   // 60 Hz, no React
      if (now - lastStateRef.current > 1000 / STATE_HZ) {     // ~12 Hz, React
        lastStateRef.current = now;
        setPlayhead(next);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [playing, paintPlayhead]);

  // ── what is on screen and what is audible, right now ──
  const top = topVideoClipAt(seq, playhead);
  const under = top ? underVideoClipAt(seq, playhead, top.clip) : null;
  const audible = activeAudioClipsAt(seq, playhead);
  const selectedClip: TlClip | null = useMemo(() => {
    if (selected.size !== 1) return null;
    const id = [...selected][0];
    for (const t of seq.tracks) for (const c of t.clips) if (c.id === id) return c;
    return null;
  }, [selected, seq]);

  // ── frames sent here without a drag ──
  // They land end-to-end on the first video track, after everything already
  // there. Stills get the default length; anything with a real duration is
  // probed, so a video does not sit on the timeline claiming four seconds.
  const consumedRef = useRef(false);
  useEffect(() => {
    if (!pending?.length || consumedRef.current) return;
    consumedRef.current = true;
    void (async () => {
      const s0 = seqRef.current;
      const track = s0.tracks.find(t => t.kind === 'video' && !t.locked);
      if (!track) { onPendingConsumed?.(); return; }
      let cursor = snap(track.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0), s0.fps);
      for (const p of pending) {
        const kind = classifyPath(p.src);
        if (!kind || kind === 'audio') continue;
        const pr = kind === 'video' ? await window.hjen.mediaProbe({ path: p.src, poster: true }) : null;
        const srcDur = pr?.ok && (pr.duration ?? 0) > 0 ? pr.duration : undefined;
        const dur = snap(kind === 'image' ? DEFAULT_IMAGE_DUR : Math.max(CLIP_MIN, srcDur ?? 5), s0.fps);
        const clip: TlClip = {
          id: newClipId(), kind, src: p.src, thumb: pr?.poster || undefined,
          label: p.label, start: cursor, dur, srcIn: 0,
          srcDur: kind === 'image' ? undefined : srcDur,
          gain: 1, hasAudio: pr?.ok ? pr.hasAudio : undefined,
          originRefId: p.refId,
        };
        edit(d => insertClip(d, track.id, clip));
        cursor = snap(cursor + dur, s0.fps);
      }
      onPendingConsumed?.();
    })();
  }, [pending, edit, onPendingConsumed]);

  // ── keyboard ──
  useEffect(() => {
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    };
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      if (e.code === 'Space') { e.preventDefault(); setPlaying(p => !p); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); seek(tRef.current - (e.shiftKey ? 1 : 1 / seq.fps)); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); seek(tRef.current + (e.shiftKey ? 1 : 1 / seq.fps)); return; }
      if (e.key === 'Home') { e.preventDefault(); seek(0); return; }
      if (e.key === 'End') { e.preventDefault(); seek(duration); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); const p = prevEdgeBefore(seq, tRef.current); if (p !== null) seek(p); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); const n = nextEdgeAfter(seq, tRef.current); if (n !== null) seek(n); return; }
      if (e.key.toLowerCase() === 's' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); edit(d => splitAt(d, tRef.current)); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selected.size === 0) return;
        e.preventDefault();
        edit(d => removeClips(d, [...selected]));
        setSelected(new Set());
        return;
      }
      if (e.key === 'Escape') setSelected(new Set());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [seek, duration, seq, edit, selected]);

  const projectName = seq.name || 'Sequence';

  return (
    <div className="tlw">
      <div className="tlw-top">
        <Monitor
          top={top?.clip ?? null}
          under={under?.clip ?? null}
          playhead={playhead}
          playing={playing}
          width={seq.width}
          height={seq.height}
        />
        {selectedClip && (
          <ClipInspector
            seq={seq}
            clip={selectedClip}
            edit={patch => edit(d => patchClip(d, selectedClip.id, patch))}
            onRemove={() => { edit(d => removeClips(d, [selectedClip.id])); setSelected(new Set()); }}
          />
        )}
      </div>

      <div className="tlw-transport">
        <button className="tlw-tp__btn" onClick={() => seek(0)} title="Start (Home)">⏮</button>
        <button className="tlw-tp__btn tlw-tp__btn--play" onClick={() => setPlaying(p => !p)} title="Play / pause (Space)">
          {playing ? '❚❚' : '▶'}
        </button>
        <button className="tlw-tp__btn" onClick={() => seek(duration)} title="End (End)">⏭</button>
        <span className="mono-label tlw-tp__time">{tc(playhead, seq.fps)} / {tc(duration, seq.fps)}</span>

        <button
          className={`tlw-tp__btn${muted ? ' is-off' : ''}`}
          onClick={() => setMuted(m => !m)}
          title={muted ? 'Silent — click to hear' : 'Audible — click to silence'}
        >{muted ? '🔇' : '🔊'}</button>

        <button className="pp-btn pp-btn--ghost" onClick={() => edit(d => splitAt(d, tRef.current))} title="Cut at the playhead (S)">
          Cut
        </button>

        <span className="tlw-tp__spacer" />

        <label className="tlw-tp__field">
          <span className="mono-label">FPS</span>
          {/* Integer only: 23.976 and 29.97 are silently wrong under the
              rational-time helper the XML uses, so they are not offered. */}
          <select value={seq.fps} onChange={e => edit(d => ({ ...d, fps: parseInt(e.target.value, 10) }))}>
            {FPS_CHOICES.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>

        <label className="tlw-tp__field">
          <span className="mono-label">ZOOM</span>
          <input
            type="range" min={8} max={200} step={1} value={pxs}
            onChange={e => setPxs(parseInt(e.target.value, 10))}
          />
        </label>
      </div>

      <TimelineTracks
        seq={seq}
        edit={edit}
        pxs={pxs}
        playhead={playhead}
        playing={playing}
        playheadElRef={playheadElRef}
        selected={selected}
        setSelected={setSelected}
        setInteracting={setInteracting}
        onSeek={seek}
        onToast={onToast}
      />

      <ExportBar seq={seq} projectName={projectName} onToast={onToast} />

      {/* One <audio> per audible clip, mounted only while it covers the
          playhead — a hidden track renders none and is therefore silent. */}
      {audible.map(({ clip }) => (
        <ClipAudio
          key={clip.id}
          src={hjenFileUrl(clip.src)}
          clipStart={clip.start}
          srcIn={clip.srcIn ?? 0}
          playhead={playhead}
          playing={playing}
          muted={muted}
          gain={clip.gain ?? 1}
        />
      ))}
    </div>
  );
}

/** h:mm:ss:ff — the only readout an editor trusts. */
function tc(t: number, fps: number): string {
  const f = Math.max(0, Math.round(t * fps));
  const ff = f % fps;
  const s = Math.floor(f / fps) % 60;
  const m = Math.floor(f / (fps * 60)) % 60;
  return `${m}:${String(s).padStart(2, '0')}:${String(ff).padStart(2, '0')}`;
}
