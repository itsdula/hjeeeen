// HJEN Studio — gated web-demo server. Zero-dependency: Node built-in http only,
// runs on Electron's bundled node with nothing installed. Wires the invitee gate
// to the ported generation core. Keys stay server-side; every make is metered;
// every invitee is time-boxed and revocable. Owner watches from /admin.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { config, paths, genId, DEFAULT_SIZE, DEFAULT_QUALITY } from './config.js';
import { store, gateStatus, appendEvent, readEvents } from './store.js';
import { makeImage, estimateImageUsd } from './providers/openai.js';
import { enhancePrompt, runSkill, listSkills } from './providers/anthropic.js';
import { llmUsd, imageUsdFromUsage } from './pricing.js';
import { verifyClerkToken, fetchClerkUser, fetchOrgMembers } from './clerk.js';
import { cloud } from './cloudstore.js';
import { getPricing, setPricing } from './plans.js';
import { buildPrompt } from './frame/compose.js';
import { resolveSize, mapQuality, MODELS } from './frame/models.js';
import { buildStoryboardPrompt } from './storyboard/compose.js';
import { buildAssetPrompt } from './assets/compose.js';
import { ingestVideo, denseFrames } from './breakdown/ingest.js';
import { transcribeAudio, captionsFlat } from './breakdown/transcribe.js';
import { runVisionStage, runDocsStage, assembleBreakdown, VISION_PASSES } from './breakdown/run.js';
import { buildSystem as buildLlmSystem, hasPrompt as hasLlmPrompt } from './llm/prompts.js';
import { verifyPaddleSignature, applyPaddleEvent, portalUrlFor } from './billing.js';
import { moyasarConfigured, createPlanInvoice, moyasarPlanIntent, verifyMoyasarWebhook, applyMoyasarEvent, applyMoyasarPaymentId, moyasarReturnInfo } from './moyasar.js';
import { getSarRate, usdToSarRiyals } from './money.js';
import { qoyodStatus, recordExpense, listExpenseCategories, initQoyodSweep } from './qoyod.js';
import { run as schedule, note429, stats as schedulerStats, totalQueued } from './scheduler.js';
import { bucketKey } from './ratelimits.js';
import { providerRetryDecision, providerFailureMessage } from './providerRetry.js';

// 25MB was sized for prompts + a few stills. It is too small for the Cuts
// passes, which send a transcoded clip INLINE: those cap the clip at 20MB of
// raw bytes, and base64 inflates that by a third (~26.7MB) before the reference
// stills and the JSON are added. Under 25MB the request died as "body too
// large" — which, before these doors learned to use the gateway at all, nobody
// could reach. 45MB clears a full-size Cuts pass and stays far under
// Cloudflare's 100MB request ceiling.
const MAX_BODY = 45 * 1024 * 1024;

// Pull REAL token counts from a provider's JSON response so the gateway logs
// actual spend, not a flat estimate. Each vendor names the fields differently.
function realLlmUsd(provider, model, responseText) {
  try {
    const d = JSON.parse(responseText);
    let inTok = 0, outTok = 0;
    if (provider === 'anthropic') { inTok = d?.usage?.input_tokens ?? 0; outTok = d?.usage?.output_tokens ?? 0; }
    else if (provider === 'openai') { inTok = d?.usage?.prompt_tokens ?? 0; outTok = d?.usage?.completion_tokens ?? 0; }
    else if (provider === 'google') { inTok = d?.usageMetadata?.promptTokenCount ?? 0; outTok = d?.usageMetadata?.candidatesTokenCount ?? 0; }
    if (inTok || outTok) { const u = llmUsd(model, inTok, outTok); if (u != null && !Number.isNaN(u)) return { usd: u, inTok, outTok }; }
  } catch { /* fall through to estimate */ }
  return null;
}

function send(res, code, obj, type = 'application/json') {
  const body = type === 'application/json' ? JSON.stringify(obj) : obj;
  res.writeHead(code, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

// Raw binary body — REQUIRED for multipart uploads (reference-image edits).
// Reading those as utf-8 corrupts the binary bytes and OpenAI drops the
// connection. Returns a Buffer forwarded verbatim to the vendor.
function readBodyRaw(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

// Raw binary body with a caller-set cap — video uploads are far bigger than the
// 25MB API-body cap. Capped at 100MB (Cloudflare free-plan request-body ceiling).
const MAX_VIDEO_BODY = 100 * 1024 * 1024;
function readBodyRawCapped(req, cap = MAX_VIDEO_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > cap) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// The public Early-Access signup is open to the internet, so throttle it: at
// most N requests per IP per window. In-memory is fine for a single-node beta.
const _signupHits = new Map();
function signupRateLimited(req) {
  const ip = req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const WINDOW_MS = 10 * 60 * 1000, MAX = 5;
  const rec = _signupHits.get(ip);
  if (!rec || now > rec.resetAt) { _signupHits.set(ip, { count: 1, resetAt: now + WINDOW_MS }); return false; }
  rec.count++;
  return rec.count > MAX;
}
function validEmail(e) { return typeof e === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim()) && e.length <= 200; }

// Owner-action audit trail — every governance mutation (plan/approve/stop/
// impersonate…) is recorded who/when/what into the append-only event log.
function audit(action, inv, extra) {
  appendEvent({ ts: Date.now(), kind: 'audit', actor: 'owner', action, targetId: inv?.id || null, targetName: inv?.name || null, email: inv?.email || null, ...(extra ? { meta: extra } : {}) });
}

// OpenAI enforces per-ORGANIZATION rate limits (e.g. gpt-image input-images/min).
// Every invitee shares one server-side key → one bucket → a burst of makes 429s.
// Absorb it here: honor OpenAI's own retry hint ("try again in Xs" / Retry-After),
// wait inside the background job so the user experiences a visible queue instead
// of a failed take. Rate waits are capped below the job's recovery lifetime.
async function openaiFetchWithRetry(upstreamPath, headers, rawBuf, opts = {}) {
  // Pace through the adaptive scheduler (PROACTIVE — prevents the 429 storm and
  // self-tunes from x-ratelimit-* headers); the inner loop below stays as the
  // REACTIVE safety net for any 429 that still slips through. onStart flips the
  // caller's job from queued → rendering the instant a slot frees.
  const key = opts.bucketKey || bucketKey('openai', config.imageModel || 'gpt-image-2');
  // note429(key) feeds AIMD: every 429 (even one the loop below then retries away)
  // halves the bucket's concurrency, so the limiter learns the account's real
  // ceiling without relying on the (useless, zero-valued) image rate headers.
  return schedule(key, () => _openaiFetchOnce(upstreamPath, headers, rawBuf, (retryAfterMs) => {
    note429(key, retryAfterMs);
    try { opts.onRateLimit?.(retryAfterMs); } catch { /* best-effort status only */ }
  }), { onStart: opts.onStart });
}
async function _openaiFetchOnce(upstreamPath, headers, rawBuf, onRateLimit) {
  // A gpt-image HIGH / 8.3MP render legitimately takes minutes, and under org
  // saturation OpenAI queues it longer still — the async submit→poll flow exists
  // precisely so it can. The timeout must therefore only catch a GENUINELY hung
  // connection, never a slow-but-valid render: set it below the client's
  // 19-minute poll window. (The old 180s aborted valid HIGH renders → retry loop
  // → ~12 min of nothing → refund. That was the "HIGH hangs, MED works" bug.)
  const FETCH_TIMEOUT_MS = 780_000; // 13 min — below the client's 19-min give-up
  let waited = 0;
  for (let attempt = 0; ; attempt++) {
    let upstream;
    try {
      const ac = new AbortController();
      const to = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
      try { upstream = await fetch(`https://api.openai.com/v1${upstreamPath}`, { method: 'POST', headers, body: rawBuf, signal: ac.signal }); }
      finally { clearTimeout(to); }
    } catch (netErr) {
      // A timeout abort means the connection is genuinely hung — retrying won't
      // help and we're already at the client's patience limit, so surface it once.
      if (netErr && netErr.name === 'AbortError') throw netErr;
      // Transient network blip (connection reset / DNS / socket timeout) — retry
      // a few times before surfacing, so a momentary hiccup never loses a make.
      const backoff = Math.min(1500 * (attempt + 1), 6000);
      if (attempt >= 4 || waited + backoff > 70_000) throw netErr;
      waited += backoff;
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }
    // Read the provider's actual reason before deciding. A 429 caused by shared
    // rate pressure must wait inside this SAME requested take; a hard billing
    // quota must return immediately because time cannot repair it.
    const peek = await upstream.clone().text().catch(() => '');
    const decision = providerRetryDecision({ status: upstream.status, body: peek, headers: upstream.headers, attempt, waitedMs: waited });
    if (upstream.status === 429) { try { onRateLimit && onRateLimit(decision.delayMs); } catch { /* best-effort */ } }
    if (!decision.retry) return upstream;
    waited += decision.delayMs;
    await new Promise((r) => setTimeout(r, decision.delayMs));
  }
}

// ── Async image jobs (submit → poll) ─────────────────────────────────────────
// gpt-image-2 at HIGH quality can take > Cloudflare's ~100s origin ceiling, so a
// SYNCHRONOUS make dies with Error 524 even though the render would have
// succeeded. Mirror the Seedance/Kling video flow: /v1/image/submit reserves one
// credit, kicks the render off in the BACKGROUND (server↔OpenAI has no CF
// ceiling) and returns a jobId in milliseconds; the client polls /v1/image/poll
// (free) until the image is ready. In-memory is fine for a single-instance
// server; a job only needs to outlive its own render (minutes).
const imageJobs = new Map(); // jobId -> { status:'pending'|'done'|'error', b64?, message?, magicToken, inv, settled, ts }
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of imageJobs) if (now - v.ts > 20 * 60 * 1000) imageJobs.delete(k);
}, 5 * 60 * 1000).unref?.();

// Async FRAME jobs — same shape. /api/frame/submit composes the prompt SERVER-SIDE,
// reserves one credit, kicks the render off in the BACKGROUND and returns a jobId
// in milliseconds; the client polls /api/frame/poll until ready. Fully async — no
// client-side abort or timeout guessing, no Cloudflare 100s ceiling in play.
const frameJobs = new Map(); // jobId -> { status, b64, meta, message, magicToken, inv, settled, ts }
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of frameJobs) if (now - v.ts > 20 * 60 * 1000) frameJobs.delete(k);
}, 5 * 60 * 1000).unref?.();

async function runFrameRenderJob(jobId, spec) {
  const job = frameJobs.get(jobId);
  if (!job) return;
  const _t0 = Date.now();
  const _elapsed = () => Math.round((Date.now() - _t0) / 1000);
  console.log(`[frame] START job=${jobId} q=${spec?.quality} size=${spec?.sizeInfo?.apiSize} refs=${(spec?.layers || []).filter((l) => l && l.b64).length}`);
  const refundOnce = async (why) => {
    if (job.settled) return; job.settled = true;
    await store.refund(job.magicToken);
    console.log(`[frame] REFUND job=${jobId} q=${spec?.quality} why=${why} after=${_elapsed()}s`);
    appendEvent({ ts: Date.now(), inviteeId: job.inv.id, email: job.inv.email, kind: 'make-refund', meta: { path: '/api/frame', why } });
  };
  try {
    const { selections, layers, prompt, sizeInfo, quality, modelSpec, projectId, sig } = spec;
    // Reference order MUST mirror buildPrompt's mention order (compositions →
    // parentless characters → nested children → the rest). Only byte-bearing layers.
    const ordered = [
      ...layers.filter((l) => l.category === 'composition' && !l.parentLayerId),
      ...layers.filter((l) => l.category === 'character' && !l.parentLayerId),
      ...layers.filter((l) => l.parentLayerId),
      ...layers.filter((l) => l.category !== 'composition' && l.category !== 'character' && !l.parentLayerId),
    ].filter((l) => l && l.b64);

    const headers = { authorization: `Bearer ${config.openaiKey}` };
    let rawBody; let upstreamPath;
    if (ordered.length > 0) {
      upstreamPath = '/images/edits';
      const fd = new FormData();
      fd.set('model', modelSpec.apiModelId); fd.set('prompt', prompt); fd.set('size', sizeInfo.apiSize); fd.set('quality', quality); fd.set('n', '1');
      for (const l of ordered) fd.append('image[]', new Blob([Buffer.from(l.b64, 'base64')], { type: l.mime || 'image/png' }), l.filename || 'ref.png');
      rawBody = fd;
    } else {
      upstreamPath = '/images/generations';
      headers['content-type'] = 'application/json';
      rawBody = Buffer.from(JSON.stringify({ model: modelSpec.apiModelId, prompt, size: sizeInfo.apiSize, quality, n: 1 }), 'utf-8');
    }

    console.log(`[frame] SUBMIT-OPENAI job=${jobId} q=${quality} path=${upstreamPath} queuedFor=${_elapsed()}s`);
    const upstream = await openaiFetchWithRetry(upstreamPath, headers, rawBody, {
      bucketKey: bucketKey(modelSpec.provider, modelSpec.apiModelId),
      onStart: () => { const j = frameJobs.get(jobId); if (j && j.phase === 'queued') j.phase = 'rendering'; },
      onRateLimit: () => { const j = frameJobs.get(jobId); if (j) j.phase = 'rate_limited'; },
    });
    const text = await upstream.text();
    console.log(`[frame] OPENAI-DONE job=${jobId} q=${quality} status=${upstream.status} totalAfter=${_elapsed()}s bytes=${text.length}`);
    if (!upstream.ok) {
      await refundOnce('provider_' + upstream.status);
      const low = text.toLowerCase();
      job.status = 'error';
      job.message = (low.includes('safety') || low.includes('moderation') || low.includes('content_policy') || low.includes('content policy') || low.includes('rejected'))
        ? 'The safety filter rejected this request — you were not charged. Try softening the prompt or references.'
        : providerFailureMessage(upstream.status, text);
      return;
    }
    let b64 = ''; let usage = null;
    try { const pj = JSON.parse(text); b64 = pj?.data?.[0]?.b64_json || ''; usage = pj?.usage; } catch { /* not json */ }
    if (!b64) { await refundOnce('empty_result'); job.status = 'error'; job.message = 'The model returned no image — you were not charged.'; return; }
    job.settled = true; // a real image exists → the charge stands

    const meta = { apiSize: sizeInfo.apiSize, targetWidth: sizeInfo.targetWidth, targetHeight: sizeInfo.targetHeight, finalMP: sizeInfo.finalMP, notes: sizeInfo.notes || '', quality, modelLabel: modelSpec.label };
    try { cloud.saveDelivered(job.inv.id, jobId, { base64: b64, ext: 'png', meta }); } catch { /* non-fatal */ }

    let usd = estimateImageUsd(quality); let realImg = false;
    try { const r = imageUsdFromUsage(usage); if (r != null && !Number.isNaN(r)) { usd = Number(r.toFixed(6)); realImg = true; } } catch { /* estimate */ }
    let savedImgPath = '';
    if (projectId) {
      try {
        const proj = cloud.projectById(job.inv.id, projectId);
        if (proj) {
          const row = cloud.saveGeneration(job.inv.id, {
            pid: projectId, base64: b64, ext: 'png',
            sidecar: { promptTitle: String(selections.prompt || 'Frame').slice(0, 120), prompt: String(selections.prompt || ''), selections, references: layers.map((l) => ({ id: l.id, category: l.category, name: l.name, customName: l.customName, parentLayerId: l.parentLayerId, groupName: l.groupName })), size: sizeInfo.apiSize, apiSize: sizeInfo.apiSize, model: modelSpec.label, apiModelId: modelSpec.apiModelId, quality, modelLabel: modelSpec.label, costUsd: usd, sig },
            promptSlug: 'frame', projectSlug: proj.slug || '', projectName: proj.name || '',
          });
          savedImgPath = `cloudgen://${projectId}/${row.gid}.${row.ext}`;
        }
      } catch { /* non-fatal — client can still save from the returned b64 */ }
    }
    appendEvent({ ts: Date.now(), inviteeId: job.inv.id, email: job.inv.email, kind: 'make', model: modelSpec.apiModelId, usd, meta: { via: 'frame-async', refs: ordered.length, saved: !!savedImgPath, ...(realImg ? { real: true } : { estimated: true }) } });
    job.status = 'done'; job.b64 = b64; job.meta = { ...meta, savedImgPath }; job.ts = Date.now();
    console.log(`[frame] DONE job=${jobId} q=${quality} totalAfter=${_elapsed()}s saved=${!!savedImgPath}`);
  } catch (err) {
    console.log(`[frame] EXCEPTION job=${jobId} q=${spec?.quality} after=${_elapsed()}s err=${String(err?.name || '')}:${String(err?.message || err).slice(0, 120)}`);
    await refundOnce('exception'); job.status = 'error'; job.message = String(err?.message || err).slice(0, 300); job.ts = Date.now();
  }
}

async function runImageJob(jobId, spec) {
  const job = imageJobs.get(jobId);
  if (!job) return;
  const tmpRefs = [];
  const refundOnce = async (why) => {
    if (job.settled) return; job.settled = true;
    await store.refund(job.magicToken);
    appendEvent({ ts: Date.now(), inviteeId: job.inv.id, email: job.inv.email, kind: 'make-refund', meta: { path: '/v1/image', why } });
  };
  try {
    // The desktop client's reference images live on ITS disk, so they arrive as
    // base64 in the submit body — materialize them to temp files for makeImage().
    if (Array.isArray(spec.images) && spec.images.length) {
      for (let i = 0; i < spec.images.length; i++) {
        const buf = Buffer.from(String(spec.images[i]), 'base64');
        const tp = path.join(os.tmpdir(), `hjen-ref-${jobId}-${i}.png`);
        fs.writeFileSync(tp, buf);
        tmpRefs.push(tp);
      }
    }
    const result = await makeImage({ modelId: spec.model, quality: spec.quality, size: spec.size, prompt: spec.prompt, referencePaths: tmpRefs,
      onStart: () => { const j = imageJobs.get(jobId); if (j && j.phase === 'queued') j.phase = 'rendering'; } });
    // A real image exists → the reserved credit stands; log the make.
    const usd = estimateImageUsd(spec.quality);
    appendEvent({ ts: Date.now(), inviteeId: job.inv.id, email: job.inv.email, kind: 'make', model: spec.model, usd, meta: { via: 'gateway-async', mode: tmpRefs.length ? 'edit' : 'generate', quality: spec.quality } });
    job.status = 'done'; job.b64 = result.b64; job.ts = Date.now();
  } catch (err) {
    await refundOnce('exception');
    job.status = 'error'; job.message = String(err?.message || err).slice(0, 400); job.ts = Date.now();
  } finally {
    for (const tp of tmpRefs) { try { fs.unlinkSync(tp); } catch { /* best effort */ } }
  }
}

// Async STORYBOARD asset jobs — same submit→poll shape as frames. The board recipe
// is composed SERVER-SIDE (buildStoryboardPrompt); render runs in the background.
const storyboardJobs = new Map(); // jobId -> { status, b64, meta, message, magicToken, inv, settled, ts }
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of storyboardJobs) if (now - v.ts > 20 * 60 * 1000) storyboardJobs.delete(k);
}, 5 * 60 * 1000).unref?.();

