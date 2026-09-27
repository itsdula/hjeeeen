// Storyboard breakdown + cast/place extraction via Claude (window.hjen.claudeJson).
// The model emits a fenced JSON block which we parse defensively. If parsing
// fails the caller falls back to manual editing — never a hard crash.

import type { StoryboardShot, StoryboardRefSlot } from '../types/storyboard';
import { uid } from '../store/storyboardStore';

// ─── system prompts ───────────────────────────────────────────────

const BREAKDOWN_SYSTEM = `You are a film director's storyboard supervisor. You read a script (screenplay, ad script, or treatment) and decompose it into individual storyboard SHOTS in the international §6.1 panel format.

Rules:
- One shot = one camera setup = one panel. A dialogue exchange is usually several shots.
- Number shots by scene: scene 1 → panels 1A, 1B, 1C…; scene 2 → 2A, 2B… Letters go A,B,…,Z,AA,AB.
- "description" is the single most important field: a concrete, generation-grade one-line visual brief a board artist or image model can draw cold (subject + action + framing intent). Specific, not abstract. No "well lit", no "atmospheric".
- Fill the technical stack when the script implies it; leave a field out if unknown (do NOT invent dialogue or shot sizes the script doesn't support).
- shot codes: ECU, CU, MCU, MS, MLS, WS, EWS, OTS, POV, INS, 2S. angle: EL, LA, HA, OH, DUT. priority: A (essential), B, C.
- dialogue ≤ 12 words per panel; if Arabic, keep the Arabic and add an English gloss in [brackets].
- Refuse cliché. If the script is thin, infer the minimum honest coverage — do not pad.
- When a location repeats by type but belongs to different people (e.g. a boy's bedroom vs a girl's bedroom), name WHOSE room it is in the description and blocking, so they never collapse into one room.

COMPACT OUTPUT (important): keep it short so the whole thing fits — description ≤ 24 words; every other field ≤ 6 words. Complete EVERY shot; never stop early or trail off. Only include optional fields the script clearly supports; omit the rest. Emit minified JSON (no pretty-printing).

OUTPUT: return ONLY a fenced \`\`\`json block, no prose before or after. Schema (only scene, letter, description are required):
{
  "shots": [
    {
      "scene": 1, "letter": "A",
      "description": "string (required, concise)",
      "shot": "MCU", "angle": "EL", "lens": "40mm", "move": "⊙→ push",
      "duration": "2.5s", "dialogue": "", "priority": "A",
      "character": "who + state", "blocking": "position", "light": "key + ambient", "frameFurniture": "FG/MG/BG + truth object"
    }
  ]
}`;

const CAST_SYSTEM = `You read a script and its shot breakdown, and extract the recurring CHARACTERS, PLACES (locations), and continuity ELEMENTS (props/objects) that should each get a single locked reference image so they stay consistent across panels.

Rules:
- A character is a named or clearly recurring person. A place is a distinct location/set. An element is a recurring prop/object whose continuity matters (a specific cup, a phone, a keepsake, a vehicle).
- For each, give a short "name" and a one-line "note" (character: age, build, wardrobe, cultural register; place: what the room/exterior is; element: what the object is). Be concrete and culturally specific; refuse stereotype.
- CRITICAL — distinct instances of the SAME type of location are SEPARATE places. A boy's bedroom and a girl's bedroom are TWO different places with distinct names (e.g. "Boy's bedroom", "Girl's bedroom"), each with its own note. NEVER merge two rooms that belong to different people or different scenes into one "Bedroom". The same applies to any repeated room type (two kitchens, two offices, two cars). When in doubt, split and name by owner/scene.
- Only list entities actually present in the material. Do not invent. Elements should be the few objects that truly recur — not every prop.

ALSO assign, for EVERY shot in the provided breakdown (keyed by its panel id like "1A"), exactly which characters, places, and elements appear IN that shot — by name. A shot is in a place even if the place isn't named in its line (infer from the scene). This drives reference continuity, so be thorough.

OUTPUT: return ONLY a fenced \`\`\`json block, no prose. Schema:
{
  "characters": [ { "name": "MUBARAK", "note": "28, Najdi, compact build, washed-soft grey tee, no thobe" } ],
  "places":     [ { "name": "Bedroom", "note": "lived-in single room, TV glow, prayer rug folded on shelf" } ],
  "elements":   [ { "name": "Brass dallah", "note": "worn brass coffee pot the family passes around" } ],
  "assignments": { "1A": { "characters": ["MUBARAK"], "places": ["Bedroom"], "elements": [] } }
}`;

