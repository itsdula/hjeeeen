---
name: noor-al-wajh
description: Generate a paste-ready master image-gen prompt for "Noor Al-Wajh" (نور الوجه — Light of the Face) — classic Saudi Arabian editorial beauty portrait. Extreme close-up, luminous dewy skin with real micro-texture, ultra-clean complexion, soft diffused key light at 30–45°, kohl-defined almond eyes, naturally full dark brows, single bold gold-or-pearl statement piece, warm neutral backdrop. Five-axis variation matrix (skin tone × eye expression × hair/covering × jewelry × angle) — auto-fills any blank from the canonical pool. Output saves as a paste-ready markdown file in the working directory. Use when the user says "noor al-wajh", "نور الوجه", "Saudi beauty portrait", "Saudi close-up portrait", "Gulf beauty prompt", "بورتريه سعودي كلاسيكي", "بورتريه جمال خليجي", or invokes /noor-al-wajh.
---

# noor-al-wajh — concept → paste-ready master prompt

The user is a working KV photographer (see `~/.claude/CLAUDE.md`). This skill encodes the **Noor Al-Wajh** DNA — classic Saudi Arabian editorial beauty portraiture. The output is one continuous master prompt the user pastes into ChatGPT Image 2 / gpt-image-2 / Nano Banana Pro / Midjourney / Flux. This skill **does not call any model** — it authors the prompt.

The aesthetic is editorial close-up beauty: dewy, minimal styling, hero face. The cultural overlay is Saudi classic — strong brows, kohl-defined almond eyes, golden warmth, regal composure, single gold-or-pearl statement piece. The reference is Tasneem Alsultan + the editorial-beauty canon (Peter Lindbergh skin philosophy, Hassan Hajjaj palette warmth, contemporary Gulf editorial).

**Cultural sensitivity is structural to this skill** — Saudi beauty is diverse (fair olive → deep bronze), hijab is optional not required, no orientalist tropes, no desert backdrops, no over-jeweled stereotype. The goal is **celebration, not idealization. Natural features are the hero.**

---

## Inputs — ask once, commit

Ask both in one message. Once committed, do not re-open them mid-prompt-writing.

1. **Subject** — gender (`woman` / `man`) + one-line character note (e.g. *"mid-30s, quiet authority"*, *"early 20s, joyful"*, *"50s, lined with character, hijab"*). The character note guides expression + age + optional covering.
2. **Variation picks** (optional — say `auto` for any single value to auto-fill from the canonical pool):

   | Axis | Options |
   |------|---------|
   | **Skin tone** | `light-golden-olive` / `warm-honey` / `rich-amber` / `deep-bronze` |
   | **Expression** | `serene-direct` / `contemplative-off-camera` / `genuine-smile` / `mysterious-allure` |
   | **Hair / covering** | `wet-slicked-back` / `natural-waves-framing` / `low-bun` / `silk-hijab-cream` / `silk-hijab-black` / `silk-hijab-burgundy` / `loose-pulled-back` |
   | **Jewelry** | `gold-dome-studs` / `gold-crescent-drops` / `pearl-stud-plus-gold-drop` / `arabesque-statement` / `delicate-gold-hoops` / `oversized-pearl-stud` / `calligraphy-pendant` |
   | **Angle** | `straight-on` / `three-quarter-left` / `three-quarter-right` / `over-shoulder-glance` |

   For male subjects: `Jewelry` defaults to `none`; `Hair/covering` pool becomes `short-dark-hair` / `white-ghutra-frame` / `red-white-shemagh-frame`; `Beard` axis activates with options `clean-shaven` / `short-trimmed` / `full-dark`.

Optional 3rd input — **aspect ratio** — default `4:5` portrait. Other supported: `1:1` square (symmetrical frontal), `3:4`. Never landscape — this style lives in portrait.

---

## The non-negotiable DNA pillars

Every output honours ALL eight. Violating any one breaks the style.

### Pillar 1 — Framing: face fills 70–90% of frame
Extreme close-up to tight headshot. Crop range: mid-forehead to chin (tightest) OR crown to upper chest (widest). **No full-body, no waist-up.** This style lives in the face.

### Pillar 2 — Soft diffused key, 30°–45° from camera
Window-light quality — not studio-hard, not flat. Wraps around facial contours without harsh shadows. **Fill ratio ~2:1 (key to fill)** — low contrast. Catch lights in eyes are large and soft. No hair light, no rim — hair is not the hero. Temperature 5200–5600K — neutral to slightly warm, never orange, never cool blue.

