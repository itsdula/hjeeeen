// The Creative Mind engine — Brief Mind's thinking machinery, extracted so
// two surfaces can share ONE brain: BriefMindView (text panels) and the
// Creative Mind (immersive visual stage). The three Council system prompts
// are byte-identical to what BriefMindView shipped; visual answers and
// Zettel notes enter ONLY through the user-prompt payload, never by editing
// these systems — so Brief Mind's behavior cannot drift.
//
// Domain source: STUDY/creative_pipeline/00_THE_COUNCIL.md §١+§٢ and
// _synthesis/B_brainstorm.md + C_creative_brief.md.
// Creative Mind design: STUDY/creative_mind/00_CREATIVE_MIND_STUDY.md.

import type { BriefData } from '../../types/hjen-bridge';
import type { BriefMindExtras, BriefCollision, BriefTerritory, VisualAnswer } from '../../types/preprod';
import { ppClaude } from '../../components/preprod/shared';
import { DEFAULT_REFUSALS } from '../../components/project/primitives/RefusalsRow';
import { ALL_CARDS } from '../compiler';
import type { KnowledgeCard } from '../compiler';
import { retrieveCards } from '../compiler/retrieve';

// ─── stage-1 data (BriefComposer's fields + the thinking block) ─────────────

export type MindData = BriefData & BriefMindExtras;

export const EMPTY_MIND: MindData = {
  // shared with BriefComposer — defaults must match so merges never clobber
  client: '',
  oneLine: '',
  regions: [],
  refusals: [...DEFAULT_REFUSALS],
  restatement: '',
  // Brief Mind extras
  rawBrief: '',
  proposition: '',
  persona: '',
  gaps: [],
  questionsLog: [],
  drawnCardIds: [],
  collisions: [],
  territories: [],
};

// ─── canon ──────────────────────────────────────────────────────────────────

export const BANNED_AR: ReadonlyArray<string> = [
  'في عالم اليوم', 'نحو مستقبل أفضل', 'تجربة لا تُنسى',
  'أصالة وحداثة', 'بلمسة سعودية', 'نحكي قصصاً',
];

export const SPECIES_LABEL: Record<NonNullable<BriefMindExtras['species']>, string> = {
  'strategy': 'Strategy brief',
  'project-management': 'Project-management brief',
  'production-task': 'Production-task brief',
};

// Static bilingual label — لغة العرض shows this beside the English chip in
// 'ar'/'both' mode. A fixed 3-value map, never an LLM translation.
export const SPECIES_LABEL_AR: Record<NonNullable<BriefMindExtras['species']>, string> = {
  'strategy': 'بريف استراتيجي',
  'project-management': 'بريف إدارة مشروع',
  'production-task': 'بريف مهمة إنتاجية',
};

export const MACHINES: ReadonlyArray<BriefCollision['machine']> = ['funnel', 'collision', 'invert', 'transform'];

export const MACHINE_LABEL: Record<BriefCollision['machine'], string> = {
  funnel: 'FUNNEL',
  collision: 'COLLIDE',
  invert: 'INVERT',
  transform: 'TRANSFORM',
};

// ─── LLM systems (the Council, encoded) ─────────────────────────────────────
//
// LANGUAGE LAW (Anwar, 2026-07-08): Brief Mind's output is ENGLISH as the
// base — precise description, precise naming. Arabic enters downstream, at
// the Pitch stage (تعريب). The input brief may arrive in any language.
// Culturally-Arabic nouns keep their Arabic name transliterated, with the
// Arabic script in parentheses when it earns its place.

