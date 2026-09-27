// The Swap — the pure modules, tested.
//
// WHY THIS FILE EXISTS AND WHY IT HAS NO DEPENDENCIES. The house app ships five
// runtime dependencies and no test runner, and this feature was not worth a
// sixth. So: tsc compiles the five pure swap modules to a temp dir, plain node
// imports them, node:assert checks them. `node scripts/swap_test.mjs`.
//
// WHAT IS WORTH TESTING HERE. Not the prompts — those are judged by the bench
// and by Anwar's eye. What is tested is the machinery that decides WHAT gets
// asked for: the dependency closure, the preserve set, the lock predicates, the
// reference order, and above all THE LADDER. A re-drive loop that is wrong is
// worse than no re-drive loop, because it spends the owner's money to arrive
// somewhere further from the frame — and it fails silently, in a place nobody
// looks, three rounds deep.

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const SRC = path.join(APP, 'src', 'lib', 'swap');
// Inside the app, not /tmp: electron/swap.ts opens with require('electron'), and
// from a temp dir node cannot walk up to node_modules to resolve it.
const OUT = path.join(APP, 'out', 'swap-test');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

let pass = 0;
const failures = [];
function it(name, fn) {
  try { fn(); pass++; }
  catch (e) { failures.push(`${name}\n    ${String(e.message).split('\n').slice(0, 6).join('\n    ')}`); }
}

// ── compile ─────────────────────────────────────────────────────────────────
// Only the five pure modules. Their cross-tree imports (store, hjen-bridge,
// eye/types) are all `import type`, so tsc erases them and nothing from the
// React tree is emitted.
//
// --noCheck because a file list on the CLI ignores tsconfig, so tsc would
// typecheck the whole transitive tree under the wrong settings and drown this
// run in unrelated errors. The REAL typecheck is `tsc -b`, which runs on the
// project and must stay green; this compile only needs runnable JS.
//
// --noResolve IS LOAD-BEARING, and it cost an hour to learn why. These modules
// import types from ../../store and ../../types/hjen-bridge. Those imports are
// `import type` and vanish from the emitted JS — but tsc still pulls the files
// into the PROGRAM, and a file that sits outside --rootDir has no representable
// path inside --outDir, so tsc emits it NEXT TO ITS SOURCE instead. That silently
// littered 65 compiled .js files through src/, where vite then resolved them
// ahead of the .ts and the app build broke on a stale export.
// --noResolve stops the tree from entering the program at all. Do not remove it,
// and never run a bare `tsc <file list>` in this repo.
const TSC = ['--module', 'commonjs', '--target', 'es2022', '--skipLibCheck', '--noCheck', '--noResolve'];
execFileSync('npx', [
  'tsc',
  path.join(SRC, 'types.ts'), path.join(SRC, 'deps.ts'), path.join(SRC, 'ledger.ts'),
  path.join(SRC, 'lock.ts'), path.join(SRC, 'refs.ts'),
  '--outDir', OUT, '--rootDir', SRC,
  // CommonJS, not ESM: tsc emits extensionless `./types` specifiers, which node's
  // ESM loader refuses. require() resolves them without a build step in between.
  ...TSC,
], { cwd: APP, stdio: ['ignore', 'inherit', 'inherit'] });

const load = (m) => require(path.join(OUT, `${m}.js`));
const { emptyDecisions } = load('types');
const { resolveFollows, preserveSet, geometryHeld, silhouetteHeld, blastRadius } = load('deps');
const { toRequirements, conflictCheck, advanceLadder, firstRound, MAX_ROUNDS } = load('ledger');
const { lockPlanFor, degrade } = load('lock');
const { orderSwapRefs, imageIndex, bodyMoves } = load('refs');

// ── helpers ─────────────────────────────────────────────────────────────────
const D = (over = {}) => {
  const d = emptyDecisions();
  for (const [k, v] of Object.entries(over)) d[k] = typeof v === 'string' ? { state: 'swap', value: v } : v;
  return d;
};
const verdict = (id, state) => ({ id, state, evidence: '' });

// ═══════════════════════ deps — the dependency closure ═══════════════════════

it('the hour drags the light, the grade and what is switched on', () => {
  const r = resolveFollows(D({ time: 'night, after the shops have closed' }));
  assert.equal(r.time.state, 'swap');
  for (const k of ['light', 'colour', 'objects']) assert.equal(r[k].state, 'follow', k);
  assert.equal(r.light.becauseOf, 'time');
});

