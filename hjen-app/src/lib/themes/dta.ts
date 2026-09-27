// Theme #3 — "Grain Athletics" (Director's Treatment A DNA). A bright warm
// paper-grey deck with HEAVY film grain (grain lives in the IMAGE layer per
// Anwar 2026-07-10 — page grounds use a grainy paper texture as the full-bleed
// image, photos sit BOXED on top), wide heavy grotesque ALL-CAPS display,
// monospace body, rust-orange + pale-teal as the only chromatic breaks.
// See STUDY/pitch_themes/03_dt_a/DNA.md.
//
// GATE-4 LAW: every box below is MEASURED from the reference pages — this file
// is GENERATED from STUDY/pitch_themes/03_dt_a/text_measurements.json by the
// pixel-literal refit (probe → cap-height → fontScale, ink-top → half-leading →
// box y). Regenerate with the refit scripts; do not hand-tune numbers.
import { PitchLayoutDef, imgLayer, textLayer } from '../pitchLayoutKit';

// ── Theme #3 tokens (measured) ──
const PAPER = '#EDEBEA';   // measured paper ground (median of text pages 237,235,236)
const INK = '#141210';     // near-black text/furniture
const RUST = '#B24A22';    // hot accent (cover-B full-bleed field)
// Display = heavy wide neo-grotesque ALL-CAPS (paid class: Neue Haas/Helvetica
// Now Display Bold). Gate-3 verdict on deck words: u:Archivo Black (weight,
// width, flat terminals, geometric M all match). Body = monospace (paid class:
// GT America Mono / Söhne Mono) → u:Space Mono (+ Bold for emphasis captions).
const DISPLAY = 'u:Archivo Black';
const MONO = 'u:Space Mono';
const MONO_B = 'u:Space Mono Bold';
const LIGHT = '#F2EDE8';

