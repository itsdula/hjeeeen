---
name: encre-parisienne
description: Generate Master Prompts for the "Encre Parisienne" illustration style — hand-drawn cobalt blue ink on warm cream paper, with vermillion red accents, minimal/faceless figures, and Parisian editorial mood. Use whenever the user asks for illustration prompts, image-generation prompts, or art direction in this blue-ink/risograph/French editorial style — or asks to render any subject (café scenes, portraits, still life, interiors, fashion) "in the Encre Parisienne style", "blue ink illustration", "Parisian illustration", "risograph style", or references this style bible. Also use when the user asks to generate prompts for Nano Banana, Midjourney, DALL·E, or any image model in this aesthetic.
---

# Encre Parisienne — Blue Ink Illustration Style

This skill produces technically precise, emotionally resonant **Master Prompts** for reproducing the "Encre Parisienne" illustration style — a hand-drawn cobalt blue ink aesthetic on warm cream paper, with rare vermillion red accents, rooted in French editorial illustration, risograph print culture, and Japanese woodblock economy of negative space.

The default output target is **Nano Banana**, but prompts are portable to any modern image model (Midjourney, DALL·E, Stable Diffusion, Flux, etc.) — the language is model-agnostic and concrete.

---

## When to use this skill

Trigger this skill when the user:

1. Asks for an image-generation prompt in this style ("write a prompt for…", "give me a Nano Banana prompt…", "Midjourney prompt for…").
2. Asks to render any subject in the "Encre Parisienne", "blue ink", "Parisian editorial", "risograph", or "French illustration" style.
3. References the Style Bible, the Five Pillars, or any of the 12 example prompts.
4. Asks for art direction, style notes, or a moodboard description matching this aesthetic.

If the user asks for an illustration but does **not** name a style, ask once whether they want it in the Encre Parisienne style or freely chosen.

---

## The Five Pillars — never violate

Every prompt must lock these in. If any pillar is missing, the output is not Encre Parisienne.

1. **Color** — Two inks max on warm cream paper. Dominant: cobalt/ultramarine blue (`#1A3C8F`–`#0033AA`). Rare accent: vermillion red (`#D42D2D`–`#E63333`), never exceeding ~15% of inked area. Optional monochrome variants: deep forest green (`#1B5E3B`) or blue-only. Ground is warm cream (`#F2EBD9`–`#EEECE4`) — **never pure white**. **No black. No gradients. No full color spectrum.**

2. **Linework** — Hand-drawn, weight-varying (0.5pt–4pt within a single drawing), confident single-stroke marks. Slightly fibrous edges. Parallel hatching is the primary shading method (1mm tight to 3–5mm open). No vector uniformity. No tentative sketch lines.

3. **Composition** — Asymmetric, off-center. Bold cinematic cropping. **Negative space is sacred** — the cream paper does ≥40% of the visual work. Depth via overlap, not atmospheric perspective. Architecture dominates figures.

4. **Figures** — Faces are blank or radically minimal. The paper *is* the skin. No detailed eyes/noses/eyebrows. Hair, lips, and clothing texture carry the expression. Bodies more detailed than faces. Hands simplified but gestural.

5. **Texture & materiality** — Feels printed, not digital. Visible paper grain. Risograph mis-registration on duotone images (blue and red passes slightly off). No drop shadows, glows, lens flares, or anti-aliased smoothness.

For the full Style DNA — palette hex ranges, color rules, hatching specifics, signature face treatment, architecture notes, mood matrix — read `references/style-dna.md`.

---

## Master Prompt architecture

When generating a Master Prompt, build it in this fixed order. Each layer anchors the model before the next layer adds detail.

