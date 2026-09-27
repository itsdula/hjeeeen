// DataValue helpers — assignability + adapters from existing result shapes.

import type { DataType, ImageValue } from './types';
import type { GenerateResult } from '../openai';

/** Can a value of `from` flow into a port of `to`? */
export function isAssignable(from: DataType, to: DataType): boolean {
  if (to === 'any' || from === 'any') return true;
  return from === to;
}

/** Wrap a GenerateResult (from frameGen / openai) as an ImageValue. */
export function imageFromGenerateResult(r: GenerateResult, path?: string): ImageValue {
  const [w, h] = (r.size || '').split('x').map(Number);
  return {
    type: 'image',
    url: r.url,
    b64: r.b64,
    path,
    width: Number.isFinite(w) ? w : undefined,
    height: Number.isFinite(h) ? h : undefined,
    mime: 'image/png',
  };
}
