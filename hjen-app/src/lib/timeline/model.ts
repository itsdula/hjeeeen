// The timeline model — types and pure edits, no React, no DOM.
//
// This is deliberately its OWN model rather than a share with src/lib/cuts.
// CutsView's timeline looks similar and is not the same object: it has
// read-only analysis lanes over a master source video that owns the clock,
// while this one assembles references and has no master at all. Its 1873 lines
// are also a bug history written as comments, and persisted Cuts sessions on
// disk still carry the old `srcKind: 'frame' | 'video'` vocabulary. Unifying
// the two models is worth doing — as its own revertable version, not folded
// into a feature batch.
//
// Where a hard-won rule IS reused, the comment says which line it came from.

import type { PanelDocBase } from '../dock/usePanelDoc';

export type TrackKind = 'video' | 'audio';
export type ClipKind = 'video' | 'image' | 'audio';

export interface TlClip {
  id: string;
  kind: ClipKind;
  /** Absolute local path. */
  src: string;
  /** Poster path — ALWAYS an image. Never the media path for a video: an <img>
   *  cannot render an .mp4 (the trap CutsView.tsx:733-738 guards against). */
  thumb?: string;
  label?: string;
  /** Position on the timeline, frame-snapped. */
  start: number;
  /** Length on the timeline, frame-snapped. */
  dur: number;
  /** In-point into the SOURCE. srcTime(t) = srcIn + (t - start). */
  srcIn?: number;
  /** Full source length when known. Undefined for a still = trims unbounded. */
  srcDur?: number;
  /** Linear gain 0..1. Capped at 1 because HTMLMediaElement.volume is, and the
   *  preview must not promise something the render would have to invent. */
  gain?: number;
  /** Does the SOURCE FILE carry an audio stream? Probed on import. Load-bearing:
   *  the exporter must never reference [n:a] on a silent file — that aborts the
   *  whole render with a filter label error. */
  hasAudio?: boolean;
  /** A/V pair. Move, trim and delete act on both halves. */
  linkId?: string;
  /** Provenance back to the HuntedRef this came off the References grid as. */
  originRefId?: string;
}

export interface TlTrack {
  id: string;
  kind: TrackKind;
  label: string;
  /** A hidden video track is invisible; a hidden audio track is silent. */
  hidden?: boolean;
  locked?: boolean;
  clips: TlClip[];
}

export interface TlSequence extends PanelDocBase {
  version: 1;
  width: number;
  height: number;
  /** Integer only in v1 — 23.976 and 29.97 are silently wrong under the
   *  rational-time helper the FCPXML emitter uses, so they are not offered. */
  fps: number;
  /** BOTTOM-FIRST. Video tracks then audio tracks; index order IS z-order, so
   *  the LAST video track wins the composite. */
  tracks: TlTrack[];
  createdAt: string;
}

/** How long a still sits on the timeline when it is first dropped. */
export const DEFAULT_IMAGE_DUR = 4;
/** Shorter than this and a clip cannot be grabbed again. */
export const CLIP_MIN = 0.1;
export const FPS_CHOICES = [24, 25, 30, 50, 60];

const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;

/**
 * Every edit snaps to the frame grid.
 *
 * Without this the MP4 and the FCPXML disagree about where a cut is: the
 * shipped CutsView rounds to 0.01s, which is not a frame at any real rate.
 */
export const snap = (t: number, fps: number) => Math.round(t * fps) / fps;

export const clipEnd = (c: TlClip) => c.start + c.dur;

export function sequenceDuration(s: TlSequence): number {
  let end = 0;
  for (const t of s.tracks) for (const c of t.clips) end = Math.max(end, clipEnd(c));
  return end;
}

/** V2 over V1, A1 and A2 beneath. Bottom-first, so tracks[last] paints on top. */
export function defaultTracks(): TlTrack[] {
  return [
    { id: uid('trk'), kind: 'video', label: 'V1', clips: [] },
    { id: uid('trk'), kind: 'video', label: 'V2', clips: [] },
    { id: uid('trk'), kind: 'audio', label: 'A1', clips: [] },
    { id: uid('trk'), kind: 'audio', label: 'A2', clips: [] },
  ];
}

/** The blank a new sequence starts from. Built in the RENDERER — main only
 *  stamps identity — so the model has exactly one definition. */
export function blankSequence(): Partial<TlSequence> {
  return { version: 1, width: 1920, height: 1080, fps: 30, tracks: defaultTracks() };
}

export function newClipId(): string { return uid('clip'); }
export function newLinkId(): string { return uid('lnk'); }
export function newTrackId(): string { return uid('trk'); }

// ─── pure edits ─────────────────────────────────────────────────────────────

export function mapTrack(s: TlSequence, trackId: string, fn: (t: TlTrack) => TlTrack): TlSequence {
  return { ...s, tracks: s.tracks.map(t => (t.id === trackId ? fn(t) : t)) };
}

