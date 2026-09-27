// Breakdown — SERVER-SIDE video ingest (Phase 1). Faithful port of the desktop
// ffmpeg pipeline (app/electron/main.ts: bdExtractFrames / bdDetectCuts /
// bdBuildShots / bdProbeDuration). Takes a video file already on disk and
// produces: analysis frames (scene-cut ∪ 1fps, capped), ~640px thumbs, real shot
// intervals from detected cuts, and a mono AAC audio track. No local ML and no
// yt-dlp here — upload-only ingest; URL fetch + ASR are later batches (§5.2).
//
// LAW: the recipe stays on the server. This module is pure ffmpeg orchestration
// (no prompts), but it lives here so the whole video pipeline runs server-side.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Static ffmpeg on the box (johnvansickle build). Fall back to PATH.
const FFMPEG = (() => {
  for (const p of ['/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/bin/ffmpeg']) {
    try { if (fs.existsSync(p)) return p; } catch { /* keep looking */ }
  }
  return 'ffmpeg';
})();
const MAX_FRAMES = 120;

function runCmd(bin, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: String(e && e.message || e) }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code == null ? -1 : code, stdout, stderr }); });
  });
}

function probeDuration(video) {
  return runCmd(FFMPEG, ['-hide_banner', '-i', video], 30_000).then((p) => {
    const m = /Duration: (\d+):(\d+):(\d+\.?\d*)/.exec(p.stderr || '');
    if (!m) return null;
    return Math.round((parseFloat(m[1]) * 3600 + parseFloat(m[2]) * 60 + parseFloat(m[3])) * 10) / 10;
  });
}

// scene-cut ∪ 1fps interval, merged by time (dedupe < 0.4s), capped by even thinning.
async function extractFrames(video, duration, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) { if (/\.jpg$/.test(f)) fs.rmSync(path.join(outDir, f)); }
  const scale = "scale='min(1280,iw)':-2";
  const pull = async (select, prefix) => {
    const vf = `${select},showinfo,${scale}`;
    const p = await runCmd(FFMPEG, ['-y', '-i', video, '-vf', vf, '-vsync', 'vfr',
      '-frames:v', '240', '-q:v', '3', path.join(outDir, `${prefix}%03d.jpg`)], 300_000);
    const times = [...(p.stderr || '').matchAll(/pts_time:(\d+\.?\d*)/g)].map((m) => parseFloat(m[1]));
    const got = fs.readdirSync(outDir).filter((f) => f.startsWith(prefix) && f.endsWith('.jpg')).sort();
    return got.map((f, i) => ({ file: path.join(outDir, f), t: times[i] == null ? i : times[i] }));
  };
  const scene = await pull("select='gt(scene,0.25)'", 's');
  const interval = await pull(duration === null ? "select='not(mod(n\\,25))'" : 'fps=1', 'i');
  const merged = [];
  for (const it of [...scene, ...interval].sort((a, b) => a.t - b.t)) {
    if (merged.length && Math.abs(it.t - merged[merged.length - 1].t) < 0.4) continue;
    merged.push(it);
  }
  let kept = merged;
  if (kept.length > MAX_FRAMES) {
    const step = kept.length / MAX_FRAMES;
    kept = Array.from({ length: MAX_FRAMES }, (_v, i) => merged[Math.min(merged.length - 1, Math.floor(i * step))]);
  }
  const out = [];
  kept.forEach((it, n) => {
    const id = `f${String(n + 1).padStart(3, '0')}`;
    const tmp = path.join(outDir, `_keep_${id}.jpg`);
    fs.copyFileSync(it.file, tmp);
    out.push({ id, rel: `frames/${id}.jpg`, abs: path.join(outDir, `${id}.jpg`), t: Math.round(it.t * 100) / 100 });
  });
  for (const f of fs.readdirSync(outDir)) { if (/^[si]\d+\.jpg$/.test(f)) fs.rmSync(path.join(outDir, f)); }
  for (const fr of out) fs.renameSync(path.join(outDir, `_keep_${fr.id}.jpg`), fr.abs);
  return out;
}

// Real shot-boundary detection — cut list (pts_time of every hard cut).
async function detectCuts(video, duration) {
  const p = await runCmd(FFMPEG,
    ['-hide_banner', '-i', video, '-filter:v', "select='gt(scene,0.3)',showinfo", '-an', '-f', 'null', '-'], 300_000);
  const times = [...(p.stderr || '').matchAll(/pts_time:(\d+\.?\d*)/g)].map((m) => parseFloat(m[1])).filter((t) => Number.isFinite(t));
  const dur = duration == null ? Infinity : duration;
  const cuts = [];
  for (const t of times.sort((a, b) => a - b)) {
    if (t <= 0.2 || t >= dur - 0.15) continue;
    if (cuts.length && t - cuts[cuts.length - 1] < 0.25) continue;
    cuts.push(Math.round(t * 100) / 100);
  }
  return cuts;
}

