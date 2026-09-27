// run.js — the SERVER-side runLlmJson.
//
// WHY THIS EXISTS. Four creative engines (the Eye, The Swap, Reference Maker,
// Context Agents) were written for the Electron MAIN process against an injected
// `runLlmJson`, precisely so the recipe never reaches the renderer. To give the
// web the same features we port those engines here — and they need the same
// seam. This is it: one function with the MAIN contract, implemented against the
// server's own keys, blobs and metering.
//
// HOUSE LAW (the recipe stays server-side). Everything that calls this lives in
// src/ and is never served to a browser. The web adapter posts a small typed
// request; the prompts, the ladders and the validation stay here.
//
// Metering matches /v1/llm exactly, including VERIFY BEFORE COMMIT: a 200 with
// no usable text is not a result, so it is refunded rather than charged.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { store, appendEvent } from '../store.js';
import { cloud } from '../cloudstore.js';
import { llmUsd } from '../pricing.js';
import { run as schedule } from '../scheduler.js';
import { bucketKey } from '../ratelimits.js';

const execFileP = promisify(execFile);

/** Model id → its vendor. Mirrors providerFor() in the ported engines, which
 *  each carry their own copy because they must stay independently registerable. */
export function providerFor(model) {
  const m = String(model || '');
  if (m.startsWith('claude')) return 'anthropic';
  if (m.startsWith('gemini')) return 'google';
  return 'openai';
}

/** The synthetic paths the renderer round-trips. Same grammar as /api/file,
 *  plus cloudbd:// for a breakdown frame (the Eye reads those too). */
export function parseCloudToken(tok) {
  const s = decodeURIComponent(String(tok || ''));
  let m = s.match(/^cloudgen:\/\/([^/]+)\/([^.]+)\.(\w+)$/);
  if (m) return { kind: 'gen', pid: m[1], gid: m[2], ext: m[3] };
  m = s.match(/^cloudlib:\/\/(.+)$/);
  if (m) return { kind: 'lib', file: m[1] };
  m = s.match(/^cloudbd:\/\/([^/]+)\/([^/]+)\/(.+)$/);
  if (m) return { kind: 'bd', pid: m[1], slug: m[2], id: m[3] };
  return null;
}

const VLM_OK = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

/** Read one image for a vision call. Frameset saves stills as AVIF, which the
 *  OpenAI vision API rejects — anything the vendors will not take is converted
 *  to PNG first (the desktop uses `sips`; the server image ships ImageMagick).
 *  Returns { mime, data } base64, or null when the frame cannot be read. */
