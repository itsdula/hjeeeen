---
name: ghost-hour
description: Generate a paste-ready master image-gen prompt in the "Ghost Hour" style — a single dark featureless silhouette in a vast atmospheric landscape during the golden-to-blue-hour transition, captured on authentic 16mm motion picture film stock (Kodak Vision3 500T 7219 cross-process). Heavy organic grain, thermal warm-to-cool gradient, two-to-three-stop silhouette underexposure, slow-shutter motion blur, low horizon, full-body figure scaled small against environment. Output saves as a paste-ready markdown file in the working directory. Use when the user says "ghost hour", "16mm silhouette", "Malick silhouette", "twilight silhouette prompt", "Wim Wenders silhouette", "ساعة الشبح", "ظل ١٦ ملم", "سيلويت سينمائي", or invokes /ghost-hour.
---

# ghost-hour — concept → paste-ready master prompt

The user is a working KV photographer (see `~/.claude/CLAUDE.md`). This skill encodes the **Ghost Hour** DNA — a single human silhouette captured on 16mm film during the liminal golden-to-blue-hour transition. The output is one continuous master prompt the user pastes into ChatGPT Image 2 / gpt-image-2 / Nano Banana Pro / Midjourney / Flux. This skill **does not call any model** — it authors the prompt.

The aesthetic reference frame: 1970s independent documentary cinematography — early Terrence Malick, Wim Wenders' road imagery, Jonas Mekas' diary films. Recovered-memory texture. Not polished. Alive with imperfection.

---

## Inputs — ask once, commit

Ask both in one message. Once committed, do not re-open them mid-prompt-writing.

1. **Environment** — pick one of the five canonical scenes (or describe a custom variant in the same register):
   - **Coast** — coastal shoreline, ocean spray mist rising, waves lapping rocks.
   - **Desert** — open desert or field at twilight, flat endless horizon.
   - **Urban** — urban roadside at blue hour, distant vehicle headlights as warm bokeh halos.
   - **Carnival** — fairground at dusk, warm neon glow from rides creating colour-saturated atmospheric halos.
   - **Transit** — train / vehicle window framing a sunset sky, figure seen in transit silhouette.
2. **Figure brief** — one line. Apparent gender or non-gendered; standing / walking / turning / reaching; hair texture (loose / wrapped / cropped); fabric movement (long coat / abaya / shemagh / no flowing fabric). Spell it out — the generator defaults to a generic standing male on anything left unsaid.

Optional 3rd input — **cultural register** — Saudi-Najdi / Saudi-Hijazi / mixed-Gulf / non-specified. If specified, the wardrobe negatives carry through (no thobe-on-women, no shemagh-on-women, etc.). Default: non-specified universal silhouette.

Optional 4th input — **aspect ratio** — default `4:5` portrait. Other supported: `3:4`, `2:3`, `9:16`, `1:1`. Never landscape unless the user overrides — the style lives in portrait orientation.

---

## The non-negotiable DNA pillars

Every output honours ALL pillars. Violating any one breaks the style.

### Pillar 1 — 16mm film stock authenticity
Authentic 16mm motion picture film grain — **heavy, organic, irregularly distributed** across the entire frame. Coarse clumpy texture of high-speed 16mm emulsion pushed one stop in processing. NOT uniform digital noise — natural clustering and tonal variation of real silver halide crystals. Larger grain particles in shadows, finer grain dissolving into highlights. Reference: **Kodak Vision3 500T 7219** at ISO 800–1600 equivalent push.

### Pillar 2 — Thermal warm-to-cool gradient
Strict palette: **burnt amber + deep golden orange + molten honey** in the sky and upper frame, transitioning through a **narrow band of muted rose** into **cool steel blue + teal + deep indigo** in shadows and lower frame. Highlights carry slight yellow-cream warmth (aged optical glass). Midtones sit in a desaturated cool-neutral zone. Shadows fall into blue-black with subtle teal undertones. Color science = **cross-processed or day-for-night graded** — warm practicals fighting against cool melancholic base tone.

### Pillar 3 — Silhouette underexposure
Subject is deliberately **two to three stops underexposed** relative to background — all surface detail, texture, identity collapsed into a solid dark mass. **NO facial features. NO clothing detail. NO skin tone.** The figure exists purely as shape, contour, gesture against the luminous environment. Background sky and ambient light sources are correctly exposed or slightly overexposed — high-contrast separation between subject and world. A thin amber or teal rim may kiss the outline of hair or shoulders, but the interior remains impenetrable.

### Pillar 4 — Motion blur
**Slow shutter: approximately 1/15s to 1/30s.** Medium motion blur across the subject. The figure's edges dissolve and smear directionally — captured movement frozen mid-gesture. Blur is NOT uniform — follows real motion physics: torso relatively stable, extremities (hair, arms, fabric) trailing into soft streaks. Background remains comparatively stable, anchoring the composition while the human element exists in a state of beautiful disintegration.

