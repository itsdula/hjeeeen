// Creative 360 — form / read / persist the project's Point Of View.
//
// The POV is the durable brain. It is formed from the signed stages, cached
// as {slug}/_project/creative_pov.json via the generic project-doc bridge, and
// reused by every tool. getPOV() forms it on first use; formPOV() reforms it
// after the stages change.

import { ppClaude } from '../../components/preprod/shared';
import type { CreativePOV } from './types';
import { POV_SYSTEM, povBlock } from './prompts';
import type { BriefMindExtras, TreatmentData, ScreenplayData } from '../../types/preprod';

const DOC_NAME = 'creative_pov';

/** Read the signed stages into a rich text the POV former reasons over. Also
 *  returns which stages were present (provenance) and a compact story-context
 *  string tools can pass around without reforming the whole POV. */
export async function readProjectThinking(projectId: string): Promise<{
  text: string;
  present: { brief: boolean; treatment: boolean; screenplay: boolean };
}> {
  const [s1, s4, s5] = await Promise.all([
    window.hjen.readStageData({ id: projectId, stage: 1 }).catch(() => null),
    window.hjen.readStageData({ id: projectId, stage: 4 }).catch(() => null),
    window.hjen.readStageData({ id: projectId, stage: 5 }).catch(() => null),
  ]);
  const b = (s1 && typeof s1 === 'object' ? s1 : {}) as BriefMindExtras & { client?: string; restatement?: string };
  const t = (s4 && typeof s4 === 'object' ? s4 : {}) as TreatmentData;
  const sc = (s5 && typeof s5 === 'object' ? s5 : {}) as ScreenplayData;

  const parts: string[] = [];
  if (b.client) parts.push(`CLIENT: ${b.client}`);
  if (b.proposition) parts.push(`PROPOSITION: ${b.proposition}`);
  if (b.persona) parts.push(`PERSONA: ${b.persona}`);
  if (b.restatement) parts.push(`BRIEF (restated): ${b.restatement}`);
  if (b.bigIdea?.territory) parts.push(`BIG IDEA: ${b.bigIdea.territory} — ${b.bigIdea.why ?? ''}`.trim());
  if (b.territories?.length) {
    parts.push('TERRITORIES:\n' + b.territories
      .map(x => `- ${x.name}: ${x.hook} · ${x.insight} · truth: ${x.culturalTruth}`).join('\n'));
  }
  const cp = t.visuals?.choicePairs;
  const cpLine = cp
    ? [cp.aspect, cp.lens, cp.lightDirection, cp.cameraMove, cp.hour, cp.placeRegister].filter(Boolean).join(' · ')
    : '';
  if (t.approach) parts.push(`APPROACH: ${t.approach}`);
  if (cpLine) parts.push(`TREATMENT CHOICES: ${cpLine}`);
  if (t.firstFrame) parts.push(`FIRST FRAME: ${t.firstFrame}`);
  if (t.lastFrame) parts.push(`LAST FRAME: ${t.lastFrame}`);
  const specs = (t.pagePlan ?? []).map(r => (r.imageSpec || '').trim()).filter(Boolean);
  if (specs.length) parts.push('IMAGE SPECS:\n' + specs.map((x, i) => `${i + 1}. ${x}`).join('\n'));
  if (sc.emotionalQuestion) parts.push(`EMOTIONAL QUESTION: ${sc.emotionalQuestion}`);
  if (sc.beats?.length) {
    parts.push('STORY BEATS:\n' + sc.beats.map(x => `- ${x.beat}: ${x.line} → ${x.visualMetaphor}`).join('\n'));
  }
  const visuals = (sc.blocks ?? []).map(x => (x.visual || '').trim()).filter(Boolean);
  if (visuals.length) parts.push('SCRIPT VISUALS:\n' + visuals.map(v => `- ${v}`).join('\n'));

  const present = {
    brief: !!(b.proposition || b.restatement || b.bigIdea?.territory),
    treatment: !!(cpLine || t.firstFrame || t.approach),
    screenplay: !!(sc.beats?.length || visuals.length),
  };
  return { text: parts.join('\n\n'), present };
}

/** Form the POV from the current stages and persist it. Returns null on failure. */
export async function formPOV(projectId: string): Promise<CreativePOV | null> {
  const { text, present } = await readProjectThinking(projectId);
  if (!text.trim()) return null;
  const res = await ppClaude<Partial<CreativePOV>>({ task: 'creative-advisor',
    system: POV_SYSTEM, promptId: 'creative360.pov',
    prompt: `The project's signed thinking:\n\n${text}\n\nForm the POV.`,
    maxTokens: 2000,
  });
  if (!res.ok) return null;
  const j = res.json || {};
  const pov: CreativePOV = {
    essence: str(j.essence),
    register: str(j.register),
    audience: str(j.audience),
    visualLanguage: str(j.visualLanguage),
    forbidden: Array.isArray(j.forbidden) ? j.forbidden.map(str).filter(Boolean) : [],
    northStar: str(j.northStar),
    formedFrom: present,
    formedAt: new Date().toISOString(),
  };
  await window.hjen.projectDocWrite({ id: projectId, name: DOC_NAME, data: pov }).catch(() => undefined);
  return pov;
}

/** Read the cached POV; form it on first use. `force` reforms from scratch. */
export async function getPOV(projectId: string, force = false): Promise<CreativePOV | null> {
  if (!force) {
    const cached = await window.hjen.projectDocRead({ id: projectId, name: DOC_NAME }).catch(() => null);
    if (cached && typeof cached === 'object' && (cached as CreativePOV).essence) return cached as CreativePOV;
  }
  return formPOV(projectId);
}

/** A ready-to-append system-prompt block so any generative tool obeys the same
 *  POV. Returns '' when there is no POV yet (the tool then runs unconstrained). */
export async function loadPovBlock(projectId: string): Promise<string> {
  const pov = await getPOV(projectId).catch(() => null);
  if (!pov) return '';
  return '\n\n─ PROJECT POV — obey it, especially the FORBIDDEN list ─\n' + povBlock(pov);
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