export const ANALYZE_SYSTEM = [
  'You are the strategic Account Planner — Jon Steel school. You enter the room representing the one person absent from it: the consumer. A brief is a compression device, not a description: one promise, aimed at one named human with observed behavior — never "the Saudi audience" or any segment. What a brief leaves unsaid is more dangerous than what it says.',
  '',
  'A raw brief arrives (it may be written in Arabic or English — read either). Work in order, and write ALL output in precise English:',
  '1. Classify the species: "strategy" | "project-management" | "production-task" — a task brief often arrives disguised as a strategy brief; expose it.',
  '2. Empty it into the superset schema and hunt the gaps: background · business objective · strategy/angle · promise · RTBs · narrow audience + psychographic · deliverables/ratios/channels · mandatories · timeline · budget · approval authority · references. Every missing field = one client-ready question, written verbatim, ready to send (gaps). Never skip: objective / audience / budget / timeline / approval authority / mandatories.',
  '3. Run the three failure-mode checks and log hits in questionsLog: more than one objective? audience wider than one persona? generic language with no specifics?',
  '4. Extract or forge the proposition: ONE sentence a stranger could sell out loud in any room. Longer than a sentence = not a proposition.',
  '5. Build the persona: one named human — name, age, city, one concrete daily behavior, one thing they mock. "Saudis 25–40" is rejected.',
  '6. Keep the questionsLog: every question the brief raises — for research, not decoration.',
  '7. Restate the brief in ≤120 English words: calm, specific, zero marketing language, one thought per sentence, and END ON THE WEIGHT WORD.',
  '',
  'Hard rules:',
  '- English is the base for every field. Culturally-Arabic nouns keep their Arabic name transliterated (e.g. "the dallah", "the dikkah bench", "sobia"), with Arabic script in parentheses only when the name itself is the detail.',
  '- Never silently invent a missing fact: any inferred field is marked "assumption — needs confirmation".',
  '- Questions are short and uncomfortable: "If the campaign works, which number moves?" / "What does the client lose if it does not?"',
  '- No stock-marketing phrasing in any language (no "in today\'s fast-paced world", no "unforgettable experience", no "authenticity meets modernity").',
  '',
  'Return ONLY a JSON object, no prose around it:',
  '{"species":"strategy|project-management|production-task","proposition":"one sentence","persona":"...","gaps":["client-ready question", "..."],"questionsLog":["..."],"restatement":"<=120 English words"}',
].join('\n');

export const COLLIDE_SYSTEM = [
  'You are the Gulf Creative Director — you build ideas from boring daily behavior, never from spectacle: from how the coffee is poured with the left hand, not from a falcon at sunset. Your method is a machine, not a mood, and your quota is ten logged collisions — most will be awful, and that is the design.',
  '',
  'You receive: a proposition + a persona + drawn cards from the 18-dimension Saudi-DNA layer (id, dimension, ar, en). When the story lives elsewhere (another city, another culture), the SAME machines run on that world\'s boring daily behavior — the cards then serve as method examples, not as forced content. Run the machines. Write ALL output in precise English:',
  '1. machine="funnel" — the four-question funnel on one card/behavior: why is this human doing it? (3 competing motives) → what does that say about them? (a trait) → best/worst thing that could happen — a test cut to THAT trait, no lottery, no random accident.',
  '2. machine="collision" — the hook formula: familiar formula × one alien element (K-9 = buddy-cop + the partner is a dog), or card × card: [occasion]×[comedy], [social gesture]×[era].',
  '3. machine="invert" — flip the card: the guest who refuses the coffee; the wedding where the men cry.',
  '4. machine="transform" — oren\'s six transforms on the card: Scale / Aesthetic / Beauty / Transportation / Clashing / Tension. (A transport swaps only era or place — trait and conflict stay locked.)',
  '',
  'Hard rules:',
  '- Output at least 10 collisions. Log even the bad ones — the log is the project\'s memory.',
  '- Every idea is one or two English sentences, SEEN not explained, and anchored to a human trait before it counts as an idea.',
  '- Comedy targets the situation, never religion or a person\'s dignity. No imported joke structures pasted across cultures.',
  '- seed = the id of the card (or the named behavior) the collision started from.',
  '',
  'Return ONLY a JSON object:',
  '{"collisions":[{"seed":"card-id","machine":"funnel|collision|invert|transform","idea":"..."}, ...]} — at least 10 items.',
].join('\n');

export const TERRITORY_SYSTEM = [
  'You are the Gulf Creative Director at the kill-gate — cull, then press. Your cruelty here: no idea survives without a one-line hook that lands in any majlis and is SEEN, without a conflict locked to a trait, without reading clean with zero explanation, and without being shootable with named resources.',
  '',
  'You receive: proposition + persona + the collisions that were KEPT. Work in precise English:',
  '1. Run every survivor through the four-part survival test: one-line hook + trait-locked conflict + reads without explanation + shootable with named resources.',
  '2. Compress any film-arc into a single-beat campaign insight — it must stretch across forty frames AND thirty seconds, not a short film.',
  '3. Write EXACTLY three territories, each: name (short) + hook (the majlis line) + insight + firstFrameHint (seen, camera-able) + culturalTruth (one named truth detail of the story\'s world: a name / place / year / gesture / object — "our heritage" = zero; for a New York story that detail is a New York noun).',
  '4. Nominate one as the Big Idea: bigIdea.territory = the territory name verbatim, bigIdea.why = two lines.',
  '',
  'Hard rules:',
  '- An idea that needs explaining dies. "If you must explain it in the majlis, do not write it."',
  '- The two enemies: the topic-idea (no tension, no change) and the imported-idea (works in London, dies in Buraidah — or the reverse).',
  '- English base everywhere; Arabic proper nouns stay transliterated where they ARE the detail.',
  '',
  'Return ONLY a JSON object:',
  '{"territories":[{"name":"...","hook":"...","insight":"...","firstFrameHint":"...","culturalTruth":"..."},{...},{...}],"bigIdea":{"territory":"...","why":"..."}}',
].join('\n');

