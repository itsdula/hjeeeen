// Server-side Claude — Refine (enhance) + run-skill. Ported from electron/main.ts
// (hjen:enhance-prompt, hjen:run-skill): same endpoint, model, pricing, and the
// NON_INTERACTIVE_PREAMBLE so skills behave identically to the desktop.

import fs from 'node:fs';
import path from 'node:path';
import { config, paths, ANTHROPIC_ENDPOINT, ENHANCE_MODEL, CLAUDE_PRICING } from '../config.js';

const ENHANCEMENT_SYSTEM_PROMPT = `You rewrite a raw image prompt into one tight, vivid cinematic paragraph (40–80 words, hard ceiling ~160).
Rules:
- Output ONLY the rewritten prompt. No preamble, no quotes, no explanation.
- Honor the attached-reference inventory exactly. If a category shows 0, you may NOT describe anything from it. A character ref defines FACE/IDENTITY only — never its clothing unless a wardrobe ref is also attached. A composition ref defines FRAMING/BLOCKING only.
- Be compatible with any technical settings the user picked, but NEVER name a lens, camera, film stock, or chip — describe their effect in prose only.
- Anchor in concrete, real specificity. No "well-lit", "atmospheric", "beautiful". Name light, posture, material, place.`;

const NON_INTERACTIVE_PREAMBLE = `# HJEN EXECUTION CONTRACT (override any conflicting instructions below)

You are running inside HJEN Studio in a single-shot, non-interactive mode. There is NO user available to answer questions. Your output is sent directly to an image-generation API.

ABSOLUTE RULES:
1. NEVER ask the user anything.
2. If the brief leaves any axis unspecified, SILENTLY auto-fill the most on-aesthetic default. Do not surface your choices.
3. Output ONLY the final ready-to-paste Master Prompt. No preamble, no headers, no closing remarks.
4. The user's brief is the COMPLETE brief — expand it using the style defined in the skill below.
5. The skill body is your style reference — APPLY it, do not echo it.

---

# SKILL BODY (style reference — apply, do not echo):

`;

function mimeOf(file) {
  const ext = file.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  return 'image/png';
}

async function callClaude(body) {
  if (!config.anthropicKey) return { ok: false, reason: 'no_key', message: 'ANTHROPIC_API_KEY not configured on the server.' };
  try {
    const res = await fetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': config.anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text();
      return { ok: false, reason: 'api_error', message: `Anthropic ${res.status}: ${errBody.slice(0, 400)}` };
    }
    const data = await res.json();
    const text = Array.isArray(data?.content)
      ? data.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim() : '';
    if (!text) return { ok: false, reason: 'empty_response', message: 'Claude returned an empty response.' };
    const inputTokens = data?.usage?.input_tokens ?? 0;
    const outputTokens = data?.usage?.output_tokens ?? 0;
    const usd = (inputTokens / 1e6) * CLAUDE_PRICING.inputPerMTok + (outputTokens / 1e6) * CLAUDE_PRICING.outputPerMTok;
    return { ok: true, text, inputTokens, outputTokens, usd };
  } catch (err) {
    return { ok: false, reason: 'network', message: err?.message || 'Network error contacting Anthropic.' };
  }
}

export async function enhancePrompt(args) {
  const raw = (args.rawPrompt || '').trim();
  if (!raw) return { ok: false, reason: 'empty_prompt', message: 'Write a prompt first, then Refine.' };
  const refs = Array.isArray(args.references) ? args.references : [];
  const cats = ['character', 'composition', 'wardrobe', 'prop', 'location', 'general'];
  const inventory = cats.map((c) => {
    const items = refs.filter((r) => r.category === c);
    return `  • ${c}: ${items.length}${items.length ? ' — ' + items.map((r) => `'${r.customName || r.name}'`).join(', ') : ''}`;
  }).join('\n');

  const userBlocks = [
    { type: 'text', text: `User's raw prompt:\n${raw}` },
    { type: 'text', text: `WHAT IS ATTACHED (exhaustive — anything else does NOT exist):\n${inventory}\n\nIf a category shows 0, you may NOT describe anything from it.` },
  ];
  for (const ref of refs) {
    try {
      if (!ref.filePath || !fs.existsSync(ref.filePath)) continue;
      const buf = fs.readFileSync(ref.filePath);
      userBlocks.push({ type: 'image', source: { type: 'base64', media_type: mimeOf(ref.filePath), data: buf.toString('base64') } });
    } catch { /* skip unreadable ref */ }
  }

  const result = await callClaude({ model: ENHANCE_MODEL, max_tokens: 220, system: ENHANCEMENT_SYSTEM_PROMPT, messages: [{ role: 'user', content: userBlocks }] });
  if (!result.ok) return result;
  return { ok: true, enhancedPrompt: result.text, usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens }, usd: result.usd, model: ENHANCE_MODEL };
}

export function listSkills() {
  const dir = paths.skills();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => readSkill(path.join(dir, f))).filter(Boolean);
}

function readSkill(file) {
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const id = path.basename(file, '.md');
    const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!m) return { id, name: id, body: raw.trim() };
    const nameMatch = m[1].match(/^name:\s*(.+)$/m);
    return { id, name: nameMatch ? nameMatch[1].trim() : id, body: m[2].trim() };
  } catch { return null; }
}

export async function runSkill(args) {
  const prompt = (args.prompt || '').trim();
  if (!prompt) return { ok: false, reason: 'empty_prompt', message: 'Write a prompt first, then run a skill.' };
  const safeId = path.basename(args.skillId || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!safeId) return { ok: false, reason: 'invalid_skill', message: 'Invalid skill id.' };
  const file = path.join(paths.skills(), `${safeId}.md`);
  if (!fs.existsSync(file)) return { ok: false, reason: 'skill_not_found', message: 'Skill not found.' };
  const skill = readSkill(file);
  if (!skill || !skill.body) return { ok: false, reason: 'skill_unreadable', message: 'Could not parse the skill.' };
  const result = await callClaude({ model: ENHANCE_MODEL, max_tokens: 4096, system: NON_INTERACTIVE_PREAMBLE + skill.body, messages: [{ role: 'user', content: prompt }] });
  if (!result.ok) return result;
  return { ok: true, masterPrompt: result.text, usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens }, usd: result.usd, model: ENHANCE_MODEL, skillId: skill.id, skillName: skill.name };
}
