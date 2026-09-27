// engine.test.mjs — Cuts on the server: real ffmpeg, stubbed vendor.
//
// Two things are proven:
//  1. RECIPE PARITY — every prompt inside the ported handlers is character-for
//     character the one in app/electron/main.ts. These prompts are inline
//     template literals rather than named constants, so the check lifts every
//     long literal out of the desktop's Cuts region and demands it appear
//     verbatim in the port.
//  2. THE PIPELINE RUNS — a real clip is built with ffmpeg, uploaded into a
//     session, cut into shots, and every path that leaves the module is a
//     cloudcuts:// token rather than a server path.
//
//   node src/cuts/engine.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hjen-cuts-'));
process.env.DATA_DIR = TMP;
process.env.GOOGLE_API_KEY = 'test-key';

let pass = 0, fail = 0, skipped = 0;
const t = async (name, fn) => {
  try { await fn(); console.log('  ✓', name); pass++; }
  catch (e) { console.log('  ✗', name, '\n     ', e.message); fail++; }
};
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error(`${m || ''} got ${A} want ${B}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'expected truthy'); };

// ── 1. recipe parity ────────────────────────────────────────────────────────
console.log('\nRECIPE PARITY — the Cuts prompts must not drift from main.ts');
const MAIN = fs.readFileSync(new URL('../../../app/electron/main.ts', import.meta.url), 'utf8');
const PORT = fs.readFileSync(new URL('./engine.js', import.meta.url), 'utf8');
// The Cuts region of main.ts: from the first cuts handler to cuts-save.
const region = MAIN.slice(MAIN.indexOf("ipcMain.handle('hjen:cuts-analyze'"), MAIN.indexOf("ipcMain.handle('hjen:cuts-save'"));
// Every template literal in it that is long enough to be a prompt. A regex is
// not good enough here: it pairs the closing backtick of one literal with the
// opening of the next and reports code as prose. So walk the source properly,
// tracking which kind of string (or comment) each character is inside.
function templateLiterals(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 2; continue; }
    if (c === '"' || c === "'") {
      const q = c; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      i++; continue;
    }
    if (c === '`') {
      i++; const start = i; let depth = 0;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '$' && src[i + 1] === '{') { depth++; i += 2; continue; }
        if (depth && src[i] === '}') { depth--; i++; continue; }
        if (!depth && src[i] === '`') break;
        i++;
      }
      out.push(src.slice(start, i)); i++; continue;
    }
    i++;
  }
  return out;
}
const literals = templateLiterals(region)
  .filter(x => x.length > 150 && !x.includes('${'));   // interpolated ones are assembled, not fixed text
ok(literals.length >= 4, `expected several prompt literals, found ${literals.length}`);
await t(`all ${literals.length} long prompt literals survived the port`, async () => {
  const missing = literals.filter(x => !PORT.includes(x));
  if (missing.length) throw new Error(`${missing.length} missing, first starts: ${missing[0].slice(0, 90)}`);
});
await t('SPEECH_SYSTEM survived — the pass that reads lips needs it', async () => {
  const i = MAIN.indexOf('const SPEECH_SYSTEM = `');
  ok(i > 0, 'not found in main.ts');
  const text = MAIN.slice(i + 'const SPEECH_SYSTEM = `'.length, MAIN.indexOf('`;', i));
  ok(PORT.includes(text), 'SPEECH_SYSTEM missing or altered in the port');
  ok(PORT.includes('SPEECH_SYSTEM'), 'the pass must still reference it');
});
await t('no Cuts prompt leaked into the browser bundle', async () => {
  const adapter = fs.readFileSync(new URL('../../public/webapp/adapter.js', import.meta.url), 'utf8');
  const leaked = literals.filter(x => adapter.includes(x.slice(0, 60)));
  eq(leaked.length, 0, 'adapter.js must carry no Cuts prompt');
  ok(!adapter.includes('master cinematographer and colorist'), 'the DNA recipe must stay server-side');
});

// ── 2. the pipeline ─────────────────────────────────────────────────────────
const { store } = await import('../store.js');
const { cloud } = await import('../cloudstore.js');
const { bindCuts } = await import('./engine.js');
const inv = await store.create({ email: 'cuts-test@hjen.ai', name: 'Cuts', genLimit: 200, durationDays: 30, active: true });
const doors = bindCuts(inv);
const SESSION = 'sess_test';

// Build a 6s clip that really contains three hard cuts (black → white → black).
const clip = path.join(TMP, 'clip.mp4');
const made = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'lavfi', '-i', 'color=c=black:s=320x240:d=2',
  '-f', 'lavfi', '-i', 'color=c=white:s=320x240:d=2',
  '-f', 'lavfi', '-i', 'color=c=red:s=320x240:d=2',
  '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map', '[v]',
  '-r', '12', '-pix_fmt', 'yuv420p', clip], { encoding: 'utf8' });