export const QUESTIONS_SYSTEM = [
  'You are a working commercial director sitting across from a client — not a poet, not a strategist with jargon. You received the analyzed brief. Write the visual questions that must be answered before anyone can shoot this campaign.',
  '',
  'What makes a question worth asking:',
  '- It is about THIS brief\'s actual subject — its product, its people, its places, its moments, its tension. Never an abstract craft category.',
  '- It settles ONE real creative decision: who the film is about, where it happens, which moment we show, how the product appears, who else is in the frame, what the opening shot is.',
  '- Its answer CHANGES what gets shot. If every option leads to the same film, kill the question.',
  '- PLAIN LANGUAGE. Short words, direct phrasing, zero philosophy, zero metaphors. A stranger reads it once and gets it. ("Where does the story happen?" — never "Which register of place inhabits the narrative?")',
  '',
  'Write 6–10 questions, ordered biggest decision first. For each: en (one short plain English question) + ar (natural Arabic translation, equally simple). 2–4 options per question, each a genuinely different path:',
  '- id: kebab-case slug.',
  '- en: 2–6 plain words naming what we would SEE ("the father\'s kitchen at dawn", "the delivery bike in traffic") — concrete, never abstract.',
  '- ar: short simple Arabic translation.',
  '- tags: 2–4 English tokens that feed the idea machine if picked.',
  '- query: 2–4 concrete words for a FILM-FRAME search engine (real movie/commercial stills indexed by content and light). THE QUERY RESTATES THE OPTION ITSELF as things a camera can see — it must share the option\'s key nouns. Option "numbers typed live on screen" → query "typing numbers screen glow"; option "handwritten on paper" → query "handwriting pen paper close-up". Test before writing it: a stranger seeing the returned frames says "yes, that IS this option". Never a loose mood, no brand names, no abstractions, no Arabic.',
  '- register: the FEELING the option is asking for — exactly one of: longing | resolve | joy | desolation | turbulence | groundedness. This is not decoration: the frame search ranks by text, and this field is what lets the eye reorder those results by how they actually FEEL. Read the option itself, not the brand: "the father\'s kitchen at dawn" is groundedness, "the empty chair at iftar" is longing, "the crowd when the goal lands" is joy, "the last shop on a dead street" is desolation, "the argument before the decision" is turbulence, "he keeps going after the third failure" is resolve.',
  '',
  'Hard rules:',
  '- English is the base of every field except ar. Culturally-Arabic nouns stay transliterated ("the dallah", "majlis").',
  '- If an option is ABOUT film / AI / screens / apps themselves (a bad AI frame, a split-screen, an interface), the query names the PHYSICAL thing a camera would see instead: "distorted portrait face" not "AI artifact"; "man closing laptop office night" not "stock-photo skyline"; "two screens editing room" not "split-screen". A frame search engine indexes real photographed frames — meta-concepts and brand names return nothing.',
  '- Options within a question must lead to visibly DIFFERENT frames — if two options would return similar images, replace one.',
  '- Most questions anchor in this brief\'s specific world (its rituals, hours, places, people); one or two may open an unexpected door.',
  '- No stock clichés as options (falcon-sunset, thobe-laughing-at-phone, diverse-team-at-laptop).',
  '',
  'Return ONLY a JSON object:',
  '{"questions":[{"id":"...","en":"...","ar":"...","options":[{"id":"...","en":"...","ar":"...","tags":["..."],"query":"...","register":"longing|resolve|joy|desolation|turbulence|groundedness"}]}, ...]}',
].join('\n');

