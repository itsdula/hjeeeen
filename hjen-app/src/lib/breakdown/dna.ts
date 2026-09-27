// BREAKDOWN — DNA distillation (renderer orchestration).
//
// Problem this solves: the disc's DNA ring showed PENDING forever because
// nothing produced the per-axis dna/<slug>.gem.md files. This module MAKES them
// — one five-segment Gem per craft axis, distilled from THAT run's own findings
// + reproduction prompt + captions. Every DNA answers ONE question: "how do I
// MAKE something NEW in this ad's language on this axis," and its instructions
// end in ONE paste-ready output clause.
//
// It runs in the renderer (like run.ts) so every LLM call routes through the
// registry + hjen:llm-json gate (house LLM law: name a TASK, not a model — here
// the `breakdown-dna` task). The 13 axes are grouped into FOUR calls clustering
// related craft so wall-time stays sane; each call is parsed per-axis and each
// axis is written the moment it lands (LIVE the instant it exists on disk).
//
// Two callers feed it the SAME normalized input: the live run (from RunState) and
// the retro "MAKE THE DNAS" action (from a stored breakdown.json). Nothing here
// is Nike-specific — the orders are per-axis and universal; the CONTENT is 100%
// this ad's own measured evidence.

import { llmForTask } from '../models/registry';
import { axisDef, matchAxisSlug } from './axes';
import type { AdBreakdown } from '../creativemind/breakdown';

// ─── normalized input (both callers build this) ──────────────────────────────
export interface DnaFinding {
  claim_en: string;
  how?: string;               // how_hjen_makes_it — the concrete control
  weight?: number;            // 3 = law · 2 = pattern · 1 = flavour
  frames: string[];           // evidence frame ids (fNNN)
  tags?: string[];
}
export interface DnaAxisInput {
  slug: string;
  findings: DnaFinding[];
  reproductionPrompt?: string;
  summary?: string;
  heroFrameIds: string[];
}
export interface DnaStageInput {
  slug: string;
  ad: { title: string; brand: string; year?: string; durationS?: number };
  captions: string;
  axes: DnaAxisInput[];               // PRESENT axes only (those carrying findings)
  frameAbs: (id: string) => string | undefined;
  skip?: Set<string>;                 // axes already made (resume / already LIVE)
}

export type DnaEvent =
  | { type: 'dna-cluster'; id: string; label: string; axes: string[] }
  | { type: 'dna-axis'; slug: string }
  | { type: 'dna-error'; cluster: string; message: string };

export interface DnaStageResult { ok: boolean; made: string[]; message?: string }

// ─── the four clusters — 13 axes, related craft grouped ──────────────────────
export interface DnaCluster { id: string; label: string; axes: string[] }
export const DNA_CLUSTERS: DnaCluster[] = [
  { id: 'look',  label: 'THE LOOK — visuals · theme & look · grade',        axes: ['visuals', 'theme_look', 'grading_color'] },
  { id: 'frame', label: 'THE FRAME — camera · edit · art & location',        axes: ['cinematography', 'edit', 'art_location'] },
  { id: 'people', label: 'THE PEOPLE — wardrobe · characters · action',      axes: ['wardrobe', 'characters', 'action'] },
  { id: 'tell',  label: 'THE TELLING — story · brief · message · sound',     axes: ['story', 'brief', 'message', 'sound'] },
];

