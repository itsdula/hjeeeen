// clipper.ts — the browser door. A fixed-port localhost bridge the HJEN
// Clipper browser extension posts web images and GIFs through, straight into
// a project's References.
//
// WHY A SECOND PORT. The MCP control port binds :0 (a random port written to
// mcp-control.json) because its client is a local process that can read that
// file. A browser extension cannot read files — it needs an address it can
// know in advance. So this door binds a FIXED port and only walks up the range
// if the machine is already using it.
//
// TWO LOCKS, because 127.0.0.1 is reachable from any page in the browser:
//   1. Per-browser grants — a browser EARNS a token by asking, and the app
//      asking the human (see startPairing). Nothing is ever typed or pasted,
//      each browser holds its own secret, and any one of them can be signed
//      out without touching the others.
//   2. Origin gate — a request carrying a normal web Origin (https://…) is
//      refused outright. Only extension origins and origin-less requests pass.
//
// The payload shape is deliberately transport-neutral (base64 bytes + page
// provenance, no local paths): the same body will POST to the cloud gateway
// when the mobile share-sheet lands, with only the base URL changing.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('node:path');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('node:fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeCrypto = require('node:crypto');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const http = require('node:http');

const PORT_FIRST = 47615;
const PORT_LAST = 47624;
const MAX_BODY = 48 * 1024 * 1024;     // a 4K PNG or a long GIF, with room to spare

export interface ClipperDeps {
  /** Absolute path of the projects root (~/Pictures/HJEN Studio by default). */
  projectsRoot: () => string;
  /** The projects index, newest state. */
  readProjects: () => Array<{ id: string; name: string; slug: string }>;
  /** Absolute path of a project's stage JSON — References is stage 2. */
  stageDataPath: (slug: string, stage: number) => string;
  /** The project the app last had open — the default save target. */
  lastProjectId: () => string | null;
  /** userData dir; grants + preferences live here. */
  userDataDir: string;
  /** Ask the human at the keyboard to authorize a browser. Resolves true only
   *  on an explicit Allow. THIS is what replaced pasting a key: the browser
   *  asks, the app asks the user, the token never crosses a clipboard. */
  askApproval: (info: { browser: string; code: string }) => Promise<boolean>;
  /** Who the app is signed in as, shown in the browser after connecting. */
  account: () => { name: string; email: string; plan: string };
  /** App version, echoed on /ping so the extension can warn on old builds. */
  appVersion: string;
  /** Where the shipped copy of the extension lives. Inside a packaged .app
   *  that is Resources/extension — a path Chrome's folder picker refuses to
   *  descend into (macOS treats a bundle as a file), so it gets mirrored out
   *  to the projects root on launch. See mirrorExtension. */
  extensionDir: string;
  /** Tell the renderer a project's References changed on disk. */
  notify: (payload: { projectId: string; kind: string }) => void;
}

/** How the user wants to clip. THE APP OWNS THESE, not the extension: the
 *  browser side is a terminal that asks the door what it is allowed to do.
 *  One place to change behaviour, and it survives reinstalling the extension. */
export interface ClipperPrefs {
  /** Right-click → Save to HJEN Studio (with the per-project submenu). */
  contextMenu: boolean;
  /** The Save badge that appears when hovering an image. */
  hoverBadge: boolean;
  /** Alt+Shift+S on whatever is under the cursor. */
  shortcut: boolean;
  /** A system notification per save (in-page toast is always shown). */
  notify: boolean;
  /** Smallest image the hover badge appears on, in px. */
  minSize: number;
  /** Fixed target project, or '' to follow whichever project is open. */
  projectId: string;
}

const DEFAULT_PREFS: ClipperPrefs = {
  contextMenu: true, hoverBadge: true, shortcut: true,
  notify: true, minSize: 200, projectId: '',
};

/** One browser that has been let in. Per-browser, so signing out of Chrome
 *  does not sign out of Firefox, and a stolen grant is one revoke away. */
export interface ClipperGrant {
  id: string;
  /** Secret. Never leaves the door except to the browser that earned it. */
  token: string;
  browser: string;
  createdAt: string;
  lastUsedAt: string;
}