export const FOLLOWUP_SYSTEM = [
  'Same director, same table. The client has now ANSWERED your visual questions — you can see every pick. Something in those answers may open a question that matters NOW and did not matter before: they chose the father, so — is the son in the frame? They chose night, so — street or interior? They chose the product in hands, so — whose hands?',
  '',
  'Write 0–4 follow-up questions, ONLY if the answers genuinely raise them. No follow-up for its own sake — returning an empty list is a professional answer.',
  '',
  'Same rules as before: each question is about this brief\'s actual subject, settles one real decision, and is written in PLAIN language (short words, no philosophy, no metaphors). 2–4 options each; every option: id (kebab), en (2–6 concrete words naming what we would see), ar (short simple Arabic), tags (2–4 English tokens), query (2–4 concrete words for a film-frame search engine — the query RESTATES THE OPTION as things a camera can see and shares its key nouns; never a loose mood, no abstractions, no Arabic), register (exactly one of longing | resolve | joy | desolation | turbulence | groundedness — the feeling the option asks for; the eye reorders the frame search by it).',
  '',
  'Return ONLY a JSON object (empty array when nothing needs asking):',
  '{"questions":[{"id":"...","en":"...","ar":"...","options":[{"id":"...","en":"...","ar":"...","tags":["..."],"query":"...","register":"longing|resolve|joy|desolation|turbulence|groundedness"}]}]}',
].join('\n');

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Stable entity id — the mind canvas references collisions/territories by it. */
export function entityId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function sentenceCount(s: string): number {
  return s.trim().split(/[.!؟?…]+/).map(t => t.trim()).filter(Boolean).length;
}

export function bannedHit(...texts: Array<string | undefined>): string | null {
  const all = texts.filter(Boolean).join(' ');
  return BANNED_AR.find(b => all.includes(b)) ?? null;
}

export function asList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(x => String(x ?? '').trim()).filter(Boolean) : [];
}

/** Dimension-diverse random pick — the CD's rule: «لا تتجاور كلها في بُعد واحد». */
export function pickDiverse(pool: KnowledgeCard[], n: number): KnowledgeCard[] {
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const out: KnowledgeCard[] = [];
  const dims = new Set<string>();
  for (const c of shuffled) {
    if (out.length >= n) break;
    if (!dims.has(c.dimension)) { out.push(c); dims.add(c.dimension); }
  }
  for (const c of shuffled) {
    if (out.length >= n) break;
    if (!out.some(x => x.id === c.id)) out.push(c);
  }
  return out;
}

/** Seed pool: retrieveCards' matched set when it bites, else the full deck
 *  (rails excluded — safety cards are laws, not brainstorm fuel). */
export function drawSeedCards(seedText: string): KnowledgeCard[] {
  let pool: KnowledgeCard[] = [];
  if (seedText.trim()) {
    const { matched } = retrieveCards(seedText, 'image', 12);
    pool = matched.filter(c => !c.always);
  }
  if (pool.length < 3) pool = ALL_CARDS.filter(c => !c.always);
  const count = 4 + Math.floor(Math.random() * 3); // 4–6
  return pickDiverse(pool, Math.min(count, pool.length));
}

