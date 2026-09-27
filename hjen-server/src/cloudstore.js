// Per-account cloud storage — the server-side backend for the web renderer's
// window.hjen. Everything is scoped by accountId (the authenticated invitee id),
// so tenants never see each other's data. File-backed for now
// (DATA_DIR/accounts/<id>/…); the API is shaped so it can move to Postgres + S3
// on AWS Riyadh later WITHOUT changing the web adapter. Desktop app untouched.
//
// The web adapter mirrors the desktop preload contract EXACTLY (arg objects +
// return shapes from src/types/hjen-bridge.d.ts). This module stores three
// things: JSON documents (per-project and per-account), generation blobs +
// index rows, and a per-account reference library.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config, genId } from './config.js';

const execFileP = promisify(execFile);

// ── convert concurrency limiter ────────────────────────────────────────────
// The server is a single Node process. ImageMagick `convert` used to run through
// execFileSync, which BLOCKS the event loop for the whole spawn — so a burst of
// cold-cache image requests (every freshly-made generation is cold) serialized
// and stalled EVERY other request behind them. We now run convert async, but cap
// how many spawn at once (a 20-image grid must not fork 20 processes) and share
// one in-flight promise per output file so duplicate concurrent requests wait on
// the same job instead of racing to write the same path.
const CONVERT_MAX = 3;
let _convertActive = 0;
const _convertQueue = [];
function _runConvert(args) {
  return new Promise((resolve, reject) => {
    const start = () => {
      _convertActive++;
      execFileP('convert', args, { timeout: 20000 })
        .then(() => resolve(), reject)
        .finally(() => { _convertActive--; const next = _convertQueue.shift(); if (next) next(); });
    };
    if (_convertActive < CONVERT_MAX) start(); else _convertQueue.push(start);
  });
}
const _inflightResize = new Map(); // cached-path → Promise<void>
// Produce `cached` (a resized WebP) from `master` if absent. Atomic: convert
// writes a unique .tmp then rename, so a reader never sees a half-written file.
// Deduped by output path so concurrent callers share one convert.
function _ensureResized(master, cached, w) {
  if (fs.existsSync(cached)) return Promise.resolve();
  const pending = _inflightResize.get(cached);
  if (pending) return pending;
  const tmp = `${cached}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  const job = _runConvert([master + '[0]', '-resize', `${w}x>`, '-quality', '82', '-strip', tmp])
    .then(() => { fs.renameSync(tmp, cached); })
    .catch((e) => { try { fs.rmSync(tmp, { force: true }); } catch {} throw e; })
    .finally(() => { _inflightResize.delete(cached); });
  _inflightResize.set(cached, job);
  return job;
}

const safe = (s) => String(s || '').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 80);
const accRoot = (acc) => path.join(config.dataDir, 'accounts', safe(acc));
const projDir = (acc, pid) => path.join(accRoot(acc), 'projects', safe(pid));

function readJson(f, fallback) { try { return JSON.parse(fs.readFileSync(f, 'utf-8')); } catch { return fallback; } }
function writeJson(f, data) { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = `${f}.${process.pid}.tmp`; fs.writeFileSync(t, JSON.stringify(data, null, 2)); fs.renameSync(t, f); }
const slugify = (s) => String(s || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'untitled';
const nowIso = () => new Date().toISOString();

export const cloud = {
  // ── projects index ─────────────────────────────
  // A row mirrors the desktop ProjectMeta shape (id, name, slug, created,
  // generationCount, coverImagePath?, currentStage?, stagesState?).
  _projectsFile: (acc) => path.join(accRoot(acc), 'projects.json'),
  _metaFile: (acc) => path.join(accRoot(acc), 'meta.json'), // { lastProjectId }

  listProjects(acc) {
    const list = readJson(this._projectsFile(acc), []);
    // Keep generationCount fresh (cheap: read the per-project index length).
    return list.map((p) => ({ ...p, generationCount: this.listGenerations(acc, p.id).length }));
  },
  getProjectsBundle(acc) {
    const meta = readJson(this._metaFile(acc), {});
    return { projects: this.listProjects(acc), projectsRoot: `cloud://${safe(acc)}`, lastProjectId: meta.lastProjectId || null };
  },
  createProject(acc, name) {
    const list = readJson(this._projectsFile(acc), []);
    const proj = { id: genId(10), name: (name || 'Untitled').trim(), slug: slugify(name), created: nowIso(), generationCount: 0, currentStage: 1, stagesState: {} };
    list.unshift(proj);
    writeJson(this._projectsFile(acc), list);
    fs.mkdirSync(projDir(acc, proj.id), { recursive: true });
    this.appendOp(acc, { op: 'project-create', pid: proj.id, name: proj.name });
    return proj;
  },
  renameProject(acc, id, name) {
    const list = readJson(this._projectsFile(acc), []);
    const p = list.find((x) => x.id === id); if (!p) return null;
    const from = p.name;
    p.name = (name || p.name).trim(); p.slug = slugify(p.name);
    writeJson(this._projectsFile(acc), list);
    this.appendOp(acc, { op: 'project-rename', pid: id, name: p.name, meta: { from } });
    return { ...p, generationCount: this.listGenerations(acc, id).length };
  },
  setProjectCover(acc, id, imgPath) {
    const list = readJson(this._projectsFile(acc), []);
    const p = list.find((x) => x.id === id); if (!p) return null;
    p.coverImagePath = imgPath || undefined;
    writeJson(this._projectsFile(acc), list);
    return { ...p, generationCount: this.listGenerations(acc, id).length };
  },
  // Merge partial ProjectMeta fields (currentStage / stagesState) from a saved
  // ProjectState, keeping the list-view mirror in sync.
  patchProjectMeta(acc, id, patch) {
    const list = readJson(this._projectsFile(acc), []);
    const p = list.find((x) => x.id === id); if (!p) return null;
    Object.assign(p, patch);
    writeJson(this._projectsFile(acc), list);
    return { ...p, generationCount: this.listGenerations(acc, id).length };
  },
  deleteProject(acc, id) {
    const list = readJson(this._projectsFile(acc), []).filter((x) => x.id !== id);
    writeJson(this._projectsFile(acc), list);
    try { fs.rmSync(projDir(acc, id), { recursive: true, force: true }); } catch {}
    this.appendOp(acc, { op: 'project-delete', pid: id });
    return true;
  },
  setLastProjectId(acc, id) {
    const meta = readJson(this._metaFile(acc), {});
    meta.lastProjectId = id || null;
    writeJson(this._metaFile(acc), meta);
    return true;
  },
  projectById(acc, id) {
    return readJson(this._projectsFile(acc), []).find((x) => x.id === id) || null;
  },

  // ── op-log (the cloud-first sync backbone + user-visible history) ──────────
  // Append-only per-account journal: every create/delete/rename/edit/move gets a
  // monotonic seq. The desktop sync agent pulls ops after its cursor to mirror the
  // folder; the Files/history UI can read it too. seq is kept in a tiny counter
  // file (atomic write) so it never collides on this single node.
  _opLog: (acc) => path.join(accRoot(acc), 'sync-log.jsonl'),
  _opSeqFile: (acc) => path.join(accRoot(acc), 'sync-seq.json'),
  appendOp(acc, o) {
    try {
      const cur = readJson(this._opSeqFile(acc), { seq: 0 });
      const seq = (cur.seq || 0) + 1;
      writeJson(this._opSeqFile(acc), { seq });
      const rec = { seq, ts: Date.now(), actor: o.actor || 'cloud', op: String(o.op || ''), pid: o.pid || null, gid: o.gid || null, ext: o.ext || null, name: o.name || null, meta: o.meta || null };
      fs.mkdirSync(accRoot(acc), { recursive: true });
      fs.appendFileSync(this._opLog(acc), JSON.stringify(rec) + '\n');
      return rec;
    } catch { return null; }
  },
  readOps(acc, since = 0) {
    try {
      const ops = [];
      for (const l of fs.readFileSync(this._opLog(acc), 'utf-8').split('\n')) {
        if (!l) continue;
        try { const r = JSON.parse(l); if ((r.seq || 0) > since) ops.push(r); } catch {}
      }
      return ops;
    } catch { return []; }
  },
  opCursor(acc) { return readJson(this._opSeqFile(acc), { seq: 0 }).seq || 0; },

  // ── generic JSON documents ─────────────────────
  // Two scopes: per-project ({project}/docs/<key>.json) and per-account
  // ({acc}/docs/<key>.json — board looks, mind notes, jobs, settings…).
  readProjectDoc(acc, pid, key, fallback = null) {
    return readJson(path.join(projDir(acc, pid), 'docs', safe(String(key).replace(/\//g, '__')) + '.json'), fallback);
  },
  writeProjectDoc(acc, pid, key, data) {
    writeJson(path.join(projDir(acc, pid), 'docs', safe(String(key).replace(/\//g, '__')) + '.json'), data);
    return true;
  },
  readAcctDoc(acc, key, fallback = null) {
    return readJson(path.join(accRoot(acc), 'docs', safe(String(key).replace(/\//g, '__')) + '.json'), fallback);
  },
  writeAcctDoc(acc, key, data) {
    writeJson(path.join(accRoot(acc), 'docs', safe(String(key).replace(/\//g, '__')) + '.json'), data);
    return true;
  },

  // ── generations (image/video blobs + index rows) ──
  // A row carries the fields the renderer's GlobalGenerationEntry needs; the
  // full sidecar is stored beside it for readSidecar().
  saveGeneration(acc, { pid, base64, ext = 'png', sidecar = {}, promptSlug = 'frame', projectName = '', projectSlug = '' }) {
    if (!pid) throw new Error('generation needs a project id');
    const gid = genId(12);
    const blobDir = path.join(projDir(acc, pid), 'blobs');
    fs.mkdirSync(blobDir, { recursive: true });
    fs.writeFileSync(path.join(blobDir, `${gid}.${ext}`), Buffer.from(base64, 'base64'));
    const idxFile = path.join(projDir(acc, pid), 'generations.json');
    const idx = readJson(idxFile, []);
    const ts = Date.now();
    const row = {
      gid, ext, ts, promptSlug,
      sidecar,
      // denormalized fields for the global list (avoid re-reading each sidecar)
      promptTitle: sidecar.promptTitle || sidecar.prompt || promptSlug || 'Frame',
      finalSize: sidecar.finalSize || sidecar.apiSize, resolution: sidecar.resolution,
      quality: sidecar.quality, aspect: sidecar.aspect, modelLabel: sidecar.modelLabel || sidecar.model,
      costUsd: sidecar.costUsd, durationMs: sidecar.durationMs,
      referencesCount: Array.isArray(sidecar.references) ? sidecar.references.length : (sidecar.referencesCount || 0),
      captured: sidecar.captured || null,
      projectId: pid, projectName, projectSlug,
    };
    idx.unshift(row);
    writeJson(idxFile, idx.slice(0, 5000));
    const _ev = ['mp4', 'webm', 'mov'].includes(String(ext).toLowerCase());
    this.appendOp(acc, { op: 'create', pid, gid, ext, name: sidecar.promptTitle || promptSlug, meta: { tool: sidecar.tool || (_ev ? 'video' : 'frame') } });
    // Warm display + thumbnail sizes in the background so the first view of this
    // fresh generation isn't a cold, event-loop-blocking resize (the "من توليده
    // إلى توليده" slowness). Non-blocking — the save response returns immediately.
    if (!_ev) this.warmResizes(acc, pid, gid, ext);
    return { gid, ext, ts };
  },
  listGenerations(acc, pid) {
    return readJson(path.join(projDir(acc, pid), 'generations.json'), []);
  },

  // ── breakdown artifacts (server-side video ingest, Phase 1) ───────────────
  // Per (account, project, slug): the source video + extracted frames/_thumbs +
  // audio.m4a + manifest.json, all under the project so it travels with it.
  bdDir(acc, pid, slug) { return path.join(projDir(acc, pid), 'breakdowns', safe(slug)); },
  saveBreakdownManifest(acc, pid, slug, manifest) {
    writeJson(path.join(this.bdDir(acc, pid, slug), 'manifest.json'), manifest);
    return true;
  },
  readBreakdownManifest(acc, pid, slug) {
    return readJson(path.join(this.bdDir(acc, pid, slug), 'manifest.json'), null);
  },
  // Serve one frame's bytes. kind 'full' = the up-to-1280px master, else the
  // ~640px analysis thumb. Returns a Buffer or null.
  readBreakdownFrame(acc, pid, slug, id, kind = 'thumb') {
    const sub = kind === 'full' ? 'frames' : '_thumbs';
    const f = path.join(this.bdDir(acc, pid, slug), sub, `${safe(id)}.jpg`);
    try { return fs.existsSync(f) ? fs.readFileSync(f) : null; } catch { return null; }
  },
  // Resolve the ingested source video (source.<ext>) for the precise shot resolver.
  bdSourceVideo(acc, pid, slug) {
    const dir = this.bdDir(acc, pid, slug);
    try { const f = fs.readdirSync(dir).find((x) => /^source\./.test(x)); return f ? path.join(dir, f) : ''; }
    catch { return ''; }
  },
  // Serve one dense frame's bytes from a specific dense run.
  readDenseFrame(acc, pid, slug, run, id) {
    const f = path.join(this.bdDir(acc, pid, slug), '_dense', safe(run), `${safe(id)}.jpg`);
    try { return fs.existsSync(f) ? fs.readFileSync(f) : null; } catch { return null; }
  },
  listBreakdowns(acc, pid) {
    const base = path.join(projDir(acc, pid), 'breakdowns');
    let slugs = [];
    try { slugs = fs.readdirSync(base); } catch { return []; }
    return slugs.map((s) => this.readBreakdownManifest(acc, pid, s)).filter(Boolean);
  },

  // ── Cuts sessions (server-side ffmpeg working area) ───────────────────────
  // The desktop keeps these beside the project on disk:
  //   {project}/Cuts/<sessionId>/{shots,strip,cand,watch.mp4,source.*}
  // On the web they are ACCOUNT-scoped rather than project-scoped, because Cuts
  // is a global internal tool — the desktop's cuts-list deliberately walks every
  // project bucket so a session never disappears when the active project changes.
  cutsDir(acc, sessionId) {
    const id = String(sessionId || 'session').replace(/[^\w-]+/g, '_').slice(0, 60);
    const dir = path.join(accRoot(acc), 'cuts', id);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  },
  /** Serve one file out of a session, by a path that can never escape it. */
  readCutsFile(acc, sessionId, rel) {
    const base = this.cutsDir(acc, sessionId);
    const clean = String(rel || '').replace(/\.\.+/g, '').replace(/[^\w./-]/g, '');
    const f = path.join(base, clean);
    if (!f.startsWith(base)) return null;
    try { return fs.existsSync(f) ? fs.readFileSync(f) : null; } catch { return null; }
  },
  /** Wipe a session's working area — cutsDelete removes the doc AND the bytes. */
  removeCutsDir(acc, sessionId) {
    try { fs.rmSync(this.cutsDir(acc, sessionId), { recursive: true, force: true }); return true; }
    catch { return false; }
  },

  // ── delivered-frame recovery cache (paid ⟺ recoverable) ──────────────────
  // The LAW: once a make is charged, the file must come back to the user
  // automatically — even if the app was closed mid-flight and never received
  // the HTTP response. So EVERY delivered+charged frame is persisted here,
  // keyed purely by (account, jobId) — surface-agnostic (works for desktop's
  // LOCAL projects and web alike, no project needed). The client re-fetches it
  // on next launch via /api/frame/recover. TTL-pruned so it can't grow forever.
  _recoverDir: (acc) => path.join(accRoot(acc), 'recover'),
  saveDelivered(acc, jobId, { base64, ext = 'png', meta = {} }) {
    const j = safe(jobId); if (!j || !base64) return;
    const dir = this._recoverDir(acc);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${j}.${ext}`), Buffer.from(base64, 'base64'));
      writeJson(path.join(dir, `${j}.json`), { jobId: j, ext, ts: Date.now(), meta });
      this._pruneDelivered(acc);
    } catch { /* recovery is a safety net — never break the make on a cache write */ }
  },
  getDelivered(acc, jobId) {
    const j = safe(jobId); if (!j) return null;
    const rec = readJson(path.join(this._recoverDir(acc), `${j}.json`), null);
    if (!rec) return null;
    try {
      const b64 = fs.readFileSync(path.join(this._recoverDir(acc), `${j}.${rec.ext || 'png'}`)).toString('base64');
      return { ...rec, b64 };
    } catch { return null; }
  },
  _pruneDelivered(acc, ttlMs = 7 * 24 * 3600 * 1000) {
    const dir = this._recoverDir(acc);
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        const rec = readJson(path.join(dir, f), null);
        if (rec && Date.now() - (rec.ts || 0) > ttlMs) {
          try { fs.rmSync(path.join(dir, f)); } catch {}
          try { fs.rmSync(path.join(dir, `${rec.jobId}.${rec.ext || 'png'}`)); } catch {}
        }
      }
    } catch { /* empty/missing dir → nothing to prune */ }
  },
  // Every account that has a data dir (drives boot-time global sweeps).
  listAccountIds() {
    try { return fs.readdirSync(path.join(config.dataDir, 'accounts')).filter((d) => d && !d.startsWith('.')); }
    catch { return []; }
  },
  // Prune the recover safety-net cache for ALL accounts. The per-account prune
  // only fires on that account's NEXT delivered make, so an idle (or, when the
  // disk is full, a BLOCKED) account's 7-day blobs never expire on their own.
  // Running this on boot + on a timer breaks that deadlock. Returns files freed.
  pruneAllRecover(ttlMs = 7 * 24 * 3600 * 1000) {
    let removed = 0;
    for (const acc of this.listAccountIds()) {
      const dir = this._recoverDir(acc);
      try {
        for (const f of fs.readdirSync(dir)) {
          if (!f.endsWith('.json')) continue;
          const rec = readJson(path.join(dir, f), null);
          if (rec && Date.now() - (rec.ts || 0) > ttlMs) {
            try { fs.rmSync(path.join(dir, f)); removed++; } catch {}
            try { fs.rmSync(path.join(dir, `${rec.jobId}.${rec.ext || 'png'}`)); } catch {}
          }
        }
      } catch { /* no recover dir for this account */ }
    }
    return removed;
  },
  // True when the master blob for a row actually exists on disk (used to drop
  // orphaned index rows — a gen whose file is gone must never surface as a
  // broken/undownloadable ghost in the Files browser).
  blobExists(acc, pid, gid, ext = 'png') {
    try { return fs.existsSync(path.join(projDir(acc, pid), 'blobs', `${safe(gid)}.${safe(ext)}`)); }
    catch { return false; }
  },
  // Every generation across every project, newest first — for listAllGenerations.
  // `opts.presentOnly` drops rows whose blob is missing (the Files browser wants
  // only real, downloadable files, never orphaned index rows).
  listAllGenerations(acc, opts = {}) {
    const out = [];
    for (const p of readJson(this._projectsFile(acc), [])) {
      for (const r of this.listGenerations(acc, p.id)) {
        if (opts.presentOnly && !this.blobExists(acc, p.id, r.gid, r.ext || 'png')) continue;
        out.push({ ...r, projectName: p.name, projectSlug: p.slug });
      }
    }
    out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return out;
  },
  readBlob(acc, pid, gid, ext = 'png') {
    const f = path.join(projDir(acc, pid), 'blobs', `${safe(gid)}.${safe(ext)}`);
    return fs.existsSync(f) ? fs.readFileSync(f) : null;
  },
  // Display-optimized variant: a WebP resized to `w` px wide, cached on disk so
  // the browser never pulls the full multi-MB PNG just to show it on screen. The
  // full original stays the download master. Returns { buf, ct } or null (caller
  // falls back to the master). ImageMagick `convert` does the work.
  // ASYNC (hot path): never blocks the event loop. Returns { buf, ct } | null.
  async resizedBlobAsync(acc, pid, gid, ext = 'png', w = 1600) {
    w = Math.max(64, Math.min(4096, w | 0));
    const blobDir = path.join(projDir(acc, pid), 'blobs');
    const master = path.join(blobDir, `${safe(gid)}.${safe(ext)}`);
    if (!fs.existsSync(master)) return null;
    if (ext === 'mp4' || ext === 'webm') return null; // video: serve as-is
    const cached = path.join(blobDir, `${safe(gid)}_w${w}.webp`);
    try {
      await _ensureResized(master, cached, w);
      return { buf: fs.readFileSync(cached), ct: 'image/webp' };
    } catch { return null; }
  },
  // SYNC (kept for any non-hot-path / internal caller). Prefer the async variant
  // on request paths — this blocks the event loop while convert runs.
  resizedBlob(acc, pid, gid, ext = 'png', w = 1600) {
    w = Math.max(64, Math.min(4096, w | 0));
    const blobDir = path.join(projDir(acc, pid), 'blobs');
    const master = path.join(blobDir, `${safe(gid)}.${safe(ext)}`);
    if (!fs.existsSync(master)) return null;
    if (ext === 'mp4' || ext === 'webm') return null; // video: serve as-is
    const cached = path.join(blobDir, `${safe(gid)}_w${w}.webp`);
    try {
      if (!fs.existsSync(cached)) {
        execFileSync('convert', [master + '[0]', '-resize', `${w}x>`, '-quality', '82', '-strip', cached],
          { timeout: 20000, stdio: 'ignore' });
      }
      return { buf: fs.readFileSync(cached), ct: 'image/webp' };
    } catch { return null; }
  },
  readGenerationRow(acc, pid, gid) {
    return this.listGenerations(acc, pid).find((r) => r.gid === gid) || null;
  },
  // Discover the master's extension from disk (shared by the auto variants).
  _discoverExt(acc, pid, gid) {
    const blobDir = path.join(projDir(acc, pid), 'blobs');
    try {
      const g = safe(gid);
      const f = fs.readdirSync(blobDir).find((n) => n.startsWith(g + '.') && !/_(w\d+|poster)\.webp$/.test(n));
      return f ? f.split('.').pop() : null;
    } catch { return null; }
  },
  // ASYNC (hot path) — used by the token-free, edge-cacheable display route
  // /i/<acc>/<pid>/<gid>/<w>.webp and by /api/file?w=.
  async resizedBlobAutoAsync(acc, pid, gid, w = 1600) {
    const ext = this._discoverExt(acc, pid, gid);
    if (!ext) return null;
    // Video thumbnails are the poster frame (extracted by makeVideoPoster).
    if (ext === 'mp4' || ext === 'webm' || ext === 'mov') return this.videoPoster(acc, pid, gid);
    return this.resizedBlobAsync(acc, pid, gid, ext, w);
  },
  // SYNC variant kept for backward-compat (not on the hot path anymore).
  resizedBlobAuto(acc, pid, gid, w = 1600) {
    const ext = this._discoverExt(acc, pid, gid);
    if (!ext) return null;
    if (ext === 'mp4' || ext === 'webm' || ext === 'mov') return this.videoPoster(acc, pid, gid);
    return this.resizedBlob(acc, pid, gid, ext, w);
  },
  // Fire-and-forget: warm the display + thumbnail WebP for a freshly saved image
  // so the first on-screen view is never a cold, blocking resize. Non-blocking —
  // errors are swallowed (a missed warm just falls back to on-demand resize).
  warmResizes(acc, pid, gid, ext = 'png') {
    if (['mp4', 'webm', 'mov'].includes(String(ext).toLowerCase())) return;
    for (const w of [640, 1600]) {
      this.resizedBlobAsync(acc, pid, gid, ext, w).catch(() => {});
    }
  },
  videoPoster(acc, pid, gid) {
    const f = path.join(projDir(acc, pid), 'blobs', `${safe(gid)}_poster.webp`);
    return fs.existsSync(f) ? { buf: fs.readFileSync(f), ct: 'image/webp' } : null;
  },
  // Extract a still poster from a saved clip (ffmpeg) → used as its thumbnail.
  makeVideoPoster(acc, pid, gid, ext = 'mp4') {
    const blobDir = path.join(projDir(acc, pid), 'blobs');
    const clip = path.join(blobDir, `${safe(gid)}.${safe(ext)}`);
    const poster = path.join(blobDir, `${safe(gid)}_poster.webp`);
    if (!fs.existsSync(clip) || fs.existsSync(poster)) return;
    const ff = fs.existsSync('/usr/local/bin/ffmpeg') ? '/usr/local/bin/ffmpeg' : 'ffmpeg';
    try { execFileSync(ff, ['-y', '-ss', '0.5', '-i', clip, '-vframes', '1', '-vf', 'scale=640:-1', poster], { timeout: 25000, stdio: 'ignore' }); } catch {}
  },
  deleteGeneration(acc, pid, gid) {
    const idxFile = path.join(projDir(acc, pid), 'generations.json');
    const idx = readJson(idxFile, []); const row = idx.find((r) => r.gid === gid);
    writeJson(idxFile, idx.filter((r) => r.gid !== gid));
    if (row) { try { fs.rmSync(path.join(projDir(acc, pid), 'blobs', `${gid}.${row.ext || 'png'}`), { force: true }); } catch {} }
    this.appendOp(acc, { op: 'delete', pid, gid, ext: row?.ext || 'png', name: row?.promptTitle || null });
    return true;
  },

  // ── video jobs (server-side completion) ────────
  // Video renders happen at the vendor (Seedance/Kling); we charge on submit. A
  // closed tab must NOT lose a paid video, so we track each task here and a server
  // worker polls it to done — downloading + saving the clip to the project (found
  // on return) — or refunds it once if the render failed. Global file (few at a time).
  _vjobsFile: () => path.join(config.dataDir, 'videojobs.json'),
  listVideoJobs() { return readJson(this._vjobsFile(), []); },
  addVideoJob(job) {
    const l = this.listVideoJobs();
    if (l.some((j) => j.taskId === job.taskId)) return; // idempotent
    l.unshift({ ...job, status: 'pending', at: Date.now(), tries: 0 });
    writeJson(this._vjobsFile(), l.slice(0, 500));
  },
  setVideoJob(taskId, patch) {
    const l = this.listVideoJobs(); const j = l.find((x) => x.taskId === taskId);
    if (j) { Object.assign(j, patch); writeJson(this._vjobsFile(), l); }
    return j;
  },

  // ── reference library (per-account) ────────────
  _libFile: (acc) => path.join(accRoot(acc), 'library.json'),
  listLibrary(acc) { return readJson(this._libFile(acc), []); },
  addLibraryAsset(acc, { category, base64, ext = 'png', name = '' }) {
    const list = readJson(this._libFile(acc), []);
    const id = genId(12);
    const libBlob = path.join(accRoot(acc), 'library', `${id}.${ext}`);
    fs.mkdirSync(path.dirname(libBlob), { recursive: true });
    const buf = Buffer.from(base64, 'base64');
    fs.writeFileSync(libBlob, buf);
    const asset = {
      id, category, name: name || `${category}-${id.slice(0, 4)}`, filename: `${id}.${ext}`,
      filePath: `cloudlib://${id}.${ext}`, thumbPath: `cloudlib://${id}.${ext}`,
      addedAt: nowIso(), bytes: buf.length, origin: 'upload',
    };
    list.unshift(asset);
    writeJson(this._libFile(acc), list);
    return asset;
  },
  deleteLibraryAsset(acc, id) {
    const list = readJson(this._libFile(acc), []); const a = list.find((x) => x.id === id);
    writeJson(this._libFile(acc), list.filter((x) => x.id !== id));
    if (a) { try { fs.rmSync(path.join(accRoot(acc), 'library', a.filename), { force: true }); } catch {} }
    return true;
  },
  renameLibraryAsset(acc, id, name) {
    const list = readJson(this._libFile(acc), []); const a = list.find((x) => x.id === id);
    if (!a) return null; a.name = name; writeJson(this._libFile(acc), list); return a;
  },
  moveLibraryAsset(acc, id, newCategory) {
    const list = readJson(this._libFile(acc), []); const a = list.find((x) => x.id === id);
    if (!a) return null; a.category = newCategory; writeJson(this._libFile(acc), list); return a;
  },
  readLibraryBlob(acc, filename) {
    const f = path.join(accRoot(acc), 'library', safe(filename));
    return fs.existsSync(f) ? fs.readFileSync(f) : null;
  },

  // ── profile avatar (per-account) ───────────────
  saveAvatar(acc, base64, ext = 'png') {
    const f = path.join(accRoot(acc), `avatar.${safe(ext)}`);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, Buffer.from(base64, 'base64'));
    // Clear other-ext avatars so the newest wins.
    for (const e of ['png', 'jpg', 'jpeg', 'webp']) { if (e !== ext) { try { fs.rmSync(path.join(accRoot(acc), `avatar.${e}`), { force: true }); } catch {} } }
    return `avatar.${ext}`;
  },
  readAvatar(acc) {
    for (const e of ['png', 'jpg', 'jpeg', 'webp']) {
      const f = path.join(accRoot(acc), `avatar.${e}`);
      if (fs.existsSync(f)) return { buf: fs.readFileSync(f), ct: e === 'jpg' || e === 'jpeg' ? 'image/jpeg' : e === 'webp' ? 'image/webp' : 'image/png' };
    }
    return null;
  },
};