// ─── the per-axis DNA orders (Anwar-approved content law) ────────────────────
// make  = the MAKE-side question this DNA teaches the user to answer;
// law   = the specific machinery <context>/<constraints> must carry;
// output = the ONE paste-ready clause every <instructions> workflow must end in.
interface DnaOrder { make: string; law: string; output: string }
export const DNA_ORDERS: Record<string, DnaOrder> = {
  visuals:        { make: 'frame a NEW shot in this ad’s compositional language',      law: 'the placement law, the negative-space band, the figure-scale ratio, the recurring motifs', output: 'a framing clause ready to paste into any frame prompt' },
  wardrobe:       { make: 'dress a NEW character in this ad’s wardrobe language',        law: 'a piece-list template with explicit negatives against cultural and generator drift', output: 'a wardrobe clause per character' },
  characters:     { make: 'cast a NEW face into this ad’s world',                        law: 'an archetype-with-a-life card — age band, register, resting face, what they carry', output: 'a casting description' },
  action:         { make: 'direct NEW performance in this ad’s physical language',       law: 'the verb vocabulary, the effort ceiling, the stillness law', output: 'a performance clause' },
  theme_look:     { make: 'lock the look of a NEW frame to this ad',                          law: 'the one lookPhrase, the era/texture register, and five refusals', output: 'a look-lock clause that goes into EVERY prompt' },
  cinematography: { make: 'shoot a NEW setup in this ad’s camera language',              law: 'the lens bands, the camera height/angle law, the movement triggers, the light architecture per setup', output: 'a camera+light clause' },
  grading_color:  { make: 'grade a NEW frame into this ad’s color family',               law: 'the hex ramps (from this run’s sampled values), the contrast spine, the skin-protection strategy, the saturation law', output: 'a grade clause' },
  edit:           { make: 'cut a NEW sequence at this ad’s pace',                         law: 'the cut-length numbers per beat, the transition grammar, the VO-sync rule', output: 'a pacing spec for storyboard / video making' },
  story:          { make: 'write a NEW story in this ad’s storytelling language',         law: 'the want-but-until engine, the single emotional question, the beat engine', output: 'a new story spine in this ad’s language' },
  brief:          { make: 'shape a NEW brief that would yield this kind of film',             law: 'the proposition shape, the persona shape, the mandatories', output: 'a brief skeleton' },
  message:        { make: 'write NEW copy and claims in this ad’s voice',                 law: 'the under-claim pattern, the brand-entry rule, the end-frame convention', output: 'copy / claim rules' },
  sound:          { make: 'direct sound and write VO for a NEW spot in this ad’s sonic language', law: 'the VO-ladder pattern, the score curve, the foley register, the ending sound', output: 'sound direction + VO writing rules' },
  art_location:   { make: 'build a NEW world / location in this ad’s language',           law: 'the location register, the surface truth, the prop economy', output: 'a world / location clause' },
};

// ─── the raw five-segment JSON a cluster call returns per axis ───────────────
interface DnaSeg {
  title?: string; sourceLine?: string;
  role?: string; context?: string; instructions?: string; constraints?: string; examples?: string;
}

const clamp = (s: any): string => String(s ?? '').trim();

function parseJsonLoose(text: string): any {
  const t = (text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(t); } catch { /* slice */ }
  const m = t.match(/[{[][\s\S]*[}\]]/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
  throw new Error('model did not return valid JSON');
}

/** cluster hero frames → absolute image paths (hero ids first, then weight-3
 *  finding frames), deduped and capped so a call stays light. */
function clusterImages(axes: DnaAxisInput[], frameAbs: (id: string) => string | undefined, cap: number): string[] {
  const ids: string[] = [];
  const push = (id: string) => { if (id && !ids.includes(id)) ids.push(id); };
  for (const ax of axes) for (const id of ax.heroFrameIds) push(id);
  for (const ax of axes) for (const f of ax.findings) if ((f.weight ?? 0) >= 3) for (const id of f.frames) push(id);
  for (const ax of axes) for (const f of ax.findings) for (const id of f.frames) push(id);
  return ids.slice(0, cap).map(frameAbs).filter((p): p is string => !!p);
}

function axisEvidence(ax: DnaAxisInput): { laws: number; frames: number } {
  const fr = new Set<string>();
  let laws = 0;
  for (const f of ax.findings) { if ((f.weight ?? 0) >= 3) laws++; for (const id of f.frames) fr.add(id); }
  return { laws, frames: fr.size };
}

function axisBriefBlock(ax: DnaAxisInput): string {
  const def = axisDef(ax.slug);
  const order = DNA_ORDERS[ax.slug];
  const findings = [...ax.findings].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0)).slice(0, 10);
  const lines = findings.map(f =>
    `- [w${f.weight ?? 1}] ${clamp(f.claim_en)}${f.how ? `  ⟶ ${clamp(f.how)}` : ''}${f.frames?.length ? `  (${f.frames.join(', ')})` : ''}`
  );
  return [
    `══════ AXIS: ${ax.slug} (${def?.en || ax.slug}) — DNA order ══════`,
    `MAKE-SIDE PURPOSE: teach the user to ${order?.make || 'make new work in this ad’s language'}.`,
    `THIS DNA MUST CARRY: ${order?.law || ''}.`,
    `EVERY <instructions> WORKFLOW ENDS IN ONE PASTE-READY OUTPUT: ${order?.output || 'one clause'}.`,
    ax.summary ? `AXIS THESIS (this ad): ${clamp(ax.summary)}` : '',
    ax.reproductionPrompt ? `THE MAKE-PROMPT (this axis, this ad — mine it for values):\n${clamp(ax.reproductionPrompt)}` : '',
    `FINDINGS (this ad’s measured evidence — weight-sorted; w3 = a LAW):`,
    lines.join('\n') || '- (no findings)',
  ].filter(Boolean).join('\n');
}