const dta: PitchLayoutDef[] = [
  {
    // SYNCED from the signed proof project — final pixel-fit state (stage 10).
    id: 'dta-cover', name: 'Cover — boxed hero', themeId: 'dta',
    apply: (p) => ({
      bgColor: '#EDEBEA',
      extras: [
        { ...imgLayer({ x: 0.0328, y: 0.104, w: 0.883, h: 0.791 }, p.imagePath), image: { scale: 1 } },
        textLayer({ x: 0.0713, y: 0.0315, w: 0.0567, h: 0.0352 }, '', { color: '#141210', dir: 'ltr', fontScale: 1.011, fontKey: 'u:Archivo Black' }),
        textLayer({ x: 0.8399, y: 0.1892, w: 0.1462, h: 0.0302 }, '', { color: '#141210', align: 'start', dir: 'ltr', fontScale: 0.866, fontKey: 'u:Space Mono' }),
        textLayer({ x: 0.6849, y: 0.7065, w: 0.3313, h: 0.1806 }, '', { color: '#141210', align: 'start', dir: 'ltr', fontScale: 5.185, fontKey: 'u:Archivo Black' }),
      ],
      layout: {
        image: { scrim: false, x: -0.0002, y: 0.0003 },
        kicker: { box: { x: 0.0309, y: 0.1899, w: 0.2024, h: 0.0283 }, color: '#141210', align: 'start', dir: 'ltr', fontScale: 1.131, fontKey: 'u:Space Mono' },
        title: { box: { x: 0.0292, y: 0.6364, w: 0.658, h: 0.1303 }, color: '#141210', align: 'start', dir: 'ltr', fontScale: 1.677, fontKey: 'u:Archivo Black', noSig: true },
        body: { hidden: true },
      },
    }),
  },
  {
    // SYNCED from the signed proof project — final pixel-fit state (stage 10).
    id: 'dta-cover-b', name: 'Cover — rust full-bleed', themeId: 'dta',
    apply: (p) => ({
      bgColor: '#B24A22',
      extras: [
        textLayer({ x: 0.075, y: 0.0835, w: 0.0567, h: 0.0352 }, '', { color: '#F2EDE8', dir: 'ltr', fontScale: 1.011, fontKey: 'u:Archivo Black' }),
        textLayer({ x: 0.7671, y: 0.077, w: 0.2154, h: 0.0302 }, '', { color: '#F2EDE8', align: 'start', dir: 'ltr', fontScale: 0.867, fontKey: 'u:Space Mono' }),
      ],
      layout: {
        image: { scrim: false },
        kicker: { hidden: true },
        title: { box: { x: 0.1597, y: 0.6914, w: 0.6807, h: 0.2481 }, color: '#F2EDE8', align: 'center', dir: 'ltr', fontScale: 2.017, lineScale: 0.874, fontKey: 'u:Archivo Black', noSig: true },
        body: { hidden: true },
      },
    }),
  },
  {
    // SYNCED from the signed proof project — final pixel-fit state (stage 10).
    id: 'dta-note', name: 'NOTE — hero + inset + caption', themeId: 'dta',
    apply: (p) => ({
      bgColor: '#EDEBEA',
      extras: [
        imgLayer({ x: 0.18, y: 0.043, w: 0.51, h: 0.56 }, p.imagePath),
        imgLayer({ x: 0.742, y: 0.089, w: 0.166, h: 0.34 }),
        textLayer({ x: 0.1775, y: 0.7209, w: 0.6423, h: 0.0377 }, '', { color: '#141210', align: 'center', dir: 'ltr', fontScale: 1.083, fontKey: 'u:Space Mono Bold' }),
        textLayer({ x: 0.738, y: 0.6584, w: 0.0959, h: 0.0272 }, '', { color: '#141210', align: 'start', dir: 'ltr', fontScale: 0.781, fontKey: 'u:Space Mono' }),
        textLayer({ x: 0.0147, y: 0.9061, w: 0.1037, h: 0.0597 }, '', { color: '#141210', dir: 'ltr', fontScale: 1.714, fontKey: 'u:Archivo Black' }),
      ],
      layout: {
        image: { scrim: false },
        kicker: { box: { x: 0.1791, y: 0.6579, w: 0.1421, h: 0.0269 }, color: '#141210', align: 'start', dir: 'ltr', fontScale: 1.074, fontKey: 'u:Space Mono' },
        title: { box: { x: 0.0775, y: 0.0869, w: 0.12, h: 0.0652 }, color: '#141210', align: 'start', dir: 'ltr', fontScale: 0.839, fontKey: 'u:Archivo Black', noSig: true },
        body: { box: { x: 0.1815, y: 0.7678, w: 0.6403, h: 0.1975 }, color: '#141210', align: 'start', dir: 'ltr', fontScale: 0.559, lineScale: 0.641, fontKey: 'u:Space Mono' },
      },
    }),
  },
  {
    // SYNCED from the signed proof project — final pixel-fit state (stage 10).
    id: 'dta-idea', name: 'IDEA — text + stacked media', themeId: 'dta',
    apply: (p) => ({
      bgColor: '#EDEBEA',
      extras: [
        imgLayer({ x: 0.5, y: 0, w: 0.5, h: 0.585 }, p.imagePath),
        imgLayer({ x: 0.5, y: 0.585, w: 0.5, h: 0.31 }),
        textLayer({ x: 0.4252, y: 0.0753, w: 0.12, h: 0.0903 }, '', { color: '#141210', align: 'center', dir: 'ltr', fontScale: 2.592, fontKey: 'u:Archivo Black', rotate: 90 }),
        textLayer({ x: 0.0987, y: 0.2694, w: 0.4763, h: 0.1251 }, '', { color: '#141210', align: 'start', dir: 'ltr', fontScale: 1.039, lineScale: 0.719, fontKey: 'u:Space Mono Bold' }),
        textLayer({ x: 0.0154, y: 0.2554, w: 0.1037, h: 0.0597 }, '', { color: '#141210', dir: 'ltr', fontScale: 1.714, fontKey: 'u:Archivo Black' }),
      ],
      layout: {
        image: { scrim: false },
        kicker: { box: { x: 0.0182, y: 0.0424, w: 0.1421, h: 0.0269 }, color: '#141210', align: 'start', dir: 'ltr', fontScale: 1.074, fontKey: 'u:Space Mono' },
        title: { hidden: true },
        body: { box: { x: 0.0987, y: 0.4255, w: 0.401, h: 0.4841 }, color: '#141210', align: 'start', dir: 'ltr', fontScale: 0.559, lineScale: 0.641, fontKey: 'u:Space Mono' },
      },
    }),
  },
  {
    // SYNCED from the signed proof project — final pixel-fit state (stage 10).
    id: 'dta-movement', name: 'MOVEMENT — motion triptych', themeId: 'dta',
    apply: (p) => ({
      bgColor: '#EDEBEA',
      extras: [
        imgLayer({ x: 0.005, y: 0.033, w: 0.35, h: 0.41 }, p.imagePath),
        imgLayer({ x: 0.36, y: 0.033, w: 0.415, h: 0.41 }),
        imgLayer({ x: 0.02, y: 0.455, w: 0.61, h: 0.545 }),
        textLayer({ x: 0.895, y: 0.4885, w: 0.1037, h: 0.0597 }, '', { color: '#141210', dir: 'ltr', fontScale: 1.714, fontKey: 'u:Archivo Black' }),
        textLayer({ x: 0.9016, y: 0.1, w: 0.1391, h: 0.0272 }, '', { color: '#141210', align: 'start', dir: 'ltr', fontScale: 0.781, fontKey: 'u:Space Mono' }),
      ],
      layout: {
        image: { scrim: false },
        kicker: { box: { x: 0.8574, y: 0.0424, w: 0.1421, h: 0.0269 }, color: '#141210', align: 'start', dir: 'ltr', fontScale: 1.074, fontKey: 'u:Space Mono' },
        title: { box: { x: 0.6646, y: 0.5049, w: 0.2419, h: 0.0674 }, color: '#141210', align: 'start', dir: 'ltr', fontScale: 0.867, fontKey: 'u:Archivo Black', noSig: true },
        body: { box: { x: 0.6521, y: 0.9022, w: 0.3222, h: 0.1144 }, color: '#141210', align: 'start', dir: 'ltr', fontScale: 0.559, lineScale: 0.647, fontKey: 'u:Space Mono' },
      },
    }),
  },
  {
    // SYNCED from the signed proof project — final pixel-fit state (stage 10).
    id: 'dta-lights', name: 'LIGHTS — night pair', themeId: 'dta',
    apply: (p) => ({
      bgColor: '#EDEBEA',
      extras: [
        imgLayer({ x: 0.5, y: 0, w: 0.5, h: 1 }, p.imagePath),
        imgLayer({ x: 0.014, y: 0.285, w: 0.475, h: 0.715 }),
        textLayer({ x: 0.4429, y: 0.0455, w: 0.0718, h: 0.0383 }, '', { color: '#141210', dir: 'ltr', fontScale: 1.098, fontKey: 'u:Archivo Black' }),
      ],
      layout: {
        image: { scrim: false },
        kicker: { box: { x: 0.0178, y: 0.0465, w: 0.2311, h: 0.0298 }, color: '#141210', align: 'start', dir: 'ltr', fontScale: 1.192, fontKey: 'u:Space Mono' },
        title: { box: { x: 0.0178, y: 0.1803, w: 0.1607, h: 0.0674 }, color: '#141210', align: 'start', dir: 'ltr', fontScale: 0.867, fontKey: 'u:Archivo Black', noSig: true },
        body: { box: { x: 0.1795, y: 0.1693, w: 0.3091, h: 0.082 }, color: '#141210', align: 'start', dir: 'ltr', fontScale: 0.559, lineScale: 0.634, fontKey: 'u:Space Mono' },
      },
    }),
  },
  {
    // SYNCED from the signed proof project — final pixel-fit state (stage 10).
    id: 'dta-product', name: 'PRODUCT — detail cluster', themeId: 'dta',
    apply: (p) => ({
      bgColor: '#EDEBEA',
      extras: [
        imgLayer({ x: 0.015, y: 0.02, w: 0.635, h: 0.56 }, p.imagePath),
        imgLayer({ x: 0.665, y: 0.245, w: 0.315, h: 0.335 }),
        imgLayer({ x: 0.1, y: 0.51, w: 0.155, h: 0.44 }),
        textLayer({ x: 0.895, y: 0.03, w: 0.1037, h: 0.0597 }, '', { color: '#141210', dir: 'ltr', fontScale: 1.714, fontKey: 'u:Archivo Black' }),
        textLayer({ x: 0.9005, y: 0.9345, w: 0.0959, h: 0.0272 }, '', { color: '#141210', align: 'start', dir: 'ltr', fontScale: 0.781, fontKey: 'u:Space Mono' }),
      ],
      layout: {
        image: { scrim: false },
        kicker: { box: { x: 0.8574, y: 0.8877, w: 0.1421, h: 0.0269 }, color: '#141210', align: 'start', dir: 'ltr', fontScale: 1.074, fontKey: 'u:Space Mono' },
        title: { box: { x: 0.7917, y: 0.6197, w: 0.2055, h: 0.0674 }, color: '#141210', align: 'start', dir: 'ltr', fontScale: 0.867, fontKey: 'u:Archivo Black', noSig: true },
        body: { box: { x: 0.3411, y: 0.6233, w: 0.3154, h: 0.2179 }, color: '#141210', align: 'start', dir: 'ltr', fontScale: 0.559, lineScale: 0.647, fontKey: 'u:Space Mono' },
      },
    }),
  },
  {
    // SYNCED from the signed proof project — final pixel-fit state (stage 10).
    id: 'dta-edit', name: 'EDIT — cinematic strip', themeId: 'dta',
    apply: (p) => ({
      bgColor: '#EDEBEA',
      extras: [
        imgLayer({ x: 0.26, y: 0, w: 0.74, h: 1 }, p.imagePath),
        imgLayer({ x: 0.175, y: 0.04, w: 0.4, h: 0.32 }),
        imgLayer({ x: 0.585, y: 0.04, w: 0.315, h: 0.325 }),
        imgLayer({ x: 0.015, y: 0.365, w: 0.245, h: 0.635 }),
        textLayer({ x: 0.0154, y: 0.03, w: 0.0858, h: 0.0597 }, '', { color: '#141210', dir: 'ltr', fontScale: 1.714, fontKey: 'u:Archivo Black' }),
        textLayer({ x: 0.584, y: 0.638, w: 0.0959, h: 0.0272 }, '', { color: '#F2EDE8', align: 'start', dir: 'ltr', fontScale: 0.781, fontKey: 'u:Space Mono' }),
      ],
      layout: {
        image: { hidden: true, scrim: false },
        kicker: { box: { x: 0.584, y: 0.5896, w: 0.1421, h: 0.0269 }, color: '#F2EDE8', align: 'start', dir: 'ltr', fontScale: 1.074, fontKey: 'u:Space Mono' },
        title: { box: { x: 0.5833, y: 0.7679, w: 0.1034, h: 0.0652 }, color: '#F2EDE8', align: 'start', dir: 'ltr', fontScale: 0.839, fontKey: 'u:Archivo Black', noSig: true },
        body: { box: { x: 0.5864, y: 0.8685, w: 0.3087, h: 0.1003 }, color: '#F2EDE8', align: 'start', dir: 'ltr', fontScale: 0.559, lineScale: 0.641, fontKey: 'u:Space Mono' },
      },
    }),
  },
  {
    // SYNCED from the signed proof project — final pixel-fit state (stage 10).
    id: 'dta-final', name: 'FINAL NOTE — closer', themeId: 'dta',
    apply: (p) => ({
      bgColor: '#EDEBEA',
      extras: [
        imgLayer({ x: 0.017, y: 0.045, w: 0.317, h: 0.433 }, p.imagePath),
        imgLayer({ x: 0.342, y: 0.045, w: 0.642, h: 0.836 }),
        textLayer({ x: 0.3057, y: 0.5772, w: 0.13, h: 0.062 }, '', { color: '#EDEBEA', strokeColor: '#141210', align: 'start', dir: 'ltr', fontScale: 2.724, fontKey: 'u:Archivo Black' }),
        textLayer({ x: 0.1791, y: 0.8734, w: 0.0978, h: 0.0362 }, '', { color: '#141210', align: 'start', dir: 'ltr', fontScale: 1.039, fontKey: 'u:Space Mono Bold' }),
        textLayer({ x: 0.072, y: 0.601, w: 0.1, h: 0.058 }, '', { color: '#141210', dir: 'ltr', fontScale: 1.714, fontKey: 'u:Archivo Black' }),
        textLayer({ x: 0.4469, y: 0.9345, w: 0.1391, h: 0.0272 }, '', { color: '#141210', align: 'start', dir: 'ltr', fontScale: 0.781, fontKey: 'u:Space Mono' }),
      ],
      layout: {
        image: { scrim: false, x: 0.0002, y: 0 },
        kicker: { box: { x: 0.4473, y: 0.8769, w: 0.1421, h: 0.0269 }, color: '#141210', align: 'start', dir: 'ltr', fontScale: 1.074, fontKey: 'u:Space Mono' },
        title: { box: { x: 0.185, y: 0.598, w: 0.2108, h: 0.074 }, color: '#141210', align: 'start', dir: 'ltr', fontScale: 0.881, fontKey: 'u:Archivo Black', noSig: true },
        body: { box: { x: 0.179, y: 0.678, w: 0.166, h: 0.19 }, color: '#141210', align: 'start', dir: 'ltr', fontScale: 0.559, lineScale: 0.654, fontKey: 'u:Space Mono' },
      },
    }),
  },
];

export const dtaLayouts = dta;
