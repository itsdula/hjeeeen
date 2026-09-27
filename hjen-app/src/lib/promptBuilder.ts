import type { Selections } from '../types/catalog';
import type { Layer } from '../store';
import { normalizeMentions } from './mentions';

export type PromptRenderMode = 'photoreal' | 'animation' | 'storyboard';

/** Detect an explicit storyboard contract emitted by a Skill. The check is
 * intentionally strict: merely mentioning "storyboard" in a photographic
 * brief must not disable the normal skin/texture render guard. */
export function detectPromptRenderMode(prompt: string, isAnimation = false): PromptRenderMode {
  const text = String(prompt || '');
  const hasStoryboardContract =
    /MASTER STYLE LOCK\s*:/i.test(text) && /(?:storyboard|ink illustration|ink rendering)/i.test(text) ||
    /FRAME PURPOSE\s*:/i.test(text) && /INK TREATMENT\s*:/i.test(text) ||
    /non-photographic storyboard illustration/i.test(text);
  if (hasStoryboardContract) return 'storyboard';
  return isAnimation ? 'animation' : 'photoreal';
}

// Assembles a single OpenAI gpt-image-2 prompt string from the user's selections.
// Prompt structure order:
// scene → perspective fragment → camera/lens/stock prompts → focal/aperture descriptors → lighting → atmosphere → style anchor → references