if (made.status !== 0 || !fs.existsSync(clip)) {
  console.log('\nPIPELINE — skipped (no usable ffmpeg here)\n     ', (made.stderr || '').slice(0, 160));
  skipped = 1;
} else {
  console.log('\nTHE PIPELINE — real ffmpeg on a real clip');
  // Put the clip where an upload would have left it.
  const dir = cloud.cutsDir(inv.id, SESSION);
  fs.copyFileSync(clip, path.join(dir, 'source.mp4'));
  const TOKEN = `cloudcuts://${SESSION}/source.mp4`;

  let analyzed = null;
  await t('analyze finds the cuts and returns tokens, never server paths', async () => {
    analyzed = await doors.analyze({ sessionId: SESSION, videoPath: TOKEN });
    ok(analyzed.ok, JSON.stringify(analyzed).slice(0, 200));
    ok(analyzed.duration > 5 && analyzed.duration < 7, `duration ${analyzed.duration}`);
    ok(analyzed.shots.length >= 3, `expected 3+ shots, got ${analyzed.shots.length}`);
    for (const sh of analyzed.shots) {
      ok(sh.thumb.startsWith('cloudcuts://'), `thumb leaked a path: ${sh.thumb}`);
      ok(!sh.thumb.includes(TMP), 'no server path may escape');
    }
    ok(analyzed.strip.length > 0, 'filmstrip built');
    ok(analyzed.strip.every(f => f.path.startsWith('cloudcuts://')), 'strip tokenised');
    eq(analyzed.dir, undefined, 'the working directory is never disclosed');
  });
  await t('every returned token actually resolves to bytes', async () => {
    const tok = analyzed.shots[0].thumb.match(/^cloudcuts:\/\/([^/]+)\/(.+)$/);
    ok(tok, 'token shape');
    const buf = cloud.readCutsFile(inv.id, decodeURIComponent(tok[1]), tok[2]);
    ok(buf && buf.length > 500, 'the thumb has real pixels');
  });
  await t('a token cannot escape its session', async () => {
    eq(cloud.readCutsFile(inv.id, SESSION, '../../../invitees.json'), null);
    eq(cloud.readCutsFile(inv.id, SESSION, '..%2F..%2Fx'), null);
  });
  await t('shot-frames extracts candidates inside one shot', async () => {
    const r = await doors.shotFrames({ sessionId: SESSION, videoPath: TOKEN, shotIndex: 1, start: 0, end: 2, count: 3 });
    ok(r.ok, JSON.stringify(r).slice(0, 150));
    eq(r.frames.length, 3);
    ok(r.frames.every(f => f.abs.startsWith('cloudcuts://')), 'candidates tokenised');
  });
  await t('has-audio answers honestly for a silent clip', async () => {
    const r = await doors.hasAudio({ sessionId: SESSION, videoPath: TOKEN });
    ok(r.ok); eq(r.hasAudio, false);
  });
  await t('analyze refuses a video that is not there', async () => {
    const r = await doors.analyze({ sessionId: SESSION, videoPath: 'cloudcuts://sess_test/missing.mp4' });
    eq(r.ok, false); eq(r.reason, 'no_video');
  });

  console.log('\nTHE VISION PASSES — metered, refunded on silence');
  let VENDOR = null;
  const google = (text) => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
                              usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 } });
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify(VENDOR) });
  await t('dna transcodes a watch file and parses the look', async () => {
    VENDOR = google(JSON.stringify({ intent: 'calm', look: 'soft', palette: 'warm', film: '500T',
      lighting: 'north window', lens: '35mm', era: 'now', mood: 'quiet', grain: 'fine', aspect: '16:9' }));
    const r = await doors.dna({ sessionId: SESSION, videoPath: TOKEN });
    ok(r.ok, JSON.stringify(r).slice(0, 200));
    eq(r.dna.film, '500T');
    ok(fs.existsSync(path.join(cloud.cutsDir(inv.id, SESSION), 'watch.mp4')), 'watch file cached');
  });
  await t('a vendor 200 with no text is refunded, not charged', async () => {
    const before = store.getById(inv.id).genUsed;
    VENDOR = google('');
    const r = await doors.story({ sessionId: SESSION, videoPath: TOKEN, shots: [{ i: 1, start: 0, end: 2 }] });
    eq(r.ok, false);
    eq(store.getById(inv.id).genUsed, before, 'silence must not be charged');
  });
  await t('a real answer IS charged', async () => {
    const before = store.getById(inv.id).genUsed;
    VENDOR = google(JSON.stringify({ synopsis: 's', world: 'w', continuity: 'c', shots: [] }));
    const r = await doors.story({ sessionId: SESSION, videoPath: TOKEN, shots: [{ i: 1, start: 0, end: 2 }] });
    ok(r.ok); eq(r.synopsis, 's');
    eq(store.getById(inv.id).genUsed, before + 1);
  });
  await t('the embed pass says why it is desktop-only', async () => {
    const r = await doors.embed({ sessionId: SESSION });
    eq(r.ok, false); eq(r.reason, 'no_python'); ok(r.message.includes('desktop app'));
  });
}

console.log(`\n${pass} passed, ${fail} failed${skipped ? ', pipeline skipped' : ''}\n`);
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* leave it */ }
process.exit(fail ? 1 : 0);
