import { emptyProjectCreativeGraph, type ProjectCreativeGraph } from './projectGraph';

const DOC_NAME = 'creative_graph';

function valid(value: unknown, projectId: string): value is ProjectCreativeGraph {
  if (!value || typeof value !== 'object') return false;
  const graph = value as Partial<ProjectCreativeGraph>;
  return graph.schemaVersion === 1 && graph.projectId === projectId && Array.isArray(graph.nodes) && Array.isArray(graph.edges);
}

export async function loadProjectCreativeGraph(projectId: string): Promise<ProjectCreativeGraph> {
  const raw = await window.hjen.projectDocRead({ id: projectId, name: DOC_NAME }).catch(() => null);
  return valid(raw, projectId) ? raw : emptyProjectCreativeGraph(projectId);
}

export async function saveProjectCreativeGraph(graph: ProjectCreativeGraph): Promise<boolean> {
  const result = await window.hjen.projectDocWrite({ id: graph.projectId, name: DOC_NAME, data: graph }).catch(() => ({ ok: false }));
  return result.ok;
}

