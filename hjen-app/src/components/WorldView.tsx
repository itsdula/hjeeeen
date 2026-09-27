import { useEffect, useRef, useState, useCallback } from 'react';
import { useStore } from '../store';
import type { ProjectFileEntry } from '../types/hjen-bridge';
import '../styles/world.css';

const hjenUrl = (p: string) => `hjen-file://${encodeURI(p)}`;

/**
 * HJEN SET — build a navigable world from one image, fly a focal-true camera
 * (full-frame 36×24 sensor), and lock the angle into a finished frame.
 *
 * Local tier (this view): image → monocular depth (Python sidecar,
 * Depth-Anything-V2-Small) → world/index.html displaces it into a pocket world
 * you orbit/dolly. "Lock Angle" captures an Angle Pack (plate + camera.json +
 * prompt) and finishes it on gpt-image-2 in the Clay & Basil DNA, angle held.
 * Cloud tier (HunyuanWorld, full 360° world) is a later slice.
 */
const PRIMES = [24, 35, 50, 85, 135] as const;
const SHOTS = ['ECU', 'CU', 'MCU', 'MS', 'MLS', 'LS', 'WS'] as const;
const ANGLES: Record<string, string> = { EL: 'Eye', HA: 'High', LA: 'Low', OH: 'Over', WE: 'Worm' };
const MOVES = ['push-in', 'pull-out', 'orbit-l', 'orbit-r', 'crane-up', 'tilt-down'] as const;

/** Turn raw sidecar/OpenAI errors into a one-line, human message. */
function humanError(msg: string): string {
  const m = (msg || '').toLowerCase();
  if (m.includes('billing_hard_limit') || m.includes('billing hard limit')) return 'OpenAI billing limit reached — raise your hard limit in the OpenAI dashboard, then try again.';
  if (m.includes('no openai api key') || m.includes('openai_api_key')) return 'No OpenAI API key. Add it in Settings.';
  if (m.includes('rate limit') || m.includes('429')) return 'OpenAI rate limit — wait a moment and try again.';
  if (m.includes('moderation') || m.includes('safety')) return 'The image was rejected by content moderation. Try a different frame.';
  if (m.includes('no python') || m.includes('depth model')) return 'Depth engine not found — the Python world-kit venv is missing.';
  return msg.length > 160 ? msg.slice(0, 160) + '…' : msg;
}