it('the closure is transitive — place reaches colour through light', () => {
  const r = resolveFollows(D({ place: 'a shut petrol station at the edge of town' }));
  assert.equal(r.light.state, 'follow');
  assert.equal(r.colour.state, 'follow', 'colour must be reached through light, not directly');
  assert.equal(r.colour.becauseOf, 'light');
});

it('an explicit swap is never demoted to follow', () => {
  // the user changed the hour AND deliberately chose the new light himself
  const r = resolveFollows(D({ time: 'night', light: 'one sodium lamp behind them' }));
  assert.equal(r.light.state, 'swap', 'user intent outranks the graph');
  assert.equal(r.light.value, 'one sodium lamp behind them');
});

it('an explicit KEEP is flagged, never silently promoted', () => {
  const r = resolveFollows(D({
    time: 'night',
    light: { state: 'keep', pinnedAgainstGraph: true },
  }));
  assert.equal(r.light.state, 'keep', 'the owner is never silently overruled');
  assert.equal(r.light.becauseOf, 'time', 'but the UI must be able to name the conflict');
});

it('multi-change unions the closures instead of picking one', () => {
  const r = resolveFollows(D({ identity: 'a woman in her sixties', action: 'pouring the tea' }));
  assert.equal(r.wardrobe.state, 'follow');   // from identity
  assert.equal(r.posture.state, 'follow');    // from action
  assert.equal(r.hands.state, 'follow');
  assert.equal(r.gaze.state, 'follow');
});

it('preserve is the neighbourhood, not the checklist', () => {
  const s = preserveSet(resolveFollows(D({ identity: 'a woman in her sixties' })));
  assert.ok(s.has('camera'), 'camera drifts unconditionally');
  assert.ok(!s.has('identity'), 'the swapped slot gets a CHANGE line, never a PRESERVE line');
  assert.ok(!s.has('wardrobe'), 'a FOLLOWING slot gets a CONSEQUENCE line, never a PRESERVE line');
  assert.ok(!s.has('medium'), 'a slot no change can drag stays silent — Image 1 carries it');
  assert.ok(!s.has('place'), 'nor does the room, which the photograph plainly shows');
  assert.ok(s.size <= 5, `the block must stay short, got ${s.size}`);
});

it('AT_RISK is not FOLLOWS — Anwar’s three keeps get named, with their values', () => {
  // The literal ask: change the character, keep the angle, the action and the
  // gaze. Replacing the human does not license the gaze to move, but the model
  // redraws the person and it moves anyway — so those slots must be RESTATED,
  // which is the opposite relation from "may change as a consequence".
  const s = preserveSet(resolveFollows(D({ identity: 'a woman in her sixties' })));
  for (const k of ['camera', 'action', 'gaze', 'posture', 'hands']) {
    assert.ok(s.has(k), `${k} must be named when the person is replaced`);
  }
});

it('a grade pass is where a face is silently lost', () => {
  for (const slot of ['light', 'colour', 'medium']) {
    assert.ok(preserveSet(resolveFollows(D({ [slot]: 'x' }))).has('identity'), slot);
  }
});

it('identity is preserved by name whenever it is being kept', () => {
  const s = preserveSet(resolveFollows(D({ place: 'a hotel corridor at 2am' })));
  assert.ok(s.has('identity'), 'faces drift on every edit — always name it');
  assert.ok(!s.has('light') && !s.has('objects'), 'both are following, so they are not preserved');
});

it('the two lock predicates read the right slots', () => {
  assert.equal(geometryHeld(D()), true);
  assert.equal(silhouetteHeld(D()), true);
  assert.equal(geometryHeld(D({ identity: 'x' })), true, 'a new face does not move the room');
  assert.equal(silhouetteHeld(D({ identity: 'x' })), false, 'but it does change the outline');
  assert.equal(geometryHeld(D({ posture: 'x' })), false);
  assert.equal(silhouetteHeld(D({ wardrobe: 'x' })), false);
  assert.equal(blastRadius(resolveFollows(D({ time: 'night' }))), 4);
});

it('a gaze change turns the head, so the outline is NOT held', () => {
  // the miss this test exists for: gaze sits in neither the geometry list nor
  // the wardrobe/identity pair, so it silently qualified for a full canny lock —
  // a stencil cut around the old head angle, holding the face exactly where the
  // change was asking it to turn away from.
  assert.equal(geometryHeld(D({ gaze: 'past the camera to someone off-frame left' })), true,
    'eyes and a few degrees of head rotate inside the same volume — depth survives');
  assert.equal(silhouetteHeld(D({ gaze: 'past the camera to someone off-frame left' })), false);
  assert.equal(lockPlanFor(D({ gaze: 'x' })).canny, false);
  assert.equal(lockPlanFor(D({ gaze: 'x' })).depth, true);
});

