import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import type { TimelineTrack } from '../store';

const fileUrl = (p: string) => `hjen-file://${encodeURI(p)}`;
const tc = (s: number) => {
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(Math.floor(s % 60)).padStart(2, '0');
  const ff = String(Math.floor((s % 1) * 30)).padStart(2, '0');
  return `00:${mm}:${ss}:${ff}`;
};

/* Docked timeline — a bottom Sequence panel, in the SAME Node view
 * (not a jump to Video). Tracks V2/V1/A1/A2, clips positioned by time and
 * draggable, a ruler, and a transport row. Clips are added from canvas nodes
 * via addToTimeline(); this dock renders + edits them. */

const TRACKS: TimelineTrack[] = ['V2', 'V1', 'A1', 'A2'];
const PXS = 44;              // pixels per second
const TRACK_H = 46;
const RULER_S = 2;           // ruler tick every N seconds
const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// Export resolution presets by aspect → [label, W, H].
const ASPECTS = ['16:9', '9:16', '1:1', '4:5', '21:9'] as const;
const RES: Record<string, Array<{ label: string; w: number; h: number }>> = {
  '16:9': [{ label: '720p', w: 1280, h: 720 }, { label: '1080p', w: 1920, h: 1080 }, { label: '4K', w: 3840, h: 2160 }],
  '9:16': [{ label: '720p', w: 720, h: 1280 }, { label: '1080p', w: 1080, h: 1920 }, { label: '4K', w: 2160, h: 3840 }],
  '1:1': [{ label: '1080', w: 1080, h: 1080 }, { label: '2K', w: 2048, h: 2048 }, { label: '4K', w: 2880, h: 2880 }],
  '4:5': [{ label: '1080', w: 1080, h: 1350 }, { label: '2K', w: 1620, h: 2025 }],
  '21:9': [{ label: '1080', w: 2560, h: 1080 }, { label: '4K', w: 3840, h: 1646 }],
};

