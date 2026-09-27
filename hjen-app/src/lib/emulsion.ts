// HJEN Emulsion — the "Camera Body × Lens × Film" layer.
//
// A deterministic, LOCAL (no-API, offline) post-processing pass that pushes an
// AI-generated frame toward a real cinema-camera look: soft highlight roll-off,
// highlight desaturation, amber halation, managed micro-contrast (acutance),
// luminance-weighted film grain, veiling-glare black-lift, vignette + CA.
//
// Ported 1:1 from the verified Python prototype (emulsion.py / camera_model.py).
// Provenance of the numbers:
//   [KNOWN]  ARRI LogC roll-off, halation physics, grain-weighting, acutance,
//            lens micro-contrast RANK (Zeiss>ARRI>Cooke), veiling-glare 0.3-0.6%,
//            cos^4 vignette shape.
//   [PROV]   grain amplitudes (Kodak publishes no scalar RMS — curve-read est.),
//            CA / vignette magnitude / Black Pro-Mist grades (tuned by eye).
//
// Runs entirely on Float32 planar buffers; blur is a dependency-free 3-pass box
// blur (≈Gaussian). Works on an ImageData in, ImageData out.

// ------------------------------------------------------------------ types
export interface EmulsionParams {
  // stage 2 — optics
  glare: number; black_lift: number;
  halation: number; hal_thresh: number; hal_radius: number; hal_color: [number, number, number];
  bloom: number;
  // stage 3 — display render
  knee: number; rolloff: number;
  hd_start: number; hd_amount: number; hd_warm: [number, number, number];
  scontrast: number;
  // stage 4 — acutance
  acutance: number; acut_sigma: number;
  // stage 5 — grain
  grain: number; grain_size: number;
  // stage 6 — lens
  vignette: number; ca: number;
}

export type BodyId = 'alexa_mini_lf' | 'alexa_35' | 'venice' | 'neutral';
export type LensId = 'cooke_s4' | 'arri_signature' | 'zeiss_master' | 'vintage_ana' | 'modern_promist';
export type StockId = 'vision3_50d' | 'vision3_250d' | 'vision3_500t' | 'cinestill_800t' | 'none';
export type ScanRes = '2K' | '4K';
export type ScenePreset = 'auto' | 'day' | 'night' | 'studio' | 'golden' | 'neon';
export type DistortionType = 'none' | 'barrel' | 'pincushion' | 'fisheye' | 'mustache' | 'anamorphic';

export interface CameraChoice {
  body: BodyId; lens: LensId; stock: StockId;
  intensity: number;        // 0..1.5 — scales the added effects
  scan: ScanRes;
  sceneAdaptive: boolean;
  scenePreset: ScenePreset;
  distortionType: DistortionType;   // lens geometric distortion profile
  distortionAmount: number;         // 0..1 — slider strength
}

export interface SceneInfo { warmth: number; key: number; night: number; warm: number; }

// ------------------------------------------------------------------ base preset (verified defaults)
export const BASE: EmulsionParams = {
  glare: 0.028, black_lift: 0.0025,
  halation: 0.10, hal_thresh: 0.68, hal_radius: 0.009, hal_color: [1.0, 0.50, 0.24],
  bloom: 0.06,
  knee: 0.66, rolloff: 0.80,
  hd_start: 0.74, hd_amount: 0.45, hd_warm: [1.0, 0.975, 0.93],
  scontrast: 0.10,
  acutance: 0.32, acut_sigma: 1.4,
  grain: 0.011, grain_size: 0.62,
  vignette: 0.14, ca: 0.0018,
};

// ------------------------------------------------------------------ camera components
type Partial2 = Partial<EmulsionParams>;

export const BODIES: Record<BodyId, Partial2> = {
  alexa_mini_lf: { knee: 0.66, rolloff: 0.80, hd_start: 0.74, hd_amount: 0.45, scontrast: 0.10 },
  alexa_35:      { knee: 0.62, rolloff: 0.88, hd_start: 0.70, hd_amount: 0.50, scontrast: 0.08 },
  venice:        { knee: 0.72, rolloff: 0.62, hd_start: 0.80, hd_amount: 0.30, scontrast: 0.14 },
  neutral:       { knee: 0.75, rolloff: 0.45, hd_start: 0.82, hd_amount: 0.22, scontrast: 0.06 },
};