async function runStoryboardRenderJob(jobId, spec) {
  const job = storyboardJobs.get(jobId);
  if (!job) return;
  const refundOnce = async (why) => {
    if (job.settled) return; job.settled = true;
    await store.refund(job.magicToken);
    appendEvent({ ts: Date.now(), inviteeId: job.inv.id, email: job.inv.email, kind: 'make-refund', meta: { path: '/api/storyboard', why } });
  };
  const { built, sizeInfo, quality, modelSpec, refBufs, sbReq, projectId, sig } = spec;
  const callOpenAI = async (prompt) => {
    const headers = { authorization: `Bearer ${config.openaiKey}` };
    let rawBody; let upstreamPath;
    if (refBufs.length > 0) {
      upstreamPath = '/images/edits';
      const fd = new FormData();
      fd.set('model', modelSpec.apiModelId); fd.set('prompt', prompt); fd.set('size', sizeInfo.apiSize); fd.set('quality', quality); fd.set('n', '1');
      for (const l of refBufs) fd.append('image[]', new Blob([Buffer.from(l.b64, 'base64')], { type: l.mime || 'image/png' }), l.filename || 'ref.png');
      rawBody = fd;
    } else {
      upstreamPath = '/images/generations';
      headers['content-type'] = 'application/json';
      rawBody = Buffer.from(JSON.stringify({ model: modelSpec.apiModelId, prompt, size: sizeInfo.apiSize, quality, n: 1 }), 'utf-8');
    }
    const upstream = await openaiFetchWithRetry(upstreamPath, headers, rawBody);
    return { status: upstream.status, ok: upstream.ok, text: await upstream.text() };
  };
  const isSafety = (t) => { const l = (t || '').toLowerCase(); return l.includes('safety') || l.includes('moderation') || l.includes('content_policy') || l.includes('content policy') || l.includes('rejected'); };
  try {
    let r = await callOpenAI(built.prompt);
    if (!r.ok && isSafety(r.text) && built.fallbackPrompt) r = await callOpenAI(built.fallbackPrompt); // wholesome retry
    if (!r.ok) {
      await refundOnce('provider_' + r.status);
      job.status = 'error';
      job.message = isSafety(r.text) ? 'The safety filter rejected this even after the wholesome retry — you were not charged.' : `Provider error (${r.status}) — you were not charged.`;
      return;
    }
    let b64 = ''; let usage = null;
    try { const pj = JSON.parse(r.text); b64 = pj?.data?.[0]?.b64_json || ''; usage = pj?.usage; } catch { /* not json */ }
    if (!b64) { await refundOnce('empty_result'); job.status = 'error'; job.message = 'The model returned no image — you were not charged.'; return; }
    job.settled = true;
    const meta = { apiSize: sizeInfo.apiSize, targetWidth: sizeInfo.targetWidth, targetHeight: sizeInfo.targetHeight, quality, modelLabel: modelSpec.label };
    try { cloud.saveDelivered(job.inv.id, jobId, { base64: b64, ext: 'png', meta }); } catch { /* non-fatal */ }
    let usd = estimateImageUsd(quality); let realImg = false;
    try { const rr = imageUsdFromUsage(usage); if (rr != null && !Number.isNaN(rr)) { usd = Number(rr.toFixed(6)); realImg = true; } } catch { /* estimate */ }
    let savedImgPath = '';
    if (projectId) {
      try {
        const proj = cloud.projectById(job.inv.id, projectId);
        if (proj) {
          const row = cloud.saveGeneration(job.inv.id, {
            pid: projectId, base64: b64, ext: 'png',
            sidecar: { promptTitle: String(sbReq.kind || 'storyboard'), kind: `storyboard-${sbReq.kind}`, size: sizeInfo.apiSize, quality, modelLabel: modelSpec.label, costUsd: usd, sig },
            promptSlug: 'storyboard', projectSlug: proj.slug || '', projectName: proj.name || '',
          });
          savedImgPath = `cloudgen://${projectId}/${row.gid}.${row.ext}`;
        }
      } catch { /* non-fatal */ }
    }
    appendEvent({ ts: Date.now(), inviteeId: job.inv.id, email: job.inv.email, kind: 'make', model: modelSpec.apiModelId, usd, meta: { via: 'storyboard-async', kind: sbReq.kind, refs: refBufs.length, saved: !!savedImgPath, ...(realImg ? { real: true } : { estimated: true }) } });
    job.status = 'done'; job.b64 = b64; job.meta = { ...meta, savedImgPath }; job.ts = Date.now();
  } catch (err) {
    await refundOnce('exception'); job.status = 'error'; job.message = String(err?.message || err).slice(0, 300); job.ts = Date.now();
  }
}

function tokenOf(req, url) {
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const q = url.searchParams.get('token');
  return q || null;
}

async function requireInvitee(req, url, res) {
  const token = tokenOf(req, url);
  // Two credentials coexist: a magic-link token (opaque id, no dots) OR a Clerk
  // session JWT (three dot-separated parts). A valid Clerk session maps to the
  // funded HJEN account bound to that Clerk user (created on first sign-in).
  let inv = null;
  if (token && token.split('.').length === 3) {
    const claims = await verifyClerkToken(token);
    if (!claims) { send(res, 401, { ok: false, reason: 'clerk_invalid', message: 'Session expired — please sign in again.' }); return null; }
    if (claims.org_id) {
      // Acting inside an organization → the shared, funded team account.
      inv = await store.getOrCreateByClerkOrg(claims.org_id, { name: claims.org_slug || claims.org_name });
    } else {
      // Personal account.
      const details = await fetchClerkUser(claims.sub);
      inv = await store.getOrCreateByClerkUser(claims.sub, details);
    }
  } else if (token) {
    inv = store.getByToken(token);
  }
  if (!inv) { send(res, 401, { ok: false, reason: 'no_token', message: 'Invalid access link.' }); return null; }
  const s = gateStatus(inv);
  if (!s.ok) {
    const message =
      s.reason === 'pending' ? 'Your request is in the Early Access queue — we will activate your access soon.' :
      s.reason === 'rejected' ? 'This request was not activated.' :
      s.reason === 'expired' ? 'Your trial has ended.' :
      s.reason === 'exhausted' ? 'You have reached your shot limit.' : 'Your access has been paused.';
    const position = s.reason === 'pending' ? store.queuePosition(inv.id) : undefined;
    send(res, 403, { ok: false, reason: s.reason, message, name: inv.name, position, remaining: s.remaining, daysLeft: s.daysLeft });
    return null;
  }
  return inv;
}

function requireAdmin(req, url, res) {
  if (!config.adminToken) { send(res, 500, { ok: false, message: 'ADMIN_TOKEN not configured.' }); return false; }
  if (tokenOf(req, url) !== config.adminToken) { send(res, 401, { ok: false, message: 'Unauthorized.' }); return false; }
  return true;
}

function serveHtml(res, file) {
  try { send(res, 200, fs.readFileSync(path.join(paths.publicDir(), file), 'utf-8'), 'text/html'); }
  catch { send(res, 404, 'not found', 'text/plain'); }
}
function serveHtmlAs(res, file, type) {
  try { send(res, 200, fs.readFileSync(path.join(paths.publicDir(), file), 'utf-8'), type); }
  catch { send(res, 404, 'not found', 'text/plain'); }
}

// Serve the built React Control Plane (Vite output) from ../console/dist. This
// is the world-class admin surface, parallel to the existing /admin page.
function serveConsole(res, rel) {
  const base = path.resolve(paths.publicDir(), '..', 'console', 'dist');
  const clean = String(rel || '').replace(/\.\.+/g, '').replace(/[^a-zA-Z0-9._/-]/g, '') || 'index.html';
  const file = path.join(base, clean);
  if (!file.startsWith(base) || !fs.existsSync(file)) {
    // SPA fallback → index.html so client routing works.
    try { return send(res, 200, fs.readFileSync(path.join(base, 'index.html'), 'utf-8'), 'text/html'); }
    catch { return send(res, 404, 'not found', 'text/plain'); }
  }
  const ext = clean.split('.').pop();
  const ct = ext === 'js' ? 'text/javascript' : ext === 'css' ? 'text/css' : ext === 'html' ? 'text/html'
    : ext === 'svg' ? 'image/svg+xml' : ext === 'json' ? 'application/json'
    : ext === 'woff2' ? 'font/woff2' : 'application/octet-stream';
  res.writeHead(200, { 'content-type': `${ct}; charset=utf-8`, 'cache-control': ext === 'html' ? 'no-store' : 'public, max-age=86400' });
  return res.end(fs.readFileSync(file));
}

// Full content-type map for the renderer's mixed asset payload (JS/CSS/fonts/
// images/wasm/media). Anything unknown falls back to octet-stream.
const MIME = {
  html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css',
  json: 'application/json', map: 'application/json', svg: 'image/svg+xml',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
  wasm: 'application/wasm', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav',
  txt: 'text/plain', csv: 'text/csv', glb: 'model/gltf-binary', gltf: 'model/gltf+json',
};

