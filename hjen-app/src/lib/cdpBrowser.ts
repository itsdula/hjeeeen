// A tiny CDP client that drives the user's real Chrome (launched by main with
// --remote-allow-origins=*) from the renderer over a native WebSocket. The
// renderer already IS Chromium, so it has WebSocket + can speak CDP directly;
// main only launches Chrome and hands us the page's ws URL (no CORS fights).
//
// This is how the reference hunt uses the user's LOGGED-IN Frameset session in
// a real, separate browser window — types the query into the search box, reads
// the rendered results, and screenshots each chosen frame's pixels.

export interface CdpSession {
  send: (method: string, params?: any) => Promise<any>;
  evaluate: <T = any>(expr: string) => Promise<T>;
  navigate: (url: string) => Promise<void>;
  screenshotClip: (rect: { x: number; y: number; width: number; height: number }) => Promise<string>;
  /** Read an image's PIXELS from inside the page via a CORS canvas — works
   *  regardless of window visibility (no black screenshots) and transcodes
   *  AVIF/webp → PNG. Returns base64 PNG, or '' on taint/failure. */
  capturePng: (src: string) => Promise<string>;
  /** Capture MANY srcs in ONE in-page pass (one CDP roundtrip, not N). Each
   *  is optionally downscaled to `maxEdge` for a fast judge payload. Returns a
   *  base64-PNG array aligned to `srcs` ('' where a capture failed). */
  capturePngBatch: (srcs: string[], maxEdge?: number) => Promise<string[]>;
  /** Poll a JS boolean expression until truthy or the budget runs out — the
   *  event-driven replacement for blind sleeps after a navigate. Tolerates
   *  evaluate errors (context destroyed mid-navigation) and keeps polling.
   *  Returns true if the signal fired, false on timeout. */
  waitFor: (pollExprJs: string, opts?: { timeoutMs?: number; intervalMs?: number }) => Promise<boolean>;
  /** Fetch an image's BYTES from inside the page (CORS-clean CDNs only) →
   *  base64 of its data URL. No canvas, no transcode — preserves the original
   *  encoding. Returns '' on failure so a canvas path can take over. */
  fetchImageBase64: (src: string) => Promise<string>;
  /** Type a query into the search box and press Enter. `focusWindow` brings the
   *  tab to front first (nice to watch) — parallel lanes pass false so they
   *  don't fight over the frontmost window. */
  typeSearch: (query: string, focusWindow?: boolean) => Promise<boolean>;
  /** Scroll to the bottom N times to trigger a grid's lazy/infinite load, so a
   *  harvest sees MANY results, not just the first viewport. Returns to top. */
  scrollToLoad: (times?: number, delayMs?: number) => Promise<void>;
  bringToFront: () => Promise<void>;
  close: () => void;
}

