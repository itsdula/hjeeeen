// The Zettel memory — organ #1 of the Creative Mind (Anwar's 6C's spine:
// Capture → Connect → Crystallize → Create). Phase 0 ships CAPTURE only:
// fleeting notes, per-user and cross-project, stored at
// {projectsRoot}/_mind/notes.json via hjen:mind-notes-read/write.
// Connect (hub links) and Crystallize (promotion to permanent insight-cards)
// arrive in Phases 1–2 — see STUDY/creative_mind/01_BUILD_PLAN.md.

export interface MindNote {
  id: string;
  text: string;
  tags: string[];
  dimension?: string;      // one of the 18 DNA dimensions, when the user files it
  capturedAt: string;      // ISO
  status: 'fleeting';      // Phase 0 — later: 'connected' | 'permanent'
}

export function newNote(text: string, dimension?: string): MindNote {
  return {
    id: `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    text: text.trim(),
    tags: [],
    dimension: dimension || undefined,
    capturedAt: new Date().toISOString(),
    status: 'fleeting',
  };
}

export async function loadNotes(): Promise<MindNote[]> {
  try {
    const res = await window.hjen.mindNotesRead();
    return res?.ok ? res.notes : [];
  } catch { return []; }
}

export async function saveNotes(notes: MindNote[]): Promise<void> {
  try { await window.hjen.mindNotesWrite({ notes }); } catch { /* keep the session alive */ }
}

/** Notes whose text/dimension overlaps the session's language — the CREATE
 *  bridge: what the user captured over weeks feeds today's collider. */
export function matchNotes(notes: MindNote[], seedText: string, limit = 6): MindNote[] {
  const tokens = new Set(
    seedText.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(t => t.length > 2),
  );
  if (tokens.size === 0) return [];
  const scored = notes
    .map(n => {
      const nTokens = `${n.text} ${n.dimension ?? ''} ${n.tags.join(' ')}`
        .toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(t => t.length > 2);
      const hits = nTokens.filter(t => tokens.has(t)).length;
      return { n, hits };
    })
    .filter(x => x.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  return scored.slice(0, limit).map(x => x.n);
}
