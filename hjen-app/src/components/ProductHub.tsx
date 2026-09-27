import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useStore, type ActiveView } from '../store';
import '../styles/studio-sorbet.css'; // SORBET GRID skin — scoped under .hub.studio-sorbet only

/**
 * HJEN Studio = a suite of apps for filmmakers. This is the landing /
 * hub page that lists every product. Today `frame`, `enhancer`, `node`,
 * `storyboard` and `video` are built; the rest are roadmap placeholders
 * the user can preview but not yet open.
 *
 * The hub renders in three user-switchable layouts (remembered across
 * sessions): Tiles (springboard grid), Wallet (fanning card stack), and
 * Bands (full-bleed editorial rows). All three follow the HJEN law —
 * colour lives on the substrate, ink stays Midnight or Whiteout.
 */

export type ProductId = 'frame' | 'enhancer' | 'emulsion' | 'angles' | 'swap' | 'reference-maker' | 'node' | 'space' | 'storyboard' | 'story' | 'video' | 'references' | 'shotlist' | 'art' | 'cast' | 'wardrobe' | 'world' | 'filmspace' | 'mcp' | 'brief' | 'creativemind' | 'treatment' | 'pitch' | 'advisor' | 'breakdown' | 'ca-studio' | 'ca-trainer' | 'ca-eye'
  // The four asset factories (stage 06). 'wardrobe' already existed as a
  // roadmap tile and is now the fourth floor rather than a separate promise.
  | 'a-character' | 'a-location' | 'a-prop';
export type Status = 'available' | 'soon';
type HubView = 'tiles' | 'wallet' | 'bands';

export interface Product {
  id: ProductId;
  name: string;
  tagline: string;
  description: string;
  status: Status;
  /** Brand token used as the tile / card / band substrate. */
  accent: string;
  /** Position in the creative workflow (Story → … → Node). Lower = earlier.
   *  Every view sorts by this, so a future product just needs its own number
   *  (use a gap/decimal to slot between two existing steps). */
  order: number;
}

