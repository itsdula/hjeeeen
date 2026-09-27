// Depth-aware defocus (scene-aware Level 2) — ACCURATE rebuild.
//   depth: Apple Depth Pro METRIC depth (metres), delivered as an 8-bit map
//          (0=nearest, 255=farthest) + a { minM, maxM } range to reconstruct metres.
//   blur:  physically-correct thin-lens CIRCLE OF CONFUSION (asymmetric near/far).
//   render: OCCLUSION-AWARE layered premultiplied-RGBA (far→near) so the background
//           never bleeds onto the sharp subject edge (Portrait-Mode-style).
// Runs live in the Emulsion worker; focus (metres) + aperture (f-number) are sliders,
// click-to-focus reads true metric depth at the tapped point.

export interface MeterRange { minM: number; maxM: number; }
export interface DofParams {
  focus: number | 'auto';   // focus distance in METRES (or 'auto' = near subject)
  fnum: number;             // aperture f-number (smaller = shallower DoF, more blur)
  haze: number;             // 0..~0.3 distance haze
  focalMm?: number;         // default 50
  sensorMm?: number;        // default 36 (full-frame width)
}

function blurPlane(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return src.slice();
  const box = (s: Float32Array, d: Float32Array, horiz: boolean) => {
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
  let a = src.slice(); const b = new Float32Array(src.length);
  for (let p = 0; p < 2; p++) { box(a, b, true); box(b, a, false); }
  return a;
}

function pct(sorted: Float32Array, q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
}

/** Reconstruct metric depth (metres) into a plane matching rgb, coord-scaled. */
function metersPlane(depth: ImageData, range: MeterRange, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  const dw = depth.width, dh = depth.height, dd = depth.data;
  const sx = dw / w, sy = dh / h, span = range.maxM - range.minM;
  for (let y = 0; y < h; y++) {
    const my = Math.min(dh - 1, (y * sy) | 0);
    for (let x = 0; x < w; x++) {
      const mx = Math.min(dw - 1, (x * sx) | 0);
      out[y*w + x] = range.minM + (dd[(my*dw + mx) * 4] / 255) * span;
    }
  }
  return out;
}

/** Apply physically-based, occlusion-aware depth-of-field. */
export function depthDefocus(rgb: ImageData, depth: ImageData, range: MeterRange, p: DofParams): ImageData {
  const w = rgb.width, h = rgb.height, n = w * h, d = rgb.data;
  const meters = metersPlane(depth, range, w, h);
  const focalMm = p.focalMm ?? 50, sensorMm = p.sensorMm ?? 36;
  const f = focalMm / 1000;                                  // metres
  const A = f / Math.max(p.fnum, 0.5);                       // aperture diameter (m)

  // focus distance (metres)
  let S1: number;
  if (p.focus === 'auto') {
    const s = new Float32Array(Math.min(n, 40000));
    for (let i = 0; i < s.length; i++) s[i] = meters[((i * (n / s.length)) | 0)];
    s.sort(); S1 = pct(s, 0.15);                             // near subject
  } else S1 = p.focus;
  S1 = Math.max(S1, f + 1e-3);

  // thin-lens circle of confusion -> blur radius in pixels (asymmetric near/far)
  const pxPerM = w / (sensorMm / 1000);
  const maxPx = 0.02 * Math.sqrt(w*w + h*h);
  const coc = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const S2 = Math.max(meters[i], f + 1e-3);
    const cocM = A * Math.abs(S2 - S1) / S2 * (f / (S1 - f));
    coc[i] = Math.min(cocM * pxPerM, maxPx);
  }

  // planar rgb
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0; i < n; i++) { R[i] = d[i*4]/255; G[i] = d[i*4+1]/255; B[i] = d[i*4+2]/255; }

  // occlusion-aware layered render: split by depth, blur each premultiplied layer, composite far->near
  const sortM = meters.slice().sort();
  const lo = pct(sortM, 0.01), hi = pct(sortM, 0.99), LAYERS = 6;
  const accR = new Float32Array(n), accG = new Float32Array(n), accB = new Float32Array(n), accA = new Float32Array(n);
  for (let li = LAYERS - 1; li >= 0; li--) {
    const d0 = lo + (hi - lo) * (li / LAYERS), d1 = lo + (hi - lo) * ((li + 1) / LAYERS);
    const mask = new Float32Array(n); let cocSum = 0, cnt = 0;
    for (let i = 0; i < n; i++) {
      const inLayer = li === 0 ? meters[i] < d1 : (meters[i] >= d0 && meters[i] < d1);
      if (inLayer) { mask[i] = 1; cocSum += coc[i]; cnt++; }
    }
    if (cnt === 0) continue;
    const r = Math.round(cocSum / cnt);
    const softMask = blurPlane(mask, w, h, 1);
    const pmR = new Float32Array(n), pmG = new Float32Array(n), pmB = new Float32Array(n);
    for (let i = 0; i < n; i++) { pmR[i] = R[i]*softMask[i]; pmG[i] = G[i]*softMask[i]; pmB[i] = B[i]*softMask[i]; }
    const bR = blurPlane(pmR, w, h, r), bG = blurPlane(pmG, w, h, r), bB = blurPlane(pmB, w, h, r), bA = blurPlane(softMask, w, h, r);
    for (let i = 0; i < n; i++) {
      const inv = 1 - bA[i];
      accR[i] = accR[i]*inv + bR[i]; accG[i] = accG[i]*inv + bG[i];
      accB[i] = accB[i]*inv + bB[i]; accA[i] = accA[i]*inv + bA[i];
    }
  }

  const out = new Uint8ClampedArray(d.length);
  for (let i = 0; i < n; i++) {
    const a = Math.max(accA[i], 1e-4);
    let rr = accR[i]/a, gg = accG[i]/a, bb = accB[i]/a;
    if (p.haze > 0) {
      const far = Math.min(1, Math.max(0, (meters[i] - S1) / Math.max(hi - S1, 1e-3)));
      const hz = p.haze * far, L = rr*0.2126 + gg*0.7152 + bb*0.0722;
      rr = rr*(1-hz) + (L*0.5 + 0.62*0.5)*hz;
      gg = gg*(1-hz) + (L*0.5 + 0.66*0.5)*hz;
      bb = bb*(1-hz) + (L*0.5 + 0.72*0.5)*hz;
    }
    out[i*4] = rr*255; out[i*4+1] = gg*255; out[i*4+2] = bb*255; out[i*4+3] = d[i*4+3];
  }
  return new ImageData(out, w, h);
}

/** Metric depth (metres) at a normalised point (fx,fy in 0..1) — for click-to-focus. */
export function depthAt(depth: ImageData, range: MeterRange, fx: number, fy: number): number {
  const x = Math.min(depth.width - 1, Math.max(0, (fx * depth.width) | 0));
  const y = Math.min(depth.height - 1, Math.max(0, (fy * depth.height) | 0));
  return range.minM + (depth.data[(y*depth.width + x) * 4] / 255) * (range.maxM - range.minM);
}
