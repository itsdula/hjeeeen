// webAdapter.test.mjs — the web window.hjen against the DESKTOP contract.
//
// WHY THIS EXISTS. The web build runs the SAME renderer as the desktop app; the
// only difference is who answers window.hjen. When a feature lands on desktop,
// its preload door has to land here too, or the renderer calls into the Proxy
// fallback and the feature fails silently on the web — which is exactly how a
// finished Ad Breakdown could be assembled, shown, and then lost on reload.
//
// So this loads the real adapter in a fake browser over an in-memory /api/doc
// and asserts the BEHAVIOUR the desktop guarantees, not just that a method
// exists: monotonic rev, refuse-empty-overwrite, stale-rev refusal, rolling
// backups, heal-from-backup, and honest desktop-only answers.
//
//   node src/webAdapter.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';

const CALLS = [];
const DOCS = new Map();                       // "scope|pid|key" -> data
const key = (u) => {
  const q = new URL(u, 'https://x');
  return [q.searchParams.get('scope'), q.searchParams.get('pid') || '', q.searchParams.get('key')].join('|');
};
async function fakeFetch(url, opts = {}) {
  const u = String(url);
  const json = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) });
  if (u.startsWith('/api/doc') && (!opts.method || opts.method === 'GET')) {
    return json({ ok: true, data: DOCS.has(key(u)) ? DOCS.get(key(u)) : null });
  }
  if (u.startsWith('/api/doc') && opts.method === 'POST') {
    const b = JSON.parse(opts.body);
    DOCS.set([b.scope, b.pid || '', b.key].join('|'), b.data);
    return json({ ok: true });
  }
  if (u.startsWith('/api/breakdown/list')) return json({ ok: true, breakdowns: [{ slug: 'ingested', title: 'From server', frames: 3 }] });
  if (u.startsWith('/api/breakdown/read')) return json({ ok: true, found: true, breakdown: { title: 'server-assembled' } });
  if (u.startsWith('/api/session') || u.startsWith('/api/me')) return json({ ok: true, acc: 'acct1' });
  if (u.startsWith('/api/engine/')) {
    CALLS.push({ door: u.slice('/api/engine/'.length), body: JSON.parse(opts.body || '{}') });
    return json({ ok: true, echoed: u.slice('/api/engine/'.length) });
  }
  if (u.startsWith('/api/fetch-url')) {
    CALLS.push({ door: 'fetch-url', body: JSON.parse(opts.body || '{}') });
    return json({ ok: true, base64: 'AAAA', mime: 'image/png' });
  }
  return json({ ok: true });
}

const store = {};
const ctx = {
  console,
  location: { origin: 'https://demo.hjen.ai', href: 'https://demo.hjen.ai/studio/', search: '', pathname: '/studio/', replace() {} },
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  },
  fetch: fakeFetch,
  document: {
    readyState: 'complete', head: { appendChild() {} }, body: {},
    getElementById: () => null, createElement: () => ({ setAttribute() {}, style: {} }),
    addEventListener() {}, querySelectorAll: () => [],
  },
  window: null,
  BroadcastChannel: class { constructor() {} postMessage() {} close() {} },
  URL, URLSearchParams, Promise, JSON, Math, Date, Object, Array, String, Number, Boolean,
  setTimeout, clearTimeout, setInterval, clearInterval, TextDecoder, TextEncoder,
  Image: class {}, Blob: class {}, atob: (b) => Buffer.from(b, 'base64').toString('binary'),
  btoa: (b) => Buffer.from(b, 'binary').toString('base64'),
  HTMLImageElement: class {}, HTMLVideoElement: class {}, HTMLSourceElement: class {},
  MutationObserver: class { observe() {} disconnect() {} },
  navigator: { userAgent: 'node' },
  Element: class { setAttribute() {} },
};
ctx.window = ctx;
ctx.globalThis = ctx;
ctx.self = ctx;
vm.createContext(ctx);
store['hjen_web_token'] = 'tok_test';
store['hjen_last_project'] = 'proj1';
ctx.__hjenAuth = async () => 'tok_test';

