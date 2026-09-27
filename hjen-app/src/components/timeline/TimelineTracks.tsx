// The tracks: ruler, lanes, clips, and everything that can be done to them
// with a pointer — move, trim, drop.
//
// Absolutely-positioned divs, no canvas, no library. Two disciplines borrowed
// from CutsView because they are the difference between a timeline that feels
// like a tool and one that feels like a web page:
//   · the playhead is moved by writing style.left on a ref, never by React
//     state, so scrubbing does not re-render the whole lane stack (CutsView:262-283)
//   · the track-heads column is scrolled by transform, kept in sync with the
//     lane scroller, so the two never drift (CutsView:1627)

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hjenFileUrl } from '../../lib/theme/apply';
import {
  CLIP_MIN, DEFAULT_IMAGE_DUR, applyTrim, clipEnd, insertClip, linkedIds, newClipId,
  newLinkId, patchClip, snap, audioTrackFor, type TlClip, type TlSequence, type TlTrack,
} from '../../lib/timeline/model';
import { firstFreeAt } from '../../lib/timeline/query';
import { canAcceptDrag, isImageThumb, readMediaDrag, writeMediaDrag } from '../../lib/timeline/dnd';

const LANE_H = { video: 56, audio: 40 } as const;
const HEAD_W = 78;
const RULER_H = 24;

type Gesture =
  | { kind: 'move'; ids: string[]; start0: Record<string, number>; fromX: number }
  | { kind: 'trim-l' | 'trim-r'; ids: string[]; base: Record<string, TlClip>; fromX: number };

