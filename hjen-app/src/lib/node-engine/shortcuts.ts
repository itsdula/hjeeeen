// NODE keyboard shortcuts — the single source of truth for the Node view keymap.
//
// One table feeds three consumers: the dispatch hook (components/node/
// useNodeShortcuts.ts), the in-app ⌘/ help overlay (components/node/
// ShortcutHelp.tsx), and the Learn page's shortcut reference (components/
// LearnPage.tsx). They cannot drift because they all read from here.
//
// Canonical layout = the Keyboard-Shortcuts modal (F = favorite,
// ⇧1 = fit-all, ⇧2 = zoom-to-selection, full Timeline column), plus the
// take-loop keys documented on /learn (1–5 labels, U upscale).
//
// This module carries NO React/DOM-store dependency — pure data + KeyboardEvent
// predicates — so it can be imported anywhere and unit-tested in isolation.

export type ShortcutContext = 'canvas' | 'timeline';

export interface ShortcutDef {
  /** Stable id the dispatch hook switches on (e.g. 'create.image'). */
  id: string;
  /** Display group — matches the Learn page / help-overlay section headers. */
  group: string;
  /** Human label shown in the help overlay + Learn table. */
  name: string;
  /** Display chords: each inner array is one chord; multiple = "A / B". */
  chords: string[][];
  /** Contexts this fires in. 'canvas' = the board; 'timeline' = the dock. */
  when: ShortcutContext[];
  /** True iff this KeyboardEvent triggers the shortcut. */
  match: (e: KeyboardEvent) => boolean;
  /** call preventDefault when matched (default true). */
  preventDefault?: boolean;
}

// ---- Matcher helpers ------------------------------------------------------
const cmd = (e: KeyboardEvent) => e.metaKey || e.ctrlKey;
/** A letter/simple key with an exact modifier signature (all default false). */
function chord(main: string, mods: { cmd?: boolean; shift?: boolean; alt?: boolean } = {}) {
  return (e: KeyboardEvent) =>
    e.key.toLowerCase() === main.toLowerCase() &&
    !!mods.cmd === cmd(e) && !!mods.shift === e.shiftKey && !!mods.alt === e.altKey;
}
/** Match any of several literal e.key values with an exact modifier signature. */
function keys(vals: string[], mods: { cmd?: boolean; shift?: boolean; alt?: boolean } = {}) {
  const set = new Set(vals);
  return (e: KeyboardEvent) =>
    set.has(e.key) && !!mods.cmd === cmd(e) && !!mods.shift === e.shiftKey && !!mods.alt === e.altKey;
}
const PLUS = ['+', '='];
const MINUS = ['-', '_'];