// shot i = [cut[i-1], cut[i]]; carries the frames whose t falls inside; slivers fold back.
function buildShots(cuts, duration, frames) {
  const dur = duration == null ? (frames.length ? frames[frames.length - 1].t + 1 : 0) : duration;
  const bounds = [0, ...cuts, dur].filter((v, i, a) => i === 0 || v > a[i - 1]);
  const raw = [];
  for (let i = 0; i < bounds.length - 1; i++) raw.push({ tcIn: bounds[i], tcOut: bounds[i + 1] });
  const merged = [];
  for (const s of raw) {
    if (merged.length && s.tcOut - s.tcIn < 0.35) { merged[merged.length - 1].tcOut = s.tcOut; continue; }
    merged.push({ ...s });
  }
  return merged.map((s, i) => ({
    no: i + 1, tcIn: s.tcIn, tcOut: s.tcOut,
    frameIds: frames.filter((f) => f.t >= s.tcIn - 0.05 && f.t < s.tcOut + 0.05).map((f) => f.id),
  }));
}

/**
 * Ingest a video already on disk. Produces frames + ~640px thumbs + mono audio +
 * shot intervals under `dir`. Returns a manifest the client renders and the run
 * orchestration (Phase 2) consumes. Pure server-side; no charge (ffmpeg only).
 *
 * @param {string} video  absolute path to the source video
 * @param {string} dir    output root (frames/, _thumbs/, audio.m4a land here)
 */
export async function ingestVideo(video, dir) {
  const framesDir = path.join(dir, 'frames');
  const thumbsDir = path.join(dir, '_thumbs');
  fs.mkdirSync(framesDir, { recursive: true });
  fs.mkdirSync(thumbsDir, { recursive: true });

  const duration = await probeDuration(video);
  const frames = await extractFrames(video, duration, framesDir);
  if (!frames.length) throw new Error('No frames could be extracted from the video.');

  let shots = [];
  try {
    const cuts = await detectCuts(video, duration);
    shots = buildShots(cuts, duration, frames.map((f) => ({ id: f.id, t: f.t })));
  } catch { /* cut detection best-effort — shotlist degrades to model-inferred */ }

  // ~640px analysis thumbs (what the vision passes read; the full frame is the master).
  const thumbs = [];
  for (const fr of frames) {
    const tabs = path.join(thumbsDir, `${fr.id}.jpg`);
    await runCmd(FFMPEG, ['-y', '-i', fr.abs, '-vf', "scale='min(640,iw)':-2", '-q:v', '7', tabs], 30_000);
    thumbs.push({ id: fr.id, abs: fs.existsSync(tabs) ? tabs : fr.abs, t: fr.t });
  }

  // Mono AAC audio (dialogue source for a later ASR batch; best-effort).
  const audioAbs = path.join(dir, 'audio.m4a');
  const ap = await runCmd(FFMPEG, ['-y', '-i', video, '-vn', '-ac', '1', '-c:a', 'aac', '-b:a', '96k', audioAbs], 300_000);
  const hasAudio = ap.code === 0 && fs.existsSync(audioAbs) && fs.statSync(audioAbs).size > 0;

  return {
    duration,
    frames: frames.map((f) => ({ id: f.id, t: f.t })),
    shots,
    hasAudio,
    audioPath: hasAudio ? audioAbs : null,
    framesDir,
    thumbsDir,
  };
}

// PRECISE SHOT RESOLVER (Phase 3) — densely sample a [tcIn,tcOut] window at N fps
// and compute FINE scene-cut candidates inside it (low threshold → the model
// verifies). This is how a coarse "shot" resolves into the several shots it really
// contains. Faithful port of the desktop bd dense-frames handler.
export async function denseFrames(video, outDir, tcIn, tcOut, fps) {
  fs.mkdirSync(outDir, { recursive: true });
  // -ss/-to BEFORE -i resets segment timestamps to 0 → add tcIn back to each frame's t.
  const vf = `fps=${fps},scale='min(640,iw)':-2,showinfo`;
  const p = await runCmd(FFMPEG, ['-y', '-ss', String(tcIn), '-to', String(tcOut), '-i', video, '-vf', vf, '-q:v', '4', path.join(outDir, 'd%03d.jpg')], 120_000);
  const times = [...(p.stderr || '').matchAll(/pts_time:(\d+\.?\d*)/g)].map((m) => parseFloat(m[1]));
  const got = fs.readdirSync(outDir).filter((f) => /^d\d+\.jpg$/.test(f)).sort();
  const frames = got.map((f, i) => ({ id: f.replace('.jpg', ''), t: Math.round((tcIn + (times[i] == null ? i / fps : times[i])) * 100) / 100 }));
  // fine cut candidates inside the window (low 0.12 threshold; the model verifies).
  const sc = await runCmd(FFMPEG, ['-hide_banner', '-ss', String(tcIn), '-to', String(tcOut), '-i', video, '-filter:v', "select='gt(scene,0.12)',showinfo", '-an', '-f', 'null', '-'], 120_000);
  const candidates = [...(sc.stderr || '').matchAll(/pts_time:(\d+\.?\d*)/g)]
    .map((m) => Math.round((tcIn + parseFloat(m[1])) * 100) / 100)
    .filter((t, i, a) => t > tcIn + 0.1 && t < tcOut - 0.05 && (i === 0 || t - a[i - 1] > 0.15));
  return { frames, candidates };
}

export const _ffmpegPath = FFMPEG;