it('a hand that lifts moves through space, so depth is not held either', () => {
  assert.equal(geometryHeld(D({ hands: 'the right hand raised, holding the cup out' })), false,
    'a depth map of the lowered hand would argue with the raised one');
  assert.equal(lockPlanFor(D({ hands: 'x' })).kit, 'none');
});

// ═══════════════════════ ledger — requirements ═══════════════════════

it('requirements are numbered in weight order, not click order', () => {
  const reqs = toRequirements(D({ place: 'a mosque courtyard', identity: 'a boy of nine' }));
  assert.deepEqual(reqs.map(r => r.id), ['C1', 'C2']);
  assert.equal(reqs[0].slot, 'identity', 'identity outranks place in the weight order');
  assert.equal(reqs[1].slot, 'place');
});

it('a swap with neither words nor an image is not a requirement', () => {
  assert.equal(toRequirements(D({ identity: { state: 'swap', value: '   ' } })).length, 0);
  assert.equal(toRequirements(D({ identity: { state: 'swap', refPath: '/a/face.png' } })).length, 1,
    'but an image alone IS a requirement — "change him to THIS person" needs no words');
});

it('a pinned neighbour of a swapped slot is reported as a conflict', () => {
  const d = resolveFollows(D({ time: 'night', light: { state: 'keep', pinnedAgainstGraph: true } }));
  const c = conflictCheck(d, toRequirements(d));
  assert.equal(c.length, 1);
  assert.equal(c[0].kind, 'pin');
  assert.ok(c[0].message.length > 20, 'the conflict must be readable, not a code');
});

it('no conflict is the common, correct answer', () => {
  const d = resolveFollows(D({ identity: 'a woman in her sixties' }));
  assert.deepEqual(conflictCheck(d, toRequirements(d)), []);
});

// ═══════════════════════ ledger — THE LADDER ═══════════════════════

const threeReqs = toRequirements(D({ identity: 'a woman in her sixties', place: 'a shut souq', time: 'night' }));

it('everything landed ends the ladder', () => {
  const step = advanceLadder(firstRound('/src.png', threeReqs), threeReqs.map(r => verdict(r.id, 'landed')), '/take1.png');
  assert.equal(step.next, null);
  assert.equal(step.landed.length, 3);
  assert.deepEqual(step.unresolved, []);
});

it('THE LADDER NEVER CHAINS — every round re-asks from the original frame', () => {
  // The bug this test exists for: round 2 used to re-photograph round 1's
  // OUTPUT and round 3 re-photographed round 2's, so the "reference" handed to
  // the model was a machine's guess about a machine's guess, three generations
  // from the real photograph. Anwar caught it in the sidecars.
  const r1 = firstRound('/src.png', threeReqs);
  const s1 = advanceLadder(r1, [verdict('C1', 'landed'), verdict('C2', 'missed'), verdict('C3', 'landed')], '/take1.png');
  assert.equal(s1.next.sourcePath, '/src.png', 'round 2 works from the ORIGINAL');
  const s2 = advanceLadder(s1.next, [verdict('C2', 'missed'), verdict('C1', 'landed'), verdict('C3', 'landed')], '/take2.png');
  assert.equal(s2.next.sourcePath, '/src.png', 'and so does round 3');
});

it('a re-ask carries every requirement, failures first', () => {
  const r1 = firstRound('/src.png', threeReqs);
  const step = advanceLadder(r1, [verdict('C1', 'landed'), verdict('C2', 'missed'), verdict('C3', 'landed')], '/take1.png');
  assert.equal(step.next.round, 2);
  assert.deepEqual(step.next.requirements.map(r => r.id), ['C2', 'C1', 'C3'],
    'all three — a change left off the list would simply not be in a frame re-made from the original');
  assert.deepEqual(step.next.escalate, ['C2'], 'and the failure is named so the re-ask is a different instruction');
  assert.deepEqual(step.next.landed.map(r => r.id), ['C1', 'C3']);
});

it('partial counts as failure — half is not yes', () => {
  const step = advanceLadder(firstRound('/src.png', threeReqs),
    [verdict('C1', 'partial'), verdict('C2', 'landed'), verdict('C3', 'landed')], '/take1.png');
  assert.deepEqual(step.next.escalate, ['C1'], 'a partial is chased, not banked');
});

