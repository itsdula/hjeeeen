// Segmentation-aware treatment (scene-aware Level 2b) — applied AFTER the emulsion
// look, using masks computed once by worldkit/segment_cli.py.
//   skin protect: restore the (in-focus) base's texture + suppress grain on faces
//                 while keeping the graded tone — the retoucher's "protect skin".
//   sky treat:    de-grain the sky (grain is ugliest in flat sky).
// Masks are grayscale ImageData (may differ in resolution; coords are scaled).

export interface SegMasks { skin?: ImageData | null; sky?: ImageData | null; }
export interface SegOpts { skinProtect: number; skyTreat: number; }   // 0..1 strengths

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
  box(a, b, true); box(b, a, false);
  return a;
}

function sampleMask(mask: ImageData, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  const mw = mask.width, mh = mask.height, md = mask.data;
  const sx = mw / w, sy = mh / h;
  for (let y = 0; y < h; y++) {
    const my = Math.min(mh - 1, (y * sy) | 0);
    for (let x = 0; x < w; x++) {
      const mx = Math.min(mw - 1, (x * sx) | 0);
      out[y*w + x] = md[(my*mw + mx) * 4] / 255;
    }
  }
  return out;
}

/** Apply skin protect + sky treatment. `emul` = the emulsion look output;
 *  `base` = the in-focus capture-stage frame (for restoring texture on skin). */
export function applySegTreatment(emul: ImageData, base: ImageData, masks: SegMasks, opts: SegOpts): ImageData {
  const w = emul.width, h = emul.height, n = w * h;
  const e = emul.data, b = base.data;
  const out = new Uint8ClampedArray(e.length); out.set(e);

  const hasSkin = masks.skin && opts.skinProtect > 0;
  const hasSky = masks.sky && opts.skyTreat > 0;
  if (!hasSkin && !hasSky) return new ImageData(out, w, h);

  // planar emul + base (only if needed)
  const eR = new Float32Array(n), eG = new Float32Array(n), eB = new Float32Array(n);
  for (let i = 0; i < n; i++) { eR[i] = e[i*4]/255; eG[i] = e[i*4+1]/255; eB[i] = e[i*4+2]/255; }

  if (hasSkin) {
    const skinM = sampleMask(masks.skin!, w, h);
    const bR = new Float32Array(n), bG = new Float32Array(n), bB = new Float32Array(n);
    for (let i = 0; i < n; i++) { bR[i] = b[i*4]/255; bG[i] = b[i*4+1]/255; bB[i] = b[i*4+2]/255; }
    const eLoR = blurPlane(eR, w, h, 2), eLoG = blurPlane(eG, w, h, 2), eLoB = blurPlane(eB, w, h, 2);
    const bLoR = blurPlane(bR, w, h, 2), bLoG = blurPlane(bG, w, h, 2), bLoB = blurPlane(bB, w, h, 2);
    for (let i = 0; i < n; i++) {
      const m = skinM[i] * opts.skinProtect;
      if (m <= 0) continue;
      // graded low-freq (tone) + original texture (grain removed)
      const rr = eLoR[i] + (bR[i] - bLoR[i]);
      const gg = eLoG[i] + (bG[i] - bLoG[i]);
      const bb = eLoB[i] + (bB[i] - bLoB[i]);
      out[i*4]   = (eR[i]*(1-m) + rr*m) * 255;
      out[i*4+1] = (eG[i]*(1-m) + gg*m) * 255;
      out[i*4+2] = (eB[i]*(1-m) + bb*m) * 255;
    }
  }

  if (hasSky) {
    const skyM = sampleMask(masks.sky!, w, h);
    // read possibly-updated out into planar, de-grain sky by blending toward a light blur
    const oR = new Float32Array(n), oG = new Float32Array(n), oB = new Float32Array(n);
    for (let i = 0; i < n; i++) { oR[i] = out[i*4]/255; oG[i] = out[i*4+1]/255; oB[i] = out[i*4+2]/255; }
    const sR = blurPlane(oR, w, h, 2), sG = blurPlane(oG, w, h, 2), sB = blurPlane(oB, w, h, 2);
    for (let i = 0; i < n; i++) {
      const m = skyM[i] * opts.skyTreat;
      if (m <= 0) continue;
      out[i*4]   = (oR[i]*(1-m) + sR[i]*m) * 255;
      out[i*4+1] = (oG[i]*(1-m) + sG[i]*m) * 255;
      out[i*4+2] = (oB[i]*(1-m) + sB[i]*m) * 255;
    }
  }
  return new ImageData(out, w, h);
}
