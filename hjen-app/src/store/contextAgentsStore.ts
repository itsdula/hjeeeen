// Context Agents — the Studio session store. Mirrors creativeMindStore's board
// machinery (boardKey / refSearchSafe / corpusBoard / a per-question prefetch)
// but SIMPLE: the thinking engine is server-side. This store only:
//   · assembles the small closed-vocab state from the impression picks,
//   · hunts a reference board for every impression option (input) and every
//     retrieved method (output),
//   · calls engine.caApply once the three axes + a goal are set,
//   · never scores, never selects, never prompts — that recipe lives in MAIN.
//
// House law (recipe stays server-side): the only engine touchpoint is
// engine.caApply. refSearch here is DISPLAY (fetching evidence boards), not
// retrieval — the same corpus boards Creative Mind fetches.

import { create } from 'zustand';
import type { HjenRefResult, CAApplyResult, CACard, CAProfileSummary } from '../types/hjen-bridge';
import { caApply, listProfiles } from '../lib/contextagents/engine';
import type { ApplyState } from '../lib/contextagents/types';
import { IMPRESSION_QUESTIONS, type ImpressionOption } from '../lib/contextagents/impressions';
import { framesetBoardLadder, resetFramesetSession, setHuntReporter, setStarveListener, openFramesetLogin } from '../lib/creativemind/framesetHunt';

// The board frame carried by both surfaces. Structurally identical to Creative
// Mind's BoardFrame — re-exported here so RefBoard (a Context Agents component)
// imports it from within the feature.
export type { BoardFrame } from '../lib/creativemind/framesetHunt';
import type { BoardFrame } from '../lib/creativemind/framesetHunt';

/** One recorded impression pick — mirrors the VisualAnswer provenance shape
 *  (which corpus frames the beginner actually saw when they chose). */
export interface Impression {
  axis: 'register' | 'beat' | 'energy';
  optionId: string;
  value: string;
  tags: string[];
  refIds: string[];
  refPaths: string[];
}

export type CAStage = 'questions' | 'result';

// ─── helpers (copied verbatim from creativeMindStore) ────────────────────────

const boardKey = (axis: string, optId: string) => `${axis}:${optId}`;

async function refSearchSafe(query: string, limit: number): Promise<HjenRefResult[]> {
  if (!query.trim()) return [];
  try {
    const res = await window.hjen.refSearch({ query, limit });
    return res.ok ? res.results : [];
  } catch { return []; }
}

/** Corpus fallback board: prefer individually-analyzed, quality ≥ 2, one per ad. */
function corpusBoard(results: HjenRefResult[], n = 4): BoardFrame[] {
  const ranked = [...results].sort((a, b) =>
    (Number(b.analyzed) - Number(a.analyzed)) || (b.q - a.q) || (b.score - a.score));
  const out: HjenRefResult[] = [];
  const usedAds = new Set<string>();
  for (const r of ranked) {
    if (out.length >= n) break;
    if (usedAds.has(r.ad)) continue;
    out.push(r);
    usedAds.add(r.ad);
  }
  for (const r of ranked) {
    if (out.length >= n) break;
    if (!out.some(x => x.id === r.id)) out.push(r);
  }
  return out.map(r => ({ id: r.id, filePath: r.filePath, source: 'corpus' as const, title: r.brand || r.title }));
}

// Same stopword filter as framesetHunt.labelQuery — the plan's `contentWords`.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'on', 'in', 'at', 'to', 'and', 'or', 'not', 'like',
  'with', 'else', 'being', 'its', "it's", 'their', 'his', 'her', 'that', 'this',
  'it', 'is', 'are', 'be', 'as', 'for', 'by', 'from', 'into', 'through', 'when',
]);

/** Content words of a free string (drops stopwords, dedupes, first-wins). */
function contentWords(s: string, n: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)) {
    if (w.length <= 2 || STOPWORDS.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= n) break;
  }
  return out;
}