// acutance keyed to VERIFIED micro-contrast rank Zeiss>ARRI>Cooke (Cooke = most softening)
// black_lift keyed to VERIFIED veiling glare 0.3-0.6%
export const LENSES: Record<LensId, Partial2> = {
  cooke_s4:       { acutance: 0.40, ca: 0.0020, vignette: 0.16, glare: 0.030, bloom: 0.06,  black_lift: 0.0035 },
  arri_signature: { acutance: 0.28, ca: 0.0012, vignette: 0.12, glare: 0.022, bloom: 0.045, black_lift: 0.0032 },
  zeiss_master:   { acutance: 0.16, ca: 0.0008, vignette: 0.10, glare: 0.016, bloom: 0.03,  black_lift: 0.0030 },
  vintage_ana:    { acutance: 0.50, ca: 0.0035, vignette: 0.26, glare: 0.055, bloom: 0.11,  black_lift: 0.0060 },
  modern_promist: { acutance: 0.30, ca: 0.0014, vignette: 0.14, glare: 0.045, bloom: 0.14,  black_lift: 0.0045 },
};

// grain amplitudes are CURVE-READ ESTIMATES (Kodak publishes no scalar RMS); order 50D<250D<500T is physical
export const STOCKS: Record<StockId, Partial2> = {
  vision3_50d:    { grain: 0.007, grain_size: 0.55, halation: 0.08, hal_color: [1.0, 0.50, 0.24] },
  vision3_250d:   { grain: 0.011, grain_size: 0.62, halation: 0.10, hal_color: [1.0, 0.50, 0.24] },
  vision3_500t:   { grain: 0.017, grain_size: 0.72, halation: 0.13, hal_color: [1.0, 0.48, 0.22] },
  cinestill_800t: { grain: 0.018, grain_size: 0.75, halation: 0.22, hal_color: [1.0, 0.32, 0.14] },
  none:           { grain: 0.0,   grain_size: 0.6,  halation: 0.0,  hal_color: [1.0, 0.50, 0.25] },
};

// Selwyn sqrt-area law: 4K pixel covers ~1/4 the film area of 2K -> ~2x coarser per pixel
export const SCAN_GRAIN: Record<ScanRes, number> = { '2K': 1.0, '4K': 1.5 };

// manual scene overrides (force the two factors); null = fully automatic
const MANUAL: Record<Exclude<ScenePreset, 'auto'>, { night: number; warm: number }> = {
  day:    { night: 0.0, warm: 0.25 },
  night:  { night: 1.0, warm: 0.0 },
  studio: { night: 0.0, warm: 1.0 },
  golden: { night: 0.3, warm: 0.85 },
  neon:   { night: 0.9, warm: 0.0 },
};

export const CAMERA_DEFAULT: CameraChoice = {
  body: 'alexa_mini_lf', lens: 'cooke_s4', stock: 'vision3_250d',
  intensity: 1.0, scan: '2K', sceneAdaptive: true, scenePreset: 'auto',
  distortionType: 'none', distortionAmount: 0.5,
};

// lens geometric distortion — Brown-Conrady radial (k1,k2) + anamorphic scale (ax,ay)
// at amount=1.0; scaled linearly by the slider. Verified directions in the prototype.
export const DISTORTION_PROFILES: Record<DistortionType, [number, number, number, number]> = {
  none:       [0.0,   0.0,   1.0,   1.0],
  barrel:     [-0.18, -0.04, 1.0,   1.0],    // wide lens — lines bow out
  pincushion: [ 0.18,  0.05, 1.0,   1.0],    // tele — lines bow in
  fisheye:    [-0.38, -0.14, 1.0,   1.0],    // strong barrel
  mustache:   [-0.16,  0.12, 1.0,   1.0],    // wave — barrel centre, pincushion edge
  anamorphic: [-0.12, -0.03, 1.03,  0.985],  // horizontal bulge + slight vertical squeeze
};

export const DISTORTION_LABELS: Record<DistortionType, string> = {
  none: 'None', barrel: 'Barrel (wide)', pincushion: 'Pincushion (tele)',
  fisheye: 'Fisheye', mustache: 'Mustache', anamorphic: 'Anamorphic',
};

