---
name: prismatic-bleed
description: Generate a paste-ready master image-gen prompt in the "Prismatic Bleed / Spectrum Wound" style — light itself as the subject, split and bleeding through flawed prisms / CRT phosphor decay / iridescent membranes / chromatic channel separation. Five dispersion modes (Orb / Streak / Glitch Field / Signal Autopsy / Hybrid) × three backgrounds (Light Void / Dark Abyss / Split Frame). Output saves as a paste-ready markdown file in the working directory. Use when the user says "prismatic bleed", "spectrum wound", "chromatic dispersion prompt", "iridescent orb prompt", "glitch field prompt", "signal autopsy prompt", "بريزماتيك", "تشتت طيفي", "نزف الطيف", or invokes /prismatic-bleed.
---

# prismatic-bleed — concept → paste-ready master prompt

The user is a working KV photographer (see `~/.claude/CLAUDE.md`). This skill encodes the **Spectrum Wound** DNA — a style where light itself is the subject, dispersed through damaged optics. The output is a tight master prompt the user pastes into ChatGPT Image 2 / gpt-image-2 / Nano Banana Pro / Midjourney / Flux. This skill **does not call any model** — it authors the prompt.

**Cardinal rule: NO text, NO letters, NO words in the generated image, unless the user explicitly asks for typography.** This is non-negotiable and must appear in every prompt.

---

## Inputs — ask once, commit

Ask all three in one message. Once committed, do not re-open them mid-prompt-writing.

1. **Subject / concept** — one line. What is being witnessed? (e.g. *"a captured optical specimen, the ghost of every sunset"*, *"the autopsy of a dying broadcast signal"*, *"a holographic universe in the moment of its collapse"*.) The user's concept here is metaphorical — light is the subject, never a person/object.
2. **Dispersion mode** — `orb` / `streak` / `glitch-field` / `signal-autopsy` / `hybrid-orb` / `auto`. If `auto`, derive from the concept using the mode-routing table below.
3. **Background** — `light-void` / `dark-abyss` / `split-frame` / `auto`. If `auto`, derive from the emotional register: clinical/precious → light-void; volcanic/burning → dark-abyss; forensic/deconstructed → split-frame.

Optional 4th input — **typography** — default `none`. If the user explicitly asks for text, ask what text + where (corner quadrant / margin edge), and add the typography layer described in §5 below.

---

## Dispersion-mode routing — auto logic

| Concept signal | Mode |
|----------------|------|
| Containment, introspection, captured, specimen, "trapped light" | **Orb** |
| Revelation, breakthrough, escape, "a wound", "a slit", vertical energy | **Streak** |
| Destruction, chaos, breakdown, "RGB pulled apart", "scan-line catastrophe" | **Glitch Field** |
| Forensic, deconstruction, signal analysis, "autopsy", UI/data/interface | **Signal Autopsy** |
| Collapse, decay-from-form, "orb breaking down", duality contained → broken | **Hybrid Orb** |

---

## The five dispersion modes — pick one, render fully

### Mode A — The Orb (Iridescent Sphere)
Soft-edged luminous sphere/ellipsoid floats centrally or off-centre. Contains the **entire visible spectrum** compressed into its curved volume — colours shift continuously across the surface like light trapped in a soap bubble. Transitions: teal → emerald → amber → coral → magenta → deep violet. **NO hard edges** — gaussian falloff bleeds outward, casting coloured light onto the background. Self-illuminated. Surface references: oil on water, bismuth crystal oxidation, abalone shell inner surface.

### Mode B — The Vertical Streak (Prismatic Column)
Vertical or near-vertical band of dispersed spectral light cuts through the composition. Reads as light passing through a narrow slit and being refracted — wavelengths separate laterally: deep blue/cyan on one edge → green → yellow → orange → red/magenta on the opposite edge. Edges are **feathered, granular, slightly stuttered** — scan-line texture, fibre-optic bundles, light through fabric weave. Horizontal micro-displacement gives a shivering, unstable quality.

### Mode C — The Glitch Field (Chromatic Catastrophe)
Entire frame or large regions undergo horizontal displacement — scan-line offset, pixel-sort distortion, RGB channel separation. **Cyan pulls left, magenta pulls right, yellow stutters in place** — tripled ghost images of every shape, prismatic fringing along every edge. Where separated channels overlap, the full spectrum erupts in horizontal bands. Distortion follows **liquid physics** — bands warp, buckle, ripple, flow.

