// Cinema Match (Mechanism 1, in-app) — measures how far a frame's "cinema
// fingerprint" sits from the real dna_corpus distribution (CINEMA_BANK), and
// auto-tunes the Emulsion camera model to pull it closest.
//
// Mirrors the offline Python (02_PRODUCT/dna_corpus/calibration/) but uses a
// 10-feature subset that needs no FFT, so it runs live in the renderer. The
// reference bank and this extractor share the 768px working resolution.

import { renderEmulsion, CAMERA_DEFAULT, BODIES, LENSES, STOCKS,
         type CameraChoice, type ScenePreset } from './emulsion';
import { CINEMA_BANK } from './cinemaReference';

const WORK = 768;

// features computed in-app (no spectral — those need an FFT). Names match the bank.
export const APP_FEATURES = ['black_p1','hi_headroom','clip_frac','median_luma',
  'contrast_iqr','sat_mean','hi_desat_slope','warmth','acutance','grain'] as const;
type Feat = Record<string, number>;

const WEIGHT: Record<string, number> = {
  black_p1: 1.2, hi_headroom: 1.2, clip_frac: 0.8, median_luma: 0.1, contrast_iqr: 0.6,
  sat_mean: 0.6, hi_desat_slope: 1.2, warmth: 0.4, acutance: 1.2, grain: 1.0,
};

// ---------------- helpers ----------------
// canvas factory that works on the main thread AND inside a Web Worker
function makeCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

export function resizeImageData(img: ImageData, w: number): ImageData {
  if (img.width <= w) return img;
  const h = Math.round(img.height * w / img.width);
  const src = makeCanvas(img.width, img.height);
  (src.getContext('2d') as any).putImageData(img, 0, 0);
  const dst = makeCanvas(w, h);
  const ctx = dst.getContext('2d') as any; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

function boxBlur(plane: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return plane.slice();
  const pass = (s: Float32Array, d: Float32Array, horiz: boolean) => {
    const norm = 1 / (2 * r + 1);
    if (horiz) for (let y = 0; y < h; y++) {
      const row = y * w; let acc = 0;
      for (let i = -r; i <= r; i++) acc += s[row + Math.min(w - 1, Math.max(0, i))];
      for (let x = 0; x < w; x++) { d[row + x] = acc * norm; acc += s[row + Math.min(w-1, x+r+1)] - s[row + Math.max(0, x-r)]; }
    } else for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += s[Math.min(h-1, Math.max(0, i))*w + x];
      for (let y = 0; y < h; y++) { d[y*w + x] = acc * norm; acc += s[Math.min(h-1, y+r+1)*w + x] - s[Math.max(0, y-r)*w + x]; }
    }
  };
  let a = plane.slice(); const b = new Float32Array(plane.length);
  for (let p = 0; p < 2; p++) { pass(a, b, true); pass(b, a, false); }
  return a;
}

function percentile(sorted: Float32Array, q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];
}

