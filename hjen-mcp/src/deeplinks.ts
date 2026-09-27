// hjen-studio:// deep-links. Every read/write result carries one so an agent
// can hand the user a clickable link that opens the EXACT view when HJEN Studio
// is running (the Electron protocol handler is registered in Phase 3). Until
// then the links are stable + informational.

export type ViewName =
  | 'overview' | 'storyboard' | 'node' | 'frame' | 'video' | 'library' | 'cast'
  // The four asset factories — stage 06. Must stay in step with App.tsx's
  // viewMap and tools/studio.ts's VIEWS, or an agent cannot navigate to them.
  | 'character' | 'location' | 'prop' | 'wardrobe';

export function projectLink(projectId: string, view: ViewName = 'overview', entity?: string): string {
  const base = `hjen-studio://project/${encodeURIComponent(projectId)}/${view}`;
  return entity ? `${base}/${encodeURIComponent(entity)}` : base;
}

export const md = (label: string, url: string) => `[${label}](${url})`;