1. **Medium declaration** — "Hand-drawn cobalt blue ink illustration on warm cream paper" (or the monochrome/duotone variant in use). Establishes the physical world first.
2. **Color specification** — State the exact palette constraint and the exclusions ("no black, no gradients, no full color").
3. **Subject description** — The scene, figure, or objects. Concrete and sensory. Name the feeling alongside the content.
4. **Composition directive** — Framing, cropping, negative space, viewing angle, where the subject sits in the frame.
5. **Texture & detail notes** — Hatching direction, fabric pattern method (line by line / dot by dot), hair treatment, paper grain, registration artifacts.
6. **Emotional tone anchor** — A final sentence naming the emotional frequency. The North Star for interpretation.

---

## Language rules

- **Concrete and sensory over abstract.** Say "lines that thicken on downstrokes like a felt-tip marker pressing into rough paper" — not "expressive linework."
- **Name the absence.** "The face is left blank — no eyes, no nose, just lips and the paper itself as skin" — not "simplified face."
- **Reference the physical world.** "As if printed on a Riso in a Belleville atelier" — not "vintage print aesthetic."
- **Forbidden words:** whimsical, cute, cartoon, anime, sketch, doodle. This work is none of those.

For the full cheat sheet of "say this / not this" substitutions, see `references/style-dna.md` § VII.

---

## Forbidden elements (hard no's)

These break the style instantly — never include them in a prompt:

- Full color spectrum or rainbow palettes
- Photorealistic rendering or 3D effects
- Black outlines on colored fills (comic-book look)
- Smooth digital gradients, airbrush, or watercolor washes
- Detailed realistic faces with full features
- Pure white backgrounds
- Drop shadows, glows, lens flares
- Symmetrical or centered compositions
- "Cute" or chibi proportions

---

## Workflow

1. **Clarify the subject and mood** if not already specified. Pick a Mood Zone from the matrix in `references/style-dna.md` § III (Contemplative Solitude, Urban Hum, Intellectual Warmth, Quiet Confidence, Poetic Observation).
2. **Choose palette variant** — blue + red duotone, blue-only monochrome, green monochrome, or blue + tiny gold accent.
3. **Choose drawing-tool feel** — felt-tip marker, brush pen, ballpoint, dry colored pencil, or lino-print stamp. This subtly shifts texture.
4. **Compose the prompt** in the 6-layer architecture above. Aim for ~120–200 words — dense enough to anchor the model, loose enough to let it breathe.
5. **Audit against the Five Pillars and the forbidden list** before returning.
6. If the user wants several variations, generate 3–5 and label them by mood zone or subject, like the 12 example prompts in `references/example-prompts.md`.

---

## Reference files

- `references/style-dna.md` — Full Style DNA: palette hex ranges, color rules, linework specs, composition principles, figure treatment, texture notes, mood matrix, adaptation guidelines, common-mistake checklist, and the quick-reference cheat sheet. Read this when generating any prompt to confirm specifics.
- `references/example-prompts.md` — The 12 canonical Master Prompts (Café Oberkampf, Bibliothèque Personnelle, La Fille aux Boucles d'Oreilles, Bookseller's Shelf, Girl with Birds and Clouds, Afternoon in the Garden, Woman Drinking Coffee in the Leaves, The Green Shirt, Looking Up, Woman Among Fronds, Record Shop Interior, Three Figures at a Zinc Bar). Use these as voice/length/structure templates. Match their density and cadence; do not copy their content unless the user asks for a variation of one.

---

## Adapting to new subjects

The style is infinitely adaptable. To extend beyond the 12 examples:

**Always lock in:** cream paper ground, dominant blue (or single-color variant) ink, hand-drawn pressure-varying linework, generous negative space, blank/minimal/obscured faces.

**Freely vary:** subject (kitchens, landscapes, animals, cars, food, interiors), mood zone, density of detail, secondary accent color (red / gold / none), drawing-tool feel.

If a generated image drifts, audit in this order: too many colors → strip back; background filled → restore cream breathing room; faces too detailed → remove features; lines too perfect → add weight variation; composition too centered → push off-center; looks digital → add grain and mis-registration.
