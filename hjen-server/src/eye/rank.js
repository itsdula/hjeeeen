// server/src/eye/rank.js — THE EYE, server-side.
//
// WHY HERE AND NOT IN THE APP. Two reasons, and the second is the binding one:
//   1. The eye needs onnxruntime + sharp (native modules) and a 336 MB model.
//      Putting those inside a signed, notarised, auto-updating Electron app is a
//      real risk for no gain — every consumer of the eye (Creative Mind boards,
//      the References hunt) drives a WEBSITE, so it already needs the network.
//      There is no offline case to protect here.
//   2. House law: the recipe lives server-side, the client is a terminal. The
//      CAVs, the fusion constant and the scoping rule ARE the recipe. The client
//      sends a state and a list of candidate URLs; it gets back an order.
//
// WHAT IT DOES. Frameset (and any image search) ranks by TEXT. It cannot rank by
// how a frame feels, because that is not in the text. The eye scores the pixels:
//   candidate URLs → fetch → CinemaCLIP embedding → CAV probability for the
//   target feeling → fused with the source's own order → a new order.
//
// WHAT IS PROVEN (Anwar's blind judgements, 75 decisive rows over two rounds):
//   · the eye alone beats Frameset's order on `longing` and `joy` — 20-5, p=0.002
//   · on the other four registers it does not — 21-29, so there it is FUSED with
//     the source order instead of overriding it.
// That split is not a preference, it is the measurement. See
// STUDY/context_agents/eye2/FRAMESET.md.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EYE_DIR = process.env.HJEN_EYE_DIR || path.join(HERE, '..', '..', 'eye');
// fp16 first: the staging box is a t4g.small (2 vCPU / 2 GiB) that also serves
// the app, and the fp32 graph is 336 MB on disk before any activation memory.
// The half-precision export is 152 MB and its embeddings are equivalent for
// ranking, which is all we do with them.
const MODEL = process.env.HJEN_EYE_MODEL
  || [path.join(EYE_DIR, 'ImageEncoder_fp16.onnx'), path.join(EYE_DIR, 'ImageEncoder.onnx')]
    .find(f => fs.existsSync(f)) || path.join(EYE_DIR, 'ImageEncoder_fp16.onnx');
const CAVS = path.join(EYE_DIR, 'cavs.json');

const EMB_DIM = 512, SIZE = 256;
const RRF_K = 60;                       // standard RRF constant, not fitted here
const EYE_ALONE = new Set(['longing', 'joy']);   // the two registers it earned
const MAX_CANDIDATES = Number(process.env.HJEN_EYE_MAX || 80);
const FETCH_CONCURRENCY = 8;
// The References hunt runs four lanes at once. Four simultaneous ONNX sessions on
// two cores would not go faster — they would fight for the same cores and stall
// the HTTP thread that serves everyone else. One rank at a time, queued: the
// wall-clock is the same and the box stays responsive.
let _chain = Promise.resolve();
function queued(fn) {
  const run = _chain.then(fn, fn);
  _chain = run.then(() => undefined, () => undefined);
  return run;
}

let _ort = null, _sharp = null, _session = null, _cavs = null, _loadErr = null;

async function load() {
  if (_session && _cavs) return true;
  if (_loadErr) return false;
  try {
    _ort = (await import('onnxruntime-node')).default;
    _sharp = (await import('sharp')).default;
    if (!fs.existsSync(MODEL)) throw new Error(`model missing at ${MODEL}`);
    if (!fs.existsSync(CAVS)) throw new Error(`cavs missing at ${CAVS}`);
    _cavs = JSON.parse(fs.readFileSync(CAVS, 'utf8'));
    _session = await _ort.InferenceSession.create(MODEL, {
      executionProviders: ['cpu'], graphOptimizationLevel: 'all',
      intraOpNumThreads: Number(process.env.HJEN_EYE_THREADS || 2),
      interOpNumThreads: 1,
    });
    return true;
  } catch (e) {
    _loadErr = e.message || String(e);
    return false;
  }
}

export function eyeStatus() {
  return {
    ok: !!_session,
    model: fs.existsSync(MODEL) ? path.basename(MODEL) : null,
    cavs: fs.existsSync(CAVS),
    registers: _cavs ? Object.keys(_cavs.axes?.register || {}).filter(k => k[0] !== '_') : [],
    error: _loadErr,
  };
}

// The exported ONNX bakes CLIP's normalisation, so it wants a plain [0,1] tensor.
async function toTensor(buf) {
  const raw = await _sharp(buf).resize(SIZE, SIZE, { fit: 'fill', kernel: 'cubic' })
    .removeAlpha().toColourspace('srgb').raw().toBuffer();
  const f = new Float32Array(3 * SIZE * SIZE), plane = SIZE * SIZE;
  for (let i = 0, p = 0; i < plane; i++, p += 3) {
    f[i] = raw[p] / 255; f[plane + i] = raw[p + 1] / 255; f[2 * plane + i] = raw[p + 2] / 255;
  }
  return f;
}

