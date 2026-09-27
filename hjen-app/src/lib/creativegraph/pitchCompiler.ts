import type { PitchPage } from '../../types/preprod';
import { graphFingerprint, nodeOf, type ProjectCreativeGraph } from './projectGraph';
import { compileTechnicalProjections } from './technicalCompiler';

type Dict = Record<string, any>;
const t = (v: unknown): string => typeof v === 'string' ? v.trim() : '';

export interface PitchManifest {
  fingerprint: string;
  graphRevision: number;
  pages: PitchPage[];
  missing: string[];
}

export function compilePitchManifest(graph: ProjectCreativeGraph, projectName: string, preset: 8 | 25 | 50): PitchManifest {
  const briefNode = nodeOf<Dict>(graph, 'contract:brief');
  const ideaNode = nodeOf<Dict>(graph, 'contract:idea');
  const narrativeNode = nodeOf<Dict>(graph, 'contract:narrative');
  const directionNode = nodeOf<Dict>(graph, 'contract:direction');
  const brief = briefNode?.payload ?? {}, idea = ideaNode?.payload ?? {};
  const story = narrativeNode?.payload ?? {}, direction = directionNode?.payload ?? {};
  const projections = compileTechnicalProjections(graph);
  const versions = Object.fromEntries([briefNode, ideaNode, narrativeNode, directionNode].filter(Boolean).map(node => [node!.id, node!.version]));
  const page = (section: string, claim: string, text: string, imageSpec: string, sourceNodeIds: string[]): PitchPage => {
    const sourceVersions = Object.fromEntries(sourceNodeIds.map(id => [id, versions[id] ?? 0]));
    return { section, claim, text, imageSpec, sourceNodeIds, sourceVersions, sourceFingerprint: graphFingerprint({ sourceVersions, claim, text, imageSpec }) };
  };
  const pages: PitchPage[] = [
    page('COVER', 'The campaign promise', projectName, t(direction.firstFrame) || t(idea.firstFrameProof), ['contract:idea', 'contract:direction']),
    page('BRIEF', 'What we heard', t(brief.restatement) || t(brief.proposition), 'One image of the real human problem before the brand intervenes.', ['contract:brief']),
    page('HUMAN TRUTH', 'The behavior underneath the brief', [t(idea.persona), t(idea.insight), t(idea.culturalTruth)].filter(Boolean).join('\n'), projections.references.intents[0]?.querySeed || '', ['contract:brief', 'contract:idea']),
    page('BIG IDEA', t(idea.territory), [t(idea.hook), t(idea.why)].filter(Boolean).join('\n'), t(idea.firstFrameProof), ['contract:idea']),
    page('BRAND ROLE', 'Why this belongs to the brand', [t(brief.proposition), t(idea.hook)].filter(Boolean).join('\n'), 'The product causing the action — not a removable pack shot.', ['contract:brief', 'contract:idea']),
    page('FIRST FRAME', 'The image that proves the idea', t(direction.firstFrame) || t(idea.firstFrameProof), t(direction.firstFrame) || t(idea.firstFrameProof), ['contract:idea', 'contract:direction']),
    page('STORY', 'Want. Pressure. Change.', [t(story.compass), t(story.emotionalQuestion)].filter(Boolean).join('\n'), projections.storyboard.continuity.slice(0, 3).join(' · '), ['contract:idea', 'contract:narrative']),
    page('VISUAL SYSTEM', 'One visual law, carried through every frame', projections.frame.visualLaws.join('\n'), projections.references.intents[2]?.querySeed || '', ['contract:direction']),
    page('PEOPLE', 'The faces and performance that carry the idea', [projections.cast.archetype, projections.cast.performance].filter(Boolean).join('\n'), projections.cast.persona, ['contract:idea', 'contract:narrative']),
    page('WORLD', 'The place, wardrobe and truth objects', [t(direction.wardrobe?.pieces), t(direction.choicePairs?.placeRegister)].filter(Boolean).join('\n'), projections.references.intents[3]?.querySeed || '', ['contract:direction']),
    page('LAST FRAME', 'What the viewer carries out', t(direction.lastFrame), t(direction.lastFrame), ['contract:idea', 'contract:direction', 'contract:narrative']),
    page('CLOSE', 'What we are asking the room to sign', 'Big Idea · Story spine · Visual system · First and last frame', '', ['contract:idea', 'contract:narrative', 'contract:direction']),
  ].filter(item => item.section === 'COVER' || item.section === 'CLOSE' || item.text.trim() || item.imageSpec?.trim());

  const wanted = preset === 8 ? 8 : preset === 25 ? 12 : pages.length;
  const selected = pages.length <= wanted ? pages : [pages[0], ...pages.slice(1, wanted - 1), pages[pages.length - 1]];
  const missing: string[] = [];
  if (!briefNode) missing.push('Brief Contract');
  if (!ideaNode) missing.push('Signed Idea Contract');
  if (!narrativeNode) missing.push('Narrative Contract');
  if (!directionNode) missing.push('Direction Contract');
  const fingerprint = graphFingerprint({ pages: selected.map(item => ({ section: item.section, sourceFingerprint: item.sourceFingerprint })), preset });
  return { fingerprint, graphRevision: graph.revision, pages: selected, missing };
}

export function pitchPageIsStale(page: PitchPage, graph: ProjectCreativeGraph): boolean {
  if (!page.sourceVersions) return false;
  return Object.entries(page.sourceVersions).some(([id, version]) => nodeOf(graph, id)?.version !== version);
}
