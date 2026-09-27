import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const main = read('electron/main.ts');
const preload = read('electron/preload.ts');
const bridge = read('src/types/hjen-bridge.d.ts');
const store = read('src/store.ts');
const registry = read('src/lib/models/registry.ts');
const promptBuilder = read('src/lib/promptBuilder.ts');
const storyboardSkill = read('skills/cinematic-high-contrast-ink-storyboard-system.md');

const skillHandler = main.slice(main.indexOf("ipcMain.handle('hjen:run-skill'"));

assert.match(registry, /id: 'storyboard'[\s\S]*?routed: false/,
  'Storyboard Tools must remain independent from Frame Skills.');
assert.match(registry, /id: 'frame-skill'[\s\S]*?routed: true/,
  'Frame Skills must expose their own routed Settings task.');
assert.match(skillHandler, /taskModelOverride\('frame-skill'\)/,
  'Skill execution must resolve the Frame Skills model from Settings.');
assert.match(skillHandler, /runLlmJson\(\{/,
  'Skill execution must use the shared multi-provider LLM door.');
assert.match(skillHandler, /imagePaths: referencePaths/,
  'Skill execution must send actual attachment bytes to the selected model.');
assert.match(skillHandler, /FRAME SETTINGS \(signed constraints\)/,
  'Skill execution must include the Frame settings contract.');
assert.match(skillHandler, /skillMasterStyleLock/,
  'Skill execution must extract an executable MASTER STYLE LOCK.');
assert.match(skillHandler, /skill_contract_failed/,
  'A non-compliant Master Prompt must stop before image generation.');

assert.match(preload, /runSkill:[\s\S]*?references\?: Array/,
  'The preload bridge must carry reference metadata.');
assert.match(bridge, /runSkill:[\s\S]*?settings\?: Record<string, unknown>/,
  'The public renderer bridge must carry Frame settings.');
assert.match(store, /references: layersSnapshot\.map/,
  'Frame Generate must pass the attached layers into the Skill call.');
assert.match(store, /masterReferencesCount:/,
  'The generation sidecar must record how many references the Skill saw.');
assert.match(store, /hjen-frame-skill-storyboard-contract/,
  'Gateway generation must protect storyboard Skills from the legacy photoreal server tail.');

assert.match(promptBuilder, /detectPromptRenderMode/,
  'Prompt assembly must detect an explicit storyboard render contract.');
assert.match(promptBuilder, /renderMode === 'storyboard'/,
  'Storyboard prompts need a non-photographic render branch.');
assert.match(promptBuilder, /No photographic skin/,
  'The storyboard branch must explicitly refuse the photographic skin tail.');

// Execute the real TypeScript prompt builder with its mention normalizer
// replaced by an identity function. This proves behavior, not just source
// wiring: a Skill Master Prompt cannot receive the photoreal skin clause.
const require = createRequire(import.meta.url);
const ts = require('typescript');
const executablePromptBuilder = promptBuilder.replace(
  "import { normalizeMentions } from './mentions';",
  'const normalizeMentions = (value: string) => value;',
);
const compiled = ts.transpileModule(executablePromptBuilder, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const promptModule = { exports: {} };
new Function('exports', 'module', compiled)(promptModule.exports, promptModule);
const { buildPrompt } = promptModule.exports;
const baseSelections = {
  angle: null, movie: null, photographer: null, camera: null, lens: null,
  stock: null, lighting: null, movement: null, focal_mm: null, aperture_f: null,
  aspect: '16:9', resolution: '3.7MP', quality: 'HIGH', model: 'GPT_IMAGE_2',
  style_preset: 'NONE', atmosphere: '', negative: '',
};
const storyboardFinal = buildPrompt({
  ...baseSelections,
  prompt: 'FRAME PURPOSE: hold the beat. INK TREATMENT: solid black brush. MASTER STYLE LOCK: cinematic ink storyboard illustration, no photorealistic skin rendering.',
});
assert.match(storyboardFinal, /Render: non-photographic cinematic storyboard illustration/);
assert.doesNotMatch(storyboardFinal, /real skin texture with visible pores/);

const photoFinal = buildPrompt({ ...baseSelections, prompt: 'A woman waiting beside a train door.' });
assert.match(photoFinal, /Render: photorealistic, real skin texture with visible pores/);

// The gateway composes the paid image prompt on the server. Keep that copy in
// behavioral lock-step with the offline renderer copy.
const serverComposePath = path.resolve(root, '../server/src/frame/compose.js');
const serverCompose = await import(pathToFileURL(serverComposePath).href);
const serverStoryboardFinal = serverCompose.buildPrompt({
  ...baseSelections,
  prompt: 'FRAME PURPOSE: hold the beat. INK TREATMENT: solid black brush. MASTER STYLE LOCK: cinematic ink storyboard illustration, no photorealistic skin rendering.',
});
assert.match(serverStoryboardFinal, /Render: non-photographic cinematic storyboard illustration/);
assert.doesNotMatch(serverStoryboardFinal, /real skin texture with visible pores/);
const serverPhotoFinal = serverCompose.buildPrompt({ ...baseSelections, prompt: 'A woman waiting beside a train door.' });
assert.match(serverPhotoFinal, /Render: photorealistic, real skin texture with visible pores/);

assert.ok(storyboardSkill.trimEnd().endsWith('</examples>'),
  'The bundled ink-storyboard Skill must not end mid-sentence.');
assert.match(storyboardSkill, /MASTER STYLE LOCK:/,
  'The Skill must retain a deterministic render-mode contract.');

console.log('skill pipeline regression checks passed');