/** A browser waiting at the door while the user decides. */
interface PendingPair {
  id: string;
  code: string;
  browser: string;
  expiresAt: number;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  token?: string;
  /** Set once approved, so a withdrawal can take the grant back with it. */
  grantId?: string;
}

interface ClipperState {
  port: number; running: boolean; extensionDir: string;
  prefs: ClipperPrefs; grants: ClipperGrant[]; pending: PendingPair | null;
}

const state: ClipperState = {
  port: 0, running: false, extensionDir: '',
  prefs: { ...DEFAULT_PREFS }, grants: [], pending: null,
};
let deps: ClipperDeps | null = null;

const PAIR_WINDOW_MS = 2 * 60 * 1000;   // a request the user ignores dies quietly

// ─── the extension folder the user can actually reach ───────────────────────

/** macOS treats an .app as a single file: Chrome's "Load unpacked" picker
 *  cannot descend into Resources/. So a packaged copy is mirrored out to
 *  <projectsRoot>/_extension — a plain folder in Finder, refreshed on every
 *  launch so an updated app ships an updated extension without the user
 *  re-picking anything. A dev checkout is used where it lies (edits stay live). */
function mirrorExtension(src: string): string {
  try {
    if (!src || !fs.existsSync(src)) return src;
    if (!src.includes('.app/Contents/')) return src;             // dev checkout
    const dest = path.join(deps!.projectsRoot(), '_extension');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(src, dest, { recursive: true });
    return dest;
  } catch {
    return src;                                                  // show the bundle path rather than nothing
  }
}

// ─── grants + preferences (one file, <userData>/clipper.json) ───────────────

function configFile(): string { return path.join(deps!.userDataDir, 'clipper.json'); }

function persist(): void {
  try {
    fs.writeFileSync(configFile(), JSON.stringify({
      port: state.port, prefs: state.prefs, grants: state.grants, updatedAt: new Date().toISOString(),
    }, null, 2));
  } catch { /* the in-memory copy still works for this session */ }
}

/** Load grants + prefs. Unknown/garbage pref fields fall back to the default
 *  rather than reaching the browser as `undefined`. */
function loadConfig(): void {
  let stored: any = {};
  try {
    const f = configFile();
    if (fs.existsSync(f)) stored = JSON.parse(fs.readFileSync(f, 'utf-8')) || {};
  } catch { /* a fresh config is written below */ }

  state.prefs = normalizePrefs(stored.prefs);
  state.grants = Array.isArray(stored.grants)
    ? stored.grants.filter((g: any) => g && typeof g.token === 'string' && g.token.length >= 24)
    : [];

  // A copy paired under the old pasted-key build keeps working: the single key
  // becomes a grant like any other, revocable from Settings.
  if (!state.grants.length && typeof stored.token === 'string' && stored.token.length >= 24) {
    state.grants.push({
      id: uid(), token: stored.token, browser: 'Paired with a key',
      createdAt: stored.updatedAt || new Date().toISOString(),
      lastUsedAt: stored.updatedAt || new Date().toISOString(),
    });
  }
  persist();
}

function normalizePrefs(raw: any): ClipperPrefs {
  const p = (raw && typeof raw === 'object') ? raw : {};
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  return {
    contextMenu: bool(p.contextMenu, DEFAULT_PREFS.contextMenu),
    hoverBadge: bool(p.hoverBadge, DEFAULT_PREFS.hoverBadge),
    shortcut: bool(p.shortcut, DEFAULT_PREFS.shortcut),
    notify: bool(p.notify, DEFAULT_PREFS.notify),
    minSize: Math.max(60, Math.min(1200, Number(p.minSize) || DEFAULT_PREFS.minSize)),
    projectId: typeof p.projectId === 'string' ? p.projectId : '',
  };
}

/** Constant-time compare so a token can't be walked byte by byte. */
function sameSecret(given: string, known: string): boolean {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(known);
  if (a.length !== b.length) return false;
  try { return nodeCrypto.timingSafeEqual(a, b); } catch { return false; }
}