// Canonical workflow order — the four phases of making any story/video:
//  THINK   Brief Mind / Creative Mind → Direction → Story → References → Pitch
//  DESIGN  Art → Cast → Wardrobe → Storyboard → Shotlist
//  MAKE    Frame → Enhancer → Video → HJEN SET
//  ORCHESTRATE  Node → MCP
// Creative Advisor sits AFTER the three thinking stages (brief/direction/story)
// because its POV is formed from them — it's the coherence check before you
// hunt references, pitch, and produce. Sorted by `order` below, so a future
// product just needs an `order` number (a decimal slots between two steps).
export const PRODUCTS: Product[] = [
  { id: 'advisor', name: 'Creative Advisor', tagline: 'The project\'s creative mind — POV + next moves', order: 4,
    description: 'The Creative 360 mind, made visible. One durable point-of-view formed from the brief, treatment, and story — the same POV that drives References, Treatment, Story, and Pitch. Ask what would strengthen the work on any surface and it answers with concrete moves.',
    status: 'available', accent: '#9B6DD1' },
  { id: 'brief', name: 'Brief Mind', tagline: 'Raw brief → gaps → one Big Idea', order: 1,
    description: 'The strategist + creative director in one tool. Classify the brief, hunt its gaps, press it into one proposition and one named persona — then collide it with the Saudi-DNA cards until three territories and one Big Idea survive the kill-gate.',
    status: 'available', accent: '#0563E9' },
  { id: 'creativemind', name: 'Creative Mind', tagline: 'A visual room from intent to Big Idea', order: 1.5,
    description: 'The brainstorm made visual. Answer through boards of real corpus frames — mood, hour, place, era, density, distance — then watch the seeds collide into a constellation of ideas. Keep the survivors, press them into three territories, and press-and-hold to sign the Big Idea into the contract.',
    status: 'available', accent: '#5B3FD1' },
  { id: 'ca-studio', name: 'Context Studio', tagline: 'Pick the feeling → a directed, referenced output', order: 1.6,
    description: 'The DNA-agnostic creative engine, made for a beginner. Answer three impression questions by picking a picture that conveys a feeling — never the technical vocabulary — name a goal, and the engine retrieves the accumulated methods that serve it and writes three finished outputs: the goal, a shootable development, and copy. Every method comes paired with a reference board so you read the output right.',
    status: 'available', accent: '#1095ED' },
  { id: 'ca-trainer', name: 'Context Trainer', tagline: 'Grow the method library — add cards, study new ads', order: 1.7,
    description: 'The engine is still learning. Curate its method library from inside the app: add and refine method cards — craft, principle, effect, and the registers/beats/energies each serves — or study a new ad from a link or a written description and watch its methods merge into the corpus. What you teach here, Context Studio retrieves next.',
    status: 'available', accent: '#257D64' },
  { id: 'ca-eye', name: 'Context Eye', tagline: 'Pick the real reference for a feeling — you judge', order: 1.8,
    description: 'The lab bench for the engine\'s EYE. Name a state — register, beat, energy — and a goal, and the eye picks the real corpus frames that carry that feeling (metadata prefilter, then a VLM that reads the pixels), shown side by side against a naive keyword search. You judge which column is better, case by case; every verdict accumulates. This is a tool to try with your own eyes, not a shipped promise.',
    status: 'available', accent: '#F25502' },
  { id: 'story', name: 'Story', tagline: 'Idea-gate → 5 beats → timed AV script', order: 3,
    description: 'The screenwriter. Gate the idea for tension + change, hold one emotional question, expand through the 5 beats — each with an externalizing image — into a timed commercial script the Storyboard breaks down with zero hand edits.',
    status: 'available', accent: '#D1B310' },
  { id: 'treatment', name: 'Direction', tagline: 'Signed idea → visual laws → technical handoffs', order: 2,
    description: 'The project\'s visual contract. It turns the signed Big Idea into six enforceable laws (aspect · lens · light · move · hour · place), locks the first and last frames through the 8-element diagnostic, and exports versioned handoffs to References, Cast, Wardrobe, Storyboard, Shotlist, Frame and Pitch.',
    status: 'available', accent: '#AF7757' },
  { id: 'pitch', name: 'Pitch', tagline: 'The winning campaign document, made in-DNA', order: 6,
    description: 'The $2,000 ghost-treatment service as a product. Two page systems — Layl dark full-bleed, Sahifa white editorial — one image per page, reader-tailored length, thank-you opener to perfect-fit close. Export a print-grade PDF.',
    status: 'available', accent: '#E5AAD8' },
  { id: 'art', name: 'Art', tagline: 'Art direction — sets, props & palette', order: 7,
    description: 'Lock the world before a frame is made: set design, props, colour script and texture language for the campaign, held against the approved DNA.',
    status: 'soon', accent: '#B2D08D' },
  { id: 'storyboard', name: 'Storyboard', tagline: 'Beat-by-beat visual planning', order: 10,
    description: 'Paste a script. Break it into shots, lock characters and places with references, make every panel and export a formatted PDF for PPM.',
    status: 'available', accent: '#0563E9' },
  { id: 'breakdown', name: 'Breakdown', tagline: 'One world-class ad, reverse-read', order: 5.5,
    description: 'The forensic mind. A world-class ad deconstructed on a full-screen disc — 13 craft axes each carrying evidence-locked findings and the HJEN control that MADE them, the pipeline read backwards (brief → beats → references → treatment → pitch), and a DNA per axis that drives future making. Read as if HJEN MADE the film.',
    status: 'available', accent: '#C97E35' },
  { id: 'references', name: 'References', tagline: 'Canon-cited, palette-balanced reference sets', order: 5,
    description: 'The visual researcher. Twelve named search axes, every reference cited photographer + campaign + year with take/leave lines, the palette-balance law enforced (warm · cool · colorful · mid, Arab eye ≥ ⅓), and a Saudi-recast nomination on every foreign frame.',
    status: 'available', accent: '#257D64' },
  { id: 'cast', name: 'Cast', tagline: 'Photo → locked character profile', order: 8,
    description: 'Drop a portrait and Cast reads a full, editable character profile out of the face — then binds it to a card that carries the same locked identity into any Studio. Low-confidence traits are flagged for you to confirm.',
    status: 'available', accent: '#AF7757' },
  // ── The four asset factories · stage 06 of the project contract ──
  // One engine, four floors: every asset is a miniature Frame run, but each
  // factory has its own spec, its own plate roles and its own output shape.
  { id: 'a-character', name: 'Character', tagline: 'The project\'s people, locked and reusable', order: 8.1,
    description: 'Photos in, one identity out. The face plate is made with no clothing at all so identity never carries wardrobe, then an exactly three-view turnaround — headless front body, face-locked three-quarter, complete back — is built at true standing proportions. Three plates, append-only takes, and a short anchor that rides into every frame.',
    status: 'available', accent: '#AF7757' },
  { id: 'a-location', name: 'Location', tagline: 'Four plates, one binding decision', order: 8.2,
    description: 'An establishing wide at a three-quarter angle so the model has depth to extend, the reverse of the same room, the medium where the beat plays, and the detail that makes it real — then the call that matters: is the frame pinned to this geometry, or free to move through it.',
    status: 'available', accent: '#257D64' },
  { id: 'a-prop', name: 'Prop', tagline: 'One canvas, four views, real shadow', order: 8.3,
    description: 'Front, three-quarter, side and back made together on a single canvas — simultaneous holds the design where four separate renders drift. Mandatory detail inserts for the engravings and attachments that go first, and real contact shadow so the object never animates like 2D card.',
    status: 'available', accent: '#B2D08D' },
  { id: 'wardrobe', name: 'Wardrobe', tagline: 'Per-role piece lists with cultural fidelity', order: 8.4,
    description: 'Garment by garment with explicit negatives against stereotype, Gulf-region cut fluency, and a photo type per piece — ghost-mannequin keeps the drape that IS a thobe or abaya, flat-lay wins on print and logo. Binds to a character so one person\'s clothes can never migrate to another.',
    status: 'available', accent: '#DCC9C1' },
  { id: 'shotlist', name: 'Shotlist', tagline: 'Narrative beats → production-locked shots', order: 11,
    description: 'Compile the signed Story and Direction into numbered A/B/C shots. Every row carries framing, lens, movement, light and sound; stale source versions are visible, the cannot-lose shot is protected, and any row can travel into Frame without retyping.',
    status: 'available', accent: '#E5AAD8' },
  { id: 'frame', name: 'Frame', tagline: 'Saudi-DNA AI image studio for KV stills', order: 12,
    description: 'Make Key Visual stills with Saudi/Gulf cultural fidelity. Layer references, lock cinematography, refine with Claude vision, ship at print resolution.',
    status: 'available', accent: '#F25502' },
  { id: 'enhancer', name: 'Enhancer', tagline: 'De-plastic AI portraits, restore real skin', order: 13,
    description: 'Take any AI face and rebuild the texture pass — pores, vellus hair, sub-surface scattering, real lip and eye detail. Identity-locked.',
    status: 'available', accent: '#2E7C9E' },
  { id: 'emulsion', name: 'Emulsion', tagline: 'Camera body · lens · film — shot-on-Alexa look, offline', order: 13.5,
    description: 'Take any AI frame and give it a real camera body. Compose Body × Lens × Film stock — Alexa roll-off, amber halation, managed micro-contrast, grain, veiling-glare black-lift, vignette. Runs fully local, instant, no cloud. Auto-reads the scene; you keep the final call.',
    status: 'available', accent: '#6E7A86' },
  { id: 'angles', name: 'Camera Angles', tagline: 'One scene → many distinct camera angles', order: 13.7,
    description: 'Drop one still and Camera Angles reads the scene, then re-shoots the same performance from genuinely different viewpoints — worm\'s-eye, overhead, over-the-shoulder, extreme profile — each MADE through the Frame engine. The subject stays locked; only the camera moves. Let it decide, or approve and edit every angle before it fires.',
    status: 'available', accent: '#1095ED' },
  { id: 'swap', name: 'The Swap', tagline: 'One frame. Change what you name, keep the rest', order: 13.8,
    description: 'Drop a frame you admire. The Eye reads it and it comes apart into thirteen things you can change — the character, the wardrobe, the action, the gaze, the place, the hour, the light. Change one or change five; everything else survives untouched. Each change becomes a numbered requirement with a test that proves it, and every take is read back against those tests — anything the model averaged away is re-driven automatically, and anything that still will not land is named rather than hidden.',
    status: 'available', accent: '#1095ED' },
  { id: 'reference-maker', name: 'Reference Maker', tagline: 'Deck scenes → signed image decisions → drift-checked takes', order: 13.9,
    description: 'Bring in scenes from a project deck. Explain why each image matters before HJEN interprets it, then sign a KEEP / CHANGE contract. In Make, choose the image model per scene and optionally use Frame’s DNA or DOP tools. Review every take against visible preservation drift — the original note and source never disappear.',
    status: 'available', accent: '#1095ED' },
  { id: 'video', name: 'Video', tagline: 'Image → motion · Seedance · Kling', order: 14,
    description: 'Animate any HJEN still with BytePlus Seedance 2.0 or Kuaishou Kling. Pick the model, get its native controls — mode, duration, aspect, CFG, sound, end-frame anchor.',
    status: 'available', accent: '#E41A2F' },
  { id: 'world', name: 'HJEN SET', tagline: 'موقع التصوير — build a world, fly the camera', order: 15,
    description: 'Build a navigable world from one image, fly a focal-true camera (real mm) with shot-size assist, then lock the angle into an Angle Pack that gpt-image-2 and Seedance obey. Local & NDA-safe; the camera is yours, not the model’s.',
    status: 'available', accent: '#257D64' },
  { id: 'filmspace', name: 'Film Space', tagline: 'A built stage — block a stand-in, set the camera, lock the angle', order: 15.5,
    description: 'A built 3D studio stage. Place a human stand-in at a real height, choose a focal-true lens, and move the camera — orbit, dolly, height. Because the stage is real geometry, its depth, outline and COCO-17 pose are exact and fully offline. Lock the angle into an Angle Pack the Frame engine obeys as an angle + pose reference for any future frame.',
    status: 'available', accent: '#3E6E88' },
  { id: 'node', name: 'Node', tagline: 'Visual pipeline — chain every HJEN tool', order: 16,
    description: 'Wire Source → Frame → Enhancer → Video → Output on one canvas. A node-graph that orchestrates HJEN’s own tools. Fully native, runs offline.',
    status: 'available', accent: '#1095ED' },
  { id: 'space', name: 'HJEN SPACE', tagline: 'The infinite board — make, arrange, wire. No sequence.', order: 16.5,
    description: 'Node\u2019s board on its own. The same engine, nodes and canvases \u2014 Subject, Set, Image, Video, Enhance \u2014 with the Sequence removed: nothing to cut, nothing to time. A spatial workspace for work that lives as frames, not as a timeline. Its tool rail moves: drag it anywhere, dock it to any edge, fold it away.',
    status: 'available', accent: '#4FB7B3' },
  { id: 'mcp', name: 'MCP', tagline: 'Model Context Protocol — HJEN as an agent tool', order: 17,
    description: 'Expose every HJEN tool over MCP so Claude and other agents can drive the studio, and connect external MCP servers into your pipeline.',
    status: 'available', accent: '#0563E9' },
];
PRODUCTS.sort((a, b) => a.order - b.order);

