// engine.js — Cuts, SERVER-side. Port of the hjen:cuts-* handlers in
// app/electron/main.ts.
//
// WHY THE WHOLE TOOL AND NOT HALF. Cuts is one pipeline: ffmpeg finds the shots,
// then six vision passes watch the ad. Porting only the language half would have
// produced doors with nothing to read — the shots have to exist first. The
// server already carries ffmpeg (it runs the Breakdown ingest), so the whole
// tool moves rather than a slice of it.
//
// Re-seamed, not rewritten. Every prompt inside these handlers is the desktop's,
// character for character; what changed is where things live:
//   · cutsSessionDir → an ACCOUNT-scoped working area (cloud.cutsDir). Cuts is a
//     global internal tool, which is why the desktop's list walks every project
//     bucket — account scope is the same intent expressed once.
//   · providerAuth/providerFetch → the server's own Google key, with each call
//     metered and refunded through src/llm/run.js's rules.
//   · the embed pass needs local Python + worldkit and stays desktop-only.
//   · the URL fetch needs yt-dlp; it runs when the binary is on the box and says
//     so plainly when it is not.
//
// Recipe parity with main.ts is asserted in src/cuts/engine.test.mjs.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from '../config.js';
import { store, appendEvent } from '../store.js';
import { cloud } from '../cloudstore.js';
import { llmUsd } from '../pricing.js';
import { run as schedule } from '../scheduler.js';
import { bucketKey } from '../ratelimits.js';

/** The binaries this box carries. Same probe order as breakdown/ingest.js. */
function which(name) {
  for (const p of [`/usr/local/bin/${name}`, `/opt/homebrew/bin/${name}`, `/usr/bin/${name}`]) {
    try { if (fs.existsSync(p)) return p; } catch { /* keep looking */ }
  }
  return name;                       // fall back to PATH
}
const FFMPEG = which('ffmpeg');
function haveFfmpeg() {
  try { return fs.existsSync(FFMPEG) || FFMPEG === 'ffmpeg'; } catch { return false; }
}
function ytDlpPath() {
  for (const p of ['/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp']) {
    try { if (fs.existsSync(p)) return p; } catch { /* next */ }
  }
  return null;
}

/** cutsRun / cutsGrabFrame, lifted from main.ts. */
function cutsRun(bin, args, timeoutMs = 300000) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, timeoutMs);
    child.stdout.on('data', () => {});
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, stderr: String((e && e.message) || e) }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code == null ? -1 : code, stderr }); });
  });
}
async function cutsGrabFrame(bin, video, t, vf, out, timeoutMs = 30000) {
  // Exact seek (-ss AFTER -i) so a frame never bleeds in from the shot behind.
  const r = await cutsRun(bin, ['-y', '-i', video, '-ss', String(t), '-frames:v', '1', '-vf', vf, '-q:v', '3', out], timeoutMs);
  try { return fs.existsSync(out) && fs.statSync(out).size > 0; } catch { return false; }
}

/** Every Cuts pass is a Google vision call. This meters it exactly the way
 *  /v1/llm does — reserve, refuse on an empty answer, log real token spend. */
async function meteredGoogleFetch(inv, url, headers, body, signal, model) {
  const reservation = await store.consumeMake(inv.magicToken);
  if (!reservation.ok) {
    const message = reservation.reason === 'expired' ? 'Your trial has ended.'
      : reservation.reason === 'exhausted' ? 'You have reached your shot limit.'
      : 'Your access has been paused.';
    const err = new Error(message); err.reason = reservation.reason; throw err;
  }
  let res;
  try {
    res = await schedule(bucketKey('google', model || 'google'),
      () => fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal }));
  } catch (e) { await store.refund(inv.magicToken); throw e; }
  if (!res.ok) { await store.refund(inv.magicToken); return res; }
  // VERIFY BEFORE COMMIT — read the body once, refund a 200 with no text.
  const text = await res.text();
  let hasText = false, inTok = 0, outTok = 0;
  try {
    const d = JSON.parse(text);
    hasText = !!(d.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('').trim();
    inTok = d?.usageMetadata?.promptTokenCount ?? 0;
    outTok = d?.usageMetadata?.candidatesTokenCount ?? 0;
  } catch { /* non-json → no text */ }
  if (!hasText) {
    await store.refund(inv.magicToken);
    appendEvent({ ts: Date.now(), inviteeId: inv.id, email: inv.email, kind: 'make-refund', meta: { kind: 'cuts', provider: 'google', why: 'empty_result' } });
  } else {
    // pricing.js THROWS on a model it does not know, and Cuts names live model
    // aliases ("gemini-flash-latest"). An unpriced model must degrade to the flat
    // estimate — never take down the pass that already produced the answer.
    let usd = null;
    if (inTok || outTok) { try { usd = llmUsd(model, inTok, outTok); } catch { usd = null; } }
    if (usd != null && Number.isNaN(usd)) usd = null;
    appendEvent({ ts: Date.now(), inviteeId: inv.id, email: inv.email, kind: 'make', model,
      usd: usd != null ? Number(usd.toFixed(6)) : 0.01,
      meta: { via: 'cuts', kind: 'llm', provider: 'google', ...(usd != null ? { inTok, outTok, real: true } : { estimated: true, unpricedModel: usd == null }) } });
  }
  // Hand the caller a Response-shaped object; the ported bodies call .json()/.text().
  return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
}

/** The Cuts doors, bound to one account. The handler bodies below are the
 *  desktop's, so the seams they call are defined HERE, in this scope. */
