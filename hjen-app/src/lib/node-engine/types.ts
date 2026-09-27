// NODE engine — core type definitions.
//
// A native, framework-agnostic reimplementation of Griptape Nodes' execution
// model: every node type declares typed PARAMETERS (input / output / property)
// plus an async process() that does the work. Two flow types — `data` (pure,
// resolves the instant its inputs are satisfied) and `control` (async I/O —
// image/video generation). Results flow downstream as typed DataValues.
//
// This module imports ONLY types (erased at build), so it carries no runtime
// dependency on React, Zustand, or the store.

import type { Selections } from '../../types/catalog';
import type { Layer } from '../../store';

// ---- The typed values that travel along edges -----------------------------

export type DataType =
  | 'image'
  | 'video'
  | 'text'
  | 'number'
  | 'boolean'
  | 'selectionSet'   // a frozen DOP Selections snapshot
  | 'referenceSet'   // an ordered list of Layer references
  | 'any';           // wildcard (Output accepts anything)

export interface ImageValue {
  type: 'image';
  path?: string;     // absolute on-disk path (saved output / library pick)
  url?: string;      // in-memory data URL for preview
  b64?: string;      // raw base64 (needed by saveGeneration)
  width?: number;
  height?: number;
  mime?: string;
}
export interface VideoValue {
  type: 'video';
  path: string;
  posterPath?: string;
  ratio?: string;
  seconds?: number;
}
export interface TextValue { type: 'text'; text: string; }
export interface NumberValue { type: 'number'; value: number; }
export interface BooleanValue { type: 'boolean'; value: boolean; }
export interface SelectionSetValue { type: 'selectionSet'; selections: Selections; }
export interface ReferenceSetValue { type: 'referenceSet'; refs: Layer[]; }

export type DataValue =
  | ImageValue | VideoValue | TextValue | NumberValue
  | BooleanValue | SelectionSetValue | ReferenceSetValue;

// ---- Parameters + node specs ----------------------------------------------

export type ParamKind = 'input' | 'output' | 'property';

export interface Parameter {
  name: string;            // unique within the node — the param id used on edges
  label: string;
  kind: ParamKind;
  dataType: DataType;
  default?: unknown;       // property default / unconnected-input fallback
  optional?: boolean;      // input only: node may run without it
  control?: 'text' | 'textarea' | 'number' | 'toggle' | 'select' | 'asset' | 'catalog' | 'selections';
  catalogKind?: 'camera' | 'lens' | 'stock' | 'lighting' | 'angle' | 'movement';
  options?: Array<{ value: string; label: string }>;
  /** number control: render a range slider when min+max are present. */
  min?: number;
  max?: number;
  step?: number;
  /** May this property be driven by a Batch-matrix column? */
  batchable?: boolean;
}

export type FlowType = 'data' | 'control';

export interface NodeProcessCtx {
  inputs: Record<string, DataValue | undefined>;   // resolved input values
  props: Record<string, unknown>;                  // the instance's paramValues
  signal: AbortSignal;                             // control nodes honor this
  report: (status: string) => void;                // stream coarse progress
  project: { id: string; name: string; slug: string } | null;
}

// Keyed by output param name. Values may be absent (a node can legitimately
// emit nothing on an output, e.g. an unconfigured Source).
export type NodeProcessResult = Record<string, DataValue | undefined>;

export interface NodeSpec {
  type: string;            // registry key
  label: string;
  sub: string;
  accent: string;
  flow: FlowType;
  params: Parameter[];
  opens?: 'frame' | 'enhancer' | 'video';   // double-click routes to this view
  process: (ctx: NodeProcessCtx) => Promise<NodeProcessResult>;
}

// ---- Instances + edges (a saved graph) ------------------------------------

export type NodeStatus = 'idle' | 'queued' | 'running' | 'done' | 'error';

export interface NodeInstance {
  id: string;
  type: string;
  position: { x: number; y: number };
  /** User resize override (corner-drag). Absent → the type's default size. */
  size?: { w: number; h: number };
  paramValues: Record<string, unknown>;   // properties + unconnected-input overrides
  // ---- take-loop metadata (all optional; absent on legacy nodes) ----
  favorite?: boolean;                      // ★ marked keeper
  rejected?: boolean;                      // ✕ marked out
  colorLabel?: 1 | 2 | 3 | 4 | 5;          // colour tag (undefined = none)
  stackId?: string;                        // groups takes of one shot
  takeIndex?: number;                      // order within a stack (0 = original)
  name?: string;                           // inline rename (falls back to spec.label)
}

/** Edge carries source param + target param (not just node ids). */
export interface GraphEdge {
  id: string;
  from: { node: string; param: string };
  to: { node: string; param: string };
}

/** Per-node live execution state — kept OUT of the serialized GraphDoc. */
export interface NodeRuntime {
  status: NodeStatus;
  outputs?: NodeProcessResult;
  error?: string;
  statusText?: string;
  startedAt?: number;
  finishedAt?: number;
}

// ---- Serialization + batch (used by serialize.ts / later phases) ----------

export interface MatrixColumn { id: string; nodeId: string; paramKey: string; label: string; }
export interface MatrixRow { id: string; label?: string; overrides: Record<string, unknown>; }
export interface FrameMatrix { id: string; columns: MatrixColumn[]; rows: MatrixRow[]; }

export interface GraphDoc {
  schemaVersion: 2;
  id: string;
  name: string;
  nodes: NodeInstance[];
  edges: GraphEdge[];
  matrices: FrameMatrix[];
  view?: { pan: { x: number; y: number } };
  createdAt: string;
  updatedAt: string;
}