// human labels for the UI
export const BODY_LABELS: Record<BodyId, string> = {
  alexa_mini_lf: 'ARRI Alexa Mini LF', alexa_35: 'ARRI Alexa 35', venice: 'Sony Venice', neutral: 'Neutral',
};
export const LENS_LABELS: Record<LensId, string> = {
  cooke_s4: 'Cooke S4', arri_signature: 'ARRI Signature', zeiss_master: 'Zeiss Master',
  vintage_ana: 'Vintage Anamorphic', modern_promist: 'Modern + Black Pro-Mist',
};
export const STOCK_LABELS: Record<StockId, string> = {
  vision3_50d: 'Vision3 50D', vision3_250d: 'Vision3 250D', vision3_500t: 'Vision3 500T',
  cinestill_800t: 'CineStill 800T', none: 'Digital (no stock)',
};

// ------------------------------------------------------------------ compose
export function buildPreset(c: CameraChoice): EmulsionParams {
  const p: EmulsionParams = { ...BASE, ...BODIES[c.body], ...LENSES[c.lens], ...STOCKS[c.stock] } as EmulsionParams;
  p.grain *= SCAN_GRAIN[c.scan] ?? 1.0;
  const k = c.intensity;
  if (k !== 1.0) {
    for (const key of ['halation','bloom','glare','grain','vignette','ca','acutance','hd_amount','black_lift'] as const) {
      (p as any)[key] *= k;
    }
  }
  return p;
}

function adapt(base: EmulsionParams, night: number, warm: number): EmulsionParams {
  const p = { ...base };
  const wWarm: [number,number,number] = [1.0, 0.975, 0.930];
  const wNeutral: [number,number,number] = [1.0, 0.992, 0.978];
  p.hd_warm = [0,1,2].map(i => wWarm[i]*(1-warm) + wNeutral[i]*warm) as [number,number,number];
  p.hd_amount   = base.hd_amount   * (1 - 0.35*warm);
  p.halation    = base.halation    * (1 - 0.50*night) * (1 - 0.30*warm);
  p.grain       = base.grain       * (1 - 0.50*night);
  p.vignette    = base.vignette    * (1 - 0.50*night);
  p.glare       = base.glare       * (1 - 0.40*night);
  p.black_lift  = base.black_lift  * (1 - 0.60*night);
  return p;
}

// ------------------------------------------------------------------ math helpers
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / Math.max(e1 - e0, 1e-6)));
  return t * t * (3 - 2 * t);
};
const srgbToLinear = (x: number) => x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
const linearToSrgb = (x: number) => { x = x < 0 ? 0 : x; return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1/2.4) - 0.055; };
const LUMA = (r: number, g: number, b: number) => r*0.2126 + g*0.7152 + b*0.0722;

// deterministic PRNG (mulberry32) so grain is stable across renders
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// standard-normal via Box-Muller
function gaussianNoise(n: number, seed: number): Float32Array {
  const out = new Float32Array(n); const r = rng(seed);
  for (let i = 0; i < n; i += 2) {
    const u1 = Math.max(r(), 1e-7), u2 = r();
    const mag = Math.sqrt(-2 * Math.log(u1));
    out[i] = mag * Math.cos(2 * Math.PI * u2);
    if (i + 1 < n) out[i + 1] = mag * Math.sin(2 * Math.PI * u2);
  }
  return out;
}

// separable box blur (one pass) with clamped edges — operates in place via scratch
function boxBlur1D(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, horizontal: boolean) {
  if (r < 1) { dst.set(src); return; }
  const norm = 1 / (2 * r + 1);
  if (horizontal) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += src[row + Math.min(w - 1, Math.max(0, i))];
      for (let x = 0; x < w; x++) {
        dst[row + x] = acc * norm;
        const add = src[row + Math.min(w - 1, x + r + 1)];
        const sub = src[row + Math.max(0, x - r)];
        acc += add - sub;
      }
    }
  } else {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += src[Math.min(h - 1, Math.max(0, i)) * w + x];
      for (let y = 0; y < h; y++) {
        dst[y * w + x] = acc * norm;
        const add = src[Math.min(h - 1, y + r + 1) * w + x];
        const sub = src[Math.max(0, y - r) * w + x];
        acc += add - sub;
      }
    }
  }
}
// 3-pass box blur ≈ Gaussian of the given sigma
function gaussBlur(plane: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma <= 0.4) return plane.slice();
  const r = Math.max(1, Math.round(sigma));
  let a = plane.slice(); const b = new Float32Array(plane.length);
  for (let p = 0; p < 3; p++) { boxBlur1D(a, b, w, h, r, true); boxBlur1D(b, a, w, h, r, false); }
  return a;
}

