// One box on the mood board — a picture, a moving picture, or a note.
//
// The item never decides where it is; the canvas does. It only knows how to
// paint itself, report its intrinsic aspect once, and expose eight handles when
// it is the one thing selected.

import { useEffect, useRef } from 'react';
import { hjenFileUrl } from '../../lib/theme/apply';
import { HANDLES, type Handle } from '../../lib/moodboard/geometry';
import type { MoodItem } from '../../types/moodboard';

/** Below this the picture is a thumbnail — playing video there costs a decoder
 *  for something nobody can read. A board of forty clips would melt. */
const MOTION_MIN_SCALE = 0.4;

export function MoodItemView({ item, selected, only, scale, onGrab, onResize, onCaption, onNaturalSize }: {
  item: MoodItem;
  selected: boolean;
  /** Handles show only when this is the single selection — eight dots on every
   *  box of a twelve-box marquee is noise, not affordance. */
  only: boolean;
  scale: number;
  onGrab: (e: React.PointerEvent) => void;
  onResize: (e: React.PointerEvent, handle: Handle) => void;
  onCaption: (text: string) => void;
  onNaturalSize: (aspect: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Motion is paused when the box is too small to read, and resumed when it
  // grows back. Cheap, and it keeps a big board responsive.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (scale >= MOTION_MIN_SCALE) { v.play().catch(() => { /* codec or autoplay policy */ }); }
    else { try { v.pause(); } catch { /* fine */ } }
  }, [scale]);

  const media = item.kind === 'note' ? null
    : item.kind === 'video' ? (
      <video
        ref={videoRef}
        className="mb-item__media"
        src={hjenFileUrl(item.src)}
        muted
        loop
        playsInline
        preload="metadata"
        onLoadedMetadata={e => {
          const v = e.currentTarget;
          if (!item.aspect && v.videoWidth && v.videoHeight) onNaturalSize(v.videoWidth / v.videoHeight);
        }}
      />
    ) : (
      <img
        className="mb-item__media"
        src={hjenFileUrl(item.src)}
        alt={item.tag || ''}
        draggable={false}
        decoding="async"
        onLoad={e => {
          // Real pixels, not a header sniff: hjen:image-dims cannot read AVIF,
          // which the hunt downloader really does write. Chromium decoded it
          // anyway, so naturalWidth is both free and format-complete.
          const el = e.currentTarget;
          if (!item.aspect && el.naturalWidth && el.naturalHeight) {
            onNaturalSize(el.naturalWidth / el.naturalHeight);
          }
        }}
      />
    );

  return (
    <div
      className={`mb-item mb-item--${item.kind}${selected ? ' is-sel' : ''}`}
      style={{ left: item.x, top: item.y, width: item.w, height: item.h, zIndex: item.z }}
      onPointerDown={onGrab}
    >
      {media}

      {item.kind === 'note' ? (
        <textarea
          className="mb-note__text"
          value={item.caption ?? ''}
          placeholder="Write it down…"
          spellCheck
          onChange={e => onCaption(e.target.value)}
          // A note is a text field first: let the caret and the selection work
          // without the canvas stealing the gesture for a drag.
          onPointerDown={e => e.stopPropagation()}
        />
      ) : item.caption ? (
        <span className="mb-item__caption">{item.caption}</span>
      ) : null}

      {selected && only && HANDLES.map(h => (
        <span
          key={h}
          className={`mb-h mb-h--${h}`}
          onPointerDown={e => onResize(e, h)}
          // Handles keep a constant SCREEN size: a grab target that shrinks
          // with the zoom is unusable at 20%.
          style={{ transform: `scale(${1 / scale})` }}
        />
      ))}
    </div>
  );
}