it('a requirement the checker dropped is counted as missed, never as passed', () => {
  const step = advanceLadder(firstRound('/src.png', threeReqs), [verdict('C1', 'landed')], '/take1.png');
  assert.deepEqual(step.next.escalate, ['C2', 'C3'], 'silence is not success');
  assert.deepEqual(step.next.requirements.map(r => r.id), ['C2', 'C3', 'C1'], 'chased first, but all still asked for');
});

it('the ladder stops at three and says what never landed', () => {
  const r3 = { round: MAX_ROUNDS, sourcePath: '/src.png', requirements: threeReqs, escalate: ['C2'], landed: [threeReqs[0]] };
  const step = advanceLadder(r3, [verdict('C1', 'landed'), verdict('C2', 'missed'), verdict('C3', 'landed')], '/take3.png');
  assert.equal(step.next, null, 'never a fourth round — that is gambling, not converging');
  assert.deepEqual(step.unresolved.map(r => r.id), ['C2']);
  assert.ok(/did not land/.test(step.note), 'and it must SAY so');
});

it('what landed once is remembered even if a later round drops it', () => {
  const r1 = firstRound('/src.png', threeReqs);
  const s1 = advanceLadder(r1, [verdict('C1', 'landed'), verdict('C2', 'missed'), verdict('C3', 'missed')], '/take1.png');
  const s2 = advanceLadder(s1.next, [verdict('C1', 'missed'), verdict('C2', 'landed'), verdict('C3', 'missed')], '/take2.png');
  assert.deepEqual(s2.landed.map(r => r.id).sort(), ['C1', 'C2'],
    're-asking from the original cannot guarantee a repeat, so the run keeps the best take rather than the last');
  assert.deepEqual(s2.next.escalate.sort(), ['C1', 'C3'], 'and this round chases what THIS round missed');
});

// ═══════════════════════ lock — derived, not tabulated ═══════════════════════

it('nothing moving gives the strongest lock', () => {
  const p = lockPlanFor(D({ light: 'one sodium lamp behind them' }));
  assert.equal(p.kit, 'canny+depth');
  assert.ok(p.canny && p.depth);
});

it('a character swap gets depth, never canny', () => {
  const p = lockPlanFor(D({ identity: 'a woman in her sixties' }));
  assert.equal(p.kit, 'depth');
  assert.equal(p.canny, false, 'canny would force the OLD silhouette onto a new body');
  assert.equal(p.faceAnchor, false, 'the face is the thing being changed — do not anchor it');
});

it('a wardrobe swap anchors the face it is keeping', () => {
  const p = lockPlanFor(D({ wardrobe: 'a worn navy work coat' }));
  assert.equal(p.kit, 'depth');
  assert.equal(p.faceAnchor, true);
});

it('a place swap stencils the subject only and refuses full depth', () => {
  const p = lockPlanFor(D({ place: 'a shut souq at night' }));
  assert.equal(p.cannySubjectOnly, true);
  assert.equal(p.depth, false, 'full-frame depth would drag the old room into the new place');
  assert.equal(p.faceAnchor, true);
});

it('a face that is itself being replaced is never anchored', () => {
  // the contradiction this test exists for: the place branch anchored the source
  // face unconditionally, so a character+place swap shipped "the output's face
  // must be this face" alongside "the person is replaced" — two orders that
  // cannot both be obeyed, and the model obeys the picture.
  const p = lockPlanFor(D({ place: 'a shut souq', identity: 'a boy of nine' }));
  assert.equal(p.faceAnchor, false);
  assert.equal(p.cannySubjectOnly, true, 'the outline still holds — only the anchor is wrong');
});

it('a moving body gets no structural map at all', () => {
  for (const slot of ['action', 'posture']) {
    const p = lockPlanFor(D({ [slot]: 'x' }));
    assert.equal(p.kit, 'none', slot);
    assert.ok(!p.canny && !p.depth, `${slot}: every map of the source is now a lie`);
  }
});

it('a camera change is routed away, not locked', () => {
  const p = lockPlanFor(D({ camera: 'a low camera in front' }));
  assert.equal(p.kit, 'none');
  assert.ok(/Camera Angles/.test(p.reason), 'and the reason must name where it belongs');
});