async function fetchAll(urls, timeoutMs) {
  const out = new Map();
  let i = 0;
  const worker = async () => {
    while (i < urls.length) {
      const k = i++;
      try {
        const r = await fetch(urls[k], { signal: AbortSignal.timeout(timeoutMs) });
        if (r.ok) out.set(urls[k], Buffer.from(await r.arrayBuffer()));
      } catch { /* a candidate we cannot read is simply not ranked */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, urls.length) }, worker));
  return out;
}

const sigmoid = z => 1 / (1 + Math.exp(-z));

function conceptProb(emb, off, cav) {
  let z = cav.b;
  for (let d = 0; d < EMB_DIM; d++) z += cav.w[d] * emb[off + d];
  return sigmoid(z);
}

/**
 * rank({ state, candidates, mode }) → { ok, order, scored, mode, why }
 *
 * `candidates` is the source's own order — [{ id, url }, …] — and that order is
 * half the signal, so it is never discarded, only re-weighted.
 * `mode`: 'auto' (default — eye alone on longing/joy, fusion elsewhere),
 *         'eye' (override), 'fuse' (override).
 */
export async function rank(args = {}) { return queued(() => rankNow(args)); }

async function rankNow({ state, candidates, mode = 'auto', timeoutMs = 8000 } = {}) {
  const register = state?.register;
  if (!register) return { ok: false, reason: 'no register in state' };
  if (!Array.isArray(candidates) || !candidates.length) return { ok: false, reason: 'no candidates' };
  if (!(await load())) return { ok: false, reason: 'eye unavailable: ' + _loadErr };

  const cav = _cavs.axes?.register?.[register];
  if (!cav?.w) return { ok: false, reason: `no CAV trained for “${register}”` };

  const t0 = Date.now();
  const pool = candidates.slice(0, MAX_CANDIDATES);
  const bufs = await fetchAll(pool.map(c => c.url), timeoutMs);

  // encode in batches; an unreadable candidate is dropped, never invented
  const rows = [], embs = [];
  const B = 16;
  for (let k = 0; k < pool.length; k += B) {
    const slice = pool.slice(k, k + B);
    const tensors = [], kept = [];
    for (const c of slice) {
      const b = bufs.get(c.url); if (!b) continue;
      try { tensors.push(await toTensor(b)); kept.push(c); } catch { /* undecodable */ }
    }
    if (!tensors.length) continue;
    const buf = new Float32Array(tensors.length * 3 * SIZE * SIZE);
    tensors.forEach((t, j) => buf.set(t, j * 3 * SIZE * SIZE));
    const input = new _ort.Tensor('float32', buf, [tensors.length, 3, SIZE, SIZE]);
    const feeds = {}; feeds[_session.inputNames[0]] = input;
    const res = await _session.run(feeds);
    const emb = Object.values(res).find(t => t.dims[t.dims.length - 1] === EMB_DIM);
    embs.push(emb.data); rows.push(...kept);
  }
  if (!rows.length) return { ok: false, reason: 'no candidate could be read' };

  const flat = new Float32Array(rows.length * EMB_DIM);
  let off = 0;
  for (const e of embs) { flat.set(e.subarray(0, Math.min(e.length, flat.length - off)), off); off += e.length; }

  const nativeRank = new Map(pool.map((c, k) => [c.id ?? c.url, k + 1]));
  const scored = rows.map((c, k) => ({ c, p: conceptProb(flat, k * EMB_DIM, cav) }))
    .sort((a, b) => b.p - a.p)
    .map((x, k) => ({ ...x, eyeRank: k + 1 }));

  const useEyeAlone = mode === 'eye' || (mode === 'auto' && EYE_ALONE.has(register));
  const finalOrder = useEyeAlone
    ? scored
    : scored.map(x => {
      const nr = nativeRank.get(x.c.id ?? x.c.url) ?? rows.length;
      return { ...x, nr, s: 1 / (RRF_K + x.eyeRank) + 1 / (RRF_K + nr) };
    }).sort((a, b) => b.s - a.s);

  return {
    ok: true,
    mode: useEyeAlone ? 'eye' : 'fuse',
    why: useEyeAlone
      ? `${register}: the eye ranks alone (measured 20-5 over the source order on longing+joy)`
      : `${register}: fused with the source order (the eye did not beat it here: 21-29)`,
    order: finalOrder.map(x => x.c.id ?? x.c.url),
    scored: finalOrder.map(x => ({
      id: x.c.id ?? x.c.url,
      feeling: Math.round(x.p * 1000) / 1000,
      eyeRank: x.eyeRank,
      sourceRank: nativeRank.get(x.c.id ?? x.c.url) ?? null,
    })),
    read: rows.length,
    of: pool.length,
    ms: Date.now() - t0,
  };
}