// Serve the desktop renderer as the full web app: the SAME built React renderer,
// with the cloud window.hjen adapter + auth injected into index.html so it runs
// against per-account cloud storage instead of Electron's local disk. Read-only
// from the app's dist — the desktop app is never touched. Assets are referenced
// relatively (base './'), so serving under /studio/ resolves them correctly.
function serveStudio(res, rel) {
  const base = paths.webappDir();
  const clean = String(rel || '').replace(/\.\.+/g, '').replace(/[^a-zA-Z0-9._/-]/g, '');
  // index.html: inject the adapter + auth bootstrap BEFORE the renderer's module
  // script, then serve it (never cached — the injected shell must stay current).
  if (!clean || clean === 'index.html') {
    let html;
    try { html = fs.readFileSync(path.join(base, 'index.html'), 'utf-8'); }
    catch { return send(res, 500, 'renderer not deployed (set HJEN_WEBAPP_DIST)', 'text/plain'); }
    const CK = JSON.stringify(config.clerkPublishableKey || '');
    const CA = JSON.stringify(config.clerkFrontendApi || '');
    const inject = `
  <script>
  // Web host bootstrap: authenticate the studio, then expose a token getter to the
  // cloud adapter. Two credentials: a magic-link token (?token=… — admin/testing)
  // OR a Clerk session (public launch — self-service sign-up). The server accepts
  // both. No session at all → the public sign-in landing.
  (function () {
    try {
      var u = new URL(location.href); var t = u.searchParams.get('token');
      if (t) { localStorage.setItem('hjen_web_token', t); u.searchParams.delete('token');
        history.replaceState(null, '', u.pathname + (u.search || '') + u.hash); }
    } catch (e) {}
    window.__HJEN_TRACE = /[?&]trace=1/.test(location.search);
    var magic = localStorage.getItem('hjen_web_token');
    var CK = ${CK}, CA = ${CA};
    if (magic) {
      window.__hjenAuth = async function () { return localStorage.getItem('hjen_web_token') || ''; };
    } else if (CK && CA) {
      // Public path: load Clerk, require a signed-in user (→ funded trial account
      // auto-created server-side on first sign-in), and hand its session token to
      // the adapter. Not signed in → the sign-in landing.
      window.__clerkReady = new Promise(function (resolve) {
        var s = document.createElement('script'); s.async = true; s.crossOrigin = 'anonymous';
        s.setAttribute('data-clerk-publishable-key', CK);
        s.src = 'https://' + CA + '/npm/@clerk/clerk-js@5/dist/clerk.browser.js';
        s.onload = function () { window.Clerk.load().then(function () {
          if (!window.Clerk.user) { location.replace('/'); return; }
          resolve();
        }); };
        s.onerror = function () { resolve(); };
        document.head.appendChild(s);
      });
      window.__hjenAuth = async function () {
        var m = localStorage.getItem('hjen_web_token'); if (m) return m;
        await window.__clerkReady;
        try { return (window.Clerk && window.Clerk.session) ? (await window.Clerk.session.getToken()) || '' : ''; } catch (e) { return ''; }
      };
    } else {
      window.__hjenAuth = async function () { return ''; };
      location.replace('/join');
    }
  })();
  </script>
  <script src="/webapp/adapter.js"></script>`;
    // Insert right after <head> so the adapter defines window.hjen before the
    // deferred (type=module) renderer bundle executes.
    html = html.includes('<head>') ? html.replace('<head>', '<head>' + inject) : inject + html;
    return send(res, 200, html, 'text/html');
  }
  const file = path.join(base, clean);
  if (!file.startsWith(base) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return send(res, 404, 'not found', 'text/plain');
  }
  const ext = clean.split('.').pop().toLowerCase();
  const ct = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'content-type': `${ct}; charset=utf-8`, 'cache-control': 'public, max-age=86400' });
  return res.end(fs.readFileSync(file));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  const method = req.method || 'GET';

  // CORS: the desktop app's renderer (localhost dev / file:// packaged) calls
  // this server cross-origin, so echo back an allow-origin + handle preflight.
  // Auth is the Bearer invite token, not the origin — so allowing any origin is
  // safe here (no cookies, no ambient credentials).
  const origin = req.headers['origin'];
  if (origin) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'Origin');
    // Allow ANY request header — the OpenAI SDK adds its own (x-stainless-os,
    // x-stainless-arch, …). Echo back what preflight asks for, or '*'.
    const reqHeaders = req.headers['access-control-request-headers'];
    res.setHeader('access-control-allow-headers', reqHeaders || '*');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    res.setHeader('access-control-max-age', '86400');
  }
  if (method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  try {
    // ----- pages -----
    if (method === 'GET' && p === '/health') return send(res, 200, { ok: true });
    if (method === 'GET' && p === '/') return serveHtml(res, 'enter.html');
    if (method === 'GET' && p === '/join') return serveHtml(res, 'join.html');
    // Invite links + /app now open the FULL web studio (the desktop renderer on
    // the cloud). The magic token in the /s/<token> path is carried to /studio/
    // as a query param, which the studio bootstrap persists to localStorage and
    // strips from the URL. The relative-asset base ('./') needs the /studio/
    // path, so we redirect rather than serve here. The simpler single-make demo
    // still lives at /demo as a fallback.
    if (method === 'GET' && p.startsWith('/s/')) {
      const tok = encodeURIComponent(p.slice('/s/'.length).split('/')[0]);
      res.writeHead(302, { location: `/studio/?token=${tok}` }); return res.end();
    }
    if (method === 'GET' && p === '/app') { res.writeHead(302, { location: '/studio/' }); return res.end(); }
    if (method === 'GET' && p === '/demo') return serveHtml(res, 'studio.html');
    if (method === 'GET' && p === '/upgrade') return serveHtml(res, 'upgrade.html');
    if (method === 'GET' && p === '/admin') return serveHtml(res, 'admin.html');
    if (method === 'GET' && (p === '/console' || p === '/console/')) return serveConsole(res, 'index.html');
    if (method === 'GET' && p.startsWith('/console/')) return serveConsole(res, p.slice('/console/'.length));
    // Full-HJEN-on-Web host files (the cloud window.hjen adapter + test harness).
    // Edge-cacheable display images — token-free, unguessable path
    // (/i/<acc>/<pid>/<gid>/<w>.webp; acc+pid+gid are all random ids). Serves a
    // small resized WebP with long immutable cache so Cloudflare caches it at the
    // edge NEAR the user (no round-trip to the origin for repeat/shared views).
    // The full-res master + all data stay behind the authenticated /api/file.
    if (method === 'GET' && p.startsWith('/i/')) {
      const m = p.match(/^\/i\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)\/(\d+)\.webp$/);
      if (!m) return send(res, 404, 'not found', 'text/plain');
      const d = await cloud.resizedBlobAutoAsync(m[1], m[2], m[3], parseInt(m[4], 10));
      if (!d) return send(res, 404, 'not found', 'text/plain');
      res.writeHead(200, { 'content-type': 'image/webp', 'cache-control': 'public, max-age=2592000, immutable' });
      return res.end(d.buf);
    }

    if (method === 'GET' && p === '/webapp/adapter.js') return serveHtmlAs(res, 'webapp/adapter.js', 'text/javascript');
    if (method === 'GET' && (p === '/webapp/test' || p === '/webapp/test.html')) return serveHtml(res, 'webapp/test.html');

    // Full HJEN on the web — the desktop renderer served with the cloud adapter.
    // /studio must end in a slash so its relative asset refs (base './') resolve
    // under /studio/ rather than the site root.
    if (method === 'GET' && p === '/studio') { res.writeHead(302, { location: '/studio/' }); return res.end(); }
    if (method === 'GET' && (p === '/studio/' || p === '/studio/index.html')) return serveStudio(res, 'index.html');
    if (method === 'GET' && p.startsWith('/studio/')) return serveStudio(res, p.slice('/studio/'.length));

    // Public front-end config — the Clerk publishable key + frontend API are
    // public by design; the studio needs them to boot Clerk sign-in.
    if (method === 'GET' && p === '/api/config') {
      return send(res, 200, {
        ok: true,
        clerkEnabled: !!config.clerkPublishableKey,
        clerkPublishableKey: config.clerkPublishableKey || null,
        clerkFrontendApi: config.clerkFrontendApi || null,
      });
    }

    // Serve a user's own saved output image. Token is in the query string so a
    // plain <img src> works; the filename is sanitized and scoped to the
    // invitee's own output folder (no path traversal, no cross-account reads).
    if (method === 'GET' && p === '/o') {
      const tok = url.searchParams.get('t') || '';
      const inv = tok ? store.getByToken(tok) : null;
      if (!inv) return send(res, 401, { ok: false });
      const base = path.join(paths.outputs(), inv.id);
      const f = String(url.searchParams.get('f') || '').replace(/[^a-zA-Z0-9._-]/g, '');
      const file = path.join(base, f);
      if (!f || !file.startsWith(base) || !fs.existsSync(file)) return send(res, 404, { ok: false });
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'private, max-age=86400' });
      return res.end(fs.readFileSync(file));
    }

    // Public Early-Access signup — no auth. Rate-limited + deduped by email.
    // Creates a pending account and returns the user's personal status link.
    if (method === 'POST' && p === '/api/request-access') {
      const b = await readJson(req);
      if (!validEmail(b.email)) return send(res, 400, { ok: false, message: 'Enter a valid email.' });
      if (signupRateLimited(req)) return send(res, 429, { ok: false, message: 'Too many attempts — please wait a moment and try again.' });
      const { invitee, deduped } = await store.requestAccess({ email: b.email, name: b.name, country: b.country, note: b.note });
      if (!deduped) appendEvent({ ts: Date.now(), inviteeId: invitee.id, email: invitee.email, kind: 'signup', meta: { note: (b.note || '').slice(0, 120) } });
      const position = store.queuePosition(invitee.id);
      return send(res, 200, { ok: true, deduped, statusLink: `${config.publicBaseUrl}/s/${invitee.magicToken}`, position, approved: !invitee.pending && invitee.active });
    }

    // ----- invitee API -----
    if (method === 'GET' && p === '/api/session') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const s = gateStatus(inv);
      await store.touch(inv.magicToken);
      appendEvent({ ts: Date.now(), inviteeId: inv.id, email: inv.email, kind: 'login' });
      return send(res, 200, { ok: true, acc: inv.id, name: inv.name, email: inv.email, plan: inv.plan || 'trial', wave: inv.wave, genLimit: inv.genLimit, genUsed: inv.genUsed, remaining: s.remaining, daysLeft: s.daysLeft });
    }

    // Lightweight identity + live quota — no login event, no side effects. The
    // account chip polls this every few seconds so "N left" tracks each make.
    if (method === 'GET' && p === '/api/me') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const s = gateStatus(inv);
      const prof = cloud.readAcctDoc(inv.id, 'profile', {}) || {};
      return send(res, 200, { ok: true, acc: inv.id, name: prof.username || inv.name, email: inv.email, plan: inv.plan || 'trial', genLimit: inv.genLimit, genUsed: inv.genUsed, remaining: s.remaining, daysLeft: s.daysLeft, avatar: cloud.readAvatar(inv.id) ? `/api/avatar?acc=${encodeURIComponent(inv.id)}` : null });
    }

    // ── Paddle billing ──
    // Webhook — signature-verified against the RAW body (any reformatting
    // breaks the HMAC), idempotent by event id, always answers fast so Paddle
    // doesn't mark the endpoint unhealthy. No auth: the signature IS the auth.
    if (method === 'POST' && p === '/api/paddle/webhook') {
      const raw = await readBodyRaw(req);
      if (!verifyPaddleSignature(raw, req.headers['paddle-signature'])) {
        return send(res, 401, { ok: false });
      }
      let evt = {};
      try { evt = JSON.parse(raw.toString('utf-8')); } catch { return send(res, 400, { ok: false }); }
      const r = await applyPaddleEvent(evt);
      if (r.applied) {
        const acc = evt?.data?.custom_data?.acc || '';
        appendEvent({ ts: Date.now(), inviteeId: acc, email: '', kind: 'billing', meta: { note: r.note } });
      }
      return send(res, 200, { ok: true });
    }

    // What the upgrade page needs — Paddle (global/USD) + Moyasar (Saudi/SAR).
    // The Paddle client token and Moyasar publishable key are public by design;
    // the acc id ties either checkout back to this account (Paddle customData /
    // Moyasar invoice metadata). SAR prices are computed from USD at the live rate.
    if (method === 'GET' && p === '/api/billing/config') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const rate = getSarRate();
      return send(res, 200, {
        ok: true,
        env: config.paddleEnv,
        clientToken: config.paddleClientToken || null,
        acc: inv.id,
        email: inv.email,
        plan: inv.plan || 'trial',
        planSource: inv.planSource || 'manual',
        prices: (getPricing().plans || []).flatMap((pl) => pl.paddle
          ? [{ plan: pl.id, monthly: pl.paddle.monthly, annual: pl.paddle.annual }] : []),
        // The Saudi rail. `sar` holds whole-riyal display prices per plan/cycle so
        // the page can show "≈ 222 ﷼" without re-deriving the conversion.
        moyasar: {
          enabled: moyasarConfigured(),
          env: config.moyasarEnv,
          currency: 'SAR',
          rate,
          publishableKey: config.moyasarPublishableKey || null,
          sar: (getPricing().plans || []).flatMap((pl) => (pl.priceMonthly > 0)
            ? [{
                plan: pl.id,
                monthly: usdToSarRiyals(pl.priceMonthly, rate),
                annual: usdToSarRiyals(pl.priceAnnual, rate),
              }]
            : []),
        },
      });
    }

    // Self-serve subscription management (change card, cancel, invoices) —
    // a fresh Paddle customer-portal link per request.
    if (method === 'GET' && p === '/api/billing/portal') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const portal = await portalUrlFor(inv);
      if (!portal) return send(res, 404, { ok: false, message: 'No billing profile yet — upgrade first.' });
      return send(res, 200, { ok: true, url: portal });
    }

    // ── Moyasar billing (Saudi rail, SAR) ──
    // Start a checkout: create a hosted invoice server-side (amount fixed here,
    // never trusted from the client) and hand back its hosted-page URL for the
    // client to redirect to. Auth'd so the acc↔invoice link is our own id.
    if (method === 'POST' && p === '/api/moyasar/checkout') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      if (!moyasarConfigured()) return send(res, 503, { ok: false, message: 'Saudi payments not configured yet.' });
      const b = await readJson(req);
      const r = await createPlanInvoice({ acc: inv.id, email: inv.email, planId: b.plan, cycle: b.cycle, returnTo: b.returnTo });
      if (!r.ok) return send(res, 400, { ok: false, message: r.detail ? `Payment provider: ${r.detail}` : (r.reason || 'Could not start checkout.') });
      appendEvent({ ts: Date.now(), inviteeId: inv.id, email: inv.email, kind: 'billing', meta: { note: `moyasar:invoice:${b.plan}:${b.cycle || 'monthly'}` } });
      return send(res, 200, { ok: true, url: r.url, id: r.id });
    }

    // In-app payment (embedded Moyasar.js form) — returns the server-authoritative
    // amount + publishable key + metadata; the browser renders the card form in a
    // modal and Moyasar.js handles tokenisation + 3-DS, then hits /callback.
    if (method === 'POST' && p === '/api/moyasar/intent') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      if (!moyasarConfigured()) return send(res, 503, { ok: false, message: 'Saudi payments not configured yet.' });
      const b = await readJson(req);
      const r = moyasarPlanIntent({ acc: inv.id, planId: b.plan, cycle: b.cycle, returnTo: b.returnTo });
      if (!r.ok) return send(res, 400, { ok: false, message: r.reason || 'Could not start payment.' });
      appendEvent({ ts: Date.now(), inviteeId: inv.id, email: inv.email, kind: 'billing', meta: { note: `moyasar:intent:${b.plan}:${b.cycle || 'monthly'}` } });
      return send(res, 200, r);
    }

    // Webhook — the authoritative async grant. The secret_token in the body is a
    // first gate; applyMoyasarEvent then RE-FETCHES the payment from Moyasar and
    // grants only on a real 'paid'. Always answers 200 fast so Moyasar keeps the
    // endpoint healthy.
    if (method === 'POST' && p === '/api/moyasar/webhook') {
      const raw = await readBodyRaw(req);
      let evt = {};
      try { evt = JSON.parse(raw.toString('utf-8')); } catch { return send(res, 400, { ok: false }); }
      if (!verifyMoyasarWebhook(evt)) return send(res, 401, { ok: false });
      const r = await applyMoyasarEvent(evt);
      if (r.applied) appendEvent({ ts: Date.now(), inviteeId: r.acc || '', email: '', kind: 'billing', meta: { note: `moyasar:${r.note}` } });
      return send(res, 200, { ok: true });
    }

    // Browser return (invoice success_url). Moyasar appends ?id=<payment_id>&status=…
    // We ignore the query status and re-verify server-side, grant (idempotent with
    // the webhook), then bounce the user back INTO the app they came from — the
    // studio with a ?checkout=success flag (renderer shows the success modal), or
    // the standalone /upgrade confirmation when no in-app return was given.
    if (method === 'GET' && p === '/api/moyasar/callback') {
      const paymentId = url.searchParams.get('id') || '';
      let dest = '/upgrade?done=0';
      if (paymentId) {
        const r = await applyMoyasarPaymentId(paymentId);
        if (r.applied) appendEvent({ ts: Date.now(), inviteeId: r.acc || '', email: '', kind: 'billing', meta: { note: `moyasar:${r.note}` } });
        const info = await moyasarReturnInfo(paymentId);
        const paid = r.applied || r.note === 'duplicate' || info?.status === 'paid';
        if (info && info.returnTo) {
          // Return into the app either way — success or a clear failed message.
          const sep = info.returnTo.includes('?') ? '&' : '?';
          dest = paid
            ? `${info.returnTo}${sep}checkout=success${info.plan ? `&plan=${encodeURIComponent(info.plan)}` : ''}`
            : `${info.returnTo}${sep}checkout=failed`;
        } else {
          dest = `/upgrade?done=${paid ? 1 : 0}`;
        }
      }
      res.writeHead(302, { location: dest });
      return res.end();
    }

    // ── Customer plans & pricing (dynamic; owner-editable from /admin) ──
    if (method === 'GET' && p === '/api/pricing') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      return send(res, 200, { ok: true, pricing: getPricing(), account: { plan: inv.plan || 'trial', remaining: gateStatus(inv).remaining, genLimit: inv.genLimit } });
    }
    if (method === 'POST' && p === '/api/admin/pricing') {
      if (!requireAdmin(req, url, res)) return;
      const b = await readJson(req);
      const r = setPricing(b.pricing || b);
      audit('pricing:update');
      return send(res, 200, r);
    }
    // Live USD→SAR rate for the Moyasar rail — owner keeps it current (no deploy).
    if (method === 'GET' && p === '/api/admin/sar-rate') {
      if (!requireAdmin(req, url, res)) return;
      return send(res, 200, { ok: true, rate: getSarRate() });
    }
    if (method === 'POST' && p === '/api/admin/sar-rate') {
      if (!requireAdmin(req, url, res)) return;
      const b = await readJson(req);
      const rate = Number(b.rate);
      if (!Number.isFinite(rate) || rate <= 0) return send(res, 400, { ok: false, message: 'rate must be a positive number' });
      store.setSetting('sarRate', rate);
      audit('sar-rate:update');
      return send(res, 200, { ok: true, rate });
    }

    // ── Editable profile (general info, socials, avatar) ──
    if (method === 'GET' && p === '/api/profile') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const prof = cloud.readAcctDoc(inv.id, 'profile', {}) || {};
      return send(res, 200, {
        ok: true,
        profile: {
          username: prof.username || inv.name || (inv.email || '').split('@')[0],
          headline: prof.headline || '', bio: prof.bio || '', location: prof.location || '',
          socials: prof.socials || { x: '', instagram: '', youtube: '', tiktok: '' },
          email: inv.email,
          avatar: cloud.readAvatar(inv.id) ? `/api/avatar?acc=${encodeURIComponent(inv.id)}` : null,
        },
      });
    }
    if (method === 'POST' && p === '/api/profile') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const b = await readJson(req);
      const cur = cloud.readAcctDoc(inv.id, 'profile', {}) || {};
      const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
      const next = {
        username: b.username != null ? clip(b.username, 40) : cur.username,
        headline: b.headline != null ? clip(b.headline, 80) : cur.headline,
        bio: b.bio != null ? clip(b.bio, 300) : cur.bio,
        location: b.location != null ? clip(b.location, 60) : cur.location,
        socials: b.socials ? {
          x: clip(b.socials.x, 80), instagram: clip(b.socials.instagram, 80),
          youtube: clip(b.socials.youtube, 80), tiktok: clip(b.socials.tiktok, 80),
        } : cur.socials,
      };
      cloud.writeAcctDoc(inv.id, 'profile', next);
      return send(res, 200, { ok: true, profile: next });
    }
    if (method === 'POST' && p === '/api/profile/avatar') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const b = await readJson(req);
      const base64 = String(b.base64 || '').replace(/^data:[^,]+,/, '');
      if (!base64) return send(res, 400, { ok: false, message: 'base64 required' });
      cloud.saveAvatar(inv.id, base64, (b.ext || 'png').toLowerCase());
      return send(res, 200, { ok: true, avatar: `/api/avatar?acc=${encodeURIComponent(inv.id)}` });
    }
    // Avatar served by unguessable account id (like display images) so <img> works.
    if (method === 'GET' && p === '/api/avatar') {
      const a = cloud.readAvatar(url.searchParams.get('acc') || '');
      if (!a) return send(res, 404, 'not found', 'text/plain');
      res.writeHead(200, { 'content-type': a.ct, 'cache-control': 'public, max-age=300' });
      return res.end(a.buf);
    }

    if (method === 'POST' && p === '/api/refs') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const body = await readJson(req); // { dataBase64, filename, category }
      if (!body.dataBase64) return send(res, 400, { ok: false, message: 'No file.' });
      const dir = path.join(paths.refs(), inv.id);
      fs.mkdirSync(dir, { recursive: true });
      const ext = (String(body.filename || 'png').split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
      const id = genId(10);
      const dest = path.join(dir, `${id}.${ext}`);
      fs.writeFileSync(dest, Buffer.from(String(body.dataBase64).replace(/^data:[^,]+,/, ''), 'base64'));
      return send(res, 200, { ok: true, id, path: dest, category: body.category || 'general', name: body.filename || 'ref' });
    }

    if (method === 'POST' && p === '/api/enhance') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const body = await readJson(req);
      const result = await enhancePrompt({ rawPrompt: body.rawPrompt || '', references: body.references });
      if (result.ok) appendEvent({ ts: Date.now(), inviteeId: inv.id, email: inv.email, kind: 'enhance', model: result.model, usd: result.usd });
      return send(res, 200, result);
    }

    if (method === 'GET' && p === '/api/skills') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      return send(res, 200, { ok: true, skills: listSkills().map((s) => ({ id: s.id, name: s.name })) });
    }

    // ═══════ Full-HJEN-on-Web · per-account cloud storage ═══════
    // The server-side backend for the web renderer's window.hjen. The web adapter
    // mirrors the desktop preload contract EXACTLY (src/types/hjen-bridge.d.ts) —
    // these routes return the SAME shapes (ProjectMeta, GlobalGenerationEntry,
    // LibraryAsset) so the unmodified renderer works. Every route is scoped by
    // inv.id → tenant isolation. Paths the renderer round-trips (imgPath, thumbPath,
    // filePath) are synthetic tokens: cloudgen://<pid>/<gid>.<ext> and
    // cloudlib://<file>. /api/file resolves them; adapter.js rewrites the renderer's
    // hjen-file://<token> <img src> to /api/file at load time.

    // Row (cloudstore) → GlobalGenerationEntry (renderer shape).
    const genEntry = (r) => {
      const img = `cloudgen://${r.projectId}/${r.gid}.${r.ext || 'png'}`;
      const ext = String(r.ext || 'png').toLowerCase();
      const isVideo = ext === 'mp4' || ext === 'webm' || ext === 'mov';
      // Which TOOL produced this deliverable → drives the per-tool folders in the
      // Files browser. Explicit sidecar.tool wins; else derive (video vs frame).
      const tool = r.sidecar?.tool || r.tool || (isVideo ? 'video' : 'frame');
      return {
        imgPath: img, thumbPath: img, jsonPath: `cloudgen://${r.projectId}/${r.gid}.json`,
        tool, isVideo,
        dateFolder: new Date(r.ts || 0).toISOString().slice(0, 10), baseName: r.gid, ts: r.ts || 0,
        captured: r.captured || null, promptTitle: r.promptTitle || r.promptSlug || 'Frame',
        finalSize: r.finalSize, modelLabel: r.modelLabel, quality: r.quality, resolution: r.resolution,
        aspect: r.aspect, costUsd: r.costUsd, durationMs: r.durationMs,
        referencesCount: r.referencesCount || 0,
        projectId: r.projectId || null, projectName: r.projectName || '', projectSlug: r.projectSlug || '',
      };
    };
    // Parse a synthetic token → { kind, pid, gid, ext, file }.
    const parseToken = (tok) => {
      const s = decodeURIComponent(String(tok || ''));
      let m = s.match(/^cloudgen:\/\/([^/]+)\/([^.]+)\.(\w+)$/);
      if (m) return { kind: 'gen', pid: m[1], gid: m[2], ext: m[3] };
      m = s.match(/^cloudlib:\/\/(.+)$/);
      if (m) return { kind: 'lib', file: m[1] };
      // A file inside a Cuts session's working area (shot thumb / filmstrip /
      // candidate frame). Session-scoped, and readCutsFile refuses to escape it.
      m = s.match(/^cloudcuts:\/\/([^/]+)\/(.+)$/);
      if (m) return { kind: 'cuts', session: decodeURIComponent(m[1]), file: m[2] };
      return null;
    };

    if (method === 'GET' && p === '/api/projects') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      return send(res, 200, { ok: true, ...cloud.getProjectsBundle(inv.id) });
    }
    if (method === 'POST' && p === '/api/projects') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const b = await readJson(req);
      switch (b.op) {
        case 'create': return send(res, 200, { ok: true, project: cloud.createProject(inv.id, b.name) });
        case 'rename': return send(res, 200, { ok: true, project: cloud.renameProject(inv.id, b.id, b.name) });
        case 'delete': cloud.deleteProject(inv.id, b.id); return send(res, 200, { ok: true });
        case 'cover': return send(res, 200, { ok: true, project: cloud.setProjectCover(inv.id, b.id, b.imgPath) });
        case 'setLast': cloud.setLastProjectId(inv.id, b.id); return send(res, 200, { ok: true });
        case 'patchMeta': return send(res, 200, { ok: true, project: cloud.patchProjectMeta(inv.id, b.id, b.patch || {}) });
        default: return send(res, 400, { ok: false, message: 'unknown op' });
      }
    }
    // Generic JSON docs — scope 'project' (needs pid) or 'account'.
    if (method === 'GET' && p === '/api/doc') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const scope = url.searchParams.get('scope'); const key = url.searchParams.get('key');
      const data = scope === 'account'
        ? cloud.readAcctDoc(inv.id, key, null)
        : cloud.readProjectDoc(inv.id, url.searchParams.get('pid'), key, null);
      return send(res, 200, { ok: true, data });
    }
    if (method === 'POST' && p === '/api/doc') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const b = await readJson(req);
      if (b.scope === 'account') cloud.writeAcctDoc(inv.id, b.key, b.data);
      else cloud.writeProjectDoc(inv.id, b.pid, b.key, b.data);
      return send(res, 200, { ok: true });
    }
    // Save a generation → returns { imgPath, jsonPath, dir } like the desktop.
    if (method === 'POST' && p === '/api/gen') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const b = await readJson(req);
      const base64 = String(b.base64 || '').replace(/^data:[^,]+,/, '');
      if (!b.pid || !base64) return send(res, 400, { ok: false, message: 'pid + base64 required' });
      const r = cloud.saveGeneration(inv.id, {
        pid: b.pid, base64, ext: b.ext || 'png', sidecar: b.sidecar || {}, promptSlug: b.promptSlug || 'frame',
        projectName: b.projectName || '', projectSlug: b.projectSlug || '',
      });
      const img = `cloudgen://${b.pid}/${r.gid}.${r.ext}`;
      return send(res, 200, { ok: true, imgPath: img, thumbPath: img, jsonPath: `cloudgen://${b.pid}/${r.gid}.json`, dir: `cloudgen://${b.pid}` });
    }
    if (method === 'GET' && p === '/api/gens') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      return send(res, 200, { ok: true, items: cloud.listAllGenerations(inv.id).map(genEntry) });
    }
    // Files browser source — ONLY real, present, downloadable deliverables (drops
    // orphaned index rows whose blob is gone), each tagged with its `tool` so the
    // UI can group into per-tool folders. Never lists json/system files.
    if (method === 'GET' && p === '/api/files') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      return send(res, 200, { ok: true, items: cloud.listAllGenerations(inv.id, { presentOnly: true }).map(genEntry) });
    }
    // Op-log — the cloud-first sync backbone + history. `?since=<seq>` returns ops
    // after a cursor (the desktop sync agent's pull); `cursor` is the newest seq.
    if (method === 'GET' && p === '/api/oplog') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const since = parseInt(url.searchParams.get('since') || '0', 10) || 0;
      return send(res, 200, { ok: true, ops: cloud.readOps(inv.id, since), cursor: cloud.opCursor(inv.id) });
    }
    if (method === 'POST' && p === '/api/gen/delete') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const b = await readJson(req); const t = parseToken(b.imgPath);
      if (t?.kind === 'gen') cloud.deleteGeneration(inv.id, t.pid, t.gid);
      return send(res, 200, { ok: true });
    }
    if (method === 'GET' && p === '/api/sidecar') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const t = parseToken(url.searchParams.get('path'));
      const row = t?.kind === 'gen' ? cloud.readGenerationRow(inv.id, t.pid, t.gid) : null;
      return send(res, 200, { ok: true, data: row?.sidecar || null });
    }
    // Reference library.
    if (method === 'GET' && p === '/api/lib') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      return send(res, 200, { ok: true, items: cloud.listLibrary(inv.id) });
    }
    if (method === 'POST' && p === '/api/lib') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const b = await readJson(req);
      switch (b.op) {
        case 'add': {
          const base64 = String(b.base64 || '').replace(/^data:[^,]+,/, '');
          const asset = cloud.addLibraryAsset(inv.id, { category: b.category || 'general', base64, ext: b.ext || 'png', name: b.name });
          return send(res, 200, { ok: true, asset });
        }
        case 'delete': cloud.deleteLibraryAsset(inv.id, b.id); return send(res, 200, { ok: true });
        case 'rename': return send(res, 200, { ok: true, asset: cloud.renameLibraryAsset(inv.id, b.id, b.name) });
        case 'move': return send(res, 200, { ok: true, asset: cloud.moveLibraryAsset(inv.id, b.id, b.newCategory) });
        default: return send(res, 400, { ok: false, message: 'unknown op' });
      }
    }
    // Serve any synthetic blob token (token in query so <img src> works). Both
    // /api/g (legacy) and /api/file route here; scoped to the authenticated owner.
    if (method === 'GET' && (p === '/api/file' || p === '/api/g')) {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const t = parseToken(url.searchParams.get('path') || url.searchParams.get('p'));
      const w = parseInt(url.searchParams.get('w') || '0', 10);
      // Display request (?w=…): serve a small resized WebP instead of the full
      // multi-MB master, so the browser gets the image fast. Cached on disk +
      // long-lived (immutable — a gid's pixels never change), so repeat views hit
      // browser/edge cache. The full master is still served without ?w for download.
      if (w > 0 && t?.kind === 'gen') {
        const d = await cloud.resizedBlobAsync(inv.id, t.pid, t.gid, t.ext, w);
        if (d) { res.writeHead(200, { 'content-type': d.ct, 'cache-control': 'public, max-age=604800, immutable' }); return res.end(d.buf); }
      }
      let buf = null, ct = 'image/png', dlName = '';
      if (t?.kind === 'gen') {
        buf = cloud.readBlob(inv.id, t.pid, t.gid, t.ext);
        ct = t.ext === 'mp4' ? 'video/mp4' : t.ext === 'jpg' || t.ext === 'jpeg' ? 'image/jpeg' : t.ext === 'webp' ? 'image/webp' : 'image/png';
        // Readable download name from the gen's own sidecar (its typed prompt),
        // not the raw gid — "a-plain-grey-ceramic-cup_<gid>.png".
        try { const row = cloud.readGenerationRow(inv.id, t.pid, t.gid); const base = String(row?.promptSlug || row?.sidecar?.promptTitle || 'hjen').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'hjen'; dlName = `${base}_${t.gid}.${t.ext}`; } catch { dlName = `hjen_${t.gid}.${t.ext}`; }
      } else if (t?.kind === 'lib') {
        buf = cloud.readLibraryBlob(inv.id, t.file); const e = (t.file.split('.').pop() || '').toLowerCase();
        ct = e === 'jpg' || e === 'jpeg' ? 'image/jpeg' : e === 'webp' ? 'image/webp' : 'image/png';
        dlName = (t.file.split('/').pop() || `hjen.${e}`);
      } else if (t?.kind === 'cuts') {
        buf = cloud.readCutsFile(inv.id, t.session, t.file); const e = (t.file.split('.').pop() || '').toLowerCase();
        ct = e === 'mp4' ? 'video/mp4' : e === 'png' ? 'image/png' : e === 'webp' ? 'image/webp' : 'image/jpeg';
        dlName = (t.file.split('/').pop() || `hjen.${e}`);
      }
      if (!buf) return send(res, 404, { ok: false });
      const headers = { 'content-type': ct, 'cache-control': 'private, max-age=86400' };
      // ?download=1 → force a real file download with a clean name (Anwar's #1).
      if (url.searchParams.get('download') === '1' && dlName) headers['content-disposition'] = `attachment; filename="${dlName.replace(/"/g, '')}"`;
      res.writeHead(200, headers);
      return res.end(buf);
    }

    // A user's persisted library — their saved shots, newest first. Makes the
    // funded account feel real: return later and your work is still here.
    if (method === 'GET' && p === '/api/history') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const dir = path.join(paths.outputs(), inv.id);
      let items = [];
      try {
        items = fs.readdirSync(dir).filter((f) => f.endsWith('.png'))
          .map((f) => ({ f, ts: parseInt(f.split('_')[0], 10) || 0 }))
          .sort((a, b) => b.ts - a.ts).slice(0, 60);
      } catch { /* no outputs yet */ }
      return send(res, 200, { ok: true, items });
    }

    // Image models the web studio may pick from. Data-driven (never hardcode one
    // in the client) — as direct doors open (Azure OpenAI, FLUX Pro) they get
    // added here and appear in the picker with zero client change.
    if (method === 'GET' && p === '/api/models') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      return send(res, 200, { ok: true, models: [{ id: config.imageModel || 'gpt-image-2', label: 'ChatGPT Image 2.0' }] });
    }

    if (method === 'POST' && p === '/api/skill/run') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const body = await readJson(req);
      const result = await runSkill({ skillId: body.skillId || '', prompt: body.prompt || '' });
      if (result.ok) appendEvent({ ts: Date.now(), inviteeId: inv.id, email: inv.email, kind: 'skill', model: result.model, usd: result.usd, meta: { skill: result.skillName } });
      return send(res, 200, result);
    }

    // ----- cloud gateway: Seedance video (async: submit meters, poll is free) -----
    // Video is a submit→poll flow. We meter one make on SUBMIT only; POLL just
    // forwards (no charge). Both inject the server-side ARK key. If submit fails
    // upstream, the make is refunded.
    if (method === 'POST' && p === '/v1/ark/submit') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      if (!config.arkKey) return send(res, 500, { ok: false, message: 'ARK_API_KEY not configured on the server.' });
      const body = await readJson(req); // { arkBase, body }
      const reservation = await store.consumeMake(inv.magicToken);
      if (!reservation.ok) {
        const message = reservation.reason === 'expired' ? 'Your trial has ended.' : reservation.reason === 'exhausted' ? 'You have reached your shot limit.' : 'Your access has been paused.';
        return send(res, 403, { ok: false, reason: reservation.reason, message });
      }
      try {
        const base = String(body.arkBase || 'https://ark.ap-southeast.bytepluses.com/api/v3').replace(/\/$/, '');
        const upstream = await schedule(bucketKey('byteplus', (body.body || {}).model || 'seedance'), () => fetch(`${base}/contents/generations/tasks`, {
          method: 'POST',
          headers: { authorization: `Bearer ${config.arkKey}`, 'content-type': 'application/json' },
          body: JSON.stringify(body.body || {}),
        }));
        const text = await upstream.text();
        if (!upstream.ok) { await store.refund(inv.magicToken); res.writeHead(upstream.status, { 'content-type': 'application/json' }); return res.end(text); }
        // VERIFY: a 200 with no task id means the job wasn't accepted → refund.
        let taskId = ''; try { const d = JSON.parse(text); taskId = d.id || d.data?.id || d.task_id || ''; } catch {}
        if (!taskId) { await store.refund(inv.magicToken); appendEvent({ ts: Date.now(), inviteeId: inv.id, email: inv.email, kind: 'make-refund', meta: { kind: 'video', provider: 'ark', why: 'no_task_id' } }); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(text); }
        // Register for server-side completion so a closed tab never loses the clip.
        { const projectId = String(req.headers['x-hjen-project'] || ''); const bb = body.body || {}; let vprompt = ''; try { vprompt = String((bb.content || []).find?.((c) => c.type === 'text')?.text || bb.prompt || '').slice(0, 200); } catch {} if (projectId) cloud.addVideoJob({ acc: inv.id, token: inv.magicToken, taskId, provider: 'ark', base, projectId, prompt: vprompt, res: bb.resolution, dur: bb.duration, ratio: bb.ratio, model: bb.model }); }
        appendEvent({ ts: Date.now(), inviteeId: inv.id, email: inv.email, kind: 'make', model: 'seedance', usd: 0.5, meta: { via: 'gateway', kind: 'video', provider: 'ark', taskId } });
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }); return res.end(text);
      } catch (err) { await store.refund(inv.magicToken); return send(res, 502, { ok: false, reason: 'provider_error', message: String(err?.message || err) }); }
    }
    if (method === 'POST' && p === '/v1/ark/poll') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      if (!config.arkKey) return send(res, 500, { ok: false, message: 'ARK_API_KEY not configured.' });
      const body = await readJson(req); // { arkBase, taskId }
      try {
        const base = String(body.arkBase || 'https://ark.ap-southeast.bytepluses.com/api/v3').replace(/\/$/, '');
        const upstream = await fetch(`${base}/contents/generations/tasks/${encodeURIComponent(String(body.taskId || ''))}`, {
          headers: { authorization: `Bearer ${config.arkKey}` },
        });
        const text = await upstream.text();
        // The render can fail AFTER we charged on submit → refund that make once.
        try { const st = String(JSON.parse(text).status || '').toLowerCase(); if (st === 'failed' || st === 'error' || st === 'cancelled') { const r = await store.refundForTask(inv.magicToken, String(body.taskId || '')); if (r.ok) appendEvent({ ts: Date.now(), inviteeId: inv.id, email: inv.email, kind: 'make-refund', meta: { kind: 'video', provider: 'ark', why: 'render_' + st, taskId: body.taskId } }); } } catch {}
        res.writeHead(upstream.status, { 'content-type': 'application/json; charset=utf-8' }); return res.end(text);
      } catch (err) { return send(res, 502, { ok: false, reason: 'provider_error', message: String(err?.message || err) }); }
    }

    // ----- cloud gateway: Kling video (async, mirrors Ark) -----
    if (method === 'POST' && p === '/v1/kling/submit') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      if (!config.klingKey) return send(res, 500, { ok: false, message: 'KLING_API_KEY not configured on the server.' });
      const body = await readJson(req); // { klingBase, videoType, body }
      const reservation = await store.consumeMake(inv.magicToken);
      if (!reservation.ok) {
        const message = reservation.reason === 'expired' ? 'Your trial has ended.' : reservation.reason === 'exhausted' ? 'You have reached your shot limit.' : 'Your access has been paused.';
        return send(res, 403, { ok: false, reason: reservation.reason, message });
      }
      try {
        const base = String(body.klingBase || 'https://api-singapore.klingai.com').replace(/\/$/, '');
        const vt = String(body.videoType || 'text2video');
        const upstream = await schedule(bucketKey('kling', (body.body || {}).model_name || 'kling'), () => fetch(`${base}/v1/videos/${vt}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${config.klingKey}`, 'content-type': 'application/json' },
          body: JSON.stringify(body.body || {}),
        }));
        const text = await upstream.text();
        // Kling wraps { code, message, data } — refund if HTTP error OR code != 0.
        let klingCode = 0; try { klingCode = JSON.parse(text).code; } catch { /* ignore */ }
        let ktask = ''; try { ktask = JSON.parse(text).data?.task_id || ''; } catch {}
        if (!upstream.ok || (klingCode !== 0 && klingCode !== '0') || !ktask) {
          await store.refund(inv.magicToken);
          appendEvent({ ts: Date.now(), inviteeId: inv.id, email: inv.email, kind: 'make-refund', meta: { kind: 'video', provider: 'kling', why: !ktask ? 'no_task_id' : 'code_' + klingCode } });
          res.writeHead(upstream.ok ? 200 : upstream.status, { 'content-type': 'application/json' }); return res.end(text);
        }
        { const projectId = String(req.headers['x-hjen-project'] || ''); let vprompt = ''; try { vprompt = String(body.body?.prompt || '').slice(0, 200); } catch {} if (projectId) cloud.addVideoJob({ acc: inv.id, token: inv.magicToken, taskId: ktask, provider: 'kling', base, videoType: vt, projectId, prompt: vprompt }); }
        appendEvent({ ts: Date.now(), inviteeId: inv.id, email: inv.email, kind: 'make', model: 'kling', usd: 0.5, meta: { via: 'gateway', kind: 'video', provider: 'kling', taskId: ktask } });
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }); return res.end(text);
      } catch (err) { await store.refund(inv.magicToken); return send(res, 502, { ok: false, reason: 'provider_error', message: String(err?.message || err) }); }
    }
    if (method === 'POST' && p === '/v1/kling/poll') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      if (!config.klingKey) return send(res, 500, { ok: false, message: 'KLING_API_KEY not configured.' });
      const body = await readJson(req); // { klingBase, videoType, taskId }
      try {
        const base = String(body.klingBase || 'https://api-singapore.klingai.com').replace(/\/$/, '');
        const vt = String(body.videoType || 'text2video');
        const upstream = await fetch(`${base}/v1/videos/${vt}/${encodeURIComponent(String(body.taskId || ''))}`, {
          headers: { authorization: `Bearer ${config.klingKey}` },
        });
        const text = await upstream.text();
        // Render failed after the submit charge → refund that make once.
        try { const st = String(JSON.parse(text).data?.task_status || '').toLowerCase(); if (st === 'failed' || st === 'error') { const r = await store.refundForTask(inv.magicToken, String(body.taskId || '')); if (r.ok) appendEvent({ ts: Date.now(), inviteeId: inv.id, email: inv.email, kind: 'make-refund', meta: { kind: 'video', provider: 'kling', why: 'render_failed', taskId: body.taskId } }); } } catch {}
        res.writeHead(upstream.status, { 'content-type': 'application/json; charset=utf-8' }); return res.end(text);
      } catch (err) { return send(res, 502, { ok: false, reason: 'provider_error', message: String(err?.message || err) }); }
    }

    // ----- the EYE: rank image candidates by how they FEEL -----
    // Frameset and every image search rank by TEXT. The eye ranks the PIXELS, and
    // it lives here rather than in the app because the recipe (CAVs, fusion
    // constant, which registers the eye is allowed to override on) is the secret
    // sauce — the client sends a state and a list of URLs and gets back an order.
    // Free: no credit is metered, this spends CPU, not a provider call.
    if (method === 'POST' && p === '/v1/eye/rank') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const b = await readJson(req); // { state:{register,beat,energy}, candidates:[{id,url}], mode? }
      const candidates = Array.isArray(b.candidates)
        ? b.candidates.filter((c) => c && typeof c.url === 'string').slice(0, 200)
        : [];
      if (!candidates.length) return send(res, 400, { ok: false, message: 'No candidates to rank.' });
      const { rank } = await import('./eye/rank.js');
      const out = await rank({ state: b.state || {}, candidates, mode: b.mode || 'auto' });
      // A failed rank is NOT an error the caller should die on — it falls back to
      // the source's own order, so the board never comes back empty.
      return send(res, 200, out);
    }
    if (method === 'GET' && p === '/v1/eye/status') {
      const { eyeStatus } = await import('./eye/rank.js');
      return send(res, 200, { ok: true, eye: eyeStatus() });
    }

    // ═══ Ported creative engines — the Eye · The Swap · Reference Maker ·
    // Context Agents ══════════════════════════════════════════════════════════
    // These four were written for the Electron MAIN process so their recipes
    // would never reach a renderer. The web runs the SAME renderer, so parity
    // means putting the same engines behind the same seam HERE — not shipping
    // the prompts to the browser. Each route is a thin adapter over the port in
    // src/{eye,swap,reference,contextagents}/; metering happens inside
    // src/llm/run.js exactly as it does for /v1/llm.
    if (method === 'POST' && p.startsWith('/api/engine/')) {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const b = await readJson(req);
      const door = p.slice('/api/engine/'.length);
      try {
        switch (door) {
          // ── the Eye ──
          case 'eye/read':          { const m = await import('./eye/engine.js'); return send(res, 200, await m.eyeRead(inv, b)); }
          case 'eye/golden-write':  { const m = await import('./eye/engine.js'); return send(res, 200, m.eyeGoldenWrite(inv, b?.entry)); }
          case 'eye/status':        { const m = await import('./eye/engine.js'); return send(res, 200, m.eyeStatus(inv)); }
          // ── The Swap ──
          case 'swap/slots':        { const { swap } = await import('./swap/engine.js'); return send(res, 200, await swap.slots(inv, b)); }
          case 'swap/consequence':  { const { swap } = await import('./swap/engine.js'); return send(res, 200, await swap.consequence(inv, b)); }
          case 'swap/plan':         { const { swap } = await import('./swap/engine.js'); return send(res, 200, await swap.plan(inv, b)); }
          case 'swap/compose':      { const { swap } = await import('./swap/engine.js'); return send(res, 200, await swap.compose(inv, b)); }
          case 'swap/verify':       { const { swap } = await import('./swap/engine.js'); return send(res, 200, await swap.verify(inv, b)); }
          case 'swap/golden-write': { const { swap } = await import('./swap/engine.js'); return send(res, 200, swap.goldenWrite(inv, b)); }
          case 'swap/status':       { const { swap } = await import('./swap/engine.js'); return send(res, 200, swap.status(inv)); }
          // ── Reference Maker ──
          case 'reference/understand':       { const { referenceScene } = await import('./reference/scene.js'); return send(res, 200, await referenceScene.understand(inv, b)); }
          case 'reference/drift':            { const { referenceScene } = await import('./reference/scene.js'); return send(res, 200, await referenceScene.drift(inv, b)); }
          case 'reference/revise-contract':  { const { referenceScene } = await import('./reference/scene.js'); return send(res, 200, await referenceScene.reviseContract(inv, b)); }
          // ── Context Agents ──
          case 'ca/apply':          { const { ca } = await import('./contextagents/engine.js'); return send(res, 200, await ca.apply(inv, b)); }
          case 'ca/vocab':          { const { ca } = await import('./contextagents/engine.js'); return send(res, 200, ca.vocab()); }
          case 'ca/list-methods':   { const { ca } = await import('./contextagents/engine.js'); return send(res, 200, ca.listMethods(inv)); }
          case 'ca/list-profiles':  { const { ca } = await import('./contextagents/engine.js'); return send(res, 200, ca.listProfiles(inv)); }
          case 'ca/read-card':      { const { ca } = await import('./contextagents/engine.js'); return send(res, 200, ca.readCard(inv, b)); }
          case 'ca/write-card':     { const { ca } = await import('./contextagents/engine.js'); return send(res, 200, ca.writeCard(inv, b)); }
          case 'ca/delete-card':    { const { ca } = await import('./contextagents/engine.js'); return send(res, 200, ca.deleteCard(inv, b)); }
          case 'ca/read-lexicon':   { const { ca } = await import('./contextagents/engine.js'); return send(res, 200, ca.readLexicon(inv, b)); }
          case 'ca/write-lexicon':  { const { ca } = await import('./contextagents/engine.js'); return send(res, 200, ca.writeLexiconEntry(inv, b)); }
          case 'ca/study':          { const { ca } = await import('./contextagents/engine.js'); return send(res, 200, await ca.study()); }
          case 'ca/status':         { const { ca } = await import('./contextagents/engine.js'); return send(res, 200, ca.status(inv)); }
          case 'ca/eye-pick':       { const { ca } = await import('./contextagents/engine.js'); return send(res, 200, await ca.eyePick(inv, b)); }
          case 'ca/eye-query':      { const { ca } = await import('./contextagents/engine.js'); return send(res, 200, await ca.eyeQuery(inv, b)); }
          case 'ca/eye-confirm':    { const { ca } = await import('./contextagents/engine.js'); return send(res, 200, await ca.eyeConfirmFrames(inv, b)); }
          case 'ca/eye-judge':      { const { ca } = await import('./contextagents/engine.js'); return send(res, 200, ca.eyeJudge(inv, b)); }
          case 'ca/eye-status':     { const { ca } = await import('./contextagents/engine.js'); return send(res, 200, ca.eyeStatus(inv)); }
          default: return send(res, 404, { ok: false, message: `No engine door "${door}".` });
        }
      } catch (err) {
        return send(res, 500, { ok: false, reason: 'engine_error', message: String(err?.message || err).slice(0, 300) });
      }
    }

    // ═══ Cuts — server-side ffmpeg + the six vision passes ═══════════════════
    // The video is uploaded once into the session's working area; every door
    // then works from there. Doors are bound to the account so a session id can
    // never reach another account's files.
    if (method === 'POST' && p === '/api/cuts/upload') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const sessionId = String(req.headers['x-hjen-session'] || '').trim();
      if (!sessionId) return send(res, 400, { ok: false, message: 'X-HJEN-Session header is required.' });
      const filename = String(req.headers['x-hjen-filename'] || 'video.mp4');
      let buf;
      try { buf = await readBodyRawCapped(req); }
      catch { return send(res, 413, { ok: false, reason: 'too_large', message: 'Video too large (max 100MB).' }); }
      if (!buf || buf.length < 1000) return send(res, 400, { ok: false, message: 'No video received.' });
      const dir = cloud.cutsDir(inv.id, sessionId);
      const ext = (path.extname(filename) || '.mp4').toLowerCase().replace(/[^.\w]/g, '');
      const target = path.join(dir, `source${ext || '.mp4'}`);
      try { fs.writeFileSync(target, buf); }
      catch (e) { return send(res, 500, { ok: false, message: `Could not save upload: ${String(e?.message || e)}` }); }
      return send(res, 200, {
        ok: true, sessionId,
        videoPath: `cloudcuts://${encodeURIComponent(sessionId)}/source${ext || '.mp4'}`,
        bytes: buf.length,
      });
    }
    if (method === 'POST' && p.startsWith('/api/cuts/')) {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const b = await readJson(req);
      const door = p.slice('/api/cuts/'.length);
      const MAP = {
        analyze: 'analyze', 'shot-frames': 'shotFrames', fetch: 'fetchUrl', embed: 'embed',
        speech: 'speech', verify: 'verify', watch: 'watch', people: 'people',
        'verify-groups': 'verifyGroups', dna: 'dna', story: 'story', brief: 'brief',
        source: 'source', 'has-audio': 'hasAudio',
      };
      const fn = MAP[door];
      if (!fn) return send(res, 404, { ok: false, message: `No Cuts door "${door}".` });
      try {
        const { bindCuts } = await import('./cuts/engine.js');
        return send(res, 200, await bindCuts(inv)[fn](b));
      } catch (err) {
        // A quota refusal thrown out of the metered fetch is a 403, not a 500.
        if (err?.reason) return send(res, 403, { ok: false, reason: err.reason, message: String(err.message || '') });
        return send(res, 500, { ok: false, reason: 'cuts_error', message: String(err?.message || err).slice(0, 300) });
      }
    }

    // ----- fetch a remote asset as base64 -----
    // kling.ts / seedance.ts / the Enhancer hand the app a vendor URL and need
    // the BYTES. On desktop main fetches it directly; a browser cannot, because
    // no vendor CDN sends CORS headers. So the server fetches it instead.
    // SSRF guard: only http(s), and never a private/loopback/link-local host —
    // an authenticated user must not be able to aim this at the VPC.
    if (method === 'POST' && p === '/api/fetch-url') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const b = await readJson(req);
      let target;
      try { target = new URL(String(b.url || '')); } catch { return send(res, 400, { ok: false, message: 'Not a URL.' }); }
      if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        return send(res, 400, { ok: false, message: 'Only http and https can be fetched.' });
      }
      const host = target.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      const privateHost = host === 'localhost' || host === '::1' || host.endsWith('.localhost') || host.endsWith('.internal')
        || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)
        || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^169\.254\./.test(host)
        || /^0\./.test(host) || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host);
      if (privateHost) return send(res, 400, { ok: false, message: 'That host cannot be fetched.' });
      try {
        const r = await fetch(target.href, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
        if (!r.ok) return send(res, 200, { ok: false, message: `Fetch failed: ${r.status}` });
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 64 * 1024 * 1024) return send(res, 200, { ok: false, message: 'That file is too large to inline.' });
        return send(res, 200, { ok: true, base64: buf.toString('base64'), mime: r.headers.get('content-type') || '' });
      } catch (err) {
        return send(res, 200, { ok: false, message: String(err?.message || err).slice(0, 200) });
      }
    }

    // ----- cloud gateway: async gpt-image-2 (submit → poll) -----
    // The synchronous /v1/openai door dies with Cloudflare 524 on slow HIGH-quality
    // renders. This pair renders in the background instead: SUBMIT meters one make
    // and returns a jobId fast; POLL is free and returns the image when ready. See
    // imageJobs + runImageJob above.
    if (method === 'POST' && p === '/v1/image/submit') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      if (!config.openaiKey) return send(res, 500, { ok: false, message: 'OPENAI_API_KEY not configured on the server.' });
      const b = await readJson(req); // { modelId?, prompt, size, quality, images?: base64[] }
      const prompt = String(b.prompt || '').trim();
      if (!prompt) return send(res, 400, { ok: false, message: 'Type a prompt first.' });
      const model = String(b.modelId || config.imageModel || 'gpt-image-2');
      const size = String(b.size || DEFAULT_SIZE);
      const quality = ['low', 'medium', 'high'].includes(b.quality) ? b.quality : 'high';
      const images = Array.isArray(b.images) ? b.images.filter((x) => typeof x === 'string').slice(0, 16) : [];
      // Reserve one credit UP FRONT (atomic — no overdraw under concurrency).
      const reservation = await store.consumeMake(inv.magicToken);
      if (!reservation.ok) {
        const message = reservation.reason === 'expired' ? 'Your trial has ended.' : reservation.reason === 'exhausted' ? 'You have reached your shot limit.' : 'Your access has been paused.';
        return send(res, 403, { ok: false, reason: reservation.reason, message });
      }
      const jobId = 'img_' + genId();
      imageJobs.set(jobId, { status: 'pending', phase: 'queued', magicToken: inv.magicToken, inv: { id: inv.id, email: inv.email }, settled: false, ts: Date.now() });
      runImageJob(jobId, { model, size, quality, prompt, images }).catch(() => {}); // fire-and-forget; errors land on the job
      return send(res, 200, { ok: true, jobId });
    }
    if (method === 'POST' && p === '/v1/image/poll') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const b = await readJson(req); // { jobId }
      const jobId = String(b.jobId || '');
      const job = imageJobs.get(jobId);
      if (!job) return send(res, 200, { ok: true, status: 'error', message: 'This render expired on the server — please make it again.' });
      if (job.inv.id !== inv.id) return send(res, 403, { ok: false, message: 'Not your render.' });
      if (job.status === 'pending') return send(res, 200, { ok: true, status: 'pending', phase: job.phase || 'rendering', queued: totalQueued() });
      if (job.status === 'error') { const message = job.message || 'Render failed.'; imageJobs.delete(jobId); return send(res, 200, { ok: true, status: 'error', message }); }
      const b64 = job.b64; imageJobs.delete(jobId); // deliver once, then free the memory
      return send(res, 200, { ok: true, status: 'done', b64 });
    }

    // ----- cloud gateway: unified text-LLM proxy (anthropic/openai/google) -----
    // Mirrors the app's hjen:llm-json door. The app posts {provider, url, headers,
    // body}; we verify the invitee, meter one make, inject the server-side key for
    // that provider, forward verbatim, and refund on failure. One door, three vendors.
    // ----- creative-pipeline text door: system prompt injected SERVER-SIDE -----
    // Same as /v1/llm, but the client sends a promptId (+ optional vars) and an
    // EMPTY system in its vendor body; the server resolves the real system from
    // its registry and injects it per-provider. The recipe never ships in the
    // client bundle or crosses the wire. LAW: the recipe lives on the server.
    if (method === 'POST' && p === '/v1/llm-task') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const body = await readJson(req); // { provider, upstreamUrl, headers, body, promptId, vars }
      const provider = String(body.provider || '');
      const keyMap = { anthropic: config.anthropicKey, openai: config.openaiKey, google: config.googleKey };
      const key = keyMap[provider];
      if (!key) return send(res, 400, { ok: false, message: `Server has no ${provider} key.` });

      // Resolve the system prompt from the SERVER registry — never from the client.
      let system;
      try { system = buildLlmSystem(String(body.promptId || ''), body.vars || {}); }
      catch (e) { return send(res, 400, { ok: false, reason: 'unknown_prompt', message: String(e?.message || e) }); }

      // Inject the system into the vendor body in the provider's expected slot.
      const vbody = { ...(body.body || {}) };
      if (provider === 'anthropic') {
        vbody.system = system;
      } else if (provider === 'openai') {
        const msgs = Array.isArray(vbody.messages) ? vbody.messages.filter((m) => m.role !== 'system') : [];
        vbody.messages = [{ role: 'system', content: system }, ...msgs];
      } else if (provider === 'google') {
        if (Array.isArray(vbody.contents) && vbody.contents[0] && Array.isArray(vbody.contents[0].parts)) {
          vbody.contents[0].parts = [{ text: system }, ...vbody.contents[0].parts];
        } else {
          vbody.systemInstruction = { parts: [{ text: system }] };
        }
      }

      const reservation = await store.consumeMake(inv.magicToken);
      if (!reservation.ok) {
        const message = reservation.reason === 'expired' ? 'Your trial has ended.' : reservation.reason === 'exhausted' ? 'You have reached your shot limit.' : 'Your access has been paused.';
        return send(res, 403, { ok: false, reason: reservation.reason, message });
      }
      try {
        let upstreamUrl = String(body.upstreamUrl || '');
        const headers = { ...(body.headers || {}) };
        if (provider === 'anthropic') headers['x-api-key'] = key;
        else if (provider === 'openai') headers['authorization'] = `Bearer ${key}`;
        else if (provider === 'google') upstreamUrl = upstreamUrl.replace(/([?&]key=)[^&]*/, '$1' + key);
        const upstream = await schedule(bucketKey(provider, String(vbody.model || provider)), () => fetch(upstreamUrl, { method: 'POST', headers, body: JSON.stringify(vbody) }));
        const text = await upstream.text();
        if (!upstream.ok) {
          await store.refund(inv.magicToken);
          res.writeHead(upstream.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          return res.end(text);
        }
        let hasText = false;
        try {
          const d = JSON.parse(text);
          if (provider === 'anthropic') hasText = Array.isArray(d.content) && d.content.some((c) => c.type === 'text' && String(c.text || '').trim());
          else if (provider === 'openai') hasText = !!String(d.choices?.[0]?.message?.content || '').trim();
          else hasText = !!(d.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('').trim();
        } catch { /* non-json → treat as no text */ }
        if (!hasText) {
          await store.refund(inv.magicToken);
          appendEvent({ ts: Date.now(), inviteeId: inv.id, email: inv.email, kind: 'make-refund', meta: { kind: 'llm-task', provider, promptId: body.promptId, why: 'empty_result' } });
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          return res.end(text);
        }
        const reqModel = String(vbody.model || '') || (upstreamUrl.match(/models\/([^:?]+)/)?.[1] ?? provider);
        const real = realLlmUsd(provider, reqModel, text);
        appendEvent({ ts: Date.now(), inviteeId: inv.id, email: inv.email, kind: 'make', model: reqModel, usd: real ? Number(real.usd.toFixed(6)) : 0.01, meta: { via: 'llm-task', kind: 'llm', provider, promptId: body.promptId, ...(real ? { inTok: real.inTok, outTok: real.outTok, real: true } : { estimated: true }) } });
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(text);
      } catch (err) {
        await store.refund(inv.magicToken);
        return send(res, 502, { ok: false, reason: 'provider_error', message: String(err?.message || err) });
      }
    }

    if (method === 'POST' && p === '/v1/llm') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const body = await readJson(req); // { provider, upstreamUrl, headers, body }
      const provider = String(body.provider || '');
      const keyMap = { anthropic: config.anthropicKey, openai: config.openaiKey, google: config.googleKey };
      const key = keyMap[provider];
      if (!key) return send(res, 400, { ok: false, message: `Server has no ${provider} key.` });

      const reservation = await store.consumeMake(inv.magicToken);
      if (!reservation.ok) {
        const message = reservation.reason === 'expired' ? 'Your trial has ended.' : reservation.reason === 'exhausted' ? 'You have reached your shot limit.' : 'Your access has been paused.';
        return send(res, 403, { ok: false, reason: reservation.reason, message });
      }
      try {
        // Inject the real key into the provider's auth header / URL.
        let upstreamUrl = String(body.upstreamUrl || '');
        const headers = { ...(body.headers || {}) };
        if (provider === 'anthropic') headers['x-api-key'] = key;
        else if (provider === 'openai') headers['authorization'] = `Bearer ${key}`;
        else if (provider === 'google') upstreamUrl = upstreamUrl.replace(/([?&]key=)[^&]*/,'$1'+key);
        const upstream = await schedule(bucketKey(provider, String((body.body || {}).model || provider)), () => fetch(upstreamUrl, { method: 'POST', headers, body: JSON.stringify(body.body || {}) }));
        const text = await upstream.text();
        if (!upstream.ok) {
          await store.refund(inv.magicToken);
          res.writeHead(upstream.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          return res.end(text);
        }
        // VERIFY BEFORE COMMIT: a 200 with no text is not a result — refund.
        let hasText = false;
        try {
          const d = JSON.parse(text);
          if (provider === 'anthropic') hasText = Array.isArray(d.content) && d.content.some((c) => c.type === 'text' && String(c.text || '').trim());
          else if (provider === 'openai') hasText = !!String(d.choices?.[0]?.message?.content || '').trim();
          else hasText = !!(d.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('').trim();
        } catch { /* non-json → treat as no text */ }
        if (!hasText) {
          await store.refund(inv.magicToken);
          appendEvent({ ts: Date.now(), inviteeId: inv.id, email: inv.email, kind: 'make-refund', meta: { kind: 'llm', provider, why: 'empty_result' } });
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          return res.end(text);
        }
        // Log REAL token-based spend when the vendor returns usage; else fall back to a flat estimate.
        const reqModel = String((body.body && body.body.model) || '') || (String(body.upstreamUrl || '').match(/models\/([^:?]+)/)?.[1] ?? provider);
        const real = realLlmUsd(provider, reqModel, text);
        appendEvent({ ts: Date.now(), inviteeId: inv.id, email: inv.email, kind: 'make', model: reqModel, usd: real ? Number(real.usd.toFixed(6)) : 0.01, meta: { via: 'gateway', kind: 'llm', provider, ...(real ? { inTok: real.inTok, outTok: real.outTok, real: true } : { estimated: true }) } });
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(text);
      } catch (err) {
        await store.refund(inv.magicToken);
        return send(res, 502, { ok: false, reason: 'provider_error', message: String(err?.message || err) });
      }
    }

    // ----- Frame: server-side recipe + generation (IP stays on the box) -------
    // The client sends only RAW selections + reference-layer metadata (+ bytes);
    // the proprietary prompt is composed HERE (buildPrompt), never in the browser
    // and never on the wire. We meter one make, call the provider with the real
    // key, optionally persist server-side (survives a closed tab), and return the
    // image WITHOUT the composed prompt. LAW: the recipe lives on the server.
    // ----- Breakdown: server-side video ingest (Phase 1) -----------------------
    // Upload a video (raw bytes) → server ffmpeg extracts analysis frames + thumbs
    // + shot intervals + audio, saved under the project. No charge (ffmpeg only),
    // no local ML: URL fetch + ASR are later batches. LAW: the whole video pipeline
    // runs server-side. Headers: X-HJEN-Project (required), X-HJEN-Filename, X-HJEN-Slug.
    if (method === 'POST' && p === '/api/breakdown/ingest') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const pid = String(req.headers['x-hjen-project'] || '');
      if (!pid) return send(res, 400, { ok: false, message: 'X-HJEN-Project header is required.' });
      const proj = cloud.projectById(inv.id, pid);
      if (!proj) return send(res, 404, { ok: false, message: 'Project not found.' });
      const filename = String(req.headers['x-hjen-filename'] || 'video.mp4');
      const bdSlug = (s) => String(s || 'ad').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'ad';
      const slug = String(req.headers['x-hjen-slug'] || '').trim() ? bdSlug(req.headers['x-hjen-slug']) : bdSlug(filename.replace(/\.[^.]+$/, ''));
      let buf;
      try { buf = await readBodyRawCapped(req); }
      catch { return send(res, 413, { ok: false, reason: 'too_large', message: 'Video too large (max 100MB).' }); }
      if (!buf || buf.length < 1000) return send(res, 400, { ok: false, message: 'No video received.' });
      const dir = cloud.bdDir(inv.id, pid, slug);
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { return send(res, 500, { ok: false, message: String(e?.message || e) }); }
      const ext = (path.extname(filename) || '.mp4').toLowerCase();
      const source = path.join(dir, `source${ext.replace(/[^.\w]/g, '')}`);
      try { fs.writeFileSync(source, buf); } catch (e) { return send(res, 500, { ok: false, message: `Could not save upload: ${String(e?.message || e)}` }); }
      try {
        const m = await ingestVideo(source, dir);
        const manifest = { slug, filename, title: filename.replace(/\.[^.]+$/, ''), duration: m.duration, hasAudio: m.hasAudio, shots: m.shots, frames: m.frames, projectId: pid, createdAt: Date.now() };
        cloud.saveBreakdownManifest(inv.id, pid, slug, manifest);
        appendEvent({ ts: Date.now(), inviteeId: inv.id, email: inv.email, kind: 'breakdown-ingest', meta: { slug, frames: m.frames.length, shots: m.shots.length, dur: m.duration, hasAudio: m.hasAudio } });
        return send(res, 200, {
          ok: true, slug, duration: m.duration, hasAudio: m.hasAudio, shots: m.shots,
          frames: m.frames.map((f) => ({ id: f.id, t: f.t, thumbUrl: `/api/breakdown/frame?pid=${encodeURIComponent(pid)}&slug=${encodeURIComponent(slug)}&id=${f.id}&kind=thumb` })),
        });
      } catch (e) {
        return send(res, 500, { ok: false, reason: 'ingest_failed', message: String(e?.message || e) });
      }
    }

    // Serve one ingested breakdown frame's bytes (auth'd). kind=full → the master
    // (≤1280px), else the ~640px analysis thumb.
    if (method === 'GET' && p === '/api/breakdown/frame') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const pid = url.searchParams.get('pid') || '';
      const slug = url.searchParams.get('slug') || '';
      const id = url.searchParams.get('id') || '';
      const kind = url.searchParams.get('kind') === 'full' ? 'full' : 'thumb';
      const buf = pid && slug && id ? cloud.readBreakdownFrame(inv.id, pid, slug, id, kind) : null;
      if (!buf) return send(res, 404, { ok: false });
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=3600' });
      return res.end(buf);
    }

    // Breakdown Phase 3 — PRECISE SHOT RESOLVER: densely sample a shot's window on
    // the server (ffmpeg) → frames + fine cut candidates the model then verifies.
    // No charge (ffmpeg only). Body: { pid, slug, tcIn, tcOut, fps }.
    if (method === 'POST' && p === '/api/breakdown/dense') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const body = await readJson(req);
      const pid = String(body.pid || req.headers['x-hjen-project'] || '');
      const slug = String(body.slug || '');
      if (!pid || !slug) return send(res, 400, { ok: false, message: 'pid and slug are required.' });
      const video = cloud.bdSourceVideo(inv.id, pid, slug);
      if (!video) return send(res, 404, { ok: false, reason: 'no_source', message: 'Source video not found — re-ingest keeps source.* for this.' });
      const tcIn = Math.max(0, Number(body.tcIn) || 0);
      const tcOut = Math.max(tcIn + 0.2, Number(body.tcOut) || tcIn + 1);
      const fps = Math.min(12, Math.max(2, Number(body.fps) || 8));
      const run = 'd' + Date.now().toString(36);
      const denseRoot = path.join(cloud.bdDir(inv.id, pid, slug), '_dense');
      const outDir = path.join(denseRoot, run);
      try {
        // Sweep stale sibling batches (>10 min) so disk stays bounded, never touching
        // fresh dirs a concurrent resolve may be using.
        try { for (const d of fs.readdirSync(denseRoot)) { const dp = path.join(denseRoot, d); try { if (Date.now() - fs.statSync(dp).mtimeMs > 600000) fs.rmSync(dp, { recursive: true, force: true }); } catch {} } } catch {}
        const r = await denseFrames(video, outDir, tcIn, tcOut, fps);
        return send(res, 200, {
          ok: true, run, candidates: r.candidates,
          frames: r.frames.map((f) => ({ id: f.id, t: f.t, url: `/api/breakdown/dense-frame?pid=${encodeURIComponent(pid)}&slug=${encodeURIComponent(slug)}&run=${run}&id=${f.id}` })),
        });
      } catch (e) {
        return send(res, 500, { ok: false, reason: 'dense_failed', message: String(e?.message || e) });
      }
    }

    // Serve one dense frame's bytes.
    if (method === 'GET' && p === '/api/breakdown/dense-frame') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const buf = cloud.readDenseFrame(inv.id, url.searchParams.get('pid') || '', url.searchParams.get('slug') || '', url.searchParams.get('run') || '', url.searchParams.get('id') || '');
      if (!buf) return send(res, 404, { ok: false });
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=3600' });
      return res.end(buf);
    }

    // Breakdown Phase 2 — RUN the VISION stage server-side (13 axes / 6 multimodal
    // passes over the ingested thumbs). Long (minutes) → runs as a BACKGROUND job;
    // the client polls /api/breakdown/run-status. Metered per pass (refunded on a
    // failed pass). The analysis recipe is composed server-side, never on the wire.
    if (method === 'POST' && p === '/api/breakdown/run') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      if (!config.googleKey) return send(res, 500, { ok: false, message: 'GOOGLE_API_KEY not configured on the server.' });
      const body = await readJson(req);
      const pid = String(body.pid || req.headers['x-hjen-project'] || '');
      const slug = String(body.slug || '');
      if (!pid || !slug) return send(res, 400, { ok: false, message: 'pid and slug are required.' });
      const manifest = cloud.readBreakdownManifest(inv.id, pid, slug);
      if (!manifest) return send(res, 404, { ok: false, message: 'Breakdown not found — ingest first.' });
      const dir = cloud.bdDir(inv.id, pid, slug);
      const runFile = path.join(dir, 'run.json');
      const cur = (() => { try { return JSON.parse(fs.readFileSync(runFile, 'utf-8')); } catch { return null; } })();
      if (cur && cur.status === 'running' && Date.now() - (cur.startedAt || 0) < 10 * 60 * 1000) {
        return send(res, 200, { ok: true, started: false, status: 'running', done: cur.done, total: cur.total });
      }
      const total = VISION_PASSES.length;
      const writeStatus = (s) => { try { fs.writeFileSync(runFile, JSON.stringify(s)); } catch {} };
      const status = { status: 'running', stage: 'vision', done: 0, total, passes: [], startedAt: Date.now() };
      writeStatus(status);
      const meter = {
        reserve: async () => { const r = await store.consumeMake(inv.magicToken); return !!r.ok; },
        refund: async () => { await store.refund(inv.magicToken); },
      };
      const meta = {
        slug, title: manifest.title || manifest.filename, duration: manifest.duration, durationS: manifest.duration,
        frames: manifest.frames || [], transcript: manifest.transcript || null, captions: manifest.captions || '',
        sourceInfo: { title: manifest.title || manifest.filename },
      };
      const thumbAbs = (id) => path.join(dir, '_thumbs', `${id}.jpg`);
      const audioPath = path.join(dir, 'audio.m4a');
      // Fire-and-forget background run — the response returns immediately.
      (async () => {
        try {
          const r = await runVisionStage(meta, { thumbAbs, audioPath, key: config.googleKey, meter,
            onProgress: (d, t, label) => { status.done = d; status.label = label; writeStatus(status); } });
          const fresh = cloud.readBreakdownManifest(inv.id, pid, slug) || manifest;
          fresh.vision = r.vision; fresh.visionPasses = r.passes;
          cloud.saveBreakdownManifest(inv.id, pid, slug, fresh);
          status.done = total; status.passes = r.passes; writeStatus(status);
          // Phase 2b — DOCS stage (pre-production package) from the vision findings.
          // Runs only if vision produced axes; needs the anthropic key.
          if (Object.keys(r.vision).length && config.anthropicKey) {
            status.stage = 'docs'; status.docsDone = 0; status.docsTotal = 2; writeStatus(status);
            try {
              const d = await runDocsStage(r.vision, meta, { brand: '', title: meta.title, thumbAbs, key: config.anthropicKey, meter,
                onProgress: (dd) => { status.docsDone = dd; writeStatus(status); } });
              const m2 = cloud.readBreakdownManifest(inv.id, pid, slug) || fresh;
              m2.docs = d.docs; m2.docsReport = d.docsReport;
              cloud.saveBreakdownManifest(inv.id, pid, slug, m2);
              status.docsReport = d.docsReport;
            } catch (e2) { status.docsError = String(e2?.message || e2).slice(0, 200); }
          }
          status.status = 'done'; status.stage = 'done'; status.finishedAt = Date.now();
          writeStatus(status);
          appendEvent({ ts: Date.now(), inviteeId: inv.id, email: inv.email, kind: 'breakdown-run', meta: { slug, axes: Object.keys(r.vision).length, ok: r.passes.filter((x) => x.ok).length, total, docs: !!status.docsReport } });
        } catch (e) {
          status.status = 'error'; status.error = String(e?.message || e).slice(0, 300); status.finishedAt = Date.now();
          writeStatus(status);
        }
      })();
      return send(res, 200, { ok: true, started: true, total });
    }

    // Poll a breakdown run's progress + final axis list.
    if (method === 'GET' && p === '/api/breakdown/run-status') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const pid = url.searchParams.get('pid') || '';
      const slug = url.searchParams.get('slug') || '';
      let st = null;
      try { st = JSON.parse(fs.readFileSync(path.join(cloud.bdDir(inv.id, pid, slug), 'run.json'), 'utf-8')); } catch {}
      if (!st) return send(res, 200, { ok: true, status: 'idle' });
      const out = { ok: true, status: st.status, stage: st.stage, done: st.done, total: st.total, label: st.label, passes: st.passes, error: st.error, docsDone: st.docsDone, docsTotal: st.docsTotal, docsReport: st.docsReport, docsError: st.docsError };
      if (st.status === 'done') { const m = cloud.readBreakdownManifest(inv.id, pid, slug); out.axes = Object.keys(m?.vision || {}); out.hasDocs = !!(m && m.docs); }
      return send(res, 200, out);
    }

    // Read a saved breakdown manifest (frames + shots) without re-ingesting.
    if (method === 'GET' && p === '/api/breakdown/manifest') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const pid = url.searchParams.get('pid') || '';
      const slug = url.searchParams.get('slug') || '';
      const m = pid && slug ? cloud.readBreakdownManifest(inv.id, pid, slug) : null;
      if (!m) return send(res, 404, { ok: false, found: false });
      return send(res, 200, {
        ok: true, found: true, slug: m.slug, duration: m.duration, hasAudio: m.hasAudio, shots: m.shots,
        frames: (m.frames || []).map((f) => ({ id: f.id, t: f.t, thumbUrl: `/api/breakdown/frame?pid=${encodeURIComponent(pid)}&slug=${encodeURIComponent(slug)}&id=${f.id}&kind=thumb` })),
      });
    }

    // List a project's breakdowns (Phase 5 — the web BreakdownView's roster).
    if (method === 'GET' && p === '/api/breakdown/list') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const pid = url.searchParams.get('pid') || '';
      if (!pid) return send(res, 400, { ok: false, message: 'pid required' });
      const list = cloud.listBreakdowns(inv.id, pid).map((m) => ({
        slug: m.slug, title: m.title || m.filename || m.slug, duration: m.duration,
        frames: (m.frames || []).length, hasVision: !!m.vision, hasDocs: !!m.docs, createdAt: m.createdAt || null,
      }));
      return send(res, 200, { ok: true, breakdowns: list });
    }

    // Read ONE breakdown ASSEMBLED into the renderer's AdBreakdown shape (Phase 5).
    // Composed on read from the manifest's vision+docs — always fresh, no dup store.
    // Frame refs are server URLs the client appends its token to.
    if (method === 'GET' && p === '/api/breakdown/read') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const pid = url.searchParams.get('pid') || '';
      const slug = url.searchParams.get('slug') || '';
      const m = pid && slug ? cloud.readBreakdownManifest(inv.id, pid, slug) : null;
      if (!m) return send(res, 404, { ok: false, found: false });
      if (!m.vision) return send(res, 200, { ok: true, found: true, pending: true, slug });
      const meta = { slug: m.slug, title: m.title || m.filename, duration: m.duration, durationS: m.duration, frames: m.frames || [], shots: m.shots || [], transcript: m.transcript || null, captions: m.captions || '' };
      // Frame refs as a synthetic token the web adapter resolves (like cloudgen://):
      // cloudbd://<pid>/<slug>/<id> → /api/breakdown/frame. Renders through the same
      // hjen-file:// img path the View already uses, no View change.
      const frameUrl = (id) => `cloudbd://${pid}/${slug}/${id}`;
      const bd = assembleBreakdown(m.vision, m.docs || {}, meta, '', meta.title, frameUrl);
      return send(res, 200, { ok: true, found: true, breakdown: bd });
    }

    // Breakdown ASR (Phase 4): transcribe the ingested audio → timed segments via
    // the OpenAI Whisper API (direct vendor), merged into the manifest. Metered
    // (a paid vendor call on the server key); refunded if no usable speech.
    if (method === 'POST' && p === '/api/breakdown/transcribe') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      if (!config.openaiKey) return send(res, 500, { ok: false, message: 'OPENAI_API_KEY not configured on the server.' });
      const body = await readJson(req);
      const pid = String(body.pid || req.headers['x-hjen-project'] || '');
      const slug = String(body.slug || '');
      if (!pid || !slug) return send(res, 400, { ok: false, message: 'pid and slug are required.' });
      const manifest = cloud.readBreakdownManifest(inv.id, pid, slug);
      if (!manifest) return send(res, 404, { ok: false, message: 'Breakdown not found — ingest first.' });
      const audioPath = path.join(cloud.bdDir(inv.id, pid, slug), 'audio.m4a');
      if (!fs.existsSync(audioPath)) return send(res, 400, { ok: false, reason: 'no_audio', message: 'This breakdown has no audio track.' });

      const reservation = await store.consumeMake(inv.magicToken);
      if (!reservation.ok) {
        const message = reservation.reason === 'expired' ? 'Your trial has ended.' : reservation.reason === 'exhausted' ? 'You have reached your shot limit.' : 'Your access has been paused.';
        return send(res, 403, { ok: false, reason: reservation.reason, message });
      }
      let settled = false;
      const refund = async (why) => { if (settled) return; settled = true; await store.refund(inv.magicToken); appendEvent({ ts: Date.now(), inviteeId: inv.id, email: inv.email, kind: 'make-refund', meta: { path: '/api/breakdown/transcribe', why } }); };
      try {
        const r = await transcribeAudio(audioPath, config.openaiKey, { model: body.model || 'whisper-1', language: body.language || 'auto' });
        if (!r.ok) { await refund(r.message || 'asr_empty'); return send(res, 200, { ok: false, reason: 'no_speech', message: r.message || 'No usable speech found — you were not charged.' }); }
        settled = true;
        const transcript = r.transcript;
        manifest.transcript = transcript;
        manifest.captions = captionsFlat(transcript.segments);
        cloud.saveBreakdownManifest(inv.id, pid, slug, manifest);
        appendEvent({ ts: Date.now(), inviteeId: inv.id, email: inv.email, kind: 'make', model: body.model || 'whisper-1', usd: 0.01, meta: { via: 'breakdown-transcribe', slug, lang: transcript.lang, segs: transcript.segments.length } });
        return send(res, 200, { ok: true, lang: transcript.lang, source: transcript.source, segments: transcript.segments });
      } catch (e) {
        await refund('exception');
        return send(res, 502, { ok: false, reason: 'asr_error', message: String(e?.message || e) });
      }
    }

    // Recover a paid frame the client never received (app closed mid-flight).
    // Auth'd, read-only, no charge: returns the delivered frame if the server
    // still holds it for this (account, jobId), else { found:false }.
    if (method === 'GET' && p === '/api/frame/recover') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const jobId = url.searchParams.get('job') || '';
      const rec = jobId ? cloud.getDelivered(inv.id, jobId) : null;
      if (!rec) return send(res, 200, { ok: true, found: false });
      const m = rec.meta || {};
      return send(res, 200, { ok: true, found: true, b64: rec.b64, apiSize: m.apiSize, targetWidth: m.targetWidth, targetHeight: m.targetHeight, finalMP: m.finalMP, notes: m.notes || '', quality: m.quality, modelLabel: m.modelLabel });
    }

    // ── Async Frame: submit → poll (no Cloudflare ceiling in play) ──────────────
    // SUBMIT composes server-side, meters one make, kicks the render off in the
    // BACKGROUND and returns a jobId fast. POLL is free and returns the frame when
    // ready. The legacy sync POST /api/frame stays for older clients.
    if (method === 'POST' && p === '/api/frame/submit') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      if (!config.openaiKey) return send(res, 500, { ok: false, message: 'OPENAI_API_KEY not configured on the server.' });
      const body = await readJson(req);
      const selections = body.selections || {};
      const layers = Array.isArray(body.layers) ? body.layers : [];
      const modelSpec = MODELS[selections.model] || MODELS.GPT_IMAGE_2;
      if (modelSpec.provider !== 'openai') return send(res, 400, { ok: false, reason: 'unsupported_model', message: 'This model is not available on the cloud path yet.' });
      let prompt;
      try { prompt = buildPrompt(selections, layers); } catch (e) { return send(res, 400, { ok: false, reason: 'compose_failed', message: String(e?.message || e) }); }
      const sizeInfo = resolveSize(selections.model || 'GPT_IMAGE_2', selections.aspect || '1:1', selections.resolution || '1MP');
      const quality = mapQuality(selections.model || 'GPT_IMAGE_2', selections.quality || 'HIGH');
      const projectId = String(req.headers['x-hjen-project'] || '');
      const sig = String(req.headers['x-hjen-sig'] || '');
      // The client's own job id doubles as the recovery/idempotency key. Reuse it
      // if given, else mint one.
      const jobId = String(req.headers['x-hjen-job'] || '') || ('frm_' + genId());
      // Idempotency: an in-flight or already-delivered job for this id must NOT be
      // charged again — the client just needs to poll it.
      if (frameJobs.has(jobId) || cloud.getDelivered(inv.id, jobId)) return send(res, 200, { ok: true, jobId });
      const reservation = await store.consumeMake(inv.magicToken);
      if (!reservation.ok) {
        const message = reservation.reason === 'expired' ? 'Your trial has ended.' : reservation.reason === 'exhausted' ? 'You have reached your shot limit.' : 'Your access has been paused.';
        return send(res, 403, { ok: false, reason: reservation.reason, message });
      }
      frameJobs.set(jobId, { status: 'pending', phase: 'queued', magicToken: inv.magicToken, inv: { id: inv.id, email: inv.email }, settled: false, ts: Date.now() });
      runFrameRenderJob(jobId, { selections, layers, prompt, sizeInfo, quality, modelSpec, projectId, sig }).catch(() => {}); // fire-and-forget
      return send(res, 200, { ok: true, jobId });
    }
    if (method === 'POST' && p === '/api/frame/poll') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const b = await readJson(req);
      const jobId = String(b.jobId || '');
      const job = frameJobs.get(jobId);
      if (!job) {
        // GC'd or server restarted, but the frame may still be on disk under this id.
        const rec = cloud.getDelivered(inv.id, jobId);
        if (rec) { const m = rec.meta || {}; return send(res, 200, { ok: true, status: 'done', b64: rec.b64, apiSize: m.apiSize, targetWidth: m.targetWidth, targetHeight: m.targetHeight, finalMP: m.finalMP, notes: m.notes || '', quality: m.quality, modelLabel: m.modelLabel }); }
        return send(res, 200, { ok: true, status: 'error', message: 'This render expired on the server — please make it again.' });
      }
      if (job.inv.id !== inv.id) return send(res, 403, { ok: false, message: 'Not your render.' });
      if (job.status === 'pending') return send(res, 200, { ok: true, status: 'pending', phase: job.phase || 'rendering', queued: totalQueued() });
      if (job.status === 'error') { const message = job.message || 'Frame failed.'; frameJobs.delete(jobId); return send(res, 200, { ok: true, status: 'error', message }); }
      // When the render was saved server-side (savedImgPath), deliver a TINY
      // response with just the token — the client loads the image via /i/ (resized
      // WebP, streamed + edge-cached). Shipping a 12MB base64 inside JSON is what
      // silently failed for HIGH/8.3MP. Fall back to base64 only when there is no
      // server blob (no active project).
      const _m = job.meta || {};
      const out = _m.savedImgPath
        ? { ok: true, status: 'done', imgPath: _m.savedImgPath, ..._m }
        : { ok: true, status: 'done', b64: job.b64, ..._m };
      console.log(`[frame] DELIVER job=${jobId} via=${_m.savedImgPath ? 'token' : 'b64'} b64Len=${_m.savedImgPath ? 0 : (job.b64 || '').length}`);
      frameJobs.delete(jobId); // deliver once
      return send(res, 200, out);
    }

    if (method === 'POST' && p === '/api/frame') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      if (!config.openaiKey) return send(res, 500, { ok: false, message: 'OPENAI_API_KEY not configured on the server.' });

      const body = await readJson(req);
      const selections = body.selections || {};
      const layers = Array.isArray(body.layers) ? body.layers : [];
      const modelSpec = MODELS[selections.model] || MODELS.GPT_IMAGE_2;
      // OpenAI path only for now — Google/Imagen stays on the legacy client path
      // until its door is migrated (Imagen is operationally blocked regardless).
      if (modelSpec.provider !== 'openai') {
        return send(res, 400, { ok: false, reason: 'unsupported_model', message: 'This model is not available on the cloud path yet.' });
      }

      let prompt;
      try { prompt = buildPrompt(selections, layers); }
      catch (e) { return send(res, 400, { ok: false, reason: 'compose_failed', message: String(e?.message || e) }); }
      const sizeInfo = resolveSize(selections.model || 'GPT_IMAGE_2', selections.aspect || '1:1', selections.resolution || '1MP');
      const quality = mapQuality(selections.model || 'GPT_IMAGE_2', selections.quality || 'HIGH');

      // Idempotency + recovery key: the client's own job id. If this exact make was
      // already delivered+charged (a retry after a dropped response, or the same id
      // resubmitted), return the cached frame WITHOUT charging again — paid once.
      const jobId = String(req.headers['x-hjen-job'] || '');
      if (jobId) {
        const cached = cloud.getDelivered(inv.id, jobId);
        if (cached) {
          const m = cached.meta || {};
          appendEvent({ ts: Date.now(), inviteeId: inv.id, email: inv.email, kind: 'make-idempotent', meta: { path: '/api/frame', jobId } });
          return send(res, 200, { ok: true, b64: cached.b64, apiSize: m.apiSize || sizeInfo.apiSize, targetWidth: m.targetWidth ?? sizeInfo.targetWidth, targetHeight: m.targetHeight ?? sizeInfo.targetHeight, finalMP: m.finalMP ?? sizeInfo.finalMP, notes: m.notes || '', quality: m.quality || quality, modelLabel: m.modelLabel || modelSpec.label, durationMs: 0, recovered: true });
        }
      }

      // Reserve one credit up front (atomic — no overdraw under concurrency).
      const reservation = await store.consumeMake(inv.magicToken);
      if (!reservation.ok) {
        const message = reservation.reason === 'expired' ? 'Your trial has ended.' : reservation.reason === 'exhausted' ? 'You have reached your shot limit.' : 'Your access has been paused.';
        return send(res, 403, { ok: false, reason: reservation.reason, message });
      }
      let settled = false;
      const refund = async (why) => { if (settled) return; settled = true; await store.refund(inv.magicToken); appendEvent({ ts: Date.now(), inviteeId: inv.id, email: inv.email, kind: 'make-refund', meta: { path: '/api/frame', why } }); };

      const tStart = Date.now();
      try {
        // Reference order MUST mirror buildPrompt's mention order so "Image N"
        // maps to the right asset: compositions → characters(parentless) →
        // nested children → the rest. Only layers carrying bytes are sent.
        const ordered = [
          ...layers.filter((l) => l.category === 'composition' && !l.parentLayerId),
          ...layers.filter((l) => l.category === 'character' && !l.parentLayerId),
          ...layers.filter((l) => l.parentLayerId),
          ...layers.filter((l) => l.category !== 'composition' && l.category !== 'character' && !l.parentLayerId),
        ].filter((l) => l && l.b64);

        const headers = { authorization: `Bearer ${config.openaiKey}` };
        let rawBody; let upstreamPath;
        if (ordered.length > 0) {
          upstreamPath = '/images/edits';
          const fd = new FormData();
          fd.set('model', modelSpec.apiModelId);
          fd.set('prompt', prompt);
          fd.set('size', sizeInfo.apiSize);
          fd.set('quality', quality);
          fd.set('n', '1');
          for (const l of ordered) {
            const buf = Buffer.from(l.b64, 'base64');
            fd.append('image[]', new Blob([buf], { type: l.mime || 'image/png' }), l.filename || 'ref.png');
          }
          rawBody = fd; // fetch adds multipart content-type + boundary
        } else {
          upstreamPath = '/images/generations';
          headers['content-type'] = 'application/json';
          rawBody = Buffer.from(JSON.stringify({ model: modelSpec.apiModelId, prompt, size: sizeInfo.apiSize, quality, n: 1 }), 'utf-8');
        }

        const upstream = await openaiFetchWithRetry(upstreamPath, headers, rawBody);
        const text = await upstream.text();
        if (!upstream.ok) {
          await refund('provider_status_' + upstream.status);
          const low = text.toLowerCase();
          if (low.includes('safety') || low.includes('moderation') || low.includes('content_policy') || low.includes('content policy') || low.includes('rejected')) {
            return send(res, 422, { ok: false, reason: 'safety', message: 'The safety filter rejected this request — you were not charged. Try softening the prompt or references.' });
          }
          return send(res, 502, { ok: false, reason: 'provider_error', message: `Provider error (${upstream.status}) — you were not charged.` });
        }
        let parsed = null; let b64 = ''; let usage = null;
        try { parsed = JSON.parse(text); b64 = parsed?.data?.[0]?.b64_json || ''; usage = parsed?.usage; } catch { /* not json */ }
        if (!b64) { await refund('empty_result'); return send(res, 502, { ok: false, reason: 'empty_result', message: 'The model returned no image — you were not charged.' }); }
        settled = true; // a real image exists → the charge stands

        // Persist the delivered frame keyed by the client job id BEFORE we reply,
        // so a client that never receives this response (app closed / socket
        // dropped mid-flight) still gets its paid frame back on next launch via
        // /api/frame/recover. Surface-agnostic — no project needed.
        if (jobId) {
          cloud.saveDelivered(inv.id, jobId, { base64: b64, ext: 'png', meta: {
            apiSize: sizeInfo.apiSize, targetWidth: sizeInfo.targetWidth, targetHeight: sizeInfo.targetHeight,
            finalMP: sizeInfo.finalMP, notes: sizeInfo.notes || '', quality, modelLabel: modelSpec.label,
          } });
        }

        let usd = estimateImageUsd(quality); let realImg = false;
        try { const r = imageUsdFromUsage(usage); if (r != null && !Number.isNaN(r)) { usd = Number(r.toFixed(6)); realImg = true; } } catch { /* keep estimate */ }

        // Server-side save (web only — the web adapter sends X-HJEN-Project). The
        // frame then survives a closed tab; the client's saveGeneration reuses the
        // returned path (x-hjen-saved) instead of uploading a copy → no duplicate.
        const projectId = String(req.headers['x-hjen-project'] || '');
        const sig = String(req.headers['x-hjen-sig'] || '');
        let savedImgPath = '';
        if (projectId) {
          try {
            const proj = cloud.projectById(inv.id, projectId);
            if (proj) {
              const row = cloud.saveGeneration(inv.id, {
                pid: projectId, base64: b64, ext: 'png',
                // Store the RAW user selections (their typed prompt + chips) so the
                // UI can restore them on click — NOT the composed recipe, which
                // stays server-only and is never persisted. `selections` is the
                // field GenerationPreview/DetailsPanel read back.
                sidecar: {
                  promptTitle: String(selections.prompt || 'Frame').slice(0, 120),
                  prompt: String(selections.prompt || ''),
                  selections,
                  references: layers.map((l) => ({ id: l.id, category: l.category, name: l.name, customName: l.customName, parentLayerId: l.parentLayerId, groupName: l.groupName })),
                  size: sizeInfo.apiSize, apiSize: sizeInfo.apiSize, model: modelSpec.label, apiModelId: modelSpec.apiModelId,
                  quality, modelLabel: modelSpec.label, costUsd: usd, sig,
                },
                promptSlug: 'frame', projectSlug: proj.slug || '', projectName: proj.name || '',
              });
              savedImgPath = `cloudgen://${projectId}/${row.gid}.${row.ext}`;
            }
          } catch { /* non-fatal — client can still save from the returned b64 */ }
        }
        appendEvent({ ts: Date.now(), inviteeId: inv.id, email: inv.email, kind: 'make', model: modelSpec.apiModelId, usd, meta: { via: 'frame', refs: ordered.length, saved: !!savedImgPath, ...(realImg ? { real: true } : { estimated: true }) } });

        const after = store.getByToken(inv.magicToken);
        const out = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
        if (savedImgPath) { out['x-hjen-saved'] = savedImgPath; out['access-control-expose-headers'] = 'x-hjen-saved'; }
        res.writeHead(200, out);
        return res.end(JSON.stringify({
          ok: true,
          b64,
          apiSize: sizeInfo.apiSize,
          targetWidth: sizeInfo.targetWidth,
          targetHeight: sizeInfo.targetHeight,
          finalMP: sizeInfo.finalMP,
          notes: sizeInfo.notes || '',
          quality,
          modelLabel: modelSpec.label,
          durationMs: Date.now() - tStart,
          remaining: Math.max(0, after.genLimit - after.genUsed),
          genUsed: after.genUsed,
          genLimit: after.genLimit,
        }));
      } catch (err) {
        await refund('exception');
        return send(res, 502, { ok: false, reason: 'provider_error', message: String(err?.message || err) });
      }
    }

    // ----- Storyboard: server-side board recipe + generation --------------------
    // The client sends only RAW request data (kind + shot/slot/refs metadata +
    // presetId); the board recipe (style locks, negatives, panel anatomy,
    // identity locks, cinematic staging) is composed HERE, never on the wire.
    // Auto-retries once with the wholesome fallback prompt on a safety rejection.

    // ── Async Storyboard asset: submit → poll (same shape as /api/frame) ────────
    if (method === 'POST' && p === '/api/storyboard/submit') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      if (!config.openaiKey) return send(res, 500, { ok: false, message: 'OPENAI_API_KEY not configured on the server.' });
      const body = await readJson(req);
      const sbReq = body.req || {};
      const layers = Array.isArray(body.layers) ? body.layers : [];
      const settings = body.settings || {};
      const model = settings.model || 'GPT_IMAGE_2';
      const modelSpec = MODELS[model] || MODELS.GPT_IMAGE_2;
      if (modelSpec.provider !== 'openai') return send(res, 400, { ok: false, reason: 'unsupported_model', message: 'This model is not available on the cloud path yet.' });
      let built;
      try { built = buildStoryboardPrompt(sbReq); } catch (e) { return send(res, 400, { ok: false, reason: 'compose_failed', message: String(e?.message || e) }); }
      const sizeInfo = resolveSize(model, settings.aspect || '16:9', settings.resolution || '1MP');
      const quality = mapQuality(model, settings.quality || 'HIGH');
      const refBufs = layers.filter((l) => l && l.b64);
      const projectId = String(req.headers['x-hjen-project'] || '');
      const sig = String(req.headers['x-hjen-sig'] || '');
      const jobId = String(req.headers['x-hjen-job'] || '') || ('sb_' + genId());
      if (storyboardJobs.has(jobId) || cloud.getDelivered(inv.id, jobId)) return send(res, 200, { ok: true, jobId });
      const reservation = await store.consumeMake(inv.magicToken);
      if (!reservation.ok) {
        const message = reservation.reason === 'expired' ? 'Your trial has ended.' : reservation.reason === 'exhausted' ? 'You have reached your shot limit.' : 'Your access has been paused.';
        return send(res, 403, { ok: false, reason: reservation.reason, message });
      }
      storyboardJobs.set(jobId, { status: 'pending', magicToken: inv.magicToken, inv: { id: inv.id, email: inv.email }, settled: false, ts: Date.now() });
      runStoryboardRenderJob(jobId, { built, sizeInfo, quality, modelSpec, refBufs, sbReq, projectId, sig }).catch(() => {});
      return send(res, 200, { ok: true, jobId });
    }
    if (method === 'POST' && p === '/api/storyboard/poll') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const b = await readJson(req);
      const jobId = String(b.jobId || '');
      const job = storyboardJobs.get(jobId);
      if (!job) {
        const rec = cloud.getDelivered(inv.id, jobId);
        if (rec) { const m = rec.meta || {}; return send(res, 200, { ok: true, status: 'done', b64: rec.b64, apiSize: m.apiSize, targetWidth: m.targetWidth, targetHeight: m.targetHeight, quality: m.quality, modelLabel: m.modelLabel }); }
        return send(res, 200, { ok: true, status: 'error', message: 'This render expired on the server — please make it again.' });
      }
      if (job.inv.id !== inv.id) return send(res, 403, { ok: false, message: 'Not your render.' });
      if (job.status === 'pending') return send(res, 200, { ok: true, status: 'pending', phase: job.phase || 'rendering', queued: totalQueued() });
      if (job.status === 'error') { const message = job.message || 'Storyboard failed.'; storyboardJobs.delete(jobId); return send(res, 200, { ok: true, status: 'error', message }); }
      const out = { ok: true, status: 'done', b64: job.b64, ...(job.meta || {}) };
      storyboardJobs.delete(jobId);
      return send(res, 200, out);
    }

    // ── ASSETS — the four factories (character · location · prop · wardrobe).
    // Same async submit/poll contract and the same render job as the storyboard;
    // only the recipe differs, and it is composed HERE so the plate prompt never
    // ships in the browser bundle. The client sends a small typed request plus
    // reference bytes and gets pixels back.
    if (method === 'POST' && p === '/api/assets/submit') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      if (!config.openaiKey) return send(res, 500, { ok: false, message: 'OPENAI_API_KEY not configured on the server.' });
      const body = await readJson(req);
      const aReq = body.req || {};
      const layers = Array.isArray(body.layers) ? body.layers : [];
      const settings = body.settings || {};
      const model = settings.model || 'GPT_IMAGE_2';
      const modelSpec = MODELS[model] || MODELS.GPT_IMAGE_2;
      if (modelSpec.provider !== 'openai') return send(res, 400, { ok: false, reason: 'unsupported_model', message: 'This model is not available on the cloud path yet.' });
      let built;
      try { built = buildAssetPrompt(aReq); } catch (e) { return send(res, 400, { ok: false, reason: 'compose_failed', message: String(e?.message || e) }); }
      // The recipe owns the aspect — a face is 4:5, a turnaround is 32:9. The
      // client never overrides it, so a plate can't be made in the wrong shape.
      const sizeInfo = resolveSize(model, built.aspect, settings.resolution || '3.7MP');
      const quality = mapQuality(model, settings.quality || 'HIGH');
      const refBufs = layers.filter((l) => l && l.b64);
      const projectId = String(req.headers['x-hjen-project'] || '');
      const sig = String(req.headers['x-hjen-sig'] || '');
      const jobId = String(req.headers['x-hjen-job'] || '') || ('as_' + genId());
      if (storyboardJobs.has(jobId) || cloud.getDelivered(inv.id, jobId)) return send(res, 200, { ok: true, jobId });
      const reservation = await store.consumeMake(inv.magicToken);
      if (!reservation.ok) {
        const message = reservation.reason === 'expired' ? 'Your trial has ended.' : reservation.reason === 'exhausted' ? 'You have reached your shot limit.' : 'Your access has been paused.';
        return send(res, 403, { ok: false, reason: reservation.reason, message });
      }
      storyboardJobs.set(jobId, { status: 'pending', magicToken: inv.magicToken, inv: { id: inv.id, email: inv.email }, settled: false, ts: Date.now() });
      runStoryboardRenderJob(jobId, { built, sizeInfo, quality, modelSpec, refBufs, sbReq: aReq, projectId, sig }).catch(() => {});
      return send(res, 200, { ok: true, jobId, aspect: built.aspect });
    }
    if (method === 'POST' && p === '/api/assets/poll') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const b = await readJson(req);
      const jobId = String(b.jobId || '');
      const job = storyboardJobs.get(jobId);
      if (!job) {
        const rec = cloud.getDelivered(inv.id, jobId);
        if (rec) { const m = rec.meta || {}; return send(res, 200, { ok: true, status: 'done', b64: rec.b64, apiSize: m.apiSize, targetWidth: m.targetWidth, targetHeight: m.targetHeight, quality: m.quality, modelLabel: m.modelLabel }); }
        return send(res, 200, { ok: true, status: 'error', message: 'This plate expired on the server — please make it again.' });
      }
      if (job.inv.id !== inv.id) return send(res, 403, { ok: false, message: 'Not your render.' });
      if (job.status === 'pending') return send(res, 200, { ok: true, status: 'pending', phase: job.phase || 'rendering', queued: totalQueued() });
      if (job.status === 'error') { const message = job.message || 'The plate failed.'; storyboardJobs.delete(jobId); return send(res, 200, { ok: true, status: 'error', message }); }
      const out = { ok: true, status: 'done', b64: job.b64, ...(job.meta || {}) };
      storyboardJobs.delete(jobId);
      return send(res, 200, out);
    }

    if (method === 'POST' && p === '/api/storyboard') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      if (!config.openaiKey) return send(res, 500, { ok: false, message: 'OPENAI_API_KEY not configured on the server.' });

      const body = await readJson(req);
      const sbReq = body.req || {};
      const layers = Array.isArray(body.layers) ? body.layers : [];
      const settings = body.settings || {};
      const model = settings.model || 'GPT_IMAGE_2';
      const modelSpec = MODELS[model] || MODELS.GPT_IMAGE_2;
      if (modelSpec.provider !== 'openai') {
        return send(res, 400, { ok: false, reason: 'unsupported_model', message: 'This model is not available on the cloud path yet.' });
      }

      let built;
      try { built = buildStoryboardPrompt(sbReq); }
      catch (e) { return send(res, 400, { ok: false, reason: 'compose_failed', message: String(e?.message || e) }); }
      const sizeInfo = resolveSize(model, settings.aspect || '16:9', settings.resolution || '1MP');
      const quality = mapQuality(model, settings.quality || 'HIGH');

      const reservation = await store.consumeMake(inv.magicToken);
      if (!reservation.ok) {
        const message = reservation.reason === 'expired' ? 'Your trial has ended.' : reservation.reason === 'exhausted' ? 'You have reached your shot limit.' : 'Your access has been paused.';
        return send(res, 403, { ok: false, reason: reservation.reason, message });
      }
      let settled = false;
      const refund = async (why) => { if (settled) return; settled = true; await store.refund(inv.magicToken); appendEvent({ ts: Date.now(), inviteeId: inv.id, email: inv.email, kind: 'make-refund', meta: { path: '/api/storyboard', why } }); };

      // Build the OpenAI request for a given prompt (edits when refs are present).
      const refBufs = layers.filter((l) => l && l.b64);
      const callOpenAI = async (prompt) => {
        const headers = { authorization: `Bearer ${config.openaiKey}` };
        let rawBody; let upstreamPath;
        if (refBufs.length > 0) {
          upstreamPath = '/images/edits';
          const fd = new FormData();
          fd.set('model', modelSpec.apiModelId);
          fd.set('prompt', prompt);
          fd.set('size', sizeInfo.apiSize);
          fd.set('quality', quality);
          fd.set('n', '1');
          for (const l of refBufs) fd.append('image[]', new Blob([Buffer.from(l.b64, 'base64')], { type: l.mime || 'image/png' }), l.filename || 'ref.png');
          rawBody = fd;
        } else {
          upstreamPath = '/images/generations';
          headers['content-type'] = 'application/json';
          rawBody = Buffer.from(JSON.stringify({ model: modelSpec.apiModelId, prompt, size: sizeInfo.apiSize, quality, n: 1 }), 'utf-8');
        }
        const upstream = await openaiFetchWithRetry(upstreamPath, headers, rawBody);
        const text = await upstream.text();
        return { status: upstream.status, ok: upstream.ok, text };
      };
      const isSafety = (t) => { const l = (t || '').toLowerCase(); return l.includes('safety') || l.includes('moderation') || l.includes('content_policy') || l.includes('content policy') || l.includes('rejected'); };

      const tStart = Date.now();
      try {
        let r = await callOpenAI(built.prompt);
        // Safety false-positive (child/family boards) → retry once with the wholesome fallback.
        if (!r.ok && isSafety(r.text) && built.fallbackPrompt) r = await callOpenAI(built.fallbackPrompt);
        if (!r.ok) {
          await refund('provider_status_' + r.status);
          if (isSafety(r.text)) return send(res, 422, { ok: false, reason: 'safety', message: 'The safety filter rejected this even after the wholesome retry — you were not charged.' });
          return send(res, 502, { ok: false, reason: 'provider_error', message: `Provider error (${r.status}) — you were not charged.` });
        }
        let parsed = null; let b64 = ''; let usage = null;
        try { parsed = JSON.parse(r.text); b64 = parsed?.data?.[0]?.b64_json || ''; usage = parsed?.usage; } catch { /* not json */ }
        if (!b64) { await refund('empty_result'); return send(res, 502, { ok: false, reason: 'empty_result', message: 'The model returned no image — you were not charged.' }); }
        settled = true;

        // Persist under the client job id (surface-agnostic delivery store) so an
        // asset make that outran Cloudflare's ~100s ceiling — the client aborted
        // pre-ceiling or got a 524 — is retrievable via /api/frame/recover?job=.
        const recoverJob = String(req.headers['x-hjen-job'] || '');
        if (recoverJob) {
          try { cloud.saveDelivered(inv.id, recoverJob, { base64: b64, ext: 'png', meta: { apiSize: sizeInfo.apiSize, targetWidth: sizeInfo.targetWidth, targetHeight: sizeInfo.targetHeight, quality, modelLabel: modelSpec.label } }); } catch { /* non-fatal */ }
        }

        let usd = estimateImageUsd(quality); let realImg = false;
        try { const rr = imageUsdFromUsage(usage); if (rr != null && !Number.isNaN(rr)) { usd = Number(rr.toFixed(6)); realImg = true; } } catch { /* estimate */ }

        const projectId = String(req.headers['x-hjen-project'] || '');
        const sig = String(req.headers['x-hjen-sig'] || '');
        let savedImgPath = '';
        if (projectId) {
          try {
            const proj = cloud.projectById(inv.id, projectId);
            if (proj) {
              const row = cloud.saveGeneration(inv.id, {
                pid: projectId, base64: b64, ext: 'png',
                sidecar: { promptTitle: String(sbReq.kind || 'storyboard'), kind: `storyboard-${sbReq.kind}`, size: sizeInfo.apiSize, quality, modelLabel: modelSpec.label, costUsd: usd, sig },
                promptSlug: 'storyboard', projectSlug: proj.slug || '', projectName: proj.name || '',
              });
              savedImgPath = `cloudgen://${projectId}/${row.gid}.${row.ext}`;
            }
          } catch { /* non-fatal */ }
        }
        appendEvent({ ts: Date.now(), inviteeId: inv.id, email: inv.email, kind: 'make', model: modelSpec.apiModelId, usd, meta: { via: 'storyboard', kind: sbReq.kind, refs: refBufs.length, saved: !!savedImgPath, ...(realImg ? { real: true } : { estimated: true }) } });

        const after = store.getByToken(inv.magicToken);
        const out = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
        if (savedImgPath) { out['x-hjen-saved'] = savedImgPath; out['access-control-expose-headers'] = 'x-hjen-saved'; }
        res.writeHead(200, out);
        return res.end(JSON.stringify({
          ok: true, b64, apiSize: sizeInfo.apiSize, targetWidth: sizeInfo.targetWidth, targetHeight: sizeInfo.targetHeight,
          quality, modelLabel: modelSpec.label, durationMs: Date.now() - tStart,
          remaining: Math.max(0, after.genLimit - after.genUsed), genUsed: after.genUsed, genLimit: after.genLimit,
        }));
      } catch (err) {
        await refund('exception');
        return send(res, 502, { ok: false, reason: 'provider_error', message: String(err?.message || err) });
      }
    }

    // ----- cloud gateway: transparent OpenAI proxy for the desktop app -----
    // The app's openai.ts points its SDK baseURL here and sends the invitee's
    // magic token as the Bearer key. We verify the invitee, meter one make, swap
    // in the real server-side key, forward the raw request to OpenAI, and refund
    // on failure. Same metering loop as /api/make — this is the M5 pattern in miniature.
    if (method === 'POST' && p.startsWith('/v1/openai/')) {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      if (!config.openaiKey) return send(res, 500, { ok: false, message: 'OPENAI_API_KEY not configured on the server.' });

      const upstreamPath = p.slice('/v1/openai'.length); // e.g. /images/generations
      // Read RAW bytes — reference-image edits are multipart/binary; utf-8 would corrupt them.
      const rawBuf = await readBodyRaw(req);
      const isJson = (req.headers['content-type'] || '').includes('application/json');
      // The web host tags each make with its project + a signature, so the result
      // can be persisted server-side (survives a dropped tab) and de-duplicated.
      const projectId = String(req.headers['x-hjen-project'] || '');
      const sig = String(req.headers['x-hjen-sig'] || '');

      // Reserve one credit UP FRONT (atomic — no overdraw under concurrency).
      const reservation = await store.consumeMake(inv.magicToken);
      if (!reservation.ok) {
        const message = reservation.reason === 'expired' ? 'Your trial has ended.' : reservation.reason === 'exhausted' ? 'You have reached your shot limit.' : 'Your access has been paused.';
        return send(res, 403, { ok: false, reason: reservation.reason, message });
      }

      // Any exit path that isn't a delivered image REFUNDS the reserved credit —
      // the customer is never charged for a make they didn't receive.
      let settled = false;
      const refund = async (why) => { if (settled) return; settled = true; await store.refund(inv.magicToken); appendEvent({ ts: Date.now(), inviteeId: inv.id, email: inv.email, kind: 'make-refund', meta: { path: upstreamPath, why } }); };
      try {
        const headers = { authorization: `Bearer ${config.openaiKey}` };
        const ct = req.headers['content-type'];
        if (ct) headers['content-type'] = ct;
        const upstream = await openaiFetchWithRetry(upstreamPath, headers, rawBuf);
        const text = await upstream.text();
        if (!upstream.ok) {
          await refund('provider_status_' + upstream.status);
          res.writeHead(upstream.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          return res.end(text);
        }
        // VERIFY BEFORE COMMIT: a 200 with no usable image is NOT a result — refund.
        let parsed = null, b64 = '';
        try { parsed = JSON.parse(text); b64 = parsed?.data?.[0]?.b64_json || ''; } catch { /* not json */ }
        if (!b64) {
          await refund('empty_result');
          res.writeHead(502, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          return res.end(JSON.stringify({ ok: false, reason: 'empty_result', message: 'The model returned no image — you were not charged.' }));
        }
        settled = true; // a real image exists → the charge stands
        let quality = 'high';
        try { if (isJson) quality = JSON.parse(rawBuf.toString('utf-8')).quality || 'high'; } catch { /* keep default */ }
        let usd = estimateImageUsd(quality), realImg = false, imgUsage = null;
        try { imgUsage = parsed?.usage; const r = imageUsdFromUsage(imgUsage); if (r != null && !Number.isNaN(r)) { usd = Number(r.toFixed(6)); realImg = true; } } catch { /* keep estimate */ }

        // SERVER-SIDE SAVE: the credit is spent, so the frame must not depend on
        // the browser staying connected. If we know the project, persist it now —
        // the user finds it in their library on return even if they closed the tab.
        let savedImgPath = '';
        if (projectId && isJson) {
          try {
            const reqBody = JSON.parse(rawBuf.toString('utf-8'));
            const proj = cloud.projectById(inv.id, projectId);
            if (proj) {
              const prompt = String(reqBody.prompt || '').slice(0, 4000);
              const row = cloud.saveGeneration(inv.id, {
                pid: projectId, base64: b64, ext: 'png',
                sidecar: { promptTitle: prompt.slice(0, 120) || 'Frame', prompt, size: reqBody.size, quality, modelLabel: config.imageModel || 'gpt-image-2', costUsd: usd, sig },
                promptSlug: 'frame', projectSlug: proj.slug || '', projectName: proj.name || '',
              });
              savedImgPath = `cloudgen://${projectId}/${row.gid}.${row.ext}`;
            }
          } catch { /* non-fatal — the client can still save from the returned b64 */ }
        }
        appendEvent({ ts: Date.now(), inviteeId: inv.id, email: inv.email, kind: 'make', model: config.imageModel || 'gpt-image-2', usd, meta: { via: 'gateway', path: upstreamPath, saved: !!savedImgPath, ...(realImg ? { real: true, tokens: imgUsage } : { estimated: true }) } });
        const out = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
        if (savedImgPath) { out['x-hjen-saved'] = savedImgPath; out['access-control-expose-headers'] = 'x-hjen-saved'; }
        res.writeHead(200, out);
        return res.end(text);
      } catch (err) {
        await refund('exception');
        return send(res, 502, { ok: false, reason: 'provider_error', message: String(err?.message || err) });
      }
    }

    if (method === 'POST' && p === '/api/make') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const body = await readJson(req);
      const prompt = String(body.prompt || '').trim();
      if (!prompt) return send(res, 400, { ok: false, message: 'Type a prompt first.' });

      const reservation = await store.consumeMake(inv.magicToken);
      if (!reservation.ok) {
        const message = reservation.reason === 'expired' ? 'Your trial has ended.' : reservation.reason === 'exhausted' ? 'You have reached your shot limit.' : 'Your access has been paused.';
        return send(res, 403, { ok: false, reason: reservation.reason, message });
      }

      const ownDir = path.resolve(path.join(paths.refs(), inv.id));
      const refs = (body.referencePaths || []).filter((rp) => path.resolve(rp).startsWith(ownDir));
      const quality = body.quality || DEFAULT_QUALITY;
      try {
        const result = await makeImage({ prompt, size: body.size || DEFAULT_SIZE, quality, modelId: body.modelId, referencePaths: refs });
        const usd = estimateImageUsd(quality);
        const outDir = path.join(paths.outputs(), inv.id);
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, `${Date.now()}_${genId(6)}.png`), Buffer.from(result.b64, 'base64'));
        appendEvent({ ts: Date.now(), inviteeId: inv.id, email: inv.email, kind: 'make', model: result.model, usd, meta: { size: result.size, quality, refs: refs.length } });
        const after = store.getByToken(inv.magicToken);
        return send(res, 200, { ok: true, image: `data:image/png;base64,${result.b64}`, model: result.model, remaining: Math.max(0, after.genLimit - after.genUsed), genUsed: after.genUsed, genLimit: after.genLimit });
      } catch (err) {
        await store.refund(inv.magicToken);
        const msg = String(err?.message || err);
        const safety = msg.startsWith('SAFETY:');
        return send(res, safety ? 422 : 502, { ok: false, reason: safety ? 'safety' : 'provider_error', message: msg.replace(/^SAFETY:\s*/, '') });
      }
    }

    if (method === 'POST' && p === '/api/survey') {
      const inv = await requireInvitee(req, url, res); if (!inv) return;
      const body = await readJson(req);
      appendEvent({ ts: Date.now(), inviteeId: inv.id, email: inv.email, kind: 'survey', meta: { ...body } });
      return send(res, 200, { ok: true });
    }

    // ----- admin API -----
    // Scheduler observability — per-bucket live state (limit/remaining learned
    // from provider headers, active, queued, reset window). Owner-gated.
    if (method === 'GET' && p === '/api/admin/scheduler') {
      if (!requireAdmin(req, url, res)) return;
      return send(res, 200, { ok: true, totalQueued: totalQueued(), buckets: schedulerStats() });
    }

    // Storage maintenance — owner-triggered so a full data volume can be reclaimed
    // WITHOUT SSH (the demo box's SSH is IP-gated and can lock the owner out on an
    // IP change). GET reports free space; POST runs the sweep (tmp turds + global
    // recover-cache prune) and reports what it freed. Same work the boot timer does.
    if (p === '/api/admin/maintenance' && (method === 'GET' || method === 'POST')) {
      if (!requireAdmin(req, url, res)) return;
      let disk = null;
      try { const st = fs.statfsSync(config.dataDir); disk = { freeBytes: st.bavail * st.bsize, totalBytes: st.blocks * st.bsize }; } catch { /* statfs unsupported */ }
      if (method === 'GET') return send(res, 200, { ok: true, disk });
      const tmp = sweepDataTmp();
      const recovered = cloud.pruneAllRecover();
      let after = null;
      try { const st = fs.statfsSync(config.dataDir); after = { freeBytes: st.bavail * st.bsize, totalBytes: st.blocks * st.bsize }; } catch { /* unsupported */ }
      return send(res, 200, { ok: true, sweptTmp: tmp, prunedRecover: recovered, diskBefore: disk, diskAfter: after });
    }

    // Qoyod accounting — integration status (configured? dry-run? VAT? queue).
    if (method === 'GET' && p === '/api/admin/qoyod/status') {
      if (!requireAdmin(req, url, res)) return;
      return send(res, 200, { ok: true, qoyod: qoyodStatus() });
    }
    // Expense-type accounts, for the console expense form's category dropdown.
    if (method === 'GET' && p === '/api/admin/qoyod/expense-categories') {
      if (!requireAdmin(req, url, res)) return;
      const categories = await listExpenseCategories().catch(() => []);
      return send(res, 200, { ok: true, categories });
    }
    // Record a business expense into Qoyod (simple bill). Owner-gated; amount is
    // VAT-exclusive. Honors QOYOD_DRY_RUN (logs, creates nothing) like sales.
    if (method === 'POST' && p === '/api/admin/qoyod/expense') {
      if (!requireAdmin(req, url, res)) return;
      const b = await readJson(req);
      const r = await recordExpense({
        vendorName: b.vendorName, vendorTaxNumber: b.vendorTaxNumber,
        categoryId: b.categoryId, description: b.description,
        amount: b.amount, withVat: b.withVat !== false,
        issueDate: b.issueDate, reference: b.reference, status: b.status,
      }).catch((e) => ({ ok: false, note: String(e?.message || e) }));
      audit('qoyod:expense', null, { vendor: b.vendorName, amount: b.amount, note: r.note });
      return send(res, r.ok ? 200 : 400, r);
    }

    if (method === 'GET' && p === '/api/admin/invitees') {
      if (!requireAdmin(req, url, res)) return;
      const events = readEvents();
      const byId = new Map();
      for (const e of events) {
        const agg = byId.get(e.inviteeId) || { makes: 0, logins: 0, usd: 0, lastTs: 0 };
        if (e.kind === 'make') agg.makes += 1;
        if (e.kind === 'login') agg.logins += 1;
        agg.usd += e.usd || 0;
        agg.lastTs = Math.max(agg.lastTs, e.ts);
        byId.set(e.inviteeId, agg);
      }
      const invitees = store.list().map((inv) => {
        const s = gateStatus(inv);
        const agg = byId.get(inv.id) || { makes: 0, logins: 0, usd: 0, lastTs: 0 };
        return { ...inv, magicLink: `${config.publicBaseUrl}/s/${inv.magicToken}`, remaining: s.remaining, daysLeft: s.daysLeft, gateOpen: s.ok, activated: agg.logins > 0, makesLogged: agg.makes, spentUsd: Number(agg.usd.toFixed(3)), lastEventTs: agg.lastTs || inv.lastActiveAt || null };
      });
      const totalSpent = invitees.reduce((a, b) => a + b.spentUsd, 0);
      return send(res, 200, { ok: true, invitees, totals: { count: invitees.length, totalSpentUsd: Number(totalSpent.toFixed(2)) } });
    }

    if (method === 'POST' && p === '/api/admin/create') {
      if (!requireAdmin(req, url, res)) return;
      const b = await readJson(req);
      if (!b.email) return send(res, 400, { ok: false, message: 'email required' });
      const inv = await store.create({ email: b.email, name: b.name, genLimit: b.genLimit ?? 40, durationDays: b.durationDays ?? 15, wave: b.wave ?? 1, active: b.active });
      return send(res, 200, { ok: true, invitee: inv, magicLink: `${config.publicBaseUrl}/s/${inv.magicToken}` });
    }

    // Bulk-create a wave of invitees. Waves 2+ are created closed (active:false)
    // so the launch is staggered — open a wave with /api/admin/wave on schedule.
    if (method === 'POST' && p === '/api/admin/bulk') {
      if (!requireAdmin(req, url, res)) return;
      const b = await readJson(req);
      const made = await store.createMany({ count: b.count ?? 25, wave: b.wave ?? 1, genLimit: b.genLimit ?? 40, durationDays: b.durationDays ?? 15, active: b.active });
      const links = made.map((inv) => ({ name: inv.name, magicLink: `${config.publicBaseUrl}/s/${inv.magicToken}` }));
      return send(res, 200, { ok: true, count: made.length, wave: b.wave ?? 1, links });
    }

    // Approve a pending Early-Access request: opens access + grants quota.
    if (method === 'POST' && p === '/api/admin/approve') {
      if (!requireAdmin(req, url, res)) return;
      const b = await readJson(req);
      const inv = await store.approve(b.id, { genLimit: b.genLimit ?? 40, durationDays: b.durationDays ?? 15 });
      if (!inv) return send(res, 404, { ok: false, message: 'not found' });
      audit('approve', inv);
      return send(res, 200, { ok: true, invitee: inv, magicLink: `${config.publicBaseUrl}/s/${inv.magicToken}` });
    }

    // Usage analytics — recent activity feed + per-day rollup + per-model split,
    // computed from the append-only event log. Governance visibility.
    if (method === 'GET' && p === '/api/admin/activity') {
      if (!requireAdmin(req, url, res)) return;
      const events = readEvents();
      const makes = events.filter((e) => e.kind === 'make');
      const recent = events.slice(-30).reverse().map((e) => ({
        ts: e.ts, email: e.email, kind: e.kind, model: e.model || null,
        usd: typeof e.usd === 'number' ? Number(e.usd.toFixed(4)) : null,
      }));
      const byModel = {};
      for (const m of makes) { const k = m.model || 'unknown'; byModel[k] = (byModel[k] || 0) + 1; }
      const byDay = {};
      for (const m of makes) {
        const d = new Date(m.ts).toISOString().slice(0, 10);
        byDay[d] = byDay[d] || { makes: 0, spend: 0 };
        byDay[d].makes++; byDay[d].spend += (m.usd || 0);
      }
      const DAY = 86400000; const days = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date(Date.now() - i * DAY).toISOString().slice(0, 10);
        days.push({ day: d.slice(5), makes: byDay[d]?.makes || 0, spend: Number((byDay[d]?.spend || 0).toFixed(3)) });
      }
      const totalSpend = events.reduce((s, e) => s + (typeof e.usd === 'number' ? e.usd : 0), 0);
      return send(res, 200, { ok: true, recent, byModel, days, totalMakes: makes.length, totalSpend: Number(totalSpend.toFixed(3)) });
    }

    // Governance settings — the owner's switches (e.g. Clerk sign-up approval).
    if (method === 'GET' && p === '/api/admin/settings') {
      if (!requireAdmin(req, url, res)) return;
      return send(res, 200, { ok: true, settings: store.getSettings() });
    }
    if (method === 'POST' && p === '/api/admin/settings') {
      if (!requireAdmin(req, url, res)) return;
      const b = await readJson(req);
      const settings = store.setSetting('clerkSignupApproval', b.clerkSignupApproval === true);
      audit('signup-approval:' + (b.clerkSignupApproval === true));
      return send(res, 200, { ok: true, settings });
    }

    // Impersonation ("view as user") — returns the account's studio link so the
    // owner can see the product as that account. Scoped + audit-logged.
    if (method === 'POST' && p === '/api/admin/impersonate') {
      if (!requireAdmin(req, url, res)) return;
      const b = await readJson(req);
      const inv = store.getById(b.id);
      if (!inv) return send(res, 404, { ok: false, message: 'not found' });
      audit('impersonate', inv);
      return send(res, 200, { ok: true, link: `${config.publicBaseUrl}/s/${inv.magicToken}` });
    }

    // Owner-action audit trail (who/when/what).
    if (method === 'GET' && p === '/api/admin/audit') {
      if (!requireAdmin(req, url, res)) return;
      const events = readEvents().filter((e) => e.kind === 'audit').slice(-80).reverse();
      return send(res, 200, { ok: true, events });
    }

    // The members + roles of a Clerk organization (the org hierarchy tree),
    // pulled live from Clerk so the owner sees who's in each team account.
    if (method === 'GET' && p === '/api/admin/org') {
      if (!requireAdmin(req, url, res)) return;
      const orgId = url.searchParams.get('orgId') || '';
      const members = await fetchOrgMembers(orgId);
      return send(res, 200, { ok: true, members });
    }

    // Assign an account's plan/category (Trial/Pro/Team/Enterprise) — applies the
    // plan's default quota + validity. The governance lever.
    if (method === 'POST' && p === '/api/admin/plan') {
      if (!requireAdmin(req, url, res)) return;
      const b = await readJson(req);
      const inv = await store.setPlan(b.id, b.plan);
      if (!inv) return send(res, 400, { ok: false, message: 'invalid id or plan' });
      audit('plan:' + b.plan, inv);
      return send(res, 200, { ok: true, invitee: inv });
    }

    // Reject a pending request.
    if (method === 'POST' && p === '/api/admin/reject') {
      if (!requireAdmin(req, url, res)) return;
      const b = await readJson(req);
      const inv = await store.reject(b.id);
      if (!inv) return send(res, 404, { ok: false, message: 'not found' });
      audit('reject', inv);
      return send(res, 200, { ok: true, invitee: inv });
    }

    // Open or close a whole wave at once (enforced staggering).
    if (method === 'POST' && p === '/api/admin/wave') {
      if (!requireAdmin(req, url, res)) return;
      const b = await readJson(req);
      const changed = await store.setWaveActive(b.wave ?? 1, b.active !== false);
      return send(res, 200, { ok: true, wave: b.wave ?? 1, active: b.active !== false, changed });
    }

    if (method === 'POST' && (p === '/api/admin/extend' || p === '/api/admin/stop' || p === '/api/admin/activate' || p === '/api/admin/bump')) {
      if (!requireAdmin(req, url, res)) return;
      const b = await readJson(req);
      if (!b.id) return send(res, 400, { ok: false, message: 'id required' });
      let inv = null;
      if (p.endsWith('/extend')) inv = await store.extend(b.id, b.days ?? 7);
      else if (p.endsWith('/stop')) inv = await store.setActive(b.id, false);
      else if (p.endsWith('/activate')) inv = await store.setActive(b.id, true);
      else if (p.endsWith('/bump')) inv = await store.bumpLimit(b.id, b.makes ?? 10);
      if (inv) audit(p.split('/').pop(), inv);
      return inv ? send(res, 200, { ok: true, invitee: inv }) : send(res, 404, { ok: false });
    }

    return send(res, 404, { ok: false, message: 'not found' });
  } catch (err) {
    return send(res, 500, { ok: false, message: String(err?.message || err) });
  }
});

