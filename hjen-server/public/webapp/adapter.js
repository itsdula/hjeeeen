// HJEN Web Adapter — the cloud implementation of window.hjen.
//
// The desktop renderer is host-agnostic: it calls window.hjen for ALL storage,
// files, and AI. On desktop, Electron's preload provides it (local disk). On the
// web, THIS script provides it (cloud API) — injected before the renderer loads.
// Desktop code is never touched; this is its cloud twin.
//
// It mirrors the desktop preload contract EXACTLY (arg objects + return shapes
// from src/types/hjen-bridge.d.ts), so the SAME built renderer runs unmodified.
//
// Paths the renderer round-trips (imgPath / thumbPath / filePath) are synthetic
// tokens the server understands: cloudgen://<pid>/<gid>.<ext>, cloudlib://<file>.
// The renderer builds `hjen-file://<token>` <img src> in ~45 places — we can't
// touch those, and a Service Worker can't intercept a custom scheme, so we patch
// the img/video src setter to rewrite hjen-file://<token> → /api/file?path=…
//
// Auth: window.__hjenAuth = async () => <bearer token> (magic-link or Clerk).
(function () {
  var LS_TOKEN = 'hjen_web_token';
  var auth = window.__hjenAuth || (function () { return Promise.resolve(localStorage.getItem(LS_TOKEN) || ''); });
  var tokSync = function () { return localStorage.getItem(LS_TOKEN) || ''; };

  // ── multi-account isolation on a shared browser ──
  // localStorage is per-browser, not per-account, so a second account signing in
  // here must NOT inherit the first account's cached navigation / last project.
  // On boot, if the account (its token) changed since last time, clear the
  // account-scoped caches so the new account starts clean. The server already
  // scopes all DATA by the authenticated account — this only fixes local caches.
  try {
    var _tok = tokSync();
    if (_tok) {
      var _marker = 'acct:' + _tok.slice(0, 16);
      if (localStorage.getItem('hjen_acct_marker') !== _marker) {
        ['hjen.nav.v1', 'hjen_last_project', '__hjenOnlineHooked'].forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
        try { localStorage.setItem('hjen_acct_marker', _marker); } catch (e) {}
      }
    }
  } catch (e) { /* isolation guard is best-effort */ }

  // ── HTTP helpers ────────────────────────────────
  function api(path, opts) {
    opts = opts || {};
    return auth().then(function (t) {
      var headers = Object.assign({ Authorization: 'Bearer ' + t }, opts.headers || {});
      return fetch(path, Object.assign({}, opts, { headers: headers })).then(function (r) {
        return r.json().catch(function () { return { ok: false }; });
      });
    });
  }
  function post(path, body) {
    return api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  }
  // Generic JSON doc I/O (project- or account-scoped).
  function graphKey(scope) { return scope === 'space' ? 'space-graph' : 'graph'; }
  function pget(pid, key) { return api('/api/doc?scope=project&pid=' + encodeURIComponent(pid) + '&key=' + encodeURIComponent(key)).then(function (r) { return r.data; }); }
  function pput(pid, key, data) { return post('/api/doc', { scope: 'project', pid: pid, key: key, data: data }); }
  function aget(key) { return api('/api/doc?scope=account&key=' + encodeURIComponent(key)).then(function (r) { return r.data; }); }
  function aput(key, data) { return post('/api/doc', { scope: 'account', key: key, data: data }); }
  // Read-modify-write an account-scoped map doc (pending/failed jobs, cards).
  function amerge(key, fn, fallback) {
    return aget(key).then(function (cur) { var next = fn(cur || fallback); return aput(key, next).then(function () { return next; }); });
  }

  // ── hjen-file:// → /api/file rewriting ─────────────
  // w>0 asks the server for a display-sized WebP (fast) instead of the full
  // multi-MB master. All on-screen <img> use it; downloads use the master (no w).
  function fileUrl(token, w) {
    return '/api/file?path=' + encodeURIComponent(token) + (w ? '&w=' + w : '') + '&token=' + encodeURIComponent(tokSync());
  }
  var DISPLAY_W = 1600;
  // Grid/thumbnail contexts ask for a much smaller WebP than the 1600px display
  // image — a wall of generations should not pull dozens of 1600px files just to
  // paint 200px tiles. dispSrc(path,'thumb') routes here via window.__hjenDispUrl.
  var THUMB_W = 640;
  // Prefer the token-free, EDGE-CACHEABLE display URL (/i/<acc>/<pid>/<gid>/<w>.webp)
  // once we know this account's id — Cloudflare caches it near the user, so repeat
  // and shared views skip the round-trip to Frankfurt. Falls back to the
  // authenticated /api/file until the account id is known.
  function dispUrl(token, w) {
    var s = String(token);
    // Breakdown frame token → its server thumb route (Phase 5). cloudbd://<pid>/<slug>/<id>
    var bd = s.match(/^cloudbd:\/\/([^/]+)\/([^/]+)\/(.+)$/);
    if (bd) return '/api/breakdown/frame?pid=' + encodeURIComponent(bd[1]) + '&slug=' + encodeURIComponent(bd[2]) + '&id=' + encodeURIComponent(bd[3]) + '&kind=thumb&token=' + encodeURIComponent(tokSync());
    // Video (and anything non-image) is served whole — never routed through the
    // image resizer (which only knows stills and would 404 on an mp4).
    if (/\.(mp4|webm|mov|m4v|gif)$/i.test(s)) return fileUrl(token);
    var acc = window.__hjenAcc;
    var m = acc && s.match(/^cloudgen:\/\/([^/]+)\/([^.]+)\./);
    if (m) return '/i/' + encodeURIComponent(acc) + '/' + encodeURIComponent(m[1]) + '/' + encodeURIComponent(m[2]) + '/' + (w || DISPLAY_W) + '.webp';
    return fileUrl(token, w);
  }
  // A video's thumbnail is its poster frame (server extracts it with ffmpeg),
  // served through the image path — never the raw mp4 (an <img> can't show that).
  function posterUrl(token) {
    var acc = window.__hjenAcc;
    var m = acc && String(token).match(/^cloudgen:\/\/([^/]+)\/([^.]+)\./);
    if (m) return '/i/' + encodeURIComponent(acc) + '/' + encodeURIComponent(m[1]) + '/' + encodeURIComponent(m[2]) + '/640.webp';
    return '';
  }
  // <video>/<source>: whole clip (or resized image). <img>/poster: image only —
  // a video token resolves to its poster.
  function mediaSrc(v) {
    if (typeof v === 'string' && v.indexOf('hjen-file://') === 0) {
      var raw = v.slice('hjen-file://'.length);
      if (!raw || raw.indexOf('undefined') >= 0) return '';
      return dispUrl(raw, DISPLAY_W);
    }
    return v;
  }
  function imgSrc(v) {
    if (typeof v === 'string' && v.indexOf('hjen-file://') === 0) {
      var raw = v.slice('hjen-file://'.length);
      if (!raw || raw.indexOf('undefined') >= 0) return '';
      if (/\.(mp4|webm|mov|m4v)$/i.test(raw)) return posterUrl(raw);
      return dispUrl(raw, DISPLAY_W);
    }
    return v;
  }
  // Explicit sized-URL resolver for the renderer's dispSrc() helper. Grid tiles
  // pass kind 'thumb' (≈640px WebP); previews/lightbox pass 'display' (≈1600px).
  // Accepts a raw token (cloudgen://…) or an hjen-file://-prefixed one; a video
  // token resolves to its poster. Desktop has no adapter, so dispSrc there returns
  // the hjen-file:// URL unchanged and never reaches here.
  window.__hjenDispUrl = function (v, kind) {
    if (typeof v !== 'string' || !v) return '';
    var raw = v.indexOf('hjen-file://') === 0 ? v.slice('hjen-file://'.length) : v;
    if (!raw || raw.indexOf('undefined') >= 0) return '';
    if (/\.(mp4|webm|mov|m4v)$/i.test(raw)) return posterUrl(raw);
    return dispUrl(raw, kind === 'thumb' ? THUMB_W : DISPLAY_W);
  };
  try {
    var patch = function (Ctor, fn) {
      if (!Ctor) return; var d = Object.getOwnPropertyDescriptor(Ctor.prototype, 'src'); if (!d || !d.set) return;
      Object.defineProperty(Ctor.prototype, 'src', { configurable: true, enumerable: d.enumerable, get: function () { return d.get.call(this); }, set: function (v) { d.set.call(this, fn(v)); } });
    };
    patch(window.HTMLImageElement, imgSrc);
    patch(window.HTMLVideoElement, mediaSrc);
    patch(window.HTMLSourceElement, mediaSrc);
    var _setAttr = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      if ((name === 'src' || name === 'href' || name === 'poster') && typeof value === 'string' && value.indexOf('hjen-file://') === 0) {
        var isImg = name === 'poster' || this.tagName === 'IMG';
        value = isImg ? imgSrc(value) : mediaSrc(value);
      }
      return _setAttr.call(this, name, value);
    };
  } catch (e) { console.warn('[HJEN] src patch failed', e); }

  // ── make resilience ────────────────────────────────
  // Tag every gateway image request with the active project + a signature so the
  // SERVER can persist the result the instant it's generated — the frame survives
  // a closed tab / lost connection, and appears in the library on return (the
  // credit was spent, so the result must not depend on the browser). The saved
  // paths queue here; saveGeneration consumes them instead of uploading a copy.
  var _serverSaved = [];
  try {
    var _origFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      if (typeof input === 'string' && (/\/v1\/openai\/images\//.test(input) || /\/api\/frame(\/submit)?$/.test(input))) {
        init = init || {};
        var h = new Headers(init.headers || {});
        h.set('X-HJEN-Project', localStorage.getItem('hjen_last_project') || '');
        h.set('X-HJEN-Sig', 'sig-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36));
        init.headers = h;
        return _origFetch(input, init).then(function (res) {
          try { var s = res.headers.get('x-hjen-saved'); if (s) _serverSaved.push(s); } catch (e) {}
          return res;
        });
      }
      return _origFetch(input, init);
    };
  } catch (e) { console.warn('[HJEN] fetch patch failed', e); }

  // ── browser file pickers → upload:// stash ─────────
  // Desktop pickers return filesystem paths; the web has none. We read picked
  // Files to base64, stash them under an upload://<id> token, and hand those back
  // so addToLibrary / references can upload the bytes on demand.
  var uploadStash = {};
  function readAsBase64(file) {
    return new Promise(function (res) {
      var r = new FileReader();
      r.onload = function () { res(String(r.result || '').replace(/^data:[^,]+,/, '')); };
      r.onerror = function () { res(''); };
      r.readAsDataURL(file);
    });
  }
  function pickFiles(accept, multiple) {
    return new Promise(function (resolve) {
      var i = document.createElement('input'); i.type = 'file'; i.accept = accept || ''; i.multiple = !!multiple;
      i.onchange = function () {
        var files = Array.prototype.slice.call(i.files || []);
        Promise.all(files.map(function (f) {
          return readAsBase64(f).then(function (b64) {
            var id = 'u' + Math.abs(hash(f.name + f.size + b64.length)).toString(36) + b64.length.toString(36);
            var ext = (f.name.split('.').pop() || 'png').toLowerCase();
            var tok = 'upload://' + id + '.' + ext;
            uploadStash[tok] = { base64: b64, ext: ext, name: f.name };
            return tok;
          });
        })).then(resolve);
      };
      i.click();
    });
  }
  function hash(s) { var h = 0; for (var k = 0; k < s.length; k++) { h = (h * 31 + s.charCodeAt(k)) | 0; } return h; }
  function download(name, data) {
    var blob = data instanceof Blob ? data : (typeof data === 'string' && /^[A-Za-z0-9+/=]+$/.test(data.slice(0, 40))
      ? b64ToBlob(data) : new Blob([data]));
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }
  function b64ToBlob(b64) { try { var bin = atob(b64); var arr = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); return new Blob([arr]); } catch (e) { return new Blob([b64]); } }

  var noop = function () {};
  var okTrue = function () { return Promise.resolve({ ok: true }); };
  var nullP = function () { return Promise.resolve(null); };
  var emptyArr = function () { return Promise.resolve([]); };
  var unsupported = function (msg) { return function () { return Promise.resolve({ ok: false, reason: 'desktop_only', message: msg || 'Available in the desktop app.' }); }; };
  var onNoop = function () { return noop; };
  // The clipper door is a localhost server on the desktop — on web the browser
  // already IS the app, so the whole surface reports "not running".
  var NO_CLIPPER = function () {
    return {
      running: false, port: 0, url: '', extensionDir: '', browsers: [],
      prefs: { contextMenu: false, hoverBadge: false, shortcut: false, notify: false, minSize: 200, projectId: '' },
    };
  };
  var iso = function () { return new Date().toISOString(); };

  // ── the one text-LLM door ──────────────────────────
  // Faithful port of the desktop main's hjen:llm-json: build the vendor request
  // (OpenAI/Anthropic/Google) here, route it through the funded gateway (/v1/llm,
  // which injects the real key), then parse the RAW vendor response to {ok,text}.
  // This is what makes Brief Mind / Treatment / Story / Advisor / Pitch produce output.
  function resolveImagesB64(paths) {
    return Promise.all((paths || []).map(function (p) {
      if (uploadStash[p]) { var e = uploadStash[p].ext; return Promise.resolve({ mime: 'image/' + (e === 'jpg' ? 'jpeg' : e), data: uploadStash[p].base64 }); }
      return fetch(fileUrl(p)).then(function (r) { return r.ok ? r.blob() : null; }).then(function (b) {
        if (!b) return null;
        return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res({ mime: b.type || 'image/png', data: String(fr.result).replace(/^data:[^,]+,/, '') }); }; fr.readAsDataURL(b); });
      }).catch(function () { return null; });
    })).then(function (a) { return a.filter(Boolean); });
  }
  // Audio for the BREAKDOWN sound pass. Only Google accepts inline audio in the
  // same shape as images. This was MISSING on web: the desktop sent audioPaths
  // and the browser silently dropped them, so the sound axis on web read the
  // captions and never heard the ad. Same resolver shape as the images above.
  function resolveAudioB64(paths) {
    return Promise.all((paths || []).map(function (p) {
      return fetch(fileUrl(p)).then(function (r) { return r.ok ? r.blob() : null; }).then(function (b) {
        if (!b) return null;
        var ext = String(p).toLowerCase().split('.').pop();
        var mime = b.type || (ext === 'mp3' ? 'audio/mp3' : ext === 'wav' ? 'audio/wav'
          : ext === 'ogg' ? 'audio/ogg' : ext === 'flac' ? 'audio/flac'
          : ext === 'aac' ? 'audio/aac' : 'audio/mp4');
        return new Promise(function (res) {
          var fr = new FileReader();
          fr.onload = function () { res({ mime: mime, data: String(fr.result).replace(/^data:[^,]+,/, '') }); };
          fr.readAsDataURL(b);
        });
      }).catch(function () { return null; });
    })).then(function (a) { return a.filter(Boolean); });
  }
  function llmCall(a) {
    var provider = String(a.provider || ''), model = String(a.model || '');
    var prompt = String(a.prompt || '').trim();
    if (!prompt) return Promise.resolve({ ok: false, reason: 'empty_prompt', message: 'Nothing to send.' });
    var maxTokens = Math.min(Math.max(a.maxTokens || 8192, 512), 32000);
    var imgPaths = (a.imagePaths && a.imagePaths.length) ? a.imagePaths : (a.imagePath ? [a.imagePath] : []);
    var audPaths = (provider === 'google' && a.audioPaths && a.audioPaths.length) ? a.audioPaths : [];
    return Promise.all([resolveImagesB64(imgPaths), resolveAudioB64(audPaths)]).then(function (both) {
      var images = both[0], audio = both[1];
      var url = '', headers = {}, body = null;
      // When a promptId is present, the SERVER injects the system prompt (recipe
      // stays off the wire) — so send an EMPTY system here and route to /v1/llm-task.
      var sys = a.promptId ? '' : (a.system || '');
      if (provider === 'anthropic') {
        url = 'https://api.anthropic.com/v1/messages';
        headers = { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' };
        var c = images.map(function (i) { return { type: 'image', source: { type: 'base64', media_type: i.mime, data: i.data } }; });
        c.push({ type: 'text', text: prompt });
        body = { model: model, max_tokens: maxTokens, system: sys, messages: [{ role: 'user', content: c }] };
      } else if (provider === 'openai') {
        url = 'https://api.openai.com/v1/chat/completions';
        headers = { 'content-type': 'application/json' };
        var c2 = images.map(function (i) { return { type: 'image_url', image_url: { url: 'data:' + i.mime + ';base64,' + i.data } }; });
        c2.push({ type: 'text', text: prompt });
        body = { model: model, max_completion_tokens: maxTokens, messages: (sys ? [{ role: 'system', content: sys }] : []).concat([{ role: 'user', content: c2 }]) };
      } else if (provider === 'google') {
        url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=x';
        headers = { 'content-type': 'application/json' };
        var parts = []; if (sys) parts.push({ text: sys });
        images.forEach(function (i) { parts.push({ inline_data: { mime_type: i.mime, data: i.data } }); });
        audio.forEach(function (x) { parts.push({ inline_data: { mime_type: x.mime, data: x.data } }); });
        parts.push({ text: prompt });
        body = { contents: [{ role: 'user', parts: parts }], generationConfig: { maxOutputTokens: maxTokens } };
      } else { return { ok: false, reason: 'bad_provider', message: 'Unknown provider "' + provider + '".' }; }
      var endpoint = a.promptId ? '/v1/llm-task' : '/v1/llm';
      var payload = { provider: provider, upstreamUrl: url, headers: headers, body: body };
      if (a.promptId) { payload.promptId = a.promptId; payload.vars = a.vars || {}; }
      return auth().then(function (t) {
        return fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: JSON.stringify(payload) });
      }).then(function (res) {
        return res.text().then(function (txt) {
          if (!res.ok) return { ok: false, reason: 'api_error', message: provider + ' ' + res.status + ': ' + txt.slice(0, 400) };
          var data = {}; try { data = JSON.parse(txt); } catch (e) {}
          var out = '', truncated = false, usage = { inputTokens: 0, outputTokens: 0 };
          if (provider === 'anthropic') { out = Array.isArray(data.content) ? data.content.filter(function (x) { return x.type === 'text'; }).map(function (x) { return x.text; }).join('\n').trim() : ''; truncated = data.stop_reason === 'max_tokens'; usage = { inputTokens: (data.usage && data.usage.input_tokens) || 0, outputTokens: (data.usage && data.usage.output_tokens) || 0 }; }
          else if (provider === 'openai') { var ch = data.choices && data.choices[0]; out = String((ch && ch.message && ch.message.content) || '').trim(); truncated = ch && ch.finish_reason === 'length'; usage = { inputTokens: (data.usage && data.usage.prompt_tokens) || 0, outputTokens: (data.usage && data.usage.completion_tokens) || 0 }; }
          else { var cand = data.candidates && data.candidates[0]; out = Array.isArray(cand && cand.content && cand.content.parts) ? cand.content.parts.map(function (x) { return x.text || ''; }).join('\n').trim() : ''; truncated = cand && cand.finishReason === 'MAX_TOKENS'; }
          if (!out) return { ok: false, reason: 'empty', message: provider + ' returned no text.' };
          return { ok: true, text: out, truncated: truncated, model: model, usage: usage };
        });
      });
    });
  }

  // ── ProjectState → ProjectMeta mirror patch ────────
  function metaPatchFromState(state) {
    var patch = {};
    if (state && state.currentStage) patch.currentStage = state.currentStage;
    if (state && state.stages) {
      var m = {}; Object.keys(state.stages).forEach(function (k) { m[k] = (state.stages[k] && state.stages[k].status) || 'draft'; });
      patch.stagesState = m;
    }
    return patch;
  }

  // ══ Panel documents · Mood Board + Timeline ═══════════════════════
  // Desktop keeps one JSON file per document under the project folder, plus an
  // index.json and a rolling backups/ directory, and rebuilds the index by
  // reading the folder. The cloud KV has no folder to read, so here the index
  // is MAINTAINED on every write rather than derived — that is the one honest
  // difference. Everything the desktop guarantees about the DATA is kept:
  // monotonic rev, refuse-empty-overwrite, stale-rev refusal, rolling backups
  // and heal-from-backup on a missing document.
  var PANEL_KINDS = {
    moodboard: {
      populated: function (d) { return !!d && Array.isArray(d.items) && d.items.length > 0; },
      summarize: function (d) {
        var items = (d && Array.isArray(d.items)) ? d.items : [];
        var cover = null;
        for (var i = 0; i < items.length; i++) {
          if (items[i] && items[i].kind !== 'note' && items[i].src) { cover = items[i]; break; }
        }
        return { count: items.length, coverPath: cover ? cover.src : undefined };
      },
    },
    timeline: {
      populated: function (d) {
        if (!d || !Array.isArray(d.tracks)) return false;
        for (var i = 0; i < d.tracks.length; i++) {
          var c = d.tracks[i] && d.tracks[i].clips;
          if (c && c.length) return true;
        }
        return false;
      },
      summarize: function (d) {
        var tracks = (d && Array.isArray(d.tracks)) ? d.tracks : [];
        var clips = [];
        tracks.forEach(function (t) { ((t && t.clips) || []).forEach(function (c) { clips.push(c); }); });
        var cover = null;
        for (var i = 0; i < clips.length && !cover; i++) if (clips[i] && clips[i].thumb) cover = clips[i];
        for (var j = 0; j < clips.length && !cover; j++) if (clips[j] && clips[j].kind === 'image' && clips[j].src) cover = clips[j];
        return { count: clips.length, coverPath: cover ? (cover.thumb || cover.src) : undefined };
      },
    },
  };
  function panelKind(k) { return Object.prototype.hasOwnProperty.call(PANEL_KINDS, k) ? PANEL_KINDS[k] : null; }
  // Same sanitiser as the desktop's panelDocPath — a docId can never escape.
  function safeDocId(id) { return String(id || '').replace(/[^\w-]+/g, '').slice(0, 48); }
  function panelDocKey(kind, docId) { return 'panel-' + kind + '-' + safeDocId(docId); }
  function panelIndexKey(kind) { return 'panel-' + kind + '-index'; }
  function panelBakKey(kind, docId) { return panelDocKey(kind, docId) + '-bak'; }

  // Rolling backups — the last 8 populated revisions, newest last. Identical
  // consecutive revisions are skipped so drag-spam cannot flush the history.
  function pushBackup(pid, kind, docId, prevDoc) {
    var key = panelBakKey(kind, docId);
    return pget(pid, key).then(function (bak) {
      var revs = (bak && Array.isArray(bak.revs)) ? bak.revs : [];
      var last = revs.length ? revs[revs.length - 1] : null;
      try { if (last && JSON.stringify(last) === JSON.stringify(prevDoc)) return true; } catch (e) {}
      revs.push(prevDoc);
      while (revs.length > 8) revs.shift();
      return pput(pid, key, { revs: revs });
    });
  }
  function indexUpsert(pid, kind, doc) {
    return pget(pid, panelIndexKey(kind)).then(function (idx) {
      var docs = (idx && Array.isArray(idx.docs)) ? idx.docs : [];
      var row = Object.assign(
        { id: doc.id, name: doc.name || 'Untitled', updatedAt: doc.updatedAt || '', rev: doc.rev || 0 },
        PANEL_KINDS[kind].summarize(doc)
      );
      var at = -1;
      for (var i = 0; i < docs.length; i++) if (docs[i] && docs[i].id === doc.id) { at = i; break; }
      if (at >= 0) docs[at] = row; else docs.push(row);
      return pput(pid, panelIndexKey(kind), { version: 1, docs: docs });
    });
  }
  function indexRemove(pid, kind, docId) {
    return pget(pid, panelIndexKey(kind)).then(function (idx) {
      var docs = (idx && Array.isArray(idx.docs)) ? idx.docs : [];
      return pput(pid, panelIndexKey(kind), {
        version: 1,
        docs: docs.filter(function (d) { return !d || d.id !== docId; }),
      });
    });
  }

  // doc-changed fan-out. Desktop sends the event to every BrowserWindow so a
  // torn-off panel and the dock stay in step; each listener filters by its own
  // sourceId. The web has no detached windows, but it DOES have second tabs on
  // the same board, so the same event goes to in-page listeners and, across
  // tabs of this browser, over a BroadcastChannel.
  var docListeners = [];
  var docChan = null;
  try { docChan = new BroadcastChannel('hjen-doc-changed'); } catch (e) { docChan = null; }
  function emitDocChanged(payload, fromChannel) {
    docListeners.slice().forEach(function (cb) { try { cb(payload); } catch (e) {} });
    if (!fromChannel && docChan) { try { docChan.postMessage(payload); } catch (e) {} }
  }
  if (docChan) docChan.onmessage = function (e) { emitDocChanged(e.data, true); };

  // ══ Small keyed-collection store ══════════════════════════════════
  // Cuts sessions, Film Space sessions/presets/packs, Context cards and
  // Assistant conversations are all the same shape on disk: an index plus one
  // document each. One helper serves all of them against account docs.
  function collIndex(ns) { return ns + '-index'; }
  function collItem(ns, id) { return ns + '-' + String(id || '').replace(/[^\w-]+/g, '').slice(0, 64); }
  function collList(ns) {
    return aget(collIndex(ns)).then(function (idx) { return (idx && Array.isArray(idx.rows)) ? idx.rows : []; });
  }
  function collUpsert(ns, row) {
    return aget(collIndex(ns)).then(function (idx) {
      var rows = (idx && Array.isArray(idx.rows)) ? idx.rows : [];
      var at = -1;
      for (var i = 0; i < rows.length; i++) if (rows[i] && rows[i].id === row.id) { at = i; break; }
      if (at >= 0) rows[at] = Object.assign({}, rows[at], row); else rows.push(row);
      return aput(collIndex(ns), { rows: rows });
    });
  }
  function collRemove(ns, id) {
    return aget(collIndex(ns)).then(function (idx) {
      var rows = (idx && Array.isArray(idx.rows)) ? idx.rows : [];
      return aput(collIndex(ns), { rows: rows.filter(function (r) { return !r || r.id !== id; }) });
    });
  }


  // ══ Ad Breakdown keys ═════════════════════════════════════════════
  // The renderer never passes a project id to the breakdown doors (on desktop
  // they resolve against the app's own breakdowns folder), so the web side
  // scopes them to the project the studio currently has open.
  function curPid() { try { return localStorage.getItem('hjen_last_project') || ''; } catch (e) { return ''; } }
  function bdKey(slug) { return 'breakdown-' + String(slug || '').replace(/[^\w-]+/g, '').slice(0, 64); }
  function bdIndexUpsert(pid, slug, bd) {
    return pget(pid, 'breakdown-index').then(function (idx) {
      var rows = (idx && Array.isArray(idx.rows)) ? idx.rows : [];
      var row = {
        slug: slug,
        title: (bd && (bd.title || bd.name)) || slug,
        brand: (bd && bd.brand) || '',
        approved: !!(bd && bd.approved),
        frames: (bd && Array.isArray(bd.frames)) ? bd.frames.length : ((bd && bd.frames) || 0),
      };
      var at = -1;
      for (var i = 0; i < rows.length; i++) if (rows[i] && rows[i].slug === slug) { at = i; break; }
      if (at >= 0) rows[at] = Object.assign({}, rows[at], row); else rows.push(row);
      return pput(pid, 'breakdown-index', { rows: rows });
    });
  }
  // Thin poster for the ported engines (see the block inside H).
  var engine = function (door) { return function (a) { return post('/api/engine/' + door, a || {}); }; };
  // Thin poster for the Cuts doors (see the block inside H).
  var cuts = function (door) { return function (a) { return post('/api/cuts/' + door, a || {}); }; };
  // base64 → Blob without blowing the stack on a 100MB video.
  function b64ToBlob(b64) {
    var bin = atob(b64), len = bin.length, bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes]);
  }

  var H = {
    // ══ Projects ══════════════════════════════════
    getProjects: function () {
      return api('/api/projects').then(function (r) {
        return { projects: r.projects || [], projectsRoot: r.projectsRoot || 'cloud://', lastProjectId: r.lastProjectId || null };
      });
    },
    setLastProjectId: function (id) { return post('/api/projects', { op: 'setLast', id: id }); },
    createProject: function (a) { return post('/api/projects', { op: 'create', name: (a && a.name) || 'Untitled' }).then(function (r) { return r.project; }); },
    deleteProject: function (a) { return post('/api/projects', { op: 'delete', id: a && a.id }).then(function () { return { ok: true }; }); },
    renameProject: function (a) { return post('/api/projects', { op: 'rename', id: a && a.id, name: a && a.name }).then(function (r) { return r.project || null; }); },
    setProjectCover: function (a) { return post('/api/projects', { op: 'cover', id: a && a.id, imgPath: a && a.imgPath }).then(function (r) { return r.project || null; }); },

    // ══ Per-project pipeline state / stages ══════════
    readProjectState: function (a) { return pget(a.id, 'state'); },
    writeProjectState: function (a) {
      return pput(a.id, 'state', a.state).then(function () {
        return post('/api/projects', { op: 'patchMeta', id: a.id, patch: metaPatchFromState(a.state) }).then(function (r) { return r.project || null; });
      });
    },
    readStageData: function (a) { return pget(a.id, 'stage_' + a.stage); },
    writeStageData: function (a) { return pput(a.id, 'stage_' + a.stage, a.data).then(function () { return { ok: true }; }); },

    // ══ Storyboard / graph / project docs ════════════
    readStoryboard: function (a) { return pget(a.id, 'storyboard'); },
    writeStoryboard: function (a) { return pput(a.id, 'storyboard', a.data).then(function () { return { ok: true }; }); },
    listStoryboardBackups: function () { return Promise.resolve({ ok: true, backups: [] }); },
    restoreStoryboardBackup: function () { return Promise.resolve({ ok: false, reason: 'no_backups' }); },
    readBoardLooks: function () { return aget('boardlooks').then(function (d) { return { ok: true, looks: (d && d.looks) || [] }; }); },
    writeBoardLooks: function (a) { return aput('boardlooks', { looks: a.looks || [] }).then(function () { return { ok: true }; }); },
    // HJEN NODE and HJEN SPACE are two workspaces over one engine — separate
    // project docs, exactly like the desktop's _node/ vs _space/ folders.
    readGraph: function (a) { return pget(a.id, graphKey(a.scope)); },
    writeGraph: function (a) { return pput(a.id, graphKey(a.scope), a.doc).then(function () { return { ok: true }; }); },
    projectDocRead: function (a) { return pget(a.id, 'doc_' + a.name); },
    projectDocWrite: function (a) { return pput(a.id, 'doc_' + a.name, a.data).then(function () { return { ok: true }; }); },

    // ══ Creative Mind / account docs ═════════════════
    mindNotesRead: function () { return aget('mindnotes').then(function (d) { return { ok: true, notes: (d && d.notes) || [] }; }); },
    mindNotesWrite: function (a) { return aput('mindnotes', { notes: a.notes || [] }).then(function () { return { ok: true }; }); },
    myMindRead: function () { return aget('mymind').then(function (d) { return { ok: true, items: (d && d.items) || [] }; }); },
    myMindWrite: function (a) { return aput('mymind', { items: a.items || [] }).then(function () { return { ok: true }; }); },
    mindBraincardsRead: function () { return aget('braincards').then(function (d) { return { ok: true, cards: (d && d.cards) || [] }; }); },
    mindBraincardsWrite: function (a) { return aput('braincards', { cards: a.cards || [] }).then(function () { return { ok: true }; }); },
    mindBoardPaths: function () { return Promise.resolve({ ok: true, paths: {} }); },

    // ══ Ad Breakdown — read AND write ════════════════
    // The video pipeline runs on the server and leaves a manifest, which
    // /api/breakdown/read assembles. But the RUN then edits the breakdown in the
    // renderer (Arabic pass, DNA edits, REMAKE/RE-FUSE) and calls
    // mindBreakdownWrite to persist it. That write had nowhere to go on the web,
    // so a finished run was assembled, shown, and lost on reload. The authored
    // copy now lands in a project doc, and READ prefers it over the manifest —
    // the manifest stays the ingest record, the doc is the owner's version.
    mindBreakdownWrite: function (a) {
      a = a || {};
      var slug = String(a.slug || '');
      var pid = curPid();
      if (!slug || slug.indexOf('..') >= 0 || slug.indexOf('/') >= 0) return Promise.resolve({ ok: false, message: 'bad slug' });
      if (!a.breakdown || typeof a.breakdown !== 'object') return Promise.resolve({ ok: false, message: 'no breakdown' });
      if (!pid) return Promise.resolve({ ok: false, message: 'no project' });
      return pput(pid, bdKey(slug), a.breakdown)
        .then(function () { return bdIndexUpsert(pid, slug, a.breakdown); })
        .then(function () { return { ok: true, slug: slug }; });
    },
    mindBreakdownRead: function (a) {
      a = a || {};
      var slug = String(a.slug || ''), pid = curPid();
      if (!pid || !slug) return Promise.resolve({ ok: false });
      return pget(pid, bdKey(slug)).then(function (doc) {
        if (doc) return { ok: true, found: true, breakdown: doc };
        return api('/api/breakdown/read?pid=' + encodeURIComponent(pid) + '&slug=' + encodeURIComponent(slug));
      });
    },
    mindBreakdownsList: function () {
      var pid = curPid();
      if (!pid) return Promise.resolve({ ok: true, breakdowns: [] });
      return Promise.all([
        api('/api/breakdown/list?pid=' + encodeURIComponent(pid)).catch(function () { return { breakdowns: [] }; }),
        pget(pid, 'breakdown-index'),
      ]).then(function (r) {
        var server = (r[0] && r[0].breakdowns) || [];
        var mine = (r[1] && Array.isArray(r[1].rows)) ? r[1].rows : [];
        // The authored row wins on slug — it carries the owner's title/approval.
        var bySlug = {};
        server.forEach(function (b) { if (b && b.slug) bySlug[b.slug] = b; });
        mine.forEach(function (b) { if (b && b.slug) bySlug[b.slug] = Object.assign({}, bySlug[b.slug] || {}, b); });
        return { ok: true, breakdowns: Object.keys(bySlug).map(function (k) { return bySlug[k]; }) };
      });
    },
    mindBreakdownRename: function (a) {
      a = a || {};
      var slug = String(a.slug || ''), title = String(a.title || ''), pid = curPid();
      if (!pid || !slug || !title.trim()) return Promise.resolve({ ok: false, message: 'bad rename' });
      return pget(pid, bdKey(slug)).then(function (doc) {
        var next = Object.assign({}, doc || {}, { title: title });
        return pput(pid, bdKey(slug), next).then(function () { return bdIndexUpsert(pid, slug, next); });
      }).then(function () { return { ok: true, title: title }; });
    },
    mindBreakdownDelete: function (a) {
      a = a || {};
      var slug = String(a.slug || ''), pid = curPid();
      if (!pid || !slug) return Promise.resolve({ ok: false, message: 'bad slug' });
      return pput(pid, bdKey(slug), null)
        .then(function () { return pget(pid, 'breakdown-index'); })
        .then(function (idx) {
          var rows = (idx && Array.isArray(idx.rows)) ? idx.rows : [];
          return pput(pid, 'breakdown-index', { rows: rows.filter(function (x) { return !x || x.slug !== slug; }) });
        })
        .then(function () { return { ok: true }; });
    },
    mindBreakdownApprove: function (a) {
      a = a || {};
      var slug = String(a.slug || ''), pid = curPid();
      if (!pid || !slug) return Promise.resolve({ ok: false });
      return pget(pid, bdKey(slug)).then(function (doc) {
        var next = Object.assign({}, doc || {}, { approved: true });
        return pput(pid, bdKey(slug), next).then(function () { return bdIndexUpsert(pid, slug, next); });
      }).then(function () { return { ok: true }; });
    },
    // Per-axis DNA gems, one doc per breakdown keyed by axis (the desktop keeps
    // them as <axis>.gem.md files under the breakdown folder).
    mindBreakdownDnaRead: function (a) {
      a = a || {};
      var pid = curPid(), slug = String(a.slug || ''), axis = String(a.axis || '');
      if (!pid || !slug || !axis) return Promise.resolve({ ok: false });
      return pget(pid, bdKey(slug) + '-dna').then(function (d) {
        var text = d && d.axes ? d.axes[axis] : '';
        return text ? { ok: true, text: text } : { ok: false };
      });
    },
    mindBreakdownDnaWrite: function (a) {
      a = a || {};
      var pid = curPid(), slug = String(a.slug || ''), axis = String(a.axis || ''), text = String(a.text || '');
      if (!pid || !slug) return Promise.resolve({ ok: false, message: 'bad slug' });
      if (!axis || !/^[a-z_]+$/.test(axis)) return Promise.resolve({ ok: false, message: 'bad axis' });
      if (!text.trim()) return Promise.resolve({ ok: false, message: 'empty DNA' });
      return pget(pid, bdKey(slug) + '-dna').then(function (d) {
        var axes = (d && d.axes) || {};
        axes[axis] = text;
        return pput(pid, bdKey(slug) + '-dna', { axes: axes });
      }).then(function () { return { ok: true, axis: axis }; });
    },
    mindBreakdownDnaList: function () {
      var pid = curPid();
      if (!pid) return Promise.resolve({ ok: true, slugs: [] });
      return pget(pid, 'breakdown-index').then(function (idx) {
        var rows = (idx && Array.isArray(idx.rows)) ? idx.rows : [];
        return { ok: true, slugs: rows.map(function (r) { return r && r.slug; }).filter(Boolean) };
      });
    },
    // The Arabic rewrite pass stores its output beside the breakdown.
    mindBreakdownWriteArabic: function (a) {
      a = a || {};
      var pid = curPid(), slug = String(a.slug || '');
      if (!pid || !slug) return Promise.resolve({ ok: false });
      return pput(pid, bdKey(slug) + '-ar', a.data).then(function () { return { ok: true }; });
    },
    // The PDF is rendered by a hidden Electron print window onto the user's disk.
    mindBreakdownExportPdf: unsupported('Export the breakdown as a PDF from the desktop app.'),

    // ══ Breakdown on WEB (server-side pipeline) ══════
    // The whole video pipeline runs on the server (ingest→dense→ASR→vision→docs).
    // pid defaults to the last-selected project. breakdownIngest uploads raw bytes.
    breakdownIngest: function (a) {
      a = a || {};
      var pid = a.projectId || localStorage.getItem('hjen_last_project') || '';
      // The video was picked via pickVideoFile → stashed as an upload:// token
      // (base64 in uploadStash). Retrieve its bytes and stream them to the server.
      var stashed = a.filePath && uploadStash[a.filePath];
      if (!stashed) return Promise.resolve({ ok: false, message: 'no video file' });
      var bin = atob(stashed.base64); var bytes = new Uint8Array(bin.length);
      for (var k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
      return auth().then(function (t) {
        return fetch('/api/breakdown/ingest', {
          method: 'POST',
          headers: { 'authorization': 'Bearer ' + t, 'content-type': 'application/octet-stream', 'x-hjen-project': pid, 'x-hjen-filename': stashed.name || 'video.mp4', 'x-hjen-slug': a.slug || '' },
          body: bytes,
        }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
          .then(function (res) { try { delete uploadStash[a.filePath]; } catch (e) {} return res; });
      });
    },
    breakdownRun: function (a) { a = a || {}; return post('/api/breakdown/run', { pid: a.projectId || localStorage.getItem('hjen_last_project') || '', slug: a.slug }); },
    breakdownRunStatus: function (a) { a = a || {}; return api('/api/breakdown/run-status?pid=' + encodeURIComponent(a.projectId || localStorage.getItem('hjen_last_project') || '') + '&slug=' + encodeURIComponent(a.slug || '')); },
    breakdownManifest: function (a) { a = a || {}; return api('/api/breakdown/manifest?pid=' + encodeURIComponent(a.projectId || localStorage.getItem('hjen_last_project') || '') + '&slug=' + encodeURIComponent(a.slug || '')); },
    breakdownTranscribe: function (a) { a = a || {}; return post('/api/breakdown/transcribe', { pid: a.projectId || localStorage.getItem('hjen_last_project') || '', slug: a.slug, language: a.language || 'auto' }); },
    breakdownDenseFrames: function (a) { a = a || {}; return post('/api/breakdown/dense', { pid: a.projectId || localStorage.getItem('hjen_last_project') || '', slug: a.slug, tcIn: a.tcIn, tcOut: a.tcOut, fps: a.fps }); },

    // Download a deliverable — the master file, with a clean name (Anwar's #1).
    // Web: trigger a real browser download of /api/file?...&download=1.
    downloadGeneration: function (a) {
      a = a || {};
      if (!a.filePath) return Promise.resolve({ ok: false });
      // Resolve the REAL token via auth() (Clerk JWT or magic-link) — tokSync() is
      // empty for Clerk accounts, which is why the download 404'd while display (a
      // token-free /i/ edge route) worked. /api/file accepts a Clerk JWT in ?token=.
      return auth().then(function (t) {
        var url = '/api/file?path=' + encodeURIComponent(a.filePath) + '&download=1&token=' + encodeURIComponent(t || '');
        try { var el = document.createElement('a'); el.href = url; el.download = a.name || ''; document.body.appendChild(el); el.click(); el.remove(); return { ok: true }; }
        catch (e) { return { ok: false, message: String(e) }; }
      });
    },

    // ══ Background jobs + crash recovery ═════════════
    jobsRead: function () { return aget('jobs'); },
    jobsWrite: function (a) { return aput('jobs', { version: 1, updatedAt: iso(), jobs: a.jobs || [] }).then(function () { return { ok: true }; }); },
    savePendingJob: function (a) { return amerge('pending', function (m) { m = m || {}; m[a.id] = a.payload; return m; }, {}).then(okTrue); },
    clearPendingJob: function (a) { return amerge('pending', function (m) { m = m || {}; delete m[a.id]; return m; }, {}).then(function () { return { ok: true }; }); },
    listPendingJobs: function () { return aget('pending').then(function (m) { return m ? Object.keys(m).map(function (k) { return m[k]; }) : []; }); },
    saveFailedJob: function (a) { return amerge('failed', function (m) { m = m || {}; m[a.id] = a.payload; return m; }, {}).then(okTrue); },
    listFailedJobs: function () { return aget('failed').then(function (m) { return m ? Object.keys(m).map(function (k) { return m[k]; }) : []; }); },
    deleteFailedJob: function (a) { return amerge('failed', function (m) { m = m || {}; delete m[a.id]; return m; }, {}).then(function () { return { ok: true }; }); },

    // ══ Generations ══════════════════════════════════
    saveGeneration: function (a) {
      // The server already persisted this make (resilient save) → reuse its path,
      // don't upload a duplicate.
      var pre = _serverSaved.shift();
      if (pre) {
        var b = pre.replace(/\.\w+$/, '');
        return Promise.resolve({ imgPath: pre, thumbPath: pre, jsonPath: b + '.json', dir: pre.replace(/\/[^/]+$/, '') });
      }
      return post('/api/gen', {
        pid: a.projectId, base64: a.base64, ext: 'png', sidecar: a.sidecar || {},
        promptSlug: a.promptSlug || 'frame', projectSlug: a.projectSlug || '', projectName: (a.sidecar && a.sidecar.projectName) || '',
      });
    },
    // Frames view = stills only; videos live in the Video view (listProjectVideos).
    listAllGenerations: function () { return api('/api/gens').then(function (r) { return (r.items || []).filter(function (x) { return !/\.(mp4|webm|mov)$/i.test(x.imgPath || ''); }); }); },
    listGenerationsLog: function () { return api('/api/gens').then(function (r) { return r.items || []; }); },
    // Files browser: only present/downloadable deliverables, each tagged with `tool`.
    filesList: function () { return api('/api/files').then(function (r) { return r.items || []; }); },
    listProjectFiles: function (a) {
      return api('/api/gens').then(function (r) {
        var slug = a && a.projectSlug;
        return (r.items || []).filter(function (x) { return !slug || x.projectSlug === slug; }).map(function (x) {
          return { imgPath: x.imgPath, thumbPath: x.thumbPath, jsonPath: x.jsonPath, dateFolder: x.dateFolder, baseName: x.baseName, promptTitle: x.promptTitle, size: x.finalSize, quality: x.quality, ts: x.ts, costUsd: x.costUsd, durationMs: x.durationMs, modelLabel: x.modelLabel };
        });
      });
    },
    readImageDataUrl: function (imgPath) { return Promise.resolve((imgPath && String(imgPath).indexOf('undefined') < 0) ? dispUrl(imgPath, DISPLAY_W) : null); },
    readSidecar: function (jsonPath) { return api('/api/sidecar?path=' + encodeURIComponent(jsonPath)).then(function (r) { return r.data; }); },
    deleteGeneration: function (a) { return post('/api/gen/delete', { imgPath: a.imgPath }).then(function () { return { ok: true }; }); },
    moveGeneration: function () { return Promise.resolve({ ok: false, reason: 'unsupported_web' }); },
    pathExists: function () { return Promise.resolve(true); },
    imageDims: function () { return Promise.resolve(null); },
    backfillThumbnails: function () { return Promise.resolve({ processed: 0, skipped: 0, errors: 0 }); },

    // ══ Reference library ════════════════════════════
    listLibrary: function () { return api('/api/lib').then(function (r) { return r.items || []; }); },
    addToLibrary: function (a) {
      var st = uploadStash[a.sourcePath];
      if (!st) return Promise.resolve({ ok: false, reason: 'source_not_found' });
      return post('/api/lib', { op: 'add', category: a.category, base64: st.base64, ext: st.ext, name: a.name }).then(function (r) { return { ok: !!r.asset, asset: r.asset }; });
    },
    deleteFromLibrary: function (a) { return post('/api/lib', { op: 'delete', id: a.id }).then(function () { return { ok: true }; }); },
    renameLibraryAsset: function (a) { return post('/api/lib', { op: 'rename', id: a.id, name: a.name }).then(function (r) { return r.asset || null; }); },
    moveLibraryAsset: function (a) { return post('/api/lib', { op: 'move', id: a.id, newCategory: a.newCategory }).then(function (r) { return { ok: !!r.asset, asset: r.asset }; }); },
    dedupLibrary: function () { return H.listLibrary().then(function (survivors) { return { ok: true, backfilled: 0, removed: 0, freedBytes: 0, remap: {}, survivors: survivors }; }); },
    listCharacterCards: function () { return aget('cards').then(function (d) { return (d && d.cards) || []; }); },
    saveCharacterCard: function (a) {
      var card = { id: a.id || ('c' + Date.now().toString(36)), name: a.name, profile: a.profile, mainAsset: a.mainAsset, references: (a.referencePaths || []).map(function (p) { return { filePath: p, name: '' }; }), savedAt: iso(), version: 1 };
      return amerge('cards', function (d) { d = d || { cards: [] }; d.cards = [card].concat((d.cards || []).filter(function (c) { return c.id !== card.id; })); return d; }, { cards: [] }).then(function () { return { ok: true, card: card }; });
    },
    deleteCharacterCard: function (a) { return amerge('cards', function (d) { d = d || { cards: [] }; d.cards = (d.cards || []).filter(function (c) { return c.id !== a.id; }); return d; }, { cards: [] }).then(function () { return { ok: true }; }); },

    // ══ Updates ══════════════════════════════════════
    // A browser tab has no installer: the newest build is whatever the server
    // is serving, so "check" is a reload. Mirrored from preload so the shared
    // UpdateCard renders on both hosts without a branch.
    checkForUpdates: function () {
      return Promise.resolve({ ok: true, state: 'current', current: 'web',
        message: 'The web app is always the latest version — reload the page to pick up a change.' });
    },
    onUpdateProgress: function () { return function () {}; },

    // ══ External tools ═══════════════════════════════
    // On the web the heavy lifting happens on the server, which has its own
    // ffmpeg/yt-dlp — there is nothing for the user to install, so the panel
    // reports an empty list and SettingsPage hides the tab on web anyway.
    toolsStatus: function () { return Promise.resolve({ ok: true, tools: [] }); },
    toolsRecheck: function () { return Promise.resolve({ ok: true, tools: [] }); },

    // ══ Native window chrome ═════════════════════════
    // A browser tab has no traffic lights at all, so the top bar reserves
    // nothing. Mirrored from preload.ts so the renderer reads one shape.
    chrome: { trafficLights: 'left' },

    // ══ Config / keys (server holds keys) ════════════
    getGateway: function () { return auth().then(function (t) { return { url: location.origin, token: t }; }); },
    setGateway: function () { return Promise.resolve(true); },
    getApiKey: nullP, getGoogleKey: nullP, getAnthropicKey: nullP, getReplicateKey: nullP, getArkKey: nullP, getKlingKey: nullP,
    setApiKey: function () { return Promise.resolve(true); }, setGoogleKey: function () { return Promise.resolve(true); },
    setAnthropicKey: function () { return Promise.resolve(true); }, setReplicateKey: function () { return Promise.resolve(true); },
    setArkKey: function () { return Promise.resolve(true); }, setKlingKey: function () { return Promise.resolve(true); },
    getThemeConfig: function () { return aget('theme'); },
    setThemeConfig: function (c) { return aput('theme', c).then(function () { return { ok: true }; }); },
    exportTheme: unsupported('Theme export is desktop-only.'),
    importTheme: nullP,
    getPricingConfig: nullP,
    setPricingConfig: okTrue,
    modelsConfigRead: function () { return aget('models').then(function (d) { return { ok: true, config: d || undefined }; }); },
    modelsConfigWrite: function (a) { return aput('models', a.config).then(function () { return { ok: true }; }); },
    langModeGet: function () { return aget('lang').then(function (d) { return { ok: true, mode: (d && d.mode) || 'en' }; }); },
    langModeSet: function (a) { return aput('lang', { mode: a.mode }).then(function () { return { ok: true }; }); },
    transcriptionConfigRead: function () { return Promise.resolve({ ok: true, config: { engine: 'openai', model: 'whisper-1', language: 'auto' } }); },
    transcriptionConfigWrite: function () { return Promise.resolve({ ok: true, config: { engine: 'openai', model: 'whisper-1', language: 'auto' } }); },
    getProjectsRoot: function () { return Promise.resolve('cloud://'); },
    setProjectsRoot: function () { return Promise.resolve({ ok: true, root: 'cloud://' }); },
    // Web-only account surface for the renderer's top-right menu: who's signed in,
    // the live credit, and sign-out. No-ops meaningfully on desktop.
    webAccount: function () { return api('/api/me').then(function (s) { if (s && s.acc) window.__hjenAcc = s.acc; return s && s.ok ? s : null; }).catch(function () { return null; }); },
    webSignOut: function () {
      localStorage.removeItem('hjen_web_token'); localStorage.removeItem('hjen_last_project');
      if (window.Clerk && window.Clerk.signOut) { try { window.Clerk.signOut({ redirectUrl: '/' }); return; } catch (e) {} }
      location.replace('/');
    },
    getPricingConfig: nullP,

    // ══ AI — routed through the funded gateway ═══════
    enhancePrompt: function (a) { return post('/api/enhance', a); },
    listEnhancements: emptyArr,
    llmJson: function (a) { return llmCall(a); },
    claudeJson: function (a) {
      return llmCall({ provider: 'anthropic', model: 'claude-sonnet-4-6', system: a.system, prompt: a.prompt, maxTokens: a.maxTokens, imagePaths: a.imagePaths || (a.imagePath ? [a.imagePath] : []) })
        .then(function (r) { return r.ok ? { ok: true, text: r.text, truncated: r.truncated, usage: r.usage || { inputTokens: 0, outputTokens: 0 }, usd: 0, model: r.model } : r; });
    },
    listSkills: function () { return api('/api/skills').then(function (r) { return (r.skills || []).map(function (s) { return { id: s.id, name: s.name, description: s.description || '', version: '', filePath: '', body: '', importedAt: '', bytes: 0 }; }); }); },
    getSkillsFolder: function () { return Promise.resolve('Skills are managed on the HJEN server'); },
    openSkillsFolder: function () { return Promise.resolve({ ok: false, path: '', error: 'The Skills folder is available in the desktop app.' }); },
    runSkill: function (a) { return post('/api/skill/run', a); },
    listSkillRuns: emptyArr,
    pickSkillFile: nullP,
    importSkill: unsupported('Import skills in the desktop app.'),
    saveSkill: unsupported('Create and edit skills in the desktop app.'),
    deleteSkill: okTrue,

    // ══ Video (submit → poll → server-side completion) ═
    // Build the vendor request here (like the desktop main) + tag it with the
    // project so the server worker finishes + saves the clip even if the tab
    // closes. Normalize submit/poll to the shapes the renderer expects.
    seedanceSubmit: function (a) {
      var ARK = 'https://ark.ap-southeast.bytepluses.com/api/v3';
      var content = [{ type: 'text', text: a.prompt || '' }];
      var imgs = [a.imagePath, a.endImagePath].filter(Boolean);
      return resolveImagesB64(imgs).then(function (r) {
        r.forEach(function (im, i) { content.push({ type: 'image_url', image_url: { url: 'data:' + im.mime + ';base64,' + im.data }, role: i === 0 ? 'first_frame' : 'last_frame' }); });
        var body = { model: a.modelId || 'dreamina-seedance-2-0-260128', content: content, resolution: a.resolution, duration: a.duration, ratio: a.ratio, fps: a.fps };
        if (a.seed != null) body.seed = a.seed;
        return auth().then(function (t) {
          return fetch('/v1/ark/submit', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t, 'X-HJEN-Project': localStorage.getItem('hjen_last_project') || '' }, body: JSON.stringify({ arkBase: ARK, body: body }) });
        }).then(function (res) { return res.json(); }).then(function (r) {
          var taskId = r.id || (r.data && r.data.id) || '';
          return taskId ? { ok: true, taskId: taskId, model: body.model, promptFull: a.prompt } : { ok: false, reason: 'submit_failed', message: (r && r.message) || 'submit failed' };
        });
      });
    },
    seedancePoll: function (a) {
      return post('/v1/ark/poll', { arkBase: 'https://ark.ap-southeast.bytepluses.com/api/v3', taskId: a.taskId }).then(function (r) {
        return { ok: true, status: r.status || 'running', videoUrl: (r.content && r.content.video_url) || null, usage: r.usage || null, errorMessage: r.error ? (r.error.message || String(r.error)) : null, raw: r };
      });
    },
    klingSubmit: function (a) {
      var KLING = 'https://api-singapore.klingai.com';
      var vt = a.imagePath ? 'image2video' : 'text2video';
      return resolveImagesB64([a.imagePath, a.endImagePath].filter(Boolean)).then(function (imgs) {
        var body = { model_name: a.modelName || 'kling-v3', prompt: a.prompt || '', negative_prompt: a.negativePrompt || '', mode: a.mode || 'std', duration: String(a.duration || 5), aspect_ratio: a.aspectRatio || '16:9' };
        if (a.cfgScale != null) body.cfg_scale = a.cfgScale;
        if (imgs[0]) body.image = imgs[0].data;
        if (imgs[1]) body.image_tail = imgs[1].data;
        return auth().then(function (t) {
          return fetch('/v1/kling/submit', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t, 'X-HJEN-Project': localStorage.getItem('hjen_last_project') || '' }, body: JSON.stringify({ klingBase: KLING, videoType: vt, body: body }) });
        }).then(function (res) { return res.json(); }).then(function (r) {
          var taskId = (r.data && r.data.task_id) || '';
          return taskId ? { ok: true, taskId: taskId, model: body.model_name, promptFull: a.prompt, videoType: vt } : { ok: false, reason: 'submit_failed', message: (r && r.message) || 'submit failed' };
        });
      });
    },
    klingPoll: function (a) {
      return post('/v1/kling/poll', { klingBase: 'https://api-singapore.klingai.com', videoType: a.videoType || 'text2video', taskId: a.taskId }).then(function (r) {
        var d = r.data || {}; var vids = (d.task_result && d.task_result.videos) || [];
        return { ok: true, status: d.task_status || 'processing', videoUrl: (vids[0] && vids[0].url) || null, usage: null, errorMessage: d.task_status_msg || null, raw: r };
      });
    },
    saveVideo: function (a) {
      return post('/api/gen', { pid: a.projectId, base64: a.base64, ext: 'mp4', sidecar: a.sidecar || {}, promptSlug: a.promptSlug || 'video', projectSlug: a.projectSlug || '' })
        .then(function (r) { return { videoPath: r.imgPath, jsonPath: r.jsonPath, dir: r.dir, thumbPath: a.posterPath || r.imgPath }; });
    },
    listProjectVideos: function (a) { return H.listProjectFiles(a).then(function (items) { return items.filter(function (x) { return /\.mp4$/.test(x.imgPath || ''); }); }); },
    saveFailedVideo: function (a) { return amerge('failed_videos', function (m) { m = m || {}; m[a.id] = a.payload; return m; }, {}).then(okTrue); },
    listFailedVideos: function () { return aget('failed_videos').then(function (m) { return m ? Object.keys(m).map(function (k) { return m[k]; }) : []; }); },
    deleteFailedVideo: function (a) { return amerge('failed_videos', function (m) { m = m || {}; delete m[a.id]; return m; }, {}).then(function () { return { ok: true }; }); },

    // ══ Native → browser equivalents / stubs ═════════
    pickImage: function () { return pickFiles('image/*', false).then(function (a) { return a[0] || null; }); },
    pickImageFiles: function () { return pickFiles('image/*', true); },
    pickVideoFile: function () { return pickFiles('video/*', false).then(function (a) { return a[0] || null; }); },
    pickAudioFiles: function () { return pickFiles('audio/*', true); },
    pickAnyFiles: function () { return pickFiles('*/*', true); },
    pickTextDocument: function () {
      return new Promise(function (resolve) {
        var i = document.createElement('input'); i.type = 'file'; i.accept = '.txt,.md,.markdown,.rtf';
        i.onchange = function () {
          var f = (i.files || [])[0]; if (!f) return resolve(null);
          if (!/\.(txt|md|markdown|rtf)$/i.test(f.name)) return resolve({ name: f.name, text: '', unsupported: true });
          var r = new FileReader(); r.onload = function () { resolve({ name: f.name, text: String(r.result || '') }); }; r.readAsText(f);
        };
        i.click();
      });
    },
    pathForFile: function () { return ''; },
    exportFile: function (a) { download(a.fileName, a.base64); return Promise.resolve({ ok: true, path: a.fileName }); },
    saveImageBase64: function (a) { download(a.fileName || 'image.png', a.base64); return Promise.resolve({ ok: true, path: a.fileName || 'image.png', bytes: 0 }); },
    exportStoryboard: unsupported('Export the storyboard from the desktop app.'),
    pitchPdf: unsupported('Render the pitch PDF in the desktop app.'),
    exportTimelineMp4: unsupported('Timeline export is desktop-only.'),
    exportTimelineFcpxml: unsupported('Timeline export is desktop-only.'),
    saveStoryboardImage: function (a) { return post('/api/gen', { pid: a.projectId, base64: a.base64, ext: 'png', sidecar: a.sidecar || {}, promptSlug: a.promptSlug || 'board', projectSlug: a.projectSlug || '' }).then(function (r) { return { imgPath: r.imgPath, jsonPath: r.jsonPath, dir: r.dir, thumbPath: r.thumbPath }; }); },
    saveEmulsion: unsupported('Emulsion is desktop-only.'),
    listEmulsion: emptyArr, // Emulsion render history — array shape (renderer .map()s it)
    projectToolDir: function (a) { return Promise.resolve({ ok: true, dir: 'cloud://tool/' + ((a && a.tool) || 'misc') }); },
    pickExportFolder: nullP, pickFolder: nullP,
    fontsDir: function () { return Promise.resolve(''); },
    listFonts: emptyArr,
    addFonts: function () { return Promise.resolve({ ok: false, reason: 'desktop_only' }); },
    removeFont: function () { return Promise.resolve({ ok: false, reason: 'desktop_only' }); },
    openFontsDir: function () { return Promise.resolve(false); },
    openFolder: function () { return Promise.resolve(false); },
    revealInFinder: function () { return Promise.resolve(false); },
    openInBrowser: function (u) { window.open(u, '_blank'); return Promise.resolve({ ok: true }); },
    openExternalUrl: function (u) { window.open(u, '_blank'); return Promise.resolve({ ok: true }); },

    // ══ Support inbox ════════════════════════════════
    submitSupport: function (a) { return amerge('support', function (d) { d = d || { tickets: [] }; var t = { id: 't' + Date.now().toString(36), ts: Date.now(), kind: a.kind, message: a.message, status: 'open', user: a.user, context: a.context }; d.tickets = [t].concat(d.tickets || []); return d; }, { tickets: [] }).then(function (d) { var t = d.tickets[0]; return { ok: true, id: t.id, ts: t.ts }; }); },
    listSupport: function () { return aget('support').then(function (d) { return (d && d.tickets) || []; }); },

    // ══ Browser door (desktop-only localhost bridge) ═══
    clipperStatus: function () { return Promise.resolve(NO_CLIPPER()); },
    clipperRevoke: function () { return Promise.resolve(NO_CLIPPER()); },
    clipperRevokeAll: function () { return Promise.resolve(NO_CLIPPER()); },
    clipperSetPrefs: function () { return Promise.resolve(NO_CLIPPER()); },

    // ══ HJEN REF (search-only, desktop corpus) ═══════
    refStatus: function () { return Promise.resolve({ ok: false, root: 'cloud://' }); },
    refSearch: function () { return Promise.resolve({ ok: false, reason: 'no_index', root: 'cloud://' }); },

    // ══ Event subscriptions → noop unsubscribers ═════
    onNavigate: onNoop, onReload: onNoop, onCommand: onNoop, onAssistantEvent: onNoop,
    onBreakdownProgress: onNoop, onFilmspacePoseProgress: onNoop, onWorldProgress: onNoop,
    onEmulsionVideoProgress: onNoop, onCutsEmbedProgress: onNoop,
    // Web has no electron-updater — a new version arrives on the next page load,
    // so these are inert (the desktop badge never shows on web).
    onUpdateReady: onNoop, onUpdateDownloading: onNoop,
    restartToUpdate: function () { return Promise.resolve({ ok: true }); },
    // Cloud-first sync is a DESKTOP concept (mirror cloud → a local folder). On web
    // the files already live in the cloud and are browsed via Files — so inert.
    syncGetConfig: function () { return Promise.resolve({ enabled: false, root: '' }); },
    syncSetEnabled: function () { return Promise.resolve({ enabled: false, root: '' }); },
    syncPickFolder: function () { return Promise.resolve({ ok: false, cancelled: true }); },
    syncPullNow: function () { return Promise.resolve({ ok: false, message: 'sync is desktop-only' }); },
    onSyncProgress: onNoop,
    // ══ Panel documents · Mood Board + Timeline ══════
    // Full port of the desktop store, including every safety rule. See the
    // PANEL_KINDS block above for the one honest difference (maintained index).
    docList: function (a) {
      if (!a || !panelKind(a.kind)) return Promise.resolve({ ok: false, message: 'No such panel kind.' });
      return pget(a.id, panelIndexKey(a.kind)).then(function (idx) {
        var docs = (idx && Array.isArray(idx.docs)) ? idx.docs.slice() : [];
        docs.sort(function (x, y) { return String((y && y.updatedAt) || '').localeCompare(String((x && x.updatedAt) || '')); });
        return { ok: true, docs: docs };
      });
    },
    docRead: function (a) {
      if (!a || !panelKind(a.kind)) return Promise.resolve({ ok: false, message: 'No such panel kind.' });
      var did = safeDocId(a.docId);
      if (!did) return Promise.resolve({ ok: false, message: 'Bad document id.' });
      var K = PANEL_KINDS[a.kind];
      return pget(a.id, panelDocKey(a.kind, did)).then(function (doc) {
        if (doc) return { ok: true, doc: doc };
        // Missing or unreadable — heal from the newest populated backup, which
        // is what makes "Delete" recoverable on desktop and here alike.
        return pget(a.id, panelBakKey(a.kind, did)).then(function (bak) {
          var revs = (bak && Array.isArray(bak.revs)) ? bak.revs : [];
          for (var i = revs.length - 1; i >= 0; i--) {
            if (K.populated(revs[i])) {
              var healed = revs[i];
              return pput(a.id, panelDocKey(a.kind, did), healed)
                .then(function () { return { ok: true, doc: healed, healed: true }; });
            }
          }
          return { ok: false, reason: 'not_found' };
        });
      });
    },
    docWrite: function (a) {
      if (!a || !panelKind(a.kind)) return Promise.resolve({ ok: false, reason: 'no_project' });
      var did = safeDocId(a.docId);
      if (!did) return Promise.resolve({ ok: false, reason: 'bad_id' });
      var K = PANEL_KINDS[a.kind], next = a.doc || {};
      return pget(a.id, panelDocKey(a.kind, did)).then(function (prev) {
        var backup = Promise.resolve(true);
        if (prev && K.populated(prev)) {
          backup = pushBackup(a.id, a.kind, did, prev);
          // The classic wipe: a populated document must never be replaced by an
          // empty one unless the caller says so (Clear board / Delete all).
          if (!K.populated(next) && !a.allowEmpty) {
            return backup.then(function () { return { ok: false, reason: 'refused_empty_overwrite' }; });
          }
        }
        // Two-tab race: the other tab already wrote a NEWER revision. Refuse and
        // hand the winner back so the loser rebases instead of clobbering it.
        if (prev && Number(prev.rev || 0) > Number(next.rev || 0)) {
          return backup.then(function () { return { ok: false, reason: 'stale', doc: prev }; });
        }
        var doc = Object.assign({}, next, {
          id: did,
          rev: Math.max(Number(next.rev || 0), Number((prev && prev.rev) || 0) + 1),
          updatedAt: new Date().toISOString(),
        });
        return backup
          .then(function () { return pput(a.id, panelDocKey(a.kind, did), doc); })
          .then(function () { return indexUpsert(a.id, a.kind, doc); })
          .then(function () {
            emitDocChanged({ projectId: a.id, kind: a.kind, docId: did, sourceId: a.sourceId || '', rev: doc.rev });
            return { ok: true, rev: doc.rev };
          });
      });
    },
    docCreate: function (a) {
      if (!a || !panelKind(a.kind)) return Promise.resolve({ ok: false, message: 'No such panel kind.' });
      // The blank document is built in the RENDERER (that is where the model
      // lives); this only stamps identity — same split as the desktop main.
      var docId = (a.kind === 'timeline' ? 'seq_' : 'mb_') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      var now = new Date().toISOString();
      var doc = Object.assign({}, a.doc || {}, {
        version: 1, id: docId,
        name: String(a.name || (a.kind === 'timeline' ? 'Sequence' : 'Mood Board')).slice(0, 60),
        createdAt: now, updatedAt: now, rev: 1,
      });
      return pput(a.id, panelDocKey(a.kind, docId), doc)
        .then(function () { return indexUpsert(a.id, a.kind, doc); })
        .then(function () {
          emitDocChanged({ projectId: a.id, kind: a.kind, docId: docId, sourceId: '', rev: 1 });
          return { ok: true, doc: doc };
        });
    },
    docDelete: function (a) {
      if (!a || !panelKind(a.kind)) return Promise.resolve({ ok: false });
      var did = safeDocId(a.docId);
      if (!did) return Promise.resolve({ ok: false });
      // NEVER a hard delete: the last state becomes a backup first, so "Delete"
      // stays recoverable exactly like a wiped board on desktop.
      return pget(a.id, panelDocKey(a.kind, did)).then(function (prev) {
        return prev ? pushBackup(a.id, a.kind, did, prev) : true;
      }).then(function () { return pput(a.id, panelDocKey(a.kind, did), null); })
        .then(function () { return indexRemove(a.id, a.kind, did); })
        .then(function () {
          emitDocChanged({ projectId: a.id, kind: a.kind, docId: did, sourceId: '', rev: 0 });
          return { ok: true };
        });
    },
    // Importing reads files off the user's disk by absolute path. A browser tab
    // has no such path — images come in through the picker/drop as bytes — so
    // this says so rather than failing as a mystery.
    docImport: unsupported('Add images with the picker or by dropping them on the board — importing from a disk path is desktop-only.'),
    onDocChanged: function (cb) {
      docListeners.push(cb);
      return function () { var i = docListeners.indexOf(cb); if (i >= 0) docListeners.splice(i, 1); };
    },

    // ══ Detached panel windows ═══════════════════════
    // Desktop tears a board off into its own BrowserWindow. A browser tab
    // cannot be told what to be at launch, so panels stay docked here and the
    // dock simply never shows one as "open".
    panelOpen: unsupported('Panels open in their own window in the desktop app; here they stay in the dock.'),
    panelClose: okTrue,
    panelList: function () { return Promise.resolve({ ok: true, open: [] }); },
    onPanelWindow: onNoop,

    // ══ The Swap — the project document ══════════════
    readSwapDoc: function (a) { return pget(a.id, 'swap'); },
    writeSwapDoc: function (a) {
      var next = a && a.doc ? a.doc : {};
      var populated = function (d) { return !!d && Array.isArray(d.sessions) && d.sessions.length > 0; };
      return pget(a.id, 'swap').then(function (prev) {
        if (prev && populated(prev)) {
          return pushBackup(a.id, 'swap', 'doc', prev).then(function () {
            // A read costs two vision calls and the decisions on top of it are
            // the owner's own work — an empty doc must never land on a
            // populated one by accident.
            if (!populated(next) && !a.allowEmpty) return { ok: false, reason: 'refused_empty_overwrite' };
            return pput(a.id, 'swap', next).then(function () { return { ok: true }; });
          });
        }
        return pput(a.id, 'swap', next).then(function () { return { ok: true }; });
      });
    },

    // ══ Ad Breakdown — resumable run state ═══════════
    breakdownRunstateRead: function (a) {
      return aget('breakdown-runstate-' + String((a && a.slug) || '')).then(function (d) {
        return d ? { ok: true, state: d } : { ok: false, message: 'No saved run.' };
      });
    },
    breakdownRunstateWrite: function (a) {
      return aput('breakdown-runstate-' + String((a && a.slug) || ''), a && a.state)
        .then(function () { return { ok: true }; });
    },
    breakdownRunstateClear: function (a) {
      return aput('breakdown-runstate-' + String((a && a.slug) || ''), null)
        .then(function () { return { ok: true }; });
    },

    // ══ Cuts — saved sessions ════════════════════════
    // Cuts is a global internal tool: the desktop lists EVERY session across all
    // project buckets so nothing disappears when the active project changes.
    // The cloud index is account-wide for the same reason.
    cutsSave: function (a) {
      var id = String((a && a.sessionId) || '');
      if (!id) return Promise.resolve({ ok: false, message: 'sessionId required' });
      var data = Object.assign({}, (a && a.data) || {}, { savedAt: Date.now() });
      return aput(collItem('cuts', id), data)
        .then(function () {
          return collUpsert('cuts', {
            id: id, sessionId: id,
            title: data.title, videoPath: data.videoPath, duration: data.duration,
            shots: Array.isArray(data.shots) ? data.shots.length : data.shots,
            scenes: Array.isArray(data.scenes) ? data.scenes.length : data.scenes,
            savedAt: data.savedAt, projectSlug: (a && a.projectSlug) || undefined,
          });
        })
        .then(function () { return { ok: true }; });
    },
    cutsList: function () {
      return collList('cuts').then(function (rows) {
        rows = rows.slice().sort(function (x, y) { return Number((y && y.savedAt) || 0) - Number((x && x.savedAt) || 0); });
        return { ok: true, sessions: rows };
      });
    },
    cutsLoad: function (a) {
      var id = String((a && a.sessionId) || '');
      return aget(collItem('cuts', id)).then(function (d) {
        return d ? { ok: true, data: d } : { ok: false, reason: 'not_found', message: 'No such session.' };
      });
    },
    cutsDelete: function (a) {
      var id = String((a && a.sessionId) || '');
      return aput(collItem('cuts', id), null)
        .then(function () { return collRemove('cuts', id); })
        .then(function () { return { ok: true }; });
    },

    // ══ Film Space — sessions + preset thumbnails ════
    // The Three.js stage itself runs in the browser, so saved sessions are worth
    // having here. Angle Packs are not: they are written as image files beside
    // the project on disk and read back by path.
    filmspaceSessionSave: function (a) {
      var id = String((a && a.sessionId) || ('fs_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)));
      var savedAt = Date.now();
      return aget(collItem('filmspace', id)).then(function (prev) {
        // Preserve any pack ids already recorded for the session.
        var packIds = (prev && Array.isArray(prev.packIds)) ? prev.packIds : [];
        var rec = {
          id: id, name: String((a && a.name) || 'Session'), savedAt: savedAt,
          packIds: packIds, state: a && a.state,
          thumbnail: (a && a.thumbnail) || null,
        };
        return aput(collItem('filmspace', id), rec)
          .then(function () { return collUpsert('filmspace', { id: id, name: rec.name, savedAt: savedAt, packIds: packIds }); })
          .then(function () { return { ok: true, sessionId: id, dir: 'cloud://filmspace/' + id, savedAt: savedAt, thumbPath: rec.thumbnail, packIds: packIds }; });
      });
    },
    filmspaceSessionsList: function () {
      return collList('filmspace').then(function (rows) {
        rows = rows.slice().sort(function (x, y) { return Number((y && y.savedAt) || 0) - Number((x && x.savedAt) || 0); });
        return {
          ok: true, sessionsRoot: 'cloud://filmspace',
          sessions: rows.map(function (r) {
            return { id: r.id, name: r.name || 'Session', savedAt: r.savedAt || 0, thumbPath: r.thumbPath || null, packIds: r.packIds || [], dir: 'cloud://filmspace/' + r.id };
          }),
        };
      });
    },
    filmspaceSessionGet: function (a) {
      var id = String((a && a.sessionId) || '');
      return aget(collItem('filmspace', id)).then(function (d) {
        return d
          ? { ok: true, id: id, name: d.name || 'Session', savedAt: d.savedAt || 0, packIds: d.packIds || [], state: d.state }
          : { ok: false, message: 'No such session.' };
      });
    },
    filmspaceSessionDelete: function (a) {
      var id = String((a && a.sessionId) || '');
      return aput(collItem('filmspace', id), null)
        .then(function () { return collRemove('filmspace', id); })
        .then(function () { return { ok: true, sessionId: id }; });
    },
    filmspacePresetsSave: function (a) {
      var items = (a && Array.isArray(a.items)) ? a.items : [];
      return aget('filmspace-presets').then(function (cur) {
        var map = (cur && cur.items) || {};
        items.forEach(function (it) { if (it && it.id) map[it.id] = it.dataUrl; });
        return aput('filmspace-presets', { items: map })
          .then(function () { return { ok: true, dir: 'cloud://filmspace/presets', count: Object.keys(map).length }; });
      });
    },
    filmspacePresetsList: function () {
      return aget('filmspace-presets').then(function (cur) {
        return { ok: true, dir: 'cloud://filmspace/presets', ids: Object.keys((cur && cur.items) || {}) };
      });
    },
    // Angle Packs are files on disk, written beside the project and read back by
    // path. Camera Angles asks for them as a source, so answer honestly with an
    // empty set rather than an error the picker cannot render.
    filmspacePacksList: function () { return Promise.resolve({ ok: true, packsRoot: 'cloud://filmspace/packs', packs: [] }); },

    // ══ Assistant conversations ══════════════════════
    conversationsList: function (a) {
      var slug = a && a.projectSlug;
      return collList('convo').then(function (rows) {
        rows = rows.filter(function (r) { return r && (!slug || r.projectSlug === slug); });
        rows.sort(function (x, y) { return String((y && y.updatedAt) || '').localeCompare(String((x && x.updatedAt) || '')); });
        return { ok: true, conversations: rows };
      });
    },
    conversationRead: function (a) {
      var id = String((a && a.id) || '');
      return aget(collItem('convo', id)).then(function (d) { return { ok: true, conversation: d || null }; });
    },
    conversationWrite: function (convo) {
      var id = String((convo && convo.id) || '');
      if (!id) return Promise.resolve({ ok: false, reason: 'no id' });
      var msgs = (convo && Array.isArray(convo.messages)) ? convo.messages : [];
      var rec = Object.assign({}, convo, { updatedAt: new Date().toISOString() });
      return aput(collItem('convo', id), rec)
        .then(function () {
          return collUpsert('convo', {
            id: id, title: rec.title || 'Conversation', kind: rec.kind || 'general',
            projectId: rec.projectId || null, projectName: rec.projectName || null,
            projectSlug: rec.projectSlug || null, updatedAt: rec.updatedAt, msgCount: msgs.length,
          });
        })
        .then(function () { return { ok: true, path: 'cloud://convo/' + id }; });
    },
    conversationDelete: function (a) {
      var id = String((a && a.id) || '');
      return aput(collItem('convo', id), null)
        .then(function () { return collRemove('convo', id); })
        .then(function () { return { ok: true }; });
    },

    // ══ MCP hub ══════════════════════════════════════
    // The HTTP endpoint is the one surface that means anything off the desktop:
    // there is no local mcp/ folder to run run.sh from, so the paths are named
    // as unavailable rather than invented.
    mcpEndpointConfig: function () {
      return Promise.resolve({
        mcpDir: '', runShPath: '', serveHttpPath: '',
        defaultHttpUrl: location.origin + '/mcp',
      });
    },
    mcpListServers: function () {
      return aget('mcp-servers').then(function (d) { return (d && Array.isArray(d.servers)) ? d.servers : []; });
    },
    mcpSetServers: function (servers) {
      return aput('mcp-servers', { servers: Array.isArray(servers) ? servers : [] })
        .then(function () { return { ok: true }; });
    },

    // ══ Ported creative engines ══════════════════════
    // The Eye, The Swap, Reference Maker and Context Agents were written for the
    // Electron MAIN process so their prompts would never reach a renderer. They
    // now run behind /api/engine/* on the server for exactly the same reason —
    // so these doors are thin posts, and the recipe never enters this bundle.

    // ── the Eye ──
    eyeRead: engine('eye/read'),
    eyeStatus: function () { return post('/api/engine/eye/status', {}); },
    eyeGoldenWrite: engine('eye/golden-write'),

    // ── The Swap ──
    swapSlots: engine('swap/slots'),
    swapConsequence: engine('swap/consequence'),
    swapPlan: engine('swap/plan'),
    swapCompose: engine('swap/compose'),
    swapVerify: engine('swap/verify'),
    swapGoldenWrite: engine('swap/golden-write'),
    swapStatus: function () { return post('/api/engine/swap/status', {}); },
    // The edge stencil is a pixel operation the desktop runs locally. Porting it
    // means matching the exact detector, not merely producing "an edge map" —
    // a different stencil silently changes what STRUCTURE locks onto.
    swapCanny: unsupported('Structure locks are built in the desktop app.'),

    // ── Reference Maker ──
    referenceSceneUnderstand: engine('reference/understand'),
    referenceSceneDrift: engine('reference/drift'),
    referenceSceneReviseContract: engine('reference/revise-contract'),
    // A generation already lives in the cloud, so it needs no copy — the scene
    // points at the token it already has. A deck PDF or a file off the device
    // has no cloud counterpart yet, and says so.
    referenceSceneImport: function (a) {
      a = a || {};
      var src = String(a.sourcePath || '');
      if (a.sourceKind === 'device' || !src || src.indexOf('cloud') !== 0) {
        return Promise.resolve({ ok: false, reason: 'desktop_only', message: 'Import from your device in the desktop app — here, add the image to the project first and pick it from References.' });
      }
      return Promise.resolve({
        ok: true,
        asset: {
          imagePath: src,
          sourceKind: a.sourceKind || 'reference',
          sourceId: a.sourceId,
          sourceName: String(a.name || ''),
          assetHash: src,
        },
      });
    },
    referenceDeckImport: unsupported('Importing a deck PDF is desktop-only — the pages are extracted on your machine.'),

    // ── Context Agents ──
    caApply: engine('ca/apply'),
    caVocab: function () { return post('/api/engine/ca/vocab', {}); },
    caListMethods: function () { return post('/api/engine/ca/list-methods', {}); },
    caListProfiles: function () { return post('/api/engine/ca/list-profiles', {}); },
    caReadCard: engine('ca/read-card'),
    caWriteCard: engine('ca/write-card'),
    caDeleteCard: engine('ca/delete-card'),
    caReadLexicon: function (a) { return post('/api/engine/ca/read-lexicon', a || {}); },
    caWriteLexiconEntry: engine('ca/write-lexicon'),
    caStatus: function () { return post('/api/engine/ca/status', {}); },
    // The trainer spawns a script that ships only with the source checkout — the
    // packaged desktop build answers the same way.
    caStudy: engine('ca/study'),
    onCaStudyProgress: onNoop,
    caEyePick: engine('ca/eye-pick'),
    caEyeQuery: engine('ca/eye-query'),
    caEyeConfirmFrames: engine('ca/eye-confirm'),
    caEyeJudge: engine('ca/eye-judge'),
    caEyeStatus: function () { return post('/api/engine/ca/eye-status', {}); },

    // ── remote bytes ──
    // Vendor CDNs send no CORS headers, so the browser cannot read a Kling or
    // Seedance result itself. The server fetches it (SSRF-guarded) and hands
    // back the bytes in the shape the desktop's main returns.
    fetchUrlBase64: function (u) {
      return post('/api/fetch-url', { url: String(u || '') }).then(function (r) {
        if (!r || !r.ok) return { ok: false, message: (r && r.message) || 'Could not fetch that URL.' };
        return { ok: true, base64: r.base64, bytes: Math.floor((r.base64 || '').length * 3 / 4) };
      });
    },

    // ══ Cuts — the whole tool, server-side ═══════════
    // ffmpeg finds the shots and six vision passes watch the ad, all on the
    // server. The video is uploaded once into the session's working area; every
    // door after that works from the cloudcuts:// token the upload returns.
    cutsAnalyze: cuts('analyze'),
    cutsShotFrames: cuts('shot-frames'),
    cutsSpeech: cuts('speech'),
    cutsVerify: cuts('verify'),
    cutsWatch: cuts('watch'),
    cutsPeople: cuts('people'),
    cutsVerifyGroups: cuts('verify-groups'),
    cutsDna: cuts('dna'),
    cutsStory: cuts('story'),
    cutsBrief: cuts('brief'),
    cutsSource: cuts('source'),
    cutsHasAudio: cuts('has-audio'),
    cutsEmbed: cuts('embed'),
    // The picker hands back an upload:// token holding the bytes; Cuts needs the
    // video ON the server before any pass can read it, so this streams it into
    // the session and answers with the token every later door expects.
    cutsFetch: function (a) {
      a = a || {};
      var stashed = a.url && uploadStash[a.url];
      if (!stashed) return post('/api/cuts/fetch', a);
      var sessionId = String(a.sessionId || ('cut_' + Date.now().toString(36)));
      return auth().then(function (t) {
        return fetch('/api/cuts/upload', {
          method: 'POST',
          headers: {
            authorization: 'Bearer ' + t,
            'content-type': 'application/octet-stream',
            'x-hjen-session': sessionId,
            'x-hjen-filename': stashed.name || ('video.' + (stashed.ext || 'mp4')),
          },
          body: b64ToBlob(stashed.base64),
        });
      }).then(function (r) { return r.json(); })
        .then(function (res) { try { delete uploadStash[a.url]; } catch (e) {} return res; });
    },

    respondCommand: noop,
  };

  // Assign the implemented surface.
  window.hjen = H;

  // Some bridge doors are declared OPTIONAL (`ideaRun?:`) and the renderer
  // feature-detects them — IdeaView does `if (!window.hjen.ideaRun)` and shows
  // its own honest "IDEA runs in the HJEN desktop app." The catch-all Proxy
  // below answers every key with a function, which made that check always pass
  // and turned a clean message into a failed run. These keys must therefore
  // read as genuinely ABSENT, not as a stub.
  //
  // IDEA needs python3 plus the Saudi Ad Voice Graph; neither is in the server
  // image, and inventing a stub would only move the failure later.
  var ABSENT = { ideaRun: 1, ideaStatus: 1 };

  // Graceful fallback for the desktop-only long tail (world / filmspace / cuts /
  // chrome / refHunt / replicate / assistant): any method not implemented above
  // returns a safe {ok:false} instead of crashing the renderer.
  window.hjen = new Proxy(H, {
    has: function (t, k) { return (k in t) && !ABSENT[k]; },
    get: function (t, k) {
      if (typeof k === 'string' && ABSENT[k]) return undefined;
      if (k in t || typeof k !== 'string') return t[k];
      return function () {
        console.warn('[HJEN] desktop-only method on web:', k);
        return Promise.resolve({ ok: false, reason: 'desktop_only', message: 'This tool runs in the HJEN desktop app.' });
      };
    },
  });

  window.hjen.__web = true;

  // ── descender-clip CSS fix ─────────────────────────
  // Serif display titles/inputs have a tight line-height that clips descenders
  // (the 'y' in the frame title); nudge them. The account identity + credit now
  // live in the renderer's top-right menu (it reads window.hjen.webAccount()) —
  // no floating chip.
  function injectFix() {
    if (!document.head || document.getElementById('hjen-web-fix')) return;
    var st = document.createElement('style'); st.id = 'hjen-web-fix';
    st.textContent = '.atlas-card__title,.atlas-card__title-input,.project-ws__stage-h1,.hub-hero__product-name,.hero__title{line-height:1.16 !important;padding-bottom:.1em !important}.hero{overflow:visible !important}';
    document.head.appendChild(st);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectFix);
  else injectFix();
  // Prime the account id early (edge-cacheable display URLs need it) + record login.
  api('/api/session').then(function (s) { if (s && s.acc) window.__hjenAcc = s.acc; }).catch(function () {});

  console.info('[HJEN] web adapter ready — cloud window.hjen active');
})();