/** Which browser is calling — or null if none of them. */
function grantFor(given: string): ClipperGrant | null {
  if (!given) return null;
  for (const g of state.grants) if (sameSecret(given, g.token)) return g;
  return null;
}

function touch(g: ClipperGrant): void {
  const now = new Date().toISOString();
  // Once a minute is enough to answer "when was this browser last used" —
  // writing the config on every clipped frame would be silly.
  if (Date.parse(now) - Date.parse(g.lastUsedAt || 0 as any) > 60_000) {
    g.lastUsedAt = now;
    persist();
  }
}

// ─── the handshake that replaced the pasted key ─────────────────────────────
//
// The browser asks to come in; HJEN Studio asks the human; the token is handed
// back over the same loopback connection. It is never shown, never copied, and
// never typed — so there is nothing to leak by pasting into the wrong window.
//
// The four-digit code is shown in BOTH places. It is not a password: it is how
// the user confirms the dialog belongs to the browser they just clicked in,
// and not to something else on the machine that asked at the same moment.

function startPairing(browser: string): PendingPair {
  const pair: PendingPair = {
    id: uid(),
    code: String(nodeCrypto.randomInt(1000, 10000)),
    browser: String(browser || 'A browser').slice(0, 40),
    expiresAt: Date.now() + PAIR_WINDOW_MS,
    status: 'pending',
  };
  state.pending = pair;

  deps!.askApproval({ browser: pair.browser, code: pair.code })
    .then(allowed => {
      // A request the user sat on past the window is dead even if they
      // eventually click Allow — the browser has already stopped listening.
      if (state.pending !== pair || pair.status !== 'pending') return;
      if (Date.now() > pair.expiresAt) { pair.status = 'expired'; return; }
      if (!allowed) { pair.status = 'denied'; return; }

      const grant: ClipperGrant = {
        id: uid(),
        token: nodeCrypto.randomBytes(32).toString('base64url'),
        browser: pair.browser,
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
      };
      state.grants.push(grant);
      persist();
      pair.status = 'approved';
      pair.token = grant.token;
      pair.grantId = grant.id;
    })
    .catch(() => { pair.status = 'denied'; });

  return pair;
}

function pairStatus(id: string): { status: string; token?: string; code?: string } {
  const p = state.pending;
  if (!p || p.id !== id) return { status: 'unknown' };
  if (p.status === 'pending' && Date.now() > p.expiresAt) p.status = 'expired';
  if (p.status === 'approved' && p.token) {
    const token = p.token;
    state.pending = null;                        // one claim, then it is spent
    return { status: 'approved', token };
  }
  return { status: p.status, code: p.code };
}

// ─── bytes ──────────────────────────────────────────────────────────────────

/** CDNs lie through URLs — name the file after what the bytes actually are,
 *  the same discipline the hunt download and save-image-base64 handlers use. */
function sniffExt(buf: Buffer): string {
  if (buf.slice(0, 4).toString('binary') === 'RIFF' && buf.slice(8, 12).toString('binary') === 'WEBP') return '.webp';
  if (buf.slice(4, 12).toString('binary') === 'ftypavif') return '.avif';
  if (buf[0] === 0x89 && buf[1] === 0x50) return '.png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return '.jpg';
  if (buf.slice(0, 4).toString('binary').startsWith('GIF8')) return '.gif';
  if (buf.slice(0, 5).toString('binary') === '<?xml' || buf.slice(0, 4).toString('binary') === '<svg') return '.svg';
  return '';
}

const hostOf = (u: string): string => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'web'; } };
const uid = (): string => nodeCrypto.randomBytes(5).toString('hex');
const stamp = (): string => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);

/** Pull the bytes ourselves when the extension could not (CORS-locked CDN).
 *  Sends the page as Referer — most image hosts key hotlink rules off it. */
async function fetchBytes(url: string, referer?: string): Promise<Buffer> {
  const headers: Record<string, string> = {
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  };
  if (referer) { headers.referer = referer; try { headers.origin = new URL(referer).origin; } catch { /* no origin */ } }
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`The image host answered ${res.status}.`);
  return Buffer.from(await res.arrayBuffer());
}

// ─── the save ───────────────────────────────────────────────────────────────

