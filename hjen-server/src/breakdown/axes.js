// BREAKDOWN — canonical 13-axis registry (server port of app/src/lib/breakdown/axes.ts).
// Job files (job_<slug>.md) key off these slugs. Nothing here is ad-specific.
export const BREAKDOWN_AXES = [
  { slug: 'visuals',        en: 'Visuals',                   ar: 'البصريات' },
  { slug: 'wardrobe',       en: 'Wardrobe',                  ar: 'الأزياء' },
  { slug: 'characters',     en: 'Characters',                ar: 'الشخصيات' },
  { slug: 'action',         en: 'Action',                    ar: 'الحركة' },
  { slug: 'theme_look',     en: 'Theme & Look',              ar: 'الثيم واللوك' },
  { slug: 'cinematography', en: 'Cinematography',            ar: 'التصوير السينمائي' },
  { slug: 'grading_color',  en: 'Grading & Color',           ar: 'التدريج اللوني' },
  { slug: 'edit',           en: 'Edit',                      ar: 'المونتاج' },
  { slug: 'story',          en: 'Story',                     ar: 'القصة' },
  { slug: 'brief',          en: 'Brief',                     ar: 'البريف' },
  { slug: 'message',        en: 'Message',                   ar: 'الرسالة' },
  { slug: 'sound',          en: 'Music & Sound Design & VO',  ar: 'الموسيقى والصوت والتعليق' },
  { slug: 'art_location',   en: 'Art Direction & Location',  ar: 'الإخراج الفني والموقع' },
];
export const AXIS_SLUGS = BREAKDOWN_AXES.map((a) => a.slug);
export function axisDef(slug) { return BREAKDOWN_AXES.find((a) => a.slug === slug); }