export function TimelineDock() {
  const clips = useStore(s => s.timelineClips);
  const open = useStore(s => s.timelineOpen);
  const toggle = useStore(s => s.toggleTimeline);
  const moveClip = useStore(s => s.moveClip);
  const removeClip = useStore(s => s.removeClip);
  const projectName = useStore(s => s.projects.find(p => p.id === s.activeProjectId)?.name);
  // Playback + selection lifted to the store so keyboard shortcuts can drive it.
  const playhead = useStore(s => s.timelinePlayhead);
  const playing = useStore(s => s.timelinePlaying);
  const setPlayhead = useStore(s => s.setPlayhead);
  const setPlaying = useStore(s => s.setPlaying);
  const setPlayRate = useStore(s => s.setPlayRate);
  const setTimelineFocused = useStore(s => s.setTimelineFocused);
  const selectedClipId = useStore(s => s.selectedClipId);
  const selectClip = useStore(s => s.selectClip);
  const snapping = useStore(s => s.timelineSnapping);
  const toggleSnapping = useStore(s => s.toggleSnapping);
  const exportPing = useStore(s => s.exportPing);

  const [exportOpen, setExportOpen] = useState(false);
  const [aspect, setAspect] = useState<string>('16:9');
  const [resIdx, setResIdx] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const runExport = async (fmt: 'mp4' | 'fcpxml') => {
    const r = RES[aspect][Math.min(resIdx, RES[aspect].length - 1)];
    const payload = {
      clips: clips.filter(c => c.track === 'V1').map(c => ({ kind: c.kind, src: c.src, start: c.start, duration: c.duration })),
      width: r.w, height: r.h, fps: 30, projectName,
    };
    setBusy(fmt); setMsg(null);
    try {
      const res = fmt === 'mp4' ? await window.hjen.exportTimelineMp4(payload) : await window.hjen.exportTimelineFcpxml(payload);
      setMsg(res.ok ? `Exported → ${res.path.split('/').pop()}` : (res.reason === 'cancelled' ? null : `Export failed: ${res.message || res.reason}`));
      if (res.ok) setExportOpen(false);
    } catch (e: any) {
      setMsg(`Export failed: ${e?.message || e}`);
    } finally { setBusy(null); }
  };

  const lanesRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; grabDx: number } | null>(null);

  const span = Math.max(20, ...clips.map(c => c.start + c.duration)) + 6; // seconds shown
  const width = span * PXS;

  // ---- Program monitor + playhead (preview / scrub) ----
  const [monitorOn, setMonitorOn] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const v1 = clips.filter(c => c.track === 'V1').sort((a, b) => a.start - b.start);
  const total = v1.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
  const active = v1.find(c => playhead >= c.start && playhead < c.start + c.duration) ?? null;

  // Play loop — advance the playhead in real time, honouring rate/direction
  // (J/K/L shuttle). Reads/writes store state so shortcuts stay in sync.
  useEffect(() => {
    if (!playing) return;
    let raf = 0; let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000; last = now;
      const st = useStore.getState();
      let np = st.timelinePlayhead + dt * st.timelineRate;
      if (np >= total) { np = total; st.setPlaying(false); }
      else if (np <= 0) { np = 0; st.setPlaying(false); }
      st.setPlayhead(np);
      if (useStore.getState().timelinePlaying) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, total]);

  // ⌘M (requestExport) → open the export panel, expanding the dock if needed.
  const pingRef = useRef(exportPing);
  useEffect(() => {
    if (exportPing !== pingRef.current) {
      pingRef.current = exportPing;
      if (!open) toggle();
      setExportOpen(true);
    }
  }, [exportPing, open, toggle]);

  // Keep the monitor video roughly in sync (drift-tolerant v1).
  useEffect(() => {
    const vd = videoRef.current;
    if (!vd || !active || active.kind !== 'video') return;
    const localT = Math.max(0, playhead - active.start);
    if (playing) { if (vd.paused) vd.play().catch(() => {}); }
    else { vd.pause(); if (Math.abs(vd.currentTime - localT) > 0.15) { try { vd.currentTime = localT; } catch { /* seek */ } } }
  }, [active?.id, active?.kind, playing, playhead, active?.start]);

  const scrubTo = (clientX: number, rectLeft: number) => setPlayhead(Math.max(0, Math.min(total, (clientX - rectLeft) / PXS)));

  const onClipDown = (e: React.PointerEvent, id: string, start: number) => {
    e.stopPropagation();
    selectClip(id);
    const rect = lanesRef.current?.getBoundingClientRect();
    const x = e.clientX - (rect?.left ?? 0);
    dragRef.current = { id, grabDx: x - start * PXS };
    const move = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      const r = lanesRef.current?.getBoundingClientRect();
      const mx = ev.clientX - (r?.left ?? 0);
      const laneEls = lanesRef.current?.querySelectorAll('[data-track]');
      let track: TimelineTrack | undefined;
      if (laneEls) for (const el of Array.from(laneEls)) {
        const b = (el as HTMLElement).getBoundingClientRect();
        if (ev.clientY >= b.top && ev.clientY <= b.bottom) { track = (el as HTMLElement).dataset.track as TimelineTrack; break; }
      }
      moveClip(dragRef.current.id, (mx - dragRef.current.grabDx) / PXS, track);
    };
    const up = () => { dragRef.current = null; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (!open) {
    return (
      <footer className="nv-tl nv-tl--closed" onPointerDownCapture={() => setTimelineFocused(true)}>
        <button className="nv-tl__seq" onClick={toggle}>Sequence 1 <span className="nv-tl__chev">▴</span></button>
        <span className="nv-tl__hint mono-label">{clips.length} clip{clips.length === 1 ? '' : 's'}</span>
      </footer>
    );
  }

  return (
    <footer className="nv-tl" onPointerDownCapture={() => setTimelineFocused(true)}>
      {/* Program monitor — floats above the dock, shows the frame at the playhead. */}
      {monitorOn && (
        <div className="nv-tl__monitor">
          {active ? (
            active.kind === 'video' && active.src
              ? <video ref={videoRef} className="nv-tl__monvid" src={fileUrl(active.src)} muted playsInline />
              : (active.thumb ? <img className="nv-tl__monvid" src={active.thumb} alt="" /> : <div className="nv-tl__monempty">no preview</div>)
          ) : <div className="nv-tl__monempty">{v1.length ? 'move the playhead over a clip' : 'add clips to preview'}</div>}
          <div className="nv-tl__montc mono-label">{tc(playhead)} / {tc(total)}</div>
        </div>
      )}

      {/* Transport row */}
      <div className="nv-tl__transport">
        <button className="nv-tl__seq" onClick={toggle}>Sequence 1 <span className="nv-tl__chev">▾</span></button>
        <div className="nv-tl__play">
          <button title="To start (Home)" onClick={() => { setPlaying(false); setPlayhead(0); }}>⏮</button>
          <button title="Back 2s" onClick={() => setPlayhead(Math.max(0, playhead - 2))}>◀◀</button>
          <button className="nv-tl__playbtn" title="Play / pause (Space)" onClick={() => { if (!playing) setPlayRate(1); setPlaying(!playing); }}>{playing ? '⏸' : '▶'}</button>
          <button title="Forward 2s" onClick={() => setPlayhead(Math.min(total, playhead + 2))}>▶▶</button>
          <button title="To end (End)" onClick={() => { setPlaying(false); setPlayhead(total); }}>⏭</button>
        </div>
        <span className="nv-tl__tc mono-label">{tc(playhead)}</span>
        <button className={`nv-tl__mon ${snapping ? 'nv-tl__mon--on' : ''}`} onClick={toggleSnapping} title="Snapping (S)">⌁</button>
        <button className={`nv-tl__mon ${monitorOn ? 'nv-tl__mon--on' : ''}`} onClick={() => setMonitorOn(o => !o)} title="Program monitor">◱</button>
        <div className="nv-tl__exportwrap">
          <button className="nv-tl__export" onClick={() => setExportOpen(o => !o)}>Export ▾</button>
          {exportOpen && (
            <>
              <div className="nv-tl__scrim" onClick={() => setExportOpen(false)} />
              <div className="nv-tl__exportpanel">
                <div className="nv-tl__exprow">
                  <label>Aspect</label>
                  <select value={aspect} onChange={e => { setAspect(e.target.value); setResIdx(1); }}>
                    {ASPECTS.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <div className="nv-tl__exprow">
                  <label>Resolution</label>
                  <select value={resIdx} onChange={e => setResIdx(Number(e.target.value))}>
                    {RES[aspect].map((r, i) => <option key={r.label} value={i}>{r.label} · {r.w}×{r.h}</option>)}
                  </select>
                </div>
                <div className="nv-tl__expbtns">
                  <button className="btn-primary" disabled={!!busy} onClick={() => runExport('mp4')}>{busy === 'mp4' ? 'Rendering…' : 'Export MP4'}</button>
                  <button className="nv-tl__expxml" disabled={!!busy} onClick={() => runExport('fcpxml')}>{busy === 'fcpxml' ? '…' : 'Export XML'}</button>
                </div>
                <div className="nv-tl__expnote mono-label">MP4 renders via local ffmpeg · XML imports into Premiere/DaVinci</div>
              </div>
            </>
          )}
        </div>
        {msg && <span className="nv-tl__msg mono-label">{msg}</span>}
        <button className="nv-tl__collapse" onClick={toggle} title="Collapse">▾</button>
      </div>

      <div className="nv-tl__grid">
        {/* Track headers */}
        <div className="nv-tl__heads">
          <div className="nv-tl__rulerpad" />
          {TRACKS.map(t => (
            <div key={t} className="nv-tl__head" style={{ height: TRACK_H }}>
              <span className="nv-tl__headlabel">{t}</span>
              <span className="nv-tl__headicos mono-label">{t.startsWith('A') ? '🔊' : '👁'}</span>
            </div>
          ))}
        </div>

        {/* Ruler + lanes */}
        <div className="nv-tl__scroll">
          <div className="nv-tl__inner" style={{ width }}>
            <div className="nv-tl__ruler" onPointerDown={(e) => { setPlaying(false); scrubTo(e.clientX, e.currentTarget.getBoundingClientRect().left); }}>
              {Array.from({ length: Math.ceil(span / RULER_S) + 1 }).map((_, i) => (
                <span key={i} className="nv-tl__tick" style={{ left: i * RULER_S * PXS }}>{fmt(i * RULER_S)}</span>
              ))}
            </div>
            {/* Playhead — draggable scrubber over all lanes. */}
            <div
              className="nv-tl__playhead" style={{ left: playhead * PXS }}
              onPointerDown={(e) => {
                e.stopPropagation(); setPlaying(false);
                const left = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect().left;
                const move = (ev: PointerEvent) => scrubTo(ev.clientX, left);
                const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
                window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
              }}
            ><span className="nv-tl__playhead-grip" /></div>
            <div className="nv-tl__lanes" ref={lanesRef}>
              {TRACKS.map(t => (
                <div key={t} className="nv-tl__lane" data-track={t} style={{ height: TRACK_H }}>
                  {clips.filter(c => c.track === t).map(c => (
                    <div
                      key={c.id}
                      className={`nv-clip nv-clip--${c.kind} ${selectedClipId === c.id ? 'nv-clip--sel' : ''}`}
                      style={{ left: c.start * PXS, width: Math.max(28, c.duration * PXS) }}
                      onPointerDown={(e) => onClipDown(e, c.id, c.start)}
                      title={`${c.label} · ${c.duration}s`}
                    >
                      {c.thumb && <img className="nv-clip__thumb" src={c.thumb} alt="" />}
                      <span className="nv-clip__label">{c.label}</span>
                      <button className="nv-clip__x" onPointerDown={(e) => { e.stopPropagation(); removeClip(c.id); }} title="Remove">✕</button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
