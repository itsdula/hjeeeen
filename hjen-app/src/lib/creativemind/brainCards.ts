// الدماغ الثاني — طبقة الالتقاط (Phase A).
//
// كل BREAKDOWN مكتمل يودع دروسه تلقائياً في ذاكرة عابرة للمشاريع
// (`{projectsRoot}/_mind/braincards.json`). نتائج الـBREAKDOWN (BreakdownElement:
// claim/dimension/tags/weight) شبه-بطاقات DNA أصلاً — فالتحويل مُطابِق لا اختراع.
//
// دورة أنور 6C's: هذا هو عضوا Capture + Crystallize. القانون المتكرر عبر عدة
// إعلانات (نايك+أبل) يندمج في بطاقة واحدة يرتفع وزنها ويتراكم مصدرها — جوهر
// التراكم (compounding). القراءة الأمامية (حقن المصادم/الشوتلست) = Phase C.
//
// هذا الملف نقي بقدر المستطاع: يلمس window.hjen فقط في load/save.

import type { AdBreakdown, BreakdownElement } from './breakdown';
import { matchAxisSlug } from '../breakdown/axes';

// ─── البطاقة ─────────────────────────────────────────────────────────────────

export interface BrainCardSource {
  breakdownId: string;
  slug: string;
  adTitle: string;
  brand: string;
  axisKey: string;        // البُعد المصدر داخل الـBREAKDOWN (canonical axis slug)
  elementId: string;      // معرّف الـfinding الأصلي — لمنع العدّ المزدوج
}

export interface BrainCard {
  id: string;             // 'bc-<key>' مستقر بالمحتوى (يمكّن الدمج العابر)
  dimension: string;      // أحد الأبعاد الـ18 (أفضل تطابق) — لتجميع الاسترجاع
  axisKey: string;        // البُعد المصدر (canonical axis slug)
  genre?: string;         // النوع/عالم البراند — لاسترجاع مُصنَّف
  brand?: string;         // البراند الأساسي (أول مصدر)
  tags: string[];
  en: string;             // الدرس (denormalized — ينجو من حذف الـbreakdown)
  ar?: string;
  howHjenMakesIt?: string;
  framePaths: string[];   // شواهد بصرية (best-effort)
  sources: BrainCardSource[];  // يتراكم عبر الإعلانات
  baseWeight: number;     // أعلى وزن finding أصلي (2 افتراضاً، 3 = قانون)
  weight: number;         // الوزن الفعّال = baseWeight + (عدد الإعلانات المتميزة − 1)، مسقوف 6
  addedAt: string;
  updatedAt: string;
}

// ─── خرائط ثابتة ─────────────────────────────────────────────────────────────

// محور الـBREAKDOWN (canonical slug) → أحد الأبعاد الـ18 للـcompiler.
// خشِن عمداً: البُعد للتجميع، وaxisKey يحفظ المصدر الحقيقي.
const AXIS_TO_DIM: Record<string, string> = {
  visuals: 'camera',
  wardrobe: 'wardrobe',
  characters: 'faces',
  action: 'performance',
  theme_look: 'era',
  cinematography: 'camera',
  grading_color: 'lighting',
  edit: 'editing',
  story: 'narrative',
  brief: 'narrative',
  message: 'brand',
  sound: 'sound',
  art_location: 'places',
};

const VALID_DIMS = new Set([
  'wardrobe', 'dialect', 'places', 'heritage', 'faces', 'era', 'narrative',
  'comedy', 'arabic_text', 'dialogue', 'performance', 'camera', 'lighting',
  'sound', 'editing', 'social', 'occasions', 'brand',
]);

// ─── وسم النوع (heuristic نقي — يُنقَّح لاحقاً) ───────────────────────────────

const GENRE_RULES: Array<[RegExp, string]> = [
  [/nike|adidas|puma|reebok|under ?armour|sport|athlet|\brun\b|football|soccer|gym|fitness|marathon/i, 'athletic'],
  [/luxur|chanel|dior|gucci|louis|vuitton|perfume|fragrance|jewel|watch|couture/i, 'luxury'],
  [/apple|samsung|sony|tech|phone|device|\bai\b|software|\bapp\b|laptop|gadget/i, 'tech'],
  [/\bcar\b|auto|toyota|\bbmw\b|mercedes|hyundai|nissan|drive|vehicle|suv/i, 'automotive'],
  [/food|snack|drink|cola|pepsi|coffee|restaurant|taste|meal|chocolate|burger/i, 'food-beverage'],
  [/bank|\bstc\b|telecom|mobily|zain|insurance|finance|\bpay\b|wallet/i, 'telecom-finance'],
];

function guessGenre(bd: AdBreakdown): string | undefined {
  const hay = [
    bd.ad?.brand, bd.ad?.logline_en, bd.ad?.logline_ar,
    bd.pipeline?.brief?.proposition, bd.pipeline?.brief?.bigIdea?.insight,
  ].filter(Boolean).join(' ');
  for (const [re, g] of GENRE_RULES) if (re.test(hay)) return g;
  return undefined;
}

// ─── التحويل ─────────────────────────────────────────────────────────────────

const norm = (s: string): string =>
  (s || '').toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, ' ').trim();

/** مفتاح الهوية للدمج العابر: البُعد + توقيع نصّي للدرس. */
function cardKey(dimension: string, en: string): string {
  const sig = norm(en).slice(0, 90).replace(/\s+/g, '-');
  return `${dimension}::${sig}`;
}

function frameFiles(bd: AdBreakdown, frameIds: string[]): string[] {
  if (!frameIds?.length) return [];
  const byId = new Map(bd.frames.map(f => [f.id, f.file]));
  return frameIds.map(id => byId.get(id) ?? '').filter(Boolean);
}

