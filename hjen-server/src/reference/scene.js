// scene.js — Reference Maker, SERVER-side. Port of the hjen:reference-scene-*
// handlers in app/electron/main.ts.
//
// Same law as the other ported engines: the three system prompts below are the
// recipe and are lifted VERBATIM from main.ts. What changed is only that images
// arrive as cloud tokens and the model override is read from the account's
// models document. Recipe parity is asserted in src/reference/scene.test.mjs.

import { cloud } from '../cloudstore.js';
import { runLlmJson as serverLlm, providerFor as llmProvider, readVisionImage } from '../llm/run.js';

function taskModelOverride(acc, task) {
  try {
    const j = cloud.readAcctDoc(acc, 'models', null);
    const m = j?.tasks?.[task];
    return typeof m === 'string' && m ? m : null;
  } catch { return null; }
}
/** The web's existsSync: can this cloud token be read as an image at all. */
async function readable(acc, token) {
  if (!token) return false;
  return !!(await readVisionImage(acc, token));
}
/** Lifted verbatim from main.ts. */
function jsonObjectFromText(text) {
  const clean = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try { return JSON.parse(clean); } catch {}
  const first = clean.indexOf('{'), last = clean.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  try { return JSON.parse(clean.slice(first, last + 1)); } catch { return null; }
}
/** Lifted verbatim from electron/providerFallback.ts. */
function shouldRetryLlmReason(reason) {
  return reason === 'provider_unavailable' || reason === 'provider_quota'
    || reason === 'auth_error' || reason === 'no_key'
    || reason === 'network' || reason === 'timeout';
}

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

async function sceneUnderstand(inv, args = {}) {
  const runLlmJson = (a) => serverLlm(inv, a);
  const rawText = String(args?.rawText || '').trim();
  if (!rawText) return { ok: false, reason: 'empty_note', message: 'Explain why you chose this image first.' };
  if (!args?.imagePath || !(await readable(inv.id, args.imagePath))) return { ok: false, reason: 'missing_image', message: 'The source image is no longer available.' };
  const model = taskModelOverride(inv.id, 'reference-maker-understand') || 'claude-sonnet-4-6';
  const candidates = (Array.isArray(args.intentReferences) ? args.intentReferences : []).slice(0, 8);
  const intentReferences = [];
  for (const reference of candidates) {
    if (reference?.imagePath && await readable(inv.id, String(reference.imagePath))) intentReferences.push(reference);
  }
  const prompt = [
    `DIRECTOR NOTE (highest authority):\n${rawText}`,
    intentReferences.length
      ? `DIRECTOR-ATTACHED INTENT REFERENCES (images 2-${intentReferences.length + 1}; clarify the note, never add scope):\n${JSON.stringify(intentReferences.map((reference, index) => ({ image: index + 2, label: String(reference.label || ''), sourceKind: String(reference.sourceKind || '') })))}`
      : 'DIRECTOR-ATTACHED INTENT REFERENCES: none',
    `DECK POSITION: page ${Number(args.page || 0)}${args.sceneTitle ? ` \u00b7 ${args.sceneTitle}` : ''}`,
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
}

async function sceneDrift(inv, args = {}) {
  const runLlmJson = (a) => serverLlm(inv, a);
  if (!args?.sourcePath || !args?.takePath || !(await readable(inv.id, args.sourcePath)) || !(await readable(inv.id, args.takePath))) {
    return { ok: false, reason: 'missing_image', message: 'Both source and take are required for drift review.' };
  }
  const keepItems = Array.isArray(args.keepItems) ? args.keepItems : [];
  const categoryAxes = {
    composition: ['composition'], camera: ['composition', 'lens'], light: ['lighting'],
    colour: ['palette'], texture: ['texture'], identity: ['identity'],
    performance: ['locked-content'], wardrobe: ['locked-content'], place: ['locked-content'],
    time: ['locked-content'], objects: ['locked-content'], environment: ['locked-content'],
  };
  const requiredAxes = [...new Set(keepItems.flatMap((item) => categoryAxes[String(item?.category || '')] || ['locked-content']))];
  const model = taskModelOverride(inv.id, 'reference-maker-drift') || 'gemini-3.6-flash';
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
}

async function sceneReviseContract(inv, args = {}) {
  const runLlmJson = (a) => serverLlm(inv, a);
  const reviewNote = String(args?.reviewNote || '').trim();
  if (!reviewNote) return { ok: false, reason: 'empty_review', message: 'Write what should change in the next take.' };
  if (!args?.sourcePath || !(await readable(inv.id, args.sourcePath))) return { ok: false, reason: 'missing_source', message: 'The source image is no longer available.' };
  const takePath = (args.takePath && await readable(inv.id, args.takePath)) ? args.takePath : undefined;
  const seen = new Set();
  const references = [];
  for (const reference of (Array.isArray(args.references) ? args.references : [])) {
    const p = String(reference?.imagePath || '');
    if (!p || seen.has(p) || references.length >= 8) continue;
    if (!(await readable(inv.id, p))) continue;
    seen.add(p); references.push(reference);
  }
  const imagePaths = [args.sourcePath, ...(takePath ? [takePath] : []), ...references.map(reference => String(reference.imagePath))];
  const firstReferenceImage = takePath ? 3 : 2;
  const catalog = references.map((reference, index) => ({
    image: firstReferenceImage + index,
    label: String(reference.label || ''),
    sourceKind: String(reference.sourceKind || ''),
  }));
  const model = taskModelOverride(inv.id, 'reference-maker-contract-revision') || 'claude-sonnet-4-6';
  const prompt = [
    `ORIGINAL DIRECTOR NOTE:\n${String(args.directorNote || '').trim()}`,
    `USER REVIEW NOTE (highest authority for this revision):\n${reviewNote}`,
    `CURRENT CONTRACT:\n${JSON.stringify(args.currentContract || {})}`,
    `AUDIT OF THE REVIEWED TAKE (diagnostic, not new intent):\n${JSON.stringify(args.drift || null)}`,
    `SUPPORT REFERENCE CATALOG:\n${catalog.length ? JSON.stringify(catalog) : 'none'}`,
  ].join('\n\n');
  const runRevision = (candidate) => runLlmJson({
    provider: llmProvider(candidate), model: candidate, system: REFERENCE_CONTRACT_REVISION_SYSTEM,
    prompt, imagePaths, maxTokens: 5000, jsonMode: true,
  });
  let usedModel = model;
  let response = await runRevision(model);
  if (!response.ok && shouldRetryLlmReason(response.reason)) {
    const fallbackModel = taskModelOverride(inv.id, 'reference-maker-contract-revision-fallback') || 'gemini-3.6-flash';
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
}

export const referenceScene = {
  understand: sceneUnderstand,
  drift: sceneDrift,
  reviseContract: sceneReviseContract,
};