export async function readVisionImage(acc, token) {
  const t = parseCloudToken(token);
  let buf = null, ext = 'png';
  if (t?.kind === 'gen') { buf = cloud.readBlob(acc, t.pid, t.gid, t.ext); ext = String(t.ext || 'png').toLowerCase(); }
  else if (t?.kind === 'lib') { buf = cloud.readLibraryBlob(acc, t.file); ext = String(t.file.split('.').pop() || 'png').toLowerCase(); }
  else if (t?.kind === 'bd') { buf = cloud.readBreakdownFrame(acc, t.pid, t.slug, t.id, 'full'); ext = 'jpg'; }
  if (!buf || !buf.length) return null;
  if (VLM_OK.has(ext)) return { mime: MIME[ext] || 'image/png', data: buf.toString('base64') };
  // Not a format the vendors accept — transcode through a temp file.
  const stem = path.join(os.tmpdir(), `hjen-vlm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  const src = `${stem}.${ext.replace(/[^a-z0-9]/g, '') || 'bin'}`;
  const out = `${stem}.png`;
  try {
    fs.writeFileSync(src, buf);
    await execFileP('convert', [src, out], { timeout: 20000 });
    const png = fs.readFileSync(out);
    return png.length ? { mime: 'image/png', data: png.toString('base64') } : null;
  } catch {
    return null; // the caller reports the miss honestly rather than sending junk
  } finally {
    try { fs.unlinkSync(src); } catch { /* best-effort */ }
    try { fs.unlinkSync(out); } catch { /* best-effort */ }
  }
}

/** Inline media straight off the server's own disk — the Cuts passes watch a
 *  transcoded clip rather than a still, and only Google takes video inline. The
 *  path is never user-supplied: it is a file this server just produced. */
export function inlineLocalFile(file, mime) {
  try {
    const buf = fs.readFileSync(file);
    return buf.length ? { mime, data: buf.toString('base64') } : null;
  } catch { return null; }
}

/** Pull REAL token counts out of the vendor response (same as server.js). */
function realUsd(provider, model, responseText) {
  try {
    const d = JSON.parse(responseText);
    let inTok = 0, outTok = 0;
    if (provider === 'anthropic') { inTok = d?.usage?.input_tokens ?? 0; outTok = d?.usage?.output_tokens ?? 0; }
    else if (provider === 'openai') { inTok = d?.usage?.prompt_tokens ?? 0; outTok = d?.usage?.completion_tokens ?? 0; }
    else if (provider === 'google') { inTok = d?.usageMetadata?.promptTokenCount ?? 0; outTok = d?.usageMetadata?.candidatesTokenCount ?? 0; }
    if (inTok || outTok) { const u = llmUsd(model, inTok, outTok); if (u != null && !Number.isNaN(u)) return { usd: u, inTok, outTok }; }
  } catch { /* estimate below */ }
  return null;
}

/** Vendor response → the { ok, text, truncated } the engines expect. */
function parseVendor(provider, txt) {
  const d = JSON.parse(txt);
  if (provider === 'anthropic') {
    const text = (d.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    return { text, truncated: d.stop_reason === 'max_tokens', model: d.model };
  }
  if (provider === 'openai') {
    const ch = (d.choices || [])[0] || {};
    return { text: String(ch.message?.content || ''), truncated: ch.finish_reason === 'length', model: d.model };
  }
  const cand = (d.candidates || [])[0] || {};
  const text = (cand.content?.parts || []).map((x) => x.text || '').join('');
  return { text, truncated: cand.finishReason === 'MAX_TOKENS', model: d.modelVersion };
}

/**
 * The MAIN-process contract, server-side.
 * @param inv  the authenticated invitee (account + quota)
 * @param args { provider, model, system, prompt, maxTokens, imagePaths, audioPaths, jsonMode }
 * @returns { ok, text, truncated, model } | { ok:false, reason, message }
 */
export async function runLlmJson(inv, args = {}) {
  const model = String(args.model || '');
  const provider = String(args.provider || providerFor(model));
  const prompt = String(args.prompt || '').trim();
  if (!prompt) return { ok: false, reason: 'empty_prompt', message: 'Nothing to send.' };

  const keyMap = { anthropic: config.anthropicKey, openai: config.openaiKey, google: config.googleKey };
  const key = keyMap[provider];
  if (!key) return { ok: false, reason: 'no_key', message: `Server has no ${provider} key.` };

  const maxTokens = Math.min(Math.max(Number(args.maxTokens) || 8192, 512), 32000);
  const system = String(args.system || '');
  const imgs = [];
  for (const p of (args.imagePaths || [])) {
    const img = await readVisionImage(inv.id, p);
    if (img) imgs.push(img);
  }
  // Already-resolved {mime,data} parts — video or audio the caller inlined
  // itself. Only Google accepts these in the same shape as an image, so on the
  // other vendors they are dropped rather than silently mangled.
  const media = Array.isArray(args.mediaParts) ? args.mediaParts.filter(Boolean) : [];

  let upstreamUrl = '', headers = { 'content-type': 'application/json' }, body = null;
  if (provider === 'anthropic') {
    upstreamUrl = 'https://api.anthropic.com/v1/messages';
    headers['anthropic-version'] = '2023-06-01';
    headers['x-api-key'] = key;
    const content = imgs.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.data } }));
    content.push({ type: 'text', text: prompt });
    body = { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] };
  } else if (provider === 'openai') {
    upstreamUrl = 'https://api.openai.com/v1/chat/completions';
    headers.authorization = `Bearer ${key}`;
    const content = imgs.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.data}` } }));
    content.push({ type: 'text', text: prompt });
    body = {
      model, max_completion_tokens: maxTokens,
      messages: (system ? [{ role: 'system', content: system }] : []).concat([{ role: 'user', content }]),
    };
    if (args.jsonMode) body.response_format = { type: 'json_object' };
  } else if (provider === 'google') {
    upstreamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${key}`;
    const parts = [];
    if (system) parts.push({ text: system });
    imgs.forEach((i) => parts.push({ inline_data: { mime_type: i.mime, data: i.data } }));
    media.forEach((i) => parts.push({ inline_data: { mime_type: i.mime, data: i.data } }));
    parts.push({ text: prompt });
    body = { contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: maxTokens } };
    if (typeof args.temperature === 'number') body.generationConfig.temperature = args.temperature;
    if (args.jsonMode) body.generationConfig.responseMimeType = 'application/json';
  } else {
    return { ok: false, reason: 'bad_provider', message: `Unknown provider "${provider}".` };
  }

  const reservation = await store.consumeMake(inv.magicToken);
  if (!reservation.ok) {
    const message = reservation.reason === 'expired' ? 'Your trial has ended.'
      : reservation.reason === 'exhausted' ? 'You have reached your shot limit.'
      : 'Your access has been paused.';
    return { ok: false, reason: reservation.reason, message };
  }

  try {
    const upstream = await schedule(bucketKey(provider, model || provider),
      () => fetch(upstreamUrl, { method: 'POST', headers, body: JSON.stringify(body) }));
    const txt = await upstream.text();
    if (!upstream.ok) {
      await store.refund(inv.magicToken);
      return { ok: false, reason: 'api_error', message: `${provider} ${upstream.status}: ${txt.slice(0, 400)}` };
    }
    let parsed;
    try { parsed = parseVendor(provider, txt); }
    catch { parsed = { text: '' }; }
    // VERIFY BEFORE COMMIT — a 200 with no text is not a result.
    if (!String(parsed.text || '').trim()) {
      await store.refund(inv.magicToken);
      appendEvent({ ts: Date.now(), inviteeId: inv.id, email: inv.email, kind: 'make-refund', meta: { kind: 'llm', provider, why: 'empty_result' } });
      return { ok: false, reason: 'empty_result', message: `${provider} returned no text.` };
    }
    const real = realUsd(provider, model, txt);
    appendEvent({
      ts: Date.now(), inviteeId: inv.id, email: inv.email, kind: 'make', model,
      usd: real ? Number(real.usd.toFixed(6)) : 0.01,
      meta: { via: 'engine', kind: 'llm', provider, ...(real ? { inTok: real.inTok, outTok: real.outTok, real: true } : { estimated: true }) },
    });
    return { ok: true, text: parsed.text, truncated: !!parsed.truncated, model: parsed.model || model };
  } catch (err) {
    await store.refund(inv.magicToken);
    return { ok: false, reason: 'provider_error', message: String(err?.message || err) };
  }
}

/** Lenient JSON extraction — vendors wrap objects in prose or fences even when
 *  told not to. Same tolerance the desktop engines apply before validating. */
export function parseJsonLoose(text) {
  const s = String(text || '').trim();
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : s;
  try { return JSON.parse(body); } catch { /* hunt the outermost object */ }
  const first = body.indexOf('{'), last = body.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(body.slice(first, last + 1)); } catch { /* give up */ }
  }
  const fa = body.indexOf('['), la = body.lastIndexOf(']');
  if (fa >= 0 && la > fa) {
    try { return JSON.parse(body.slice(fa, la + 1)); } catch { /* give up */ }
  }
  return null;
}