export function renderMindMarkdown(d: MindData, projectName?: string): string {
  // English-base memo (Anwar 2026-07-08) — Arabization happens at Pitch.
  const L: string[] = [];
  L.push(`# Brief Mind — ${projectName ?? 'Untitled'}`);
  L.push('');
  if (d.client) L.push(`**Client:** ${d.client}  `);
  if (d.species) L.push(`**Species:** ${SPECIES_LABEL[d.species]}  `);
  if (d.proposition?.trim()) L.push(`**Proposition:** ${d.proposition.trim()}  `);
  if (d.oneLine?.trim()) L.push(`**Intent line:** ${d.oneLine.trim()}  `);
  L.push('');
  if (d.persona?.trim()) {
    L.push('## Persona');
    L.push(d.persona.trim());
    L.push('');
  }
  const gaps = (d.gaps ?? []).filter(g => g.trim());
  if (gaps.length) {
    L.push('## Gaps — client-ready questions');
    for (const g of gaps) L.push(`- ${g}`);
    L.push('');
  }
  const q = (d.questionsLog ?? []).filter(x => x.trim());
  if (q.length) {
    L.push('## Questions log');
    for (const x of q) L.push(`- ${x}`);
    L.push('');
  }
  if (d.restatement?.trim()) {
    L.push('## Restatement');
    L.push(d.restatement.trim());
    L.push('');
  }
  const world = (d.visualWorld ?? []).filter(a => a.tags.length || a.optionId);
  if (world.length) {
    L.push('## Visual World — picked through the Creative Mind');
    for (const a of world) L.push(`- **${a.questionId}:** ${a.optionId} — ${a.tags.join(', ')}`);
    L.push('');
  }
  const kept = (d.collisions ?? []).filter(c => c.kept);
  if (kept.length) {
    L.push('## Collisions kept past the kill-gate');
    for (const c of kept) L.push(`- [${c.machine}] ${c.idea} *(seed: ${c.seed})*`);
    L.push('');
  }
  const terrs = (d.territories ?? []).filter(t => t.name.trim());
  if (terrs.length) {
    L.push('## Territories');
    terrs.forEach((t, i) => {
      L.push(`### ${i + 1} · ${t.name}`);
      if (t.hook) L.push(`- **Hook:** ${t.hook}`);
      if (t.insight) L.push(`- **Insight:** ${t.insight}`);
      if (t.firstFrameHint) L.push(`- **First frame:** ${t.firstFrameHint}`);
      if (t.culturalTruth) L.push(`- **Truth detail:** ${t.culturalTruth}`);
      L.push('');
    });
  }
  if (d.bigIdea?.territory?.trim()) {
    L.push('## The Big Idea');
    L.push(`**${d.bigIdea.territory}**`);
    if (d.bigIdea.why?.trim()) L.push(d.bigIdea.why.trim());
    L.push('');
  }
  if (d.refusals?.length) {
    L.push('## Refusals');
    for (const r of d.refusals.filter(x => x.trim())) L.push(`- ${r}`);
    L.push('');
  }
  return L.join('\n');
}

// ─── LLM response shapes ────────────────────────────────────────────────────

export interface AnalyzeOut {
  species?: string;
  proposition?: string;
  persona?: string;
  gaps?: unknown;
  questionsLog?: unknown;
  restatement?: string;
}

export interface CollideOut { collisions?: Array<{ seed?: string; machine?: string; idea?: string }> }

export interface TerritoryOut {
  territories?: Array<Partial<BriefTerritory>>;
  bigIdea?: { territory?: string; why?: string };
}

// ─── typed engine calls ─────────────────────────────────────────────────────
// Visual answers / Zettel notes ride the user payload; keys are added only
// when non-empty so Brief Mind's payloads stay byte-identical to before.

export type EngineResult<T> = { ok: true; json: T; usd?: number } | { ok: false; message: string };

export function runAnalyze(rawBrief: string): Promise<EngineResult<AnalyzeOut>> {
  return import('../creativegraph/briefMindGraph').then(m => m.runAnalyzeGraph(rawBrief));
}

export interface CraftedOption { id?: string; en?: string; ar?: string; tags?: unknown; query?: string; register?: string }
export interface CraftedQuestion { id?: string; en?: string; ar?: string; options?: CraftedOption[] }
export interface QuestionsOut { questions?: CraftedQuestion[] }

export function runCraftQuestions(input: {
  species?: string;
  proposition: string;
  persona: string;
  restatement: string;
  rawBrief?: string;
}): Promise<EngineResult<QuestionsOut>> {
  return ppClaude<QuestionsOut>({ system: QUESTIONS_SYSTEM, promptId: 'brief-mind.questions', prompt: JSON.stringify(input, null, 1), task: 'brief-mind' });
}

export function runFollowupQuestions(input: {
  proposition: string;
  persona: string;
  asked: Array<{ question: string; answer: string }>;
  skipped: string[];
  maxQuestions: number;
}): Promise<EngineResult<QuestionsOut>> {
  return ppClaude<QuestionsOut>({ system: FOLLOWUP_SYSTEM, promptId: 'brief-mind.followup', prompt: JSON.stringify(input, null, 1), task: 'brief-mind' });
}

export function runCollide(input: {
  proposition: string;
  persona: string;
  cards: Array<{ id: string; dimension: string; ar: string; en: string }>;
  visualWorld?: VisualAnswer[];
  mindNotes?: string[];
}): Promise<EngineResult<CollideOut>> {
  return import('../creativegraph/briefMindGraph').then(m => m.runCollisionGraph(input));
}

export function runPress(input: {
  proposition: string;
  persona: string;
  survivors: Array<{ seed: string; machine: string; idea: string }>;
  visualWorld?: VisualAnswer[];
}): Promise<EngineResult<TerritoryOut>> {
  return import('../creativegraph/briefMindGraph').then(m => m.runTerritoryGraph(input));
}
