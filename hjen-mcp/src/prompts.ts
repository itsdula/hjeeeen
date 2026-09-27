// MCP prompts — user-selectable templates (slash-command style) that wrap the
// HJEN production canon so an agent produces house-correct output. These are the
// PPM pipeline + the 8-element frame brief + casting + DNA-lock.

import { McpServer } from './mcp/server.js';

export function registerPrompts(server: McpServer): void {
  server.prompt({
    name: 'hjen_ppm_pipeline',
    title: 'Run the PPM pipeline',
    description: 'Walk a project through the 10-phase KV pipeline (Brief → DNA → Matrix → Casting → Location → Wardrobe → PPM → Shoot → Post → Delivery).',
    arguments: [{ name: 'project', description: 'Project id/slug/name', required: false }],
    build: (a) => ({
      description: 'PPM pipeline',
      messages: [{ role: 'user', content: { type: 'text', text:
`Act as the KV photographer running HJEN's production pipeline${a.project ? ` for project "${a.project}"` : ''}.

1. Orient: call hjen_project_overview first — read the contract, stage state, storyboard, and generations.
2. Load hjen://dna and hjen://register — they are binding on every frame and every line of copy.
3. Move phase by phase, and DON'T start phase N+1 until N is signed:
   Brief → DNA → Matrix (30–40 frames) → Casting (95%) → Location → Wardrobe → PPM lock → Shoot → Post → Delivery.
4. Use hjen_stage_write to record each phase, hjen_stage_sign to lock it, hjen_ledger_add for risks/open items.
5. Build frames only after casting + wardrobe are signed. Every frame ends with one line: "Honest risk:".
Refuse the stock-Arab clichés. Specificity over abstraction.` } }],
    }),
  });

  server.prompt({
    name: 'hjen_frame_brief',
    title: 'Write a frame brief (8 elements)',
    description: 'Draft a shoot-ready frame using the non-negotiable 8-element template.',
    arguments: [{ name: 'subject', description: 'One-line subject/scene', required: false }],
    build: (a) => ({
      messages: [{ role: 'user', content: { type: 'text', text:
`Write a frame brief${a.subject ? ` for: ${a.subject}` : ''} using ALL eight elements — if any answer is "it's implied", rewrite:
1. Subject state — posture, breath, micro-expression, hands, eye-line; wardrobe piece-by-piece with explicit negatives.
2. Blocking — exact position named to the set, distance to lens, angle.
3. Light architecture — name every source (key/fill/rim/event/ambient), colour temp, angle, intensity, in/off frame.
4. Frame furniture — three plates (foreground/mid/background) + the cultural-truth object.
5. Sound of the frame — what the room sounds like at capture.
6. Time state — time of day, light state, weather, operational state.
7. Crop & aspect plan — which aspects survive, safe areas, caption/logo lockup (RTL+LTR).
8. Inside state — one sentence: what's happening inside the subject in THIS frame.
Then, if approved, hjen_frame_make it (confirm:false first for the estimate).` } }],
    }),
  });

  server.prompt({
    name: 'hjen_casting_brief',
    title: 'Write a casting brief',
    description: 'Write an archetype (a character with a life), not a type.',
    arguments: [{ name: 'role', description: 'The role', required: false }],
    build: (a) => ({
      messages: [{ role: 'user', content: { type: 'text', text:
`Write a casting brief${a.role ? ` for the role: ${a.role}` : ''} as an ARCHETYPE, not a type — a character with a life: region, age, profession, posture, wardrobe fit, resting face. Not "businessman" but e.g. "41-year-old Najdi banker who commutes SAR Riyadh→Dammam monthly, walks like he's walked this concourse 100 times." Lead with street casting. Give a self-tape prompt that directs through intention, never through results. Casting is 95% of the KV — never compromise it for schedule.` } }],
    }),
  });

  server.prompt({
    name: 'hjen_dna_lock',
    title: 'Lock the DNA before making',
    description: 'Load the imagery + copy bibles and state the five refusals before any generation.',
    build: () => ({
      messages: [{ role: 'user', content: { type: 'text', text:
`Before making anything: read hjen://dna (Clay & Basil imagery bible) and hjen://register (Saudi copy bible). State the one-line intent, the POV, the palette in words, and FIVE specific clichés this campaign will refuse (no white-thobe-laughing-at-phone, no desert-sunset-with-falcon, no diverse-team-at-laptop). Only then write prompts and hjen_frame_make.` } }],
    }),
  });
}