it('multi-change falls out of the predicates with no extra rule', () => {
  const p = lockPlanFor(D({ identity: 'a boy of nine', place: 'a mosque courtyard' }));
  assert.equal(p.depth, false, 'the place moved, so the layout map is a lie');
  assert.equal(p.cannySubjectOnly, true, 'but the subject holds, so his outline is still true');
});

it('a machine with no Python degrades honestly instead of blocking', () => {
  const p = degrade(lockPlanFor(D({ light: 'x' })), { canny: false, depth: false, matte: false });
  assert.equal(p.kit, 'none');
  assert.ok(/prompt-only/.test(p.reason), 'the UI must be able to say WHY it is weaker');
});

it('half a kit is kept, not thrown away', () => {
  const p = degrade(lockPlanFor(D({ light: 'x' })), { canny: false, depth: true, matte: false });
  assert.equal(p.kit, 'depth');
  assert.equal(p.depth, true);
  assert.ok(/edge stencil/.test(p.reason));
});

it('a subject stencil with no matte is not a subject stencil', () => {
  const p = degrade(lockPlanFor(D({ place: 'x' })), { canny: true, depth: true, matte: false });
  assert.equal(p.canny, false, 'without the matte it would stencil the OLD world we are replacing');
});

// ═══════════════════════ refs — the image order ═══════════════════════

const paths = { sourcePath: '/src.png', cannyPath: '/canny.png', depthPath: '/depth.png', facePath: '/face.png' };

it('the source is Image 1, canny is Image 2, depth is Image 3', () => {
  const d = resolveFollows(D({ light: 'one sodium lamp behind them' }));
  const refs = orderSwapRefs(d, lockPlanFor(d), toRequirements(d), paths);
  assert.equal(imageIndex(refs, 'source'), 1);
  assert.equal(imageIndex(refs, 'canny'), 2);
  assert.equal(imageIndex(refs, 'depth'), 3);
  assert.equal(refs[0].category, 'composition', 'COMPOSITION LOCK is exactly right here, and free');
});

it('an action swap drops the source out of the composition bucket', () => {
  const d = resolveFollows(D({ action: 'pouring the tea' }));
  const refs = orderSwapRefs(d, lockPlanFor(d), toRequirements(d), paths);
  assert.equal(bodyMoves(d), true);
  assert.equal(refs[0].category, 'general',
    'COMPOSITION LOCK pins the subject position — it would fight the change we asked for');
  assert.equal(imageIndex(refs, 'canny'), undefined, 'and no plate may ride along');
  assert.equal(imageIndex(refs, 'depth'), undefined);
});

it('the new face rides in the character bucket, right after the plates', () => {
  const d = resolveFollows(D({ identity: { state: 'swap', value: 'a woman in her sixties', refPath: '/newface.png' } }));
  const refs = orderSwapRefs(d, lockPlanFor(d), toRequirements(d), paths);
  assert.equal(imageIndex(refs, 'source'), 1);
  assert.equal(imageIndex(refs, 'depth'), 2);
  const face = refs.find(r => r.slot === 'identity');
  assert.equal(face.category, 'character');
  assert.equal(refs.indexOf(face), 2, 'Image 3');
});

it('every requirement image is cited, in ledger order', () => {
  const d = resolveFollows(D({
    wardrobe: { state: 'swap', value: 'a work coat', refPath: '/coat.png' },
    place: { state: 'swap', value: 'a souq', refPath: '/souq.png' },
  }));
  const refs = orderSwapRefs(d, lockPlanFor(d), toRequirements(d), paths);
  const slots = refs.filter(r => r.role === 'slot').map(r => r.slot);
  assert.deepEqual(slots, ['wardrobe', 'place'], 'wardrobe outranks place in the weight order');
  assert.ok(refs.every(r => r.label && r.label.length > 3), 'every image needs a name the model can be told');
});

it('one requirement keeps its complete multi-reference set', () => {
  const d = resolveFollows(D({
    wardrobe: { state: 'swap', value: 'a tailored work coat', refPaths: ['/coat-front.png', '/coat-back.png', '/coat-detail.png'] },
  }));
  const reqs = toRequirements(d);
  assert.deepEqual(reqs[0].refPaths, ['/coat-front.png', '/coat-back.png', '/coat-detail.png']);
  const refs = orderSwapRefs(d, lockPlanFor(d), reqs, paths).filter(r => r.role === 'slot');
  assert.deepEqual(refs.map(r => r.filePath), ['/coat-front.png', '/coat-back.png', '/coat-detail.png']);
  assert.ok(refs.every(r => r.requirementId === 'C1'), 'every image stays scoped to its CHANGE');
});