const DNA_SYSTEM = `You are HJEN BREAKDOWN’s DNA distiller — the specialist who turns one ad’s measured craft findings into a reusable MAKE-side Gem per axis. You author five-segment Gems (role · context · instructions · constraints · examples) at the standard of a flagship studio’s internal system prompt. House vocabulary law: NEVER use the words generate / generating / generation — use MAKE / MADE / FRAME / TAKE / REFINE. Any Arabic is living Saudi-register prose, never machine-Arabic, never letter-spaced. You work ONLY from the evidence you are given; you never invent a frame id, a hex value, a lens, or a cut length that the findings do not support. Return STRICT JSON only, no code fences.`;

function clusterPrompt(cluster: DnaCluster, axes: DnaAxisInput[], input: DnaStageInput): string {
  const ad = input.ad;
  const adLine = `${ad.brand ? ad.brand + ' — ' : ''}${ad.title}${ad.year ? ` (${ad.year})` : ''} · duration ${ad.durationS ?? '?'}s`;
  const blocks = axes.map(axisBriefBlock).join('\n\n');
  const contract = axes.map(ax => {
    const def = axisDef(ax.slug);
    return `  "${ax.slug}": {
    "title": "${(def?.en || ax.slug).toUpperCase()}",
    "sourceLine": "one line, e.g. '${ax.findings.length} findings (${axisEvidence(ax).laws} laws) · ${axisEvidence(ax).frames} evidence frames'",
    "role": "…", "context": "…", "instructions": "…", "constraints": "…", "examples": "…"
  }`;
  }).join(',\n');

  return `GOVERNING PREMISE — non-negotiable: this ad is read as a finished AI-MADE film produced through HJEN Studio (image models MAKE first-frame plates, video models MAKE the moving shots, all controlled by written frame descriptions, look-locks and reference frames). Every DNA is a HJEN control system, never a shoot report.

AD: ${adLine}
VO / CAPTIONS: ${input.captions || 'none'}

Author the DNA Gem for EACH axis below — ${axes.map(a => a.slug).join(', ')} — 100% from THAT axis’s own findings + make-prompt below. Each Gem is a MAKE-side specialist soaked in THIS ad’s DNA on that one axis, and it must teach a user to MAKE something NEW in this ad’s language on that axis — ending every workflow in the ONE paste-ready output named in that axis’s order.

${blocks}

─── THE FIVE SEGMENTS (author each, per axis) ───
• role — a MAKE-side specialist steeped in THIS ad’s DNA on this axis (a colorist for THIS grade, a caster for THIS world, a writer for THIS story-engine). Concrete, opinionated, citing this ad’s evidence frames inline (fNNN). ~180–260 words.
• context — the philosophy of this axis in this ad + the MEASURED machine parameters lifted from the findings (sampled hex ramps, lens bands, cut-length numbers, effort ceilings, piece lists — whatever this axis measured). Where numbers exist, put them in a fenced MACHINE PARAMETERS block. ~180–300 words.
• instructions — a numbered workflow that turns a user’s NEW scenario into this axis’s paste-ready output. The FINAL step must produce exactly ONE ${DNA_ORDERS[axes[0].slug]?.output || 'clause'}-style output (per this axis’s order). Reference the <examples> as the register.
• constraints — THIS run’s weight-3 findings only, each rewritten as an imperative MUST/REFUSE law, and each ending with its evidence frames in parentheses (fNNN, fNNN). No law without its frames. If an axis has fewer than three w3 findings, promote its strongest w2 patterns and say so.
• examples — 3–4 master prompts each DERIVED from a real evidence frame of THIS ad (label each with its source frame id), PLUS exactly 1 more applied to a hypothetical NEW scenario (label it "New scenario"). Every example ends in this axis’s paste-ready output.

Return STRICT JSON only, no code fences:
{
${contract}
}
Rules: cite ONLY frame ids that appear in the findings above. Never write the words generate/generating/generation. Keep every value honest — "unknown" beats invention. Arabic (if any) stays living Saudi-register.`;
}