export interface ClipRequest {
  /** Raw image bytes, base64 or a full data: URL. Preferred — preserves GIF animation. */
  image?: string;
  /** The remote src. Used for provenance, dedupe, and as the byte fallback. */
  imageUrl?: string;
  /** The page it was clipped from. */
  pageUrl?: string;
  pageTitle?: string;
  alt?: string;
  /** Target project. Falls back to the project the app last had open. */
  projectId?: string;
}

export interface ClipResult {
  ok: boolean;
  reason?: string;
  message?: string;
  duplicate?: boolean;
  path?: string;
  projectId?: string;
  projectName?: string;
  count?: number;
}

async function saveClip(body: ClipRequest): Promise<ClipResult> {
  const d = deps!;
  const projects = d.readProjects();
  if (projects.length === 0) return { ok: false, reason: 'no_project', message: 'No projects yet — make one in HJEN Studio first.' };

  // An explicit menu pick wins; then a project pinned in Settings; then
  // whichever project the app has open. A pinned project that was since
  // deleted must not silently misfile the clip — it falls through.
  const candidates = [String(body.projectId || ''), state.prefs.projectId, d.lastProjectId() || ''];
  const project = candidates.reduce<{ id: string; name: string; slug: string } | undefined>(
    (found, id) => found || (id ? projects.find(p => p.id === id) : undefined), undefined,
  ) || projects[0];

  // ── bytes: the extension's copy first, our own fetch as the fallback ──
  let buf: Buffer;
  try {
    const raw = String(body.image || '');
    if (raw) {
      buf = Buffer.from(raw.includes(',') && raw.slice(0, 5) === 'data:' ? raw.slice(raw.indexOf(',') + 1) : raw, 'base64');
    } else if (body.imageUrl) {
      buf = await fetchBytes(body.imageUrl, body.pageUrl);
    } else {
      return { ok: false, reason: 'no_image', message: 'No image in the request.' };
    }
  } catch (err: any) {
    return { ok: false, reason: 'fetch_failed', message: err?.message || 'Could not read the image.' };
  }
  if (buf.length < 128) return { ok: false, reason: 'too_small', message: 'That file is empty or truncated.' };

  const ext = sniffExt(buf);
  if (!ext) return { ok: false, reason: 'not_an_image', message: 'Those bytes are not an image or a GIF.' };
  if (ext === '.svg') return { ok: false, reason: 'not_an_image', message: 'SVG is vector, not a reference frame.' };

  // ── already in the set? provenance URL is the identity ──
  const stageFile = d.stageDataPath(project.slug, 2);
  let stage: any = {};
  try { if (fs.existsSync(stageFile)) stage = JSON.parse(fs.readFileSync(stageFile, 'utf-8')) || {}; } catch { stage = {}; }
  const refs: any[] = Array.isArray(stage.refs) ? stage.refs : [];
  const src = String(body.imageUrl || '');
  if (src && refs.some(r => r.imageUrl === src)) {
    return { ok: true, duplicate: true, projectId: project.id, projectName: project.name, count: refs.length };
  }

  // ── write the frame into {project}/_references/ ──
  const host = hostOf(body.pageUrl || body.imageUrl || '');
  const dir = path.join(d.projectsRoot(), project.slug, '_references');
  const fileName = `clip_${host.replace(/[^\w.-]+/g, '_')}_${stamp()}_${uid()}${ext}`;
  const filePath = path.join(dir, fileName);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, buf);
  } catch (err: any) {
    return { ok: false, reason: 'write_failed', message: err?.message || 'Could not write into the project folder.' };
  }

  // ── append to the References set. Why / Take / Leave are left EMPTY on
  //    purpose: the sign warnings then hold the set open until the user
  //    writes them. A clipped frame is a candidate, not a signed reference. ──
  const ref = {
    id: uid() + Date.now().toString(36).slice(-4),
    tag: host,
    intent: String(body.pageTitle || body.alt || 'Clipped from the web').slice(0, 160),
    imagePath: filePath,
    imageUrl: src,
    sourceUrl: String(body.pageUrl || ''),
    sourceName: host,
    why: '', take: '', leave: '',
    palette: 'mid',
  };
  try {
    fs.mkdirSync(path.dirname(stageFile), { recursive: true });
    fs.writeFileSync(stageFile, JSON.stringify({ ...stage, refs: [...refs, ref], updatedAt: new Date().toISOString() }, null, 2));
  } catch (err: any) {
    return { ok: false, reason: 'write_failed', message: err?.message || 'Could not update the References set.' };
  }

  try { d.notify({ projectId: project.id, kind: 'references' }); } catch { /* window may be closed */ }
  return { ok: true, path: filePath, projectId: project.id, projectName: project.name, count: refs.length + 1 };
}