// ═══════════════════ the recipe — prompt assembly, MAIN-side ═══════════════════
// electron/swap.ts is loadable outside Electron: require('electron') resolves to
// the binary's path (a string), destructuring ipcMain off it yields undefined,
// and nothing touches it until registerSwap() is called — which this never does.
// So the contract itself can be assembled and read with no app, no keys and no
// spend. Reading the prompt before firing a make is most of the debugging.

execFileSync('npx', [
  'tsc', path.join(APP, 'electron', 'swap.ts'),
  '--outDir', path.join(OUT, 'main'), '--rootDir', path.join(APP, 'electron'),
  ...TSC,
], { cwd: APP, stdio: ['ignore', 'inherit', 'inherit'] });
const { buildSwapPrompt, validateSlots } = require(path.join(OUT, 'main', 'swap.js'));

const READ = {
  subject: 'man · 1 · 30s-40s · standing upright · hands at side · looking into the engine bay',
  action: 'checking the engine of a stopped pickup',
  place: 'a roadside workshop yard on the edge of a small town, working-class register',
  objects: ['open bonnet', 'oil rag', 'jerry can', 'plastic chair'],
  light: { key: 'hard 3/4 back, low sun through the open shed door', fill: 'almost none — the shadow side falls to black', kelvin: '5600K daylight against a 2900K work lamp', state: 'day' },
  lens: { size: 'medium', angle: 'eye', height: 'hip', focal: 'normal', depth: 'band on the man; the yard behind falls soft' },
  colour: { dominant: 'dust beige', second: 'oxidised blue', accent: 'one red jerry can', behaviour: 'one saturated object inside an otherwise bleached field' },
  medium: 'digital, clean, contemporary',
  time: 'late afternoon, dry, the quiet hour before closing',
  inside: 'He already knows what is wrong and is deciding whether to say the price out loud.',
  craftMove: 'Shot from hip height so the bonnet reads as a wall between us and him.',
  culturalTruth: 'the oil rag tucked into the waistband, not held',
  refusal: 'the pose is one beat too composed for a man mid-job',
};
const SLOTS = validateSlots({
  identity: 'a man in his late thirties, lean, close-cropped dark hair, three-day beard',
  wardrobe: 'a faded navy work shirt, sleeves pushed to the elbow, cotton, worn soft at the collar; dark trousers stiff with dust',
  posture: 'weight on the back foot, shoulders square to the engine bay, chin dropped',
  hands: 'left hand flat on the wing, right hand loose at his side',
  gaze: 'aimed down into the open engine bay, roughly a metre in front of him; the face is flat, already deciding',
}, READ).slots;

const compose = (over, extra = {}) => {
  const d = resolveFollows(D(over));
  const reqs = toRequirements(d).map((r, i) => ({ ...r, test: `Test for ${r.id}?` }));
  const p = lockPlanFor(d);
  const refs = orderSwapRefs(d, p, reqs, extra.paths ?? { sourcePath: '/src.png' });
  return buildSwapPrompt({
    slots: SLOTS, decisions: d, requirements: reqs, refs,
    preserveKeys: [...preserveSet(d)], escalate: extra.escalate ?? [],
    subjectOnlyCanny: p.cannySubjectOnly,
  });
};

it('a gaze-only swap changes one thing and preserves the two that always drift', () => {
  const out = compose({ gaze: 'up and past the camera, at someone crossing the yard' });
  assert.match(out, /CHANGE C1 — THE GAZE/);
  assert.match(out, /PRESERVE —/);
  assert.match(out, /· CAMERA — a medium shot/);
  assert.match(out, /· THE PERSON — a man in his late thirties/);
  assert.ok(!/CHANGE C2/.test(out), 'one change means one change');
  assert.ok(!/CONSEQUENCE —/.test(out), 'gaze is terminal — nothing follows it');
  assert.ok(!/· WARDROBE/.test(out), 'Image 1 already shows the wardrobe; saying so spends attention on nothing');
});

it('the contract restates every requirement as a checkable test', () => {
  const out = compose({ identity: 'a woman in her sixties', place: 'a shut souq', time: 'night' });
  assert.match(out, /THIS FRAME IS ONLY CORRECT IF ALL OF THESE ARE TRUE/);
  for (const id of ['C1', 'C2', 'C3']) assert.match(out, new RegExp(`  ${id} — Test for ${id}\\?`));
  assert.match(out, /Satisfying two and averaging the third is a failed frame/);
});

