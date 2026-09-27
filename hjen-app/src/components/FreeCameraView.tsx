import { useRef } from 'react';
import { useStore } from '../store';
import '../styles/freecam.css';

/**
 * Free Camera — direct the camera inside a 3D Gaussian-Splatting scene, then
 * lock the chosen angle onto gpt-image-2 with HJEN DNA.
 *
 * Pipeline (backend = STUDY/freecam_kiri):
 *   1. shots/video  → KIRI Engine API → splat (.ply)        [freecam.py]
 *   2. open .ply in the embedded viewer → orbit → Capture    [this view]
 *   3. frame + canny(+depth) → gpt-image-2 → DNA finish      [lock.py]
 *
 * The viewer is the self-contained page at public/freecam/index.html (WebGL,
 * no GPU train). Running the Python backend from the UI is the next
 * integration step (Electron IPC); for now the commands are shown to run.
 */
export function FreeCameraView() {
  const setActiveView = useStore(s => s.setActiveView);
  const frameRef = useRef<HTMLIFrameElement>(null);

  const capture = () => frameRef.current?.contentWindow?.postMessage('hjen:capture', '*');

  return (
    <div className="freecam">
      <header className="freecam__bar">
        <button className="freecam__back" onClick={() => setActiveView('studio')}>← Studio</button>
        <div className="freecam__title">
          <span className="freecam__pip" />Free Camera
          <small>Direct the camera inside the scene · lock the angle</small>
        </div>
        <span className="freecam__tag mono-label">KIRI · 3DGS · gpt-image-2</span>
      </header>

      <div className="freecam__body">
        <div className="freecam__stage">
          <iframe
            ref={frameRef}
            className="freecam__viewer"
            src="freecam/index.html"
            title="HJEN Free Camera viewer"
          />
          <button className="freecam__capture" onClick={capture}>● Capture frame</button>
        </div>

        <aside className="freecam__side">
          <h3>The pipeline</h3>

          <div className="freecam__step">
            <span className="freecam__no">01</span>
            <div>
              <b>Build the splat</b>
              <p>20–300 photos (or a video) of one place → KIRI → <code>.ply</code>.</p>
              <pre>python3 freecam.py make --images ./shots --type 3dgs --mesh --out ./out</pre>
            </div>
          </div>

          <div className="freecam__step">
            <span className="freecam__no">02</span>
            <div>
              <b>Pick the angle</b>
              <p>Open the <code>.ply</code> in the viewer, orbit to your shot, hit Capture →
                downloads <code>frame.png</code> + <code>camera.json</code>.</p>
            </div>
          </div>

          <div className="freecam__step">
            <span className="freecam__no">03</span>
            <div>
              <b>Lock + DNA finish</b>
              <p>Frame → canny(+depth) → gpt-image-2 in the Clay&nbsp;&amp;&nbsp;Basil grade,
                angle held.</p>
              <pre>python3 lock.py --frame ./out/frame_*.png --out ./out</pre>
            </div>
          </div>

          <div className="freecam__note">
            Backend: <code>02_PRODUCT/desktop_app/STUDY/freecam_kiri</code>.
            Cloud step (KIRI) — keep NDA material on the local NVIDIA path.
          </div>
        </aside>
      </div>
    </div>
  );
}