/** The output Lock board query for one retrieved method: the craft's first two
 *  words + three content words from its effect + the register the card serves.
 *  DISPLAY only — this fetches evidence frames, it does not retrieve methods. */
export function cardBoardQuery(card: CACard, state: Partial<ApplyState>): string {
  const craftHead = contentWords(card.craft || '', 2);
  const effectWords = contentWords(card.effect || '', 3);
  const reg = card.when_it_works?.register?.[0] ?? state.register ?? '';
  return [...craftHead, ...effectWords, reg].filter(Boolean).join(' ').trim();
}

// ─── the store ───────────────────────────────────────────────────────────────

export interface ContextAgentsStore {
  stage: CAStage;
  advanced: boolean;                          // dropdowns instead of picture questions
  state: Partial<ApplyState>;                 // { register?, beat?, energy? }
  impressions: Impression[];                  // provenance of each pick
  boards: Record<string, BoardFrame[]>;       // boardKey(axis, optId) → frames
  profileId: string;
  profiles: CAProfileSummary[];
  goal: string;
  result: CAApplyResult | null;
  cardFrames: Record<string, BoardFrame[]>;   // methodId → evidence frames
  busy: boolean;
  activity: string | null;                    // live hunt status strip
  framesetStarved: boolean;
  error: string | null;
  initialized: boolean;

  init: () => Promise<void>;
  answer: (axis: 'register' | 'beat' | 'energy', optId: string) => void;
  setAdvanced: (b: boolean) => void;
  setAxis: (axis: 'register' | 'beat' | 'energy', value: string) => void;   // advanced-mode direct set
  setGoal: (goal: string) => void;
  setProfile: (id: string) => void;
  signInFrameset: () => void;
  run: () => Promise<void>;
  reset: () => void;
}