### Pillar 5 — Low horizon, small figure
Horizon line sits **low in the frame (lower third)** — majority of the image surrendered to expansive sky, atmosphere, negative space. Figure occupies the **centre or slight off-centre** position, **scaled small** against the environment — solitude and overwhelming presence of nature/light/urban atmosphere. Framing is **full-body or three-quarter body** — keep the subject as a complete gestural shape, never a cropped portrait.

### Pillar 6 — Atmospheric particulate
Air is **thick with particulate** — ocean mist, dust, humidity, ambient haze. Scattering medium diffuses light sources — soft gradients and glow rather than hard-edged illumination. Light wraps around the environment. Shadows are **never absolute black** — they carry colour information (deep blue, muted teal).

---

## Forbidden — the hard negatives

These never appear in a Ghost Hour image:

- Lens flare or optical aberration artifacts.
- Burned/darkened edges (NO vignette of any kind).
- Digital post-processing artifacts (NO fake chromatic aberration overlay, NO fake light leaks).
- Sharp focus on the subject — the figure must carry motion softness.
- Identifiable facial features or expressions — silhouette is impenetrable.
- Text, watermarks, overlays.
- HDR tone-mapping or hyper-saturated colour grading.
- Clean digital / modern camera aesthetic.
- Film burns, sprocket holes, scratches, dust spots — this is **high-quality analog capture**, not damaged film.

---

## Master prompt formula — assemble in this order

```
[FIGURE STATE + ENVIRONMENT + TIME-OF-DAY]
+ [16mm FILM STOCK + GRAIN ARCHITECTURE]
+ [THERMAL COLOUR GRADIENT]
+ [SILHOUETTE EXPOSURE LOGIC]
+ [MOTION BLUR SPEC]
+ [COMPOSITIONAL ANCHORS — low horizon, small figure, full body]
+ [ATMOSPHERIC PARTICULATE]
+ [EMOTIONAL TONE + CINEMATOGRAPHIC REFERENCE]
+ [HARD NEGATIVES BLOCK]
+ [TECHNICAL TAIL — aspect, stock, grain intensity, colour temp]
```

---

## The Ghost Hour master template

