// Hidden Frameset hunt — the Creative Mind's board fetcher (Anwar 2026-07-11:
// the question boards come from Frameset in a SILENT session, tailored to the
// brief; the internal corpus is the fallback, not the source).
//
// Anwar's second-round laws (same day):
//   · Frames must REPRESENT the option — the caller passes a precise query,
//     and this module retries with alternate queries (label words, tags)
//     before giving up, so boards are never empty when Frameset has anything.
//   · Frames must be FRESH each session — we harvest wide (up to HARVEST) and
//     pick the board at random from the harvest; the cache is per-session and
//     cleared on every new analyze (resetFramesetSession).
//
// Mechanics (all verified in STUDY/frameset_adapter_spec.md):
//   search URL = https://frameset.app/search?search=<q>&image_type=frames
//   grid imgs  = CDN d13mryl9xv19vu.cloudfront.net, stills end _sm.avif
//   best still = swap _sm.avif → _md.avif (1200px, 200 OK)
// TRANSPORT (Anwar 2026-07-11, round 6): the hunt rides the user's REAL Chrome
// profile (refhunt-chrome — the one already signed into Frameset for the
// References hunt) launched HEADLESS on the shared CDP port, in a background
// tab driven by lib/cdpBrowser. One tab ⇒ one page ⇒ all hunts serialized.
// Downloads land in {projectsRoot}/_mind/boards/ and render via hjen-file://.

import { connectCdp, type CdpSession } from '../cdpBrowser';
import { rankByFeeling, applyOrder } from '../eye/rank';
import type { Register } from '../eye/types';

export interface BoardFrame {
  id: string;
  filePath: string;
  source: 'frameset' | 'corpus';
  title?: string;
}

const CDN = 'd13mryl9xv19vu.cloudfront.net';
const STILL_RE = /_sm\.avif$/;
const HARVEST = 12;   // stills kept per query when there is no eye (the old random pool)
const DEEP = 60;      // stills the EYE gets to choose from — the good frame is usually not in the first twelve

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'q';

/** Stable per-frame token from the CDN uuid — unique filenames, no overwrite. */
const srcToken = (src: string) => {
  const m = src.match(/([0-9a-f]{4,})_sm\.avif$/i);
  return (m?.[1] ?? Math.random().toString(36).slice(2)).slice(-10);
};

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Live status reporting — the Creative Mind's bottom strip subscribes here so
// the user SEES what the wait is (Anwar 2026-07-11: no blind loading).
type HuntReporter = (msg: string) => void;
let report: HuntReporter = () => {};
export function setHuntReporter(r: HuntReporter | null): void {
  report = r ?? (() => {});
}

// One hidden window ⇒ one query at a time. Serialize every hunt through this.
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const next = queue.then(job, job);
  queue = next.catch(() => undefined);
  return next;
}

// Session memory: query → frames. Cleared per analyze so boards renew.
const cache = new Map<string, BoardFrame[]>();

// Quota-starvation detection: the anonymous Frameset session has a small free
// search allowance — once several consecutive hunts return ZERO stills, the
// wall is almost certainly up. We stop burning searches, tell the user, and
// offer a one-time sign-in (the persist:refhunt session keeps the login).
let consecutiveMisses = 0;
let starved = false;
let onStarve: (() => void) | null = null;
export function setStarveListener(cb: (() => void) | null): void { onStarve = cb; }
export function isFramesetStarved(): boolean { return starved; }

/** Open the user's REAL hunt Chrome VISIBLY on Frameset so they sign in once —
 *  it is the same profile the headless hunt rides, so the login carries. */
export function openFramesetLogin(): void {
  void window.hjen.chromeLaunch({ url: 'https://frameset.app', headless: false });
}

/** New session, new eyes — boards must not repeat the last session's picks. */
export function resetFramesetSession(): void {
  cache.clear();
  consecutiveMisses = 0;
  starved = false;
}

/** Forget one query — a re-hunt inside a question must fetch fresh frames. */
export function evictFramesetQuery(query: string): void {
  cache.delete(query.trim());
}

// ── the CDP tab (one, reused; reconnect on death) ───────────────────────────
let cdp: CdpSession | null = null;
let cdpTabId: string | null = null;

async function ensureCdp(): Promise<CdpSession | null> {
  if (cdp) return cdp;
  const launched = await window.hjen.chromeLaunch({ url: 'about:blank', headless: true });
  if (!launched.ok) return null;
  const tab = await window.hjen.chromeNewTab({ port: launched.port, url: 'about:blank' });
  if (!tab.ok) return null;
  try {
    cdp = await connectCdp(tab.wsUrl);
    cdpTabId = tab.targetId;
    return cdp;
  } catch {
    cdp = null;
    return null;
  }
}

function dropCdp(): void {
  try { cdp?.close(); } catch { /* gone */ }
  if (cdpTabId) void window.hjen.chromeCloseTab({ targetId: cdpTabId }).catch(() => undefined);
  cdp = null;
  cdpTabId = null;
}

