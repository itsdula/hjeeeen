// On-disk path builders — a 1:1 headless mirror of electron/main.ts so the MCP
// reads/writes the EXACT files the desktop app owns. If a path scheme changes
// in main.ts, change it here too (they are the same contract).

import path from 'node:path';
import type { Host } from './host.js';
import type { StageNumber } from './types.js';

export const projectsConfigPath = (h: Host) => path.join(h.userDataDir(), 'projects.json');
export const settingsPath = (h: Host) => path.join(h.userDataDir(), 'settings.json');

export const projectFolder = (h: Host, slug: string) => path.join(h.projectsRoot(), slug);

export const projectStatePath = (h: Host, slug: string) =>
  path.join(projectFolder(h, slug), '_project', 'state.json');

/** Map stage number → data file inside {slug}/_project/. Mirrors main.ts stageDataFilename(). */
export function stageDataFilename(stage: StageNumber): string {
  switch (stage) {
    case 1: return '01_brief.json';
    case 2: return '02_references/manifest.json';
    case 3: return '03_recast/manifest.json';
    case 4: return '04_treatment.json';
    case 5: return '05_screenplay/index.json';
    case 6: return '06_assets/manifest.json';
    case 7: return '07_frames/manifest.json';
    case 8: return '08_videos/manifest.json';
  }
}

export const projectDataPath = (h: Host, slug: string, stage: StageNumber) =>
  path.join(projectFolder(h, slug), '_project', stageDataFilename(stage));

export const storyboardPath = (h: Host, slug: string) =>
  path.join(projectFolder(h, slug), '_storyboard', 'storyboard.json');

export const graphPath = (h: Host, slug: string) =>
  path.join(projectFolder(h, slug), '_node', 'graph.json');

export const libraryRoot = (h: Host) => path.join(h.projectsRoot(), '_library');
export const characterCardsRoot = (h: Host) => path.join(libraryRoot(h), 'character_cards');
export const generationsLogPath = (h: Host) => path.join(h.projectsRoot(), '_generations.jsonl');