The template the skill outputs (with `[BRACKETS]` filled from the user's two answers):

```
A single human figure — [FIGURE BRIEF: gender/non-gendered cue, posture, hair, fabric] — rendered as a dark, featureless silhouette stands within [ENVIRONMENT — fully described per the canonical scene] during the liminal transition between golden hour and blue hour.

The image is captured on authentic 16mm motion picture film stock — the grain structure is heavy, organic, and irregularly distributed across the entire frame with the coarse, clumpy texture characteristic of high-speed 16mm emulsion pushed one stop in processing. The grain is not uniform digital noise; it carries the natural clustering and tonal variation of real silver halide crystals, with larger grain particles visible in the shadow regions and finer grain dissolving into the highlights.

Color rendering: the palette follows a strict warm-to-cool thermal gradient. The sky and upper frame glow with rich burnt amber, deep golden orange, and molten honey tones that transition through a narrow band of muted rose into cool steel blue, teal, and deep indigo in the shadow regions and lower frame. Highlights carry a slight yellow-cream warmth as if filtered through aged optical glass. Midtones sit in a desaturated, cool-neutral zone. Shadows fall into blue-black with subtle teal undertones. The color science references Kodak Vision3 500T 7219 cross-processed or day-for-night graded — where warm practicals and natural golden light fight against a cool, melancholic base tone.

Exposure and silhouette: the subject is deliberately two to three stops underexposed relative to the background, collapsing all surface detail, texture, and identity into a solid dark mass. No facial features. No clothing detail. No skin tone. The figure exists purely as shape, contour, and gesture against the luminous environment. The background sky and ambient light sources are correctly exposed or slightly overexposed, creating a high-contrast separation between the subject and the world behind them. A thin amber or teal rim may kiss the outline of hair or shoulders, but the interior of the silhouette remains impenetrable.

Motion and blur: a slow shutter speed (approximately 1/15th to 1/30th of a second) introduces medium motion blur across the subject. The figure's edges dissolve and smear directionally, suggesting captured movement frozen mid-gesture. The blur is not uniform — it follows the physics of actual motion, with the torso relatively stable and the extremities (hair, arms, fabric) trailing into soft streaks. The background remains comparatively stable, anchoring the composition while the human element exists in a state of beautiful disintegration.

Composition: the horizon line sits low in the frame (lower third), surrendering the majority of the image to expansive sky, atmosphere, and negative space. The figure occupies the [centre OR slight off-centre LEFT/RIGHT — pick one] position, scaled small against the environment — emphasizing solitude and the overwhelming presence of [nature / urban atmosphere — match to env]. The framing is full-body, keeping the subject as a complete gestural shape rather than a cropped portrait.

Atmospheric conditions: the air is thick with particulate — [match to env: ocean mist / dust / humidity / ambient haze]. This scattering medium diffuses the light sources, creating soft gradients and glow rather than hard-edged illumination. Light wraps around the environment. Shadows are never absolute black but carry colour information — deep blue, muted teal.

What this image must NOT contain: no lens flare or optical aberration artifacts. No burned or darkened edges, no vignette of any kind. No digital post-processing artifacts — no chromatic aberration overlay, no fake light leaks. No sharp focus on the subject — the figure must carry some degree of motion softness. No identifiable facial features or expressions. No text, watermarks, or overlays. No HDR tone mapping or hyper-saturated colour grading. No clean digital or modern camera aesthetic.

Emotional tone: nostalgic, raw, contemplative. The image feels like a recovered memory — something witnessed once through half-closed eyes and never fully forgotten. It carries the weight of passage, of being somewhere between arriving and leaving. The aesthetic reference is 1970s independent documentary cinematography — the films of Terrence Malick's early work, Wim Wenders' road imagery, the poetic realism of Jonas Mekas' diary films. This is not polished. It is not perfect. It is alive with the imperfection that only analog capture and human presence can produce.

---
Aspect ratio: [4:5 default OR user-specified]
Film stock reference: Kodak Vision3 500T 7219 / Kodak Ektachrome 100D cross-processed
Grain intensity: Heavy (ISO 800–1600 equivalent push)
Color temperature: Mixed — 3200K warm practicals against 6500K ambient cool fill
```

---

## Environment-specific phrasing — drop-in fragments

For Pillar 6 (atmospheric particulate) and the environment paragraph, use these:

| Environment | Environment paragraph | Particulate |
|-------------|----------------------|-------------|
| **Coast** | "…stands at the edge of a coastal shoreline at twilight, ocean spray mist rising around the figure, waves lapping at dark wet rocks, the horizon a thin luminous line where amber sky meets indigo sea." | "ocean spray mist drifting horizontally, sea humidity, fine salt particulate catching the last light" |
| **Desert** | "…stands within an open desert plain at the closing of golden hour, soft sand stretching to a flat endless horizon, the sky's burnt amber dome curving down toward distant blue-shadowed dunes." | "fine wind-blown dust suspended in the air, dry warm haze layering between the figure and the horizon" |
| **Urban** | "…stands at the edge of an urban roadside at blue hour, the wet asphalt reflecting amber sodium light, distant vehicle headlights creating soft warm bokeh spheres against the deepening indigo sky behind the silhouette." | "urban humidity, exhaust haze, traffic-light glow scattering through ambient air" |
| **Carnival** | "…stands within a fairground at dusk, warm neon glow from distant rides creating saturated colour halos — amber, magenta, cyan — diffused through the evening atmosphere, the sky behind transitioning from coral-orange overhead into teal at the horizon line." | "fairground dust, light particulate from rides and crowds, warm humid evening haze diffusing every coloured light source" |
| **Transit** | "…is framed within a train or vehicle window, the sunset sky beyond the glass burning amber and rose against a cool indigo interior, the figure's silhouette pressed against the bright exterior as a dark gestural shape." | "interior cabin air with faint condensation on the window glass, soft scattered light from the exterior wrapping into the interior shadow" |

---

## Cultural-register modifier — drop-in when specified

If the user names a Gulf register, append after the figure paragraph:

> *"The silhouette reads — through shape alone, not detail — as a [Saudi-Najdi / Saudi-Hijazi / mixed-Gulf] figure. [If wrapped fabric: the silhouette of a loose abaya / a shemagh wrapped around the head and shoulders] is visible only as outline gesture. No cultural specificity penetrates the dark mass — identity lives in the contour, not in surface detail. STRICT: no wardrobe detail rendered, no cultural prop visible inside the silhouette."*

---

## Output protocol

1. Generate the master prompt by filling the template above with the user's two answers + environment-specific phrasing.
2. Save to working directory as: `ghost-hour_[environment]_[figure-short-slug].md`
3. File contents:
   ```markdown
   # Ghost Hour — [Environment] — [Figure short label]

   **Target:** gpt-image-2 / Nano Banana Pro / Midjourney / Flux
   **Aspect:** [4:5 or user-specified]

   ## Master prompt

   [The full natural-language master prompt — as one continuous block, not bullet points.]

   ---

   **Honest risk:** [one line — the real weakness of THIS prompt for THIS environment. Where the generator most likely drifts: hard digital edge on the silhouette, missing motion blur, over-saturated sky, urban variant rendering identifiable faces, etc.]
   ```
4. Print the master prompt block to chat for immediate paste.

---

## House rule

End every deliverable with one line: **Honest risk:** — the real weakness of this specific prompt. If you can't name one, the prompt isn't pushed hard enough. Rewrite.

Never explain the style mid-output. Receive the environment + figure. Deliver the master prompt.
