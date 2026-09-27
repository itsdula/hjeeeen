// EditView — HJEN's full-screen editor (Edit mode). A dedicated NLE
// surface: a large program monitor, a transport, and tall V2/V1/A1/A2 tracks
// with draggable + trimmable + splittable clips. All state lives in the store,
// so the keyboard layer (Space/JKL/C/S/,/./⌘M …) drives this the same as the
// docked timeline. Rendered in place of the canvas when nodeMode === 'edit'.

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store';
import type { TimelineTrack } from '../../store';

const fileUrl = (p: string) => `hjen-file://${encodeURI(p)}`;
const tc = (s: number) => {
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(Math.floor(s % 60)).padStart(2, '0');
  const ff = String(Math.floor((s % 1) * 30)).padStart(2, '0');
  return `00:${mm}:${ss}:${ff}`;
};

const TRACKS: TimelineTrack[] = ['V2', 'V1', 'A1', 'A2'];
const PXS = 78;            // pixels per second (finer than the dock)
const TRACK_H = 60;
const RULER_S = 1;
const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const ASPECTS = ['16:9', '9:16', '1:1', '4:5', '21:9'] as const;
const RES: Record<string, Array<{ label: string; w: number; h: number }>> = {
  '16:9': [{ label: '720p', w: 1280, h: 720 }, { label: '1080p', w: 1920, h: 1080 }, { label: '4K', w: 3840, h: 2160 }],
  '9:16': [{ label: '720p', w: 720, h: 1280 }, { label: '1080p', w: 1080, h: 1920 }, { label: '4K', w: 2160, h: 3840 }],
  '1:1': [{ label: '1080', w: 1080, h: 1080 }, { label: '2K', w: 2048, h: 2048 }],
  '4:5': [{ label: '1080', w: 1080, h: 1350 }, { label: '2K', w: 1620, h: 2025 }],
  '21:9': [{ label: '1080', w: 2560, h: 1080 }, { label: '4K', w: 3840, h: 1646 }],
};