// ─── assemble the canonical .gem.md from parsed segments ─────────────────────
function assembleGem(ax: DnaAxisInput, seg: DnaSeg, input: DnaStageInput): string {
  const def = axisDef(ax.slug);
  const ev = axisEvidence(ax);
  const ad = input.ad;
  const title = clamp(seg.title) || (def?.en || ax.slug).toUpperCase();
  const source = clamp(seg.sourceLine) || `${ax.findings.length} findings (${ev.laws} laws) · ${ev.frames} evidence frames`;
  const header = [
    `# DNA — ${title} · ${ad.brand ? ad.brand + ' ' : ''}"${ad.title}"${ad.year ? ` (${ad.year})` : ''}`,
    ``,
    `**Source:** ${source} · job_${ax.slug} · MADE-side DNA (distilled in the run)`,
    `**Id:** \`bd-${input.slug}/dna/${ax.slug}\``,
  ].join('\n');
  const body = (k: keyof DnaSeg): string => clamp(seg[k]);
  return [
    header,
    ``,
    `<role>`, body('role'),
    ``,
    `<context>`, body('context'),
    ``,
    `<instructions>`, body('instructions'),
    ``,
    `<constraints>`, body('constraints'),
    ``,
    `<examples>`, body('examples'),
    ``,
  ].join('\n');
}

async function runDnaCluster(cluster: DnaCluster, axes: DnaAxisInput[], input: DnaStageInput): Promise<Record<string, DnaSeg>> {
  const imagePaths = clusterImages(axes, input.frameAbs, 8);
  const res = await llmForTask('breakdown-dna', {
    system: DNA_SYSTEM,
    prompt: clusterPrompt(cluster, axes, input),
    // headroom for up to 4 full five-segment Gems in one response — too low
    // truncates the JSON and loses the whole cluster (the "tell" 4-axis case).
    maxTokens: 28000,
    imagePaths: imagePaths.length ? imagePaths : undefined,
  });
  if (!res.ok || !res.text) throw new Error(res.message || res.reason || 'DNA call failed');
  const parsed = parseJsonLoose(res.text);
  const out: Record<string, DnaSeg> = {};
  for (const ax of axes) if (parsed[ax.slug]) out[ax.slug] = parsed[ax.slug];
  if (!Object.keys(out).length) throw new Error(`model returned none of: ${axes.map(a => a.slug).join(', ')}`);
  return out;
}