const missing = [];
if (!config.openaiKey) missing.push('OPENAI_API_KEY');
if (!config.adminToken) missing.push('ADMIN_TOKEN');
if (missing.length) console.warn(`[warn] missing env: ${missing.join(', ')} — make/admin limited until set.`);

// ── server-side video completion worker ────────────────────────────────────
// Video is charged on submit but rendered at the vendor. This polls each pending
// task to completion INDEPENDENT of the browser: on success it downloads + saves
// the clip to the project (the user finds it on return even if they left); on
// failure it refunds the make exactly once. This is what makes a paid video
// never get lost — and never charged when it didn't render.
async function pollVideoJobs() {
  let jobs;
  try { jobs = cloud.listVideoJobs().filter((j) => j.status === 'pending'); } catch { return; }
  for (const j of jobs) {
    try {
      let status = '', videoUrl = '';
      if (j.provider === 'ark' && config.arkKey) {
        const d = await (await fetch(`${j.base}/contents/generations/tasks/${encodeURIComponent(j.taskId)}`, { headers: { authorization: `Bearer ${config.arkKey}` } })).json();
        status = String(d.status || '').toLowerCase(); videoUrl = d.content?.video_url || '';
      } else if (j.provider === 'kling' && config.klingKey) {
        const d = await (await fetch(`${j.base}/v1/videos/${j.videoType || 'text2video'}/${encodeURIComponent(j.taskId)}`, { headers: { authorization: `Bearer ${config.klingKey}` } })).json();
        status = String(d.data?.task_status || '').toLowerCase(); videoUrl = d.data?.task_result?.videos?.[0]?.url || '';
      } else { continue; }

      if (/succe/.test(status) && videoUrl) {
        const vr = await fetch(videoUrl);
        if (!vr.ok) { cloud.setVideoJob(j.taskId, { tries: (j.tries || 0) + 1 }); continue; }
        const buf = Buffer.from(await vr.arrayBuffer());
        const proj = cloud.projectById(j.acc, j.projectId);
        const vrow = cloud.saveGeneration(j.acc, { pid: j.projectId, base64: buf.toString('base64'), ext: 'mp4', sidecar: { promptTitle: j.prompt || 'Video', prompt: j.prompt, kind: 'video', provider: j.provider, taskId: j.taskId, size: j.res, resolution: j.res, videoSeconds: j.dur, ratio: j.ratio, modelLabel: j.model }, promptSlug: 'video', projectSlug: proj?.slug || '', projectName: proj?.name || '' });
        try { cloud.makeVideoPoster(j.acc, j.projectId, vrow.gid, 'mp4'); } catch {}
        cloud.setVideoJob(j.taskId, { status: 'done', doneAt: Date.now() });
        appendEvent({ ts: Date.now(), inviteeId: j.acc, kind: 'video-saved', meta: { provider: j.provider, taskId: j.taskId, serverside: true } });
      } else if (/fail|error|cancel/.test(status)) {
        const rf = await store.refundForTask(j.token, j.taskId);
        cloud.setVideoJob(j.taskId, { status: 'failed' });
        if (rf.ok) appendEvent({ ts: Date.now(), inviteeId: j.acc, kind: 'make-refund', meta: { kind: 'video', provider: j.provider, why: 'render_' + status, taskId: j.taskId, serverside: true } });
      } else {
        const tries = (j.tries || 0) + 1;
        cloud.setVideoJob(j.taskId, tries > 120 ? { status: 'timeout' } : { tries }); // give up after ~1h
      }
    } catch { /* transient — retry next tick */ }
  }
}
setInterval(() => { pollVideoJobs().catch(() => {}); }, 30000);