export const useContextAgents = create<ContextAgentsStore>((set, get) => {

  // The hidden hunt narrates itself into the status strip (shared reporter with
  // Creative Mind — only one visual session runs at a time in practice).
  setHuntReporter(msg => set({ activity: msg || null }));
  setStarveListener(() => set({ framesetStarved: true }));

/** A hunt drives a real browser. It can hang — waiting on a login wall, a slow
 *  network, a tab that never answers — and there is no upper bound on that. */
const HUNT_TIMEOUT_MS = 25_000;

  /** Resolve to `fallback` rather than hanging or rejecting. */
  function settled<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
    return new Promise<T>(resolve => {
      let done = false;
      const finish = (v: T) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
      const timer = setTimeout(() => finish(fallback), ms);
      p.then(finish, () => finish(fallback));
    });
  }

  /** Prefetch one impression option's board: crafted query ladder → corpus.
   *
   *  THIS MUST ALWAYS COMMIT A VALUE. An option whose board is still `undefined`
   *  renders as a DISABLED button, so a hunt that threw or hung left that
   *  question permanently unanswerable — and with three axes required before
   *  MAKE enables, one stuck hunt meant the button could never be pressed at
   *  all. A machine with no Chrome, no network or no Frameset login hit that
   *  every time. An empty array is a real answer: it renders the typographic
   *  card, which is clickable. */
  async function prefetchOption(axis: string, o: ImpressionOption) {
    const key = boardKey(axis, o.id);
    if (get().boards[key]) return;
    let frames: BoardFrame[] = [];
    try {
      frames = await settled(framesetBoardLadder(o, 4), HUNT_TIMEOUT_MS, [] as BoardFrame[]);
      if (frames.length < 2) {
        const corpus = await refSearchSafe(o.tags.join(' '), 8);
        const fromCorpus = corpusBoard(corpus, 4);
        if (fromCorpus.length >= 2) frames = [...frames, ...fromCorpus].slice(0, 4);
      }
    } catch { /* no board is a degraded card, never a dead question */ }
    set(s => ({ boards: { ...s.boards, [key]: frames } }));
  }

  /** Prefetch every impression option across all three questions, in order. */
  function prefetchAll() {
    for (const q of IMPRESSION_QUESTIONS) {
      for (const o of q.options) void prefetchOption(q.axis, o);
    }
  }

  /** Evidence board for one retrieved method (output Lock card). */
  async function fetchCardFrames(card: CACard, state: Partial<ApplyState>) {
    if (get().cardFrames[card.id]) return;
    const q = cardBoardQuery(card, state);
    const corpus = await refSearchSafe(q, 8);
    set(s => ({ cardFrames: { ...s.cardFrames, [card.id]: corpusBoard(corpus, 4) } }));
  }

  return {
    stage: 'questions',
    advanced: false,
    state: {},
    impressions: [],
    boards: {},
    profileId: '',
    profiles: [],
    goal: '',
    result: null,
    cardFrames: {},
    busy: false,
    activity: null,
    framesetStarved: false,
    error: null,
    initialized: false,

    init: async () => {
      if (get().initialized) return;
      set({ initialized: true });
      resetFramesetSession();
      const profiles = await listProfiles();
      const defaultId = profiles[0]?.id ?? '';
      set(s => ({ profiles, profileId: s.profileId || defaultId }));
      // hunt every option's board now, register→beat→energy (serial queue =
      // priority) so the picture questions fill in as the user reads them.
      prefetchAll();
    },

    answer: (axis, optId) => {
      const q = IMPRESSION_QUESTIONS.find(x => x.axis === axis);
      const opt = q?.options.find(o => o.id === optId);
      if (!q || !opt) return;
      const board = get().boards[boardKey(axis, opt.id)] ?? [];
      const impression: Impression = {
        axis,
        optionId: opt.id,
        value: opt.value,
        tags: opt.tags,
        refIds: board.map(f => f.id),
        refPaths: board.map(f => f.filePath),
      };
      set(s => ({
        state: { ...s.state, [axis]: opt.value },
        impressions: [...s.impressions.filter(i => i.axis !== axis), impression],
      }));
    },

    setAdvanced: (b) => set({ advanced: b }),

    setAxis: (axis, value) => set(s => ({
      state: { ...s.state, [axis]: value },
      impressions: [
        ...s.impressions.filter(i => i.axis !== axis),
        { axis, optionId: 'advanced', value, tags: [], refIds: [], refPaths: [] },
      ],
    })),

    setGoal: (goal) => set({ goal }),
    setProfile: (id) => set({ profileId: id }),

    signInFrameset: () => {
      openFramesetLogin();
      set({ framesetStarved: false });
      resetFramesetSession();
    },

    run: async () => {
      const s = get();
      const { register, beat, energy } = s.state;
      const goal = s.goal.trim();
      if (s.busy || !register || !beat || !energy || !goal || !s.profileId) return;
      set({ busy: true, error: null, activity: 'Reading the state — retrieving the methods that serve it…' });
      let res: CAApplyResult;
      try {
        res = await caApply({ profileId: s.profileId, register, beat, energy, goal });
      } catch (e: any) {
        set({ busy: false, activity: null, error: String(e?.message || e) });
        return;
      }
      if (!res.ok) {
        set({ busy: false, activity: null, error: res.message || res.reason || 'The engine came back empty.' });
        return;
      }
      set({ busy: false, activity: null, result: res, stage: 'result', cardFrames: {} });
      // Fetch an evidence board for each retrieved method (output Lock cards).
      const applied = res.state ?? { register, beat, energy };
      for (const m of res.methods ?? []) {
        // caApply returns method summaries; hydrate the full card for its query.
        void (async () => {
          const full = await window.hjen.caReadCard({ id: m.id });
          if (full.ok) await fetchCardFrames(full.card, applied);
        })();
      }
    },

    reset: () => set({
      stage: 'questions',
      state: {},
      impressions: [],
      goal: '',
      result: null,
      cardFrames: {},
      busy: false,
      activity: null,
      error: null,
    }),
  };
});