// ─── the stage — clusters run IN PARALLEL (each independent), writing each axis
// the moment it lands. The 4 cluster calls were the run's slowest stretch when
// sequential (~3 min each); concurrently the whole stage is ~one call's wall-time.
// Each call still gets llmForTask's transient-retry; a cluster that fails leaves
// its axes missing (resumable) without blocking the others.
export async function runDnaStage(
  input: DnaStageInput,
  emit: (ev: DnaEvent) => void,
  cancelled: () => boolean,
): Promise<DnaStageResult> {
  const made: string[] = [];
  const skip = input.skip ?? new Set<string>();
  const present = new Map(input.axes.map(a => [a.slug, a]));
  const missing: string[] = [];

  const jobs = DNA_CLUSTERS
    .map(cluster => ({ cluster, axes: cluster.axes.map(s => present.get(s)).filter((a): a is DnaAxisInput => !!a && !skip.has(a.slug)) }))
    .filter(j => j.axes.length);

  const valid = (seg?: DnaSeg): boolean => !!seg && !!clamp(seg.role) && !!clamp(seg.instructions);
  await Promise.all(jobs.map(async ({ cluster, axes }) => {
    if (cancelled()) return;
    emit({ type: 'dna-cluster', id: cluster.id, label: cluster.label, axes: axes.map(a => a.slug) });
    let segs: Record<string, DnaSeg> = {};
    try { segs = await runDnaCluster(cluster, axes, input); }
    catch (e: any) { emit({ type: 'dna-error', cluster: cluster.id, message: String(e?.message || e) }); }
    // DEGRADE: any axis the multi-axis call dropped (truncation/parse) is retried
    // ALONE — a single Gem is small + reliable. Mirrors the master stage's
    // batch→single-shot fallback, so one big cluster never loses all its axes.
    const need = axes.filter(a => !valid(segs[a.slug]));
    for (const ax of need) {
      if (cancelled()) break;
      try { const one = await runDnaCluster(cluster, [ax], input); if (valid(one[ax.slug])) segs[ax.slug] = one[ax.slug]; }
      catch { /* leave missing — resumable */ }
    }
    for (const ax of axes) {
      if (!valid(segs[ax.slug])) { missing.push(ax.slug); continue; }
      const text = assembleGem(ax, segs[ax.slug], input);
      try {
        const w = await window.hjen.mindBreakdownDnaWrite({ slug: input.slug, axis: ax.slug, text });
        if (w?.ok) { made.push(ax.slug); emit({ type: 'dna-axis', slug: ax.slug }); }
        else missing.push(ax.slug);
      } catch { missing.push(ax.slug); }
    }
  }));

  if (cancelled()) return { ok: false, made, message: 'cancelled' };
  if (missing.length) return { ok: false, made, message: `dna: incomplete for ${missing.join(', ')} — retry to finish` };
  return { ok: true, made };
}

// ─── retro normalizer — build DnaStageInput from a stored breakdown.json ──────
// Used by the "MAKE THE DNAS" action on an already-run breakdown: no re-ingest,
// no re-analysis — the stored findings + reproduction prompts ARE the evidence.
export function dnaInputFromBreakdown(bd: AdBreakdown): DnaStageInput {
  const frameFile = new Map<string, string>();
  for (const f of Array.isArray(bd.frames) ? bd.frames : []) if (f?.id && f?.file) frameFile.set(f.id, f.file);

  // captions proxy — the run doesn't persist the source VO, so reconstruct a
  // usable copy signal from the reversed pipeline (proposition + beat VO).
  const pl = bd.pipeline as any;
  const cap = [
    clamp(pl?.brief?.proposition),
    ...(Array.isArray(pl?.beats) ? pl.beats.map((b: any) => clamp(b?.vo)) : []),
  ].filter(Boolean).join(' · ');

  const axes: DnaAxisInput[] = [];
  for (const ax of Array.isArray(bd.axes) ? bd.axes : []) {
    const slug = matchAxisSlug((ax as any).title_en) || matchAxisSlug((ax as any).key);
    if (!slug) continue;
    const findings: DnaFinding[] = (Array.isArray(ax.findings) ? ax.findings : []).map(f => ({
      claim_en: clamp(f.claim_en),
      how: clamp((f as any).howHjenMakesIt) || undefined,
      weight: f.weight,
      frames: Array.isArray(f.frameIds) ? f.frameIds : [],
      tags: Array.isArray(f.tags) ? f.tags : undefined,
    })).filter(f => f.claim_en);
    if (!findings.length) continue;                     // present but empty → nothing to distill
    axes.push({
      slug, findings,
      reproductionPrompt: clamp((ax as any).reproductionPrompt) || undefined,
      summary: clamp(ax.summary) || undefined,
      heroFrameIds: Array.isArray(ax.heroFrameIds) ? ax.heroFrameIds : [],
    });
  }

  return {
    slug: bd.slug,
    ad: { title: bd.ad?.title || bd.slug, brand: bd.ad?.brand || '', year: bd.ad?.year, durationS: bd.ad?.durationS },
    captions: cap,
    axes,
    frameAbs: (id: string) => frameFile.get(id),
  };
}