// ---- The registry ---------------------------------------------------------
export const NODE_SHORTCUTS: ShortcutDef[] = [
  // Create — place a node at the cursor
  { id: 'create.text',     group: 'Create', name: 'Place text',     chords: [['T']],        when: ['canvas'], match: chord('t') },
  { id: 'create.image',    group: 'Create', name: 'Place image',    chords: [['I']],        when: ['canvas'], match: chord('i') },
  { id: 'create.video',    group: 'Create', name: 'Place video',    chords: [['V']],        when: ['canvas'], match: chord('v') },
  { id: 'create.audio',    group: 'Create', name: 'Place audio',    chords: [['A']],        when: ['canvas'], match: chord('a') },
  { id: 'create.subject',  group: 'Create', name: 'Place subject',  chords: [['S']],        when: ['canvas'], match: chord('s') },
  { id: 'create.bin',      group: 'Create', name: 'Place bin',      chords: [['B']],        when: ['canvas'], match: chord('b') },
  { id: 'create.set',      group: 'Create', name: 'Place set',      chords: [['⇧', 'S']],   when: ['canvas'], match: chord('s', { shift: true }) },
  { id: 'create.variable', group: 'Create', name: 'Place variable', chords: [['⇧', 'V']],   when: ['canvas'], match: chord('v', { shift: true }) },

  // Selection
  { id: 'select.all',  group: 'Selection', name: 'Select all',            chords: [['⌘', 'A']], when: ['canvas'], match: chord('a', { cmd: true }) },
  { id: 'select.none', group: 'Selection', name: 'Deselect all',          chords: [['Esc']],    when: ['canvas'], match: keys(['Escape']), preventDefault: false },
  { id: 'select.mode', group: 'Selection', name: 'Toggle select / move',  chords: [['H']],      when: ['canvas'], match: chord('h') },

  // Camera & viewport
  { id: 'camera.fit',      group: 'Camera & viewport', name: 'Fit all in view',       chords: [['⇧', '1']], when: ['canvas'], match: keys(['!', '1'], { shift: true }) },
  { id: 'camera.zoomsel',  group: 'Camera & viewport', name: 'Zoom to selection',     chords: [['⇧', '2']], when: ['canvas'], match: keys(['@', '2'], { shift: true }) },
  { id: 'camera.center',   group: 'Camera & viewport', name: 'Center on selection',   chords: [['.']],       when: ['canvas'], match: keys(['.']) },
  { id: 'camera.zoomin',   group: 'Camera & viewport', name: 'Zoom in',               chords: [['+']],       when: ['canvas'], match: keys(PLUS) },
  { id: 'camera.zoomout',  group: 'Camera & viewport', name: 'Zoom out',              chords: [['−']],       when: ['canvas'], match: keys(MINUS) },
  { id: 'camera.zoomin2',  group: 'Camera & viewport', name: 'Zoom in (override)',    chords: [['⌘', '+']],  when: ['canvas'], match: (e) => cmd(e) && PLUS.includes(e.key) },
  { id: 'camera.zoomout2', group: 'Camera & viewport', name: 'Zoom out (override)',   chords: [['⌘', '−']],  when: ['canvas'], match: (e) => cmd(e) && MINUS.includes(e.key) },
  { id: 'camera.reset',    group: 'Camera & viewport', name: 'Reset zoom / clear label', chords: [['0']],    when: ['canvas'], match: keys(['0']) },
  { id: 'camera.zoomtool', group: 'Camera & viewport', name: 'Zoom in at cursor',     chords: [['Z']],       when: ['canvas'], match: chord('z') },

  // Clipboard
  { id: 'clip.copy',  group: 'Clipboard', name: 'Copy',  chords: [['⌘', 'C']], when: ['canvas'], match: chord('c', { cmd: true }) },
  { id: 'clip.cut',   group: 'Clipboard', name: 'Cut',   chords: [['⌘', 'X']], when: ['canvas'], match: chord('x', { cmd: true }) },
  { id: 'clip.paste', group: 'Clipboard', name: 'Paste', chords: [['⌘', 'V']], when: ['canvas'], match: chord('v', { cmd: true }) },

  // Duplicate
  { id: 'dup.plain',    group: 'Duplicate', name: 'Duplicate',               chords: [['⌘', 'D']],      when: ['canvas'], match: chord('d', { cmd: true }) },
  { id: 'dup.settings', group: 'Duplicate', name: 'Duplicate with settings', chords: [['⌘', '⇧', 'D']], when: ['canvas'], match: chord('d', { cmd: true, shift: true }) },

  // Rating & labels (take-loop)
  { id: 'take.reject',   group: 'Rating & labels', name: 'Toggle reject',        chords: [['R']],        when: ['canvas'], match: chord('r') },
  { id: 'take.favorite', group: 'Rating & labels', name: 'Toggle favorite',      chords: [['F']],        when: ['canvas'], match: chord('f') },
  { id: 'take.upscale',  group: 'Rating & labels', name: 'Upscale & enhance',    chords: [['U']],        when: ['canvas'], match: chord('u') },
  { id: 'take.label',    group: 'Rating & labels', name: 'Apply color label',    chords: [['1', '–', '5']], when: ['canvas'], match: keys(['1', '2', '3', '4', '5']) },
  { id: 'take.filter',   group: 'Rating & labels', name: 'Toggle filter overlay', chords: [['⇧', 'F']],  when: ['canvas'], match: chord('f', { shift: true }) },

  // History
  { id: 'history.undo', group: 'History', name: 'Undo', chords: [['⌘', 'Z']],      when: ['canvas', 'timeline'], match: chord('z', { cmd: true }) },
  { id: 'history.redo', group: 'History', name: 'Redo', chords: [['⌘', '⇧', 'Z']], when: ['canvas', 'timeline'], match: chord('z', { cmd: true, shift: true }) },

  // Stacks (take cycling)
  { id: 'stack.prev', group: 'Stacks', name: 'Cycle stack ←', chords: [['⌥', '←']], when: ['canvas'], match: keys(['ArrowLeft'],  { alt: true }) },
  { id: 'stack.next', group: 'Stacks', name: 'Cycle stack →', chords: [['⌥', '→']], when: ['canvas'], match: keys(['ArrowRight'], { alt: true }) },

  // Delete
  { id: 'node.delete', group: 'Delete', name: 'Delete selected', chords: [['⌫']], when: ['canvas'], match: keys(['Backspace', 'Delete']) },

  // Timeline (dock focused)
  { id: 'tl.split',    group: 'Timeline', name: 'Split clip at playhead', chords: [['C']],       when: ['timeline'], match: chord('c') },
  { id: 'tl.snap',     group: 'Timeline', name: 'Toggle snapping',        chords: [['S']],       when: ['timeline'], match: chord('s') },
  { id: 'tl.selall',   group: 'Timeline', name: 'Select all clips',       chords: [['⌘', 'A']],  when: ['timeline'], match: chord('a', { cmd: true }) },
  { id: 'tl.delete',   group: 'Timeline', name: 'Delete clip',            chords: [['⌫']],       when: ['timeline'], match: keys(['Backspace', 'Delete'], {}) },
  { id: 'tl.ripple',   group: 'Timeline', name: 'Ripple delete',          chords: [['⇧', '⌫']],  when: ['timeline'], match: keys(['Backspace', 'Delete'], { shift: true }) },
  { id: 'tl.nudgeL',   group: 'Timeline', name: 'Nudge −1 frame',         chords: [[',']],       when: ['timeline'], match: keys([','], {}) },
  { id: 'tl.nudgeR',   group: 'Timeline', name: 'Nudge +1 frame',         chords: [['.']],       when: ['timeline'], match: keys(['.'], {}) },
  { id: 'tl.nudgeL5',  group: 'Timeline', name: 'Nudge −5 frames',        chords: [['⇧', ',']],  when: ['timeline'], match: keys(['<', ','], { shift: true }) },
  { id: 'tl.nudgeR5',  group: 'Timeline', name: 'Nudge +5 frames',        chords: [['⇧', '.']],  when: ['timeline'], match: keys(['>', '.'], { shift: true }) },
  { id: 'tl.prevEdit', group: 'Timeline', name: 'Previous edit point',    chords: [['↑']],       when: ['timeline'], match: keys(['ArrowUp']) },
  { id: 'tl.nextEdit', group: 'Timeline', name: 'Next edit point',        chords: [['↓']],       when: ['timeline'], match: keys(['ArrowDown']) },
  { id: 'tl.setIn',    group: 'Timeline', name: 'Set in point',           chords: [['I']],       when: ['timeline'], match: chord('i') },
  { id: 'tl.setOut',   group: 'Timeline', name: 'Set out point',          chords: [['O']],       when: ['timeline'], match: chord('o') },
  { id: 'tl.export',   group: 'Timeline', name: 'Export video (MP4)',     chords: [['⌘', 'M']],  when: ['timeline'], match: chord('m', { cmd: true }) },

  // Playback (dock focused)
  { id: 'pb.playpause',   group: 'Playback', name: 'Play / pause',        chords: [['Space']],        when: ['timeline'], match: keys([' ']) },
  { id: 'pb.shuttleBack', group: 'Playback', name: 'Shuttle reverse',     chords: [['J']],            when: ['timeline'], match: chord('j') },
  { id: 'pb.stop',        group: 'Playback', name: 'Stop',                chords: [['K']],            when: ['timeline'], match: chord('k') },
  { id: 'pb.shuttleFwd',  group: 'Playback', name: 'Shuttle forward',     chords: [['L']],            when: ['timeline'], match: chord('l') },
  { id: 'pb.stepBack',    group: 'Playback', name: 'Step back',           chords: [['←']],            when: ['timeline'], match: keys(['ArrowLeft']) },
  { id: 'pb.stepFwd',     group: 'Playback', name: 'Step forward',        chords: [['→']],            when: ['timeline'], match: keys(['ArrowRight']) },
  { id: 'pb.jumpStart',   group: 'Playback', name: 'Jump to start',       chords: [['Home']],         when: ['timeline'], match: keys(['Home']) },
  { id: 'pb.jumpEnd',     group: 'Playback', name: 'Jump to end',         chords: [['End']],          when: ['timeline'], match: keys(['End']) },

  // Help
  { id: 'help.toggle', group: 'Help', name: 'Keyboard shortcuts', chords: [['⌘', '/']], when: ['canvas', 'timeline'], match: (e) => cmd(e) && e.key === '/' },

  // ---- Tool wheel ----
  // Space is free on the CANVAS; on the timeline it is play/pause, and the two
  // never fire together because the dispatcher resolves one context per key.
  { id: 'wheel.toggle', group: 'Tools', name: 'Tool wheel — every HJEN tool', chords: [['Space']], when: ['canvas'], match: (e) => e.key === ' ' && !cmd(e) && !e.shiftKey && !e.altKey },
];

// Order the display groups sensibly for the help overlay + Learn page.
const GROUP_ORDER = [
  'Create', 'Selection', 'Camera & viewport', 'Clipboard', 'Duplicate',
  'Rating & labels', 'History', 'Stacks', 'Delete', 'Timeline', 'Playback', 'Help',
];

/** Grouped view for display — the exact shape LearnPage + ShortcutHelp render. */
export function shortcutGroupsForHelp(): Array<{ label: string; items: Array<{ name: string; chords: string[][] }> }> {
  const byGroup = new Map<string, Array<{ name: string; chords: string[][] }>>();
  for (const s of NODE_SHORTCUTS) {
    if (!byGroup.has(s.group)) byGroup.set(s.group, []);
    byGroup.get(s.group)!.push({ name: s.name, chords: s.chords });
  }
  return GROUP_ORDER.filter(g => byGroup.has(g)).map(label => ({ label, items: byGroup.get(label)! }));
}
