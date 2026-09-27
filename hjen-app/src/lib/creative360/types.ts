import type { Register } from '../eye/types';
// Creative 360 — the shared creative brain for HJEN Studio.
//
// One durable, project-scoped Point Of View (POV) formed from the signed
// stages, plus reasoning primitives every tool draws on: query craft (from
// creative intent → searchable queries), image evaluation (a real rubric
// judge that can REFUSE), and advice (what would strengthen the work).
//
// The POV is persisted as {slug}/_project/creative_pov.json via the generic
// project-doc bridge, so it is formed once and reused — and reformed when the
// stages change. This is the "mind that evolves and serves every tool".

/** The distilled creative point-of-view — the persisted brain. */
export interface CreativePOV {
  /** What the campaign is really about, behind the plot. One line. */
  essence: string;
  /** The emotional / tonal register (e.g. "controlled solitude, dry not sentimental"). */
  register: string;
  /** Who is watching and what they would reject as fake — the creative-audience read. */
  audience: string;
  /** Light logic · lens philosophy · palette-in-words · depth band. */
  visualLanguage: string;
  /** The concrete clichés THIS project refuses (not generic — named). */
  forbidden: string[];
  /** The single sentence every asset is measured against. */
  northStar: string;
  /** Provenance — which stages were present when this POV was formed. */
  formedFrom: { brief: boolean; treatment: boolean; screenplay: boolean };
  formedAt: string;
}

/** A visual search intent + the engine-tuned queries that chase it. */
export interface SearchIntent {
  /** Why we are hunting this — what creative truth it serves (POV-anchored). */
  intent: string;
  /** 2–3 concrete, searchable scene queries (≤5 words, no abstractions). */
  queries: string[];
  /** The FEELING this intent is chasing, in the eye's vocabulary. A search engine
   *  matches words; it cannot rank by feeling. This field lets the eye reorder a
   *  deep harvest before the expensive judge ever looks — written by the same
   *  call that writes the queries, so it costs nothing extra. */
  register: Register | null;
}

/** Per-axis rubric score for one candidate image (0–5 each). */
export interface RubricScore {
  literal: number;   // is it actually the thing the query asked for?
  pov: number;       // does it serve the essence / register?
  craft: number;     // light / composition / lens — is it a strong frame at all?
  fit: number;       // palette / era / place vs the treatment's choices?
  antiCliche: number; // does it dodge the forbidden list?
  total: number;     // sum (0–25)
}

/** One judged candidate the evaluator returns. */
export interface JudgedImage {
  index: number;       // 1-based, in the order the images were given
  keep: boolean;       // cleared the bar for the active strictness
  scores: RubricScore;
  why: string;         // one line — what it earns for the story
  take: string;        // what we borrow (checkable in the frame)
  leave: string;       // what we refuse
  palette: 'warm' | 'cool' | 'colorful' | 'mid';
}

export interface EvaluateResult {
  judged: JudgedImage[];      // every candidate, ranked, scored
  thin: boolean;              // fewer keepers than requested — the set is thin
  note: string;              // the judge's one-line verdict on the set
}

export type Strictness = 'strict' | 'lenient';

/** One concrete next-move the advisor proposes for a surface/tool. */
export interface Advice {
  /** Which tool/surface it strengthens (references, treatment, story, pitch, frames…). */
  surface: string;
  /** Severity: gap = something missing, drift = contradicts the POV, lift = optional upgrade. */
  kind: 'gap' | 'drift' | 'lift';
  /** The move, in one imperative line. */
  move: string;
  /** Why it matters, tied to the POV. */
  why: string;
}
