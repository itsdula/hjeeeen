// Creative Mind — العقل الإبداعي. The immersive session engine, lifted out of
// the view (huntStore precedent): analyze / collide / press are long LLM calls
// and board prefetch is async — a store survives view unmount, and resume
// lives in one place.
//
// One brain, two surfaces: the thinking machinery is lib/creativemind/engine
// (shared verbatim with BriefMindView). This store adds what the visual stage
// needs — the question flow, corpus boards, the Zettel capture, and the
// read-merge-write into stage 1.
//
// Design: STUDY/creative_mind/00_CREATIVE_MIND_STUDY.md + 01_BUILD_PLAN.md.

import { create } from 'zustand';
import { useStore } from '../store';
import type { HjenRefResult } from '../types/hjen-bridge';
import type { BriefCollision, BriefTerritory, VisualAnswer, BriefMindExtras } from '../types/preprod';
import {
  type MindData, EMPTY_MIND, MACHINES,
  drawSeedCards, renderMindMarkdown, asList,
  runAnalyze, runCollide, runPress, runCraftQuestions, runFollowupQuestions, entityId,
} from '../lib/creativemind/engine';
import {
  type MindQuestion, FALLBACK_QUESTIONS, normalizeCraftedQuestions,
  MIN_INITIAL_QUESTIONS, MAX_TOTAL_QUESTIONS,
} from '../lib/creativemind/questions';
import { type BoardFrame, framesetBoardLadder, framesetHuntClose, resetFramesetSession, setHuntReporter, setStarveListener, openFramesetLogin, evictFramesetQuery, labelQuery } from '../lib/creativemind/framesetHunt';
import { type MindNote, loadNotes, saveNotes, newNote, matchNotes } from '../lib/creativemind/zettel';
import { ALL_CARDS } from '../lib/compiler';
import { syncStagesToCreativeGraph } from '../lib/creativegraph/stageSync';
import type { KnowledgeCard } from '../lib/compiler';

const SESSION_DOC = 'creative_mind_session';

export type MindStage =
  | 'entry' | 'analyzing' | 'questions' | 'seeds' | 'collide' | 'territories' | 'sign' | 'done';

/** What persists to {slug}/_project/creative_mind_session.json (resume). */
interface MindSession {
  v: 1;
  projectId: string;
  stage: MindStage;
  rawBrief: string;
  species?: BriefMindExtras['species'];
  proposition: string;
  persona: string;
  gaps: string[];
  questionsLog: string[];
  restatement: string;
  /** The brief-tailored question set crafted by the engine (resume needs it). */
  questions?: MindQuestion[];
  followupRounds?: number;
  questionIndex: number;
  answers: VisualAnswer[];
  drawnCardIds: string[];
  collisions: BriefCollision[];
  territories: BriefTerritory[];
  bigIdea?: { territory: string; why: string };
  updatedAt: string;
}

export interface CreativeMindStore {
  // session
  projectId: string | null;
  stage: MindStage;
  rawBrief: string;
  species?: BriefMindExtras['species'];
  proposition: string;
  persona: string;
  gaps: string[];
  questionsLog: string[];
  restatement: string;
  questions: MindQuestion[];                     // crafted per brief; [] until crafted
  followupRounds: number;                        // follow-up craft rounds already run (cap 2)
  questionIndex: number;
  answers: VisualAnswer[];
  drawnCardIds: string[];
  collisions: BriefCollision[];
  territories: BriefTerritory[];
  bigIdea?: { territory: string; why: string };

  // transient (never persisted)
  boards: Record<string, BoardFrame[]>;          // "qId:optId" → hunted frames
  cardFrames: Record<string, HjenRefResult[]>;   // cardId → evidence frames
  notes: MindNote[];                             // the Zettel inbox
  resumeOffer: boolean;                          // a non-done session exists on disk
  busy: boolean;
  crafting: boolean;                             // second half of 'analyzing' — questions being crafted
  activity: string | null;                       // the live status strip — what the wait IS
  framesetStarved: boolean;                      // quota wall hit — offer sign-in
  error: string | null;
  costUsd: number | null;
  signed: boolean;

