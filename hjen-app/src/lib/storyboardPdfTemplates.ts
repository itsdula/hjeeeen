// Ten ways to lay the frames out on the exported PDF page. Each template is a
// grid spec + caption mode + whether to start a fresh page per scene. The
// ExportStep renders a small SVG diagram per template as its reference image.

export type CaptionMode = 'none' | 'frame' | 'tech';

export interface PdfTemplate {
  id: string;
  label: string;
  note: string;
  cols: number;
  rows: number;
  caption: CaptionMode;     // none = image only · frame = description strip · tech = shot/scene strip + description
  groupByScene: boolean;    // true = a fresh page per scene
}

export const PDF_TEMPLATES: PdfTemplate[] = [
  { id: 'single',     label: 'Single',          note: 'One big panel per page + full technical strip', cols: 1, rows: 1, caption: 'tech',  groupByScene: false },
  { id: 'duo',        label: 'Duo',             note: 'Two side-by-side, captioned',                   cols: 2, rows: 1, caption: 'frame', groupByScene: false },
  { id: 'stacked',    label: 'Stacked pair',    note: 'Two stacked vertically, captioned',             cols: 1, rows: 2, caption: 'frame', groupByScene: false },
  { id: 'quad',       label: 'Quad',            note: 'Four to a page (2×2)',                          cols: 2, rows: 2, caption: 'frame', groupByScene: false },
  { id: 'classic6',   label: 'Classic six',     note: 'The standard 3×2 board',                        cols: 3, rows: 2, caption: 'frame', groupByScene: false },
  { id: 'studio6',    label: 'Studio board',    note: '3×2 with full technical strips, page per scene', cols: 3, rows: 2, caption: 'tech',  groupByScene: true  },
  { id: 'nine',       label: 'Nine grid',       note: '3×3, image-only',                               cols: 3, rows: 3, caption: 'none',  groupByScene: false },
  { id: 'filmstrip',  label: 'Filmstrip',       note: 'Four across in a cinematic strip',              cols: 4, rows: 1, caption: 'frame', groupByScene: false },
  { id: 'contact12',  label: 'Contact sheet',   note: 'Dense 4×3 index',                               cols: 4, rows: 3, caption: 'none',  groupByScene: false },
  { id: 'sceneflow',  label: 'Scene pages',     note: '2×2, a fresh page per scene',                   cols: 2, rows: 2, caption: 'frame', groupByScene: true  },
];

export function pdfTemplateById(id?: string): PdfTemplate {
  return PDF_TEMPLATES.find(t => t.id === id) ?? PDF_TEMPLATES[4]; // default: classic six
}
