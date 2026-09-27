// A scoped <audio> for one audio clip that covers the playhead.
//
// Copied from CutsView.tsx:55-104 with its comments intact, plus a per-clip
// gain. It is copied rather than shared because CutsView is 1873 lines of
// shipped code whose comments are its bug history, and moving pieces out of it
// belongs to its own revertable version — but the two fixes below were paid for
// in real debugging and must not be re-derived, so they travel verbatim.
//
// It plays NATIVELY in sync with the transport (aligned once on mount / play
// flip; hard-seek only while paused or scrubbing — no per-frame seek). Mounted
// only while its clip covers the playhead on a visible track, so a hidden track
// never renders one and is therefore silent.

import { useEffect, useRef } from 'react';

export function ClipAudio({ src, clipStart, srcIn, playhead, playing, muted, gain }: {
  src: string;
  clipStart: number;
  srcIn: number;
  playhead: number;
  playing: boolean;
  muted: boolean;
  gain: number;
}) {
  const ref = useRef<HTMLAudioElement | null>(null);
  // Source media time at the playhead honours the clip's trimmed in-point.
  const targetT = () => Math.max(0, srcIn + (playhead - clipStart));

  // Strictly bound to the transport: play only when playing and unmuted.
  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    a.muted = muted;
    let cancelled = false;
    const apply = () => {
      if (cancelled) return;
      try { a.currentTime = targetT(); } catch { /* ignore */ }
      if (playing && !muted) void a.play().catch(() => { /* codec or autoplay policy */ });
      else a.pause();
    };
    if (a.readyState >= 1) apply();
    else a.addEventListener('loadedmetadata', apply, { once: true });
    // Cancel a deferred play and drop the listener when deps change or on
    // unmount, so a late-loading element can never start after the transport
    // has already moved on.
    return () => { cancelled = true; a.removeEventListener('loadedmetadata', apply); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, muted, srcIn, clipStart]);

  // Scrubbing: follow the playhead, but only when the drift is audible.
  useEffect(() => {
    if (playing) return;
    const a = ref.current;
    if (!a) return;
    const t = targetT();
    if (Math.abs(a.currentTime - t) > 0.12) { try { a.currentTime = t; } catch { /* ignore */ } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playhead, playing, clipStart, srcIn]);

  // HTMLMediaElement.volume is 0..1, which is why the model caps gain at 1: the
  // preview must not promise a level the render would have to invent.
  useEffect(() => {
    const a = ref.current;
    if (a) a.volume = Math.max(0, Math.min(1, gain));
  }, [gain]);

  // On a REAL unmount (the clip was scrubbed past, or removed) the <audio>
  // detaches — and a detached media element keeps playing in Chromium, so pause
  // it so sound truly stops and the transport stays authoritative.
  // IMPORTANT: do NOT removeAttribute('src') / load() here. Under React
  // StrictMode the mount effect runs setup → cleanup → setup on the SAME live
  // element, so stripping the src would leave the <audio> permanently
  // source-less (readyState 0) and silent — that silenced every dropped clip.
  // pause() alone stops a detached element without destroying the React-managed
  // src.
  useEffect(() => {
    const a = ref.current;
    return () => { try { a?.pause(); } catch { /* ignore */ } };
  }, []);

  return <audio ref={ref} src={src} className="tlw-aud" preload="auto" />;
}
