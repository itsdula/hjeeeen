// Creative 360 — the advisor. Reads the POV + the current project state and
// proposes the few concrete moves that would most strengthen the work. The
// visible face of the mind (the Creative Advisor surface calls this).

import { ppClaude } from '../../components/preprod/shared';
import type { CreativePOV, Advice } from './types';
import { adviseSystem } from './prompts';
import { readProjectThinking } from './pov';

/** Advise on a surface ('references' | 'treatment' | 'story' | 'pitch' | 'frames' | 'all'). */
export async function advise(projectId: string, pov: CreativePOV, surface: string): Promise<Advice[]> {
  const { text } = await readProjectThinking(projectId);
  const res = await ppClaude<{ advice?: any[] }>({ task: 'creative-advisor',
    system: adviseSystem(pov, surface), promptId: 'creative360.advise', vars: { pov, surface },
    prompt: `The project state:\n\n${text || '(stages still thin)'}\n\nAdvise on "${surface}". Return JSON only.`,
    maxTokens: 1800,
  });
  if (!res.ok) return [];
  const rows = Array.isArray(res.json?.advice) ? res.json.advice : [];
  const kinds = ['gap', 'drift', 'lift'] as const;
  return rows.map((r: any) => ({
    surface: str(r?.surface) || surface,
    kind: kinds.includes(r?.kind) ? r.kind : 'lift',
    move: str(r?.move),
    why: str(r?.why),
  })).filter((a: Advice) => a.move) as Advice[];
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