it('the prompt cites every image attached to one change', () => {
  const out = compose({
    wardrobe: { state: 'swap', value: 'a tailored work coat', refPaths: ['/coat-front.png', '/coat-back.png', '/coat-detail.png'] },
  });
  assert.match(out, /Images 2, 3 and 4 jointly show it/);
});

it('what follows a change is stated, and bounded', () => {
  const d = resolveFollows(D({ time: 'night, after the shops have closed' }));
  d.light.proposed = 'the same doorway, now lit by a single sodium lamp behind it; hard, from 3/4 back';
  const reqs = toRequirements(d).map(r => ({ ...r, test: 'Is it night?' }));
  const out = buildSwapPrompt({
    slots: SLOTS, decisions: d, requirements: reqs,
    refs: orderSwapRefs(d, lockPlanFor(d), reqs, { sourcePath: '/src.png' }),
    preserveKeys: [...preserveSet(d)],
  });
  assert.match(out, /CONSEQUENCE —/);
  assert.match(out, /· LIGHT — because the hour changed, it becomes: the same doorway/);
  assert.match(out, /the ONLY other things in this frame permitted to move/);
  assert.ok(!/· COLOUR — because/.test(out), 'a followed slot with no proposal yet must not emit an empty line');
});

it('the structure block cites the plates that actually shipped', () => {
  const out = compose({ light: 'one sodium lamp behind them' },
    { paths: { sourcePath: '/src.png', cannyPath: '/canny.png', depthPath: '/depth.png' } });
  assert.match(out, /Image 2 is an edge stencil of Image 1 and Image 3 is its depth map/);
});

it('a plate the machine could not build is never cited', () => {
  // lockPlanFor wants canny+depth here, but no plate paths were passed —
  // the block must vanish rather than name an Image that is not attached.
  const out = compose({ light: 'one sodium lamp behind them' });
  assert.ok(!/STRUCTURE —/.test(out), 'a cited-but-absent reference is worse than no lock');
});

it('a place swap stencils the subject and says the blank is where the new world goes', () => {
  const out = compose({ place: 'a shut souq at night' },
    { paths: { sourcePath: '/src.png', cannyPath: '/subject_canny.png', facePath: '/face.png' } });
  assert.match(out, /Image 2 is an edge stencil of the SUBJECT ONLY/);
  assert.match(out, /where the new place is built/);
  assert.match(out, /IDENTITY ANCHOR — Image 3 is the face already in Image 1/);
});

it('an image-only change names the image instead of leaving a blank', () => {
  const out = compose({ identity: { state: 'swap', refPath: '/newface.png' } },
    { paths: { sourcePath: '/src.png', depthPath: '/depth.png' } });
  assert.match(out, /The new person is the one shown in Image 3\./);
  assert.match(out, /NOTHING else from it/, 'a face reference is the one attachment a model over-reads');
});

it('a change with no reference never points at one', () => {
  // the bug this test exists for: the identity line ended with "take it from that
  // reference", which is an instruction pointing at nothing when the user typed
  // words and attached no image — and the model fills that gap by inventing.
  const out = compose({ identity: 'a woman in her sixties, silver hair pinned back' },
    { paths: { sourcePath: '/src.png' } });
  assert.match(out, /The new person is a woman in her sixties, silver hair pinned back\./);
  assert.ok(!/that reference/.test(out));
  assert.ok(!/Take their face/.test(out), 'the reference clause must vanish with the reference');
  assert.ok(!/Image [2-9]/.test(out), 'only Image 1 shipped, so only Image 1 may be cited');
});

it('the literal ask names all three keeps, with their values', () => {
  const out = compose({ identity: { state: 'swap', value: 'a woman in her sixties', refPath: '/f.png' } },
    { paths: { sourcePath: '/src.png', depthPath: '/depth.png' } });
  assert.match(out, /· ACTION — checking the engine of a stopped pickup/);
  assert.match(out, /· GAZE — aimed down into the open engine bay/);
  assert.match(out, /· CAMERA — a medium shot/);
  assert.match(out, /· HANDS — left hand flat on the wing/);
  assert.ok(!/IDENTITY ANCHOR/.test(out), 'never anchor the face being replaced');
});

it('a re-ask says what failed last time — it is not the same sentence sent twice', () => {
  const out = compose({ identity: 'a woman in her sixties', place: 'a shut souq' }, { escalate: ['C2'] });
  assert.match(out, /A previous attempt at this exact frame satisfied everything else and FAILED on C2/);
  assert.match(out, /do not let the rest of the frame soften it back toward the original/);
});

