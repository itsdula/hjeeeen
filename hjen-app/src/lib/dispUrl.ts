// dispSrc — resolve an image path to a display URL, size-aware.
//
// The web adapter serves resized WebP variants (thumb ≈ 640px, display ≈ 1600px)
// so a wall of generations doesn't pull dozens of full 1600px images just to
// paint small tiles. Grid/thumbnail contexts pass kind 'thumb'; previews and the
// lightbox pass 'display' (the default).
//
// On WEB, window.__hjenDispUrl (installed by the cloud adapter) returns the sized
// URL. On DESKTOP there is no adapter, so we return the hjen-file:// URL unchanged
// — the desktop protocol serves the local file directly (no resize needed; local
// reads are fast). Behaviour on desktop is identical to the old fileUrl() helpers.
export function dispSrc(path?: string | null, kind: 'thumb' | 'display' = 'display'): string {
  if (!path) return '';
  const resolver = (globalThis as unknown as { __hjenDispUrl?: (v: string, k: string) => string }).__hjenDispUrl;
  if (typeof resolver === 'function') return resolver(String(path), kind) || '';
  return `hjen-file://${encodeURI(String(path))}`;
}