export function bindCuts(inv) {
  const acc = inv.id;
  const resolveFfmpeg = () => (haveFfmpeg() ? FFMPEG : null);
  const bdFfmpeg = () => FFMPEG;
  const bdYtDlp = () => ytDlpPath() || 'yt-dlp';
  const resolveWorldPython = () => null;          // no local ML on the server
  const worldkitScript = () => null;
  const describeMissing = () => 'ffmpeg is not available on this server.';
  const resolveTool = (id) => (id === 'ffmpeg' ? resolveFfmpeg() : null);
  const cutsSessionDir = (_projectSlug, sessionId) => cloud.cutsDir(acc, sessionId);
  const projectFolder = () => cloud.cutsDir(acc, '_fetch');
  const projectsRootPath = () => cloud.cutsDir(acc, '_fetch');
  const providerAuth = () => ({ key: config.googleKey });
  const gatewaySettings = () => null;
  const taskModelOverride = (task) => {
    try {
      const j = cloud.readAcctDoc(acc, 'models', null);
      const m = j?.tasks?.[task];
      return typeof m === 'string' && m ? m : null;
    } catch { return null; }
  };
  const providerFetch = (_p, url, headers, body, signal) =>
    meteredGoogleFetch(inv, url, headers, body, signal,
      String((body && body.model) || url.match(/models\/([^:?]+)/)?.[1] || 'gemini'));
  const app = { getPath: () => cloud.cutsDir(acc, '_tmp') };
  const win = null;
  const mainWindow = null;

// NOTE ON INDENTATION. The handler bodies below sit at column 0 rather than
// nested to this function. That is deliberate: several of them carry multi-line
// prompt templates, and re-indenting the file would have silently added spaces
// INSIDE those template literals — changing the recipe. Prompt fidelity wins
// over cosmetics; src/cuts/engine.test.mjs asserts every literal is verbatim.

const analyze = async (args) => {
    const bin = resolveFfmpeg();
    if (!bin)
        return { ok: false, reason: 'no_ffmpeg', message: 'ffmpeg not found. Install it (brew install ffmpeg).' };
    const video = args.videoPath;
    if (!video || !fs.existsSync(video))
        return { ok: false, reason: 'no_video', message: 'Video file not found.' };
    const T = typeof args.threshold === 'number' ? Math.max(0.05, Math.min(0.9, args.threshold)) : 0.3;
    const stripStep = typeof args.stripStep === 'number' ? Math.max(0.5, args.stripStep) : 1.5;
    const dir = cutsSessionDir(args.projectSlug, args.sessionId);
    try {
        // 1) Probe duration + dims + fps from stderr.
        const probe = await cutsRun(bin, ['-hide_banner', '-i', video], 30_000);
        const s = probe.stderr || '';
        const dm = /Duration: (\d+):(\d+):(\d+\.?\d*)/.exec(s);
        const duration = dm ? Math.round((parseFloat(dm[1]) * 3600 + parseFloat(dm[2]) * 60 + parseFloat(dm[3])) * 100) / 100 : 0;
        const vidLine = /Video:.*/.exec(s)?.[0] || '';
        const dims = /(\d{2,5})x(\d{2,5})/.exec(vidLine);
        const width = dims ? parseInt(dims[1], 10) : 0;
        const height = dims ? parseInt(dims[2], 10) : 0;
        const fpsM = /(\d+(?:\.\d+)?)\s*fps/.exec(vidLine);
        const fps = fpsM ? parseFloat(fpsM[1]) : 25;
        if (!duration)
            return { ok: false, reason: 'probe_failed', message: 'Could not read video duration.' };
        // 2) Hard-cut detection — cheap scene-score pass, no image encoding.
        const cutPass = await cutsRun(bin, ['-hide_banner', '-i', video, '-filter:v', `select='gt(scene,${T})',showinfo`, '-an', '-f', 'null', '-'], 600_000);
        const rawTimes = [...(cutPass.stderr || '').matchAll(/pts_time:(\d+\.?\d*)/g)]
            .map(m => parseFloat(m[1])).filter(t => Number.isFinite(t)).sort((a, b) => a - b);
        const cuts = [];
        for (const t of rawTimes) {
            if (t <= 0.2 || t >= duration - 0.15)
                continue;
            if (cuts.length && t - cuts[cuts.length - 1] < 0.25)
                continue;
            cuts.push(Math.round(t * 100) / 100);
        }
        // 3) Build shot intervals; fold only true SLIVERS (< 0.18s = detection
        // jitter) into the previous shot. Real fast-montage cuts (~0.3s) survive.
        const bounds = [0, ...cuts, duration].filter((v, i, a) => i === 0 || v > a[i - 1]);
        const rawShots = [];
        for (let i = 0; i < bounds.length - 1; i++)
            rawShots.push({ start: bounds[i], end: bounds[i + 1] });
        const shotSpans = [];
        for (const sh of rawShots) {
            if (shotSpans.length && sh.end - sh.start < 0.18) {
                shotSpans[shotSpans.length - 1].end = sh.end;
                continue;
            }
            shotSpans.push({ ...sh });
        }
        // 4) One mid-shot representative thumb per shot (fast seek, single frame).
        const shotsDir = path.join(dir, 'shots');
        fs.mkdirSync(shotsDir, { recursive: true });
        const shots = [];
        for (let i = 0; i < shotSpans.length; i++) {
            const sp = shotSpans[i];
            const mid = Math.max(0, Math.min(duration - 0.05, (sp.start + sp.end) / 2));
            const out = path.join(shotsDir, `shot${String(i + 1).padStart(3, '0')}.jpg`);
            await cutsGrabFrame(bin, video, mid, "scale='min(480,iw)':-2", out); // exact seek — no bleed from the shot behind
            shots.push({
                i: i + 1, start: Math.round(sp.start * 100) / 100, end: Math.round(sp.end * 100) / 100,
                dur: Math.round((sp.end - sp.start) * 100) / 100, thumb: fs.existsSync(out) ? out : '',
            });
        }
        // 5) Uniform filmstrip across the whole ad (Layer 1 ribbon).
        const stripDir = path.join(dir, 'strip');
        fs.mkdirSync(stripDir, { recursive: true });
        for (const f of fs.readdirSync(stripDir)) {
            if (/\.jpg$/.test(f))
                fs.rmSync(path.join(stripDir, f));
        }
        await cutsRun(bin, ['-y', '-i', video, '-vf', `fps=1/${stripStep},scale=168:-2`,
            '-q:v', '5', path.join(stripDir, 's%04d.jpg')], 300_000);
        const stripFiles = fs.readdirSync(stripDir).filter(f => /\.jpg$/.test(f)).sort();
        const strip = stripFiles.map((f, idx) => ({ t: Math.round(idx * stripStep * 100) / 100, path: path.join(stripDir, f) }));
        return { ok: true, sessionId: args.sessionId, videoPath: video, duration, fps, width, height, dir, shots, strip };
    }
    catch (err) {
        return { ok: false, reason: 'analyze_failed', message: err?.message || String(err) };
    }
};
// Extract N evenly-spaced candidate frames inside one shot (for frame selection).
const shotFrames = async (args) => {
    const bin = resolveFfmpeg();
    if (!bin)
        return { ok: false, reason: 'no_ffmpeg', message: 'ffmpeg not found.' };
    const video = args.videoPath;
    if (!video || !fs.existsSync(video))
        return { ok: false, reason: 'no_video', message: 'Video file not found.' };
    const dir = cutsSessionDir(args.projectSlug, args.sessionId);
    const candDir = path.join(dir, 'cand');
    fs.mkdirSync(candDir, { recursive: true });
    const count = Math.max(2, Math.min(12, args.count || 6));
    const span = Math.max(0.05, args.end - args.start);
    try {
        const frames = [];
        for (let k = 0; k < count; k++) {
            const t = Math.max(0, args.start + span * ((k + 0.5) / count));
            const id = `s${String(args.shotIndex).padStart(3, '0')}_k${k + 1}`;
            const out = path.join(candDir, `${id}.jpg`);
            const ok = await cutsGrabFrame(bin, video, t, "scale='min(640,iw)':-2", out); // exact seek — no bleed from the shot behind
            if (ok)
                frames.push({ id, abs: out, t: Math.round(t * 100) / 100 });
        }
        return { ok: true, frames };
    }
    catch (err) {
        return { ok: false, reason: 'frames_failed', message: err?.message || String(err) };
    }
};
// Fetch a video from a URL (YouTube/…) via yt-dlp into the Cuts working area.
// Cached per-URL (re-fetch of the same link reuses the download). Returns the
// local absolute path so cuts-analyze can run on it like any local file.
const fetchUrl = async (args) => {
    const url = (args.url || '').trim();
    if (!/^https?:\/\//i.test(url))
        return { ok: false, reason: 'bad_url', message: 'Paste a valid link starting with http.' };
    const root = args.projectSlug ? projectFolder(args.projectSlug) : path.join(projectsRootPath(), '_unassigned');
    const key = url.replace(/[^\w]+/g, '_').slice(-48) || 'clip';
    const work = path.join(root, 'Cuts', '_fetch', key);
    fs.mkdirSync(work, { recursive: true });
    const grab = () => fs.readdirSync(work)
        .filter((f) => /^video\./.test(f) && !/\.(json|vtt|srt|part|ytdl)$/.test(f))
        .sort((a, b) => fs.statSync(path.join(work, b)).size - fs.statSync(path.join(work, a)).size);
    const readTitle = () => {
        try {
            const info = fs.readdirSync(work).find((f) => f.endsWith('.info.json'));
            if (info)
                return JSON.parse(fs.readFileSync(path.join(work, info), 'utf-8'))?.title;
        }
        catch { /* best-effort */ }
        return undefined;
    };
    // Cache hit — already downloaded this URL.
    const cached = grab();
    if (cached.length)
        return { ok: true, videoPath: path.join(work, cached[0]), title: readTitle(), cached: true };
    // Say what is missing BEFORE spawning. This is where testers met
    // `spawn yt-dlp ENOENT`: a raw Node error with no clue what to do about it.
    if (!resolveTool('yt-dlp'))
        return { ok: false, reason: 'missing_tool', message: describeMissing('yt-dlp') };
    if (!resolveTool('ffmpeg'))
        return { ok: false, reason: 'missing_tool', message: describeMissing('ffmpeg') };
    try {
        // --ffmpeg-location is REQUIRED (Electron PATH lacks ffmpeg → unmerged parts otherwise).
        const base = [url, '--no-playlist', '-f', 'bv*[height<=1080]+ba/b[height<=1080]/b',
            '--ffmpeg-location', bdFfmpeg(), '-o', path.join(work, 'video.%(ext)s'), '--write-info-json',
            '--socket-timeout', '20', '--retries', '3', '--fragment-retries', '3', '--no-warnings', '-q'];
        const r = await cutsRun(bdYtDlp(), base, 600_000);
        const vids = grab();
        if (!vids.length) {
            const tail = (r.stderr || '').trim().split('\n').pop()?.slice(0, 200) || 'no video';
            return { ok: false, reason: 'ytdlp_failed', message: `Fetch failed: ${tail}` };
        }
        return { ok: true, videoPath: path.join(work, vids[0]), title: readTitle() };
    }
    catch (err) {
        return { ok: false, reason: 'fetch_failed', message: err?.message || String(err) };
    }
};
// Cuts — local visual re-identification embeddings (offline, MPS). Spawns the
// Python sidecar (torchvision detector + DINOv2 + FaceNet) to place each shot
// in a feature space; the renderer fuses the vectors into person threads.
// The visual-similarity embedding runs a local Python sidecar (worldkit's
// cuts_embed.py, DINOv2). Neither is in the server image, and a stub would only
// move the failure later.
const embed = async () => ({
  ok: false, reason: 'no_python',
  message: 'Shot embeddings are computed on your machine — run this pass in the desktop app.',
});
// Cuts — SPEECH layers. The mind listens (audio) + watches who is on screen,
// splitting speech into VOICE-OVER vs DIALOGUE. To beat Gemini's timecode DRIFT
// on long clips, the video is processed in short WINDOWS (each timecoded from 0,
// then offset by the window start) so timestamps never accumulate error.
const SPEECH_SYSTEM = `You analyse the SPEECH of an advertisement clip using BOTH its audio and its video — crucially, YOU CAN SEE WHETHER MOUTHS MOVE. Work in two steps. STEP 1 (think silently): for every moment a voice is heard, LOOK at the screen and check the LIPS. Is a person on screen moving their lips in sync with the words you hear? Or is the voice heard while no one on screen is speaking (the person is silent / not on screen / lips still)? This lip-sync check is the ONE test that decides the type. STEP 2: output the transcript.`;
const SPEECH_PROMPT = `Transcribe EVERY spoken segment in THIS CLIP — be EXHAUSTIVE, skip nothing: narration, on-screen lines, short interjections, off-screen replies, and any second language. Timecodes are in SECONDS FROM THE START OF THIS CLIP (0 = the first frame of the clip). Focus on getting each segment's START time right.\n\nTYPE — decide ONLY by the lips on screen, never by the voice's tone or role:\n• "dialogue" = the person on screen is visibly moving their OWN lips in sync with these exact words (lip-sync). You can see them speak.\n• "vo" = the words are heard but the person on screen is NOT moving their lips (silent shot, face turned away, cutaway, product/scenery), or no speaker is visible at all.\nA calm narrator whose face never speaks is "vo". A character shouting on camera with moving lips is "dialogue" even if brief. When you truly cannot see any mouth for the segment, default to "vo".\n\nGive the speaker's name/identity if identifiable.\nReturn STRICT JSON only:\n{"segments":[{"type":"vo"|"dialogue","start":<seconds>,"end":<seconds>,"text":"<verbatim words>","speaker":"<who, if identifiable, else empty>"}]}\nIf this clip has no speech, return {"segments":[]}.`;
// Transcode one window to a compact A/V clip and transcribe it (0-based times).
async function cutsSpeechWindow(bin, key, model, video, dir, wStart, len, idx) {
    const av = path.join(dir, `speech_w${idx}.mp4`);
    await cutsRun(bin, ['-y', '-ss', String(wStart), '-i', video, '-t', String(len),
        '-vf', "scale='min(480,iw)':-2,fps=5", '-c:v', 'libx264', '-crf', '30', '-preset', 'veryfast',
        '-ac', '2', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', av], 300_000);
    if (!fs.existsSync(av))
        throw new Error('transcode failed');
    if (fs.statSync(av).size > 20 * 1024 * 1024)
        throw new Error('window too large to send inline');
    const b64 = fs.readFileSync(av).toString('base64');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${key}`;
    const body = {
        contents: [{ role: 'user', parts: [
                    { text: SPEECH_SYSTEM },
                    { inline_data: { mime_type: 'video/mp4', data: b64 } },
                    { text: SPEECH_PROMPT },
                ] }],
        generationConfig: { maxOutputTokens: 24000, temperature: 0.1, responseMimeType: 'application/json' },
    };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 400_000);
    let data;
    try {
        const res = await providerFetch('google', url, { 'content-type': 'application/json' }, body, ac.signal);
        if (!res.ok) {
            const t = await res.text();
            throw new Error(`google ${res.status}: ${t.slice(0, 200)}`);
        }
        data = await res.json();
    }
    finally {
        clearTimeout(timer);
    }
    const cand = data?.candidates?.[0];
    const txt = Array.isArray(cand?.content?.parts) ? cand.content.parts.map((p) => p.text ?? '').join('\n').trim() : '';
    if (!txt)
        return [];
    let t = txt.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a >= 0 && b > a)
        t = t.slice(a, b + 1);
    const parsed = JSON.parse(t);
    return Array.isArray(parsed?.segments) ? parsed.segments : [];
}
const speech = async (args) => {
    const { key } = providerAuth('google');
    if (!key)
        return { ok: false, reason: 'no_key', message: 'No Google API key set (Settings).' };
    const bin = resolveFfmpeg();
    if (!bin)
        return { ok: false, reason: 'no_ffmpeg', message: 'ffmpeg not found.' };
    if (!args.videoPath || !fs.existsSync(args.videoPath))
        return { ok: false, reason: 'no_video', message: 'Video not found.' };
    const model = args.model || 'gemini-flash-latest';
    const dir = cutsSessionDir(args.projectSlug, args.sessionId);
    try {
        // Duration (from the caller, else probe).
        let duration = args.duration || 0;
        if (!duration) {
            const probe = await cutsRun(bin, ['-hide_banner', '-i', args.videoPath], 30_000);
            const dm = /Duration: (\d+):(\d+):(\d+\.?\d*)/.exec(probe.stderr || '');
            duration = dm ? (parseFloat(dm[1]) * 3600 + parseFloat(dm[2]) * 60 + parseFloat(dm[3])) : 0;
        }
        if (!duration)
            return { ok: false, reason: 'no_duration', message: 'Could not read video duration.' };
        // Short windows (60s, 8s overlap) so timecodes never drift across the ad.
        const WIN = 60, OVL = 8, STEP = WIN - OVL;
        const windows = [];
        for (let s = 0; s < duration - 0.5; s += STEP)
            windows.push({ start: Math.round(s * 100) / 100, len: Math.min(WIN, duration - s) });
        if (!windows.length)
            windows.push({ start: 0, len: duration });
        const all = [];
        for (let i = 0; i < windows.length; i++) {
            const w = windows[i];
            const segs = await cutsSpeechWindow(bin, key, model, args.videoPath, dir, w.start, w.len, i);
            for (const s of segs) {
                const st = (Number(s.start) || 0) + w.start;
                all.push({ type: s.type, text: s.text, speaker: s.speaker, start: st, end: (Number(s.end) || st) + w.start });
            }
        }
        // Merge windows: sort by start, drop overlap duplicates (same text near same time).
        all.sort((a, b) => a.start - b.start);
        const norm = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
        const out = [];
        for (const s of all) {
            const dup = out.find(o => Math.abs(o.start - s.start) < 3 && (() => {
                const a2 = norm(o.text), b2 = norm(s.text);
                return a2 === b2 || (a2.length > 4 && (a2.includes(b2) || b2.includes(a2)));
            })());
            if (!dup)
                out.push(s);
        }
        return { ok: true, segments: out };
    }
    catch (err) {
        const aborted = err?.name === 'AbortError';
        return { ok: false, reason: aborted ? 'timeout' : 'speech_failed', message: String(err?.message || err).slice(0, 300) };
    }
};
// Cuts — VERIFY the automatic cuts by comprehension. ffmpeg splits at every big
// frame change, but an object crossing the lens / a whip-pan / a flash triggers
// a FALSE cut (still one continuous take). The mind watches the video + a still
// per shot and flags the boundaries that are false, so they can be merged.
const verify = async (args) => {
    const { key } = providerAuth('google');
    if (!key)
        return { ok: false, reason: 'no_key', message: 'No Google API key set (Settings).' };
    const bin = resolveFfmpeg();
    if (!bin)
        return { ok: false, reason: 'no_ffmpeg', message: 'ffmpeg not found.' };
    if (!args.videoPath || !fs.existsSync(args.videoPath))
        return { ok: false, reason: 'no_video', message: 'Video not found.' };
    const model = args.model || 'gemini-flash-latest';
    const dir = cutsSessionDir(args.projectSlug, args.sessionId);
    const small = path.join(dir, 'watch.mp4');
    try {
        if (!fs.existsSync(small)) {
            await cutsRun(bin, ['-y', '-i', args.videoPath, '-an', '-vf', "scale='min(480,iw)':-2,fps=3",
                '-c:v', 'libx264', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', small], 300_000);
        }
        if (!fs.existsSync(small))
            return { ok: false, reason: 'transcode_failed', message: 'Could not prepare the video.' };
        const b64 = fs.readFileSync(small).toString('base64');
        const N = args.shots.length;
        const system = `You are a film editor auditing an automatic cut detector against the real video. It has TWO kinds of error. (1) FALSE cuts — it split ONE continuous take into two shots because an object crossed the lens, the camera whip-panned, a flash fired, or motion blurred. (2) MISSED cuts — it FAILED to split where a real edit happened, so ONE numbered "shot" actually contains two or more different takes/angles/subjects back to back (common when the two takes look similar in colour or setting, e.g. a wide of a field then a close-up on the same field). You are given the video and one numbered still per detected shot; watch the video against the shot time ranges to find BOTH kinds of error.`;
        const parts = [
            { text: system },
            { inline_data: { mime_type: 'video/mp4', data: b64 } },
            { text: `Detected shots, one still each (1..${N}):` },
        ];
        for (const s of args.shots) {
            parts.push({ text: `Shot ${s.i} (${s.start.toFixed(2)}–${s.end.toFixed(2)}s):` });
            if (s.frame && fs.existsSync(s.frame)) {
                const ext = path.extname(s.frame).toLowerCase();
                const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
                parts.push({ inline_data: { mime_type: mime, data: fs.readFileSync(s.frame).toString('base64') } });
            }
        }
        parts.push({ text: `Do TWO passes against the video:\nA) FALSE cuts — for each boundary between adjacent shots (i and i+1), is it a FALSE trigger where shot i and shot i+1 are actually the SAME continuous take (object crossed the lens, whip-pan, flash, motion blur)? List those to MERGE.\nB) MISSED cuts — for each shot, does its footage actually change to a DIFFERENT take/angle/subject somewhere in the MIDDLE of its time range (a real edit the detector missed)? If so, give the shot number and the approximate ABSOLUTE time in seconds where the new take begins. Only report a split when the content clearly changes to a different shot; do not split on camera movement within one take. A shot can have more than one internal cut.\nReturn STRICT JSON:\n{"merge":[[lower,higher], ...],"split":[{"shot":<n>,"at":<absolute seconds>}, ...]}\nIf there are no false cuts, merge is []. If no shot hides a missed cut, split is [].` });
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${key}`;
        const body = { contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: 8000, temperature: 0.1, responseMimeType: 'application/json' } };
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 300_000);
        let data;
        try {
            const res = await providerFetch('google', url, { 'content-type': 'application/json' }, body, ac.signal);
            if (!res.ok) {
                const t = await res.text();
                return { ok: false, reason: 'api_error', message: `google ${res.status}: ${t.slice(0, 300)}` };
            }
            data = await res.json();
        }
        finally {
            clearTimeout(timer);
        }
        const cand = data?.candidates?.[0];
        const text = Array.isArray(cand?.content?.parts) ? cand.content.parts.map((p) => p.text ?? '').join('\n').trim() : '';
        if (!text)
            return { ok: false, reason: 'empty', message: 'Model returned no text.' };
        let parsed;
        try {
            let t = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
            const a = t.indexOf('{'), b = t.lastIndexOf('}');
            if (a >= 0 && b > a)
                t = t.slice(a, b + 1);
            parsed = JSON.parse(t);
        }
        catch {
            return { ok: false, reason: 'parse', message: `Could not parse JSON: ${text.slice(0, 140)}` };
        }
        const merge = Array.isArray(parsed?.merge) ? parsed.merge.filter((p) => Array.isArray(p) && p.length === 2) : [];
        const split = Array.isArray(parsed?.split)
            ? parsed.split.filter((s) => s && Number.isFinite(Number(s.shot)) && Number.isFinite(Number(s.at)))
                .map((s) => ({ shot: Number(s.shot), at: Number(s.at) }))
            : [];
        return { ok: true, merge, split };
    }
    catch (err) {
        const aborted = err?.name === 'AbortError';
        return { ok: false, reason: aborted ? 'timeout' : 'verify_failed', message: String(err?.message || err).slice(0, 300) };
    }
};
// Cuts — the mind WATCHES the ad. A compact copy of the video (low res/fps) is
// sent to a video-capable model (Gemini) together with the exact shot
// boundaries, and it groups shots by COMPREHENSION — tracking each person/story
// across the continuous footage. This is grouping by understanding, not by
// frame similarity: the model actually sees the ad move.
const watch = async (args) => {
    const { key } = providerAuth('google');
    if (!key)
        return { ok: false, reason: 'no_key', message: 'No Google API key set (Settings).' };
    const bin = resolveFfmpeg();
    if (!bin)
        return { ok: false, reason: 'no_ffmpeg', message: 'ffmpeg not found.' };
    if (!args.videoPath || !fs.existsSync(args.videoPath))
        return { ok: false, reason: 'no_video', message: 'Video not found.' };
    const model = args.model || 'gemini-flash-latest'; // video-capable, watches the ad end-to-end
    const dir = cutsSessionDir(args.projectSlug, args.sessionId);
    const small = path.join(dir, 'watch.mp4');
    // Transcode to a small clip; shrink further once if it's over the inline cap.
    const transcode = async (scale, fps, crf) => {
        await cutsRun(bin, ['-y', '-i', args.videoPath, '-an', '-vf',
            `scale='min(${scale},iw)':-2,fps=${fps}`, '-c:v', 'libx264', '-crf', String(crf),
            '-preset', 'veryfast', '-movflags', '+faststart', small], 300_000);
    };
    try {
        await transcode(480, 3, 30);
        let bytes = fs.existsSync(small) ? fs.statSync(small).size : 0;
        if (bytes > 18 * 1024 * 1024)
            await transcode(384, 2, 32);
        bytes = fs.existsSync(small) ? fs.statSync(small).size : 0;
        if (!bytes)
            return { ok: false, reason: 'transcode_failed', message: 'Could not prepare the video.' };
        if (bytes > 20 * 1024 * 1024)
            return { ok: false, reason: 'too_large', message: 'Ad too large to send inline.' };
        const b64 = fs.readFileSync(small).toString('base64');
        // Hybrid input: the VIDEO (continuity) + a numbered REFERENCE STILL per shot.
        // The stills remove the timecode-alignment ambiguity — the model reads each
        // shot's actual frame instead of guessing which timecode is which shot,
        // which is what caused wrong merges (a football shot landing in a soccer
        // group). The video lets it track a person across close-up ↔ wide.
        const N = args.shots.length;
        const system = `You are a film editor. You are given (1) the FULL ad video for continuity, and (2) one numbered REFERENCE STILL per shot. The stills tell you EXACTLY what each numbered shot shows — never guess a shot from its timecode; read its still. Divide the ad into SCENES: a scene is one physical PLACE and its people (identified by CLOTHING — colours, kit, number). A close-up of a person and the wide of the place where that same clothing appears are ONE scene. NEVER group two shots by shared colour, lighting, mood, or a merely similar sport — only by the SAME physical place AND the SAME people.`;
        const parts = [
            { text: system },
            { inline_data: { mime_type: 'video/mp4', data: b64 } },
            { text: `Reference stills, one per shot (1..${N}):` },
        ];
        for (const s of args.shots) {
            parts.push({ text: `Shot ${s.i} (${s.start.toFixed(1)}–${s.end.toFixed(1)}s):` });
            if (s.frame && fs.existsSync(s.frame)) {
                const ext = path.extname(s.frame).toLowerCase();
                const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
                parts.push({ inline_data: { mime_type: mime, data: fs.readFileSync(s.frame).toString('base64') } });
            }
        }
        parts.push({ text: `Now group ALL ${N} shots. Match each numbered still to what you saw in the video, reason about PLACE and PERSON (by clothing), and put together every shot that shares the same place and the same people — the establishing wide + the close-ups — even when far apart in the timeline or returning later. Return STRICT JSON only:\n{"groups":[{"label":"<place — who, concrete>","shots":[all shot numbers]}]}\nEvery shot number from 1 to ${N} in exactly one group.` });
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${key}`;
        const body = {
            contents: [{ role: 'user', parts }],
            // Force strict JSON (no fences) + headroom so a "thinking" model never truncates.
            generationConfig: { maxOutputTokens: 32000, temperature: 0.1, responseMimeType: 'application/json' },
        };
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 300_000);
        let data;
        try {
            const res = await providerFetch('google', url, { 'content-type': 'application/json' }, body, ac.signal);
            if (!res.ok) {
                const t = await res.text();
                return { ok: false, reason: 'api_error', message: `google ${res.status}: ${t.slice(0, 400)}` };
            }
            data = await res.json();
        }
        finally {
            clearTimeout(timer);
        }
        const cand = data?.candidates?.[0];
        const finish = cand?.finishReason;
        const text = Array.isArray(cand?.content?.parts) ? cand.content.parts.map((p) => p.text ?? '').join('\n').trim() : '';
        if (!text)
            return { ok: false, reason: 'empty', message: `Model returned no text${finish ? ` (finish: ${finish})` : ''}.` };
        let parsed;
        try {
            let t = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
            const a = t.indexOf('{'), b = t.lastIndexOf('}');
            if (a >= 0 && b > a)
                t = t.slice(a, b + 1);
            parsed = JSON.parse(t);
        }
        catch {
            const hint = finish === 'MAX_TOKENS' ? ' (response was truncated)' : '';
            return { ok: false, reason: 'parse', message: `Could not parse model JSON${hint}: ${text.slice(0, 160)}` };
        }
        const groups = Array.isArray(parsed?.groups) ? parsed.groups : [];
        return { ok: true, groups };
    }
    catch (err) {
        const aborted = err?.name === 'AbortError';
        return { ok: false, reason: aborted ? 'timeout' : 'watch_failed', message: String(err?.message || err).slice(0, 300) };
    }
};
// Cuts — PEOPLE layer. The mind watches the ad (continuity) + reads a numbered
// still per shot, then identifies the MAIN recurring characters and, for each,
// lists every shot they appear in with a description, build, expression and
// wardrobe. This is casting/continuity comprehension — a person is the SAME
// across shots by face + body + clothing, even across different places.
const people = async (args) => {
    const { key } = providerAuth('google');
    if (!key)
        return { ok: false, reason: 'no_key', message: 'No Google API key set (Settings).' };
    const bin = resolveFfmpeg();
    if (!bin)
        return { ok: false, reason: 'no_ffmpeg', message: 'ffmpeg not found.' };
    if (!args.videoPath || !fs.existsSync(args.videoPath))
        return { ok: false, reason: 'no_video', message: 'Video not found.' };
    const model = args.model || 'gemini-flash-latest';
    const dir = cutsSessionDir(args.projectSlug, args.sessionId);
    const small = path.join(dir, 'people.mp4');
    const transcode = async (scale, fps, crf) => {
        await cutsRun(bin, ['-y', '-i', args.videoPath, '-an', '-vf',
            `scale='min(${scale},iw)':-2,fps=${fps}`, '-c:v', 'libx264', '-crf', String(crf),
            '-preset', 'veryfast', '-movflags', '+faststart', small], 300_000);
    };
    try {
        await transcode(480, 3, 30);
        let bytes = fs.existsSync(small) ? fs.statSync(small).size : 0;
        if (bytes > 18 * 1024 * 1024)
            await transcode(384, 2, 32);
        bytes = fs.existsSync(small) ? fs.statSync(small).size : 0;
        if (!bytes)
            return { ok: false, reason: 'transcode_failed', message: 'Could not prepare the video.' };
        if (bytes > 20 * 1024 * 1024)
            return { ok: false, reason: 'too_large', message: 'Ad too large to send inline.' };
        const b64 = fs.readFileSync(small).toString('base64');
        const N = args.shots.length;
        const system = `You are a casting director and continuity supervisor. You are given (1) the FULL ad video for continuity, and (2) one numbered REFERENCE STILL per shot — the stills tell you EXACTLY what each numbered shot shows; never guess a shot from its timecode, read its still. Your job: identify EVERY distinct character in the ad. Be EXHAUSTIVE: sweep every shot and account for each identifiable person, whether they recur across many shots or appear in just ONE. A character is the SAME person across shots by FACE + BODY + CLOTHING continuity, even when the place changes, the framing changes (wide ↔ close-up), or they return later. The same person can appear in many shots; one shot can contain more than one character. Only skip anonymous background fill (a blurred face deep in a passing crowd) and shots with no person at all (product, scenery, text).`;
        const parts = [
            { text: system },
            { inline_data: { mime_type: 'video/mp4', data: b64 } },
            { text: `Reference stills, one per shot (1..${N}):` },
        ];
        for (const s of args.shots) {
            parts.push({ text: `Shot ${s.i} (${s.start.toFixed(1)}–${s.end.toFixed(1)}s):` });
            if (s.frame && fs.existsSync(s.frame)) {
                const ext = path.extname(s.frame).toLowerCase();
                const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
                parts.push({ inline_data: { mime_type: mime, data: fs.readFileSync(s.frame).toString('base64') } });
            }
        }
        parts.push({ text: `Now list EVERY character in the ad — including anyone who appears in only ONE shot. For EACH one, give: a short name/label (a real name if the ad identifies it, else a concrete descriptor like "the young runner"); ALL shots they appear in (by the numbered stills — check the whole ad, do not stop at the first few); and four descriptions. Return STRICT JSON only:\n{"people":[{"name":"<short label>","description":"<who they are and their role in the ad>","appearance":"<general build — age range, build, hair, skin, distinguishing features>","expression":"<general expression / emotional register across their shots>","wardrobe":"<clothing piece by piece — garments, colours, materials, kit numbers>","shots":[ALL shot numbers they appear in]}]}\nInclude EVERY identifiable person, ordered by how central they are (most central first). Do NOT invent people who are not clearly present. If the ad shows no people at all, return {"people":[]}.` });
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${key}`;
        const body = {
            contents: [{ role: 'user', parts }],
            generationConfig: { maxOutputTokens: 32000, temperature: 0.1, responseMimeType: 'application/json' },
        };
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 300_000);
        let data;
        try {
            const res = await providerFetch('google', url, { 'content-type': 'application/json' }, body, ac.signal);
            if (!res.ok) {
                const t = await res.text();
                return { ok: false, reason: 'api_error', message: `google ${res.status}: ${t.slice(0, 400)}` };
            }
            data = await res.json();
        }
        finally {
            clearTimeout(timer);
        }
        const cand = data?.candidates?.[0];
        const finish = cand?.finishReason;
        const text = Array.isArray(cand?.content?.parts) ? cand.content.parts.map((p) => p.text ?? '').join('\n').trim() : '';
        if (!text)
            return { ok: false, reason: 'empty', message: `Model returned no text${finish ? ` (finish: ${finish})` : ''}.` };
        let parsed;
        try {
            let t = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
            const a = t.indexOf('{'), b = t.lastIndexOf('}');
            if (a >= 0 && b > a)
                t = t.slice(a, b + 1);
            parsed = JSON.parse(t);
        }
        catch {
            const hint = finish === 'MAX_TOKENS' ? ' (response was truncated)' : '';
            return { ok: false, reason: 'parse', message: `Could not parse model JSON${hint}: ${text.slice(0, 160)}` };
        }
        const people = Array.isArray(parsed?.people) ? parsed.people : [];
        return { ok: true, people };
    }
    catch (err) {
        const aborted = err?.name === 'AbortError';
        return { ok: false, reason: aborted ? 'timeout' : 'people_failed', message: String(err?.message || err).slice(0, 300) };
    }
};
// Cuts — VERIFY GROUPS (QA layer). Re-examines each finished group by looking at
// its member shots' frames TOGETHER and flags any shot that does not belong. It
// re-extracts a FRESH, frame-accurate mid-shot still per member (never trusting
// the possibly-bled stored thumb), so it is reliable even on old sessions — and
// returns those frames so the UI shows exactly what the mind judged.
const verifyGroups = async (args) => {
    const { key } = providerAuth('google');
    if (!key)
        return { ok: false, reason: 'no_key', message: 'No Google API key set (Settings).' };
    const bin = resolveFfmpeg();
    if (!bin)
        return { ok: false, reason: 'no_ffmpeg', message: 'ffmpeg not found.' };
    if (!args.videoPath || !fs.existsSync(args.videoPath))
        return { ok: false, reason: 'no_video', message: 'Video not found.' };
    const model = args.model || 'gemini-flash-latest';
    const dir = cutsSessionDir(args.projectSlug, args.sessionId);
    const vdir = path.join(dir, 'verify');
    fs.mkdirSync(vdir, { recursive: true });
    const groups = (args.groups || []).filter(g => g.shots && g.shots.length >= 2); // singletons are trivially coherent
    if (!groups.length)
        return { ok: true, groups: [], frames: [] };
    try {
        // Re-extract up to THREE accurate frames per UNIQUE shot (30/50/70% inset
        // from the cut edges), so one bad/cropped/transition frame can't mislead the
        // judgement — verify sends no video, so multiple stills is its only depth.
        // Cache across groups; the MIDDLE frame is the one returned for display.
        const framesByShot = new Map(); // shot → [f30, f50, f70]
        const grab = async (sh) => {
            if (framesByShot.has(sh.i))
                return framesByShot.get(sh.i);
            const span = Math.max(0.05, sh.end - sh.start);
            const fracs = span < 0.6 ? [0.5] : [0.3, 0.5, 0.7]; // ultra-short shots → one frame
            const out = [];
            for (let k = 0; k < fracs.length; k++) {
                const t = Math.max(0, sh.start + span * fracs[k]);
                const fp = path.join(vdir, `v${String(sh.i).padStart(3, '0')}_${k}.jpg`);
                await cutsGrabFrame(bin, args.videoPath, t, "scale='min(448,iw)':-2", fp);
                if (fs.existsSync(fp))
                    out.push(fp);
            }
            framesByShot.set(sh.i, out);
            return out;
        };
        for (const g of groups)
            for (const sh of g.shots)
                await grab(sh);
        const system = args.kind === 'person'
            ? `You are an identity/continuity checker. Each GROUP claims to be ONE single character. Each member shot is shown as UP TO THREE stills sampled across its duration — judge the shot by ALL its frames together, never by a single frame that might be a cropped, blurred, or transition moment. Decide whether every shot shows the SAME person (same face, body, hair — clothing may change). Flag any shot whose person is clearly DIFFERENT from the group's majority. Read the frames literally; do not assume a shot belongs just because it is numbered into the group.`
            : `You are a scene/continuity checker. Each GROUP claims to be ONE physical place with the SAME people. Each member shot is shown as UP TO THREE stills sampled across its duration — judge the shot by ALL its frames together, never by a single frame that might be a cropped, blurred, or transition moment. Decide whether every shot is the same location and the same people. Flag any shot that is a DIFFERENT place, or clearly different people. Read the frames literally; do not assume a shot belongs just because it is numbered into the group.`;
        const parts = [{ text: system }];
        for (const g of groups) {
            parts.push({ text: `\nGROUP ${g.id} «${g.label}» — member shots:` });
            for (const sh of g.shots) {
                const fps = framesByShot.get(sh.i) || [];
                parts.push({ text: `shot ${sh.i} (${fps.length} frame${fps.length > 1 ? 's' : ''}):` });
                for (const fp of fps)
                    if (fs.existsSync(fp))
                        parts.push({ inline_data: { mime_type: 'image/jpeg', data: fs.readFileSync(fp).toString('base64') } });
            }
        }
        parts.push({ text: `\nFor EACH group return whether it is coherent and list any shots that do not belong, with a confidence 0..1 and a short reason. Return STRICT JSON only:\n{"groups":[{"id":"<group id>","coherent":true|false,"outliers":[{"shot":<n>,"confidence":<0..1>,"reason":"<why it does not belong>"}]}]}\nA group with no outliers is coherent:true, outliers:[].` });
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${key}`;
        const body = { contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: 32000, temperature: 0.1, responseMimeType: 'application/json' } };
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 300_000);
        let data;
        try {
            const res = await providerFetch('google', url, { 'content-type': 'application/json' }, body, ac.signal);
            if (!res.ok) {
                const t = await res.text();
                return { ok: false, reason: 'api_error', message: `google ${res.status}: ${t.slice(0, 400)}` };
            }
            data = await res.json();
        }
        finally {
            clearTimeout(timer);
        }
        const cand = data?.candidates?.[0];
        const finish = cand?.finishReason;
        const text = Array.isArray(cand?.content?.parts) ? cand.content.parts.map((p) => p.text ?? '').join('\n').trim() : '';
        if (!text)
            return { ok: false, reason: 'empty', message: `Model returned no text${finish ? ` (finish: ${finish})` : ''}.` };
        let parsed;
        try {
            let t = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
            const a = t.indexOf('{'), b = t.lastIndexOf('}');
            if (a >= 0 && b > a)
                t = t.slice(a, b + 1);
            parsed = JSON.parse(t);
        }
        catch {
            const hint = finish === 'MAX_TOKENS' ? ' (response was truncated)' : '';
            return { ok: false, reason: 'parse', message: `Could not parse model JSON${hint}: ${text.slice(0, 160)}` };
        }
        const outGroups = Array.isArray(parsed?.groups) ? parsed.groups : [];
        // Return the MIDDLE frame per shot for the UI (representative still).
        const frames = [...framesByShot.entries()]
            .map(([shot, fps]) => ({ shot, path: fps[Math.floor(fps.length / 2)] || fps[0] || '' }))
            .filter(f => f.path);
        return { ok: true, groups: outGroups, frames };
    }
    catch (err) {
        const aborted = err?.name === 'AbortError';
        return { ok: false, reason: aborted ? 'timeout' : 'verify_failed', message: String(err?.message || err).slice(0, 300) };
    }
};
// Cuts — Phase 0 · read the ad's shared LOOK (DNA). One video pass returns the
// campaign's cinematographic fingerprint, injected into every master prompt.
const dna = async (args) => {
    const { key } = providerAuth('google');
    if (!key)
        return { ok: false, reason: 'no_key', message: 'No Google API key set (Settings).' };
    const bin = resolveFfmpeg();
    if (!bin)
        return { ok: false, reason: 'no_ffmpeg', message: 'ffmpeg not found.' };
    if (!args.videoPath || !fs.existsSync(args.videoPath))
        return { ok: false, reason: 'no_video', message: 'Video not found.' };
    const model = args.model || 'gemini-flash-latest';
    const dir = cutsSessionDir(args.projectSlug, args.sessionId);
    const small = path.join(dir, 'watch.mp4');
    try {
        if (!fs.existsSync(small)) {
            await cutsRun(bin, ['-y', '-i', args.videoPath, '-an', '-vf', "scale='min(480,iw)':-2,fps=3",
                '-c:v', 'libx264', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', small], 300_000);
        }
        if (!fs.existsSync(small))
            return { ok: false, reason: 'transcode_failed', message: 'Could not prepare the video.' };
        const b64 = fs.readFileSync(small).toString('base64');
        const system = `You are a master cinematographer and colorist reverse-reading a finished advertisement to recover its exact VISUAL LOOK — so it can be reproduced from words alone, with NO reference images. Watch the whole ad. Read the optics, the grade, the light logic, the texture. Be concrete and technical (name focal-length character, film stock or digital grade, color temperature bias, contrast curve, grain). This DNA will be pasted at the top of every single shot's generation prompt, so it must be precise and self-consistent.`;
        const parts = [
            { text: system },
            { inline_data: { mime_type: 'video/mp4', data: b64 } },
            { text: `Return STRICT JSON only:\n{"intent":"<one line: what this ad is doing emotionally>","look":"<2-3 sentence prose look block a DP could light from>","palette":"<dominant tones + accent placement>","film":"<stock/grade/texture, e.g. Kodak 500T look, halation, filmic highlight rolloff>","lighting":"<light logic: quality, direction, contrast>","lens":"<lens & optics language: focal lengths, depth, distortion, bokeh>","era":"<period the look evokes>","mood":"<emotional register>","grain":"<grain/texture/noise character>","aspect":"<aspect ratio + framing habit>"}` },
        ];
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${key}`;
        const body = { contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: 8000, temperature: 0.2, responseMimeType: 'application/json' } };
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 300_000);
        let data;
        try {
            const res = await providerFetch('google', url, { 'content-type': 'application/json' }, body, ac.signal);
            if (!res.ok) {
                const t = await res.text();
                return { ok: false, reason: 'api_error', message: `google ${res.status}: ${t.slice(0, 300)}` };
            }
            data = await res.json();
        }
        finally {
            clearTimeout(timer);
        }
        const cand = data?.candidates?.[0];
        const text = Array.isArray(cand?.content?.parts) ? cand.content.parts.map((p) => p.text ?? '').join('\n').trim() : '';
        if (!text)
            return { ok: false, reason: 'empty', message: 'Model returned no text.' };
        let dna;
        try {
            let t = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
            const a = t.indexOf('{'), b = t.lastIndexOf('}');
            if (a >= 0 && b > a)
                t = t.slice(a, b + 1);
            dna = JSON.parse(t);
        }
        catch {
            return { ok: false, reason: 'parse', message: `Could not parse JSON: ${text.slice(0, 140)}` };
        }
        return { ok: true, dna };
    }
    catch (err) {
        const aborted = err?.name === 'AbortError';
        return { ok: false, reason: aborted ? 'timeout' : 'dna_failed', message: String(err?.message || err).slice(0, 300) };
    }
};
// Cuts — COMPREHEND the whole ad (the wide eye on the world). One video pass
// returns the narrative, the assembled environment, the cross-shot continuity,
// and a per-shot context note — knowledge later injected into every master
// prompt (and available to future cut/group stages).
const story = async (args) => {
    const { key } = providerAuth('google');
    if (!key)
        return { ok: false, reason: 'no_key', message: 'No Google API key set (Settings).' };
    const bin = resolveFfmpeg();
    if (!bin)
        return { ok: false, reason: 'no_ffmpeg', message: 'ffmpeg not found.' };
    if (!args.videoPath || !fs.existsSync(args.videoPath))
        return { ok: false, reason: 'no_video', message: 'Video not found.' };
    const model = args.model || 'gemini-flash-latest';
    const dir = cutsSessionDir(args.projectSlug, args.sessionId);
    const small = path.join(dir, 'watch.mp4');
    try {
        if (!fs.existsSync(small)) {
            await cutsRun(bin, ['-y', '-i', args.videoPath, '-an', '-vf', "scale='min(480,iw)':-2,fps=3",
                '-c:v', 'libx264', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', small], 300_000);
        }
        if (!fs.existsSync(small))
            return { ok: false, reason: 'transcode_failed', message: 'Could not prepare the video.' };
        const b64 = fs.readFileSync(small).toString('base64');
        const shotList = (args.shots || []).map(s => `Shot ${s.i}: ${s.start.toFixed(2)}–${s.end.toFixed(2)}s`).join('\n');
        const system = `You are the comprehension mind of a film-analysis system. You WATCH a whole advertisement end to end and build a complete understanding of its WORLD before anything is described in isolation: the narrative and events beat by beat; the full physical environment assembled from EVERY shot (a later shot often reveals the surroundings an earlier close shot could not); and the CONTINUITY that carries between shots — a subject's orientation, facing, direction of travel, and state established by an adjacent shot that a single shot's frames cannot show alone. Reason across the whole timeline, then report.`;
        const parts = [
            { text: system },
            { inline_data: { mime_type: 'video/mp4', data: b64 } },
            { text: `The detected shots (by time):\n${shotList}\n\nReturn STRICT JSON only:\n{"synopsis":"<the ad's story/events, beat by beat>","world":"<the full place/environment assembled from ALL shots — geography, architecture, what surrounds the action even when a given shot only shows part of it>","continuity":"<cross-shot facts: who is who, spatial layout, and each subject's ORIENTATION and FACE DIRECTION (facing up / down / toward camera) and direction of travel and state as they carry between shots. Be explicit about facing — e.g. a backward fall means the face/front is toward the sky/camera while the back leads downward. ALSO give the SPATIAL TRAJECTORY with physical logic: where the subject is relative to key landmarks at each stage (e.g. just launched from the platform → still CLOSE to it; mid-fall → farther; entry → at the water). A subject cannot be floating far from the point it just left.>","shots":[{"i":<shot number>,"context":"<this shot's role in the sequence + the facts an adjacent shot establishes about it (e.g. the subject's facing/direction was set up by the previous shot; the surroundings are the ones revealed in another shot)>"}]}\nInclude every shot number in "shots".` },
        ];
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${key}`;
        const body = { contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: 32000, temperature: 0.2, responseMimeType: 'application/json' } };
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 300_000);
        let data;
        try {
            const res = await providerFetch('google', url, { 'content-type': 'application/json' }, body, ac.signal);
            if (!res.ok) {
                const t = await res.text();
                return { ok: false, reason: 'api_error', message: `google ${res.status}: ${t.slice(0, 300)}` };
            }
            data = await res.json();
        }
        finally {
            clearTimeout(timer);
        }
        const cand = data?.candidates?.[0];
        const finish = cand?.finishReason;
        const text = Array.isArray(cand?.content?.parts) ? cand.content.parts.map((p) => p.text ?? '').join('\n').trim() : '';
        if (!text)
            return { ok: false, reason: 'empty', message: `Model returned no text${finish ? ` (finish: ${finish})` : ''}.` };
        let parsed;
        try {
            let t = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
            const a = t.indexOf('{'), b = t.lastIndexOf('}');
            if (a >= 0 && b > a)
                t = t.slice(a, b + 1);
            parsed = JSON.parse(t);
        }
        catch {
            const hint = finish === 'MAX_TOKENS' ? ' (response was truncated)' : '';
            return { ok: false, reason: 'parse', message: `Could not parse JSON${hint}: ${text.slice(0, 140)}` };
        }
        return { ok: true, synopsis: parsed?.synopsis || '', world: parsed?.world || '', continuity: parsed?.continuity || '', shots: Array.isArray(parsed?.shots) ? parsed.shots : [] };
    }
    catch (err) {
        const aborted = err?.name === 'AbortError';
        return { ok: false, reason: aborted ? 'timeout' : 'story_failed', message: String(err?.message || err).slice(0, 300) };
    }
};
// Cuts — Phase 2/3 · deep description + MASTER PROMPT for one shot. Uses THREE
// accurate frames of the shot + the ad DNA + the entity canon (so wardrobe /
// appearance stay consistent across shots). NO reference images are used — the
// prompt must carry everything in words. Faithful to the source, top-tier craft.
const brief = async (args) => {
    const { key } = providerAuth('google');
    if (!key)
        return { ok: false, reason: 'no_key', message: 'No Google API key set (Settings).' };
    const bin = resolveFfmpeg();
    if (!bin)
        return { ok: false, reason: 'no_ffmpeg', message: 'ffmpeg not found.' };
    if (!args.videoPath || !fs.existsSync(args.videoPath))
        return { ok: false, reason: 'no_video', message: 'Video not found.' };
    const model = args.model || 'gemini-flash-latest';
    const dir = cutsSessionDir(args.projectSlug, args.sessionId);
    const bdir = path.join(dir, 'brief');
    fs.mkdirSync(bdir, { recursive: true });
    const sh = args.shot;
    try {
        // DENSE, time-ordered sampling — enough frames to read the ACTION ARC of a
        // moving shot (launch → mid-air → entry), always including the very first and
        // last frame. A single mid-frame cannot describe a jump/dive/whip.
        const span = Math.max(0.05, sh.end - sh.start);
        const n = span < 0.5 ? 1 : span < 1.2 ? 4 : span < 2.5 ? 6 : 8;
        const fracs = n === 1 ? [0.5] : Array.from({ length: n }, (_, k) => 0.04 + 0.92 * (k / (n - 1)));
        const frames = [];
        for (let k = 0; k < fracs.length; k++) {
            const t = Math.max(0, sh.start + span * fracs[k]);
            const fp = path.join(bdir, `b${String(sh.i).padStart(3, '0')}_${k}.jpg`);
            await cutsGrabFrame(bin, args.videoPath, t, "scale='min(768,iw)':-2", fp);
            if (fs.existsSync(fp))
                frames.push(fp);
        }
        if (!frames.length)
            return { ok: false, reason: 'no_frames', message: 'Could not extract frames.' };
        // The single frame the MASTER PROMPT must reproduce. Prefer the chosen
        // keyframe; else the middle sampled frame. The other frames are CONTEXT only.
        let repPath = '';
        if (args.keyframe && fs.existsSync(args.keyframe))
            repPath = args.keyframe;
        else
            repPath = frames[Math.floor(frames.length / 2)];
        const dna = args.dna || {};
        const dnaBlock = Object.keys(dna).length
            ? `AD LOOK / DNA (reproduce this grade and optics exactly — it is shared by every shot):\n${['intent', 'look', 'palette', 'film', 'lighting', 'lens', 'era', 'mood', 'grain'].map(k => dna[k] ? `- ${k}: ${dna[k]}` : '').filter(Boolean).join('\n')}`
            : 'AD LOOK / DNA: (not provided — infer a consistent look from the frames).';
        const canonBlock = (args.canon || '').trim()
            ? `KNOWN ENTITIES IN THIS SHOT (describe them with THESE exact traits for consistency — do not re-invent their look or wardrobe):\n${args.canon}`
            : 'KNOWN ENTITIES: (none catalogued — describe what you see).';
        const st = args.story || {};
        const storyBlock = (st.synopsis || st.world || st.continuity || (args.context || '').trim())
            ? `AD COMPREHENSION — you have effectively watched the WHOLE ad. This knowledge is AUTHORITATIVE for the subject's ORIENTATION, FACING (up / down / toward camera), DIRECTION of travel, the nature of the action, and off-frame SURROUNDINGS. A single low-resolution still very often MISREADS these (a backward or rotating fall can look head-down in one frame yet the body is really back-leading with the face toward the sky/camera). When your literal reading of this shot's frames CONFLICTS with the comprehension on orientation/facing/direction, DEFER to the comprehension and describe the facing it implies — do NOT default to a generic head-down / face-down read.\n${st.synopsis ? `- Story: ${st.synopsis}\n` : ''}${st.world ? `- World/environment: ${st.world}\n` : ''}${st.continuity ? `- Continuity: ${st.continuity}\n` : ''}${(args.context || '').trim() ? `- THIS shot's role: ${args.context}\n` : ''}${(args.neighbours || '').trim() ? `- Neighbouring shots:\n${args.neighbours}\n` : ''}`
            : '';
        // WRITING METHOD (general, case-independent):
        // - Describe ONE still — the REPRESENTATIVE frame — exactly as it appears.
        //   The context frames only help read lighting/geometry; never narrate the
        //   motion arc, and never describe a pose/moment that is not in that still.
        // - Nail the camera's true geometry: is the lens axis PERPENDICULAR to the
        //   subject/ground (straight-on, or a true top-down where the scene reads
        //   flat), or is it a RAKED/oblique angle (high or low, where the ground and
        //   background visibly recede and the subject reads upright)? This one call
        //   decides the whole composition — get it exactly right.
        // - Bake the exact colour temperature and grade INTO the master prompt.
        const system = `You are a world-class cinematographer, stylist and prompt engineer. You are given several CONTEXT frames of one shot in time order, and then ONE REPRESENTATIVE FRAME (the last image). Your entire job is to describe the REPRESENTATIVE FRAME as a single still and compile ONE MASTER PROMPT that a top image model can render — from TEXT ALONE, no reference image — to reproduce THAT still faithfully. The context frames exist only to help you read the lighting and geometry; do NOT narrate motion, a sequence, or any pose/moment that is not present in the representative still.

Determine and state precisely, from what is actually visible (put conclusions in the fields, not your reasoning):
1. CAMERA GEOMETRY — the true angle of the lens axis. Decide clearly whether it is PERPENDICULAR (straight-on to the subject, or a true top-down where the scene reads flat with no receding ground) or a RAKED/OBLIQUE angle (high or low, where floor/background recede and the subject reads upright). State the height relative to the subject, the shot size, and the lens character. Also state WHICH PART OF THE SUBJECT is in frame and WHERE THE FRAME CROPS it, and which way the subject faces the lens. Getting this geometry exactly right is the single most important task.
2. SCALE & COMPOSITION — how BIG the subject is in the frame (estimate the fraction of frame height it occupies) and how much NEGATIVE SPACE surrounds it, plus WHERE in the frame it sits. A distant subject small against a vast background must be described as small with deep negative space — never centred and large by default. This is as important as the geometry: wrong scale ruins the composition.
3. DIRECTION & PLACEMENT (with PHYSICAL LOGIC) — which way the subject POINTS and TRAVELS (the head/motion vector) and its position RELATIVE TO NAMED SET LANDMARKS. Ground the placement in PHYSICS and the shot's stage in the action (from the AD COMPREHENSION): a subject that just left a launch point (platform, edge, ground) is still CLOSE to it — it cannot be floating far away in empty space so soon after. Use the comprehension's spatial trajectory to set how NEAR/FAR the subject is from the landmark, and state left/right explicitly and do not let them flip. A bare quadrant is not enough, and never place the subject implausibly far from the point it just came from.
4. POSE — the EXACT position of every limb AND its tightness: where each arm and hand are (overhead / pinned tight to the body / spread wide / reaching) and whether the limbs are STREAMLINED-TIGHT or OPEN/SPREAD; whether the motion is HEAD-LEADING or FEET-LEADING; the head direction; the legs. State the body-line's inclination as an ACTUAL ANGLE IN DEGREES FROM HORIZONTAL (e.g. ~30° = shallow, ~90° = vertical) — measure it from the frame, and be FAITHFUL: do not dramatise a shallow line into a vertical plunge or flatten a steep one. A generative model exaggerates toward its generic version of the action, so give the real number and hold it.
5. LIGHT — every source, its direction, quality and colour temperature, and exactly how light falls across the subject (highlights, shadows, rim) and any reflections.
6. COLOUR, GRADE & ATMOSPHERE — the actual palette and the grade's colour-temperature bias (warm/cool/neutral), the SATURATION LEVEL (muted/desaturated vs vivid — describe the TRUE colours even when they are dull; never idealise a muted colour into a vivid one), the CONTRAST (low/normal/high), and any ATMOSPHERE in the air (haze, mist, diffusion, depth). These carry the look as much as hue does.
Do NOT mention or specify any aspect ratio anywhere — the user controls framing/aspect separately.
Be literal. Never generic ("well-lit", "cinematic", "dynamic") — name the actual geometry, scale, direction, pose, light, and the true (often muted) colours.`;
        const parts = [
            { text: system },
            { text: `Shot ${sh.i}. CONTEXT frames (for reading light/geometry only — do NOT describe these as a sequence):` },
        ];
        for (const fp of frames)
            parts.push({ inline_data: { mime_type: 'image/jpeg', data: fs.readFileSync(fp).toString('base64') } });
        parts.push({ text: `REPRESENTATIVE FRAME — describe and write the master prompt for THIS still only:` });
        parts.push({ inline_data: { mime_type: 'image/jpeg', data: fs.readFileSync(repPath).toString('base64') } });
        parts.push({ text: `${storyBlock}${storyBlock ? '\n' : ''}${dnaBlock}\n\n${canonBlock}\n\nReturn STRICT JSON only (all describing the REPRESENTATIVE still):\n{"subject":"<the subject frozen in this still with LIMB-PRECISE pose: exact position of each arm and hand (overhead/at sides/reaching, leading or trailing), head direction, legs, body line and orientation; micro-expression; and the FACE/BODY ORIENTATION derived from the AD COMPREHENSION (facing up / down / toward camera; which side leads the movement) — this orientation follows the comprehension's action, not a possibly-misread single frame>","wardrobe":"<every garment piece-by-piece: type + material + colour + condition; use catalogued traits for known entities>","blocking":"<SCALE: how big the subject is (approx fraction of frame height) + amount of negative space + WHERE in the frame it sits; DIRECTION the subject points/travels (head/motion vector, state left/right explicitly) + its position RELATIVE TO named set landmarks with PHYSICAL PROXIMITY (near / just below / far — grounded in the action stage, e.g. still close to the platform it just left); distance to lens, angle to camera; which part of the subject is framed + where the frame crops it>","light":"<every source: key/fill/rim/practical/ambient — direction, quality, colour temperature; and exactly HOW light falls across the subject (highlights, shadows, rim) + reflections>","camera":{"shotSize":"<ECU/CU/MCU/MS/MLS/WS/EWS>","lens":"<focal length + optical character>","angle":"<PERPENDICULAR (straight-on / true top-down, scene reads flat) OR RAKED (high/low oblique, ground recedes) — say which, with the precise angle>","height":"<camera height vs subject>","movement":"<static/pan/tilt/dolly/track/handheld/crane; note if the still shows motion blur>","dof":"<depth of field + where focus sits>"},"colour":"<the ACTUAL palette (describe true colours even if muted — never idealise to vivid): grade colour-temperature bias (warm/cool/neutral), SATURATION level (desaturated/muted vs vivid), CONTRAST (low/normal/high), and ATMOSPHERE (haze/mist/diffusion/air); skin, wardrobe, environment colours>","frameFurniture":"<foreground / mid-ground / background plates, concrete objects>","time":"<time of day, light state, weather, operational state>","mood":"<emotional register>","inside":"<one sentence: what is happening inside the subject in this still>","prompt":"<the MASTER PROMPT: one dense paragraph that reproduces THIS still — lead with the exact camera geometry (perpendicular vs raked) + shot size + SUBJECT SCALE-IN-FRAME and negative space + the DIRECTION the subject points/travels (state left/right) and its placement relative to set landmarks WITH physical proximity (e.g. close to the platform it just left, not floating far in empty space) + crop, then the limb-precise pose, wardrobe, the light on the subject, and the full palette with SATURATION + CONTRAST + ATMOSPHERE and the grade's colour temperature baked in (true muted colours, not idealised), and the AD LOOK. Include the body-line's actual angle in degrees from horizontal, and match it faithfully (neither flattened nor exaggerated to vertical). If the pose is a specific tight athletic form a model would render as a generic 'graceful' version, END the prompt with ONE short negative clause ruling out the WRONG direction of drift (e.g. for a shallow line: 'a shallow ~30° diagonal, not a vertical plunge'; for a tight form: 'limbs tight to the body, not spread'). A single top-tier text-to-image prompt, no reference image. Do NOT mention any aspect ratio>"}` });
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${key}`;
        const body = { contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: 8000, temperature: 0.3, responseMimeType: 'application/json' } };
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 180_000);
        let data;
        try {
            const res = await providerFetch('google', url, { 'content-type': 'application/json' }, body, ac.signal);
            if (!res.ok) {
                const t = await res.text();
                return { ok: false, reason: 'api_error', message: `google ${res.status}: ${t.slice(0, 300)}` };
            }
            data = await res.json();
        }
        finally {
            clearTimeout(timer);
        }
        const cand = data?.candidates?.[0];
        const text = Array.isArray(cand?.content?.parts) ? cand.content.parts.map((p) => p.text ?? '').join('\n').trim() : '';
        if (!text)
            return { ok: false, reason: 'empty', message: 'Model returned no text.' };
        let brief;
        try {
            let t = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
            const a = t.indexOf('{'), b = t.lastIndexOf('}');
            if (a >= 0 && b > a)
                t = t.slice(a, b + 1);
            brief = JSON.parse(t);
        }
        catch {
            return { ok: false, reason: 'parse', message: `Could not parse JSON: ${text.slice(0, 140)}` };
        }
        return { ok: true, brief };
    }
    catch (err) {
        const aborted = err?.name === 'AbortError';
        return { ok: false, reason: aborted ? 'timeout' : 'brief_failed', message: String(err?.message || err).slice(0, 300) };
    }
};
// Cuts sessions — persist/reopen a cut session (shots + scenes + keyframes +
// manual edits). Stored as session.json beside its frames under Cuts/<id>/.
const source = (args) => {
    try {
        const p = args?.videoPath || '';
        if (!p || !p.includes(`${path.sep}_fetch${path.sep}`))
            return { ok: true, url: '' };
        const dir = path.dirname(p);
        if (!fs.existsSync(dir))
            return { ok: true, url: '' };
        const info = fs.readdirSync(dir).find(f => f.endsWith('.info.json'));
        if (!info)
            return { ok: true, url: '' };
        const j = JSON.parse(fs.readFileSync(path.join(dir, info), 'utf-8'));
        const url = j.webpage_url || j.original_url || j.url || '';
        return { ok: true, url: /^https?:\/\//i.test(url) ? url : '' };
    }
    catch (err) {
        return { ok: false, url: '', message: err?.message || String(err) };
    }
};
// Does a source video actually CARRY an audio stream? A YouTube fetch can arrive
// video-only, or a made clip can be silent — either way the monitor would be
// silent through no UI fault. The renderer surfaces this on the SOURCE ♪ lane so
// "no sound" reads as "the source has no audio", not "audio is broken".
// ffmpeg -i prints stream info to stderr; an audio stream shows as "Stream …: Audio:".
const hasAudio = async (args) => {
    try {
        const p = args?.videoPath || '';
        if (!p || !fs.existsSync(p))
            return { ok: false, hasAudio: null, reason: 'no_file' };
        const r = await cutsRun(bdFfmpeg(), ['-hide_banner', '-i', p], 30_000);
        // ffmpeg exits non-zero with "-i" and no output, but always dumps the stream map.
        const hasAudio = /Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?: Audio:/.test(r.stderr);
        return { ok: true, hasAudio };
    }
    catch (err) {
        return { ok: false, hasAudio: null, message: err?.message || String(err) };
    }
};

  // ── path → token ────────────────────────────────────────────────────────
  // The ported bodies hand back ABSOLUTE server paths (a shot thumb, a filmstrip
  // frame, a candidate). A browser cannot read those, and shipping them would
  // also disclose the server's layout. Every path that leaves this module is
  // rewritten to `cloudcuts://<sessionId>/<rel>`, the same synthetic-token grammar
  // /api/file already resolves for cloudgen:// and cloudlib://. Paths coming IN
  // are translated back, so a second call finds the file it was given.
  const tokenize = (sessionId, abs) => {
    if (!abs || typeof abs !== 'string') return abs;
    const base = cloud.cutsDir(acc, sessionId);
    if (!abs.startsWith(base)) return abs;
    const rel = abs.slice(base.length).replace(/^[/\\]+/, '').replace(/\\/g, '/');
    return `cloudcuts://${encodeURIComponent(String(sessionId))}/${rel}`;
  };
  const mapPaths = (sessionId, value) => {
    if (Array.isArray(value)) return value.map((v) => mapPaths(sessionId, v));
    if (value && typeof value === 'object') {
      const out = {};
      for (const k of Object.keys(value)) {
        // `dir` is the working area itself — never a file the client can fetch.
        out[k] = k === 'dir' ? undefined : mapPaths(sessionId, value[k]);
      }
      return out;
    }
    return typeof value === 'string' ? tokenize(sessionId, value) : value;
  };

  /** Resolve an incoming videoPath: a cloudcuts:// token, or the session's own
   *  uploaded source when the client sends nothing usable. */
  const resolveVideo = (args) => {
    const sessionId = String(args?.sessionId || '');
    const given = String(args?.videoPath || '');
    const m = given.match(/^cloudcuts:\/\/([^/]+)\/(.+)$/);
    if (m) return path.join(cloud.cutsDir(acc, decodeURIComponent(m[1])), m[2]);
    if (given && given.startsWith('/')) return given;          // already absolute
    if (!sessionId) return given;
    // Fall back to whatever this session ingested.
    const dir = cloud.cutsDir(acc, sessionId);
    try {
      const f = fs.readdirSync(dir).find((x) => /^source\./.test(x));
      if (f) return path.join(dir, f);
    } catch { /* none */ }
    return given;
  };

  /** Wrap a door: translate paths in, tokens out. */
  const door = (fn) => async (args) => {
    const a = { ...(args || {}) };
    if (a.videoPath !== undefined) a.videoPath = resolveVideo(a);
    const r = await fn(a);
    return mapPaths(String(a.sessionId || ''), r);
  };

  return {
    analyze: door(analyze), shotFrames: door(shotFrames), fetchUrl: door(fetchUrl),
    embed, speech: door(speech), verify: door(verify), watch: door(watch),
    people: door(people), verifyGroups: door(verifyGroups), dna: door(dna),
    story: door(story), brief: door(brief), source: door(source), hasAudio: door(hasAudio),
  };
}