export function EditView() {
  const clips = useStore(s => s.timelineClips);
  const playhead = useStore(s => s.timelinePlayhead);
  const playing = useStore(s => s.timelinePlaying);
  const setPlayhead = useStore(s => s.setPlayhead);
  const setPlaying = useStore(s => s.setPlaying);
  const setPlayRate = useStore(s => s.setPlayRate);
  const moveClip = useStore(s => s.moveClip);
  const removeClip = useStore(s => s.removeClip);
  const splitClip = useStore(s => s.splitClip);
  const setClipInOut = useStore(s => s.setClipInOut);
  const selectedClipId = useStore(s => s.selectedClipId);
  const selectClip = useStore(s => s.selectClip);
  const snapping = useStore(s => s.timelineSnapping);
  const toggleSnapping = useStore(s => s.toggleSnapping);
  const exportPing = useStore(s => s.exportPing);
  const projectName = useStore(s => s.projects.find(p => p.id === s.activeProjectId)?.name);

  const lanesRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [aspect, setAspect] = useState('16:9');
  const [resIdx, setResIdx] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const span = Math.max(24, ...clips.map(c => c.start + c.duration)) + 6;
  const width = span * PXS;
  const v1 = clips.filter(c => c.track === 'V1').sort((a, b) => a.start - b.start);
  const total = v1.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
  const active = v1.find(c => playhead >= c.start && playhead < c.start + c.duration) ?? null;

  // Play loop (rate-aware, store-driven) — same contract as the dock.
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

  useEffect(() => {
    const vd = videoRef.current;
    if (!vd || !active || active.kind !== 'video') return;
    const localT = Math.max(0, playhead - active.start) + (active.inPoint ?? 0);
    if (playing) { if (vd.paused) vd.play().catch(() => {}); }
    else { vd.pause(); if (Math.abs(vd.currentTime - localT) > 0.15) { try { vd.currentTime = localT; } catch { /* seek */ } } }
  }, [active?.id, active?.kind, playing, playhead, active?.start, active?.inPoint]);

  const pingRef = useRef(exportPing);
  useEffect(() => { if (exportPing !== pingRef.current) { pingRef.current = exportPing; setExportOpen(true); } }, [exportPing]);

  const scrubTo = (clientX: number, rectLeft: number) => setPlayhead(Math.max(0, Math.min(total, (clientX - rectLeft) / PXS)));

  const startClipDrag = (e: React.PointerEvent, id: string, start: number) => {
    e.stopPropagation();
    selectClip(id);
    const rect = lanesRef.current?.getBoundingClientRect();
    const grab = (e.clientX - (rect?.left ?? 0)) - start * PXS;
    const move = (ev: PointerEvent) => {
      const r = lanesRef.current?.getBoundingClientRect();
      const mx = ev.clientX - (r?.left ?? 0);
      let track: TimelineTrack | undefined;
      const laneEls = lanesRef.current?.querySelectorAll('[data-track]');
      if (laneEls) for (const el of Array.from(laneEls)) {
        const b = (el as HTMLElement).getBoundingClientRect();
        if (ev.clientY >= b.top && ev.clientY <= b.bottom) { track = (el as HTMLElement).dataset.track as TimelineTrack; break; }
      }
      moveClip(id, (mx - grab) / PXS, track);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const startTrim = (e: React.PointerEvent, id: string, edge: 'in' | 'out') => {
    e.stopPropagation();
    selectClip(id);
    const move = (ev: PointerEvent) => {
      const r = lanesRef.current?.getBoundingClientRect();
      const t = Math.max(0, (ev.clientX - (r?.left ?? 0)) / PXS);
      setClipInOut(id, edge, t);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const runExport = async (fmtKind: 'mp4' | 'fcpxml') => {
    const r = RES[aspect][Math.min(resIdx, RES[aspect].length - 1)];
    const payload = {
      clips: clips.filter(c => c.track === 'V1').map(c => ({ kind: c.kind, src: c.src, start: c.start, duration: c.duration })),
      width: r.w, height: r.h, fps: 30, projectName,
    };
    setBusy(fmtKind); setMsg(null);
    try {
      const res = fmtKind === 'mp4' ? await window.hjen.exportTimelineMp4(payload) : await window.hjen.exportTimelineFcpxml(payload);
      setMsg(res.ok ? `Exported → ${res.path.split('/').pop()}` : (res.reason === 'cancelled' ? null : `Export failed: ${res.message || res.reason}`));
      if (res.ok) setExportOpen(false);
    } catch (e: any) { setMsg(`Export failed: ${e?.message || e}`); }
    finally { setBusy(null); }
  };

  return (
    <div className="nv-edit">
      {/* Program monitor */}
      <div className="nv-edit__monitor">
        {active
          ? (active.kind === 'video' && active.src
              ? <video ref={videoRef} className="nv-edit__mvid" src={fileUrl(active.src)} muted playsInline />
              : (active.thumb ? <img className="nv-edit__mvid" src={active.thumb} alt="" /> : <div className="nv-edit__mempty">no preview</div>))
          : <div className="nv-edit__mempty">{v1.length ? 'move the playhead over a clip' : 'add clips on the canvas (＋ Timeline), then edit here'}</div>}
        <div className="nv-edit__tc mono-label">{tc(playhead)} / {tc(total)}</div>
      </div>

      {/* Transport */}
      <div className="nv-edit__transport">
        <div className="nv-edit__play">
          <button title="To start (Home)" onClick={() => { setPlaying(false); setPlayhead(0); }}>⏮</button>
          <button title="Shuttle reverse (J)" onClick={() => { setPlayRate(-2); setPlaying(true); }}>◀◀</button>
          <button className="nv-edit__playbtn" title="Play / pause (Space)" onClick={() => { if (!playing) setPlayRate(1); setPlaying(!playing); }}>{playing ? '⏸' : '▶'}</button>
          <button title="Shuttle forward (L)" onClick={() => { setPlayRate(2); setPlaying(true); }}>▶▶</button>
          <button title="To end (End)" onClick={() => { setPlaying(false); setPlayhead(total); }}>⏭</button>
        </div>
        <button className="nv-edit__tbtn" title="Split at playhead (C)" onClick={() => { const c = active ?? (selectedClipId ? clips.find(x => x.id === selectedClipId) : null); if (c) splitClip(c.id, playhead); }}>✂ Split</button>
        <button className={`nv-edit__tbtn ${snapping ? 'nv-edit__tbtn--on' : ''}`} title="Snapping (S)" onClick={toggleSnapping}>⌁ Snap</button>
        <button className="nv-edit__tbtn" title="Delete clip (⌫)" disabled={!selectedClipId} onClick={() => { if (selectedClipId) removeClip(selectedClipId); }}>✕ Clip</button>
        <span className="nv-edit__spacer" />
        <div className="nv-edit__exportwrap">
          <button className="nv-edit__tbtn nv-edit__tbtn--go" onClick={() => setExportOpen(o => !o)} title="Export (⌘M)">Export ▾</button>
          {exportOpen && (
            <>
              <div className="nv-edit__scrim" onClick={() => setExportOpen(false)} />
              <div className="nv-edit__exportpanel">
                <div className="nv-edit__exprow"><label>Aspect</label>
                  <select value={aspect} onChange={e => { setAspect(e.target.value); setResIdx(1); }}>{ASPECTS.map(a => <option key={a} value={a}>{a}</option>)}</select>
                </div>
                <div className="nv-edit__exprow"><label>Resolution</label>
                  <select value={resIdx} onChange={e => setResIdx(Number(e.target.value))}>{RES[aspect].map((r, i) => <option key={r.label} value={i}>{r.label} · {r.w}×{r.h}</option>)}</select>
                </div>
                <div className="nv-edit__expbtns">
                  <button className="btn-primary" disabled={!!busy} onClick={() => runExport('mp4')}>{busy === 'mp4' ? 'Rendering…' : 'Export MP4'}</button>
                  <button className="nv-edit__expxml" disabled={!!busy} onClick={() => runExport('fcpxml')}>{busy === 'fcpxml' ? '…' : 'Export XML'}</button>
                </div>
                <div className="nv-edit__expnote mono-label">MP4 via local ffmpeg · XML imports into Premiere/DaVinci</div>
              </div>
            </>
          )}
        </div>
        {msg && <span className="nv-edit__msg mono-label">{msg}</span>}
      </div>

      {/* Timeline */}
      <div className="nv-edit__grid">
        <div className="nv-edit__heads">
          <div className="nv-edit__rulerpad" />
          {TRACKS.map(t => (
            <div key={t} className="nv-edit__head" style={{ height: TRACK_H }}>
              <span className="nv-edit__headlabel">{t}</span>
              <span className="mono-label">{t.startsWith('A') ? '🔊' : '👁'}</span>
            </div>
          ))}
        </div>
        <div className="nv-edit__scroll">
          <div className="nv-edit__inner" style={{ width }}>
            <div className="nv-edit__ruler" onPointerDown={(e) => { setPlaying(false); scrubTo(e.clientX, e.currentTarget.getBoundingClientRect().left); }}>
              {Array.from({ length: Math.ceil(span / RULER_S) + 1 }).map((_, i) => (
                <span key={i} className="nv-edit__tick" style={{ left: i * RULER_S * PXS }}>{fmt(i * RULER_S)}</span>
              ))}
            </div>
            <div className="nv-edit__playhead" style={{ left: playhead * PXS }}
              onPointerDown={(e) => {
                e.stopPropagation(); setPlaying(false);
                const left = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect().left;
                const move = (ev: PointerEvent) => scrubTo(ev.clientX, left);
                const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
                window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
              }}><span className="nv-edit__playhead-grip" /></div>
            <div className="nv-edit__lanes" ref={lanesRef}>
              {TRACKS.map(t => (
                <div key={t} className="nv-edit__lane" data-track={t} style={{ height: TRACK_H }}>
                  {clips.filter(c => c.track === t).map(c => (
                    <div key={c.id}
                      className={`nv-editclip nv-editclip--${c.kind} ${selectedClipId === c.id ? 'nv-editclip--sel' : ''}`}
                      style={{ left: c.start * PXS, width: Math.max(30, c.duration * PXS) }}
                      onPointerDown={(e) => startClipDrag(e, c.id, c.start)}
                      title={`${c.label} · ${c.duration.toFixed(1)}s`}>
                      <span className="nv-editclip__trim nv-editclip__trim--l" onPointerDown={(e) => startTrim(e, c.id, 'in')} />
                      {c.thumb && <img className="nv-editclip__thumb" src={c.thumb} alt="" />}
                      <span className="nv-editclip__label">{c.label}</span>
                      <span className="nv-editclip__trim nv-editclip__trim--r" onPointerDown={(e) => startTrim(e, c.id, 'out')} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
