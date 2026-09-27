import { nodeOf, type ProjectCreativeGraph } from './projectGraph';

export interface BenchmarkDimension {
  id: string;
  label: string;
  weight: number;
  judgeQuestion: string;
  failure: string;
}

/** The rubric deliberately rewards decisions that survive production, not
 * verbal polish. Weights total 100 and no dimension may hide another. */
export const BENCHMARK_DIMENSIONS: BenchmarkDimension[] = [
  { id: 'truth', label: 'Human truth', weight: 15, judgeQuestion: 'Does the work reveal a precise observed behavior rather than a demographic generalization?', failure: 'Generic insight that fits any brand.' },
  { id: 'causality', label: 'Brand causality', weight: 15, judgeQuestion: 'Does the product or brand cause the idea and the change, or merely appear inside it?', failure: 'Remove the logo and the concept still works unchanged.' },
  { id: 'distinct', label: 'Structural distinctiveness', weight: 15, judgeQuestion: 'Is the mechanism structurally ownable before palette, casting or copy?', failure: 'A familiar ad with a renamed mood.' },
  { id: 'proof', label: 'First-frame proof', weight: 15, judgeQuestion: 'Can the first frame prove the mechanism without explanatory copy?', failure: 'A beautiful frame that needs the deck to make sense.' },
  { id: 'culture', label: 'Cultural truth', weight: 15, judgeQuestion: 'Is Gulf/Saudi specificity behavioral and contemporary, without stock-Arab shorthand?', failure: 'Symbols, costume or locations substituting for lived truth.' },
  { id: 'craft', label: 'Craft specificity', weight: 10, judgeQuestion: 'Can director, DP, stylist and editor execute the choices without inventing missing law?', failure: 'Mood adjectives where a source, angle, action or material is required.' },
  { id: 'fidelity', label: 'Cross-tool fidelity', weight: 10, judgeQuestion: 'Do Story, Direction, Shotlist, Frame and Pitch preserve the signed mechanism without silent drift?', failure: 'Each tool writes a plausible but different campaign.' },
  { id: 'pitch', label: 'Client clarity', weight: 5, judgeQuestion: 'Can a client understand the choice, proof and risk quickly enough to approve it?', failure: 'Creative intelligence hidden by document performance.' },
];

export interface BenchmarkReadiness {
  ready: boolean;
  percent: number;
  blockers: string[];
  checks: Array<{ label: string; pass: boolean }>;
}

/** Readiness is not an output-quality score. It only answers whether the same
 * complete contract can be exported for a fair blind comparison. */
export function evaluateBenchmarkReadiness(graph: ProjectCreativeGraph): BenchmarkReadiness {
  const requiredContracts = ['contract:brief', 'contract:idea', 'contract:direction', 'contract:narrative'];
  const requiredProjections = ['projection:references', 'projection:cast', 'projection:wardrobe', 'projection:frame', 'projection:storyboard', 'projection:shotlist'];
  const checks = [
    ...requiredContracts.map(id => ({ label: `${id} exists`, pass: !!nodeOf(graph, id) })),
    { label: 'Idea contract is signed', pass: nodeOf(graph, 'contract:idea')?.status === 'signed' },
    { label: 'Direction contract is signed', pass: nodeOf(graph, 'contract:direction')?.status === 'signed' },
    { label: 'Narrative contract is signed', pass: nodeOf(graph, 'contract:narrative')?.status === 'signed' },
    ...requiredProjections.map(id => ({ label: `${id} is current`, pass: !!nodeOf(graph, id) && nodeOf(graph, id)?.status !== 'stale' })),
    { label: 'No stale consumer nodes', pass: !graph.nodes.some(node => ['projection', 'artifact'].includes(node.kind) && node.status === 'stale') },
    { label: 'At least one consumer trace exists', pass: graph.traces.length > 0 },
  ];
  const blockers = checks.filter(check => !check.pass).map(check => check.label);
  return { ready: blockers.length === 0, percent: Math.round((checks.length - blockers.length) / checks.length * 100), blockers, checks };
}

export interface BlindJudgePacket {
  caseId: string;
  brief: string;
  outputA: string;
  outputB: string;
}

export function buildBlindJudgePrompt(packet: BlindJudgePacket): string {
  const rubric = BENCHMARK_DIMENSIONS.map(d => `${d.id} (${d.weight}%): ${d.judgeQuestion}`).join('\n');
  return `You are an independent global creative-awards juror and production ECD. Compare two anonymous campaign systems against the same brief. Do not reward prose polish, length, or fashionable vocabulary. Judge the idea's causal mechanism and whether it survives execution.\n\nCASE: ${packet.caseId}\nBRIEF:\n${packet.brief}\n\nRUBRIC:\n${rubric}\n\nOUTPUT A:\n${packet.outputA}\n\nOUTPUT B:\n${packet.outputB}\n\nReturn JSON only: {"dimensions":[{"id":"truth","a":0,"b":0,"reason":"evidence in one sentence"}],"winner":"A|B|TIE","confidence":0.0,"fatalFlawA":"","fatalFlawB":""}. Score every dimension 0–5. A tie is valid. Never infer brand quality from formatting.`;
}

export interface BenchmarkVerdict { dimensions: Array<{ id: string; a: number; b: number }>; winner: 'A' | 'B' | 'TIE' }
export function weightedVerdictScore(verdict: BenchmarkVerdict, side: 'a' | 'b'): number {
  const byId = new Map(verdict.dimensions.map(item => [item.id, item]));
  return Math.round(BENCHMARK_DIMENSIONS.reduce((sum, dimension) => {
    const raw = Math.max(0, Math.min(5, byId.get(dimension.id)?.[side] ?? 0));
    return sum + (raw / 5) * dimension.weight;
  }, 0));
}

export const BENCHMARK_PASS = {
  minimumWeightedScore: 80,
  minimumDimensionScore: 3,
  minimumBlindWinRate: 0.60,
  minimumRealBriefs: 10,
} as const;
