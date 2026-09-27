import { nodeOf, type ProjectCreativeGraph } from './projectGraph';

export interface CreativeQualityReport {
  score: number;
  contractFidelity: number;
  stale: string[];
  missing: string[];
  orphaned: string[];
  checks: Array<{ id: string; pass: boolean; note: string }>;
}

export function evaluateCreativeGraph(graph: ProjectCreativeGraph): CreativeQualityReport {
  const required = ['contract:brief', 'contract:idea', 'contract:narrative', 'contract:direction'];
  const missing = required.filter(id => !nodeOf(graph, id));
  const stale = graph.nodes.filter(node => node.status === 'stale').map(node => node.id);
  const orphaned = graph.nodes
    .filter(node => node.kind === 'artifact' || node.kind === 'projection')
    .filter(node => !graph.edges.some(edge => edge.to === node.id)).map(node => node.id);
  const idea = nodeOf<Record<string, any>>(graph, 'contract:idea')?.payload;
  const narrative = nodeOf<Record<string, any>>(graph, 'contract:narrative')?.payload;
  const direction = nodeOf<Record<string, any>>(graph, 'contract:direction')?.payload;
  const checks = [
    { id: 'brief', pass: !missing.includes('contract:brief'), note: 'Brief Contract exists.' },
    { id: 'idea', pass: !!idea?.territory && !!idea?.insight, note: 'Idea has a named territory and insight.' },
    { id: 'brand', pass: !!idea?.proposition && !!idea?.hook, note: 'Idea remains causally attached to the proposition.' },
    { id: 'proof', pass: !!idea?.firstFrameProof || !!direction?.firstFrame, note: 'The idea has first-frame proof.' },
    { id: 'story', pass: !!narrative?.beats?.length && !!narrative?.compass, note: 'Narrative carries beats and a compass.' },
    { id: 'direction', pass: Object.values(direction?.choicePairs ?? {}).filter(Boolean).length >= 6, note: 'Six visual decisions are locked.' },
    { id: 'fresh', pass: stale.length === 0, note: 'No downstream contract is stale.' },
    { id: 'provenance', pass: graph.nodes.every(node => node.provenance.length > 0), note: 'Every node has provenance.' },
    { id: 'orphaned', pass: orphaned.length === 0, note: 'Every delivery node is linked to a source.' },
  ];
  const score = Math.round((checks.filter(check => check.pass).length / checks.length) * 100);
  const consumers = graph.nodes.filter(node => node.kind === 'artifact' || node.kind === 'projection');
  const faithful = consumers.filter(node => node.status !== 'stale' && graph.edges.some(edge => edge.to === node.id));
  const contractFidelity = consumers.length ? Math.round((faithful.length / consumers.length) * 100) : 0;
  return { score, contractFidelity, stale, missing, orphaned, checks };
}