### Mode D — The Signal Autopsy (Structured Glitch)
Architectural variant of Mode C — horizontal chromatic displacement operates on **recognisable geometric structures**: rectangles, bars, interface-like panels, data blocks. Composition reads as a deconstructed broadcast signal, forensic analysis of a dying display. Each geometric element exists in cyan/magenta/yellow tripled copies, offset horizontally, overlapping to produce the full spectrum at intersections. A **thin vertical prismatic axis often bisects** the composition — a concentrated line of pure white-to-spectrum refraction, like a signal carrier wave. Scan-line texture is prominent.

### Mode E — The Hybrid Orb (Coherence collapsing into Glitch)
Large orb dominates centre — upper hemisphere holds together (gaussian gradient, self-illuminated, teal → amber core → magenta edge) — but as the eye travels down, the orb separates into horizontal scan-line bands. Individual channels pull apart laterally into pure cyan / pure magenta / pure amber strips. Lowest portion has fully disintegrated into horizontal chromatic streaks extending to frame edges. **Gradual progressive failure**, never a hard cut.

---

## The three backgrounds — pick one, render fully

### Background A — Light Void
Warm off-white to pale warm-grey (#F5F3F0 → #E8E4E0). Never clinical white, never blue-white. Subtle radial vignette darkens extreme corners. Functions as **negative space** — chromatic dispersion FLOATS against it, precious, specimen-like, scientific. Spectral element casts **soft coloured reflections** onto the background — ambient chromatic contamination proving the light is volumetric.

### Background B — Dark Abyss
Deep black to near-black (#0A0A0A → #1A1A1A). Blacks are rich and textured — subtle warm or cool undertones, never perfectly neutral. **Film grain visible in the dark regions** — fine, organic, analog-feeling. Spectral element **burns** against this void — radioactive, volcanic, supernatural — and illuminates its immediate surroundings: coloured light spills, bleeds, scatters into the dark, atmospheric halos and ambient colour zones.

### Background C — Split Frame
Hard horizontal cut dividing the composition into two unequal zones: dominant **dark field (70–85%)** containing the chromatic event, and a secondary **light band (15–30%)** — typically at the bottom or top edge — clean cream-white paper-textured ledge. Boundary is architectural, deliberate, never a gradient. Light band functions as a **documentary strip** — grounds the chaotic chromatic event in materiality (mounted print, unexposed film border, specimen card with label area). Chromatic event may **bleed faintly** across the boundary.

---

## The spectral palette — the full wound

**Minimum 5 continuous spectral hues per composition.** The eye must travel through multiple wavelength transitions.

```
Deep Violet     #4B0082
Electric Blue   #0047AB
Cyan            #00BCD4
Teal-Green      #00897B
Emerald         #2E7D32
Chartreuse      #CDDC39
Golden Amber    #FFA000
Burnt Orange    #E65100
Coral Red       #FF5252
Hot Magenta     #E91E63
Deep Magenta    #AD1457
```

Rules:
- Transitions are **gaussian, organic, continuous** — no hard colour boundaries.
- No single hue occupies more than 30% of the spectral area.
- **Hot centre = warm hues** (amber / coral / magenta) — peak luminance.
- **Periphery = cool hues** (blue / teal / cyan) — softer falloff.
- Impossible intermediate tones (pink-gold, teal-amber, violet-green) are signatures — name them.

---

## Master prompt formula — assemble in this order

```
[CHROMATIC EVENT TYPE]
+ [SPECTRAL COLOUR SEQUENCE]
+ [BACKGROUND TYPE + TEXTURE + LIGHT SPILL]
+ [SPATIAL COMPOSITION]
+ [GRAIN / MATERIALITY]
+ [EMOTIONAL REGISTER]
+ [NO-TEXT GUARD CLAUSE]
```

### Layer-by-layer write spec

**1. CHROMATIC EVENT TYPE** (1–2 sentences) — Name the dispersion mode + describe its physical behaviour. *"a vertical band of prismatically dispersed spectral light cuts through the composition — light passing through a narrow aperture, refracted into separated wavelengths…"*

**2. SPECTRAL COLOUR SEQUENCE** (2–3 sentences) — Map the colour journey. Name 5–7 hues in spatial order. Where the hot centre is, where the cool periphery is, where impossible intermediates emerge. Use the words **gaussian, continuous, organic**.

**3. BACKGROUND + TEXTURE + LIGHT SPILL** (1–2 sentences) — Declare light-void / dark-abyss / split-frame. Describe tone, warmth, texture (paper tooth, grain, fibre). Describe how the spectral event **contaminates** the background.

**4. SPATIAL COMPOSITION** (1 sentence) — Place the chromatic event. Note breathing space. Note asymmetry. Confirm purely visual — no typographic elements (unless requested).

**5. GRAIN / MATERIALITY** (1 sentence) — Fine organic analog film grain embedded in emulsion, visible in highlights and shadows. The image feels printed on physical media, not rendered on a screen.

**6. EMOTIONAL REGISTER** (1 sentence) — Close with one phenomenological phrase. Pool: *"iridescent wound"*, *"optical autopsy"*, *"spectral hemorrhage"*, *"light remembering itself"*, *"the interior of a prism's dream"*, *"wavelength escaping containment"*, *"holographic scar tissue"*, *"the bleed between frequencies"*, *"the ghost of every sunset compressed into a sphere"*.

**7. NO-TEXT GUARD CLAUSE** — Always include verbatim:
> *"No text, no letters, no words, no numbers anywhere in the image."*

---

## Six prompt templates (skeletons — adapt; don't ship verbatim)

### Template 1 — Orb on Light Void
> A luminous iridescent sphere floats at [POSITION] against a warm off-white matte background with subtle paper texture and fine analog film grain. No text, no letters, no words, no numbers anywhere in the image. The sphere contains the entire visible spectrum compressed into its curved volume — [5–7 HUES IN ORDER, hot centre named] — every transition gaussian, continuous, organic, producing impossible intermediate tones: [2–3 NAMED]. The sphere is self-illuminated, casting soft spectral reflections onto the background — [contamination details]. Edges dissolve into gaussian falloff. Subtle radial vignette at corners. Fine organic grain throughout, visible in both luminous surface and quiet background. Purely visual — no typographic elements. [EMOTIONAL REGISTER PHRASE].

### Template 2 — Streak on Dark Abyss
> A vertical band of prismatically dispersed spectral light cuts through the centre of a deep black composition, rich analog grain visible in the dark field. No text, no letters, no words, no numbers anywhere in the image. The streak reads as light passing through a narrow aperture and being refracted — [WAVELENGTH SEQUENCE LEFT-TO-RIGHT] — edges feathered, granular, slightly horizontally displaced, scan-line texture along boundaries. Luminous centre pulses at peak saturation — [WARM HUES] at maximum intensity — while outer spectral edges ([COOL HUES]) bleed softly into the dark ground. Column illuminates its surroundings: [coloured halo description]. Shadows carry coloured noise — deep blues, warm browns — textured and alive. Vertical poster-proportioned frame. Purely visual. [EMOTIONAL REGISTER PHRASE].

### Template 3 — Glitch Field on Dark Abyss
> Catastrophic chromatic displacement fills the frame against a deep black background with visible analog film grain. No text, no letters, no words, no numbers anywhere in the image. Abstract geometric forms — [LIST: rectangles / horizontal bars / circular elements] — have had their RGB channels physically torn apart and horizontally smeared: cyan pulls left, magenta pulls right, yellow stutters in place — tripled ghost images with prismatic fringing along every edge. Where separated channels overlap, the full spectrum erupts in horizontal bands: [4–5 HUES IN COLLISION ORDER]. Displacement follows liquid physics — bands warp, buckle, ripple. Some regions aggressively smeared with scan-line texture; others hold briefly before fracturing. Black background pulses with fine analog grain. Purely visual. [EMOTIONAL REGISTER PHRASE].

### Template 4 — Signal Autopsy on Split Frame
> Split-frame composition: a dominant deep black field occupying the upper 75% of the frame, and a clean warm cream-white band across the lower 25%, divided by a hard horizontal cut. No text, no letters, no words, no numbers anywhere in the image. Within the dark field: a complex horizontal structure of chromatically displaced geometric elements — rectangles, bars, panel-like shapes — exist in tripled cyan/magenta/yellow copies. Where the three channels overlap, the full visible spectrum erupts in aggressive horizontal bands: [5 HUES]. A thin vertical prismatic axis bisects the centre of the dark field — concentrated spectral refraction from deep blue through amber to magenta, radiating laterally. Small geometric rectangles and squares float as colour-separated artifacts. Dark field carries rich analog grain with coloured noise in shadows. The cream-white band below is quiet — warm paper texture with fine grain — receiving only faint spectral contamination bleeding down from above. Purely visual. [EMOTIONAL REGISTER PHRASE].

### Template 5 — Hybrid Orb on Dark Abyss
> A large soft-edged iridescent orb dominates the centre of a deep black composition, but the orb is being corrupted by horizontal glitch displacement. No text, no letters, no words, no numbers anywhere in the image. The upper hemisphere holds together — continuous gradient from [COOL HUE] through [HOT CORE HUE] to [WARM EDGE HUE], self-illuminated, gaussian-soft — but as the eye travels downward, the orb separates into horizontal scan-line bands. Individual channels pull apart laterally: strips of pure cyan, strips of pure magenta, strips of amber — the unified sphere fracturing into displaced spectral ribbons. The lowest portion has fully disintegrated into horizontal chromatic streaks extending to the frame edges, vibrating with micro-displacement. Transition from coherent orb to glitch dissolution is gradual and organic — a progressive failure, like a holographic projection losing signal from the bottom up. Black background carries rich analog grain with coloured noise. Faint spectral light contaminates the surrounding darkness with soft coloured halos. Purely visual. [EMOTIONAL REGISTER PHRASE].

### Template 6 — Multi-Orb Specimen on Light Void
> Two luminous iridescent spheres of different scales float against a warm cream-white background with subtle paper texture and fine analog grain. No text, no letters, no words, no numbers anywhere in the image. The primary sphere is larger, positioned slightly above centre, containing [SPECTRUM A]. The secondary sphere is smaller, positioned lower and offset, containing [SPECTRUM B — complementary warmer/cooler emphasis]. Both spheres glow from within and cast soft spectral reflections onto the matte background — overlapping coloured shadows where their light influence intersects, creating new intermediate hues on the paper. Edges dissolve into soft gaussian falloff — they bleed gradually into negative space. Generous clean background separates the spheres from the margins. Fine grain throughout — embedded in spectral surfaces and quiet background alike. Purely visual. [EMOTIONAL REGISTER PHRASE].

---

## Forbidden (cite in the negative prompt section)

These never appear:

- Recognisable photographic subjects (people, objects, landscapes) as primary content — **light is the subject**.
- Clean uniform rainbow arcs (this is optical and damaged, not meteorological).
- Lens flare circles, hexagonal aperture shapes, sun stars, bokeh circles.
- 3D-rendered metallic/glass with ray-traced reflections.
- Watercolour, oil paint, traditional art media textures.
- Symmetrical mandala or kaleidoscope patterns.
- Particle effects, sparkles, glitter.
- Smoke/fog/atmospheric volumetrics as primary element.
- Neon tube or LED strip lighting.
- Vaporwave / synthwave palettes (too pink-purple biased).
- **ANY text, letters, words, numbers — unless explicitly requested.**
- Decorative / serif / handwritten typefaces — even when text is requested.
- Hard geometric shapes with sharp edges.
- Clean digital gradients without grain.
- Single-hue or dual-hue palettes — minimum 5 spectral hues mandatory.
- Earth tones, pastels, muted palettes as dominant.
- Fluorescent / neon colours exceeding the visible spectrum.

---

## Typography layer — OPT-IN ONLY (skip unless user requested)

If and only if the user explicitly asked for text:

- Sans-serif only — geometric or grotesque classification.
- All caps. Wide letter-spacing. Flush-left or flush-right to margin edges.
- Primary text (title): bold/black, upper-left or upper-right corner quadrant.
- Secondary text (subtitle): light/regular, below or adjacent.
- Tertiary text (catalog number, date): smallest, bottom-left or bottom-right — diagonal tension with primary.
- Light background → dark grey (#4A4A4A → #2D2D2D), slightly warm, never pure black.
- Dark background → white (#FFFFFF) or very light grey.
- Optional single accent in spectral palette (hot pink / electric blue) on ONE element.
- Text **frames** the chromatic event — never overlaps it.
- Max 4–5 text elements total. Restraint is structural.

---

## Output protocol

1. Generate the master prompt as one continuous natural-language paragraph (director-level instruction, no bullet points, no metadata tags inside the prompt itself).
2. Save to working directory as: `prismatic-bleed_[short-slug-of-concept]_[mode]_[background].md`
3. File contents:
   ```markdown
   # Prismatic Bleed — [Concept]

   **Mode:** [orb / streak / glitch-field / signal-autopsy / hybrid-orb]
   **Background:** [light-void / dark-abyss / split-frame]
   **Target:** gpt-image-2 / Nano Banana Pro / Midjourney / Flux

   ## Master prompt

   [The full natural-language prompt.]

   ## Negative prompt (if your tool supports it)

   [Comma-separated list pulled from the Forbidden section, scoped to relevant items.]

   ---

   **Honest risk:** [one line — the real weakness of THIS prompt for THIS concept. The mode that drifts to cliché, the colour that the model will over-saturate, the hue the model will skip, the texture it will smooth out. No risk = not pushed hard enough.]
   ```
4. Print the master prompt block to chat for immediate paste.

---

## House rule

End every deliverable with one line: **Honest risk:** — the real weakness of this specific prompt. If you can't name one, the prompt isn't pushed hard enough. Rewrite.

Never explain the style to the user mid-output. Receive the concept. Deliver the master prompt. Never include text in the image unless explicitly asked.