// ─── the door ───────────────────────────────────────────────────────────────

/** Extension origins pass; a real web page's origin never does. */
function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true;                       // origin-less GET from the worker
  return /^(chrome|moz|safari-web)-extension:\/\//.test(origin);
}

function send(res: any, status: number, payload: unknown, origin?: string): void {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': origin || '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-max-age': '86400',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function bearer(req: any): string {
  const h = String(req.headers.authorization || '');
  if (h.toLowerCase().startsWith('bearer ')) return h.slice(7).trim();
  try { return new URL(req.url, 'http://127.0.0.1').searchParams.get('t') || ''; } catch { return ''; }
}

function readJson(req: any, res: any, origin: string | undefined, then: (payload: any) => void): void {
  let body = '';
  let killed = false;
  req.on('data', (c: any) => {
    body += c;
    if (body.length > MAX_BODY) { killed = true; req.destroy(); }
  });
  req.on('end', () => {
    if (killed) return;
    try { then(JSON.parse(body || '{}')); }
    catch { send(res, 400, { ok: false, reason: 'bad_json' }, origin); }
  });
  req.on('error', () => { /* client hung up */ });
}

function handle(req: any, res: any): void {
  const origin = req.headers.origin as string | undefined;
  const route = (req.url || '/').split('?')[0];

  if (req.method === 'OPTIONS') { send(res, 204, {}, origin); return; }
  if (!originAllowed(origin)) { send(res, 403, { ok: false, reason: 'origin' }, origin); return; }

  const grant = grantFor(bearer(req));

  // /ping is open on purpose — the extension must be able to tell "Studio is
  // not running" from "Studio is running but this browser is not signed in".
  if (route === '/hjen/ping') {
    send(res, 200, {
      ok: true, app: 'HJEN Studio', version: deps!.appVersion, port: state.port,
      paired: !!grant,
      account: grant ? deps!.account() : null,
      browser: grant ? grant.browser : null,
    }, origin);
    return;
  }

  // ── Sign in. No key, no clipboard: the browser asks, the app asks the user.
  if (route === '/hjen/pair/request' && req.method === 'POST') {
    readJson(req, res, origin, (payload) => {
      // One at a time — a spammed door must not stack dialogs on the user.
      if (state.pending && state.pending.status === 'pending' && Date.now() < state.pending.expiresAt) {
        send(res, 429, { ok: false, reason: 'busy', message: 'Another sign-in is already waiting in HJEN Studio.' }, origin);
        return;
      }
      const pair = startPairing(String(payload?.browser || 'A browser'));
      send(res, 200, { ok: true, requestId: pair.id, code: pair.code, expiresIn: PAIR_WINDOW_MS }, origin);
    });
    return;
  }

  // The browser gives up (Cancel, or the page closed). Without this, a request
  // nobody answers holds the door shut against every OTHER browser until it
  // expires — so withdrawing is part of the protocol, not a nicety. A stale
  // Allow click is already harmless: startPairing drops an answer whose
  // request is no longer the pending one.
  if (route === '/hjen/pair/request' && req.method === 'DELETE') {
    let id = '';
    try { id = new URL(req.url, 'http://127.0.0.1').searchParams.get('id') || ''; } catch { /* no id */ }
    if (state.pending && state.pending.id === id) {
      // Racing the user: they may have clicked Allow in the instant the
      // browser gave up. A grant nobody ever claimed is a dead row in the
      // Signed-in list, so it leaves with the request that made it.
      const orphan = state.pending.grantId;
      if (orphan) {
        state.grants = state.grants.filter(g => g.id !== orphan);
        persist();
      }
      state.pending = null;
    }
    send(res, 200, { ok: true }, origin);
    return;
  }

  // The browser waits here. The token is handed back exactly once.
  if (route === '/hjen/pair/claim' && req.method === 'GET') {
    let id = '';
    try { id = new URL(req.url, 'http://127.0.0.1').searchParams.get('id') || ''; } catch { /* no id */ }
    const st = pairStatus(id);
    send(res, 200, { ok: true, ...st, account: st.token ? deps!.account() : undefined }, origin);
    return;
  }

  // ── Sign out. The browser hands its own grant back.
  if (route === '/hjen/pair' && req.method === 'DELETE') {
    if (grant) {
      state.grants = state.grants.filter(g => g.id !== grant.id);
      persist();
    }
    send(res, 200, { ok: true }, origin);
    return;
  }

  if (!grant) {
    send(res, 401, { ok: false, reason: 'unpaired', message: 'This browser is not signed in to HJEN Studio.' }, origin);
    return;
  }
  touch(grant);

  // The browser asks the app what it is allowed to do. Every save method is a
  // switch in Settings → Browser; the extension holds none of this itself.
  if (route === '/hjen/settings' && req.method === 'GET') {
    send(res, 200, { ok: true, prefs: state.prefs }, origin);
    return;
  }

  if (route === '/hjen/projects' && req.method === 'GET') {
    const projects = deps!.readProjects().map(p => ({ id: p.id, name: p.name, slug: p.slug }));
    send(res, 200, { ok: true, projects, activeProjectId: deps!.lastProjectId() }, origin);
    return;
  }

  if (route === '/hjen/reference' && req.method === 'POST') {
    readJson(req, res, origin, (payload: ClipRequest) => {
      saveClip(payload)
        .then(r => send(res, r.ok ? 200 : 400, r, origin))
        .catch(err => send(res, 500, { ok: false, reason: 'threw', message: String(err?.message || err) }, origin));
    });
    return;
  }

  send(res, 404, { ok: false, reason: 'no_route' }, origin);
}