// ---------------- the 10-feature cinema fingerprint ----------------
export function cinemaFeatures(imgIn: ImageData): Feat {
  const img = resizeImageData(imgIn, WORK);
  const w = img.width, h = img.height, n = w * h, d = img.data;
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n), L = new Float32Array(n);
  const sat = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = d[i*4]/255, g = d[i*4+1]/255, b = d[i*4+2]/255;
    R[i] = r; G[i] = g; B[i] = b;
    L[i] = r*0.2126 + g*0.7152 + b*0.0722;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    sat[i] = (mx - mn) / (mx + 1e-4);
  }
  const Ls = L.slice().sort();
  const f: Feat = {};
  f.black_p1 = percentile(Ls, 0.01);
  const top = Math.max(1, Math.floor(n / 100));
  let hsum = 0; for (let i = n - top; i < n; i++) hsum += Ls[i]; f.hi_headroom = hsum / top;
  let clip = 0; for (let i = 0; i < n; i++) if (L[i] > 0.98) clip++; f.clip_frac = clip / n;
  f.median_luma = percentile(Ls, 0.5);
  f.contrast_iqr = percentile(Ls, 0.75) - percentile(Ls, 0.25);

  let ssum = 0; for (let i = 0; i < n; i++) ssum += sat[i]; f.sat_mean = ssum / n;

  // highlight desaturation slope: least-squares sat vs luma for luma>0.5
  let sx=0, sy=0, sxx=0, sxy=0, cnt=0;
  for (let i = 0; i < n; i++) if (L[i] > 0.5) { sx+=L[i]; sy+=sat[i]; sxx+=L[i]*L[i]; sxy+=L[i]*sat[i]; cnt++; }
  f.hi_desat_slope = cnt > 100 ? (cnt*sxy - sx*sy) / Math.max(cnt*sxx - sx*sx, 1e-6) : 0;

  // warmth: meanR/meanB on mids
  let mr=0, mb=0, mc=0;
  for (let i = 0; i < n; i++) if (L[i] > 0.08 && L[i] < 0.85) { mr+=R[i]; mb+=B[i]; mc++; }
  f.warmth = mc > 100 ? (mr/mc) / Math.max(mb/mc, 1e-4) : 1.0;

  // acutance: std(rgb - blur) / std(rgb)
  const bR = boxBlur(R, w, h, 2), bG = boxBlur(G, w, h, 2), bB = boxBlur(B, w, h, 2);
  let hpM=0, imM=0; for (let i=0;i<n;i++){ hpM += (R[i]-bR[i])+(G[i]-bG[i])+(B[i]-bB[i]); imM += R[i]+G[i]+B[i]; }
  hpM/=(3*n); imM/=(3*n);
  let hpV=0, imV=0;
  for (let i=0;i<n;i++){ const a=(R[i]-bR[i])-hpM,b=(G[i]-bG[i])-hpM,c=(B[i]-bB[i])-hpM; hpV+=a*a+b*b+c*c;
    const p=R[i]-imM,q=G[i]-imM,r=B[i]-imM; imV+=p*p+q*q+r*r; }
  f.acutance = Math.sqrt(hpV/(3*n)) / (Math.sqrt(imV/(3*n)) + 1e-6);

  // grain: median local std in the flattest 20% of 16px blocks (on luma)
  const bl = 16, bw = Math.floor(w/bl), bh = Math.floor(h/bl);
  const stds: number[] = [];
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    let m=0, v=0; const c = bl*bl;
    for (let y=0;y<bl;y++) for (let x=0;x<bl;x++) m += L[(by*bl+y)*w + bx*bl+x];
    m/=c;
    for (let y=0;y<bl;y++) for (let x=0;x<bl;x++){ const dd=L[(by*bl+y)*w + bx*bl+x]-m; v+=dd*dd; }
    stds.push(Math.sqrt(v/c));
  }
  stds.sort((a,b)=>a-b);
  const flatN = Math.max(1, Math.floor(stds.length*0.2));
  f.grain = stds.length ? stds[Math.floor(flatN/2)] : 0;
  return f;
}

// ---------------- distance to real cinema ----------------
export function cinemaDistance(f: Feat): number {
  const regime = f.median_luma < 0.22 ? 'night' : 'day';
  const ref = (CINEMA_BANK as any)[regime];
  let num = 0, den = 0;
  for (const k of APP_FEATURES) {
    const z = (f[k] - ref.mean[k]) / ref.std[k];
    const wt = WEIGHT[k]; num += wt*z*z; den += wt;
  }
  return Math.sqrt(num / den);
}

export interface MatchResult { choice: CameraChoice; before: number; after: number; }

const tick = () => new Promise<void>(r => setTimeout(r, 0));

// greedy coordinate descent over the camera model, minimising distance to real
// cinema. Async + yields between trials so the UI can paint progress.
export async function autoMatch(source: ImageData, onProgress?: (p: number) => void): Promise<MatchResult> {
  const small = resizeImageData(source, WORK);
  const before = cinemaDistance(cinemaFeatures(small));
  const score = (c: CameraChoice) => cinemaDistance(cinemaFeatures(renderEmulsion(small, c).image));

  let choice: CameraChoice = { ...CAMERA_DEFAULT };
  let best = score(choice);
  const axes: Array<[keyof CameraChoice, any[]]> = [
    ['body', Object.keys(BODIES)],
    ['lens', Object.keys(LENSES)],
    ['stock', Object.keys(STOCKS)],
    ['intensity', [0.5, 0.75, 1.0, 1.25]],
    ['scenePreset', ['auto','day','night','studio','golden'] as ScenePreset[]],
  ];
  const total = 2 * axes.reduce((s,[,o]) => s + o.length, 0);
  let done = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (const [key, opts] of axes) {
      let localBest = best, localVal = choice[key];
      for (const o of opts) {
        done++; onProgress?.(done / total); await tick();
        if (o === choice[key]) continue;
        const trial = { ...choice, [key]: o } as CameraChoice;
        const dd = score(trial);
        if (dd < localBest) { localBest = dd; localVal = o; }
      }
      best = localBest; (choice as any)[key] = localVal;
    }
  }
  return { choice, before, after: best };
}