/** Pick Midnight or Whiteout ink by the substrate's relative luminance.
 *  Exported so sibling hubs (e.g. the App hub) reuse the exact same ink logic. */
export function inkOf(hex: string): 'dark' | 'light' {
  const h = hex.replace('#', '');
  const ch = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const L = 0.2126 * lin(ch(0)) + 0.7152 * lin(ch(2)) + 0.0722 * lin(ch(4));
  return L > 0.45 ? 'dark' : 'light';
}

const statusLabel = (s: Status) => (s === 'available' ? 'Available now' : 'Coming soon');

/** SORBET GRID hue cycle length — see the `data-sb-hue` block in
 *  studio-sorbet.css. SIX steps over five candy hues, not five: on a 5-column
 *  grid a 5-step cycle repeats down every column (vertical stripes), which is
 *  exactly what the bible's adjacency law forbids. A 6-step cycle shifts by one
 *  each row, so the tile above and the tile beside always differ. */
const SB_HUE_STEPS = 6;

/** The one true product → view map. Every available Studio tool maps to the
 *  `activeView` it opens; the roadmap ('soon') tools deliberately have no entry.
 *  Both the hub tiles and the ⌘K command palette navigate through this, so the
 *  two can never diverge. */
export const PRODUCT_VIEW: Partial<Record<ProductId, ActiveView>> = {
  frame: 'frame', enhancer: 'enhancer', emulsion: 'emulsion', angles: 'angles', swap: 'swap', 'reference-maker': 'reference-maker',
  video: 'video', node: 'node', space: 'space', storyboard: 'storyboard', cast: 'cast',
  world: 'world', filmspace: 'filmspace', mcp: 'mcp', advisor: 'advisor',
  brief: 'brief', creativemind: 'creativemind', story: 'story',
  treatment: 'treatment', pitch: 'pitch', references: 'references',
  breakdown: 'breakdown', 'ca-studio': 'ca-studio', 'ca-trainer': 'ca-trainer', 'ca-eye': 'ca-eye',
  shotlist: 'shotlist',
  'a-character': 'a-character', 'a-location': 'a-location', 'a-prop': 'a-prop', wardrobe: 'a-wardrobe',
};

