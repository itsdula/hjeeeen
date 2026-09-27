// HJEN cloud-first SYNC ENGINE — the PULL half (cloud → local mirror).
// Mirrors an account's server deliverables into a local folder, driven by the
// append-only op-log. ACCOUNT-ISOLATED: everything lives under
// <root>/<accountLabel>/, and the engine only writes/deletes inside that
// subfolder — a second account on the same machine can never be touched.
// Verified live against demo.hjen.ai (pull → download → local files, idempotent).
//
// Layout it produces (clean — outputs only; system files hidden in .hjen/):
//   <root>/<accountLabel>/<Project>/<Tool>/<name>_<gid>.<ext>
//   <root>/<accountLabel>/.hjen/index.json   (gid → relative path, for deletes)
//   <root>/<accountLabel>/.hjen/cursor.json  (last-applied op seq)

import fs from 'node:fs';
import path from 'node:path';

const TOOL_LABEL: Record<string, string> = { frame: 'Frames', video: 'Videos', storyboard: 'Storyboard', breakdown: 'Breakdown', cuts: 'Cuts', references: 'References', cast: 'Cast' };
export const safeName = (s: unknown): string => String(s || '').replace(/[^\p{L}\p{N} _.-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'untitled';
export const toolFolder = (t?: string): string => (t && TOOL_LABEL[t]) || (t ? safeName(t[0].toUpperCase() + t.slice(1)) : 'Other');

interface Op { seq: number; op: string; pid?: string | null; gid?: string | null; ext?: string | null; name?: string | null; meta?: { tool?: string; from?: string } | null }
export interface PullConfig { gatewayUrl: string; token: string; root: string; accountLabel: string }
export interface PullResult { cursor: number; applied: number; downloaded: number; deleted: number }

const TOOL_SLUG: Record<string, string> = { Frames: 'frame', Videos: 'video', Storyboard: 'storyboard', Breakdown: 'breakdown', Cuts: 'cuts', References: 'references', Cast: 'cast', Other: '' };
const MEDIA_RE = /\.(png|jpe?g|webp|gif|mp4|webm|mov|m4v)$/i;
function listDirs(dir: string): string[] { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; } }
async function jpost(url: string, token: string, body: unknown): Promise<any> {
  const r = await fetch(url, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('POST ' + url.split('?')[0] + ' → ' + r.status);
  return r.json();
}

/**
 * PUSH (local → cloud), ADD-ONLY + echo-safe. Uploads media the USER dropped into
 * the synced folder (files not already tracked in .hjen/index) as generations in
 * the matching project+tool. It NEVER deletes cloud files from local removals
 * (cloud is the source of truth; deletions flow cloud→local via pull only). Each
 * upload is recorded in the index by its new gid, so the create op it generates is
 * skipped by this machine's next pull (no duplicate). Scoped to one account's subfolder.
 */
export async function pushOnce(cfg: PullConfig): Promise<{ uploaded: number }> {
  const base = cfg.gatewayUrl.replace(/\/$/, '');
  const accRoot = path.join(cfg.root, safeName(cfg.accountLabel));
  if (!fs.existsSync(accRoot)) return { uploaded: 0 };
  const idxFile = path.join(accRoot, '.hjen', 'index.json');
  const index = readJson<Record<string, string>>(idxFile, {});
  const known = new Set(Object.values(index)); // relpaths already synced
  const projByName: Record<string, any> = {};
  try { for (const p of (await jget(base + '/api/projects', cfg.token)).projects || []) projByName[safeName(p.name)] = p; } catch { /* offline → skip this cycle */ return { uploaded: 0 }; }
  let uploaded = 0;
  for (const proj of listDirs(accRoot)) {
    if (proj === '.hjen') continue;
    for (const tool of listDirs(path.join(accRoot, proj))) {
      const dir = path.join(accRoot, proj, tool);
      let files: string[] = [];
      try { files = fs.readdirSync(dir); } catch { continue; }
      for (const fn of files) {
        if (!MEDIA_RE.test(fn)) continue;
        const abs = path.join(dir, fn);
        const rel = path.relative(accRoot, abs);
        if (known.has(rel)) continue;                                    // pull-written or already pushed
        try { if (Date.now() - fs.statSync(abs).mtimeMs < 3000) continue; } catch { continue; } // still being written
        let p = projByName[safeName(proj)];
        if (!p) { try { const cr = await jpost(base + '/api/projects', cfg.token, { op: 'create', name: proj }); p = cr.project; if (p) projByName[safeName(proj)] = p; } catch { continue; } }
        if (!p) continue;
        try {
          const b64 = fs.readFileSync(abs).toString('base64');
          const ext = (fn.split('.').pop() || 'png').toLowerCase();
          const nm = fn.replace(/_[A-Za-z0-9_-]{8,}\.[^.]+$/, '').replace(/\.[^.]+$/, '');   // strip the _<gid> suffix pull adds
          const res = await jpost(base + '/api/gen', cfg.token, { pid: p.id, base64: b64, ext, promptSlug: nm, projectName: proj, projectSlug: '', sidecar: { promptTitle: nm, tool: TOOL_SLUG[tool] || tool.toLowerCase() } });
          const m = String(res?.imgPath || '').match(/^cloudgen:\/\/[^/]+\/([^.]+)\./);
          if (m) { index[m[1]] = rel; uploaded++; }
        } catch { /* skip a file that fails to upload; next cycle retries */ }
      }
    }
  }
  writeJson(idxFile, index);
  return { uploaded };
}

function readJson<T>(f: string, fb: T): T { try { return JSON.parse(fs.readFileSync(f, 'utf-8')); } catch { return fb; } }
function writeJson(f: string, d: unknown) { try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(d, null, 2)); } catch { /* best-effort */ } }