export function WorldView() {
  const setActiveView = useStore(s => s.setActiveView);
  const activeProject = useStore(s => s.activeProject());
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [phase, setPhase] = useState<'idle' | 'building' | 'ready' | 'error'>('idle');
  const [status, setStatus] = useState('Drop an image, or pick one, to build the world');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [worldDir, setWorldDir] = useState<string | null>(null);
  const [focal, setFocal] = useState(35);
  const [lastPack, setLastPack] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [locked, setLocked] = useState<string | null>(null);
  const [history, setHistory] = useState<ProjectFileEntry[]>([]);

  const post = useCallback((cmd: string, extra: Record<string, unknown> = {}) => {
    frameRef.current?.contentWindow?.postMessage({ cmd, ...extra }, '*');
  }, []);

  // Load this project's past generations (world outputs + everything else),
  // newest first, for the left gallery. Refreshed after each lock.
  const loadHistory = useCallback(async () => {
    try {
      const files = await window.hjen.listProjectFiles({ projectSlug: activeProject?.slug ?? null });
      setHistory((files || []).sort((a, b) => b.ts - a.ts));
    } catch { setHistory([]); }
  }, [activeProject?.slug]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  // depth progress from main
  useEffect(() => {
    const off = window.hjen.onWorldProgress?.((_e, d) => { if (d.worldId !== 'finish') setStatus(d.line || 'Building…'); });
    return () => { off?.(); };
  }, []);

  // capture-result + world-ready from the viewer
  useEffect(() => {
    const onMsg = async (e: MessageEvent) => {
      const m = e.data;
      if (!m || !m.type) return;
      if (m.type === 'hjen:world-ready') {
        setPhase(m.data?.ok ? 'ready' : 'error');
        setStatus(m.data?.ok ? 'World ready — fly the camera' : 'Could not build the world');
      }
      if (m.type === 'hjen:capture-result' && worldDir) {
        setLocked(null); setErrorMsg(null);
        const r = await window.hjen.worldPackSave({ dir: worldDir, pngDataUrl: m.data.png, camera: m.data.camera, prompt: m.data.prompt });
        if (!r.ok) { setErrorMsg(humanError(r.message)); setStatus('Could not save the Angle Pack'); return; }
        setLastPack(r.packDir);
        // finish the pack on gpt-image-2 in the Clay & Basil DNA, angle held
        setFinishing(true); setStatus('Finishing in Clay & Basil DNA…');
        const f = await window.hjen.worldFinish({ platePath: r.platePath, outDir: r.packDir, quality: 'high' });
        setFinishing(false);
        if (f.ok) {
          setLocked(`${f.lockedUrl}?t=${Date.now()}`);
          setStatus('Angle locked — final frame ready');
          // save into the active project so it lands in the Library + left gallery
          if (f.lockedBase64) {
            try {
              await window.hjen.saveGeneration({
                base64: f.lockedBase64,
                promptSlug: 'world-' + ((m.data.camera?.vocab?.shot_size || 'shot').toLowerCase()),
                projectSlug: activeProject?.slug,
                projectId: activeProject?.id,
                sidecar: {
                  captured: new Date().toISOString(),
                  tool: 'world',
                  prompt: m.data.prompt,
                  camera: m.data.camera,
                  model: 'HJEN SET · depth-world → gpt-image-2',
                  apiModelId: 'gpt-image-2',
                  project: activeProject ? { id: activeProject.id, name: activeProject.name, slug: activeProject.slug } : null,
                },
              });
              loadHistory();
            } catch { /* non-fatal */ }
          }
        }
        else { setErrorMsg(humanError(f.message)); setStatus('Angle Pack saved — finish failed'); }
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [worldDir, activeProject?.slug, activeProject?.id, loadHistory]);

  const buildFrom = useCallback(async (imagePath: string) => {
    setPhase('building'); setStatus('Extracting depth…'); setErrorMsg(null); setWorldDir(null); setLastPack(null); setLocked(null);
    const r = await window.hjen.worldDepth({ imagePath, size: 1536 });
    if (!r.ok) { setPhase('error'); setErrorMsg(humanError(r.message)); setStatus('Could not build the world'); return; }
    setWorldDir(r.dir);
    const src = `world/index.html?img=${encodeURIComponent(r.imgUrl)}&depth=${encodeURIComponent(r.depthUrl)}&hfov=60&zn=1.6&zf=120`;
    if (frameRef.current) frameRef.current.src = src;
  }, []);

  const pick = useCallback(async () => {
    const p = await window.hjen.pickImage({ title: 'Choose an image to build the world' });
    if (p) buildFrom(p);
  }, [buildFrom]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0] as (File & { path?: string }) | undefined;
    if (f?.path) buildFrom(f.path);
  }, [buildFrom]);

  const dial = (mm: number) => { setFocal(mm); post('setFocal', { mm }); };

  return (
    <div className="world" onDragOver={e => e.preventDefault()} onDrop={onDrop}>
      <header className="world__bar">
        <button className="world__back" onClick={() => setActiveView('studio')}>← Studio</button>
        <div className="world__title">
          <span className="world__pip" />HJEN SET
          <small>Build a world from one image · fly the camera · lock the angle</small>
        </div>
        <span className="world__tier">Local · NDA safe</span>
      </header>

      <div className="world__body">
        <aside className="world__history">
          <div className="world__proj">
            <span className="world__projlabel">Project</span>
            <b>{activeProject?.name || 'No project — general'}</b>
          </div>
          <div className="world__histhead">Frames <span>{history.length}</span></div>
          <div className="world__histgrid">
            {history.length === 0 && <div className="world__histempty">Locked frames land here.</div>}
            {history.map(f => (
              <button key={f.imgPath} className="world__histitem" title={f.promptTitle}
                onClick={() => window.hjen.openFolder(f.imgPath)}>
                <img src={hjenUrl(f.thumbPath || f.imgPath)} alt={f.promptTitle} loading="lazy" />
              </button>
            ))}
          </div>
        </aside>

        <div className="world__stage">
          {phase === 'idle' && (
            <div className="world__drop">
              <div className="world__dropinner">
                <b>Drop an image here</b>
                <p>or</p>
                <button className="world__primary" onClick={pick}>Choose image</button>
              </div>
            </div>
          )}
          {phase !== 'idle' && (
            <iframe ref={frameRef} className="world__viewer" title="HJEN SET world viewer" />
          )}
          {phase === 'building' && <div className="world__overlay">{status}</div>}
        </div>

        <aside className="world__side">
          <div className="world__status">{status}</div>
          {errorMsg && <div className="world__error">{errorMsg}</div>}

          <h3>Lens</h3>
          <div className="world__row">
            {PRIMES.map(mm => (
              <button key={mm} className={`world__chip ${focal === mm ? 'on' : ''}`} disabled={phase !== 'ready'} onClick={() => dial(mm)}>{mm}mm</button>
            ))}
          </div>

          <h3>Shot size</h3>
          <div className="world__row">
            {SHOTS.map(s => (
              <button key={s} className="world__chip" disabled={phase !== 'ready'} onClick={() => post('shotAssist', { shot: s, mm: focal, angle: 'EL' })}>{s}</button>
            ))}
          </div>

          <h3>Angle</h3>
          <div className="world__row">
            {Object.entries(ANGLES).map(([code, label]) => (
              <button key={code} className="world__chip" disabled={phase !== 'ready'} onClick={() => post('shotAssist', { shot: 'MS', mm: focal, angle: code })}>{label}</button>
            ))}
          </div>

          <h3>Move</h3>
          <div className="world__row">
            {MOVES.map(id => (
              <button key={id} className="world__chip" disabled={phase !== 'ready'} onClick={() => post('move', { id, t: 1 })}>{id}</button>
            ))}
            <button className="world__chip" disabled={phase !== 'ready'} onClick={() => post('reset')}>reset</button>
          </div>

          <div className="world__actions">
            <button className="world__lock" disabled={phase !== 'ready' || finishing} onClick={() => post('capture')}>
              {finishing ? 'Finishing…' : '● Lock Angle'}
            </button>
          </div>
          {locked && (
            <div className="world__result">
              <img src={locked} alt="final locked frame" />
              <div className="world__resultcap">Final frame · Clay &amp; Basil DNA</div>
            </div>
          )}
          {lastPack && <div className="world__pack">Angle Pack → <code>{lastPack.split('/').slice(-3).join('/')}</code><br /><small>plate · camera.json · prompt · _locked.png</small></div>}

          <div className="world__note">
            Local tier: image → depth (MPS) → a pocket world you fly ±15°. The cloud tier (HunyuanWorld, full 360° world) is next.
          </div>
        </aside>
      </div>
    </div>
  );
}
