// Reading a sequence at a moment in time — pure, so the monitor, the exporter
// and the transport all agree about what is on screen at t.

import { clipEnd, type TlClip, type TlSequence, type TlTrack } from './model';

export interface ClipAt { track: TlTrack; clip: TlClip }

const covers = (c: TlClip, t: number) => t >= c.start && t < clipEnd(c);

/**
 * The topmost VISIBLE video clip at t.
 *
 * Tracks are stored bottom-first, so the LAST match wins — the same rule
 * CutsView.tsx:917-928 follows. A hidden track is not a candidate at all.
 */
export function topVideoClipAt(s: TlSequence, t: number): ClipAt | null {
  let found: ClipAt | null = null;
  for (const track of s.tracks) {
    if (track.kind !== 'video' || track.hidden) continue;
    const clip = track.clips.find(c => covers(c, t));
    if (clip) found = { track, clip };
  }
  return found;
}

/** The clip directly BENEATH the topmost one — the second layer the monitor
 *  keeps warm so a cut between tracks does not flash black. */
export function underVideoClipAt(s: TlSequence, t: number, above: TlClip): ClipAt | null {
  let found: ClipAt | null = null;
  for (const track of s.tracks) {
    if (track.kind !== 'video' || track.hidden) continue;
    const clip = track.clips.find(c => covers(c, t));
    if (!clip) continue;
    if (clip.id === above.id) break;      // reached the top layer — stop
    found = { track, clip };
  }
  return found;
}

/** Every audible clip at t. A hidden audio track is silent, not merely dimmed. */
export function activeAudioClipsAt(s: TlSequence, t: number): ClipAt[] {
  const out: ClipAt[] = [];
  for (const track of s.tracks) {
    if (track.hidden) continue;
    for (const clip of track.clips) {
      if (!covers(clip, t)) continue;
      // A video clip on a VIDEO track is silent here: its sound, if it has any,
      // came down as a linked clip on an audio track. Routing both would double
      // the audio — the trap CutsView.tsx:979-981 records.
      if (track.kind === 'audio') out.push({ track, clip });
    }
  }
  return out;
}

/** Where in the SOURCE file timeline-time t lands for this clip. */
export const srcTimeAt = (c: TlClip, t: number) => Math.max(0, (c.srcIn ?? 0) + (t - c.start));

/** The next clip edge strictly after t on any visible video track — what the
 *  monitor pre-rolls toward, and where ⇥ jumps. */
export function nextEdgeAfter(s: TlSequence, t: number): number | null {
  let best = Infinity;
  for (const track of s.tracks) {
    for (const c of track.clips) {
      if (c.start > t + 1e-6) best = Math.min(best, c.start);
      if (clipEnd(c) > t + 1e-6) best = Math.min(best, clipEnd(c));
    }
  }
  return Number.isFinite(best) ? best : null;
}

export function prevEdgeBefore(s: TlSequence, t: number): number | null {
  let best = -Infinity;
  for (const track of s.tracks) {
    for (const c of track.clips) {
      if (c.start < t - 1e-6) best = Math.max(best, c.start);
      if (clipEnd(c) < t - 1e-6) best = Math.max(best, clipEnd(c));
    }
  }
  return Number.isFinite(best) ? best : null;
}

/** Does placing [start, start+dur) on this track collide with what is there? */
export function overlaps(track: TlTrack, start: number, dur: number, ignoreId?: string): boolean {
  return track.clips.some(c =>
    c.id !== ignoreId && start < clipEnd(c) - 1e-6 && start + dur > c.start + 1e-6);
}

/** First free slot at or after `start` on this track, so a drop onto a busy
 *  spot slides right instead of silently landing on top of something. */
export function firstFreeAt(track: TlTrack, start: number, dur: number): number {
  let t = start;
  const sorted = [...track.clips].sort((a, b) => a.start - b.start);
  for (const c of sorted) {
    if (t + dur <= c.start + 1e-6) return t;
    if (t < clipEnd(c)) t = clipEnd(c);
  }
  return t;
}