  // actions
  init: (projectId: string) => Promise<void>;
  resume: () => void;
  startFresh: () => void;
  setRawBrief: (text: string) => void;
  analyze: () => Promise<void>;
  answer: (optionId: string) => void;
  answerCustom: (text: string) => void;
  rehuntQuestion: () => void;
  signInFrameset: () => void;
  skip: () => void;
  back: () => void;
  drawSeeds: () => void;
  rerollCard: (idx: number) => void;
  collide: () => Promise<void>;
  toggleKeep: (idx: number) => void;
  press: () => Promise<void>;
  pickBigIdea: (name: string) => void;
  setBigIdeaWhy: (why: string) => void;
  goSign: () => void;
  sign: (projectName?: string) => Promise<void>;
  captureNote: (text: string, dimension?: string) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  reset: () => void;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const boardKey = (qId: string, optId: string) => `${qId}:${optId}`;

/** Latin tokens of a card's tags — the only bridge from a card to corpus
 *  evidence (card sources are `seed:*`, not HJC ids). */
function cardQuery(card: KnowledgeCard): string {
  const latin = (card.tags ?? []).filter(t => /[a-z]/i.test(t)).slice(0, 3);
  return latin.join(' ').trim();
}

async function refSearchSafe(query: string, limit: number): Promise<HjenRefResult[]> {
  if (!query.trim()) return [];
  try {
    const res = await window.hjen.refSearch({ query, limit });
    return res.ok ? res.results : [];
  } catch { return []; }
}

/** Corpus fallback board: prefer individually-analyzed, quality ≥ 2. */
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

// ─── the store ───────────────────────────────────────────────────────────────

let persistTimer: ReturnType<typeof setTimeout> | null = null;

export const useCreativeMind = create<CreativeMindStore>((set, get) => {

  // the hidden hunt narrates itself into the status strip
  setHuntReporter(msg => set({ activity: msg || null }));
  setStarveListener(() => set({ framesetStarved: true }));

  function snapshot(): MindSession | null {
    const s = get();
    if (!s.projectId) return null;
    return {
      v: 1,
      projectId: s.projectId,
      stage: s.stage,
      rawBrief: s.rawBrief,
      species: s.species,
      proposition: s.proposition,
      persona: s.persona,
      gaps: s.gaps,
      questionsLog: s.questionsLog,
      restatement: s.restatement,
      questions: s.questions.length ? s.questions : undefined,
      followupRounds: s.followupRounds,
      questionIndex: s.questionIndex,
      answers: s.answers,
      drawnCardIds: s.drawnCardIds,
      collisions: s.collisions,
      territories: s.territories,
      bigIdea: s.bigIdea,
      updatedAt: new Date().toISOString(),
    };
  }

  function persist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      const doc = snapshot();
      if (!doc) return;
      void window.hjen.projectDocWrite({ id: doc.projectId, name: SESSION_DOC, data: doc })
        .catch(() => undefined);
    }, 600);
  }

  function patch(p: Partial<CreativeMindStore>) {
    set(p as any);
    persist();
  }

  function addCost(usd?: number) {
    if (typeof usd === 'number' && usd > 0) set(s => ({ costUsd: (s.costUsd ?? 0) + usd }));
  }

  /** Prefetch the boards of one question (current + next only — image weight).
   *  Source order (Anwar 2026-07-11): hidden Frameset hunt on the option's
   *  crafted query → corpus refSearch on its tags → typographic card ([]).
   *  Each option's board lands PROGRESSIVELY the moment its hunt finishes. */
  async function prefetchQuestion(index: number) {
    const q = get().questions[index];
    if (!q) return;
    const missing = q.options.filter(o => !get().boards[boardKey(q.id, o.id)]);
    if (missing.length === 0) return;
    await Promise.all(missing.map(async (o) => {
      // representativeness ladder: crafted query → label words → tags, then corpus
      let frames = await framesetBoardLadder(o, 4);
      if (frames.length < 2) {
        set({ activity: `Searching the Saudi library — ${o.tags.slice(0, 2).join(' ')}` });
        const corpus = await refSearchSafe(o.tags.join(' '), 8);
        const fromCorpus = corpusBoard(corpus, 4);
        if (fromCorpus.length >= 2) frames = [...frames, ...fromCorpus].slice(0, 4);
        set({ activity: null });
      }
      set(s => ({ boards: { ...s.boards, [boardKey(q.id, o.id)]: frames } }));
    }));
  }

  /** Evidence frames fanned behind one seed card. */
  async function fetchCardFrames(card: KnowledgeCard) {
    if (get().cardFrames[card.id]) return;
    const results = await refSearchSafe(cardQuery(card), 4);
    set(s => ({ cardFrames: { ...s.cardFrames, [card.id]: results.slice(0, 3) } }));
  }

  function seedText(): string {
    const s = get();
    const tagText = s.answers.flatMap(a => a.tags).join(' ');
    return `${s.proposition} ${tagText} ${s.rawBrief}`.trim();
  }

  /** End of the current question list: before moving to seeds, ask the
   *  director if the ANSWERS opened anything new (Anwar 2026-07-11 — answers
   *  may spawn follow-up questions; hard cap MAX_TOTAL_QUESTIONS, 2 rounds). */
  async function finishQuestionsOrFollowup(answers: VisualAnswer[]) {
    const s = get();
    const room = MAX_TOTAL_QUESTIONS - s.questions.length;
    if (s.followupRounds >= 2 || room <= 0) {
      patch({ stage: 'seeds' });
      get().drawSeeds();
      return;
    }
    set({ crafting: true, activity: 'Reading your answers — one question may remain…' });
    const askedIds = new Set(answers.map(a => a.questionId));
    const res = await runFollowupQuestions({
      proposition: s.proposition,
      persona: s.persona,
      asked: answers.map(a => ({ question: a.q ?? a.questionId, answer: a.a ?? a.optionId })),
      skipped: s.questions.filter(q => !askedIds.has(q.id)).map(q => q.en),
      maxQuestions: Math.min(4, room),
    });
    const followups = res.ok
      ? normalizeCraftedQuestions(res.json.questions, {
          max: Math.min(4, room),
          existingIds: s.questions.map(q => q.id),
        })
      : [];
    if (res.ok) addCost(res.usd);
    if (followups.length === 0) {
      patch({ crafting: false, activity: null, stage: 'seeds' });
      get().drawSeeds();
      return;
    }
    const startIndex = s.questions.length;
    patch({
      crafting: false,
      activity: null,
      followupRounds: s.followupRounds + 1,
      questions: [...s.questions, ...followups],
      questionIndex: startIndex,
    });
    for (let i = startIndex; i < startIndex + followups.length; i++) void prefetchQuestion(i);
  }

  return {
    projectId: null,
    stage: 'entry',
    rawBrief: '',
    species: undefined,
    proposition: '',
    persona: '',
    gaps: [],
    questionsLog: [],
    restatement: '',
    questions: [],
    followupRounds: 0,
    questionIndex: 0,
    answers: [],
    drawnCardIds: [],
    collisions: [],
    territories: [],
    bigIdea: undefined,

    boards: {},
    cardFrames: {},
    notes: [],
    resumeOffer: false,
    busy: false,
    crafting: false,
    activity: null,
    framesetStarved: false,
    error: null,
    costUsd: null,
    signed: false,

    init: async (projectId) => {
      const s = get();
      // same project already live in the store (view remount) — keep it
      if (s.projectId === projectId && s.stage !== 'entry') return;
      const notes = await loadNotes();
      let saved: MindSession | null = null;
      try {
        const doc = await window.hjen.projectDocRead({ id: projectId, name: SESSION_DOC });
        if (doc && typeof doc === 'object' && (doc as MindSession).v === 1) saved = doc as MindSession;
      } catch { /* fresh */ }
      if (saved && saved.stage !== 'done' && saved.stage !== 'entry') {
        set({ projectId, notes, resumeOffer: true, stage: 'entry' });
        // stash the saved session on resume()
        (get() as any)._saved = saved;
      } else {
        set({ projectId, notes, resumeOffer: false });
      }
    },

    resume: () => {
      const saved = (get() as any)._saved as MindSession | undefined;
      if (!saved) { set({ resumeOffer: false }); return; }
      set({
        resumeOffer: false,
        stage: saved.stage === 'analyzing' ? 'entry' : saved.stage,
        rawBrief: saved.rawBrief,
        species: saved.species,
        proposition: saved.proposition,
        persona: saved.persona,
        gaps: saved.gaps ?? [],
        questionsLog: saved.questionsLog ?? [],
        restatement: saved.restatement ?? '',
        questions: saved.questions?.length ? saved.questions : [...FALLBACK_QUESTIONS],
        followupRounds: saved.followupRounds ?? 0,
        questionIndex: saved.questionIndex ?? 0,
        answers: saved.answers ?? [],
        drawnCardIds: saved.drawnCardIds ?? [],
        collisions: saved.collisions ?? [],
        territories: saved.territories ?? [],
        bigIdea: saved.bigIdea,
        signed: false,
      });
      if (saved.stage === 'questions') {
        const from = saved.questionIndex ?? 0;
        const count = saved.questions?.length ?? 0;
        for (let i = from; i < count; i++) void prefetchQuestion(i);
      }
      if (saved.stage === 'seeds' || saved.stage === 'collide') {
        const byId = new Map(ALL_CARDS.map(c => [c.id, c]));
        for (const id of saved.drawnCardIds ?? []) {
          const c = byId.get(id);
          if (c) void fetchCardFrames(c);
        }
      }
    },

    startFresh: () => {
      (get() as any)._saved = undefined;
      patch({
        resumeOffer: false, stage: 'entry', rawBrief: '', species: undefined,
        proposition: '', persona: '', gaps: [], questionsLog: [], restatement: '',
        questions: [], followupRounds: 0, questionIndex: 0, answers: [], drawnCardIds: [], collisions: [],
        territories: [], bigIdea: undefined, boards: {}, cardFrames: {},
        crafting: false, error: null, signed: false,
      });
    },

    setRawBrief: (text) => patch({ rawBrief: text }),

    analyze: async () => {
      const s = get();
      const raw = s.rawBrief.trim();
      if (!raw || s.busy) return;
      resetFramesetSession();               // boards renew every session (Anwar)
      set({ busy: true, error: null, stage: 'analyzing', crafting: false, boards: {}, framesetStarved: false, activity: 'Reading the brief — hunting its gaps…' });
      const res = await runAnalyze(raw);
      if (!res.ok) { set({ busy: false, activity: null, error: res.message, stage: 'entry' }); return; }
      addCost(res.usd);
      const j = res.json;
      const species = (['strategy', 'project-management', 'production-task'] as const)
        .find(x => x === j.species);
      const proposition = (j.proposition ?? '').trim();
      const persona = (j.persona ?? '').trim();
      const restatement = (j.restatement ?? '').trim();
      patch({
        species, proposition, persona, restatement,
        gaps: asList(j.gaps),
        questionsLog: asList(j.questionsLog),
        crafting: true,
      });
      void useStore.getState().addLedgerEntry({
        kind: 'note',
        body: `Creative Mind: brief analyzed — ${species ?? 'unclassified'}, ${asList(j.gaps).length} gaps flagged.`,
      });
      // second engine pass: craft the question set FROM this brief — the
      // adaptation is the product (Anwar 2026-07-11). Failure → static set.
      set({ activity: 'Writing your questions from this brief…' });
      let questions = [...FALLBACK_QUESTIONS];
      const crafted = await runCraftQuestions({ species, proposition, persona, restatement, rawBrief: raw });
      if (crafted.ok) {
        addCost(crafted.usd);
        const normalized = normalizeCraftedQuestions(crafted.json.questions);
        if (normalized.length >= MIN_INITIAL_QUESTIONS) questions = normalized;
      }
      patch({
        busy: false,
        crafting: false,
        activity: null,
        stage: 'questions',
        questionIndex: 0,
        questions,
      });
      // hunt EVERY question's boards NOW, most important first (the queue is
      // serial, so call order = priority) — the user never waits mid-flow.
      for (let i = 0; i < questions.length; i++) void prefetchQuestion(i);
    },

    answer: (optionId) => {
      const s = get();
      const q = s.questions[s.questionIndex];
      if (!q) return;
      const opt = q.options.find(o => o.id === optionId);
      if (!opt) return;
      const board = s.boards[boardKey(q.id, opt.id)] ?? [];
      const picked: VisualAnswer = {
        questionId: q.id,
        optionId: opt.id,
        tags: opt.tags,
        refIds: board.map(r => r.id),
        refPaths: board.map(r => r.filePath),
        q: q.en,
        a: opt.en,
      };
      const answers = [...s.answers.filter(a => a.questionId !== q.id), picked];
      const nextIndex = s.questionIndex + 1;
      if (nextIndex >= s.questions.length) {
        patch({ answers, questionIndex: nextIndex });
        void finishQuestionsOrFollowup(answers);
      } else {
        patch({ answers, questionIndex: nextIndex });
      }
    },

    answerCustom: (text) => {
      const s = get();
      const q = s.questions[s.questionIndex];
      const t = text.trim();
      if (!q || !t) return;
      // the user's own words become the answer — tags are its content words
      const tags = t
        .split(/[^\p{L}\p{N}''-]+/u)
        .filter(w => w.length > 2)
        .slice(0, 6);
      const picked: VisualAnswer = {
        questionId: q.id,
        optionId: 'custom',
        tags: tags.length ? tags : [t],
        refIds: [],
        q: q.en,
        a: t,
      };
      const answers = [...s.answers.filter(a => a.questionId !== q.id), picked];
      const nextIndex = s.questionIndex + 1;
      if (nextIndex >= s.questions.length) {
        patch({ answers, questionIndex: nextIndex });
        void finishQuestionsOrFollowup(answers);
      } else {
        patch({ answers, questionIndex: nextIndex });
      }
    },

    // quota wall → the user signs in ONCE in a visible window; session persists
    signInFrameset: () => {
      openFramesetLogin();
      set({ framesetStarved: false });   // give the hunt another chance after login
      resetFramesetSession();
    },

    // the reference didn't fit → hunt this question again, fresh frames
    rehuntQuestion: () => {
      const s = get();
      const q = s.questions[s.questionIndex];
      if (!q) return;
      const boards = { ...s.boards };
      for (const o of q.options) {
        delete boards[boardKey(q.id, o.id)];
        evictFramesetQuery(o.query);
        evictFramesetQuery(labelQuery(o.en));
        evictFramesetQuery(o.tags.slice(0, 2).join(' '));
      }
      set({ boards });
      void prefetchQuestion(s.questionIndex);
    },

    skip: () => {
      const s = get();
      const nextIndex = s.questionIndex + 1;
      if (nextIndex >= s.questions.length) {
        patch({ questionIndex: nextIndex });
        void finishQuestionsOrFollowup(s.answers);
      } else {
        patch({ questionIndex: nextIndex });
      }
    },

    back: () => {
      const s = get();
      if (s.stage === 'questions' && s.questionIndex > 0) {
        const prevQ = s.questions[s.questionIndex - 1];
        patch({
          questionIndex: s.questionIndex - 1,
          answers: s.answers.filter(a => a.questionId !== prevQ.id),
        });
      } else if (s.stage === 'questions') {
        patch({ stage: 'entry' });
      } else if (s.stage === 'seeds') {
        patch({ stage: 'questions', questionIndex: Math.max(0, s.questions.length - 1) });
      } else if (s.stage === 'collide') {
        patch({ stage: 'seeds' });
      } else if (s.stage === 'territories') {
        patch({ stage: 'collide' });
      } else if (s.stage === 'sign') {
        patch({ stage: 'territories' });
      }
    },

    drawSeeds: () => {
      const cards = drawSeedCards(seedText());
      patch({ drawnCardIds: cards.map(c => c.id), stage: 'seeds' });
      for (const c of cards) void fetchCardFrames(c);
    },

    rerollCard: (idx) => {
      const s = get();
      const drawn = [...s.drawnCardIds];
      const pool = ALL_CARDS.filter(c => !c.always && !drawn.includes(c.id));
      if (pool.length === 0 || !drawn[idx]) return;
      const next = pool[Math.floor(Math.random() * pool.length)];
      drawn[idx] = next.id;
      patch({ drawnCardIds: drawn });
      void fetchCardFrames(next);
    },

    collide: async () => {
      const s = get();
      if (s.busy || s.drawnCardIds.length === 0) return;
      const byId = new Map(ALL_CARDS.map(c => [c.id, c]));
      const cards = s.drawnCardIds
        .map(id => byId.get(id))
        .filter((c): c is KnowledgeCard => !!c)
        .map(c => ({ id: c.id, dimension: c.dimension, ar: c.ar, en: c.en }));
      set({ busy: true, error: null, stage: 'collide', activity: 'Running the collision machines — quota is ten…' });
      const mindNotes = matchNotes(s.notes, seedText()).map(n => n.text);
      const res = await runCollide({
        proposition: s.proposition,
        persona: s.persona,
        cards,
        visualWorld: s.answers,
        mindNotes,
      });
      if (!res.ok) { set({ busy: false, activity: null, error: res.message }); return; }
      addCost(res.usd);
      const list: BriefCollision[] = (res.json.collisions ?? [])
        .map(c => ({
          id: entityId('col'),
          seed: String(c.seed ?? '').trim() || 'unseeded',
          machine: MACHINES.find(m => m === c.machine) ?? 'collision',
          idea: String(c.idea ?? '').trim(),
          kept: false,
        }))
        .filter(c => c.idea);
      if (list.length === 0) { set({ busy: false, activity: null, error: 'The collider came back empty — try again.' }); return; }
      patch({ busy: false, activity: null, collisions: list });
      void useStore.getState().addLedgerEntry({
        kind: 'note',
        body: `Creative Mind: ${list.length} collisions logged — kill-gate open.${mindNotes.length ? ` ${mindNotes.length} captured notes fed the collider.` : ''}`,
      });
    },

    toggleKeep: (idx) => {
      const s = get();
      patch({ collisions: s.collisions.map((c, i) => i === idx ? { ...c, kept: !c.kept } : c) });
    },

    press: async () => {
      const s = get();
      const survivors = s.collisions.filter(c => c.kept)
        .map(({ seed, machine, idea }) => ({ seed, machine, idea }));
      if (s.busy || survivors.length === 0) return;
      set({ busy: true, error: null, activity: 'Kill-gate, then press — three territories…' });
      const res = await runPress({
        proposition: s.proposition,
        persona: s.persona,
        survivors,
        visualWorld: s.answers,
      });
      if (!res.ok) { set({ busy: false, activity: null, error: res.message }); return; }
      addCost(res.usd);
      const terrs: BriefTerritory[] = (res.json.territories ?? []).slice(0, 3).map(t => ({
        id: entityId('ter'),
        name: String(t.name ?? '').trim(),
        hook: String(t.hook ?? '').trim(),
        insight: String(t.insight ?? '').trim(),
        firstFrameHint: String(t.firstFrameHint ?? '').trim(),
        culturalTruth: String(t.culturalTruth ?? '').trim(),
      })).filter(t => t.name);
      if (terrs.length === 0) { set({ busy: false, error: 'No territories survived the press — kill-gate again, then retry.' }); return; }
      const big = res.json.bigIdea;
      const bigTerritory = String(big?.territory ?? '').trim();
      const bigIdea = terrs.some(t => t.name === bigTerritory)
        ? { territory: bigTerritory, why: String(big?.why ?? '').trim() }
        : { territory: terrs[0].name, why: String(big?.why ?? '').trim() };
      patch({ busy: false, activity: null, territories: terrs, bigIdea, stage: 'territories' });
      void useStore.getState().addLedgerEntry({
        kind: 'note',
        body: `Creative Mind: ${terrs.length} territories pressed — big idea "${bigIdea.territory}".`,
      });
    },

    pickBigIdea: (name) => {
      const s = get();
      patch({ bigIdea: { territory: name, why: s.bigIdea?.why ?? '' } });
    },

    setBigIdeaWhy: (why) => {
      const s = get();
      patch({ bigIdea: { territory: s.bigIdea?.territory ?? '', why } });
    },

    goSign: () => patch({ stage: 'sign' }),

    sign: async (projectName) => {
      const s = get();
      if (!s.projectId || s.busy) return;
      set({ busy: true, error: null, activity: 'Writing stage 01 into the contract…' });
      try {
        // read-merge-write: three tools share stage 1 — never clobber
        let disk: Partial<MindData> = {};
        try {
          const d = await window.hjen.readStageData({ id: s.projectId, stage: 1 });
          if (d && typeof d === 'object') disk = d as Partial<MindData>;
        } catch { /* fresh stage */ }
        const merged: MindData = {
          ...EMPTY_MIND,
          ...disk,
          rawBrief: s.rawBrief,
          species: s.species,
          proposition: s.proposition,
          persona: s.persona,
          gaps: s.gaps,
          questionsLog: s.questionsLog,
          restatement: s.restatement || disk.restatement || '',
          drawnCardIds: s.drawnCardIds,
          collisions: s.collisions,
          territories: s.territories,
          bigIdea: s.bigIdea,
          visualWorld: s.answers,
        };
        await window.hjen.writeStageData({
          id: s.projectId,
          stage: 1,
          data: { ...merged, updatedAt: new Date().toISOString() },
          markdown: renderMindMarkdown(merged, projectName),
        });
        await syncStagesToCreativeGraph(s.projectId);
        await useStore.getState().signProjectStage(1);
        void useStore.getState().addLedgerEntry({
          kind: 'note',
          body: `Creative Mind: big idea "${s.bigIdea?.territory ?? '—'}" signed — ${s.answers.length} visual answers, ${s.collisions.filter(c => c.kept).length} collisions kept.`,
        });
        patch({ busy: false, activity: null, signed: true, stage: 'done' });
        void framesetHuntClose();
      } catch (e: any) {
        set({ busy: false, activity: null, error: String(e?.message || e) });
      }
    },

    captureNote: async (text, dimension) => {
      const t = text.trim();
      if (!t) return;
      const notes = [newNote(t, dimension), ...get().notes];
      set({ notes });
      await saveNotes(notes);
    },

    deleteNote: async (id) => {
      const notes = get().notes.filter(n => n.id !== id);
      set({ notes });
      await saveNotes(notes);
    },

    reset: () => {
      (get() as any)._saved = undefined;
      set({
        projectId: null, stage: 'entry', rawBrief: '', species: undefined,
        proposition: '', persona: '', gaps: [], questionsLog: [], restatement: '',
        questions: [], followupRounds: 0, questionIndex: 0, answers: [], drawnCardIds: [], collisions: [],
        territories: [], bigIdea: undefined, boards: {}, cardFrames: {},
        resumeOffer: false, busy: false, crafting: false, error: null, signed: false,
      });
    },
  };
});
