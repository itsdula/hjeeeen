// Getting media onto a track — one definition of the drag payload and one
// ladder for reading it back.
//
// Four things can drop onto this timeline, and each arrives differently:
//   1 · a Mood Board item or a Takes clip  → our own MIME on dataTransfer
//   2 · a References tile                  → the module singleton, because that
//       drag preventDefault()s so a NATIVE file drag can take over
//   3 · Finder, or a tile dragged into a detached window → dataTransfer.files
//   4 · a URL dropped from a browser       → text/uri-list, local files only

import { takeRefDragPayload } from '../dock/dragPayload';
import type { ClipKind } from './model';

/** This app's media drag. */
export const MIME_MEDIA = 'application/x-hjen-media';
/** The Takes gallery already emits this one (CutsGenPanel.tsx:396) — reading it
 *  too means a Take drops onto this timeline for free. */
export const MIME_CUTCLIP = 'application/x-cut-clip';

export interface MediaDragPayload {
  kind: ClipKind;
  src: string;
  /** An IMAGE poster only — never the media path for a video. */
  thumb?: string;
  label?: string;
  /** Known media length, when the source already knows it. */
  dur?: number;
  originRefId?: string;
}

const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|flac|ogg|aif|aiff)$/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|tiff?|heic|avif|bmp)$/i;

export function classifyPath(p: string): ClipKind | null {
  if (!p) return null;
  if (VIDEO_EXT.test(p)) return 'video';
  if (AUDIO_EXT.test(p)) return 'audio';
  if (IMAGE_EXT.test(p)) return 'image';
  return null;
}

/** A thumb is only usable as a poster if an <img> can actually render it. */
export function isImageThumb(thumb?: string): boolean {
  return !!thumb && IMAGE_EXT.test(thumb);
}

/** Drag sources call this. It writes BOTH MIMEs so anything droppable here is
 *  also droppable on the Cuts timeline, whose older payload shape stays
 *  byte-compatible. */
export function writeMediaDrag(dt: DataTransfer, p: MediaDragPayload): void {
  try {
    dt.setData(MIME_MEDIA, JSON.stringify(p));
    dt.setData(MIME_CUTCLIP, JSON.stringify({
      srcKind: p.kind === 'image' ? 'frame' : 'video',      // the legacy vocabulary
      src: p.src, thumb: p.thumb, label: p.label, dur: p.dur,
    }));
    dt.setData('text/plain', p.src);
    dt.effectAllowed = 'copy';
  } catch { /* a cancelled drag — nothing to do */ }
}

/** Would this drag be accepted? Cheap enough for dragover, which fires often. */
export function canAcceptDrag(e: React.DragEvent): boolean {
  const types = Array.from(e.dataTransfer.types || []);
  if (types.includes(MIME_MEDIA) || types.includes(MIME_CUTCLIP)) return true;
  return Array.from(e.dataTransfer.items || []).some(i => i.kind === 'file');
}

/** Read whatever arrived, richest source first. */
export function readMediaDrag(e: React.DragEvent): MediaDragPayload[] {
  try {
    const j = e.dataTransfer.getData(MIME_MEDIA);
    if (j) return [JSON.parse(j) as MediaDragPayload];
  } catch { /* next */ }

  try {
    const j = e.dataTransfer.getData(MIME_CUTCLIP);
    if (j) {
      const p = JSON.parse(j);
      return [{
        kind: p.srcKind === 'frame' ? 'image' : 'video',
        src: p.src, thumb: isImageThumb(p.thumb) ? p.thumb : undefined,
        label: p.label, dur: p.dur,
      }];
    }
  } catch { /* next */ }

  // A References tile: its dragstart was cancelled so the native drag could
  // take over, which means dataTransfer is empty and the payload is here.
  const refs = takeRefDragPayload();
  if (refs.length) {
    return refs.flatMap(r => {
      const kind = classifyPath(r.imagePath);
      return kind ? [{ kind, src: r.imagePath, label: r.tag, originRefId: r.id }] : [];
    });
  }

  // A native file drop — Finder, another app, or a tile dragged from the studio
  // window into a detached one. This is the ONLY channel that crosses a
  // BrowserWindow boundary. pathForFile recovers the absolute path Electron 32
  // removed from File.path.
  const files = Array.from(e.dataTransfer.files || []);
  if (files.length) {
    return files.flatMap(f => {
      const src = window.hjen.pathForFile(f);
      const kind = src ? classifyPath(src) : null;
      return kind ? [{ kind, src, label: src.split('/').pop() }] : [];
    });
  }

  try {
    const uri = e.dataTransfer.getData('text/uri-list');
    if (uri && uri.startsWith('file://')) {
      const src = decodeURI(uri.replace(/^file:\/\//, '').split('\n')[0].trim());
      const kind = classifyPath(src);
      if (kind) return [{ kind, src, label: src.split('/').pop() }];
    }
  } catch { /* nothing usable */ }

  return [];
}
