// Asset badges — the shared, DCC-neutral indicators that ride every made-frame
// thumbnail across the app (the Projects gallery + the "Choose a frame" picker).
// Two facts, one quiet language:
//   • QUALITY tier (LOW / MED / HIGH) — read from the generation sidecar
//     (`selections.quality`). A three-bar level meter + a mono label whose ink
//     weight rises with the tier. NOT a candy-coloured status pill.
//   • RESOLUTION (e.g. 2304×1536) — the real pixel size. Read from saved
//     metadata when present, else straight from the image file header, so it
//     shows even for old frames that predate quality tracking.
//
// A frame made before quality was recorded resolves to an "unknown" tier (a
// dashed «—»), never a false badge — a past frame's quality cannot be
// recovered. Its resolution still always shows.

import { useEffect, useState } from 'react';

export type QualityLevel = 'LOW' | 'MED' | 'HIGH' | 'UNKNOWN';

/** Normalise whatever string the sidecar carried into the four house tiers.
 *  Accepts the UI values (LOW/MED/HIGH) and any lower-cased / MEDIUM / MID
 *  spelling that could reach here from older records or the mapped api value. */
export function normalizeQuality(q?: string | null): QualityLevel {
  if (!q) return 'UNKNOWN';
  const s = q.trim().toUpperCase();
  if (s === 'LOW') return 'LOW';
  if (s === 'MED' || s === 'MEDIUM' || s === 'MID') return 'MED';
  if (s === 'HIGH') return 'HIGH';
  return 'UNKNOWN';
}

const FILLED: Record<QualityLevel, number> = { LOW: 1, MED: 2, HIGH: 3, UNKNOWN: 0 };

export function QualityBadge({
  quality,
  variant = 'inline',
}: {
  quality?: string | null;
  /** `overlay` sits on a thumbnail (solid chip, absolute corner);
   *  `inline` sits in a metadata row (transparent, flows with text). */
  variant?: 'overlay' | 'inline';
}) {
  const level = normalizeQuality(quality);
  const filled = FILLED[level];
  const label = level === 'UNKNOWN' ? '—' : level;
  const aria =
    level === 'UNKNOWN'
      ? 'Quality not recorded for this frame'
      : `Made at ${label} quality`;

  return (
    <span
      className={`q-badge q-badge--${variant} q-badge--${level.toLowerCase()}`}
      data-q={level.toLowerCase()}
      role="img"
      aria-label={aria}
      title={aria}
    >
      <span className="q-badge__meter" aria-hidden="true">
        <span className={`q-badge__bar ${filled > 0 ? 'q-badge__bar--on' : ''}`} />
        <span className={`q-badge__bar ${filled > 1 ? 'q-badge__bar--on' : ''}`} />
        <span className={`q-badge__bar ${filled > 2 ? 'q-badge__bar--on' : ''}`} />
      </span>
      <span className="q-badge__label mono-label selectable">{label}</span>
    </span>
  );
}

// ─── Resolution ──────────────────────────────────────────────────────────

/** Normalise a stored size string ("2944x1264") to a display form with a real
 *  multiplication sign ("2944×1264"). Returns null when there is nothing valid. */
export function formatDims(size?: string | null): string | null {
  if (!size) return null;
  const m = String(size).match(/(\d{2,6})\s*[x×X]\s*(\d{2,6})/);
  return m ? `${m[1]}×${m[2]}` : null;
}

// Process-lifetime caches so a 300-tile grid never reads the same header twice
// and re-renders don't refire the IPC.
const dimsCache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

/** Resolve an image's pixel resolution as a display string. Prefers a valid
 *  stored size (instant, no IPC); otherwise reads the file header once via the
 *  bridge and caches the result. Returns null until known / if unreadable. */
export function useImageDims(path?: string, storedSize?: string | null): string | null {
  const stored = formatDims(storedSize);
  const [dims, setDims] = useState<string | null>(
    stored ?? (path && dimsCache.has(path) ? dimsCache.get(path)! : null),
  );

  useEffect(() => {
    if (stored) { setDims(stored); return; }
    if (!path) { setDims(null); return; }
    if (dimsCache.has(path)) { setDims(dimsCache.get(path)!); return; }

    let dead = false;
    let p = inflight.get(path);
    if (!p) {
      p = window.hjen
        .imageDims(path)
        .then(r => {
          const v = r ? `${r.w}×${r.h}` : null;
          dimsCache.set(path, v);
          inflight.delete(path);
          return v;
        })
        .catch(() => {
          inflight.delete(path);
          return null;
        });
      inflight.set(path, p);
    }
    p.then(v => { if (!dead) setDims(v); });
    return () => { dead = true; };
  }, [path, stored]);

  return dims;
}

/** The resolution chip. Renders nothing until a value is known, so it never
 *  reserves an empty slot. `path` is the read-from-file fallback source. */
export function DimsTag({
  size,
  path,
  variant = 'inline',
}: {
  size?: string | null;
  path?: string;
  variant?: 'overlay' | 'inline';
}) {
  const dims = useImageDims(path, size);
  if (!dims) return null;
  return (
    <span
      className={`dims-tag dims-tag--${variant} mono-label selectable`}
      title={`Resolution ${dims} px`}
    >
      {dims}
    </span>
  );
}

// ─── Caption ─────────────────────────────────────────────────────────────

/** Turn a raw frame label — which may be a prompt fragment, an export
 *  filename, or an ISO-timestamp basename — into a readable single-line
 *  title. Strips export prefixes / timestamps and token-soup separators; it
 *  never invents words, only cleans what is already there. */
export function cleanTitle(raw?: string | null): string {
  let s = (raw || '').trim();
  if (!s) return 'Untitled';
  // Drop an Emulsion export prefix and any ISO-8601 timestamp basename.
  s = s.replace(/^emulsion[\s._-]*/i, '');
  s = s.replace(/\b\d{4}[-_. ]\d{2}[-_. ]\d{2}t[\d\-_.:]+/gi, ' ');
  // Underscore / multi-space soup → single spaces.
  s = s.replace(/[_]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  // A basename fallback often leaves a leading HH MM (SS) time fragment in
  // front of the real words ("21 50 make a…"). Strip it when actual words
  // follow, so the title starts on meaning — never touch a real number that
  // begins a prompt ("3 boys…") because that isn't a two-group time run.
  s = s.replace(/^\d{1,2}[ .:_-]\d{2}(?:[ .:_-]\d{2})?\s+(?=[A-Za-z])/, '').trim();
  if (!s) return 'Untitled';
  return s.charAt(0).toUpperCase() + s.slice(1);
}
