// Shared kit for building pitch THEME layout presets. A "layout" is a preset
// that configures a page's fields (bgColor + element boxes/styles + extra
// image/text layers); the render engine draws whatever the page holds. Each
// theme lives in its own module and imports these helpers so presets stay
// consistent and mergeable.
import type { PitchPage, PitchExtraLayer } from '../types/preprod';

export interface PitchLayoutDef {
  id: string;
  name: string;
  themeId: string;
  apply: (page: PitchPage) => Partial<PitchPage>;
}
export interface PitchThemeDef { id: string; name: string; layouts: PitchLayoutDef[]; thumb?: string; }

let seq = 0;
export const eid = () => `Lx${(seq++).toString(36)}${Math.round(performance.now()).toString(36)}`;
export const imgLayer = (box: PitchExtraLayer['box'], imagePath?: string): PitchExtraLayer =>
  ({ id: eid(), kind: 'image', name: 'Image', box, imagePath, image: {} });
export const textLayer = (box: PitchExtraLayer['box'], text: string, style: PitchExtraLayer['style']): PitchExtraLayer =>
  ({ id: eid(), kind: 'text', name: 'Text', box, text, style });
export type { PitchPage };
