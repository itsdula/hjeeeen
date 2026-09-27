// Theme #1 — "Cinematic Cream" (Equip Foods DNA). DARK (near-black bg, cream type)
// and CREAM (peach-cream bg, ink type) spreads alternate — the alternation is the
// signature. See STUDY/pitch_themes/01_equip_foods/DNA.md.
//
// GATE-4 LAW: every box below is MEASURED from the reference pages
// (measure_layout.py + pixel probes on images/p*.png @1400x788) — not approximated.
// Title fontScales derive from probed cap-height fractions of page height.
import { PitchLayoutDef, imgLayer, textLayer } from '../pitchLayoutKit';

// ── Theme #1 tokens (measured from the original pages) ──
const CREAM = '#FBE6CE';   // measured page cream (#fde7cf/#fce5cd/#fde8cf corners)
const ORANGE = '#E0531F';  // burnt-orange accent (single accent)
const BLACK = '#030303';   // measured dark-page background
const DARK2 = '#160F10';   // p02 collage background (warm near-black)
const INK = '#171310';     // dark text on cream pages
// Original display = a Flareserif-821 / Friz-Quadrata-class GLYPHIC serif (paid;
// identified via WhatTheFont + Fontspring in Gate 3). Closest FREE match = a
// static sharp display cut of Fraunces (opsz 144, SOFT 0, WONK 0) — wide, very
// high contrast, sharp flared terminals — installed in the HJEN Fonts folder.
const DISPLAY = 'u:Fraunces Display';
const DISPLAY_I = 'u:Fraunces Display Italic';  // orange labels + pull-quotes (true italic)
const INTER = 'inter';     // body grotesque (original = Poppins-class geometric)

// shared running elements (measured): kicker top-left, HXM brand top-right, folio.
const KICK = { x: 0.02, y: 0.038, w: 0.40, h: 0.04 };
const hxm = (color: string) =>
  textLayer({ x: 0.905, y: 0.028, w: 0.075, h: 0.05 }, 'HXM', { color, fontKey: INTER, weight: 800, align: 'end', dir: 'ltr', fontScale: 1.35 });
const kick = (color = ORANGE) =>
  ({ box: KICK, color, fontKey: DISPLAY_I, italic: true, align: 'start' as const, dir: 'ltr' as const, fontScale: 1.1 });