// ─── JSON extraction ──────────────────────────────────────────────

/** Pull the first plausible JSON object out of an LLM response — fenced block
 *  first, then a bare {…} span. Returns null if nothing parses. */
export function extractJson(text: string): any | null {
  if (!text) return null;
  // 1. fenced ```json … ``` (or plain ``` … ```)
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates: string[] = [];
  if (fence) candidates.push(fence[1]);
  // 2. widest brace span as fallback
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  for (const c of candidates) {
    try { return JSON.parse(c.trim()); } catch { /* try next */ }
  }
  return null;
}

/** Salvage complete `{...}` objects from (possibly truncated) text — string-aware,
 *  brace-balanced. Used when the JSON array got cut off mid-stream. */
export function salvageObjects(text: string): any[] {
  const out: any[] = [];
  if (!text) return out;
  // Prefer the region after a "shots" array opener, if present.
  const m = text.search(/"shots"\s*:\s*\[/);
  const region = m >= 0 ? text.slice(text.indexOf('[', m) + 1) : text;
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let j = 0; j < region.length; j++) {
    const ch = region[j];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') { if (depth === 0) start = j; depth++; }
    else if (ch === '}') { depth--; if (depth === 0 && start >= 0) { try { out.push(JSON.parse(region.slice(start, j + 1))); } catch { /* skip */ } start = -1; } }
  }
  return out;
}

// ─── public API ───────────────────────────────────────────────────

const DESCRIBE_LOOK_SYSTEM =
  'You name the DRAWING STYLE of a storyboard reference image — its medium and rendering register only. ' +
  'Write ONE phrase, 50–100 characters, naming the medium, line/tone quality, and palette. ' +
  'Describe the LOOK, never the subject or scene content. No people, no story. No quotes, no trailing period, no preamble. ' +
  'Example: "Loose graphite pencil on white, soft cross-hatched greys, monochrome".';

