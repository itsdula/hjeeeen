// Context Agents — renderer engine (THIN client only).
//
// House law (recipe stays server-side): this file is a dumb terminal. Every
// function is one line over window.hjen.ca* → the MAIN process. There is NO
// retrieval logic, NO thresholds, NO prompt text, NO lexicon here — the recipe
// lives exclusively in electron/contextAgents.ts. If you are tempted to add
// scoring or a system prompt in this file, it belongs in MAIN instead.

import type {
  CACard,
  CAApplyResult,
  CAProfileSummary,
  CAVocab,
  CALexiconEntry,
} from '../../types/hjen-bridge';
import type { ApplyArgs } from './types';

/** Run the engine: send the small state + profile + goal, get the three finished
 *  texts + the chosen method ids back. All retrieval + prompting happens in MAIN. */
export function caApply(a: ApplyArgs): Promise<CAApplyResult> {
  return window.hjen.caApply(a);
}

/** The closed state vocabulary (never hardcoded in the renderer — read from MAIN). */
export async function vocab(): Promise<CAVocab> {
  const r = await window.hjen.caVocab();
  return { registers: r.registers, beats: r.beats, energies: r.energies };
}

/** All method cards (Trainer list). */
export async function listMethods(): Promise<CACard[]> {
  const r = await window.hjen.caListMethods();
  return r.ok ? r.methods : [];
}

/** The available DNA profiles as {id,name}. */
export async function listProfiles(): Promise<CAProfileSummary[]> {
  const r = await window.hjen.caListProfiles();
  return r.ok ? r.profiles : [];
}

/** Read a single card by id (Trainer editor). */
export function readCard(id: string) {
  return window.hjen.caReadCard({ id });
}

/** Create or overwrite a card (validated + written atomically in MAIN). */
export function writeCard(card: CACard) {
  return window.hjen.caWriteCard({ card });
}

/** Delete a card by id. */
export function deleteCard(id: string) {
  return window.hjen.caDeleteCard({ id });
}

/** Read lexicon entries, optionally filtered by status (e.g. 'trusted'). */
export async function readLexicon(status?: string): Promise<CALexiconEntry[]> {
  const r = await window.hjen.caReadLexicon(status ? { status } : undefined);
  return r.ok ? r.entries : [];
}

/** Study a new ad: MAIN spawns the lab pipeline; returns the merge report. */
export function study(a: { adId: string; profileId: string; videoPathOrUrl?: string; description?: string; lang?: string }) {
  return window.hjen.caStudy(a);
}
