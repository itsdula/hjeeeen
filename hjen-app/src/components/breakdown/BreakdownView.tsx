import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore, type BgJob, type OrphanRef } from '../../store';
import { useTabActive } from '../../lib/keepAlive';
import { hjenFileUrl } from '../../lib/theme/apply';
import {
  listBreakdowns, readBreakdown, renameBreakdown, deleteBreakdown,
  type AdBreakdown, type BreakdownSummary, type BreakdownElement,
  type BreakdownShotRow, type ShotMasterPrompt, type BreakdownFrame,
  type ShotAttachment, type BreakdownEntities, type BreakdownPerson, type BreakdownPlace,
  type BreakdownAsset, type BuiltRef,
} from '../../lib/creativemind/breakdown';
import { resolveEntities, entitiesForShot } from '../../lib/breakdown/entityResolver';
import {
  patchEntity, findEntity, linkBuiltRefToShots, activeOf, foldLegacy, type EntityKind,
} from '../../lib/breakdown/entityEdit';

// The built-reference SLOTS a card exposes: place/asset share one 'ref' slot;
// a person has a 'face' and a 'sheet' slot. Reverting names the slot + the `at`.
type RefSlot = 'ref' | 'face' | 'sheet';
import type { Quality, ModelId } from '../../types/catalog';
import { MODELS } from '../../lib/models';
import { VIDEO_MODELS, videoModelById } from '../../lib/video/models';
import { initialSelections } from '../../lib/selectionsDefault';
import {
  runMasterPromptStage, masterPromptInputFromBreakdown, mergeMasterPrompts,
} from '../../lib/breakdown/masterPrompt';
import { buildDiscModel, resolveThumbs, type DiscModel } from '../../lib/breakdown/discModel';
import { BREAKDOWN_AXES } from '../../lib/breakdown/axes';
import { jobFor, loadDnaStatuses, loadBreakdownDna, type DnaState } from '../../lib/breakdown/content';
import { runDnaStage, dnaInputFromBreakdown } from '../../lib/breakdown/dna';
import { resolveSceneShots, type ResolvedShot } from '../../lib/breakdown/shotResolver';
import { captureBreakdownToBrain } from '../../lib/creativemind/brainCards';
import { GEM_SEG_ORDER, gemWordCount, type Gem } from '../../lib/breakdown/gem';
import { BreakdownDisc, STAGES, type StageKey } from './BreakdownDisc';
import { NewBreakdown, type NewBreakdownInput } from './NewBreakdown';
import { BreakdownProgress, BreakdownProgressLive } from './BreakdownProgress';
import '../../styles/breakdown.css';

const pad2 = (n: number) => String(n).padStart(2, '0');

// ─── shot-frame comparison (ORIGINAL ad frame vs the MADE frame) ─────────────
// The shotlist's make settings + per-shot make handlers, threaded down to each
// ShotCard. MADE-not-Generate throughout — every button says MAKE.
const QUALITY_OPTS: { v: Quality; label: string }[] = [
  { v: 'LOW', label: 'LOW' }, { v: 'MED', label: 'MID' }, { v: 'HIGH', label: 'HIGH' },
];
// Same list the Frame view's aspect picker offers (PickerModal ASPECT_OPTIONS).
const SHOT_ASPECTS = ['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16'];

export interface ShotFramesCtl {
  frames: BreakdownFrame[];
  quality: Quality; setQuality: (q: Quality) => void;
  aspect: string; setAspect: (a: string) => void;
  // Image model the frame makes run on — user-selectable (from MODELS registry).
  imageModel: ModelId; setImageModel: (m: ModelId) => void;
  making: Record<number, boolean>;
  errors: Record<number, string>;
  onMakeShot: (r: BreakdownShotRow) => void;
  onMakeAll: () => void;
  all: { active: boolean; done: number; total: number } | null;
  // REMAKE (re-fuse) — rebuild this ONE shot's master prompt with the upgraded
  // fusion, keyed by shot number (mirrors the frame make/error state).
  refusing: Record<number, boolean>;
  refuseErrors: Record<number, string>;
  onRemakeShot: (r: BreakdownShotRow) => void;
  // MAKE VIDEO — per-shot motion clip from the fused VIDEO prompt + the MADE
  // frame as its first frame. Keyed by shot number, mirroring the frame state.
  vidMaking: Record<number, boolean>;
  vidErrors: Record<number, string>;
  onMakeShotVideo: (r: BreakdownShotRow) => void;
  onMakeAllVideos: () => void;
  allVideos: { active: boolean; done: number; total: number } | null;
  // Video backend + settings — user-selectable (from VIDEO_MODELS registry).
  videoModelId: string; setVideoModelId: (id: string) => void;
  videoResolution: '480p' | '720p' | '1080p' | '4k'; setVideoResolution: (r: '480p' | '720p' | '1080p' | '4k') => void;
  videoDuration: number; setVideoDuration: (d: number) => void;
  // Live attachments — attach/edit/remove references that steer this shot's makes.
  onAttach: (r: BreakdownShotRow, kind: 'image' | 'video') => void;
  onAttachNote: (r: BreakdownShotRow, id: string, note: string) => void;
  onAttachRole: (r: BreakdownShotRow, id: string, role: 'both' | 'frame' | 'video') => void;
  onAttachRemove: (r: BreakdownShotRow, id: string) => void;
  onAttachUpdate: (r: BreakdownShotRow, id: string) => void;
  onAttachSyncAll: (r: BreakdownShotRow) => void;   // drop/refresh ALL generated refs at once
  genRefCount: (no: number) => number;              // how many generated refs this shot has
}

// ENTITIES — the ad's understood cast + places, linked across shots. One vision
// pass clusters the DISTINCT recurring persons + places; the roster is persisted
// onto pipeline.entities and CONSUMED by the master-prompt fusion. The shotlist
// surfaces the UNDERSTAND button, the roster, and per-shot entity chips.
export interface EntityCtl {
  roster?: BreakdownEntities;
  making: boolean;
  error?: string;
  onUnderstand: () => void;
  // BUILD REFERENCE — MAKE a clean reference for an entity/asset from its text
  // prompt (never the film), then LINK it to its shots. Per-entity state keyed by
  // entity id (P#/L#/A# are unique across kinds), + the edit-prompt persister.
  building: Record<string, boolean>;
  buildErrors: Record<string, string>;
  onBuild: (kind: EntityKind, id: string) => void;
  onEditPrompt: (kind: EntityKind, id: string, prompt: string) => void;
  // Revert a slot to an older build in its history — sets it active + re-links.
  onRevert: (kind: EntityKind, id: string, slot: RefSlot, at: string) => void;
  // ORPHANED REFERENCES — on-demand disk sweep for built refs no entity points at
  // anymore (pre-history-feature overwrites). `list` null = never scanned. RESTORE
  // re-appends one to its entity's slot history (pointer only, no file touched).
  orphans: {
    list: OrphanRef[] | null;
    scanning: boolean;
    error?: string;
    restoring: Record<string, boolean>;
    restored: Record<string, boolean>;
    onScan: () => void;
    onRestore: (o: OrphanRef) => void;
    onReveal: (imgPath: string) => void;
  };
}

// Seedance accepts a fixed ratio set; the shotlist aspect picker offers more.
// Map any picked aspect to the nearest supported motion ratio so MAKE VIDEO
// never sends an unsupported value. Falls back to landscape 16:9.
const SEEDANCE_RATIO: Record<string, '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9'> = {
  '21:9': '21:9', '16:9': '16:9', '3:2': '16:9', '4:3': '4:3', '5:4': '4:3',
  '1:1': '1:1', '4:5': '3:4', '3:4': '3:4', '2:3': '9:16', '9:16': '9:16',
};
function toSeedanceRatio(aspect: string): '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9' {
  return SEEDANCE_RATIO[aspect] ?? '16:9';
}

// The image models offered to the shotlist — pulled from the registry so new
// models appear automatically (no static list).
const IMAGE_MODELS = Object.values(MODELS);
const VIDEO_RESOLUTIONS: Array<'480p' | '720p' | '1080p' | '4k'> = ['480p', '720p', '1080p', '4k'];
const VIDEO_DURATIONS = [5, 10];

// ── attachment helpers — role decides which make(s) an attachment feeds ──────
const basenameOf = (p: string) => p.split('/').pop() || p;
const attFeeds = (a: ShotAttachment, make: 'frame' | 'video') => (a.role ?? 'both') === 'both' || a.role === make;
// Frame make consumes image attachments as reference layers.
const frameRefPaths = (atts?: ShotAttachment[]) =>
  (atts || []).filter(a => a.kind === 'image' && attFeeds(a, 'frame')).map(a => a.path);
// Video make: the first video-role image attachment becomes the end-frame anchor.
const videoEndFrame = (atts?: ShotAttachment[]) =>
  (atts || []).find(a => a.kind === 'image' && attFeeds(a, 'video'))?.path;
// The appendix that travels with the prompt — describes each attachment's role.
function composeAppendix(atts: ShotAttachment[] | undefined, make: 'frame' | 'video'): string {
  const rel = (atts || []).filter(a => attFeeds(a, make));
  if (!rel.length) return '';
  const lines = rel.map(a => `- [${a.kind.toUpperCase()}] ${(a.note || '').trim() || basenameOf(a.path)}`);
  return `ATTACHED REFERENCES (${make === 'frame' ? 'image-making' : 'video-making'}):\n${lines.join('\n')}`;
}

// The ORIGINAL still for a shot MUST come from THIS shot's own window
// [tcIn, tcOut) — so it shows the same moment the master prompt describes.
// Two drifts this guards against:
//  • references[0] is NOT this shot's frame — withEntityRefs() prepends each
//    recurring entity's identity-lock frame (provenance from a DIFFERENT shot)
//    to the front of references, so the old "first ad-frame ref" rule showed a
//    stranger's frame.
//  • the prompt is grounded on DENSE frames across the whole window (mid-action),
//    while the old fallback picked the frame nearest tc (= tcIn, the FIRST frame).
// Rule: (1) an ad-frame ref that actually LANDS in this window (the model's own
// pick, not a lock); (2) else the stored frame nearest the window CENTRE
// (mid-action, where the prompt lives); (3) else nearest tcIn, then frame 0.
function originalFrameFile(r: BreakdownShotRow, frames: BreakdownFrame[], tcOutSec?: number): string | undefined {
  if (!frames.length) return undefined;
  const tcIn = shotTcToSec(r.tc);
  const inWindow = (f: BreakdownFrame) =>
    f.t != null && tcIn != null && f.t >= tcIn - 0.05 && (tcOutSec == null || f.t < tcOutSec + 0.05);

  // 1. an ad-frame reference whose frame falls inside THIS shot's window
  for (const rf of (r.masterPrompt?.references || [])) {
    if (rf.kind !== 'ad-frame') continue;
    const hit = frames.find(f => f.id === rf.ref);
    if (hit?.file && inWindow(hit)) return hit.file;
  }

  if (tcIn == null) return frames[0]?.file;

  // 2. the stored frame nearest the window centre — mid-action, not the first frame
  const centre = tcOutSec != null ? (tcIn + tcOutSec) / 2 : tcIn;
  const pool = frames.filter(inWindow);
  const search = pool.length ? pool : frames;
  let best: BreakdownFrame | undefined; let bestD = Infinity;
  for (const f of search) {
    if (f.t == null) continue;
    const d = Math.abs(f.t - centre);
    if (d < bestD) { bestD = d; best = f; }
  }
  return best?.file ?? frames[0]?.file;
}

// The GENERATED references that steer a shot — the LATEST built reference of
// every entity linked to this shot: each person's ACTIVE character SHEET (the
// sheet is what links to shots; the face is identity-only), the place's active
// ref, and each linked asset's active ref. This is the source of truth for
// "drop the made references in" + "update to the newest built version".
type GenRef = { kind: 'person-face' | 'person-sheet' | 'place' | 'asset'; id: string; path: string; note: string };
function generatedRefsForShot(roster: BreakdownEntities | undefined, shotNo: number): GenRef[] {
  if (!roster) return [];
  const out: GenRef[] = [];
  // A person raises TWO references — the FACE (identity, pointed to in the
  // prompt) and the 3-angle character SHEET.
  for (const p of roster.persons.filter(x => x.shotNos.includes(shotNo))) {
    const face = activeOf(foldLegacy(p.builtFaces, (p as any).builtFace), p.activeFaceAt);
    if (face?.path) out.push({ kind: 'person-face', id: p.id, path: face.path, note: `${p.id} — FACE (identity — match this face)` });
    const sheet = activeOf(foldLegacy(p.builtSheets, (p as any).builtSheet), p.activeSheetAt);
    if (sheet?.path) out.push({ kind: 'person-sheet', id: p.id, path: sheet.path, note: `${p.id} — character sheet` });
  }
  const place = roster.places.find(x => x.shotNos.includes(shotNo));
  if (place) {
    const rf = activeOf(foldLegacy(place.builtRefs, (place as any).builtRef), place.activeRefAt);
    if (rf?.path) out.push({ kind: 'place', id: place.id, path: rf.path, note: `${place.id} — place` });
  }
  for (const a of (roster.assets || []).filter(x => x.shotNos.includes(shotNo))) {
    const rf = activeOf(foldLegacy(a.builtRefs, (a as any).builtRef), a.activeRefAt);
    if (rf?.path) out.push({ kind: 'asset', id: a.id, path: rf.path, note: `${a.id} — ${a.kind || 'asset'}` });
  }
  return out;
}

// EVERY built-ref file path (all history versions) of the faces/sheets/places/
// assets a shot manages — so UPDATE ALL can recognise an old generated drop even
// when it predates `source` (attached by hand from disk) and replace it instead
// of piling a duplicate on top.
function managedBuiltPathsForShot(roster: BreakdownEntities | undefined, shotNo: number): Set<string> {
  const s = new Set<string>();
  if (!roster) return s;
  for (const p of roster.persons.filter(x => x.shotNos.includes(shotNo))) {
    for (const b of foldLegacy(p.builtFaces, (p as any).builtFace)) if (b.path) s.add(b.path);
    for (const b of foldLegacy(p.builtSheets, (p as any).builtSheet)) if (b.path) s.add(b.path);
  }
  const place = roster.places.find(x => x.shotNos.includes(shotNo));
  if (place) for (const b of foldLegacy(place.builtRefs, (place as any).builtRef)) if (b.path) s.add(b.path);
  for (const a of (roster.assets || []).filter(x => x.shotNos.includes(shotNo)))
    for (const b of foldLegacy(a.builtRefs, (a as any).builtRef)) if (b.path) s.add(b.path);
  return s;
}

// Copy affordance — copies raw text to the clipboard, flips to COPIED for ~1.5s.
// Follows the app's clipboard pattern (navigator.clipboard?.writeText + timed flag,
// as in McpHub / NodeMcpOverlay). stopPropagation keeps it from toggling a parent
// <summary>. COPY / COPIED are house-safe words (no banned "generate" vocabulary).
function CopyBtn({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const doCopy = () => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  return (
    <button
      type="button"
      className={`bd-copy${copied ? ' is-copied' : ''}${className ? ` ${className}` : ''}`}
      onClick={e => { e.preventDefault(); e.stopPropagation(); doCopy(); }}
      aria-label={copied ? 'Copied' : 'Copy text'}
    >
      {copied ? (
        <svg className="bd-copy__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} aria-hidden="true"><path d="M5 12l4 4 10-10" /></svg>
      ) : (
        <svg className="bd-copy__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></svg>
      )}
      {copied ? 'COPIED' : 'COPY'}
    </button>
  );
}

// WATCH THE FILM — the link back to the source film a breakdown was read from.
// Prefers the local ingested video (source.<ext>, played in an in-app overlay);
// falls back to the source webpage (ad.sourceUrl) via the OS browser; renders
// nothing when neither exists, so there is never a dead button. MADE-safe copy.
function WatchFilmButton({ bd, onPlayLocal, variant }: {
  bd: AdBreakdown; onPlayLocal: (path: string) => void; variant?: 'ghost';
}) {
  const path = bd.sourcePath;
  const url = bd.ad.sourceUrl;
  if (!path && !url) return null;
  const play = () => { if (path) onPlayLocal(path); else if (url) window.hjen.openInBrowser(url); };
  return (
    <button
      type="button"
      className={`bd-watch${variant === 'ghost' ? ' bd-watch--ghost' : ''}`}
      onClick={play}
      title={path ? 'Play the source film' : 'Open the source film'}
    >
      <svg className="bd-watch__ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
      WATCH THE FILM
      <svg className="bd-watch__arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
    </button>
  );
}

// Close an overlay on Escape AND stop the key from reaching the overlays behind
// it. Every overlay's Esc handler is window-level, and the page's own handler
// (setPage(null) → back to the disc) is registered first, so it would fire too —
// closing the whole page when the user only meant to close an image. A
// CAPTURE-phase listener runs before all bubble-phase window listeners, and
// stopImmediatePropagation() then blocks the page handler regardless of mount
// order. `active` gates it so only the topmost open overlay listens.
function useEscClose(active: boolean, onClose: () => void) {
  const cb = useRef(onClose);
  cb.current = onClose;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      cb.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active]);
}

// The in-app player overlay — streams the local source film over hjen-file://,
// mirroring VideoView's VideoPreviewModal pattern (backdrop click + Esc close).
function FilmOverlay({ path, title, onClose }: { path: string; title: string; onClose: () => void }) {
  useEscClose(true, onClose);
  return (
    <div className="bd-film-backdrop" role="dialog" aria-modal="true" aria-label={`${title} — the film`} onClick={onClose}>
      <div className="bd-film-wrap" onClick={e => e.stopPropagation()}>
        <div className="bd-film-top">
          <span className="mono-label bd-film-title">{title}</span>
          <button type="button" className="bd-film-close" onClick={onClose} aria-label="Close the film (Esc)">✕ CLOSE</button>
        </div>
        <video className="bd-film-player" src={hjenFileUrl(path)} controls autoPlay />
      </div>
    </div>
  );
}

// Plays a WINDOW [tcIn, tcOut) of the ingested source film — HTML5 seek + a
// timeupdate loop so the original shot's own footage plays (and repeats) beside
// the MADE clip. No ffmpeg clipping needed.
function SourceSegment({ path, tcIn, tcOut }: { path: string; tcIn: number; tcOut?: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const seekStart = () => { try { v.currentTime = tcIn; } catch { /* not seekable yet */ } };
    const onMeta = () => { seekStart(); v.play().catch(() => {}); };
    const onTime = () => {
      if (tcOut != null && v.currentTime >= tcOut) { seekStart(); v.play().catch(() => {}); }
      else if (v.currentTime < tcIn - 0.25) seekStart();
    };
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('timeupdate', onTime);
    if (v.readyState >= 1) onMeta();
    return () => { v.removeEventListener('loadedmetadata', onMeta); v.removeEventListener('timeupdate', onTime); };
  }, [path, tcIn, tcOut]);
  return <video ref={ref} className="bd-compare__media bd-compare__media--vid" src={`${hjenFileUrl(path)}#t=${tcIn}${tcOut != null ? `,${tcOut}` : ''}`} controls autoPlay muted playsInline />;
}

