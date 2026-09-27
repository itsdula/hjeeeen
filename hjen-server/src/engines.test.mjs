// engines.test.mjs — the four ported creative engines, end to end on the server.
//
// Two things are proven here and neither is cosmetic:
//
//  1. RECIPE PARITY. Every prompt constant in a port must be byte-identical to
//     the desktop original. A paraphrase would mean the web quietly became a
//     different product from the app — the exact failure the port exists to
//     avoid. Any edit to eye.ts / swap.ts / contextAgents.ts / the reference
//     handlers fails this test until the port is re-run.
//
//  2. THE ENGINES ACTUALLY RUN. A stubbed vendor stands in for the provider so
//     the validation, the retry and the refuse-on-silence rules are exercised
//     against real account storage rather than mocked away.
//
//   node src/engines.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hjen-engines-'));
process.env.DATA_DIR = TMP;
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.OPENAI_API_KEY = 'test-key';
process.env.GOOGLE_API_KEY = 'test-key';

const { store } = await import('./store.js');
const { cloud } = await import('./cloudstore.js');

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); console.log('  ✓', name); pass++; }
  catch (e) { console.log('  ✗', name, '\n     ', e.message); fail++; }
};
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error(`${m || ''} got ${A} want ${B}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'expected truthy'); };

// ── 1. recipe parity ────────────────────────────────────────────────────────
function liftTemplate(file, name) {
  const s = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  const open = `const ${name} = \``;
  const i = s.indexOf(open);
  if (i < 0) return null;
  let out = '', j = i + open.length;
  while (j < s.length) {
    const c = s[j];
    if (c === '\\') { const n = s[j + 1]; out += (n === '`' || n === '\\' || n === '$') ? n : c + n; j += 2; continue; }
    if (c === '`') break;
    out += c; j++;
  }
  return out;
}
const PARITY = [
  ['../../app/electron/eye.ts', './eye/engine.js', ['EYE_READ_SYS']],
  ['../../app/electron/swap.ts', './swap/engine.js',
    ['SWAP_SLOTS_SYS', 'SWAP_PLAN_SYS', 'SWAP_CONSEQUENCE_SYS', 'SWAP_VERIFY_SYS', 'SWAP_HEAD', 'SWAP_MIDDLE', 'SWAP_TAIL']],
  ['../../app/electron/contextAgents.ts', './contextagents/engine.js', ['EYE_QUERY_SYS']],
  ['../../app/electron/main.ts', './reference/scene.js',
    ['REFERENCE_UNDERSTANDING_SYSTEM', 'REFERENCE_DRIFT_SYSTEM', 'REFERENCE_CONTRACT_REVISION_SYSTEM']],
];
console.log('\nRECIPE PARITY — the port must not paraphrase the desktop');
for (const [desktop, server, names] of PARITY) {
  for (const n of names) {
    await t(`${n} is byte-identical`, async () => {
      const a = liftTemplate(desktop, n), b = liftTemplate(server, n);
      ok(a, `${n} not found in ${desktop}`);
      ok(b, `${n} not found in ${server}`);
      if (a !== b) {
        let i = 0; while (a[i] === b[i]) i++;
        throw new Error(`diverged at ${i}: desktop ${JSON.stringify(a.slice(i, i + 70))} vs server ${JSON.stringify(b.slice(i, i + 70))}`);
      }
    });
  }
}

// ── 2. the engines, against a stubbed vendor ────────────────────────────────
const inv = await store.create({ email: 'engine-test@hjen.ai', name: 'Engine', genLimit: 200, durationDays: 30, active: true });
// A real blob so readVisionImage has bytes to hand the vendor.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const row = cloud.saveGeneration(inv.id, { pid: 'proj1', base64: PNG, ext: 'png', sidecar: {} });
const IMG = `cloudgen://proj1/${row.gid}.png`;

let VENDOR = null, SENT = [];
globalThis.fetch = async (url, opts) => {
  SENT.push({ url: String(url), body: JSON.parse(opts.body) });
  const payload = typeof VENDOR === 'function' ? VENDOR(SENT.length) : VENDOR;
  return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
};
const anthropic = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', model: 'claude-sonnet-4-6', usage: { input_tokens: 10, output_tokens: 20 } });
const google = (text) => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 } });

