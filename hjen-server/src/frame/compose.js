// HJEN recipe — SERVER-SIDE prompt composition.
//
// This is the proprietary Frame prompt assembly, moved off the client so the
// composed prompt (style bible, camera/film DNA, composition lock, negatives,
// render tail) NEVER ships in the browser bundle or appears in a network
// request. It is a faithful, byte-for-byte port of the client's
// app/src/lib/promptBuilder.ts + the `normalizeMentions` helper from
// app/src/lib/mentions.ts. Keep the two in lock-step: any edit here must be
// mirrored in the client's OFFLINE path (which is the owner's machine only).
//
// LAW: the recipe lives on the server; the client is a dumb terminal.

// ── @mention normalization (port of mentions.ts) ─────────────────────────────
const MENTION_PRECEDER = /[\s([{'"«»،؛]/;
const WORD_CHAR = /[\p{L}\p{N}_]/u;

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildTokenRegex(names) {
  const cleaned = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  if (cleaned.length === 0) return null;
  return new RegExp(`@(${cleaned.map(escapeRegex).join('|')})`, 'gu');
}

function isTokenAt(text, start, end) {
  if (start > 0 && !MENTION_PRECEDER.test(text[start - 1])) return false;
  if (end < text.length && WORD_CHAR.test(text[end])) return false;
  return true;
}

function findMentionTokens(text, names) {
  const re = buildTokenRegex(names);
  if (!re) return [];
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (isTokenAt(text, start, end)) out.push({ start, end });
  }
  return out;
}

/** 'quote' → 'name' (frame convention). Unknown @text passes through. */
export function normalizeMentions(text, names, style) {
  const tokens = findMentionTokens(text, names);
  if (tokens.length === 0) return text;
  let out = '';
  let pos = 0;
  for (const t of tokens) {
    const name = text.slice(t.start + 1, t.end);
    out += text.slice(pos, t.start);
    out += style === 'quote' ? `'${name}'` : name;
    pos = t.end;
  }
  out += text.slice(pos);
  return out;
}

// ── prompt assembly (port of promptBuilder.ts buildPrompt) ────────────────────
export function detectPromptRenderMode(prompt, isAnimation = false) {
  const text = String(prompt || '');
  const hasStoryboardContract =
    /MASTER STYLE LOCK\s*:/i.test(text) && /(?:storyboard|ink illustration|ink rendering)/i.test(text)
    || /FRAME PURPOSE\s*:/i.test(text) && /INK TREATMENT\s*:/i.test(text)
    || /non-photographic storyboard illustration/i.test(text);
  if (hasStoryboardContract) return 'storyboard';
  return isAnimation ? 'animation' : 'photoreal';
}

/**
 * Assemble the gpt-image-2 prompt from user selections + reference layers.
 * @param {object} s        selections (values the user chose + raw prompt)
 * @param {object[]} layers reference-layer METADATA (category,name,customName,parentLayerId,groupName)
 * @returns {string} the final composed prompt
 */
export function buildPrompt(s, layers = []) {
  const isAnimation = s.style_preset === 'MOVIE' && s.movie?.type === 'Animation';
  const isPhotographer = s.style_preset === 'PHOTOGRAPHER' && !!s.photographer;
  const renderMode = detectPromptRenderMode(s.prompt, isAnimation);

  const parts = [];

  // 1. STYLE GATE
  if (s.style_preset === 'MOVIE' && s.movie) {
    const meta = [s.movie.director, s.movie.cinematographer && `DP ${s.movie.cinematographer}`, s.movie.year].filter(Boolean).join(', ');
    const registerWord = isAnimation ? 'animation' : 'cinematography';
    parts.push(`In the ${registerWord} style of ${s.movie.title}${meta ? ` (${meta})` : ''}`);
  } else if (isPhotographer && s.photographer) {
    parts.push(`In the photographic style of ${s.photographer.name}${s.photographer.notes ? ` — ${s.photographer.notes}` : ''}`);
  }

  // 2. Main scene description (user-written) with @mentions → 'name'
  const scene = normalizeMentions(
    s.prompt,
    layers.map((l) => l.customName?.trim() || l.name),
    'quote',
  );
  if (scene.trim()) parts.push(scene.trim());

  // 3. Perspective
  if (s.angle) parts.push(s.angle.description);

  // 4. Camera gear — one dense clause
  const techParts = [];
  if (s.camera) techParts.push(`shot on ${s.camera.prompt || s.camera.name}`);
  if (s.lens) techParts.push(`${s.lens.name} lens`);
  if (s.focal_mm) techParts.push(`${s.focal_mm}mm`);
  if (s.aperture_f) techParts.push(`f/${s.aperture_f}`);
  if (s.stock) techParts.push(`on ${s.stock.name}`);
  if (techParts.length > 0) parts.push(`Camera: ${techParts.join(', ')}`);

  // 5. Lighting
  if (s.lighting) parts.push(`Lighting: ${s.lighting.description || s.lighting.name}`);

  // 6. Atmosphere
  if (s.atmosphere.trim()) parts.push(`Atmosphere: ${s.atmosphere.trim()}`);

  // 8. References
  if (layers.length > 0) {
    const displayName = (l) => l.customName?.trim() || l.name;
    const characters = layers.filter((l) => l.category === 'character' && !l.parentLayerId);
    const standaloneOtherChars = layers.filter((l) => l.category === 'character' && l.parentLayerId);
    const compositions = layers.filter((l) => l.category === 'composition' && !l.parentLayerId);
    const restFlat = layers.filter((l) => l.category !== 'character' && l.category !== 'composition' && !l.parentLayerId && !l.groupName);
    const legacyGrouped = layers.filter((l) => !l.parentLayerId && l.groupName && l.category !== 'character' && l.category !== 'composition');

    if (compositions.length > 0) {
      const names = compositions.map((c) => `'${displayName(c)}'`).join(', ');
      const refWord = compositions.length > 1 ? 'these references' : 'this reference';
      parts.push(
        `COMPOSITION LOCK — TREAT THE FOLLOWING REFERENCE AS A HARD FRAMING TEMPLATE, NOT INSPIRATION: ${names}. `
        + `Reproduce the EXACT same framing rectangle: same camera angle, same lens perspective and apparent focal length, `
        + `same horizon line height, same subject position within the frame (left/right third, vertical placement), `
        + `same scale of subject relative to frame edges, same foreground/midground/background plate structure, `
        + `same headroom and lead room. The output's spatial geometry must MATCH ${refWord} when the two are overlaid. `
        + `Do NOT reframe, re-crop, rotate, change angle, change height, or invent a new composition — only the subject's `
        + `identity, wardrobe, and the location/period dressing may differ from ${refWord}; the geometry is locked`,
      );
    }

    const parts2 = [];

    for (const char of characters) {
      const nested = layers.filter((l) => l.parentLayerId === char.id);
      const segments = [`character ${displayName(char)}`];
      if (nested.length > 0) {
        const byCat = {};
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

    if (legacyGrouped.length > 0) {
      const byGroup = {};
      for (const l of legacyGrouped) {
        const g = l.groupName;
        if (!byGroup[g]) byGroup[g] = [];
        byGroup[g].push(l);
      }
      for (const [groupName, items] of Object.entries(byGroup)) {
        const byCat = {};
        for (const l of items) {
          if (!byCat[l.category]) byCat[l.category] = [];
          byCat[l.category].push(displayName(l));
        }
        const segments = Object.entries(byCat).map(([cat, names]) => `${cat} ${names.join(', ')}`);
        parts2.push(`'${groupName}' (${segments.join('; ')})`);
      }
    }

    const remaining = [...restFlat, ...standaloneOtherChars];
    if (remaining.length > 0) {
      const byCat = {};
      for (const l of remaining) {
        if (!byCat[l.category]) byCat[l.category] = [];
        byCat[l.category].push(displayName(l));
      }
      const segments = Object.entries(byCat).map(([cat, names]) => `${cat}: ${names.join(', ')}`);
      parts2.push(`general references (${segments.join('; ')})`);
    }

    parts.push(`Use the attached reference images: ${parts2.join('. ')}`);
  }

  // 9. Aspect note
  parts.push(`Aspect ratio ${s.aspect}.`);

  // 10. Render directive — branch on style register
  if (renderMode === 'storyboard') {
    parts.push(
      'Render: non-photographic cinematic storyboard illustration. Preserve the Master Prompt\'s exact drawing medium, '
      + 'line hierarchy, tonal architecture, negative space and production-readable blocking. No photographic skin, '
      + 'no pores, no glossy 3D rendering, no beauty retouching, no color unless the Master Prompt explicitly requires it',
    );
  } else if (renderMode === 'animation' && s.movie) {
    parts.push(
      `Render: animated illustration in the exact medium and style register of ${s.movie.title} — `
      + `match that film's specific animation type (whether 3D CGI, 2D hand-drawn, cel animation, `
      + `stop-motion, or stylised hybrid), its character design language, and its color philosophy. `
      + `NOT photorealistic, NO photographic skin texture, NO film grain — this is a stylised `
      + `illustration in the medium of ${s.movie.title}, not a photograph`,
    );
  } else {
    parts.push(
      'Render: photorealistic, real skin texture with visible pores and fine facial hair, '
      + 'natural micro-expression, no airbrushing, no plastic skin, no beauty-retouch finish, '
      + 'no stacked filters',
    );
  }

  // 11. NEGATIVE — dead last
  if (s.negative.trim()) {
    parts.push(
      `NEGATIVE — hard exclusion list, NOT subject matter. `
      + `Do NOT render, include, or even partially depict any of the following anywhere in the frame: `
      + `${s.negative.trim()}. These elements are forbidden; if any would naturally appear, omit it`,
    );
  }

  return parts.join('. ').replace(/\.\s*\./g, '.');
}

// Map aspect labels to gpt-image-2 supported sizes (port of aspectToSize).
export function aspectToSize(aspect) {
  const [w, h] = aspect.split(':').map(Number);
  if (Math.abs(w - h) <= 1) return '1024x1024';
  return w > h ? '1536x1024' : '1024x1536';
}
