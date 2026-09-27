// Build a clean, human-readable filename from a generation's title for the
// Download action (window.hjen.downloadGeneration). Keeps the deliverable's
// real extension, slugifies the title (Unicode letters/numbers survive, so
// Arabic titles still produce a readable name), and caps the length. Returns
// '' when nothing usable remains — the bridge (server/desktop) then falls back
// to its own clean default, which is the intended behaviour.
const EXT_RE = /\.(png|jpe?g|webp|gif|mp4|webm|mov|m4v)$/i;

export function cleanFileName(title: string | undefined, filePath: string): string {
  const ext = filePath.match(EXT_RE)?.[0]?.toLowerCase() || '';
  const base = (title || '')
    .trim()
    .toLowerCase()
    // collapse any run of non-alphanumeric (Unicode-aware) into a single hyphen
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return base ? `${base}${ext}` : '';
}
