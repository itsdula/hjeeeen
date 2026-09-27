// BREAKDOWN — the canonical 13-axis registry. ONE source of truth for the disc's
// outer ring. Any installed breakdown.json carries only the axes its factory run
// produced (Nike ships 11); the disc always renders these 13, matching data axes
// to a slug by title_en / key (tolerant), and rendering the rest as honest
// pending segments. Job files (per-axis, universal) and per-breakdown DNA files
// both key off these slugs. NOTHING here is Nike-specific.

export interface AxisDef {
  slug: string;   // stable — matches job_<slug>.md and dna/<slug>.gem.md
  en: string;     // canonical English disc label
  ar: string;     // fallback Arabic label (a breakdown's own title_ar wins when present)
}

/** Disc order (outer ring, clockwise from top). */
export const BREAKDOWN_AXES: AxisDef[] = [
  { slug: 'visuals',        en: 'Visuals',                  ar: 'البصريات' },
  { slug: 'wardrobe',       en: 'Wardrobe',                 ar: 'الأزياء' },
  { slug: 'characters',     en: 'Characters',               ar: 'الشخصيات' },
  { slug: 'action',         en: 'Action',                   ar: 'الحركة' },
  { slug: 'theme_look',     en: 'Theme & Look',             ar: 'الثيم واللوك' },
  { slug: 'cinematography', en: 'Cinematography',           ar: 'التصوير السينمائي' },
  { slug: 'grading_color',  en: 'Grading & Color',          ar: 'التدريج اللوني' },
  { slug: 'edit',           en: 'Edit',                     ar: 'المونتاج' },
  { slug: 'story',          en: 'Story',                    ar: 'القصة' },
  { slug: 'brief',          en: 'Brief',                    ar: 'البريف' },
  { slug: 'message',        en: 'Message',                  ar: 'الرسالة' },
  { slug: 'sound',          en: 'Music & Sound Design & VO', ar: 'الموسيقى والصوت والتعليق' },
  { slug: 'art_location',   en: 'Art Direction & Location', ar: 'الإخراج الفني والموقع' },
];

export const AXIS_SLUGS: string[] = BREAKDOWN_AXES.map(a => a.slug);

const norm = (s: string): string => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// alias(normalized) → slug. Built from canonical slug + en, plus the data
// variants breakdown.json is known to carry (hyphen keys, long axis titles).
const ALIAS: Record<string, string> = {};
for (const a of BREAKDOWN_AXES) {
  ALIAS[norm(a.slug)] = a.slug;   // 'theme_look' → 'themelook'
  ALIAS[norm(a.en)] = a.slug;     // 'Theme & Look' → 'themelook'
}
Object.assign(ALIAS, {
  theme: 'theme_look', themelook: 'theme_look', look: 'theme_look',
  grading: 'grading_color', grade: 'grading_color', color: 'grading_color', gradingcolour: 'grading_color',
  colorgrade: 'grading_color', colourgrade: 'grading_color',
  dop: 'cinematography', cinema: 'cinematography', photography: 'cinematography',
  editing: 'edit', montage: 'edit',
  music: 'sound', sounddesign: 'sound', vo: 'sound', voiceover: 'sound', audio: 'sound',
  musicsounddesignvo: 'sound', musicsoundvo: 'sound', soundvo: 'sound',
  art: 'art_location', artdirection: 'art_location', location: 'art_location',
  artlocation: 'art_location', artdirectionlocation: 'art_location', production: 'art_location',
});

/** Tolerant map from a data axis's title_en (or key, e.g. 'grading-color') to a
 *  canonical slug. Returns null when nothing sensible matches. */
export function matchAxisSlug(titleOrKey: string | undefined | null): string | null {
  const n = norm(titleOrKey || '');
  if (!n) return null;
  if (ALIAS[n]) return ALIAS[n];
  // last resort: any alias fully contained (handles 'gradingandcolorpalette' etc.)
  for (const key of Object.keys(ALIAS)) {
    if (key.length >= 5 && n.includes(key)) return ALIAS[key];
  }
  return null;
}

export function axisDef(slug: string): AxisDef | undefined {
  return BREAKDOWN_AXES.find(a => a.slug === slug);
}