const equip: PitchLayoutDef[] = [
  {
    // SYNCED from the signed proof project — final pixel-fit state (stage 10).
    id: 'eq-cover', name: 'Cover', themeId: 'equip',
    apply: (p) => ({
      bgColor: '#030303',
      layout: {
        image: { hidden: false, scale: 1.15, x: 0.0235, y: -0.0173, locked: false },
        kicker: { box: { x: 0.0195, y: 0.0383, w: 0.4, h: 0.04 }, color: '#E0531F', align: 'start', dir: 'ltr', fontScale: 1.1, fontKey: 'u:Fraunces Display Italic', italic: true, hidden: false },
        title: { box: { x: 0.0596, y: 0.1157, w: 0.88, h: 0.63 }, color: '#FBE6CE', align: 'center', dir: 'ltr', fontScale: 5.3, lineScale: 0.84, fontKey: 'u:Fraunces Display', hidden: false, locked: false },
        body: { hidden: false },
      },
    }),
  },
  {
    // SYNCED from the signed proof project — final pixel-fit state (stage 10).
    id: 'eq-opportunity', name: 'Opportunity (image collage)', themeId: 'equip',
    apply: (p) => ({
      bgColor: '#160F10',
      extras: [
        { ...imgLayer({ x: 0.0003, y: 0.0004, w: 0.483, h: 0.545 }, p.imagePath), image: { opacity: 1 } },
        imgLayer({ x: 0.483, y: 0.0003, w: 0.517, h: 0.52 }),
        imgLayer({ x: 0, y: 0.545, w: 0.305, h: 0.455 }),
        imgLayer({ x: 0.663, y: 0.5853, w: 0.337, h: 0.415 }),
        textLayer({ x: 0.35, y: 0.7545, w: 0.3, h: 0.1 }, '', { color: '#FBE6CE', align: 'center', dir: 'ltr', fontScale: 0.72, lineScale: 0.85, fontKey: 'inter', italic: true }),
        textLayer({ x: 0.5999, y: 0.038, w: 0.37, h: 0.04 }, '', { color: '#e0531f', align: 'end', dir: 'ltr', fontScale: 1, fontKey: 'u:Fraunces Display Italic', italic: true }),
      ],
      layout: {
        image: { hidden: true },
        kicker: { box: { x: 0.02, y: 0.038, w: 0.4, h: 0.04 }, color: '#E0531F', align: 'start', dir: 'ltr', fontScale: 1.1, fontKey: 'u:Fraunces Display Italic', italic: true },
        title: { box: { x: 0.18, y: 0.359, w: 0.64, h: 0.24 }, color: '#FBE6CE', align: 'center', dir: 'ltr', fontScale: 1.82, lineScale: 0.9, fontKey: 'u:Fraunces Display', locked: false },
        body: { box: { x: 0.3498, y: 0.659, w: 0.2951, h: 0.058 }, color: '#FBE6CE', align: 'center', dir: 'ltr', fontScale: 0.72, lineScale: 0.75, fontKey: 'inter', hidden: false, locked: true },
      },
    }),
  },
  {
    // SYNCED from the signed proof project — final pixel-fit state (stage 10).
    id: 'eq-belief', name: 'Core belief (cream)', themeId: 'equip',
    apply: (p) => ({
      bgColor: '#FBE6CE',
      extras: [
        imgLayer({ x: 0.0999, y: 0.104, w: 0.8, h: 0.791 }, p.imagePath),
        textLayer({ x: 0.6, y: 0.635, w: 0.27, h: 0.12 }, '', { color: '#FBE6CE', dir: 'ltr', fontScale: 0.8, lineScale: 1.5, fontKey: 'inter' }),
        textLayer({ x: 0.6, y: 0.78, w: 0.27, h: 0.08 }, '', { color: '#E0531F', dir: 'ltr', fontScale: 0.85, lineScale: 1.25, fontKey: 'u:Fraunces Display Italic', italic: true }),
        textLayer({ x: 0.9048, y: 0.028, w: 0.075, h: 0.05 }, '', { color: '#171310', align: 'end', dir: 'ltr', fontScale: 1.35, fontKey: 'inter', weight: 800 }),
      ],
      layout: {
        image: { hidden: true },
        kicker: { box: { x: 0.02, y: 0.038, w: 0.4, h: 0.04 }, color: '#E0531F', align: 'start', dir: 'ltr', fontScale: 1.1, fontKey: 'u:Fraunces Display Italic', italic: true },
        title: { box: { x: 0.1, y: 0.068, w: 0.8, h: 0.17 }, color: '#FBE6CE', align: 'center', dir: 'ltr', fontScale: 2.52, lineScale: 0.9, fontKey: 'u:Fraunces Display' },
        body: { box: { x: 0.145, y: 0.525, w: 0.3, h: 0.12 }, color: '#FBE6CE', dir: 'ltr', fontScale: 0.8, lineScale: 1.5, fontKey: 'inter' },
      },
    }),
  },
  {
    // SYNCED from the signed proof project — final pixel-fit state (stage 10).
    id: 'eq-concept', name: 'Concept (cream two-column)', themeId: 'equip',
    apply: (p) => ({
      bgColor: '#fbe6ce',
      extras: [
        imgLayer({ x: 0.2541, y: 0, w: 0.5, h: 1 }, p.imagePath),
        textLayer({ x: 0.7752, y: 0.2879, w: 0.1934, h: 0.2126 }, '', { color: '#171310', align: 'end', dir: 'ltr', fontScale: 0.76, lineScale: 1.55, fontKey: 'inter' }),
        textLayer({ x: 0.7747, y: 0.6853, w: 0.2, h: 0.2 }, '', { color: '#E0531F', align: 'end', dir: 'ltr', fontScale: 0.82, lineScale: 1.3, fontKey: 'u:Fraunces Display Italic', italic: true }),
        textLayer({ x: 0.905, y: 0.028, w: 0.075, h: 0.05 }, '', { color: '#171310', align: 'end', dir: 'ltr', fontScale: 1.35, fontKey: 'inter', weight: 800 }),
        { ...imgLayer({ x: 0.6931, y: 0.0118, w: 0.2995, h: 0.2614 }, undefined), image: { fit: 'contain' } },
      ],
      layout: {
        image: { hidden: true },
        kicker: { box: { x: 0.02, y: 0.038, w: 0.4, h: 0.04 }, color: '#E0531F', align: 'start', dir: 'ltr', fontScale: 1.1, fontKey: 'u:Fraunces Display Italic', italic: true },
        title: { box: { x: 0.25, y: 0.042, w: 0.5, h: 0.12 }, color: '#FBE6CE', align: 'center', dir: 'ltr', fontScale: 1.93, lineScale: 0.9, fontKey: 'u:Anton' },
        body: { box: { x: 0.022, y: 0.2897, w: 0.205, h: 0.55 }, color: '#7a3500', dir: 'ltr', fontScale: 1.26, lineScale: 0.55, fontKey: 'inter' },
      },
    }),
  },
  {
    // SYNCED from the signed proof project — final pixel-fit state (stage 10).
    id: 'eq-tone', name: 'Visual tone', themeId: 'equip',
    apply: (p) => ({
      bgColor: '#030303',
      extras: [
        imgLayer({ x: -0.0001, y: 0.235, w: 0.375, h: 0.385 }, p.imagePath),
        imgLayer({ x: 0.625, y: 0.238, w: 0.375, h: 0.385 }),
        textLayer({ x: 0.905, y: 0.028, w: 0.075, h: 0.05 }, '', { color: '#FBE6CE', align: 'end', dir: 'ltr', fontScale: 1.35, fontKey: 'inter', weight: 800 }),
      ],
      layout: {
        image: { hidden: true },
        kicker: { box: { x: 0.02, y: 0.038, w: 0.4, h: 0.04 }, color: '#E0531F', align: 'start', dir: 'ltr', fontScale: 1.1, fontKey: 'u:Fraunces Display Italic', italic: true },
        title: { box: { x: 0.06, y: 0.095, w: 0.49, h: 0.33 }, color: '#FBE6CE', align: 'center', dir: 'ltr', fontScale: 2.9, lineScale: 0.73, fontKey: 'u:Fraunces Display' },
        body: { hidden: true },
      },
    }),
  },
  {
    // SYNCED from the signed proof project — final pixel-fit state (stage 10).
    id: 'eq-grid', name: 'Moodboard grid', themeId: 'equip',
    apply: (p) => ({
      bgColor: '#030303',
      extras: [
        imgLayer({ x: 0, y: 0.119, w: 0.183, h: 0.299 }, p.imagePath),
        imgLayer({ x: 0.192, y: 0.119, w: 0.275, h: 0.299 }),
        imgLayer({ x: 0.475, y: 0.119, w: 0.292, h: 0.299 }),
        imgLayer({ x: 0.775, y: 0.119, w: 0.225, h: 0.299 }),
        imgLayer({ x: 0, y: 0.433, w: 0.628, h: 0.567 }),
        imgLayer({ x: 0.633, y: 0.433, w: 0.367, h: 0.567 }),
        textLayer({ x: 0.905, y: 0.028, w: 0.075, h: 0.05 }, '', { color: '#FBE6CE', align: 'end', dir: 'ltr', fontScale: 1.35, fontKey: 'inter', weight: 800 }),
      ],
      layout: {
        image: { hidden: true },
        kicker: { box: { x: 0.02, y: 0.038, w: 0.4, h: 0.04 }, color: '#E0531F', align: 'start', dir: 'ltr', fontScale: 1.1, fontKey: 'u:Fraunces Display Italic', italic: true },
        title: { hidden: true },
        body: { hidden: true },
      },
    }),
  },
  {
    // SYNCED from the signed proof project — final pixel-fit state (stage 10).
    id: 'eq-insight', name: 'Insight (stacked images)', themeId: 'equip',
    apply: (p) => ({
      bgColor: '#030303',
      extras: [
        imgLayer({ x: 0.5, y: 0, w: 0.5, h: 1 }, p.imagePath),
        imgLayer({ x: 0.604, y: 0.099, w: 0.303, h: 0.4 }),
        imgLayer({ x: 0.568, y: 0.533, w: 0.376, h: 0.402 }),
        textLayer({ x: 0.905, y: 0.028, w: 0.075, h: 0.05 }, '', { color: '#FBE6CE', align: 'end', dir: 'ltr', fontScale: 1.35, fontKey: 'inter', weight: 800 }),
      ],
      layout: {
        image: { hidden: true },
        kicker: { box: { x: 0.02, y: 0.038, w: 0.4, h: 0.04 }, color: '#E0531F', align: 'start', dir: 'ltr', fontScale: 1.1, fontKey: 'u:Fraunces Display Italic', italic: true },
        title: { box: { x: 0.09, y: 0.108, w: 0.36, h: 0.14 }, color: '#FBE6CE', align: 'start', dir: 'ltr', fontScale: 2.11, lineScale: 0.9, fontKey: 'u:Fraunces Display' },
        body: { hidden: false },
      },
    }),
  },
  {
    // SYNCED from the signed proof project — final pixel-fit state (stage 10).
    id: 'eq-vs', name: 'Strategy (versus)', themeId: 'equip',
    apply: (p) => ({
      bgColor: '#FBE6CE',
      extras: [
        { ...imgLayer({ x: 0, y: 0, w: 0.5, h: 1 }, p.imagePath), image: { scale: 1.15 } },
        imgLayer({ x: 0.549, y: 0.079, w: 0.403, h: 0.403 }),
        imgLayer({ x: 0.549, y: 0.514, w: 0.403, h: 0.402 }),
        imgLayer({ x: 0.068, y: 0.409, w: 0.178, h: 0.181 }),
        imgLayer({ x: 0.261, y: 0.409, w: 0.17, h: 0.181 }),
        textLayer({ x: 0.425, y: 0.775, w: 0.16, h: 0.225 }, '', { color: '#fbe6ce', align: 'center', dir: 'ltr', fontScale: 10, lineScale: 0.72, fontKey: 'u:Fraunces Display' }),
        textLayer({ x: 0.6, y: 0.935, w: 0.3, h: 0.05 }, '', { color: '#E0531F', align: 'center', dir: 'ltr', fontScale: 0.95, fontKey: 'inter' }),
        textLayer({ x: 0.905, y: 0.028, w: 0.075, h: 0.05 }, '', { color: '#171310', align: 'end', dir: 'ltr', fontScale: 1.35, fontKey: 'inter', weight: 800 }),
      ],
      layout: {
        image: { hidden: true },
        kicker: { box: { x: 0.02, y: 0.038, w: 0.4, h: 0.04 }, color: '#E0531F', align: 'start', dir: 'ltr', fontScale: 1.1, fontKey: 'u:Fraunces Display Italic', italic: true },
        title: { box: { x: 0.055, y: 0.0977, w: 0.5599, h: 0.2306 }, color: '#FBE6CE', align: 'start', dir: 'ltr', fontScale: 2.8, lineScale: 0.9, fontKey: 'u:Fraunces Display' },
        body: { hidden: true },
      },
    }),
  },
  {
    // SYNCED from the signed proof project — final pixel-fit state (stage 10).
    id: 'eq-execution', name: 'Execution (3-column)', themeId: 'equip',
    apply: (p) => ({
      bgColor: '#030303',
      extras: [
        imgLayer({ x: 0, y: 0, w: 1, h: 0.412 }, p.imagePath),
        textLayer({ x: 0, y: 0.418, w: 1, h: 0.047 }, '', { color: '#FBE6CE', fontScale: 0.5, fontKey: 'inter', bg: '#FBE6CE' }),
        textLayer({ x: 0.062, y: 0.285, w: 0.45, h: 0.05 }, '', { color: '#FBE6CE', dir: 'ltr', fontScale: 0.95, fontKey: 'inter', italic: true }),
        textLayer({ x: 0.388, y: 0.505, w: 0.235, h: 0.42 }, '', { color: '#FBE6CE', dir: 'ltr', fontScale: 0.76, lineScale: 1.55, fontKey: 'inter' }),
        textLayer({ x: 0.712, y: 0.505, w: 0.235, h: 0.42 }, '', { color: '#FBE6CE', dir: 'ltr', fontScale: 0.76, lineScale: 1.55, fontKey: 'inter' }),
        textLayer({ x: 0.905, y: 0.028, w: 0.075, h: 0.05 }, '', { color: '#FBE6CE', align: 'end', dir: 'ltr', fontScale: 1.35, fontKey: 'inter', weight: 800 }),
      ],
      layout: {
        image: { hidden: true },
        kicker: { box: { x: 0.02, y: 0.038, w: 0.4, h: 0.04 }, color: '#E0531F', align: 'start', dir: 'ltr', fontScale: 1.1, fontKey: 'u:Fraunces Display Italic', italic: true },
        title: { box: { x: 0.058, y: 0.112, w: 0.55, h: 0.15 }, color: '#FBE6CE', align: 'start', dir: 'ltr', fontScale: 2.13, lineScale: 0.9, fontKey: 'u:Fraunces Display' },
        body: { box: { x: 0.062, y: 0.505, w: 0.235, h: 0.42 }, color: '#FBE6CE', dir: 'ltr', fontScale: 0.76, lineScale: 1.55, fontKey: 'inter' },
      },
    }),
  },
  {
    // SYNCED from the signed proof project — final pixel-fit state (stage 10).
    id: 'eq-timeline', name: 'Timeline (stepped cards)', themeId: 'equip',
    apply: (p) => ({
      bgColor: '#FBE6CE',
      extras: [
        textLayer({ x: 0.011, y: 0.158, w: 0.188, h: 0.02 }, '', { color: '#171310', fontScale: 0.4, bg: '#171310' }),
        textLayer({ x: 0.011, y: 0.185, w: 0.188, h: 0.045 }, '', { color: '#E0531F', align: 'center', dir: 'ltr', fontScale: 0.82, fontKey: 'inter', weight: 600 }),
        textLayer({ x: 0.011, y: 0.235, w: 0.188, h: 0.257 }, '', { color: '#FBE6CE', dir: 'ltr', fontScale: 0.7, lineScale: 1.2, fontKey: 'inter', bg: '#171310' }),
        textLayer({ x: 0.208, y: 0.385, w: 0.188, h: 0.02 }, '', { color: '#171310', fontScale: 0.4, bg: '#171310' }),
        textLayer({ x: 0.208, y: 0.412, w: 0.188, h: 0.045 }, '', { color: '#E0531F', align: 'center', dir: 'ltr', fontScale: 0.82, fontKey: 'inter', weight: 600 }),
        textLayer({ x: 0.2078, y: 0.4626, w: 0.188, h: 0.253 }, '', { color: '#FBE6CE', dir: 'ltr', fontScale: 0.7, lineScale: 1.2, fontKey: 'inter', bg: '#171310' }),
        textLayer({ x: 0.406, y: 0.607, w: 0.188, h: 0.02 }, '', { color: '#171310', fontScale: 0.4, bg: '#171310' }),
        textLayer({ x: 0.406, y: 0.634, w: 0.188, h: 0.045 }, '', { color: '#E0531F', align: 'center', dir: 'ltr', fontScale: 0.82, fontKey: 'inter', weight: 600 }),
        textLayer({ x: 0.406, y: 0.687, w: 0.188, h: 0.253 }, '', { color: '#FBE6CE', dir: 'ltr', fontScale: 0.7, lineScale: 1.2, fontKey: 'inter', bg: '#171310' }),
        textLayer({ x: 0.603, y: 0.475, w: 0.188, h: 0.02 }, '', { color: '#E0531F', fontScale: 0.4, bg: '#E0531F' }),
        textLayer({ x: 0.603, y: 0.5, w: 0.188, h: 0.045 }, '', { color: '#E0531F', align: 'center', dir: 'ltr', fontScale: 0.82, fontKey: 'inter', weight: 600 }),
        textLayer({ x: 0.6025, y: 0.5531, w: 0.188, h: 0.253 }, '', { color: '#FBE6CE', dir: 'ltr', fontScale: 0.7, lineScale: 1.1, fontKey: 'inter', bg: '#171310' }),
        textLayer({ x: 0.8, y: 0.298, w: 0.188, h: 0.02 }, '', { color: '#E0531F', fontScale: 0.4, bg: '#E0531F' }),
        textLayer({ x: 0.8, y: 0.325, w: 0.188, h: 0.045 }, '', { color: '#E0531F', align: 'center', dir: 'ltr', fontScale: 0.82, fontKey: 'inter', weight: 600 }),
        textLayer({ x: 0.8, y: 0.373, w: 0.188, h: 0.253 }, '', { color: '#FBE6CE', dir: 'ltr', fontScale: 0.7, lineScale: 1.1, fontKey: 'inter', bg: '#171310' }),
        textLayer({ x: 0.905, y: 0.028, w: 0.075, h: 0.05 }, '', { color: '#171310', align: 'end', dir: 'ltr', fontScale: 1.35, fontKey: 'inter', weight: 800 }),
        { ...imgLayer({ x: 0.3509, y: 0.3353, w: 0.2995, h: 0.2614 }, p.imagePath), image: { fit: 'contain' } },
      ],
      layout: {
        image: { hidden: true },
        kicker: { box: { x: 0.02, y: 0.038, w: 0.4, h: 0.04 }, color: '#E0531F', align: 'start', dir: 'ltr', fontScale: 1.1, fontKey: 'u:Fraunces Display Italic', italic: true },
        title: { box: { x: 0.29, y: 0.0453, w: 0.4367, h: 0.6772 }, color: '#171310', align: 'center', dir: 'ltr', fontScale: 1.49, lineScale: 0.95, fontKey: 'u:Fraunces Display' },
        body: { hidden: true },
      },
    }),
  },
  {
    // SYNCED from the signed proof project — final pixel-fit state (stage 10).
    id: 'eq-section', name: 'Budget (poster title)', themeId: 'equip',
    apply: (p) => ({
      bgColor: '#000000',
      extras: [
        imgLayer({ x: 0.132, y: 0.113, w: 0.735, h: 0.54 }, p.imagePath),
        textLayer({ x: 0.905, y: 0.028, w: 0.075, h: 0.05 }, '', { color: '#FBE6CE', align: 'end', dir: 'ltr', fontScale: 1.35, fontKey: 'inter', weight: 800 }),
      ],
      layout: {
        image: { hidden: true },
        kicker: { box: { x: 0.02, y: 0.038, w: 0.4, h: 0.04 }, color: '#E0531F', align: 'start', dir: 'ltr', fontScale: 1.1, fontKey: 'u:Fraunces Display Italic', italic: true },
        title: { box: { x: 0.1, y: 0.0844, w: 0.8, h: 0.24 }, color: '#FBE6CE', align: 'center', dir: 'ltr', fontScale: 4.29, lineScale: 0.9, fontKey: 'u:Fraunces Display' },
        body: { box: { x: 0.132, y: 0.688, w: 0.735, h: 0.16 }, color: '#FBE6CE', dir: 'ltr', fontScale: 0.88, lineScale: 1.17, fontKey: 'inter' },
      },
    }),
  },
  {
    // SYNCED from the signed proof project — final pixel-fit state (stage 10).
    id: 'eq-why', name: 'Why us (split)', themeId: 'equip',
    apply: (p) => ({
      bgColor: '#030303',
      extras: [
        imgLayer({ x: 0.5, y: 0, w: 0.5, h: 1 }, p.imagePath),
        textLayer({ x: 0.905, y: 0.028, w: 0.075, h: 0.05 }, '', { color: '#FBE6CE', align: 'end', dir: 'ltr', fontScale: 1.35, fontKey: 'inter', weight: 800 }),
      ],
      layout: {
        image: { hidden: true },
        kicker: { box: { x: 0.02, y: 0.038, w: 0.4, h: 0.04 }, color: '#E0531F', align: 'start', dir: 'ltr', fontScale: 1.1, fontKey: 'u:Fraunces Display Italic', italic: true },
        title: { box: { x: 0.15, y: 0.105, w: 0.337, h: 0.29 }, color: '#FBE6CE', align: 'end', dir: 'ltr', fontScale: 2.66, lineScale: 0.86, fontKey: 'u:Fraunces Display' },
        body: { box: { x: 0.031, y: 0.545, w: 0.445, h: 0.4 }, color: '#FBE6CE', dir: 'ltr', fontScale: 0.76, lineScale: 0.97, fontKey: 'inter' },
      },
    }),
  },
  {
    // SYNCED from the signed proof project — final pixel-fit state (stage 10).
    id: 'eq-credits', name: 'Credits (founders)', themeId: 'equip',
    apply: (p) => ({
      bgColor: '#FBE6CE',
      extras: [
        imgLayer({ x: 0.085, y: 0.1767, w: 0.165, h: 0.295 }, p.imagePath),
        imgLayer({ x: 0.144, y: 0.615, w: 0.164, h: 0.278 }),
        textLayer({ x: 0.078, y: 0.085, w: 0.3, h: 0.15 }, '', { color: '#FBE6CE', dir: 'ltr', fontScale: 1.9, lineScale: 1.15, fontKey: 'inter', weight: 500 }),
        textLayer({ x: 0.253, y: 0.4337, w: 0.13, h: 0.09 }, '', { color: '#171310', dir: 'ltr', fontScale: 1.05, lineScale: 1.15, fontKey: 'inter', weight: 700 }),
        textLayer({ x: 0.352, y: 0.205, w: 0.375, h: 0.22 }, '', { color: '#171310', dir: 'ltr', fontScale: 0.7, lineScale: 1.5, fontKey: 'inter' }),
        textLayer({ x: 0.092, y: 0.525, w: 0.26, h: 0.15 }, '', { color: '#E0531F', dir: 'ltr', fontScale: 1.9, lineScale: 1.15, fontKey: 'inter', weight: 500 }),
        textLayer({ x: 0.2131, y: 0.8902, w: 0.13, h: 0.09 }, '', { color: '#171310', dir: 'ltr', fontScale: 1.05, lineScale: 1.15, fontKey: 'inter', weight: 700 }),
        textLayer({ x: 0.352, y: 0.635, w: 0.375, h: 0.22 }, '', { color: '#171310', dir: 'ltr', fontScale: 0.7, lineScale: 1.5, fontKey: 'inter' }),
        textLayer({ x: 0.79, y: 0.245, w: 0.185, h: 0.52 }, '', { color: '#171310', align: 'center', dir: 'ltr', fontScale: 0.85, lineScale: 2.4, fontKey: 'inter', weight: 600 }),
        textLayer({ x: 0.905, y: 0.028, w: 0.075, h: 0.05 }, '', { color: '#171310', align: 'end', dir: 'ltr', fontScale: 1.35, fontKey: 'inter', weight: 800 }),
      ],
      layout: {
        image: {  },
        kicker: { box: { x: 0.02, y: 0.038, w: 0.4, h: 0.04 }, color: '#E0531F', align: 'start', dir: 'ltr', fontScale: 1.1, fontKey: 'u:Fraunces Display Italic', italic: true },
        title: { hidden: true },
        body: { hidden: true },
      },
    }),
  },
  {
    // SYNCED from the signed proof project — final pixel-fit state (stage 10).
    id: 'eq-work', name: 'Our work (reel tiles)', themeId: 'equip',
    apply: (p) => ({
      bgColor: '#000000',
      extras: [
        { ...imgLayer({ x: 0.03, y: 0.433, w: 0.165, h: 0.46 }, p.imagePath), image: { scale: 1.45 } },
        imgLayer({ x: 0.201, y: 0.433, w: 0.165, h: 0.46 }),
        imgLayer({ x: 0.372, y: 0.433, w: 0.166, h: 0.46 }),
        { ...imgLayer({ x: 0.567, y: 0.194, w: 0.108, h: 0.299 }, undefined), image: { scale: 1.75 } },
        imgLayer({ x: 0.683, y: 0.194, w: 0.108, h: 0.299 }),
        imgLayer({ x: 0.8, y: 0.194, w: 0.108, h: 0.299 }),
        textLayer({ x: 0.565, y: 0.545, w: 0.3, h: 0.04 }, '', { color: '#E0531F', dir: 'ltr', fontScale: 0.82, fontKey: 'inter', italic: true }),
        textLayer({ x: 0.04, y: 0.845, w: 0.1, h: 0.04 }, '', { color: '#FFFFFF', dir: 'ltr', fontScale: 0.72, fontKey: 'inter', weight: 600 }),
        textLayer({ x: 0.211, y: 0.845, w: 0.1, h: 0.04 }, '', { color: '#FFFFFF', dir: 'ltr', fontScale: 0.72, fontKey: 'inter', weight: 600 }),
        textLayer({ x: 0.382, y: 0.845, w: 0.1, h: 0.04 }, '', { color: '#FFFFFF', dir: 'ltr', fontScale: 0.72, fontKey: 'inter', weight: 600 }),
        textLayer({ x: 0.574, y: 0.445, w: 0.09, h: 0.04 }, '', { color: '#FFFFFF', dir: 'ltr', fontScale: 0.62, fontKey: 'inter', weight: 600 }),
        textLayer({ x: 0.69, y: 0.445, w: 0.09, h: 0.04 }, '', { color: '#FFFFFF', dir: 'ltr', fontScale: 0.62, fontKey: 'inter', weight: 600 }),
        textLayer({ x: 0.807, y: 0.445, w: 0.09, h: 0.04 }, '', { color: '#FFFFFF', dir: 'ltr', fontScale: 0.62, fontKey: 'inter', weight: 600 }),
        textLayer({ x: 0.905, y: 0.028, w: 0.075, h: 0.05 }, '', { color: '#FBE6CE', align: 'end', dir: 'ltr', fontScale: 1.35, fontKey: 'inter', weight: 800 }),
      ],
      layout: {
        image: { hidden: false, opacity: 0.18 },
        kicker: { box: { x: 0.02, y: 0.038, w: 0.4, h: 0.04 }, color: '#E0531F', align: 'start', dir: 'ltr', fontScale: 1.1, fontKey: 'u:Fraunces Display Italic', italic: true },
        title: { box: { x: 0.1298, y: 0.0483, w: 0.46, h: 0.31 }, color: '#FBE6CE', align: 'center', dir: 'ltr', fontScale: 2.8, lineScale: 0.78, fontKey: 'u:Fraunces Display' },
        body: { box: { x: 0.565, y: 0.595, w: 0.385, h: 0.33 }, color: '#D9D4CB', dir: 'ltr', fontScale: 0.76, lineScale: 1.07, fontKey: 'inter' },
      },
    }),
  },
  // CARRIED (no proof page uses it — kept verbatim)
{
    id: 'eq-frame', name: 'Full-bleed frame', themeId: 'equip',
    apply: () => ({
      bgColor: BLACK,
      extras: [],
      layout: {
        image: {},
        kicker: kick(),
        title: { hidden: true },
        body: { box: { x: 0.05, y: 0.88, w: 0.6, h: 0.08 }, color: CREAM, fontKey: DISPLAY, italic: true, dir: 'ltr', fontScale: 0.7 },
      },
    }),
  },
];

export const equipLayouts = equip;
