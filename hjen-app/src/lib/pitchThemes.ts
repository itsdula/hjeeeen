// Pitch theme system — a theme is a set of page LAYOUTS. Because the render
// engine draws whatever boxes / colours / fonts / extra layers a page holds, a
// "layout" is just a preset that configures those fields. Applying one rewrites
// the page's arrangement (bgColor + layout boxes/styles + extra image/text
// layers) while preserving the page's CONTENT (section, title, body, image).
//
// SHIPPING THEME: equip only — "Cinematic Cream", forensically rebuilt from the
// Equip Foods reference (Gate 1–4, MEASURED boxes) and approved as theme #01.
// The other 8 studied themes were retired 2026-07-09 (Anwar's call); their DNA
// studies remain under STUDY/pitch_themes/NN_*/ for future re-authoring.
import type { PitchLayoutDef, PitchThemeDef } from './pitchLayoutKit';
import { equipLayouts } from './themes/equip';
import { dtaLayouts } from './themes/dta';
import equipThumb from '../assets/themes/equip.jpg';
import dtaThumb from '../assets/themes/dta.jpg';

export type { PitchLayoutDef, PitchThemeDef } from './pitchLayoutKit';

export const PITCH_THEMES: PitchThemeDef[] = [
  { id: 'equip', name: 'Cinematic Cream (Equip)', layouts: equipLayouts, thumb: equipThumb },
  { id: 'dta', name: 'Grain Athletics (DT-A)', layouts: dtaLayouts, thumb: dtaThumb },
];
export const ALL_LAYOUTS: PitchLayoutDef[] = PITCH_THEMES.flatMap(t => t.layouts);
export const findLayout = (id?: string) => ALL_LAYOUTS.find(l => l.id === id);