async function jget(url: string, token: string): Promise<any> {
  const r = await fetch(url, { headers: { authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('GET ' + url.split('?')[0] + ' → ' + r.status);
  return r.json();
}

/** Run ONE pull cycle for one account — scoped entirely to its own subfolder. */
export async function pullOnce(cfg: PullConfig): Promise<PullResult> {
  const base = cfg.gatewayUrl.replace(/\/$/, '');
  const accRoot = path.join(cfg.root, safeName(cfg.accountLabel));
  const hidden = path.join(accRoot, '.hjen');
  fs.mkdirSync(hidden, { recursive: true });
  const idxFile = path.join(hidden, 'index.json');
  const curFile = path.join(hidden, 'cursor.json');
  const index = readJson<Record<string, string>>(idxFile, {});
  let cursor = readJson<{ seq: number }>(curFile, { seq: 0 }).seq || 0;

  const projName: Record<string, string> = {};
  try { for (const p of (await jget(base + '/api/projects', cfg.token)).projects || []) projName[p.id] = p.name; } catch { /* names best-effort */ }

  const { ops } = await jget(base + '/api/oplog?since=' + cursor, cfg.token) as { ops: Op[] };
  let downloaded = 0, deleted = 0, applied = 0;

  for (const op of ops || []) {
    try {
      if (op.op === 'create' && op.pid && op.gid) {
        // Echo-safety: if we already hold this gid locally (pull-written OR
        // push-uploaded from this machine), skip the download — no duplicate.
        if (index[op.gid] && fs.existsSync(path.join(accRoot, index[op.gid]))) { cursor = Math.max(cursor, op.seq || 0); applied++; continue; }
        const dir = path.join(accRoot, safeName(projName[op.pid] || op.pid), toolFolder(op.meta?.tool));
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `${safeName(op.name || 'frame')}_${op.gid}.${op.ext || 'png'}`);
        const r = await fetch(`${base}/api/file?path=${encodeURIComponent(`cloudgen://${op.pid}/${op.gid}.${op.ext || 'png'}`)}&token=${encodeURIComponent(cfg.token)}`);
        if (r.ok) { fs.writeFileSync(file, Buffer.from(await r.arrayBuffer())); index[op.gid] = path.relative(accRoot, file); downloaded++; }
      } else if (op.op === 'delete' && op.gid) {
        const rel = index[op.gid];
        if (rel) { try { fs.rmSync(path.join(accRoot, rel), { force: true }); } catch { /* gone */ } delete index[op.gid]; deleted++; }
      } else if (op.op === 'project-rename' && op.pid) {
        const from = op.meta?.from ? safeName(op.meta.from) : null;
        const to = safeName(op.name);
        if (from && to && from !== to) { try { const a = path.join(accRoot, from), b = path.join(accRoot, to); if (fs.existsSync(a)) fs.renameSync(a, b); } catch { /* skip */ } }
      } else if (op.op === 'project-delete' && op.pid) {
        const nm = safeName(projName[op.pid] || '');
        if (nm) { try { fs.rmSync(path.join(accRoot, nm), { recursive: true, force: true }); } catch { /* skip */ } }
      }
      cursor = Math.max(cursor, op.seq || 0);
      applied++;
    } catch { /* skip a bad op; next pull retries from the un-advanced cursor */ }
  }

  writeJson(idxFile, index);
  writeJson(curFile, { seq: cursor });
  return { cursor, applied, downloaded, deleted };
}
