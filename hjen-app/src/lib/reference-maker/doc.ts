import { parseReferenceGraph, refreshGraph } from './graph';
import type { ReferenceProjectGraph } from './types';

const DOC_NAME = 'reference_maker_graph';
const writeQueues = new Map<string, Promise<boolean>>();

/** Project-local persistence through the existing guarded _project document bridge. */
export async function loadReferenceGraph(projectId: string): Promise<ReferenceProjectGraph | null> {
  try {
    const data = await window.hjen.projectDocRead({ id: projectId, name: DOC_NAME });
    return data ? parseReferenceGraph(JSON.stringify(data)) : null;
  } catch {
    return null;
  }
}

export async function saveReferenceGraph(projectId: string, graph: ReferenceProjectGraph): Promise<boolean> {
  // Understanding and Make may now finish on different scenes at nearly the
  // same time. Serialize document writes per project so a slower, older IPC
  // response can never land after a newer graph and erase its result.
  const persisted = refreshGraph(graph);
  const previous = writeQueues.get(projectId) ?? Promise.resolve(true);
  const next = previous.catch(() => false).then(async () => {
    try {
      const result = await window.hjen.projectDocWrite({ id: projectId, name: DOC_NAME, data: persisted });
      return Boolean(result?.ok);
    } catch {
      return false;
    }
  });
  writeQueues.set(projectId, next);
  void next.finally(() => {
    if (writeQueues.get(projectId) === next) writeQueues.delete(projectId);
  });
  return next;
}
