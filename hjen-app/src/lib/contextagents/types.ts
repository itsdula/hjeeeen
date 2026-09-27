// Context Agents — renderer-side types. These mirror the library JSON shapes and
// the caApply return shape EXACTLY. They carry NO recipe: no retrieval logic, no
// thresholds, no prompt text — those live only in electron/contextAgents.ts (MAIN).
//
// The canonical bridge types (CACard, CAProfileSummary, CALexiconEntry, CAVocab,
// CAApplyResult, CAPredicate) are declared once in src/types/hjen-bridge.d.ts and
// re-exported here so the app has a single import surface for the feature.

export type {
  CAPredicate,
  CACard,
  CAProfileSummary,
  CALexiconEntry,
  CAVocab,
  CAApplyResult,
} from '../../types/hjen-bridge';

/** The closed-vocabulary state the Studio assembles from the impression
 *  questions (or the advanced-mode selects) and sends to the engine. */
export interface ApplyState {
  register: string;
  beat: string;
  energy: string;
}

/** The full argument caApply takes: the state + the picked DNA profile + goal. */
export interface ApplyArgs extends ApplyState {
  profileId: string;
  goal: string;
}