/** Connect to a page target's CDP WebSocket and return a small command API. */
export async function connectCdp(wsUrl: string): Promise<CdpSession> {
  const ws = new WebSocket(wsUrl);
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  let nextId = 1;

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('Could not open the Chrome CDP socket.'));
  });

  ws.onmessage = (ev) => {
    let msg: any;
    try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ''); } catch { return; }
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id)!; pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || 'CDP error'));
      else p.resolve(msg.result);
    }
  };

  const send = (method: string, params: any = {}): Promise<any> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`CDP ${method} timed out`)); } }, 30_000);
    });

  await send('Page.enable').catch(() => undefined);
  await send('Runtime.enable').catch(() => undefined);

  const evaluate = async <T = any>(expr: string): Promise<T> => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r?.result?.value as T;
  };

  const navigate = async (url: string) => {
    await send('Page.navigate', { url });
  };

  const bringToFront = async () => { await send('Page.bringToFront').catch(() => undefined); };

  const screenshotClip = async (rect: { x: number; y: number; width: number; height: number }): Promise<string> => {
    // A backgrounded/occluded Chrome tab is not composited on macOS, so its
    // screenshot comes back BLACK. Bring the page to front first — the user
    // wants to watch this window work anyway. Clip is VIEWPORT-relative to
    // match getBoundingClientRect, so no captureBeyondViewport.
    await bringToFront();
    const r = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 },
      captureBeyondViewport: false,
    });
    return r?.data as string; // base64 png
  };

  // Read pixels from inside the page — CORS canvas, immune to window occlusion.
  const capturePng = async (src: string): Promise<string> => {
    const b64 = await evaluate<string | null>(`(async () => {
      try {
        const im = new Image(); im.crossOrigin = 'anonymous';
        const ok = await new Promise(res => { im.onload = () => res(1); im.onerror = () => res(0); im.src = ${JSON.stringify(src)}; setTimeout(() => res(0), 6000); });
        if (!ok || !im.naturalWidth) return null;
        const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
        c.getContext('2d').drawImage(im, 0, 0);
        return c.toDataURL('image/png').split(',')[1] || null;
      } catch (e) { return null; }
    })()`).catch(() => null);
    return b64 || '';
  };

  // Capture a whole candidate set in one page pass. Downscaling to maxEdge keeps
  // the CDP return payload small and the vision judge fast — the judge doesn't
  // need full resolution, only the kept survivors are re-captured at full size.
  const capturePngBatch = async (srcs: string[], maxEdge = 1200): Promise<string[]> => {
    if (srcs.length === 0) return [];
    const arr = await evaluate<Array<string | null>>(`(async () => {
      const srcs = ${JSON.stringify(srcs)}; const maxEdge = ${maxEdge}; const out = [];
      for (const s of srcs) {
        try {
          const im = new Image(); im.crossOrigin = 'anonymous';
          const ok = await new Promise(res => { im.onload = () => res(1); im.onerror = () => res(0); im.src = s; setTimeout(() => res(0), 6000); });
          if (!ok || !im.naturalWidth) { out.push(null); continue; }
          let w = im.naturalWidth, h = im.naturalHeight;
          const scale = Math.min(1, maxEdge / Math.max(w, h));
          w = Math.round(w * scale); h = Math.round(h * scale);
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          c.getContext('2d').drawImage(im, 0, 0, w, h);
          out.push(c.toDataURL('image/png').split(',')[1] || null);
        } catch (e) { out.push(null); }
      }
      return out;
    })()`).catch(() => null);
    return Array.isArray(arr) ? arr.map(x => x || '') : srcs.map(() => '');
  };

  // Poll a boolean expression until truthy — the reliable ready-signal used
  // after a navigate (e.g. "≥10 result imgs mounted") instead of a fixed sleep.
  const waitFor = async (pollExprJs: string, opts: { timeoutMs?: number; intervalMs?: number } = {}): Promise<boolean> => {
    const timeoutMs = opts.timeoutMs ?? 15_000;
    const intervalMs = opts.intervalMs ?? 250;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      let ok = false;
      // During navigation Runtime.evaluate can throw (context destroyed) — swallow and keep polling.
      try { ok = await evaluate<boolean>(`!!(${pollExprJs})`); } catch { ok = false; }
      if (ok) return true;
      await new Promise(r => setTimeout(r, intervalMs));
    }
    return false;
  };

  // Read an image's raw bytes via an in-page fetch (the CDN is CORS-clean, so
  // this works from the page) → base64 of its data URL. Keeps the original
  // encoding (AVIF/WebP); returns '' on any failure so a canvas path can run.
  const fetchImageBase64 = async (src: string): Promise<string> => {
    const b64 = await evaluate<string | null>(`(async () => {
      try {
        const r = await fetch(${JSON.stringify(src)});
        if (!r.ok) return null;
        const blob = await r.blob();
        const dataUrl = await new Promise((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result);
          fr.onerror = () => rej(new Error('read failed'));
          fr.readAsDataURL(blob);
        });
        return typeof dataUrl === 'string' ? (dataUrl.split(',')[1] || null) : null;
      } catch (e) { return null; }
    })()`).catch(() => null);
    return b64 || '';
  };

  // Search the box: set the value the React-friendly way (native setter + input
  // event, so the SPA's own state updates), then fire Enter THREE ways — a CDP
  // hardware key, an in-page synthetic keydown/keypress/keyup, and a form submit
  // — because a bare CDP Enter often doesn't trigger a framework's search.
  const typeSearch = async (query: string, focusWindow = true): Promise<boolean> => {
    if (focusWindow) await bringToFront();
    const ok = await evaluate<boolean>(`(() => {
      const inp = document.querySelector('input[placeholder*="Search commercials" i], input[type="search"], input[placeholder*="Search" i], input[type="text"]');
      if (!inp) return false;
      inp.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(inp, ${JSON.stringify(query)});
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`).catch(() => false);
    if (!ok) return false;
    await new Promise(r => setTimeout(r, 200));
    for (const type of ['keyDown', 'keyUp'] as const) {
      await send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }).catch(() => undefined);
    }
    // belt-and-suspenders for SPAs that ignore the hardware key:
    await evaluate(`(() => {
      const inp = (document.activeElement && document.activeElement.tagName === 'INPUT')
        ? document.activeElement
        : document.querySelector('input[type="search"], input[placeholder*="Search" i], input[type="text"]');
      if (!inp) return 0;
      for (const t of ['keydown','keypress','keyup'])
        inp.dispatchEvent(new KeyboardEvent(t, { key:'Enter', code:'Enter', keyCode:13, which:13, bubbles:true, cancelable:true }));
      const f = inp.form || (inp.closest && inp.closest('form'));
      if (f) { try { f.requestSubmit ? f.requestSubmit() : f.submit(); } catch (e) {} }
      return 1;
    })()`).catch(() => undefined);
    return true;
  };

  const scrollToLoad = async (times = 3, delayMs = 900): Promise<void> => {
    for (let i = 0; i < times; i++) {
      await evaluate(`(() => { window.scrollTo(0, document.body.scrollHeight); return 1; })()`).catch(() => 0);
      await new Promise(r => setTimeout(r, delayMs));
    }
    await evaluate(`(() => { window.scrollTo(0, 0); return 1; })()`).catch(() => 0);
  };

  return { send, evaluate, navigate, screenshotClip, capturePng, capturePngBatch, waitFor, fetchImageBase64, typeSearch, scrollToLoad, bringToFront, close: () => { try { ws.close(); } catch { /* gone */ } } };
}