// bilinear sample of a plane at (fx,fy) in pixel coords
function sample(plane: Float32Array, w: number, h: number, fx: number, fy: number): number {
  fx = Math.min(w - 1, Math.max(0, fx)); fy = Math.min(h - 1, Math.max(0, fy));
  const x0 = fx | 0, y0 = fy | 0, x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const dx = fx - x0, dy = fy - y0;
  const a = plane[y0 * w + x0], bb = plane[y0 * w + x1], c = plane[y1 * w + x0], d = plane[y1 * w + x1];
  return a * (1 - dx) * (1 - dy) + bb * dx * (1 - dy) + c * (1 - dx) * dy + d * dx * dy;
}

// ------------------------------------------------------------------ scene analysis
export function analyze(data: Uint8ClampedArray): { key: number; warmth: number } {
  const n = data.length / 4;
  // perceptual (display) luma median via 256-bin histogram; warmth = meanR/meanB on mids
  const hist = new Uint32Array(256);
  let sr = 0, sb = 0, cnt = 0;
  for (let i = 0; i < n; i++) {
    const r = data[i*4] / 255, g = data[i*4+1] / 255, b = data[i*4+2] / 255;
    const L = LUMA(r, g, b);
    hist[Math.min(255, (L * 255) | 0)]++;
    if (L > 0.08 && L < 0.85) { sr += r; sb += b; cnt++; }
  }
  let acc = 0, half = n / 2, key = 0.5;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= half) { key = i / 255; break; } }
  const warmth = cnt > 0 ? (sr / cnt) / Math.max(sb / cnt, 1e-4) : 1.0;
  return { key, warmth };
}