/** حوّل breakdown مكتمل → بطاقات دماغ. يلتقط القوانين والأنماط القوية فقط
 *  (weight ≥ 2؛ الوزن غير المحدَّد = 2، والـflavor الصريح weight===1 يُسقَط). */
export function breakdownToCards(bd: AdBreakdown): BrainCard[] {
  if (!bd?.axes?.length) return [];
  const brand = bd.ad?.brand || '';
  const genre = guessGenre(bd);
  const now = new Date().toISOString();
  const out: BrainCard[] = [];

  for (const axis of bd.axes) {
    const canonical = matchAxisSlug(axis.key) || matchAxisSlug(axis.title_en) || String(axis.key || '');
    const axisDim = AXIS_TO_DIM[canonical] || 'narrative';
    for (const f of axis.findings || []) {
      const w = f.weight ?? 2;
      if (w < 2) continue;                          // flavor يُسقَط
      const en = (f.claim_en || '').trim();
      if (!en) continue;
      const dimension = (f.dimension && VALID_DIMS.has(f.dimension)) ? f.dimension : axisDim;
      const source: BrainCardSource = {
        breakdownId: bd.id, slug: bd.slug, adTitle: bd.ad?.title || bd.slug,
        brand, axisKey: canonical, elementId: f.id,
      };
      out.push({
        id: `bc-${cardKey(dimension, en)}`,
        dimension, axisKey: canonical, genre, brand,
        tags: uniq([...(f.tags || []), brand, genre].filter(Boolean) as string[]),
        en,
        ar: f.claim_ar?.trim() || undefined,
        howHjenMakesIt: f.howHjenMakesIt?.trim() || undefined,
        framePaths: frameFiles(bd, f.frameIds),
        sources: [source],
        baseWeight: w,
        weight: w,
        addedAt: now, updatedAt: now,
      });
    }
  }
  return out;
}

// ─── الدمج العابر (compounding) ──────────────────────────────────────────────

function uniq<T>(a: T[]): T[] { return Array.from(new Set(a)); }

function effectiveWeight(baseWeight: number, sources: BrainCardSource[]): number {
  const distinctAds = new Set(sources.map(s => s.slug)).size;
  return Math.min(6, baseWeight + Math.max(0, distinctAds - 1));
}

export interface MergeResult { cards: BrainCard[]; added: number; merged: number; }

/** ادمج بطاقات جديدة في الموجودة. نفس المفتاح عبر إعلانين → بطاقة واحدة يرتفع
 *  وزنها ويتراكم مصدرها. إعادة نفس الإعلان (backfill) idempotent — تُدَدَب
 *  المصادر بـ(slug+elementId) فلا تضخّم الوزن. */
export function mergeBrainCards(existing: BrainCard[], incoming: BrainCard[]): MergeResult {
  const byId = new Map<string, BrainCard>();
  for (const c of existing) byId.set(c.id, c);
  let added = 0, merged = 0;

  for (const inc of incoming) {
    const cur = byId.get(inc.id);
    if (!cur) { byId.set(inc.id, { ...inc }); added++; continue; }
    const srcKey = (s: BrainCardSource) => `${s.slug}::${s.elementId}`;
    const seen = new Set(cur.sources.map(srcKey));
    let changed = false;
    for (const s of inc.sources) {
      if (!seen.has(srcKey(s))) { cur.sources.push(s); seen.add(srcKey(s)); changed = true; }
    }
    // أثرِ الحقول من الوارد إن كانت أغنى
    if (inc.ar && !cur.ar) { cur.ar = inc.ar; changed = true; }
    if (inc.howHjenMakesIt && !cur.howHjenMakesIt) { cur.howHjenMakesIt = inc.howHjenMakesIt; changed = true; }
    if (inc.framePaths?.length && !cur.framePaths?.length) { cur.framePaths = inc.framePaths; changed = true; }
    const tags = uniq([...cur.tags, ...inc.tags]);
    if (tags.length !== cur.tags.length) { cur.tags = tags; changed = true; }
    cur.baseWeight = Math.max(cur.baseWeight, inc.baseWeight);
    const w = effectiveWeight(cur.baseWeight, cur.sources);
    if (w !== cur.weight) { cur.weight = w; changed = true; }
    if (changed) { cur.updatedAt = new Date().toISOString(); merged++; }
  }
  return { cards: Array.from(byId.values()), added, merged };
}

// ─── load / save (يلمسان window.hjen) ────────────────────────────────────────

export async function loadBrainCards(): Promise<BrainCard[]> {
  try {
    const res = await window.hjen.mindBraincardsRead();
    return res?.ok ? (res.cards as BrainCard[]) : [];
  } catch { return []; }
}

export async function saveBrainCards(cards: BrainCard[]): Promise<void> {
  try { await window.hjen.mindBraincardsWrite({ cards }); } catch { /* next capture retries */ }
}

export interface CaptureResult { added: number; merged: number; total: number; }

/** الالتقاط التلقائي: breakdown → بطاقات → دمج في الذاكرة → حفظ.
 *  best-effort — لا يُفشِل تشغيل الـbreakdown أبداً. */
export async function captureBreakdownToBrain(bd: AdBreakdown): Promise<CaptureResult> {
  const incoming = breakdownToCards(bd);
  if (!incoming.length) return { added: 0, merged: 0, total: 0 };
  const existing = await loadBrainCards();
  const { cards, added, merged } = mergeBrainCards(existing, incoming);
  if (added || merged) await saveBrainCards(cards);
  return { added, merged, total: cards.length };
}