/** Open a Studio product by id through the app's real navigation (the same
 *  store action a hub tile click uses). Returns false for roadmap tools that
 *  aren't wired to a view yet. Callable from anywhere (reads the live store). */
export function openStudioProduct(id: ProductId): boolean {
  const view = PRODUCT_VIEW[id];
  if (!view) return false;
  useStore.getState().setActiveView(view);
  return true;
}

/** Horizontal wallet-fan custom props for card `i` of `n`: collapsed offset
 *  (--wc-x), fanned offset (--wc-hx) and resting scale (--wc-s). The CSS drives
 *  the transitions; the hovered card lifts up and on top via `.hub-wc:hover`. */
export function fanVars(i: number, n: number): Record<string, string | number> {
  const mid = (n - 1) / 2;
  const spread = Math.min(128, Math.round(980 / Math.max(1, n - 1)));
  return {
    zIndex: i + 1,
    ['--wc-x']: `${(i - mid) * 28}px`,
    ['--wc-hx']: `${(i - mid) * spread}px`,
    ['--wc-s']: `${1 - Math.abs(i - mid) * 0.015}`,
  };
}

export const GLYPH: Record<ProductId, JSX.Element> = {
  // ── the four asset factories ──
  // Character: a head plate beside its turnaround strip — the face, then the
  // three angles made from it.
  'a-character': <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><rect x="2.5" y="4" width="8" height="16" rx="1.4" /><circle cx="6.5" cy="10" r="2.1" /><path d="M3.6 20c0-2 1.3-3.4 2.9-3.4S9.4 18 9.4 20" /><path d="M13.5 6.5h8M13.5 12h8M13.5 17.5h8" opacity={0.5} /></svg>,
  // Location: three depth planes — foreground, midground, background.
  'a-location': <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M2.5 19h19" /><path d="M4.5 19V9.5l7-4.5 7 4.5V19" /><path d="M4.5 12.5h14" opacity={0.45} /><rect x="9.5" y="14" width="4.5" height="5" /></svg>,
  // Prop: one object, four views on one canvas.
  'a-prop': <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><rect x="2.5" y="6" width="19" height="12" rx="1.4" /><path d="M9 6v12M15 6v12" opacity={0.42} /><path d="M4.6 15.2h2.8l.5-4c0-1.3-.7-2-1.9-2s-1.9.7-1.9 2z" /><path d="M16.6 15.2h2.8l.5-4c0-1.3-.7-2-1.9-2s-1.9.7-1.9 2z" opacity={0.55} /></svg>,
  frame: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2.2" /><path d="M3 17l5-4 4 3 3-3 6 5" /></svg>,
  enhancer: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 6.4L20 10l-6.2 1.6L12 18l-1.8-6.4L4 10l6.2-1.6z" /></svg>,
  emulsion: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="2.5" y="7" width="19" height="12" rx="2" /><circle cx="12" cy="13" r="3.4" /><path d="M7 7l1.4-2.5h7.2L17 7" /><circle cx="17.6" cy="10.4" r="0.9" fill="currentColor" stroke="none" /></svg>,
  angles: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" /><path d="M12 12L4.6 5.8M12 12L19.4 5.8M12 12v8.2" opacity={0.55} /><rect x="2.4" y="3" width="4" height="3" rx="0.7" /><rect x="17.6" y="3" width="4" height="3" rx="0.7" /><rect x="10" y="19.6" width="4" height="3" rx="0.7" /></svg>,
  // The Swap: the frame holds, one part of it lifts out and another drops in.
  // The rectangle is the frame that survives; the filled tile is the one thing
  // being changed; the two arrows are the exchange.
  swap: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><rect x="2.6" y="4.2" width="18.8" height="15.6" rx="1.6" /><rect x="5.4" y="7" width="6" height="6" rx="1" fill="currentColor" stroke="none" /><path d="M14.6 9h4M18.6 9l-1.6-1.6M18.6 9l-1.6 1.6" opacity={0.7} /><path d="M18.6 15h-4M14.6 15l1.6-1.6M14.6 15l1.6 1.6" opacity={0.7} /></svg>,
  'reference-maker': <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><rect x="3" y="3.5" width="18" height="17" rx="1.6" /><path d="M7 8h10M7 12h6M7 16h4" /><path d="M16.5 13.5v5M14 16h5" opacity={0.7} /></svg>,
  node: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="5" cy="12" r="2.4" /><circle cx="19" cy="5" r="2.4" /><circle cx="19" cy="19" r="2.4" /><path d="M7 11l10-5M7 13l10 5" /></svg>,
  // SPACE — the board without the sequence: a frame of open space with nodes
  // free inside it, and no track under them.
  space: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}><rect x="2.5" y="4" width="19" height="16" rx="2.5" opacity={0.45} strokeDasharray="3 3" /><circle cx="8" cy="10" r="2.2" /><circle cx="16" cy="14.5" r="2.2" /><path d="M10 11.3l3.9 2.2" /></svg>,
  storyboard: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="3" y="4" width="8" height="7" rx="1" /><rect x="13" y="4" width="8" height="7" rx="1" /><rect x="3" y="14" width="8" height="6" rx="1" /><rect x="13" y="14" width="8" height="6" rx="1" /></svg>,
  video: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z" /></svg>,
  story: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}><path d="M6 18L18 6M9 6h9v9" /></svg>,
  references: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c.6 3 1.5 4.4 4.5 4.5C13.5 7 12.6 8.4 12 11.5 11.4 8.4 10.5 7 7.5 6.5 10.5 6.4 11.4 5 12 2zM18 13c.4 2 1 2.9 3 3-2 .1-2.6 1-3 3-.4-2-1-2.9-3-3 2-.1 2.6-1 3-3z" /></svg>,
  shotlist: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></svg>,
  art: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-1 1-1.9-.6-1 .1-2.1 1.3-2.1H17a4 4 0 0 0 4-4c0-5-4-8-9-8z" /><circle cx="7.5" cy="11.5" r="1.1" fill="currentColor" /><circle cx="12" cy="8" r="1.1" fill="currentColor" /><circle cx="16.5" cy="11.5" r="1.1" fill="currentColor" /></svg>,
  cast: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M16 5.5a3 3 0 0 1 0 5.5M21 20c0-2.6-1.4-4.8-3.5-5.7" /></svg>,
  wardrobe: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round"><path d="M12 5.5a2 2 0 1 1 1.5 1.9L12 9l8.5 5.2c.9.6.5 1.8-.6 1.8H4.1c-1.1 0-1.5-1.2-.6-1.8L12 9" /></svg>,
  mcp: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v5M12 3v5" /><path d="M6 8h8v3a4 4 0 0 1-8 0z" /><path d="M10 15v3a3 3 0 0 0 3 3h5" /></svg>,
  world: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="3" y="8" width="12" height="9" rx="2" /><path d="M15 11l5-3v9l-5-3" /><path d="M4 5.5a9 4 0 0 0 16 0" opacity={0.5} /></svg>,
  filmspace: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M3 20h18" opacity={0.55} /><path d="M3 20l4-9h10l4 9" opacity={0.4} /><circle cx="11" cy="10" r="2.1" /><path d="M11 12v4M9 16h4M9.4 13.4l-1.6 2M12.6 13.4l1.6 2" /><path d="M17 5.5l4 2v3l-4-2z" /><circle cx="15.2" cy="7.4" r="1.1" /></svg>,
  brief: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M9 4h9a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H9" /><path d="M5 8l4 4-4 4" /><path d="M13 9h3M13 13h3" /></svg>,
  creativemind: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><circle cx="6" cy="7" r="1.4" fill="currentColor" stroke="none" /><circle cx="18" cy="6" r="1.4" fill="currentColor" stroke="none" /><circle cx="19" cy="16" r="1.4" fill="currentColor" stroke="none" /><circle cx="7" cy="18" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="2.6" /><path d="M12 9.4L18 6M12 14.6L19 16M12 14.6L7 18M12 9.4L6 7" opacity={0.6} /></svg>,
  treatment: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /><circle cx="16.5" cy="16" r="1.4" fill="currentColor" stroke="none" /></svg>,
  pitch: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="3" y="4" width="18" height="12" rx="1.5" /><path d="M12 16v4M8 20h8" /><path d="M7 12l3-3 2 2 4-4" /></svg>,
  advisor: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="3.2" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" /></svg>,
  breakdown: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v5M12 15.5v5M3.5 12h5M15.5 12h5" /><circle cx="12" cy="12" r="2" /></svg>,
  'ca-studio': <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><rect x="3" y="4" width="8" height="7" rx="1.2" /><rect x="13" y="4" width="8" height="7" rx="1.2" /><circle cx="7" cy="16.5" r="2.4" fill="currentColor" stroke="none" /><path d="M13 15h7M13 18.5h5" /></svg>,
  'ca-trainer': <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H19v13H6.5A1.5 1.5 0 0 0 5 18.5z" /><path d="M5 18.5A1.5 1.5 0 0 1 6.5 20H19" opacity={0.5} /><path d="M12 8v5M9.5 10.5h5" /></svg>,
  'ca-eye': <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /></svg>,
};