// ------------------------------------------------------------------ the pipeline
/** Apply the emulsion pass to an ImageData in place-safe fashion; returns a new ImageData. */
export function applyEmulsion(img: ImageData, params: EmulsionParams): ImageData {
  const w = img.width, h = img.height, n = w * h;
  const src = img.data;
  const diag = Math.sqrt(w*w + h*h);
  const p = params;

  // planar linear buffers
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    R[i] = srgbToLinear(src[i*4] / 255);
    G[i] = srgbToLinear(src[i*4+1] / 255);
    B[i] = srgbToLinear(src[i*4+2] / 255);
  }

  // --- 2a veiling glare / black-lift ---
  if (p.glare > 0) {
    const s = diag * 0.03;
    const gr = gaussBlur(R, w, h, s), gg = gaussBlur(G, w, h, s), gb = gaussBlur(B, w, h, s);
    for (let i = 0; i < n; i++) {
      R[i] += p.glare * gr[i] + p.black_lift;
      G[i] += p.glare * gg[i] + p.black_lift;
      B[i] += p.glare * gb[i] + p.black_lift;
    }
  }

  // --- 2b halation (amber, from highlights) ---
  if (p.halation > 0) {
    const hi = new Float32Array(n);
    for (let i = 0; i < n; i++) hi[i] = smoothstep(p.hal_thresh, p.hal_thresh + 0.35, LUMA(R[i], G[i], B[i]));
    const hb = gaussBlur(hi, w, h, diag * p.hal_radius);
    const [ar, ag, ab] = p.hal_color;
    for (let i = 0; i < n; i++) { R[i] += p.halation*hb[i]*ar; G[i] += p.halation*hb[i]*ag; B[i] += p.halation*hb[i]*ab; }
  }

  // --- 2c bloom / diffusion ---
  if (p.bloom > 0) {
    const hr = new Float32Array(n), hg = new Float32Array(n), hb = new Float32Array(n);
    for (let i = 0; i < n; i++) { const m = smoothstep(0.55, 1.0, LUMA(R[i], G[i], B[i])); hr[i]=m*R[i]; hg[i]=m*G[i]; hb[i]=m*B[i]; }
    const br = gaussBlur(hr, w, h, diag*0.012), bg = gaussBlur(hg, w, h, diag*0.012), bb = gaussBlur(hb, w, h, diag*0.012);
    for (let i = 0; i < n; i++) { R[i] += p.bloom*br[i]; G[i] += p.bloom*bg[i]; B[i] += p.bloom*bb[i]; }
  }

  // --- 3 display-render: soft roll-off + highlight desaturation ---
  const k = p.knee, ik = Math.max(1 - k, 1e-6);
  const [wr, wg, wb] = p.hd_warm;
  const out = new Uint8ClampedArray(src.length);
  const disp = new Float32Array(n * 3); // hold display rgb for later stages
  for (let i = 0; i < n; i++) {
    let r = R[i], g = G[i], b = B[i];
    // tanh shoulder above knee
    const roll = (v: number) => {
      if (v <= k) return v;
      const rolled = k + ik * Math.tanh((v - k) / ik);
      return k + (rolled - k) * p.rolloff + (v - k) * (1 - p.rolloff);
    };
    r = roll(r); g = roll(g); b = roll(b);
    // highlight desaturation toward warm white
    const L = LUMA(r, g, b);
    const ds = smoothstep(p.hd_start, 1.0, L) * p.hd_amount;
    r = r*(1-ds) + L*wr*ds; g = g*(1-ds) + L*wg*ds; b = b*(1-ds) + L*wb*ds;
    // to display
    let dr = linearToSrgb(r), dg = linearToSrgb(g), db = linearToSrgb(b);
    dr = dr<0?0:dr>1?1:dr; dg = dg<0?0:dg>1?1:dg; db = db<0?0:db>1?1:db;
    // 3b gentle S (fixes endpoints, no re-clip)
    const s = p.scontrast;
    if (s > 0) { dr = dr*(1-s) + (dr*dr*(3-2*dr))*s; dg = dg*(1-s) + (dg*dg*(3-2*dg))*s; db = db*(1-s) + (db*db*(3-2*db))*s; }
    disp[i*3] = dr; disp[i*3+1] = dg; disp[i*3+2] = db;
  }

  // --- 4 acutance (reduce uniform micro-contrast) ---
  if (p.acutance > 0) {
    const pr = new Float32Array(n), pg = new Float32Array(n), pb = new Float32Array(n);
    for (let i = 0; i < n; i++) { pr[i]=disp[i*3]; pg[i]=disp[i*3+1]; pb[i]=disp[i*3+2]; }
    const br = gaussBlur(pr, w, h, p.acut_sigma), bg = gaussBlur(pg, w, h, p.acut_sigma), bb = gaussBlur(pb, w, h, p.acut_sigma);
    for (let i = 0; i < n; i++) {
      disp[i*3]   = pr[i] - p.acutance * (pr[i] - br[i]);
      disp[i*3+1] = pg[i] - p.acutance * (pg[i] - bg[i]);
      disp[i*3+2] = pb[i] - p.acutance * (pb[i] - bb[i]);
    }
  }

  // --- 5 grain (luminance-weighted, fades in deep shadow) ---
  if (p.grain > 0) {
    let noise = gaussBlur(gaussianNoise(n, 7), w, h, p.grain_size);
    // renormalise to unit std
    let mean = 0; for (let i = 0; i < n; i++) mean += noise[i]; mean /= n;
    let v = 0; for (let i = 0; i < n; i++) { const d = noise[i]-mean; v += d*d; } const std = Math.sqrt(v/n) || 1;
    for (let i = 0; i < n; i++) {
      const Lg = LUMA(disp[i*3], disp[i*3+1], disp[i*3+2]);
      let wt = 1 - Math.abs(Lg - 0.42) / 0.55; wt = wt < 0 ? 0 : wt > 1 ? 1 : wt;
      wt *= smoothstep(0.03, 0.16, Lg);
      const gval = p.grain * ((noise[i]-mean)/std) * wt;
      disp[i*3] += gval; disp[i*3+1] += gval; disp[i*3+2] += gval;
    }
  }

  // --- 6a vignette (cos^4-ish r^2 falloff) ---
  const cx = w/2, cy = h/2, hw = w/2, hh = h/2;
  if (p.vignette > 0) {
    for (let i = 0; i < n; i++) {
      const x = i % w, y = (i / w) | 0;
      const rr = Math.min(1, Math.sqrt(((x-cx)/hw)**2 + ((y-cy)/hh)**2));
      const vig = 1 - p.vignette * rr * rr;
      disp[i*3] *= vig; disp[i*3+1] *= vig; disp[i*3+2] *= vig;
    }
  }

  // --- 6b lateral CA (radial: R scaled out, B scaled in about centre) ---
  if (p.ca > 0) {
    const planeR = new Float32Array(n), planeB = new Float32Array(n);
    for (let i = 0; i < n; i++) { planeR[i] = disp[i*3]; planeB[i] = disp[i*3+2]; }
    const sR = 1 + p.ca, sB = 1 - p.ca;
    for (let i = 0; i < n; i++) {
      const x = i % w, y = (i / w) | 0;
      disp[i*3]   = sample(planeR, w, h, cx + (x - cx)/sR, cy + (y - cy)/sR);
      disp[i*3+2] = sample(planeB, w, h, cx + (x - cx)/sB, cy + (y - cy)/sB);
    }
  }

  // pack out
  for (let i = 0; i < n; i++) {
    out[i*4]   = Math.max(0, Math.min(1, disp[i*3]))   * 255;
    out[i*4+1] = Math.max(0, Math.min(1, disp[i*3+1])) * 255;
    out[i*4+2] = Math.max(0, Math.min(1, disp[i*3+2])) * 255;
    out[i*4+3] = src[i*4+3];
  }
  return new ImageData(out, w, h);
}