/** Bind the first free port in the range so a second Mac app (or a stale
 *  process) never silently steals the address the extension is pointed at. */
function listenFrom(server: any, port: number): void {
  server.once('error', (err: any) => {
    if (err?.code === 'EADDRINUSE' && port < PORT_LAST) { listenFrom(server, port + 1); return; }
    console.warn('[hjen-clipper] could not bind', err?.message || err);
  });
  server.listen(port, '127.0.0.1', () => {
    state.port = port;
    state.running = true;
    persist();
    console.log(`[hjen-clipper] listening on 127.0.0.1:${port}`);
  });
}

export function startClipper(d: ClipperDeps): void {
  deps = d;
  loadConfig();
  state.extensionDir = mirrorExtension(d.extensionDir);
  try {
    const server = http.createServer(handle);
    listenFrom(server, PORT_FIRST);
  } catch (err) {
    console.warn('[hjen-clipper] failed to start', err);
  }
}

/** What Settings → Browser reads. Tokens never appear here — the app has no
 *  reason to show a secret it hands out directly over the loopback. */
export interface ClipperStatus {
  running: boolean; port: number; url: string;
  extensionDir: string; prefs: ClipperPrefs;
  browsers: Array<{ id: string; browser: string; createdAt: string; lastUsedAt: string }>;
}

export function clipperStatus(): ClipperStatus {
  return {
    running: state.running,
    port: state.port,
    url: `http://127.0.0.1:${state.port}`,
    extensionDir: state.extensionDir || deps?.extensionDir || '',
    prefs: { ...state.prefs },
    browsers: state.grants.map(g => ({
      id: g.id, browser: g.browser, createdAt: g.createdAt, lastUsedAt: g.lastUsedAt,
    })),
  };
}

/** Sign one browser out from the app's side. */
export function clipperRevoke(id: string): ClipperStatus {
  state.grants = state.grants.filter(g => g.id !== id);
  persist();
  return clipperStatus();
}