/** Clips are kept sorted by start so every reader can assume order. */
export function insertClip(s: TlSequence, trackId: string, clip: TlClip): TlSequence {
  return mapTrack(s, trackId, t => ({ ...t, clips: [...t.clips, clip].sort((a, b) => a.start - b.start) }));
}

export function patchClip(s: TlSequence, clipId: string, patch: Partial<TlClip>): TlSequence {
  return {
    ...s,
    tracks: s.tracks.map(t => {
      if (!t.clips.some(c => c.id === clipId)) return t;
      return { ...t, clips: t.clips.map(c => (c.id === clipId ? { ...c, ...patch } : c)).sort((a, b) => a.start - b.start) };
    }),
  };
}

/** Remove clips by id, and anything linked to them: an A/V pair is one object
 *  to the hand even though it is two clips on two tracks. */
export function removeClips(s: TlSequence, ids: string[]): TlSequence {
  const kill = new Set(ids);
  const links = new Set<string>();
  for (const t of s.tracks) for (const c of t.clips) if (kill.has(c.id) && c.linkId) links.add(c.linkId);
  return {
    ...s,
    tracks: s.tracks.map(t => ({
      ...t,
      clips: t.clips.filter(c => !kill.has(c.id) && !(c.linkId && links.has(c.linkId))),
    })),
  };
}

/** Every clip sharing a linkId with one of `ids` — used so a move drags the
 *  pair, not half of it. */
export function linkedIds(s: TlSequence, ids: string[]): string[] {
  const seed = new Set(ids);
  const links = new Set<string>();
  for (const t of s.tracks) for (const c of t.clips) if (seed.has(c.id) && c.linkId) links.add(c.linkId);
  const out = new Set(ids);
  for (const t of s.tracks) for (const c of t.clips) if (c.linkId && links.has(c.linkId)) out.add(c.id);
  return [...out];
}

/**
 * The trim clamp — the ONE definition.
 *
 * Descends from CutsView.tsx:846-861, with one deliberate difference: a still
 * has no source to run out of, so `srcDur === undefined` means the right handle
 * pulls as far as you like. A video is clamped to what the file actually has,
 * because the alternative is a render that freezes on the last frame while the
 * timeline claims there is picture there.
 */
export function applyTrim(
  c: TlClip,
  mode: 'trim-l' | 'trim-r',
  deltaT: number,
  fps: number,
): Pick<TlClip, 'start' | 'dur' | 'srcIn'> {
  const srcIn0 = c.srcIn ?? 0;
  if (mode === 'trim-l') {
    // The left handle moves the in-point and the position together, so the
    // frame under the handle stays under the handle.
    const maxRight = c.dur - CLIP_MIN;                       // cannot pass its own tail
    const maxLeft = c.srcDur === undefined ? Infinity : srcIn0;   // cannot start before the file does
    const d = snap(Math.max(-maxLeft, Math.min(maxRight, deltaT)), fps);
    return { start: snap(c.start + d, fps), dur: snap(c.dur - d, fps), srcIn: snap(srcIn0 + d, fps) };
  }
  const room = c.srcDur === undefined ? Infinity : c.srcDur - srcIn0;
  const dur = snap(Math.max(CLIP_MIN, Math.min(room, c.dur + deltaT)), fps);
  return { start: c.start, dur, srcIn: srcIn0 };
}

/** Split every clip covering `t`, keeping links intact so an A/V pair cuts as
 *  one. Returns the sequence unchanged if nothing sits under the playhead. */
export function splitAt(s: TlSequence, t: number): TlSequence {
  const at = snap(t, s.fps);
  let cut = false;
  const tracks = s.tracks.map(track => {
    if (track.locked) return track;
    const clips: TlClip[] = [];
    for (const c of track.clips) {
      if (at > c.start + CLIP_MIN / 2 && at < clipEnd(c) - CLIP_MIN / 2) {
        cut = true;
        const leftDur = snap(at - c.start, s.fps);
        clips.push({ ...c, dur: leftDur });
        clips.push({
          ...c, id: newClipId(),
          start: at, dur: snap(c.dur - leftDur, s.fps),
          srcIn: snap((c.srcIn ?? 0) + leftDur, s.fps),
        });
      } else clips.push(c);
    }
    return { ...track, clips };
  });
  return cut ? { ...s, tracks } : s;
}

/** The audio track a video track's sound should land on: the first audio track
 *  with room at that time, else the first audio track at all. Mirrors the
 *  intent of CutsView.tsx:750-755, which also un-hides its destination. */
export function audioTrackFor(s: TlSequence, start: number, dur: number): TlTrack | null {
  const audio = s.tracks.filter(t => t.kind === 'audio' && !t.locked);
  if (!audio.length) return null;
  const free = audio.find(t => !t.clips.some(c => start < clipEnd(c) - 1e-6 && start + dur > c.start + 1e-6));
  return free ?? audio[0];
}
