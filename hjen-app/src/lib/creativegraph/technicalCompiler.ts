import { nodeOf, type ProjectCreativeGraph } from './projectGraph';

type Dict = Record<string, any>;
const clean = (v: unknown): string => typeof v === 'string' ? v.trim() : '';
const compact = (values: unknown[]): string[] => values.map(clean).filter(Boolean);

export interface ReferenceProjection {
  northStar: string;
  intents: Array<{ purpose: string; querySeed: string; take: string; leave: string }>;
  refusals: string[];
}
export interface CastProjection { persona: string; archetype: string; performance: string; negatives: string[] }
export interface WardrobeProjection { character: string; direction: string; palette: string; negatives: string[] }
export interface FrameProjection { ideaProof: string; firstFrame: string; lastFrame: string; visualLaws: string[]; refusals: string[] }
export interface StoryboardProjection { compass: string; emotionalQuestion: string; visualLaws: string[]; continuity: string[]; refusals: string[] }
export interface ShotlistProjection { priorities: string[]; lightLaw: string; movementLaw: string; aspectLaw: string; cannotLose: string }
export interface TechnicalProjections {
  references: ReferenceProjection; cast: CastProjection; wardrobe: WardrobeProjection;
  frame: FrameProjection; storyboard: StoryboardProjection; shotlist: ShotlistProjection;
}

export function compileTechnicalProjections(graph: ProjectCreativeGraph): TechnicalProjections {
  const brief = (nodeOf<Dict>(graph, 'contract:brief')?.payload ?? {}) as Dict;
  const idea = (nodeOf<Dict>(graph, 'contract:idea')?.payload ?? {}) as Dict;
  const direction = (nodeOf<Dict>(graph, 'contract:direction')?.payload ?? {}) as Dict;
  const narrative = (nodeOf<Dict>(graph, 'contract:narrative')?.payload ?? {}) as Dict;
  const cp = (direction.choicePairs ?? {}) as Dict;
  const refusals = Array.isArray(brief.refusals) ? brief.refusals.map(clean).filter(Boolean) : [];
  const visualLaws = compact([cp.aspect, cp.lens, cp.lightDirection, cp.cameraMove, cp.hour, cp.placeRegister]);
  const truth = clean(idea.culturalTruth);
  const persona = clean(idea.persona) || clean(brief.persona);
  const proof = clean(idea.firstFrameProof) || clean(direction.firstFrame);
  const mechanism = clean(idea.hook) || clean(idea.territory);
  const beats = Array.isArray(narrative.beats) ? narrative.beats : [];

  const intents: ReferenceProjection['intents'] = [];
  const pushIntent = (purpose: string, querySeed: string, take: string, leave: string) => {
    if (querySeed && !intents.some(item => item.querySeed === querySeed)) intents.push({ purpose, querySeed, take, leave });
  };
  pushIntent('Prove the human truth', compact([persona, truth]).join(' '), `Observed behavior and the named truth: ${truth}`, 'Casting poses or generic cultural symbolism.');
  pushIntent('Lock the first-frame mechanism', proof, `Composition that proves: ${mechanism}`, 'A pretty frame that needs copy to explain the idea.');
  pushIntent('Lock camera and distance', compact([cp.lens, cp.aspect, cp.cameraMove]).join(' '), visualLaws.join(' · '), 'Contradictory camera grammar or spectacle without point of view.');
  pushIntent('Lock light and place', compact([cp.hour, cp.lightDirection, cp.placeRegister]).join(' '), compact([cp.hour, cp.lightDirection, cp.placeRegister]).join(' · '), 'Imported location glamour or brand-blue sky treatment.');

  return {
    references: { northStar: clean(idea.territory), intents, refusals },
    cast: {
      persona, archetype: persona,
      performance: compact([clean(idea.insight), clean(narrative.emotionalQuestion)]).join(' · '),
      negatives: [...refusals, 'Result-directed smiling', 'Stock-Arab casting shorthand'],
    },
    wardrobe: {
      character: persona, direction: clean(direction.wardrobe?.pieces),
      palette: compact([cp.hour, cp.lightDirection]).join(' · '),
      negatives: [...(Array.isArray(direction.wardrobe?.negatives) ? direction.wardrobe.negatives : []), ...refusals],
    },
    frame: {
      ideaProof: mechanism, firstFrame: clean(direction.firstFrame) || proof,
      lastFrame: clean(direction.lastFrame), visualLaws, refusals,
    },
    storyboard: {
      compass: clean(narrative.compass), emotionalQuestion: clean(narrative.emotionalQuestion),
      visualLaws, continuity: beats.map((beat: Dict) => `${clean(beat.beat)}: ${clean(beat.visualMetaphor)}`).filter((line: string) => line !== ': '),
      refusals,
    },
    shotlist: {
      priorities: beats.map((beat: Dict) => `${clean(beat.beat)} — ${clean(beat.line)}`).filter((line: string) => !line.endsWith('— ')),
      lightLaw: clean(cp.lightDirection), movementLaw: clean(cp.cameraMove), aspectLaw: clean(cp.aspect), cannotLose: proof,
    },
  };
}

export function projectionPrompt(value: unknown): string {
  return JSON.stringify(value, null, 1);
}