/** Sign every browser out at once. */
export function clipperRevokeAll(): ClipperStatus {
  state.grants = [];
  persist();
  return clipperStatus();
}

/** Settings → Browser writes here. The extension picks it up on its next
 *  ping (every popup open, every save) — no reinstall, no re-pairing. */
export function clipperSetPrefs(patch: Partial<ClipperPrefs>): ClipperStatus {
  state.prefs = normalizePrefs({ ...state.prefs, ...(patch || {}) });
  persist();
  return clipperStatus();
}

// ─── downloading the extension ──────────────────────────────────────────────

/** "Show folder" only helps the person sitting at THIS Mac. A download is the
 *  portable form: one .zip that can go to a second machine, to a colleague, or
 *  into a support thread — and, once the extension is in the stores, this is
 *  the button that becomes a store link without the surrounding UI moving.
 *
 *  Zipped with the OS's own archiver rather than a dependency: `ditto` writes
 *  the same format Finder's Compress does, so the receiving end just
 *  double-clicks it. --keepParent so the archive expands to a NAMED folder
 *  instead of spraying manifest.json into Downloads. */
export const CLIPPER_TARGETS = ['chrome', 'firefox', 'safari'] as const;
export type ClipperTarget = (typeof CLIPPER_TARGETS)[number];

export interface ClipperDownloadResult {
  ok: boolean;
  /** Absolute path of the .zip that was written. */
  path?: string;
  error?: string;
}

/** A path that does not exist yet — never silently overwrite a file the user
 *  may have already sent to someone. */
function freePath(dir: string, base: string, ext: string): string {
  let p = path.join(dir, base + ext);
  for (let n = 2; fs.existsSync(p) && n < 100; n++) p = path.join(dir, `${base} ${n}${ext}`);
  return p;
}

export async function clipperDownload(
  target: ClipperTarget,
  destDir: string,
): Promise<ClipperDownloadResult> {
  if (!CLIPPER_TARGETS.includes(target)) return { ok: false, error: `Unknown browser "${target}".` };

  const src = path.join(state.extensionDir || deps?.extensionDir || '', target);
  if (!src || !fs.existsSync(src)) {
    return { ok: false, error: 'The extension folder is missing from this build. Reinstall HJEN Studio.' };
  }

  const version = deps?.appVersion || '0';
  const name = `HJEN-Clipper-${target}-v${version}`;
  // Staged under userData so the zip expands to a folder named for the build,
  // not a bare "chrome" that says nothing six months from now in Downloads.
  const holder = path.join(deps!.userDataDir, `clipper-zip-${target}`);
  const inner = path.join(holder, name);

  try {
    fs.rmSync(holder, { recursive: true, force: true });
    fs.mkdirSync(holder, { recursive: true });
    fs.cpSync(src, inner, { recursive: true });

    // The install steps ship INSIDE the archive: whoever receives it has the
    // zip and nothing else — not this Settings page, not the app.
    const readme = path.join(state.extensionDir || '', 'README.md');
    if (fs.existsSync(readme) && !fs.existsSync(path.join(inner, 'README.md'))) {
      fs.copyFileSync(readme, path.join(inner, 'README.md'));
    }

    const out = freePath(destDir, name, '.zip');
    await zipFolder(inner, out);
    return { ok: true, path: out };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    try { fs.rmSync(holder, { recursive: true, force: true }); } catch { /* temp */ }
  }
}

/** The OS's own archiver, so no dependency is added for one button.
 *
 *  `zip -X` rather than macOS's `ditto`: ditto sequesters extended attributes
 *  into a __MACOSX/._* shadow tree, and the person who unzips this on Windows
 *  sees every file twice. -X drops those attributes; nothing in an extension
 *  folder needs them. */
function zipFolder(srcFolder: string, outFile: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { execFile } = require('node:child_process');
  return new Promise((resolve, reject) => {
    execFile(
      'zip',
      ['-r', '-q', '-X', outFile, path.basename(srcFolder)],
      { cwd: path.dirname(srcFolder) },
      (err: Error | null, _out: string, stderr: string) => {
        if (err) reject(new Error(stderr?.trim() || err.message));
        else resolve();
      },
    );
  });
}