export function TimelineTracks({
  seq, edit, pxs, playhead, playing, playheadElRef, selected, setSelected, setInteracting, onSeek, onToast,
}: {
  seq: TlSequence;
  edit: (fn: (d: TlSequence) => TlSequence) => void;
  pxs: number;
  /** Throttled (~12 Hz) — good enough to keep the DOM honest after a re-render. */
  playhead: number;
  playing: boolean;
  /** The panel's rAF loop writes style.left on this element at 60 Hz. Owned up
   *  there because that is where the clock is; rendered here because that is
   *  where the lanes are. */
  playheadElRef: React.MutableRefObject<HTMLDivElement | null>;
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  setInteracting: (v: boolean) => void;
  onSeek: (t: number) => void;
  onToast: (m: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const headsRef = useRef<HTMLDivElement | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const liveRef = useRef<Record<string, Partial<TlClip>> | null>(null);
  const seqRef = useRef(seq);
  const pxsRef = useRef(pxs);
  const [live, setLive] = useState<Record<string, Partial<TlClip>> | null>(null);
  const [dropTrack, setDropTrack] = useState<string | null>(null);

  seqRef.current = seq;
  pxsRef.current = pxs;
  liveRef.current = live;

  const duration = Math.max(10, seq.tracks.reduce(
    (m, t) => t.clips.reduce((n, c) => Math.max(n, clipEnd(c)), m), 0) + 4);
  const laneW = Math.max(400, duration * pxs);

  // Tracks are STORED bottom-first (V1, V2, A1, A2) because index order is
  // z-order and the last video track must win the composite. They are DRAWN
  // the way an editor reads them: video descending from the top, audio beneath
  // it — V2, V1, A1, A2. A plain reverse() would put the audio on top.
  const rows = useMemo(() => [
    ...seq.tracks.filter(t => t.kind === 'video').reverse(),
    ...seq.tracks.filter(t => t.kind === 'audio'),
  ], [seq.tracks]);

  // The playhead moves by DOM write, never by React state. This effect only
  // corrects it after a zoom or a re-render; the panel's rAF loop owns the
  // 60 Hz motion.
  useEffect(() => {
    const el = playheadElRef.current;
    if (el) el.style.left = `${playhead * pxs}px`;
  }, [playhead, pxs, playheadElRef]);

  // ── heads follow the lanes ──
  const onScroll = useCallback(() => {
    const s = scrollRef.current, h = headsRef.current;
    if (s && h) h.style.transform = `translateY(-${s.scrollTop}px)`;
  }, []);

  // ── scrub ──
  const timeAtClientX = useCallback((clientX: number) => {
    const el = scrollRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.max(0, (clientX - r.left + el.scrollLeft) / pxsRef.current);
  }, []);

  const startScrub = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setInteracting(true);
    onSeek(timeAtClientX(e.clientX));
    const move = (ev: PointerEvent) => onSeek(timeAtClientX(ev.clientX));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setInteracting(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [onSeek, timeAtClientX, setInteracting]);

  // ── move / trim ──
  const beginClip = useCallback((
    e: React.PointerEvent, track: TlTrack, clip: TlClip, mode: 'move' | 'trim-l' | 'trim-r',
  ) => {
    if (e.button !== 0 || track.locked) return;
    e.stopPropagation();
    e.preventDefault();

    // A linked A/V pair is one object to the hand: grab either half, move both.
    const ids = linkedIds(seqRef.current, [clip.id]);
    const additive = e.shiftKey || e.metaKey;
    const acting = additive ? [...new Set([...selected, ...ids])] : (selected.has(clip.id) ? [...selected] : ids);
    setSelected(new Set(acting));
    setInteracting(true);

    const byId = new Map<string, TlClip>();
    for (const t of seqRef.current.tracks) for (const c of t.clips) if (acting.includes(c.id)) byId.set(c.id, c);

    const g: Gesture = mode === 'move'
      ? { kind: 'move', ids: acting, fromX: e.clientX, start0: Object.fromEntries([...byId].map(([id, c]) => [id, c.start])) }
      : { kind: mode, ids: acting, fromX: e.clientX, base: Object.fromEntries(byId) };
    gestureRef.current = g;

    // Window listeners, not setPointerCapture — the same law PitchView records:
    // the browser drops element capture after a move or two and the clip sticks.
    const move = (ev: PointerEvent) => {
      const cur = gestureRef.current;
      if (!cur) return;
      const dt = (ev.clientX - cur.fromX) / pxsRef.current;
      const next: Record<string, Partial<TlClip>> = {};
      if (cur.kind === 'move') {
        for (const id of cur.ids) {
          const s0 = cur.start0[id];
          if (s0 === undefined) continue;
          next[id] = { start: Math.max(0, snap(s0 + dt, seqRef.current.fps)) };
        }
      } else {
        for (const id of cur.ids) {
          const b = cur.base[id];
          if (!b) continue;
          next[id] = applyTrim(b, cur.kind, dt, seqRef.current.fps);
        }
      }
      setLive(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const committed = liveRef.current;
      gestureRef.current = null;
      setLive(null);
      setInteracting(false);
      if (!committed) return;
      // ONE commit for the whole gesture → one debounced write, one broadcast.
      edit(d => {
        let out = d;
        for (const [id, patch] of Object.entries(committed)) out = patchClip(out, id, patch);
        return out;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [selected, setSelected, edit, setInteracting]);

  // ── drop onto a track ──
  const onTrackDrop = useCallback(async (track: TlTrack, e: React.DragEvent) => {
    e.preventDefault();
    setDropTrack(null);
    if (track.locked) return;
    const payloads = readMediaDrag(e);
    if (!payloads.length) return;

    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const scroller = scrollRef.current;
    let cursor = Math.max(0, snap(
      (e.clientX - rect.left + (scroller?.scrollLeft ?? 0)) / pxsRef.current, seqRef.current.fps));

    for (const p of payloads) {
      // One cheap probe per file — cached in main by path+mtime. It gives the
      // real duration, whether the file has sound at all, and a poster for a
      // video whose only "thumb" would otherwise be the video path itself.
      const needProbe = p.kind !== 'image' || p.dur == null;
      const pr = needProbe
        ? await window.hjen.mediaProbe({ path: p.src, poster: p.kind === 'video' && !isImageThumb(p.thumb) })
        : null;

      const kind = (pr?.ok && pr.kind) ? pr.kind : p.kind;
      if (track.kind === 'audio' && kind === 'image') { onToast('Audio tracks take sound, not stills.'); continue; }
      if (track.kind === 'video' && kind === 'audio') { onToast('Sound goes on an audio track.'); continue; }

      const srcDur = pr?.ok && (pr.duration ?? 0) > 0 ? pr.duration : p.dur;
      const dur = snap(
        kind === 'image' ? (p.dur ?? DEFAULT_IMAGE_DUR) : Math.max(CLIP_MIN, srcDur ?? 5),
        seqRef.current.fps,
      );
      // Land in the first free slot at or after the cursor rather than silently
      // on top of what is already there.
      const liveTrack = seqRef.current.tracks.find(t => t.id === track.id) ?? track;
      const start = snap(firstFreeAt(liveTrack, cursor, dur), seqRef.current.fps);

      const clip: TlClip = {
        id: newClipId(), kind, src: p.src,
        thumb: isImageThumb(p.thumb) ? p.thumb : (pr?.poster || undefined),
        label: p.label, start, dur, srcIn: 0,
        srcDur: kind === 'image' ? undefined : srcDur,     // a still trims unbounded
        gain: 1, hasAudio: pr?.ok ? pr.hasAudio : undefined,
        originRefId: p.originRefId,
      };

      // Bring the sound down with the picture — but ONLY when there is any. The
      // shipped Cuts drop creates a silent linked clip for a video-only file,
      // which then confuses both the mix and the exporter.
      const wantsAudio = track.kind === 'video' && kind === 'video' && pr?.ok && pr.hasAudio;
      if (wantsAudio) clip.linkId = newLinkId();

      edit(d => {
        let out = insertClip(d, track.id, clip);
        if (wantsAudio) {
          const dest = audioTrackFor(out, start, dur);
          if (dest) {
            out = insertClip({ ...out, tracks: out.tracks.map(t => (t.id === dest.id ? { ...t, hidden: false } : t)) },
              dest.id, {
                ...clip, id: newClipId(), kind: 'audio',
                label: `♪ ${p.label || 'audio'}`, thumb: undefined,
              });
          }
        }
        return out;
      });
      cursor = snap(start + dur, seqRef.current.fps);
    }
  }, [edit, onToast]);

  // ── render ──
  const shown = (c: TlClip): TlClip => (live?.[c.id] ? { ...c, ...live[c.id] } as TlClip : c);
  const ticks: number[] = [];
  const step = pxs > 90 ? 1 : pxs > 40 ? 2 : pxs > 18 ? 5 : 10;
  for (let t = 0; t <= duration; t += step) ticks.push(t);

  return (
    <div className="tlw-tl">
      <div className="tlw-tl__heads" style={{ width: HEAD_W }}>
        <div className="tlw-tl__headspacer" style={{ height: RULER_H }} />
        <div ref={headsRef}>
          {rows.map(t => (
            <div key={t.id} className="tlw-head" style={{ height: LANE_H[t.kind] }}>
              <span className="mono-label tlw-head__label">{t.label}</span>
              <button
                className={`tlw-head__eye${t.hidden ? ' is-off' : ''}`}
                title={t.hidden ? (t.kind === 'audio' ? 'Silent — click to hear' : 'Hidden — click to show')
                                : (t.kind === 'audio' ? 'Audible — click to silence' : 'Visible — click to hide')}
                aria-label={`Toggle ${t.label}`}
                onClick={() => edit(d => ({ ...d, tracks: d.tracks.map(x => (x.id === t.id ? { ...x, hidden: !x.hidden } : x)) }))}
              >{t.kind === 'audio' ? '♪' : '◉'}</button>
            </div>
          ))}
        </div>
      </div>

      <div className="tlw-tl__scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="tlw-tl__inner" style={{ width: laneW }}>
          <div className="tlw-ruler" style={{ height: RULER_H }} onPointerDown={startScrub}>
            {ticks.map(t => (
              <span key={t} className="tlw-tick" style={{ left: t * pxs }}>
                <span className="tlw-tick__label mono-label">{fmt(t)}</span>
              </span>
            ))}
          </div>

          {rows.map(t => (
            <div
              key={t.id}
              className={`tlw-lane tlw-lane--${t.kind}${t.hidden ? ' is-hidden' : ''}${dropTrack === t.id ? ' is-drop' : ''}`}
              style={{ height: LANE_H[t.kind] }}
              onPointerDown={startScrub}
              onDragOver={e => { if (!canAcceptDrag(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDropTrack(t.id); }}
              onDragLeave={e => { if (e.currentTarget === e.target) setDropTrack(null); }}
              onDrop={e => { void onTrackDrop(t, e); }}
            >
              {t.clips.map(raw => {
                const c = shown(raw);
                return (
                  <div
                    key={c.id}
                    className={`tlw-clip tlw-clip--${c.kind}${selected.has(c.id) ? ' is-sel' : ''}`}
                    style={{ left: c.start * pxs, width: Math.max(8, c.dur * pxs) }}
                    onPointerDown={e => beginClip(e, t, raw, 'move')}
                    // A clip is also a drag SOURCE: pull it onto a mood board,
                    // or onto another sequence, without going back to Finder.
                    draggable
                    onDragStart={e => writeMediaDrag(e.dataTransfer, {
                      kind: c.kind, src: c.src, thumb: c.thumb, label: c.label, dur: c.dur,
                      originRefId: c.originRefId,
                    })}
                    title={`${c.label || c.src.split('/').pop()} · ${c.dur.toFixed(2)}s`}
                  >
                    {c.thumb && <img className="tlw-clip__thumb" src={hjenFileUrl(c.thumb)} alt="" draggable={false} />}
                    <span className="tlw-clip__name">{c.label || c.src.split('/').pop()}</span>
                    <span className="tlw-clip__trim tlw-clip__trim--l" onPointerDown={e => beginClip(e, t, raw, 'trim-l')} />
                    <span className="tlw-clip__trim tlw-clip__trim--r" onPointerDown={e => beginClip(e, t, raw, 'trim-r')} />
                  </div>
                );
              })}
            </div>
          ))}

          <div ref={playheadElRef} className={`tlw-playhead${playing ? ' is-playing' : ''}`} />
        </div>
      </div>
    </div>
  );
}

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