// Qoyod: drain any failed sale-invoice pushes periodically (no-op unless Qoyod
// is configured and live). Dormant when QOYOD_API_KEY is unset.
initQoyodSweep();

// ── boot + periodic maintenance ──────────────────────────────────────────────
// Keep the data volume bounded so a slow fill can't wedge metering writes:
//  · sweep stale `*.<pid>.tmp` turds left by any interrupted atomic write —
//    ENOSPC leaves one on EVERY retry, so they compound the very problem that
//    created them (this is the file the "no space left on device" banner names);
//  · prune the recover safety-net cache for EVERY account (the per-account prune
//    only runs on that account's next make, so idle/blocked accounts never expire).
function sweepDataTmp() {
  let removed = 0;
  try {
    for (const f of fs.readdirSync(config.dataDir)) {
      if (!/\.\d+\.tmp$/.test(f)) continue;
      try { fs.rmSync(path.join(config.dataDir, f)); removed++; } catch { /* raced */ }
    }
  } catch { /* dataDir missing → nothing to sweep */ }
  return removed;
}
function runMaintenance() {
  try {
    const tmp = sweepDataTmp();
    const rec = cloud.pruneAllRecover();
    if (tmp || rec) console.log(`[maint] swept ${tmp} tmp turd(s), pruned ${rec} recover blob(s)`);
  } catch (e) { console.warn('[maint] failed', e?.message || e); }
}
runMaintenance();
setInterval(runMaintenance, 6 * 3600 * 1000).unref?.();

server.listen(config.port, '0.0.0.0', () => {
  console.log(`HJEN Studio gated demo → ${config.publicBaseUrl}  (admin at ${config.publicBaseUrl}/admin)`);
});