const src = fs.readFileSync(new URL('../public/webapp/adapter.js', import.meta.url), 'utf8');
vm.runInContext(src, ctx, { filename: 'adapter.js' });
// The adapter clears account-scoped caches on a token change (multi-account
// isolation), so the open project is set AFTER boot — as the renderer does.
store['hjen_last_project'] = 'proj1';
const H = ctx.window.hjen;

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); console.log('  ✓', name); pass++; }
  catch (e) { console.log('  ✗', name, '\n     ', e.message); fail++; }
};
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error(`${m || ''} got ${A} want ${B}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'expected truthy'); };

console.log('\nPANEL DOCUMENTS');
let mbId;
await t('docCreate stamps identity + rev 1', async () => {
  const r = await H.docCreate({ id: 'proj1', kind: 'moodboard', name: 'Board A' });
  ok(r.ok); eq(r.doc.rev, 1); eq(r.doc.name, 'Board A'); ok(/^mb_/.test(r.doc.id)); mbId = r.doc.id;
});
await t('docList shows the new board', async () => {
  const r = await H.docList({ id: 'proj1', kind: 'moodboard' });
  ok(r.ok); eq(r.docs.length, 1); eq(r.docs[0].id, mbId); eq(r.docs[0].count, 0);
});
await t('docWrite populates + bumps rev, index summarises', async () => {
  const r = await H.docWrite({ id: 'proj1', kind: 'moodboard', docId: mbId, doc: { id: mbId, rev: 1, name: 'Board A', items: [{ kind: 'image', src: 'cloudgen://a/b.png' }] } });
  ok(r.ok, JSON.stringify(r)); eq(r.rev, 2);
  const l = await H.docList({ id: 'proj1', kind: 'moodboard' });
  eq(l.docs[0].count, 1); eq(l.docs[0].coverPath, 'cloudgen://a/b.png');
});
await t('docWrite REFUSES an empty overwrite of a populated board', async () => {
  const r = await H.docWrite({ id: 'proj1', kind: 'moodboard', docId: mbId, doc: { id: mbId, rev: 2, items: [] } });
  eq(r.ok, false); eq(r.reason, 'refused_empty_overwrite');
});
await t('...but allowEmpty lets Clear board through', async () => {
  const r = await H.docWrite({ id: 'proj1', kind: 'moodboard', docId: mbId, doc: { id: mbId, rev: 2, items: [] }, allowEmpty: true });
  ok(r.ok); eq(r.rev, 3);
});
await t('docRead heals a wiped doc from the newest populated backup', async () => {
  // simulate the file vanishing
  DOCS.set(['project', 'proj1', 'panel-moodboard-' + mbId].join('|'), null);
  const r = await H.docRead({ id: 'proj1', kind: 'moodboard', docId: mbId });
  ok(r.ok); eq(r.healed, true); eq(r.doc.items.length, 1);
});
await t('docWrite refuses a STALE revision and hands back the winner', async () => {
  const r = await H.docWrite({ id: 'proj1', kind: 'moodboard', docId: mbId, doc: { id: mbId, rev: 0, items: [{ kind: 'image', src: 'x' }] } });
  eq(r.ok, false); eq(r.reason, 'stale'); ok(r.doc);
});
await t('docDelete drops it from the index but keeps it recoverable', async () => {
  const r = await H.docDelete({ id: 'proj1', kind: 'moodboard', docId: mbId });
  ok(r.ok);
  const l = await H.docList({ id: 'proj1', kind: 'moodboard' });
  eq(l.docs.length, 0);
  const read = await H.docRead({ id: 'proj1', kind: 'moodboard', docId: mbId });
  ok(read.ok && read.healed, 'delete must stay recoverable, like desktop');
});
await t('onDocChanged fires on write', async () => {
  let got = null;
  const off = H.onDocChanged((d) => { got = d; });
  const c = await H.docCreate({ id: 'proj1', kind: 'timeline', name: 'Seq' });
  ok(got, 'no event'); eq(got.kind, 'timeline'); eq(got.rev, 1); off();
});
await t('timeline summarise counts clips across tracks', async () => {
  const c = await H.docCreate({ id: 'proj1', kind: 'timeline', name: 'Seq2' });
  await H.docWrite({ id: 'proj1', kind: 'timeline', docId: c.doc.id, doc: { rev: 1, name: 'Seq2', tracks: [{ clips: [{ thumb: 't1' }, {}] }, { clips: [{}] }] } });
  const l = await H.docList({ id: 'proj1', kind: 'timeline' });
  const row = l.docs.find(d => d.id === c.doc.id);
  eq(row.count, 3); eq(row.coverPath, 't1');
});
await t('bad kind is refused', async () => { eq((await H.docList({ id: 'proj1', kind: 'nope' })).ok, false); });

console.log('\nTHE SWAP');
await t('writeSwapDoc then readSwapDoc round-trips', async () => {
  ok((await H.writeSwapDoc({ id: 'proj1', doc: { sessions: [{ id: 's1' }] } })).ok);
  eq((await H.readSwapDoc({ id: 'proj1' })).sessions.length, 1);
});
await t('writeSwapDoc refuses to wipe a populated doc', async () => {
  const r = await H.writeSwapDoc({ id: 'proj1', doc: { sessions: [] } });
  eq(r.ok, false); eq(r.reason, 'refused_empty_overwrite');
});
await t('...allowEmpty still works', async () => { ok((await H.writeSwapDoc({ id: 'proj1', doc: { sessions: [] }, allowEmpty: true })).ok); });

console.log('\nAD BREAKDOWN');
await t('mindBreakdownWrite persists (the data-loss bug)', async () => {
  const r = await H.mindBreakdownWrite({ slug: 'nike26', breakdown: { title: 'Nike 26', frames: [1, 2], brand: 'Nike' } });
  ok(r.ok, JSON.stringify(r)); eq(r.slug, 'nike26');
});
await t('mindBreakdownRead prefers the authored doc over the manifest', async () => {
  const r = await H.mindBreakdownRead({ slug: 'nike26' });
  ok(r.ok); eq(r.breakdown.title, 'Nike 26');
});
await t('mindBreakdownRead falls back to the server manifest', async () => {
  const r = await H.mindBreakdownRead({ slug: 'ingested' });
  ok(r.ok); eq(r.breakdown.title, 'server-assembled');
});
await t('mindBreakdownsList merges server + authored', async () => {
  const r = await H.mindBreakdownsList();
  const slugs = r.breakdowns.map(b => b.slug).sort();
  eq(slugs, ['ingested', 'nike26']);
});
await t('mindBreakdownRename actually renames', async () => {
  ok((await H.mindBreakdownRename({ slug: 'nike26', title: 'Nike KSA' })).ok);
  eq((await H.mindBreakdownRead({ slug: 'nike26' })).breakdown.title, 'Nike KSA');
});
await t('mindBreakdownDelete actually deletes', async () => {
  ok((await H.mindBreakdownDelete({ slug: 'nike26' })).ok);
  const l = await H.mindBreakdownsList();
  eq(l.breakdowns.map(b => b.slug), ['ingested']);
});
await t('DNA gems round-trip per axis, bad axis refused', async () => {
  ok((await H.mindBreakdownDnaWrite({ slug: 'x1', axis: 'light', text: 'hard key' })).ok);
  eq((await H.mindBreakdownDnaRead({ slug: 'x1', axis: 'light' })).text, 'hard key');
  eq((await H.mindBreakdownDnaWrite({ slug: 'x1', axis: 'BAD-1', text: 't' })).ok, false);
  eq((await H.mindBreakdownDnaWrite({ slug: 'x1', axis: 'light', text: '  ' })).ok, false);
});

console.log('\nRUN STATE / CUTS / FILM SPACE / CONVERSATIONS / MCP');
await t('breakdown run state round-trips and clears', async () => {
  ok((await H.breakdownRunstateWrite({ slug: 's', state: { phase: 3 } })).ok);
  eq((await H.breakdownRunstateRead({ slug: 's' })).state.phase, 3);
  await H.breakdownRunstateClear({ slug: 's' });
  eq((await H.breakdownRunstateRead({ slug: 's' })).ok, false);
});
await t('cuts save → list → load → delete', async () => {
  ok((await H.cutsSave({ sessionId: 'c1', data: { title: 'Ad', shots: [1, 2, 3] } })).ok);
  const l = await H.cutsList({});
  eq(l.sessions.length, 1); eq(l.sessions[0].shots, 3); eq(l.sessions[0].title, 'Ad');
  eq((await H.cutsLoad({ sessionId: 'c1' })).data.title, 'Ad');
  await H.cutsDelete({ sessionId: 'c1' });
  eq((await H.cutsList({})).sessions.length, 0);
  eq((await H.cutsLoad({ sessionId: 'c1' })).reason, 'not_found');
});
await t('film space session save/list/get/delete + packIds preserved', async () => {
  const s = await H.filmspaceSessionSave({ name: 'Stage 1', state: { cam: 1 } });
  ok(s.ok); const id = s.sessionId;
  eq((await H.filmspaceSessionsList({})).sessions.length, 1);
  eq((await H.filmspaceSessionGet({ sessionId: id })).state.cam, 1);
  await H.filmspaceSessionSave({ sessionId: id, name: 'Stage 1b', state: { cam: 2 } });
  eq((await H.filmspaceSessionGet({ sessionId: id })).name, 'Stage 1b');
  await H.filmspaceSessionDelete({ sessionId: id });
  eq((await H.filmspaceSessionsList({})).sessions.length, 0);
});
await t('film space presets merge, not clobber', async () => {
  await H.filmspacePresetsSave({ items: [{ id: 'a', dataUrl: 'x' }] });
  await H.filmspacePresetsSave({ items: [{ id: 'b', dataUrl: 'y' }] });
  eq((await H.filmspacePresetsList()).ids.sort(), ['a', 'b']);
});
await t('conversations write/list/read/delete + project filter', async () => {
  await H.conversationWrite({ id: 'k1', title: 'General', kind: 'general', messages: [1, 2] });
  await H.conversationWrite({ id: 'k2', title: 'Proj', kind: 'project', projectSlug: 'sar', messages: [1] });
  eq((await H.conversationsList()).conversations.length, 2);
  eq((await H.conversationsList({ projectSlug: 'sar' })).conversations.length, 1);
  eq((await H.conversationRead({ id: 'k1' })).conversation.title, 'General');
  eq((await H.conversationsList()).conversations.find(c => c.id === 'k1').msgCount, 2);
  await H.conversationDelete({ id: 'k1' });
  eq((await H.conversationsList()).conversations.length, 1);
});
await t('mcp servers persist + endpoint points at this origin', async () => {
  eq(await H.mcpListServers(), []);
  ok((await H.mcpSetServers([{ name: 'x', command: 'y' }])).ok);
  eq((await H.mcpListServers())[0].name, 'x');
  eq((await H.mcpEndpointConfig()).defaultHttpUrl, 'https://demo.hjen.ai/mcp');
});
await t('desktop-only doors answer honestly, not silently', async () => {
  const r = await H.docImport({ id: 'proj1', kind: 'moodboard', paths: ['/a'] });
  eq(r.ok, false); eq(r.reason, 'desktop_only'); ok(r.message.length > 10);
  eq((await H.panelList()).open, []);
  eq((await H.filmspacePacksList({})).packs, []);
});

console.log('\nPORTED ENGINES — the doors post to the server, never compose here');
const lastCall = () => CALLS[CALLS.length - 1];
await t('the Eye posts to its three doors', async () => {
  await H.eyeRead({ imagePath: 'cloudgen://p/g.png', note: 'hi' });
  eq(lastCall().door, 'eye/read'); eq(lastCall().body.imagePath, 'cloudgen://p/g.png');
  await H.eyeStatus(); eq(lastCall().door, 'eye/status');
  await H.eyeGoldenWrite({ entry: { read: {} } }); eq(lastCall().door, 'eye/golden-write');
});
await t('The Swap posts all six engine doors', async () => {
  const map = { swapSlots: 'swap/slots', swapConsequence: 'swap/consequence', swapPlan: 'swap/plan',
                swapCompose: 'swap/compose', swapVerify: 'swap/verify', swapGoldenWrite: 'swap/golden-write' };
  for (const k of Object.keys(map)) { await H[k]({ probe: k }); eq(lastCall().door, map[k], k); }
  await H.swapStatus(); eq(lastCall().door, 'swap/status');
});
await t('Reference Maker posts its three doors', async () => {
  await H.referenceSceneUnderstand({ rawText: 'x' }); eq(lastCall().door, 'reference/understand');
  await H.referenceSceneDrift({}); eq(lastCall().door, 'reference/drift');
  await H.referenceSceneReviseContract({}); eq(lastCall().door, 'reference/revise-contract');
});
await t('Context Agents posts every ported door', async () => {
  const map = { caApply: 'ca/apply', caVocab: 'ca/vocab', caListMethods: 'ca/list-methods',
    caListProfiles: 'ca/list-profiles', caReadCard: 'ca/read-card', caWriteCard: 'ca/write-card',
    caDeleteCard: 'ca/delete-card', caReadLexicon: 'ca/read-lexicon', caWriteLexiconEntry: 'ca/write-lexicon',
    caStatus: 'ca/status', caStudy: 'ca/study', caEyePick: 'ca/eye-pick', caEyeQuery: 'ca/eye-query',
    caEyeConfirmFrames: 'ca/eye-confirm', caEyeJudge: 'ca/eye-judge', caEyeStatus: 'ca/eye-status' };
  for (const k of Object.keys(map)) { await H[k]({ probe: k }); eq(lastCall().door, map[k], k); }
});
await t('NO recipe reached the browser bundle', async () => {
  const src = fs.readFileSync(new URL('../public/webapp/adapter.js', import.meta.url), 'utf8');
  for (const needle of ['EYE_READ_SYS', 'SWAP_SLOTS_SYS', 'SWAP_VERIFY_SYS', 'REFERENCE_UNDERSTANDING_SYSTEM',
                        'You are a working commercial stills photographer', 'STRUCTURE — Image']) {
    ok(!src.includes(needle), `adapter.js must not carry "${needle}"`);
  }
});
await t('fetchUrlBase64 proxies through the server and reports bytes', async () => {
  const r = await H.fetchUrlBase64('https://cdn.example/x.png');
  ok(r.ok); eq(r.base64, 'AAAA'); eq(r.bytes, 3);
  eq(lastCall().door, 'fetch-url'); eq(lastCall().body.url, 'https://cdn.example/x.png');
});
await t('OPTIONAL doors read as absent so feature detection works', async () => {
  eq(H.ideaRun, undefined); eq(H.ideaStatus, undefined);
  ok(!('ideaRun' in H), 'ideaRun must not answer `in`');
  // ...while an ordinary desktop-only door still answers safely.
  const r = await H.worldFinish({});
  eq(r.ok, false); eq(r.reason, 'desktop_only');
});
await t('referenceSceneImport reuses a cloud asset, refuses a device file', async () => {
  const good = await H.referenceSceneImport({ projectId: 'p', sourcePath: 'cloudgen://p/g.png', sourceKind: 'generation' });
  ok(good.ok); eq(good.asset.imagePath, 'cloudgen://p/g.png');
  const bad = await H.referenceSceneImport({ projectId: 'p', sourcePath: '/Users/x/a.png', sourceKind: 'device' });
  eq(bad.ok, false); ok(bad.message.length > 10);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