/** SORBET GRID doodles — each tile renders the real HAND-DRAWN illustration as a
 *  BUNDLED image asset, not an icon and not a loose runtime fetch. This map is
 *  ProductId → the doodle's filename slug; the URLs come from DOODLE_URLS below
 *  (Vite eager glob over src/assets/studio-doodles), so every PNG ships
 *  fingerprinted inside the app.
 *
 *  The art is KNOCKED OUT — the ink is the alpha, no white ground — so a tile
 *  paints it straight onto the candy and a dark SOON tile just inverts the
 *  strokes. No blend mode, and no black block left standing on the dark tiles.
 *
 *  EVERY product has one. The five that used to fall back to the boxed glyph
 *  (Creative Advisor, the three Context agents, MCP) were drawn to match the
 *  set and weighted to its line — a card with a generic icon read as a
 *  different product family. */
export const DOODLE_SLUG: Partial<Record<ProductId, string>> = {
  brief: 'brief-mind', creativemind: 'creative-mind', treatment: 'treatment',
  story: 'story', references: 'references', pitch: 'pitch', breakdown: 'breakdown',
  storyboard: 'storyboard', frame: 'frame', enhancer: 'enhancer', emulsion: 'emulsion',
  angles: 'camera-angles', swap: 'the-swap', 'reference-maker': 'references', video: 'video', world: 'hjen-set', filmspace: 'film-space',
  cast: 'cast', node: 'node', space: 'node', art: 'art', wardrobe: 'wardrobe', shotlist: 'shotlist',
  'a-character': 'cast', 'a-location': 'hjen-set', 'a-prop': 'art',
  advisor: 'creative-advisor', 'ca-studio': 'context-studio',
  'ca-trainer': 'context-trainer', 'ca-eye': 'context-eye', mcp: 'mcp',
};