// ─── shot COMPARE lightbox — ORIGINAL vs MADE, in two modes ──────────────────
// STILLS: the original ad FRAME | the MADE frame.  MOTION: the original film
// clipped to THIS shot's window [tcIn, tcOut) | the MADE video (the ad still is
// the reference for stills, the source clip for motion). Reuses the
// bd-film-backdrop idiom — Esc + backdrop close, arrows move shots.
function ShotCompareLightbox({ rows, frames, index, onIndex, onClose, sourcePath, durationS }: {
  rows: BreakdownShotRow[]; frames: BreakdownFrame[];
  index: number; onIndex: (i: number) => void; onClose: () => void;
  sourcePath?: string; durationS?: number;
}) {
  const r = rows[index];
  const [mode, setMode] = useState<'stills' | 'motion'>('stills');
  useEffect(() => { setMode('stills'); }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // capture phase + stopImmediatePropagation so Esc closes only THIS lightbox,
      // not the page handler behind it (see useEscClose).
      if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); onClose(); return; }
      if ((document.activeElement as HTMLElement | null)?.tagName === 'VIDEO') return;
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      if (e.key === 'ArrowRight' && index < rows.length - 1) onIndex(index + 1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [index, rows.length, onIndex, onClose]);

  if (!r) return null;
  const madePath = r.madeFrame?.path;
  const videoPath = r.madeVideo?.path;
  const tcIn = shotTcToSec(r.tc) ?? 0;
  const tcOut = shotTcToSec(rows[index + 1]?.tc) ?? durationS ?? undefined;
  const origUrl = originalFrameFile(r, frames, tcOut);
  const canMotion = !!sourcePath || !!videoPath;
  const motion = mode === 'motion' && canMotion;

  return (
    <div className="bd-compare-backdrop" role="dialog" aria-modal="true" aria-label={`Shot ${r.no} — original vs made`} onClick={onClose}>
      <div className="bd-compare" onClick={e => e.stopPropagation()}>
        <div className="bd-compare__top">
          <span className="mono-label bd-compare__eyebrow">SHOT {r.no} · ORIGINAL vs MADE</span>
          {canMotion && (
            <span className="bd-compare__toggle" role="group" aria-label="Compare stills or motion">
              <button type="button" className={`bd-compare__tgl${!motion ? ' is-on' : ''}`} onClick={() => setMode('stills')} aria-pressed={!motion}>STILLS</button>
              <button type="button" className={`bd-compare__tgl${motion ? ' is-on' : ''}`} onClick={() => setMode('motion')} aria-pressed={motion}>MOTION</button>
            </span>
          )}
          <button type="button" className="bd-film-close" onClick={onClose} aria-label="Close (Esc)">✕ CLOSE</button>
        </div>

        <div className="bd-compare__panes">
          <figure className="bd-compare__pane">
            <figcaption className="bd-compare__badge">ORIGINAL — {motion ? 'the ad, this shot' : 'the ad frame'}</figcaption>
            {motion
              ? (sourcePath
                  ? <SourceSegment path={sourcePath} tcIn={tcIn} tcOut={tcOut} />
                  : <div className="bd-compare__empty">The source film isn’t kept for this breakdown</div>)
              : (origUrl
                  ? <img className="bd-compare__media" src={hjenFileUrl(origUrl)} alt={`Original frame for shot ${r.no}`} />
                  : <div className="bd-compare__empty">No original frame for this shot</div>)}
          </figure>

          <figure className="bd-compare__pane">
            <figcaption className="bd-compare__badge bd-compare__badge--made">MADE — {motion ? 'the motion take' : 'by HJEN'}</figcaption>
            {motion
              ? (videoPath
                  ? <video className="bd-compare__media bd-compare__media--vid" src={hjenFileUrl(videoPath)} controls autoPlay loop />
                  : <div className="bd-compare__empty">No video made yet — use <b>MAKE VIDEO</b> in this shot</div>)
              : (madePath
                  ? <img className="bd-compare__media" src={hjenFileUrl(madePath)} alt={`MADE frame for shot ${r.no}`} />
                  : <div className="bd-compare__empty">Not made yet — use <b>MAKE FRAME</b> in this shot</div>)}
          </figure>
        </div>

        <div className="bd-compare__cap">
          <span className="bd-compare__captc">{r.tc || '—'}</span>
          {r.beat && <span className="bd-beat-tag">{r.beat}</span>}
          {/* prefer the GROUNDED master-prompt caption (read off this window's own
              frames) over the shotlist row text, which can drift off its window. */}
          <span className="bd-compare__capdesc selectable">{r.masterPrompt?.description || r.description}</span>
        </div>

        <div className="bd-compare__nav">
          <button type="button" className="bd-compare__navbtn" onClick={() => onIndex(index - 1)} disabled={index <= 0} aria-label="Previous shot">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><path d="M15 6l-6 6 6 6" /></svg>
            PREV
          </button>
          <span className="bd-compare__count">SHOT {index + 1} / {rows.length}</span>
          <button type="button" className="bd-compare__navbtn" onClick={() => onIndex(index + 1)} disabled={index >= rows.length - 1} aria-label="Next shot">
            NEXT
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><path d="M9 6l6 6-6 6" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}

type Page =
  | { kind: 'axis'; i: number }
  | { kind: 'stage'; key: StageKey }
  | { kind: 'dnalib' }
  | { kind: 'dna'; axisSlug: string }
  | { kind: 'overview' };

// A page ↔ a compact string kept in the tab's sub, so a Breakdown tab reopens on
// the SAME inner page after switching tabs (not back at the disc). Also parses the
// legacy job-hint forms a finished JOB writes ('shotlist' · 'dnas' · 'disc').
function serializePage(p: Page | null): string | null {
  if (!p) return null;
  switch (p.kind) {
    case 'axis': return `axis:${p.i}`;
    case 'stage': return `stage:${p.key}`;
    case 'dnalib': return 'dnalib';
    case 'dna': return `dna:${p.axisSlug}`;
    case 'overview': return 'overview';
  }
}
function parsePageHint(hint: string | null | undefined): Page | null {
  if (!hint || hint === 'disc' || hint === 'null') return null;
  if (hint === 'shotlist') return { kind: 'stage', key: 'shotlist' as StageKey };
  if (hint === 'dnas' || hint === 'dnalib') return { kind: 'dnalib' };
  if (hint === 'overview') return { kind: 'overview' };
  const mAxis = /^axis:(\d+)$/.exec(hint);
  if (mAxis) return { kind: 'axis', i: Number(mAxis[1]) };
  const mStage = /^stage:(.+)$/.exec(hint);
  if (mStage) return { kind: 'stage', key: mStage[1] as StageKey };
  const mDna = /^dna:(.+)$/.exec(hint);
  if (mDna) return { kind: 'dna', axisSlug: mDna[1] };
  return null;
}

// ─── small presentational helpers ──────────────────────────────────────────

function Thumbs({ model, ids }: { model: DiscModel; ids?: string[] }) {
  const thumbs = resolveThumbs(model, ids, hjenFileUrl);
  if (!thumbs.length) return null;
  return (
    <div className="bd-thumbs">
      {thumbs.map(t => (
        <div className="bd-thumb" key={t.id}>
          <img src={t.url} alt={t.id} loading="lazy" />
          <span>{t.id} · {t.t.toFixed(1)}s</span>
        </div>
      ))}
    </div>
  );
}

function FindingCard({ model, f }: { model: DiscModel; f: BreakdownElement }) {
  const w = f.weight ?? 0;
  return (
    <div className="bd-card">
      <div className="bd-card__meta">
        <span className="bd-fid">{f.id.split('/').slice(-2).join('/')}</span>
        <div className="bd-wbar"><i style={{ width: `${Math.round((w / 3) * 100)}%` }} /></div>
        <span className="bd-wnum">{w ? `w${w}` : '—'}</span>
      </div>
      {f.claim_ar && <div className="bd-claim-ar" dir="rtl">{f.claim_ar}</div>}
      {!f.claim_ar && f.claim_en && <div className="bd-card__claim">{f.claim_en}</div>}
      {f.howHjenMakesIt && (
        <div className="bd-how">
          <div className="bd-how__top">
            <span className="lbl">HOW HJEN MAKES IT</span>
            <CopyBtn text={f.howHjenMakesIt} className="bd-copy--amber" />
          </div>
          <code>{f.howHjenMakesIt}</code>
        </div>
      )}
      <Thumbs model={model} ids={f.frameIds} />
      {f.tags && f.tags.length > 0 && (
        <div className="bd-tags">{f.tags.map(t => <span className="bd-tag" key={t}>{t}</span>)}</div>
      )}
    </div>
  );
}

// `job` marks a UNIVERSAL analyst Gem (the same construction reused for every
// ad). Its <examples> are canonical Nike "WHY DO IT?" cards — NOT the current
// ad's data — so on a job we badge that segment and keep it collapsed, and on a
// non-Nike ad we say so in plain words to kill the data-leakage read.
function GemSegments({ gem, openFirst, job, adTitle, adIsNike }: {
  gem: Gem; openFirst?: boolean; job?: boolean; adTitle?: string; adIsNike?: boolean;
}) {
  return (
    <>
      {GEM_SEG_ORDER.map((k, idx) => {
        const txt = gem.segments[k] || '';
        if (!txt) return null;
        const canon = job && k === 'examples';
        const open = canon ? false : (openFirst || idx === 0);
        return (
          <details className="bd-gemseg" key={k} open={open}>
            <summary>
              <span className="bd-gemseg__k">&lt;{k}&gt;</span>
              <span className="bd-gemseg__right">
                {canon && <span className="bd-gemseg__canon">CANONICAL · NIKE — NOT THIS AD</span>}
                <span className="wc">{gemWordCount(txt)} WORDS</span>
                <CopyBtn text={txt} />
              </span>
            </summary>
            {canon && (
              <div className="bd-gemseg__provenance">
                These example cards are the fixed teaching set from the Nike “WHY DO IT?” breakdown — the canonical illustration of how this axis is read.
                {!adIsNike && adTitle ? <> They are <b>not</b> {adTitle}’s data. This ad’s own MADE-side output lives in <b>OPEN DNA</b>.</> : null}
              </div>
            )}
            <div className="bd-gemtext">{txt}</div>
          </details>
        );
      })}
    </>
  );
}

function PendingBlock({ what, hint }: { what: string; hint: string }) {
  return (
    <div className="bd-empty">
      <h4>PENDING — {what}</h4>
      <p>{hint}</p>
    </div>
  );
}

// ─── the view ──────────────────────────────────────────────────────────────

