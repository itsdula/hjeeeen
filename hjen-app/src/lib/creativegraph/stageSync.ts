import type { BriefMindExtras, ScreenplayData, TreatmentData } from '../../types/preprod';
import type { BriefData } from '../../types/hjen-bridge';
import { compileStorySource } from '../story/sourceContract';
import { connectCreativeNodes, setCreativeNodeStatus, upsertCreativeNode, type ProjectCreativeGraph } from './projectGraph';
import { loadProjectCreativeGraph, saveProjectCreativeGraph } from './repository';
import { compileTechnicalProjections } from './technicalCompiler';

type BriefStage = BriefData & BriefMindExtras;
const text = (v: unknown): string => typeof v === 'string' ? v.trim() : '';

/** Import legacy stage documents into semantic graph nodes. This is idempotent:
 * unchanged stage content does not create a new graph revision. */
export async function syncStagesToCreativeGraph(projectId: string): Promise<ProjectCreativeGraph> {
  const [briefRaw, treatmentRaw, storyRaw, projectState] = await Promise.all([
    window.hjen.readStageData({ id: projectId, stage: 1 }),
    window.hjen.readStageData({ id: projectId, stage: 4 }),
    window.hjen.readStageData({ id: projectId, stage: 5 }),
    window.hjen.readProjectState({ id: projectId }),
  ]);
  const brief = (briefRaw && typeof briefRaw === 'object' ? briefRaw : {}) as Partial<BriefStage>;
  const treatment = (treatmentRaw && typeof treatmentRaw === 'object' ? treatmentRaw : {}) as Partial<TreatmentData>;
  const story = (storyRaw && typeof storyRaw === 'object' ? storyRaw : {}) as Partial<ScreenplayData>;
  let graph = await loadProjectCreativeGraph(projectId);
  let dirty = false;
  const put = (input: Parameters<typeof upsertCreativeNode>[1]) => {
    const result = upsertCreativeNode(graph, input); graph = result.graph; dirty ||= result.changed;
  };
  const at = new Date().toISOString();

  put({ id: 'contract:brief', kind: 'decision', label: 'Brief Contract', status: 'draft',
    payload: {
      client: text(brief.client), proposition: text(brief.proposition), persona: text(brief.persona),
      intent: text(brief.oneLine), gaps: brief.gaps ?? [], assumptions: brief.questionsLog ?? [],
      refusals: brief.refusals ?? [], scope: brief.scope ?? {}, restatement: text(brief.restatement),
    }, provenance: { surface: 'Brief Mind', stage: 1, at, by: 'migration' } });

  const selectedName = text(brief.bigIdea?.territory);
  const territory = (brief.territories ?? []).find(item => text(item.name) === selectedName);
  if (selectedName || territory) {
    put({ id: 'contract:idea', kind: 'idea', label: 'Signed Idea Contract', status: 'approved',
      payload: {
        territory: selectedName, why: text(brief.bigIdea?.why), hook: text(territory?.hook),
        insight: text(territory?.insight), culturalTruth: text(territory?.culturalTruth),
        firstFrameProof: text(territory?.firstFrameHint), proposition: text(brief.proposition),
        persona: text(brief.persona), visualWorld: brief.visualWorld ?? [],
      }, provenance: { surface: 'Brief Mind', stage: 1, sourceNodeIds: ['contract:brief'], at, by: 'migration' } });
    graph = connectCreativeNodes(graph, 'contract:brief', 'contract:idea', 'derived-from');
  }

  if (Object.keys(treatment).length) {
    put({ id: 'contract:direction', kind: 'craft', label: 'Direction Contract', status: 'draft',
      payload: {
        approach: text(treatment.approach), ideaStance: treatment.ideaStance ?? {},
        choicePairs: treatment.visuals?.choicePairs ?? {}, firstFrame: text(treatment.firstFrame),
        lastFrame: text(treatment.lastFrame), wardrobe: treatment.wardrobe ?? {}, post: treatment.post ?? {},
      }, provenance: { surface: 'Direction', stage: 4, sourceNodeIds: ['contract:idea'], at, by: 'migration' } });
    graph = connectCreativeNodes(graph, 'contract:idea', 'contract:direction', 'constrained-by');
  }

  if (Object.keys(story).length && (story.beats?.length || story.blocks?.length || story.gate)) {
    put({ id: 'contract:narrative', kind: 'craft', label: 'Narrative Contract', status: 'draft',
      payload: {
        source: story.source ?? compileStorySource(projectId, brief, treatment), gate: story.gate ?? {},
        compass: text(story.compass), emotionalQuestion: text(story.emotionalQuestion),
        beats: story.beats ?? [], blocks: story.blocks ?? [], budget: story.budget, dialect: story.dialect,
      }, provenance: { surface: 'Story', stage: 5, sourceNodeIds: ['contract:idea', 'contract:direction'], at, by: 'migration' } });
    graph = connectCreativeNodes(graph, 'contract:idea', 'contract:narrative', 'derived-from');
    graph = connectCreativeNodes(graph, 'contract:direction', 'contract:narrative', 'constrained-by');
  }

  const stageStatus = (stage: 1 | 4 | 5, nodeIds: string[]) => {
    if (projectState?.stages?.[stage]?.status !== 'signed') return;
    for (const id of nodeIds) graph = setCreativeNodeStatus(graph, id, 'signed', projectState.stages[stage].signedAt);
  };
  stageStatus(1, ['contract:brief', 'contract:idea']);
  stageStatus(4, ['contract:direction']);
  stageStatus(5, ['contract:narrative']);

  const projections = compileTechnicalProjections(graph);
  for (const [name, payload] of Object.entries(projections)) {
    const id = `projection:${name}`;
    put({ id, kind: 'projection', label: `${name[0].toUpperCase()}${name.slice(1)} Handoff`, status: 'draft', payload,
      provenance: { surface: 'Technical Compiler', sourceNodeIds: ['contract:idea', 'contract:direction', 'contract:narrative'], at, by: 'graph' } });
    for (const source of ['contract:idea', 'contract:direction', 'contract:narrative']) {
      if (graph.nodes.some(node => node.id === source)) graph = connectCreativeNodes(graph, source, id, 'exports-to');
    }
  }

  const pitch = (treatment as TreatmentData & { pitch?: { pages?: unknown[]; manifestFingerprint?: string; graphRevision?: number } }).pitch;
  if (pitch?.pages?.length) {
    put({ id: 'artifact:pitch', kind: 'artifact', label: 'Client Pitch', status: 'draft',
      payload: { pages: pitch.pages, manifestFingerprint: pitch.manifestFingerprint, compiledFromRevision: pitch.graphRevision },
      provenance: { surface: 'Pitch', sourceNodeIds: ['contract:brief', 'contract:idea', 'contract:narrative', 'contract:direction'], at, by: 'graph' } });
    for (const source of ['contract:brief', 'contract:idea', 'contract:narrative', 'contract:direction']) {
      if (graph.nodes.some(node => node.id === source)) graph = connectCreativeNodes(graph, source, 'artifact:pitch', 'appears-in');
    }
  }

  if (dirty || graph.revision > 0) await saveProjectCreativeGraph(graph);
  return graph;
}