console.log('\nTHE EYE');
const { eyeRead, eyeGoldenWrite, eyeStatus } = await import('./eye/engine.js');
await t('a full read validates and reports nothing thin', async () => {
  SENT = [];
  VENDOR = google(JSON.stringify({
    subject: 'one man, 40s, standing, hands at his sides, eye-line off-left',
    place: 'a Riyadh metro concourse, interior, civic', action: 'waiting for the train',
    objects: ['ticket gate', 'steel bench', 'paper cup'],
    light: { key: 'hard overhead fluorescent', fill: 'two stops down off the tile', kelvin: '4300K mixed with daylight', state: 'interior-practical' },
    lens: { size: 'medium', angle: 'eye', height: 'hip', focal: 'normal', depth: 'band on the man, gates soft behind' },
    colour: { dominant: 'cold grey', second: 'warm skin', accent: 'red signage', behaviour: 'one warm body inside a cold field' },
    medium: 'digital, fine grain, no halation, contemporary', time: '07:40, clear, rush hour',
    inside: 'He is early and does not like being early.', craftMove: 'Waited for the gates to empty behind him.',
    culturalTruth: 'the folded ghutra over his forearm', refusal: 'the bench edge cuts his heel awkwardly',
    searchPhrase: 'man waiting metro concourse morning commute',
    searchPhraseAr: 'رجل ينتظر في محطة المترو صباحا',
    tags: ['metro', 'riyadh', 'commute', 'انتظار', 'محطة', 'صباح', 'رجل', 'مدينة'],
    register: 'groundedness', energy: 'quiet', quality: 3,
  }));
  const r = await eyeRead(inv, { imagePath: IMG });
  ok(r.ok, JSON.stringify(r).slice(0, 200));
  eq(r.thin, []); eq(r.read.lens.height, 'hip'); eq(r.read.quality, 3);
  ok(r.imageHash.length === 32, 'image hashed');
  ok(SENT[0].url.includes('generativelanguage'), 'routed to the right vendor');
});
await t('evasive layer-3 answers are reported thin, not repaired', async () => {
  VENDOR = google(JSON.stringify({
    subject: 'a man', place: 'a station', action: 'waiting', objects: ['bench'],
    light: { key: 'overhead', fill: 'soft', kelvin: '4300K', state: 'interior-practical' },
    lens: { size: 'medium', angle: 'eye', height: 'eye', focal: 'normal', depth: 'shallow' },
    colour: { dominant: 'grey', second: 'blue', accent: 'red', behaviour: 'cold on cold' },
    medium: 'digital', time: 'morning',
    inside: 'n/a', craftMove: '', culturalTruth: 'none', refusal: 'nothing',
    searchPhrase: 'man waiting station morning', searchPhraseAr: 'رجل ينتظر في المحطة صباحا',
    tags: ['a', 'b', 'c', 'd', 'e', 'f'], register: 'resolve', energy: 'mid', quality: 2,
  }));
  const r = await eyeRead(inv, { imagePath: IMG });
  ok(r.ok);
  for (const axis of ['inside', 'craftMove', 'culturalTruth', 'refusal']) ok(r.thin.includes(axis), `${axis} must be thin`);
});
await t('a Latin-script Arabic key is thin (transliteration is useless to search)', async () => {
  VENDOR = google(JSON.stringify({ searchPhraseAr: 'rajul yantathir fi al mahatta', searchPhrase: 'man waiting station morning', tags: [] }));
  const r = await eyeRead(inv, { imagePath: IMG });
  ok(r.thin.includes('searchPhraseAr'));
});
await t('malformed JSON retries once, then fails honestly', async () => {
  SENT = []; VENDOR = google('not json at all');
  const r = await eyeRead(inv, { imagePath: IMG });
  eq(r.ok, false); eq(r.reason, 'parse_failed');
  eq(SENT.length, 2, 'exactly one retry');
});
await t('an unreadable image never reaches the vendor', async () => {
  SENT = [];
  const r = await eyeRead(inv, { imagePath: 'cloudgen://proj1/missing.png' });
  eq(r.ok, false); eq(r.reason, 'no_image'); eq(SENT.length, 0);
});
await t('the golden set appends and status counts graded axes', async () => {
  eq(eyeStatus(inv).golden, 0);
  ok(eyeGoldenWrite(inv, { read: { subject: 'x' }, axisGrades: { light: 'good', colour: 'bad' } }).ok);
  ok(eyeGoldenWrite(inv, { read: { subject: 'y' }, axisGrades: { light: 'good' } }).ok);
  const st = eyeStatus(inv); eq(st.golden, 2); eq(st.gradedAxes, 3);
  eq(eyeGoldenWrite(inv, { nothing: true }).ok, false);
});