### Pillar 3 — Dewy luminous skin with REAL texture
Ultra-clean at first glance, but **real micro-texture visible on close inspection** — not airbrushed to plastic CGI. Skin hydrated, plump, healthy — never dry, never oily-sheen. Specular highlights on nose bridge, cheekbone peaks, cupid's bow — round, soft-edged, **luminous not glary**. Under-eye area bright and smooth — no dark circles. Lips slightly glossy, naturally coloured, never dry. Light freckles or beauty marks welcome as character.

### Pillar 4 — Warm Saudi skin spectrum
Olive → golden → amber → bronze. **No ashy or pink undertones, ever.** Sun-kissed-but-protected, luminous, not tanned. The Saudi luminous spectrum (hex anchors):
- Light golden olive: #D4A574 → #C9956B
- Warm honey: #B8864E → #A67842
- Rich amber: #8B6538 → #7A5A32
- Deep bronze: #6B4E30 → #5C4228

### Pillar 5 — Invisible makeup ("no-makeup makeup")
**Eyes:** subtle kohl-like darkness at the lash line (not a literal drawn line — blended, smoky, natural). Lashes naturally dark and defined — no clumpy mascara. **Brows:** full, naturally arched, dark — the hero feature. Never thin, never penciled with hard edges. **Lips:** natural rose/mauve/berry — slightly glossy, no sharp liner. **No visible foundation, blush, contour, highlighter, eyeshadow product.** Any cheek colour comes from natural flush. Any cheekbone luminosity comes from lighting, not product.

### Pillar 6 — One statement piece, gold or pearl
**Maximum 2 jewelry pieces visible (earrings count as one).** Gold dominant — warm, polished, substantial, artisanal. Pearls accepted as accent. **No silver, no rhinestones, no costume.** Pieces look inherited or modern-artisanal — never mass-produced. The jewelry catches light — shares the luminous quality of the skin.