async function huntOnce(query: string, want: number, register?: Register | null): Promise<BoardFrame[]> {
  const url = `https://frameset.app/search?search=${encodeURIComponent(query)}&image_type=frames`;
  report(`Searching film frames — “${query}”`);
  let s = await ensureCdp();
  if (!s) return [];
  try {
    await s.navigate(url);
  } catch {
    dropCdp();                       // dead socket — one reconnect attempt
    s = await ensureCdp();
    if (!s) return [];
    await s.navigate(url).catch(() => undefined);
  }

  // ready signal: the grid mounted with a real result set (not just logos)
  await s.waitFor(
    `document.querySelectorAll('img[src*="${CDN}"]').length >= 8`,
    { timeoutMs: 12_000, intervalMs: 400 },
  );
  await sleep(400);   // let lazy srcs settle

  const stills = await s.evaluate<Array<{ src: string; alt: string }>>(`(() => {
    const out = [];
    for (const img of document.querySelectorAll('img[src*="${CDN}"]')) {
      if (img.closest && img.closest('#submit-title')) continue;
      const src = img.currentSrc || img.src;
      if (/_sm\.avif$/.test(src)) out.push({ src, alt: img.alt || '' });
      if (out.length >= 60) break;
    }
    return out;
  })()`).catch(() => [] as Array<{ src: string; alt: string }>);
  if (!stills || stills.length === 0) return [];
  report(`Found ${stills.length} frames for “${query}” — picking ${want}`);

  // SELECTION. Random was the old answer to a real problem — Frameset's own top
  // row repeats across sessions, so the board had to be shuffled to stay fresh.
  // But random cannot be wrong and cannot be right either. When the option
  // carries a feeling, the EYE reads the pixels of a much deeper harvest and
  // orders them by that feeling (server-side; blind-tested against Frameset's
  // own order — it wins outright on longing/joy and is fused with it elsewhere).
  // No feeling, no server, no model → the old shuffle, unchanged.
  let pool = shuffle(stills.slice(0, HARVEST));
  if (register) {
    const deep = stills.slice(0, DEEP);
    const ranked = await rankByFeeling(register, deep.map(st => ({ id: st.src, url: st.src })));
    if (ranked?.order?.length) {
      pool = applyOrder(deep, st => st.src, ranked.order);
      report(`the eye read ${ranked.read}/${ranked.of} — ${ranked.mode === 'eye' ? 'ordered by feeling' : 'feeling + relevance'}`);
    }
  }
  const out: BoardFrame[] = [];
  const qs = slug(query);
  for (let i = 0; i < pool.length && out.length < want; i++) {
    report(`Downloading frame ${out.length + 1}/${want} — “${query}”`);
    const md = pool[i].src.replace('_sm.avif', '_md.avif');
    // in-page CORS fetch keeps the original AVIF bytes; canvas PNG is the retry
    let b64 = await s.fetchImageBase64(md);
    if (!b64) b64 = await s.fetchImageBase64(pool[i].src);
    if (!b64) b64 = await s.capturePng(pool[i].src);
    if (!b64) continue;
    const saved = await window.hjen.saveImageBase64({
      base64: b64, projectSlug: '_mind', subfolder: 'boards',
      fileName: `${qs}_${srcToken(pool[i].src)}`,
    });
    if (saved.ok) {
      out.push({ id: `frameset:${qs}:${srcToken(pool[i].src)}`, filePath: saved.path, source: 'frameset', title: pool[i].alt });
    }
  }
  return out;
}

/** Hunt one option's board. Serialized; session-cached per query; empty array
 *  on any failure (quota wall, offline, no results) — the caller ladders. */
export function framesetBoard(query: string, want = 4, register?: Register | null): Promise<BoardFrame[]> {
  const q = query.trim();
  if (!q) return Promise.resolve([]);
  const hit = cache.get(q);
  if (hit) return Promise.resolve(hit);
  return enqueue(async () => {
    if (starved) return [];
    const again = cache.get(q);
    if (again) return again;
    try {
      const frames = await huntOnce(q, want, register);
      if (frames.length > 0) {
        consecutiveMisses = 0;
        cache.set(q, frames);
      } else {
        consecutiveMisses += 1;
        if (consecutiveMisses >= 3 && !starved) {
          starved = true;
          report('Frameset quota likely reached — sign in once to keep the hunt');
          onStarve?.();
        }
      }
      return frames;
    } catch {
      return [];
    } finally {
      if (!starved) report('');   // strip clears when this hunt ends
    }
  });
}

const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'on', 'in', 'at', 'to', 'and', 'or', 'not', 'like', 'with', 'else', 'being', 'its', "it's", 'their', 'his', 'her']);

/** Turn an option LABEL into a search phrase — its own content words. */
export function labelQuery(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w))
    .slice(0, 4)
    .join(' ');
}

/** The representativeness ladder (Anwar: frames must represent the card, and
 *  no card goes imageless while Frameset has anything): crafted query → the
 *  option label's own words → the first two tags. Merged unique, first-wins. */
export async function framesetBoardLadder(
  option: { query: string; en: string; tags: string[]; register?: Register | null },
  want = 4,
): Promise<BoardFrame[]> {
  const tries = [
    option.query,
    labelQuery(option.en),
    option.tags.slice(0, 2).join(' '),
  ].map(q => q.trim()).filter((q, i, all) => q && all.indexOf(q) === i);

  const out: BoardFrame[] = [];
  const seen = new Set<string>();
  for (const q of tries) {
    if (out.length >= want || starved) break;
    const frames = await framesetBoard(q, want, option.register);
    for (const f of frames) {
      if (out.length >= want) break;
      if (seen.has(f.filePath)) continue;
      seen.add(f.filePath);
      out.push(f);
    }
  }
  return out;
}

/** End of session — release the background tab (Chrome itself stays). */
export async function framesetHuntClose(): Promise<void> {
  dropCdp();
}
