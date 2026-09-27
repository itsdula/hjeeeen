// Flatten a sequence into what the exporters take.
//
// One definition, used by BOTH the MP4 render and the FCPXML write, so the two
// can never disagree about which clips exist, where they sit, or how long the
// piece is.

import { clipEnd, snap, sequenceDuration, type TlSequence } from './model';

export interface ExportClipSpec {
  kind: 'video' | 'image' | 'audio';
  src: string;
  start: number;
  dur: number;
  srcIn: number;
  gain: number;
  hasAudio: boolean;
  /** 0 = the bottom video track, 1..n above it; negative = an audio track. */
  lane: number;
  label?: string;
}

export interface ExportSpec {
  clips: ExportClipSpec[];
  width: number;
  height: number;
  fps: number;
  total: number;
  /** Clips dropped from the spec, and why — so the UI can SAY what it left out
   *  instead of silently rendering less than the user sees. */
  dropped: Array<{ label: string; reason: string }>;
}

export function toExportSpec(seq: TlSequence): ExportSpec {
  const fps = seq.fps;
  const clips: ExportClipSpec[] = [];
  const dropped: ExportSpec['dropped'] = [];

  // Tracks are stored bottom-first, so a video track's index IS its lane, and
  // the last one wins the composite.
  let videoLane = 0;
  let audioLane = -1;
  for (const t of seq.tracks) {
    const lane = t.kind === 'video' ? videoLane++ : audioLane--;
    if (t.hidden) {
      for (const c of t.clips) {
        dropped.push({ label: c.label || c.src.split('/').pop() || 'clip', reason: t.kind === 'audio' ? 'track silenced' : 'track hidden' });
      }
      continue;
    }
    for (const c of t.clips) {
      const name = c.label || c.src.split('/').pop() || 'clip';
      if (!c.src) { dropped.push({ label: name, reason: 'no file' }); continue; }
      // A clip on an audio lane whose file has no audio stream must never reach
      // the filter graph: referencing [n:a] on a silent file aborts the whole
      // render with a label error.
      if (lane < 0 && c.hasAudio === false) { dropped.push({ label: name, reason: 'file has no sound' }); continue; }
      clips.push({
        kind: lane < 0 ? 'audio' : (c.kind === 'audio' ? 'audio' : c.kind),
        src: c.src,
        start: snap(Math.max(0, c.start), fps),
        dur: snap(Math.max(1 / fps, c.dur), fps),
        srcIn: snap(Math.max(0, c.srcIn ?? 0), fps),
        gain: Math.max(0, Math.min(1, c.gain ?? 1)),
        hasAudio: c.hasAudio !== false,
        lane,
        label: name,
      });
    }
  }

  clips.sort((a, b) => (a.lane - b.lane) || (a.start - b.start));
  // Measure the piece from what will actually be RENDERED, not from what is on
  // the timeline: a hidden tail track must not pad the file with black.
  const total = snap(clips.reduce((m, c) => Math.max(m, c.start + c.dur), 0), fps);
  return { clips, width: seq.width, height: seq.height, fps, total, dropped };
}

/** The full timeline length including hidden tracks — what the ruler shows. */
export const timelineLength = (seq: TlSequence) => sequenceDuration(seq);

export { clipEnd };
