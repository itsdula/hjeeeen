import type { BriefMindExtras, StorySourceContract, TreatmentData } from '../../types/preprod';
import type { BriefData } from '../../types/hjen-bridge';

type BriefStage = BriefData & BriefMindExtras;

const text = (v: unknown): string => typeof v === 'string' ? v.trim() : '';
const texts = (v: unknown): string[] => Array.isArray(v) ? v.map(text).filter(Boolean) : [];

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !key.endsWith('UpdatedAt') && key !== 'updatedAt')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Small deterministic content fingerprint; not a security hash. */
export function sourceFingerprint(source: StorySourceContract): string {
  const input = stable(source);
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `story-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function compileStorySource(
  projectId: string,
  briefRaw: unknown,
  treatmentRaw: unknown,
): StorySourceContract {
  const brief = (briefRaw && typeof briefRaw === 'object' ? briefRaw : {}) as Partial<BriefStage>;
  const treatment = (treatmentRaw && typeof treatmentRaw === 'object' ? treatmentRaw : {}) as Partial<TreatmentData>;
  const territoryName = text(brief.bigIdea?.territory);
  const territory = (brief.territories ?? []).find(item => text(item.name) === territoryName)
    ?? (brief.territories ?? [])[0];
  const visualWorld = (brief.visualWorld ?? []).map(item => {
    const q = text(item.q) || text(item.questionId);
    const a = text(item.a) || text(item.optionId);
    return [q, a].filter(Boolean).join(': ');
  }).filter(Boolean);

  const contract: StorySourceContract = {
    projectId,
    brief: {
      proposition: text(brief.proposition), persona: text(brief.persona), intent: text(brief.oneLine),
      bigIdea: territoryName, why: text(brief.bigIdea?.why), insight: text(territory?.insight),
      culturalTruth: text(territory?.culturalTruth), firstFrameHint: text(territory?.firstFrameHint),
      refusals: texts(brief.refusals), visualWorld,
    },
    treatment: {
      approach: text(treatment.approach), love: text(treatment.ideaStance?.love),
      expand: text(treatment.ideaStance?.expand), keep: text(treatment.ideaStance?.keep),
      choicePairs: treatment.visuals?.choicePairs ?? {}, firstFrame: text(treatment.firstFrame),
      lastFrame: text(treatment.lastFrame), wardrobe: text(treatment.wardrobe?.pieces),
      wardrobeNegatives: texts(treatment.wardrobe?.negatives), edit: text(treatment.post?.edit),
      grade: text(treatment.post?.grade),
    },
    upstream: {
      briefUpdatedAt: text((brief as any).updatedAt),
      treatmentUpdatedAt: text((treatment as any).updatedAt),
    },
    missing: [],
  };
  if (!contract.brief.proposition) contract.missing.push('Brief Mind proposition');
  if (!contract.brief.persona) contract.missing.push('Brief Mind persona');
  if (!contract.brief.bigIdea) contract.missing.push('signed Big Idea');
  if (!contract.brief.insight) contract.missing.push('Big Idea insight');
  if (!contract.brief.culturalTruth) contract.missing.push('cultural truth');
  if (!contract.treatment.approach) contract.missing.push('Treatment approach');
  if (Object.values(contract.treatment.choicePairs).filter(v => text(v)).length < 6) contract.missing.push('six Treatment decisions');
  return contract;
}

export function sourcePrompt(source: StorySourceContract | undefined): string {
  if (!source) return '(No upstream source contract is attached.)';
  return JSON.stringify(source, null, 1);
}