export function buildPrompt(s: Selections, layers: Layer[] = []): string {
  // Style register decides whether we append photoreal directives or
  // animation-language directives. An Animation style + "photorealistic
  // skin texture" tail is a direct contradiction that confuses gpt-image-2.
  const isAnimation = s.style_preset === 'MOVIE' && s.movie?.type === 'Animation';
  const isPhotographer = s.style_preset === 'PHOTOGRAPHER' && !!s.photographer;
  const renderMode = detectPromptRenderMode(s.prompt, isAnimation);

  const parts: string[] = [];

  // ═══ 1. STYLE GATE — declared up front so every later clause is read
  //    inside its register. Animation MUST lead, otherwise the model
  //    averages towards photoreal and the style chip becomes decorative.
  if (s.style_preset === 'MOVIE' && s.movie) {
    const meta = [s.movie.director, s.movie.cinematographer && `DP ${s.movie.cinematographer}`, s.movie.year].filter(Boolean).join(', ');
    const registerWord = isAnimation ? 'animation' : 'cinematography';
    parts.push(`In the ${registerWord} style of ${s.movie.title}${meta ? ` (${meta})` : ''}`);
  } else if (isPhotographer && s.photographer) {
    parts.push(`In the photographic style of ${s.photographer.name}${s.photographer.notes ? ` — ${s.photographer.notes}` : ''}`);
  }

  // 2. Main scene description (user-written). @mentions become the same
  //    quoted 'name' convention the reference clauses below use, so the
  //    scene text and "Use the attached reference images: 'name' (…)"
  //    name the same entity identically.
  const scene = normalizeMentions(
    s.prompt,
    layers.map(l => l.customName?.trim() || l.name),
    'quote',
  );
  if (scene.trim()) parts.push(scene.trim());

  // 3. Perspective
  if (s.angle) parts.push(s.angle.description);

  // 4. Camera gear — bundled into one comma-separated technical clause
  //    instead of a chain of mini-sentences. The dense form biases the
  //    model harder than four loose phrases.
  const techParts: string[] = [];
  if (s.camera) techParts.push(`shot on ${s.camera.prompt || s.camera.name}`);
  if (s.lens) techParts.push(`${s.lens.name} lens`);
  if (s.focal_mm) techParts.push(`${s.focal_mm}mm`);
  if (s.aperture_f) techParts.push(`f/${s.aperture_f}`);
  if (s.stock) techParts.push(`on ${s.stock.name}`);
  if (techParts.length > 0) parts.push(`Camera: ${techParts.join(', ')}`);

  // 5. Lighting
  if (s.lighting) parts.push(`Lighting: ${s.lighting.description || s.lighting.name}`);

  // 6. Atmosphere (free-text, last so it can override)
  if (s.atmosphere.trim()) parts.push(`Atmosphere: ${s.atmosphere.trim()}`);

  // 8. References — describe what each attached image represents so the model
  //    can map visual context to subject + category. Images themselves are
  //    sent via images.edit; this text disambiguates which ref is for whom.
  //
  //    Hierarchy: a character layer can be a "subject" with wardrobe/accessory
  //    layers nested under it (via parentLayerId). Other categories (location,
  //    prop, general) stay flat.
  if (layers.length > 0) {
    const displayName = (l: Layer) => l.customName?.trim() || l.name;
    const characters = layers.filter(l => l.category === 'character' && !l.parentLayerId);
    const standaloneOtherChars = layers.filter(l => l.category === 'character' && l.parentLayerId); // edge case
    const compositions = layers.filter(l => l.category === 'composition' && !l.parentLayerId);
    // Exclude composition refs from the flat-rest bucket — they get a
    // dedicated lock clause so they don't dissolve into "general references".
    const restFlat = layers.filter(l => l.category !== 'character' && l.category !== 'composition' && !l.parentLayerId && !l.groupName);
    const legacyGrouped = layers.filter(l => !l.parentLayerId && l.groupName && l.category !== 'character' && l.category !== 'composition');

    // Composition lock clause — emitted FIRST and standalone so gpt-image-2
    // reads it before any other reference prose. When buried inside the
    // "general references" wrapper the model treats it as decorative context
    // and ignores the spatial lock entirely.
    //
    // Strengthened: explicit sub-rules (horizon, subject position, lens
    // perspective, depth plates) instead of a single "match the spatial
    // structure" because the model interprets terse instructions loosely
    // when reference is treated as visual context rather than a hard control.
    if (compositions.length > 0) {
      const names = compositions.map(c => `'${displayName(c)}'`).join(', ');
      const refWord = compositions.length > 1 ? 'these references' : 'this reference';
      parts.push(
        `COMPOSITION LOCK — TREAT THE FOLLOWING REFERENCE AS A HARD FRAMING TEMPLATE, NOT INSPIRATION: ${names}. ` +
        `Reproduce the EXACT same framing rectangle: same camera angle, same lens perspective and apparent focal length, ` +
        `same horizon line height, same subject position within the frame (left/right third, vertical placement), ` +
        `same scale of subject relative to frame edges, same foreground/midground/background plate structure, ` +
        `same headroom and lead room. The output's spatial geometry must MATCH ${refWord} when the two are overlaid. ` +
        `Do NOT reframe, re-crop, rotate, change angle, change height, or invent a new composition — only the subject's ` +
        `identity, wardrobe, and the location/period dressing may differ from ${refWord}; the geometry is locked`
      );
    }

    const parts2: string[] = [];

    // Characters with their nested wardrobe/accessory/etc
    for (const char of characters) {
      const nested = layers.filter(l => l.parentLayerId === char.id);
      const segments: string[] = [`character ${displayName(char)}`];
      if (nested.length > 0) {
        const byCat: Record<string, string[]> = {};
        for (const n of nested) {
          if (!byCat[n.category]) byCat[n.category] = [];
          byCat[n.category].push(displayName(n));
        }
        for (const [cat, names] of Object.entries(byCat)) {
          segments.push(`${cat} ${names.join(', ')}`);
        }
      }
      parts2.push(`'${displayName(char)}' (${segments.join('; ')})`);
    }

    // Legacy grouped (older sidecars using groupName)
    if (legacyGrouped.length > 0) {
      const byGroup: Record<string, Layer[]> = {};
      for (const l of legacyGrouped) {
        const g = l.groupName!;
        if (!byGroup[g]) byGroup[g] = [];
        byGroup[g].push(l);
      }
      for (const [groupName, items] of Object.entries(byGroup)) {
        const byCat: Record<string, string[]> = {};
        for (const l of items) {
          if (!byCat[l.category]) byCat[l.category] = [];
          byCat[l.category].push(displayName(l));
        }
        const segments = Object.entries(byCat).map(([cat, names]) => `${cat} ${names.join(', ')}`);
        parts2.push(`'${groupName}' (${segments.join('; ')})`);
      }
    }

    // Standalone non-character layers (location, prop, general, or orphan wardrobe)
    const remaining = [...restFlat, ...standaloneOtherChars];
    if (remaining.length > 0) {
      const byCat: Record<string, string[]> = {};
      for (const l of remaining) {
        if (!byCat[l.category]) byCat[l.category] = [];
        byCat[l.category].push(displayName(l));
      }
      const segments = Object.entries(byCat).map(([cat, names]) => `${cat}: ${names.join(', ')}`);
      parts2.push(`general references (${segments.join('; ')})`);
    }

    parts.push(`Use the attached reference images: ${parts2.join('. ')}`);
  }

  // 9. Aspect note (gpt-image-2 supports `size` param separately, but we mention it for clarity)
  parts.push(`Aspect ratio ${s.aspect}.`);

  // 10. Render directive — BRANCH on style register so we never contradict
  //     the style chip. Photoreal tail for live-action / photographer /
  //     none; animation tail for animation movies.
  //
  //     IMPORTANT: do not hardcode a specific animation medium ("hand-drawn",
  //     "cel-shaded") in the tail. Different films use different media —
  //     Shrek = 3D CGI, Akira = cel animation, Studio Ghibli = hand-drawn,
  //     Spider-Verse = stylised 3D + comic. Mandating "cel-shaded" for all
  //     animations contradicts ~half the catalog and gpt-image-2 hedges to
  //     a generic 2D look. Tell the model to match the FILM's own medium
  //     and trust the film-title bias to handle the rest.
  if (renderMode === 'storyboard') {
    parts.push(
      'Render: non-photographic cinematic storyboard illustration. Preserve the Master Prompt\'s exact drawing medium, ' +
      'line hierarchy, tonal architecture, negative space and production-readable blocking. No photographic skin, ' +
      'no pores, no glossy 3D rendering, no beauty retouching, no color unless the Master Prompt explicitly requires it'
    );
  } else if (renderMode === 'animation' && s.movie) {
    parts.push(
      `Render: animated illustration in the exact medium and style register of ${s.movie.title} — ` +
      `match that film's specific animation type (whether 3D CGI, 2D hand-drawn, cel animation, ` +
      `stop-motion, or stylised hybrid), its character design language, and its color philosophy. ` +
      `NOT photorealistic, NO photographic skin texture, NO film grain — this is a stylised ` +
      `illustration in the medium of ${s.movie.title}, not a photograph`
    );
  } else {
    parts.push(
      'Render: photorealistic, real skin texture with visible pores and fine facial hair, ' +
      'natural micro-expression, no airbrushing, no plastic skin, no beauty-retouch finish, ' +
      'no stacked filters'
    );
  }

  // 11. NEGATIVE — isolated exclusion clause, emitted dead LAST so the model
  //     reads it as an override and it never bleeds into the scene prose.
  //     gpt-image-2 / Imagen 3.0 expose no native negative_prompt parameter,
  //     so the only place a negative can actually act is the prompt text — but
  //     we keep it physically separate from the user's scene `prompt` (its own
  //     Selections field) so the scene description stays clean. Framed as a
  //     hard "do not render" list, NOT as subject matter, so the model treats
  //     each term as forbidden rather than as something to depict.
  if (s.negative.trim()) {
    parts.push(
      `NEGATIVE — hard exclusion list, NOT subject matter. ` +
      `Do NOT render, include, or even partially depict any of the following anywhere in the frame: ` +
      `${s.negative.trim()}. These elements are forbidden; if any would naturally appear, omit it`
    );
  }

  return parts.join('. ').replace(/\.\s*\./g, '.');
}

// Map our aspect labels to gpt-image-2 supported sizes
// gpt-image-2 supports: 1024x1024, 1024x1536, 1536x1024 (square / portrait / landscape)
export function aspectToSize(aspect: string, _resolution: string): '1024x1024' | '1024x1536' | '1536x1024' {
  const [w, h] = aspect.split(':').map(Number);
  if (Math.abs(w - h) <= 1) return '1024x1024';
  return w > h ? '1536x1024' : '1024x1536';
}