/** Lens geometric distortion — Brown-Conrady radial remap with auto-fill (no edge smear). */
export function distortImageData(img: ImageData, type: DistortionType, amount: number): ImageData {
  if (type === 'none' || amount <= 0) return img;
  const w = img.width, h = img.height, n = w * h, src = img.data;
  let [k1, k2, ax, ay] = DISTORTION_PROFILES[type];
  k1 *= amount; k2 *= amount; ax = 1 + (ax - 1) * amount; ay = 1 + (ay - 1) * amount;
  const cx = (w - 1) / 2, cy = (h - 1) / 2, norm = Math.sqrt(cx * cx + cy * cy);
  const fCorner = 1 + k1 + k2;
  const fill = 1 / Math.max(1, fCorner);          // pincushion (f>1) zooms in; barrel untouched
  // planar copy for sampling
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0; i < n; i++) { R[i] = src[i*4]; G[i] = src[i*4+1]; B[i] = src[i*4+2]; }
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < n; i++) {
    const x = i % w, y = (i / w) | 0;
    const dx = (x - cx) / norm, dy = (y - cy) / norm;
    const r2 = dx * dx + dy * dy;
    const f = (1 + k1 * r2 + k2 * r2 * r2) * fill;
    const sx = cx + dx * f * ax * norm, sy = cy + dy * f * ay * norm;
    out[i*4]   = sample(R, w, h, sx, sy);
    out[i*4+1] = sample(G, w, h, sx, sy);
    out[i*4+2] = sample(B, w, h, sx, sy);
    out[i*4+3] = src[i*4+3];
  }
  return new ImageData(out, w, h);
}

/** Full entry point: compose Body×Lens×Stock, scene-adapt, apply, distort. Returns {image, scene}. */
export function renderEmulsion(img: ImageData, choice: CameraChoice): { image: ImageData; scene: SceneInfo } {
  const base = buildPreset(choice);
  let params = base;
  let scene: SceneInfo = { warmth: 1, key: 0.5, night: 0, warm: 0 };
  if (choice.sceneAdaptive) {
    const a = analyze(img.data);
    let night = 1 - smoothstep(0.12, 0.34, a.key);
    let warm = smoothstep(1.05, 1.45, a.warmth);
    if (choice.scenePreset !== 'auto') {
      const m = MANUAL[choice.scenePreset]; night = m.night; warm = m.warm;
    }
    params = adapt(base, night, warm);
    scene = { warmth: a.warmth, key: a.key, night, warm };
  }
  let image = applyEmulsion(img, params);
  image = distortImageData(image, choice.distortionType, choice.distortionAmount);
  return { image, scene };
}
