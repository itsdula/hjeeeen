// Registers all built-in HJEN product nodes into the registry. Idempotent.

import { registerNode } from '../registry';
import { makeSourceSpec } from './source';
import { makeFrameSpec } from './frame';
import { makeEnhancerSpec } from './enhancer';
import { makeVideoSpec } from './video';
import { makeOutputSpec } from './output';
import { makeTextSpec, makeBinSpec, makeVariableSpec, makeSetSpec, makeGroupSpec, makeFileSpec } from './canvas';
import { makeMindSpecs } from './mind';
import { makeBreakdownSpecs } from './breakdown';

let registered = false;

export function registerBuiltinNodes(): void {
  if (registered) return;
  registerNode(makeSourceSpec());
  registerNode(makeFrameSpec());
  registerNode(makeEnhancerSpec());
  registerNode(makeVideoSpec());
  registerNode(makeOutputSpec());
  registerNode(makeTextSpec());
  registerNode(makeBinSpec());
  registerNode(makeVariableSpec());
  registerNode(makeSetSpec());
  registerNode(makeGroupSpec());
  registerNode(makeFileSpec());
  for (const spec of makeMindSpecs()) registerNode(spec);   // لوحة التفكير
  for (const spec of makeBreakdownSpecs()) registerNode(spec);   // تشريح الإعلان 360
  registered = true;
}
