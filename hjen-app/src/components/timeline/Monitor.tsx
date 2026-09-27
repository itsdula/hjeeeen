// The preview monitor.
//
// Honest about what it is: two stacked HTML elements, not a compositor. The
// topmost visible video clip paints over the one beneath it, which is enough
// for "V2 over V1" and nothing more — no blending, no transforms in the render,
// no transitions. The exporter is the authority; this is the reading room.
//
// Video seeking is a real cost in an element-based preview, so it follows the
// same discipline CutsView settled on: align the element once when the clip or
// the play state changes, and hard-seek only while paused or scrubbing. A
// per-frame currentTime write makes Chromium drop back to keyframes and the
// picture stutters.

import { useEffect, useRef } from 'react';
import { hjenFileUrl } from '../../lib/theme/apply';
import { srcTimeAt } from '../../lib/timeline/query';
import type { TlClip } from '../../lib/timeline/model';

function Layer({ clip, playhead, playing, className }: {
  clip: TlClip;
  playhead: number;
  playing: boolean;
  className: string;
}) {
  const vRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const v = vRef.current;
    if (!v) return;
    try { v.currentTime = srcTimeAt(clip, playhead); } catch { /* not ready yet */ }
    if (playing) void v.play().catch(() => { /* codec or autoplay policy */ });
    else v.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.id, playing]);

  useEffect(() => {
    if (playing) return;
    const v = vRef.current;
    if (!v) return;
    const t = srcTimeAt(clip, playhead);
    if (Math.abs(v.currentTime - t) > 0.06) { try { v.currentTime = t; } catch { /* ignore */ } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playhead, playing, clip.id, clip.srcIn, clip.start]);

  if (clip.kind === 'image') {
    return <img className={className} src={hjenFileUrl(clip.src)} alt="" draggable={false} />;
  }
  return (
    <video
      ref={vRef}
      className={className}
      src={hjenFileUrl(clip.src)}
      muted                    /* sound comes from the audio tracks, never from here */
      playsInline
      preload="auto"
      // The poster is the honest fallback when Chromium cannot decode the
      // codec — a black rectangle reads as "the app is broken", a frame reads
      // as "this clip will not preview here".
      poster={clip.thumb ? hjenFileUrl(clip.thumb) : undefined}
    />
  );
}

export function Monitor({ top, under, playhead, playing, width, height }: {
  top: TlClip | null;
  under: TlClip | null;
  playhead: number;
  playing: boolean;
  width: number;
  height: number;
}) {
  return (
    <div className="tlw-mon">
      <div className="tlw-mon__frame" style={{ aspectRatio: `${width} / ${height}` }}>
        {under && <Layer clip={under} playhead={playhead} playing={playing} className="tlw-mon__layer" />}
        {top && <Layer clip={top} playhead={playhead} playing={playing} className="tlw-mon__layer" />}
        {!top && !under && (
          // Black, and say why — an empty monitor that looks broken is worse
          // than an empty monitor that explains itself.
          <div className="tlw-mon__blank">
            <span className="mono-label">NOTHING AT THE PLAYHEAD</span>
          </div>
        )}
      </div>
    </div>
  );
}