console.log('\nTHE SWAP');
const { swap, buildSwapPrompt } = await import('./swap/engine.js');
await t('plan writes an acceptance test per requirement', async () => {
  VENDOR = anthropic(JSON.stringify({ tests: { C1: 'Is the coat navy?' }, untestable: [], conflicts: [] }));
  const r = await swap.plan(inv, { requirements: [{ id: 'C1', slot: 'wardrobe', value: 'navy coat' }], slots: {} });
  ok(r.ok); eq(r.tests.C1, 'Is the coat navy?');
});
await t('verify counts a SKIPPED requirement as missed, never as a pass', async () => {
  VENDOR = google(JSON.stringify({ verdicts: [{ id: 'C1', state: 'landed', evidence: 'navy' }] }));
  const r = await swap.verify(inv, {
    takePath: IMG,
    requirements: [{ id: 'C1', test: 'Is the coat navy?' }, { id: 'C2', test: 'Is the cup gone?' }],
  });
  ok(r.ok);
  eq(r.verdicts.length, 2);
  eq(r.verdicts.find(v => v.id === 'C1').state, 'landed');
  eq(r.verdicts.find(v => v.id === 'C2').state, 'missed', 'silence is not success');
});
await t('verify refuses when nothing carries a test', async () => {
  const r = await swap.verify(inv, { takePath: IMG, requirements: [{ id: 'C1' }] });
  eq(r.ok, false); ok(r.message.includes('acceptance test'));
});
await t('consequence spends no call when nothing follows', async () => {
  SENT = [];
  const r = await swap.consequence(inv, { decisions: { wardrobe: { state: 'swap', value: 'navy' } } });
  ok(r.ok); eq(r.follows, {}); eq(SENT.length, 0);
});
await t('consequence answers only the slots it was asked about', async () => {
  VENDOR = anthropic(JSON.stringify({ follows: { light: 'cooler', colour: 'bluer', place: 'UNASKED' } }));
  const r = await swap.consequence(inv, {
    decisions: { wardrobe: { state: 'swap', value: 'navy' }, light: { state: 'follow' }, colour: { state: 'follow' } },
    slots: {},
  });
  ok(r.ok); eq(Object.keys(r.follows).sort(), ['colour', 'light']);
});
await t('compose is deterministic and never leaks an empty slot bullet', async () => {
  const args = {
    slots: { identity: 'a man in his 40s', wardrobe: '', light: { key: 'hard overhead', fill: 'soft' }, objects: ['bench'] },
    decisions: {}, requirements: [{ id: 'C1', slot: 'wardrobe', value: 'navy coat', test: 'navy?', priority: 1 }],
    refs: [], preserveKeys: ['identity', 'wardrobe', 'light', 'objects'], round: 1,
  };
  const a = await swap.compose(inv, JSON.parse(JSON.stringify(args)));
  const b = await swap.compose(inv, JSON.parse(JSON.stringify(args)));
  ok(a.ok); eq(a.prompt, b.prompt, 'same inputs must give the same prompt');
  ok(!/WARDROBE — \./.test(a.prompt), 'a slot the read never saw must contribute nothing');
  ok(a.prompt.includes('Image 1 is the source frame'), 'the head survived the port');
});
await t('golden write + status track machine-vs-owner agreement', async () => {
  eq(swap.status(inv).golden, 0);
  ok(swap.goldenWrite(inv, { entry: { takePath: IMG,
    machineVerdicts: [{ id: 'C1', state: 'landed' }, { id: 'C2', state: 'landed' }],
    humanVerdicts: { C1: 'landed', C2: 'missed' } } }).ok);
  const st = swap.status(inv); eq(st.golden, 1); eq(st.judged, 2); eq(st.agreed, 1);
});

