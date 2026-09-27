// Use plain CommonJS require to avoid esModuleInterop edge cases.
// Electron v33 exports `app`, `BrowserWindow`, `ipcMain` directly on the module.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const electron = require('electron');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('node:path');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('node:fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const os = require('node:os');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const childProcess = require('node:child_process');
// `crypto` collides with the DOM Crypto global TypeScript pulls in.
// Aliased to `nodeCrypto` so the type checker resolves to node:crypto.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeCrypto = require('node:crypto');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pathToFileURL } = require('node:url');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeHttp = require('node:http');
// TS (module:CommonJS) would downlevel `import()` to require(), which cannot load
// an ESM file:// URL — keep the NATIVE dynamic import at runtime via Function.
const esmImport: (u: string) => Promise<any> = new Function('u', 'return import(u)') as any;

const { app, BrowserWindow, Menu, MenuItem, ipcMain, dialog, protocol, net, nativeImage, screen } = electron as typeof import('electron');

// Context-Agents engine (MAIN-side; the recipe stays server-side). Registered
// once at startup with its MAIN dependencies injected — see app.whenReady().
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { registerContextAgents } = require('./contextAgents');

// The Eye (MAIN-side; EYE_READ_SYS never crosses IPC). Same pattern.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { registerEye } = require('./eye');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { registerSwap } = require('./swap');
// IDEA — canonical Saudi Ad Voice N0-N8 graph runner.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { registerIdea } = require('./idea');

// The browser door — a fixed-port localhost bridge the HJEN Clipper extension
// posts clipped web images through, straight into a project's References.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { startClipper, clipperStatus, clipperRevoke, clipperRevokeAll, clipperSetPrefs, clipperDownload } = require('./clipper');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resolveTool, requireTool, describeMissing, toolsStatus, refreshTools, repairPath } = require('./tools');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  isProviderCreditExhausted,
  isTransientProviderFailure,
  readableProviderError,
  shouldRetryLlmReason,
  frameSkillModelRoutes,
  runLlmWithFallback,
} = require('./providerFallback') as typeof import('./providerFallback');

console.log('[hjen-main] Electron loaded. Type of app:', typeof app, 'keys:', Object.keys(electron).slice(0, 8));

// Seedance 2 returns 4K clips encoded in HEVC/H.265. Chromium has no built-in
// HEVC decoder, so the in-app <video> preview renders a black frame stuck at
// 0:00 even though the file is valid (macOS plays it via VideoToolbox). This
// switch routes HEVC decode through the OS platform decoder so previews play.
// Must be set before app.whenReady().
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport');

// Register a privileged custom scheme so the renderer can load local files
// without base64 IPC round-trips. Must be done BEFORE app.whenReady().
protocol.registerSchemesAsPrivileged([
  { scheme: 'hjen-file', privileges: { secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } },
]);

let mainWindow: any = null;

// ─── Single-instance lock ───────────────────────────────────────────────────
// Only one HJEN Studio may run per machine. If a second copy is launched
// (double-click, `open`, a deep-link handoff), the OS routes to us via
// `second-instance`; we surface the existing window instead of opening a new
// one. Requesting the lock BEFORE app is ready means a failed acquisition
// quits before 'ready' fires — no second window ever flashes. Applies in dev
// and in the packaged .app alike.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event: any, argv: string[]) => {
    console.log('[hjen-main] second-instance blocked — focusing existing window');
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
    // A deep-link handed off from the second instance (macOS usually delivers
    // via 'open-url', but Windows/linux + some launch paths pass it in argv).
    try {
      const link = (argv || []).find((a) => typeof a === 'string' && a.startsWith('hjen-studio://'));
      if (link) handleDeepLink(link);
    } catch { /* ignore */ }
  });
}

// ─── which side macOS puts the window buttons on ────────────────────────────
// macOS moves close/minimise/zoom to the RIGHT of the title bar when the
// SYSTEM language is right-to-left — Arabic, Hebrew, Farsi, Urdu. That is the
// OS's decision, not the app's: HJEN's own interface stays English either way.
// The top bar reserves a 96px gutter for those buttons, and it was hardcoded to
// the left — so on an Arabic Mac the buttons landed on top of the account name
// while the left gutter sat empty. This tells the renderer which side to leave.
const RTL_LANG = /^(ar|he|fa|ur|yi|dv|ps|ug|ckb|sd)\b/i;
function trafficLightSide(): 'left' | 'right' {
  if (process.platform !== 'darwin') return 'left';
  try {
    // getPreferredSystemLanguages is the OS's own ordered preference list —
    // the same thing macOS reads to decide the button side. The other two are
    // fallbacks for older Electron / odd configurations.
    const candidates = [
      ...((app as any).getPreferredSystemLanguages?.() ?? []),
      (app as any).getSystemLocale?.() ?? '',
      app.getLocale(),
    ].filter((l: string) => typeof l === 'string' && l);
    const first = String(candidates[0] || '').replace(/_/g, '-');
    return RTL_LANG.test(first) ? 'right' : 'left';
  } catch { return 'left'; }
}

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 760,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#121212',   // match app --bg (graphite palette) so the
                                  // native title-bar / edges never show a seam
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: true,
      // Passed as an argument, not an IPC call, so preload can read it
      // synchronously and the gutter is on the right side at FIRST paint —
      // an async answer would show one frame of the wrong layout.
      additionalArguments: [`--hjen-traffic-lights=${trafficLightSide()}`],
    },
  });

  // Spell-check suggestion menu. Chromium underlines misspellings out of
  // the box, but Electron only ships the dictionary suggestions in the
  // context-menu event params — building the menu (with "Add to dict",
  // standard cut/copy/paste, etc.) is the app's job.
  mainWindow.webContents.on('context-menu', (_event: any, params: any) => {
    const menu = new Menu();

    // Spelling suggestions for the word under the cursor, if any.
    for (const suggestion of (params.dictionarySuggestions || [])) {
      menu.append(new MenuItem({
        label: suggestion,
        click: () => mainWindow?.webContents.replaceMisspelling(suggestion),
      }));
    }
    if (params.misspelledWord) {
      if ((params.dictionarySuggestions || []).length > 0) {
        menu.append(new MenuItem({ type: 'separator' }));
      }
      menu.append(new MenuItem({
        label: `Add "${params.misspelledWord}" to dictionary`,
        click: () => mainWindow?.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      }));
      menu.append(new MenuItem({ type: 'separator' }));
    }

    // Standard edit commands when relevant.
    if (params.isEditable) {
      menu.append(new MenuItem({ role: 'cut',   enabled: params.editFlags?.canCut }));
      menu.append(new MenuItem({ role: 'copy',  enabled: params.editFlags?.canCopy }));
      menu.append(new MenuItem({ role: 'paste', enabled: params.editFlags?.canPaste }));
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({ role: 'selectAll' }));
    } else if (params.selectionText && params.selectionText.trim()) {
      menu.append(new MenuItem({ role: 'copy' }));
    }

    if (menu.items.length > 0 && mainWindow) {
      menu.popup({ window: mainWindow });
    }
  });

  // Use a couple of common dictionaries. en-US covers the prompt language;
  // the user can extend via Settings later if Arabic needs Apple's system
  // dict (Chromium doesn't ship Arabic spell check yet).
  mainWindow.webContents.session.setSpellCheckerLanguages(['en-US']);

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // A detached panel window (Mood Board / Timeline) is a child of the SESSION,
  // not of the app: when the studio goes, its panels go with it. Otherwise a
  // headless board keeps the app alive on macOS with no way back to the studio.
  // Nulling mainWindow is what makes `activate` below able to rebuild it.
  mainWindow.on('closed', () => {
    for (const w of panelWins.values()) { try { if (!w.isDestroyed()) w.close(); } catch { /* gone */ } }
    panelWins.clear();
    mainWindow = null;
  });

  // Sync the unified gateway setting into the renderer's localStorage so the
  // renderer-side doors (openai.ts image, gemini.ts) see the same source as the
  // main-process doors. Reads env (dev harness) OR the saved gateway.json.
  const gwSync = gatewaySettings();
  mainWindow.webContents.on('did-finish-load', () => {
    if (gwSync) {
      const base = JSON.stringify(`${gwSync.url.replace(/\/$/, '')}/v1/openai`);
      const tok = JSON.stringify(gwSync.token);
      mainWindow?.webContents.executeJavaScript(
        `localStorage.setItem('hjen.gateway.baseURL', ${base}); localStorage.setItem('hjen.gateway.token', ${tok});`
      ).catch(() => { /* renderer not ready */ });
    } else {
      mainWindow?.webContents.executeJavaScript(
        `localStorage.removeItem('hjen.gateway.baseURL'); localStorage.removeItem('hjen.gateway.token');`
      ).catch(() => { /* renderer not ready */ });
    }
  });
};

// ─── hjen-studio:// deep-links + local control port (MCP live-bridge) ────────
// Makes the deep-links the MCP emits actually open the exact view, and lets the
// MCP hot-reload a doc it just wrote so the artist watches it change.
app.setAsDefaultProtocolClient('hjen-studio');

function navigateRenderer(projectId: string | null, view: string, entity?: string): void {
  try {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    mainWindow.webContents.send('hjen:navigate', { projectId, view, entity });
  } catch { /* ignore */ }
}

function handleDeepLink(rawUrl: string): void {
  // hjen-studio://project/{id}/{view}[/{entity}]
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'hjen-studio:') return;
    const parts = [u.hostname, ...u.pathname.split('/')].filter(Boolean);
    if (parts[0] === 'project') navigateRenderer(parts[1] || null, parts[2] || 'overview', parts[3]);
  } catch { /* ignore */ }
}

app.on('open-url', (event: any, url: string) => { event.preventDefault(); handleDeepLink(url); });

// Held HTTP responses for /command — the MCP drives a REAL app action and waits
// for the renderer to answer. Keyed by requestId; the renderer replies via the
// hjen:command-result IPC (below), which resolves the held response.
const pendingCommands = new Map<string, { res: any; timer: NodeJS.Timeout }>();
ipcMain.on('hjen:command-result', (_e: any, payload: { requestId: string; result: any }) => {
  const p = pendingCommands.get(payload?.requestId);
  if (!p) return;
  clearTimeout(p.timer);
  pendingCommands.delete(payload.requestId);
  try { p.res.writeHead(200, { 'content-type': 'application/json' }); p.res.end(JSON.stringify(payload.result ?? { ok: true })); } catch { /* connection gone */ }
});

function startControlPort(): void {
  try {
    const server = nodeHttp.createServer((req: any, res: any) => {
      let body = '';
      req.on('data', (c: any) => { body += c; if (body.length > 4_000_000) req.destroy(); });
      req.on('end', () => {
        let data: any = {}; try { data = JSON.parse(body || '{}'); } catch { /* ignore */ }
        if (req.method === 'POST' && req.url === '/navigate') { navigateRenderer(data.projectId ?? null, data.view || 'overview', data.entity); }
        else if (req.method === 'POST' && req.url === '/reload') { try { mainWindow?.webContents.send('hjen:reload', { projectId: data.projectId ?? null, kind: data.kind || 'all' }); } catch { /* ignore */ } }
        else if (req.method === 'POST' && req.url === '/command') {
          // Drive a REAL app action and HOLD the response until the renderer
          // answers (or a generous timeout) — the MCP→app command bridge.
          if (!mainWindow) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, reason: 'no_window' })); return; }
          const requestId = `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const timer = setTimeout(() => {
            if (pendingCommands.has(requestId)) { pendingCommands.delete(requestId); try { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, reason: 'timeout' })); } catch { /* gone */ } }
          }, 600_000);
          pendingCommands.set(requestId, { res, timer });
          try { mainWindow.webContents.send('hjen:command', { requestId, action: String(data.action || ''), args: data.args ?? {} }); }
          catch { clearTimeout(timer); pendingCommands.delete(requestId); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, reason: 'send_failed' })); }
          return; // held — resolved by hjen:command-result
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      try { fs.writeFileSync(path.join(app.getPath('userData'), 'mcp-control.json'), JSON.stringify({ port, pid: process.pid, updatedAt: new Date().toISOString() }, null, 2)); } catch { /* ignore */ }
      console.log(`[hjen-control] listening on 127.0.0.1:${port}`);
    });
  } catch (err) { console.warn('[hjen-control] failed to start', err); }
}

// ─── Auto-update ─────────────────────────────────────────────────────────────
// Shipped desktop copies keep themselves current: on launch (packaged builds
// only) we check the release feed configured in electron-builder's `publish`
// block, download any newer version in the background, and install it on quit.
// electron-updater is required lazily inside a try/catch so a dev run without
// the dependency (or a build with no publish feed) never crashes — it just
// skips the check. The feed is provider-agnostic: whether releases live on a
// public GitHub repo or our own host, only package.json `build.publish` changes.
// Hoisted so the focus-check + the renderer's "Restart to update" action can
// reach the same instance the event handlers were bound on.
let autoUpdaterRef: any = null;
let lastUpdateCheck = 0;
/** Set once a version has finished downloading, so the Check button can say
 *  "ready — restart" instead of pretending to look again. */
let updateReadyVersion: string | null = null;
/** Live download percentage, so a manual check can show progress rather than
 *  a button that appears to do nothing for four hundred megabytes. */
let updateProgress = 0;
const UPDATE_POLL_MS = 3 * 60 * 60 * 1000;   // periodic check while the app stays open
const UPDATE_FOCUS_THROTTLE_MS = 30 * 60 * 1000; // don't re-check on every focus flicker
const checkForUpdatesSafe = () => {
  if (!autoUpdaterRef) return;
  lastUpdateCheck = Date.now();
  autoUpdaterRef.checkForUpdates().catch((e: any) => console.log('[hjen-update] check failed:', e?.message || e));
};

const initAutoUpdate = () => {
  if (!app.isPackaged) return; // dev builds are updated by rebuilding, not the feed
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { autoUpdater } = require('electron-updater');
    autoUpdaterRef = autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true; // safety net: applies on any later quit
    autoUpdater.on('error', (err: any) => console.log('[hjen-update] error:', err?.message || err));
    autoUpdater.on('checking-for-update', () => console.log('[hjen-update] checking…'));
    autoUpdater.on('update-available', (info: any) => {
      console.log('[hjen-update] available:', info?.version);
      try { mainWindow?.webContents.send('hjen:update-downloading', { version: info?.version }); } catch { /* window gone */ }
    });
    autoUpdater.on('update-not-available', () => console.log('[hjen-update] up to date'));
    autoUpdater.on('download-progress', (p: any) => {
      updateProgress = Math.round(p?.percent || 0);
      console.log(`[hjen-update] ${updateProgress}%`);
      try { mainWindow?.webContents.send('hjen:update-progress', { percent: updateProgress }); } catch { /* window gone */ }
    });
    autoUpdater.on('update-downloaded', (info: any) => {
      updateReadyVersion = info?.version || 'new';
      console.log('[hjen-update] downloaded', info?.version, '— ready to install');
      // Tell the RENDERER a version is ready → it shows the in-app "Restart to
      // update" badge live, even if the app is never quit (Claude-style).
      try { mainWindow?.webContents.send('hjen:update-ready', { version: info?.version }); } catch { /* window gone */ }
    });
    // 1) check on launch, 2) check every few hours while open, 3) check when the
    // user returns to the window — so a long-open app still learns about a release.
    checkForUpdatesSafe();
    setInterval(checkForUpdatesSafe, UPDATE_POLL_MS);
    try {
      mainWindow?.on('focus', () => {
        if (Date.now() - lastUpdateCheck > UPDATE_FOCUS_THROTTLE_MS) checkForUpdatesSafe();
      });
    } catch { /* no window yet — the interval still covers it */ }
  } catch (e: any) {
    console.log('[hjen-update] skipped (electron-updater not available):', e?.message || e);
  }
};

/** Renderer → main: the user pressed "Check for updates".
 *
 *  The app already checks by itself on launch, on an interval and on focus — but
 *  a person who has just been told a fix exists wants to ASK, now, and get an
 *  answer. Silence is indistinguishable from a broken updater. This returns the
 *  real state, including the version they are on, so "up to date" is checkable
 *  rather than a claim. */
ipcMain.handle('hjen:check-for-updates', async () => {
  const current = app.getVersion();
  if (!app.isPackaged) {
    return { ok: true, state: 'dev' as const, current,
      message: 'This is a development build — it updates by rebuilding, not from the release feed.' };
  }
  if (!autoUpdaterRef) {
    return { ok: false, state: 'unsupported' as const, current,
      message: 'The updater is not available in this build.' };
  }
  if (updateReadyVersion) {
    return { ok: true, state: 'ready' as const, current, version: updateReadyVersion };
  }
  try {
    lastUpdateCheck = Date.now();
    const res: any = await autoUpdaterRef.checkForUpdates();
    const found = res?.updateInfo?.version;
    // electron-updater answers with the feed's version whether or not it is
    // newer, so the comparison is ours to make.
    if (found && found !== current && res?.downloadPromise !== undefined) {
      return { ok: true, state: 'downloading' as const, current, version: found, percent: updateProgress };
    }
    if (found && found !== current) {
      return { ok: true, state: 'available' as const, current, version: found };
    }
    return { ok: true, state: 'current' as const, current };
  } catch (e: any) {
    return { ok: false, state: 'error' as const, current, message: String(e?.message || e).slice(0, 240) };
  }
});

/** The Mac app menu, so "Check for Updates…" sits where every Mac user already
 *  looks for it — under the application's own name, above Settings. Electron's
 *  default menu has no such item; without this the only way to ask was to find
 *  the button inside Settings. The rest of the template is the standard one, so
 *  Copy/Paste, Minimise, Close and the window list keep working. */
function installAppMenu(): void {
  const name = app.getName();
  const template: any[] = [
    {
      label: name,
      submenu: [
        { role: 'about', label: `About ${name}` },
        // The handler is attached below, where autoUpdaterRef is in scope.
        { label: 'Check for Updates…', click: () => undefined },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'Cmd+,',
          click: () => { try { mainWindow?.webContents.send('hjen:navigate', { projectId: null, view: 'settings' }); } catch { /* no window */ } },
        },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  // Wire the update item to the same code path the in-app button uses, and
  // report the answer in a dialog — a menu item that does nothing visible reads
  // as broken.
  template[0].submenu[1].click = async () => {
    const current = app.getVersion();
    if (!app.isPackaged || !autoUpdaterRef) {
      await dialog.showMessageBox(mainWindow ?? undefined, {
        type: 'info', message: `HJEN Studio ${current}`,
        detail: 'This build does not update from the release feed.', buttons: ['OK'],
      });
      return;
    }
    if (updateReadyVersion) {
      const { response } = await dialog.showMessageBox(mainWindow ?? undefined, {
        type: 'info', message: `Version ${updateReadyVersion} is ready`,
        detail: 'Restart HJEN Studio to start using it.',
        buttons: ['Restart now', 'Later'], defaultId: 0, cancelId: 1,
      });
      if (response === 0) { try { autoUpdaterRef.quitAndInstall(); } catch { /* ignore */ } }
      return;
    }
    try {
      lastUpdateCheck = Date.now();
      const res: any = await autoUpdaterRef.checkForUpdates();
      const found = res?.updateInfo?.version;
      await dialog.showMessageBox(mainWindow ?? undefined, {
        type: 'info',
        message: found && found !== current ? `Version ${found} is downloading` : `HJEN Studio ${current}`,
        detail: found && found !== current
          ? 'It downloads in the background — you will be offered a restart when it is ready.'
          : 'You are on the latest version.',
        buttons: ['OK'],
      });
    } catch (e: any) {
      await dialog.showMessageBox(mainWindow ?? undefined, {
        type: 'warning', message: 'Could not check for updates',
        detail: String(e?.message || e).slice(0, 300), buttons: ['OK'],
      });
    }
  };
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Renderer → main: the user clicked "Restart to update" on the in-app badge.
ipcMain.handle('hjen:restart-to-update', () => {
  try { autoUpdaterRef?.quitAndInstall(); return { ok: true }; }
  catch (e: any) { return { ok: false, message: String(e?.message || e) }; }
});

app.whenReady().then(() => {
  // Serve any path under the user's home with the hjen-file:// scheme.
  // The renderer just does <img src="hjen-file:///absolute/path/to/image.jpg" />
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Readable } = require('node:stream');
  const HJEN_MIME: Record<string, string> = {
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/x-m4v', '.ogv': 'video/ogg',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.avif': 'image/avif',
    '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.aac': 'audio/aac', '.ogg': 'audio/ogg',
    '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
    '.json': 'application/json', '.txt': 'text/plain', '.pdf': 'application/pdf',
  };
  protocol.handle('hjen-file', (request) => {
    // URL form: hjen-file:///absolute/path  →  url.pathname is "/absolute/path"
    const u = new URL(request.url);
    const fp = decodeURIComponent(u.pathname);
    try {
      const stat = fs.statSync(fp);
      if (!stat.isFile()) return new Response('not found', { status: 404 });
      const total = stat.size;
      const type = HJEN_MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream';
      // <video> streams + SEEKS via byte-range requests and needs 206 Partial
      // Content. net.fetch('file://') ignores Range (always 200) → video playback
      // is flaky/fails while images (a single request) always work. Serve the file
      // ourselves with real Range support.
      const range = request.headers.get('range') || request.headers.get('Range');
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        let start = m && m[1] !== '' ? parseInt(m[1], 10) : 0;
        let end = m && m[2] !== '' ? parseInt(m[2], 10) : total - 1;
        if (!Number.isFinite(start) || start < 0) start = 0;
        if (!Number.isFinite(end) || end >= total) end = total - 1;
        if (start > end) { start = 0; end = total - 1; }
        const body = Readable.toWeb(fs.createReadStream(fp, { start, end })) as unknown as ReadableStream;
        return new Response(body, {
          status: 206,
          headers: {
            'Content-Type': type, 'Accept-Ranges': 'bytes',
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Content-Length': String(end - start + 1),
            // ACAO so a crossOrigin="anonymous" <video>/<img> yields a CLEAN canvas
            // (the Emulsion Video scrub preview draws frames → getImageData).
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
      const whole = Readable.toWeb(fs.createReadStream(fp)) as unknown as ReadableStream;
      return new Response(whole, {
        status: 200,
        headers: { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': String(total), 'Access-Control-Allow-Origin': '*' },
      });
    } catch {
      // fall back to the previous behavior for anything odd (e.g. non-file URLs)
      return net.fetch(`file://${fp}`);
    }
  });
  // ─── Dock icon (HJEN logo) ────────────────────────────────────────────────
  // In a packaged .app the baked .icns wins; this covers `electron .` dev runs
  // (and is a harmless fallback in production) so the dock shows the HJEN H
  // mark instead of the generic Electron mask. Silently no-ops until the
  // artwork is dropped at app/build/appicon.png.
  try {
    if (process.platform === 'darwin' && app.dock) {
      const iconCandidates = [
        path.join(__dirname, '..', 'build', 'appicon.png'),
        path.join(process.resourcesPath || '', 'appicon.png'),
      ];
      for (const p of iconCandidates) {
        try {
          if (p && fs.existsSync(p)) {
            const img = electron.nativeImage.createFromPath(p);
            if (!img.isEmpty()) {
              app.dock.setIcon(img);
              const s = img.getSize();
              console.log(`[hjen-main] dock icon set from ${p} (${s.width}x${s.height})`);
              break;
            }
          }
        } catch { /* ignore individual candidate */ }
      }
    }
  } catch { /* ignore */ }

  // A Mac app launched from Finder inherits /usr/bin:/bin:/usr/sbin:/sbin — no
  // Homebrew. Widen PATH once, here, before anything spawns a child, so a user
  // who HAS ffmpeg/yt-dlp installed works no matter how the app was started.
  repairPath();

  // The shipped method + profile library has to be on disk BEFORE the first
  // hjen:ca-list-profiles arrives, or Context Studio opens with an empty
  // dropdown and a MAKE button that can never enable.
  seedContextAgents();

  // Context-Agents IPC (hjen:ca-*) — inject MAIN helpers so the module needs no
  // import cycle with this side-effect-heavy file. mainWindow is a module-local
  // `let`, so it's passed via a getter (it may still be null at this instant).
  registerContextAgents({
    getWindow: () => mainWindow,
    runLlmJson,
    contextAgentsRoot,
    refCorpusRoot: hjenRefCorpusRoot,
    taskModelOverride,
  });

  // The Eye (hjen:eye-*) — READ / JUDGE / CHOOSE. Same injection pattern: the
  // recipe (EYE_READ_SYS) never leaves MAIN.
  registerEye({ runLlmJson, eyeRoot, taskModelOverride });
  registerSwap({ runLlmJson, swapRoot, taskModelOverride });
  registerIdea({
    app,
    ipcMain,
    resolveTool,
    describeMissing,
    providerKey,
    gatewaySettings,
    taskModelOverride,
  });

  createWindow();
  startControlPort();

  // Browser door. Same injection pattern as the engines above: the module owns
  // the protocol, MAIN owns where projects live.
  startClipper({
    projectsRoot: () => projectsRootPath(),
    readProjects: () => readProjects().map(p => ({ id: p.id, name: p.name, slug: p.slug })),
    stageDataPath: (slug: string, stage: number) => projectDataPath(slug, stage as StageNumber),
    lastProjectId: () => { const s = readSettings(); return typeof s.lastProjectId === 'string' ? s.lastProjectId : null; },
    userDataDir: app.getPath('userData'),
    appVersion: app.getVersion(),
    // The extension rides in Resources/ of a packaged build — a stable path
    // that survives auto-update, so a browser pointed at it keeps working.
    // Hand-assembled bundles (Resources/app symlinked to the repo) have no
    // such folder, so fall back to the repo copy rather than showing the user
    // a path that isn't there.
    extensionDir: (() => {
      const packaged = path.join(process.resourcesPath || '', 'extension');
      const repo = path.join(__dirname, '..', '..', 'extension', 'dist');
      try { if (fs.existsSync(packaged)) return packaged; } catch { /* fall through */ }
      return repo;
    })(),
    notify: ({ projectId, kind }: { projectId: string; kind: string }) => {
      try { mainWindow?.webContents.send('hjen:reload', { projectId, kind }); } catch { /* window gone */ }
    },
    // Signing a browser in is an AUTHORIZATION, so it gets the OS's own
    // authorization surface rather than a panel the user may never look at:
    // the app comes forward and asks, with the browser named and the code
    // repeated so they can see the dialog belongs to the click they just made.
    askApproval: async ({ browser, code }: { browser: string; code: string }) => {
      try {
        app.focus({ steal: true });
        if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); }
        const { response } = await dialog.showMessageBox(mainWindow ?? undefined, {
          type: 'question',
          buttons: ['Allow', "Don't allow"],
          defaultId: 0,
          cancelId: 1,
          title: 'Sign in to HJEN Studio',
          message: `${browser} wants to sign in to HJEN Studio.`,
          detail: `Code ${code}\n\nIt will be able to save images you pick into this workspace’s References. `
            + 'Allow this only if you just asked for it in that browser. You can sign it out any time in Settings → Browser.',
          noLink: true,
        });
        return response === 0;
      } catch { return false; }
    },
    // Identity is a hardcoded local profile today (see TopBarMenus PROFILE) —
    // there is no real desktop auth yet. The door reports whatever the app
    // says it is, so real accounts land here with no change on this side.
    account: () => ({ name: 'HJEN Studio', email: 'Local workspace · Offline', plan: 'PRO' }),
  });

  initAutoUpdate();
  installAppMenu();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
// Test the STUDIO, not the window count: a live detached panel window (or the
// hunt browser) would otherwise falsify `length === 0` and the Dock icon would
// stop bringing the studio back.
app.on('activate', () => { if (!mainWindow || mainWindow.isDestroyed()) createWindow(); });
// Quitting with a panel torn off must not leave an orphan window holding the
// app open through the teardown.
app.on('before-quit', () => {
  for (const w of panelWins.values()) { try { if (!w.isDestroyed()) w.destroy(); } catch { /* gone */ } }
  panelWins.clear();
});

// ============ Cloud gateway config (unified source for all provider doors) ============
// One persisted setting so the packaged app works without env vars: when a
// gateway {url, token} is saved, every provider door routes through HJEN's
// server instead of calling vendors directly. Env vars still win when present
// (for the dev test-harness). Off by default → local direct mode is untouched.

function gatewaySettings(): { url: string; token: string } | null {
  if (process.env.HJEN_GATEWAY_URL && process.env.HJEN_GATEWAY_TOKEN) {
    return { url: process.env.HJEN_GATEWAY_URL, token: process.env.HJEN_GATEWAY_TOKEN };
  }
  try {
    const f = path.join(app.getPath('userData'), 'gateway.json');
    if (fs.existsSync(f)) {
      const g = JSON.parse(fs.readFileSync(f, 'utf-8'));
      if (g?.url && g?.token) return { url: String(g.url), token: String(g.token) };
    }
  } catch { /* ignore */ }
  return null;
}

ipcMain.handle('hjen:get-gateway', () => gatewaySettings());
ipcMain.handle('hjen:set-gateway', (_e: any, cfg: { url: string; token: string } | null) => {
  const f = path.join(app.getPath('userData'), 'gateway.json');
  try {
    if (cfg && cfg.url && cfg.token) fs.writeFileSync(f, JSON.stringify({ url: cfg.url, token: cfg.token }), { mode: 0o600 });
    else if (fs.existsSync(f)) fs.unlinkSync(f);
    return true;
  } catch { return false; }
});

// ============ Cloud-first SYNC (pull: cloud → local folder) ============
// The desktop mirrors the account's server deliverables into a user-chosen folder,
// account-isolated (per-account subfolder), driven by the op-log. Pull runs on a
// timer + on demand. Push (local → cloud) is a later phase.
function syncConfigPath(): string { return path.join(app.getPath('userData'), 'sync.json'); }
function syncConfig(): { enabled: boolean; root: string } {
  try { const c = JSON.parse(fs.readFileSync(syncConfigPath(), 'utf-8')); return { enabled: !!c.enabled, root: String(c.root || '') }; }
  catch { return { enabled: false, root: '' }; }
}
function writeSyncConfig(c: { enabled: boolean; root: string }) {
  try { fs.writeFileSync(syncConfigPath(), JSON.stringify(c, null, 2)); } catch { /* best-effort */ }
}
// The account's human label (its email/name) → the per-account subfolder name.
async function syncAccountLabel(gw: { url: string; token: string }): Promise<string> {
  try {
    const r = await fetch(gw.url.replace(/\/$/, '') + '/api/me', { headers: { authorization: 'Bearer ' + gw.token } });
    if (r.ok) { const m: any = await r.json(); return String(m.email || m.name || m.id || 'account'); }
  } catch { /* fall through */ }
  return 'account';
}
let syncInFlight = false;
async function runSyncPull(): Promise<{ ok: boolean; message?: string; downloaded?: number; deleted?: number; uploaded?: number; cursor?: number }> {
  const cfg = syncConfig();
  if (!cfg.enabled || !cfg.root) return { ok: false, message: 'sync not configured' };
  const gw = gatewaySettings();
  if (!gw) return { ok: false, message: 'no account signed in (gateway)' };
  if (syncInFlight) return { ok: false, message: 'a pull is already running' };
  syncInFlight = true;
  try {
    const { pullOnce, pushOnce } = await import('./syncEngine');
    const label = await syncAccountLabel(gw);
    const cf = { gatewayUrl: gw.url, token: gw.token, root: cfg.root, accountLabel: label };
    // Pull first (cloud → local), then push the user's new local files (local →
    // cloud, add-only). The index the pull maintains keeps push from re-pushing
    // pull-written files, and the next pull skips push-uploaded gids → no echo.
    const r = await pullOnce(cf);
    let uploaded = 0;
    try { uploaded = (await pushOnce(cf)).uploaded; } catch { /* push best-effort */ }
    try { mainWindow?.webContents.send('hjen:sync-progress', { ...r, uploaded, label }); } catch { /* window gone */ }
    return { ok: true, ...r, uploaded };
  } catch (e: any) { return { ok: false, message: String(e?.message || e) }; }
  finally { syncInFlight = false; }
}
ipcMain.handle('hjen:sync-get-config', () => syncConfig());
ipcMain.handle('hjen:sync-set-enabled', (_e: any, enabled: boolean) => { const c = syncConfig(); writeSyncConfig({ ...c, enabled: !!enabled }); return syncConfig(); });
ipcMain.handle('hjen:sync-pick-folder', async () => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  const r = await dialog.showOpenDialog(win, { title: 'Choose the HJEN Studio sync folder', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths?.[0]) return { ok: false, cancelled: true };
  writeSyncConfig({ enabled: true, root: r.filePaths[0] });
  void runSyncPull();
  return { ok: true, config: syncConfig() };
});
ipcMain.handle('hjen:sync-pull-now', () => runSyncPull());
// Auto-pull every 5 minutes while enabled (cheap: only downloads new ops).
setInterval(() => { const c = syncConfig(); if (c.enabled && c.root && gatewaySettings()) void runSyncPull(); }, 5 * 60 * 1000);

// ============ API keys ============

ipcMain.handle('hjen:get-api-key', () => {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const keyFile = path.join(app.getPath('userData'), 'openai_key.txt');
  if (fs.existsSync(keyFile)) return fs.readFileSync(keyFile, 'utf-8').trim() || null;
  return null;
});
ipcMain.handle('hjen:set-api-key', (_e: any, key: string) => {
  fs.writeFileSync(path.join(app.getPath('userData'), 'openai_key.txt'), key, { mode: 0o600 });
  return true;
});

ipcMain.handle('hjen:get-google-key', () => {
  if (process.env.GOOGLE_API_KEY) return process.env.GOOGLE_API_KEY;
  const keyFile = path.join(app.getPath('userData'), 'google_key.txt');
  if (fs.existsSync(keyFile)) return fs.readFileSync(keyFile, 'utf-8').trim() || null;
  return null;
});
ipcMain.handle('hjen:set-google-key', (_e: any, key: string) => {
  fs.writeFileSync(path.join(app.getPath('userData'), 'google_key.txt'), key, { mode: 0o600 });
  return true;
});

ipcMain.handle('hjen:get-anthropic-key', () => {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const keyFile = path.join(app.getPath('userData'), 'anthropic_key.txt');
  if (fs.existsSync(keyFile)) return fs.readFileSync(keyFile, 'utf-8').trim() || null;
  return null;
});
ipcMain.handle('hjen:set-anthropic-key', (_e: any, key: string) => {
  fs.writeFileSync(path.join(app.getPath('userData'), 'anthropic_key.txt'), key, { mode: 0o600 });
  return true;
});

// ============ Models per task (Settings → Models dashboard) ============
// Overrides only — defaults live in src/lib/models/registry.ts (the ONE
// module). Stored in userData so main-side callers can read the same file.

function modelsConfigPath(): string {
  return path.join(app.getPath('userData'), 'models_config.json');
}
ipcMain.handle('hjen:models-config-read', () => {
  try {
    const j = JSON.parse(fs.readFileSync(modelsConfigPath(), 'utf-8'));
    return { ok: true, config: j };
  } catch { return { ok: true, config: { version: 1, tasks: {} } }; }
});
ipcMain.handle('hjen:models-config-write', (_e: any, args: { config: unknown }) => {
  fs.writeFileSync(modelsConfigPath(), JSON.stringify(args?.config ?? { version: 1, tasks: {} }, null, 2));
  return { ok: true };
});

// ── Transcription (ASR) config — swappable engine for the BREAKDOWN dialogue ──
// layer. Stored in settings.json under `transcription`. Default is local whisper
// (Anwar's preference); switchable to the OpenAI Whisper API or any compatible
// endpoint (WhisperFlow) from Settings. Arabic-first: default model + 'auto'
// language detection (force 'ar' when needed).
type TranscriptionConfig = {
  engine: 'local-whisper' | 'openai' | 'custom';
  model: string;
  language: string;                 // 'auto' | 'ar' | 'en' | …
  endpoint?: string;                // custom (OpenAI-compatible /audio/transcriptions)
};
function defaultTranscription(): TranscriptionConfig {
  // large-v3 is the Arabic-capable default — never 'base' (weak on Arabic).
  return { engine: 'local-whisper', model: 'large-v3', language: 'auto' };
}
function readTranscriptionConfig(): TranscriptionConfig {
  const s = readSettings().transcription;
  const d = defaultTranscription();
  if (!s || typeof s !== 'object') return d;
  return {
    engine: s.engine === 'openai' || s.engine === 'custom' ? s.engine : 'local-whisper',
    model: typeof s.model === 'string' && s.model ? s.model : d.model,
    language: typeof s.language === 'string' && s.language ? s.language : d.language,
    endpoint: typeof s.endpoint === 'string' ? s.endpoint : undefined,
  };
}
ipcMain.handle('hjen:transcription-config-read', () => ({ ok: true, config: readTranscriptionConfig() }));
ipcMain.handle('hjen:transcription-config-write', (_e: any, args: { config: Partial<TranscriptionConfig> }) => {
  const cur = readTranscriptionConfig();
  writeSettings({ transcription: { ...cur, ...(args?.config || {}) } });
  return { ok: true, config: readTranscriptionConfig() };
});
// لغة العرض — content display language ('en' | 'ar' | 'both'). English is
// always the source; 'ar'/'both' show the arabic-translate task's rendition.
ipcMain.handle('hjen:lang-mode-get', () => {
  const m = readSettings().contentLang;
  return { ok: true, mode: m === 'ar' || m === 'both' ? m : 'en' };
});
ipcMain.handle('hjen:lang-mode-set', (_e: any, args: { mode?: string }) => {
  const m = args?.mode;
  writeSettings({ contentLang: m === 'ar' || m === 'both' ? m : 'en' });
  return { ok: true };
});

/** Main-side task→model lookup (override or caller's fallback). */
function taskModelOverride(task: string): string | null {
  try {
    const j = JSON.parse(fs.readFileSync(modelsConfigPath(), 'utf-8'));
    const m = j?.tasks?.[task];
    return typeof m === 'string' && m ? m : null;
  } catch { return null; }
}

// ─── hjen:llm-json — one text-LLM door, three direct vendors ─────────────
// The renderer resolves {task → provider+model} through the registry and
// passes them here; this handler only executes. No middlemen (house law):
// api.anthropic.com / api.openai.com / generativelanguage.googleapis.com.

function providerKey(provider: string): string | null {
  const envName = provider === 'anthropic' ? 'ANTHROPIC_API_KEY'
    : provider === 'openai' ? 'OPENAI_API_KEY' : 'GOOGLE_API_KEY';
  if (process.env[envName]) return process.env[envName] as string;
  const file = provider === 'anthropic' ? 'anthropic_key.txt'
    : provider === 'openai' ? 'openai_key.txt' : 'google_key.txt';
  const f = path.join(app.getPath('userData'), file);
  try { return fs.existsSync(f) ? (fs.readFileSync(f, 'utf-8').trim() || null) : null; } catch { return null; }
}

// ─── ONE way out of the app for a vendor call ───────────────────────────────
// A signed-in user has NO local provider key — the whole point of the gateway
// is that the key lives on the server (house law: the client is a terminal).
// Every door that asked `providerKey()` and bailed on null was therefore dead
// for exactly the people the product is built for, while the image and video
// doors — which had always checked `!key && !gatewayOn` — kept working. That
// is why only SOME makes failed.
//
// providerAuth + providerFetch are the single pair every text/vision call site
// now uses (house law: verified specs live in ONE module everyone imports).

/** Can this provider be called at all, and with what credential?
 *  `key` is the real local key, or the placeholder `'x'` when the gateway will
 *  substitute the real one — so a call site builds its URL and headers exactly
 *  as before and needs no branch of its own. `null` means genuinely no way in. */
function providerAuth(provider: string): { key: string | null; viaGateway: boolean } {
  const gw = gatewaySettings();
  const viaGateway = !!(gw?.url && gw?.token);
  const key = providerKey(provider);
  return { key: key ?? (viaGateway ? 'x' : null), viaGateway };
}

/** POST to a vendor — through the gateway when one is configured (the server
 *  swaps in the real key, meters the spend and refunds a failure), straight to
 *  the vendor otherwise. The gateway passes an upstream failure back with its
 *  own status and body, so a caller's error handling is unchanged either way. */
async function providerFetch(
  provider: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  const gw = gatewaySettings();
  if (gw?.url && gw?.token) {
    const localKey = providerKey(provider);
    try {
      const gatewayResponse = await fetch(`${gw.url.replace(/\/$/, '')}/v1/llm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${gw.token}` },
        body: JSON.stringify({ provider, upstreamUrl: url, headers, body }),
        signal,
      });
      // HJEN credit and vendor credit are separate ledgers. When the gateway
      // cannot serve the request, retry once against the explicitly configured
      // desktop key. This covers upstream billing exhaustion and short 502/503/
      // 504 proxy outages without treating ordinary rate limits as retryable.
      if (localKey && !gatewayResponse.ok) {
        const errorBody = await gatewayResponse.clone().text().catch(() => '');
        if (isProviderCreditExhausted(gatewayResponse.status, errorBody) || isTransientProviderFailure(gatewayResponse.status)) {
          return fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
        }
      }
      return gatewayResponse;
    } catch (error: any) {
      if (localKey && error?.name !== 'AbortError') {
        return fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
      }
      throw error;
    }
  }
  return fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
}

/** The image's REAL format, read from its magic bytes. An extension can lie, and
 *  the old extension-only map defaulted EVERY unrecognised file to image/jpeg —
 *  so a Frameset AVIF went upstream labelled jpeg and came back as a confusing
 *  parse error instead of an honest "unsupported format". Callers that must send
 *  a readable frame convert first (vlmReadablePath); this only labels the truth. */
function sniffImageMime(buf: any, ext: string): string {
  if (buf.length >= 12) {
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    if (buf.toString('ascii', 4, 8) === 'ftyp') {
      const brand = buf.toString('ascii', 8, 12);
      if (brand === 'avif' || brand === 'avis') return 'image/avif';
      if (brand.startsWith('hei') || brand === 'mif1' || brand === 'msf1') return 'image/heic';
    }
  }
  return ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif'
    : ext === '.avif' ? 'image/avif' : (ext === '.heic' || ext === '.heif') ? 'image/heic' : 'image/jpeg';
}

// Vision vendors cap inline images independently of the model context window
// (Anthropic currently rejects any single base64 payload above 10 MiB). PDF
// extraction deliberately preserves the source pixels for Make, so its PNGs can
// exceed that ceiling. Build a separate, disposable analysis buffer here: the
// file on disk is never rewritten and image generation still receives the full
// source.
function visionImageBuffer(buf: Buffer): { mime: string; data: Buffer } {
  const limit = 7_500_000; // leaves headroom for base64/vendor envelope rules
  const originalMime = sniffImageMime(buf, '');
  if (buf.length <= limit && originalMime !== 'image/avif' && originalMime !== 'image/heic') {
    return { mime: originalMime, data: buf };
  }
  try {
    let img = nativeImage.createFromBuffer(buf);
    if (img.isEmpty()) return { mime: originalMime, data: buf };
    const size = img.getSize();
    const longest = Math.max(size.width, size.height);
    if (longest > 2400) {
      const scale = 2400 / longest;
      img = img.resize({
        width: Math.max(1, Math.round(size.width * scale)),
        height: Math.max(1, Math.round(size.height * scale)),
        quality: 'best',
      });
    }
    for (const quality of [86, 76, 64, 52]) {
      const jpeg = img.toJPEG(quality);
      if (jpeg.length > 0 && jpeg.length <= limit) return { mime: 'image/jpeg', data: jpeg };
    }
  } catch { /* upstream will return the honest format/size error */ }
  return { mime: originalMime, data: buf };
}

function readImagesB64(paths?: string[]): Array<{ mime: string; data: string }> {
  const out: Array<{ mime: string; data: string }> = [];
  for (const p of paths ?? []) {
    if (!p || !fs.existsSync(p)) continue;
    try {
      const buf = fs.readFileSync(p);
      const vision = visionImageBuffer(buf);
      out.push({ mime: vision.mime, data: vision.data.toString('base64') });
    } catch { /* skip unreadable image */ }
  }
  return out;
}

// Audio for multimodal analysis (BREAKDOWN's sound pass). Only the Google
// Gemini endpoint accepts inline audio in the same shape as images; other
// providers get captions text instead — so callers always send captions too.
function readAudioB64(paths?: string[]): Array<{ mime: string; data: string }> {
  const out: Array<{ mime: string; data: string }> = [];
  for (const p of paths ?? []) {
    if (!p || !fs.existsSync(p)) continue;
    try {
      const ext = path.extname(p).toLowerCase();
      const mime = ext === '.mp3' ? 'audio/mp3' : ext === '.wav' ? 'audio/wav'
        : ext === '.ogg' ? 'audio/ogg' : ext === '.flac' ? 'audio/flac'
        : ext === '.aac' ? 'audio/aac' : 'audio/mp4';   // .m4a / .mp4
      out.push({ mime, data: fs.readFileSync(p).toString('base64') });
    } catch { /* skip unreadable audio */ }
  }
  return out;
}

// The provider-fetch body of the text-LLM door, extracted verbatim from the
// former inline `hjen:llm-json` handler so MAIN-side callers (contextAgents.ts)
// can reuse the exact same execution — same key resolution (providerKey), same
// gateway-vs-direct branch (gatewaySettings), same response parsing. The IPC
// handler below is now a thin passthrough, so its behaviour is unchanged.
export async function runLlmJson(args: {
  provider: string; model: string; system: string; prompt: string;
  maxTokens?: number; imagePaths?: string[]; audioPaths?: string[];
  /** Ask the vendor to CONSTRAIN the reply to valid JSON instead of merely
   *  requesting it in the prompt. Measured 2026-07-31 on the Eye's read: without
   *  it, ~17% of replies came back with malformed JSON (an unescaped quote
   *  inside a value), intermittently — the same reply parsed fine on retry.
   *  Opt-in and additive: every existing caller is unaffected. Anthropic has no
   *  equivalent flag, so there it stays a prompt-level instruction. */
  jsonMode?: boolean;
}): Promise<{ ok: boolean; text?: string; truncated?: boolean; model?: string; usage?: { inputTokens: number; outputTokens: number }; reason?: string; message?: string }> {
  const provider = String(args?.provider ?? '');
  const model = String(args?.model ?? '');
  const prompt = String(args?.prompt ?? '').trim();
  if (!prompt) return { ok: false, reason: 'empty_prompt', message: 'Nothing to send.' };
  const { key } = providerAuth(provider);
  if (!key) return { ok: false, reason: 'no_key', message: `No ${provider} API key. Add it in Settings → API Keys.` };
  const maxTokens = Math.min(Math.max(args?.maxTokens ?? 8192, 512), 32000);
  const images = readImagesB64(args?.imagePaths);
  const audio = provider === 'google' ? readAudioB64(args?.audioPaths) : [];
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 500_000);
  try {
    let url = '', headers: Record<string, string> = {}, body: any = null;
    if (provider === 'anthropic') {
      url = 'https://api.anthropic.com/v1/messages';
      headers = { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' };
      const content: any[] = images.map(i => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.data } }));
      content.push({ type: 'text', text: prompt });
      body = { model, max_tokens: maxTokens, system: args.system || '', messages: [{ role: 'user', content }] };
    } else if (provider === 'openai') {
      url = 'https://api.openai.com/v1/chat/completions';
      headers = { 'content-type': 'application/json', authorization: `Bearer ${key}` };
      const content: any[] = images.map(i => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.data}` } }));
      content.push({ type: 'text', text: prompt });
      body = {
        model, max_completion_tokens: maxTokens,
        messages: [
          ...(args.system ? [{ role: 'system', content: args.system }] : []),
          { role: 'user', content },
        ],
        ...(args.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      };
    } else if (provider === 'google') {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${key}`;
      headers = { 'content-type': 'application/json' };
      const parts: any[] = [];
      if (args.system) parts.push({ text: args.system });
      for (const i of images) parts.push({ inline_data: { mime_type: i.mime, data: i.data } });
      for (const a of audio) parts.push({ inline_data: { mime_type: a.mime, data: a.data } });
      parts.push({ text: prompt });
      body = {
        contents: [{ role: 'user', parts }],
        generationConfig: {
          maxOutputTokens: maxTokens,
          ...(args.jsonMode ? { responseMimeType: 'application/json' } : {}),
        },
      };
    } else {
      return { ok: false, reason: 'bad_provider', message: `Unknown provider "${provider}".` };
    }
    // Gateway when configured (server holds the real key + meters quota),
    // vendor directly otherwise. The app never ships a real provider key.
    const res = await providerFetch(provider, url, headers, body, ac.signal);
    if (!res.ok) {
      const errBody = await res.text();
      const reason = isTransientProviderFailure(res.status)
        ? 'provider_unavailable'
        : (res.status === 401 || res.status === 403)
          ? 'auth_error'
          : isProviderCreditExhausted(res.status, errBody)
            ? 'provider_quota'
            : 'api_error';
      return {
        ok: false,
        reason,
        message: readableProviderError(provider, res.status, errBody),
      };
    }
    const data: any = await res.json();
    let text = '';
    let truncated = false;
    let inputTokens = 0;
    let outputTokens = 0;
    if (provider === 'anthropic') {
      text = Array.isArray(data?.content) ? data.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim() : '';
      truncated = data?.stop_reason === 'max_tokens';
      inputTokens = Number(data?.usage?.input_tokens || 0);
      outputTokens = Number(data?.usage?.output_tokens || 0);
    } else if (provider === 'openai') {
      const choice = data?.choices?.[0];
      text = String(choice?.message?.content ?? '').trim();
      truncated = choice?.finish_reason === 'length';
      inputTokens = Number(data?.usage?.prompt_tokens || 0);
      outputTokens = Number(data?.usage?.completion_tokens || 0);
    } else {
      const cand = data?.candidates?.[0];
      text = Array.isArray(cand?.content?.parts) ? cand.content.parts.map((p: any) => p.text ?? '').join('\n').trim() : '';
      truncated = cand?.finishReason === 'MAX_TOKENS';
      inputTokens = Number(data?.usageMetadata?.promptTokenCount || 0);
      outputTokens = Number(data?.usageMetadata?.candidatesTokenCount || 0);
    }
    if (!text) return { ok: false, reason: 'empty', message: `${provider} returned no text.` };
    return { ok: true, text, truncated, model, usage: { inputTokens, outputTokens } };
  } catch (err: any) {
    const aborted = err?.name === 'AbortError';
    return { ok: false, reason: aborted ? 'timeout' : 'network', message: String(err?.message || err).slice(0, 300) };
  } finally {
    clearTimeout(timer);
  }
}

ipcMain.handle('hjen:llm-json', async (_e: any, args: {
  provider: string; model: string; system: string; prompt: string;
  maxTokens?: number; imagePaths?: string[]; audioPaths?: string[];
}) => runLlmJson(args));

ipcMain.handle('hjen:get-replicate-key', () => {
  if (process.env.REPLICATE_API_TOKEN) return process.env.REPLICATE_API_TOKEN;
  const keyFile = path.join(app.getPath('userData'), 'replicate_key.txt');
  if (fs.existsSync(keyFile)) return fs.readFileSync(keyFile, 'utf-8').trim() || null;
  return null;
});
ipcMain.handle('hjen:set-replicate-key', (_e: any, key: string) => {
  fs.writeFileSync(path.join(app.getPath('userData'), 'replicate_key.txt'), key, { mode: 0o600 });
  return true;
});

ipcMain.handle('hjen:get-ark-key', () => {
  if (process.env.ARK_API_KEY) return process.env.ARK_API_KEY;
  const keyFile = path.join(app.getPath('userData'), 'ark_key.txt');
  if (fs.existsSync(keyFile)) return fs.readFileSync(keyFile, 'utf-8').trim() || null;
  return null;
});
ipcMain.handle('hjen:set-ark-key', (_e: any, key: string) => {
  fs.writeFileSync(path.join(app.getPath('userData'), 'ark_key.txt'), key, { mode: 0o600 });
  return true;
});

// ============ Replicate proxy ============
//
// The renderer process can't talk to Replicate directly: Replicate's API
// doesn't send CORS headers, so cross-origin requests from the renderer
// fail. We proxy through the main process and return the polled-to-completion
// prediction result (or a clear error string).
//
// We resolve the model's latest version dynamically so the caller passes
// only the human-readable "owner/name" and we always hit the newest hash.

async function resolveReplicateLatestVersion(token: string, modelRef: string): Promise<string> {
  // modelRef is "owner/name" (no version pin)
  const res = await fetch(`https://api.replicate.com/v1/models/${modelRef}`, {
    headers: { Authorization: `Token ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Replicate model lookup failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const data: any = await res.json();
  const ver = data?.latest_version?.id;
  if (!ver) throw new Error(`Replicate model ${modelRef} has no published version`);
  return ver;
}

ipcMain.handle('hjen:replicate-run', async (_e: any, args: {
  model: string;          // e.g. "sczhou/codeformer"
  version?: string;       // explicit version hash, optional
  input: Record<string, any>;
  pollIntervalMs?: number;
  maxWaitMs?: number;
}) => {
  let token: string | null = process.env.REPLICATE_API_TOKEN || null;
  if (!token) {
    const keyFile = path.join(app.getPath('userData'), 'replicate_key.txt');
    if (fs.existsSync(keyFile)) token = fs.readFileSync(keyFile, 'utf-8').trim() || null;
  }
  if (!token) {
    return { ok: false, reason: 'no_key', message: 'No Replicate API token. Open Settings and add one.' };
  }

  try {
    const version = args.version ?? await resolveReplicateLatestVersion(token, args.model);

    const createRes = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        Authorization: `Token ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ version, input: args.input }),
    });
    if (!createRes.ok) {
      const body = await createRes.text();
      return { ok: false, reason: 'create_failed', message: `Replicate create failed (${createRes.status}): ${body.slice(0, 400)}` };
    }
    let prediction: any = await createRes.json();

    const interval = args.pollIntervalMs ?? 1500;
    const maxWait = args.maxWaitMs ?? 5 * 60 * 1000;
    const start = Date.now();
    while (prediction.status === 'starting' || prediction.status === 'processing') {
      if (Date.now() - start > maxWait) {
        return { ok: false, reason: 'timeout', message: `Replicate prediction timed out after ${maxWait}ms (id=${prediction.id})` };
      }
      await new Promise(r => setTimeout(r, interval));
      const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
        headers: { Authorization: `Token ${token}` },
      });
      if (!pollRes.ok) {
        const body = await pollRes.text();
        return { ok: false, reason: 'poll_failed', message: `Replicate poll failed (${pollRes.status}): ${body.slice(0, 400)}` };
      }
      prediction = await pollRes.json();
    }

    if (prediction.status !== 'succeeded') {
      return {
        ok: false,
        reason: 'prediction_failed',
        message: `Replicate prediction ${prediction.status}: ${prediction.error || '(no error message)'}`,
      };
    }

    return {
      ok: true,
      output: prediction.output,
      predictionId: prediction.id,
      metrics: prediction.metrics ?? null,
    };
  } catch (err: any) {
    return { ok: false, reason: 'exception', message: err?.message || String(err) };
  }
});

// ============ Seedance 2.0 (BytePlus ModelArk) proxy ============
//
// Video generation API. We proxy through main for two reasons:
//   1. Same CORS issue as Replicate — the renderer can't talk to ModelArk
//      directly because the response has no Access-Control-Allow-Origin.
//   2. We need to read input image files from disk and base64-encode them
//      before posting, which the renderer can do via fetch+blob, but doing
//      it in main keeps the heavy work off the UI thread.
//
// Two calls: submit (POST /contents/generations/tasks) returns a task_id,
// then poll (GET /contents/generations/tasks/{id}) until status === 'succeeded'.
// The submit + poll loop is split across two IPC calls so the renderer can
// drive its own polling cadence + show progress text.

function arkBaseUrl(): string {
  return (process.env.ARK_BASE_URL || 'https://ark.ap-southeast.bytepluses.com/api/v3').replace(/\/$/, '');
}
function arkKeyOrNull(): string | null {
  if (process.env.ARK_API_KEY) return process.env.ARK_API_KEY;
  const keyFile = path.join(app.getPath('userData'), 'ark_key.txt');
  if (fs.existsSync(keyFile)) return fs.readFileSync(keyFile, 'utf-8').trim() || null;
  return null;
}
function imagePathToDataUri(absPath: string): string {
  if (/^(https?:|data:)/.test(absPath)) return absPath;
  if (!fs.existsSync(absPath)) throw new Error(`Image not found: ${absPath}`);
  const ext = path.extname(absPath).slice(1).toLowerCase();
  const mime =
    ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
    ext === 'webp' ? 'image/webp' :
    ext === 'gif' ? 'image/gif' :
    'image/png';
  const buf: Buffer = fs.readFileSync(absPath);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// Build the prompt string with --flags appended, matching the Seedance prompt
// format. The model parses these flags out of the prompt text itself; they
// are NOT separate JSON fields.
function buildSeedancePromptString(p: {
  prompt: string;
  resolution: string;
  duration: number;
  ratio: string;
  fps: number;
  seed?: number | null;
  cameraFixed?: boolean;
  watermark?: boolean;
}): string {
  const parts: string[] = [p.prompt.trim()];
  parts.push(`--resolution ${p.resolution}`);
  parts.push(`--duration ${p.duration}`);
  parts.push(`--ratio ${p.ratio}`);
  parts.push(`--fps ${p.fps}`);
  if (p.seed != null) parts.push(`--seed ${p.seed}`);
  if (p.cameraFixed) parts.push('--camerafixed true');
  if (!p.watermark) parts.push('--watermark false');
  return parts.join(' ');
}

ipcMain.handle('hjen:seedance-submit', async (_e: any, args: {
  prompt: string;
  /** Optional. Local absolute path or URL. If present → image-to-video mode. */
  imagePath?: string | null;
  /** Optional. Local absolute path or URL. Last-frame anchor for tail control. */
  endImagePath?: string | null;
  resolution: '480p' | '720p' | '1080p' | '4k';
  duration: number;
  ratio: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9';
  fps: number;
  seed?: number | null;
  cameraFixed?: boolean;
  watermark?: boolean;
  audio?: boolean;
  /** Override default model id. Defaults to dreamina-seedance-2-0-260128. */
  modelId?: string;
}) => {
  const key = arkKeyOrNull();
  const gwOn = !!gatewaySettings();
  if (!key && !gwOn) return { ok: false as const, reason: 'no_key', message: 'No BytePlus ARK API key. Open Settings and add ARK_API_KEY.' };

  try {
    const fullPrompt = buildSeedancePromptString({
      prompt: args.prompt,
      resolution: args.resolution,
      duration: args.duration,
      ratio: args.ratio,
      fps: args.fps,
      seed: args.seed,
      cameraFixed: args.cameraFixed,
      watermark: args.watermark,
    });

    const content: any[] = [{ type: 'text', text: fullPrompt }];
    if (args.imagePath) {
      content.push({
        type: 'image_url',
        image_url: { url: imagePathToDataUri(args.imagePath) },
        // role hint helps the model interpret multiple images. Harmless on
        // single-image submissions — the SDK silently ignores unknown fields.
        role: 'first_frame',
      });
    }
    if (args.endImagePath) {
      content.push({
        type: 'image_url',
        image_url: { url: imagePathToDataUri(args.endImagePath) },
        role: 'last_frame',
      });
    }

    const model = (args.modelId || process.env.SEEDANCE_MODEL || 'dreamina-seedance-2-0-260128').trim();
    const body = {
      model,
      content,
      generate_audio: !!args.audio,
    };

    // Cloud gateway: route submit through HJEN's server (holds ARK key + meters).
    const _gw = gatewaySettings(); const gwUrl = _gw?.url, gwToken = _gw?.token;
    const submitUrl = `${arkBaseUrl()}/contents/generations/tasks`;
    const res = gwUrl && gwToken
      ? await fetch(`${gwUrl.replace(/\/$/, '')}/v1/ark/submit`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${gwToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ arkBase: arkBaseUrl(), body }),
        })
      : await fetch(submitUrl, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
    if (!res.ok) {
      const text = await res.text();
      // Full error context — URL, status, body, model — so the UI can show
      // exactly what was attempted. Helps when the BytePlus endpoint moves
      // between regions / SDK versions.
      const detail = [
        `URL:    POST ${submitUrl}`,
        `Status: ${res.status} ${res.statusText}`,
        `Model:  ${model}`,
        `Body:   ${text || '(empty response body)'}`,
      ].join('\n');
      return { ok: false as const, reason: 'submit_failed', message: `Seedance submit failed.\n\n${detail}` };
    }
    const data: any = await res.json();
    const taskId: string | undefined = data?.id ?? data?.task_id;
    if (!taskId) return { ok: false as const, reason: 'no_task_id', message: `Seedance submit returned no task id. Raw: ${JSON.stringify(data).slice(0, 400)}` };
    return { ok: true as const, taskId, model, promptFull: fullPrompt };
  } catch (err: any) {
    return { ok: false as const, reason: 'exception', message: err?.message || String(err) };
  }
});

ipcMain.handle('hjen:seedance-poll', async (_e: any, args: { taskId: string }) => {
  const key = arkKeyOrNull();
  const _gw = gatewaySettings(); const gwUrl = _gw?.url, gwToken = _gw?.token;
  if (!key && !(gwUrl && gwToken)) return { ok: false as const, reason: 'no_key', message: 'No ARK API key' };
  try {
    const res = gwUrl && gwToken
      ? await fetch(`${gwUrl.replace(/\/$/, '')}/v1/ark/poll`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${gwToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ arkBase: arkBaseUrl(), taskId: args.taskId }),
        })
      : await fetch(`${arkBaseUrl()}/contents/generations/tasks/${encodeURIComponent(args.taskId)}`, {
          headers: { Authorization: `Bearer ${key}` },
        });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false as const, reason: 'poll_failed', message: `Seedance poll failed (${res.status}): ${text.slice(0, 400)}` };
    }
    const data: any = await res.json();
    const status: string = data?.status ?? 'unknown';
    // Video URL can live on content.video_url or top-level video_url depending on SDK version
    const videoUrl: string | null = data?.content?.video_url ?? data?.video_url ?? null;
    const usage = data?.usage ?? null;
    const errorMessage = data?.error?.message ?? data?.error ?? null;
    return { ok: true as const, status, videoUrl, usage, errorMessage, raw: data };
  } catch (err: any) {
    return { ok: false as const, reason: 'exception', message: err?.message || String(err) };
  }
});

// ============ Kling video (Kuaishou) — direct API, no middlemen ============
//
// Second video backend alongside Seedance. Kling's API differs completely:
//   • Auth   — a static API Key (console → "+ New API Key"), Bearer header.
//              (Kling also offers a legacy AccessKey/SecretKey→JWT flow; we use
//              the simpler API Key which works for ALL model versions.)
//   • Body   — structured JSON fields (NOT Seedance's --flags-in-prompt).
//   • Images — RAW base64 with NO data: prefix (Kling rejects the prefix), or URL.
//   • Routes — POST /v1/videos/{text2video|image2video}; the poll route mirrors
//              the submit route, so the client remembers which one it used.
// The submit/poll RESPONSE shape here is normalised to match Seedance's so the
// renderer's shared poll loop (src/lib/kling.ts ← mirror of seedance.ts) reuses
// the same success/fail vocabulary ('succeeded' / 'failed').

function klingKeyOrNull(): string | null {
  if (process.env.KLING_API_KEY) return process.env.KLING_API_KEY;
  const keyFile = path.join(app.getPath('userData'), 'kling_key.txt');
  if (fs.existsSync(keyFile)) return fs.readFileSync(keyFile, 'utf-8').trim() || null;
  return null;
}
function klingBaseUrl(): string {
  // Singapore endpoint = the global (outside-China) host per Kling docs.
  return (process.env.KLING_BASE_URL || 'https://api-singapore.klingai.com').replace(/\/$/, '');
}
// Kling wants RAW base64 (no `data:image/...;base64,` prefix) or a plain URL.
function imagePathToRawBase64(absPath: string): string {
  if (/^https?:/.test(absPath)) return absPath;                       // URL passthrough
  if (/^data:/.test(absPath)) return absPath.replace(/^data:[^,]+,/, ''); // strip a data-uri prefix
  if (!fs.existsSync(absPath)) throw new Error(`Image not found: ${absPath}`);
  return fs.readFileSync(absPath).toString('base64');
}
// camera_control: preset types need no config; 'simple' carries the 6-axis config
// (only one axis may be non-zero, enforced upstream in the UI).
function buildKlingCamera(type: string, config?: Record<string, number> | null): any {
  if (type !== 'simple') return { type };
  const c = config || {};
  return {
    type: 'simple',
    config: {
      horizontal: c.horizontal ?? 0, vertical: c.vertical ?? 0, pan: c.pan ?? 0,
      tilt: c.tilt ?? 0, roll: c.roll ?? 0, zoom: c.zoom ?? 0,
    },
  };
}

ipcMain.handle('hjen:get-kling-key', () => {
  if (process.env.KLING_API_KEY) return process.env.KLING_API_KEY;
  const keyFile = path.join(app.getPath('userData'), 'kling_key.txt');
  if (fs.existsSync(keyFile)) return fs.readFileSync(keyFile, 'utf-8').trim() || null;
  return null;
});
ipcMain.handle('hjen:set-kling-key', (_e: any, key: string) => {
  fs.writeFileSync(path.join(app.getPath('userData'), 'kling_key.txt'), key, { mode: 0o600 });
  return true;
});

ipcMain.handle('hjen:kling-submit', async (_e: any, args: {
  prompt: string;
  negativePrompt?: string;
  /** Optional local path or URL → switches to image-to-video. */
  imagePath?: string | null;
  /** Optional last-frame anchor (image_tail). Mutually exclusive with camera_control. */
  endImagePath?: string | null;
  modelName: string;                       // e.g. 'kling-v3', 'kling-v2-6'
  mode?: 'std' | 'pro' | '4k';             // std=720P, pro=1080P, 4k=4K
  aspectRatio?: '16:9' | '9:16' | '1:1';   // text-to-video only
  duration?: number;                       // 3..15 (model-dependent)
  cfgScale?: number | null;                // 0..1; ignored on kling-v2.x
  cameraType?: string | null;              // simple/down_back/forward_up/right_turn_forward/left_turn_forward
  cameraConfig?: Record<string, number> | null;
  sound?: boolean;                         // native audio on/off
  watermark?: boolean;                     // true = keep watermark
  externalTaskId?: string;
}) => {
  const key = klingKeyOrNull();
  const _gw = gatewaySettings(); const gwUrl = _gw?.url, gwToken = _gw?.token;
  if (!key && !(gwUrl && gwToken)) return { ok: false as const, reason: 'no_key', message: 'No Kling API key. Add it in Settings → API Keys.' };
  try {
    const isImage = !!args.imagePath;
    const videoType: 'text2video' | 'image2video' = isImage ? 'image2video' : 'text2video';
    const modelName = (args.modelName || 'kling-v3').trim();

    const body: any = { model_name: modelName, prompt: (args.prompt || '').trim() };
    if (args.negativePrompt?.trim()) body.negative_prompt = args.negativePrompt.trim();
    if (args.mode) body.mode = args.mode;
    if (args.duration != null) body.duration = String(args.duration);
    if (args.cfgScale != null && !/^kling-v2/.test(modelName)) body.cfg_scale = args.cfgScale;
    if (args.sound != null) body.sound = args.sound ? 'on' : 'off';
    if (args.watermark != null) body.watermark_info = { enabled: !!args.watermark };
    if (args.externalTaskId) body.external_task_id = args.externalTaskId;

    if (isImage) {
      body.image = imagePathToRawBase64(args.imagePath!);
      if (args.endImagePath) body.image_tail = imagePathToRawBase64(args.endImagePath);
      // camera_control ⊕ image_tail — only add camera when there's no tail frame.
      if (!args.endImagePath && args.cameraType) body.camera_control = buildKlingCamera(args.cameraType, args.cameraConfig);
    } else {
      if (args.aspectRatio) body.aspect_ratio = args.aspectRatio;
      if (args.cameraType) body.camera_control = buildKlingCamera(args.cameraType, args.cameraConfig);
    }

    // Cloud gateway: route submit through HJEN's server (holds Kling key + meters).
    const submitUrl = `${klingBaseUrl()}/v1/videos/${videoType}`;
    const res = gwUrl && gwToken
      ? await fetch(`${gwUrl.replace(/\/$/, '')}/v1/kling/submit`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${gwToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ klingBase: klingBaseUrl(), videoType, body }),
        })
      : await fetch(submitUrl, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
    if (!res.ok) {
      const text = await res.text();
      const detail = [
        `URL:    POST ${submitUrl}`,
        `Status: ${res.status} ${res.statusText}`,
        `Model:  ${modelName}`,
        `Body:   ${text || '(empty response body)'}`,
      ].join('\n');
      return { ok: false as const, reason: 'submit_failed', message: `Kling submit failed.\n\n${detail}` };
    }
    const data: any = await res.json();
    // Kling wraps everything: { code, message, data }. code 0 = success.
    if (data?.code !== 0 && data?.code !== '0') {
      return { ok: false as const, reason: 'submit_failed', message: `Kling submit error ${data?.code}: ${data?.message || '(no message)'}` };
    }
    const taskId: string | undefined = data?.data?.task_id;
    if (!taskId) return { ok: false as const, reason: 'no_task_id', message: `Kling submit returned no task id. Raw: ${JSON.stringify(data).slice(0, 400)}` };
    return { ok: true as const, taskId, model: modelName, promptFull: body.prompt, videoType };
  } catch (err: any) {
    return { ok: false as const, reason: 'exception', message: err?.message || String(err) };
  }
});

ipcMain.handle('hjen:kling-poll', async (_e: any, args: { taskId: string; videoType?: 'text2video' | 'image2video' }) => {
  const key = klingKeyOrNull();
  const _gw = gatewaySettings(); const gwUrl = _gw?.url, gwToken = _gw?.token;
  if (!key && !(gwUrl && gwToken)) return { ok: false as const, reason: 'no_key', message: 'No Kling API key' };
  try {
    const vt = args.videoType || 'image2video';
    const res = gwUrl && gwToken
      ? await fetch(`${gwUrl.replace(/\/$/, '')}/v1/kling/poll`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${gwToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ klingBase: klingBaseUrl(), videoType: vt, taskId: args.taskId }),
        })
      : await fetch(`${klingBaseUrl()}/v1/videos/${vt}/${encodeURIComponent(args.taskId)}`, {
          headers: { Authorization: `Bearer ${key}` },
        });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false as const, reason: 'poll_failed', message: `Kling poll failed (${res.status}): ${text.slice(0, 400)}` };
    }
    const data: any = await res.json();
    const d = data?.data ?? {};
    // Kling: submitted | processing | succeed | failed → Seedance vocabulary.
    const raw: string = d?.task_status ?? 'unknown';
    const status = raw === 'succeed' ? 'succeeded' : raw === 'failed' ? 'failed' : raw === 'submitted' ? 'queued' : 'running';
    const videoUrl: string | null = d?.task_result?.videos?.[0]?.url ?? null;
    const usage = { unit_deduction: d?.final_unit_deduction ?? null, balance: d?.final_balance_deduction ?? null };
    const errorMessage = raw === 'failed' ? (d?.task_status_msg ?? 'Kling task failed') : null;
    return { ok: true as const, status, videoUrl, usage, errorMessage, raw: data };
  } catch (err: any) {
    return { ok: false as const, reason: 'exception', message: err?.message || String(err) };
  }
});

// Save the downloaded MP4 + sidecar + a poster thumbnail to the projects layout.
// Mirrors hjen:save-generation but with video-specific extension + thumb source.
ipcMain.handle('hjen:save-video', (_e: any, args: {
  base64: string;
  sidecar: any;
  promptSlug: string;
  projectSlug?: string;
  projectId?: string;
  /** Absolute path to a poster image. If present, copied alongside as the
   *  thumb so the Library can render a still without decoding the mp4. */
  posterPath?: string | null;
}) => {
  const today = new Date().toISOString().slice(0, 10);
  const bucket = args.projectSlug ? args.projectSlug : '_unassigned';
  const dir = path.join(projectsRootPath(), bucket, today);
  fs.mkdirSync(dir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safeSlug = (args.promptSlug || 'untitled').slice(0, 60);
  const base = `${ts}_${safeSlug}`;
  const videoPath = path.join(dir, `${base}.mp4`);
  const jsonPath = path.join(dir, `${base}.json`);
  const thumbPath = path.join(dir, `${base}.thumb.jpg`);

  const buffer = Buffer.from(args.base64, 'base64');
  fs.writeFileSync(videoPath, buffer);
  fs.writeFileSync(jsonPath, JSON.stringify({ ...args.sidecar, kind: 'video', videoPath }, null, 2));

  // Poster thumb: if the caller provided a source image, downscale it to
  // 1024px and save as the thumb. Otherwise leave thumb missing — the
  // renderer falls back to a static placeholder.
  if (args.posterPath && fs.existsSync(args.posterPath)) {
    try {
      const native = electron.nativeImage.createFromPath(args.posterPath);
      const { width, height } = native.getSize();
      if (width > 0 && height > 0) {
        const target = Math.min(width, 1024);
        const scale = target / Math.max(1, width);
        const tw = Math.max(1, Math.round(width * scale));
        const th = Math.max(1, Math.round(height * scale));
        const thumbBuf = native.resize({ width: tw, height: th, quality: 'best' }).toJPEG(88);
        fs.writeFileSync(thumbPath, thumbBuf);
      }
    } catch (e) {
      console.warn('[save-video] poster thumb failed', e);
    }
  }

  // Bump project generation count so the Projects page reflects video work too
  let projectName = '(unassigned)';
  if (args.projectId) {
    const arr = readProjects();
    const target = arr.find(p => p.id === args.projectId);
    if (target) {
      target.generationCount = (target.generationCount || 0) + 1;
      projectName = target.name;
      writeProjects(arr);
    }
  }

  // Reuse the durable generation log so videos show up in Usage too
  try {
    const sidecar = args.sidecar || {};
    const stat = fs.statSync(videoPath);
    appendGenerationEvent({
      ts: stat.mtimeMs,
      imgPath: videoPath,
      thumbPath: fs.existsSync(thumbPath) ? thumbPath : undefined,
      jsonPath,
      dateFolder: today,
      baseName: base,
      captured: sidecar?.captured ?? null,
      promptTitle: (sidecar?.prompt || '').split(/[.!?\n,]/)[0]?.trim()?.slice(0, 100) ||
        base.split('_').slice(1).join(' ').replace(/-/g, ' '),
      finalSize: sidecar?.resolution,
      modelLabel: sidecar?.model,
      quality: undefined,
      resolution: sidecar?.resolution,
      aspect: sidecar?.ratio,
      costUsd: typeof sidecar?.estimatedCost?.usd === 'number' ? sidecar.estimatedCost.usd : undefined,
      durationMs: typeof sidecar?.durationMs === 'number' ? sidecar.durationMs : undefined,
      referencesCount: sidecar?.imagePath ? 1 : 0,
      projectId: args.projectId ?? null,
      projectName,
      projectSlug: bucket,
    });
  } catch (err) {
    console.warn('[save-video] could not append usage log', err);
  }

  return { videoPath, jsonPath, dir, thumbPath };
});

// List every saved video across a project's date folders. Mirrors
// hjen:list-project-files but for .mp4. Returned entries reuse the
// ProjectFileEntry shape with `imgPath` pointing at the video on disk.
ipcMain.handle('hjen:list-project-videos', (_e: any, args: { projectSlug?: string | null }) => {
  const bucket = args.projectSlug || '_unassigned';
  const root = path.join(projectsRootPath(), bucket);
  if (!fs.existsSync(root)) return [];

  const entries: any[] = [];
  const dateFolders = (fs.readdirSync(root) as string[]).filter((d: string) => {
    const full = path.join(root, d);
    return fs.statSync(full).isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d);
  });

  for (const dateFolder of dateFolders) {
    const dir = path.join(root, dateFolder);
    const files = fs.readdirSync(dir) as string[];
    for (const f of files) {
      if (!f.endsWith('.mp4')) continue;
      const baseName = f.slice(0, -4);
      const videoPath = path.join(dir, f);
      const jsonPath = path.join(dir, `${baseName}.json`);
      const thumbCandidate = path.join(dir, `${baseName}.thumb.jpg`);
      let sidecar: any = {};
      try { sidecar = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')); } catch {}
      const stat = fs.statSync(videoPath);
      const title =
        (sidecar?.prompt || '').split(/[.!?\n,]/)[0]?.trim()?.slice(0, 80) ||
        baseName.split('_').slice(1).join(' ').replace(/-/g, ' ');
      entries.push({
        imgPath: videoPath,
        thumbPath: fs.existsSync(thumbCandidate) ? thumbCandidate : undefined,
        jsonPath,
        dateFolder,
        baseName,
        promptTitle: title || baseName,
        // Quality tier: Seedance records `resolution` (720p/1080p/4k); Kling
        // records `mode` (std/pro/4k) instead — expose both so the take strip
        // can show a tier for either backend.
        size: sidecar?.resolution,
        mode: sidecar?.mode,
        ts: stat.mtimeMs,
        durationMs: typeof sidecar?.durationMs === 'number' ? sidecar.durationMs : undefined,
        modelLabel: sidecar?.model,
        videoSeconds: sidecar?.duration,
        // Kling stores the aspect under `aspectRatio`, Seedance under `ratio`.
        ratio: sidecar?.ratio ?? sidecar?.aspectRatio,
      });
    }
  }
  entries.sort((a, b) => b.ts - a.ts);
  return entries;
});

// Fetch a remote URL (typically a Replicate result URL) and return as base64.
// Replicate output URLs are short-lived signed URLs; the renderer reads them
// through this proxy so we get the bytes onto disk before they expire.
ipcMain.handle('hjen:fetch-url-base64', async (_e: any, url: string) => {
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    return { ok: true, base64: buf.toString('base64'), bytes: buf.length };
  } catch (err: any) {
    return { ok: false, message: err?.message || String(err) };
  }
});

// ============ Reference hunt — a visible browser the user can watch ============
//
// The References tool extracts visual search TAGS from the project's stages,
// then hunts them on real reference sites (Frameset & friends). Those sites
// sit behind Cloudflare/logins, so server-side fetch is useless — instead we
// open a REAL BrowserWindow (persist:refhunt session → the user can log in
// once and stay logged in), read the rendered page's images, screenshot it
// for the vision pass, and download chosen frames through the SAME session
// (cookies + UA carry over, so the CDN trusts us like a normal browser).

let refHuntWin: InstanceType<typeof BrowserWindow> | null = null;

ipcMain.handle('hjen:refhunt-open', async (_e: any, args: { url: string; hidden?: boolean }) => {
  try {
    if (!refHuntWin || refHuntWin.isDestroyed()) {
      refHuntWin = new BrowserWindow({
        width: 1280, height: 860, title: 'HJEN — Reference hunt',
        // hidden mode (Creative Mind's silent board hunt): never surfaces; the
        // page still loads, lays out, and downloads — throttling off so the
        // SPA settles at foreground speed.
        show: !args.hidden,
        webPreferences: {
          partition: 'persist:refhunt', nodeIntegration: false, contextIsolation: true,
          backgroundThrottling: false,
        },
      });
      refHuntWin.on('closed', () => { refHuntWin = null; });
    }
    if (!args.hidden) refHuntWin.show();
    await refHuntWin.loadURL(args.url).catch(() => { /* SPA route errors are fine — page still renders */ });
    return { ok: true };
  } catch (err: any) { return { ok: false, message: err?.message || String(err) }; }
});

ipcMain.handle('hjen:refhunt-read', async () => {
  try {
    if (!refHuntWin || refHuntWin.isDestroyed()) return { ok: false, message: 'Hunt window is not open.' };
    const wc = refHuntWin.webContents;
    const info = await wc.executeJavaScript(`(() => {
      const imgs = [...document.images]
        .map(i => ({ src: i.currentSrc || i.src, alt: i.alt || '', w: i.naturalWidth, h: i.naturalHeight }))
        .filter(i => i.src && /^https?:/.test(i.src) && i.w >= 220 && i.h >= 140);
      const seen = new Set(); const out = [];
      for (const i of imgs) { if (!seen.has(i.src)) { seen.add(i.src); out.push(i); } if (out.length >= 48) break; }
      return { url: location.href, title: document.title, images: out };
    })()`, true);
    // Screenshot is best-effort: a hidden window may not paint (macOS) — the
    // images list is the load-bearing output, never fail the read over a shot.
    let screenshotPath = '';
    try {
      const shot = await wc.capturePage();
      const dir = path.join(app.getPath('temp'), 'hjen-refhunt');
      fs.mkdirSync(dir, { recursive: true });
      screenshotPath = path.join(dir, `page-${Date.now()}.png`);
      fs.writeFileSync(screenshotPath, shot.toPNG());
    } catch { /* hidden window — no pixels, fine */ }
    return { ok: true, ...info, screenshotPath };
  } catch (err: any) { return { ok: false, message: err?.message || String(err) }; }
});

ipcMain.handle('hjen:refhunt-download', async (_e: any, args: {
  url: string; projectSlug?: string | null; fileName: string;
  /** '_references' (default — the kept set) or '_references/_candidates' (vision-pass scratch). */
  subfolder?: string; referer?: string;
}) => {
  try {
    if (!refHuntWin || refHuntWin.isDestroyed()) return { ok: false, message: 'Hunt window is not open.' };
    const wc = refHuntWin.webContents;
    const safe = (args.fileName || 'ref').replace(/[^\w.\-]+/g, '_').slice(0, 80);
    const dir = path.join(projectsRootPath(), args.projectSlug || '_unassigned', args.subfolder || '_references');
    fs.mkdirSync(dir, { recursive: true });

    // The canonical Electron path: downloadURL + will-download — rides the
    // browser's own download pipeline (session cookies, no CORS, no taint).
    // session.fetch was rejected here with ERR_BLOCKED_BY_CLIENT.
    const result = await new Promise<{ ok: true; path: string; bytes: number } | { ok: false; message: string }>((resolve) => {
      const timeout = setTimeout(() => { cleanup(); resolve({ ok: false, message: 'Download timed out.' }); }, 30_000);
      const onDownload = (_ev: any, item: any) => {
        cleanup();
        const got = item.getFilename() || '';
        const extFromItem = (got.match(/\.(png|jpe?g|webp|gif|avif)$/i)?.[0] || '.jpg').toLowerCase();
        const filePath = path.join(dir, /\.(png|jpe?g|webp|gif|avif)$/i.test(safe) ? safe : safe + extFromItem);
        item.setSavePath(filePath);
        item.once('done', (_e2: any, state: string) => {
          if (state !== 'completed') { resolve({ ok: false, message: `Download ${state}.` }); return; }
          // CDNs lie through URLs — sniff the actual bytes and fix the
          // extension, or the vision pass sends the wrong media type and
          // Anthropic rejects it ("image/jpeg not supported" on webp bytes).
          let finalPath = filePath, bytes = 0;
          try {
            bytes = fs.statSync(filePath).size;
            const head = Buffer.alloc(16);
            const fd = fs.openSync(filePath, 'r'); fs.readSync(fd, head, 0, 16, 0); fs.closeSync(fd);
            const realExt =
              head.slice(0, 4).toString('binary') === 'RIFF' && head.slice(8, 12).toString('binary') === 'WEBP' ? '.webp'
              : head.slice(4, 12).toString('binary') === 'ftypavif' ? '.avif'
              : head[0] === 0x89 && head[1] === 0x50 ? '.png'
              : head[0] === 0xff && head[1] === 0xd8 ? '.jpg'
              : head.slice(0, 4).toString('binary').startsWith('GIF8') ? '.gif'
              : null;
            if (realExt && !filePath.toLowerCase().endsWith(realExt)) {
              const renamed = filePath.replace(/\.(png|jpe?g|webp|gif|avif)$/i, '') + realExt;
              fs.renameSync(filePath, renamed);
              finalPath = renamed;
            }
          } catch { /* keep original path */ }
          resolve({ ok: true, path: finalPath, bytes });
        });
      };
      const cleanup = () => { clearTimeout(timeout); wc.session.removeListener('will-download', onDownload); };
      wc.session.once('will-download', onDownload);
      wc.downloadURL(args.url);
    });
    return result;
  } catch (err: any) { return { ok: false, message: err?.message || String(err) }; }
});

// Capture ONE image element off the rendered page as PNG — Chromium decodes
// whatever the CDN serves (AVIF/webp/…), we save pixels. No CORS, no formats.
ipcMain.handle('hjen:refhunt-capture', async (_e: any, args: {
  src: string; projectSlug?: string | null; fileName: string; subfolder?: string;
}) => {
  try {
    if (!refHuntWin || refHuntWin.isDestroyed()) return { ok: false, message: 'Hunt window is not open.' };
    const wc = refHuntWin.webContents;
    const rect = await wc.executeJavaScript(`(async () => {
      const img = [...document.images].find(i => (i.currentSrc || i.src) === ${JSON.stringify(args.src)});
      if (!img) return null;
      img.scrollIntoView({ block: 'center', inline: 'center' });
      await new Promise(r => setTimeout(r, 350));
      const r2 = img.getBoundingClientRect();
      return { x: Math.max(0, Math.round(r2.x)), y: Math.max(0, Math.round(r2.y)),
               width: Math.round(Math.min(r2.width, innerWidth - r2.x)),
               height: Math.round(Math.min(r2.height, innerHeight - r2.y)) };
    })()`, true);
    if (!rect || rect.width < 40 || rect.height < 40) return { ok: false, message: 'Image not found on the page.' };
    const shot = await wc.capturePage(rect);
    const buf = shot.toPNG();
    const safe = (args.fileName || 'ref').replace(/[^\w.\-]+/g, '_').slice(0, 80);
    const dir = path.join(projectsRootPath(), args.projectSlug || '_unassigned', args.subfolder || '_references');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, safe.endsWith('.png') ? safe : safe + '.png');
    fs.writeFileSync(filePath, buf);
    return { ok: true, path: filePath, bytes: buf.length };
  } catch (err: any) { return { ok: false, message: err?.message || String(err) }; }
});

ipcMain.handle('hjen:refhunt-close', () => {
  try { refHuntWin?.close(); } catch { /* already gone */ }
  refHuntWin = null;
  return { ok: true };
});

// ─── Native file drag-out (References grid → Finder / another HJEN window) ───
// HTML5 drag cannot hand a real FILE to the OS — it carries a bitmap and a URL.
// webContents.startDrag opens a native AppKit dragging session for the actual
// paths, so the drop lands as a genuine file in Finder, in Photoshop, or in any
// other window of this app. The renderer cancels its own dragstart and calls
// this WHILE THE MOUSE IS STILL DOWN; see ReferencesView.onTileDragStart.
//
// macOS REFUSES an empty icon (startDrag throws), and nativeImage.createFromPath
// only decodes PNG/JPEG — a hunted frame is just as often .webp / .avif / .gif.
// Three fallbacks, best fidelity first:
//   1 · decode it ourselves   (PNG / JPEG — synchronous)
//   2 · QuickLook thumbnail   (gif · webp · avif · heic · mov — macOS decodes)
//   3 · the Finder file icon  (always non-empty, so the drag always starts)
// Cached by path+mtime: every millisecond spent here is a millisecond the user
// is already dragging with no drag image under the cursor.
const DRAG_ICON_PX = 128;
const dragIconCache = new Map<string, any>();

async function dragIconFor(file: string): Promise<any | null> {
  let key = file;
  try { key = `${file}:${fs.statSync(file).mtimeMs}`; } catch { /* unstamped */ }
  const hit = dragIconCache.get(key);
  if (hit) return hit;

  const keep = (img: any): any | null => {
    if (!img || img.isEmpty()) return null;
    if (dragIconCache.size > 64) dragIconCache.clear();   // crude LRU — a cache, not a store
    dragIconCache.set(key, img);
    return img;
  };

  // 1 · straight decode. resize() with only a width keeps the aspect ratio.
  try {
    const direct = nativeImage.createFromPath(file);
    if (!direct.isEmpty()) {
      const { width } = direct.getSize();
      const out = keep(width > DRAG_ICON_PX ? direct.resize({ width: DRAG_ICON_PX, quality: 'good' }) : direct);
      if (out) return out;
    }
  } catch { /* next */ }
  // 2 · QuickLook — whatever Finder can preview, including animated formats.
  try {
    const thumb = await nativeImage.createThumbnailFromPath(file, { width: DRAG_ICON_PX, height: DRAG_ICON_PX });
    const out = keep(thumb);
    if (out) return out;
  } catch { /* next */ }
  // 3 · the generic document icon — never empty.
  try { return keep(await app.getFileIcon(file, { size: 'large' })); }
  catch { return null; }
}

ipcMain.handle('hjen:start-drag', async (event: any, args: { paths: string[] }) => {
  try {
    const wanted = Array.isArray(args?.paths) ? args.paths : [];
    // Drag only what is really on disk — a missing path makes the OS drag a
    // ghost that silently drops nothing, which reads as "the app is broken".
    const files: string[] = [];
    for (const p of wanted) {
      if (typeof p !== 'string' || !p) continue;
      try { if (fs.existsSync(p) && fs.statSync(p).isFile()) files.push(p); } catch { /* skip */ }
    }
    if (files.length === 0) return { ok: false, message: 'Those frames are not on disk.' };

    const icon = await dragIconFor(files[0]);
    if (!icon) return { ok: false, message: 'Could not build a drag image for that frame.' };

    // event.sender, NOT mainWindow: the drag must originate in the webContents
    // the gesture happened in — which makes drag-out work from a detached panel
    // window for free. `file` is required by the type even when `files` is
    // supplied; `files` overrides it, so a multi-select drag carries the set.
    event.sender.startDrag({ file: files[0], files, icon });
    return { ok: true, files: files.length };
  } catch (err: any) {
    return { ok: false, message: err?.message || String(err) };
  }
});

// ── Real-browser hunt: launch the user's Chrome (a dedicated HJEN profile so
//    their Frameset login persists), driven over CDP from the renderer. Anwar:
//    "use my logged-in browser, a real window, not inside the app." Chrome is
//    launched with --remote-allow-origins=* so the file:// renderer's CDP
//    WebSocket is accepted; main discovers the page target via fetch (no CORS).
let huntChrome: { proc: any; port: number } | null = null;

function chromeBinary(): string | null {
  const candidates = process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
       '/Applications/Chromium.app/Contents/MacOS/Chromium',
       '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
    : process.platform === 'win32'
      ? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
         'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe']
      : ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch { /* next */ } }
  return null;
}

async function chromeReady(port: number, tries = 40): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) return true; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

/** Is the debug Chrome on `port` a headless instance? null = unreachable. */
async function chromeIsHeadless(port: number): Promise<boolean | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`);
    const j: any = await r.json();
    return /headless/i.test(String(j?.Browser ?? ''));
  } catch { return null; }
}

ipcMain.handle('hjen:chrome-launch', async (_e: any, args: { url: string; headless?: boolean }) => {
  try {
    const port = 9333;
    const profile = path.join(app.getPath('userData'), 'refhunt-chrome');
    // Reuse an already-REACHABLE debug Chrome first — even one this app didn't
    // spawn. One nuance since the Creative Mind's silent hunt: a HEADLESS
    // request reuses anything, but a VISIBLE request can't ride a headless
    // instance (there is no window) — kill it and respawn visible.
    if (await chromeReady(port, 2)) {
      // Mode check: our own spawns carry their mode; orphans get the brand
      // sniff (older Chrome says "HeadlessChrome"; modern headless says
      // "Chrome" — then we assume visible, the safe default for reuse).
      const knownHeadless = (huntChrome as any)?.headless === true || (await chromeIsHeadless(port)) === true;
      if (args.headless || !knownHeadless) {
        if (!huntChrome) huntChrome = { proc: null, port };   // adopt the orphan
        return { ok: true, port, reused: true };
      }
      // visible requested, headless running → clear the profile lock first
      try { huntChrome?.proc?.kill(); } catch { /* orphan */ }
      try { childProcess.execSync(`pkill -f -- "--user-data-dir=${profile}"`); } catch { /* none left */ }
      huntChrome = null;
      await new Promise(r => setTimeout(r, 800));
    }
    const bin = chromeBinary();
    if (!bin) return { ok: false, message: 'No Chrome/Chromium/Edge found. Install Google Chrome.' };
    fs.mkdirSync(profile, { recursive: true });
    const spawnArgs = [
      `--remote-debugging-port=${port}`,
      '--remote-allow-origins=*',
      `--user-data-dir=${profile}`,
      '--no-first-run', '--no-default-browser-check',
    ];
    if (args.headless) spawnArgs.push('--headless=new', '--window-size=1440,900');
    // Plain positional URL opens ONE window; lanes then open as TABS via
    // /json/new. (--new-window forced a second window on every launch.)
    spawnArgs.push(args.url || 'about:blank');
    const proc = childProcess.spawn(bin, spawnArgs, { detached: false, stdio: 'ignore' });
    huntChrome = { proc, port, headless: !!args.headless } as any;
    proc.on('exit', () => { if (huntChrome && huntChrome.proc === proc) huntChrome = null; });
    if (!(await chromeReady(port))) return { ok: false, message: 'Chrome did not expose its debug port.' };
    return { ok: true, port };
  } catch (err: any) { return { ok: false, message: err?.message || String(err) }; }
});

// Return the ws URL of a page target the renderer can drive (creates a tab if
// asked). main does the /json HTTP so the renderer never fights CORS.
ipcMain.handle('hjen:chrome-page', async (_e: any, args: { port?: number; url?: string }) => {
  try {
    const port = args.port || huntChrome?.port;
    if (!port) return { ok: false, message: 'Chrome is not launched.' };
    if (args.url) {
      // open (or focus) a tab at url
      try { await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(args.url)}`, { method: 'PUT' }); } catch { /* older chrome: fall through */ }
    }
    const list: any[] = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    if (!page) return { ok: false, message: 'No page target in Chrome yet.' };
    return { ok: true, wsUrl: page.webSocketDebuggerUrl, targetId: page.id, url: page.url };
  } catch (err: any) { return { ok: false, message: err?.message || String(err) }; }
});

// Open a FRESH tab in the running hunt-Chrome and return its own page ws URL.
// Each tab shares the profile (so the logged-in Frameset session carries), but
// is an independent CDP target — this is what lets N queries hunt in parallel.
ipcMain.handle('hjen:chrome-new-tab', async (_e: any, args: { port?: number; url?: string }) => {
  try {
    const port = args.port || huntChrome?.port;
    if (!port) return { ok: false, message: 'Chrome is not launched.' };
    const target = `http://127.0.0.1:${port}/json/new?${encodeURIComponent(args.url || 'about:blank')}`;
    // Chrome ≥111 requires PUT for /json/new; older builds accept GET.
    let created: any = null;
    try { created = await (await fetch(target, { method: 'PUT' })).json(); }
    catch { try { created = await (await fetch(target)).json(); } catch { /* fall through */ } }
    if (created?.webSocketDebuggerUrl) {
      return { ok: true, wsUrl: created.webSocketDebuggerUrl, targetId: created.id, url: created.url };
    }
    return { ok: false, message: 'Chrome did not open a new tab.' };
  } catch (err: any) { return { ok: false, message: err?.message || String(err) }; }
});

// Close one tab by target id (frees the page after a lane finishes).
ipcMain.handle('hjen:chrome-close-tab', async (_e: any, args: { port?: number; targetId: string }) => {
  try {
    const port = args.port || huntChrome?.port;
    if (!port || !args.targetId) return { ok: false };
    try { await fetch(`http://127.0.0.1:${port}/json/close/${args.targetId}`); } catch { /* gone */ }
    return { ok: true };
  } catch { return { ok: false }; }
});

ipcMain.handle('hjen:chrome-close', () => {
  try { huntChrome?.proc?.kill(); } catch { /* already gone */ }
  huntChrome = null;
  return { ok: true };
});

// Save a base64 PNG (a CDP screenshot the renderer took of the external page)
// into the project's _references. Reuses the same folder discipline.
ipcMain.handle('hjen:save-image-base64', (_e: any, args: {
  base64: string; projectSlug?: string | null; fileName: string; subfolder?: string;
}) => {
  try {
    const safe = (args.fileName || 'ref').replace(/[^\w.\-]+/g, '_').slice(0, 80);
    const dir = path.join(projectsRootPath(), args.projectSlug || '_unassigned', args.subfolder || '_references');
    fs.mkdirSync(dir, { recursive: true });
    const buf = Buffer.from(args.base64, 'base64');
    // Sniff the actual bytes for the extension (same discipline as the
    // download handler): callers pipe through jpeg corpus frames and animated
    // webp — naming those .png makes the vision pass send the wrong media
    // type and Anthropic rejects it.
    const realExt =
      buf.slice(0, 4).toString('binary') === 'RIFF' && buf.slice(8, 12).toString('binary') === 'WEBP' ? '.webp'
      : buf.slice(4, 12).toString('binary') === 'ftypavif' ? '.avif'
      : buf[0] === 0x89 && buf[1] === 0x50 ? '.png'
      : buf[0] === 0xff && buf[1] === 0xd8 ? '.jpg'
      : buf.slice(0, 4).toString('binary').startsWith('GIF8') ? '.gif'
      : '.png';
    const base = safe.replace(/\.(png|jpe?g|webp|gif|avif)$/i, '');
    const filePath = path.join(dir, base + realExt);
    fs.writeFileSync(filePath, buf);
    return { ok: true, path: filePath, bytes: buf.length };
  } catch (err: any) { return { ok: false, message: err?.message || String(err) }; }
});

// ============ Prompt enhancement (Claude) ============
//
// Reads attached reference images from disk, sends them + the raw prompt to
// Claude (vision), and returns a refined scene-direction prompt. Claude is
// instructed NOT to describe camera/lens/film/lighting/angle — those come
// from the app's selection chips and would conflict if duplicated in prose.
//
// BYO key for now. The endpoint is hardcoded to Anthropic direct; swap to
// an HJEN-hosted proxy later by changing ANTHROPIC_ENDPOINT below.

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
/** Auth header set for a direct Anthropic call. In gateway mode the key here
 *  is the placeholder from providerAuth and the server overwrites it. */
const ANTHROPIC_HEADERS = (key: string) => ({
  'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01',
});
const ENHANCE_MODEL = 'claude-sonnet-4-6';

// Sonnet 4.6 published rates (per million tokens). Update if Anthropic
// changes pricing; verify against your billing.
const CLAUDE_PRICING = {
  inputPerMTok: 3,
  outputPerMTok: 15,
};

interface RefForEnhance {
  filePath: string;
  category: string;
  name: string;
  customName?: string;
  parentName?: string;
}

interface EnhanceSettings {
  angle?: { name: string; description?: string } | null;
  camera?: { name: string; prompt?: string } | null;
  lens?: { name: string; note?: string } | null;
  stock?: { name: string; usage?: string } | null;
  lighting?: { name: string; description?: string } | null;
  movement?: { name: string; description?: string } | null;
  focal_mm?: number | null;
  aperture_f?: number | null;
  aspect?: string;
  stylePreset?: 'NONE' | 'MOVIE' | 'PHOTOGRAPHER';
  movie?: { title: string; director?: string | null; year?: string | number; type?: string } | null;
  photographer?: { name: string; notes?: string; genre?: string } | null;
  atmosphere?: string;
}

/** Format the user's chip selections into a compact brief Claude can read.
 *  The STYLE block is split out and ALWAYS leads — it determines whether
 *  the scene is written in animation language or photoreal language, and
 *  Claude was previously ignoring it. */
function buildSettingsBrief(s?: EnhanceSettings): string {
  if (!s) return '';
  const lines: string[] = [];

  // ═══ STYLE REGISTER — leads the brief so Claude reads everything else
  //    through this lens. Animation movies need an explicit, loud signal
  //    or Claude defaults to photoreal Saudi-KV register.
  if (s.stylePreset === 'MOVIE' && s.movie?.title) {
    const isAnimation = s.movie.type === 'Animation';
    const meta = [s.movie.director, s.movie.year].filter(Boolean).join(', ');
    if (isAnimation) {
      lines.push(`*** STYLE REGISTER: ANIMATION ***`);
      lines.push(`Style anchor: ${s.movie.title}${meta ? ` (${meta})` : ''} — animation language, NOT photoreal.`);
      lines.push(`The downstream image model will render this in the visual vocabulary of ${s.movie.title}. Write your prose so it can be re-illustrated in that animation register — no photoreal skin / pore / texture language.`);
    } else {
      lines.push(`STYLE REGISTER: LIVE-ACTION CINEMA`);
      lines.push(`Style anchor: ${s.movie.title}${meta ? ` (${meta})` : ''} — match this film's visual register (era, palette, character behaviour) without naming it.`);
    }
  } else if (s.stylePreset === 'PHOTOGRAPHER' && s.photographer?.name) {
    lines.push(`STYLE REGISTER: PHOTOGRAPHER`);
    const meta = [s.photographer.genre, s.photographer.notes].filter(Boolean).join(' — ');
    lines.push(`Style anchor: ${s.photographer.name}${meta ? ` (${meta})` : ''} — match this photographer's signature register (genre, posture, light philosophy) without naming them.`);
  } else {
    lines.push(`STYLE REGISTER: DOCUMENTARY-PHOTOREAL (no style chip set)`);
  }

  // ═══ FRAMING + CAMERA + LIGHTING brief
  if (s.angle?.name) lines.push(`Perspective: ${s.angle.name}${s.angle.description ? ` — ${s.angle.description}` : ''}`);
  if (s.camera?.name) lines.push(`Camera: ${s.camera.name}${s.camera.prompt ? ` (${s.camera.prompt})` : ''}`);
  if (s.lens?.name) lines.push(`Lens: ${s.lens.name}${s.lens.note ? ` — ${s.lens.note}` : ''}`);
  if (typeof s.focal_mm === 'number') lines.push(`Focal length: ${s.focal_mm}mm`);
  if (typeof s.aperture_f === 'number') lines.push(`Aperture: f/${s.aperture_f}`);
  if (s.stock?.name) lines.push(`Film stock: ${s.stock.name}${s.stock.usage ? ` — ${s.stock.usage}` : ''}`);
  if (s.lighting?.name) lines.push(`Lighting: ${s.lighting.name}${s.lighting.description ? ` — ${s.lighting.description}` : ''}`);
  if (s.movement?.name) lines.push(`Camera movement: ${s.movement.name}${s.movement.description ? ` — ${s.movement.description}` : ''}`);
  if (s.aspect) lines.push(`Aspect ratio: ${s.aspect}`);
  if (s.atmosphere?.trim()) lines.push(`Atmosphere note: ${s.atmosphere.trim()}`);
  return lines.join('\n');
}

function imageExtToMime(p: string): string {
  const e = path.extname(p).toLowerCase().slice(1);
  if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
  if (e === 'webp') return 'image/webp';
  if (e === 'gif') return 'image/gif';
  return 'image/png';
}

const ENHANCEMENT_SYSTEM_PROMPT = `You are a TIGHT stills-photography prompt refiner for HJEN, a Saudi commercial KV studio.

Your role is a STABILIZER, not a creative writer. You take the user's raw prompt + reference images + chip selections and produce ONE short, dense paragraph that LOCKS IN what already exists. You do NOT invent new content. You do NOT pad.

═══ HARD LENGTH LIMIT ═══
Output: 40–80 words. ONE paragraph. If you write more than 80 words you have failed the task.

═══ RULE #0 — NO HALLUCINATING REFERENCES (TOP RULE) ═══

The user message contains a "WHAT IS ATTACHED" inventory listing exactly which reference categories exist, with counts. This is the exhaustive ground truth. You may ONLY describe things from categories whose count is ≥ 1.

ABSOLUTES:
- The CHARACTER reference is the SUBJECT'S FACE / IDENTITY. It is NOT a wardrobe reference. Even if you can see clothing on the character ref image, you may NOT describe that clothing as "from the reference" or invent specific garments (no "sage-green hooded puffer jacket", no "navy crepe abaya", no garment names + colors).
- If the inventory says "wardrobe: 0", you MUST NOT mention any specific garment, color, fabric, cut. Either silently omit wardrobe entirely OR use the most generic functional phrase ("dressed for the scene") — and only if the user's raw prompt invited it.
- If "prop: 0", do not invent or mention any prop.
- If "location: 0", describe location only in the abstract terms the user wrote — do not invent street names, neighbourhoods, weather details that weren't in the user prompt.
- The phrase "from the X reference" is FORBIDDEN unless X is in the inventory with count ≥ 1.
- Do NOT carry over phrasing from prior generations. Each call starts fresh; the only context is the current inventory + current user prompt + current chip settings. Anything not in those is invented.

When in doubt: omit. A shorter, faithful prose is better than a richer prose with invented detail. Invented detail produces images that contradict the user's actual references.

═══ RULE #1 — STYLE REGISTER IS THE CONTRACT ═══

The user's "Technical settings" block starts with a STYLE REGISTER line. That line dictates the visual language of your prose. It is NOT optional and the user-prompt cannot override it.

• "STYLE REGISTER: ANIMATION" — write the scene as if it will be rendered in that animated film's visual vocabulary. The character is a STYLISED character, not a real person. Describe shape, posture, color blocking, gesture. Do NOT describe pores, freckles, micro-expressions, skin texture, photographic realism, or any photoreal-portraiture language. If the user prompt says "Saudi woman in Paris" and the style is "Avatar: The Last Airbender", you write an Avatar-style stylised Saudi-coded character in Paris — not a real human in Paris.

• "STYLE REGISTER: LIVE-ACTION CINEMA" — cinematic-photographic register matched to that film's era and look.

• "STYLE REGISTER: PHOTOGRAPHER" — that photographer's signature register (genre/light/posture). Don't name them.

• "STYLE REGISTER: DOCUMENTARY-PHOTOREAL" — neutral photoreal default; subtle realism, no stylisation, no genre theatricality.

If you violate the style register you have failed the task, regardless of how good the prose is.

═══ RULE #2 — WHAT THE OUTPUT MUST DO ═══

1. CONFIRM the user's raw prompt — preserve the action, subject count, location intent, and mood the user wrote. Do NOT replace any of it with your own preferences.

2. LOCK IN what's visible in the reference images — for each attached reference, name the specific thing it shows in 2–4 words and bind it to whoever it belongs to:
   - Character ref → "the woman/man shown in the reference" or by provided name
   - Wardrobe ref → "in the [garment-from-ref]"
   - Prop ref → "holding/with the [object-from-ref]"
   - Location ref → "in the [location-from-ref]"
   Do NOT describe what the reference might mean or how it's lit. Just NAME it tightly.

3. RESPECT the chip selections silently — the chips (perspective, lens, focal, aperture, film, lighting, movement, aspect, style, atmosphere) will be appended downstream. Your job is to ensure the prose doesn't contradict them.

═══ RULE #3 — WHAT YOU MUST NOT DO ═══

- Do NOT add new characters, props, garments, or scene elements that aren't in the user prompt or in a reference.
- Do NOT add atmospheric flourishes, mood essays, or texture inventories ("warm golden afternoon light caressing the…", "skin glistening with…", "three plates of foreground/mid/background…"). One mood word per sentence max.
- Do NOT describe age, ethnicity, skin texture, micro-expressions, or hairstyle unless the user wrote them OR you can SEE them in a reference image. If style register is ANIMATION, skip skin / pore / texture descriptors entirely.
- Do NOT name camera, lens, focal length, aperture, film, lighting equipment/kelvin, photographer, director, movie, genre labels (cinematic / editorial / 35mm / bokeh), angle/movement terms, color grade, aspect, or render quality words. These come from the chips downstream.
- Do NOT add Saudi/Gulf clichés (thobe, abaya, dallah, shemagh, falcon, desert, camel) unless they appear in the user prompt or references.
- Do NOT explain what the image will look like ("a striking portrait that…"). Just describe the scene.

═══ RULE #4 — CHIP COMPATIBILITY (silent enforcement) ═══

Drop any element from the user's raw prompt that contradicts the selected chips. The chip ALWAYS wins. Examples:
- Perspective extreme close-up / close-up: drop wide environment, crowds, signage, buildings. Keep face / hands / single object / texture only.
- Perspective wide / establishing: keep environment, allow multiple plates.
- Wide aperture (≤ f/2.8): describe subject only; background goes unnamed.
- 21:9 aspect: composition spreads horizontally; no tall vertical sprawl.
- 9:16 aspect: one subject, vertical-friendly framing.

═══ OUTPUT FORMAT ═══

ONE paragraph. 40–80 words. Plain prose. Present tense. Third person. No headings, bullets, labels, or quotes. Do not start with "A photo of" or "An image of". Address named characters by name. Bind wardrobe/props to their parent character explicitly.`;

function enhancementsLogPath(): string {
  // Sits at the projects root so the user can find / archive it like
  // any other generated artifact.
  return path.join(projectsRootPath(), '_enhancements.jsonl');
}

// ============ Pending generation jobs (crash recovery) ============
//
// Layout:
//   {projectsRoot}/_pending/{jobId}.json
//
// Each file is the full serializable job context the renderer needs to
// either retry the generation or surface a clear "interrupted" notice
// on next launch. We write the file BEFORE issuing the API call and
// delete it on completion (success or failure). Files that survive an
// app restart are by definition orphans = app died mid-generation.

function pendingJobsDir(): string {
  return path.join(projectsRootPath(), '_pending');
}

ipcMain.handle('hjen:save-pending-job', (_e: any, args: { id: string; payload: any }) => {
  if (!args.id || !args.payload) return { ok: false, reason: 'invalid' };
  fs.mkdirSync(pendingJobsDir(), { recursive: true });
  const f = path.join(pendingJobsDir(), `${args.id}.json`);
  try {
    fs.writeFileSync(f, JSON.stringify(args.payload, null, 2));
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: err?.message || 'write_failed' };
  }
});

ipcMain.handle('hjen:clear-pending-job', (_e: any, args: { id: string }) => {
  if (!args.id) return { ok: false };
  const f = path.join(pendingJobsDir(), `${args.id}.json`);
  try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  return { ok: true };
});

ipcMain.handle('hjen:list-pending-jobs', () => {
  const dir = pendingJobsDir();
  if (!fs.existsSync(dir)) return [];
  try {
    const files = (fs.readdirSync(dir) as string[]).filter((f: string) => f.endsWith('.json'));
    const out: any[] = [];
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(dir, f), 'utf-8');
        out.push(JSON.parse(raw));
      } catch {}
    }
    return out.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
  } catch {
    return [];
  }
});

// ============ Failed generation jobs (debug history) ============
//
// Layout:
//   {projectsRoot}/_failed/{jobId}.json
//
// Persisted on every catch in generate() so the user can later inspect
// the exact prompt + references that were sent + the API error message.
// Stays on disk until the user explicitly dismisses the entry from the
// sidebar's Failed group.

function failedJobsDir(): string {
  return path.join(projectsRootPath(), '_failed');
}

ipcMain.handle('hjen:save-failed-job', (_e: any, args: { id: string; payload: any }) => {
  if (!args.id || !args.payload) return { ok: false, reason: 'invalid' };
  fs.mkdirSync(failedJobsDir(), { recursive: true });
  const f = path.join(failedJobsDir(), `${args.id}.json`);
  try {
    fs.writeFileSync(f, JSON.stringify(args.payload, null, 2));
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: err?.message || 'write_failed' };
  }
});

ipcMain.handle('hjen:list-failed-jobs', () => {
  const dir = failedJobsDir();
  if (!fs.existsSync(dir)) return [];
  try {
    const files = (fs.readdirSync(dir) as string[]).filter((f: string) => f.endsWith('.json'));
    const out: any[] = [];
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(dir, f), 'utf-8');
        out.push(JSON.parse(raw));
      } catch {}
    }
    return out.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
  } catch {
    return [];
  }
});

ipcMain.handle('hjen:delete-failed-job', (_e: any, args: { id: string }) => {
  if (!args.id) return { ok: false };
  const f = path.join(failedJobsDir(), `${args.id}.json`);
  try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  return { ok: true };
});

// ---------- Failed VIDEO jobs (separate folder so Frame inspector + Video
// sidebar don't cross-pollute schemas). Same shape pattern as failed jobs
// above. Keyed by id (uuid generated in renderer). ----------
function failedVideosDir(): string {
  return path.join(projectsRootPath(), '_failed_videos');
}
ipcMain.handle('hjen:save-failed-video', (_e: any, args: { id: string; payload: any }) => {
  if (!args.id || !args.payload) return { ok: false, reason: 'invalid' };
  fs.mkdirSync(failedVideosDir(), { recursive: true });
  const f = path.join(failedVideosDir(), `${args.id}.json`);
  try {
    fs.writeFileSync(f, JSON.stringify(args.payload, null, 2));
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: err?.message || 'write_failed' };
  }
});
ipcMain.handle('hjen:list-failed-videos', () => {
  const dir = failedVideosDir();
  if (!fs.existsSync(dir)) return [];
  try {
    const files = (fs.readdirSync(dir) as string[]).filter((f: string) => f.endsWith('.json'));
    const out: any[] = [];
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(dir, f), 'utf-8');
        out.push(JSON.parse(raw));
      } catch {}
    }
    return out.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
  } catch {
    return [];
  }
});
ipcMain.handle('hjen:delete-failed-video', (_e: any, args: { id: string }) => {
  if (!args.id) return { ok: false };
  const f = path.join(failedVideosDir(), `${args.id}.json`);
  try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  return { ok: true };
});

// ============ Generations log (append-only usage history) ============
//
// File: {projectsRoot}/_generations.jsonl
// One JSON line per successful generation. NEVER touched by delete-generation,
// delete-project, or move-generation — Usage stays Usage even after files are
// removed from disk. Same JSONL pattern as _enhancements.jsonl + _skill_runs.jsonl.

function generationsLogPath(): string {
  return path.join(projectsRootPath(), '_generations.jsonl');
}

interface GenerationLogEntry {
  ts: number;
  imgPath: string;
  thumbPath?: string;
  jsonPath: string;
  dateFolder: string;
  baseName: string;
  captured: string | null;
  promptTitle: string;
  finalSize?: string;
  modelLabel?: string;
  quality?: string;
  resolution?: string;
  aspect?: string;
  costUsd?: number;
  durationMs?: number;
  referencesCount: number;
  projectId: string | null;
  projectName: string;
  projectSlug: string;
}

function appendGenerationEvent(ev: GenerationLogEntry) {
  try {
    fs.mkdirSync(projectsRootPath(), { recursive: true });
    fs.appendFileSync(generationsLogPath(), JSON.stringify(ev) + '\n');
  } catch (err) {
    console.warn('[generations] could not append to log', err);
  }
}

function readGenerationsLog(): GenerationLogEntry[] {
  const p = generationsLogPath();
  if (!fs.existsSync(p)) return [];
  try {
    const lines = fs.readFileSync(p, 'utf-8').split(/\r?\n/).filter(Boolean);
    const out: GenerationLogEntry[] = [];
    for (const line of lines) {
      try { out.push(JSON.parse(line)); } catch {}
    }
    return out;
  } catch {
    return [];
  }
}

interface EnhancementEvent {
  ts: number;                 // epoch ms
  model: string;              // e.g. "claude-sonnet-4-6"
  inputTokens: number;
  outputTokens: number;
  usd: number;                // computed from token rates
  referencesCount: number;
  rawPromptChars: number;
  enhancedPromptChars: number;
  // Short excerpts (≤120 chars) for display in the Usage log without
  // bloating the JSONL file with full prompts.
  rawPromptExcerpt?: string;
  enhancedPromptExcerpt?: string;
  projectId?: string | null;
  projectSlug?: string | null;
  projectName?: string | null;
}

function appendEnhancementEvent(ev: EnhancementEvent) {
  try {
    fs.mkdirSync(projectsRootPath(), { recursive: true });
    fs.appendFileSync(enhancementsLogPath(), JSON.stringify(ev) + '\n');
  } catch (err) {
    console.warn('[enhance] could not append to log', err);
  }
}

ipcMain.handle('hjen:list-enhancements', () => {
  const p = enhancementsLogPath();
  if (!fs.existsSync(p)) return [];
  try {
    const lines = fs.readFileSync(p, 'utf-8').split(/\r?\n/).filter(Boolean);
    const out: EnhancementEvent[] = [];
    for (const line of lines) {
      try { out.push(JSON.parse(line)); } catch {}
    }
    return out.sort((a, b) => b.ts - a.ts);
  } catch {
    return [];
  }
});

// ============ Emulsion renders (dedicated home) ============
//
// The Emulsion view (Camera Body × Lens × Film) writes to ONE global folder
// {projectsRoot}/Emulsion/ — NOT a per-project date bucket — so the user
// always has a single, browsable home for these renders. Each save drops a
// full PNG + a 1024px thumb + a JSON sidecar, and appends one line to
// {projectsRoot}/_emulsion.jsonl (mirrors _enhancements.jsonl).
interface EmulsionEvent {
  ts: number;                 // epoch ms
  imgPath: string;
  thumbPath?: string;
  jsonPath: string;
  comparePath?: string;       // {base}_compare.png — original | edited side-by-side
  camera: any;                // the CameraChoice used
  sourcePath?: string;        // the ORIGINAL frame — so reopen re-derives cleanly (no stacking)
  sourceName?: string;
}

function emulsionLogPath(): string {
  return path.join(projectsRootPath(), '_emulsion.jsonl');
}

function appendEmulsionEvent(ev: EmulsionEvent) {
  try {
    fs.mkdirSync(projectsRootPath(), { recursive: true });
    fs.appendFileSync(emulsionLogPath(), JSON.stringify(ev) + '\n');
  } catch (err) {
    console.warn('[emulsion] could not append to log', err);
  }
}

ipcMain.handle('hjen:list-emulsion', () => {
  const p = emulsionLogPath();
  if (!fs.existsSync(p)) return [];
  try {
    const lines = fs.readFileSync(p, 'utf-8').split(/\r?\n/).filter(Boolean);
    const out: EmulsionEvent[] = [];
    for (const line of lines) {
      try { out.push(JSON.parse(line)); } catch {}
    }
    return out.sort((a, b) => b.ts - a.ts);
  } catch {
    return [];
  }
});

ipcMain.handle('hjen:save-emulsion', (_e: any, args: {
  base64: string;
  compareBase64?: string;   // original | edited side-by-side, saved alongside
  camera: any;
  scene?: any;
  sourcePath?: string;
  sourceName?: string;
}) => {
  const dir = path.join(projectsRootPath(), 'Emulsion');
  fs.mkdirSync(dir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const cameraSlug = String(args.camera?.body || 'camera').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'camera';
  const base = `${ts}_${cameraSlug}`;
  const imgPath = path.join(dir, `${base}.png`);
  const jsonPath = path.join(dir, `${base}.json`);
  const thumbPath = path.join(dir, `${base}.thumb.jpg`);

  const buffer = Buffer.from(args.base64, 'base64');
  fs.writeFileSync(imgPath, buffer);

  // Side-by-side comparison (original left | edited right), saved next to the
  // primary edited PNG so the user always has the two together in one file.
  let comparePath: string | undefined;
  if (args.compareBase64) {
    try {
      comparePath = path.join(dir, `${base}_compare.png`);
      fs.writeFileSync(comparePath, Buffer.from(args.compareBase64, 'base64'));
    } catch (e) {
      console.warn('[save-emulsion] compare write failed', e);
      comparePath = undefined;
    }
  }

  const sourceName = args.sourceName || (args.sourcePath ? path.basename(args.sourcePath) : undefined);
  const sidecar = {
    ts: Date.now(),
    tool: 'emulsion',
    camera: args.camera ?? null,   // full CameraChoice (body/lens/stock/intensity/scan/scenePreset)
    scene: args.scene ?? null,     // the detected scene at render time
    sourcePath: args.sourcePath ?? null,
    sourceName: sourceName ?? null,
    comparePath: comparePath ?? null,
  };
  fs.writeFileSync(jsonPath, JSON.stringify(sidecar, null, 2));

  // 1024px JPEG thumb, same resize path as hjen:save-generation.
  try {
    const native = electron.nativeImage.createFromBuffer(buffer);
    const { width, height } = native.getSize();
    const target = Math.min(width, 1024);
    const scale = target / Math.max(1, width);
    const tw = Math.max(1, Math.round(width * scale));
    const th = Math.max(1, Math.round(height * scale));
    fs.writeFileSync(thumbPath, native.resize({ width: tw, height: th, quality: 'best' }).toJPEG(88));
  } catch (e) {
    console.warn('[save-emulsion] thumbnail failed', e);
  }

  const finalThumb = fs.existsSync(thumbPath) ? thumbPath : undefined;
  try {
    appendEmulsionEvent({
      ts: Date.now(),
      imgPath,
      thumbPath: finalThumb,
      jsonPath,
      comparePath,
      camera: args.camera ?? null,
      sourcePath: args.sourcePath ?? undefined,
      sourceName,
    });
  } catch (err) {
    console.warn('[save-emulsion] could not append log', err);
  }

  return { ok: true, imgPath, thumbPath: finalThumb, comparePath };
});

// Emulsion for VIDEO — apply the SAME look pipeline to every frame of a clip.
// Long-running (minutes): streams each `[vid] progress i/N` line to the renderer
// via hjen:emulsion-video-progress (mirrors hjen:world-progress). Output lands in
// the shared Emulsion folder as <ts>_<cameraSlug>.mp4. Flags map 1:1 from the
// CameraChoice; skin/sky come from the two Scene Protect sliders (0..1).
ipcMain.handle('hjen:emulsion-video', async (_e: any, args: {
  videoPath: string;
  choice: any;            // CameraChoice
  skin?: number;          // 0..1 — Skin Protect (per-frame segmentation, slow)
  sky?: number;           // 0..1 — Sky Treat
  maxw?: number;
}) => {
  const py = resolveWorldPython();
  if (!py) return { ok: false as const, reason: 'no_python', message: 'Local video engine unavailable — no Python found. Set HJEN_WORLD_PY or install the world_from_image venv.' };
  const script = worldkitScript('emulsion_video_cli.py');
  if (!fs.existsSync(script)) return { ok: false as const, reason: 'no_script', message: `emulsion_video_cli.py not found at ${script}` };
  if (!fs.existsSync(args.videoPath)) return { ok: false as const, reason: 'no_video', message: `Video not found: ${args.videoPath}` };

  const dir = path.join(projectsRootPath(), 'Emulsion');
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const c = args.choice || {};
  const cameraSlug = String(c.body || 'camera').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'camera';
  const outPath = path.join(dir, `${ts}_${cameraSlug}.mp4`);

  const flags = [
    script, args.videoPath, outPath,
    `--body=${c.body ?? 'alexa_mini_lf'}`,
    `--lens=${c.lens ?? 'cooke_s4'}`,
    `--stock=${c.stock ?? 'vision3_250d'}`,
    `--intensity=${c.intensity ?? 1.0}`,
    `--scan=${c.scan ?? '2K'}`,
    `--preset=${c.scenePreset ?? 'auto'}`,
    `--dtype=${c.distortionType ?? 'none'}`,
    `--damount=${c.distortionAmount ?? 0}`,
    `--skin=${args.skin ?? 0}`,
    `--sky=${args.sky ?? 0}`,
  ];
  if (typeof args.maxw === 'number') flags.push(`--maxw=${args.maxw}`);   // omitted ⇒ NATIVE resolution (match & preserve source)

  const code = await new Promise<number>((resolve) => {
    const p = childProcess.spawn(py, flags, { stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    p.stdout.on('data', (d: Buffer) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() || '';
      for (const line of lines) {
        const m = line.trim().match(/^\[vid\] progress (\d+)\/(\d+)/);
        if (m) mainWindow?.webContents.send('hjen:emulsion-video-progress', { i: parseInt(m[1], 10), n: parseInt(m[2], 10) });
      }
    });
    p.stderr.on('data', () => { /* ffmpeg / transformers noise */ });
    p.on('close', (cc: number) => resolve(cc ?? 1));
    p.on('error', () => resolve(1));
  });
  if (code !== 0) return { ok: false as const, reason: 'failed', message: `Video engine exited ${code}` };
  if (!fs.existsSync(outPath)) return { ok: false as const, reason: 'no_output', message: 'Video engine produced no output.' };
  return { ok: true as const, path: outPath };
});

// Extract the first frame of a video to a temp PNG — used as the representative
// still the Emulsion Video look preview tunes against. (ffprobe is not required.)
ipcMain.handle('hjen:video-first-frame', async (_e: any, args: { videoPath: string }) => {
  if (!args?.videoPath || !fs.existsSync(args.videoPath)) return { ok: false as const, message: `Video not found: ${args?.videoPath}` };
  const ffmpeg = (() => {
    const home = os.homedir();
    for (const p of [path.join(home, '.local/bin/ffmpeg'), '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']) {
      if (fs.existsSync(p)) return p;
    }
    return 'ffmpeg';
  })();
  const dir = path.join(app.getPath('userData'), 'emulsion_video_frames');
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, `frame_${Date.now().toString(36)}.png`);
  const code = await new Promise<number>((resolve) => {
    const p = childProcess.spawn(ffmpeg, ['-y', '-v', 'error', '-i', args.videoPath, '-vf', 'select=eq(n\\,0)', '-vframes', '1', outPath], { stdio: ['ignore', 'ignore', 'pipe'] });
    p.on('close', (c: number) => resolve(c ?? 1));
    p.on('error', () => resolve(1));
  });
  if (code !== 0 || !fs.existsSync(outPath)) return { ok: false as const, message: 'Could not extract the first frame.' };
  return { ok: true as const, path: outPath };
});

// ============ Support inbox (in-app, no email) ============
//
// Layout: {projectsRoot}/_support.jsonl — one ticket per line.
//
// The Support panel sends straight into this local inbox. No mail client,
// no Gmail — the request is captured on disk instantly and can later be
// synced to a real endpoint / read by an admin view (hjen:list-support).
function supportInboxPath(): string {
  return path.join(projectsRootPath(), '_support.jsonl');
}

ipcMain.handle('hjen:submit-support', (_e: any, args: { kind: string; message: string; user?: any; context?: any }) => {
  const message = (args?.message || '').trim();
  if (!message) return { ok: false, reason: 'empty' };
  const ticket = {
    id: `sup_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
    kind: args?.kind || 'Feature request',
    message,
    status: 'open' as const,
    // Who sent it. Comes from the account identity in the renderer; augmented
    // here with machine-side facts the sender can't spoof.
    user: {
      ...(args?.user ?? {}),
      host: os.hostname(),
    },
    appVersion: app.getVersion(),
    platform: process.platform,
    context: args?.context ?? null,
  };
  try {
    fs.mkdirSync(projectsRootPath(), { recursive: true });
    fs.appendFileSync(supportInboxPath(), JSON.stringify(ticket) + '\n');
    return { ok: true, id: ticket.id, ts: ticket.ts };
  } catch (err: any) {
    return { ok: false, reason: err?.message || 'write_failed' };
  }
});

ipcMain.handle('hjen:list-support', () => {
  const p = supportInboxPath();
  if (!fs.existsSync(p)) return [];
  try {
    const lines = fs.readFileSync(p, 'utf-8').split(/\r?\n/).filter(Boolean);
    const out: any[] = [];
    for (const line of lines) {
      try { out.push(JSON.parse(line)); } catch {}
    }
    return out.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
  } catch {
    return [];
  }
});

ipcMain.handle('hjen:enhance-prompt', async (_e: any, args: {
  rawPrompt: string;
  references: RefForEnhance[];
  settings?: EnhanceSettings;
  projectId?: string | null;
  projectSlug?: string | null;
  projectName?: string | null;
}) => {
  // Local key, or the gateway's placeholder when the server holds the real one
  const apiKey = providerAuth('anthropic').key;
  if (!apiKey) {
    return { ok: false, reason: 'no_key', message: 'No Anthropic API key configured. Open Settings and add one.' };
  }

  const raw = (args.rawPrompt || '').trim();
  if (!raw) {
    return { ok: false, reason: 'empty_prompt', message: 'Write a prompt first, then Enhance.' };
  }

  // Build the user message — text describing each layer + actual image blocks
  type ContentBlock =
    | { type: 'text'; text: string }
    | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };
  const userBlocks: ContentBlock[] = [];

  userBlocks.push({
    type: 'text',
    text: `User's raw prompt:\n${raw}`,
  });

  // Inject the user's chip selections as a "constraints brief" so Claude
  // can enforce the compatibility rules from the system prompt. The chips
  // themselves get concatenated downstream by promptBuilder.ts — Claude
  // must NOT name them in its output, only respect their semantic limits.
  const settingsBrief = buildSettingsBrief(args.settings);
  if (settingsBrief) {
    userBlocks.push({
      type: 'text',
      text: `Technical settings the user picked (will be appended downstream — your prose must be COMPATIBLE with all of these but must NEVER name them):\n${settingsBrief}`,
    });
  }

  const refs = Array.isArray(args.references) ? args.references : [];

  // Build an explicit inventory of WHAT IS ATTACHED — categorised + counted —
  // so Claude can't hallucinate references from categories that have zero
  // refs. Without this inventory Claude sees clothing on the character
  // photo and invents a fictional "wardrobe reference" to attribute it to.
  const inventory = {
    character:   refs.filter(r => r.category === 'character'),
    composition: refs.filter(r => r.category === 'composition'),
    wardrobe:    refs.filter(r => r.category === 'wardrobe'),
    prop:        refs.filter(r => r.category === 'prop'),
    location:    refs.filter(r => r.category === 'location'),
    general:     refs.filter(r => r.category === 'general'),
  };
  const inventoryLines = [
    `WHAT IS ATTACHED (exhaustive — anything else does NOT exist):`,
    `  • characters:  ${inventory.character.length}${inventory.character.length ? ' — ' + inventory.character.map(r => `'${r.customName || r.name}'`).join(', ') : ''}`,
    `  • composition: ${inventory.composition.length}${inventory.composition.length ? ' — ' + inventory.composition.map(r => `'${r.customName || r.name}'`).join(', ') : ''}`,
    `  • wardrobe:    ${inventory.wardrobe.length}${inventory.wardrobe.length ? ' — ' + inventory.wardrobe.map(r => `'${r.customName || r.name}'`).join(', ') : ''}`,
    `  • props:       ${inventory.prop.length}${inventory.prop.length ? ' — ' + inventory.prop.map(r => `'${r.customName || r.name}'`).join(', ') : ''}`,
    `  • locations:   ${inventory.location.length}${inventory.location.length ? ' — ' + inventory.location.map(r => `'${r.customName || r.name}'`).join(', ') : ''}`,
    `  • general:     ${inventory.general.length}${inventory.general.length ? ' — ' + inventory.general.map(r => `'${r.customName || r.name}'`).join(', ') : ''}`,
    ``,
    `If a category shows 0, you may NOT describe anything from that category. The character reference shows the SUBJECT'S FACE and IDENTITY — it does NOT define wardrobe. Even if you see clothing on the character ref image, you may NOT describe that clothing unless a wardrobe reference is ALSO attached above. A composition reference defines the FRAMING, BLOCKING, and SUBJECT PLACEMENT only — lock those from it; ignore its content/subject identity.`,
  ].join('\n');

  userBlocks.push({ type: 'text', text: inventoryLines });

  if (refs.length > 0) {
    const refLabel = refs.map((r, i) => {
      const n = r.customName?.trim() || r.name;
      const parent = r.parentName ? ` (belongs to ${r.parentName})` : '';
      return `[${i + 1}] ${r.category}: ${n}${parent}`;
    }).join('\n');
    userBlocks.push({
      type: 'text',
      text: `Reference images attached below in order:\n${refLabel}`,
    });

    for (const ref of refs) {
      try {
        if (!fs.existsSync(ref.filePath)) continue;
        const buf = fs.readFileSync(ref.filePath);
        // Downscale large references to keep request size + cost manageable.
        // 1024px long-edge is plenty for Claude to read a face / outfit / location.
        let imgBuf = buf;
        let mime = imageExtToMime(ref.filePath);
        try {
          const native = electron.nativeImage.createFromBuffer(buf);
          const sz = native.getSize();
          const longest = Math.max(sz.width, sz.height);
          if (longest > 1024) {
            const scale = 1024 / longest;
            const tw = Math.max(1, Math.round(sz.width * scale));
            const th = Math.max(1, Math.round(sz.height * scale));
            imgBuf = native.resize({ width: tw, height: th, quality: 'good' }).toJPEG(82);
            mime = 'image/jpeg';
          }
        } catch (resizeErr) {
          // If resize fails, fall through with the original buffer.
          console.warn('[enhance] resize failed, using original', resizeErr);
        }
        userBlocks.push({
          type: 'image',
          source: { type: 'base64', media_type: mime, data: imgBuf.toString('base64') },
        });
      } catch (err) {
        console.warn(`[enhance] could not read ref ${ref.filePath}`, err);
      }
    }
  }

  try {
    const res = await providerFetch('anthropic', ANTHROPIC_ENDPOINT, ANTHROPIC_HEADERS(apiKey), {
      model: ENHANCE_MODEL,
      // 220 ≈ ~160 words ceiling. Combined with the system prompt's
      // 40-80 word target, this leaves Claude no room to ramble.
      max_tokens: 220,
      system: ENHANCEMENT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userBlocks }],
    });

    if (!res.ok) {
      const errBody = await res.text();
      return { ok: false, reason: 'api_error', message: `Anthropic ${res.status}: ${errBody.slice(0, 400)}` };
    }

    const data: any = await res.json();
    const text = Array.isArray(data?.content)
      ? data.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim()
      : '';
    if (!text) {
      return { ok: false, reason: 'empty_response', message: 'Claude returned an empty response.' };
    }

    const inputTokens = data?.usage?.input_tokens ?? 0;
    const outputTokens = data?.usage?.output_tokens ?? 0;
    const usd =
      (inputTokens / 1_000_000) * CLAUDE_PRICING.inputPerMTok +
      (outputTokens / 1_000_000) * CLAUDE_PRICING.outputPerMTok;

    // Persist for the Usage report. Append-only JSONL so concurrent writes
    // never overwrite each other and the file is grep-friendly on disk.
    appendEnhancementEvent({
      ts: Date.now(),
      model: ENHANCE_MODEL,
      inputTokens,
      outputTokens,
      usd,
      referencesCount: refs.length,
      rawPromptChars: raw.length,
      enhancedPromptChars: text.length,
      rawPromptExcerpt: raw.slice(0, 120),
      enhancedPromptExcerpt: text.slice(0, 120),
      projectId: args.projectId ?? null,
      projectSlug: args.projectSlug ?? null,
      projectName: args.projectName ?? null,
    });

    return {
      ok: true,
      enhancedPrompt: text,
      usage: { inputTokens, outputTokens },
      usd,
      model: ENHANCE_MODEL,
    };
  } catch (err: any) {
    return { ok: false, reason: 'network', message: err?.message || 'Network error contacting Anthropic.' };
  }
});

// ============ Projects ============

type StageNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
type StageStatus = 'draft' | 'signed';

interface ProjectMeta {
  id: string;
  name: string;
  slug: string;
  created: string;
  generationCount: number;
  coverImagePath?: string;
  /** Cheap mirror of state.json so list views don't have to read each
   *  project's _project/state.json. Authoritative copy lives on disk. */
  currentStage?: StageNumber;
  stagesState?: Partial<Record<StageNumber, StageStatus>>;
}

interface ProjectLedgerEntry {
  id: string;
  ts: number;
  kind: 'note' | 'risk' | 'open';
  body: string;
  resolved?: boolean;
}

interface ProjectState {
  version: 1;
  currentStage: StageNumber;
  stages: Record<StageNumber, { status: StageStatus; signedAt?: string }>;
  ledger: ProjectLedgerEntry[];
}

const STAGE_NUMBERS: StageNumber[] = [1, 2, 3, 4, 5, 6, 7, 8];

function emptyProjectState(): ProjectState {
  const stages = {} as ProjectState['stages'];
  for (const n of STAGE_NUMBERS) stages[n] = { status: 'draft' };
  return { version: 1, currentStage: 1, stages, ledger: [] };
}

/** Map stage number → filename inside {projectSlug}/_project/.
 *  Stage 02 (References) and 03 (Recast) use a subfolder, not a single file,
 *  so they're listed here for the dataPath helper but not for the
 *  read/writeStageData JSON handlers. */
function stageDataFilename(stage: StageNumber): string {
  switch (stage) {
    case 1: return '01_brief.json';
    case 2: return '02_references/manifest.json';
    case 3: return '03_recast/manifest.json';
    case 4: return '04_treatment.json';
    case 5: return '05_screenplay/index.json';
    case 6: return '06_assets/manifest.json';
    case 7: return '07_frames/manifest.json';
    case 8: return '08_videos/manifest.json';
  }
}

function stageMarkdownFilename(stage: StageNumber): string | null {
  switch (stage) {
    case 1: return '01_brief.md';
    case 4: return '04_treatment.md';
    default: return null;
  }
}

function projectStatePath(slug: string): string {
  return path.join(projectFolder(slug), '_project', 'state.json');
}

function projectDataPath(slug: string, stage: StageNumber): string {
  return path.join(projectFolder(slug), '_project', stageDataFilename(stage));
}

/** Storyboard product sidecar. Lives in its own folder so it never collides
 *  with the PPM 8-stage pipeline's _project/ files. */
function storyboardDataPath(slug: string): string {
  return path.join(projectFolder(slug), '_storyboard', 'storyboard.json');
}

function ensureProjectStateOnDisk(slug: string): ProjectState {
  const statePath = projectStatePath(slug);
  if (fs.existsSync(statePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      if (parsed && parsed.version === 1) return parsed as ProjectState;
    } catch {}
  }
  const fresh = emptyProjectState();
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(fresh, null, 2));
  return fresh;
}

/** After any state.json write, copy currentStage + stages map back onto
 *  ProjectMeta so the Projects list (Atlas/Wall) renders without loading
 *  every project's sidecar. */
function syncProjectMetaFromState(id: string, state: ProjectState): ProjectMeta | null {
  const arr = readProjects();
  const target = arr.find(p => p.id === id);
  if (!target) return null;
  target.currentStage = state.currentStage;
  const mirror: Partial<Record<StageNumber, StageStatus>> = {};
  for (const n of STAGE_NUMBERS) mirror[n] = state.stages[n]?.status ?? 'draft';
  target.stagesState = mirror;
  writeProjects(arr);
  return target;
}

function projectsConfigPath(): string {
  return path.join(app.getPath('userData'), 'projects.json');
}

function projectsRootPath(): string {
  const settingsFile = path.join(app.getPath('userData'), 'settings.json');
  if (fs.existsSync(settingsFile)) {
    try {
      const s = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
      if (s.projectsRoot && typeof s.projectsRoot === 'string') return s.projectsRoot;
    } catch {}
  }
  return path.join(app.getPath('pictures'), 'HJEN Studio');
}

function readProjects(): ProjectMeta[] {
  const f = projectsConfigPath();
  if (!fs.existsSync(f)) return [];
  try {
    const arr = JSON.parse(fs.readFileSync(f, 'utf-8'));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeProjects(arr: ProjectMeta[]) {
  fs.writeFileSync(projectsConfigPath(), JSON.stringify(arr, null, 2), { mode: 0o644 });
}

function projectFolder(slug: string): string {
  return path.join(projectsRootPath(), slug);
}

// Rewrite every absolute path reference inside a project's data files after the
// folder moves — so stored image/export paths keep pointing at the real files.
// Boundary-safe: only replaces `<oldDir>/` and `<oldDir>"` so a sibling slug
// that merely shares a prefix is never touched.
function rewriteProjectPaths(dir: string, oldDir: string, newDir: string) {
  const walk = (d: string) => {
    let entries: any[] = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }) as any[]; } catch { return; }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(json|jsonl|md|html)$/i.test(entry.name)) continue;
      try {
        const txt = fs.readFileSync(full, 'utf-8');
        if (!txt.includes(oldDir)) continue;
        const next = txt.split(`${oldDir}/`).join(`${newDir}/`).split(`${oldDir}"`).join(`${newDir}"`);
        if (next !== txt) fs.writeFileSync(full, next);
      } catch { /* skip unreadable file */ }
    }
  };
  walk(dir);
}

// Append an operations entry to the project's own ledger (inside _project/state.json).
function appendProjectLog(slug: string, kind: 'note' | 'risk' | 'open', body: string) {
  try {
    const state = ensureProjectStateOnDisk(slug);
    state.ledger = state.ledger || [];
    state.ledger.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ts: Date.now(), kind, body });
    fs.writeFileSync(projectStatePath(slug), JSON.stringify(state, null, 2));
  } catch { /* logging must never break the operation */ }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60) || 'untitled';
}

function readSettings(): Record<string, any> {
  const f = path.join(app.getPath('userData'), 'settings.json');
  if (!fs.existsSync(f)) return {};
  try { return JSON.parse(fs.readFileSync(f, 'utf-8')) || {}; }
  catch { return {}; }
}

function writeSettings(patch: Record<string, any>) {
  const f = path.join(app.getPath('userData'), 'settings.json');
  const merged = { ...readSettings(), ...patch };
  fs.writeFileSync(f, JSON.stringify(merged, null, 2));
}

// ---- Pricing config (vendor-rate overrides + margin/discount) ----
// Lives at {projectsRoot}/_pricing.json, parallel to _generations.jsonl.
// Cost stays immutable in the logs; this only governs derived client price.
function pricingConfigPath(): string {
  return path.join(projectsRootPath(), '_pricing.json');
}

ipcMain.handle('hjen:get-pricing-config', () => {
  const f = pricingConfigPath();
  if (!fs.existsSync(f)) return null; // renderer falls back to DEFAULT_PRICING_CONFIG
  try { return JSON.parse(fs.readFileSync(f, 'utf-8')); }
  catch { return null; }
});

ipcMain.handle('hjen:set-pricing-config', (_e: any, config: any) => {
  try {
    const f = pricingConfigPath();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const out = { ...config, updatedAt: new Date().toISOString() };
    fs.writeFileSync(f, JSON.stringify(out, null, 2), { mode: 0o644 });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: err?.message || 'write_failed' };
  }
});

// ============ Theme / appearance config ============
// App-level (not per-project): lives in userData/theme.json. Holds the
// active theme id + any user-created custom themes. Built-in themes live in
// the renderer (src/lib/theme/presets.ts) and are never written here.
function themeConfigPath(): string {
  return path.join(app.getPath('userData'), 'theme.json');
}

ipcMain.handle('hjen:get-theme-config', () => {
  const f = themeConfigPath();
  if (!fs.existsSync(f)) return null; // renderer falls back to Default
  try { return JSON.parse(fs.readFileSync(f, 'utf-8')); }
  catch { return null; }
});

ipcMain.handle('hjen:set-theme-config', (_e: any, config: any) => {
  try {
    const f = themeConfigPath();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const out = { ...config, version: 1, updatedAt: new Date().toISOString() };
    fs.writeFileSync(f, JSON.stringify(out, null, 2), { mode: 0o644 });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: err?.message || 'write_failed' };
  }
});

// ============ Background-jobs log (crash/quit resilience) ============
//
// The operations subsystem (BgJob) lives in the renderer, so an app quit or
// crash while a job is running would lose the whole run + its LOG trace. We
// mirror the job history to disk here, same durability contract as theme.json:
// the renderer writes on every meaningful transition (debounced), and hydrates
// on boot — reconciling any job left 'running' to 'interrupted'.
//   {userData}/jobs.json  →  { version, updatedAt, jobs: BgJob[] }
function jobsLogPath(): string {
  return path.join(app.getPath('userData'), 'jobs.json');
}

ipcMain.handle('hjen:jobs-read', () => {
  const f = jobsLogPath();
  if (!fs.existsSync(f)) return null; // renderer starts with an empty log
  try { return JSON.parse(fs.readFileSync(f, 'utf-8')); }
  catch { return null; }
});

ipcMain.handle('hjen:jobs-write', (_e: any, payload: { jobs?: unknown }) => {
  try {
    const f = jobsLogPath();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const out = { version: 1, updatedAt: new Date().toISOString(), jobs: Array.isArray(payload?.jobs) ? payload.jobs : [] };
    fs.writeFileSync(f, JSON.stringify(out, null, 2), { mode: 0o644 });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: err?.message || 'write_failed' };
  }
});

// Export a single theme to a user-chosen .json file.
ipcMain.handle('hjen:export-theme', async (_e: any, args: { theme: any; suggestedName?: string }) => {
  try {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    if (!win) return { ok: false, reason: 'no_window' };
    const safe = (args?.suggestedName || args?.theme?.name || 'theme')
      .replace(/[^a-z0-9-_ ]/gi, '').trim() || 'theme';
    const res = await dialog.showSaveDialog(win, {
      title: 'Export theme',
      defaultPath: `${safe}.hjentheme.json`,
      filters: [{ name: 'HJEN Theme', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePath) return { ok: false, reason: 'canceled' };
    fs.writeFileSync(res.filePath, JSON.stringify(args.theme, null, 2), { mode: 0o644 });
    return { ok: true, path: res.filePath };
  } catch (err: any) {
    return { ok: false, reason: err?.message || 'export_failed' };
  }
});

// Import a theme JSON file. Returns the parsed object (renderer validates).
ipcMain.handle('hjen:import-theme', async () => {
  try {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    if (!win) return null;
    const res = await dialog.showOpenDialog(win, {
      title: 'Import theme',
      properties: ['openFile'],
      filters: [{ name: 'HJEN Theme', extensions: ['json'] }],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return JSON.parse(fs.readFileSync(res.filePaths[0], 'utf-8'));
  } catch {
    return null;
  }
});

// Pick a single image (logo / boot background / product tile override).
ipcMain.handle('hjen:pick-image', async (_e: any, args?: { title?: string }) => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  if (!win) return null;
  const res = await dialog.showOpenDialog(win, {
    title: args?.title || 'Choose image',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'tiff', 'bmp'] }],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  return res.filePaths[0];
});

// ─── HJEN SET · موقع التصوير (world builder) ────────────────────────────────
// Local "pocket stage": one image → monocular depth → the world/index.html
// viewer displaces it into a navigable, focal-true world. Depth runs in a
// Python sidecar (Depth-Anything-V2-Small on MPS). Cloud (HunyuanWorld) is a
// later tier; this is the offline/NDA path.
// The worldkit sidecars (depth / HMR pose / emulsion) are Python scripts that sit
// beside the app rather than inside app.asar (a child process cannot execute a
// file inside an archive).
//
// These used to fall back to a HARDCODED absolute path on the author's own disk —
// "an internal single-machine tool, so the repo path is a valid anchor". It stopped
// being valid the moment the app was handed to anyone else: on every other Mac that
// directory does not exist, so Film Space, depth, pose, segment and the local image
// passes resolved to nothing and failed. The bundle now carries the scripts in
// Resources/worldkit, and dev still reads the repo copy beside __dirname.
const REPO_ROOT_DIR = path.resolve(__dirname, '..', '..');

/** A worldkit script: packaged copy, else the repo copy next to this file. */
function worldkitScript(name: string): string {
  const candidates = [
    path.join(process.resourcesPath || '', 'worldkit', name),   // packaged
    path.join(__dirname, '..', 'worldkit', name),               // dev (app/worldkit)
    path.join(REPO_ROOT_DIR, 'app', 'worldkit', name),
  ];
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch { /* next */ } }
  return candidates[0];    // report the packaged path in the error the caller raises
}

/** The Python that runs the worldkit scripts. A project venv is preferred (it
 *  holds torch and the model weights); otherwise the shared resolver answers,
 *  which also knows Homebrew's python on a Finder-launched app. */
function resolveWorldPython(): string | null {
  const venvs = [
    process.env.HJEN_WORLD_PY,
    path.join(REPO_ROOT_DIR, 'STUDY', 'world_from_image', '.venv', 'bin', 'python'),
    path.join(__dirname, '..', '..', 'STUDY', 'world_from_image', '.venv', 'bin', 'python'),
  ].filter(Boolean) as string[];
  for (const c of venvs) {
    try { if (fs.existsSync(c)) { childProcess.execFileSync(c, ['-c', 'import sys'], { stdio: 'ignore' }); return c; } }
    catch { /* next */ }
  }
  return resolveTool('python3');
}

// image → depth-world source (rgb + depth pngs), returned as hjen-file:// URLs.
ipcMain.handle('hjen:world-depth', async (_e: any, args: { imagePath: string; size?: number }) => {
  const py = resolveWorldPython();
  if (!py) return { ok: false as const, reason: 'no_python', message: 'No Python with the depth model found. Set HJEN_WORLD_PY or install the world_from_image venv.' };
  const script = worldkitScript('depth_cli.py');
  if (!fs.existsSync(script)) return { ok: false as const, reason: 'no_script', message: `depth_cli.py not found at ${script}` };
  if (!fs.existsSync(args.imagePath)) return { ok: false as const, reason: 'no_image', message: `Image not found: ${args.imagePath}` };

  const worldId = 'w' + Date.now().toString(36);
  const dir = path.join(app.getPath('userData'), 'worlds', worldId);
  fs.mkdirSync(dir, { recursive: true });
  const stem = path.basename(args.imagePath).replace(/\.[^.]+$/, '');

  const code = await new Promise<number>((resolve) => {
    const p = childProcess.spawn(py, [script, dir, args.imagePath, `--size=${args.size || 1536}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    let last = '';
    p.stdout.on('data', (d: Buffer) => { last = d.toString(); mainWindow?.webContents.send('hjen:world-progress', { worldId, line: last.trim() }); });
    p.stderr.on('data', () => { /* transformers logs noise */ });
    p.on('close', (c: number) => resolve(c ?? 1));
    p.on('error', () => resolve(1));
  });
  if (code !== 0) return { ok: false as const, reason: 'depth_failed', message: `Depth sidecar exited ${code}` };

  const rgb = path.join(dir, `${stem}_rgb.png`);
  const depth = path.join(dir, `${stem}_depth8.png`);
  if (!fs.existsSync(rgb) || !fs.existsSync(depth)) return { ok: false as const, reason: 'no_output', message: 'Depth sidecar produced no output.' };
  const url = (abs: string) => `hjen-file://${encodeURI(abs.split(path.sep).join('/'))}`;
  return { ok: true as const, worldId, dir, imgUrl: url(rgb), depthUrl: url(depth) };
});

// Film Space · Pose from image (HMR / SMPL body recovery). A Python sidecar
// (4D-Humans / HMR2.0, worldkit/pose_hmr.py) recovers full SMPL parameters +
// the posed 3D joints from ONE image — so global body orientation (a horizontal
// dive, a pitched crouch, a turned torso) is a FIRST-CLASS output, unlike the
// old MediaPipe keypoint→direction retarget that structurally discarded it.
// Same resolver/spawn/progress shape as hjen:world-depth. Streams the sidecar's
// [hmr] progress lines and returns pose.json's params. RESEARCH weights,
// internal/NDA use only pending a commercial license (see pose_hmr.py header).
ipcMain.handle('hjen:filmspace-pose-hmr', async (_e: any, args: { imagePath: string }) => {
  const py = resolveWorldPython();
  if (!py) return { ok: false as const, reason: 'no_python', message: 'Local body-recovery model unavailable — no Python with the HMR engine found. Set HJEN_WORLD_PY or install the world_from_image venv.' };
  const script = worldkitScript('pose_hmr.py');
  if (!fs.existsSync(script)) return { ok: false as const, reason: 'no_script', message: `pose_hmr.py not found at ${script}` };
  if (!fs.existsSync(args.imagePath)) return { ok: false as const, reason: 'no_image', message: `Image not found: ${args.imagePath}` };

  const dir = path.join(app.getPath('userData'), 'filmspace_pose', 'p' + Date.now().toString(36));
  fs.mkdirSync(dir, { recursive: true });

  const code = await new Promise<number>((resolve) => {
    const p = childProcess.spawn(py, [script, dir, args.imagePath], { stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', (d: Buffer) => {
      d.toString().split(/\r?\n/).forEach((line: string) => {
        const t = line.trim();
        if (t.startsWith('[hmr]')) mainWindow?.webContents.send('hjen:filmspace-pose-progress', { line: t.slice(5).trim() });
      });
    });
    p.stderr.on('data', () => { /* torch / transformers noise */ });
    p.on('close', (c: number) => resolve(c ?? 1));
    p.on('error', () => resolve(1));
  });
  if (code !== 0) return { ok: false as const, reason: 'hmr_failed', message: `Body-recovery sidecar exited ${code}` };
  const poseFile = path.join(dir, 'pose.json');
  if (!fs.existsSync(poseFile)) return { ok: false as const, reason: 'no_output', message: 'Body recovery produced no output.' };
  try {
    const params = JSON.parse(fs.readFileSync(poseFile, 'utf-8'));
    return { ok: true as const, params };
  } catch {
    return { ok: false as const, reason: 'bad_output', message: 'Could not read the recovered pose.' };
  }
});

// Emulsion Depth DoF — scene-aware defocus (real bokeh) via Depth-Anything-V2.
// Mirrors hjen:world-depth: same Python resolver/env, a worldkit/ script, output
// under userData. Returns the absolute path of the defocused PNG.
ipcMain.handle('hjen:emulsion-defocus', async (_e: any, args: { imagePath: string; focus: 'auto' | number; aperture: number; haze: number }) => {
  const py = resolveWorldPython();
  if (!py) return { ok: false as const, reason: 'no_python', message: 'Local depth model unavailable — no Python with Depth-Anything found. Set HJEN_WORLD_PY or install the world_from_image venv.' };
  const script = worldkitScript('defocus_cli.py');
  if (!fs.existsSync(script)) return { ok: false as const, reason: 'no_script', message: `defocus_cli.py not found at ${script}` };
  if (!fs.existsSync(args.imagePath)) return { ok: false as const, reason: 'no_image', message: `Image not found: ${args.imagePath}` };

  const dir = path.join(app.getPath('userData'), 'emulsion_defocus', 'd' + Date.now().toString(36));
  fs.mkdirSync(dir, { recursive: true });

  let stdout = '';
  const code = await new Promise<number>((resolve) => {
    const p = childProcess.spawn(py, [
      script, dir, args.imagePath,
      `--focus=${args.focus}`,
      `--aperture=${args.aperture}`,
      `--haze=${args.haze}`,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    p.stderr.on('data', () => { /* transformers logs noise */ });
    p.on('close', (c: number) => resolve(c ?? 1));
    p.on('error', () => resolve(1));
  });
  if (code !== 0) return { ok: false as const, reason: 'failed', message: `Depth DoF sidecar exited ${code}` };

  const done = stdout.split(/\r?\n/).map(l => l.trim()).find(l => l.startsWith('[defocus] done '));
  const outPath = done ? done.slice('[defocus] done '.length).trim() : '';
  if (!outPath || !fs.existsSync(outPath)) return { ok: false as const, reason: 'no_output', message: 'Depth DoF produced no output.' };
  return { ok: true as const, path: outPath };
});

// Emulsion LIVE Depth DoF — compute the DEPTH MAP once (~5s); focus/aperture/haze
// are then live in the worker. Same resolver/script as defocus, but --depthonly=1
// so it emits only {stem}_depth8.png (grayscale, 1=near/0=far).
ipcMain.handle('hjen:emulsion-depth', async (_e: any, args: { imagePath: string }) => {
  const py = resolveWorldPython();
  if (!py) return { ok: false as const, reason: 'no_python', message: 'Local depth model unavailable — no Python with Depth-Anything found. Set HJEN_WORLD_PY or install the world_from_image venv.' };
  const script = worldkitScript('defocus_cli.py');
  if (!fs.existsSync(script)) return { ok: false as const, reason: 'no_script', message: `defocus_cli.py not found at ${script}` };
  if (!fs.existsSync(args.imagePath)) return { ok: false as const, reason: 'no_image', message: `Image not found: ${args.imagePath}` };

  const dir = path.join(app.getPath('userData'), 'emulsion_defocus', 'd' + Date.now().toString(36));
  fs.mkdirSync(dir, { recursive: true });

  let stdout = '';
  const code = await new Promise<number>((resolve) => {
    const p = childProcess.spawn(py, [script, dir, args.imagePath, '--depthonly=1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    p.stderr.on('data', () => { /* transformers logs noise */ });
    p.on('close', (c: number) => resolve(c ?? 1));
    p.on('error', () => resolve(1));
  });
  if (code !== 0) return { ok: false as const, reason: 'failed', message: `Depth sidecar exited ${code}` };

  const done = stdout.split(/\r?\n/).map(l => l.trim()).find(l => l.startsWith('[defocus] done '));
  const outPath = done ? done.slice('[defocus] done '.length).trim() : '';
  if (!outPath || !fs.existsSync(outPath)) return { ok: false as const, reason: 'no_output', message: 'Depth map produced no output.' };
  return { ok: true as const, path: outPath };
});

// Emulsion METRIC Depth DoF — compute an Apple Depth Pro METRIC depth map once
// (~8s; first run downloads ~1.9GB weights). Emits an 8-bit depth PNG (0=near,
// 255=far) plus the metric { minM, maxM } range so the worker reconstructs true
// metres for physically-correct thin-lens bokeh. focus (metres) / f-number / haze
// stay live in the worker afterwards.
ipcMain.handle('hjen:emulsion-depthpro', async (_e: any, args: { imagePath: string }) => {
  const py = resolveWorldPython();
  if (!py) return { ok: false as const, reason: 'no_python', message: 'Local depth model unavailable — no Python with Depth Pro found. Set HJEN_WORLD_PY or install the world_from_image venv.' };
  const script = worldkitScript('depthpro_cli.py');
  if (!fs.existsSync(script)) return { ok: false as const, reason: 'no_script', message: `depthpro_cli.py not found at ${script}` };
  if (!fs.existsSync(args.imagePath)) return { ok: false as const, reason: 'no_image', message: `Image not found: ${args.imagePath}` };

  const dir = path.join(app.getPath('userData'), 'emulsion_depthpro', 'd' + Date.now().toString(36));
  fs.mkdirSync(dir, { recursive: true });

  let stdout = '';
  const code = await new Promise<number>((resolve) => {
    const p = childProcess.spawn(py, [script, dir, args.imagePath], { stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    p.stderr.on('data', () => { /* transformers logs noise */ });
    p.on('close', (c: number) => resolve(c ?? 1));
    p.on('error', () => resolve(1));
  });
  if (code !== 0) return { ok: false as const, reason: 'failed', message: `Depth Pro sidecar exited ${code}` };

  const lines = stdout.split(/\r?\n/).map(l => l.trim());
  const rangeLine = lines.find(l => l.startsWith('[depthpro] range '));
  const doneLine = lines.find(l => l.startsWith('[depthpro] done '));
  const outPath = doneLine ? doneLine.slice('[depthpro] done '.length).trim() : '';
  const rangeParts = rangeLine ? rangeLine.slice('[depthpro] range '.length).trim().split(/\s+/) : [];
  const minM = parseFloat(rangeParts[0]);
  const maxM = parseFloat(rangeParts[1]);
  if (!outPath || !fs.existsSync(outPath)) return { ok: false as const, reason: 'no_output', message: 'Depth Pro produced no output.' };
  if (!Number.isFinite(minM) || !Number.isFinite(maxM)) return { ok: false as const, reason: 'no_range', message: 'Depth Pro produced no metric range.' };
  return { ok: true as const, path: outPath, minM, maxM };
});

// Emulsion Scene Protect — segmentation-aware treatment. Compute the masks ONCE
// (~4s Segformer ADE20k); skin-protect + sky-treat strengths are then live in the
// worker. Emits {stem}_seg_skin.png / _seg_sky.png / _seg_plant.png into a temp dir.
ipcMain.handle('hjen:emulsion-segment', async (_e: any, args: { imagePath: string }) => {
  const py = resolveWorldPython();
  if (!py) return { ok: false as const, reason: 'no_python', message: 'Local segmentation model unavailable — no Python with Segformer found. Set HJEN_WORLD_PY or install the world_from_image venv.' };
  const script = worldkitScript('segment_cli.py');
  if (!fs.existsSync(script)) return { ok: false as const, reason: 'no_script', message: `segment_cli.py not found at ${script}` };
  if (!fs.existsSync(args.imagePath)) return { ok: false as const, reason: 'no_image', message: `Image not found: ${args.imagePath}` };

  const dir = path.join(app.getPath('userData'), 'emulsion_seg', 's' + Date.now().toString(36));
  fs.mkdirSync(dir, { recursive: true });

  let stdout = '';
  const code = await new Promise<number>((resolve) => {
    const p = childProcess.spawn(py, [script, dir, args.imagePath], { stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    p.stderr.on('data', () => { /* transformers logs noise */ });
    p.on('close', (c: number) => resolve(c ?? 1));
    p.on('error', () => resolve(1));
  });
  if (code !== 0) return { ok: false as const, reason: 'failed', message: `Segmentation sidecar exited ${code}` };

  const done = stdout.split(/\r?\n/).map(l => l.trim()).find(l => l.startsWith('[seg] done '));
  const outDir = done ? done.slice('[seg] done '.length).trim() : '';
  if (!outDir) return { ok: false as const, reason: 'no_output', message: 'Segmentation produced no output.' };
  const stem = path.basename(args.imagePath).replace(/\.[^.]+$/, '');
  const skin = path.join(outDir, `${stem}_seg_skin.png`);
  const sky = path.join(outDir, `${stem}_seg_sky.png`);
  if (!fs.existsSync(skin) || !fs.existsSync(sky)) return { ok: false as const, reason: 'no_output', message: 'Segmentation masks missing.' };
  return { ok: true as const, skin, sky };
});

// The Swap · edge stencil. make_canny.py is PIL-only — no torch, no model
// weights — so it is the ONE plate that survives on a machine with nothing
// installed but a Python that can import PIL. When `maskPath` is given (the
// person matte from hjen:emulsion-segment) the stencil covers the SUBJECT ONLY
// and everything around them comes back blank, which is what a place swap needs:
// the subject's outline held, the world left free.
//
// `available: false` is a first-class answer, not an error. The caller drops the
// plate, fires the take prompt-only, and says why in one sentence. Never a
// silent downgrade, never a hard block.
ipcMain.handle('hjen:swap-canny', async (_e: any, args: { imagePath: string; maskPath?: string }) => {
  const py = resolveWorldPython();
  if (!py) return { ok: false as const, available: false, message: 'No Python found on this machine, so the edge stencil could not be built.' };
  const script = worldkitScript('make_canny.py');
  if (!fs.existsSync(script)) return { ok: false as const, available: false, message: `make_canny.py not found at ${script}` };
  if (!fs.existsSync(args.imagePath)) return { ok: false as const, available: false, message: `Image not found: ${args.imagePath}` };
  // PIL is the script's only dependency — probe it rather than let the spawn
  // fail with an exit code the user cannot read.
  try { childProcess.execFileSync(py, ['-c', 'import PIL'], { stdio: 'ignore' }); }
  catch { return { ok: false as const, available: false, message: 'This Python has no PIL, so the edge stencil could not be built.' }; }

  const dir = path.join(app.getPath('userData'), 'swap_plates', 'c' + Date.now().toString(36));
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, path.basename(args.imagePath).replace(/\.[^.]+$/, '') + '_canny.png');

  const argv = [script, '--input', args.imagePath, '--output', out];
  if (args.maskPath && fs.existsSync(args.maskPath)) argv.push('--mask', args.maskPath);

  const code = await new Promise<number>((resolve) => {
    const p = childProcess.spawn(py, argv, { stdio: ['ignore', 'ignore', 'pipe'] });
    p.stderr.on('data', () => { /* PIL noise */ });
    p.on('close', (c: number) => resolve(c ?? 1));
    p.on('error', () => resolve(1));
  });
  if (code !== 0 || !fs.existsSync(out)) {
    return { ok: false as const, available: false, message: `The edge stencil sidecar exited ${code}.` };
  }
  return { ok: true as const, available: true, cannyPath: out };
});

// save an Angle Pack: plate.png + camera.json + prompt.txt under the world dir.
ipcMain.handle('hjen:world-pack-save', async (_e: any, args: { dir: string; packId?: string; pngDataUrl: string; camera: any; prompt: string }) => {
  try {
    const packId = args.packId || ('pack_' + Date.now().toString(36));
    const packDir = path.join(args.dir, 'packs', packId);
    fs.mkdirSync(packDir, { recursive: true });
    const b64 = args.pngDataUrl.split(',')[1] || '';
    const platePath = path.join(packDir, 'plate.png');
    fs.writeFileSync(platePath, Buffer.from(b64, 'base64'));
    fs.writeFileSync(path.join(packDir, 'camera.json'), JSON.stringify(args.camera, null, 2));
    fs.writeFileSync(path.join(packDir, 'prompt.txt'), args.prompt || '');
    return { ok: true as const, packDir, platePath };
  } catch (e: any) {
    return { ok: false as const, message: String(e?.message || e) };
  }
});

// Film Space — write a COMPLETE Angle Pack from the built-stage viewer. Unlike
// hjen:world-pack-save (plate + camera.json + prompt only), the stage is real
// geometry, so depth / outline / pose are EXACT and rendered client-side — this
// channel persists all six files as a `hjen.anglepack.camera/1` pack directory.
function resolveFilmspaceFfmpeg(): string | null {
  const home = os.homedir();
  for (const p of [path.join(home, '.local/bin/ffmpeg'), '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

ipcMain.handle('hjen:filmspace-pack-save', async (_e: any, args: {
  dir: string; packId?: string;
  plate: string; depth?: string; outline?: string; pose?: string;
  camera: any; prompt: string;
  clip?: string; clipMime?: string;   // MOVE mode: a recorded preview (webm/mp4 data URL)
  sessionId?: string; projectSlug?: string;   // tie this pack to the active session
}) => {
  try {
    if (!args.dir) return { ok: false as const, message: 'No pack directory.' };
    const packId = args.packId || ('pack_' + Date.now().toString(36));
    const packDir = path.join(args.dir, 'packs', packId);
    fs.mkdirSync(packDir, { recursive: true });
    // Stamp the owning session onto the camera manifest, so the association travels
    // with the pack even if the session index is lost.
    if (args.sessionId && args.camera && typeof args.camera === 'object') args.camera.session_id = args.sessionId;
    const writePng = (name: string, dataUrl?: string) => {
      if (!dataUrl) return null;
      const b64 = dataUrl.split(',')[1] || '';
      if (!b64) return null;
      const p = path.join(packDir, name);
      fs.writeFileSync(p, Buffer.from(b64, 'base64'));
      return p;
    };
    const platePath = writePng('plate.png', args.plate);
    if (!platePath) return { ok: false as const, message: 'The plate render was empty.' };
    writePng('depth.png', args.depth);
    writePng('outline.png', args.outline);
    writePng('pose.png', args.pose);
    fs.writeFileSync(path.join(packDir, 'camera.json'), JSON.stringify(args.camera, null, 2));
    fs.writeFileSync(path.join(packDir, 'prompt.txt'), args.prompt || '');

    // MOVE mode — persist the recorded preview. Record arrives as webm; transcode
    // to preview.mp4 via ffmpeg when available (ANGLE_PACK_SPEC preview.mp4), else
    // keep the webm as a documented fallback.
    let previewFile: string | null = null;
    if (args.clip) {
      const b64 = args.clip.split(',')[1] || '';
      if (b64) {
        const isMp4 = /mp4/i.test(args.clipMime || '');
        const rawExt = isMp4 ? 'mp4' : 'webm';
        const rawPath = path.join(packDir, 'preview.' + rawExt);
        fs.writeFileSync(rawPath, Buffer.from(b64, 'base64'));
        previewFile = 'preview.' + rawExt;
        if (!isMp4) {
          const ff = resolveFilmspaceFfmpeg();
          if (ff) {
            const mp4Path = path.join(packDir, 'preview.mp4');
            const ok = await new Promise<boolean>((resolve) => {
              const p = childProcess.spawn(ff, ['-y', '-v', 'error', '-i', rawPath,
                '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4Path],
                { stdio: ['ignore', 'ignore', 'pipe'] });
              p.on('close', (code: number) => resolve(code === 0 && fs.existsSync(mp4Path)));
              p.on('error', () => resolve(false));
            });
            if (ok) { try { fs.unlinkSync(rawPath); } catch { /* keep webm if unlink fails */ } previewFile = 'preview.mp4'; }
          }
        }
      }
    }

    // Tie the output to its session: a sidecar (survives the index) + append the
    // packId to the session's own record so a session lists exactly its packs.
    if (args.sessionId) {
      try { fs.writeFileSync(path.join(packDir, 'session.txt'), args.sessionId); } catch { /* non-fatal */ }
      try {
        const root = args.projectSlug ? projectFolder(args.projectSlug) : path.join(projectsRootPath(), '_unassigned');
        const sessJson = path.join(root, 'FilmSpace', 'sessions', args.sessionId, 'session.json');
        if (fs.existsSync(sessJson)) {
          const doc = JSON.parse(fs.readFileSync(sessJson, 'utf8'));
          doc.packIds = Array.isArray(doc.packIds) ? doc.packIds : [];
          if (!doc.packIds.includes(packId)) { doc.packIds.push(packId); fs.writeFileSync(sessJson, JSON.stringify(doc, null, 2)); }
        }
      } catch { /* non-fatal */ }
    }

    const files = fs.readdirSync(packDir).sort();
    return { ok: true as const, packDir, packId, platePath, files, previewFile };
  } catch (e: any) {
    return { ok: false as const, message: String(e?.message || e) };
  }
});

// Film Space — saved SESSIONS. A session persists a project's full stage snapshot
// (getSceneState) plus the ids of the Angle Packs locked while it was active, so a
// producer can reopen exactly the scene that made a set of outputs. Layout mirrors
// packs: <project>/FilmSpace/sessions/<sessionId>/{session.json, thumb.png}.
ipcMain.handle('hjen:filmspace-session-save', async (_e: any, args: { projectSlug?: string; sessionId?: string; name: string; state: unknown; thumbnail?: string }) => {
  try {
    const root = args.projectSlug ? projectFolder(args.projectSlug) : path.join(projectsRootPath(), '_unassigned');
    const sessionId = args.sessionId || ('sess_' + Date.now().toString(36));
    const dir = path.join(root, 'FilmSpace', 'sessions', sessionId);
    fs.mkdirSync(dir, { recursive: true });
    const jsonPath = path.join(dir, 'session.json');
    // preserve pack associations already recorded for this session
    let packIds: string[] = [];
    if (fs.existsSync(jsonPath)) { try { const prev = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); if (Array.isArray(prev.packIds)) packIds = prev.packIds; } catch { /* fresh */ } }
    const savedAt = Date.now();
    const doc = { schema: 'hjen.filmspace.session/1', id: sessionId, name: String(args.name || 'Untitled session'), savedAt, packIds, state: args.state };
    fs.writeFileSync(jsonPath, JSON.stringify(doc, null, 2));
    let thumbPath: string | null = null;
    if (args.thumbnail) {
      const b64 = args.thumbnail.split(',')[1] || '';
      if (b64) { thumbPath = path.join(dir, 'thumb.png'); fs.writeFileSync(thumbPath, Buffer.from(b64, 'base64')); }
    } else { const existing = path.join(dir, 'thumb.png'); if (fs.existsSync(existing)) thumbPath = existing; }
    return { ok: true as const, sessionId, dir, savedAt, thumbPath, packIds };
  } catch (e: any) {
    return { ok: false as const, message: String(e?.message || e) };
  }
});

ipcMain.handle('hjen:filmspace-sessions-list', (_e: any, args: { projectSlug?: string }) => {
  try {
    const root = args?.projectSlug ? projectFolder(args.projectSlug) : path.join(projectsRootPath(), '_unassigned');
    const sessionsRoot = path.join(root, 'FilmSpace', 'sessions');
    if (!fs.existsSync(sessionsRoot)) return { ok: true as const, sessionsRoot, sessions: [] as any[] };
    const sessions: Array<{ id: string; name: string; savedAt: number; thumbPath: string | null; packIds: string[]; dir: string }> = [];
    for (const id of fs.readdirSync(sessionsRoot) as string[]) {
      const dir = path.join(sessionsRoot, id);
      const st = (() => { try { return fs.statSync(dir); } catch { return null; } })();
      if (!st || !st.isDirectory()) continue;
      const jsonPath = path.join(dir, 'session.json');
      if (!fs.existsSync(jsonPath)) continue;
      let doc: any = null;
      try { doc = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch { continue; }
      const thumb = path.join(dir, 'thumb.png');
      sessions.push({ id: doc.id || id, name: doc.name || id, savedAt: doc.savedAt || st.mtimeMs, thumbPath: fs.existsSync(thumb) ? thumb : null, packIds: Array.isArray(doc.packIds) ? doc.packIds : [], dir });
    }
    sessions.sort((a, b) => b.savedAt - a.savedAt);   // newest first
    return { ok: true as const, sessionsRoot, sessions };
  } catch (e: any) {
    return { ok: false as const, message: String(e?.message || e), sessions: [] as any[] };
  }
});

ipcMain.handle('hjen:filmspace-session-get', (_e: any, args: { projectSlug?: string; sessionId: string }) => {
  try {
    const root = args?.projectSlug ? projectFolder(args.projectSlug) : path.join(projectsRootPath(), '_unassigned');
    const jsonPath = path.join(root, 'FilmSpace', 'sessions', args.sessionId, 'session.json');
    if (!fs.existsSync(jsonPath)) return { ok: false as const, message: 'Session not found.' };
    const doc = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    return { ok: true as const, id: doc.id, name: doc.name, savedAt: doc.savedAt, packIds: Array.isArray(doc.packIds) ? doc.packIds : [], state: doc.state };
  } catch (e: any) {
    return { ok: false as const, message: String(e?.message || e) };
  }
});

ipcMain.handle('hjen:filmspace-session-delete', (_e: any, args: { projectSlug?: string; sessionId: string }) => {
  try {
    const root = args?.projectSlug ? projectFolder(args.projectSlug) : path.join(projectsRootPath(), '_unassigned');
    const dir = path.join(root, 'FilmSpace', 'sessions', args.sessionId);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    return { ok: true as const, sessionId: args.sessionId };
  } catch (e: any) {
    return { ok: false as const, message: String(e?.message || e) };
  }
});

// Film Space movement-preset previews — small thumbnails rendered from OUR OWN
// stage (never copied media), cached under userData so they survive restarts.
ipcMain.handle('hjen:filmspace-presets-save', async (_e: any, args: { items: { id: string; dataUrl: string }[] }) => {
  try {
    const dir = path.join(app.getPath('userData'), 'filmspace-presets');
    fs.mkdirSync(dir, { recursive: true });
    let n = 0;
    for (const it of (args.items || [])) {
      const b64 = (it.dataUrl || '').split(',')[1] || '';
      if (!b64 || !/^[a-z0-9-]+$/i.test(it.id)) continue;
      fs.writeFileSync(path.join(dir, it.id + '.png'), Buffer.from(b64, 'base64'));
      n++;
    }
    return { ok: true as const, dir, count: n };
  } catch (e: any) {
    return { ok: false as const, message: String(e?.message || e) };
  }
});
// Absolute dir of the vendored, offline pose engine (MediaPipe wasm + model),
// shipped inside the renderer bundle (public/ in dev → dist/ in prod). The Film
// Space iframe fetches these over hjen-file:// to run pose-from-image on-device.
ipcMain.handle('hjen:filmspace-pose-dir', () => {
  try {
    const base = process.env.VITE_DEV_SERVER_URL
      ? path.join(__dirname, '..', 'public')
      : path.join(__dirname, '..', 'dist');
    const dir = path.join(base, 'filmspace', 'assets', 'pose');
    const model = path.join(dir, 'pose_landmarker_full.task');
    const ready = fs.existsSync(model);
    return { ok: ready as boolean, dir, ready };
  } catch (e: any) {
    return { ok: false as const, dir: '', ready: false, message: String(e?.message || e) };
  }
});

ipcMain.handle('hjen:filmspace-presets-list', () => {
  try {
    const dir = path.join(app.getPath('userData'), 'filmspace-presets');
    if (!fs.existsSync(dir)) return { ok: true as const, dir, ids: [] as string[] };
    const ids = (fs.readdirSync(dir) as string[]).filter((f: string) => f.endsWith('.png')).map((f: string) => f.replace(/\.png$/, ''));
    return { ok: true as const, dir, ids };
  } catch (e: any) {
    return { ok: false as const, message: String(e?.message || e), ids: [] as string[] };
  }
});

// Film Space — READ-ONLY listing of a project's locked Angle Packs. Reads the
// SAME layout the LOCK writes (<project>/FilmSpace/packs/<packId>/) but never
// touches it: enumerate pack folders, require a plate.png (the anchor), and
// surface camera.json + prompt.txt so Camera Angles can offer each pack as a
// "From Film Space" angle. Decoupled by design — works off disk alone; does not
// depend on Film Space being open, compiled, or "finished".
ipcMain.handle('hjen:filmspace-packs-list', (_e: any, args: { projectSlug?: string }) => {
  try {
    const root = args?.projectSlug ? projectFolder(args.projectSlug) : path.join(projectsRootPath(), '_unassigned');
    const packsRoot = path.join(root, 'FilmSpace', 'packs');
    if (!fs.existsSync(packsRoot)) return { ok: true as const, packsRoot, packs: [] as any[] };
    const packs: Array<{ packId: string; packDir: string; platePath: string; outlinePath: string | null; depthPath: string | null; posePath: string | null; camera: unknown; prompt: string; previewFile: string | null; at: number }> = [];
    for (const packId of fs.readdirSync(packsRoot) as string[]) {
      const packDir = path.join(packsRoot, packId);
      const st = (() => { try { return fs.statSync(packDir); } catch { return null; } })();
      if (!st || !st.isDirectory()) continue;
      const platePath = path.join(packDir, 'plate.png');
      if (!fs.existsSync(platePath)) continue;   // plate is the anchor — skip incomplete packs
      // Structural layers (line / depth / pose). Camera Angles sends THESE — not
      // the body plate — as the geometry reference for a Film-Space-sourced make,
      // so the safety filter never sees a photo-like body. null when a pack is too
      // old to carry one (the make then falls back to the plate).
      const sib = (name: string) => { const p = path.join(packDir, name); return fs.existsSync(p) ? p : null; };
      const outlinePath = sib('outline.png');
      const depthPath = sib('depth.png');
      const posePath = sib('pose.png');
      let camera: unknown = null;
      try { camera = JSON.parse(fs.readFileSync(path.join(packDir, 'camera.json'), 'utf8')); } catch { /* optional */ }
      let prompt = '';
      try { prompt = fs.readFileSync(path.join(packDir, 'prompt.txt'), 'utf8'); } catch { /* optional */ }
      const mp4 = path.join(packDir, 'preview.mp4');
      const webm = path.join(packDir, 'preview.webm');
      const previewFile = fs.existsSync(mp4) ? mp4 : (fs.existsSync(webm) ? webm : null);
      packs.push({ packId, packDir, platePath, outlinePath, depthPath, posePath, camera, prompt, previewFile, at: st.mtimeMs });
    }
    packs.sort((a, b) => b.at - a.at);   // newest first
    return { ok: true as const, packsRoot, packs };
  } catch (e: any) {
    return { ok: false as const, message: String(e?.message || e), packs: [] as any[] };
  }
});

// finish an Angle Pack: plate → canny + depth → gpt-image-2 in the Clay & Basil
// DNA, angle held. Runs the same lock the freecam pipeline proved, in-app.
ipcMain.handle('hjen:world-finish', async (_e: any, args: { platePath: string; outDir: string; quality?: string }) => {
  const py = resolveWorldPython();
  if (!py) return { ok: false as const, message: 'No Python with the depth model found.' };
  const script = worldkitScript('finish.py');
  if (!fs.existsSync(script)) return { ok: false as const, message: `finish.py not found at ${script}` };
  if (!fs.existsSync(args.platePath)) return { ok: false as const, message: `Plate not found: ${args.platePath}` };
  const keyFile = path.join(app.getPath('userData'), 'openai_key.txt');
  const openaiKey = process.env.OPENAI_API_KEY || (fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf-8').trim() : '');
  // Second and last door that needs a real local key: this one spawns a python
  // process and passes OPENAI_API_KEY in its environment, so there is nothing
  // for providerFetch to intercept. Film Space's finish pass is BYO-key.
  if (!openaiKey) return { ok: false as const, message: 'Film Space finishing needs your own OpenAI key. Add it in Settings → API Keys.' };

  const outDir = args.outDir || path.dirname(args.platePath);
  const result = await new Promise<{ ok: boolean; locked?: string; error?: string }>((resolve) => {
    const p = childProcess.spawn(py, [script, '--plate', args.platePath, '--out', outDir, '--quality', args.quality || 'high'],
      { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, OPENAI_API_KEY: openaiKey } });
    let out = '';
    p.stdout.on('data', (d: Buffer) => { out += d.toString(); mainWindow?.webContents.send('hjen:world-progress', { worldId: 'finish', line: 'finishing…' }); });
    p.stderr.on('data', () => { /* model logs */ });
    p.on('close', () => {
      const line = out.trim().split('\n').filter(Boolean).pop() || '{}';
      try { resolve(JSON.parse(line)); } catch { resolve({ ok: false, error: out.slice(-400) }); }
    });
    p.on('error', (e: any) => resolve({ ok: false, error: String(e?.message || e) }));
  });
  if (!result.ok || !result.locked) return { ok: false as const, message: result.error || 'finish failed' };
  const url = `hjen-file://${encodeURI(result.locked.split(path.sep).join('/'))}`;
  let lockedBase64 = '';
  try { lockedBase64 = fs.readFileSync(result.locked).toString('base64'); } catch { /* ignore */ }
  return { ok: true as const, lockedPath: result.locked, lockedUrl: url, lockedBase64 };
});

// ─── In-app Assistant (MCP surface ②) ──────────────────────────────────────
// A Claude agent that drives HJEN through the SAME hjen MCP tools an external
// agent uses. Lazily spawns the hjen MCP server (mcp/run.sh) as a stdio client
// and reuses the app's Anthropic key. Engine lives in mcp/dist/agent (built).
let assistantMount: any = null;
function anthropicKeyOrNull(): string | null {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const keyFile = path.join(app.getPath('userData'), 'anthropic_key.txt');
  if (fs.existsSync(keyFile)) return fs.readFileSync(keyFile, 'utf-8').trim() || null;
  return null;
}
// Per-tool scope for the "/frame · /storyboard · /video · /story · /node"
// commands — pins the agent to ONE surface's tools so a request never leaks
// into the wrong place (e.g. remaking a storyboard panel via the Frame maker).
// Tools physically hidden from the agent per scope (deterministic guardrail —
// see below where `gated` is built). The agent CANNOT call what it can't see.
const SCOPE_BLOCK: Record<string, string[]> = {
  storyboard: ['hjen_frame_make', 'hjen_portrait_refine', 'hjen_video_make', 'hjen_chain_run', 'hjen_graph_run', 'hjen_graph_upsert'],
  frame: ['hjen_storyboard_shot_make', 'hjen_storyboard_shot_upsert', 'hjen_video_make', 'hjen_chain_run', 'hjen_graph_run', 'hjen_graph_upsert'],
  video: ['hjen_storyboard_shot_make', 'hjen_storyboard_shot_upsert', 'hjen_graph_run', 'hjen_graph_upsert'],
  node: ['hjen_frame_make', 'hjen_portrait_refine', 'hjen_video_make', 'hjen_storyboard_shot_make', 'hjen_storyboard_shot_upsert', 'hjen_chain_run'],
  story: ['hjen_frame_make', 'hjen_portrait_refine', 'hjen_video_make', 'hjen_chain_run', 'hjen_storyboard_shot_make', 'hjen_graph_run'],
};
const SCOPE_RULES: Record<string, string> = {
  storyboard: 'SCOPE = STORYBOARD. Operate ONLY on the storyboard, and DRIVE THE LIVE APP so the user watches every step. Full pipeline from a script, in order: hjen_storyboard_set_script → hjen_storyboard_breakdown → hjen_storyboard_cast → hjen_storyboard_assets_make (confirm) → hjen_storyboard_panels_make (confirm). For specific shots use hjen_storyboard_shots_make (parallel) or hjen_storyboard_shot_make (single). ALL of these run the app\'s REAL actions live (board style + references + correct save location). NEVER use hjen_frame_make for a panel. Navigate first with hjen_studio_open if needed.',
  frame: 'SCOPE = FRAME. Operate ONLY on standalone frames. For MORE THAN ONE frame ALWAYS call hjen_frames_make ONCE with all of them (they fire in PARALLEL) — never loop hjen_frame_make. Single frame → hjen_frame_make. Frames are PHOTOGRAPHIC cinematic stills built on the project DNA — do NOT write storyboard / sketch / pencil / line-art style into a frame prompt unless the user EXPLICITLY asks for a sketch. Do NOT touch the storyboard or node graph.',
  video: 'SCOPE = VIDEO. Operate ONLY on video via hjen_video_make (image-to-video / text-to-video). Do NOT make stills or edit the board unless the user asks for a first-frame plate.',
  node: 'SCOPE = NODE. Operate ONLY on the node graph via hjen_graph_upsert / hjen_graph_run. Do NOT make storyboard shots or standalone frames.',
  story: 'SCOPE = STORY. Work on the narrative/structure only (brief, treatment, shot list via hjen_stage_write / hjen_ledger_add / hjen_storyboard_shot_upsert). Do NOT spend on any make tool.',
};
ipcMain.handle('hjen:assistant-turn', async (e: any, args: { message: string; history?: any[]; context?: { surface?: string; projectId?: string | null; projectName?: string | null; attachments?: string[]; scope?: string } }) => {
  // THE ONE DOOR THAT STILL NEEDS A REAL LOCAL KEY. Everything else routes
  // through providerFetch and works on the gateway's key — but this handler
  // does not call Anthropic itself: it hands the key to the MCP agent engine,
  // which drives its own multi-turn tool loop through the SDK. Sending it the
  // gateway placeholder would buy a 401 mid-conversation instead of this
  // honest sentence. Routing it means giving the engine the gateway baseURL —
  // a real change, not a rename, and not worth guessing at.
  const apiKey = anthropicKeyOrNull();
  if (!apiKey) return { ok: false, reason: 'no_key', message: 'The in-app Assistant needs your own Anthropic key. Add it in Settings → API Keys.' };
  const msg = (args?.message || '').trim();
  if (!msg) return { ok: false, reason: 'empty', message: 'Type a message first.' };
  try {
    const mcpDist = path.join(__dirname, '..', '..', 'mcp', 'dist');
    const runSh = path.join(__dirname, '..', '..', 'mcp', 'run.sh');
    if (!assistantMount) {
      // Surface ③ — mount any external MCP servers from {userData}/mcp-servers.json
      // (stdio: [{ name, command, args? }]) alongside the primary hjen server.
      let externals: any[] = [];
      try {
        const cfg = path.join(app.getPath('userData'), 'mcp-servers.json');
        if (fs.existsSync(cfg)) { const parsed = JSON.parse(fs.readFileSync(cfg, 'utf-8')); if (Array.isArray(parsed)) externals = parsed; }
      } catch { /* ignore bad config */ }
      const mountMod: any = await esmImport(pathToFileURL(path.join(mcpDist, 'agent', 'mount.js')).href);
      assistantMount = await mountMod.mountServers({ name: 'hjen', command: runSh }, externals);
    }
    const loopMod: any = await esmImport(pathToFileURL(path.join(mcpDist, 'agent', 'loop.js')).href);
    const ctx = args?.context || {};
    const proj = ctx.projectName ? `project "${ctx.projectName}"${ctx.projectId ? ` (id ${ctx.projectId})` : ''}` : (ctx.projectId ? `project id ${ctx.projectId}` : 'no project is open yet — reuse ONE if you must create it');
    const nodeExtra = ctx.surface === 'node'
      ? `LIVE CONTEXT: You are the Assistant embedded INSIDE THE NODE CANVAS, working on ${proj}. Build ON THIS PROJECT'S CANVAS — do NOT create a new project when one is already open. When the user asks for a "storyboard" or "shots", the deliverable is STORYBOARD SHOTS: call hjen_storyboard_shot_upsert once per shot (scene + letter + description) AND/OR node-graph nodes via hjen_graph_upsert — that is what "storyboard"/"nodes" means here. Do NOT call the paid make tools (hjen_frame_make, hjen_portrait_refine, hjen_video_make, hjen_chain_run, hjen_storyboard_shot_make, hjen_graph_run) unless the user EXPLICITLY asks to "make / render / generate" an actual image or video — and even then, surface the cost estimate (confirm:false) first and wait for a yes. Build the structure first; spend on pixels only on explicit request.`
      : undefined;
    // The in-app Assistant lives INSIDE the running app — opening views must be
    // an action (hjen_studio_open drives this very window), never a printed link.
    const openExtra = `UI NAVIGATION: you are running INSIDE the HJEN Studio app. When the user asks to OPEN anything (a project's node canvas, storyboard, frame, video, library, cast), CALL hjen_studio_open with the project + view — the window navigates immediately. Do not print deep links unless hjen_studio_open returns opened:false.`;
    const attach = Array.isArray(ctx.attachments) ? ctx.attachments.filter(p => typeof p === 'string' && p.trim()) : [];
    const attachExtra = attach.length
      ? `USER ATTACHMENTS: the user attached ${attach.length} local file(s) to this message — absolute paths:\n${attach.map(p => `- ${p}`).join('\n')}\nUse them directly: as \`references\` for hjen_frame_make / hjen_portrait_refine, as \`imagePath\` for hjen_video_make, or view them with hjen_asset_view.`
      : undefined;
    // Always-on guardrail: storyboard panels are made with the storyboard tool,
    // never the frame maker (the recurring wrong-tool bug).
    const boardRule = 'TOOL DISCIPLINE + SPEED: NEVER loop a make-tool one item at a time — always batch. Several frames → hjen_frames_make (one parallel call). Several panels → hjen_storyboard_shots_make or hjen_storyboard_panels_make (parallel). Storyboard panels are ALWAYS made with the storyboard tools (board style + references + writes into the panel), NEVER hjen_frame_make. Fire everything you can in ONE batch so the user waits once, not N times.';
    const scope = args?.context?.scope;
    const scopeExtra = scope && SCOPE_RULES[scope] ? SCOPE_RULES[scope] : undefined;
    const systemExtra = [scopeExtra, openExtra, boardRule, nodeExtra, attachExtra].filter(Boolean).join('\n\n') || undefined;
    // HARD tool-gating: prompt-steering alone isn't reliable, so when the user
    // scopes with "/storyboard" etc. we physically REMOVE the wrong make-tools
    // from the agent's toolset — it then cannot make a Frame inside a storyboard.
    const gated = scope && SCOPE_BLOCK[scope]
      ? assistantMount.tools.filter((t: any) => !SCOPE_BLOCK[scope].includes(t.name))
      : assistantMount.tools;
    const turn = await loopMod.runAgentTurn({
      anthropicKey: apiKey,
      tools: gated,
      callTool: (n: string, a: any) => assistantMount.call(n, a),
      systemExtra,
      onEvent: (ev: any) => { try { e.sender.send('hjen:assistant-event', ev); } catch { /* ignore */ } },
    }, msg, Array.isArray(args?.history) ? args.history : []);
    return { ok: true, mounted: assistantMount.mounted, ...turn };
  } catch (err: any) {
    return { ok: false, message: String(err?.message || err) };
  }
});

// ─── Assistant conversations — persistent, general OR project-linked ────────
// One store, both surfaces: files under {projectsRoot}/_conversations/ (general)
// and {slug}/_project/conversations/ (project). Implemented in the MCP tree
// (mcp/dist/conversations-store.js) so external agents read the SAME history
// via hjen_conversations_list / hjen_conversation_get.
let convoStoreMod: any = null;
let convoHost: any = null;
async function conversationsStore(): Promise<{ mod: any; host: any }> {
  if (!convoStoreMod) {
    const mcpDist = path.join(__dirname, '..', '..', 'mcp', 'dist');
    convoStoreMod = await esmImport(pathToFileURL(path.join(mcpDist, 'conversations-store.js')).href);
    const hostMod: any = await esmImport(pathToFileURL(path.join(mcpDist, 'host-node.js')).href);
    convoHost = hostMod.createNodeHost();
  }
  return { mod: convoStoreMod, host: convoHost };
}
ipcMain.handle('hjen:conversations-list', async (_e: any, args?: { projectSlug?: string }) => {
  try { const { mod, host } = await conversationsStore(); return { ok: true, conversations: mod.listConversations(host, args || {}) }; }
  catch (err: any) { return { ok: false, message: String(err?.message || err), conversations: [] }; }
});
ipcMain.handle('hjen:conversation-read', async (_e: any, args: { id: string; kind?: string; projectSlug?: string }) => {
  try { const { mod, host } = await conversationsStore(); return { ok: true, conversation: mod.readConversation(host, args?.id, { kind: args?.kind, projectSlug: args?.projectSlug }) }; }
  catch (err: any) { return { ok: false, message: String(err?.message || err), conversation: null }; }
});
ipcMain.handle('hjen:conversation-write', async (_e: any, convo: any) => {
  try { const { mod, host } = await conversationsStore(); return mod.writeConversation(host, convo); }
  catch (err: any) { return { ok: false, reason: String(err?.message || err) }; }
});
ipcMain.handle('hjen:conversation-delete', async (_e: any, args: { id: string }) => {
  try { const { mod, host } = await conversationsStore(); return mod.deleteConversation(host, args?.id); }
  catch (err: any) { return { ok: false }; }
});

// ─── MCP Hub — Connect + External-servers config (surfaces ① and ③) ─────────
ipcMain.handle('hjen:mcp-endpoint-config', () => {
  const mcpDir = path.join(__dirname, '..', '..', 'mcp');
  return {
    mcpDir,
    runShPath: path.join(mcpDir, 'run.sh'),
    serveHttpPath: path.join(mcpDir, 'serve-http.sh'),
    defaultHttpUrl: (process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:8788').replace(/\/$/, '') + '/mcp',
  };
});
function mcpServersPath(): string { return path.join(app.getPath('userData'), 'mcp-servers.json'); }
ipcMain.handle('hjen:mcp-list-servers', () => {
  try { const f = mcpServersPath(); if (fs.existsSync(f)) { const a = JSON.parse(fs.readFileSync(f, 'utf-8')); return Array.isArray(a) ? a : []; } } catch { /* ignore */ }
  return [];
});
ipcMain.handle('hjen:mcp-set-servers', (_e: any, servers: any[]) => {
  try {
    const f = mcpServersPath();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(Array.isArray(servers) ? servers : [], null, 2));
    assistantMount = null; // force re-mount on next assistant turn so new servers load
    return { ok: true };
  } catch (err: any) { return { ok: false, reason: err?.message || 'write_failed' }; }
});

// ---- Browser door (HJEN Clipper) — status + signed-in browsers ----
// Browsers sign themselves in through an Allow dialog; nothing is ever pasted.
// Settings lists what is connected and can sign any of it out.
ipcMain.handle('hjen:clipper-status', () => clipperStatus());
ipcMain.handle('hjen:clipper-revoke', (_e: any, args: { id: string }) => clipperRevoke(args?.id));
ipcMain.handle('hjen:clipper-revoke-all', () => clipperRevokeAll());
// Which save methods are live is decided HERE, in the app — the extension only
// asks. One place to change it, and it survives reinstalling the extension.
ipcMain.handle('hjen:clipper-set-prefs', (_e: any, patch: any) => clipperSetPrefs(patch));

// ---- External tools (Settings → Tools) ----
// What this Mac actually has. The app leans on programs it does not ship —
// ffmpeg, yt-dlp, whisper, python — and when one is absent the tool that needs
// it used to fail with a raw ENOENT. This is the honest answer, per program,
// and "check again" re-probes so an install is picked up without a restart.
ipcMain.handle('hjen:tools-status', () => ({ ok: true as const, tools: toolsStatus() }));
ipcMain.handle('hjen:tools-recheck', () => { refreshTools(); return { ok: true as const, tools: toolsStatus() }; });
// Download — the portable form of "Show folder": a .zip that can travel to a
// second machine or a colleague. Lands in Downloads without a save dialog,
// which is what "download" means everywhere else, then reveals itself so the
// user can see where it went.
ipcMain.handle('hjen:clipper-download', async (_e: any, args: { target?: string }) => {
  const target = String(args?.target || 'chrome') as any;
  let dest = app.getPath('downloads');
  try { fs.mkdirSync(dest, { recursive: true }); } catch { dest = app.getPath('home'); }
  const res = await clipperDownload(target, dest);
  if (res.ok && res.path) { try { electron.shell.showItemInFolder(res.path); } catch { /* no Finder */ } }
  return res;
});

ipcMain.handle('hjen:get-projects', () => {
  const s = readSettings();
  return {
    projects: readProjects(),
    projectsRoot: projectsRootPath(),
    lastProjectId: typeof s.lastProjectId === 'string' ? s.lastProjectId : null,
  };
});

ipcMain.handle('hjen:set-last-project-id', (_e: any, id: string | null) => {
  writeSettings({ lastProjectId: id ?? null });
  return { ok: true };
});

ipcMain.handle('hjen:create-project', (_e: any, args: { name: string }) => {
  const arr = readProjects();
  const baseSlug = slugify(args.name);
  let slug = baseSlug;
  let n = 2;
  while (arr.some(p => p.slug === slug)) { slug = `${baseSlug}-${n++}`; }
  const project: ProjectMeta = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: args.name.trim() || 'Untitled Project',
    slug,
    created: new Date().toISOString(),
    generationCount: 0,
  };
  arr.unshift(project);
  writeProjects(arr);
  fs.mkdirSync(projectFolder(slug), { recursive: true });
  // Seed _project/state.json + mirror the initial stage map onto ProjectMeta
  const seeded = ensureProjectStateOnDisk(slug);
  syncProjectMetaFromState(project.id, seeded);
  // Re-read so the renderer sees the mirrored fields
  const refreshed = readProjects().find(p => p.id === project.id) ?? project;
  return refreshed;
});

ipcMain.handle('hjen:delete-project', (_e: any, args: { id: string; deleteFiles?: boolean }) => {
  const arr = readProjects();
  const target = arr.find(p => p.id === args.id);
  if (!target) return { ok: false, reason: 'not_found' };
  const remaining = arr.filter(p => p.id !== args.id);
  writeProjects(remaining);
  if (args.deleteFiles) {
    const dir = projectFolder(target.slug);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
  return { ok: true };
});

// Rename rules — the project folder name always tracks the project name:
//  1. New display name → new unique slug (slugify + `-n` on collision).
//  2. If the slug changes, the on-disk folder is MOVED to match, and every
//     absolute path stored inside it is repointed to the new location.
//  3. Projects are referenced by stable `id`, so the renderer/handlers keep
//     working; only stored absolute paths need repointing (done in step 2).
//  4. The operation is logged to the project's own ledger.
//  5. On any filesystem failure the display name still changes but the folder
//     is left intact (never leave the project half-moved).
ipcMain.handle('hjen:rename-project', (_e: any, args: { id: string; name: string }) => {
  const arr = readProjects();
  const target = arr.find(p => p.id === args.id);
  if (!target) return null;

  const newName = (args.name || '').trim() || target.name;
  const oldSlug = target.slug;
  const base = slugify(newName);
  let newSlug = base, n = 2;
  while (arr.some(p => p.slug === newSlug && p.id !== target.id)) newSlug = `${base}-${n++}`;

  target.name = newName;

  if (newSlug !== oldSlug) {
    const oldDir = projectFolder(oldSlug);
    const newDir = projectFolder(newSlug);
    try {
      if (fs.existsSync(oldDir)) {
        if (fs.existsSync(newDir)) throw new Error(`target folder already exists: ${newSlug}`);
        fs.renameSync(oldDir, newDir);
        rewriteProjectPaths(newDir, oldDir, newDir);
      } else {
        fs.mkdirSync(newDir, { recursive: true });
      }
      if (target.coverImagePath && target.coverImagePath.startsWith(`${oldDir}/`)) {
        target.coverImagePath = `${newDir}${target.coverImagePath.slice(oldDir.length)}`;
      }
      target.slug = newSlug;
      writeProjects(arr);
      appendProjectLog(newSlug, 'note', `Project renamed to "${newName}" — folder ${oldSlug} → ${newSlug}; stored paths repointed.`);
    } catch (err: any) {
      // keep the display-name change; leave the folder where it is
      writeProjects(arr);
      appendProjectLog(oldSlug, 'risk', `Rename to "${newName}" kept the name but could NOT move the folder (${oldSlug} → ${newSlug}): ${String(err?.message || err)}`);
    }
  } else {
    writeProjects(arr);
  }
  return target;
});

// Pin any generation image as the project's hero cover. Pass null to clear.
ipcMain.handle('hjen:set-project-cover', (_e: any, args: { id: string; imgPath: string | null }) => {
  const arr = readProjects();
  const target = arr.find(p => p.id === args.id);
  if (!target) return null;
  if (args.imgPath && typeof args.imgPath === 'string') {
    target.coverImagePath = args.imgPath;
  } else {
    delete target.coverImagePath;
  }
  writeProjects(arr);
  return target;
});

// ─── Per-project pipeline state ────────────────────────────
// {projectSlug}/_project/state.json is the source of truth. ProjectMeta
// carries a thin mirror so the Projects list doesn't have to read every
// project's sidecar to render the stage rail.

ipcMain.handle('hjen:read-project-state', (_e: any, args: { id: string }) => {
  const arr = readProjects();
  const target = arr.find(p => p.id === args.id);
  if (!target) return null;
  const state = ensureProjectStateOnDisk(target.slug);
  // Backfill the cheap mirror for projects created before this feature
  if (target.currentStage === undefined || target.stagesState === undefined) {
    syncProjectMetaFromState(args.id, state);
  }
  return state;
});

ipcMain.handle('hjen:write-project-state', (_e: any, args: { id: string; state: ProjectState }) => {
  const arr = readProjects();
  const target = arr.find(p => p.id === args.id);
  if (!target) return null;
  if (!args.state || args.state.version !== 1) return null;
  const statePath = projectStatePath(target.slug);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(args.state, null, 2));
  return syncProjectMetaFromState(args.id, args.state);
});

ipcMain.handle('hjen:read-stage-data', (_e: any, args: { id: string; stage: StageNumber }) => {
  const arr = readProjects();
  const target = arr.find(p => p.id === args.id);
  if (!target) return null;
  const f = projectDataPath(target.slug, args.stage);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf-8')); }
  catch { return null; }
});

ipcMain.handle('hjen:write-stage-data', (_e: any, args: { id: string; stage: StageNumber; data: unknown; markdown?: string }) => {
  const arr = readProjects();
  const target = arr.find(p => p.id === args.id);
  if (!target) return { ok: false };
  const f = projectDataPath(target.slug, args.stage);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(args.data, null, 2));
  // Mirror to human-readable .md when the stage has one (Brief, Treatment)
  const mdName = stageMarkdownFilename(args.stage);
  if (mdName && typeof args.markdown === 'string') {
    fs.writeFileSync(path.join(projectFolder(target.slug), '_project', mdName), args.markdown);
  }
  return { ok: true };
});

// Generic per-project JSON doc under {slug}/_project/<name>.json — a shared
// sidecar not owned by any of the 8 stages. Backs the Creative 360 mind's
// persisted POV (creative_pov.json), reusable for any cross-tool artifact.
// `name` is sanitized to a bare filename so a caller can't escape the folder.
function projectDocPath(slug: string, name: string): string {
  const safe = String(name || 'doc').replace(/[^\w.\-]+/g, '_').replace(/\.json$/i, '').slice(0, 60) || 'doc';
  return path.join(projectFolder(slug), '_project', `${safe}.json`);
}
ipcMain.handle('hjen:project-doc-read', (_e: any, args: { id: string; name: string }) => {
  const target = readProjects().find(p => p.id === args.id);
  if (!target) return null;
  const f = projectDocPath(target.slug, args.name);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf-8')); } catch { return null; }
});
ipcMain.handle('hjen:project-doc-write', (_e: any, args: { id: string; name: string; data: unknown }) => {
  const target = readProjects().find(p => p.id === args.id);
  if (!target) return { ok: false };
  const f = projectDocPath(target.slug, args.name);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(args.data, null, 2));
  return { ok: true };
});

// ─── Reference Maker — deck → director contract → drift-checked take ──────
// The PDF extractor is a small project-local sidecar. It extracts each embedded
// visual independently (never a composite page crop) while recording its
// page/order/bbox, so overlapping deck masks cannot bleed one reference into
// another and the renderer never has to guess the supplied sequence.
function referenceDeckScript(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin', 'reference_deck_extract.py')
    : path.join(app.getAppPath(), 'bin', 'reference_deck_extract.py');
}

function runProcess(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk: any) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk: any) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', (code: number | null) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function jsonObjectFromText(text: string): any | null {
  const clean = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try { return JSON.parse(clean); } catch {}
  const first = clean.indexOf('{'), last = clean.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  try { return JSON.parse(clean.slice(first, last + 1)); } catch { return null; }
}

function llmProvider(model: string): 'anthropic' | 'openai' | 'google' {
  if (/^claude/i.test(model)) return 'anthropic';
  if (/^(gpt|o\d)/i.test(model)) return 'openai';
  return 'google';
}

ipcMain.handle('hjen:reference-deck-import', async (_e: any, args: { projectId?: string; sourcePath?: string }) => {
  const target = readProjects().find(project => project.id === args?.projectId);
  if (!target) return { ok: false, reason: 'no_project', message: 'Open a project before importing a reference deck.' };
  let source = String(args?.sourcePath || '');
  if (!source) {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    const picked = await dialog.showOpenDialog(win, {
      title: 'Open reference deck',
      properties: ['openFile'],
      filters: [{ name: 'PDF decks', extensions: ['pdf'] }],
    });
    if (picked.canceled || !picked.filePaths[0]) return { ok: false, reason: 'cancelled', message: 'Import cancelled.' };
    source = picked.filePaths[0];
  }
  if (path.extname(source).toLowerCase() !== '.pdf' || !fs.existsSync(source) || !fs.statSync(source).isFile()) {
    return { ok: false, reason: 'bad_pdf', message: 'Choose an existing PDF file.' };
  }
  const script = referenceDeckScript();
  if (!fs.existsSync(script)) return { ok: false, reason: 'missing_extractor', message: 'The PDF extractor is missing from this build.' };
  const deckId = `${slugify(path.basename(source, path.extname(source)))}-${Date.now().toString(36)}`;
  const deckDir = path.join(projectFolder(target.slug), '_reference_maker', 'decks', deckId);
  fs.mkdirSync(deckDir, { recursive: true });
  const localPdf = path.join(deckDir, 'source.pdf');
  fs.copyFileSync(source, localPdf);

  try {
    const result = await runProcess(process.env.HJEN_PYTHON || 'python3', [script, '--input', localPdf, '--out', deckDir]);
    const payload = jsonObjectFromText(result.stdout.trim().split(/\r?\n/).filter(Boolean).pop() || '');
    if (result.code !== 0 || !payload?.ok || !payload?.manifest) {
      const dependency = /fitz|PyMuPDF|No module named/i.test(`${result.stderr}\n${payload?.message || ''}`);
      return {
        ok: false,
        reason: dependency ? 'missing_pymupdf' : (payload?.reason || 'extract_failed'),
        message: dependency
          ? 'PDF extraction needs PyMuPDF. Install it with: python3 -m pip install PyMuPDF'
          : (payload?.message || result.stderr.trim() || 'The PDF could not be separated into reference images.'),
      };
    }
    const raw = payload.manifest;
    const deck = {
      id: deckId,
      title: path.basename(source),
      sourcePath: localPdf,
      originalSourcePath: source,
      manifestPath: payload.manifestPath,
      pageCount: Number(raw.pageCount || 0),
      assetCount: Number(raw.assetCount || 0),
      occurrenceCount: Number(raw.occurrenceCount || 0),
      importedAt: new Date().toISOString(),
    };
    const occurrences = (Array.isArray(raw.occurrences) ? raw.occurrences : []).map((occurrence: any) => ({
      ...occurrence,
      deckId,
    }));
    if (!occurrences.length) return { ok: false, reason: 'empty_deck', message: 'No usable image placements were found in this PDF.' };
    return { ok: true, manifest: { deck, occurrences } };
  } catch (error: any) {
    const missingPython = error?.code === 'ENOENT';
    return {
      ok: false,
      reason: missingPython ? 'missing_python' : 'extract_failed',
      message: missingPython ? 'Python 3 is required to open PDF decks in this build.' : String(error?.message || error),
    };
  }
});

ipcMain.handle('hjen:reference-scene-import', async (_e: any, args: {
  projectId?: string;
  sourcePath?: string;
  sourceKind?: 'reference' | 'generation' | 'device';
  sourceId?: string;
  name?: string;
}) => {
  const target = readProjects().find(project => project.id === args?.projectId);
  if (!target) return { ok: false, reason: 'no_project', message: 'Open a project before adding a scene.' };
  let source = String(args?.sourcePath || '');
  if (!source) {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    const picked = await dialog.showOpenDialog(win, {
      title: 'Add source scene',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'heic', 'heif'] }],
    });
    if (picked.canceled || !picked.filePaths[0]) return { ok: false, reason: 'cancelled', message: 'Add scene cancelled.' };
    source = picked.filePaths[0];
  }
  const ext = path.extname(source).toLowerCase();
  const allowed = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.heic', '.heif']);
  if (!allowed.has(ext) || !fs.existsSync(source) || !fs.statSync(source).isFile()) {
    return { ok: false, reason: 'bad_image', message: 'Choose an existing image file.' };
  }
  try {
    const payload = fs.readFileSync(source);
    const hash = nodeCrypto.createHash('sha256').update(payload).digest('hex');
    const sourceKind = args?.sourceKind === 'reference' || args?.sourceKind === 'generation'
      ? args.sourceKind : 'device';
    const importsDir = path.join(projectFolder(target.slug), '_reference_maker', 'imports');
    fs.mkdirSync(importsDir, { recursive: true });
    const baseName = slugify(String(args?.name || path.basename(source, ext))) || sourceKind;
    const localPath = path.join(importsDir, `${baseName}-${hash.slice(0, 10)}${ext}`);
    if (!fs.existsSync(localPath)) fs.writeFileSync(localPath, payload);
    const size = (() => {
      try {
        const image = nativeImage.createFromBuffer(payload);
        if (!image.isEmpty()) {
          const dims = image.getSize();
          return [dims.width, dims.height];
        }
      } catch {}
      return undefined;
    })();
    return {
      ok: true,
      asset: {
        imagePath: localPath,
        sourceKind,
        sourceId: String(args?.sourceId || '') || undefined,
        sourceName: String(args?.name || path.basename(source)),
        assetHash: hash,
        sourceSize: size,
      },
    };
  } catch (error: any) {
    return { ok: false, reason: 'copy_failed', message: String(error?.message || error) };
  }
});

const REFERENCE_UNDERSTANDING_SYSTEM = `You are the decision engine for a director-led image translation tool.
The director's note is the highest authority. The source image is evidence, never permission to invent intent.
IMAGE 1 is the source scene. IMAGE 2 onward, when present, are director-attached INTENT REFERENCES: use them only to clarify the visual meaning of the written note. They do not replace the source scene and cannot introduce an unrequested change.
Restate what the director wants in concrete visible terms. Ask at most ONE clarification, and only when all are true: information is missing or conflicting; it affects a visible change or continuity; alternatives make visibly different frames; it cannot be resolved from supplied evidence.
Build a KEEP/CHANGE contract. KEEP names what must survive from the source. CHANGE contains only what the director asked to change. Every CHANGE needs an output-only yes/no acceptance test. Never upgrade a visual observation into director intent. Never change camera unless the director explicitly requested it.
When an attached intent reference materially explains a CHANGE, put its image number in that item's referenceImages array. Assign only relevant references; do not make the director attach the same image again later. Never put IMAGE 1 (the source) in referenceImages.
Preserve scope words and quantities exactly: "mostly" must never become "all", "some" must never become "every", and a preference must never become a mandate. Acceptance tests must use the same scope as the director's note.
Return JSON only with this shape:
{"interpretation":{"restatement":"","sceneRole":"","intendedFeeling":"","storyPosition":"","place":"","timeState":"","characters":""},"clarification":null,"preservationMode":"STRICT_SWAP","contract":[{"id":"K1","slot":"camera","category":"camera","action":"KEEP","value":"","authority":"director-note","referenceImages":[],"acceptanceTest":""}]}
Allowed slots: camera, action, identity, wardrobe, posture, hands, gaze, light, colour, medium, time, place, objects.
Allowed categories: composition, camera, light, colour, texture, identity, performance, wardrobe, place, time, objects, environment.
preservationMode is STRICT_SWAP when the director values the existing frame or asks for limited changes; REFERENCE_GUIDED when several visible systems may move; REBUILD only when they explicitly want a new construction.`;

ipcMain.handle('hjen:reference-scene-understand', async (_e: any, args: {
  rawText?: string; imagePath?: string; page?: number; sceneTitle?: string;
  intentReferences?: Array<{ imagePath?: string; label?: string; sourceKind?: string }>;
  visualRead?: unknown; slots?: unknown;
}) => {
  const rawText = String(args?.rawText || '').trim();
  if (!rawText) return { ok: false, reason: 'empty_note', message: 'Explain why you chose this image first.' };
  if (!args?.imagePath || !fs.existsSync(args.imagePath)) return { ok: false, reason: 'missing_image', message: 'The source image is no longer available.' };
  const model = taskModelOverride('reference-maker-understand') || 'claude-sonnet-4-6';
  const intentReferences = (Array.isArray(args.intentReferences) ? args.intentReferences : [])
    .filter(reference => reference?.imagePath && fs.existsSync(String(reference.imagePath)))
    .slice(0, 8);
  const prompt = [
    `DIRECTOR NOTE (highest authority):\n${rawText}`,
    intentReferences.length
      ? `DIRECTOR-ATTACHED INTENT REFERENCES (images 2-${intentReferences.length + 1}; clarify the note, never add scope):\n${JSON.stringify(intentReferences.map((reference, index) => ({ image: index + 2, label: String(reference.label || ''), sourceKind: String(reference.sourceKind || '') })))}`
      : 'DIRECTOR-ATTACHED INTENT REFERENCES: none',
    `DECK POSITION: page ${Number(args.page || 0)}${args.sceneTitle ? ` · ${args.sceneTitle}` : ''}`,
    `VISUAL OBSERVATION (lower authority):\n${JSON.stringify(args.visualRead || {})}`,
    `SOURCE SLOTS (lower authority):\n${JSON.stringify(args.slots || {})}`,
  ].join('\n\n');
  const response = await runLlmJson({
    provider: llmProvider(model), model, system: REFERENCE_UNDERSTANDING_SYSTEM,
    prompt, imagePaths: [args.imagePath, ...intentReferences.map(reference => String(reference.imagePath))], maxTokens: 5000, jsonMode: true,
  });
  if (!response.ok) return response;
  const data = jsonObjectFromText(response.text || '');
  if (!data?.interpretation || !Array.isArray(data?.contract)) {
    return { ok: false, reason: 'bad_contract', message: 'The scene understanding returned an invalid contract. Try again.' };
  }
  return { ok: true, data, model };
});

const REFERENCE_DRIFT_SYSTEM = `You are a strict commercial-stills continuity checker.
IMAGE 1 is the director's source reference. IMAGE 2 is the newly made take.
Judge each supplied KEEP invariant by direct comparison, and each CHANGE requirement on IMAGE 2 alone. Do not reward novelty. A change landing does not excuse drift elsewhere.
Return exactly one drift verdict for EVERY required protected axis named in the prompt, and exactly one change verdict for EVERY supplied CHANGE id. Omitting a verdict rejects the take.
Return JSON only: {"drift":[{"axis":"composition","score":0,"threshold":85,"passed":false,"evidence":""}],"changes":[{"id":"C1","state":"landed|partial|missed","evidence":""}],"overall":"READY|REJECTED"}.
score is similarity for the locked axis, 0-100. Use thresholds supplied by the prompt, default 85.`;

const REFERENCE_CONTRACT_REVISION_SYSTEM = `You are the contract editor inside a director-led image translation tool.
The user's REVIEW NOTE is the new highest authority for the next pass. The original DIRECTOR NOTE remains authoritative wherever the review note is silent. Drift-audit evidence is diagnostic only: it may reveal what missed, but it is never permission to add a change the user did not request.
IMAGE 1 is the source. IMAGE 2, when present, is the reviewed take. Later images are SUPPORT REFERENCES supplied by the user now or earlier in Direction.
Revise the current KEEP/CHANGE contract minimally. Preserve unchanged item ids. Add or rewrite only what the review note requires. Never start a Make. Never silently loosen a KEEP to make a failed take pass.
For each CHANGE, return referenceImages containing the image numbers of ONLY the support references that materially explain that change. Do not attach the source or reviewed take as a change reference. Retain existing referencePaths on unchanged items.
Every CHANGE needs a concrete visible instruction and an output-only yes/no acceptanceTest. KEEP items must state what remains protected.
Write the summary in the same language as the user's review note.
Return JSON only:
{"summary":"<short receipt of what changed in the contract>","preservationMode":"STRICT_SWAP|REFERENCE_GUIDED|REBUILD","contract":[{"id":"K1","slot":"camera","category":"camera","action":"KEEP","value":"","authority":"director-note","referencePaths":[],"referenceImages":[],"acceptanceTest":""}]}
Allowed slots: camera, action, identity, wardrobe, posture, hands, gaze, light, colour, medium, time, place, objects.
Allowed categories: composition, camera, light, colour, texture, identity, performance, wardrobe, place, time, objects, environment.`;

ipcMain.handle('hjen:reference-scene-drift', async (_e: any, args: {
  sourcePath?: string; takePath?: string; keepItems?: unknown[]; changeItems?: unknown[];
  dna?: unknown; dop?: unknown;
}) => {
  if (!args?.sourcePath || !args?.takePath || !fs.existsSync(args.sourcePath) || !fs.existsSync(args.takePath)) {
    return { ok: false, reason: 'missing_image', message: 'Both source and take are required for drift review.' };
  }
  const keepItems = Array.isArray(args.keepItems) ? args.keepItems : [];
  const categoryAxes: Record<string, string[]> = {
    composition: ['composition'], camera: ['composition', 'lens'], light: ['lighting'],
    colour: ['palette'], texture: ['texture'], identity: ['identity'],
    performance: ['locked-content'], wardrobe: ['locked-content'], place: ['locked-content'],
    time: ['locked-content'], objects: ['locked-content'], environment: ['locked-content'],
  };
  const requiredAxes = [...new Set(keepItems.flatMap((item: any) => categoryAxes[String(item?.category || '')] || ['locked-content']))];
  const model = taskModelOverride('reference-maker-drift') || 'gemini-3.6-flash';
  const response = await runLlmJson({
    provider: llmProvider(model), model, system: REFERENCE_DRIFT_SYSTEM,
    prompt: `REQUIRED PROTECTED AXES (one verdict each):\n${JSON.stringify(requiredAxes)}\n\nKEEP INVARIANTS:\n${JSON.stringify(keepItems)}\n\nCHANGE REQUIREMENTS:\n${JSON.stringify(args.changeItems || [])}\n\nOPTIONAL DNA SNAPSHOT:\n${JSON.stringify(args.dna || null)}\n\nOPTIONAL DOP SNAPSHOT:\n${JSON.stringify(args.dop || null)}`,
    imagePaths: [args.sourcePath, args.takePath], maxTokens: 4000, jsonMode: true,
  });
  if (!response.ok) return response;
  const data = jsonObjectFromText(response.text || '');
  if (!Array.isArray(data?.drift) || !Array.isArray(data?.changes)) {
    return { ok: false, reason: 'bad_review', message: 'The drift checker returned an invalid review. The take was not auto-approved.' };
  }
  return { ok: true, data, model };
});

ipcMain.handle('hjen:reference-scene-revise-contract', async (_e: any, args: {
  directorNote?: string; reviewNote?: string; sourcePath?: string; takePath?: string;
  currentContract?: unknown; drift?: unknown;
  references?: Array<{ imagePath?: string; label?: string; sourceKind?: string }>;
}) => {
  const reviewNote = String(args?.reviewNote || '').trim();
  if (!reviewNote) return { ok: false, reason: 'empty_review', message: 'Write what should change in the next take.' };
  if (!args?.sourcePath || !fs.existsSync(args.sourcePath)) return { ok: false, reason: 'missing_source', message: 'The source image is no longer available.' };
  const takePath = args.takePath && fs.existsSync(args.takePath) ? args.takePath : undefined;
  const references = (Array.isArray(args.references) ? args.references : [])
    .filter(reference => reference?.imagePath && fs.existsSync(String(reference.imagePath)))
    .filter((reference, index, all) => all.findIndex(item => String(item.imagePath) === String(reference.imagePath)) === index)
    .slice(0, 8);
  const imagePaths = [args.sourcePath, ...(takePath ? [takePath] : []), ...references.map(reference => String(reference.imagePath))];
  const firstReferenceImage = takePath ? 3 : 2;
  const catalog = references.map((reference, index) => ({
    image: firstReferenceImage + index,
    label: String(reference.label || ''),
    sourceKind: String(reference.sourceKind || ''),
  }));
  const model = taskModelOverride('reference-maker-contract-revision') || 'claude-sonnet-4-6';
  const prompt = [
    `ORIGINAL DIRECTOR NOTE:\n${String(args.directorNote || '').trim()}`,
    `USER REVIEW NOTE (highest authority for this revision):\n${reviewNote}`,
    `CURRENT CONTRACT:\n${JSON.stringify(args.currentContract || {})}`,
    `AUDIT OF THE REVIEWED TAKE (diagnostic, not new intent):\n${JSON.stringify(args.drift || null)}`,
    `SUPPORT REFERENCE CATALOG:\n${catalog.length ? JSON.stringify(catalog) : 'none'}`,
  ].join('\n\n');
  const runRevision = (candidate: string) => runLlmJson({
    provider: llmProvider(candidate), model: candidate, system: REFERENCE_CONTRACT_REVISION_SYSTEM,
    prompt, imagePaths, maxTokens: 5000, jsonMode: true,
  });
  let usedModel = model;
  let response = await runRevision(model);
  if (!response.ok && shouldRetryLlmReason(response.reason)) {
    const fallbackModel = taskModelOverride('reference-maker-contract-revision-fallback') || 'gemini-3.6-flash';
    if (fallbackModel !== model) {
      const fallback = await runRevision(fallbackModel);
      if (fallback.ok) {
        response = fallback;
        usedModel = fallbackModel;
      } else {
        return {
          ...fallback,
          message: `Contract update could not reach an available AI route. ${fallback.message || 'Try again in a moment.'}`,
        };
      }
    }
  }
  if (!response.ok) return response;
  const data = jsonObjectFromText(response.text || '');
  if (!Array.isArray(data?.contract)) {
    return { ok: false, reason: 'bad_contract', message: 'The review returned an invalid contract revision. Nothing was changed.' };
  }
  return { ok: true, data, model: usedModel };
});

// ─── Creative Mind — Zettel memory (fleeting notes) ─────────────────
// Per-user, CROSS-project: {projectsRoot}/_mind/notes.json (root-level
// sidecar, same family as _conversations/). Capture must never lose a note:
// write is whole-file JSON, read tolerates a corrupt file by returning [].
function mindNotesPath(): string {
  return path.join(projectsRootPath(), '_mind', 'notes.json');
}
ipcMain.handle('hjen:mind-notes-read', () => {
  const f = mindNotesPath();
  if (!fs.existsSync(f)) return { ok: true, notes: [] };
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf-8'));
    return { ok: true, notes: Array.isArray(j?.notes) ? j.notes : [] };
  } catch { return { ok: true, notes: [] }; }
});
ipcMain.handle('hjen:mind-notes-write', (_e: any, args: { notes: unknown[] }) => {
  const f = mindNotesPath();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ version: 1, notes: Array.isArray(args?.notes) ? args.notes : [] }, null, 2));
  return { ok: true };
});

// Resolve Creative-Mind board frame ids (`frameset:<query>:<token>`) to their
// saved files in {projectsRoot}/_mind/boards — legacy answers stored only ids;
// the thinking canvas needs the paths to SHOW the pictures an answer stood on.
ipcMain.handle('hjen:mind-board-paths', (_e: any, args: { ids: string[] }) => {
  const dir = path.join(projectsRootPath(), '_mind', 'boards');
  const out: Record<string, string> = {};
  let files: string[] = [];
  try { files = fs.readdirSync(dir) as string[]; } catch { return { ok: true, paths: out }; }
  for (const id of Array.isArray(args?.ids) ? args.ids : []) {
    if (typeof id !== 'string') continue;
    const parts = id.split(':');           // frameset : <query-slug> : <token>
    if (parts.length < 3) continue;
    const stem = `${parts[1]}_${parts[2]}`;
    const hit = files.find(f => f.startsWith(stem + '.') || f === stem);
    if (hit) out[id] = path.join(dir, hit);
  }
  return { ok: true, paths: out };
});

// ─── Ad Breakdown 360 — تشريح الإعلان ───────────────────────────────
// Breakdowns are authored offline (STUDY/ad_breakdowns/pipeline) and installed
// under {projectsRoot}/_mind/breakdowns/<slug>/{breakdown.json, frames/}.
// The app only loads + renders: read resolves frame paths to ABSOLUTE so the
// renderer builds hjen-file:// URLs directly (mind-board-paths precedent).
function mindBreakdownsDir(): string {
  return path.join(projectsRootPath(), '_mind', 'breakdowns');
}
ipcMain.handle('hjen:mind-breakdowns-list', () => {
  const dir = mindBreakdownsDir();
  const out: Array<{ slug: string; title: string; brand: string; approved: boolean; frames: number }> = [];
  let entries: string[] = [];
  try { entries = fs.readdirSync(dir) as string[]; } catch { return { ok: true, breakdowns: out }; }
  for (const slug of entries) {
    const f = path.join(dir, slug, 'breakdown.json');
    if (!fs.existsSync(f)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf-8'));
      out.push({
        slug,
        title: String(j?.ad?.title ?? slug),
        brand: String(j?.ad?.brand ?? ''),
        approved: !!j?.approved,
        frames: Array.isArray(j?.frames) ? j.frames.length : 0,
      });
    } catch { /* a corrupt breakdown never blocks the list */ }
  }
  return { ok: true, breakdowns: out };
});
ipcMain.handle('hjen:mind-breakdown-read', (_e: any, args: { slug: string }) => {
  const slug = String(args?.slug ?? '');
  if (!slug || slug.includes('..') || slug.includes('/')) return { ok: false };
  const base = path.join(mindBreakdownsDir(), slug);
  const f = path.join(base, 'breakdown.json');
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf-8'));
    for (const fr of Array.isArray(j?.frames) ? j.frames : []) {
      if (fr && typeof fr.file === 'string' && !path.isAbsolute(fr.file)) {
        fr.file = path.join(base, fr.file);
      }
    }
    // The ingested source film is saved beside the breakdown as source.<ext>.
    // Surface its ABSOLUTE path so the renderer can stream it over hjen-file://
    // (older breakdowns without one simply carry no sourcePath).
    try {
      const src = (fs.readdirSync(base) as string[])
        .find(n => /^source\.(mp4|webm|mov|m4v|mkv|avi)$/i.test(n));
      if (src) j.sourcePath = path.join(base, src);
    } catch { /* no source file — the watch link falls back to sourceUrl or hides */ }
    return { ok: true, breakdown: j };
  } catch { return { ok: false }; }
});
// Per-breakdown DNA files — the forward contract with the offline factory. Each
// breakdown folder MAY carry dna/<axisSlug>.gem.md (the distilled five-segment
// Gem for that axis). Present → LIVE; absent → the app shows a pending state (or,
// for a seeded demo, a bundled sample). List which exist, and read one by axis.
ipcMain.handle('hjen:mind-breakdown-dna-list', (_e: any, args: { slug: string }) => {
  const slug = String(args?.slug ?? '');
  if (!slug || slug.includes('..') || slug.includes('/')) return { ok: false, slugs: [] };
  const dir = path.join(mindBreakdownsDir(), slug, 'dna');
  const out: string[] = [];
  try {
    for (const f of fs.readdirSync(dir) as string[]) {
      const m = /^([a-z_]+)\.gem\.md$/.exec(f);
      if (m) out.push(m[1]);
    }
  } catch { /* no dna/ folder yet — every axis is pending */ }
  return { ok: true, slugs: out };
});
ipcMain.handle('hjen:mind-breakdown-dna-read', (_e: any, args: { slug: string; axis: string }) => {
  const slug = String(args?.slug ?? '');
  const axis = String(args?.axis ?? '');
  if (!slug || slug.includes('..') || slug.includes('/')) return { ok: false };
  if (!axis || !/^[a-z_]+$/.test(axis)) return { ok: false };
  const f = path.join(mindBreakdownsDir(), slug, 'dna', `${axis}.gem.md`);
  try { return { ok: true, text: fs.readFileSync(f, 'utf-8') }; }
  catch { return { ok: false }; }
});
// Write ONE distilled axis DNA (dna/<axis>.gem.md) into a breakdown's folder —
// the forward half of the LIVE contract the list/read handlers above light up.
// Written by the DNA distillation stage of runBreakdown AND by the retro
// "MAKE THE DNAS" action on an already-run breakdown.
ipcMain.handle('hjen:mind-breakdown-dna-write', (_e: any, args: { slug: string; axis: string; text: string }) => {
  const slug = String(args?.slug ?? '');
  const axis = String(args?.axis ?? '');
  const text = String(args?.text ?? '');
  if (!slug || slug.includes('..') || slug.includes('/')) return { ok: false, message: 'bad slug' };
  if (!axis || !/^[a-z_]+$/.test(axis)) return { ok: false, message: 'bad axis' };
  if (!text.trim()) return { ok: false, message: 'empty DNA' };
  const dir = path.join(mindBreakdownsDir(), slug, 'dna');
  try {
    fs.mkdirSync(dir, { recursive: true });
    atomicWriteFileSync(path.join(dir, `${axis}.gem.md`), text);
    return { ok: true, axis };
  } catch (e: any) { return { ok: false, message: String(e?.message || e) }; }
});

// Export a breakdown as the house A4-landscape treatment PDF («معالجة الإعلان»)
// and reveal it — the whole render happens inside Electron (printToPDF).
ipcMain.handle('hjen:mind-breakdown-export-pdf', async (_e: any, args: { slug: string }) => {
  const slug = String(args?.slug ?? '');
  if (!slug || slug.includes('..') || slug.includes('/')) return { ok: false, message: 'bad slug' };
  const { exportBreakdownPdf } = await import('./breakdownPdf');
  const res = await exportBreakdownPdf(path.join(mindBreakdownsDir(), slug));
  if (res.ok && res.path) {
    electron.shell.openPath(res.path);        // open the treatment for reading
    electron.shell.showItemInFolder(res.path);
  }
  return res;
});

// الصياغة العربية — persist the Arabic re-authoring beside its breakdown; the
// treatment PDF merges it automatically when present.
ipcMain.handle('hjen:mind-breakdown-write-arabic', (_e: any, args: { slug: string; data: unknown }) => {
  const slug = String(args?.slug ?? '');
  if (!slug || slug.includes('..') || slug.includes('/')) return { ok: false };
  const dir = path.join(mindBreakdownsDir(), slug);
  if (!fs.existsSync(path.join(dir, 'breakdown.json'))) return { ok: false };
  atomicWriteFileSync(path.join(dir, 'arabic_rewrite.json'), JSON.stringify(args?.data ?? {}, null, 1));
  return { ok: true };
});

ipcMain.handle('hjen:mind-breakdown-approve', (_e: any, args: { slug: string; approved: boolean }) => {
  const slug = String(args?.slug ?? '');
  if (!slug || slug.includes('..') || slug.includes('/')) return { ok: false };
  const f = path.join(mindBreakdownsDir(), slug, 'breakdown.json');
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf-8'));
    j.approved = !!args?.approved;
    atomicWriteFileSync(f, JSON.stringify(j, null, 1));
    return { ok: true };
  } catch { return { ok: false }; }
});

// Rename a breakdown's DISPLAY TITLE only (breakdown.json → ad.title). The folder
// `slug` is the immutable identity key — referenced by the dna/ folder, sourcePath,
// job nav, and My-Mind provenance — so it is NEVER touched. Only the human title
// changes; the disc + picker re-read it on refresh.
ipcMain.handle('hjen:mind-breakdown-rename', (_e: any, args: { slug: string; title: string }) => {
  const slug = String(args?.slug ?? '');
  const title = String(args?.title ?? '').trim();
  if (!slug || slug.includes('..') || slug.includes('/')) return { ok: false, message: 'bad slug' };
  if (!title) return { ok: false, message: 'empty title' };
  const f = path.join(mindBreakdownsDir(), slug, 'breakdown.json');
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf-8'));
    if (!j.ad || typeof j.ad !== 'object') j.ad = {};
    j.ad.title = title;
    atomicWriteFileSync(f, JSON.stringify(j, null, 1));
    return { ok: true, title };
  } catch (e: any) { return { ok: false, message: String(e?.message || e) }; }
});

// Delete a breakdown — remove the whole install folder (_mind/breakdowns/<slug>/).
// Destructive, so guard the slug hard: no traversal, no separators, must resolve to
// a DIRECT child of the breakdowns dir (belt-and-braces against path escape).
ipcMain.handle('hjen:mind-breakdown-delete', (_e: any, args: { slug: string }) => {
  const slug = String(args?.slug ?? '');
  if (!slug || slug.includes('..') || slug.includes('/') || slug.includes('\\') || path.isAbsolute(slug)) {
    return { ok: false, message: 'bad slug' };
  }
  const parent = path.resolve(mindBreakdownsDir());
  const dir = path.resolve(parent, slug);
  if (path.dirname(dir) !== parent) return { ok: false, message: 'path escape' };
  try {
    if (!fs.existsSync(dir)) return { ok: false, message: 'not found' };
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: true };
  } catch (e: any) { return { ok: false, message: String(e?.message || e) }; }
});

// ─── BREAKDOWN — the runnable pipeline (native side) ─────────────────────────
// The RUN process is orchestrated in the renderer so every text-LLM call routes
// through the registry + hjen:llm-json gate (house LLM law). Main owns only the
// native heavy lifting: download (yt-dlp) OR local file, frame extraction +
// analysis thumbs + audio + captions (ffmpeg), and the final JSON write. Frames
// land straight in the install dir; progress streams over hjen:breakdown-progress.

// Resolved through tools.ts (house law: one resolver). These were three separate
// probe lists that each ended in a bare command name — which only finds anything
// when the program is on PATH, and a Finder-launched Mac app has no Homebrew on
// its PATH. Getters, not constants: the user can install a missing program and
// hit "Check again" without restarting.
const bdYtDlp = () => resolveTool('yt-dlp');
const bdFfmpeg = () => resolveTool('ffmpeg');
const BD_MAX_FRAMES = 120;

// whisper.cpp CLI for local ASR — same probe idiom as yt-dlp/ffmpeg. Returns '' if
// nothing is found, so the caller degrades gracefully to subtitles / an API engine.
const bdWhisper = () => resolveTool('whisper') ?? '';
// Resolve a whisper.cpp model file for a name like 'large-v3' → ggml-large-v3.bin.
function bdWhisperModel(name: string): string {
  const home = os.homedir();
  const file = /\.bin$/.test(name) ? name : `ggml-${name}.bin`;
  const dirs = [
    path.join(home, '.local/share/whisper'), path.join(home, 'Library/Application Support/hjen-studio/whisper'),
    '/opt/homebrew/share/whisper-cpp', '/usr/local/share/whisper-cpp',
    path.join(process.resourcesPath || '', 'whisper'),
  ];
  if (path.isAbsolute(name) && fs.existsSync(name)) return name;
  for (const d of dirs) { const p = path.join(d, file); try { if (fs.existsSync(p)) return p; } catch { /* skip */ } }
  return '';
}

// per-run cancel registry: runId → { child, cancelled }
const bdRuns = new Map<string, { child: any; cancelled: boolean }>();

function bdProgress(payload: Record<string, any>) {
  try { mainWindow?.webContents.send('hjen:breakdown-progress', payload); } catch { /* window gone */ }
}

function bdRunCmd(runId: string, bin: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = childProcess.spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const rec = bdRuns.get(runId);
    if (rec) rec.child = child;
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', (e: any) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: String(e?.message || e) }); });
    child.on('close', (code: number) => { clearTimeout(timer); if (rec) rec.child = null; resolve({ code: code ?? -1, stdout, stderr }); });
  });
}

function bdProbeDuration(runId: string, video: string): Promise<number | null> {
  return bdRunCmd(runId, bdFfmpeg(), ['-hide_banner', '-i', video], 30_000).then(p => {
    const m = /Duration: (\d+):(\d+):(\d+\.?\d*)/.exec(p.stderr || '');
    if (!m) return null;
    return Math.round((parseFloat(m[1]) * 3600 + parseFloat(m[2]) * 60 + parseFloat(m[3])) * 10) / 10;
  });
}

// scene-cut ∪ 1fps interval, merged by time (dedupe < 0.4s), capped by even thinning.
async function bdExtractFrames(runId: string, video: string, duration: number | null, outDir: string) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of (fs.readdirSync(outDir) as string[])) { if (/\.jpg$/.test(f)) fs.rmSync(path.join(outDir, f)); }
  const scale = "scale='min(1280,iw)':-2";
  const pull = async (select: string, prefix: string): Promise<Array<{ file: string; t: number }>> => {
    const vf = `${select},showinfo,${scale}`;
    const p = await bdRunCmd(runId, bdFfmpeg(), ['-y', '-i', video, '-vf', vf, '-vsync', 'vfr',
      '-frames:v', '240', '-q:v', '3', path.join(outDir, `${prefix}%03d.jpg`)], 300_000);
    const times = [...(p.stderr || '').matchAll(/pts_time:(\d+\.?\d*)/g)].map(m => parseFloat(m[1]));
    const got = (fs.readdirSync(outDir) as string[]).filter((f: string) => f.startsWith(prefix) && f.endsWith('.jpg')).sort();
    return got.map((f: string, i: number) => ({ file: path.join(outDir, f), t: times[i] ?? i }));
  };
  const scene = await pull("select='gt(scene,0.25)'", 's');
  const interval = await pull(duration === null ? "select='not(mod(n\\,25))'" : 'fps=1', 'i');
  const merged: Array<{ file: string; t: number }> = [];
  for (const it of [...scene, ...interval].sort((a, b) => a.t - b.t)) {
    if (merged.length && Math.abs(it.t - merged[merged.length - 1].t) < 0.4) continue;
    merged.push(it);
  }
  let kept = merged;
  if (kept.length > BD_MAX_FRAMES) {
    const step = kept.length / BD_MAX_FRAMES;
    kept = Array.from({ length: BD_MAX_FRAMES }, (_v, i) => merged[Math.min(merged.length - 1, Math.floor(i * step))]);
  }
  // rename kept → fNNN.jpg via temp names to avoid collision with s*/i* set
  const out: Array<{ id: string; rel: string; abs: string; t: number }> = [];
  kept.forEach((it, n) => {
    const id = `f${String(n + 1).padStart(3, '0')}`;
    const tmp = path.join(outDir, `_keep_${id}.jpg`);
    fs.copyFileSync(it.file, tmp);
    out.push({ id, rel: `frames/${id}.jpg`, abs: path.join(outDir, `${id}.jpg`), t: Math.round(it.t * 100) / 100 });
  });
  for (const f of (fs.readdirSync(outDir) as string[])) { if (/^[si]\d+\.jpg$/.test(f)) fs.rmSync(path.join(outDir, f)); }
  for (const fr of out) fs.renameSync(path.join(outDir, `_keep_${fr.id}.jpg`), fr.abs);
  return out;
}

// Real shot-boundary detection — the cut list ffmpeg computes but the pipeline
// used to throw away. A dedicated scene-score pass (no image encoding, cheap)
// reports the pts_time of every hard cut. This is what makes the shotlist REAL
// (measured cuts + timecodes) instead of a text model's guess.
async function bdDetectCuts(runId: string, video: string, duration: number | null): Promise<number[]> {
  const p = await bdRunCmd(runId, bdFfmpeg(),
    ['-hide_banner', '-i', video, '-filter:v', "select='gt(scene,0.3)',showinfo", '-an', '-f', 'null', '-'], 300_000);
  const times = [...(p.stderr || '').matchAll(/pts_time:(\d+\.?\d*)/g)].map(m => parseFloat(m[1])).filter(t => Number.isFinite(t));
  const dur = duration ?? Infinity;
  const cuts: number[] = [];
  for (const t of times.sort((a, b) => a - b)) {
    if (t <= 0.2 || t >= dur - 0.15) continue;
    if (cuts.length && t - cuts[cuts.length - 1] < 0.25) continue;
    cuts.push(Math.round(t * 100) / 100);
  }
  return cuts;
}

// Build shot intervals from the cut list: shot i = [cut[i-1], cut[i]]. Each shot
// carries the ingested frames whose timestamp falls inside it. Very short slivers
// (< 0.35s, usually a flash/dissolve mis-fire) fold into the previous shot.
function bdBuildShots(cuts: number[], duration: number | null, frames: Array<{ id: string; t: number }>):
  Array<{ no: number; tcIn: number; tcOut: number; frameIds: string[] }> {
  const dur = duration ?? (frames.length ? frames[frames.length - 1].t + 1 : 0);
  const bounds = [0, ...cuts, dur].filter((v, i, a) => i === 0 || v > a[i - 1]);
  const raw: Array<{ tcIn: number; tcOut: number }> = [];
  for (let i = 0; i < bounds.length - 1; i++) raw.push({ tcIn: bounds[i], tcOut: bounds[i + 1] });
  const merged: Array<{ tcIn: number; tcOut: number }> = [];
  for (const s of raw) {
    if (merged.length && s.tcOut - s.tcIn < 0.35) { merged[merged.length - 1].tcOut = s.tcOut; continue; }
    merged.push({ ...s });
  }
  return merged.map((s, i) => ({
    no: i + 1, tcIn: s.tcIn, tcOut: s.tcOut,
    frameIds: frames.filter(f => f.t >= s.tcIn - 0.05 && f.t < s.tcOut + 0.05).map(f => f.id),
  }));
}

// A subtitle timestamp → seconds. Accepts VTT (HH:MM:SS.mmm) and SRT (…,mmm),
// with or without the hours field.
function bdSubTime(s: string): number | null {
  const m = /(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})/.exec(s.trim());
  if (!m) return null;
  const h = m[1] ? +m[1] : 0;
  return h * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / (m[4].length === 3 ? 1000 : m[4].length === 2 ? 100 : 10);
}

// Parse the first non-empty captions.* file into TIMED cues — the timing that the
// old bdVttText threw away. Returns the detected language (from the filename) and
// segments {start,end,text}. Consecutive duplicate lines (auto-sub rolling
// repeats) are collapsed. This is the timed-subtitle source; ASR (Phase 1) is
// preferred over it when present.
function bdSubtitles(dir: string): { lang: string; segments: Array<{ start: number; end: number; text: string }> } | null {
  let files: string[] = [];
  try { files = (fs.readdirSync(dir) as string[]).filter((f: string) => /^captions\./.test(f)); } catch { return null; }
  for (const name of files.sort()) {
    const lang = (/^captions\.([\w-]+)\./.exec(name)?.[1] || 'und').split('-')[0];
    const raw = fs.readFileSync(path.join(dir, name), 'utf-8');
    // split into cue blocks on blank lines
    const blocks = raw.replace(/^WEBVTT[^\n]*\n/, '').split(/\r?\n\r?\n/);
    const segs: Array<{ start: number; end: number; text: string }> = [];
    for (const block of blocks) {
      const lines = block.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean);
      const ti = lines.findIndex((l: string) => l.includes('-->'));
      if (ti < 0) continue;
      const [a, b] = lines[ti].split('-->');
      const start = bdSubTime(a), end = bdSubTime(b || '');
      if (start == null) continue;
      const text = lines.slice(ti + 1)
        .filter((l: string) => !/^(Kind:|Language:)/.test(l))
        .map((l: string) => l.replace(/<[^>]+>/g, '').trim()).filter(Boolean).join(' ');
      if (!text) continue;
      if (segs.length && segs[segs.length - 1].text === text) { segs[segs.length - 1].end = end ?? start; continue; }
      segs.push({ start, end: end ?? start, text });
    }
    if (segs.length) return { lang, segments: segs };
  }
  return null;
}

/** Flat caption string derived from timed cues — backward-compat for prompt code
 *  that still reads meta.captions before the transcript path lands. */
function bdCaptionsFlat(segs: Array<{ text: string }> | null | undefined, maxChars = 4000): string {
  if (!segs || !segs.length) return '';
  return segs.map(s => s.text).join(' | ').slice(0, maxChars);
}

// Whisper hallucinates on non-speech audio (music beds, ambience, wordless ads) —
// emitting gibberish like "L L L L", one token repeated, or a wildly wrong
// language. Such a transcript must NOT pollute the analysis as "dialogue". Detect
// it so the caller degrades to subtitles / none — the correct result for an ad
// with no spoken words (e.g. the Sony "Find your Focus" music piece).
function bdLooksHallucinated(segs: Array<{ text: string }>): boolean {
  const text = segs.map(s => s.text).join(' ').trim();
  if (!text) return true;
  // No SPOKEN words: whisper often labels a wordless ad's sound as bracketed
  // annotations — 〈Footsteps〉 [Music] (ticking clock) [موسيقى]. Strip those; if
  // almost nothing real remains, there's no dialogue → reject (the SOUND vision
  // pass still hears the actual audio). This is the Sony "Find your Focus" case.
  const spoken = text
    .replace(/[〈\[(][^〉\])]*[〉\])]/g, ' ')
    .replace(/\bموسيقى\b|\bmusic\b|\bapplause\b|\btance\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  const spokenWords = spoken.split(/\s+/).filter(w => w.replace(/[^\p{L}\p{N}]/gu, '').length >= 2);
  if (spokenWords.length < 3) return true;
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length < 3) return false;                       // too little to judge — allow
  const counts: Record<string, number> = {};
  for (const t of tokens) counts[t] = (counts[t] || 0) + 1;
  const maxRep = Math.max(...Object.values(counts));
  if (tokens.length > 6 && maxRep / tokens.length > 0.4) return true;         // one token dominates
  const shortRatio = tokens.filter(t => t.replace(/[^\p{L}\p{N}]/gu, '').length <= 1).length / tokens.length;
  if (shortRatio > 0.55) return true;                                          // mostly 1-char tokens
  const compact = text.replace(/\s+/g, '');
  const uniq = new Set(compact.toLowerCase()).size;
  if (compact.length > 20 && uniq / compact.length < 0.12) return true;        // near-zero char diversity
  return false;
}

/** Normalize a detected-language string to a short code where obvious. */
function bdNormLang(l: string): string {
  const s = (l || '').toLowerCase();
  if (/^ar|arab/.test(s)) return 'ar';
  if (/^en|engl/.test(s)) return 'en';
  return s.slice(0, 5) || 'und';
}

type AsrResult = { ok: boolean; transcript?: { lang: string; source: 'asr'; segments: Array<{ start: number; end: number; text: string; lang?: string }> }; message?: string };

// Transcribe audio → TIMED segments via the configured engine (local whisper.cpp
// / OpenAI Whisper API / custom OpenAI-compatible endpoint). Arabic-first: honors
// cfg.language ('auto' | 'ar' | …). NEVER throws — returns a clear failure the
// caller degrades from (→ platform subtitles), so ASR is best-effort, not fatal.
async function bdTranscribe(runId: string, audioPath: string, cfg: TranscriptionConfig): Promise<AsrResult> {
  if (!audioPath || !fs.existsSync(audioPath)) return { ok: false, message: 'no audio to transcribe' };
  try {
    // ── API engines (OpenAI Whisper or a WhisperFlow-style compatible endpoint) ──
    if (cfg.engine === 'openai' || cfg.engine === 'custom') {
      const endpoint = cfg.engine === 'custom' && cfg.endpoint ? cfg.endpoint : 'https://api.openai.com/v1/audio/transcriptions';
      const key = providerKey('openai');
      if (!key && cfg.engine === 'openai') return { ok: false, message: 'no OpenAI key for transcription (Settings → keys)' };
      const form = new FormData();
      form.append('file', new Blob([fs.readFileSync(audioPath)]), path.basename(audioPath));
      form.append('model', cfg.model || 'whisper-1');
      form.append('response_format', 'verbose_json');
      if (cfg.language && cfg.language !== 'auto') form.append('language', cfg.language);
      const headers: Record<string, string> = {};
      if (key) headers.Authorization = `Bearer ${key}`;
      const res = await fetch(endpoint, { method: 'POST', headers, body: form as any });
      if (!res.ok) return { ok: false, message: `ASR API ${res.status}: ${(await res.text()).slice(0, 200)}` };
      const j: any = await res.json();
      const segs = (Array.isArray(j?.segments) ? j.segments : []).map((s: any) => ({
        start: Number(s.start) || 0, end: Number(s.end) || 0, text: String(s.text || '').trim(),
      })).filter((s: any) => s.text);
      if (!segs.length && j?.text) segs.push({ start: 0, end: Number(j?.duration) || 0, text: String(j.text).trim() });
      if (!segs.length) return { ok: false, message: 'ASR returned no speech' };
      if (bdLooksHallucinated(segs)) return { ok: false, message: 'no clear speech — ASR output looked hallucinated (music/ambience)' };
      return { ok: true, transcript: { lang: bdNormLang(j?.language || cfg.language || 'und'), source: 'asr', segments: segs } };
    }
    // ── local whisper.cpp ──
    if (!bdWhisper()) return { ok: false, message: describeMissing('whisper') + '  Or switch the engine in Settings → Transcription.' };
    const model = bdWhisperModel(cfg.model || 'large-v3');
    if (!model) return { ok: false, message: `whisper model "${cfg.model}" not found — download ggml-${cfg.model}.bin or switch engine` };
    // whisper.cpp reads 16 kHz mono WAV — convert the m4a first
    const wav = audioPath.replace(/\.[^.]+$/, '') + '.16k.wav';
    const cv = await bdRunCmd(runId, bdFfmpeg(), ['-y', '-i', audioPath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], 120_000);
    if (cv.code !== 0 || !fs.existsSync(wav)) return { ok: false, message: 'audio→wav conversion failed for ASR' };
    const outPrefix = wav.replace(/\.wav$/, '.asr');
    const lang = cfg.language && cfg.language !== 'auto' ? cfg.language : 'auto';
    const wp = await bdRunCmd(runId, bdWhisper(), ['-m', model, '-f', wav, '-oj', '-of', outPrefix, '-l', lang], 600_000);
    const jsonPath = `${outPrefix}.json`;
    if (!fs.existsSync(jsonPath)) return { ok: false, message: `whisper produced no output (code ${wp.code}): ${(wp.stderr || '').slice(-200)}` };
    let j: any = {};
    try { j = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')); } catch { return { ok: false, message: 'whisper json parse failed' }; }
    const segs = (Array.isArray(j?.transcription) ? j.transcription : []).map((t: any) => ({
      start: (t?.offsets?.from ?? 0) / 1000, end: (t?.offsets?.to ?? 0) / 1000, text: String(t?.text || '').trim(),
    })).filter((s: any) => s.text);
    try { fs.rmSync(wav, { force: true }); fs.rmSync(jsonPath, { force: true }); } catch { /* best-effort */ }
    if (!segs.length) return { ok: false, message: 'whisper returned no speech' };
    if (bdLooksHallucinated(segs)) return { ok: false, message: 'no clear speech — whisper output looked hallucinated (music/ambience)' };
    return { ok: true, transcript: { lang: bdNormLang(j?.result?.language || cfg.language || 'und'), source: 'asr', segments: segs } };
  } catch (e: any) {
    return { ok: false, message: String(e?.message || e).slice(0, 200) };
  }
}

ipcMain.handle('hjen:breakdown-transcribe', async (_e: any, args: { runId?: string; audioPath: string; config?: Partial<TranscriptionConfig> }) => {
  const cfg = { ...readTranscriptionConfig(), ...(args?.config || {}) };
  return bdTranscribe(String(args?.runId || `tx-${Date.now()}`), String(args?.audioPath || ''), cfg);
});

// ── PRECISE SHOT RESOLVER (native side) — drill INTO one scene ──
// Densely samples a [tcIn,tcOut] window at N fps and computes fine scene-score cut
// CANDIDATES inside it. The renderer then has the model VERIFY + UNDERSTAND the
// real shots (a cut vs a camera move). This is how a coarse 15s "shot" resolves
// into the several varied shots it actually contains. Source video resolved from
// the breakdown folder (source.*) or an explicit path.
function bdSourceVideo(slug: string, explicit?: string): string {
  if (explicit && fs.existsSync(explicit)) return explicit;
  const dir = path.join(mindBreakdownsDir(), slug);
  try {
    const f = (fs.readdirSync(dir) as string[]).find((x: string) => /^source\./.test(x));
    if (f) return path.join(dir, f);
  } catch { /* none */ }
  return '';
}
let bdDenseSeq = 0;   // monotonic — guarantees a unique dense subdir per call even within the same ms
ipcMain.handle('hjen:breakdown-dense-frames', async (_e: any, args: {
  runId?: string; slug: string; videoPath?: string; tcIn: number; tcOut: number; fps?: number;
}) => {
  const runId = String(args?.runId || `dense-${Date.now()}-${bdDenseSeq++}`);
  bdRuns.set(runId, { child: null, cancelled: false });
  const video = bdSourceVideo(String(args?.slug || ''), args?.videoPath);
  if (!video) return { ok: false, message: 'source video not found — re-ingest keeps source.* for this' };
  const tcIn = Math.max(0, Number(args?.tcIn) || 0);
  const tcOut = Math.max(tcIn + 0.2, Number(args?.tcOut) || tcIn + 1);
  const fps = Math.min(12, Math.max(2, Number(args?.fps) || 8));
  // UNIQUE per-call subdir so PARALLEL fusion batches never wipe each other's
  // frames (the old shared `_dense` was rm'd on every call → a race that bound the
  // wrong images to a shot). Sweep only STALE sibling batches (>10 min) so disk
  // stays bounded without touching the fresh dirs other in-flight calls are using.
  const denseRoot = path.join(mindBreakdownsDir(), String(args?.slug || ''), '_dense');
  const out = path.join(denseRoot, runId.replace(/[^\w.-]/g, '_'));
  try {
    fs.mkdirSync(out, { recursive: true });
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const d of (fs.readdirSync(denseRoot) as string[])) {
      const p = path.join(denseRoot, d);
      try { if (p !== out && fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { recursive: true, force: true }); } catch { /* */ }
    }
  } catch { /* */ }
  try {
    // dense frames (segment timestamps reset to 0 by -ss before -i → add tcIn back)
    const vf = `fps=${fps},scale='min(640,iw)':-2,showinfo`;
    const p = await bdRunCmd(runId, bdFfmpeg(), ['-y', '-ss', String(tcIn), '-to', String(tcOut), '-i', video, '-vf', vf, '-q:v', '4', path.join(out, 'd%03d.jpg')], 120_000);
    const times = [...(p.stderr || '').matchAll(/pts_time:(\d+\.?\d*)/g)].map(m => parseFloat(m[1]));
    const got = (fs.readdirSync(out) as string[]).filter((f: string) => /^d\d+\.jpg$/.test(f)).sort();
    const frames = got.map((f: string, i: number) => ({ id: f.replace('.jpg', ''), abs: path.join(out, f), t: Math.round((tcIn + (times[i] ?? i / fps)) * 100) / 100 }));
    // fine cut candidates inside the window (low threshold → the model verifies)
    const sc = await bdRunCmd(runId, bdFfmpeg(), ['-hide_banner', '-ss', String(tcIn), '-to', String(tcOut), '-i', video, '-filter:v', "select='gt(scene,0.12)',showinfo", '-an', '-f', 'null', '-'], 120_000);
    const candidates = [...(sc.stderr || '').matchAll(/pts_time:(\d+\.?\d*)/g)]
      .map(m => Math.round((tcIn + parseFloat(m[1])) * 100) / 100)
      .filter((t, i, a) => t > tcIn + 0.1 && t < tcOut - 0.05 && (i === 0 || t - a[i - 1] > 0.15));
    return { ok: true, frames, candidates };
  } catch (e: any) {
    return { ok: false, message: String(e?.message || e).slice(0, 200) };
  } finally {
    bdRuns.delete(runId);
  }
});

ipcMain.handle('hjen:breakdown-ingest', async (_e: any, args: {
  runId: string; url?: string; filePath?: string; slug?: string;
}) => {
  const runId = String(args?.runId || `run-${Date.now()}`);
  bdRuns.set(runId, { child: null, cancelled: false });
  const cancelled = () => bdRuns.get(runId)?.cancelled;
  const url = (args?.url || '').trim();
  const localFile = (args?.filePath || '').trim();
  if (!url && !localFile) return { ok: false, message: 'Give a URL or a local video file.' };

  // slug: caller's, else derived from URL / filename
  let slug = String(args?.slug || '').trim();
  if (!slug) {
    const base = localFile ? path.basename(localFile).replace(/\.[^.]+$/, '') : (url.replace(/^https?:\/\//, '').split(/[/?#]/).filter(Boolean).pop() || 'ad');
    slug = slugify(base);
  }
  const dir = path.join(mindBreakdownsDir(), slug);
  const framesDir = path.join(dir, 'frames');
  const work = path.join(dir, '_work');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(work, { recursive: true });
  } catch (e: any) { return { ok: false, message: `Cannot prepare folder: ${String(e?.message || e)}` }; }

  // Every path through this run shells out to ffmpeg (frames, thumbs, audio);
  // a link needs yt-dlp too. Answer now, in words, rather than ENOENT later.
  if (!resolveTool('ffmpeg')) return { ok: false, reason: 'missing_tool', message: describeMissing('ffmpeg') };
  if (!localFile && !resolveTool('yt-dlp')) return { ok: false, reason: 'missing_tool', message: describeMissing('yt-dlp') };

  const t0 = Date.now();
  let sourceInfo: any = {};
  let videoPath = '';
  try {
    // ── FETCH ──
    if (localFile) {
      if (!fs.existsSync(localFile)) return { ok: false, message: 'Local file not found.' };
      bdProgress({ runId, step: 'fetch', msg: `reading ${path.basename(localFile)}` });
      videoPath = localFile;
      sourceInfo = { title: path.basename(localFile).replace(/\.[^.]+$/, ''), uploader: null, webpageUrl: null };
    } else {
      bdProgress({ runId, step: 'fetch', msg: 'downloading with yt-dlp…' });
      // --ffmpeg-location is REQUIRED: the Electron process PATH has no ffmpeg, and
      // without it yt-dlp exits 0 leaving UNMERGED video.f*/audio.f* intermediates.
      const base = [url, '--no-playlist', '-f', 'bv*[height<=1080]+ba/b[height<=1080]/b',
        '--ffmpeg-location', bdFfmpeg(),
        '-o', path.join(work, 'video.%(ext)s'), '--write-info-json',
        '--socket-timeout', '20', '--retries', '3', '--fragment-retries', '3', '--no-warnings', '-q'];
      const subs = ['--write-subs', '--write-auto-subs', '--sub-langs', 'en,en-*,ar,ar-*'];
      let p = await bdRunCmd(runId, bdYtDlp(), [...base, ...subs], 600_000);
      // largest candidate first — if intermediates ever survive, the video stream
      // dwarfs the audio one, so size ordering never hands ffmpeg an audio-only file
      const grab = (): string[] => (fs.readdirSync(work) as string[])
        .filter((f: string) => /^video\./.test(f) && !/\.(json|vtt|srt|part)$/.test(f))
        .sort((a: string, b: string) => fs.statSync(path.join(work, b)).size - fs.statSync(path.join(work, a)).size);
      let vids = grab();
      if (!vids.length && /subtitle/i.test(p.stderr || '')) { p = await bdRunCmd(runId, bdYtDlp(), base, 600_000); vids = grab(); }
      if (cancelled()) return { ok: false, cancelled: true };
      if (!vids.length) return { ok: false, message: `yt-dlp failed: ${(p.stderr || '').trim().split('\n').pop()?.slice(0, 200) || 'no video'}` };
      videoPath = path.join(work, vids[0]);
      try {
        const infoFile = (fs.readdirSync(work) as string[]).find((f: string) => f.endsWith('.info.json'));
        if (infoFile) {
          const raw = JSON.parse(fs.readFileSync(path.join(work, infoFile), 'utf-8'));
          sourceInfo = { title: raw.title, uploader: raw.uploader, webpageUrl: raw.webpage_url, uploadDate: raw.upload_date };
        }
      } catch { /* info is best-effort */ }
    }
    if (cancelled()) return { ok: false, cancelled: true };

    // ── FRAMES ──
    bdProgress({ runId, step: 'frames', msg: 'measuring…' });
    const duration = await bdProbeDuration(runId, videoPath);
    bdProgress({ runId, step: 'frames', msg: 'extracting frames (scene-cut ∪ 1fps)…' });
    const frames = await bdExtractFrames(runId, videoPath, duration, framesDir);
    if (cancelled()) return { ok: false, cancelled: true };
    if (!frames.length) return { ok: false, message: 'No frames could be extracted from the video.' };

    // REAL shot boundaries — detect cuts, build shot intervals (the shotlist source).
    bdProgress({ runId, step: 'frames', msg: 'detecting shot cuts…' });
    let shots: Array<{ no: number; tcIn: number; tcOut: number; frameIds: string[] }> = [];
    try {
      const cuts = await bdDetectCuts(runId, videoPath, duration);
      shots = bdBuildShots(cuts, duration, frames.map(f => ({ id: f.id, t: f.t })));
    } catch { /* cut detection is best-effort; shotlist degrades to model-inferred */ }

    // analysis thumbs (~640px)
    bdProgress({ runId, step: 'frames', msg: `thumbing ${frames.length} frames…` });
    const thumbsDir = path.join(dir, '_thumbs');
    fs.mkdirSync(thumbsDir, { recursive: true });
    const thumbs: Array<{ id: string; abs: string; t: number }> = [];
    for (const fr of frames) {
      const tabs = path.join(thumbsDir, `${fr.id}.jpg`);
      await bdRunCmd(runId, bdFfmpeg(), ['-y', '-i', fr.abs, '-vf', "scale='min(640,iw)':-2", '-q:v', '7', tabs], 30_000);
      thumbs.push({ id: fr.id, abs: fs.existsSync(tabs) ? tabs : fr.abs, t: fr.t });
    }
    if (cancelled()) return { ok: false, cancelled: true };

    // ── AUDIO ──
    bdProgress({ runId, step: 'audio', msg: 'extracting audio…' });
    const audioAbs = path.join(dir, 'audio.m4a');
    const ap = await bdRunCmd(runId, bdFfmpeg(), ['-y', '-i', videoPath, '-vn', '-ac', '1', '-c:a', 'aac', '-b:a', '96k', audioAbs], 300_000);
    const hasAudio = ap.code === 0 && fs.existsSync(audioAbs) && fs.statSync(audioAbs).size > 0;

    // ── CAPTIONS ──
    if (!localFile) {
      for (const f of (fs.readdirSync(work) as string[])) {
        if (/\.(vtt|srt)$/.test(f)) {
          const m = /\.([\w-]+)\.(vtt|srt)$/.exec(f);
          const lang = m ? m[1] : 'und';
          try { fs.renameSync(path.join(work, f), path.join(dir, `captions.${lang}.${m ? m[2] : 'vtt'}`)); } catch { /* skip */ }
        }
      }
    }
    // DIALOGUE — ASR first (Arabic-first, engine from Settings). Works even for
    // local uploads that have no subtitles; preferred over platform captions.
    // Best-effort: any failure degrades to subtitles, never stops the run.
    let transcript: { lang: string; source: 'asr' | 'subs'; segments: Array<{ start: number; end: number; text: string; lang?: string }> } | null = null;
    if (hasAudio) {
      bdProgress({ runId, step: 'audio', msg: 'transcribing dialogue…' });
      const cfg = readTranscriptionConfig();
      let asr = await bdTranscribe(runId, audioAbs, cfg);
      // If local whisper isn't installed yet, fall back to the OpenAI Whisper API
      // (a direct vendor, not a middleman) when a key exists — so ASR works today
      // and uses local once installed. Surfaced clearly in progress.
      if (!asr.ok && cfg.engine === 'local-whisper' && providerKey('openai')) {
        bdProgress({ runId, step: 'audio', msg: 'local whisper unavailable — transcribing via OpenAI…' });
        asr = await bdTranscribe(runId, audioAbs, { ...cfg, engine: 'openai', model: 'whisper-1' });
      }
      if (asr.ok && asr.transcript) transcript = asr.transcript;
      else bdProgress({ runId, step: 'audio', msg: `ASR skipped (${asr.message || 'no speech'}) — trying subtitles` });
    }
    // Timed subtitles fallback (source 'subs'); captions (flat) derives from
    // whichever transcript we ended up with, for backward-compat prompt code.
    const subs = bdSubtitles(dir);
    if (!transcript && subs) transcript = { lang: subs.lang, source: 'subs', segments: subs.segments };
    const captions = bdCaptionsFlat(transcript?.segments || subs?.segments);

    // keep source video beside the set (downloads MOVE in; local uploads are
    // COPIED so the precise shot resolver can re-extract dense frames later).
    try {
      const ext = path.extname(videoPath) || '.mp4';
      const dest = path.join(dir, `source${ext}`);
      if (!localFile) fs.renameSync(videoPath, dest);
      else if (videoPath !== dest) fs.copyFileSync(videoPath, dest);
      fs.rmSync(work, { recursive: true, force: true });
    } catch { /* cleanup is best-effort */ }

    bdProgress({ runId, step: 'ingested', msg: `${frames.length} frames · ${Math.round((Date.now() - t0) / 100) / 10}s` });
    return {
      ok: true,
      meta: {
        slug, dir, durationS: duration, captions, transcript, shots,
        audioAbs: hasAudio ? audioAbs : null,
        sourceInfo,
        frames: frames.map(f => ({ id: f.id, rel: f.rel, abs: f.abs, t: f.t })),
        thumbs,
      },
    };
  } catch (e: any) {
    return { ok: false, message: String(e?.message || e).slice(0, 300) };
  } finally {
    // leave the run registered so a late cancel is a no-op; GC after 5 min
    setTimeout(() => bdRuns.delete(runId), 300_000);
  }
});

ipcMain.handle('hjen:breakdown-cancel', (_e: any, args: { runId: string }) => {
  const rec = bdRuns.get(String(args?.runId || ''));
  if (!rec) return { ok: false };
  rec.cancelled = true;
  try { rec.child?.kill('SIGKILL'); } catch { /* already gone */ }
  return { ok: true };
});

// Write the assembled AdBreakdown JSON (frames already placed by ingest). Frame
// `file` paths are stored RELATIVE ('frames/fNNN.jpg') — mind-breakdown-read
// resolves them to absolute on load, exactly like the offline factory install.
ipcMain.handle('hjen:mind-breakdown-write', (_e: any, args: { slug: string; breakdown: any }) => {
  const slug = String(args?.slug ?? '');
  if (!slug || slug.includes('..') || slug.includes('/')) return { ok: false, message: 'bad slug' };
  const bd = args?.breakdown;
  if (!bd || typeof bd !== 'object') return { ok: false, message: 'no breakdown' };
  const dir = path.join(mindBreakdownsDir(), slug);
  try {
    fs.mkdirSync(dir, { recursive: true });
    atomicWriteFileSync(path.join(dir, 'breakdown.json'), JSON.stringify(bd, null, 1));
    return { ok: true, slug };
  } catch (e: any) { return { ok: false, message: String(e?.message || e) }; }
});

// ── RUN-STATE CHECKPOINT — the mid-run save that makes RESUME real ──
// breakdown.json is written only at the very end of a run; if the app quits mid-
// run, everything made so far (vision passes, DNAs, docs, master prompts) would
// be lost. This checkpoint mirrors the in-memory RunState to run-state.json beside
// the frames after every expensive phase, so an interrupted run RESUMES from
// exactly where it stopped. Cleared once the final breakdown.json lands.
ipcMain.handle('hjen:breakdown-runstate-write', (_e: any, args: { slug: string; state: any }) => {
  const slug = String(args?.slug ?? '');
  if (!slug || slug.includes('..') || slug.includes('/')) return { ok: false, message: 'bad slug' };
  const dir = path.join(mindBreakdownsDir(), slug);
  try {
    if (!fs.existsSync(dir)) return { ok: false, message: 'folder missing' };
    atomicWriteFileSync(path.join(dir, 'run-state.json'), JSON.stringify(args?.state ?? {}));
    return { ok: true };
  } catch (e: any) { return { ok: false, message: String(e?.message || e) }; }
});
ipcMain.handle('hjen:breakdown-runstate-read', (_e: any, args: { slug: string }) => {
  const slug = String(args?.slug ?? '');
  if (!slug || slug.includes('..') || slug.includes('/')) return { ok: false, message: 'bad slug' };
  const f = path.join(mindBreakdownsDir(), slug, 'run-state.json');
  try {
    if (!fs.existsSync(f)) return { ok: true, state: null };
    return { ok: true, state: JSON.parse(fs.readFileSync(f, 'utf-8')) };
  } catch (e: any) { return { ok: false, message: String(e?.message || e) }; }
});
ipcMain.handle('hjen:breakdown-runstate-clear', (_e: any, args: { slug: string }) => {
  const slug = String(args?.slug ?? '');
  if (!slug || slug.includes('..') || slug.includes('/')) return { ok: true };
  try { fs.rmSync(path.join(mindBreakdownsDir(), slug, 'run-state.json'), { force: true }); } catch { /* best-effort */ }
  return { ok: true };
});

// My Mind — the user's curated pipeline DNA, cross-project. This file is
// precious (weeks of curation): atomic write + a rolling backup per day.
function myMindPath(): string {
  return path.join(projectsRootPath(), '_mind', 'mymind.json');
}
ipcMain.handle('hjen:my-mind-read', () => {
  const f = myMindPath();
  if (!fs.existsSync(f)) return { ok: true, items: [] };
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf-8'));
    return { ok: true, items: Array.isArray(j?.items) ? j.items : [] };
  } catch { return { ok: true, items: [] }; }
});
ipcMain.handle('hjen:my-mind-write', (_e: any, args: { items: unknown[] }) => {
  const f = myMindPath();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  try {
    if (fs.existsSync(f)) {
      const bdir = path.join(path.dirname(f), 'backups');
      fs.mkdirSync(bdir, { recursive: true });
      const stamp = new Date().toISOString().slice(0, 10);
      const bfile = path.join(bdir, `mymind_${stamp}.json`);
      if (!fs.existsSync(bfile)) fs.copyFileSync(f, bfile);
    }
  } catch { /* backup is best-effort; the write below still goes through */ }
  atomicWriteFileSync(f, JSON.stringify(
    { version: 1, items: Array.isArray(args?.items) ? args.items : [] }, null, 2));
  return { ok: true };
});

// Brain Cards — الدماغ الثاني (Phase A). Lessons auto-captured from every
// BREAKDOWN, cross-project, accumulated (compounding). Precious like My Mind:
// atomic write + a rolling daily backup.
function brainCardsPath(): string {
  return path.join(projectsRootPath(), '_mind', 'braincards.json');
}
ipcMain.handle('hjen:mind-braincards-read', () => {
  const f = brainCardsPath();
  if (!fs.existsSync(f)) return { ok: true, cards: [] };
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf-8'));
    return { ok: true, cards: Array.isArray(j?.cards) ? j.cards : [] };
  } catch { return { ok: true, cards: [] }; }
});
ipcMain.handle('hjen:mind-braincards-write', (_e: any, args: { cards: unknown[] }) => {
  const f = brainCardsPath();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  try {
    if (fs.existsSync(f)) {
      const bdir = path.join(path.dirname(f), 'backups');
      fs.mkdirSync(bdir, { recursive: true });
      const stamp = new Date().toISOString().slice(0, 10);
      const bfile = path.join(bdir, `braincards_${stamp}.json`);
      if (!fs.existsSync(bfile)) fs.copyFileSync(f, bfile);
    }
  } catch { /* backup is best-effort; the write below still goes through */ }
  atomicWriteFileSync(f, JSON.stringify(
    { version: 1, cards: Array.isArray(args?.cards) ? args.cards : [] }, null, 2));
  return { ok: true };
});

// ─── Storyboard product ──────────────────────────────────────────
// ─── storyboard data-safety helpers ────────────────────────────────
// Goal: a user must NEVER lose their board, and must be able to roll back to
// any earlier point. Three layers: atomic writes (no half-written files on a
// crash), versioned backups (throttled + deduped so history survives), and
// auto-heal (a missing/corrupt main file is rebuilt from the newest backup).

const SB_LEN = (a: any) => (Array.isArray(a) ? a.length : 0);
function sbPopulated(d: any): boolean {
  return SB_LEN(d?.shots) > 0 || SB_LEN(d?.characters) > 0 || SB_LEN(d?.places) > 0 ||
    SB_LEN(d?.elements) > 0 || !!String(d?.scriptText || '').trim();
}
function sbSignature(d: any): string {
  // structural fingerprint — any change here forces a fresh backup
  return [SB_LEN(d?.shots), SB_LEN(d?.characters), SB_LEN(d?.places), SB_LEN(d?.elements),
    String(d?.scriptText || '').length].join(':');
}
function atomicWriteFileSync(file: string, content: string) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);   // atomic on the same filesystem
}
function sbBackupDir(mainFile: string): string {
  return path.join(path.dirname(mainFile), 'backups');
}
function sbListBackupFiles(bdir: string): string[] {
  if (!fs.existsSync(bdir)) return [];
  return fs.readdirSync(bdir)
    .filter((n: string) => n.startsWith('storyboard_') && n.endsWith('.json'))
    .sort();   // lexical === chronological (ISO stamps)
}
/** Save `prevRaw` as a backup, with dedup + throttle + retention. */
function sbWriteBackup(bdir: string, prevRaw: string, prevParsed: any) {
  try {
    fs.mkdirSync(bdir, { recursive: true });
    const files = sbListBackupFiles(bdir);
    const newest = files.length ? path.join(bdir, files[files.length - 1]) : null;
    if (newest) {
      const newestRaw = fs.readFileSync(newest, 'utf-8');
      if (newestRaw === prevRaw) return;                    // identical content — skip
      // Throttle keystroke-spam: if the newest backup is < 90s old AND the
      // structure is unchanged (same counts), don't add another. Structural
      // changes (a shot added/removed, etc.) always snapshot immediately.
      const ageMs = Date.now() - fs.statSync(newest).mtimeMs;
      let sameStruct = false;
      try { sameStruct = sbSignature(JSON.parse(newestRaw)) === sbSignature(prevParsed); } catch { /* keep */ }
      if (ageMs < 90_000 && sameStruct) return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    atomicWriteFileSync(path.join(bdir, `storyboard_${stamp}.json`), prevRaw);
    // retention — keep the newest 60 versions
    const after = sbListBackupFiles(bdir);
    for (const old of after.slice(0, Math.max(0, after.length - 60))) {
      try { fs.unlinkSync(path.join(bdir, old)); } catch { /* ignore */ }
    }
  } catch { /* backups are best-effort, never block the write */ }
}
/** Newest backup that parses to a populated board, or null. */
function sbNewestValidBackup(bdir: string): { file: string; data: any } | null {
  const files = sbListBackupFiles(bdir).reverse();   // newest first
  for (const n of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(bdir, n), 'utf-8'));
      if (sbPopulated(data)) return { file: path.join(bdir, n), data };
    } catch { /* try older */ }
  }
  return null;
}

ipcMain.handle('hjen:read-storyboard', (_e: any, args: { id: string }) => {
  const arr = readProjects();
  const target = arr.find(p => p.id === args.id);
  if (!target) return null;
  const f = storyboardDataPath(target.slug);
  // Happy path — main file parses.
  if (fs.existsSync(f)) {
    try { return JSON.parse(fs.readFileSync(f, 'utf-8')); }
    catch { /* corrupt — fall through to auto-heal */ }
  }
  // Auto-heal: main file missing or corrupt → restore from newest valid backup.
  const healed = sbNewestValidBackup(sbBackupDir(f));
  if (healed) {
    try { atomicWriteFileSync(f, JSON.stringify(healed.data, null, 2)); } catch { /* ignore */ }
    return healed.data;
  }
  return null;
});

ipcMain.handle('hjen:write-storyboard', (_e: any, args: { id: string; data: any; allowEmpty?: boolean }) => {
  const arr = readProjects();
  const target = arr.find(p => p.id === args.id);
  if (!target) return { ok: false };
  const f = storyboardDataPath(target.slug);
  fs.mkdirSync(path.dirname(f), { recursive: true });

  // ── data-loss guard ──────────────────────────────────────────────
  // Snapshot the populated previous state, and REFUSE to clobber a populated
  // board with a completely empty one (the classic wipe).
  const next = args.data || {};
  const nextEmpty = !sbPopulated(next);
  try {
    if (fs.existsSync(f)) {
      const prevRaw = fs.readFileSync(f, 'utf-8');
      const prev = JSON.parse(prevRaw);
      if (sbPopulated(prev)) {
        sbWriteBackup(sbBackupDir(f), prevRaw, prev);
        if (nextEmpty && !args.allowEmpty) return { ok: false, reason: 'refused_empty_overwrite' };
      }
    }
  } catch { /* if we can't read prev, fall through and write */ }

  atomicWriteFileSync(f, JSON.stringify(args.data, null, 2));
  return { ok: true };
});

// ─── Node graph persistence (Studio Node canvas) ───────────────────
// Own sidecar under <slug>/_node/graph.json, independent of _project and
// _storyboard. Same safety model as storyboard: atomic write, throttled
// deduped backups, auto-heal from newest valid backup, empty-overwrite guard.
/** Node-graph workspaces. HJEN NODE and HJEN SPACE run the same engine on two
 *  SEPARATE boards, so each gets its own folder — a Space edit can never
 *  overwrite a Node pipeline, and each keeps its own rolling backups. */
type GraphScope = 'node' | 'space';
const GRAPH_SCOPE_DIR: Record<GraphScope, string> = { node: '_node', space: '_space' };
function graphDataPath(slug: string, scope: GraphScope = 'node'): string {
  return path.join(projectFolder(slug), GRAPH_SCOPE_DIR[scope] ?? '_node', 'graph.json');
}
function graphPopulated(d: any): boolean {
  if (Array.isArray(d?.nodes) && d.nodes.length > 0) return true;         // legacy single-canvas
  if (Array.isArray(d?.canvases)) return d.canvases.some((c: any) => Array.isArray(c?.nodes) && c.nodes.length > 0);
  return false;
}
function graphListBackupFiles(bdir: string): string[] {
  if (!fs.existsSync(bdir)) return [];
  return fs.readdirSync(bdir)
    .filter((n: string) => n.startsWith('graph_') && n.endsWith('.json'))
    .sort();
}
function graphWriteBackup(bdir: string, prevRaw: string) {
  try {
    fs.mkdirSync(bdir, { recursive: true });
    const files = graphListBackupFiles(bdir);
    const newest = files.length ? path.join(bdir, files[files.length - 1]) : null;
    if (newest) {
      const newestRaw = fs.readFileSync(newest, 'utf-8');
      if (newestRaw === prevRaw) return;                     // identical — skip
      const ageMs = Date.now() - fs.statSync(newest).mtimeMs;
      if (ageMs < 90_000) return;                            // throttle keystroke spam
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    atomicWriteFileSync(path.join(bdir, `graph_${stamp}.json`), prevRaw);
    const after = graphListBackupFiles(bdir);
    for (const old of after.slice(0, Math.max(0, after.length - 40))) {
      try { fs.unlinkSync(path.join(bdir, old)); } catch { /* ignore */ }
    }
  } catch { /* best-effort */ }
}
function graphNewestValidBackup(bdir: string): any | null {
  const files = graphListBackupFiles(bdir).reverse();
  for (const n of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(bdir, n), 'utf-8'));
      if (graphPopulated(data)) return data;
    } catch { /* older */ }
  }
  return null;
}

ipcMain.handle('hjen:read-graph', (_e: any, args: { id: string; scope?: GraphScope }) => {
  const target = readProjects().find(p => p.id === args.id);
  if (!target) return null;
  const f = graphDataPath(target.slug, args.scope ?? 'node');
  if (fs.existsSync(f)) {
    try { return JSON.parse(fs.readFileSync(f, 'utf-8')); }
    catch { /* corrupt — auto-heal */ }
  }
  const healed = graphNewestValidBackup(path.join(path.dirname(f), 'backups'));
  if (healed) {
    try { atomicWriteFileSync(f, JSON.stringify(healed, null, 2)); } catch { /* ignore */ }
    return healed;
  }
  return null;
});

ipcMain.handle('hjen:write-graph', (_e: any, args: { id: string; doc: any; allowEmpty?: boolean; scope?: GraphScope }) => {
  const target = readProjects().find(p => p.id === args.id);
  if (!target) return { ok: false, reason: 'no_project' };
  const f = graphDataPath(target.slug, args.scope ?? 'node');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const next = args.doc || {};
  const nextEmpty = !graphPopulated(next);
  try {
    if (fs.existsSync(f)) {
      const prevRaw = fs.readFileSync(f, 'utf-8');
      const prev = JSON.parse(prevRaw);
      if (graphPopulated(prev)) {
        graphWriteBackup(path.join(path.dirname(f), 'backups'), prevRaw);
        if (nextEmpty && !args.allowEmpty) return { ok: false, reason: 'refused_empty_overwrite' };
      }
    }
  } catch { /* fall through and write */ }
  atomicWriteFileSync(f, JSON.stringify(args.doc, null, 2));
  return { ok: true };
});

// ─── The Swap persistence ──────────────────────────────────────────
// Own sidecar under <slug>/_swap/swap.json. Same safety model as the graph:
// atomic write, throttled deduped backups, auto-heal, empty-overwrite guard.
//
// WHY IT IS PER PROJECT even though a source frame can come from anywhere: a
// decomposition is not a read, it is WORK — a read the owner paid for, plus the
// decisions he made on top of it, plus every take those decisions produced. The
// takes already save into the active project, so the session that made them
// belongs there too. Splitting them would mean a project's frames existed with
// no record of what was asked for.
function swapDocPath(slug: string): string {
  return path.join(projectFolder(slug), '_swap', 'swap.json');
}
function swapPopulated(d: any): boolean {
  return Array.isArray(d?.sessions) && d.sessions.length > 0;
}
function swapListBackupFiles(bdir: string): string[] {
  if (!fs.existsSync(bdir)) return [];
  return fs.readdirSync(bdir).filter((n: string) => n.startsWith('swap_') && n.endsWith('.json')).sort();
}
function swapWriteBackup(bdir: string, prevRaw: string) {
  try {
    fs.mkdirSync(bdir, { recursive: true });
    const files = swapListBackupFiles(bdir);
    const newest = files.length ? path.join(bdir, files[files.length - 1]) : null;
    if (newest) {
      if (fs.readFileSync(newest, 'utf-8') === prevRaw) return;      // identical — skip
      if (Date.now() - fs.statSync(newest).mtimeMs < 90_000) return; // throttle keystroke spam
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    atomicWriteFileSync(path.join(bdir, `swap_${stamp}.json`), prevRaw);
    const after = swapListBackupFiles(bdir);
    for (const old of after.slice(0, Math.max(0, after.length - 40))) {
      try { fs.unlinkSync(path.join(bdir, old)); } catch { /* ignore */ }
    }
  } catch { /* best-effort */ }
}
function swapNewestValidBackup(bdir: string): any | null {
  for (const n of swapListBackupFiles(bdir).reverse()) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(bdir, n), 'utf-8'));
      if (swapPopulated(data)) return data;
    } catch { /* older */ }
  }
  return null;
}

ipcMain.handle('hjen:read-swap-doc', (_e: any, args: { id: string }) => {
  const target = readProjects().find(p => p.id === args.id);
  if (!target) return null;
  const f = swapDocPath(target.slug);
  if (fs.existsSync(f)) {
    try { return JSON.parse(fs.readFileSync(f, 'utf-8')); }
    catch { /* corrupt — auto-heal */ }
  }
  const healed = swapNewestValidBackup(path.join(path.dirname(f), 'backups'));
  if (healed) {
    try { atomicWriteFileSync(f, JSON.stringify(healed, null, 2)); } catch { /* ignore */ }
    return healed;
  }
  return null;
});

ipcMain.handle('hjen:write-swap-doc', (_e: any, args: { id: string; doc: any; allowEmpty?: boolean }) => {
  const target = readProjects().find(p => p.id === args.id);
  if (!target) return { ok: false, reason: 'no_project' };
  const f = swapDocPath(target.slug);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const nextEmpty = !swapPopulated(args.doc || {});
  try {
    if (fs.existsSync(f)) {
      const prevRaw = fs.readFileSync(f, 'utf-8');
      if (swapPopulated(JSON.parse(prevRaw))) {
        swapWriteBackup(path.join(path.dirname(f), 'backups'), prevRaw);
        // A read costs two vision calls and the decisions on top of it are the
        // owner's own work — an empty doc must never be allowed to land on a
        // populated one by accident.
        if (nextEmpty && !args.allowEmpty) return { ok: false, reason: 'refused_empty_overwrite' };
      }
    }
  } catch { /* fall through and write */ }
  atomicWriteFileSync(f, JSON.stringify(args.doc, null, 2));
  return { ok: true };
});

// ═══ Panel documents · Mood Board + Timeline ════════════════════════
// Two features, one store. A mood board and a sequence are the same kind of
// object: a per-project, user-authored document that lives in a dock inside
// References and can be torn off into its own window. They therefore share one
// persistence layer rather than owning two near-identical copies of it.
//
// Safety model is the graph's, because this is unrecoverable creative work with
// no upstream source: atomic write, throttled deduped backups, auto-heal from
// the newest valid backup, empty-overwrite guard. PLUS a `rev` guard the graph
// does not need — a document can be open in TWO windows at once (the dock and
// its detached twin), and the loser of a race must be told rather than clobber.
//
// ONE FILE PER DOCUMENT, not one big file: two windows on two documents is then
// structurally conflict-free instead of merely conventionally safe.
//
//   <slug>/_moodboard/<docId>.json   ·  <slug>/_timeline/<docId>.json
//           index.json               ← a MIRROR, rebuilt from the files; never
//                                      trusted over them, so a stale index can
//                                      never hide a real document
//           media/<sha1>.<ext>       ← copies of files dropped from OUTSIDE
//           backups/doc_<id>_<ISO>.json

interface PanelKind {
  dir: string;
  /** Does this document hold real work? Gates the empty-overwrite refusal. */
  populated: (d: any) => boolean;
  summarize: (d: any) => { count: number; coverPath?: string };
}

const PANEL_KINDS: Record<string, PanelKind> = {
  moodboard: {
    dir: '_moodboard',
    populated: d => Array.isArray(d?.items) && d.items.length > 0,
    summarize: d => {
      const items = Array.isArray(d?.items) ? d.items : [];
      const cover = items.find((i: any) => i?.kind !== 'note' && i?.src);
      return { count: items.length, coverPath: cover?.src };
    },
  },
  timeline: {
    dir: '_timeline',
    populated: d => Array.isArray(d?.tracks) && d.tracks.some((t: any) => (t?.clips || []).length > 0),
    summarize: d => {
      const tracks = Array.isArray(d?.tracks) ? d.tracks : [];
      const clips = tracks.flatMap((t: any) => t?.clips || []);
      const cover = clips.find((c: any) => c?.thumb) || clips.find((c: any) => c?.kind === 'image' && c?.src);
      return { count: clips.length, coverPath: cover?.thumb || cover?.src };
    },
  },
};

function panelKind(kind: string): PanelKind | null {
  return Object.prototype.hasOwnProperty.call(PANEL_KINDS, kind) ? PANEL_KINDS[kind] : null;
}
function panelDir(slug: string, kind: string): string {
  return path.join(projectFolder(slug), PANEL_KINDS[kind].dir);
}
/** Sanitised so a docId can never escape the folder it belongs to. */
function panelDocPath(slug: string, kind: string, docId: string): string {
  const safe = String(docId || '').replace(/[^\w-]+/g, '').slice(0, 48);
  return safe ? path.join(panelDir(slug, kind), `${safe}.json`) : '';
}

function panelBackup(slug: string, kind: string, docId: string, prevRaw: string) {
  try {
    const bdir = path.join(panelDir(slug, kind), 'backups');
    fs.mkdirSync(bdir, { recursive: true });
    const mine = (n: string) => n.startsWith(`doc_${docId}_`) && n.endsWith('.json');
    const files = (fs.readdirSync(bdir) as string[]).filter(mine).sort();
    const newest = files.length ? path.join(bdir, files[files.length - 1]) : null;
    if (newest) {
      if (fs.readFileSync(newest, 'utf-8') === prevRaw) return;         // identical — skip
      if (Date.now() - fs.statSync(newest).mtimeMs < 90_000) return;    // throttle drag-spam
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    atomicWriteFileSync(path.join(bdir, `doc_${docId}_${stamp}.json`), prevRaw);
    const after = (fs.readdirSync(bdir) as string[]).filter(mine).sort();
    for (const old of after.slice(0, Math.max(0, after.length - 40))) {
      try { fs.unlinkSync(path.join(bdir, old)); } catch { /* ignore */ }
    }
  } catch { /* best-effort */ }
}

function panelNewestValidBackup(slug: string, kind: string, docId: string): any | null {
  try {
    const bdir = path.join(panelDir(slug, kind), 'backups');
    const files = (fs.readdirSync(bdir) as string[])
      .filter(n => n.startsWith(`doc_${docId}_`) && n.endsWith('.json')).sort().reverse();
    for (const n of files) {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(bdir, n), 'utf-8'));
        if (PANEL_KINDS[kind].populated(d)) return d;
      } catch { /* older */ }
    }
  } catch { /* none */ }
  return null;
}

/** Rebuild index.json from the document files. The files are the truth; the
 *  index is a convenience mirror, the same relationship ProjectMeta has to
 *  state.json. */
function panelReindex(slug: string, kind: string): any[] {
  const dir = panelDir(slug, kind);
  let names: string[] = [];
  try { names = (fs.readdirSync(dir) as string[]).filter(n => n.endsWith('.json') && n !== 'index.json'); }
  catch { return []; }
  const out: any[] = [];
  for (const n of names) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf-8'));
      if (!d?.id) continue;
      const s = PANEL_KINDS[kind].summarize(d);
      out.push({ id: d.id, name: d.name || 'Untitled', updatedAt: d.updatedAt || '', rev: d.rev || 0, ...s });
    } catch { /* skip a corrupt document */ }
  }
  out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  try {
    fs.mkdirSync(dir, { recursive: true });
    atomicWriteFileSync(path.join(dir, 'index.json'), JSON.stringify({ version: 1, docs: out }, null, 2));
  } catch { /* the answer below is still right */ }
  return out;
}

/** Send to EVERY renderer, including the sender — each one filters by sourceId.
 *  Windows with no listener (the hunt browser, the hidden print window) simply
 *  drop it. */
function broadcast(channel: string, payload: any): void {
  for (const w of BrowserWindow.getAllWindows()) {
    try { if (!w.isDestroyed()) w.webContents.send(channel, payload); } catch { /* gone */ }
  }
}

function panelProject(id: string): ProjectMeta | undefined {
  return readProjects().find(p => p.id === id);
}

ipcMain.handle('hjen:doc-list', (_e: any, args: { id: string; kind: string }) => {
  const t = panelProject(args?.id);
  if (!t || !panelKind(args?.kind)) return { ok: false, message: 'No such project.' };
  return { ok: true, docs: panelReindex(t.slug, args.kind) };
});

ipcMain.handle('hjen:doc-read', (_e: any, args: { id: string; kind: string; docId: string }) => {
  const t = panelProject(args?.id);
  if (!t || !panelKind(args?.kind)) return { ok: false, message: 'No such project.' };
  const f = panelDocPath(t.slug, args.kind, args.docId);
  if (!f) return { ok: false, message: 'Bad document id.' };
  if (fs.existsSync(f)) {
    try { return { ok: true, doc: JSON.parse(fs.readFileSync(f, 'utf-8')) }; }
    catch { /* corrupt — auto-heal below */ }
  }
  const healed = panelNewestValidBackup(t.slug, args.kind, args.docId);
  if (healed) {
    try {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      atomicWriteFileSync(f, JSON.stringify(healed, null, 2));
    } catch { /* ignore */ }
    return { ok: true, doc: healed, healed: true };
  }
  return { ok: false, reason: 'not_found' };
});

ipcMain.handle('hjen:doc-write', (_e: any, args: {
  id: string; kind: string; docId: string; doc: any; sourceId?: string; allowEmpty?: boolean;
}) => {
  const t = panelProject(args?.id);
  if (!t || !panelKind(args?.kind)) return { ok: false, reason: 'no_project' };
  const f = panelDocPath(t.slug, args.kind, args.docId);
  if (!f) return { ok: false, reason: 'bad_id' };
  fs.mkdirSync(path.dirname(f), { recursive: true });

  const K = PANEL_KINDS[args.kind];
  const next = args.doc || {};
  let prev: any = null;
  try {
    if (fs.existsSync(f)) {
      const prevRaw = fs.readFileSync(f, 'utf-8');
      prev = JSON.parse(prevRaw);
      if (K.populated(prev)) {
        panelBackup(t.slug, args.kind, args.docId, prevRaw);
        // The classic wipe: a populated document must never be replaced by an
        // empty one unless the caller says so (Clear board / Delete all).
        if (!K.populated(next) && !args.allowEmpty) return { ok: false, reason: 'refused_empty_overwrite' };
      }
      // Two-window race: the other window already wrote a NEWER revision.
      // Refuse and hand the winner back so the loser rebases instead of
      // clobbering work it never saw.
      if (Number(prev?.rev ?? 0) > Number(next?.rev ?? 0)) {
        return { ok: false, reason: 'stale', doc: prev };
      }
    }
  } catch { /* unreadable prev — fall through and write */ }

  const doc = {
    ...next,
    id: args.docId,
    rev: Math.max(Number(next?.rev ?? 0), Number(prev?.rev ?? 0) + 1),
    updatedAt: new Date().toISOString(),
  };
  atomicWriteFileSync(f, JSON.stringify(doc, null, 2));
  panelReindex(t.slug, args.kind);
  broadcast('hjen:doc-changed', {
    projectId: args.id, kind: args.kind, docId: args.docId,
    sourceId: args.sourceId || '', rev: doc.rev,
  });
  return { ok: true, rev: doc.rev };
});

// The blank document is built in the RENDERER (that is where the model lives —
// src/types/moodboard.ts, src/lib/timeline/model.ts). Main only stamps identity.
ipcMain.handle('hjen:doc-create', (_e: any, args: { id: string; kind: string; name?: string; doc?: any }) => {
  const t = panelProject(args?.id);
  if (!t || !panelKind(args?.kind)) return { ok: false, message: 'No such project.' };
  const docId = `${args.kind === 'timeline' ? 'seq' : 'mb'}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();
  const doc = {
    ...(args.doc || {}),
    version: 1, id: docId,
    name: String(args.name || (args.kind === 'timeline' ? 'Sequence' : 'Mood Board')).slice(0, 60),
    createdAt: now, updatedAt: now, rev: 1,
  };
  const f = panelDocPath(t.slug, args.kind, docId);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  atomicWriteFileSync(f, JSON.stringify(doc, null, 2));
  panelReindex(t.slug, args.kind);
  broadcast('hjen:doc-changed', { projectId: args.id, kind: args.kind, docId, sourceId: '', rev: 1 });
  return { ok: true, doc };
});

ipcMain.handle('hjen:doc-delete', (_e: any, args: { id: string; kind: string; docId: string }) => {
  const t = panelProject(args?.id);
  if (!t || !panelKind(args?.kind)) return { ok: false };
  const f = panelDocPath(t.slug, args.kind, args.docId);
  // NEVER a hard delete: the last state becomes a backup first, so "Delete" is
  // recoverable from backups/ exactly like a wiped storyboard.
  try {
    if (f && fs.existsSync(f)) {
      panelBackup(t.slug, args.kind, args.docId, fs.readFileSync(f, 'utf-8'));
      fs.unlinkSync(f);
    }
  } catch { /* ignore */ }
  try { panelWins.get(`${args.kind}:${args.id}:${args.docId}`)?.close(); } catch { /* gone */ }
  panelReindex(t.slug, args.kind);
  broadcast('hjen:doc-changed', { projectId: args.id, kind: args.kind, docId: args.docId, sourceId: '', rev: 0 });
  return { ok: true };
});

// Files dropped from OUTSIDE the project are COPIED in and content-hashed, so a
// document can never break because the user moved a file on their Desktop. A
// path already inside the project folder is referenced in place — no duplicate
// bytes for a frame that already lives in _references/.
ipcMain.handle('hjen:doc-import', (_e: any, args: { id: string; kind: string; paths: string[] }) => {
  const t = panelProject(args?.id);
  if (!t || !panelKind(args?.kind)) return { ok: false, message: 'No such project.' };
  const root = projectFolder(t.slug);
  const dir = path.join(panelDir(t.slug, args.kind), 'media');
  const out: Array<{ path: string; name: string }> = [];
  for (const p of Array.isArray(args.paths) ? args.paths : []) {
    try {
      if (!p || !fs.existsSync(p) || !fs.statSync(p).isFile()) continue;
      if (p === root || p.startsWith(root + path.sep)) { out.push({ path: p, name: path.basename(p) }); continue; }
      const buf = fs.readFileSync(p);
      const hash = nodeCrypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
      const ext = (path.extname(p) || '.png').toLowerCase();
      fs.mkdirSync(dir, { recursive: true });
      const dest = path.join(dir, `${hash}${ext}`);
      if (!fs.existsSync(dest)) fs.writeFileSync(dest, buf);
      out.push({ path: dest, name: path.basename(p) });
    } catch { /* skip this one */ }
  }
  return { ok: true, files: out };
});

// ─── Detached panel windows ────────────────────────────────────────
// The SAME renderer bundle, told at launch what to be. The flag rides on
// additionalArguments — the precedent set by --hjen-traffic-lights above:
// preload reads process.argv SYNCHRONOUSLY, so the right thing paints on the
// FIRST frame. An async "which window am I?" IPC would show one frame of the
// full studio shell before it swapped. The query string carries the same values
// so a devtools reload is self-describing; argv stays the authority.
const panelWins = new Map<string, any>();          // `${kind}:${projectId}:${docId}` → BrowserWindow

function loadRendererInto(win: any, query: Record<string, string>): void {
  if (process.env.VITE_DEV_SERVER_URL) {
    const u = new URL(process.env.VITE_DEV_SERVER_URL);
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
    win.loadURL(u.toString());
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'), { query });
  }
}

function openPanelKeys(): string[] {
  return [...panelWins.entries()].filter(([, w]) => w && !w.isDestroyed()).map(([k]) => k);
}

ipcMain.handle('hjen:panel-open', (_e: any, args: { kind: string; id: string; docId: string; name?: string }) => {
  try {
    if (!panelKind(args?.kind)) return { ok: false, message: 'Unknown panel.' };
    const key = `${args.kind}:${args.id}:${args.docId}`;
    const open = panelWins.get(key);
    if (open && !open.isDestroyed()) {          // already out — surface it, never clone it
      if (open.isMinimized()) open.restore();
      open.show(); open.focus();
      return { ok: true, alreadyOpen: true };
    }

    // Beside the studio, not on top of it — «بجانب التطبيق».
    const mb = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null;
    const area = screen.getDisplayMatching(mb ?? { x: 0, y: 0, width: 1440, height: 900 }).workArea;
    const w = Math.min(1040, Math.max(560, Math.round(area.width * 0.44)));
    const h = Math.min(1100, Math.max(520, Math.round(area.height * 0.86)));
    const x = mb ? Math.max(area.x, Math.min(area.x + area.width - w, mb.x + mb.width + 12))
                 : area.x + area.width - w - 24;
    const y = mb ? Math.max(area.y, Math.min(area.y + area.height - h, mb.y)) : area.y + 24;

    const win = new BrowserWindow({
      width: w, height: h, x, y, minWidth: 460, minHeight: 380,
      title: args.name || (args.kind === 'timeline' ? 'Timeline' : 'Mood Board'),
      titleBarStyle: 'hiddenInset',
      backgroundColor: '#121212',              // the same graphite as the studio — no seam
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        spellcheck: true,
        // A GIF must keep moving and a timeline must keep playing while the
        // studio is the focused window — that is the whole point of detaching.
        backgroundThrottling: false,
        additionalArguments: [
          `--hjen-traffic-lights=${trafficLightSide()}`,
          `--hjen-window=${args.kind}`,
          `--hjen-doc=${args.docId}`,
          `--hjen-project=${args.id}`,
        ],
      },
    });
    panelWins.set(key, win);
    win.on('closed', () => {
      panelWins.delete(key);
      broadcast('hjen:panel-window', { projectId: args.id, kind: args.kind, docId: args.docId, open: false });
    });
    loadRendererInto(win, { panel: args.kind, doc: args.docId, project: args.id });
    broadcast('hjen:panel-window', { projectId: args.id, kind: args.kind, docId: args.docId, open: true });
    return { ok: true, alreadyOpen: false };
  } catch (err: any) { return { ok: false, message: err?.message || String(err) }; }
});

ipcMain.handle('hjen:panel-close', (_e: any, args: { kind: string; id: string; docId: string }) => {
  try { panelWins.get(`${args.kind}:${args.id}:${args.docId}`)?.close(); } catch { /* already gone */ }
  return { ok: true };
});

/** Which documents are currently OUT, so a freshly-mounted dock renders the
 *  "open in its own window" state instead of a second live copy. */
ipcMain.handle('hjen:panel-list', () => ({ ok: true, open: openPanelKeys() }));

// ─── Timeline export (mp4 via ffmpeg · FCPXML) ─────────────────────
// Local, offline render — no cloud. Requires ffmpeg on the machine.
function resolveFfmpeg(): string | null { return resolveTool('ffmpeg'); }
function runFfmpeg(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = childProcess.spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d: any) => { err += String(d); });
    p.on('error', reject);
    p.on('close', (code: number) => code === 0 ? resolve() : reject(new Error(err.split('\n').slice(-6).join('\n') || `ffmpeg exit ${code}`)));
  });
}

interface ExportClip { kind: 'video' | 'image' | 'audio'; src?: string; start: number; duration: number; }

// Render the V1 timeline to an mp4 at the chosen resolution. Clips are
// normalised (scale+pad to WxH, fps) then concatenated in start order.
// v1: video-only (audio dropped), gaps ignored (clips play back-to-back).
ipcMain.handle('hjen:export-timeline-mp4', async (_e: any, args: { clips: ExportClip[]; width: number; height: number; fps: number; projectName?: string }) => {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const bin = resolveFfmpeg();
  if (!bin) return { ok: false, reason: 'no_ffmpeg', message: 'ffmpeg not found. Install it (brew install ffmpeg).' };
  const clips = (args.clips || []).filter(c => c.src && c.kind !== 'audio').sort((a, b) => a.start - b.start);
  if (!clips.length) return { ok: false, reason: 'empty', message: 'No exportable clips on the timeline.' };

  const save = await dialog.showSaveDialog(win, {
    title: 'Export MP4', defaultPath: `${(args.projectName || 'sequence').replace(/[^\w-]+/g, '_')}_${args.width}x${args.height}.mp4`,
    filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
  });
  if (save.canceled || !save.filePath) return { ok: false, reason: 'cancelled' };

  const W = args.width, H = args.height, FPS = args.fps || 30;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hjen-export-'));
  try {
    const vf = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,fps=${FPS},setsar=1,format=yuv420p`;
    const segs: string[] = [];
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i];
      const seg = path.join(tmp, `seg_${String(i).padStart(3, '0')}.mp4`);
      const base = c.kind === 'image'
        ? ['-loop', '1', '-t', String(c.duration), '-i', c.src!]
        : ['-i', c.src!, '-t', String(c.duration)];
      await runFfmpeg(bin, ['-y', ...base, '-vf', vf, '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-r', String(FPS), seg]);
      segs.push(seg);
    }
    const listFile = path.join(tmp, 'concat.txt');
    fs.writeFileSync(listFile, segs.map(s => `file '${s.replace(/'/g, "'\\''")}'`).join('\n'));
    await runFfmpeg(bin, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', save.filePath]);
    return { ok: true, path: save.filePath };
  } catch (err: any) {
    return { ok: false, reason: 'ffmpeg_failed', message: err?.message || String(err) };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ─── CUTS ENGINE 1.0 · internal, standalone ────────────────────────
// A dedicated shot-boundary + representative-frame extractor. Mirrors the
// breakdown ffmpeg idioms (scene-score cut detection, fast-seek frame pulls)
// but keeps its OWN channels/dirs so the breakdown pipeline is never touched.
// Native side does ONLY the heavy lifting (probe + ffmpeg). All grouping /
// frame-selection reasoning lives in the renderer (src/lib/cuts/engine.ts).

// Spawn ffmpeg and KEEP stderr on success (cut detection parses pts_time from it).
function cutsRun(bin: string, args: string[], timeoutMs = 300_000): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = childProcess.spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    const to = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* ignore */ } }, timeoutMs);
    p.stderr.on('data', (d: any) => { err += String(d); });
    p.on('error', (e: any) => { clearTimeout(to); reject(e); });
    p.on('close', (code: number) => { clearTimeout(to); resolve({ code: code ?? 0, stderr: err }); });
  });
}

// Grab ONE frame at an EXACT timestamp. A single fast input-seek (`-ss` before
// `-i`) snaps to the nearest keyframe ≤ t, which — for a shot near a cut — can
// land inside the PREVIOUS shot (the frame "behind" it), poisoning grouping.
// Two-stage seek fixes it: fast-seek to a keyframe a few seconds before, then
// decode forward to the precise time — fast AND frame-accurate.
async function cutsGrabFrame(bin: string, video: string, t: number, vf: string, out: string, timeoutMs = 30_000): Promise<boolean> {
  const coarse = Math.max(0, t - 3);
  const fine = Math.max(0, t - coarse);
  await cutsRun(bin, ['-y', '-ss', String(coarse), '-i', video, '-ss', String(fine),
    '-frames:v', '1', '-vf', vf, '-q:v', '3', out], timeoutMs);
  return fs.existsSync(out);
}

// ─── Generic media probe — ONE cheap read for the timeline's drop path ──────
// ffprobe is deliberately not a tool of this app (see tools.ts: "nothing calls
// it — durations are parsed out of ffmpeg's own stderr"), so this parses the
// same stderr with the same regexes cuts-analyze already trusts. cuts-analyze
// itself is far too heavy for a drop: it runs full scene-cut detection and
// builds a filmstrip. cuts-has-audio answers only a boolean.
//
// Cached by path+mtime: dropping the same file twice costs nothing.
const mediaProbeCache = new Map<string, any>();

ipcMain.handle('hjen:media-probe', async (_e: any, args: { path: string; poster?: boolean }) => {
  const p = args?.path || '';
  if (!p || !fs.existsSync(p)) return { ok: false, reason: 'no_file' };
  const bin = resolveTool('ffmpeg');
  if (!bin) return { ok: false, reason: 'no_ffmpeg', message: describeMissing('ffmpeg') };
  let key = p;
  try { key = `${p}|${fs.statSync(p).mtimeMs}|${args.poster ? 'p' : ''}`; } catch { /* unstamped */ }
  const hit = mediaProbeCache.get(key);
  if (hit) return hit;
  try {
    // No output file: ffmpeg errors out after printing the stream table, which
    // is exactly what we want to read.
    const r = await cutsRun(bin, ['-hide_banner', '-i', p], 30_000);
    const s = r.stderr || '';
    const dm = /Duration: (\d+):(\d+):(\d+\.?\d*)/.exec(s);
    const duration = dm ? Math.round((+dm[1] * 3600 + +dm[2] * 60 + parseFloat(dm[3])) * 100) / 100 : 0;
    const vLine = /Video:.*/.exec(s)?.[0] || '';
    const dims = /(\d{2,5})x(\d{2,5})/.exec(vLine);
    const fpsM = /(\d+(?:\.\d+)?)\s*fps/.exec(vLine);
    const hasVideo = !!vLine;
    // Same test hjen:cuts-has-audio uses.
    const hasAudio = /Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?: Audio:/.test(s);
    // A still reports a Video stream with duration 0 / N/A.
    const kind: 'audio' | 'video' | 'image' = !hasVideo ? 'audio' : (duration > 0.05 ? 'video' : 'image');

    let poster = '';
    if (args.poster && kind === 'video') {
      const dir = path.join(app.getPath('userData'), 'timeline_posters');
      fs.mkdirSync(dir, { recursive: true });
      const out = path.join(dir, `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}.jpg`);
      if (await cutsGrabFrame(bin, p, Math.min(0.5, duration / 2), "scale='min(480,iw)':-2", out)) poster = out;
    }

    const res = {
      ok: true, kind, duration, hasVideo, hasAudio,
      width: dims ? +dims[1] : 0, height: dims ? +dims[2] : 0,
      fps: fpsM ? parseFloat(fpsM[1]) : 0, poster,
    };
    if (mediaProbeCache.size > 256) mediaProbeCache.clear();
    mediaProbeCache.set(key, res);
    return res;
  } catch (err: any) {
    return { ok: false, reason: 'probe_failed', message: err?.message || String(err) };
  }
});

// Per-session working dir: {project|_unassigned}/Cuts/<sessionId>/{shots,strip,cand}
function cutsSessionDir(projectSlug: string | undefined, sessionId: string): string {
  const root = projectSlug ? projectFolder(projectSlug) : path.join(projectsRootPath(), '_unassigned');
  const safe = String(sessionId || 'session').replace(/[^\w-]+/g, '_').slice(0, 60);
  const dir = path.join(root, 'Cuts', safe);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Probe → hard cuts → shots → per-shot mid thumb + a full-length filmstrip.
ipcMain.handle('hjen:cuts-analyze', async (_e: any, args: {
  sessionId: string; videoPath: string; projectSlug?: string; threshold?: number; stripStep?: number;
}) => {
  const bin = resolveFfmpeg();
  if (!bin) return { ok: false, reason: 'no_ffmpeg', message: 'ffmpeg not found. Install it (brew install ffmpeg).' };
  const video = args.videoPath;
  if (!video || !fs.existsSync(video)) return { ok: false, reason: 'no_video', message: 'Video file not found.' };
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
    if (!duration) return { ok: false, reason: 'probe_failed', message: 'Could not read video duration.' };

    // 2) Hard-cut detection — cheap scene-score pass, no image encoding.
    const cutPass = await cutsRun(bin,
      ['-hide_banner', '-i', video, '-filter:v', `select='gt(scene,${T})',showinfo`, '-an', '-f', 'null', '-'], 600_000);
    const rawTimes = [...(cutPass.stderr || '').matchAll(/pts_time:(\d+\.?\d*)/g)]
      .map(m => parseFloat(m[1])).filter(t => Number.isFinite(t)).sort((a, b) => a - b);
    const cuts: number[] = [];
    for (const t of rawTimes) {
      if (t <= 0.2 || t >= duration - 0.15) continue;
      if (cuts.length && t - cuts[cuts.length - 1] < 0.25) continue;
      cuts.push(Math.round(t * 100) / 100);
    }

    // 3) Build shot intervals; fold only true SLIVERS (< 0.18s = detection
    // jitter) into the previous shot. Real fast-montage cuts (~0.3s) survive.
    const bounds = [0, ...cuts, duration].filter((v, i, a) => i === 0 || v > a[i - 1]);
    const rawShots: Array<{ start: number; end: number }> = [];
    for (let i = 0; i < bounds.length - 1; i++) rawShots.push({ start: bounds[i], end: bounds[i + 1] });
    const shotSpans: Array<{ start: number; end: number }> = [];
    for (const sh of rawShots) {
      if (shotSpans.length && sh.end - sh.start < 0.18) { shotSpans[shotSpans.length - 1].end = sh.end; continue; }
      shotSpans.push({ ...sh });
    }

    // 4) One mid-shot representative thumb per shot (fast seek, single frame).
    const shotsDir = path.join(dir, 'shots');
    fs.mkdirSync(shotsDir, { recursive: true });
    const shots: Array<{ i: number; start: number; end: number; dur: number; thumb: string }> = [];
    for (let i = 0; i < shotSpans.length; i++) {
      const sp = shotSpans[i];
      const mid = Math.max(0, Math.min(duration - 0.05, (sp.start + sp.end) / 2));
      const out = path.join(shotsDir, `shot${String(i + 1).padStart(3, '0')}.jpg`);
      await cutsGrabFrame(bin, video, mid, "scale='min(480,iw)':-2", out);   // exact seek — no bleed from the shot behind
      shots.push({
        i: i + 1, start: Math.round(sp.start * 100) / 100, end: Math.round(sp.end * 100) / 100,
        dur: Math.round((sp.end - sp.start) * 100) / 100, thumb: fs.existsSync(out) ? out : '',
      });
    }

    // 5) Uniform filmstrip across the whole ad (Layer 1 ribbon).
    const stripDir = path.join(dir, 'strip');
    fs.mkdirSync(stripDir, { recursive: true });
    for (const f of (fs.readdirSync(stripDir) as string[])) { if (/\.jpg$/.test(f)) fs.rmSync(path.join(stripDir, f)); }
    await cutsRun(bin, ['-y', '-i', video, '-vf', `fps=1/${stripStep},scale=168:-2`,
      '-q:v', '5', path.join(stripDir, 's%04d.jpg')], 300_000);
    const stripFiles = (fs.readdirSync(stripDir) as string[]).filter(f => /\.jpg$/.test(f)).sort();
    const strip = stripFiles.map((f, idx) => ({ t: Math.round(idx * stripStep * 100) / 100, path: path.join(stripDir, f) }));

    return { ok: true, sessionId: args.sessionId, videoPath: video, duration, fps, width, height, dir, shots, strip };
  } catch (err: any) {
    return { ok: false, reason: 'analyze_failed', message: err?.message || String(err) };
  }
});

// Extract N evenly-spaced candidate frames inside one shot (for frame selection).
ipcMain.handle('hjen:cuts-shot-frames', async (_e: any, args: {
  sessionId: string; videoPath: string; projectSlug?: string; shotIndex: number; start: number; end: number; count?: number;
}) => {
  const bin = resolveFfmpeg();
  if (!bin) return { ok: false, reason: 'no_ffmpeg', message: 'ffmpeg not found.' };
  const video = args.videoPath;
  if (!video || !fs.existsSync(video)) return { ok: false, reason: 'no_video', message: 'Video file not found.' };
  const dir = cutsSessionDir(args.projectSlug, args.sessionId);
  const candDir = path.join(dir, 'cand');
  fs.mkdirSync(candDir, { recursive: true });
  const count = Math.max(2, Math.min(12, args.count || 6));
  const span = Math.max(0.05, args.end - args.start);
  try {
    const frames: Array<{ id: string; abs: string; t: number }> = [];
    for (let k = 0; k < count; k++) {
      const t = Math.max(0, args.start + span * ((k + 0.5) / count));
      const id = `s${String(args.shotIndex).padStart(3, '0')}_k${k + 1}`;
      const out = path.join(candDir, `${id}.jpg`);
      const ok = await cutsGrabFrame(bin, video, t, "scale='min(640,iw)':-2", out);   // exact seek — no bleed from the shot behind
      if (ok) frames.push({ id, abs: out, t: Math.round(t * 100) / 100 });
    }
    return { ok: true, frames };
  } catch (err: any) {
    return { ok: false, reason: 'frames_failed', message: err?.message || String(err) };
  }
});

// Fetch a video from a URL (YouTube/…) via yt-dlp into the Cuts working area.
// Cached per-URL (re-fetch of the same link reuses the download). Returns the
// local absolute path so cuts-analyze can run on it like any local file.
ipcMain.handle('hjen:cuts-fetch', async (_e: any, args: { url: string; projectSlug?: string }) => {
  const url = (args.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return { ok: false, reason: 'bad_url', message: 'Paste a valid link starting with http.' };
  const root = args.projectSlug ? projectFolder(args.projectSlug) : path.join(projectsRootPath(), '_unassigned');
  const key = url.replace(/[^\w]+/g, '_').slice(-48) || 'clip';
  const work = path.join(root, 'Cuts', '_fetch', key);
  fs.mkdirSync(work, { recursive: true });

  const grab = (): string[] => (fs.readdirSync(work) as string[])
    .filter((f: string) => /^video\./.test(f) && !/\.(json|vtt|srt|part|ytdl)$/.test(f))
    .sort((a: string, b: string) => fs.statSync(path.join(work, b)).size - fs.statSync(path.join(work, a)).size);

  const readTitle = (): string | undefined => {
    try {
      const info = (fs.readdirSync(work) as string[]).find((f: string) => f.endsWith('.info.json'));
      if (info) return JSON.parse(fs.readFileSync(path.join(work, info), 'utf-8'))?.title;
    } catch { /* best-effort */ }
    return undefined;
  };

  // Cache hit — already downloaded this URL.
  const cached = grab();
  if (cached.length) return { ok: true, videoPath: path.join(work, cached[0]), title: readTitle(), cached: true };

  // Say what is missing BEFORE spawning. This is where testers met
  // `spawn yt-dlp ENOENT`: a raw Node error with no clue what to do about it.
  if (!resolveTool('yt-dlp')) return { ok: false, reason: 'missing_tool', message: describeMissing('yt-dlp') };
  if (!resolveTool('ffmpeg')) return { ok: false, reason: 'missing_tool', message: describeMissing('ffmpeg') };

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
  } catch (err: any) {
    return { ok: false, reason: 'fetch_failed', message: err?.message || String(err) };
  }
});

// Cuts — local visual re-identification embeddings (offline, MPS). Spawns the
// Python sidecar (torchvision detector + DINOv2 + FaceNet) to place each shot
// in a feature space; the renderer fuses the vectors into person threads.
ipcMain.handle('hjen:cuts-embed', async (_e: any, args: {
  sessionId: string; projectSlug?: string; model?: string; shots: Array<{ i: number; frames: string[] }>;
}) => {
  const py = resolveWorldPython();
  if (!py) return { ok: false, reason: 'no_python', message: 'No local Python env for embeddings (STUDY/world_from_image/.venv).' };
  const script = worldkitScript('cuts_embed.py');
  if (!fs.existsSync(script)) return { ok: false, reason: 'no_script', message: `cuts_embed.py not found at ${script}` };
  const dir = cutsSessionDir(args.projectSlug, args.sessionId);
  const manifestPath = path.join(dir, 'embed_manifest.json');
  const outPath = path.join(dir, 'embed.json');
  fs.writeFileSync(manifestPath, JSON.stringify({ out: outPath, model: args.model || 'facebook/dinov2-base', shots: args.shots }));
  const win = mainWindow;
  const code = await new Promise<number>((resolve) => {
    const p = childProcess.spawn(py, [script, manifestPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', (d: Buffer) => { const line = String(d).trim(); if (line) win?.webContents.send('hjen:cuts-embed-progress', { line }); });
    p.stderr.on('data', () => { /* torch/transformers noise */ });
    p.on('close', (c: number) => resolve(c ?? 1));
    p.on('error', () => resolve(1));
  });
  if (code !== 0 || !fs.existsSync(outPath)) return { ok: false, reason: 'embed_failed', message: `embedding sidecar exited ${code}` };
  try { return { ok: true, data: JSON.parse(fs.readFileSync(outPath, 'utf-8')) }; }
  catch (err: any) { return { ok: false, reason: 'parse', message: err?.message || String(err) }; }
});

// Cuts — SPEECH layers. The mind listens (audio) + watches who is on screen,
// splitting speech into VOICE-OVER vs DIALOGUE. To beat Gemini's timecode DRIFT
// on long clips, the video is processed in short WINDOWS (each timecoded from 0,
// then offset by the window start) so timestamps never accumulate error.
const SPEECH_SYSTEM = `You analyse the SPEECH of an advertisement clip using BOTH its audio and its video — crucially, YOU CAN SEE WHETHER MOUTHS MOVE. Work in two steps. STEP 1 (think silently): for every moment a voice is heard, LOOK at the screen and check the LIPS. Is a person on screen moving their lips in sync with the words you hear? Or is the voice heard while no one on screen is speaking (the person is silent / not on screen / lips still)? This lip-sync check is the ONE test that decides the type. STEP 2: output the transcript.`;
const SPEECH_PROMPT = `Transcribe EVERY spoken segment in THIS CLIP — be EXHAUSTIVE, skip nothing: narration, on-screen lines, short interjections, off-screen replies, and any second language. Timecodes are in SECONDS FROM THE START OF THIS CLIP (0 = the first frame of the clip). Focus on getting each segment's START time right.\n\nTYPE — decide ONLY by the lips on screen, never by the voice's tone or role:\n• "dialogue" = the person on screen is visibly moving their OWN lips in sync with these exact words (lip-sync). You can see them speak.\n• "vo" = the words are heard but the person on screen is NOT moving their lips (silent shot, face turned away, cutaway, product/scenery), or no speaker is visible at all.\nA calm narrator whose face never speaks is "vo". A character shouting on camera with moving lips is "dialogue" even if brief. When you truly cannot see any mouth for the segment, default to "vo".\n\nGive the speaker's name/identity if identifiable.\nReturn STRICT JSON only:\n{"segments":[{"type":"vo"|"dialogue","start":<seconds>,"end":<seconds>,"text":"<verbatim words>","speaker":"<who, if identifiable, else empty>"}]}\nIf this clip has no speech, return {"segments":[]}.`;

// Transcode one window to a compact A/V clip and transcribe it (0-based times).
async function cutsSpeechWindow(bin: string, key: string, model: string, video: string, dir: string, wStart: number, len: number, idx: number): Promise<any[]> {
  const av = path.join(dir, `speech_w${idx}.mp4`);
  await cutsRun(bin, ['-y', '-ss', String(wStart), '-i', video, '-t', String(len),
    '-vf', "scale='min(480,iw)':-2,fps=5", '-c:v', 'libx264', '-crf', '30', '-preset', 'veryfast',
    '-ac', '2', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', av], 300_000);
  if (!fs.existsSync(av)) throw new Error('transcode failed');
  if (fs.statSync(av).size > 20 * 1024 * 1024) throw new Error('window too large to send inline');
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
  let data: any;
  try {
    const res = await providerFetch('google', url, { 'content-type': 'application/json' }, body, ac.signal);
    if (!res.ok) { const t = await res.text(); throw new Error(`google ${res.status}: ${t.slice(0, 200)}`); }
    data = await res.json();
  } finally { clearTimeout(timer); }
  const cand = data?.candidates?.[0];
  const txt = Array.isArray(cand?.content?.parts) ? cand.content.parts.map((p: any) => p.text ?? '').join('\n').trim() : '';
  if (!txt) return [];
  let t = txt.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  const parsed = JSON.parse(t);
  return Array.isArray(parsed?.segments) ? parsed.segments : [];
}

ipcMain.handle('hjen:cuts-speech', async (_e: any, args: {
  sessionId: string; projectSlug?: string; videoPath: string; model?: string; duration?: number;
}) => {
  const { key } = providerAuth('google');
  if (!key) return { ok: false, reason: 'no_key', message: 'No Google API key set (Settings).' };
  const bin = resolveFfmpeg();
  if (!bin) return { ok: false, reason: 'no_ffmpeg', message: 'ffmpeg not found.' };
  if (!args.videoPath || !fs.existsSync(args.videoPath)) return { ok: false, reason: 'no_video', message: 'Video not found.' };
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
    if (!duration) return { ok: false, reason: 'no_duration', message: 'Could not read video duration.' };

    // Short windows (60s, 8s overlap) so timecodes never drift across the ad.
    const WIN = 60, OVL = 8, STEP = WIN - OVL;
    const windows: Array<{ start: number; len: number }> = [];
    for (let s = 0; s < duration - 0.5; s += STEP) windows.push({ start: Math.round(s * 100) / 100, len: Math.min(WIN, duration - s) });
    if (!windows.length) windows.push({ start: 0, len: duration });

    const all: any[] = [];
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
    const norm = (t: any) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const out: any[] = [];
    for (const s of all) {
      const dup = out.find(o => Math.abs(o.start - s.start) < 3 && (() => {
        const a2 = norm(o.text), b2 = norm(s.text);
        return a2 === b2 || (a2.length > 4 && (a2.includes(b2) || b2.includes(a2)));
      })());
      if (!dup) out.push(s);
    }
    return { ok: true, segments: out };
  } catch (err: any) {
    const aborted = err?.name === 'AbortError';
    return { ok: false, reason: aborted ? 'timeout' : 'speech_failed', message: String(err?.message || err).slice(0, 300) };
  }
});

// Cuts — VERIFY the automatic cuts by comprehension. ffmpeg splits at every big
// frame change, but an object crossing the lens / a whip-pan / a flash triggers
// a FALSE cut (still one continuous take). The mind watches the video + a still
// per shot and flags the boundaries that are false, so they can be merged.
ipcMain.handle('hjen:cuts-verify', async (_e: any, args: {
  sessionId: string; projectSlug?: string; videoPath: string; model?: string;
  shots: Array<{ i: number; start: number; end: number; frame?: string }>;
}) => {
  const { key } = providerAuth('google');
  if (!key) return { ok: false, reason: 'no_key', message: 'No Google API key set (Settings).' };
  const bin = resolveFfmpeg();
  if (!bin) return { ok: false, reason: 'no_ffmpeg', message: 'ffmpeg not found.' };
  if (!args.videoPath || !fs.existsSync(args.videoPath)) return { ok: false, reason: 'no_video', message: 'Video not found.' };
  const model = args.model || 'gemini-flash-latest';
  const dir = cutsSessionDir(args.projectSlug, args.sessionId);
  const small = path.join(dir, 'watch.mp4');
  try {
    if (!fs.existsSync(small)) {
      await cutsRun(bin, ['-y', '-i', args.videoPath, '-an', '-vf', "scale='min(480,iw)':-2,fps=3",
        '-c:v', 'libx264', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', small], 300_000);
    }
    if (!fs.existsSync(small)) return { ok: false, reason: 'transcode_failed', message: 'Could not prepare the video.' };
    const b64 = fs.readFileSync(small).toString('base64');
    const N = args.shots.length;
    const system = `You are a film editor auditing an automatic cut detector against the real video. It has TWO kinds of error. (1) FALSE cuts — it split ONE continuous take into two shots because an object crossed the lens, the camera whip-panned, a flash fired, or motion blurred. (2) MISSED cuts — it FAILED to split where a real edit happened, so ONE numbered "shot" actually contains two or more different takes/angles/subjects back to back (common when the two takes look similar in colour or setting, e.g. a wide of a field then a close-up on the same field). You are given the video and one numbered still per detected shot; watch the video against the shot time ranges to find BOTH kinds of error.`;
    const parts: any[] = [
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
    let data: any;
    try {
      const res = await providerFetch('google', url, { 'content-type': 'application/json' }, body, ac.signal);
      if (!res.ok) { const t = await res.text(); return { ok: false, reason: 'api_error', message: `google ${res.status}: ${t.slice(0, 300)}` }; }
      data = await res.json();
    } finally { clearTimeout(timer); }
    const cand = data?.candidates?.[0];
    const text = Array.isArray(cand?.content?.parts) ? cand.content.parts.map((p: any) => p.text ?? '').join('\n').trim() : '';
    if (!text) return { ok: false, reason: 'empty', message: 'Model returned no text.' };
    let parsed: any;
    try {
      let t = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
      const a = t.indexOf('{'), b = t.lastIndexOf('}');
      if (a >= 0 && b > a) t = t.slice(a, b + 1);
      parsed = JSON.parse(t);
    } catch { return { ok: false, reason: 'parse', message: `Could not parse JSON: ${text.slice(0, 140)}` }; }
    const merge = Array.isArray(parsed?.merge) ? parsed.merge.filter((p: any) => Array.isArray(p) && p.length === 2) : [];
    const split = Array.isArray(parsed?.split)
      ? parsed.split.filter((s: any) => s && Number.isFinite(Number(s.shot)) && Number.isFinite(Number(s.at)))
        .map((s: any) => ({ shot: Number(s.shot), at: Number(s.at) }))
      : [];
    return { ok: true, merge, split };
  } catch (err: any) {
    const aborted = err?.name === 'AbortError';
    return { ok: false, reason: aborted ? 'timeout' : 'verify_failed', message: String(err?.message || err).slice(0, 300) };
  }
});

// Cuts — the mind WATCHES the ad. A compact copy of the video (low res/fps) is
// sent to a video-capable model (Gemini) together with the exact shot
// boundaries, and it groups shots by COMPREHENSION — tracking each person/story
// across the continuous footage. This is grouping by understanding, not by
// frame similarity: the model actually sees the ad move.
ipcMain.handle('hjen:cuts-watch', async (_e: any, args: {
  sessionId: string; projectSlug?: string; videoPath: string; model?: string;
  shots: Array<{ i: number; start: number; end: number; frame?: string }>;
}) => {
  const { key } = providerAuth('google');
  if (!key) return { ok: false, reason: 'no_key', message: 'No Google API key set (Settings).' };
  const bin = resolveFfmpeg();
  if (!bin) return { ok: false, reason: 'no_ffmpeg', message: 'ffmpeg not found.' };
  if (!args.videoPath || !fs.existsSync(args.videoPath)) return { ok: false, reason: 'no_video', message: 'Video not found.' };
  const model = args.model || 'gemini-flash-latest';   // video-capable, watches the ad end-to-end
  const dir = cutsSessionDir(args.projectSlug, args.sessionId);
  const small = path.join(dir, 'watch.mp4');

  // Transcode to a small clip; shrink further once if it's over the inline cap.
  const transcode = async (scale: number, fps: number, crf: number) => {
    await cutsRun(bin, ['-y', '-i', args.videoPath, '-an', '-vf',
      `scale='min(${scale},iw)':-2,fps=${fps}`, '-c:v', 'libx264', '-crf', String(crf),
      '-preset', 'veryfast', '-movflags', '+faststart', small], 300_000);
  };
  try {
    await transcode(480, 3, 30);
    let bytes = fs.existsSync(small) ? fs.statSync(small).size : 0;
    if (bytes > 18 * 1024 * 1024) await transcode(384, 2, 32);
    bytes = fs.existsSync(small) ? fs.statSync(small).size : 0;
    if (!bytes) return { ok: false, reason: 'transcode_failed', message: 'Could not prepare the video.' };
    if (bytes > 20 * 1024 * 1024) return { ok: false, reason: 'too_large', message: 'Ad too large to send inline.' };
    const b64 = fs.readFileSync(small).toString('base64');

    // Hybrid input: the VIDEO (continuity) + a numbered REFERENCE STILL per shot.
    // The stills remove the timecode-alignment ambiguity — the model reads each
    // shot's actual frame instead of guessing which timecode is which shot,
    // which is what caused wrong merges (a football shot landing in a soccer
    // group). The video lets it track a person across close-up ↔ wide.
    const N = args.shots.length;
    const system = `You are a film editor. You are given (1) the FULL ad video for continuity, and (2) one numbered REFERENCE STILL per shot. The stills tell you EXACTLY what each numbered shot shows — never guess a shot from its timecode; read its still. Divide the ad into SCENES: a scene is one physical PLACE and its people (identified by CLOTHING — colours, kit, number). A close-up of a person and the wide of the place where that same clothing appears are ONE scene. NEVER group two shots by shared colour, lighting, mood, or a merely similar sport — only by the SAME physical place AND the SAME people.`;
    const parts: any[] = [
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
    let data: any;
    try {
      const res = await providerFetch('google', url, { 'content-type': 'application/json' }, body, ac.signal);
      if (!res.ok) { const t = await res.text(); return { ok: false, reason: 'api_error', message: `google ${res.status}: ${t.slice(0, 400)}` }; }
      data = await res.json();
    } finally { clearTimeout(timer); }

    const cand = data?.candidates?.[0];
    const finish = cand?.finishReason;
    const text = Array.isArray(cand?.content?.parts) ? cand.content.parts.map((p: any) => p.text ?? '').join('\n').trim() : '';
    if (!text) return { ok: false, reason: 'empty', message: `Model returned no text${finish ? ` (finish: ${finish})` : ''}.` };
    let parsed: any;
    try {
      let t = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
      const a = t.indexOf('{'), b = t.lastIndexOf('}');
      if (a >= 0 && b > a) t = t.slice(a, b + 1);
      parsed = JSON.parse(t);
    } catch {
      const hint = finish === 'MAX_TOKENS' ? ' (response was truncated)' : '';
      return { ok: false, reason: 'parse', message: `Could not parse model JSON${hint}: ${text.slice(0, 160)}` };
    }
    const groups = Array.isArray(parsed?.groups) ? parsed.groups : [];
    return { ok: true, groups };
  } catch (err: any) {
    const aborted = err?.name === 'AbortError';
    return { ok: false, reason: aborted ? 'timeout' : 'watch_failed', message: String(err?.message || err).slice(0, 300) };
  }
});

// Cuts — PEOPLE layer. The mind watches the ad (continuity) + reads a numbered
// still per shot, then identifies the MAIN recurring characters and, for each,
// lists every shot they appear in with a description, build, expression and
// wardrobe. This is casting/continuity comprehension — a person is the SAME
// across shots by face + body + clothing, even across different places.
ipcMain.handle('hjen:cuts-people', async (_e: any, args: {
  sessionId: string; projectSlug?: string; videoPath: string; model?: string;
  shots: Array<{ i: number; start: number; end: number; frame?: string }>;
}) => {
  const { key } = providerAuth('google');
  if (!key) return { ok: false, reason: 'no_key', message: 'No Google API key set (Settings).' };
  const bin = resolveFfmpeg();
  if (!bin) return { ok: false, reason: 'no_ffmpeg', message: 'ffmpeg not found.' };
  if (!args.videoPath || !fs.existsSync(args.videoPath)) return { ok: false, reason: 'no_video', message: 'Video not found.' };
  const model = args.model || 'gemini-flash-latest';
  const dir = cutsSessionDir(args.projectSlug, args.sessionId);
  const small = path.join(dir, 'people.mp4');

  const transcode = async (scale: number, fps: number, crf: number) => {
    await cutsRun(bin, ['-y', '-i', args.videoPath, '-an', '-vf',
      `scale='min(${scale},iw)':-2,fps=${fps}`, '-c:v', 'libx264', '-crf', String(crf),
      '-preset', 'veryfast', '-movflags', '+faststart', small], 300_000);
  };
  try {
    await transcode(480, 3, 30);
    let bytes = fs.existsSync(small) ? fs.statSync(small).size : 0;
    if (bytes > 18 * 1024 * 1024) await transcode(384, 2, 32);
    bytes = fs.existsSync(small) ? fs.statSync(small).size : 0;
    if (!bytes) return { ok: false, reason: 'transcode_failed', message: 'Could not prepare the video.' };
    if (bytes > 20 * 1024 * 1024) return { ok: false, reason: 'too_large', message: 'Ad too large to send inline.' };
    const b64 = fs.readFileSync(small).toString('base64');

    const N = args.shots.length;
    const system = `You are a casting director and continuity supervisor. You are given (1) the FULL ad video for continuity, and (2) one numbered REFERENCE STILL per shot — the stills tell you EXACTLY what each numbered shot shows; never guess a shot from its timecode, read its still. Your job: identify EVERY distinct character in the ad. Be EXHAUSTIVE: sweep every shot and account for each identifiable person, whether they recur across many shots or appear in just ONE. A character is the SAME person across shots by FACE + BODY + CLOTHING continuity, even when the place changes, the framing changes (wide ↔ close-up), or they return later. The same person can appear in many shots; one shot can contain more than one character. Only skip anonymous background fill (a blurred face deep in a passing crowd) and shots with no person at all (product, scenery, text).`;
    const parts: any[] = [
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
    let data: any;
    try {
      const res = await providerFetch('google', url, { 'content-type': 'application/json' }, body, ac.signal);
      if (!res.ok) { const t = await res.text(); return { ok: false, reason: 'api_error', message: `google ${res.status}: ${t.slice(0, 400)}` }; }
      data = await res.json();
    } finally { clearTimeout(timer); }

    const cand = data?.candidates?.[0];
    const finish = cand?.finishReason;
    const text = Array.isArray(cand?.content?.parts) ? cand.content.parts.map((p: any) => p.text ?? '').join('\n').trim() : '';
    if (!text) return { ok: false, reason: 'empty', message: `Model returned no text${finish ? ` (finish: ${finish})` : ''}.` };
    let parsed: any;
    try {
      let t = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
      const a = t.indexOf('{'), b = t.lastIndexOf('}');
      if (a >= 0 && b > a) t = t.slice(a, b + 1);
      parsed = JSON.parse(t);
    } catch {
      const hint = finish === 'MAX_TOKENS' ? ' (response was truncated)' : '';
      return { ok: false, reason: 'parse', message: `Could not parse model JSON${hint}: ${text.slice(0, 160)}` };
    }
    const people = Array.isArray(parsed?.people) ? parsed.people : [];
    return { ok: true, people };
  } catch (err: any) {
    const aborted = err?.name === 'AbortError';
    return { ok: false, reason: aborted ? 'timeout' : 'people_failed', message: String(err?.message || err).slice(0, 300) };
  }
});

// Cuts — VERIFY GROUPS (QA layer). Re-examines each finished group by looking at
// its member shots' frames TOGETHER and flags any shot that does not belong. It
// re-extracts a FRESH, frame-accurate mid-shot still per member (never trusting
// the possibly-bled stored thumb), so it is reliable even on old sessions — and
// returns those frames so the UI shows exactly what the mind judged.
ipcMain.handle('hjen:cuts-verify-groups', async (_e: any, args: {
  sessionId: string; projectSlug?: string; videoPath: string; model?: string;
  kind: 'scene' | 'person';
  groups: Array<{ id: string; label: string; shots: Array<{ i: number; start: number; end: number }> }>;
}) => {
  const { key } = providerAuth('google');
  if (!key) return { ok: false, reason: 'no_key', message: 'No Google API key set (Settings).' };
  const bin = resolveFfmpeg();
  if (!bin) return { ok: false, reason: 'no_ffmpeg', message: 'ffmpeg not found.' };
  if (!args.videoPath || !fs.existsSync(args.videoPath)) return { ok: false, reason: 'no_video', message: 'Video not found.' };
  const model = args.model || 'gemini-flash-latest';
  const dir = cutsSessionDir(args.projectSlug, args.sessionId);
  const vdir = path.join(dir, 'verify');
  fs.mkdirSync(vdir, { recursive: true });
  const groups = (args.groups || []).filter(g => g.shots && g.shots.length >= 2);   // singletons are trivially coherent
  if (!groups.length) return { ok: true, groups: [], frames: [] };

  try {
    // Re-extract up to THREE accurate frames per UNIQUE shot (30/50/70% inset
    // from the cut edges), so one bad/cropped/transition frame can't mislead the
    // judgement — verify sends no video, so multiple stills is its only depth.
    // Cache across groups; the MIDDLE frame is the one returned for display.
    const framesByShot = new Map<number, string[]>();   // shot → [f30, f50, f70]
    const grab = async (sh: { i: number; start: number; end: number }) => {
      if (framesByShot.has(sh.i)) return framesByShot.get(sh.i)!;
      const span = Math.max(0.05, sh.end - sh.start);
      const fracs = span < 0.6 ? [0.5] : [0.3, 0.5, 0.7];   // ultra-short shots → one frame
      const out: string[] = [];
      for (let k = 0; k < fracs.length; k++) {
        const t = Math.max(0, sh.start + span * fracs[k]);
        const fp = path.join(vdir, `v${String(sh.i).padStart(3, '0')}_${k}.jpg`);
        await cutsGrabFrame(bin, args.videoPath, t, "scale='min(448,iw)':-2", fp);
        if (fs.existsSync(fp)) out.push(fp);
      }
      framesByShot.set(sh.i, out);
      return out;
    };
    for (const g of groups) for (const sh of g.shots) await grab(sh);

    const system = args.kind === 'person'
      ? `You are an identity/continuity checker. Each GROUP claims to be ONE single character. Each member shot is shown as UP TO THREE stills sampled across its duration — judge the shot by ALL its frames together, never by a single frame that might be a cropped, blurred, or transition moment. Decide whether every shot shows the SAME person (same face, body, hair — clothing may change). Flag any shot whose person is clearly DIFFERENT from the group's majority. Read the frames literally; do not assume a shot belongs just because it is numbered into the group.`
      : `You are a scene/continuity checker. Each GROUP claims to be ONE physical place with the SAME people. Each member shot is shown as UP TO THREE stills sampled across its duration — judge the shot by ALL its frames together, never by a single frame that might be a cropped, blurred, or transition moment. Decide whether every shot is the same location and the same people. Flag any shot that is a DIFFERENT place, or clearly different people. Read the frames literally; do not assume a shot belongs just because it is numbered into the group.`;
    const parts: any[] = [{ text: system }];
    for (const g of groups) {
      parts.push({ text: `\nGROUP ${g.id} «${g.label}» — member shots:` });
      for (const sh of g.shots) {
        const fps = framesByShot.get(sh.i) || [];
        parts.push({ text: `shot ${sh.i} (${fps.length} frame${fps.length > 1 ? 's' : ''}):` });
        for (const fp of fps) if (fs.existsSync(fp)) parts.push({ inline_data: { mime_type: 'image/jpeg', data: fs.readFileSync(fp).toString('base64') } });
      }
    }
    parts.push({ text: `\nFor EACH group return whether it is coherent and list any shots that do not belong, with a confidence 0..1 and a short reason. Return STRICT JSON only:\n{"groups":[{"id":"<group id>","coherent":true|false,"outliers":[{"shot":<n>,"confidence":<0..1>,"reason":"<why it does not belong>"}]}]}\nA group with no outliers is coherent:true, outliers:[].` });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${key}`;
    const body = { contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: 32000, temperature: 0.1, responseMimeType: 'application/json' } };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 300_000);
    let data: any;
    try {
      const res = await providerFetch('google', url, { 'content-type': 'application/json' }, body, ac.signal);
      if (!res.ok) { const t = await res.text(); return { ok: false, reason: 'api_error', message: `google ${res.status}: ${t.slice(0, 400)}` }; }
      data = await res.json();
    } finally { clearTimeout(timer); }

    const cand = data?.candidates?.[0];
    const finish = cand?.finishReason;
    const text = Array.isArray(cand?.content?.parts) ? cand.content.parts.map((p: any) => p.text ?? '').join('\n').trim() : '';
    if (!text) return { ok: false, reason: 'empty', message: `Model returned no text${finish ? ` (finish: ${finish})` : ''}.` };
    let parsed: any;
    try {
      let t = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
      const a = t.indexOf('{'), b = t.lastIndexOf('}');
      if (a >= 0 && b > a) t = t.slice(a, b + 1);
      parsed = JSON.parse(t);
    } catch {
      const hint = finish === 'MAX_TOKENS' ? ' (response was truncated)' : '';
      return { ok: false, reason: 'parse', message: `Could not parse model JSON${hint}: ${text.slice(0, 160)}` };
    }
    const outGroups = Array.isArray(parsed?.groups) ? parsed.groups : [];
    // Return the MIDDLE frame per shot for the UI (representative still).
    const frames = [...framesByShot.entries()]
      .map(([shot, fps]) => ({ shot, path: fps[Math.floor(fps.length / 2)] || fps[0] || '' }))
      .filter(f => f.path);
    return { ok: true, groups: outGroups, frames };
  } catch (err: any) {
    const aborted = err?.name === 'AbortError';
    return { ok: false, reason: aborted ? 'timeout' : 'verify_failed', message: String(err?.message || err).slice(0, 300) };
  }
});

// Cuts — Phase 0 · read the ad's shared LOOK (DNA). One video pass returns the
// campaign's cinematographic fingerprint, injected into every master prompt.
ipcMain.handle('hjen:cuts-dna', async (_e: any, args: { sessionId: string; projectSlug?: string; videoPath: string; model?: string }) => {
  const { key } = providerAuth('google');
  if (!key) return { ok: false, reason: 'no_key', message: 'No Google API key set (Settings).' };
  const bin = resolveFfmpeg();
  if (!bin) return { ok: false, reason: 'no_ffmpeg', message: 'ffmpeg not found.' };
  if (!args.videoPath || !fs.existsSync(args.videoPath)) return { ok: false, reason: 'no_video', message: 'Video not found.' };
  const model = args.model || 'gemini-flash-latest';
  const dir = cutsSessionDir(args.projectSlug, args.sessionId);
  const small = path.join(dir, 'watch.mp4');
  try {
    if (!fs.existsSync(small)) {
      await cutsRun(bin, ['-y', '-i', args.videoPath, '-an', '-vf', "scale='min(480,iw)':-2,fps=3",
        '-c:v', 'libx264', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', small], 300_000);
    }
    if (!fs.existsSync(small)) return { ok: false, reason: 'transcode_failed', message: 'Could not prepare the video.' };
    const b64 = fs.readFileSync(small).toString('base64');
    const system = `You are a master cinematographer and colorist reverse-reading a finished advertisement to recover its exact VISUAL LOOK — so it can be reproduced from words alone, with NO reference images. Watch the whole ad. Read the optics, the grade, the light logic, the texture. Be concrete and technical (name focal-length character, film stock or digital grade, color temperature bias, contrast curve, grain). This DNA will be pasted at the top of every single shot's generation prompt, so it must be precise and self-consistent.`;
    const parts: any[] = [
      { text: system },
      { inline_data: { mime_type: 'video/mp4', data: b64 } },
      { text: `Return STRICT JSON only:\n{"intent":"<one line: what this ad is doing emotionally>","look":"<2-3 sentence prose look block a DP could light from>","palette":"<dominant tones + accent placement>","film":"<stock/grade/texture, e.g. Kodak 500T look, halation, filmic highlight rolloff>","lighting":"<light logic: quality, direction, contrast>","lens":"<lens & optics language: focal lengths, depth, distortion, bokeh>","era":"<period the look evokes>","mood":"<emotional register>","grain":"<grain/texture/noise character>","aspect":"<aspect ratio + framing habit>"}` },
    ];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${key}`;
    const body = { contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: 8000, temperature: 0.2, responseMimeType: 'application/json' } };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 300_000);
    let data: any;
    try {
      const res = await providerFetch('google', url, { 'content-type': 'application/json' }, body, ac.signal);
      if (!res.ok) { const t = await res.text(); return { ok: false, reason: 'api_error', message: `google ${res.status}: ${t.slice(0, 300)}` }; }
      data = await res.json();
    } finally { clearTimeout(timer); }
    const cand = data?.candidates?.[0];
    const text = Array.isArray(cand?.content?.parts) ? cand.content.parts.map((p: any) => p.text ?? '').join('\n').trim() : '';
    if (!text) return { ok: false, reason: 'empty', message: 'Model returned no text.' };
    let dna: any;
    try { let t = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim(); const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a >= 0 && b > a) t = t.slice(a, b + 1); dna = JSON.parse(t); }
    catch { return { ok: false, reason: 'parse', message: `Could not parse JSON: ${text.slice(0, 140)}` }; }
    return { ok: true, dna };
  } catch (err: any) {
    const aborted = err?.name === 'AbortError';
    return { ok: false, reason: aborted ? 'timeout' : 'dna_failed', message: String(err?.message || err).slice(0, 300) };
  }
});

// Cuts — COMPREHEND the whole ad (the wide eye on the world). One video pass
// returns the narrative, the assembled environment, the cross-shot continuity,
// and a per-shot context note — knowledge later injected into every master
// prompt (and available to future cut/group stages).
ipcMain.handle('hjen:cuts-story', async (_e: any, args: {
  sessionId: string; projectSlug?: string; videoPath: string; model?: string;
  shots: Array<{ i: number; start: number; end: number }>;
}) => {
  const { key } = providerAuth('google');
  if (!key) return { ok: false, reason: 'no_key', message: 'No Google API key set (Settings).' };
  const bin = resolveFfmpeg();
  if (!bin) return { ok: false, reason: 'no_ffmpeg', message: 'ffmpeg not found.' };
  if (!args.videoPath || !fs.existsSync(args.videoPath)) return { ok: false, reason: 'no_video', message: 'Video not found.' };
  const model = args.model || 'gemini-flash-latest';
  const dir = cutsSessionDir(args.projectSlug, args.sessionId);
  const small = path.join(dir, 'watch.mp4');
  try {
    if (!fs.existsSync(small)) {
      await cutsRun(bin, ['-y', '-i', args.videoPath, '-an', '-vf', "scale='min(480,iw)':-2,fps=3",
        '-c:v', 'libx264', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', small], 300_000);
    }
    if (!fs.existsSync(small)) return { ok: false, reason: 'transcode_failed', message: 'Could not prepare the video.' };
    const b64 = fs.readFileSync(small).toString('base64');
    const shotList = (args.shots || []).map(s => `Shot ${s.i}: ${s.start.toFixed(2)}–${s.end.toFixed(2)}s`).join('\n');
    const system = `You are the comprehension mind of a film-analysis system. You WATCH a whole advertisement end to end and build a complete understanding of its WORLD before anything is described in isolation: the narrative and events beat by beat; the full physical environment assembled from EVERY shot (a later shot often reveals the surroundings an earlier close shot could not); and the CONTINUITY that carries between shots — a subject's orientation, facing, direction of travel, and state established by an adjacent shot that a single shot's frames cannot show alone. Reason across the whole timeline, then report.`;
    const parts: any[] = [
      { text: system },
      { inline_data: { mime_type: 'video/mp4', data: b64 } },
      { text: `The detected shots (by time):\n${shotList}\n\nReturn STRICT JSON only:\n{"synopsis":"<the ad's story/events, beat by beat>","world":"<the full place/environment assembled from ALL shots — geography, architecture, what surrounds the action even when a given shot only shows part of it>","continuity":"<cross-shot facts: who is who, spatial layout, and each subject's ORIENTATION and FACE DIRECTION (facing up / down / toward camera) and direction of travel and state as they carry between shots. Be explicit about facing — e.g. a backward fall means the face/front is toward the sky/camera while the back leads downward. ALSO give the SPATIAL TRAJECTORY with physical logic: where the subject is relative to key landmarks at each stage (e.g. just launched from the platform → still CLOSE to it; mid-fall → farther; entry → at the water). A subject cannot be floating far from the point it just left.>","shots":[{"i":<shot number>,"context":"<this shot's role in the sequence + the facts an adjacent shot establishes about it (e.g. the subject's facing/direction was set up by the previous shot; the surroundings are the ones revealed in another shot)>"}]}\nInclude every shot number in "shots".` },
    ];

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${key}`;
    const body = { contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: 32000, temperature: 0.2, responseMimeType: 'application/json' } };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 300_000);
    let data: any;
    try {
      const res = await providerFetch('google', url, { 'content-type': 'application/json' }, body, ac.signal);
      if (!res.ok) { const t = await res.text(); return { ok: false, reason: 'api_error', message: `google ${res.status}: ${t.slice(0, 300)}` }; }
      data = await res.json();
    } finally { clearTimeout(timer); }
    const cand = data?.candidates?.[0];
    const finish = cand?.finishReason;
    const text = Array.isArray(cand?.content?.parts) ? cand.content.parts.map((p: any) => p.text ?? '').join('\n').trim() : '';
    if (!text) return { ok: false, reason: 'empty', message: `Model returned no text${finish ? ` (finish: ${finish})` : ''}.` };
    let parsed: any;
    try { let t = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim(); const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a >= 0 && b > a) t = t.slice(a, b + 1); parsed = JSON.parse(t); }
    catch { const hint = finish === 'MAX_TOKENS' ? ' (response was truncated)' : ''; return { ok: false, reason: 'parse', message: `Could not parse JSON${hint}: ${text.slice(0, 140)}` }; }
    return { ok: true, synopsis: parsed?.synopsis || '', world: parsed?.world || '', continuity: parsed?.continuity || '', shots: Array.isArray(parsed?.shots) ? parsed.shots : [] };
  } catch (err: any) {
    const aborted = err?.name === 'AbortError';
    return { ok: false, reason: aborted ? 'timeout' : 'story_failed', message: String(err?.message || err).slice(0, 300) };
  }
});

// Cuts — Phase 2/3 · deep description + MASTER PROMPT for one shot. Uses THREE
// accurate frames of the shot + the ad DNA + the entity canon (so wardrobe /
// appearance stay consistent across shots). NO reference images are used — the
// prompt must carry everything in words. Faithful to the source, top-tier craft.
ipcMain.handle('hjen:cuts-brief', async (_e: any, args: {
  sessionId: string; projectSlug?: string; videoPath: string; model?: string;
  shot: { i: number; start: number; end: number }; keyframe?: string; dna: any;
  story?: any; context?: string; neighbours?: string; canon?: string;
}) => {
  const { key } = providerAuth('google');
  if (!key) return { ok: false, reason: 'no_key', message: 'No Google API key set (Settings).' };
  const bin = resolveFfmpeg();
  if (!bin) return { ok: false, reason: 'no_ffmpeg', message: 'ffmpeg not found.' };
  if (!args.videoPath || !fs.existsSync(args.videoPath)) return { ok: false, reason: 'no_video', message: 'Video not found.' };
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
    const frames: string[] = [];
    for (let k = 0; k < fracs.length; k++) {
      const t = Math.max(0, sh.start + span * fracs[k]);
      const fp = path.join(bdir, `b${String(sh.i).padStart(3, '0')}_${k}.jpg`);
      await cutsGrabFrame(bin, args.videoPath, t, "scale='min(768,iw)':-2", fp);
      if (fs.existsSync(fp)) frames.push(fp);
    }
    if (!frames.length) return { ok: false, reason: 'no_frames', message: 'Could not extract frames.' };

    // The single frame the MASTER PROMPT must reproduce. Prefer the chosen
    // keyframe; else the middle sampled frame. The other frames are CONTEXT only.
    let repPath = '';
    if (args.keyframe && fs.existsSync(args.keyframe)) repPath = args.keyframe;
    else repPath = frames[Math.floor(frames.length / 2)];

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
    const parts: any[] = [
      { text: system },
      { text: `Shot ${sh.i}. CONTEXT frames (for reading light/geometry only — do NOT describe these as a sequence):` },
    ];
    for (const fp of frames) parts.push({ inline_data: { mime_type: 'image/jpeg', data: fs.readFileSync(fp).toString('base64') } });
    parts.push({ text: `REPRESENTATIVE FRAME — describe and write the master prompt for THIS still only:` });
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: fs.readFileSync(repPath).toString('base64') } });
    parts.push({ text: `${storyBlock}${storyBlock ? '\n' : ''}${dnaBlock}\n\n${canonBlock}\n\nReturn STRICT JSON only (all describing the REPRESENTATIVE still):\n{"subject":"<the subject frozen in this still with LIMB-PRECISE pose: exact position of each arm and hand (overhead/at sides/reaching, leading or trailing), head direction, legs, body line and orientation; micro-expression; and the FACE/BODY ORIENTATION derived from the AD COMPREHENSION (facing up / down / toward camera; which side leads the movement) — this orientation follows the comprehension's action, not a possibly-misread single frame>","wardrobe":"<every garment piece-by-piece: type + material + colour + condition; use catalogued traits for known entities>","blocking":"<SCALE: how big the subject is (approx fraction of frame height) + amount of negative space + WHERE in the frame it sits; DIRECTION the subject points/travels (head/motion vector, state left/right explicitly) + its position RELATIVE TO named set landmarks with PHYSICAL PROXIMITY (near / just below / far — grounded in the action stage, e.g. still close to the platform it just left); distance to lens, angle to camera; which part of the subject is framed + where the frame crops it>","light":"<every source: key/fill/rim/practical/ambient — direction, quality, colour temperature; and exactly HOW light falls across the subject (highlights, shadows, rim) + reflections>","camera":{"shotSize":"<ECU/CU/MCU/MS/MLS/WS/EWS>","lens":"<focal length + optical character>","angle":"<PERPENDICULAR (straight-on / true top-down, scene reads flat) OR RAKED (high/low oblique, ground recedes) — say which, with the precise angle>","height":"<camera height vs subject>","movement":"<static/pan/tilt/dolly/track/handheld/crane; note if the still shows motion blur>","dof":"<depth of field + where focus sits>"},"colour":"<the ACTUAL palette (describe true colours even if muted — never idealise to vivid): grade colour-temperature bias (warm/cool/neutral), SATURATION level (desaturated/muted vs vivid), CONTRAST (low/normal/high), and ATMOSPHERE (haze/mist/diffusion/air); skin, wardrobe, environment colours>","frameFurniture":"<foreground / mid-ground / background plates, concrete objects>","time":"<time of day, light state, weather, operational state>","mood":"<emotional register>","inside":"<one sentence: what is happening inside the subject in this still>","prompt":"<the MASTER PROMPT: one dense paragraph that reproduces THIS still — lead with the exact camera geometry (perpendicular vs raked) + shot size + SUBJECT SCALE-IN-FRAME and negative space + the DIRECTION the subject points/travels (state left/right) and its placement relative to set landmarks WITH physical proximity (e.g. close to the platform it just left, not floating far in empty space) + crop, then the limb-precise pose, wardrobe, the light on the subject, and the full palette with SATURATION + CONTRAST + ATMOSPHERE and the grade's colour temperature baked in (true muted colours, not idealised), and the AD LOOK. Include the body-line's actual angle in degrees from horizontal, and match it faithfully (neither flattened nor exaggerated to vertical). If the pose is a specific tight athletic form a model would render as a generic 'graceful' version, END the prompt with ONE short negative clause ruling out the WRONG direction of drift (e.g. for a shallow line: 'a shallow ~30° diagonal, not a vertical plunge'; for a tight form: 'limbs tight to the body, not spread'). A single top-tier text-to-image prompt, no reference image. Do NOT mention any aspect ratio>"}` });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${key}`;
    const body = { contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: 8000, temperature: 0.3, responseMimeType: 'application/json' } };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 180_000);
    let data: any;
    try {
      const res = await providerFetch('google', url, { 'content-type': 'application/json' }, body, ac.signal);
      if (!res.ok) { const t = await res.text(); return { ok: false, reason: 'api_error', message: `google ${res.status}: ${t.slice(0, 300)}` }; }
      data = await res.json();
    } finally { clearTimeout(timer); }
    const cand = data?.candidates?.[0];
    const text = Array.isArray(cand?.content?.parts) ? cand.content.parts.map((p: any) => p.text ?? '').join('\n').trim() : '';
    if (!text) return { ok: false, reason: 'empty', message: 'Model returned no text.' };
    let brief: any;
    try { let t = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim(); const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a >= 0 && b > a) t = t.slice(a, b + 1); brief = JSON.parse(t); }
    catch { return { ok: false, reason: 'parse', message: `Could not parse JSON: ${text.slice(0, 140)}` }; }
    return { ok: true, brief };
  } catch (err: any) {
    const aborted = err?.name === 'AbortError';
    return { ok: false, reason: aborted ? 'timeout' : 'brief_failed', message: String(err?.message || err).slice(0, 300) };
  }
});

// Cuts sessions — persist/reopen a cut session (shots + scenes + keyframes +
// manual edits). Stored as session.json beside its frames under Cuts/<id>/.
ipcMain.handle('hjen:cuts-save', (_e: any, args: { projectSlug?: string; sessionId: string; data: any }) => {
  try {
    const dir = cutsSessionDir(args.projectSlug, args.sessionId);
    fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ ...args.data, savedAt: Date.now() }, null, 2));
    return { ok: true };
  } catch (err: any) { return { ok: false, message: err?.message || String(err) }; }
});

ipcMain.handle('hjen:cuts-list', (_e: any, _args: { projectSlug?: string }) => {
  // Cuts Engine is a global internal tool — list EVERY session across all
  // project buckets (+ _unassigned) so nothing "disappears" when the active
  // project changes. Each session carries its own projectSlug for loading.
  try {
    const rootPath = projectsRootPath();
    const nameBySlug = new Map<string, string>();
    try { for (const p of readProjects()) if (p.slug) nameBySlug.set(p.slug, p.name || p.slug); } catch {}
    let buckets: string[] = [];
    try { buckets = (fs.readdirSync(rootPath) as string[]).filter(b => {
      try { return fs.statSync(path.join(rootPath, b, 'Cuts')).isDirectory(); } catch { return false; }
    }); } catch {}
    const sessions: any[] = [];
    for (const bucket of buckets) {
      const cutsDir = path.join(rootPath, bucket, 'Cuts');
      const projectSlug = bucket === '_unassigned' ? undefined : bucket;
      const projectName = bucket === '_unassigned' ? 'Unassigned' : (nameBySlug.get(bucket) || bucket);
      for (const name of (fs.readdirSync(cutsDir) as string[])) {
        if (name.startsWith('_')) continue; // skip _fetch and other scratch
        const f = path.join(cutsDir, name, 'session.json');
        if (!fs.existsSync(f)) continue;
        try {
          const d = JSON.parse(fs.readFileSync(f, 'utf-8'));
          sessions.push({ sessionId: d.sessionId || name, title: d.title, videoPath: d.videoPath,
            duration: d.duration, shots: (d.shots || []).length, scenes: (d.scenes || []).length,
            savedAt: d.savedAt || 0, projectSlug, project: projectName });
        } catch { /* skip corrupt */ }
      }
    }
    sessions.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    return { ok: true, sessions };
  } catch (err: any) { return { ok: false, message: err?.message || String(err), sessions: [] }; }
});

ipcMain.handle('hjen:cuts-load', (_e: any, args: { projectSlug?: string; sessionId: string }) => {
  try {
    const dir = cutsSessionDir(args.projectSlug, args.sessionId);
    const f = path.join(dir, 'session.json');
    if (!fs.existsSync(f)) return { ok: false, reason: 'not_found', message: 'Session not found.' };
    return { ok: true, data: JSON.parse(fs.readFileSync(f, 'utf-8')) };
  } catch (err: any) { return { ok: false, message: err?.message || String(err) }; }
});

// Delete a Cuts session — removes its whole working folder (frames + json).
ipcMain.handle('hjen:cuts-delete', (_e: any, args: { projectSlug?: string; sessionId: string }) => {
  try {
    const dir = cutsSessionDir(args.projectSlug, args.sessionId);
    // Guard: only ever delete inside a project's Cuts/ area.
    if (!dir.includes(`${path.sep}Cuts${path.sep}`)) return { ok: false, message: 'Refusing to delete outside Cuts.' };
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    return { ok: true };
  } catch (err: any) { return { ok: false, message: err?.message || String(err) }; }
});

// Recover a fetched video's ORIGINAL source URL. Fetched clips live under
// Cuts/_fetch/<key>/ beside a yt-dlp *.info.json that carries webpage_url — so
// old sessions saved before sourceUrl existed can still resolve their YouTube link.
ipcMain.handle('hjen:cuts-source', (_e: any, args: { videoPath: string }) => {
  try {
    const p = args?.videoPath || '';
    if (!p || !p.includes(`${path.sep}_fetch${path.sep}`)) return { ok: true, url: '' };
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) return { ok: true, url: '' };
    const info = (fs.readdirSync(dir) as string[]).find(f => f.endsWith('.info.json'));
    if (!info) return { ok: true, url: '' };
    const j = JSON.parse(fs.readFileSync(path.join(dir, info), 'utf-8'));
    const url = j.webpage_url || j.original_url || j.url || '';
    return { ok: true, url: /^https?:\/\//i.test(url) ? url : '' };
  } catch (err: any) { return { ok: false, url: '', message: err?.message || String(err) }; }
});

// Does a source video actually CARRY an audio stream? A YouTube fetch can arrive
// video-only, or a made clip can be silent — either way the monitor would be
// silent through no UI fault. The renderer surfaces this on the SOURCE ♪ lane so
// "no sound" reads as "the source has no audio", not "audio is broken".
// ffmpeg -i prints stream info to stderr; an audio stream shows as "Stream …: Audio:".
ipcMain.handle('hjen:cuts-has-audio', async (_e: any, args: { videoPath: string }) => {
  try {
    const p = args?.videoPath || '';
    if (!p || !fs.existsSync(p)) return { ok: false, hasAudio: null, reason: 'no_file' };
    const r = await cutsRun(bdFfmpeg(), ['-hide_banner', '-i', p], 30_000);
    // ffmpeg exits non-zero with "-i" and no output, but always dumps the stream map.
    const hasAudio = /Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?: Audio:/.test(r.stderr);
    return { ok: true, hasAudio };
  } catch (err: any) { return { ok: false, hasAudio: null, message: err?.message || String(err) }; }
});

// Open an arbitrary http(s) URL in the default browser (e.g. a session's source
// YouTube link), or reveal a local file when given a path.
ipcMain.handle('hjen:open-external-url', async (_e: any, url: string) => {
  try {
    if (/^https?:\/\//i.test(url)) { await electron.shell.openExternal(url); return { ok: true }; }
    if (url && fs.existsSync(url)) { electron.shell.showItemInFolder(url); return { ok: true }; }
    return { ok: false, message: 'Nothing to open.' };
  } catch (err: any) { return { ok: false, message: err?.message || String(err) }; }
});

// Export the timeline as FCPXML (imports into DaVinci Resolve / Premiere / FCP).
ipcMain.handle('hjen:export-timeline-fcpxml', async (_e: any, args: { clips: ExportClip[]; width: number; height: number; fps: number; projectName?: string }) => {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const clips = (args.clips || []).filter(c => c.src).sort((a, b) => a.start - b.start);
  if (!clips.length) return { ok: false, reason: 'empty', message: 'No clips to export.' };
  const save = await dialog.showSaveDialog(win, {
    title: 'Export FCPXML', defaultPath: `${(args.projectName || 'sequence').replace(/[^\w-]+/g, '_')}.fcpxml`,
    filters: [{ name: 'Final Cut / Premiere XML', extensions: ['fcpxml'] }],
  });
  if (save.canceled || !save.filePath) return { ok: false, reason: 'cancelled' };

  const FPS = args.fps || 30;
  const rt = (sec: number) => `${Math.round(sec * FPS)}/${FPS}s`;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const total = clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
  const assets: string[] = []; const spine: string[] = [];
  clips.forEach((c, i) => {
    const id = `a${i + 1}`;
    const url = `file://${encodeURI(c.src!)}`;
    const isImg = c.kind === 'image';
    assets.push(`    <asset id="${id}" name="clip${i + 1}" src="${esc(url)}" start="0s" duration="${rt(c.duration)}" hasVideo="1" format="r1"${isImg ? '' : ' hasAudio="1"'}/>`);
    spine.push(`        <asset-clip ref="${id}" offset="${rt(c.start)}" name="clip${i + 1}" duration="${rt(c.duration)}"/>`);
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="r1" name="HJEN ${args.width}x${args.height}" frameDuration="1/${FPS}s" width="${args.width}" height="${args.height}"/>
${assets.join('\n')}
  </resources>
  <library>
    <event name="HJEN Studio">
      <project name="${esc(args.projectName || 'Sequence 1')}">
        <sequence format="r1" duration="${rt(total)}" tcStart="0s" tcFormat="NDF">
          <spine>
${spine.join('\n')}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
  try { fs.writeFileSync(save.filePath, xml); return { ok: true, path: save.filePath }; }
  catch (err: any) { return { ok: false, reason: 'write_failed', message: err?.message || String(err) }; }
});

// ═══ Sequence export · the References timeline ══════════════════════
// New channels, deliberately beside the old ones rather than replacing them:
// hjen:export-timeline-{mp4,fcpxml} above still serve TimelineDock, and a
// conformance problem in a new emitter must never break a working one.
//
// The graph and the XML are built by PURE modules (ffmpegGraph.ts, fcpxml.ts)
// so both can be run from plain node against real files — which is how the
// filter graph was verified before any of this UI existed.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildGraph, encodeArgs } = require('./ffmpegGraph');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildFcpxml } = require('./fcpxml');

interface SeqExportClip {
  kind: 'video' | 'image' | 'audio';
  src: string; start: number; dur: number; srcIn: number;
  gain: number; hasAudio: boolean; lane: number; label?: string;
}
interface SeqExportArgs {
  clips: SeqExportClip[];
  width: number; height: number; fps: number; total: number;
  projectName?: string;
}

/** One render at a time, per window. Keyed by webContents id so a detached
 *  panel and the studio can each hold their own. */
const renderJobs = new Map<number, { proc: any; out: string; cancelled: boolean }>();

ipcMain.handle('hjen:export-sequence-mp4', async (e: any, args: SeqExportArgs) => {
  const bin = resolveTool('ffmpeg');
  if (!bin) return { ok: false, reason: 'no_ffmpeg', message: describeMissing('ffmpeg') };

  const wcId = e.sender.id;
  if (renderJobs.has(wcId)) return { ok: false, reason: 'busy', message: 'A render is already running.' };

  const clips = (args.clips || []).filter(c => c.src && fs.existsSync(c.src));
  if (!clips.length) return { ok: false, reason: 'empty', message: 'Nothing on the timeline to render.' };

  const win = BrowserWindow.fromWebContents(e.sender) ?? BrowserWindow.getAllWindows()[0];
  const save = await dialog.showSaveDialog(win, {
    title: 'Export MP4',
    defaultPath: `${(args.projectName || 'sequence').replace(/[^\w-]+/g, '_')}_${args.width}x${args.height}.mp4`,
    filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
  });
  if (save.canceled || !save.filePath) return { ok: false, reason: 'cancelled' };

  const total = Math.max(0.1, args.total || clips.reduce((m, c) => Math.max(m, c.start + c.dur), 0));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hjen-seq-'));
  const scriptFile = path.join(tmp, 'graph.txt');

  try {
    const g = buildGraph(clips, { width: args.width, height: args.height, fps: args.fps, total });
    fs.writeFileSync(scriptFile, g.script);

    // -filter_complex_script, not -filter_complex: a forty-input graph is well
    // past any comfortable command-line length.
    const ffArgs = [
      '-y', '-hide_banner',
      ...g.inputArgs,
      '-filter_complex_script', scriptFile,
      ...encodeArgs(args.fps),
      '-progress', 'pipe:1', '-nostats',
      save.filePath,
    ];

    const code: number = await new Promise((resolve, reject) => {
      const proc = childProcess.spawn(bin, ffArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
      renderJobs.set(wcId, { proc, out: save.filePath!, cancelled: false });
      let err = '';
      let buf = '';
      // -progress only starts emitting after the FIRST frame, which on a big
      // graph can be several seconds — the renderer shows "Preparing…" until
      // the first out_time_us arrives.
      proc.stdout.on('data', (d: any) => {
        buf += String(d);
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          const m = /^out_time_us=(\d+)/.exec(line.trim());
          if (!m) continue;
          const secs = Number(m[1]) / 1e6;
          try { e.sender.send('hjen:export-progress', { pct: Math.max(0, Math.min(1, secs / total)), secs, total }); }
          catch { /* window gone */ }
        }
      });
      proc.stderr.on('data', (d: any) => { err += String(d); });
      proc.on('error', reject);
      proc.on('close', (c: number) => {
        if (renderJobs.get(wcId)?.cancelled) { reject(new Error('cancelled')); return; }
        if (c === 0) resolve(0);
        else reject(new Error(err.split('\n').filter(Boolean).slice(-6).join('\n') || `ffmpeg exit ${c}`));
      });
    });

    if (code === 0) return { ok: true, path: save.filePath, dropped: [] };
    return { ok: false, reason: 'ffmpeg_failed' };
  } catch (err: any) {
    const wasCancel = renderJobs.get(wcId)?.cancelled || /cancelled/i.test(String(err?.message));
    // Never leave a half-written file behind pretending to be a render.
    try { if (fs.existsSync(save.filePath)) fs.unlinkSync(save.filePath); } catch { /* ignore */ }
    return wasCancel
      ? { ok: false, reason: 'cancelled' }
      : { ok: false, reason: 'ffmpeg_failed', message: err?.message || String(err) };
  } finally {
    renderJobs.delete(wcId);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

ipcMain.handle('hjen:export-cancel', (e: any) => {
  const job = renderJobs.get(e.sender.id);
  if (!job) return { ok: false, reason: 'idle' };
  job.cancelled = true;
  try { job.proc.kill('SIGKILL'); } catch { /* already gone */ }
  return { ok: true };
});

ipcMain.handle('hjen:export-sequence-fcpxml', async (e: any, args: SeqExportArgs) => {
  const clips = (args.clips || []).filter(c => c.src);
  if (!clips.length) return { ok: false, reason: 'empty', message: 'Nothing on the timeline to export.' };
  const win = BrowserWindow.fromWebContents(e.sender) ?? BrowserWindow.getAllWindows()[0];
  const save = await dialog.showSaveDialog(win, {
    title: 'Export XML',
    defaultPath: `${(args.projectName || 'sequence').replace(/[^\w-]+/g, '_')}.fcpxml`,
    filters: [{ name: 'Final Cut / Resolve / Premiere XML', extensions: ['fcpxml'] }],
  });
  if (save.canceled || !save.filePath) return { ok: false, reason: 'cancelled' };
  try {
    const xml = buildFcpxml(clips, {
      width: args.width, height: args.height, fps: args.fps,
      total: args.total, projectName: args.projectName,
    });
    fs.writeFileSync(save.filePath, xml);
    return { ok: true, path: save.filePath };
  } catch (err: any) {
    return { ok: false, reason: 'write_failed', message: err?.message || String(err) };
  }
});

// List restore points for a project's storyboard, newest first.
ipcMain.handle('hjen:list-storyboard-backups', (_e: any, args: { id: string }) => {
  const arr = readProjects();
  const target = arr.find(p => p.id === args.id);
  if (!target) return { ok: false, backups: [] };
  const bdir = sbBackupDir(storyboardDataPath(target.slug));
  const out: any[] = [];
  for (const n of sbListBackupFiles(bdir).reverse()) {
    const full = path.join(bdir, n);
    try {
      const st = fs.statSync(full);
      const d = JSON.parse(fs.readFileSync(full, 'utf-8'));
      out.push({
        file: full, ts: st.mtimeMs,
        shots: SB_LEN(d?.shots), characters: SB_LEN(d?.characters),
        places: SB_LEN(d?.places), elements: SB_LEN(d?.elements),
        scriptChars: String(d?.scriptText || '').length,
      });
    } catch { /* skip unreadable */ }
  }
  return { ok: true, backups: out };
});

// Restore a chosen backup over the main file. The current state is snapshotted
// first, so a restore is itself undoable.
ipcMain.handle('hjen:restore-storyboard-backup', (_e: any, args: { id: string; file: string }) => {
  const arr = readProjects();
  const target = arr.find(p => p.id === args.id);
  if (!target) return { ok: false, reason: 'no_project' };
  const f = storyboardDataPath(target.slug);
  const bdir = sbBackupDir(f);
  const chosen = path.resolve(args.file || '');
  if (path.dirname(chosen) !== path.resolve(bdir)) return { ok: false, reason: 'bad_path' };
  if (!fs.existsSync(chosen)) return { ok: false, reason: 'not_found' };
  try {
    const data = JSON.parse(fs.readFileSync(chosen, 'utf-8'));
    // snapshot current before replacing, so the restore can be undone
    if (fs.existsSync(f)) {
      const curRaw = fs.readFileSync(f, 'utf-8');
      try { const cur = JSON.parse(curRaw); if (sbPopulated(cur)) sbWriteBackup(bdir, curRaw, cur); } catch { /* ignore */ }
    }
    atomicWriteFileSync(f, JSON.stringify(data, null, 2));
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, reason: 'restore_failed', message: String(err?.message || err).slice(0, 200) };
  }
});

// ─── global board looks (shared across ALL storyboard projects) ─────
// The user's custom board looks are a GLOBAL library, not per-project: a look
// added in one project shows up in every project. Stored once at the projects
// root, written atomically + backed up so the look library can't be lost.
function boardLooksPath(): string {
  return path.join(projectsRootPath(), '_board_looks.json');
}
ipcMain.handle('hjen:read-board-looks', () => {
  const f = boardLooksPath();
  if (fs.existsSync(f)) {
    try { const d = JSON.parse(fs.readFileSync(f, 'utf-8')); if (Array.isArray(d?.looks)) return { ok: true, looks: d.looks }; }
    catch { /* fall through to backup */ }
  }
  // auto-heal from newest backup
  const bdir = path.join(path.dirname(f), 'board_looks_backups');
  if (fs.existsSync(bdir)) {
    const files = fs.readdirSync(bdir).filter((n: string) => n.endsWith('.json')).sort().reverse();
    for (const n of files) {
      try { const d = JSON.parse(fs.readFileSync(path.join(bdir, n), 'utf-8')); if (Array.isArray(d?.looks)) return { ok: true, looks: d.looks }; }
      catch { /* try older */ }
    }
  }
  return { ok: true, looks: [] };
});
ipcMain.handle('hjen:write-board-looks', (_e: any, args: { looks: any[] }) => {
  const f = boardLooksPath();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  try {
    // back up the previous library before overwriting
    if (fs.existsSync(f)) {
      const prevRaw = fs.readFileSync(f, 'utf-8');
      const bdir = path.join(path.dirname(f), 'board_looks_backups');
      fs.mkdirSync(bdir, { recursive: true });
      const newest = fs.readdirSync(bdir).filter((n: string) => n.endsWith('.json')).sort().pop();
      const newestRaw = newest ? fs.readFileSync(path.join(bdir, newest), 'utf-8') : null;
      if (newestRaw !== prevRaw) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        atomicWriteFileSync(path.join(bdir, `looks_${stamp}.json`), prevRaw);
        const all = fs.readdirSync(bdir).filter((n: string) => n.endsWith('.json')).sort();
        for (const old of all.slice(0, Math.max(0, all.length - 30))) { try { fs.unlinkSync(path.join(bdir, old)); } catch { /* ignore */ } }
      }
    }
  } catch { /* best-effort backup */ }
  atomicWriteFileSync(f, JSON.stringify({ version: 1, looks: args.looks || [] }, null, 2));
  return { ok: true };
});

/** Generic structured-text Claude call. Unlike enhance-prompt (capped at 220
 *  tokens + photography system prompt), this takes a caller-supplied system
 *  prompt and a generous token budget so the renderer can ask for fenced JSON
 *  (the storyboard breakdown + cast/place extraction). Returns raw assistant
 *  text; the renderer parses it. */
ipcMain.handle('hjen:claude-json', async (_e: any, args: { system: string; prompt: string; maxTokens?: number; imagePath?: string; imagePaths?: string[] }) => {
  const apiKey = providerAuth('anthropic').key;
  if (!apiKey) {
    return { ok: false, reason: 'no_key', message: 'No Anthropic API key configured. Open Settings and add one.' };
  }
  const prompt = (args.prompt || '').trim();
  if (!prompt) {
    return { ok: false, reason: 'empty_prompt', message: 'Nothing to send.' };
  }
  // Optionally attach one or more images. `imagePaths` (multi) takes
  // precedence; `imagePath` (single) is kept for back-compat. Multiple
  // images let the model read ONE consolidated profile across several
  // photos of the same subject (Cast).
  const content: any[] = [];
  const imgs = (args.imagePaths && args.imagePaths.length) ? args.imagePaths : (args.imagePath ? [args.imagePath] : []);
  for (const p of imgs) {
    if (!p || !fs.existsSync(p)) continue;
    try {
      const imgBuf = fs.readFileSync(p);
      const ext = path.extname(p).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
      content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: imgBuf.toString('base64') } });
    } catch { /* skip this image */ }
  }
  content.push({ type: 'text', text: prompt });
  // Don't hang forever if the API stalls — abort after 500s.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 500_000);
  try {
    const res = await providerFetch('anthropic', ANTHROPIC_ENDPOINT, ANTHROPIC_HEADERS(apiKey), {
      model: ENHANCE_MODEL,
      max_tokens: Math.min(Math.max(args.maxTokens ?? 8192, 512), 32000),
      system: args.system || 'You are a precise assistant. Return only what is asked.',
      messages: [{ role: 'user', content }],
    }, ac.signal);
    if (!res.ok) {
      const errBody = await res.text();
      return { ok: false, reason: 'api_error', message: `Anthropic ${res.status}: ${errBody.slice(0, 400)}` };
    }
    const data: any = await res.json();
    const stopReason = data?.stop_reason;
    if (stopReason === 'max_tokens') {
      // Surface truncation so the renderer can still salvage + warn.
      const txt = Array.isArray(data?.content) ? data.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n') : '';
      return { ok: true, text: txt, truncated: true, usage: { inputTokens: data?.usage?.input_tokens ?? 0, outputTokens: data?.usage?.output_tokens ?? 0 }, usd: 0, model: ENHANCE_MODEL };
    }
    const text = Array.isArray(data?.content)
      ? data.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim()
      : '';
    if (!text) {
      return { ok: false, reason: 'empty_response', message: 'Claude returned an empty response.' };
    }
    const inputTokens = data?.usage?.input_tokens ?? 0;
    const outputTokens = data?.usage?.output_tokens ?? 0;
    const usd =
      (inputTokens / 1_000_000) * CLAUDE_PRICING.inputPerMTok +
      (outputTokens / 1_000_000) * CLAUDE_PRICING.outputPerMTok;
    appendEnhancementEvent({
      ts: Date.now(),
      model: ENHANCE_MODEL,
      inputTokens,
      outputTokens,
      usd,
      referencesCount: 0,
      rawPromptChars: prompt.length,
      enhancedPromptChars: text.length,
      rawPromptExcerpt: prompt.slice(0, 120),
      enhancedPromptExcerpt: text.slice(0, 120),
      projectId: null,
      projectSlug: null,
      projectName: 'storyboard',
    });
    return { ok: true, text, usage: { inputTokens, outputTokens }, usd, model: ENHANCE_MODEL };
  } catch (err: any) {
    const msg = err?.name === 'AbortError' ? 'Timed out after 500s — try again or shorten the script.' : String(err?.message || err).slice(0, 400);
    return { ok: false, reason: 'network', message: msg };
  } finally {
    clearTimeout(timer);
  }
});

ipcMain.handle('hjen:export-storyboard', (_e: any, args: {
  folder: string;
  pdfBase64: string;
  panels: Array<{ srcPath: string; fileName: string }>;
  fileName?: string;
}) => {
  try {
    if (!args.folder) return { ok: false, reason: 'no_folder' };
    // Sanitize the user's chosen base name; fall back to 'storyboard'.
    const base = (args.fileName || 'storyboard')
      .replace(/\.[a-z0-9]{1,5}$/i, '')                 // drop any extension the user typed
      .replace(/[\/\\:*?"<>|]+/g, '_')                  // strip path-illegal chars
      .replace(/\s+/g, ' ').trim().slice(0, 120) || 'storyboard';
    const panelsDir = path.join(args.folder, `${base}_panels`);
    fs.mkdirSync(panelsDir, { recursive: true });
    let written = 0;
    for (const p of args.panels || []) {
      try {
        if (p.srcPath && fs.existsSync(p.srcPath)) {
          fs.copyFileSync(p.srcPath, path.join(panelsDir, p.fileName));
          written++;
        }
      } catch { /* skip the bad one, keep going */ }
    }
    const pdfPath = path.join(args.folder, `${base}.pdf`);
    fs.writeFileSync(pdfPath, Buffer.from(args.pdfBase64, 'base64'));
    return { ok: true, written, pdfPath };
  } catch (err: any) {
    return { ok: false, reason: String(err?.message || err).slice(0, 200) };
  }
});

// References export — the reference set leaves the app. Frames are COPIED
// VERBATIM (a GIF stays a GIF, a PNG stays a PNG); the PDF and the notes sheet
// are written beside them. `subfolder` wraps everything in <base>/ — a lone PDF
// skips the wrapper and lands directly in the chosen folder.
ipcMain.handle('hjen:export-references', (_e: any, args: {
  folder: string;
  baseName?: string;
  subfolder?: boolean;
  files?: Array<{ srcPath: string; fileName: string }>;
  pdfBase64?: string | null;
  notesCsv?: string | null;
}) => {
  try {
    if (!args.folder) return { ok: false, reason: 'no_folder' };
    const base = (args.baseName || 'references')
      .replace(/\.[a-z0-9]{1,5}$/i, '')                 // drop any extension the user typed
      .replace(/[\/\\:*?"<>|]+/g, '_')                  // strip path-illegal chars
      .replace(/\s+/g, ' ').trim().slice(0, 120) || 'references';
    const dir = args.subfolder === false ? args.folder : path.join(args.folder, base);
    fs.mkdirSync(dir, { recursive: true });

    let written = 0, skipped = 0;
    const used = new Set<string>();
    for (const f of args.files || []) {
      try {
        if (!f.srcPath || !fs.existsSync(f.srcPath)) { skipped++; continue; }
        // never let two frames collide onto one name inside the export
        let name = String(f.fileName || 'frame').replace(/[\/\\:*?"<>|]+/g, '_');
        if (used.has(name)) {
          const dot = name.lastIndexOf('.');
          const stem = dot > 0 ? name.slice(0, dot) : name;
          const ext = dot > 0 ? name.slice(dot) : '';
          let n = 2;
          while (used.has(`${stem}_${n}${ext}`)) n++;
          name = `${stem}_${n}${ext}`;
        }
        used.add(name);
        fs.copyFileSync(f.srcPath, path.join(dir, name));
        written++;
      } catch { skipped++; }                            // skip the bad one, keep going
    }

    let pdfPath: string | undefined;
    if (args.pdfBase64) {
      pdfPath = path.join(dir, `${base}.pdf`);
      fs.writeFileSync(pdfPath, Buffer.from(args.pdfBase64, 'base64'));
    }
    if (args.notesCsv) fs.writeFileSync(path.join(dir, `${base}_notes.csv`), args.notesCsv, 'utf8');

    return { ok: true, dir, written, skipped, pdfPath };
  } catch (err: any) {
    return { ok: false, reason: String(err?.message || err).slice(0, 200) };
  }
});

// Resolve (and create) a per-tool folder INSIDE the project, so every tool's
// output lives with the project — e.g. <projectsRoot>/<slug>/Pitch/.
ipcMain.handle('hjen:project-tool-dir', (_e: any, args: { projectSlug?: string; tool: string }) => {
  try {
    const tool = (args.tool || 'Exports').replace(/[\/\\:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Exports';
    const root = args.projectSlug ? projectFolder(args.projectSlug) : path.join(projectsRootPath(), '_unassigned');
    const dir = path.join(root, tool);
    fs.mkdirSync(dir, { recursive: true });
    return { ok: true, dir };
  } catch (err: any) {
    return { ok: false, reason: String(err?.message || err).slice(0, 200) };
  }
});

// Generic single-file export — writes a base64 blob (HTML, PPTX, …) to a chosen
// folder. Used by the Pitch view's HTML / PowerPoint exports.
// Pitch export captures — render the exported HTML deck in a hidden window and
// screenshot each slide at 2x. The export renderer IS the preview renderer, so
// PDF/PPTX match the app 100% by construction.
// Pitch PDF — print the (preview-faithful) exported HTML deck in a hidden
// window via Chromium's printToPDF: REAL selectable text, embedded fonts,
// exact CSS layout. One renderer for preview + HTML + PDF.
ipcMain.handle('hjen:pitch-pdf', async (_e: any, args: { htmlPath: string; widthMm: number; heightMm: number }) => {
  const win = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { backgroundThrottling: false } });
  try {
    await win.loadFile(args.htmlPath);
    await new Promise(r => setTimeout(r, 1500));   // fonts + images settle
    const data = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      pageSize: { width: args.widthMm * 1000, height: args.heightMm * 1000 },   // microns
    });
    return { ok: true, pdf: data.toString('base64') };
  } catch (err: any) {
    return { ok: false, reason: String(err?.message || err) };
  } finally { try { win.destroy(); } catch { /* noop */ } }
});

ipcMain.handle('hjen:export-file', (_e: any, args: { folder: string; fileName: string; base64: string }) => {
  try {
    if (!args.folder) return { ok: false, reason: 'no_folder' };
    const name = (args.fileName || 'export')
      .replace(/[\/\\:*?"<>|]+/g, '_')
      .replace(/\s+/g, ' ').trim().slice(0, 160) || 'export';
    const outPath = path.join(args.folder, name);
    fs.writeFileSync(outPath, Buffer.from(args.base64, 'base64'));
    return { ok: true, path: outPath };
  } catch (err: any) {
    return { ok: false, reason: String(err?.message || err).slice(0, 200) };
  }
});

// ─── User fonts ───────────────────────────────────────────────────────────
// A managed Fonts folder the user drops font files into. Files register with
// the app (via @font-face over hjen-file://) so every tool's font picker can
// use them, and are also copied into the OS user-fonts folder (~/Library/Fonts
// on macOS) so they install device-wide.
const FONT_EXT = /\.(ttf|otf|ttc|woff2?|dfont)$/i;
function fontsDir(): string {
  const dir = path.join(app.getPath('userData'), 'Fonts');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function osFontsDir(): string | null {
  if (process.platform === 'darwin') return path.join(app.getPath('home'), 'Library', 'Fonts');
  if (process.platform === 'win32') return path.join(app.getPath('home'), 'AppData', 'Local', 'Microsoft', 'Windows', 'Fonts');
  return path.join(app.getPath('home'), '.local', 'share', 'fonts');
}
function listFonts(): Array<{ family: string; file: string; path: string }> {
  const dir = fontsDir();
  let entries: string[] = [];
  try { entries = fs.readdirSync(dir); } catch { /* empty */ }
  const fonts = entries.filter(f => FONT_EXT.test(f)).sort();
  // auto-install: EVERY font in the HJEN Fonts folder (however it got there —
  // dialog or a manual drop) is mirrored into the OS user-fonts folder, so
  // exported PPTX/PDF files open with the right faces device-wide.
  const os = osFontsDir();
  if (os) {
    try {
      fs.mkdirSync(os, { recursive: true });
      for (const f of fonts) {
        const dst = path.join(os, f);
        if (!fs.existsSync(dst)) { try { fs.copyFileSync(path.join(dir, f), dst); } catch { /* best-effort */ } }
      }
    } catch { /* OS folder unavailable — registration in-app still works */ }
  }
  return fonts.map(file => ({
    family: file.replace(FONT_EXT, '').replace(/[_]+/g, ' ').trim(),
    file,
    path: path.join(dir, file),
  }));
}
ipcMain.handle('hjen:fonts-dir', () => fontsDir());
ipcMain.handle('hjen:list-fonts', () => listFonts());
ipcMain.handle('hjen:open-fonts-dir', () => { electron.shell.openPath(fontsDir()); return true; });
ipcMain.handle('hjen:add-fonts', async () => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  if (!win) return { ok: false, reason: 'no_window' };
  const res = await dialog.showOpenDialog(win, {
    title: 'Add fonts',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Fonts', extensions: ['ttf', 'otf', 'ttc', 'woff', 'woff2', 'dfont'] }],
  });
  if (res.canceled || res.filePaths.length === 0) return { ok: true, added: 0, fonts: listFonts() };
  const dir = fontsDir();
  const os = osFontsDir();
  let added = 0;
  for (const src of res.filePaths) {
    try {
      const base = path.basename(src);
      fs.copyFileSync(src, path.join(dir, base));
      if (os) { try { fs.mkdirSync(os, { recursive: true }); fs.copyFileSync(src, path.join(os, base)); } catch { /* OS copy is best-effort */ } }
      added++;
    } catch { /* skip the bad one */ }
  }
  return { ok: true, added, fonts: listFonts() };
});
ipcMain.handle('hjen:remove-font', (_e: any, args: { file: string }) => {
  try {
    const p = path.join(fontsDir(), path.basename(args.file || ''));
    if (fs.existsSync(p)) fs.rmSync(p);
    return { ok: true, fonts: listFonts() };
  } catch (err: any) { return { ok: false, reason: String(err?.message || err) }; }
});

ipcMain.handle('hjen:get-projects-root', () => projectsRootPath());

ipcMain.handle('hjen:set-projects-root', (_e: any, newRoot: string) => {
  if (!newRoot || typeof newRoot !== 'string') return { ok: false };
  fs.mkdirSync(newRoot, { recursive: true });
  const settingsFile = path.join(app.getPath('userData'), 'settings.json');
  let settings: any = {};
  if (fs.existsSync(settingsFile)) {
    try { settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8')); } catch {}
  }
  settings.projectsRoot = newRoot;
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
  return { ok: true, root: newRoot };
});

ipcMain.handle('hjen:pick-folder', async () => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  if (!win) return null;
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose folder',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: projectsRootPath(),
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  return res.filePaths[0];
});

/** Folder picker for storyboard export. Defaults INTO the project's own
 *  Storyboard folder (created if missing) so the dialog opens there. */
ipcMain.handle('hjen:pick-export-folder', async (_e: any, args: { projectSlug?: string; tool?: string; title?: string }) => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  if (!win) return null;
  // Each tool opens on its own home inside the project — Storyboard/, References/…
  const tool = (args?.tool || 'Storyboard').replace(/[\/\\:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Storyboard';
  let defaultPath = projectsRootPath();
  if (args?.projectSlug) {
    const dir = path.join(projectFolder(args.projectSlug), tool);
    try { fs.mkdirSync(dir, { recursive: true }); defaultPath = dir; } catch { /* fall back to root */ }
  }
  const res = await dialog.showOpenDialog(win, {
    title: args?.title || 'Save storyboard into…',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath,
    buttonLabel: 'Save here',
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  return res.filePaths[0];
});

// ============ Save generation ============

// Save a generated image + sidecar JSON to <projectsRoot>/<project_slug>/YYYY-MM-DD/{ts}_{slug}.{png,json}
// If no projectSlug, falls back to <projectsRoot>/_unassigned/YYYY-MM-DD/
ipcMain.handle('hjen:save-generation', (_e: any, args: {
  base64: string;
  sidecar: any;
  promptSlug: string;
  projectSlug?: string;
  projectId?: string;
}) => {
  const today = new Date().toISOString().slice(0, 10);
  const bucket = args.projectSlug ? args.projectSlug : '_unassigned';
  const dir = path.join(projectsRootPath(), bucket, today);
  fs.mkdirSync(dir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safeSlug = (args.promptSlug || 'untitled').slice(0, 60);
  const base = `${ts}_${safeSlug}`;
  const imgPath = path.join(dir, `${base}.png`);
  const jsonPath = path.join(dir, `${base}.json`);

  const buffer = Buffer.from(args.base64, 'base64');
  fs.writeFileSync(imgPath, buffer);
  fs.writeFileSync(jsonPath, JSON.stringify(args.sidecar, null, 2));

  // Generate a 1024px-wide JPEG thumbnail. Used for sidebar AND for the
  // Projects-page hero/cover, so it has to look sharp on a phone-sized poster.
  // Saved alongside the full PNG as {base}.thumb.jpg
  const thumbPath = path.join(dir, `${base}.thumb.jpg`);
  try {
    const native = electron.nativeImage.createFromBuffer(buffer);
    const { width, height } = native.getSize();
    const target = Math.min(width, 1024);
    const scale = target / Math.max(1, width);
    const tw = Math.max(1, Math.round(width * scale));
    const th = Math.max(1, Math.round(height * scale));
    const thumbBuf = native.resize({ width: tw, height: th, quality: 'best' }).toJPEG(88);
    fs.writeFileSync(thumbPath, thumbBuf);
  } catch (e) {
    // Thumbnail is non-critical; sidebar can fall back to the full image
    console.warn('Thumbnail generation failed', e);
  }

  // Bump generation count on the project record
  let projectName = '(unassigned)';
  if (args.projectId) {
    const arr = readProjects();
    const target = arr.find(p => p.id === args.projectId);
    if (target) {
      target.generationCount = (target.generationCount || 0) + 1;
      projectName = target.name;
      writeProjects(arr);
    }
  }

  // Append to the durable usage log so deletions never wipe history.
  try {
    const sidecar = args.sidecar || {};
    const stat = fs.statSync(imgPath);
    appendGenerationEvent({
      ts: stat.mtimeMs,
      imgPath,
      thumbPath: fs.existsSync(thumbPath) ? thumbPath : undefined,
      jsonPath,
      dateFolder: today,
      baseName: base,
      captured: sidecar?.captured ?? null,
      promptTitle:
        sidecar?.selections?.prompt?.split(/[.!?\n,]/)[0]?.trim()?.slice(0, 100) ||
        base.split('_').slice(1).join(' ').replace(/-/g, ' '),
      finalSize: sidecar?.finalSize || sidecar?.size,
      modelLabel: sidecar?.model,
      quality: sidecar?.selections?.quality,
      resolution: sidecar?.selections?.resolution,
      aspect: sidecar?.selections?.aspect,
      costUsd: typeof sidecar?.estimatedCost?.usd === 'number' ? sidecar.estimatedCost.usd : undefined,
      durationMs: typeof sidecar?.durationMs === 'number' ? sidecar.durationMs : undefined,
      referencesCount: Array.isArray(sidecar?.references) ? sidecar.references.length : 0,
      projectId: args.projectId ?? null,
      projectName,
      projectSlug: bucket,
    });
  } catch (err) {
    console.warn('[save-generation] could not append usage log', err);
  }

  return { imgPath, jsonPath, dir, thumbPath };
});

// Save a storyboard panel/asset image. Kept OUT of the Frames product: it goes
// under <slug>/_storyboard/images/<date>/ (not a YYYY-MM-DD bucket), so
// list-project-files / list-all-generations never pick it up, and we do NOT
// bump generationCount or append to the usage log.
ipcMain.handle('hjen:save-storyboard-image', (_e: any, args: {
  base64: string;
  sidecar: any;
  promptSlug: string;
  projectSlug?: string;
}) => {
  const today = new Date().toISOString().slice(0, 10);
  const bucket = args.projectSlug ? args.projectSlug : '_unassigned';
  const dir = path.join(projectsRootPath(), bucket, '_storyboard', 'images', today);
  fs.mkdirSync(dir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safeSlug = (args.promptSlug || 'untitled').slice(0, 60);
  const base = `${ts}_${safeSlug}`;
  const imgPath = path.join(dir, `${base}.png`);
  const jsonPath = path.join(dir, `${base}.json`);

  const buffer = Buffer.from(args.base64, 'base64');
  fs.writeFileSync(imgPath, buffer);
  fs.writeFileSync(jsonPath, JSON.stringify(args.sidecar, null, 2));

  const thumbPath = path.join(dir, `${base}.thumb.jpg`);
  try {
    const native = electron.nativeImage.createFromBuffer(buffer);
    const { width, height } = native.getSize();
    const target = Math.min(width, 1024);
    const scale = target / Math.max(1, width);
    const tw = Math.max(1, Math.round(width * scale));
    const th = Math.max(1, Math.round(height * scale));
    fs.writeFileSync(thumbPath, native.resize({ width: tw, height: th, quality: 'best' }).toJPEG(88));
  } catch (e) {
    console.warn('[save-storyboard-image] thumbnail failed', e);
  }

  return { imgPath, jsonPath, dir, thumbPath };
});

ipcMain.handle('hjen:open-folder', (_e: any, p: string) => {
  electron.shell.openPath(p);
  return true;
});
// Reveal a file in Finder/Explorer (highlights it in its folder) — distinct from
// open-folder which OPENS the file. Used by the reference "Reveal in Finder" menu.
ipcMain.handle('hjen:reveal-in-finder', (_e: any, p: string) => {
  try { electron.shell.showItemInFolder(p); return true; } catch { return false; }
});

// Download/export a deliverable to a chosen location (desktop equivalent of the
// web browser download). The file is already local; export a named copy.
ipcMain.handle('hjen:download-generation', async (_e: any, a: { filePath: string; name?: string }) => {
  try {
    let src = String(a?.filePath || '');
    if (src.startsWith('hjen-file://')) src = decodeURIComponent(src.slice('hjen-file://'.length));
    if (!src || !fs.existsSync(src)) return { ok: false, message: 'file not found' };
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    const r = await dialog.showSaveDialog(win, { defaultPath: a?.name || path.basename(src) });
    if (r.canceled || !r.filePath) return { ok: false, cancelled: true };
    fs.copyFileSync(src, r.filePath);
    return { ok: true, path: r.filePath };
  } catch (e: any) { return { ok: false, message: String(e?.message || e) }; }
});

// Open a local file in the default WEB BROWSER (not the default app for its
// type). Used for the interactive HTML pitch export so it always renders as a
// page + runs its nav JS, even if .html is bound to a code editor on this Mac.
ipcMain.handle('hjen:open-in-browser', async (_e: any, p: string) => {
  try {
    const url = 'file://' + encodeURI(p.split(path.sep).join('/'));
    await electron.shell.openExternal(url);
    return { ok: true };
  } catch (err: any) { return { ok: false, message: err?.message || String(err) }; }
});

// Move a generation (.png + .json + .thumb.jpg) from its current project
// to a different project's date folder. Updates the sidecar's project field.
ipcMain.handle('hjen:move-generation', (_e: any, args: {
  imgPath: string;
  targetProjectSlug: string | null;     // null = _unassigned
  targetProjectId?: string | null;      // updates the project's generationCount
}) => {
  if (!fs.existsSync(args.imgPath)) return { ok: false, reason: 'source_missing' };

  const dir = path.dirname(args.imgPath);
  const fname = path.basename(args.imgPath);
  const ext = path.extname(fname);
  const base = fname.slice(0, -ext.length);
  const jsonPath = path.join(dir, `${base}.json`);
  const thumbPath = path.join(dir, `${base}.thumb.jpg`);

  const dateFolder = path.basename(dir);                  // YYYY-MM-DD
  const sourceBucket = path.basename(path.dirname(dir));  // project slug

  const targetBucket = args.targetProjectSlug || '_unassigned';
  if (sourceBucket === targetBucket) return { ok: false, reason: 'same_project' };

  const targetDir = path.join(projectsRootPath(), targetBucket, dateFolder);
  fs.mkdirSync(targetDir, { recursive: true });

  // Avoid collisions if a same-named file already exists in target
  let targetBase = base;
  let suffix = 1;
  while (fs.existsSync(path.join(targetDir, `${targetBase}${ext}`))) {
    suffix += 1;
    targetBase = `${base}_${suffix}`;
  }

  const newImg = path.join(targetDir, `${targetBase}${ext}`);
  const newJson = path.join(targetDir, `${targetBase}.json`);
  const newThumb = path.join(targetDir, `${targetBase}.thumb.jpg`);

  // Update sidecar project reference before move
  let sidecar: any = {};
  try { sidecar = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')); } catch {}
  if (args.targetProjectSlug) {
    const projects = readProjects();
    const target = projects.find(p => p.slug === args.targetProjectSlug);
    sidecar.project = target ? { id: target.id, name: target.name, slug: target.slug } : null;
  } else {
    sidecar.project = null;
  }

  // Perform moves
  fs.renameSync(args.imgPath, newImg);
  if (fs.existsSync(jsonPath)) {
    fs.writeFileSync(newJson, JSON.stringify(sidecar, null, 2));
    fs.unlinkSync(jsonPath);
  }
  if (fs.existsSync(thumbPath)) fs.renameSync(thumbPath, newThumb);

  // Adjust generation counts on both projects
  const projects = readProjects();
  const sourceP = projects.find(p => p.slug === sourceBucket);
  if (sourceP) sourceP.generationCount = Math.max(0, (sourceP.generationCount || 0) - 1);
  if (args.targetProjectId) {
    const t = projects.find(p => p.id === args.targetProjectId);
    if (t) t.generationCount = (t.generationCount || 0) + 1;
  }
  writeProjects(projects);

  return { ok: true, newImgPath: newImg, newJsonPath: newJson };
});

// Permanently delete a generation's PNG + JSON + thumbnail.
ipcMain.handle('hjen:delete-generation', (_e: any, args: { imgPath: string }) => {
  if (!fs.existsSync(args.imgPath)) return { ok: false, reason: 'source_missing' };
  const dir = path.dirname(args.imgPath);
  const fname = path.basename(args.imgPath);
  const ext = path.extname(fname);
  const base = fname.slice(0, -ext.length);
  const jsonPath = path.join(dir, `${base}.json`);
  const thumbPath = path.join(dir, `${base}.thumb.jpg`);

  const projectSlug = path.basename(path.dirname(dir));

  try { fs.unlinkSync(args.imgPath); } catch {}
  try { if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath); } catch {}
  try { if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath); } catch {}

  // Decrement project counter
  const projects = readProjects();
  const proj = projects.find(p => p.slug === projectSlug);
  if (proj) {
    proj.generationCount = Math.max(0, (proj.generationCount || 0) - 1);
    writeProjects(projects);
  }

  return { ok: true };
});

// ============ Read project files (for sidebar) ============

interface ProjectFileEntry {
  imgPath: string;
  thumbPath?: string;
  jsonPath: string;
  dateFolder: string;
  baseName: string;
  promptTitle: string;
  size?: string;
  quality?: string;
  ts: number;
  costUsd?: number;
  durationMs?: number;
  modelLabel?: string;
}

ipcMain.handle('hjen:list-project-files', (_e: any, args: { projectSlug?: string | null }) => {
  const bucket = args.projectSlug || '_unassigned';
  const root = path.join(projectsRootPath(), bucket);
  if (!fs.existsSync(root)) return [];

  const entries: ProjectFileEntry[] = [];
  const dateFolders = (fs.readdirSync(root) as string[]).filter((d: string) => {
    const full = path.join(root, d);
    return fs.statSync(full).isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d);
  });

  for (const dateFolder of dateFolders) {
    const dir = path.join(root, dateFolder);
    const files = fs.readdirSync(dir) as string[];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const baseName = f.slice(0, -5);
      const imgPath = path.join(dir, `${baseName}.png`);
      const thumbCandidate = path.join(dir, `${baseName}.thumb.jpg`);
      const jsonPath = path.join(dir, f);
      if (!fs.existsSync(imgPath)) continue;
      let sidecar: any = {};
      try { sidecar = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')); } catch {}
      const stat = fs.statSync(imgPath);
      const title =
        sidecar?.selections?.prompt?.split(/[.!?\n,]/)[0]?.trim()?.slice(0, 80) ||
        baseName.split('_').slice(1).join(' ').replace(/-/g, ' ');
      entries.push({
        imgPath,
        thumbPath: fs.existsSync(thumbCandidate) ? thumbCandidate : undefined,
        jsonPath,
        dateFolder,
        baseName,
        promptTitle: title || baseName,
        size: sidecar?.finalSize || sidecar?.size,
        quality: sidecar?.selections?.quality,
        ts: stat.mtimeMs,
        costUsd: typeof sidecar?.estimatedCost?.usd === 'number' ? sidecar.estimatedCost.usd : undefined,
        durationMs: typeof sidecar?.durationMs === 'number' ? sidecar.durationMs : undefined,
        modelLabel: sidecar?.model,
      });
    }
  }
  entries.sort((a, b) => b.ts - a.ts);
  return entries;
});

ipcMain.handle('hjen:read-sidecar', (_e: any, jsonPath: string) => {
  if (!fs.existsSync(jsonPath)) return null;
  try { return JSON.parse(fs.readFileSync(jsonPath, 'utf-8')); } catch { return null; }
});

// Walk EVERY project folder and return every generation entry with its
// sidecar metadata. Used by the global Usage report + Projects page.
ipcMain.handle('hjen:list-all-generations', () => {
  const root = projectsRootPath();
  if (!fs.existsSync(root)) return [];

  const projects = readProjects();
  const projectBySlug = new Map(projects.map(p => [p.slug, p]));

  const out: any[] = [];
  const bucketDirs = (fs.readdirSync(root) as string[]).filter((d: string) => {
    if (d === '_library') return false;            // skip the central library
    return fs.statSync(path.join(root, d)).isDirectory();
  });

  for (const bucket of bucketDirs) {
    const bucketPath = path.join(root, bucket);
    const project = projectBySlug.get(bucket) ?? null;
    const dateFolders = (fs.readdirSync(bucketPath) as string[]).filter((d: string) => {
      const full = path.join(bucketPath, d);
      return fs.statSync(full).isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d);
    });
    for (const dateFolder of dateFolders) {
      const dir = path.join(bucketPath, dateFolder);
      const files = fs.readdirSync(dir) as string[];
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const baseName = f.slice(0, -5);
        const imgPath = path.join(dir, `${baseName}.png`);
        const thumbCandidate = path.join(dir, `${baseName}.thumb.jpg`);
        const jsonPath = path.join(dir, f);
        if (!fs.existsSync(imgPath)) continue;
        let sidecar: any = {};
        try { sidecar = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')); } catch {}
        const stat = fs.statSync(imgPath);
        out.push({
          imgPath,
          thumbPath: fs.existsSync(thumbCandidate) ? thumbCandidate : undefined,
          jsonPath,
          dateFolder,
          baseName,
          ts: stat.mtimeMs,
          captured: sidecar?.captured ?? null,
          promptTitle:
            sidecar?.selections?.prompt?.split(/[.!?\n,]/)[0]?.trim()?.slice(0, 100) ||
            baseName.split('_').slice(1).join(' ').replace(/-/g, ' '),
          finalSize: sidecar?.finalSize || sidecar?.size,
          modelLabel: sidecar?.model,
          quality: sidecar?.selections?.quality,
          resolution: sidecar?.selections?.resolution,
          aspect: sidecar?.selections?.aspect,
          costUsd: typeof sidecar?.estimatedCost?.usd === 'number' ? sidecar.estimatedCost.usd : undefined,
          durationMs: typeof sidecar?.durationMs === 'number' ? sidecar.durationMs : undefined,
          referencesCount: Array.isArray(sidecar?.references) ? sidecar.references.length : 0,
          projectId: project?.id ?? null,
          projectName: project?.name ?? '(unassigned)',
          projectSlug: bucket,
        });
      }
    }
  }
  out.sort((a, b) => b.ts - a.ts);
  return out;
});

// Pixel dimensions of any local image, read straight from the file HEADER —
// cheap (a few small reads, no full decode) and, crucially, works for images
// that carry no saved size metadata (older frames, uploaded library refs).
// Supports the formats the app makes or ingests: PNG · JPEG · WebP · GIF.
function readImageDims(file: string): { w: number; h: number } | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(32);
    fs.readSync(fd, head, 0, 32, 0);

    // PNG — IHDR width/height are big-endian u32 at bytes 16 and 20.
    if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
      return { w: head.readUInt32BE(16), h: head.readUInt32BE(20) };
    }
    // GIF — logical screen width/height are little-endian u16 at bytes 6 and 8.
    if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) {
      return { w: head.readUInt16LE(6), h: head.readUInt16LE(8) };
    }
    // WebP — RIFF container, format tag at byte 12.
    if (head.slice(0, 4).toString('ascii') === 'RIFF' && head.slice(8, 12).toString('ascii') === 'WEBP') {
      const fmt = head.slice(12, 16).toString('ascii');
      if (fmt === 'VP8 ') {
        return { w: head.readUInt16LE(26) & 0x3fff, h: head.readUInt16LE(28) & 0x3fff };
      }
      if (fmt === 'VP8L') {
        const bits = head.readUInt32LE(21);
        return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
      }
      if (fmt === 'VP8X') {
        const w = 1 + (head[24] | (head[25] << 8) | (head[26] << 16));
        const h = 1 + (head[27] | (head[28] << 8) | (head[29] << 16));
        return { w, h };
      }
    }
    // JPEG — walk the marker segments to the SOF frame header.
    if (head[0] === 0xff && head[1] === 0xd8) {
      const size = fs.fstatSync(fd).size;
      const seg = Buffer.alloc(4);
      let offset = 2;
      while (offset + 4 <= size) {
        fs.readSync(fd, seg, 0, 4, offset);
        if (seg[0] !== 0xff) { offset++; continue; }
        const marker = seg[1];
        // Standalone markers (no length): padding, RSTn, SOI/EOI.
        if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { offset += 2; continue; }
        const segLen = seg.readUInt16BE(2);
        const isSOF =
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf);
        if (isSOF) {
          const sof = Buffer.alloc(5);
          fs.readSync(fd, sof, 0, 5, offset + 4); // precision(1) height(2) width(2)
          return { w: sof.readUInt16BE(3), h: sof.readUInt16BE(1) };
        }
        offset += 2 + segLen;
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* ignore */ } }
  }
}

ipcMain.handle('hjen:image-dims', (_e: any, args: { path: string }) => {
  if (!args?.path || !fs.existsSync(args.path)) return null;
  return readImageDims(args.path);
});

// Usage history. Reads the append-only _generations.jsonl log so deletions
// of images or projects never wipe the cost/spend history. On the first call
// after upgrade (no log yet) we backfill from the filesystem scan so existing
// users don't see a sudden zero.
ipcMain.handle('hjen:list-generations-log', () => {
  const root = projectsRootPath();
  if (!fs.existsSync(root)) return [];

  const logExists = fs.existsSync(generationsLogPath());
  const log = readGenerationsLog();

  // Filesystem scan — same shape, used both as a backfill source and to
  // surface any generation that exists on disk but isn't yet in the log.
  const projects = readProjects();
  const projectBySlug = new Map(projects.map(p => [p.slug, p]));
  const fsEntries: GenerationLogEntry[] = [];
  const bucketDirs = (fs.readdirSync(root) as string[]).filter((d: string) => {
    if (d === '_library' || d === '_pending' || d === '_failed') return false;
    try { return fs.statSync(path.join(root, d)).isDirectory(); } catch { return false; }
  });
  for (const bucket of bucketDirs) {
    const bucketPath = path.join(root, bucket);
    const project = projectBySlug.get(bucket) ?? null;
    let dateFolders: string[] = [];
    try {
      dateFolders = (fs.readdirSync(bucketPath) as string[]).filter((d: string) => {
        const full = path.join(bucketPath, d);
        return fs.statSync(full).isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d);
      });
    } catch { continue; }
    for (const dateFolder of dateFolders) {
      const dir = path.join(bucketPath, dateFolder);
      let files: string[] = [];
      try { files = fs.readdirSync(dir) as string[]; } catch { continue; }
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const baseName = f.slice(0, -5);
        const imgPath = path.join(dir, `${baseName}.png`);
        const thumbCandidate = path.join(dir, `${baseName}.thumb.jpg`);
        const jsonPath = path.join(dir, f);
        if (!fs.existsSync(imgPath)) continue;
        let sidecar: any = {};
        try { sidecar = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')); } catch {}
        const stat = fs.statSync(imgPath);
        fsEntries.push({
          ts: stat.mtimeMs,
          imgPath,
          thumbPath: fs.existsSync(thumbCandidate) ? thumbCandidate : undefined,
          jsonPath,
          dateFolder,
          baseName,
          captured: sidecar?.captured ?? null,
          promptTitle:
            sidecar?.selections?.prompt?.split(/[.!?\n,]/)[0]?.trim()?.slice(0, 100) ||
            baseName.split('_').slice(1).join(' ').replace(/-/g, ' '),
          finalSize: sidecar?.finalSize || sidecar?.size,
          modelLabel: sidecar?.model,
          quality: sidecar?.selections?.quality,
          resolution: sidecar?.selections?.resolution,
          aspect: sidecar?.selections?.aspect,
          costUsd: typeof sidecar?.estimatedCost?.usd === 'number' ? sidecar.estimatedCost.usd : undefined,
          durationMs: typeof sidecar?.durationMs === 'number' ? sidecar.durationMs : undefined,
          referencesCount: Array.isArray(sidecar?.references) ? sidecar.references.length : 0,
          projectId: project?.id ?? null,
          projectName: project?.name ?? '(unassigned)',
          projectSlug: bucket,
        });
      }
    }
  }

  // First run after upgrade: seed the log with everything we found on disk so
  // the user keeps their existing history. Then return as the source of truth.
  if (!logExists && fsEntries.length > 0) {
    try {
      fs.mkdirSync(root, { recursive: true });
      const seed = fsEntries.map(e => JSON.stringify(e)).join('\n') + '\n';
      fs.writeFileSync(generationsLogPath(), seed);
    } catch (err) {
      console.warn('[generations-log] seed failed', err);
    }
    return fsEntries.slice().sort((a, b) => b.ts - a.ts);
  }

  // Merge: log entries are authoritative history; any filesystem entry
  // missing from the log (e.g. older generations from a fresh upgrade with
  // pre-existing log) is appended in.
  const seenKeys = new Set(log.map(e => e.jsonPath || e.imgPath));
  const merged = log.slice();
  for (const fe of fsEntries) {
    const key = fe.jsonPath || fe.imgPath;
    if (!seenKeys.has(key)) {
      merged.push(fe);
      seenKeys.add(key);
      try { fs.appendFileSync(generationsLogPath(), JSON.stringify(fe) + '\n'); } catch {}
    }
  }
  merged.sort((a, b) => b.ts - a.ts);
  return merged;
});

ipcMain.handle('hjen:path-exists', (_e: any, p: string) => {
  try { return !!p && fs.existsSync(p); } catch { return false; }
});

ipcMain.handle('hjen:read-image-data-url', (_e: any, imgPath: string) => {
  if (!fs.existsSync(imgPath)) return null;
  const ext = path.extname(imgPath).slice(1).toLowerCase() || 'png';
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
  const data = fs.readFileSync(imgPath);
  return `data:${mime};base64,${data.toString('base64')}`;
});

// Gateway uploads must not send several full-resolution 5–15MB PNG references
// inside the same JSON request. Keep small plates byte-exact; resize only large
// photographic references in memory. The owner's local file is never changed.
ipcMain.handle('hjen:read-image-upload-data-url', (_e: any, imgPath: string) => {
  try {
    if (!fs.existsSync(imgPath)) return null;
    const source = fs.readFileSync(imgPath);
    if (source.length <= 1_500_000) {
      const ext = path.extname(imgPath).slice(1).toLowerCase() || 'png';
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
      return `data:${mime};base64,${source.toString('base64')}`;
    }
    let image = nativeImage.createFromBuffer(source);
    if (image.isEmpty()) return null;
    const size = image.getSize();
    const maxEdge = 1600;
    if (Math.max(size.width, size.height) > maxEdge) {
      const scale = maxEdge / Math.max(size.width, size.height);
      image = image.resize({
        width: Math.max(1, Math.round(size.width * scale)),
        height: Math.max(1, Math.round(size.height * scale)),
        quality: 'best',
      });
    }
    const upload = image.toJPEG(90);
    return `data:image/jpeg;base64,${upload.toString('base64')}`;
  } catch {
    return null;
  }
});

// ============ Reference Library ============
//
// Layout:
//   {projectsRoot}/_library/
//   ├── library.json              (metadata index)
//   ├── characters/
//   │   ├── <id>.<ext>            (original file, copied in)
//   │   └── thumb_<id>.jpg        (320px thumb)
//   ├── wardrobe/
//   ├── locations/
//   ├── props/
//   └── general/
//
// Library is shared across all projects; user uploads once, references many times.

type LibCategory = 'character' | 'wardrobe' | 'location' | 'prop' | 'general' | 'pose' | 'expression' | 'composition' | 'audio' | 'movement';

interface LibraryAsset {
  id: string;
  category: LibCategory;
  name: string;
  filename: string;       // original filename incl. extension
  filePath: string;       // absolute path on disk
  thumbPath: string;      // absolute thumbnail path
  addedAt: string;
  bytes: number;
  origin?: string;        // optional: where it came from (URL, original path, etc.)
  /** SHA-256 of the asset's file contents. Used to dedup repeat adds —
   *  pressing Refine twice on the same frame finds the existing asset by
   *  hash and skips the second copy. Optional for backwards compat with
   *  entries written before hashing was introduced. */
  contentHash?: string;
}

function libraryRoot(): string {
  return path.join(projectsRootPath(), '_library');
}
function libraryIndexPath(): string {
  return path.join(libraryRoot(), 'library.json');
}
function readLibrary(): LibraryAsset[] {
  const p = libraryIndexPath();
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return []; }
}
function writeLibrary(arr: LibraryAsset[]) {
  fs.mkdirSync(libraryRoot(), { recursive: true });
  fs.writeFileSync(libraryIndexPath(), JSON.stringify(arr, null, 2));
}
function makeThumb(buffer: any, thumbPath: string) {
  const native = electron.nativeImage.createFromBuffer(buffer);
  const sz = native.getSize();
  const scale = 320 / Math.max(1, sz.width);
  const tw = Math.max(1, Math.round(sz.width * scale));
  const th = Math.max(1, Math.round(sz.height * scale));
  const thumbBuf = native.resize({ width: tw, height: th, quality: 'good' }).toJPEG(70);
  fs.writeFileSync(thumbPath, thumbBuf);
}

ipcMain.handle('hjen:list-library', () => readLibrary());

ipcMain.handle('hjen:add-to-library', (_e: any, args: { category: LibCategory; sourcePath: string; name?: string }) => {
  if (!fs.existsSync(args.sourcePath)) return { ok: false, reason: 'source_not_found' };
  const ext = path.extname(args.sourcePath).toLowerCase() || '.png';
  const catDir = path.join(libraryRoot(), `${args.category}s`);
  fs.mkdirSync(catDir, { recursive: true });

  // Read once, hash once. The buffer is reused for both the on-disk write
  // and the in-memory thumbnail, so the file is only touched a single time
  // even on the slow first-add path. ~50ms for a 5MB PNG on SSD.
  const buffer = fs.readFileSync(args.sourcePath);
  const contentHash = nodeCrypto.createHash('sha256').update(buffer).digest('hex');

  // Dedup: same content + same category → reuse the existing asset and
  // skip the copy. The asset's stored file is still on disk (verified
  // before reuse — if it was deleted out from under us, we fall through
  // and re-copy). Different categories are NOT deduped: the same image
  // can legitimately serve as both a Composition lock and a Character
  // reference, and the Library categorisation is the load-bearing
  // signal for the prompt builder.
  const existing = readLibrary().find(a =>
    a.contentHash === contentHash &&
    a.category === args.category &&
    fs.existsSync(a.filePath)
  );
  if (existing) {
    return { ok: true, asset: existing, deduped: true };
  }

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const filePath = path.join(catDir, `${id}${ext}`);
  const thumbPath = path.join(catDir, `thumb_${id}.jpg`);
  fs.writeFileSync(filePath, buffer);
  try { makeThumb(buffer, thumbPath); } catch (e) { console.warn('[library] thumb failed', e); }

  const baseName = path.basename(args.sourcePath, ext);
  const asset: LibraryAsset = {
    id,
    category: args.category,
    name: args.name?.trim() || baseName,
    filename: path.basename(args.sourcePath),
    filePath,
    thumbPath,
    addedAt: new Date().toISOString(),
    bytes: buffer.length,
    origin: args.sourcePath,
    contentHash,
  };
  const arr = readLibrary();
  arr.unshift(asset);
  writeLibrary(arr);
  return { ok: true, asset };
});

ipcMain.handle('hjen:delete-from-library', (_e: any, args: { id: string }) => {
  const arr = readLibrary();
  const target = arr.find(a => a.id === args.id);
  if (!target) return { ok: false };
  try { if (fs.existsSync(target.filePath)) fs.unlinkSync(target.filePath); } catch {}
  try { if (fs.existsSync(target.thumbPath)) fs.unlinkSync(target.thumbPath); } catch {}
  writeLibrary(arr.filter(a => a.id !== args.id));
  return { ok: true };
});

// ── Character cards (Cast product) ────────────────────────────────────
// A character card bundles a portrait (already saved as a Library
// 'character' asset, so it shows up in Frame's reference picker) with the
// extra reference photos it was read from and the locked profile JSON.
// Stored at {projectsRoot}/_library/character_cards/{id}/ — card.json +
// the copied reference images. Recall in Frame attaches the portrait +
// references as layers and injects the profile into the prompt.
interface CharacterCardRef { filePath: string; name: string }
interface CharacterCard {
  id: string;
  name: string;
  profile: Record<string, string>;
  mainAsset: LibraryAsset;
  references: CharacterCardRef[];
  savedAt: string;
  version: number;
}
function characterCardsRoot(): string { return path.join(libraryRoot(), 'character_cards'); }

ipcMain.handle('hjen:list-character-cards', (): CharacterCard[] => {
  const root = characterCardsRoot();
  if (!fs.existsSync(root)) return [];
  const out: CharacterCard[] = [];
  for (const d of fs.readdirSync(root)) {
    const cj = path.join(root, d, 'card.json');
    if (fs.existsSync(cj)) { try { out.push(JSON.parse(fs.readFileSync(cj, 'utf-8'))); } catch { /* skip */ } }
  }
  return out.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
});

ipcMain.handle('hjen:save-character-card', (_e: any, args: { id?: string; name: string; profile: any; mainAsset: LibraryAsset; referencePaths: string[] }) => {
  const id = args.id || `card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = path.join(characterCardsRoot(), id);
  fs.mkdirSync(dir, { recursive: true });
  const references: CharacterCardRef[] = [];
  (args.referencePaths || []).forEach((src, i) => {
    if (!src || !fs.existsSync(src)) return;
    const ext = path.extname(src).toLowerCase() || '.png';
    const dest = path.join(dir, `ref-${i}${ext}`);
    try { fs.copyFileSync(src, dest); references.push({ filePath: dest, name: path.basename(src) }); } catch { /* skip */ }
  });
  const card: CharacterCard = {
    id, name: args.name || 'Unnamed', profile: args.profile || {},
    mainAsset: args.mainAsset, references, savedAt: new Date().toISOString(), version: 1,
  };
  fs.writeFileSync(path.join(dir, 'card.json'), JSON.stringify(card, null, 2));
  return { ok: true, card };
});

ipcMain.handle('hjen:delete-character-card', (_e: any, args: { id: string }) => {
  const dir = path.join(characterCardsRoot(), args.id);
  try { if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  return { ok: true };
});

// ============ HJEN REF — the internal Saudi reference library ============
//
// The 510-ad study (02_PRODUCT/dna_corpus) indexed as a searchable frame
// library: 8,745 real frames, ~4,880 carrying per-frame Gemini tags (shot,
// lighting, palette, wardrobe, place, cultural-truth objects). The library is
// INVISIBLE as a browsable gallery (Anwar 2026-07-10) — it surfaces only
// through search, as one source among the hunt's sources. Zero network,
// zero LLM: normalized-token scoring over a prebuilt index.
// Index built by dna_corpus/pipeline/build_ref_index.py.

interface HjenRefRecord {
  id: string; ad: string; file: string;
  brand: string; company: string; title: string; url: string;
  occasion: string; era: string; region: string;
  analyzed: boolean; q: number;
  shotSize: string; shotAngle: string; lightState: string;
  palette: string[]; place: string; wardrobe: string;
  truthObjects: string[]; dims: string[]; ostKind: string;
  blob: string;
  // ── index v2 · the Eye's read (absent until eye_read.py has run the frame) ──
  hasRead?: boolean;
  shotHeight?: string;
  searchPhrase?: string;
  register?: string;
  energy?: string;
  read?: Record<string, any> | null;
}

let hjenRefCache: { root: string; records: HjenRefRecord[] } | null = null;

function hjenRefCorpusRoot(): string {
  // Dev layout: {repo}/02_PRODUCT/desktop_app/app → corpus two levels up.
  // Packaged builds override with HJEN_DNA_CORPUS (asar breaks the walk).
  return process.env.HJEN_DNA_CORPUS
    || path.resolve(app.getAppPath(), '..', '..', 'dna_corpus');
}

// The Context-Agents library (methods/ · profiles/ · lexicon.json) is WRITTEN at
// runtime by the in-app Trainer, so it can't live inside the read-only packaged
// bundle. It lives peer to dna_corpus/ in dev; in the packaged app it lives in a
// writable, seeded userData folder (the auto-updater never touches userData).
// HJEN_CONTEXT_AGENTS pins it (dev harness + the lab scripts share the same root).
function contextAgentsRoot(): string {
  return process.env.HJEN_CONTEXT_AGENTS
    || (app.isPackaged
        ? path.join(app.getPath('userData'), 'context_agents')
        : path.resolve(app.getAppPath(), '..', '..', 'context_agents'));
}

/** Put the shipped Context Agents library where the packaged app looks for it.
 *
 *  WHY: the root above is WRITABLE (the Trainer edits cards, the lexicon grows,
 *  the Eye appends judgments), so packaged builds point at userData — which on a
 *  fresh install is empty. The library itself lived only in the repo and was
 *  never put in the bundle, so every packaged build had **zero DNA profiles**:
 *  Context Studio's profile dropdown showed "—", `ready` could never become
 *  true, and MAKE stayed disabled forever with a hint the user could not
 *  satisfy. It worked in dev (which reads the repo directly) and nowhere else.
 *
 *  MERGE, DO NOT REPLACE. The same tree holds the user's own trained cards and
 *  graded reads, so only files that are MISSING are copied. An update brings new
 *  methods and profiles; nothing the user wrote is overwritten. */
function seedContextAgents(): void {
  if (!app.isPackaged) return;                       // dev reads the repo itself
  const src = path.join(process.resourcesPath || '', 'context_agents');
  const dest = contextAgentsRoot();
  try {
    if (!fs.existsSync(src)) return;                 // older bundle, nothing to seed
    let copied = 0;
    const walk = (from: string, to: string) => {
      fs.mkdirSync(to, { recursive: true });
      for (const e of fs.readdirSync(from, { withFileTypes: true })) {
        const s = path.join(from, e.name), d = path.join(to, e.name);
        if (e.isDirectory()) walk(s, d);
        else if (!fs.existsSync(d)) { fs.copyFileSync(s, d); copied++; }
      }
    };
    walk(src, dest);
    if (copied) console.log(`[hjen-ca] seeded ${copied} library file(s) → ${dest}`);
  } catch (err) {
    console.warn('[hjen-ca] could not seed the library', err);
  }
}

// The Eye's own library — the golden set of graded reads. Written at runtime by
// the bench (and later by the batch reader), so it follows the same writable-root
// rule as context_agents/: peer to dna_corpus/ in dev, userData when packaged.
function eyeRoot(): string {
  return process.env.HJEN_EYE_ROOT
    || (app.isPackaged
        ? path.join(app.getPath('userData'), 'eye')
        : path.resolve(app.getAppPath(), '..', '..', 'eye'));
}

// The Swap's own library — swap_golden.jsonl, where a graded take records both
// whether each preserved slot held AND whether the machine's verdict agreed with
// Anwar's. Same writable-root rule as the Eye: peer to dna_corpus/ in dev,
// userData when packaged.
function swapRoot(): string {
  return process.env.HJEN_SWAP_ROOT
    || (app.isPackaged
        ? path.join(app.getPath('userData'), 'swap')
        : path.resolve(app.getAppPath(), '..', '..', 'swap'));
}

function loadHjenRefIndex(): { root: string; records: HjenRefRecord[] } | null {
  if (hjenRefCache) return hjenRefCache;
  const root = hjenRefCorpusRoot();
  const idx = path.join(root, 'index', 'hjen_ref_index.json');
  try {
    if (!fs.existsSync(idx)) return null;
    const parsed = JSON.parse(fs.readFileSync(idx, 'utf-8'));
    if (!Array.isArray(parsed?.records)) return null;
    hjenRefCache = { root, records: parsed.records };
    return hjenRefCache;
  } catch { return null; }
}

/** Same Arabic normalization discipline as the DNA layer's retrieve.ts. */
function hjenRefNormalize(s: string): string {
  return s.toLowerCase()
    .replace(/[ً-ْٰـ]/g, '')  // harakat + tatweel
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ').trim();
}

ipcMain.handle('hjen:ref-status', () => {
  const lib = loadHjenRefIndex();
  if (!lib) return { ok: false as const, root: hjenRefCorpusRoot() };
  return { ok: true as const, root: lib.root, frames: lib.records.length };
});

ipcMain.handle('hjen:ref-search', (_e: any, args: { query: string; limit?: number }) => {
  const lib = loadHjenRefIndex();
  if (!lib) return { ok: false as const, reason: 'no_index', root: hjenRefCorpusRoot() };
  const phrase = hjenRefNormalize(String(args?.query ?? ''));
  const tokens = phrase.split(' ').filter(t => t.length >= 2);
  if (tokens.length === 0) return { ok: true as const, results: [] };
  // v1 demanded 60% of tokens hit. That ratio was tuned for a SHORT tag blob,
  // where a stray single-word overlap really was noise. Against the eye's read
  // the blob is prose, and a real query ("رجل وحيد يطل على مدينة ليلاً") carries
  // connective words no frame will ever contain — so 60% over-rejects the right
  // answer. Prose earns a lower floor; a tag-only blob keeps the old one.
  const anyRead = lib.records.some(r => (r as any).hasRead);
  const ratio = anyRead ? 0.4 : 0.6;
  const need = Math.max(1, Math.ceil(tokens.length * ratio));
  const limit = Math.min(200, Math.max(1, args?.limit ?? 60));

  // FIELD WEIGHTS. A hit in the search key is worth more than a hit buried in
  // the ad-level blob — the key is 5–10 words the eye chose AS the frame's
  // handle, so landing there means the searcher and the eye agree on what the
  // frame is. Ranked by how close the field sits to the searcher's intent.
  const fieldsOf = (r: any): Array<[string, number]> => {
    const rd = r.read;
    if (!rd) return [[r.blob, 1]];
    const light = rd.light || {}, lens = rd.lens || {}, colour = rd.colour || {};
    return [
      [hjenRefNormalize([rd.searchPhrase, rd.searchPhraseAr, (rd.tags || []).join(' ')].join(' ')), 6],
      [hjenRefNormalize([rd.subject, rd.place, rd.action, (rd.objects || []).join(' ')].join(' ')), 4],
      [hjenRefNormalize([rd.inside, rd.craftMove, rd.culturalTruth].join(' ')), 3],
      [hjenRefNormalize([rd.time, rd.medium, light.key, colour.behaviour, lens.depth].join(' ')), 2],
      [r.blob, 1],
    ];
  };

  const pass = (minHits: number) => {
    const list: Array<{ r: HjenRefRecord; score: number; hits: number }> = [];
    for (const r of lib.records) {
      let hits = 0;
      for (const t of tokens) if (r.blob.includes(t)) hits++;
      if (hits < minHits) continue;
      // Weighted: each token scores ONCE, at the highest-value field it lands in.
      let weighted = 0;
      const fields = fieldsOf(r as any);
      for (const t of tokens) {
        let best = 0;
        for (const [text, w] of fields) if (w > best && text.includes(t)) best = w;
        weighted += best;
      }
      // the exact phrase still outranks scattered hits; quality breaks ties
      const score = hits * 10 + weighted * 4
        + (tokens.length > 1 && r.blob.includes(phrase) ? 15 : 0)
        + (r.q >= 3 ? 4 : r.q === 2 ? 2 : 0) + (r.analyzed ? 1 : 0);
      list.push({ r, score, hits });
    }
    return list;
  };
  // strict pass first; a zero-result strict pass falls back one notch so a
  // two-word query with one rare word still answers (loose, but honest).
  let scored = pass(need);
  let loose = false;
  if (scored.length === 0 && need > 1) { scored = pass(need - 1); loose = true; }
  scored.sort((a, b) => b.score - a.score);

  // diversity guard: cap frames per ad so one commercial can't flood the board.
  const perAd = new Map<string, number>();
  const out: any[] = [];
  for (const { r, score } of scored) {
    const n = perAd.get(r.ad) ?? 0;
    if (n >= 3) continue;
    perAd.set(r.ad, n + 1);
    out.push({
      id: r.id, ad: r.ad,
      filePath: path.join(lib.root, r.file),
      brand: r.brand, company: r.company, title: r.title, url: r.url,
      occasion: r.occasion, era: r.era, region: r.region,
      q: r.q, analyzed: r.analyzed,
      shotSize: r.shotSize, lightState: r.lightState,
      palette: r.palette, place: r.place,
      truthObjects: r.truthObjects, dims: r.dims,
      hasRead: !!r.hasRead, searchPhrase: r.searchPhrase ?? '',
      register: r.register ?? '', energy: r.energy ?? '',
      score,
    });
    if (out.length >= limit) break;
  }
  return { ok: true as const, results: out, loose };
});

ipcMain.handle('hjen:rename-library-asset', (_e: any, args: { id: string; name: string }) => {
  const arr = readLibrary();
  const target = arr.find(a => a.id === args.id);
  if (!target) return null;
  target.name = args.name.trim() || target.name;
  writeLibrary(arr);
  return target;
});

/** Move an asset to a different category. Physically relocates both the
 *  original file and the thumb to the new category folder so the index
 *  invariant (filePath under {libraryRoot}/{category}s/) holds. Used by
 *  the Library page's "Move to ▾" bulk action. */
ipcMain.handle('hjen:move-library-asset', (_e: any, args: { id: string; newCategory: LibCategory }) => {
  const arr = readLibrary();
  const target = arr.find(a => a.id === args.id);
  if (!target) return { ok: false, reason: 'not_found' };
  if (target.category === args.newCategory) return { ok: true, asset: target };

  const newDir = path.join(libraryRoot(), `${args.newCategory}s`);
  fs.mkdirSync(newDir, { recursive: true });
  const newFilePath = path.join(newDir, path.basename(target.filePath));
  const newThumbPath = path.join(newDir, path.basename(target.thumbPath));

  try {
    if (fs.existsSync(target.filePath)) fs.renameSync(target.filePath, newFilePath);
    if (fs.existsSync(target.thumbPath)) fs.renameSync(target.thumbPath, newThumbPath);
  } catch (e: any) {
    return { ok: false, reason: e?.message || 'move_failed' };
  }

  target.category = args.newCategory;
  target.filePath = newFilePath;
  target.thumbPath = newThumbPath;
  writeLibrary(arr);
  return { ok: true, asset: target };
});

/** One-shot cleanup pass: backfill SHA-256 hashes for any legacy entries
 *  that pre-date hash-on-add, then collapse duplicate groups (same hash
 *  + same category) down to a single survivor. The OLDEST entry in each
 *  group wins — past sidecars + layer references most likely point to
 *  those IDs, so keeping them avoids orphaning historical context.
 *  Returns a remap so the renderer can rewrite any in-memory layer that
 *  currently points to a deleted asset. */
ipcMain.handle('hjen:dedup-library', () => {
  const arr = readLibrary();
  let backfilled = 0;
  // Pass 1: backfill missing hashes.
  for (const a of arr) {
    if (a.contentHash) continue;
    try {
      if (!fs.existsSync(a.filePath)) continue;
      const buf = fs.readFileSync(a.filePath);
      a.contentHash = nodeCrypto.createHash('sha256').update(buf).digest('hex');
      backfilled++;
    } catch { /* skip unreadable files */ }
  }

  // Pass 2: group by hash+category, pick survivor, collect victims.
  const groups = new Map<string, LibraryAsset[]>();
  for (const a of arr) {
    if (!a.contentHash) continue;
    const key = `${a.category}::${a.contentHash}`;
    const g = groups.get(key) || [];
    g.push(a);
    groups.set(key, g);
  }

  const remap: Record<string, string> = {};
  const victims: LibraryAsset[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // Oldest wins. Sort ascending by addedAt; first entry is the keeper.
    group.sort((a, b) => (a.addedAt || '').localeCompare(b.addedAt || ''));
    const [survivor, ...dupes] = group;
    for (const d of dupes) {
      remap[d.id] = survivor.id;
      victims.push(d);
    }
  }

  // Pass 3: delete victim files on disk + remove from index.
  let freedBytes = 0;
  const victimIds = new Set(victims.map(v => v.id));
  for (const v of victims) {
    freedBytes += v.bytes || 0;
    try { if (fs.existsSync(v.filePath)) fs.unlinkSync(v.filePath); } catch {}
    try { if (fs.existsSync(v.thumbPath)) fs.unlinkSync(v.thumbPath); } catch {}
  }
  const survivors = arr.filter(a => !victimIds.has(a.id));
  writeLibrary(survivors);

  return {
    ok: true,
    backfilled,
    removed: victims.length,
    freedBytes,
    remap,           // { deletedId → survivorId }
    survivors,       // full new library state
  };
});

ipcMain.handle('hjen:pick-image-files', async () => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  if (!win) return null;
  const res = await dialog.showOpenDialog(win, {
    title: 'Add to reference library',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'tiff', 'bmp'] }],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  return res.filePaths;
});

// Any-file picker — the thinking canvas takes documents, decks, PDFs, audio,
// and video onto the board as file cards. Multi-select, grouped filters.
ipcMain.handle('hjen:pick-any-files', async (_e: any, args?: { title?: string }) => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  if (!win) return null;
  const res = await dialog.showOpenDialog(win, {
    title: args?.title || 'Add files to the board',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'All files', extensions: ['*'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'tiff', 'bmp'] },
      { name: 'Video', extensions: ['mp4', 'mov', 'webm', 'm4v'] },
      { name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'] },
      { name: 'Documents', extensions: ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'key', 'pages', 'txt', 'md', 'rtf', 'csv'] },
    ],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  return res.filePaths;
});

// Audio picker — same multi-select pattern as pick-image-files but for sound
// design refs. Stored under the same library tree, just in the 'audio' category.
ipcMain.handle('hjen:pick-audio-files', async () => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  if (!win) return null;
  const res = await dialog.showOpenDialog(win, {
    title: 'Add audio to reference library',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'] }],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  return res.filePaths;
});

// Video-file picker for a local BREAKDOWN run (skips the yt-dlp download).
ipcMain.handle('hjen:pick-video-file', async () => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  if (!win) return null;
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose a video to break down',
    properties: ['openFile'],
    filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'webm', 'mkv', 'm4v', 'avi'] }],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  return res.filePaths[0];
});

// Text-document picker — lets the user LOAD a script or a client brief from a
// file instead of pasting it. Reads text-based formats natively (zero-dep):
// plain text / markdown / screenplay (.fountain, .fdx XML) / .rtf (control
// words stripped) / .csv / .vtt / .srt. Binary decks (.pdf, .docx, .pptx,
// .pages, .key) can't be parsed without a dependency, so they come back with
// `unsupported: true` and the UI asks the user to paste or export to text.
ipcMain.handle('hjen:pick-text-document', async (_e: any, args?: { title?: string }) => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  if (!win) return null;
  const res = await dialog.showOpenDialog(win, {
    title: args?.title || 'Load from file',
    properties: ['openFile'],
    filters: [
      { name: 'Text & script', extensions: ['txt', 'md', 'markdown', 'text', 'fountain', 'fdx', 'rtf', 'csv', 'tsv', 'vtt', 'srt', 'json', 'xml', 'html'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (res.canceled || res.filePaths.length === 0) return null;

  const filePath = res.filePaths[0];
  const name = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();

  // Binary formats we can't read without a parser dependency.
  const BINARY = new Set(['.pdf', '.docx', '.doc', '.pptx', '.ppt', '.pages', '.key', '.numbers', '.xlsx', '.odt', '.zip']);
  if (BINARY.has(ext)) return { name, text: '', unsupported: true };

  try {
    let text = fs.readFileSync(filePath, 'utf-8');
    // Reject a binary that slipped through the filter (lots of NUL bytes).
    const head = text.slice(0, 4096);
    const nulls = (head.match(/\x00/g) || []).length;
    if (nulls > 8) return { name, text: '', unsupported: true };
    if (ext === '.rtf') text = stripRtf(text);
    if (ext === '.fdx' || ext === '.xml' || ext === '.html') text = stripMarkup(text);
    // Strip a UTF-8 BOM if present.
    text = text.replace(/^﻿/, '');
    return { name, text: text.trim() };
  } catch {
    return { name, text: '', unsupported: true };
  }
});

/** Best-effort RTF → plain text: drop control words, groups, and hex escapes. */
function stripRtf(rtf: string): string {
  return rtf
    .replace(/\\par[d]?/g, '\n')
    .replace(/\\tab/g, '\t')
    .replace(/\\'[0-9a-fA-F]{2}/g, '')          // hex-escaped bytes
    .replace(/\\[a-zA-Z]+-?\d* ?/g, '')          // control words
    .replace(/[{}]/g, '')                         // group braces
    .replace(/\\\r?\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Best-effort tag strip for .fdx/.xml/.html: keep text nodes, collapse space. */
function stripMarkup(s: string): string {
  return s
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|br|Paragraph|para)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Backfill thumbnails for existing PNGs that were saved before the
// thumbnail-on-save feature was added. Returns { processed, skipped, errors }.
ipcMain.handle('hjen:backfill-thumbnails', async (_e: any, args: { projectSlug?: string | null }) => {
  const bucket = args?.projectSlug || '_unassigned';
  const root = path.join(projectsRootPath(), bucket);
  if (!fs.existsSync(root)) return { processed: 0, skipped: 0, errors: 0 };

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  const dateFolders = (fs.readdirSync(root) as string[]).filter((d: string) => {
    const full = path.join(root, d);
    return fs.statSync(full).isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d);
  });

  for (const dateFolder of dateFolders) {
    const dir = path.join(root, dateFolder);
    const files = fs.readdirSync(dir) as string[];
    for (const f of files) {
      if (!f.endsWith('.png')) continue;
      const baseName = f.slice(0, -4);
      const imgPath = path.join(dir, f);
      const thumbPath = path.join(dir, `${baseName}.thumb.jpg`);
      if (fs.existsSync(thumbPath)) { skipped++; continue; }
      try {
        const buf = fs.readFileSync(imgPath);
        const native = electron.nativeImage.createFromBuffer(buf);
        const sz = native.getSize();
        const target = Math.min(sz.width, 1024);
        const scale = target / Math.max(1, sz.width);
        const tw = Math.max(1, Math.round(sz.width * scale));
        const th = Math.max(1, Math.round(sz.height * scale));
        const thumbBuf = native.resize({ width: tw, height: th, quality: 'best' }).toJPEG(88);
        fs.writeFileSync(thumbPath, thumbBuf);
        processed++;
      } catch (err) {
        console.warn(`[backfill] failed for ${imgPath}`, err);
        errors++;
      }
    }
  }

  return { processed, skipped, errors };
});

// ---------------------------------------------------------------------------
// Skills — Anthropic-style markdown skill files.
//
// In development the folder lives at <app-root>/skills so a creator can drop
// skills beside package.json and immediately see them in HJEN. Packaged apps
// cannot safely write inside their signed .app bundle, so the same folder is
// materialised under the app's writable data root. Bundled starter skills are
// copied there on first launch.
//
// Supported layouts:
//   skills/{slug}.md
//   skills/{slug}/SKILL.md
//
// Each file has YAML frontmatter (name/description/version) and a body that
// becomes the system prompt for the Claude call that produces the Master
// Prompt before image generation.

function skillsRoot(): string {
  const dir = app.isPackaged
    ? path.join(app.getPath('userData'), 'skills')
    : path.join(app.getAppPath(), 'skills');
  fs.mkdirSync(dir, { recursive: true });

  // Preserve skills imported by older development builds, which stored them
  // in userData before the app-root folder became the canonical dev source.
  const legacy = path.join(app.getPath('userData'), 'skills');
  const legacyMarker = path.join(legacy, '.migrated-to-app-root');
  if (legacy !== dir && fs.existsSync(legacy) && !fs.existsSync(legacyMarker)) {
    copyMissingSkillFiles(legacy, dir);
    try { fs.writeFileSync(legacyMarker, new Date().toISOString(), 'utf8'); } catch {}
  }

  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, 'skills');
    if (fs.existsSync(bundled)) copyMissingSkillFiles(bundled, dir);
  }
  return dir;
}

function copyMissingSkillFiles(sourceDir: string, destDir: string): void {
  try {
    fs.mkdirSync(destDir, { recursive: true });
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true }) as import('node:fs').Dirent[]) {
      if (entry.name.startsWith('.')) continue;
      const source = path.join(sourceDir, entry.name);
      const dest = path.join(destDir, entry.name);
      if (entry.isDirectory()) copyMissingSkillFiles(source, dest);
      else if (!fs.existsSync(dest)) fs.copyFileSync(source, dest);
    }
  } catch (e) {
    console.warn('[skills] could not seed bundled skills', e);
  }
}

function slugifySkillName(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (slug) return slug;
  // Arabic and other non-Latin names still need a stable, filesystem-safe id.
  const hash = nodeCrypto.createHash('sha1').update(String(name || 'skill')).digest('hex').slice(0, 10);
  return `skill-${hash}`;
}

function parseSkillFrontmatter(raw: string): { meta: Record<string, string>; body: string; hasFrontmatter: boolean } {
  // Strip UTF-8 BOM if present — common in files saved by Windows editors or
  // some macOS apps. Without this, the leading char is U+FEFF and the
  // `^---` regex below silently fails to match the frontmatter.
  let src = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  // Permit leading blank lines before the opening fence.
  src = src.replace(/^\s*\n+/, '');
  const m = src.match(/^---+\s*\n([\s\S]*?)\n---+\s*(?:\n|$)([\s\S]*)$/);
  if (!m) return { meta: {}, body: src.trim(), hasFrontmatter: false };
  const meta: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    // Allow optional leading whitespace before the key (some editors indent).
    const kv = line.match(/^\s*([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    meta[kv[1].toLowerCase()] = v;
  }
  return { meta, body: m[2].trim(), hasFrontmatter: true };
}

function skillFilesOnDisk(root: string): string[] {
  const files: string[] = [];
  const visit = (dir: string, depth: number) => {
    let entries: import('node:fs').Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) as import('node:fs').Dirent[]; }
    catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full, depth + 1);
        continue;
      }
      const lower = entry.name.toLowerCase();
      const isMarkdown = lower.endsWith('.md') || lower.endsWith('.markdown');
      // At the root, every markdown file is a skill. Inside a skill folder,
      // only SKILL.md is the entry point; reference markdown stays private.
      if (isMarkdown && (depth === 0 || lower === 'skill.md' || lower === 'skill.markdown')) files.push(full);
    }
  };
  visit(root, 0);
  return files.sort((a, b) => a.localeCompare(b));
}

function skillIdForFile(filePath: string, root: string): string {
  const relative = path.relative(root, filePath);
  const base = path.basename(relative).toLowerCase();
  if (base === 'skill.md' || base === 'skill.markdown') {
    return path.dirname(relative).split(path.sep).map(slugifySkillName).filter(Boolean).join('--') || 'skill';
  }
  return slugifySkillName(path.basename(relative, path.extname(relative)));
}

function readSkillFromDisk(filePath: string, root = skillsRoot()): any | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const { meta, body } = parseSkillFrontmatter(raw);
    const stat = fs.statSync(filePath);
    const id = skillIdForFile(filePath, root);
    if (!body) return null;
    return {
      id,
      name: meta.name || id,
      description: meta.description || '',
      version: meta.version || '',
      filePath,
      body,
      importedAt: stat.mtime.toISOString(),
      bytes: stat.size,
    };
  } catch (e) {
    console.warn('[skills] failed to read', filePath, e);
    return null;
  }
}

function listSkillsFromDisk(): any[] {
  const root = skillsRoot();
  const seen = new Set<string>();
  return skillFilesOnDisk(root)
    .map((filePath: string) => readSkillFromDisk(filePath, root))
    .filter((skill: any) => {
      if (!skill || seen.has(skill.id)) return false;
      seen.add(skill.id);
      return true;
    })
    .sort((a: any, b: any) => a.name.localeCompare(b.name));
}

function findSkillById(id: string): any | null {
  const safeId = String(id || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!safeId) return null;
  return listSkillsFromDisk().find((skill: any) => skill.id === safeId) || null;
}

ipcMain.handle('hjen:list-skills', () => {
  return listSkillsFromDisk();
});

ipcMain.handle('hjen:get-skills-folder', () => skillsRoot());

ipcMain.handle('hjen:open-skills-folder', async () => {
  const dir = skillsRoot();
  const error = await electron.shell.openPath(dir);
  return { ok: !error, path: dir, error: error || undefined };
});

ipcMain.handle('hjen:pick-skill-file', async () => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  if (!win) return null;
  const res = await dialog.showOpenDialog(win, {
    title: 'Import skill (Markdown)',
    properties: ['openFile'],
    filters: [{ name: 'Skill files', extensions: ['md', 'markdown'] }],
  });
  if (res.canceled || !res.filePaths?.[0]) return null;
  return res.filePaths[0];
});

ipcMain.handle('hjen:import-skill', (_e: any, args: { sourcePath: string }) => {
  if (!args?.sourcePath || !fs.existsSync(args.sourcePath)) {
    return { ok: false, reason: 'source_not_found' };
  }
  let raw: string;
  try { raw = fs.readFileSync(args.sourcePath, 'utf8'); }
  catch { return { ok: false, reason: 'read_failed' }; }

  const { meta, body, hasFrontmatter } = parseSkillFrontmatter(raw);
  if (!hasFrontmatter) return { ok: false, reason: 'no_frontmatter' };
  if (!body) return { ok: false, reason: 'empty_body' };
  if (!meta.name) return { ok: false, reason: 'missing_name', foundKeys: Object.keys(meta) };

  const slug = slugifySkillName(meta.name);
  const dest = path.join(skillsRoot(), `${slug}.md`);
  if (fs.existsSync(dest)) return { ok: false, reason: 'already_exists', existingId: slug };

  fs.writeFileSync(dest, raw, 'utf8');
  const skill = readSkillFromDisk(dest);
  if (!skill) return { ok: false, reason: 'parse_failed' };
  return { ok: true, skill };
});

ipcMain.handle('hjen:save-skill', (_e: any, args: {
  id?: string | null;
  name: string;
  description?: string;
  version?: string;
  body: string;
}) => {
  const name = String(args?.name || '').replace(/\r?\n/g, ' ').trim();
  const description = String(args?.description || '').replace(/\r?\n/g, ' ').trim();
  const version = String(args?.version || '').replace(/\r?\n/g, ' ').trim();
  const body = String(args?.body || '').trim();
  if (!name) return { ok: false, reason: 'missing_name' };
  if (!body) return { ok: false, reason: 'empty_body' };

  const existing = args?.id ? findSkillById(args.id) : null;
  if (args?.id && !existing) return { ok: false, reason: 'not_found' };
  const id = existing?.id || slugifySkillName(name);
  const filePath = existing?.filePath || path.join(skillsRoot(), `${id}.md`);
  if (!existing && fs.existsSync(filePath)) return { ok: false, reason: 'already_exists', existingId: id };

  const frontmatter = [
    '---',
    `name: ${name}`,
    ...(description ? [`description: ${description}`] : []),
    ...(version ? [`version: ${version}`] : []),
    '---',
    '',
  ].join('\n');
  const next = `${frontmatter}${body}\n`;
  const tempPath = `${filePath}.tmp-${process.pid}`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(tempPath, next, 'utf8');
    fs.renameSync(tempPath, filePath);
    const skill = readSkillFromDisk(filePath, skillsRoot());
    if (!skill) return { ok: false, reason: 'parse_failed' };
    return { ok: true, skill };
  } catch (e: any) {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
    return { ok: false, reason: 'write_failed', message: String(e?.message || e) };
  }
});

ipcMain.handle('hjen:delete-skill', (_e: any, args: { id: string }) => {
  if (!args?.id) return { ok: false };
  const skill = findSkillById(args.id);
  if (!skill?.filePath || !fs.existsSync(skill.filePath)) return { ok: false, reason: 'not_found' };
  try { fs.unlinkSync(skill.filePath); return { ok: true }; }
  catch (e: any) { return { ok: false, reason: 'unlink_failed', message: String(e?.message || e) }; }
});

// Frame Skill execution — the Settings-selected text model receives the skill
// body, Frame constraints and the actual attached images, then returns the
// Master Prompt that will be sent to the image API.

interface SkillRunEvent {
  ts: number;
  provider: 'anthropic' | 'openai' | 'google';
  model: string;
  skillId: string;
  skillName: string;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  rawPromptChars: number;
  masterPromptChars: number;
  rawPromptExcerpt?: string;
  masterPromptExcerpt?: string;
  referencesCount: number;
  settingsHash: string;
  contractRepaired: boolean;
  projectId?: string | null;
  projectSlug?: string | null;
  projectName?: string | null;
}

function skillRunsLogPath(): string {
  return path.join(projectsRootPath(), '_skill_runs.jsonl');
}

function appendSkillRunEvent(ev: SkillRunEvent) {
  try {
    fs.mkdirSync(projectsRootPath(), { recursive: true });
    fs.appendFileSync(skillRunsLogPath(), JSON.stringify(ev) + '\n');
  } catch (err) {
    console.warn('[skill-run] could not append to log', err);
  }
}

/** A Skill may declare an exact output-medium contract. Treat the first
 * MASTER STYLE LOCK in the body as executable policy, not as an example the
 * model may paraphrase away when the user's source brief says "photo". */
function skillMasterStyleLock(body: string): string | null {
  const line = String(body || '').split(/\r?\n/).find(value => /^MASTER STYLE LOCK\s*:/i.test(value.trim()));
  return line?.trim() || null;
}

function masterPromptHonorsStyleLock(prompt: string, requiredLock: string | null): boolean {
  if (!requiredLock) return true;
  return String(prompt || '').includes(requiredLock);
}

ipcMain.handle('hjen:list-skill-runs', () => {
  const p = skillRunsLogPath();
  if (!fs.existsSync(p)) return [];
  try {
    const lines = (fs.readFileSync(p, 'utf-8') as string).split(/\r?\n/).filter(Boolean);
    const out: SkillRunEvent[] = [];
    for (const line of lines) {
      try { out.push(JSON.parse(line)); } catch {}
    }
    return out;
  } catch {
    return [];
  }
});

ipcMain.handle('hjen:run-skill', async (_e: any, args: {
  skillId: string;
  prompt: string;
  references?: Array<{
    category?: string;
    name?: string;
    customName?: string;
    parentName?: string;
    filePath?: string;
  }>;
  settings?: Record<string, unknown>;
  projectId?: string | null;
  projectSlug?: string | null;
  projectName?: string | null;
}) => {
  const prompt = (args.prompt || '').trim();
  if (!prompt) {
    return { ok: false, reason: 'empty_prompt', message: 'Write a prompt first, then run a skill.' };
  }

  const safeId = String(args.skillId || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!safeId) return { ok: false, reason: 'invalid_skill', message: 'Invalid skill id.' };
  const skill = findSkillById(safeId);
  if (!skill) {
    return { ok: false, reason: 'skill_not_found', message: 'Skill file not found on disk.' };
  }
  if (!skill || !skill.body) {
    return { ok: false, reason: 'skill_unreadable', message: 'Could not parse the skill file.' };
  }

  // HJEN runs skills NON-INTERACTIVELY: there is no chat loop, the model's
  // output goes straight to the image API. Many published skills (especially
  // Anthropic-style ones) start by asking the user clarifying questions —
  // useless here, and the image model renders the literal questions as text.
  // This preamble hard-overrides that behavior. It is prepended to the skill
  // body so it cannot be ignored by the skill's own instructions.
  const NON_INTERACTIVE_PREAMBLE = `# HJEN EXECUTION CONTRACT (override any conflicting instructions below)

You are running inside HJEN Studio in a single-shot, non-interactive mode. There is NO user available to answer questions. Your output is sent directly to an image-generation API.

ABSOLUTE RULES:
1. NEVER ask the user anything. Forbidden openings include but are not limited to: "Tell me", "Before I build", "One question", "Give me", "I need from you", "Confirm", "Choose", "Which", "What", "Pick".
2. Read every attached image as evidence. The attachment inventory identifies each image's role. Preserve identity, wardrobe, location, prop and composition information according to those roles; never pretend an attached image was unseen.
3. Output ONLY the final, ready-to-paste Master Prompt for the image model. No preamble. No "Here is the prompt:". No explanation of your choices. No markdown headers. No closing remarks. Just the prompt body.
4. This execution produces ONE image. Resolve the strongest single instant from the user's brief and output ONE Master Prompt. Do not split into a shot list or multiple panels unless the user explicitly requests one composite storyboard sheet.
5. The skill body that follows is your style reference — APPLY it, do not narrate, summarize, or quote it back.
6. Frame settings are signed constraints. Do not silently replace the requested aspect, camera, lens, lighting, atmosphere, negative instructions or image model.
7. If a visual fact is absent from the brief, settings and attachments, choose the smallest production-plausible default. Never override supplied evidence with a guess.
8. STYLE AUTHORITY: the Skill body owns the FINAL output medium and rendering language. If the user brief says photo, film photograph, color photography, digital painting, 3D, sketch, or another medium that conflicts with the Skill, treat those words as SOURCE qualities to translate — era, light, texture, framing, mood — never as permission to abandon the Skill's medium.
9. When the Skill body declares a MASTER STYLE LOCK, the final Master Prompt MUST end with that exact lock. Do not rename it STYLE LOCK, paraphrase it, weaken it, or replace it with the user's source-medium request.

---

# SKILL BODY (style reference — apply, do not echo):

`;

  const references = (Array.isArray(args.references) ? args.references : [])
    .filter(ref => typeof ref?.filePath === 'string' && !!ref.filePath && fs.existsSync(ref.filePath))
    .slice(0, 14);
  const referencePaths = references.map(ref => String(ref.filePath));
  const referenceInventory = references.length
    ? references.map((ref, index) => {
        const label = String(ref.customName || ref.name || `Reference ${index + 1}`);
        const role = String(ref.category || 'general');
        const parent = ref.parentName ? `; belongs to ${ref.parentName}` : '';
        return `IMAGE ${index + 1}: ${label} [role=${role}${parent}]`;
      }).join('\n')
    : 'No reference images attached.';
  const settings = args.settings && typeof args.settings === 'object' ? args.settings : {};
  const settingsJson = JSON.stringify(settings, null, 2);
  const settingsHash = nodeCrypto.createHash('sha256').update(settingsJson).digest('hex').slice(0, 16);
  const executionPrompt = [
    `USER BRIEF:\n${prompt}`,
    `FRAME SETTINGS (signed constraints):\n${settingsJson}`,
    `ATTACHMENT INVENTORY (the attached images follow in this exact order):\n${referenceInventory}`,
    'Build the single final Master Prompt now. Integrate the visible evidence from every relevant attachment; do not describe the inventory as a separate appendix.',
  ].join('\n\n');

  const model = taskModelOverride('frame-skill') || 'claude-sonnet-4-6';
  const fallbackModel = taskModelOverride('frame-skill-fallback');
  const requiredStyleLock = skillMasterStyleLock(skill.body);

  const runSkillRequest = async (request: {
    system: string;
    prompt: string;
    maxTokens: number;
    imagePaths: string[];
  }, preferredModel = model) => {
    const routed = await runLlmWithFallback({
      models: frameSkillModelRoutes(preferredModel, fallbackModel),
      run: candidate => runLlmJson({
        provider: llmProvider(candidate),
        model: candidate,
        maxTokens: request.maxTokens,
        system: request.system,
        prompt: request.prompt,
        imagePaths: request.imagePaths,
      }),
    });
    if (routed.attempts.length > 1) {
      console.warn(`[skill-run] text route fallback: ${routed.attempts.join(' → ')}`);
    }
    return { ...routed, provider: llmProvider(routed.model) };
  };

  try {
    const routed = await runSkillRequest({
      maxTokens: 4096,
      system: NON_INTERACTIVE_PREAMBLE + skill.body,
      prompt: executionPrompt,
      imagePaths: referencePaths,
    });
    const res = routed.result;
    if (!res.ok) {
      return {
        ...res,
        message: routed.attempts.length > 1
          ? `Frame Skill could not reach an available text model. ${res.message || 'Try again in a moment.'}`
          : res.message,
      };
    }

    let usedModel = routed.model;
    let usedProvider = routed.provider;

    let text = String(res.text || '').trim();
    if (!text) {
      return { ok: false, reason: 'empty_response', message: 'Skill returned an empty response.' };
    }

    let inputTokens = res.usage?.inputTokens ?? 0;
    let outputTokens = res.usage?.outputTokens ?? 0;
    let anthropicInputTokens = usedProvider === 'anthropic' ? inputTokens : 0;
    let anthropicOutputTokens = usedProvider === 'anthropic' ? outputTokens : 0;
    let contractRepaired = false;

    // A model can follow a source phrase such as "film photograph" and ignore
    // the active Skill's ink-storyboard medium. Never let that invalid draft
    // reach a paid image make. One bounded compliance pass starts on the model
    // that produced the draft, with the same cross-provider safety route, then
    // we verify the exact lock.
    if (!masterPromptHonorsStyleLock(text, requiredStyleLock)) {
      const repairRoute = await runSkillRequest({
        maxTokens: 4096,
        imagePaths: referencePaths,
        system: `You are HJEN Studio's strict Master Prompt compliance editor. Rewrite the supplied draft as ONE complete image-generation Master Prompt. The active Skill owns the final visual medium and outranks conflicting medium words in the source brief. Preserve all scene facts, people, blocking, era, mood, camera logic and production details, but TRANSLATE photographic source language into the Skill's required medium. Output only the rewritten Master Prompt. End with the REQUIRED MASTER STYLE LOCK verbatim, character-for-character.`,
        prompt: [
          `USER BRIEF (scene facts; any conflicting output medium is subordinate):\n${prompt}`,
          `FRAME SETTINGS:\n${settingsJson}`,
          `ATTACHMENT INVENTORY:\n${referenceInventory}`,
          `INVALID DRAFT MASTER PROMPT:\n${text}`,
          `REQUIRED MASTER STYLE LOCK (append verbatim as the final paragraph):\n${requiredStyleLock || ''}`,
        ].join('\n\n'),
      }, usedModel);
      const repair = repairRoute.result;
      if (!repair.ok || !repair.text) {
        return {
          ok: false,
          reason: 'skill_contract_failed',
          message: `The text model returned a Master Prompt that violated the active Skill's style lock, and the compliance pass failed: ${repair.message || 'empty response'}`,
        };
      }
      usedModel = repairRoute.model;
      usedProvider = repairRoute.provider;
      inputTokens += repair.usage?.inputTokens ?? 0;
      outputTokens += repair.usage?.outputTokens ?? 0;
      if (repairRoute.provider === 'anthropic') {
        anthropicInputTokens += repair.usage?.inputTokens ?? 0;
        anthropicOutputTokens += repair.usage?.outputTokens ?? 0;
      }
      text = String(repair.text).trim();
      contractRepaired = true;
      if (!masterPromptHonorsStyleLock(text, requiredStyleLock)) {
        return {
          ok: false,
          reason: 'skill_contract_failed',
          message: `The ${usedProvider} model did not honor the active Skill's required MASTER STYLE LOCK. Image generation was stopped before spending a make.`,
        };
      }
    }
    // Exact token pricing is currently maintained only for the Anthropic
    // house model. Do not invent a dollar amount for another vendor.
    const usd =
      (anthropicInputTokens / 1_000_000) * CLAUDE_PRICING.inputPerMTok +
      (anthropicOutputTokens / 1_000_000) * CLAUDE_PRICING.outputPerMTok;

    appendSkillRunEvent({
      ts: Date.now(),
      provider: usedProvider,
      model: usedModel,
      skillId: skill.id,
      skillName: skill.name,
      inputTokens,
      outputTokens,
      usd,
      rawPromptChars: prompt.length,
      masterPromptChars: text.length,
      rawPromptExcerpt: prompt.slice(0, 120),
      masterPromptExcerpt: text.slice(0, 120),
      referencesCount: referencePaths.length,
      settingsHash,
      contractRepaired,
      projectId: args.projectId ?? null,
      projectSlug: args.projectSlug ?? null,
      projectName: args.projectName ?? null,
    });

    return {
      ok: true,
      masterPrompt: text,
      usage: { inputTokens, outputTokens },
      usd,
      provider: usedProvider,
      model: usedModel,
      referencesCount: referencePaths.length,
      settingsHash,
      contractRepaired,
      skillId: skill.id,
      skillName: skill.name,
    };
  } catch (err: any) {
    return { ok: false, reason: 'network', message: err?.message || 'Network error contacting the text model.' };
  }
});