/** The hand-drawn doodle PNGs are BUNDLED, not fetched loose. Vite's eager glob
 *  pulls every file in src/assets/studio-doodles into the build graph, so each
 *  ships fingerprinted + immutable-cached inside the app (part of the program,
 *  cached on device) — no HTTP round-trip on mount, no flash when the Studio tab
 *  opens. The art is static reference data that changes rarely, exactly what a
 *  bundled+hashed asset is for. Files are 512px (≈40× smaller than the 1920px
 *  originals) so the whole set is ~4MB, not 40MB. */
const DOODLE_URLS = import.meta.glob('../assets/studio-doodles/*.png', {
  eager: true, import: 'default',
}) as Record<string, string>;
function doodleUrl(slug: string | undefined): string | undefined {
  if (!slug) return undefined;
  return DOODLE_URLS[`../assets/studio-doodles/${slug}.png`];
}

const VIEWS: { id: HubView; label: string; icon: JSX.Element }[] = [
  { id: 'tiles', label: 'Tiles', icon: <svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="3" width="8" height="8" rx="2" /><rect x="3" y="13" width="8" height="8" rx="2" /><rect x="13" y="13" width="8" height="8" rx="2" /></svg> },
  { id: 'wallet', label: 'Wallet', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="4" y="9" width="16" height="11" rx="2.5" /><path d="M6 9V7a2 2 0 0 1 2-2h10" /><path d="M7 6l1-2h9" /></svg> },
  { id: 'bands', label: 'Bands', icon: <svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="4" width="18" height="4" rx="1.5" /><rect x="3" y="10" width="18" height="4" rx="1.5" /><rect x="3" y="16" width="18" height="4" rx="1.5" /></svg> },
];

const VIEW_KEY = 'hjen_hub_view';
const HIDDEN_KEY = 'hjen_hub_hidden';

/** Studio tools the user has hidden. Persisted as a JSON array of ProductIds in
 *  localStorage — mirrors how the hub already persists its own view (VIEW_KEY),
 *  so the hidden set survives an app restart. Stale ids (a product removed in a
 *  future build) are dropped on load. */
function loadHidden(): Set<ProductId> {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(arr.filter(id => PRODUCTS.some(p => p.id === id)) as ProductId[]);
  } catch { return new Set(); }
}
function persistHidden(ids: Set<ProductId>) {
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...ids])); } catch { /* ignore */ }
}

const EYE = (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>);
const EYE_OFF = (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l18 18" /><path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" /><path d="M9.9 4.6A9.9 9.9 0 0 1 12 4.5c6.5 0 10 7 10 7a17.3 17.3 0 0 1-2.16 3.03M6.06 6.06A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 3.94-.84" /></svg>);
const CHECK = (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>);

/** The hidden / shown flag drawn on each card while in manage mode. Visible
 *  cards get a quiet eye chip; hidden cards get a bright eye-off "Hidden" chip
 *  that sits above the dimming scrim. */
function ManageBadge({ hidden }: { hidden: boolean }) {
  return (
    <span className={`hub-mflag ${hidden ? 'hub-mflag--off' : 'hub-mflag--on'}`} aria-hidden>
      {hidden ? EYE_OFF : EYE}
      {hidden && <span>Hidden</span>}
    </span>
  );
}