console.log('\nCONTEXT AGENTS');
const { ca } = await import('./contextagents/engine.js');
await t('the shipped library loads', async () => {
  ok(ca.listMethods(inv).methods.length >= 50, 'methods');
  ok(ca.listProfiles(inv).profiles.length >= 10, 'profiles');
  eq(ca.status(inv).ok, true);
});
await t('a written card overlays the seed and survives a re-read', async () => {
  const card = { id: 'my-move', craft: 'cut', principle: 'Hold one beat longer', effect: 'the room settles',
                 when_it_works: { register: ['longing'] } };
  const w = ca.writeCard(inv, { card });
  ok(w.ok, JSON.stringify(w)); eq(w.id, 'my-move');
  eq(ca.readCard(inv, { id: 'my-move' }).card.principle, 'Hold one beat longer');
  ok(ca.listMethods(inv).methods.some(c => c.id === 'my-move'));
});
await t('a bad card is refused with the reason, not written', async () => {
  eq(ca.writeCard(inv, { card: { craft: 'cut' } }).reason, 'bad_card');
  eq(ca.writeCard(inv, {}).reason, 'bad_card');
  // The desktop's predicate rule survived the port: register must be an ARRAY.
  eq(ca.writeCard(inv, { card: { craft: 'cut', principle: 'p', effect: 'e',
    when_it_works: { register: 'longing' } } }).reason, 'bad_predicate');
});
await t('deleting a SEEDED card tombstones it without touching the library', async () => {
  const seeded = ca.listMethods(inv).methods.find(c => c.id !== 'my-move');
  ok(ca.deleteCard(inv, { id: seeded.id }).ok);
  ok(!ca.listMethods(inv).methods.some(c => c.id === seeded.id), 'gone for this account');
  const onDisk = fs.readdirSync(new URL('../context_agents/methods', import.meta.url));
  ok(onDisk.length >= 50, 'the shipped library is untouched');
});
await t('the lexicon merges seed + account entries', async () => {
  const before = ca.readLexicon(inv, {}).entries.length;
  ok(ca.writeLexiconEntry(inv, { entry: { expression: 'يا هلا', meaning: 'welcome', usage: 'greeting', status: 'trusted' } }).ok);
  const after = ca.readLexicon(inv, {}).entries;
  eq(after.length, before + 1);
  ok(after.some(e => e.expression === 'يا هلا'));
  ok(ca.readLexicon(inv, { status: 'trusted' }).entries.every(e => e.status === 'trusted'));
});
await t('the trainer says why it is unavailable instead of failing blank', async () => {
  const r = await ca.study();
  eq(r.ok, false); eq(r.reason, 'no_script'); ok(r.message.includes('developer tool'));
});
await t('eye-pick reports the missing corpus honestly', async () => {
  const r = await ca.eyePick(inv, { register: 'longing' });
  eq(r.ok, false); eq(r.reason, 'no_corpus');
  eq((await ca.eyePick(inv, {})).reason, 'bad_args');
});

console.log('\nREFERENCE MAKER');
const { referenceScene } = await import('./reference/scene.js');
await t('understand refuses an empty note before spending a call', async () => {
  SENT = [];
  const r = await referenceScene.understand(inv, { rawText: '  ', imagePath: IMG });
  eq(r.ok, false); eq(r.reason, 'empty_note'); eq(SENT.length, 0);
});
await t('understand rejects a contract that came back malformed', async () => {
  VENDOR = anthropic(JSON.stringify({ interpretation: 'x' }));   // no contract array
  const r = await referenceScene.understand(inv, { rawText: 'make it colder', imagePath: IMG });
  eq(r.ok, false); eq(r.reason, 'bad_contract');
});
await t('understand returns the parsed contract', async () => {
  VENDOR = anthropic('```json\n' + JSON.stringify({ interpretation: 'colder', contract: [{ id: 'K1', action: 'KEEP' }] }) + '\n```');
  const r = await referenceScene.understand(inv, { rawText: 'make it colder', imagePath: IMG });
  ok(r.ok, JSON.stringify(r).slice(0, 150)); eq(r.data.contract.length, 1);
});
await t('drift needs BOTH images and rejects a half review', async () => {
  eq((await referenceScene.drift(inv, { sourcePath: IMG })).reason, 'missing_image');
  VENDOR = google(JSON.stringify({ drift: [] }));               // no changes array
  eq((await referenceScene.drift(inv, { sourcePath: IMG, takePath: IMG, keepItems: [] })).reason, 'bad_review');
});
await t('revise-contract refuses an empty review note', async () => {
  eq((await referenceScene.reviseContract(inv, { reviewNote: '' })).reason, 'empty_review');
});

console.log('\nMETERING');
await t('a vendor 200 with NO text is refunded, not charged', async () => {
  const before = store.getById(inv.id).genUsed;
  VENDOR = anthropic('');
  const r = await eyeRead(inv, { imagePath: IMG });
  eq(r.ok, false); eq(r.reason, 'empty_result');
  eq(store.getById(inv.id).genUsed, before, 'the empty answer must not be charged');
});
await t('a real answer IS charged', async () => {
  const before = store.getById(inv.id).genUsed;
  VENDOR = anthropic(JSON.stringify({ tests: {}, untestable: [], conflicts: [] }));
  await swap.plan(inv, { requirements: [{ id: 'C1', slot: 'wardrobe', value: 'x' }], slots: {} });
  eq(store.getById(inv.id).genUsed, before + 1);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* leave it */ }
process.exit(fail ? 1 : 0);