export function BreakdownView() {
  const setActiveView = useStore(s => s.setActiveView);
  const setActiveTabSub = useStore(s => s.setActiveTabSub);
  // Keep-alive: this view stays MOUNTED for its tab even while hidden, so the
  // open breakdown + inner page + scroll survive a tab switch. While hidden the
  // `activeTab()` selectors below resolve to the OTHER (active) tab, so the
  // reconcile effect is guarded on `active` — a background instance must never
  // reopen its disc from another tab's saved slug.
  const active = useTabActive();
  // This tab's saved nav. A finished JOB re-points it via openJobNav (writing
  // breakdownSlug + a page hint) WITHOUT remounting this view, so we track both as
  // live selectors and reconcile in an effect below.
  const tabSlug = useStore(s => (s.activeTab().sub?.breakdownSlug as string | null | undefined) ?? null);
  const tabPage = useStore(s => (s.activeTab().sub?.breakdownPage as string | null | undefined) ?? null);
  // A running breakdown-run opened from the status bar / a live card lands here
  // via this hint — the tab remembers it's attached to that op's live progress.
  const tabLiveJobId = useStore(s => (s.activeTab().sub?.liveJobId as string | null | undefined) ?? null);

  const [list, setList] = useState<BreakdownSummary[] | null>(null);
  // Restore the last open breakdown from this tab's saved sub-state, so a
  // Breakdown tab reopens on the same disc after switching tabs.
  const [slug, setSlug] = useState<string | null>(() => {
    const s = useStore.getState().activeTab().sub?.breakdownSlug;
    return typeof s === 'string' ? s : null;
  });
  const [bd, setBd] = useState<AdBreakdown | null>(null);
  const [loadingBd, setLoadingBd] = useState(false);
  const [page, setPageRaw] = useState<Page | null>(null);
  // Wrapped setter — every user-facing page change also persists into the tab's
  // sub, so switching away and back reopens on the SAME inner page. (setPageRaw is
  // used for restore + load, which must NOT re-persist.)
  const setPage = useCallback((p: Page | null) => {
    setPageRaw(p);
    useStore.getState().setActiveTabSub({ breakdownPage: serializePage(p) });
  }, []);

  // WATCH THE FILM — the ingested source video played in an in-app overlay.
  // Holds the absolute source.<ext> path when open (null = closed).
  const [watchPath, setWatchPath] = useState<string | null>(null);

  const [dnaStatuses, setDnaStatuses] = useState<Record<string, DnaState['kind']>>({});
  const [dnaCache, setDnaCache] = useState<Record<string, DnaState>>({});
  // retro DNA — MAKE THE DNAS on an already-run breakdown (findings, no DNA yet)
  const [dnaMaking, setDnaMaking] = useState<{ active: boolean; done: number; total: number; error?: string } | null>(null);
  // retro MASTER PROMPTS — the convergence, on an already-run breakdown (needs DNAs)
  const [masterMaking, setMasterMaking] = useState<{ active: boolean; done: number; total: number; error?: string } | null>(null);
  // UNDERSTAND ENTITIES — the one vision pass that clusters the ad's recurring
  // people + places and links them across shots (persisted onto pipeline.entities).
  const [entitiesMaking, setEntitiesMaking] = useState<{ active: boolean; error?: string } | null>(null);
  // BUILD REFERENCE — per-entity build state + error, keyed by entity id.
  const [entBuilding, setEntBuilding] = useState<Record<string, boolean>>({});
  const [entBuildErrors, setEntBuildErrors] = useState<Record<string, string>>({});
  // ORPHANED REFERENCES — on-demand sweep for built refs no entity points at
  // anymore. `orphanList` null until the first scan; restoring/restored keyed by
  // the orphan's imgPath (unique per file).
  const [orphanList, setOrphanList] = useState<OrphanRef[] | null>(null);
  const [orphanScanning, setOrphanScanning] = useState(false);
  const [orphanError, setOrphanError] = useState<string | undefined>(undefined);
  const [orphanRestoring, setOrphanRestoring] = useState<Record<string, boolean>>({});
  const [orphanRestored, setOrphanRestored] = useState<Record<string, boolean>>({});
  // الدماغ الثاني — backfill: deposit THIS breakdown's lessons into the cross-project memory
  const [brainMsg, setBrainMsg] = useState<string | null>(null);
  const [brainBusy, setBrainBusy] = useState(false);

  // ── SHOT FRAMES — make each shot's FRAME prompt into an image, compare to the
  // original ad frame. Settings live at the top of the shotlist; per-shot making
  // + error state keyed by shot number; frameAll drives MAKE FRAMES FOR ALL.
  const [frameQuality, setFrameQuality] = useState<Quality>('MED');
  // Default aspect = 16:9 (matches most ad frames incl. the reference cuts). The
  // user can override; the video ratio derives from this too.
  const [frameAspect, setFrameAspect] = useState<string>('16:9');
  const [shotMaking, setShotMaking] = useState<Record<number, boolean>>({});
  const [shotErrors, setShotErrors] = useState<Record<number, string>>({});
  const [frameAll, setFrameAll] = useState<{ active: boolean; done: number; total: number } | null>(null);
  // REMAKE (re-fuse) — per-shot master-prompt re-fusion making + error state,
  // keyed by shot number. Drives the per-shot REMAKE button.
  const [shotRefusing, setShotRefusing] = useState<Record<number, boolean>>({});
  const [shotRefuseErrors, setShotRefuseErrors] = useState<Record<number, string>>({});
  // MAKE VIDEO — per-shot motion clip making + error state, keyed by shot number.
  const [shotVidMaking, setShotVidMaking] = useState<Record<number, boolean>>({});
  const [shotVidErrors, setShotVidErrors] = useState<Record<number, string>>({});
  // User-selectable models (image + video) + video settings + bulk video state.
  const [frameModel, setFrameModel] = useState<ModelId>(initialSelections.model);
  const [videoModelId, setVideoModelId] = useState<string>('seedance-2.0');
  const [videoResolution, setVideoResolution] = useState<'480p' | '720p' | '1080p' | '4k'>('720p');
  const [videoDuration, setVideoDuration] = useState<number>(5);
  const [videoAll, setVideoAll] = useState<{ active: boolean; done: number; total: number } | null>(null);
  // Mirror of `bd` for the make workers: they merge their madeFrame into the
  // freshest breakdown (read synchronously) so concurrent pool completions never
  // clobber one another before the disk write.
  const bdRef = useRef<AdBreakdown | null>(null);
  useEffect(() => { bdRef.current = bd; }, [bd]);

  // NEW BREAKDOWN run flow — 'browse' (picker/disc) · 'new' (form) · 'progress'
  // (a fresh run in flight) · 'live' (re-attached to an already-running job).
  const [flow, setFlow] = useState<'browse' | 'new' | 'progress' | 'live'>('browse');
  const [runInput, setRunInput] = useState<NewBreakdownInput | null>(null);
  const [liveJobId, setLiveJobId] = useState<string | null>(null);

  // Runs still in flight — the picker shows each as a live card (they aren't on
  // disk yet, so listBreakdowns can't see them). Select the whole bgJobs array
  // (stable ref) and filter in a memo so the selector never returns a new ref.
  const bgJobs = useStore(s => s.bgJobs);
  const runningRuns = useMemo(
    () => bgJobs.filter(j => j.kind === 'breakdown-run' && j.status === 'running'),
    [bgJobs],
  );

  // load the installed breakdowns for the picker
  const refreshList = useCallback(() => { listBreakdowns().then(setList).catch(() => setList([])); }, []);
  useEffect(() => { refreshList(); }, [refreshList]);
  // When any run flips out of 'running' (done/error), refresh so a just-finished
  // breakdown swaps from its live card to the real on-disk card.
  useEffect(() => { refreshList(); }, [runningRuns.length, refreshList]);

  const openBreakdown = useCallback(async (s: string) => {
    setLoadingBd(true); setSlug(s); setPageRaw(null); setDnaStatuses({}); setDnaCache({});
    setActiveTabSub({ breakdownSlug: s });   // remember on this tab
    const [data, statuses] = await Promise.all([readBreakdown(s), loadDnaStatuses(s)]);
    setBd(data); setDnaStatuses(statuses); setLoadingBd(false);
  }, [setActiveTabSub]);

  const toPicker = useCallback(() => { setSlug(null); setBd(null); setPage(null); setDnaMaking(null); setMasterMaking(null); setActiveTabSub({ breakdownSlug: null, breakdownPage: null, liveJobId: null }); }, [setActiveTabSub]);

  // RENAME landed — refresh the picker so the new title shows; if this tab has that
  // breakdown's disc open, patch its in-memory title too (folder slug is unchanged).
  const onRenamed = useCallback((renamedSlug: string, title: string) => {
    refreshList();
    if (renamedSlug === slug) setBd(prev => (prev ? { ...prev, ad: { ...prev.ad, title } } : prev));
  }, [refreshList, slug]);
  // DELETE landed — refresh the picker; if this tab's disc was that breakdown, fall
  // back to the picker so we never sit on a folder that no longer exists.
  const onDeleted = useCallback((deletedSlug: string) => {
    refreshList();
    if (deletedSlug === slug) toPicker();
  }, [refreshList, slug, toPicker]);

  // Restore the tab's saved inner page — both a finished JOB's hint ('shotlist' ·
  // 'dnas') AND a page the user left on (serialized). setPageRaw, never the wrapped
  // setter: this reflects what the tab already holds, so it must not re-persist.
  const applyPageHint = useCallback((hint: string | null) => {
    const p = parsePageHint(hint);
    if (p) setPageRaw(p);
    // 'disc' / null → leave the disc (or the user's current page) untouched
  }, []);
  // Reconcile the disc with this tab's saved nav — covers BOTH first mount (restore
  // a saved breakdownSlug) AND a live job-nav that swaps the tab's breakdown while
  // this view stays mounted. Guarded so ordinary in-view navigation never re-opens.
  useEffect(() => {
    if (!active) return;   // hidden instance: don't reconcile against another tab's nav
    // A live-attach hint wins while a run is in flight — jump straight to the
    // op's live progress page (from the status bar or a running picker card).
    if (tabLiveJobId) {
      if (flow !== 'live' || liveJobId !== tabLiveJobId) { setLiveJobId(tabLiveJobId); setFlow('live'); }
      return;
    }
    if (!tabSlug) return;                          // picker — nothing to restore
    if (tabSlug !== slug) {                          // a (job-)nav switched breakdown
      void openBreakdown(tabSlug).then(() => applyPageHint(tabPage));
    } else if (!bd && !loadingBd) {                  // same slug, not loaded → initial open
      void openBreakdown(tabSlug).then(() => applyPageHint(tabPage));
    } else if (bd) {                                 // already open → honor a fresh page hint
      applyPageHint(tabPage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, tabLiveJobId, tabSlug, tabPage, slug, bd, loadingBd]);

  // MAKE THE DNAS (retro) — distil ONLY, from the stored breakdown.json: no
  // re-ingest, no re-analysis. Writes each dna/<slug>.gem.md and flips LIVE.
  const makeDnas = useCallback(async () => {
    if (!bd || !slug || dnaMaking?.active) return;
    const input = dnaInputFromBreakdown(bd);
    const live = new Set(Object.entries(dnaStatuses).filter(([, k]) => k === 'live').map(([s]) => s));
    input.skip = live;
    const total = input.axes.filter(a => !live.has(a.slug)).length;
    if (!total) return;
    setDnaMaking({ active: true, done: 0, total });
    // Mirror into the background-jobs subsystem — read actions from getState()
    // so the op keeps advancing (and lands green) even if the user leaves the
    // Breakdown view mid-run.
    const jb = useStore.getState();
    const jobId = jb.startJob({
      kind: 'breakdown-dna',
      title: `DNA · ${bd.ad.title || slug}`,
      // Land straight on the DNAS library — where this op's output lives.
      nav: { view: 'breakdown', projectId: null, sub: { breakdownSlug: slug, breakdownPage: 'dnas' } },
      stages: [{ key: 'distill', label: 'Distil axis DNAs', state: 'pending' }],
      progressText: `0 / ${total}`,
    });
    let done = 0;
    const res = await runDnaStage(input, ev => {
      if (ev.type === 'dna-axis') {
        done += 1;
        setDnaMaking(m => (m ? { ...m, done: m.done + 1 } : m));
        setDnaStatuses(s => ({ ...s, [ev.slug]: 'live' }));   // flip this axis LIVE the moment it lands
        setDnaCache(c => { const n = { ...c }; delete n[ev.slug]; return n; });
        useStore.getState().updateJob(jobId, { progressText: `${done} / ${total} axes` });
      }
    }, () => false);
    const statuses = await loadDnaStatuses(slug);
    setDnaStatuses(statuses); setDnaCache({});
    setDnaMaking(res.ok ? null : { active: false, done: res.made.length, total, error: res.message });
    useStore.getState().finishJob(jobId, res.ok
      ? { status: 'done' }
      : { status: 'error', error: res.message || 'DNA distillation stopped' });
  }, [bd, slug, dnaStatuses, dnaMaking]);

  // الدماغ الثاني — backfill this breakdown's lessons into the cross-project memory.
  // Live runs auto-capture on finish; this fills breakdowns completed before Phase A,
  // and is idempotent (sources dedupe on slug+elementId).
  const captureBrain = useCallback(async () => {
    if (!bd || brainBusy) return;
    setBrainBusy(true); setBrainMsg(null);
    try {
      const cap = await captureBreakdownToBrain(bd);
      setBrainMsg(cap.added || cap.merged
        ? `الذاكرة: +${cap.added} درس · ${cap.merged} مُعزَّز · ${cap.total} إجمالاً`
        : 'الذاكرة: لا جديد (مُلتقَط سابقاً)');
    } catch (e: any) {
      setBrainMsg(`تعذّر الالتقاط: ${String(e?.message || e)}`);
    } finally { setBrainBusy(false); }
  }, [bd, brainBusy]);

  // MAKE THE MASTER PROMPTS (retro) — the convergence, from the stored
  // breakdown.json: fuse the 13 axis DNAs into ONE master prompt per shot, in two
  // forms + the references list. Needs the DNAs present (it fuses them). Each shot
  // lands live; the merged breakdown is persisted back to disk.
  const makeMasters = useCallback(async () => {
    if (!bd || !slug || masterMaking?.active) return;
    const liveDnas = Object.values(dnaStatuses).filter(k => k === 'live').length;
    if (liveDnas === 0) {
      setMasterMaking({ active: false, done: 0, total: 0, error: 'Make the axis DNAs first — the master prompts fuse them.' });
      return;
    }
    const input = masterPromptInputFromBreakdown(bd);
    const rows = ((bd.pipeline as any)?.shotlist?.rows || []) as BreakdownShotRow[];
    const already = new Set(rows.filter(r => r.masterPrompt).map(r => r.no));
    const total = input.shots.filter(s => !already.has(s.no)).length;
    if (!total) { setMasterMaking(null); return; }
    setMasterMaking({ active: true, done: 0, total });
    const jb = useStore.getState();
    const jobId = jb.startJob({
      kind: 'breakdown-master',
      title: `Master prompts · ${bd.ad.title || slug}`,
      // Land straight on the SHOTLIST — where the per-shot master prompts live.
      nav: { view: 'breakdown', projectId: null, sub: { breakdownSlug: slug, breakdownPage: 'shotlist' } },
      stages: [{ key: 'fuse', label: 'Fuse one master prompt per shot', state: 'pending' }],
      progressText: `0 / ${total}`,
    });
    const acc: Record<number, ShotMasterPrompt> = {};
    const res = await runMasterPromptStage(input, ev => {
      if (ev.type === 'mp-shot') {
        acc[ev.no] = ev.mp;
        setMasterMaking(m => (m ? { ...m, done: m.done + 1 } : m));
        useStore.getState().updateJob(jobId, { progressText: `${Object.keys(acc).length} / ${total} shots` });
      }
    }, () => false, already);
    if (Object.keys(acc).length) {
      const merged = mergeMasterPrompts(bd, acc);
      setBd(merged);
      try { await window.hjen.mindBreakdownWrite({ slug, breakdown: merged }); } catch { /* next run retries */ }
    }
    setMasterMaking(res.ok ? null : { active: false, done: Object.keys(acc).length, total, error: res.message });
    useStore.getState().finishJob(jobId, res.ok
      ? { status: 'done' }
      : { status: 'error', error: res.message || 'Master-prompt fusion stopped' });
  }, [bd, slug, dnaStatuses, masterMaking]);

  // UNDERSTAND THE CAST & PLACES — the one vision pass. Clusters the ad's
  // DISTINCT recurring persons + places, links each to the shots it appears in,
  // then merges the roster onto pipeline.entities and persists it (the SAME
  // setBd + mindBreakdownWrite discipline makeMasters uses). Once persisted, a
  // REMAKE/RE-FUSE consumes it automatically (the fusion reads bd.pipeline.entities).
  const understandEntities = useCallback(async () => {
    if (!bd || !slug || entitiesMaking?.active) return;
    setEntitiesMaking({ active: true });
    const jb = useStore.getState();
    const jobId = jb.startJob({
      kind: 'breakdown-entities',
      title: `Cast & places · ${bd.ad.title || slug}`,
      // Land back on the SHOTLIST — where the roster + shot chips live.
      nav: { view: 'breakdown', projectId: null, sub: { breakdownSlug: slug, breakdownPage: 'shotlist' } },
      stages: [{ key: 'resolve', label: 'Understand the cast & places', state: 'pending' }],
      progressText: 'reading one frame per shot…',
    });
    const res = await resolveEntities(bd);
    if (res.ok && res.roster) {
      const base = bdRef.current || bd;
      const merged: AdBreakdown = { ...base, pipeline: { ...base.pipeline, entities: res.roster } };
      bdRef.current = merged; setBd(merged);
      try { await window.hjen.mindBreakdownWrite({ slug, breakdown: merged }); } catch { /* next run retries */ }
      setEntitiesMaking(null);
      useStore.getState().updateJob(jobId, { progressText: `${res.roster.persons.length} people · ${res.roster.places.length} places` });
      useStore.getState().finishJob(jobId, { status: 'done' });
    } else {
      setEntitiesMaking({ active: false, error: res.message || 'Could not understand the cast & places.' });
      useStore.getState().finishJob(jobId, { status: 'error', error: res.message || 'Entity understanding stopped' });
    }
  }, [bd, slug, entitiesMaking]);

  // EDIT AN ENTITY'S BUILD PROMPT — persist the tweaked wording back onto the
  // entity in pipeline.entities, merged onto the FRESHEST breakdown (bdRef) so a
  // concurrent build/make never clobbers it (same discipline as patchRow).
  const editEntityPrompt = useCallback(async (kind: EntityKind, id: string, prompt: string) => {
    const prev = bdRef.current;
    if (!prev || !slug || !prev.pipeline.entities) return;
    const merged = patchEntity(prev, kind, id, { prompt });
    bdRef.current = merged; setBd(merged);
    try { await window.hjen.mindBreakdownWrite({ slug, breakdown: merged }); } catch { /* next edit retries */ }
  }, [slug]);

  // BUILD REFERENCE — MAKE a clean reference for one entity/asset from its TEXT
  // prompt only (the store action never feeds the ad's frame), then LINK it to its
  // shots. The store returns the merged breakdown (builtRef + shot attachments
  // stamped on the freshest disk copy); we adopt it so the card shows the built
  // thumbnail + linked-to-shots line without a reload.
  const buildEntityRef = useCallback(async (kind: EntityKind, id: string) => {
    if (!bd || !slug || entBuilding[id]) return;
    setEntBuildErrors(e => { const n = { ...e }; delete n[id]; return n; });
    setEntBuilding(m => ({ ...m, [id]: true }));
    const res = await useStore.getState().buildEntityReference({ slug, kind, id });
    setEntBuilding(m => { const n = { ...m }; delete n[id]; return n; });
    if (res.ok && res.breakdown) { bdRef.current = res.breakdown; setBd(res.breakdown); }
    // A message accompanies a hard failure OR a built-but-link-failed partial —
    // surface it either way (the built image still shows when a breakdown came back).
    if (res.message) setEntBuildErrors(e => ({ ...e, [id]: res.message! }));
  }, [bd, slug, entBuilding]);

  // REVERT a built-reference slot to an older build in its history — sets the
  // active pointer + (for linked slots: the person SHEET, the place/asset ref)
  // REPLACES the shot link to the reverted image (de-duped, never stacked). No
  // image is ever deleted — this only moves the pointer. Freshest-bdRef discipline.
  const revertEntityRef = useCallback(async (kind: EntityKind, id: string, slot: RefSlot, at: string) => {
    const prev = bdRef.current;
    if (!prev || !slug || !prev.pipeline.entities) return;
    const ent = findEntity(prev, kind, id); if (!ent) return;
    const patch: any = {};
    let relinkPath: string | undefined;
    if (slot === 'face') {
      patch.activeFaceAt = at;   // face is a pure identity ref — not linked to shots
    } else if (slot === 'sheet') {
      patch.activeSheetAt = at;
      const list = foldLegacy((ent as any).builtSheets, (ent as any).builtSheet);
      relinkPath = list.find(b => b.at === at)?.path;
    } else {
      patch.activeRefAt = at;
      const list = foldLegacy((ent as any).builtRefs, (ent as any).builtRef);
      relinkPath = list.find(b => b.at === at)?.path;
    }
    let merged = patchEntity(prev, kind, id, patch);
    if (relinkPath) {
      const role: 'both' | 'frame' = kind === 'place' ? 'frame' : 'both';
      const note = kind === 'person' ? `${id} identity` : `${id} reference`;
      merged = linkBuiltRefToShots(merged, id, ent.shotNos, relinkPath, role, note);
    }
    bdRef.current = merged; setBd(merged);
    try { await window.hjen.mindBreakdownWrite({ slug, breakdown: merged }); } catch { /* next edit retries */ }
  }, [slug]);

  // ORPHANED REFERENCES — SCAN the active project's library for built references
  // this breakdown no longer points at (a disk hit, run only on demand). RESTORE
  // re-appends one orphan to its entity's slot history (a pointer only — no file
  // is ever touched) and adopts the merged breakdown so the card's history grows
  // in place. Freshest-read merge lives in the store action.
  const scanOrphans = useCallback(async () => {
    if (!slug || orphanScanning) return;
    setOrphanScanning(true); setOrphanError(undefined);
    try {
      const list = await useStore.getState().scanOrphanRefs({ slug });
      setOrphanList(list);
    } catch (e: any) {
      setOrphanError(e?.message || String(e)); setOrphanList([]);
    } finally {
      setOrphanScanning(false);
    }
  }, [slug, orphanScanning]);

  const restoreOrphan = useCallback(async (o: OrphanRef) => {
    if (!slug || orphanRestoring[o.imgPath] || orphanRestored[o.imgPath]) return;
    setOrphanRestoring(m => ({ ...m, [o.imgPath]: true }));
    setOrphanError(undefined);
    const res = await useStore.getState().restoreOrphanRef({
      slug, imgPath: o.imgPath, id: o.id, kind: o.kind, part: o.part, at: o.at,
    });
    setOrphanRestoring(m => { const n = { ...m }; delete n[o.imgPath]; return n; });
    if (res.ok) {
      setOrphanRestored(m => ({ ...m, [o.imgPath]: true }));
      if (res.breakdown) { bdRef.current = res.breakdown; setBd(res.breakdown); }   // history grows in place
    } else if (res.message) {
      setOrphanError(res.message);
    }
  }, [slug, orphanRestoring, orphanRestored]);

  const revealOrphan = useCallback((imgPath: string) => {
    void window.hjen.revealInFinder(imgPath).catch(() => { /* reveal is best-effort */ });
  }, []);

  // REMAKE (re-fuse) ONE shot — rebuild just this shot's master prompt with the
  // upgraded fusion, IGNORING the "already made" skip. We fuse a single shot by
  // skipping EVERY OTHER shot number, so the stage runs exactly this one through
  // the improved grounding-first pass. Same persist discipline as makeMasters
  // (setBd + mindBreakdownWrite), merged onto the FRESHEST breakdown so a
  // concurrent frame/video make is never clobbered.
  const remakeShot = useCallback(async (r: BreakdownShotRow) => {
    if (!bd || !slug || shotRefusing[r.no]) return;
    const liveDnas = Object.values(dnaStatuses).filter(k => k === 'live').length;
    if (liveDnas === 0) {
      setShotRefuseErrors(e => ({ ...e, [r.no]: 'Make the axis DNAs first — the master prompts fuse them.' }));
      return;
    }
    setShotRefuseErrors(e => { const n = { ...e }; delete n[r.no]; return n; });
    setShotRefusing(m => ({ ...m, [r.no]: true }));
    const input = masterPromptInputFromBreakdown(bd);
    // The single-shot target: skip is EVERY shot number except this one.
    const skipAllExceptThisShot = new Set(input.shots.map(s => s.no).filter(no => no !== r.no));
    const jb = useStore.getState();
    const jobId = jb.startJob({
      kind: 'breakdown-master',
      title: `Re-fuse shot ${r.no} · ${bd.ad.title || slug}`,
      nav: { view: 'breakdown', projectId: null, sub: { breakdownSlug: slug, breakdownPage: 'shotlist' } },
      stages: [{ key: 'fuse', label: `Re-fuse shot ${r.no}`, state: 'pending' }],
      progressText: `shot ${r.no}`,
    });
    let mp: ShotMasterPrompt | null = null;
    const res = await runMasterPromptStage(input, ev => {
      if (ev.type === 'mp-shot' && ev.no === r.no) mp = ev.mp;
    }, () => false, skipAllExceptThisShot);
    setShotRefusing(m => { const n = { ...m }; delete n[r.no]; return n; });
    if (mp) {
      const merged = mergeMasterPrompts(bdRef.current || bd, { [r.no]: mp });
      bdRef.current = merged; setBd(merged);
      try { await window.hjen.mindBreakdownWrite({ slug, breakdown: merged }); } catch { /* next run retries */ }
    } else {
      setShotRefuseErrors(e => ({ ...e, [r.no]: res.message || 'The re-fuse stopped — nothing came back for this shot.' }));
    }
    useStore.getState().finishJob(jobId, res.ok && mp
      ? { status: 'done' }
      : { status: 'error', error: res.message || 'Re-fuse stopped' });
  }, [bd, slug, dnaStatuses, shotRefusing]);

  // RE-FUSE ALL — rebuild EVERY shot's master prompt with the upgraded fusion,
  // ignoring the "already made" skip (empty skip → the stage runs every shot).
  // Overwrites all existing master prompts, so the toolbar gates it behind a
  // light two-step confirm. Persists progressively (merge + write per shot) so a
  // long run leaves durable partial progress. Shares the masterMaking progress UI.
  const refuseAllMasters = useCallback(async () => {
    if (!bd || !slug || masterMaking?.active) return;
    const liveDnas = Object.values(dnaStatuses).filter(k => k === 'live').length;
    if (liveDnas === 0) {
      setMasterMaking({ active: false, done: 0, total: 0, error: 'Make the axis DNAs first — the master prompts fuse them.' });
      return;
    }
    const input = masterPromptInputFromBreakdown(bd);
    const total = input.shots.length;
    if (!total) { setMasterMaking(null); return; }
    setMasterMaking({ active: true, done: 0, total });
    const jb = useStore.getState();
    const jobId = jb.startJob({
      kind: 'breakdown-master',
      title: `Re-fuse all · ${bd.ad.title || slug}`,
      nav: { view: 'breakdown', projectId: null, sub: { breakdownSlug: slug, breakdownPage: 'shotlist' } },
      stages: [{ key: 'fuse', label: 'Re-fuse every shot', state: 'pending' }],
      progressText: `0 / ${total}`,
    });
    const acc: Record<number, ShotMasterPrompt> = {};
    const res = await runMasterPromptStage(input, ev => {
      if (ev.type === 'mp-shot') {
        acc[ev.no] = ev.mp;
        setMasterMaking(m => (m ? { ...m, done: m.done + 1 } : m));
        // progressive persist — merge this shot onto the freshest breakdown + write
        const merged = mergeMasterPrompts(bdRef.current || bd, { [ev.no]: ev.mp });
        bdRef.current = merged; setBd(merged);
        void window.hjen.mindBreakdownWrite({ slug, breakdown: merged }).catch(() => { /* next shot's write retries */ });
        useStore.getState().updateJob(jobId, { progressText: `${Object.keys(acc).length} / ${total} shots` });
      }
    }, () => false);   // empty skip → every shot is re-fused
    setMasterMaking(res.ok ? null : { active: false, done: Object.keys(acc).length, total, error: res.message });
    useStore.getState().finishJob(jobId, res.ok
      ? { status: 'done' }
      : { status: 'error', error: res.message || 'Master-prompt re-fusion stopped' });
  }, [bd, slug, dnaStatuses, masterMaking]);

  // Pin a MADE frame onto its shot row + return the merged breakdown. Reads the
  // freshest breakdown from bdRef (not React state) so concurrent pool workers
  // each build on the latest, then the caller persists the merged result.
  const pinMadeFrame = useCallback((no: number, path: string): AdBreakdown | null => {
    const prev = bdRef.current;
    const sl = (prev?.pipeline as any)?.shotlist;
    if (!prev || !sl?.rows) return null;
    const rows = (sl.rows as BreakdownShotRow[]).map(r =>
      r.no === no ? { ...r, madeFrame: { path, at: new Date().toISOString() } } : r);
    const merged: AdBreakdown = { ...prev, pipeline: { ...prev.pipeline, shotlist: { ...sl, rows } } };
    bdRef.current = merged;
    setBd(merged);
    return merged;
  }, []);

  // One shot's FRAME make. Isolated from the user's Frame session (the store
  // action clones initialSelections). On success the MADE frame is pinned to the
  // row and the breakdown is persisted so the comparison survives reload.
  const runOneShotFrame = useCallback(async (r: BreakdownShotRow): Promise<boolean> => {
    if (!bd || !slug) return false;
    const frame = r.masterPrompt?.frame?.trim();
    if (!frame) { setShotErrors(e => ({ ...e, [r.no]: 'This shot has no fused FRAME prompt yet — make the master prompts first.' })); return false; }
    setShotErrors(e => { const n = { ...e }; delete n[r.no]; return n; });
    setShotMaking(m => ({ ...m, [r.no]: true }));
    const res = await useStore.getState().makeBreakdownShotFrame({
      slug, no: r.no, prompt: frame, quality: frameQuality, aspect: frameAspect,
      model: frameModel, refPaths: frameRefPaths(r.attachments),
      appendix: composeAppendix(r.attachments, 'frame'), title: bd.ad.title,
    });
    setShotMaking(m => { const n = { ...m }; delete n[r.no]; return n; });
    if (res.ok && res.path) {
      const merged = pinMadeFrame(r.no, res.path);
      if (merged) { try { await window.hjen.mindBreakdownWrite({ slug, breakdown: merged }); } catch { /* next make retries */ } }
      return true;
    }
    setShotErrors(e => ({ ...e, [r.no]: res.message || 'The make stopped.' }));
    return false;
  }, [bd, slug, frameQuality, frameAspect, frameModel, pinMadeFrame]);

  const makeShotFrame = useCallback((r: BreakdownShotRow) => {
    if (shotMaking[r.no]) return;
    void runOneShotFrame(r);
  }, [shotMaking, runOneShotFrame]);

  // Pin a MADE video onto its shot row + return the merged breakdown. Mirrors
  // pinMadeFrame — reads the freshest breakdown from bdRef (not React state) so a
  // concurrent frame/video completion never clobbers the other before disk write.
  const pinMadeVideo = useCallback((no: number, path: string): AdBreakdown | null => {
    const prev = bdRef.current;
    const sl = (prev?.pipeline as any)?.shotlist;
    if (!prev || !sl?.rows) return null;
    const rows = (sl.rows as BreakdownShotRow[]).map(r =>
      r.no === no ? { ...r, madeVideo: { path, at: new Date().toISOString() } } : r);
    const merged: AdBreakdown = { ...prev, pipeline: { ...prev.pipeline, shotlist: { ...sl, rows } } };
    bdRef.current = merged;
    setBd(merged);
    return merged;
  }, []);

  // One shot's VIDEO make. Isolated from the user's Video session (the store
  // action drives Seedance directly, never reading selections/layers/videoJobs).
  // Needs the MADE frame — it is the clip's first frame. On success the MADE video
  // is pinned to the row and the breakdown persisted so it survives reload.
  const runOneShotVideo = useCallback(async (r: BreakdownShotRow): Promise<boolean> => {
    if (!bd || !slug) return false;
    const video = r.masterPrompt?.video?.trim();
    if (!video) { setShotVidErrors(e => ({ ...e, [r.no]: 'This shot has no fused VIDEO prompt yet — make the master prompts first.' })); return false; }
    if (!r.madeFrame?.path) { setShotVidErrors(e => ({ ...e, [r.no]: 'Make the frame first — the video needs its first frame.' })); return false; }
    setShotVidErrors(e => { const n = { ...e }; delete n[r.no]; return n; });
    setShotVidMaking(m => ({ ...m, [r.no]: true }));
    // Duration is BOUND to this shot's on-screen length — snapped to the chosen
    // model's nearest allowed value — not a fixed global. (Falls back to the
    // global picker only when the shot has no measurable tc window.)
    const allRows = (((bd.pipeline as any)?.shotlist?.rows || []) as BreakdownShotRow[]);
    const shotDur = shotDurationSec(allRows, r.no, bd.ad.durationS);
    const durations = videoModelById(videoModelId)?.durations ?? [5, 10];
    const duration = shotDur != null ? snapDuration(shotDur, durations) : snapDuration(videoDuration, durations);
    const res = await useStore.getState().makeBreakdownShotVideo({
      slug, no: r.no, prompt: video, imagePath: r.madeFrame.path,
      modelId: videoModelId, resolution: videoResolution, duration,
      ratio: toSeedanceRatio(frameAspect),
      endImagePath: videoEndFrame(r.attachments),
      refPaths: (r.attachments || []).map(a => a.path),
      appendix: composeAppendix(r.attachments, 'video'), title: bd.ad.title,
    });
    setShotVidMaking(m => { const n = { ...m }; delete n[r.no]; return n; });
    if (res.ok && res.path) {
      const merged = pinMadeVideo(r.no, res.path);
      if (merged) { try { await window.hjen.mindBreakdownWrite({ slug, breakdown: merged }); } catch { /* next make retries */ } }
      return true;
    }
    setShotVidErrors(e => ({ ...e, [r.no]: res.message || 'The make stopped.' }));
    return false;
  }, [bd, slug, frameAspect, videoModelId, videoResolution, videoDuration, pinMadeVideo]);

  const makeShotVideo = useCallback((r: BreakdownShotRow) => {
    if (shotVidMaking[r.no]) return;
    void runOneShotVideo(r);
  }, [shotVidMaking, runOneShotVideo]);

  // Merge a patch into one shot row + persist (same freshest-read discipline as
  // pinMadeFrame). Used by the live-attachment handlers.
  const patchRow = useCallback(async (no: number, patch: Partial<BreakdownShotRow>) => {
    const prev = bdRef.current;
    const sl = (prev?.pipeline as any)?.shotlist;
    if (!prev || !sl?.rows || !slug) return;
    const rows = (sl.rows as BreakdownShotRow[]).map(r => r.no === no ? { ...r, ...patch } : r);
    const merged: AdBreakdown = { ...prev, pipeline: { ...prev.pipeline, shotlist: { ...sl, rows } } };
    bdRef.current = merged; setBd(merged);
    try { await window.hjen.mindBreakdownWrite({ slug, breakdown: merged }); } catch { /* next edit retries */ }
  }, [slug]);

  const rowAtts = (no: number): ShotAttachment[] =>
    ((bdRef.current?.pipeline as any)?.shotlist?.rows?.find((x: BreakdownShotRow) => x.no === no)?.attachments) || [];

  // Attach references live — reuses the app's native file pickers (images can be
  // multi-selected; a clip is one file). Never touches the user's Frame/Video refs.
  const attachToShot = useCallback(async (r: BreakdownShotRow, kind: 'image' | 'video') => {
    let paths: string[] = [];
    try {
      if (kind === 'image') paths = (await window.hjen.pickImageFiles()) || [];
      else { const p = await window.hjen.pickVideoFile(); if (p) paths = [p]; }
    } catch { paths = []; }
    if (!paths.length) return;
    const add: ShotAttachment[] = paths.map((p, i) => ({
      id: `att-${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 5)}`,
      path: p, kind, role: 'both',
    }));
    await patchRow(r.no, { attachments: [...rowAtts(r.no), ...add] });
  }, [patchRow]);
  const setAttachNote = useCallback((r: BreakdownShotRow, id: string, note: string) => {
    void patchRow(r.no, { attachments: rowAtts(r.no).map(a => a.id === id ? { ...a, note } : a) });
  }, [patchRow]);
  const setAttachRole = useCallback((r: BreakdownShotRow, id: string, role: 'both' | 'frame' | 'video') => {
    void patchRow(r.no, { attachments: rowAtts(r.no).map(a => a.id === id ? { ...a, role } : a) });
  }, [patchRow]);
  const removeAttach = useCallback((r: BreakdownShotRow, id: string) => {
    void patchRow(r.no, { attachments: rowAtts(r.no).filter(a => a.id !== id) });
  }, [patchRow]);
  const genRefsForShot = useCallback((no: number): GenRef[] =>
    generatedRefsForShot((bd?.pipeline as any)?.entities as BreakdownEntities | undefined, no), [bd]);

  // UPDATE a live reference. If it was dropped from a generated entity reference
  // (has `source`), re-pull that entity's LATEST built version AUTOMATICALLY —
  // no picker. A manually-attached file falls back to the file picker.
  const updateAttach = useCallback(async (r: BreakdownShotRow, id: string) => {
    const cur = rowAtts(r.no).find(a => a.id === id);
    if (!cur) return;
    if (cur.source) {
      const want = cur.source.kind === 'person' ? 'person-sheet' : cur.source.kind;   // legacy 'person' == sheet
      const gen = genRefsForShot(r.no).find(g => g.kind === want && g.id === cur.source!.id);
      if (gen?.path) void patchRow(r.no, { attachments: rowAtts(r.no).map(a => a.id === id ? { ...a, path: gen.path } : a) });
      return;   // sourced refs never open a picker
    }
    let p: string | undefined;
    try {
      if (cur.kind === 'image') { const ps = (await window.hjen.pickImageFiles()) || []; p = ps[0]; }
      else { p = (await window.hjen.pickVideoFile()) || undefined; }
    } catch { p = undefined; }
    if (!p) return;
    void patchRow(r.no, { attachments: rowAtts(r.no).map(a => a.id === id ? { ...a, path: p! } : a) });
  }, [patchRow, genRefsForShot]);

  // UPDATE ALL — clears the shot's PREVIOUS generated references (whether
  // source-linked or an old hand-attached copy of a built-ref file) and lays down
  // a FRESH set at the latest built version. No duplicates, no manual cleanup.
  // Genuinely manual/external attachments (mood images, motion clips that aren't
  // built refs) are preserved.
  const syncGenRefs = useCallback((r: BreakdownShotRow) => {
    const roster = (bd?.pipeline as any)?.entities as BreakdownEntities | undefined;
    const gens = generatedRefsForShot(roster, r.no);
    if (!gens.length) return;
    const managed = managedBuiltPathsForShot(roster, r.no);
    const keptManual = rowAtts(r.no).filter(a => !a.source && !managed.has(a.path));
    const fresh: ShotAttachment[] = gens.map((g, i) => ({
      id: `att-${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 5)}`,
      path: g.path, kind: 'image', role: 'both', note: g.note, source: { kind: g.kind, id: g.id },
    }));
    void patchRow(r.no, { attachments: [...fresh, ...keptManual] });
  }, [patchRow, bd]);

  // MAKE VIDEOS FOR ALL — bounded pool (video is heavy + paid): make every shot
  // that has a fused VIDEO prompt AND a MADE frame and isn't already a video.
  const makeAllVideos = useCallback(async () => {
    if (!bd || !slug || videoAll?.active) return;
    const rows = (((bd.pipeline as any)?.shotlist?.rows || []) as BreakdownShotRow[])
      .filter(r => r.masterPrompt?.video?.trim() && r.madeFrame && !r.madeVideo && !shotVidMaking[r.no]);
    if (!rows.length) return;
    setVideoAll({ active: true, done: 0, total: rows.length });
    const POOL = 2;
    let idx = 0;
    const worker = async () => {
      for (;;) {
        const i = idx++;
        if (i >= rows.length) return;
        await runOneShotVideo(rows[i]);
        setVideoAll(v => (v ? { ...v, done: v.done + 1 } : v));
      }
    };
    await Promise.all(Array.from({ length: Math.min(POOL, rows.length) }, worker));
    setVideoAll(null);
  }, [bd, slug, videoAll, shotVidMaking, runOneShotVideo]);

  // MAKE FRAMES FOR ALL — a bounded pool (image gen is heavy + paid): make every
  // shot that has a FRAME prompt and isn't already made. Persists after each.
  const makeAllFrames = useCallback(async () => {
    if (!bd || !slug || frameAll?.active) return;
    const rows = (((bd.pipeline as any)?.shotlist?.rows || []) as BreakdownShotRow[])
      .filter(r => r.masterPrompt?.frame?.trim() && !r.madeFrame && !shotMaking[r.no]);
    if (!rows.length) return;
    setFrameAll({ active: true, done: 0, total: rows.length });
    const POOL = 3;
    let idx = 0;
    const worker = async () => {
      for (;;) {
        const i = idx++;
        if (i >= rows.length) return;
        await runOneShotFrame(rows[i]);
        setFrameAll(f => (f ? { ...f, done: f.done + 1 } : f));
      }
    };
    await Promise.all(Array.from({ length: Math.min(POOL, rows.length) }, worker));
    setFrameAll(null);
  }, [bd, slug, frameAll, shotMaking, runOneShotFrame]);

  // Escape closes a page → back to the disc
  useEffect(() => {
    if (!page) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPage(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [page]);

  const model = useMemo(() => (bd ? buildDiscModel(bd) : null), [bd]);

  // resolve a DNA page's content on demand (real folder → demo → pending)
  useEffect(() => {
    if (page?.kind !== 'dna' || !slug) return;
    const ax = page.axisSlug;
    if (dnaCache[ax]) return;
    let alive = true;
    loadBreakdownDna(slug, ax).then(res => { if (alive) setDnaCache(c => ({ ...c, [ax]: res })); });
    return () => { alive = false; };
  }, [page, slug, dnaCache]);

  // ── NEW BREAKDOWN — the form ──
  if (flow === 'new') {
    return (
      <div className="bd-root">
        <div className="bd-bar">
          <button className="bd-bar__back" onClick={() => setFlow('browse')} aria-label="Back to breakdowns">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><path d="M15 6l-6 6 6 6" /></svg>
            BREAKDOWNS
          </button>
          <span className="bd-wordmark">BREAK<b>DOWN</b></span>
        </div>
        <NewBreakdown
          onBack={() => setFlow('browse')}
          onStart={i => { setRunInput(i); setFlow('progress'); }}
        />
      </div>
    );
  }

  // ── NEW BREAKDOWN — the run in flight ──
  if (flow === 'progress' && runInput) {
    return (
      <div className="bd-root">
        <div className="bd-bar">
          <button className="bd-bar__back" onClick={() => setFlow('browse')} aria-label="Back to breakdowns (keeps running)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><path d="M15 6l-6 6 6 6" /></svg>
            BREAKDOWNS
          </button>
          <span className="bd-wordmark">BREAK<b>DOWN</b></span>
        </div>
        <BreakdownProgress
          input={runInput}
          onExit={() => setFlow('browse')}
          onDone={s => { refreshList(); setFlow('browse'); openBreakdown(s); }}
        />
      </div>
    );
  }

  // ── re-attached to a run already in flight (from a picker live card) ──
  if (flow === 'live' && liveJobId) {
    return (
      <div className="bd-root">
        <div className="bd-bar">
          <button className="bd-bar__back" onClick={() => { setFlow('browse'); setLiveJobId(null); }} aria-label="Back to breakdowns">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><path d="M15 6l-6 6 6 6" /></svg>
            BREAKDOWNS
          </button>
          <span className="bd-wordmark">BREAK<b>DOWN</b></span>
        </div>
        <BreakdownProgressLive
          jobId={liveJobId}
          onExit={() => { setFlow('browse'); setLiveJobId(null); setActiveTabSub({ liveJobId: null }); }}
          onDone={s => { setLiveJobId(null); setActiveTabSub({ liveJobId: null }); setFlow('browse'); refreshList(); openBreakdown(s); }}
        />
      </div>
    );
  }

  // ── picker (entry) ──
  if (!slug) {
    return (
      <div className="bd-root">
        <div className="bd-bar">
          <button className="bd-bar__back" onClick={() => setActiveView('studio')} aria-label="Back to Studio">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><path d="M15 6l-6 6 6 6" /></svg>
            STUDIO
          </button>
          <span className="bd-wordmark">BREAK<b>DOWN</b></span>
        </div>
        {list === null ? (
          <div className="bd-loading">READING INSTALLED BREAKDOWNS…</div>
        ) : list.length === 0 && runningRuns.length === 0 ? (
          <div className="bd-picker"><div className="bd-picker__empty">
            <svg className="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
              <circle cx="12" cy="12" r="9" /><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /><circle cx="12" cy="12" r="2.4" />
            </svg>
            <h2>No breakdowns yet</h2>
            <p>Point BREAKDOWN at a world-class ad — a link or a local video — and it reads the film back as if HJEN had <b>MADE</b> it: one MAKE prompt per craft axis, and the full pre-production package it would have taken to the client.</p>
            <button className="bd-actbtn primary" onClick={() => setFlow('new')}>+ NEW BREAKDOWN</button>
          </div></div>
        ) : (
          <div className="bd-picker"><div className="bd-picker__inner">
            <div className="bd-picker__head">
              <div className="bd-eyebrow">REVERSE-READ</div>
              <h1>Pick a breakdown</h1>
              <div className="bd-ar" dir="rtl">تشريح الإعلان — إعلان عالمي، مقروء بالعكس كأن هجين صنعه</div>
              <div className="bd-desc">Every ad, deconstructed as if HJEN MADE it. Open one to read its disc — 13 craft axes leading with THE MAKE PROMPT, and the reversed pre-production pipeline.</div>
            </div>
            <div className="bd-picker__grid">
              <button className="bd-bd-card bd-bd-card--new" onClick={() => setFlow('new')} aria-label="Start a new breakdown">
                <div className="bd-bd-card__body">
                  <span className="bd-bd-card__brand">START A REVERSE-READ</span>
                  <span className="bd-bd-card__title">New breakdown</span>
                  <span className="bd-newcard__hint">Paste an ad link or drop a file — read back as if HJEN MADE it.</span>
                  <span className="bd-newcard__cta">
                    BEGIN
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                  </span>
                </div>
              </button>
              {runningRuns.map(j => (
                <RunningCard key={j.id} job={j} onOpen={() => { setActiveTabSub({ liveJobId: j.id }); setLiveJobId(j.id); setFlow('live'); }} />
              ))}
              {list.map(b => (
                <PickerCard
                  key={b.slug} b={b}
                  onOpen={() => openBreakdown(b.slug)}
                  onRenamed={onRenamed} onDeleted={onDeleted}
                />
              ))}
            </div>
          </div></div>
        )}
      </div>
    );
  }

  // ── disc + pages ──
  return (
    <div className="bd-root">
      <div className="bd-bar">
        <button className="bd-bar__back" onClick={toPicker} aria-label="Back to breakdown picker">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><path d="M15 6l-6 6 6 6" /></svg>
          BREAKDOWNS
        </button>
        <span className="bd-wordmark">BREAK<b>DOWN</b></span>
        {bd && (
          <>
            <span className="bd-bar__ad"><b>{bd.ad.brand}</b> — {bd.ad.title}</span>
            {model && (
              <span className="bd-bar__stats">
                <span><b>{model.axes.filter(a => a.present).length}</b> AXES</span>
                <span><b>{model.findingsTotal}</b> FINDINGS</span>
                <span><b>{model.frames.size}</b> FRAMES</span>
              </span>
            )}
            <button
              className="bd-bar__brain"
              onClick={captureBrain}
              disabled={brainBusy}
              title="أودِع دروس هذا الإعلان في الذاكرة العابرة للمشاريع (الدماغ الثاني)"
              aria-label="Capture this breakdown's lessons into the second brain"
            >
              {brainBusy ? '…يلتقط' : brainMsg || 'الذاكرة ⌾'}
            </button>
          </>
        )}
      </div>

      {loadingBd || !bd || !model ? (
        <div className="bd-loading">{loadingBd ? 'OPENING THE DISC…' : 'BREAKDOWN NOT FOUND'}</div>
      ) : (
        <div className="bd-stage">
          <BreakdownDisc
            model={model}
            ad={bd.ad}
            onAxis={i => setPage({ kind: 'axis', i })}
            onStage={key => setPage({ kind: 'stage', key })}
            onHub={() => setPage({ kind: 'overview' })}
          />
          {/* the ad title — a clean typographic block UNDER the disc (moved off
              the hub image), forensic-amber eyebrow above, watch link below */}
          <div className="bd-disc-title">
            <div className="bd-disc-title__eyebrow">
              {(bd.ad.brand || '').toUpperCase()}{bd.ad.year ? ` · ${bd.ad.year}` : ''}
            </div>
            <h2 className="bd-disc-title__h">{bd.ad.title}</h2>
            <WatchFilmButton bd={bd} onPlayLocal={setWatchPath} />
          </div>
          <div className="bd-legend">
            <b>Outer ring</b> — 13 craft axes · <b>Inner ring</b> — the reversed pipeline · <b>Centre</b> — the film
          </div>
        </div>
      )}

      {page && bd && model && (
        <PageOverlay
          page={page} bd={bd} model={model}
          dnaStatuses={dnaStatuses} dnaCache={dnaCache}
          dnaMaking={dnaMaking} onMakeDnas={makeDnas}
          masterMaking={masterMaking} onMakeMasters={makeMasters}
          onRefuseAll={refuseAllMasters}
          entities={{
            roster: bd.pipeline.entities,
            making: !!entitiesMaking?.active,
            error: entitiesMaking && !entitiesMaking.active ? entitiesMaking.error : undefined,
            onUnderstand: understandEntities,
            building: entBuilding, buildErrors: entBuildErrors,
            onBuild: buildEntityRef, onEditPrompt: editEntityPrompt,
            onRevert: revertEntityRef,
            orphans: {
              list: orphanList, scanning: orphanScanning, error: orphanError,
              restoring: orphanRestoring, restored: orphanRestored,
              onScan: scanOrphans, onRestore: restoreOrphan, onReveal: revealOrphan,
            },
          }}
          shotFrames={{
            frames: bd.frames,
            quality: frameQuality, setQuality: setFrameQuality,
            aspect: frameAspect, setAspect: setFrameAspect,
            imageModel: frameModel, setImageModel: setFrameModel,
            making: shotMaking, errors: shotErrors,
            onMakeShot: makeShotFrame, onMakeAll: makeAllFrames,
            all: frameAll,
            refusing: shotRefusing, refuseErrors: shotRefuseErrors,
            onRemakeShot: remakeShot,
            vidMaking: shotVidMaking, vidErrors: shotVidErrors,
            onMakeShotVideo: makeShotVideo,
            onMakeAllVideos: makeAllVideos, allVideos: videoAll,
            videoModelId, setVideoModelId,
            videoResolution, setVideoResolution,
            videoDuration, setVideoDuration,
            onAttach: attachToShot, onAttachNote: setAttachNote,
            onAttachRole: setAttachRole, onAttachRemove: removeAttach,
            onAttachUpdate: updateAttach, onAttachSyncAll: syncGenRefs,
            genRefCount: (no: number) => genRefsForShot(no).length,
          }}
          onClose={() => setPage(null)}
          openDna={axisSlug => setPage({ kind: 'dna', axisSlug })}
          openDnaLib={() => setPage({ kind: 'dnalib' })}
          onWatch={setWatchPath}
        />
      )}

      {watchPath && bd && (
        <FilmOverlay path={watchPath} title={bd.ad.title} onClose={() => setWatchPath(null)} />
      )}
    </div>
  );
}

// ─── running card — a breakdown still being MADE (not on disk yet) ──────────
// Surfaces an in-flight `breakdown-run` BgJob in the picker so a run in the
// background is never lost from view. Clicking re-attaches to its live progress.
function RunningCard({ job, onOpen }: { job: BgJob; onOpen: () => void }) {
  const title = job.title.replace(/^Breakdown · /, '');
  const active = job.stages.find(s => s.state === 'active');
  // The step we're ON (active index + 1), matching the tab + status bar — not the
  // count of finished steps, so all three surfaces read the same fraction.
  const activeIdx = job.stages.findIndex(s => s.state === 'active');
  const cur = activeIdx >= 0 ? activeIdx + 1 : job.stages.filter(s => s.state === 'done').length;
  return (
    <button className="bd-bd-card bd-bd-card--running" onClick={onOpen} aria-label={`Open the running breakdown ${title}`}>
      <div className="bd-bd-card__body">
        <span className="bd-bd-card__brand bd-running__brand">
          <span className="bd-running__dot" aria-hidden="true" />
          MAKING NOW · {cur}/{job.stages.length}
        </span>
        <span className="bd-bd-card__title">{title}</span>
        <span className="bd-running__stagechip">{(active?.label || 'Starting').toUpperCase()}</span>
        <span className="bd-running__prog">{job.progressText || 'Fetching the film…'}</span>
      </div>
    </button>
  );
}

// ─── picker card ────────────────────────────────────────────────────────────

function PickerCard({ b, onOpen, onRenamed, onDeleted }: {
  b: BreakdownSummary; onOpen: () => void;
  onRenamed: (slug: string, title: string) => void;
  onDeleted: (slug: string) => void;
}) {
  const [cover, setCover] = useState<string | undefined>(undefined);
  // 'idle' → the card · 'rename' → inline title editor · 'confirm' → delete confirm
  const [mode, setMode] = useState<'idle' | 'rename' | 'confirm'>('idle');
  const [draft, setDraft] = useState(b.title);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // pull the first frame as a cover, lazily (one read; harmless if it fails)
  useEffect(() => {
    let alive = true;
    readBreakdown(b.slug).then(d => {
      const f = d?.frames?.[0];
      if (alive && f?.file) setCover(hjenFileUrl(f.file));
    });
    return () => { alive = false; };
  }, [b.slug]);
  // keep the draft in step with the summary title (e.g. after a rename refresh)
  useEffect(() => { setDraft(b.title); }, [b.title]);
  // focus + select the field the moment the rename editor opens
  useEffect(() => { if (mode === 'rename') { inputRef.current?.focus(); inputRef.current?.select(); } }, [mode]);

  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const cancel = () => { setMode('idle'); setErr(null); setDraft(b.title); };
  const startRename = (e: React.MouseEvent) => { e.stopPropagation(); setErr(null); setDraft(b.title); setMode('rename'); };
  const startDelete = (e: React.MouseEvent) => { e.stopPropagation(); setErr(null); setMode('confirm'); };

  const saveRename = async () => {
    const t = draft.trim();
    if (!t || t === b.title) { cancel(); return; }
    setBusy(true); setErr(null);
    const res = await renameBreakdown(b.slug, t);
    setBusy(false);
    if (res.ok) { setMode('idle'); onRenamed(b.slug, res.title || t); }
    else setErr(res.message || 'Rename failed');
  };
  const doDelete = async () => {
    setBusy(true); setErr(null);
    const res = await deleteBreakdown(b.slug);
    setBusy(false);
    if (res.ok) onDeleted(b.slug);   // parent refreshes the picker (card drops out)
    else setErr(res.message || 'Delete failed');
  };

  return (
    <div className={`bd-bd-card${mode !== 'idle' ? ' is-editing' : ''}`}>
      <button className="bd-bd-card__hit" onClick={onOpen} aria-label={`Open ${b.brand} ${b.title}`}>
        <div className="bd-bd-card__cover">
          {cover
            ? <img src={cover} alt="" loading="lazy" />
            : <span className="bd-bd-card__cover-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2.4" /><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /></svg>
              </span>}
        </div>
        <div className="bd-bd-card__body">
          {b.brand && <span className="bd-bd-card__brand">{b.brand}</span>}
          <span className="bd-bd-card__title">{b.title}</span>
          <span className="bd-bd-card__meta">
            <span>{b.frames} FRAMES</span>
            {b.approved && <span className="bd-bd-card__seal">● SEALED</span>}
          </span>
        </div>
      </button>

      {/* per-card controls — hover / focus reveal, kept off the card face */}
      <div className="bd-bd-card__ctl">
        <button type="button" className="bd-cardbtn" onClick={startRename} title="Rename title" aria-label={`Rename ${b.title}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true"><path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z" /><path d="M13.5 6.5l3 3" /></svg>
        </button>
        <button type="button" className="bd-cardbtn bd-cardbtn--danger" onClick={startDelete} title="Delete breakdown" aria-label={`Delete ${b.title}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" /><path d="M10 11v6M14 11v6" /></svg>
        </button>
      </div>

      {mode === 'rename' && (
        <div className="bd-cardedit" onClick={stop}>
          <span className="mono-label">RENAME — TITLE ONLY</span>
          <input
            ref={inputRef} className="bd-cardedit__input" value={draft} disabled={busy}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void saveRename(); } else if (e.key === 'Escape') { e.preventDefault(); cancel(); } }}
            aria-label="New display title"
          />
          {err && <span className="bd-cardedit__err">{err}</span>}
          <div className="bd-cardedit__row">
            <button type="button" className="bd-cardedit__btn" onClick={cancel} disabled={busy}>CANCEL</button>
            <button type="button" className="bd-cardedit__btn bd-cardedit__btn--primary" onClick={() => void saveRename()} disabled={busy || !draft.trim()}>{busy ? 'SAVING…' : 'SAVE'}</button>
          </div>
        </div>
      )}

      {mode === 'confirm' && (
        <div className="bd-cardedit bd-cardedit--danger" onClick={stop}>
          <span className="mono-label">DELETE BREAKDOWN</span>
          <p className="bd-cardedit__msg">Remove <b>{b.title}</b> and its whole folder? This can’t be undone.</p>
          {err && <span className="bd-cardedit__err">{err}</span>}
          <div className="bd-cardedit__row">
            <button type="button" className="bd-cardedit__btn" onClick={cancel} disabled={busy}>CANCEL</button>
            <button type="button" className="bd-cardedit__btn bd-cardedit__btn--danger" onClick={() => void doDelete()} disabled={busy}>{busy ? 'DELETING…' : 'DELETE'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── page overlay (axis / stage / dna library / dna / overview) ─────────────

type MakingState = { active: boolean; done: number; total: number; error?: string } | null;

interface OverlayProps {
  page: Page; bd: AdBreakdown; model: DiscModel;
  dnaStatuses: Record<string, DnaState['kind']>; dnaCache: Record<string, DnaState>;
  dnaMaking: MakingState; onMakeDnas: () => void;
  masterMaking: MakingState; onMakeMasters: () => void; onRefuseAll: () => void;
  entities: EntityCtl;
  shotFrames: ShotFramesCtl;
  onClose: () => void; openDna: (axisSlug: string) => void; openDnaLib: () => void;
  onWatch: (path: string) => void;
}

function PageOverlay({ page, bd, model, dnaStatuses, dnaCache, dnaMaking, onMakeDnas, masterMaking, onMakeMasters, onRefuseAll, entities, shotFrames, onClose, openDna, openDnaLib, onWatch }: OverlayProps) {
  let crumb: JSX.Element = <></>;
  let pending = false;
  let body: JSX.Element = <></>;
  const adIsNike = /nike/i.test(bd.ad.brand || '') || /nike/i.test(bd.slug || '');

  if (page.kind === 'axis') {
    const ax = model.axes[page.i];
    const job = jobFor(ax.slug);
    pending = !ax.present;
    const rp = ax.reproductionPrompt;
    const allText = [
      rp ? `THE MAKE PROMPT — ${ax.en}\n${rp}` : '',
      ...ax.findings.map(f => `• ${f.claim_en}${f.howHjenMakesIt ? `\n  ⟶ ${f.howHjenMakesIt}` : ''}`),
    ].filter(Boolean).join('\n\n');
    crumb = <>OUTER RING — AXIS <b>{pad2(page.i + 1)}/{model.axes.length}</b></>;
    body = (
      <>
        <div className="bd-head">
          <div className="bd-eyebrow">Craft axis {pad2(page.i + 1)} · OUTPUT 1 — “what if this was AI-MADE?”</div>
          <h1>{ax.en.toUpperCase()}</h1>
          <div className="bd-ar" dir="rtl">{ax.ar}{ax.present ? ` · ${ax.findings.length} خلاصة` : ' · قيد الصناعة'}</div>
          {ax.summary && <div className="bd-desc">{ax.summary}</div>}
          <div className="bd-actrow">
            {ax.present && allText && <button className="bd-actbtn" onClick={() => navigator.clipboard?.writeText(allText).catch(() => {})}>COPY ALL</button>}
            <button className="bd-actbtn ghost" onClick={() => openDna(ax.slug)}>OPEN DNA →</button>
          </div>
        </div>

        {/* OUTPUT 1 — THE MAKE PROMPT (leads the page) */}
        {rp ? (
          <div className="bd-makeprompt">
            <div className="bd-makeprompt__top">
              <span className="mono-label">THE MAKE PROMPT — {ax.en} alone</span>
              <CopyBtn text={rp} className="bd-copy--amber" />
            </div>
            <p className="bd-makeprompt__body selectable">{rp}</p>
            <div className="bd-makeprompt__hint">Hand this to a model to MAKE this ad’s result on this axis alone — separated from every other craft.</div>
          </div>
        ) : ax.present ? (
          <div className="bd-premise">This axis has no MAKE prompt (an earlier breakdown). Its evidence findings still read below.</div>
        ) : null}

        {ax.present ? (
          <>
            <h3 className="bd-sech">SUPPORTING EVIDENCE — {ax.findings.length} findings</h3>
            <div className="bd-grid2">{ax.findings.map(f => <FindingCard key={f.id} model={model} f={f} />)}</div>
          </>
        ) : (
          <div className="bd-premise">
            This axis is not in <b>{bd.ad.title}</b>’s data yet — it is made when this ad is run.
            The universal job below shows exactly how it will be deconstructed.
          </div>
        )}

        {job && (
          <details className="bd-jobsec" id="bd-jobsec">
            <summary>
              <span>THE ANALYST JOB — <b>UNIVERSAL</b> · how every ad is read on this axis</span>
              <span className="bd-jobsec__chev">▾</span>
            </summary>
            <div className="bd-jobsec__note">
              Universal analyst construction — the same for every breakdown. Its worked examples are canonical <b>Nike “WHY DO IT?”</b> cards, not <b>{bd.ad.title}</b>’s data. For this ad’s own MADE-side language, use <b>OPEN DNA</b> above.
            </div>
            <div className="bd-jobhead">{job.header}</div>
            <GemSegments gem={job} job adTitle={bd.ad.title} adIsNike={adIsNike} />
          </details>
        )}
      </>
    );
  } else if (page.kind === 'stage') {
    return (
      <StagePage
        stKey={page.key} bd={bd} model={model} onClose={onClose} openDnaLib={openDnaLib}
        dnaStatuses={dnaStatuses} masterMaking={masterMaking} onMakeMasters={onMakeMasters}
        onRefuseAll={onRefuseAll} entities={entities} shotFrames={shotFrames}
      />
    );
  } else if (page.kind === 'dnalib') {
    pending = true;
    crumb = <>INNER RING — <b>DNAS</b></>;
    body = (
      <>
        <div className="bd-head">
          <div className="bd-eyebrow">Reversed pipeline · DNAS</div>
          <h1>DNA LIBRARY</h1>
          <div className="bd-desc">One DNA file per outer-ring axis — 13 per breakdown. Each is a five-segment Gem (role · context · instructions · constraints · examples) distilled from that axis’s laws, with measured parameters. Real DNAs live in the breakdown’s <code>dna/</code> folder and drive future making alongside References.</div>
          <div className="bd-ar" dir="rtl">ملف DNA لكل محور خارجي — يقود المراحل القادمة مع الـReferences</div>
          {(() => {
            const withFindings = model.axes.filter(a => a.present && a.findings.length > 0);
            const makeable = withFindings.filter(a => dnaStatuses[a.slug] !== 'live').length;
            if (!withFindings.length) return null;
            const err = dnaMaking && !dnaMaking.active ? dnaMaking.error : undefined;
            return (
              <div className="bd-dnamake">
                {dnaMaking?.active ? (
                  <div className="bd-dnamake__run">
                    <span className="bd-dnamake__spin" aria-hidden="true" />
                    <span>MAKING THE DNAS… <b>{dnaMaking.done}/{dnaMaking.total}</b> distilled &amp; written LIVE</span>
                  </div>
                ) : makeable > 0 ? (
                  <div className="bd-dnamake__cta">
                    <button className="bd-actbtn primary" onClick={onMakeDnas}>
                      {err ? 'FINISH THE DNAS →' : `MAKE THE ${makeable === withFindings.length ? '' : 'MISSING '}DNAS →`}
                    </button>
                    <span className="bd-dnamake__hint">
                      {err
                        ? <>Stopped — <span className="selectable">{err}</span></>
                        : <>Distil {makeable} axis DNA{makeable === 1 ? '' : 's'} from <b>{bd.ad.title}</b>’s stored findings — no re-analysis. Each writes to <code>dna/</code> and flips LIVE.</>}
                    </span>
                  </div>
                ) : (
                  <div className="bd-dnamake__done">● ALL {withFindings.length} AXIS DNAS ARE LIVE — this ad’s own MADE-side language</div>
                )}
              </div>
            );
          })()}
        </div>
        <div className="bd-dna-grid">
          {BREAKDOWN_AXES.map((def, n) => {
            const st = dnaStatuses[def.slug];
            const cls = st === 'live' ? 'live' : st === 'demo' ? 'demo' : 'stub';
            const label = st === 'live' ? 'LIVE — REAL DNA' : st === 'demo' ? 'LIVE SAMPLE · DEMO' : 'PENDING — AFTER RUN';
            return (
              <button className="bd-dna-card" key={def.slug} onClick={() => openDna(def.slug)}>
                <span className="ax-no">DNA {pad2(n + 1)}/13 · dna/{def.slug}.gem.md</span>
                <span className="ax-name">{def.en.toUpperCase()}</span>
                <span className={`status ${cls}`}>{label}</span>
              </button>
            );
          })}
        </div>
      </>
    );
  } else if (page.kind === 'dna') {
    const def = BREAKDOWN_AXES.find(a => a.slug === page.axisSlug);
    const title = (def?.en || page.axisSlug).toUpperCase();
    const res = dnaCache[page.axisSlug];
    crumb = <>DNAS — <b>dna/{page.axisSlug}.gem.md</b></>;
    pending = !res || res.kind === 'pending';
    if (!res) {
      body = <><div className="bd-head"><div className="bd-eyebrow">Axis DNA · Gem construction</div><h1>DNA — {title}</h1></div><div className="bd-loading">READING DNA…</div></>;
    } else if (res.kind === 'pending') {
      body = (
        <>
          <div className="bd-head"><div className="bd-eyebrow">Axis DNA · Gem construction</div><h1>DNA — {title}</h1></div>
          <div className="bd-premise">PENDING — this DNA is made by <code>job_{page.axisSlug}</code> after the factory run for <b>{bd.ad.title}</b>, then written to <code>dna/{page.axisSlug}.gem.md</code> in this breakdown’s folder.</div>
          <div className="bd-sec"><h3>What will live here</h3>
            <p>The five-segment Gem for this axis: a specialist &lt;role&gt; soaked in this ad’s DNA · &lt;context&gt; with philosophy + measured machine parameters · &lt;instructions&gt; that turn a new scenario into one master prompt · &lt;constraints&gt; carrying the weight-3 laws only · &lt;examples&gt; of 4–6 master prompts each derived from a real evidence frame.</p>
          </div>
          <div className="bd-actrow"><button className="bd-actbtn ghost" onClick={openDnaLib}>‹ DNA LIBRARY</button></div>
        </>
      );
    } else {
      const demo = res.kind === 'demo';
      body = (
        <>
          <div className="bd-head">
            <div className="bd-eyebrow">Axis DNA · Gem construction{demo ? ' · Live sample (demo)' : ''}</div>
            <h1>DNA — {title}</h1>
            <div className="bd-desc">Distilled from this axis’s findings. Every law cites its evidence frames; every parameter is measured (sampled hex), never estimated; every example prompt is a real frame rewritten in this DNA’s language.</div>
            <div className="bd-jobhead" style={{ marginTop: 'var(--s-3)' }}>{res.gem.header}</div>
          </div>
          <GemSegments gem={res.gem} openFirst />
          <div className="bd-actrow"><button className="bd-actbtn ghost" onClick={openDnaLib}>‹ DNA LIBRARY</button></div>
        </>
      );
    }
  } else if (page.kind === 'overview') {
    crumb = <>CENTRE — <b>THE FILM</b></>;
    body = <OverviewBody bd={bd} model={model} onWatch={onWatch} />;
  }

  return (
    <div className="bd-page" role="dialog" aria-modal="true">
      <div className="bd-page__top">
        <button className="bd-bar__back" onClick={onClose} aria-label="Back to the disc (Esc)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><path d="M15 6l-6 6 6 6" /></svg>
          DISC
        </button>
        <span className="bd-crumb">{crumb}</span>
        {pending && <span className="bd-page__pending-chip">PENDING · FACTORY</span>}
      </div>
      <div className="bd-scroll"><div className="bd-inner">{body}</div></div>
    </div>
  );
}

// ─── shotlist — one expandable card per shot, revealing its fused master prompt

// "0:15.7" | "15" | "3.2s" → seconds. Mirrors masterPrompt.tcToSec.
function shotTcToSec(tc?: string): number | undefined {
  const s = (tc || '').trim(); if (!s) return undefined;
  const m = /(\d+):(\d+(?:\.\d+)?)/.exec(s);
  if (m) return (+m[1]) * 60 + (+m[2]);
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
}
/** A shot's on-screen length = its tc → the next shot's tc (or the ad's end). */
function shotDurationSec(rows: BreakdownShotRow[], no: number, adDurationS?: number): number | undefined {
  const i = rows.findIndex(r => r.no === no);
  if (i < 0) return undefined;
  const tcIn = shotTcToSec(rows[i].tc);
  if (tcIn == null) return undefined;
  const tcOut = shotTcToSec(rows[i + 1]?.tc) ?? adDurationS;
  return (tcOut != null && tcOut > tcIn) ? +(tcOut - tcIn).toFixed(2) : undefined;
}
/** Snap a desired length to the model's nearest allowed duration (ties → shorter). */
function snapDuration(sec: number, allowed: number[]): number {
  if (!allowed?.length) return Math.max(1, Math.round(sec));
  return [...allowed].sort((a, b) => (Math.abs(a - sec) - Math.abs(b - sec)) || (a - b))[0];
}
function fmtSec(sec: number): string {
  const m = Math.floor(sec / 60); const r = sec - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${(Math.round(r * 10) / 10).toString().replace(/\.0$/, '')}`;
}

// ─── ENTITY ROSTER — the ad's cast, places & assets, linked across shots ─────
// Grouped PEOPLE / PLACES / ASSETS, each a card with its provenance reference
// thumbnail, id (P1/L1/A1), descriptor, wardrobe (persons) or PROP/WARDROBE badge
// (assets), an EDITABLE build prompt, and a BUILD REFERENCE affordance that MAKES
// a clean reference from the prompt TEXT (no film) and links it to the shots.
// Recurring entities (shotNos.length > 1 — the linked ones that matter) sort first.
function EntityRoster({ roster, frames, open, onToggle, highlight, building, errors, onBuild, onEditPrompt, onRevert, orphans }: {
  roster: BreakdownEntities; frames: BreakdownFrame[];
  open: boolean; onToggle: (v: boolean) => void; highlight: string | null;
  building: Record<string, boolean>; errors: Record<string, string>;
  onBuild: (kind: EntityKind, id: string) => void;
  onEditPrompt: (kind: EntityKind, id: string, prompt: string) => void;
  onRevert: (kind: EntityKind, id: string, slot: RefSlot, at: string) => void;
  orphans: EntityCtl['orphans'];
}) {
  const fileById = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of frames) if (f.file) m.set(f.id, f.file);
    return m;
  }, [frames]);
  const byRecurrence = <T extends { shotNos: number[] }>(a: T, b: T) => b.shotNos.length - a.shotNos.length;
  const persons = useMemo(() => [...roster.persons].sort(byRecurrence), [roster.persons]);
  const places = useMemo(() => [...roster.places].sort(byRecurrence), [roster.places]);
  const assets = useMemo(() => [...(roster.assets || [])].sort(byRecurrence), [roster.assets]);
  const linked = [...roster.persons, ...roster.places, ...(roster.assets || [])].filter(e => e.shotNos.length > 1).length;

  const cardProps = (kind: EntityKind, id: string) => ({
    fileById, highlight: highlight === id,
    building: !!building[id], error: errors[id],
    onBuild: () => onBuild(kind, id),
    onEditPrompt: (prompt: string) => onEditPrompt(kind, id, prompt),
    onRevert: (slot: RefSlot, at: string) => onRevert(kind, id, slot, at),
  });

  return (
    <details className="bd-roster" open={open} onToggle={e => onToggle((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="bd-roster__sum">
        <span className="mono-label bd-roster__title">THE CAST, PLACES &amp; ASSETS — understood &amp; linked</span>
        <span className="bd-roster__stat">
          <b>{roster.persons.length}</b> PEOPLE · <b>{roster.places.length}</b> PLACES{assets.length > 0 ? <> · <b>{assets.length}</b> ASSETS</> : null}{linked > 0 ? <> · <b>{linked}</b> LINKED</> : null}
        </span>
        <button
          type="button" className="bd-entbuild__btn bd-orphscan"
          onClick={e => { e.preventDefault(); e.stopPropagation(); if (!open) onToggle(true); orphans.onScan(); }}
          disabled={orphans.scanning}
          title="Sweep this project's library for built references no entity points at anymore — pre-history-feature orphans. Read-only; nothing is deleted."
        >
          {orphans.scanning
            ? <><span className="bd-dnamake__spin" aria-hidden="true" />SCANNING…</>
            : <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>{orphans.list ? 'RESCAN ORPHANS' : 'SCAN FOR ORPHANS'}</>}
        </button>
        <span className="bd-roster__chev" aria-hidden="true">▾</span>
      </summary>
      <div className="bd-roster__body">
        {persons.length > 0 && (
          <div className="bd-roster__group">
            <h4 className="bd-roster__grouphd">PEOPLE <span>{persons.length}</span></h4>
            <div className="bd-roster__grid">
              {persons.map(p => <EntityCard key={p.id} ent={p} kind="person" {...cardProps('person', p.id)} />)}
            </div>
          </div>
        )}
        {places.length > 0 && (
          <div className="bd-roster__group">
            <h4 className="bd-roster__grouphd">PLACES <span>{places.length}</span></h4>
            <div className="bd-roster__grid">
              {places.map(p => <EntityCard key={p.id} ent={p} kind="place" {...cardProps('place', p.id)} />)}
            </div>
          </div>
        )}
        {assets.length > 0 && (
          <div className="bd-roster__group">
            <h4 className="bd-roster__grouphd">ASSETS <span>{assets.length}</span></h4>
            <div className="bd-roster__grid">
              {assets.map(a => <EntityCard key={a.id} ent={a} kind="asset" {...cardProps('asset', a.id)} />)}
            </div>
          </div>
        )}
        <OrphansGroup orphans={orphans} />
      </div>
    </details>
  );
}

// ORPHANED REFERENCES — built references on disk (sidecar provenance) that NO
// entity's history points at anymore. Only shown once a scan has run; groups the
// orphans by their inferred entity id (matched first), each with a RESTORE that
// re-appends the pointer to that entity's slot history. NOTHING is deleted — this
// only re-surfaces a dropped pointer. Unmatched orphans (id gone from the roster)
// are still viewable but RESTORE is disabled.
function OrphansGroup({ orphans }: { orphans: EntityCtl['orphans'] }) {
  const { list, scanning, error, restoring, restored, onScan, onRestore, onReveal } = orphans;
  // Group by entity id — matched ids first (restorable), then unmatched.
  const groups = useMemo(() => {
    if (!list) return [];
    const byId = new Map<string, OrphanRef[]>();
    for (const o of list) {
      const arr = byId.get(o.id) || [];
      arr.push(o); byId.set(o.id, arr);
    }
    const entries = [...byId.entries()].map(([id, items]) => ({ id, items, matched: items[0].matched }));
    entries.sort((a, b) => (a.matched === b.matched ? a.id.localeCompare(b.id) : a.matched ? -1 : 1));
    return entries;
  }, [list]);

  if (list === null) return null;          // never scanned — the header button invites it
  const total = list.length;

  return (
    <div className="bd-roster__group bd-orph">
      <h4 className="bd-roster__grouphd bd-orph__hd">
        ORPHANED REFERENCES <span>{total}</span>
        {total > 0 && <span className="bd-orph__sub">no entity points at these — RESTORE re-surfaces them into history (nothing is deleted)</span>}
      </h4>
      {error && <p className="bd-entbuild__err selectable">{error}</p>}
      {total === 0 ? (
        <p className="bd-orph__empty">No orphaned references — every built reference in this project is still pointed at.</p>
      ) : (
        groups.map(g => (
          <div key={g.id} className="bd-orph__id">
            <h5 className="bd-orph__idhd">
              <span className={`bd-orph__idbadge${g.matched ? '' : ' is-unmatched'}`}>{g.id}</span>
              <span className="bd-orph__idmeta">{g.items.length} {g.items.length === 1 ? 'REFERENCE' : 'REFERENCES'}</span>
              {!g.matched && <span className="bd-orph__unmatched" title="This id is no longer in the roster (it was re-run with new ids) — viewable, but cannot be restored into an entity that no longer exists.">UNMATCHED · NOT IN ROSTER</span>}
            </h5>
            <div className="bd-orph__grid">
              {g.items.map(o => {
                const isRestoring = !!restoring[o.imgPath];
                const isRestored = !!restored[o.imgPath];
                const src = hjenFileUrl(o.thumbPath || o.imgPath);
                const date = o.at ? o.at.slice(0, 10) : o.dateFolder;
                return (
                  <figure key={o.imgPath} className="bd-orphcard">
                    <button
                      type="button" className="bd-orphcard__thumb"
                      onClick={() => onReveal(o.imgPath)}
                      title="Reveal this file in Finder"
                    >
                      <img src={src} alt={`Orphaned reference for ${o.id}`} loading="lazy" />
                      {o.part && <span className={`bd-orphcard__part bd-orphcard__part--${o.part}`}>{o.part.toUpperCase()}</span>}
                    </button>
                    <figcaption className="bd-orphcard__meta">
                      <span className="bd-orphcard__id">{o.id}{o.part ? ` · ${o.part}` : ''}</span>
                      <span className="bd-orphcard__date">{date}</span>
                    </figcaption>
                    {isRestored ? (
                      <span className="bd-orphcard__done"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} aria-hidden="true"><path d="M5 12l4 4 10-10" /></svg>RESTORED · IN HISTORY</span>
                    ) : (
                      <button
                        type="button" className="bd-entbuild__btn bd-orphcard__btn"
                        onClick={() => onRestore(o)}
                        disabled={!o.matched || isRestoring || scanning}
                        title={o.matched
                          ? `Re-append this reference to ${o.id}'s history — you can then pick it via the history viewer's USE THIS`
                          : `${o.id} is no longer in the roster — cannot restore`}
                      >
                        {isRestoring
                          ? <><span className="bd-dnamake__spin" aria-hidden="true" />RESTORING…</>
                          : o.matched ? `RESTORE TO ${o.id}` : 'NO MATCHING ENTITY'}
                      </button>
                    )}
                  </figure>
                );
              })}
            </div>
          </div>
        ))
      )}
      <button
        type="button" className="bd-entbuild__btn bd-orph__rescan"
        onClick={onScan} disabled={scanning}
        title="Sweep the library again"
      >
        {scanning
          ? <><span className="bd-dnamake__spin" aria-hidden="true" />SCANNING…</>
          : 'RESCAN'}
      </button>
    </div>
  );
}

function EntityCard({ ent, kind, fileById, highlight, building, error, onBuild, onEditPrompt, onRevert }: {
  ent: BreakdownPerson | BreakdownPlace | BreakdownAsset; kind: EntityKind;
  fileById: Map<string, string>; highlight: boolean;
  building: boolean; error?: string;
  onBuild: () => void; onEditPrompt: (prompt: string) => void;
  onRevert: (slot: RefSlot, at: string) => void;
}) {
  const file = fileById.get(ent.refFrameId);
  const wardrobe = kind === 'person' ? (ent as BreakdownPerson).wardrobe : undefined;
  const assetKind = kind === 'asset' ? (ent as BreakdownAsset).kind : undefined;
  const recurring = ent.shotNos.length > 1;
  const shots = [...ent.shotNos].sort((a, b) => a - b);
  // The editable build prompt — self-contained text (falls back to the descriptor
  // for older rosters). Local draft synced to the entity; persisted on blur.
  const promptSeed = ent.prompt || ent.descriptor || '';
  const [draft, setDraft] = useState(promptSeed);
  useEffect(() => { setDraft(ent.prompt || ent.descriptor || ''); }, [ent.prompt, ent.descriptor]);
  const commitPrompt = () => {
    const v = draft.trim();
    if (v && v !== (ent.prompt || '')) onEditPrompt(v);
  };
  // Persons get TWO identity references (a bare FACE + a 3-angle SHEET); places
  // and assets get ONE clean reference. Each SLOT is an append-only HISTORY with an
  // active pointer — a build never overwrites, it appends + points active. Legacy
  // single fields fold into a one-element history. `anyBuilt` decides the view.
  const isPerson = kind === 'person';
  const p = ent as BreakdownPerson;
  const pa = ent as BreakdownPlace | BreakdownAsset;
  const faceList = isPerson ? foldLegacy(p.builtFaces, (p as any).builtFace) : [];
  const sheetList = isPerson ? foldLegacy(p.builtSheets, (p as any).builtSheet) : [];
  const refList = !isPerson ? foldLegacy(pa.builtRefs, (pa as any).builtRef) : [];
  const face = isPerson ? activeOf(faceList, p.activeFaceAt) : undefined;
  const sheet = isPerson ? activeOf(sheetList, p.activeSheetAt) : undefined;
  const single = !isPerson ? activeOf(refList, pa.activeRefAt) : undefined;
  const anyBuilt = isPerson ? (!!face || !!sheet) : !!single;
  const buildLabel = isPerson ? 'BUILD REFERENCES' : 'BUILD REFERENCE';
  const buildingLabel = isPerson ? 'BUILDING THE REFERENCES…' : 'BUILDING THE REFERENCE…';
  const shotsLabel = shots.length ? `${shots.length === 1 ? 'SHOT' : 'SHOTS'} ${shots.join(' · ')}` : 'NO SHOTS';
  // A slot's history VIEWER (newest first) — opened by clicking a built thumb.
  // `viewerIdx` = the enlarged version (index into the newest-first list).
  const [viewer, setViewer] = useState<{ slot: RefSlot; title: string } | null>(null);
  const [viewerIdx, setViewerIdx] = useState(0);
  // right-click context menu ({x,y,path}) → "Reveal in Finder".
  const [ctx, setCtx] = useState<{ x: number; y: number; path: string } | null>(null);
  // Esc closes the version viewer only — not the page behind it.
  useEscClose(!!viewer, () => { setViewer(null); setCtx(null); });
  const viewerList = viewer ? (viewer.slot === 'face' ? faceList : viewer.slot === 'sheet' ? sheetList : refList) : [];
  const viewerActiveAt = viewer
    ? (viewer.slot === 'face' ? p.activeFaceAt : viewer.slot === 'sheet' ? p.activeSheetAt : pa.activeRefAt)
    : undefined;
  const viewerActive = activeOf(viewerList, viewerActiveAt);
  const viewerNewest = [...viewerList].reverse();   // newest first
  const openViewer = (slot: RefSlot, title: string) => {
    const list = slot === 'face' ? faceList : slot === 'sheet' ? sheetList : refList;
    const act = activeOf(list, slot === 'face' ? p.activeFaceAt : slot === 'sheet' ? p.activeSheetAt : pa.activeRefAt);
    const nf = [...list].reverse();
    const ai = nf.findIndex(b => b.at === act?.at);
    setViewerIdx(ai >= 0 ? ai : 0);
    setViewer({ slot, title });
  };
  const onCtx = (e: React.MouseEvent, path: string) => { e.preventDefault(); e.stopPropagation(); setCtx({ x: e.clientX, y: e.clientY, path }); };
  return (
    <div id={`bd-ent-${ent.id}`} className={`bd-ent bd-ent--${kind}${recurring ? ' is-linked' : ''}${highlight ? ' is-highlight' : ''}`}>
      <div className="bd-ent__thumb">
        {file
          ? <img src={hjenFileUrl(file)} alt={`${ent.id} reference frame`} loading="lazy" />
          : <span className="bd-ent__thumb-empty" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M4 15l4-4 4 4 3-3 5 5" /><circle cx="9" cy="9" r="1.4" /></svg>
            </span>}
        {assetKind && <span className={`bd-ent__kind bd-ent__kind--${assetKind}`}>{assetKind === 'wardrobe' ? 'WARDROBE' : 'PROP'}</span>}
        <span className="bd-ent__id">{ent.id}</span>
        {recurring && <span className="bd-ent__linktag" title={`Linked across ${shots.length} shots`}>×{shots.length}</span>}
      </div>
      <div className="bd-ent__body">
        <p className="bd-ent__desc selectable">{ent.descriptor}</p>
        {wardrobe && <p className="bd-ent__wardrobe selectable"><span className="mono-label">WARDROBE</span> {wardrobe}</p>}
        <div className="bd-ent__shots">
          <span className="bd-ent__shotslbl">{recurring ? `IN ${shots.length} SHOTS` : 'IN 1 SHOT'}</span>
          <span className="bd-ent__shotchips">
            {shots.map(n => <span key={n} className="bd-ent__sn">{n}</span>)}
          </span>
        </div>

        {/* BUILD — the editable text-to-image prompt + BUILD REFERENCE. The build
            MAKES a clean reference from this TEXT alone (never the provenance
            frame), then links it to the entity's shots. */}
        <div className="bd-entbuild">
          <details className="bd-entbuild__promptwrap">
            <summary className="bd-entbuild__promptsum">
              <span className="mono-label">{isPerson ? 'PHYSICAL IDENTITY' : 'BUILD PROMPT'}</span>
              <span className="bd-entbuild__hint">{isPerson ? 'face + build, no clothing · no film' : 'text · MADE from scratch, no film'}</span>
              <span className="bd-entbuild__chev" aria-hidden="true">▾</span>
            </summary>
            <textarea
              className="bd-entbuild__ta"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={commitPrompt}
              rows={4}
              spellCheck={false}
              aria-label={`Build prompt for ${ent.id}`}
              placeholder="A self-contained description that MAKES a clean reference of this element…"
            />
          </details>

          {anyBuilt ? (
            <div className={`bd-entbuild__made${isPerson ? ' bd-entbuild__made--person' : ''}`}>
              {isPerson ? (
                <div className="bd-entbuild__parts">
                  {face && (
                    <figure className="bd-entbuild__part">
                      <button type="button" className="bd-entbuild__thumbbtn" onClick={() => openViewer('face', `${ent.id} — FACE`)} onContextMenu={e => onCtx(e, face.path)} title={faceList.length > 1 ? `${faceList.length} versions — click to enlarge & browse · right-click to reveal` : 'Click to enlarge · right-click to reveal'}>
                        <img className="bd-entbuild__madeimg bd-entbuild__madeimg--face" src={hjenFileUrl(face.path)} alt={`${ent.id} face reference`} loading="lazy" />
                        {faceList.length > 1 && <span className="bd-entbuild__vbadge">v{faceList.length}</span>}
                      </button>
                      <figcaption className="bd-entbuild__partcap">FACE — bare, neutral</figcaption>
                    </figure>
                  )}
                  {sheet && (
                    <figure className="bd-entbuild__part">
                      <button type="button" className="bd-entbuild__thumbbtn" onClick={() => openViewer('sheet', `${ent.id} — SHEET`)} onContextMenu={e => onCtx(e, sheet.path)} title={sheetList.length > 1 ? `${sheetList.length} versions — click to enlarge & browse · right-click to reveal` : 'Click to enlarge · right-click to reveal'}>
                        <img className="bd-entbuild__madeimg" src={hjenFileUrl(sheet.path)} alt={`${ent.id} character sheet`} loading="lazy" />
                        {sheetList.length > 1 && <span className="bd-entbuild__vbadge">v{sheetList.length}</span>}
                      </button>
                      <figcaption className="bd-entbuild__partcap">SHEET — headless front · face ¾ · back</figcaption>
                    </figure>
                  )}
                </div>
              ) : (
                <button type="button" className="bd-entbuild__thumbbtn" onClick={() => openViewer('ref', `${ent.id} — REFERENCE`)} onContextMenu={e => onCtx(e, single!.path)} title={refList.length > 1 ? `${refList.length} versions — click to enlarge & browse · right-click to reveal` : 'Click to enlarge · right-click to reveal'}>
                  <img className="bd-entbuild__madeimg" src={hjenFileUrl(single!.path)} alt={`${ent.id} built reference`} loading="lazy" />
                  {refList.length > 1 && <span className="bd-entbuild__vbadge">v{refList.length}</span>}
                </button>
              )}
              <div className="bd-entbuild__madeinfo">
                <span className="bd-entbuild__madebadge">{isPerson ? 'MADE — IDENTITY REFERENCES' : 'MADE — CLEAN REFERENCE'}</span>
                {(isPerson ? !!sheet : true) && <span className="bd-entbuild__linked">LINKED TO {shotsLabel}</span>}
                <button
                  type="button" className="bd-entbuild__btn" onClick={onBuild} disabled={building}
                  title={isPerson ? 'Make both identity references again from the identity above — replaces them' : 'Make this reference again from the prompt above — replaces the linked image'}
                >
                  {building ? <><span className="bd-dnamake__spin" aria-hidden="true" />BUILDING…</> : 'BUILD AGAIN'}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button" className="bd-entbuild__btn bd-entbuild__btn--primary" onClick={onBuild} disabled={building}
              title={isPerson
                ? 'MAKE two identity references (a bare face + a 3-angle sheet) from the identity above (text-to-image), then link the sheet to this person\'s shots'
                : 'MAKE a clean reference from the prompt above (text-to-image), then link it to this element\'s shots'}
            >
              {building
                ? <><span className="bd-dnamake__spin" aria-hidden="true" />{buildingLabel}</>
                : <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true"><path d="M12 3l2.4 6.2L21 11l-5 4.2L17.4 21 12 17.6 6.6 21 8 15.2 3 11l6.6-1.8z" /></svg>{buildLabel}</>}
            </button>
          )}
          {error && <span className="bd-entbuild__err selectable">{error}</span>}
        </div>
      </div>

      {/* VERSION HISTORY VIEWER — click to enlarge, arrow between versions, revert
          to any, right-click to reveal the file. Every build is kept. */}
      {viewer && viewerNewest.length > 0 && (() => {
        const idx = Math.min(viewerIdx, viewerNewest.length - 1);
        const focused = viewerNewest[idx];
        const n = viewerNewest.length - idx;
        const isActive = viewerActive?.at === focused.at;
        return (
          <div className="bd-verviewer" role="dialog" aria-modal="true" aria-label={`${viewer.title} versions`} onClick={() => { setViewer(null); setCtx(null); }}>
            <div className="bd-verviewer__panel" onClick={e => e.stopPropagation()}>
              <div className="bd-verviewer__head">
                <span className="mono-label">{viewer.title} · v{n} of {viewerNewest.length}{isActive ? ' · ACTIVE' : ''}</span>
                <button type="button" className="bd-verviewer__close" onClick={() => setViewer(null)} aria-label="Close">✕</button>
              </div>
              <div className="bd-verviewer__stage">
                <button type="button" className="bd-verviewer__nav" disabled={idx >= viewerNewest.length - 1} onClick={() => setViewerIdx(idx + 1)} aria-label="Older version">‹</button>
                <img
                  className="bd-verviewer__big" src={hjenFileUrl(focused.path)} alt={`version ${n}`}
                  onContextMenu={e => onCtx(e, focused.path)}
                />
                <button type="button" className="bd-verviewer__nav" disabled={idx <= 0} onClick={() => setViewerIdx(idx - 1)} aria-label="Newer version">›</button>
              </div>
              <div className="bd-verviewer__actions">
                {!isActive
                  ? <button type="button" className="bd-entbuild__btn bd-entbuild__btn--primary" onClick={() => { onRevert(viewer.slot, focused.at); setViewer(null); }}>USE THIS VERSION</button>
                  : <span className="bd-verviewer__activetag">ACTIVE VERSION</span>}
                <button type="button" className="bd-entbuild__btn" onClick={() => void window.hjen.revealInFinder(focused.path)}>REVEAL IN FINDER</button>
              </div>
              <div className="bd-verviewer__strip">
                {viewerNewest.map((b, i) => (
                  <button
                    key={b.at + i} type="button"
                    className={`bd-verviewer__thumb${i === idx ? ' is-focused' : ''}${viewerActive?.at === b.at ? ' is-active' : ''}`}
                    onClick={() => setViewerIdx(i)} onContextMenu={e => onCtx(e, b.path)}
                    title={`v${viewerNewest.length - i}${viewerActive?.at === b.at ? ' · active' : ''} — right-click to reveal`}
                  >
                    <img src={hjenFileUrl(b.path)} alt={`version ${viewerNewest.length - i}`} loading="lazy" />
                  </button>
                ))}
              </div>
              <div className="bd-verviewer__foot">Every build is kept — reverting only re-points the active reference; nothing is deleted.</div>
            </div>
          </div>
        );
      })()}

      {/* right-click context menu */}
      {ctx && (
        <>
          <div className="bd-ctxbackdrop" onClick={() => setCtx(null)} onContextMenu={e => { e.preventDefault(); setCtx(null); }} />
          <div className="bd-ctxmenu" style={{ left: ctx.x, top: ctx.y }} role="menu">
            <button type="button" className="bd-ctxmenu__item" onClick={() => { void window.hjen.revealInFinder(ctx.path); setCtx(null); }}>Reveal in Finder</button>
          </div>
        </>
      )}
    </div>
  );
}

function ShotCard({ r, slug, tcIn, tcOut, sf, roster, onEntityChip, onCompare }: {
  r: BreakdownShotRow; slug: string; tcIn?: number; tcOut?: number; sf: ShotFramesCtl;
  roster?: BreakdownEntities; onEntityChip?: (id: string) => void; onCompare: () => void;
}) {
  const mp = r.masterPrompt;
  const spec = [r.size, r.lens, r.move].filter(Boolean).join(' · ') || '—';
  // The entities LINKED to this shot — the same P1 chip recurs on every shot that
  // person is in, making the cross-shot link visible at the row level.
  const shotEnts = entitiesForShot(roster, r.no);
  const entChips: { id: string; kind: 'person' | 'place'; label: string; recurring: boolean }[] = [
    ...shotEnts.persons.map(p => ({ id: p.id, kind: 'person' as const, label: p.id, recurring: p.shotNos.length > 1 })),
    ...(shotEnts.place ? [{ id: shotEnts.place.id, kind: 'place' as const, label: shotEnts.place.id, recurring: shotEnts.place.shotNos.length > 1 }] : []),
  ];
  const origUrl = originalFrameFile(r, sf.frames, tcOut);
  const making = !!sf.making[r.no];
  const err = sf.errors[r.no];
  const makingVideo = !!sf.vidMaking[r.no];
  const vidErr = sf.vidErrors[r.no];
  // The compare cell shows the MADE frame if it exists (the new output), else the
  // original ad frame — clicking either opens the large side-by-side lightbox.
  const previewUrl = r.madeFrame ? hjenFileUrl(r.madeFrame.path) : origUrl ? hjenFileUrl(origUrl) : undefined;
  const span = tcIn != null && tcOut != null ? tcOut - tcIn : 0;
  const canResolve = tcIn != null && tcOut != null && span >= 1.4;   // only worth drilling a scene with room for cuts
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<ResolvedShot[] | null>(null);
  const [resErr, setResErr] = useState<string | null>(null);

  const doResolve = async (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (tcIn == null || tcOut == null || resolving) return;
    setResolving(true); setResErr(null);
    const res = await resolveSceneShots(slug, tcIn, tcOut);
    setResolving(false);
    if (res.ok) setResolved(res.shots);
    else setResErr(res.message || 'Could not resolve this scene’s shots.');
  };

  return (
    <details className="bd-shot">
      <summary className="bd-shot__sum">
        <span className="bd-shot__no">{r.no}</span>
        <span className="bd-shot__tc">{r.tc || '—'}</span>
        <span className="bd-shot__beat">{r.beat ? <span className="bd-beat-tag">{r.beat}</span> : '—'}</span>
        <span className="bd-shot__spec">{spec}</span>
        <span className="bd-shot__desc">
          <span className="bd-shot__desctext selectable">{r.masterPrompt?.description || r.description}</span>
          {entChips.length > 0 && (
            <span className="bd-shot__ents" role="group" aria-label="People and places in this shot">
              {entChips.map(c => (
                <button
                  key={c.id} type="button"
                  className={`bd-entchip bd-entchip--${c.kind}${c.recurring ? ' is-linked' : ''}`}
                  onClick={e => { e.preventDefault(); e.stopPropagation(); onEntityChip?.(c.id); }}
                  title={`${c.kind === 'person' ? 'Person' : 'Place'} ${c.label}${c.recurring ? ' — linked across shots' : ''} · show in the roster`}
                >{c.label}</button>
              ))}
            </span>
          )}
        </span>
        <span className={`bd-shot__flag${mp ? ' is-live' : ''}`}>{mp ? '● MASTER' : 'PENDING'}</span>
        <button
          type="button"
          className={`bd-shot__compare${r.madeFrame ? ' is-made' : ''}${(err || vidErr) ? ' is-err' : ''}`}
          onClick={e => { e.preventDefault(); e.stopPropagation(); onCompare(); }}
          title="Compare the original ad frame against the MADE frame / video"
          aria-label={`Compare original vs made for shot ${r.no}`}
        >
          {previewUrl
            ? <img className="bd-shot__thumb" src={previewUrl} alt="" loading="lazy" />
            : <span className="bd-shot__ph">{origUrl ? 'COMPARE' : '—'}</span>}
          {(making || makingVideo) && (
            <span className="bd-shot__compare-ov"><span className="bd-dnamake__spin" aria-hidden="true" /></span>
          )}
          {r.madeVideo && !making && !makingVideo && (
            <span className="bd-shot__playbadge" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
            </span>
          )}
          <span className="bd-shot__compare-ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
          </span>
        </button>
      </summary>
      {mp
        ? <MasterPromptBlock r={r} sf={sf} making={making} makingVideo={makingVideo} error={err} videoError={vidErr} />
        : <div className="bd-shot__pending">This shot has no fused master prompt yet — run <b>MAKE THE MASTER PROMPTS</b> above to converge its 13 axes into one.</div>}

      {/* PRECISE RESOLVE — drill into this scene's real varied shots */}
      {canResolve && (
        <div className="bd-resolve">
          {!resolved && !resolving && (
            <button className="bd-resolve__btn" onClick={doResolve}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4" /></svg>
              RESOLVE THE REAL SHOTS
              <span className="bd-resolve__span">{fmtSec(span)}s scene</span>
            </button>
          )}
          {resolving && <div className="bd-resolve__run"><span className="bd-dnamake__spin" aria-hidden="true" /> Reading the real shots inside this scene…</div>}
          {resErr && <div className="bd-resolve__err selectable">{resErr}</div>}
          {resolved && (
            <div className="bd-resolve__out">
              <div className="bd-resolve__head"><span className="mono-label">{resolved.length} REAL SHOT{resolved.length === 1 ? '' : 'S'} INSIDE THIS SCENE</span><span className="bd-resolve__note">understood + verified from dense frames</span></div>
              {resolved.map((s, i) => (
                <div className="bd-resolve__shot" key={i}>
                  <span className="bd-resolve__stc">{fmtSec(s.tcIn)}</span>
                  <span className="bd-resolve__ssize">{[s.size, s.angle].filter(Boolean).join(' · ') || '—'}</span>
                  <span className="bd-resolve__swhat selectable">{s.subject ? <b>{s.subject} — </b> : null}{s.what}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </details>
  );
}

// One attached reference — thumbnail + editable note + role toggle + remove.
function AttachmentRow({ a, r, sf }: { a: ShotAttachment; r: BreakdownShotRow; sf: ShotFramesCtl }) {
  const [note, setNote] = useState(a.note || '');
  const [bust, setBust] = useState(0);      // cache-bust so a same-path update re-renders
  const [zoom, setZoom] = useState(false);
  useEscClose(zoom, () => setZoom(false));  // Esc closes the enlarged image only, not the page
  useEffect(() => { setNote(a.note || ''); }, [a.id]);
  const role = a.role || 'both';
  const src = `${hjenFileUrl(a.path)}?v=${bust}`;
  return (
    <div className="bd-att">
      <div
        className="bd-att__thumb" style={{ cursor: 'zoom-in' }}
        onClick={() => setZoom(true)} role="button" tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setZoom(true); } }}
        title="Click to enlarge" aria-label="Enlarge reference"
      >
        {a.kind === 'image'
          ? <img src={src} alt="" loading="lazy" />
          : <video src={src} muted preload="metadata" />}
        <span className="bd-att__kind">{a.source ? 'MADE' : a.kind === 'image' ? 'IMG' : 'CLIP'}</span>
      </div>
      <input
        className="bd-att__note" value={note} placeholder="what it is / what it’s for…"
        onChange={e => setNote(e.target.value)}
        onBlur={() => { if (note !== (a.note || '')) sf.onAttachNote(r, a.id, note); }}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        aria-label="Attachment note"
      />
      <div className="bd-att__role" role="group" aria-label="Which make this feeds">
        {(['both', 'frame', 'video'] as const).map(rl => (
          <button key={rl} type="button" className={`bd-att__roleopt${role === rl ? ' is-on' : ''}`} onClick={() => sf.onAttachRole(r, a.id, rl)} aria-pressed={role === rl}>{rl.toUpperCase()}</button>
        ))}
      </div>
      <button
        type="button" className="bd-att__rm"
        onClick={() => { setBust(b => b + 1); sf.onAttachUpdate(r, a.id); }}
        aria-label={a.source ? 'Update — pull the latest made version' : 'Update — re-point to the changed file'}
        title={a.source ? 'Update — pull this entity’s latest made reference' : 'Update — re-point to the changed / newly made file'}
      >↻</button>
      <button type="button" className="bd-att__rm" onClick={() => sf.onAttachRemove(r, a.id)} aria-label="Remove attachment" title="Remove">✕</button>

      {zoom && (
        <div
          onClick={() => setZoom(false)} role="dialog" aria-modal="true" aria-label="Reference preview"
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4vh 4vw', cursor: 'zoom-out' }}
        >
          {a.kind === 'image'
            ? <img src={src} alt="" style={{ maxWidth: '92vw', maxHeight: '92vh', objectFit: 'contain', borderRadius: 8, boxShadow: '0 8px 40px rgba(0,0,0,.6)' }} />
            : <video src={src} controls autoPlay style={{ maxWidth: '92vw', maxHeight: '92vh', borderRadius: 8 }} onClick={e => e.stopPropagation()} />}
        </div>
      )}
    </div>
  );
}

// The live-attachment zone — attach images (frame refs / end-frame) or clips
// (motion refs). First-frame stays the primary control; these are secondary.
function ShotAttachments({ r, sf }: { r: BreakdownShotRow; sf: ShotFramesCtl }) {
  const atts = r.attachments || [];
  return (
    <div className="bd-atts">
      <div className="bd-atts__head">
        <span className="mono-label">LIVE REFERENCES — steer this shot’s makes</span>
        <div className="bd-atts__actions">
          {sf.genRefCount(r.no) > 0 && (
            <button
              type="button" className="bd-attbtn bd-attbtn--sync"
              onClick={() => sf.onAttachSyncAll(r)}
              title="Drop / refresh every made reference for this shot at its latest built version"
            >⟳ UPDATE ALL ({sf.genRefCount(r.no)})</button>
          )}
          <button type="button" className="bd-attbtn" onClick={() => sf.onAttach(r, 'image')}>+ IMAGE</button>
          <button type="button" className="bd-attbtn" onClick={() => sf.onAttach(r, 'video')}>+ CLIP</button>
        </div>
      </div>
      {atts.length === 0
        ? <div className="bd-atts__empty">No live references. First-frame is the primary control; attach images (frame refs · end-frame anchor) or clips (motion refs) to steer the makes further.</div>
        : <div className="bd-atts__list">{atts.map(a => <AttachmentRow key={a.id} a={a} r={r} sf={sf} />)}</div>}
    </div>
  );
}

function MasterPromptBlock({ r, sf, making, makingVideo, error, videoError }: {
  r: BreakdownShotRow; sf: ShotFramesCtl;
  making: boolean; makingVideo: boolean; error?: string; videoError?: string;
}) {
  const mp = r.masterPrompt!;
  const no = r.no;
  const madeAlready = !!r.madeFrame;
  const madeVideoAlready = !!r.madeVideo;
  const hasFrame = madeAlready;
  const refusing = !!sf.refusing[no];
  const refuseError = sf.refuseErrors[no];
  const atts = r.attachments || [];
  const frameAppendix = composeAppendix(atts, 'frame');
  const videoAppendix = composeAppendix(atts, 'video');
  const videoModelLabel = (videoModelById(sf.videoModelId) ?? VIDEO_MODELS[0]).label;

  const refLine = (rf: ShotMasterPrompt['references'][number]) =>
    `[${rf.kind === 'ad-frame' ? 'AD-FRAME' : 'EXTERNAL'}] ${rf.ref} — ${rf.purpose}`;
  const allText = [
    `SHOT ${no} — MASTER PROMPT`, '',
    'FRAME PROMPT', mp.frame, frameAppendix ? `\n${frameAppendix}` : '', '',
    'VIDEO PROMPT', mp.video, videoAppendix ? `\n${videoAppendix}` : '', '',
    'REFERENCES — attach to reach an identical result',
    ...mp.references.map(refLine),
  ].filter(x => x !== undefined).join('\n');
  const refText = mp.references.map(refLine).join('\n');

  return (
    <div className="bd-master">
      <div className="bd-master__top">
        <span className="mono-label">SHOT {no} · THE MASTER PROMPT — 13 axes, fused</span>
        <div className="bd-master__acts">
          <button
            type="button" className={`bd-refuse${refusing ? ' is-making' : ''}`}
            onClick={() => sf.onRemakeShot(r)} disabled={refusing}
            title="Re-fuse this shot's master prompt with the upgraded fusion"
            aria-label={refusing ? 'Re-fusing this shot' : 'Remake this shot’s master prompt'}
          >
            {refusing
              ? <><span className="bd-dnamake__spin" aria-hidden="true" /> RE-FUSING…</>
              : <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path d="M4 12a8 8 0 0 1 13.7-5.7L20 8M20 4v4h-4" /><path d="M20 12a8 8 0 0 1-13.7 5.7L4 16M4 20v-4h4" /></svg>
                  REMAKE
                </>}
          </button>
          <CopyBtn text={allText} className="bd-copy--amber" />
        </div>
      </div>
      {refuseError && <div className="bd-makeframe__err selectable">{refuseError}</div>}

      {/* live attachments — feed BOTH makes */}
      <ShotAttachments r={r} sf={sf} />

      {/* DESCRIPTION — a plain, general read of the shot, above the image prompt,
          with none of the 13 craft details. */}
      {mp.description && (
        <div className="bd-mp bd-mp--desc">
          <div className="bd-mp__h">
            <span className="mono-label">DESCRIPTION</span>
            <CopyBtn text={mp.description} />
          </div>
          <p className="bd-mp__body selectable">{mp.description}</p>
        </div>
      )}

      {/* FRAME PROMPT — MAKE FRAME lives in the header */}
      <div className="bd-mp">
        <div className="bd-mp__h">
          <span className="mono-label">FRAME PROMPT</span>
          <div className="bd-mp__acts">
            <button
              type="button" className={`bd-makeframe${making ? ' is-making' : ''}`}
              onClick={() => sf.onMakeShot(r)} disabled={making}
              aria-label={making ? 'Making the frame' : madeAlready ? 'Make this frame again' : 'Make the frame'}
            >
              {making
                ? <><span className="bd-dnamake__spin" aria-hidden="true" /> MAKING…</>
                : <>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path d="M4 5h16v14H4z" /><path d="M4 15l4-4 4 4 3-3 5 5" /><circle cx="9" cy="9" r="1.4" /></svg>
                    {madeAlready ? 'MAKE AGAIN' : 'MAKE FRAME'}
                  </>}
            </button>
            <CopyBtn text={frameAppendix ? `${mp.frame}\n\n${frameAppendix}` : mp.frame} />
          </div>
        </div>
        {error && <div className="bd-makeframe__err selectable">{error}</div>}
        <p className="bd-mp__body selectable">{mp.frame}</p>
        {frameAppendix && (
          <div className="bd-appendix">
            <span className="mono-label bd-appendix__lbl">IMAGE-MAKING APPENDIX — travels with the prompt</span>
            <pre className="bd-appendix__body selectable">{frameAppendix}</pre>
          </div>
        )}
      </div>

      {/* MAKE VIDEO — above the VIDEO PROMPT (first-frame drives video quality) */}
      <div className="bd-makevideo-bar">
        <button
          type="button" className={`bd-makevideo-lg${makingVideo ? ' is-making' : ''}`}
          onClick={() => sf.onMakeShotVideo(r)} disabled={makingVideo || !hasFrame}
          title={!hasFrame ? 'Make the frame first — the video needs its first frame' : undefined}
          aria-label={makingVideo ? 'Making the video' : madeVideoAlready ? 'Make this video again' : 'Make the video'}
        >
          {makingVideo
            ? <><span className="bd-dnamake__spin" aria-hidden="true" /> MAKING VIDEO…</>
            : <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><rect x="3" y="5" width="14" height="14" rx="2" /><path d="M17 10l4-2v8l-4-2z" /></svg>
                {madeVideoAlready ? 'MAKE VIDEO AGAIN' : 'MAKE VIDEO'}
              </>}
        </button>
        <span className="bd-makevideo-bar__meta">
          {hasFrame
            ? <>on <b>{videoModelLabel}</b> · {sf.videoResolution} · {sf.videoDuration}s · first frame = the MADE frame</>
            : <>Make the frame first — the video takes it as its first frame.</>}
        </span>
      </div>

      {/* VIDEO PROMPT */}
      <div className="bd-mp">
        <div className="bd-mp__h">
          <span className="mono-label">VIDEO PROMPT — for motion</span>
          <CopyBtn text={videoAppendix ? `${mp.video}\n\n${videoAppendix}` : mp.video} />
        </div>
        {videoError && <div className="bd-makeframe__err selectable">{videoError}</div>}
        <p className="bd-mp__body selectable">{mp.video}</p>
        {videoAppendix && (
          <div className="bd-appendix">
            <span className="mono-label bd-appendix__lbl">VIDEO-MAKING APPENDIX — travels with the prompt</span>
            <pre className="bd-appendix__body selectable">{videoAppendix}</pre>
          </div>
        )}
      </div>

      {/* the fused static reference list (from the 13-axis convergence) */}
      <div className="bd-mp">
        <div className="bd-mp__h"><span className="mono-label">REFERENCES — attach to reach an identical result</span>{mp.references.length > 0 && <CopyBtn text={refText} />}</div>
        {mp.references.length ? (
          <div className="bd-refatts">
            {mp.references.map((rf, i) => (
              <div className={`bd-refatt bd-refatt--${rf.kind}`} key={i}>
                <span className="bd-refatt__kind">{rf.kind === 'ad-frame' ? 'AD-FRAME' : 'EXTERNAL'}</span>
                <span className="bd-refatt__ref selectable">{rf.ref}</span>
                <span className="bd-refatt__purpose">{rf.purpose}</span>
              </div>
            ))}
          </div>
        ) : <div className="bd-shot__pending">No references named for this shot.</div>}
      </div>
    </div>
  );
}

// ─── inner-ring stage pages (each guards its pipeline field) ────────────────

function StagePage({ stKey, bd, model, onClose, openDnaLib, dnaStatuses, masterMaking, onMakeMasters, onRefuseAll, entities, shotFrames }: {
  stKey: StageKey; bd: AdBreakdown; model: DiscModel; onClose: () => void; openDnaLib: () => void;
  dnaStatuses: Record<string, DnaState['kind']>; masterMaking: MakingState; onMakeMasters: () => void;
  onRefuseAll: () => void; entities: EntityCtl; shotFrames: ShotFramesCtl;
}) {
  // Compare lightbox — which shot's ORIGINAL/MADE is enlarged (null = closed).
  // Declared before the early return so hook order stays stable across stages.
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  // ENTITY roster — controlled open (a shot chip can open + scroll to a card) +
  // a transient highlight on the focused entity. Hooks live before any early
  // return so hook order stays stable across every stage.
  const [rosterOpen, setRosterOpen] = useState(false);
  const [highlightEnt, setHighlightEnt] = useState<string | null>(null);
  const hasRoster = !!entities.roster && (entities.roster.persons.length > 0 || entities.roster.places.length > 0 || (entities.roster.assets?.length ?? 0) > 0);
  useEffect(() => { if (hasRoster) setRosterOpen(true); }, [hasRoster]);
  useEffect(() => {
    if (!highlightEnt) return;
    const t = window.setTimeout(() => setHighlightEnt(null), 1800);
    return () => window.clearTimeout(t);
  }, [highlightEnt]);
  const focusEntity = useCallback((id: string) => {
    setRosterOpen(true); setHighlightEnt(id);
    requestAnimationFrame(() => {
      document.getElementById(`bd-ent-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, []);
  // RE-FUSE ALL — two-step confirm (it overwrites every existing master prompt).
  // First click arms; second click fires; auto-disarms after a short window.
  const [confirmRefuse, setConfirmRefuse] = useState(false);
  useEffect(() => {
    if (!confirmRefuse) return;
    const t = window.setTimeout(() => setConfirmRefuse(false), 4000);
    return () => window.clearTimeout(t);
  }, [confirmRefuse]);
  const shotRows: BreakdownShotRow[] = ((bd.pipeline as any)?.shotlist?.rows || []) as BreakdownShotRow[];

  // DNAS routes to the library — render it via the overlay path instead
  if (stKey === 'dnas') { openDnaLib(); return null; }

  const pl = bd.pipeline;
  const idx = STAGES.findIndex(s => s.key === stKey);
  const label = STAGES[idx]?.label || stKey.toUpperCase();
  const names: Record<StageKey, string> = {
    dnas: 'the axis DNAs', pitch: 'the deck, page by page', shotlist: 'the numbered shotlist',
    treatment: 'the director’s treatment', references: 'the reference hunt',
    story: 'how we’d write it', beats: 'the five-beat spine', brief: 'the brief that makes it',
  };
  const eyebrow2 = 'OUTPUT 2 — “what if we prepared this before production, for the client?”';

  let pending = false;
  let body: JSX.Element;

  if (stKey === 'brief') {
    const b = pl?.brief;
    pending = !b;
    body = b ? (
      <>
        <div className="bd-premise">Last stop of the reversed spine — the brief that would have produced this film.</div>
        {b.rawBrief && <div className="bd-sec"><h3>Raw brief</h3><p>{b.rawBrief}</p></div>}
        {b.proposition && <div className="bd-sec"><h3>The one proposition</h3><p>{b.proposition}</p></div>}
        {b.persona && <div className="bd-sec"><h3>Persona</h3><p>{b.persona}</p></div>}
        {b.bigIdea && (
          <div className="bd-sec"><h3>Big idea — {b.bigIdea.name}</h3>
            {b.bigIdea.hook && <p><b className="bd-lead">Hook · </b>{b.bigIdea.hook}</p>}
            {b.bigIdea.insight && <p><b className="bd-lead">Insight · </b>{b.bigIdea.insight}</p>}
            {b.bigIdea.culturalTruth && <p><b className="bd-lead">Cultural truth · </b>{b.bigIdea.culturalTruth}</p>}
          </div>
        )}
        {pl?.wantButUntil && <div className="bd-sec"><h3>Want — but — until</h3><p>{pl.wantButUntil}</p></div>}
      </>
    ) : <PendingBlock what="brief" hint="This breakdown’s pipeline carries no brief yet. It is reconstructed after the factory run." />;
  } else if (stKey === 'beats') {
    const beats = pl?.beats || [];
    pending = beats.length === 0;
    body = beats.length ? (
      <div className="bd-grid2">
        {beats.map(b => (
          <div className="bd-card" key={b.id}>
            <div className="bd-card__meta"><span className="bd-beat-tag">{b.beat}</span></div>
            <div className="bd-card__claim">{b.visual}</div>
            {b.vo && <div className="bd-card__vo">VO · {b.vo}</div>}
            <Thumbs model={model} ids={b.frameIds} />
          </div>
        ))}
      </div>
    ) : <PendingBlock what="beats" hint="No five-beat spine in this breakdown’s data yet." />;
  } else if (stKey === 'story') {
    const s = pl?.story;
    pending = !s;
    body = s ? (
      <>
        {s.wantButUntil && (
          <div className="bd-sec"><div className="bd-sec__top"><h3>Want — but — until</h3><CopyBtn text={s.wantButUntil} /></div><p className="bd-prose selectable">{s.wantButUntil}</p></div>
        )}
        {s.emotionalQuestion && <div className="bd-sec"><h3>The emotional question</h3><p className="bd-prose selectable">{s.emotionalQuestion}</p></div>}
        {s.narrative && (
          <div className="bd-sec"><div className="bd-sec__top"><h3>The narrative</h3><CopyBtn text={s.narrative} /></div><p className="bd-prose selectable">{s.narrative}</p></div>
        )}
        {s.beats?.length > 0 && (
          <div className="bd-sec"><h3>The five beats, written</h3>
            <div className="bd-grid2">
              {s.beats.map((b, i) => (
                <div className="bd-card" key={i}>
                  <div className="bd-card__meta"><span className="bd-beat-tag">{b.beat}</span></div>
                  <div className="bd-card__claim selectable">{b.line}</div>
                  {b.metaphor && <div className="bd-card__vo">METAPHOR · {b.metaphor}</div>}
                </div>
              ))}
            </div>
          </div>
        )}
      </>
    ) : <PendingBlock what="story" hint="This breakdown carries no written story yet — run the ad to author it." />;
  } else if (stKey === 'references') {
    const hunt = pl?.referencesHunt;
    const refs = pl?.references || [];
    pending = !hunt && refs.length === 0;
    body = hunt ? (
      <>
        {hunt.axes?.length > 0 && (
          <div className="bd-sec"><h3>Search axes — where we’d hunt</h3>
            <div className="bd-chips">{hunt.axes.map((a, i) => <span className="bd-chip" key={i}>{a}</span>)}</div>
          </div>
        )}
        <h3 className="bd-sech">The references — take &amp; leave</h3>
        {hunt.items.map((r, n) => (
          <div className="bd-card bd-card--wide" key={n}>
            <div className="bd-card__meta"><span className="bd-ref-num">{pad2(n + 1)}</span><b className="bd-lead">{r.title}</b></div>
            <div className="bd-takeleave">
              <div className="bd-tl bd-tl--take"><span className="mono-label">TAKE</span><p className="selectable">{r.take}</p></div>
              <div className="bd-tl bd-tl--leave"><span className="mono-label">LEAVE</span><p className="selectable">{r.leave}</p></div>
            </div>
            <Thumbs model={model} ids={r.frameIds} />
          </div>
        ))}
      </>
    ) : refs.length ? (
      <>{refs.map((r, n) => (
        <div className="bd-card bd-card--wide" key={r.id}>
          <div className="bd-card__meta"><span className="bd-ref-num">{pad2(n + 1)}</span></div>
          <div className="bd-card__claim">{r.note}</div>
          <Thumbs model={model} ids={r.frameIds} />
        </div>
      ))}</>
    ) : <PendingBlock what="references" hint="No reference hunt in this breakdown’s data yet." />;
  } else if (stKey === 'treatment') {
    const t = pl?.treatment;
    pending = !t;
    const pairs: [keyof NonNullable<typeof t>['choicePairs'], string][] = [
      ['aspect', 'ASPECT'], ['lens', 'LENS'], ['lightDirection', 'LIGHT DIRECTION'],
      ['cameraMove', 'CAMERA MOVE'], ['hour', 'HOUR'], ['placeRegister', 'PLACE REGISTER'],
    ];
    body = t ? (
      <>
        {t.lookPhrase && <div className="bd-premise">{t.lookPhrase}</div>}
        {t.prose && (
          <div className="bd-sec"><div className="bd-sec__top"><h3>The treatment</h3><CopyBtn text={t.prose} /></div><p className="bd-prose selectable">{t.prose}</p></div>
        )}
        <div className="bd-sec"><h3>The six choice-pairs</h3>
          {pairs.map(([k, en]) => t.choicePairs?.[k] && (
            <div className="bd-kv" key={k}><b>{en}</b><span>{t.choicePairs[k]}</span></div>
          ))}
        </div>
        {(t.firstFrameId || t.lastFrameId) && (
          <div className="bd-sec"><h3>First &amp; last frame</h3>
            <Thumbs model={model} ids={[t.firstFrameId, t.lastFrameId].filter((x): x is string => !!x)} />
          </div>
        )}
      </>
    ) : <PendingBlock what="treatment" hint="No director’s treatment in this breakdown’s data yet." />;
  } else if (stKey === 'pitch') {
    const pages = pl?.pitchPages;
    const legacy = pl?.pitch || [];
    pending = (!pages || pages.length === 0) && legacy.length === 0;
    body = pages && pages.length ? (
      <div className="bd-pitchgrid">
        {pages.map((p, n) => (
          <div className="bd-pitchpage" key={p.id}>
            <div className="bd-pitchpage__no">PAGE {pad2(n + 1)}</div>
            <div className="bd-pitchpage__title">{p.title}</div>
            {p.content && <div className="bd-pitchpage__body selectable">{p.content}</div>}
            {p.visualSlot && <div className="bd-pitchpage__slot"><span className="mono-label">VISUAL</span> {p.visualSlot}</div>}
          </div>
        ))}
      </div>
    ) : legacy.length ? (
      <>{legacy.map(p => (
        <div className="bd-card bd-card--wide" key={p.id}>
          <div className="bd-card__claim"><b className="bd-lead">{p.title}</b></div>
          <div className="bd-card__vo" style={{ fontSize: 'var(--t-body)', color: 'var(--ink-dim)' }}>{p.body}</div>
          <Thumbs model={model} ids={p.frameId ? [p.frameId] : []} />
        </div>
      ))}</>
    ) : <PendingBlock what="pitch" hint="No pitch page plan in this breakdown’s data yet." />;
  } else {
    // shotlist — every shot converges to ONE fused master prompt (frame + video + refs)
    const sl = pl?.shotlist;
    const rows: BreakdownShotRow[] = sl?.rows || [];
    pending = !sl || rows.length === 0;
    const withMaster = rows.filter(r => r.masterPrompt).length;
    const liveDnas = Object.values(dnaStatuses).filter(k => k === 'live').length;
    const err = masterMaking && !masterMaking.active ? masterMaking.error : undefined;
    body = rows.length ? (
      <>
        {/* the convergence — MAKE THE MASTER PROMPTS */}
        <div className="bd-dnamake">
          {masterMaking?.active ? (
            <div className="bd-dnamake__run">
              <span className="bd-dnamake__spin" aria-hidden="true" />
              <span>FUSING THE MASTER PROMPTS… <b>{masterMaking.done}/{masterMaking.total}</b> shots — FRAME + VIDEO + REFERENCES</span>
            </div>
          ) : withMaster < rows.length ? (
            <div className="bd-dnamake__cta">
              <button className="bd-actbtn primary" onClick={onMakeMasters}>
                {err ? 'FINISH THE MASTER PROMPTS →' : `MAKE THE ${withMaster > 0 ? 'MISSING ' : ''}MASTER PROMPTS →`}
              </button>
              <span className="bd-dnamake__hint">
                {err
                  ? <>Stopped — <span className="selectable">{err}</span></>
                  : liveDnas === 0
                    ? <>The convergence: fuse this ad’s 13 axis DNAs into ONE master prompt per shot (frame · video · references). <b>Make the axis DNAs first</b> — the master prompts fuse them.</>
                    : <>Fuse the 13 axes into ONE master prompt for {rows.length - withMaster} shot{rows.length - withMaster === 1 ? '' : 's'} — grounded entirely in <b>{bd.ad.title}</b>’s own DNA. Each shot lands live &amp; is saved.</>}
              </span>
            </div>
          ) : (
            <div className="bd-dnamake__done">● ALL {rows.length} SHOTS FUSED — one master prompt each: FRAME · VIDEO · REFERENCES</div>
          )}
        </div>

        {/* MAKE — the frame + video controls, model choosers, and settings */}
        {(() => {
          const eligible = rows.filter(r => r.masterPrompt?.frame?.trim() && !r.madeFrame).length;
          const madeCount = rows.filter(r => r.madeFrame).length;
          const vidEligible = rows.filter(r => r.masterPrompt?.video?.trim() && r.madeFrame && !r.madeVideo).length;
          const vidMadeCount = rows.filter(r => r.madeVideo).length;
          const sf = shotFrames;
          return (
            <div className="bd-framectl">
              {/* ── UNDERSTAND THE CAST & PLACES — one vision pass that links the
                   ad's recurring people + places across shots; feeds the fusion. ── */}
              {(() => {
                const roster = entities.roster;
                const nP = roster?.persons.length ?? 0;
                const nL = roster?.places.length ?? 0;
                const nA = roster?.assets?.length ?? 0;
                const linked = roster
                  ? [...roster.persons, ...roster.places, ...(roster.assets || [])].filter(e => e.shotNos.length > 1).length
                  : 0;
                const err = entities.error;
                return (
                  <div className="bd-framectl__grp bd-framectl__grp--entities">
                    <div className="bd-framectl__lead">
                      <button
                        className={`bd-actbtn ghost bd-entbtn${entities.making ? ' is-making' : ''}`}
                        onClick={entities.onUnderstand}
                        disabled={entities.making}
                        title="One vision pass — cluster the ad's recurring people + places and link them across shots. Feeds the master-prompt fusion."
                        aria-label={roster ? 'Re-understand the cast and places' : 'Understand the cast and places'}
                      >
                        {entities.making
                          ? <><span className="bd-dnamake__spin" aria-hidden="true" /> UNDERSTANDING…</>
                          : <>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><circle cx="9" cy="8" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><circle cx="17.5" cy="9.5" r="2" /><path d="M15 19a4 4 0 0 1 6.5-3.1" /></svg>
                              {roster ? 'RE-UNDERSTAND THE CAST & PLACES' : 'UNDERSTAND THE CAST & PLACES'}
                            </>}
                      </button>
                      <span className="bd-framectl__count">
                        {err
                          ? <span className="bd-entbtn__err selectable">{err}</span>
                          : roster
                            ? <><b>{nP}</b> people · <b>{nL}</b> places{nA > 0 ? <> · <b>{nA}</b> assets</> : null}{linked > 0 ? <> · <b>{linked}</b> linked across shots</> : null}</>
                            : <>Cluster the recurring people, places + assets — one locked reference each, reused across their shots</>}
                      </span>
                    </div>
                  </div>
                );
              })()}

              {/* ── RE-FUSE ALL — rebuild every master prompt with the upgraded
                   fusion (overwrites existing; two-step confirm). ── */}
              {withMaster > 0 && (
                <div className="bd-framectl__grp bd-framectl__grp--refuse">
                  <div className="bd-framectl__lead">
                    <button
                      className={`bd-actbtn ghost bd-refuseall${confirmRefuse ? ' is-armed' : ''}`}
                      onClick={() => {
                        if (masterMaking?.active) return;
                        if (confirmRefuse) { setConfirmRefuse(false); onRefuseAll(); }
                        else setConfirmRefuse(true);
                      }}
                      disabled={!!masterMaking?.active || liveDnas === 0}
                      title="Re-fuse every shot's master prompt with the upgraded fusion — overwrites the existing prompts"
                      aria-label="Re-fuse all master prompts"
                    >
                      {masterMaking?.active
                        ? `RE-FUSING… ${masterMaking.done}/${masterMaking.total}`
                        : confirmRefuse ? 'RE-FUSE ALL — overwrites existing?' : 'RE-FUSE ALL ↻'}
                    </button>
                    <span className="bd-framectl__count">
                      {liveDnas === 0
                        ? <>Make the axis DNAs first — the fusion needs them</>
                        : confirmRefuse
                          ? <>Click again to overwrite all <b>{withMaster}</b> master prompt{withMaster === 1 ? '' : 's'}</>
                          : <>Rebuild all <b>{withMaster}</b> with the upgraded fusion</>}
                    </span>
                  </div>
                </div>
              )}

              {/* ── IMAGE row ── */}
              <div className="bd-framectl__grp">
                <div className="bd-framectl__lead">
                  <button className="bd-actbtn primary" onClick={sf.onMakeAll} disabled={!!sf.all?.active || eligible === 0}>
                    {sf.all?.active ? `MAKING FRAMES… ${sf.all.done}/${sf.all.total}` : 'MAKE FRAMES FOR ALL →'}
                  </button>
                  <span className="bd-framectl__count">
                    {madeCount > 0
                      ? <><b>{madeCount}</b>/{rows.length} MADE{eligible > 0 ? ` · ${eligible} to go` : ''}</>
                      : <>{eligible} shot{eligible === 1 ? '' : 's'} ready to make</>}
                  </span>
                </div>
                <div className="bd-framectl__sets">
                  <label className="bd-aspsel">
                    <span className="bd-qseg__lbl">IMAGE MODEL</span>
                    <select className="bd-aspsel__sel" value={sf.imageModel} onChange={e => sf.setImageModel(e.target.value as ModelId)}>
                      {IMAGE_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  </label>
                  <div className="bd-qseg" role="group" aria-label="Make quality">
                    <span className="bd-qseg__lbl">QUALITY</span>
                    {QUALITY_OPTS.map(o => (
                      <button key={o.v} type="button" className={`bd-qseg__opt${sf.quality === o.v ? ' is-on' : ''}`} onClick={() => sf.setQuality(o.v)} aria-pressed={sf.quality === o.v}>{o.label}</button>
                    ))}
                  </div>
                  <label className="bd-aspsel">
                    <span className="bd-qseg__lbl">ASPECT</span>
                    <select className="bd-aspsel__sel" value={sf.aspect} onChange={e => sf.setAspect(e.target.value)}>
                      {SHOT_ASPECTS.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </label>
                </div>
              </div>

              {/* ── VIDEO row — quality is controlled by the first frame first ── */}
              <div className="bd-framectl__grp bd-framectl__grp--video">
                <div className="bd-framectl__lead">
                  <button className="bd-actbtn" onClick={sf.onMakeAllVideos} disabled={!!sf.allVideos?.active || vidEligible === 0}>
                    {sf.allVideos?.active ? `MAKING VIDEOS… ${sf.allVideos.done}/${sf.allVideos.total}` : 'MAKE VIDEOS FOR ALL →'}
                  </button>
                  <span className="bd-framectl__count">
                    {vidMadeCount > 0
                      ? <><b>{vidMadeCount}</b>/{rows.length} VIDEO{vidEligible > 0 ? ` · ${vidEligible} to go` : ''}</>
                      : vidEligible > 0
                        ? <>{vidEligible} shot{vidEligible === 1 ? '' : 's'} ready — needs a MADE frame first</>
                        : <>Make the frames first — video takes the frame as its first frame</>}
                  </span>
                </div>
                <div className="bd-framectl__sets">
                  <label className="bd-aspsel">
                    <span className="bd-qseg__lbl">VIDEO MODEL</span>
                    <select className="bd-aspsel__sel" value={sf.videoModelId} onChange={e => sf.setVideoModelId(e.target.value)}>
                      <optgroup label="Seedance">
                        {VIDEO_MODELS.filter(m => m.provider === 'seedance').map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                      </optgroup>
                      <optgroup label="Kling">
                        {VIDEO_MODELS.filter(m => m.provider === 'kling').map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                      </optgroup>
                    </select>
                  </label>
                  <label className="bd-aspsel">
                    <span className="bd-qseg__lbl">RES</span>
                    <select className="bd-aspsel__sel" value={sf.videoResolution} onChange={e => sf.setVideoResolution(e.target.value as '480p' | '720p' | '1080p' | '4k')}>
                      {VIDEO_RESOLUTIONS.map(rz => <option key={rz} value={rz}>{rz}</option>)}
                    </select>
                  </label>
                  <label className="bd-aspsel" title="Each shot's video length is bound to its own on-screen duration from the shotlist, snapped to the model's nearest allowed value.">
                    <span className="bd-qseg__lbl">SECONDS</span>
                    <span className="bd-aspsel__auto">⏱ per shot</span>
                  </label>
                </div>
              </div>
            </div>
          );
        })()}

        {hasRoster && entities.roster && (
          <EntityRoster
            roster={entities.roster} frames={shotFrames.frames}
            open={rosterOpen} onToggle={setRosterOpen} highlight={highlightEnt}
            building={entities.building} errors={entities.buildErrors}
            onBuild={entities.onBuild} onEditPrompt={entities.onEditPrompt}
            onRevert={entities.onRevert} orphans={entities.orphans}
          />
        )}

        <div className="bd-shots">
          <div className="bd-shots__head" aria-hidden="true">
            <span>#</span><span>TC</span><span>BEAT</span><span>SIZE · LENS · MOVE</span><span>DESCRIPTION</span><span>MASTER</span><span>COMPARE</span>
          </div>
          {rows.map((r, i) => {
            const tcIn = shotTcToSec(r.tc);
            const tcOut = i + 1 < rows.length ? shotTcToSec(rows[i + 1].tc) : (bd.ad.durationS ?? undefined);
            return <ShotCard key={i} r={r} slug={bd.slug} tcIn={tcIn} tcOut={tcOut} sf={shotFrames} roster={entities.roster} onEntityChip={focusEntity} onCompare={() => setLightboxIdx(i)} />;
          })}
        </div>
      </>
    ) : <PendingBlock what="shotlist" hint="No shotlist in this breakdown’s data yet — run the ad to author it." />;
  }

  return (
    <div className="bd-page" role="dialog" aria-modal="true">
      <div className="bd-page__top">
        <button className="bd-bar__back" onClick={onClose} aria-label="Back to the disc (Esc)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><path d="M15 6l-6 6 6 6" /></svg>
          DISC
        </button>
        <span className="bd-crumb">INNER RING — REVERSED PIPELINE <b>{pad2(idx + 1)}/{STAGES.length}</b></span>
        {pending && <span className="bd-page__pending-chip">PENDING · FACTORY</span>}
      </div>
      <div className="bd-scroll"><div className="bd-inner">
        <div className="bd-head">
          <div className="bd-eyebrow">{eyebrow2}</div>
          <h1>{label}</h1>
          <div className="bd-desc">{names[stKey]}</div>
        </div>
        {body}
      </div></div>
      {lightboxIdx != null && shotRows[lightboxIdx] && (
        <ShotCompareLightbox
          rows={shotRows} frames={shotFrames.frames}
          index={lightboxIdx} onIndex={setLightboxIdx}
          onClose={() => setLightboxIdx(null)}
          sourcePath={bd.sourcePath} durationS={bd.ad.durationS}
        />
      )}
    </div>
  );
}

function OverviewBody({ bd, model, onWatch }: { bd: AdBreakdown; model: DiscModel; onWatch: (path: string) => void }) {
  return (
    <>
      <div className="bd-head">
        <div className="bd-eyebrow">{(bd.ad.brand || '').toUpperCase()}{bd.ad.year ? ` · ${bd.ad.year}` : ''}</div>
        <h1>{bd.ad.title}</h1>
        {bd.ad.logline_en && <div className="bd-desc">{bd.ad.logline_en}</div>}
        {bd.ad.logline_ar && <div className="bd-ar" dir="rtl">{bd.ad.logline_ar}</div>}
        <div className="bd-actrow"><WatchFilmButton bd={bd} onPlayLocal={onWatch} /></div>
      </div>
      <div className="bd-premise">Governing premise — this ad is read as an AI film MADE by HJEN.</div>
      <div className="bd-stat-row">
        <div className="bd-stat"><b>{model.axes.filter(a => a.present).length}</b><span>Craft axes</span></div>
        <div className="bd-stat"><b>{model.findingsTotal}</b><span>Findings</span></div>
        <div className="bd-stat"><b>{model.frames.size}</b><span>Frames read</span></div>
        <div className="bd-stat"><b>{STAGES.length}</b><span>Pipeline stages</span></div>
      </div>
      <div className="bd-sec"><h3>Source</h3>
        <div className="bd-kv"><b>BRAND</b><span>{bd.ad.brand || '—'}</span></div>
        <div className="bd-kv"><b>TITLE</b><span>{bd.ad.title}</span></div>
        {bd.ad.year && <div className="bd-kv"><b>YEAR</b><span>{bd.ad.year}</span></div>}
        {bd.ad.director && <div className="bd-kv"><b>DIRECTOR</b><span>{bd.ad.director}</span></div>}
        {bd.ad.durationS != null && <div className="bd-kv"><b>DURATION</b><span>{Math.round(bd.ad.durationS)}s</span></div>}
        {bd.ad.sourceUrl && (
          <div className="bd-kv"><b>SOURCE</b>
            <span><button type="button" className="bd-linklike selectable" onClick={() => window.hjen.openInBrowser(bd.ad.sourceUrl!)}>{bd.ad.sourceUrl}</button></span>
          </div>
        )}
      </div>
    </>
  );
}