export function ProductHub() {
  const [view, setViewState] = useState<HubView>(() => {
    try { return (localStorage.getItem(VIEW_KEY) as HubView) || 'tiles'; } catch { return 'tiles'; }
  });
  const setView = (v: HubView) => {
    setViewState(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ }
  };

  const openProduct = (p: Product) => {
    if (p.status !== 'available') return;
    openStudioProduct(p.id);
  };

  // ---- Hide / show tools (manage mode) ----
  const [hidden, setHiddenState] = useState<Set<ProductId>>(() => loadHidden());
  const [manage, setManage] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; id: ProductId } | null>(null);

  const commitHidden = (next: Set<ProductId>) => { setHiddenState(next); persistHidden(next); };
  const hideOne = (id: ProductId) => { const n = new Set(hidden); n.add(id); commitHidden(n); };
  const toggleHidden = (id: ProductId) => {
    const n = new Set(hidden);
    if (n.has(id)) n.delete(id); else n.add(id);
    commitHidden(n);
  };

  // Normal mode: a click opens the tool (unchanged). Manage mode: a click
  // toggles the card's visibility instead — the only behavioural change.
  const onCardClick = (p: Product) => { if (manage) { toggleHidden(p.id); return; } openProduct(p); };
  const onCardMenu = (e: ReactMouseEvent, p: Product) => {
    e.preventDefault();
    if (manage) return; // in manage mode a click already toggles — no menu needed
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - 224),
      y: Math.min(e.clientY, window.innerHeight - 168),
      id: p.id,
    });
  };

  // Escape backs out — close the menu first, then leave manage mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (menu) setMenu(null);
      else if (manage) setManage(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu, manage]);

  const available = PRODUCTS.filter(p => p.status === 'available').length;
  const soon = PRODUCTS.length - available;
  const hiddenCount = hidden.size;
  // Normal mode hides the hidden tools everywhere; manage mode shows them all.
  const visible = manage ? PRODUCTS : PRODUCTS.filter(p => !hidden.has(p.id));
  const viewIndex = VIEWS.findIndex(v => v.id === view);

  return (
    <div className="hub studio-sorbet">
      {/* Manage banner — sticky so Exit Mode stays reachable while the grid scrolls */}
      {manage && (
        <div className="hub-manage-bar" role="region" aria-label="Manage Studio tools">
          <div className="hub-manage-bar__lead">
            <span className="hub-manage-bar__eyebrow mono-label">Manage tools</span>
            <span className="hub-manage-bar__text">Click any tool to hide it or bring it back. Hidden tools stay off your Studio until you show them here.</span>
          </div>
          <div className="hub-manage-bar__actions">
            <span className="hub-manage-bar__count mono-label">{hiddenCount} hidden</span>
            <button className="hub-manage-bar__exit" onClick={() => setManage(false)}>{CHECK}<span>Exit Mode</span></button>
          </div>
        </div>
      )}

      {/* Bar — title + user-controlled view switcher */}
      <div className="hub-bar">
        <div className="hub-bar__head">
          <span className="hub-bar__eyebrow mono-label" aria-hidden>Made not generated</span>
          <h2 className="hub-bar__title">Studio</h2>
          <span className="hub-bar__lead mono-label">
            {available} available · {soon} soon
            {hiddenCount > 0 && !manage && (
              <> · <button className="hub-bar__hiddenbtn" onClick={() => setManage(true)}>{hiddenCount} hidden</button></>
            )}
          </span>
        </div>
        <div className="hub-toggle" data-i={viewIndex} role="tablist">
          <span className="hub-toggle__glider" aria-hidden />
          {VIEWS.map(v => (
            <button
              key={v.id}
              role="tab"
              aria-selected={v.id === view}
              className={`hub-toggle__btn ${v.id === view ? 'hub-toggle__btn--on' : ''}`}
              onClick={() => setView(v.id)}
            >{v.icon}{v.label}</button>
          ))}
        </div>
        {/* Sorbet stat slab — reuses the already-computed `available` count. */}
        <div className="hub-sb-aside">
          <div className="hub-sb-stat">
            <span className="hub-sb-stat__num">{available}</span>
            <span className="hub-sb-stat__lbl">tools in<br />your studio</span>
          </div>
        </div>
      </div>

      {/* ---------- TILES (02) ---------- */}
      {view === 'tiles' && (() => {
        // Sort the SOON tiles to the end HERE rather than leaning on the CSS
        // `order` property alone: the hue cycle has to reason about each tile's
        // VISUAL position in the grid, and `order` reshuffles the boxes after
        // the selectors have already matched DOM order. Sort is stable, so the
        // workflow order inside each status group is untouched.
        const ordered = [...visible].sort(
          (a, b) => Number(a.status === 'soon') - Number(b.status === 'soon'),
        );
        let liveIndex = 0;
        return (
          <div className={`hub-tiles ${manage ? 'hub-tiles--manage' : ''}`}>
            {ordered.map(p => {
              const ink = inkOf(p.accent);
              const isHidden = hidden.has(p.id);
              // SOON tiles take the neutral dark well, so they sit out the cycle.
              const hue = p.status === 'soon' ? undefined : liveIndex++ % SB_HUE_STEPS;
              return (
                <button
                  key={p.id}
                  className={`hub-tile hub-tile--ink-${ink} ${p.status === 'soon' ? 'hub-tile--soon' : ''} ${manage && isHidden ? 'hub-tile--hidden' : ''}`}
                  data-sb-hue={hue}
                  style={{ background: p.accent, ['--hub-tile-accent' as any]: p.accent }}
                  onClick={() => onCardClick(p)}
                  onContextMenu={e => onCardMenu(e, p)}
                  title={manage ? (isHidden ? 'Click to show' : 'Click to hide') : undefined}
                >
                  {manage && <ManageBadge hidden={isHidden} />}
                  {p.status === 'soon' && <span className="hub-tile__st mono-label">{statusLabel(p.status)}</span>}
                  <span className="hub-tile__name">{p.name}</span>
                  <span className="hub-tile__desc">{p.tagline}</span>
                  {doodleUrl(DOODLE_SLUG[p.id])
                    ? <img className="tile-doodle" src={doodleUrl(DOODLE_SLUG[p.id])} alt="" aria-hidden="true" draggable={false} />
                    : <span className="hub-tile__glyph">{GLYPH[p.id]}</span>}
                </button>
              );
            })}
          </div>
        );
      })()}

      {/* ---------- WALLET (05) ---------- */}
      {view === 'wallet' && (
        <div className="hub-wallet">
          <div className="hub-wallet__lead">
            <h3>One stack.<br />Every tool.</h3>
            <p>Frame, enhance, chain, board and move — every HJEN tool lives in one wallet and hands off to the next.</p>
            <div className="hub-wallet__legend">
              <span><i style={{ background: 'var(--ember)' }} />Available</span>
              <span><i style={{ background: 'rgba(255,255,255,0.35)' }} />Roadmap</span>
            </div>
            <div className="hub-wallet__hint">{manage ? 'Click a card to hide or show it.' : 'Hover the stack to fan it open · click a card to open the tool.'}</div>
          </div>
          <div className={`hub-deck ${manage ? 'hub-deck--manage' : ''}`}>
            {visible.map((p, i) => {
              const ink = inkOf(p.accent);
              const isHidden = hidden.has(p.id);
              return (
                <button
                  key={p.id}
                  className={`hub-wc hub-wc--ink-${ink} ${manage && isHidden ? 'hub-wc--hidden' : ''}`}
                  style={{ background: p.accent, ['--hub-tile-accent' as any]: p.accent, ...(fanVars(i, visible.length) as any) }}
                  onClick={() => onCardClick(p)}
                  onContextMenu={e => onCardMenu(e, p)}
                  title={manage ? (isHidden ? 'Click to show' : 'Click to hide') : undefined}
                >
                  {manage && <ManageBadge hidden={isHidden} />}
                  <span className="hub-wc__top">
                    <span className="hub-wc__nm">{p.name}</span>
                    <span className="hub-wc__st mono-label">{statusLabel(p.status)}</span>
                  </span>
                  <span className="hub-wc__ds">{p.tagline}</span>
                  <span className="hub-wc__big">{String(i + 1).padStart(2, '0')}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ---------- BANDS (03) ---------- */}
      {view === 'bands' && (
        <div className={`hub-bands ${manage ? 'hub-bands--manage' : ''}`}>
          {visible.map((p, i) => {
            const ink = inkOf(p.accent);
            const isHidden = hidden.has(p.id);
            return (
              <button
                key={p.id}
                className={`hub-band hub-band--ink-${ink} ${manage && isHidden ? 'hub-band--hidden' : ''}`}
                style={{ background: p.accent, ['--hub-tile-accent' as any]: p.accent }}
                onClick={() => onCardClick(p)}
                onContextMenu={e => onCardMenu(e, p)}
                title={manage ? (isHidden ? 'Click to show' : 'Click to hide') : undefined}
              >
                {manage && <ManageBadge hidden={isHidden} />}
                <span className="hub-band__no">{String(i + 1).padStart(2, '0')}</span>
                <span className="hub-band__nm">{p.name}<small>{p.tagline}</small></span>
                <span className="hub-band__meta">
                  <b>{statusLabel(p.status)}</b>
                  {p.status === 'available' ? 'Live in the studio today.' : 'On the roadmap — shipping soon.'}
                </span>
                <span className="hub-band__arr">
                  {p.status === 'available'
                    ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}><path d="M6 18L18 6M9 6h9v9" /></svg>
                    : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Right-click card menu — Hide this tool · Show All (enter manage mode) */}
      {menu && (() => {
        const p = PRODUCTS.find(x => x.id === menu.id);
        if (!p) return null;
        return (
          <>
            <div
              className="hub-cardmenu__scrim"
              onClick={() => setMenu(null)}
              onContextMenu={e => { e.preventDefault(); setMenu(null); }}
            />
            <div className="hub-cardmenu" style={{ left: menu.x, top: menu.y }} role="menu">
              <div className="hub-cardmenu__head mono-label">{p.name}</div>
              <button className="hub-cardmenu__item" role="menuitem" onClick={() => { hideOne(menu.id); setMenu(null); }}>
                {EYE_OFF}<span>Hide</span>
              </button>
              <div className="hub-cardmenu__sep" />
              <button className="hub-cardmenu__item" role="menuitem" onClick={() => { setManage(true); setMenu(null); }}>
                {EYE}<span>Show All</span>
              </button>
            </div>
          </>
        );
      })()}
    </div>
  );
}
