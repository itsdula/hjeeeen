/**
 * CreativeGraph is a small state-graph runner for reasoning workflows.
 *
 * It is deliberately separate from the visual Node canvas. The canvas moves
 * media values through a DAG; creative reasoning needs controlled loops,
 * conditional routing, an audit trail, and explicit stop conditions.
 */

export interface GraphStep<S> {
  node: string;
  startedAt: number;
  finishedAt: number;
  route: string | null;
  note?: string;
}

export interface GraphContext<S> {
  readonly signal?: AbortSignal;
  readonly history: ReadonlyArray<GraphStep<S>>;
  readonly visits: ReadonlyMap<string, number>;
  note(message: string): void;
}

export interface GraphNodeResult<S> {
  state: S;
  /** Route name. Omit to use the node's default route. */
  route?: string | null;
}

export interface GraphNode<S> {
  id: string;
  run(state: S, context: GraphContext<S>): Promise<GraphNodeResult<S>>;
  routes?: Record<string, string | null>;
  defaultRoute?: string | null;
}

export interface GraphRunResult<S> {
  state: S;
  history: GraphStep<S>[];
}

export interface GraphRunOptions<S> {
  start: string;
  nodes: GraphNode<S>[];
  initial: S;
  signal?: AbortSignal;
  /** Hard guard against accidental critic/repair loops. */
  maxSteps?: number;
  /** Optional immutable checkpoints for diagnostics or future resume. */
  checkpoint?: (state: S, step: GraphStep<S>) => void | Promise<void>;
}

export class CreativeGraphError extends Error {
  constructor(message: string, readonly node?: string) {
    super(message);
    this.name = 'CreativeGraphError';
  }
}

export async function runCreativeGraph<S>(options: GraphRunOptions<S>): Promise<GraphRunResult<S>> {
  const byId = new Map(options.nodes.map(node => [node.id, node]));
  if (byId.size !== options.nodes.length) throw new CreativeGraphError('Creative graph has duplicate node ids.');

  const maxSteps = Math.max(1, options.maxSteps ?? 24);
  const history: GraphStep<S>[] = [];
  const visits = new Map<string, number>();
  let state = options.initial;
  let cursor: string | null = options.start;

  while (cursor) {
    if (options.signal?.aborted) throw new DOMException('Creative graph cancelled.', 'AbortError');
    if (history.length >= maxSteps) throw new CreativeGraphError(`Creative graph exceeded ${maxSteps} steps.`, cursor);
    const node = byId.get(cursor);
    if (!node) throw new CreativeGraphError(`Unknown creative graph node "${cursor}".`, cursor);

    visits.set(cursor, (visits.get(cursor) ?? 0) + 1);
    let note: string | undefined;
    const startedAt = Date.now();
    const result = await node.run(state, {
      signal: options.signal,
      history,
      visits,
      note: message => { note = message; },
    });
    state = result.state;

    const route = result.route === undefined ? 'default' : result.route;
    const next = route === null
      ? null
      : (node.routes?.[route] ?? (route === 'default' ? node.defaultRoute : undefined));
    if (next === undefined) {
      throw new CreativeGraphError(`Node "${cursor}" returned unmapped route "${route}".`, cursor);
    }

    const step: GraphStep<S> = { node: cursor, startedAt, finishedAt: Date.now(), route, note };
    history.push(step);
    await options.checkpoint?.(state, step);
    cursor = next;
  }
  return { state, history };
}