it('round 1 carries no re-ask language', () => {
  const out = compose({ identity: 'a woman in her sixties' });
  assert.ok(!/previous attempt/.test(out), 'nothing has failed yet');
});

it('only the original frame is ever attached', () => {
  // The law Anwar set after reading the sidecars: the images this tool sends are
  // his original and the references he chose — never something it made earlier.
  const out = compose({ identity: { state: 'swap', value: 'a woman in her sixties', refPath: '/newface.png' } },
    { paths: { sourcePath: '/original.png', depthPath: '/depth.png' } });
  assert.match(out, /Image 1 is the source frame/);
  const d = resolveFollows(D({ identity: { state: 'swap', value: 'a woman in her sixties', refPath: '/newface.png' } }));
  const refs = orderSwapRefs(d, lockPlanFor(d), toRequirements(d), { sourcePath: '/original.png', depthPath: '/depth.png' });
  assert.equal(refs.find(r => r.role === 'source').filePath, '/original.png');
  assert.deepEqual(refs.map(r => r.filePath).sort(), ['/depth.png', '/newface.png', '/original.png'],
    'the original, a map of the original, and the face HE chose — nothing this tool made');
});

it('the refusal never reaches the render', () => {
  const out = compose({ time: 'night' });
  assert.ok(!/one beat too composed/.test(out),
    'EyeRead.refusal names the frame’s flaw — emitting it asks the model to reproduce it');
  assert.equal(SLOTS.refusal, undefined, 'and it must not even be carried in the slots');
  assert.equal(SLOTS.culturalTruth, 'the oil rag tucked into the waistband, not held');
});

it('a slot the read could not see contributes nothing rather than an empty bullet', () => {
  const blind = { ...SLOTS, identity: '' };
  const d = resolveFollows(D({ place: 'a souq' }));
  const reqs = toRequirements(d).map(r => ({ ...r, test: 't?' }));
  const out = buildSwapPrompt({
    slots: blind, decisions: d, requirements: reqs,
    refs: orderSwapRefs(d, lockPlanFor(d), reqs, { sourcePath: '/src.png' }),
    preserveKeys: [...preserveSet(d)],
  });
  assert.ok(!/· THE PERSON —\s*\./.test(out), 'an empty bullet teaches the model that a blank is acceptable');
});

it('the verbatim axes are copied, never re-read', () => {
  assert.equal(SLOTS.action, READ.action);
  assert.equal(SLOTS.place, READ.place);
  assert.deepEqual(SLOTS.camera, READ.lens);
  assert.deepEqual(SLOTS.light, READ.light);
});

it('an evasive person slot is marked thin, not accepted', () => {
  const { thin } = validateSlots({ identity: 'n/a', wardrobe: '', posture: 'weight back', hands: 'both at his side', gaze: 'down' }, READ);
  assert.ok(thin.includes('identity'), '"n/a" means the model did not look');
  assert.ok(thin.includes('wardrobe'));
  assert.ok(!thin.includes('posture'));
});

it('a head-to-toe outfit read off a close-up is flagged as invention', () => {
  const cu = { ...READ, lens: { ...READ.lens, size: 'cu' } };
  const thin = validateSlots({
    identity: 'a man in his late thirties', posture: 'square on', hands: 'out of frame', gaze: 'down',
    wardrobe: 'a faded navy work shirt with the sleeves pushed to the elbow, dark cotton trousers stiff with dust, brown leather boots worn through at the toe, a canvas belt',
  }, cu).thin;
  assert.ok(thin.includes('wardrobe'), 'the Eye has no golden data for wardrobe — a confident close-up outfit is the failure mode');
  const wide = validateSlots({
    identity: 'a man in his late thirties', posture: 'square on', hands: 'out of frame', gaze: 'down',
    wardrobe: 'a faded navy work shirt with the sleeves pushed to the elbow, dark cotton trousers stiff with dust, brown leather boots worn through at the toe, a canvas belt',
  }, READ).thin;
  assert.ok(!wide.includes('wardrobe'), 'the same read from a medium shot is fine');
});

// ── report ──────────────────────────────────────────────────────────────────
rmSync(OUT, { recursive: true, force: true });
if (failures.length) {
  console.error(`\n✗ ${failures.length} failed, ${pass} passed\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`✓ ${pass} passed`);
