import { appendCreativeTrace, nodeOf, type CreativeNode, type ProjectCreativeGraph } from './projectGraph';
import { saveProjectCreativeGraph } from './repository';
import { syncStagesToCreativeGraph } from './stageSync';

export interface ProjectionRead<T> {
  graph: ProjectCreativeGraph;
  node?: CreativeNode<T>;
}

/** Read through the synchronizer so a consumer never sees a graph older than
 * the stage documents that still back existing HJEN projects. */
export async function readCreativeProjection<T>(projectId: string, name: string): Promise<ProjectionRead<T>> {
  const graph = await syncStagesToCreativeGraph(projectId);
  return { graph, node: nodeOf<T>(graph, `projection:${name}`) };
}

/** Record an explicit handoff. A trace answers the production question later:
 * "Which version of Direction actually reached this frame / cast / board?" */
export async function traceProjectionUse(
  read: ProjectionRead<unknown>,
  surface: string,
  action: string,
  notes: string[] = [],
): Promise<ProjectCreativeGraph> {
  if (!read.node) return read.graph;
  const next = appendCreativeTrace(read.graph, {
    surface,
    action,
    nodeIds: [read.node.id],
    notes: [`${read.node.id}@v${read.node.version}`, ...notes],
  });
  await saveProjectCreativeGraph(next);
  return next;
}
