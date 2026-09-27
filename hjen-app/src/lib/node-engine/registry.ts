// Node-type registry. Adding a new node type = one registerNode() call with
// typed params + an async process. The palette, port rendering, validation and
// execution all read from here — nothing is hardcoded to a fixed set of kinds.

import type { NodeSpec, ParamKind, Parameter } from './types';

const specs = new Map<string, NodeSpec>();

export function registerNode(spec: NodeSpec): void {
  if (specs.has(spec.type)) throw new Error(`Node type "${spec.type}" already registered`);
  specs.set(spec.type, spec);
}

export function getNodeSpec(type: string): NodeSpec | undefined {
  return specs.get(type);
}

export function allNodeSpecs(): NodeSpec[] {
  return [...specs.values()];
}

export function paramsByKind(spec: NodeSpec, kind: ParamKind): Parameter[] {
  return spec.params.filter(p => p.kind === kind);
}