/** Describe an uploaded style reference in 50–100 chars (drives the custom look). */
export async function describeReference(imagePath: string): Promise<{ ok: true; note: string } | { ok: false; message: string }> {
  if (!imagePath) return { ok: false, message: 'No reference to describe.' };
  const res = await window.hjen.claudeJson({
    system: DESCRIBE_LOOK_SYSTEM,
    prompt: 'Describe the drawing style of this reference image in one 50–100 character phrase.',
    imagePath,
    maxTokens: 120,
  });
  if (!res.ok) return { ok: false, message: res.message };
  const note = res.text.trim().replace(/^["'\s]+|["'\s.]+$/g, '').slice(0, 100);
  if (!note) return { ok: false, message: 'Could not read a description. Try again.' };
  return { ok: true, note };
}

export async function breakdownScript(scriptText: string, creativeContext = ''): Promise<{ ok: true; shots: StoryboardShot[] } | { ok: false; message: string }> {
  const script = scriptText.trim();
  if (!script) return { ok: false, message: 'Paste a script first.' };

  const res = await window.hjen.claudeJson({
    system: BREAKDOWN_SYSTEM,
    prompt: `Break this script into storyboard shots.${creativeContext ? `\n\nSIGNED CREATIVE HANDOFF — obey these laws; do not invent a second visual language:\n${creativeContext}` : ''}\n\nSCRIPT:\n${script}`,
    maxTokens: 24000,
  });
  if (!res.ok) return { ok: false, message: res.message };

  // Normal parse first; if that fails or yields nothing (e.g. the output was
  // truncated), salvage every complete shot object from the raw text.
  const parsed = extractJson(res.text);
  let rawShots: any[] = Array.isArray(parsed?.shots) ? parsed.shots : [];
  if (rawShots.length === 0) rawShots = salvageObjects(res.text).filter(o => o && (o.description || o.scene || o.letter));
  if (rawShots.length === 0) {
    const truncated = (res as any).truncated;
    return { ok: false, message: truncated ? 'The response was cut off before any shot completed — try again.' : 'Could not read shots from the response. Edit shots manually, or try again.' };
  }

  const shots: StoryboardShot[] = rawShots.map((s: any, i: number) => ({
    id: uid('shot'),
    scene: Number.isFinite(s?.scene) ? Number(s.scene) : 1,
    letter: typeof s?.letter === 'string' && s.letter.trim() ? s.letter.trim().toUpperCase() : String.fromCharCode(65 + (i % 26)),
    description: str(s?.description),
    shot: optStr(s?.shot),
    angle: optStr(s?.angle),
    lens: optStr(s?.lens),
    move: optStr(s?.move),
    duration: optStr(s?.duration),
    dialogue: optStr(s?.dialogue),
    sfx: optStr(s?.sfx),
    music: optStr(s?.music),
    transition: optStr(s?.transition),
    priority: (['A', 'B', 'C'].includes(s?.priority) ? s.priority : undefined) as StoryboardShot['priority'],
    character: optStr(s?.character),
    blocking: optStr(s?.blocking),
    light: optStr(s?.light),
    frameFurniture: optStr(s?.frameFurniture),
    status: 'pending',
  }));

  return { ok: true, shots };
}

export interface ShotAssignment { characters: string[]; places: string[]; elements: string[] }

export async function extractCastAndPlaces(
  scriptText: string,
  shots: StoryboardShot[],
): Promise<
  | { ok: true; characters: StoryboardRefSlot[]; places: StoryboardRefSlot[]; elements: StoryboardRefSlot[]; assignments: Record<string, ShotAssignment> }
  | { ok: false; message: string }
> {
  const script = scriptText.trim();
  if (!script) return { ok: false, message: 'Paste a script first.' };

  const shotsDigest = shots
    .map(s => `${s.scene}${s.letter}: ${s.description}${s.character ? ` — ${s.character}` : ''}`)
    .join('\n')
    .slice(0, 6000);

  const res = await window.hjen.claudeJson({
    system: CAST_SYSTEM,
    prompt: `SCRIPT:\n${script}\n\nSHOT BREAKDOWN:\n${shotsDigest}\n\nExtract the recurring characters and places.`,
    maxTokens: 8000,
  });
  if (!res.ok) return { ok: false, message: res.message };

  const parsed = extractJson(res.text);
  const toSlots = (arr: any, prefix: string): StoryboardRefSlot[] =>
    Array.isArray(arr)
      ? arr.filter((x: any) => x && str(x.name)).map((x: any) => ({ id: uid(prefix), name: str(x.name), note: optStr(x.note) }))
      : [];

  const characters = toSlots(parsed?.characters, 'char');
  const places = toSlots(parsed?.places, 'place');
  const elements = toSlots(parsed?.elements, 'el');
  if (characters.length === 0 && places.length === 0 && elements.length === 0) {
    return { ok: false, message: 'Could not read any cast, places, or elements. Add them manually, or try again.' };
  }

  const assignments: Record<string, ShotAssignment> = {};
  const rawAssign = parsed?.assignments;
  if (rawAssign && typeof rawAssign === 'object') {
    for (const [pid, val] of Object.entries(rawAssign as Record<string, any>)) {
      const arr = (k: string) => Array.isArray(val?.[k]) ? val[k].filter((x: any) => typeof x === 'string').map((x: string) => x.trim()) : [];
      assignments[pid] = { characters: arr('characters'), places: arr('places'), elements: arr('elements') };
    }
  }
  return { ok: true, characters, places, elements, assignments };
}

// ─── coercion helpers ─────────────────────────────────────────────
function str(v: any): string { return typeof v === 'string' ? v.trim() : ''; }
function optStr(v: any): string | undefined { const s = str(v); return s || undefined; }