### Pillar 7 — Neutral warm backdrop
Solid, flat — warm off-white (#F0EDE6), light warm gray (#D8D3CC), or soft cream. Slightly lighter than the deepest skin tone — gentle separation. **No gradients, no textures, no environment, no props, no studio paper seam.** Edge transition between subject and background is natural (shallow depth of field), never composited-looking.

### Pillar 8 — Regal composure
Confident, self-possessed — **never coy, never overtly seductive**. Quiet strength — emotion lives in the eyes, not in exaggerated expression. Warmth without a forced smile. When smiling: genuine, reaching the eyes, crow's feet welcome, unguarded.

---

## Forbidden — the hard negatives

Universal exclusions to ship with every prompt:

- Heavy makeup, thick foundation, matte/powdered skin, visible product, contour lines, sharp lip liner.
- False eyelashes, colored contact lenses, dramatic eye shadow, glitter, rhinestones.
- Silver jewelry, costume jewelry, mass-produced look.
- Harsh lighting, hard shadows, dark moody background, coloured background, studio gel lights, ring-light catchlights.
- Overprocessed plastic skin, airbrushed uncanny valley, visible retouching.
- Orange fake tan, ashy or pink undertones.
- Blurry, soft focus on the face itself.
- Busy background, props, environmental context.
- Full body, waist-up, fashion pose, runway, glamour photography.
- Overly sexual posing, duck lips, pouting.
- Orientalist tropes — desert backdrops, "exotic" framing, falcons, over-jeweled stereotype.
- Caricatured Arab features — exaggerated nose, exaggerated eye shape.
- Text, watermarks, overlays.

---

## Master prompt formula — assemble in this order

```
[SUBJECT IDENTIFIER + SKIN TONE]
+ [SKIN QUALITY + TEXTURE]
+ [EYES + LASHES + KOHL DEFINITION]
+ [BROWS]
+ [LIPS]
+ [HAIR / COVERING]
+ [JEWELRY (single statement piece named)]
+ [LIGHTING (direction + softness + specular highlights)]
+ [SHADOW QUALITY]
+ [BACKGROUND]
+ [CAMERA / FORMAT / FRAMING]
+ [EXPRESSION + MOOD]
+ [ASPECT RATIO]
```

---

## The Noor Al-Wajh master template — female

The template the skill outputs (with `[BRACKETS]` filled from user picks + auto-fill where `auto`):

```
A close-up editorial beauty portrait of a Saudi Arabian woman, [CHARACTER NOTE — e.g. mid-30s with quiet authority], with [SKIN TONE — full descriptor, e.g. "warm honey-toned skin glowing with dewy luminosity"], ultra-clean complexion with natural micro-texture visible — real skin, not airbrushed CGI, with the healthy hydrated quality of a Peter-Lindbergh-legacy beauty image.

Large expressive deep brown almond-shaped eyes with naturally dark thick lashes, subtle kohl-like definition smudged at the lash line creating natural depth (not a drawn line — blended, smoky, organic). Full, naturally arched dark brows — the hero feature — strong and defined, never thin, never penciled.

Natural [LIP TONE: rose / mauve / berry / nude-rose] lips with a subtle hydrated sheen, soft natural lip line — no sharp liner, no over-drawing.

Hair: [HAIR/COVERING — full descriptor, e.g. "dark wavy hair loosely pulled back from the face" / "cream silk hijab draped softly framing the face, falling to the shoulder"].

[JEWELRY — single statement piece named in full, e.g. "wearing one bold gold sculptural dome stud earring catching the warm light" / "a single oversized pearl stud at the visible ear, paired with a delicate gold calligraphy pendant on a fine chain at the collarbone"].

Soft diffused key light from [DIRECTION — left / right / front] at approximately 30 to 45 degrees from the camera axis, window-light quality wrapping evenly around the facial contours. Gentle luminous shadows on the opposite side of the face — never harsh, never black, always carrying detail. Specular highlights on the nose bridge, cheekbone peaks, and cupid's bow — round, soft-edged, dewy. Large soft catch lights in the eyes. Fill ratio approximately 2:1 — low contrast.

[BACKGROUND — full descriptor, e.g. "Warm cream background (#F0EDE6), solid and flat, slightly lighter than the deepest skin tone for gentle separation. No texture, no gradient, no environment."]

Shot on Hasselblad medium format camera, editorial beauty photography, intimate [ANGLE — straight-on / three-quarter from the left / three-quarter from the right / over-shoulder glance] close-up framing. Face fills 75% of the frame. Realistic skin pores visible at close inspection but never pitting or rough. No visible makeup product — "no-makeup makeup" — any luminosity comes from skin prep and lighting alone.

Expression: [MOOD — full descriptor, e.g. "serene confident direct gaze, regal composure, quiet warmth without a smile" / "genuine wide smile reaching the eyes, crow's feet welcome, authentic joy"].

What this image must NOT contain: no heavy makeup, no thick foundation, no matte or powdery skin finish, no visible makeup product, no contour lines, no sharp lip liner, no false eyelashes, no coloured contact lenses, no dramatic eye shadow, no glitter, no rhinestones, no silver jewelry, no harsh lighting, no hard shadows, no dark or coloured background, no studio gel lights, no ring-light catchlights, no overprocessed plastic skin, no airbrushed uncanny valley, no orange fake tan, no ashy or pink skin undertones, no busy background, no props, no full body, no waist-up framing, no fashion pose, no overly sexual posing, no duck lips, no orientalist tropes (no desert backdrop, no falcons, no over-jeweled stereotype), no caricatured features, no text, no watermarks.

[ASPECT RATIO — 4:5 portrait orientation default]
```

---

## The Noor Al-Wajh master template — male

For male subjects, swap the relevant blocks:

```
A close-up editorial portrait of a Saudi Arabian man, [CHARACTER NOTE], with [SKIN TONE — full descriptor] and a clean luminous complexion, natural skin texture with healthy glow — real skin pores visible at close inspection, never airbrushed to CGI.

Deep dark brown eyes with a direct confident gaze, naturally long dark lashes, no kohl. Strong naturally full dark brows — defined, masculine, the visual anchor of the face. Natural lip tone, hydrated but not glossy.

[BEARD — clean-shaven / well-groomed short dark beard with clean edges / full dark beard, naturally shaped].

Hair: [short-dark-hair / visible edge of a crisp white ghutra framing the face, draped over one shoulder / red-and-white shemagh wrapped over the head and one shoulder]. [If ghutra/shemagh: NOT a stylised costume — worn naturally, the cut and drape of contemporary Saudi everyday styling.]

Soft diffused natural light from [DIRECTION] at 30–45 degrees, gentle shadows defining the jawline and cheekbones, never harsh. Specular highlights on the brow bone, nose bridge, and cheekbone peaks. Fill ratio 2:1 — low contrast.

[BACKGROUND — warm off-white / cream / light warm gray, solid and flat, no environment].

Shot on Hasselblad medium format camera, editorial beauty/portrait photography, intimate [ANGLE] close-up framing. Face fills 75% of the frame.

Expression: composed regal expression with quiet authority, never staged, never posed-fashion. The Saudi classic gaze — self-possessed, present, confident.

What this image must NOT contain: [same forbidden list as female template, plus: no heavily oiled or shiny skin, no theatrical "warrior" or "desert prince" framing, no rifle or falcon, no stylised costume rendering of the ghutra/shemagh].

[ASPECT RATIO — 4:5 portrait orientation default]
```

---

## Auto-fill defaults (when user says `auto` for any axis)

When a single axis is `auto`, pick from this canonical default order (rotates per call to avoid the same image twice):

| Axis | Default rotation order |
|------|----------------------|
| Skin tone | `warm-honey` → `rich-amber` → `light-golden-olive` → `deep-bronze` |
| Expression | `serene-direct` → `contemplative-off-camera` → `genuine-smile` → `mysterious-allure` |
| Hair / covering | `natural-waves-framing` → `wet-slicked-back` → `silk-hijab-cream` → `low-bun` → `silk-hijab-black` → `silk-hijab-burgundy` → `loose-pulled-back` |
| Jewelry (female) | `gold-dome-studs` → `pearl-stud-plus-gold-drop` → `gold-crescent-drops` → `arabesque-statement` → `delicate-gold-hoops` → `oversized-pearl-stud` → `calligraphy-pendant` |
| Hair (male) | `short-dark-hair` → `white-ghutra-frame` → `red-white-shemagh-frame` |
| Beard (male) | `short-trimmed` → `full-dark` → `clean-shaven` |
| Angle | `straight-on` → `three-quarter-left` → `three-quarter-right` → `over-shoulder-glance` |

If the user says `auto` for the whole subject, deliver the first un-used combination from a deliberately mixed starting state — never the same combo back-to-back.

---

## Platform-specific tail (append when target is known)

If user names target platform, append the appropriate modifier block:

**Midjourney:** `--style raw --s 100 --ar 4:5 --no makeup studio-lighting dark-background`

**DALL-E / GPT Image 2:** *(natural language continuation)* `Photographed in the style of clean editorial beauty portraiture with soft natural window light, dewy skin, minimal makeup, and a warm neutral background. Medium format camera quality with fine detail and natural skin texture.`

**Flux / Stable Diffusion:** `editorial beauty portrait, medium format photography, natural light, dewy skin, clean complexion, soft shadows, neutral background, close-up, high resolution, fine skin detail, warm tones, photorealistic` + negative prompt: `(painting:1.3), (illustration:1.3), (cartoon:1.3), (3d render:1.3), (digital art:1.3), (oversaturated:1.2), (overexposed:1.2)`

**Ideogram:** `Style: Photo | editorial beauty portrait, close-up, natural light, dewy clean skin, warm neutral backdrop`

---

## Output protocol

1. Generate the master prompt by filling the appropriate template (female / male) with user picks + auto-fills.
2. Save to working directory as: `noor-al-wajh_[gender]_[skin]_[hair]_[expression].md`
3. File contents:
   ```markdown
   # Noor Al-Wajh — [Gender] — [Character note]

   **Target:** gpt-image-2 / Nano Banana Pro / Midjourney / Flux
   **Aspect:** [4:5 default OR user-specified]
   **Variation picks:**
   - Skin tone: [value]
   - Expression: [value]
   - Hair/covering: [value]
   - Jewelry: [value or "none" for male default]
   - Angle: [value]
   - [Beard, if male: value]

   ## Master prompt

   [The full natural-language master prompt — as one continuous block, not bullet points.]

   ## Style-integrity audit (run before paste)

   - [ ] Face fills 70%+ of frame
   - [ ] Skin reads luminous + dewy + real-texture (not CGI plastic)
   - [ ] Warm skin undertone — no ashy / pink
   - [ ] Brows are full + dark + the hero feature
   - [ ] Single statement piece only (max 2 with earrings as one)
   - [ ] Background is neutral warm — no environment
   - [ ] Mood reads confident + regal — not coy, not seductive
   - [ ] No orientalist trope present

   ---

   **Honest risk:** [one line — the real weakness of THIS prompt for THIS subject. Where the generator most likely drifts: over-airbrushed skin, pink-cast undertone, eye-shadow appearing where none asked, hijab rendered as "exotic" drape, over-jeweled, faux-stoic expression.]
   ```
4. Print the master prompt block to chat for immediate paste.

---

## House rule

End every deliverable with one line: **Honest risk:** — the real weakness of this specific prompt. If you can't name one, the prompt isn't pushed hard enough. Rewrite.

Cultural rule: beauty is celebration, not idealisation. Natural features are the hero. Saudi beauty is diverse — represent the full spectrum. Hijab is optional. No orientalist tropes, ever.

Never explain the style mid-output. Receive the subject + picks. Deliver the master prompt.
