// لغة العرض — the ONE display-language module (house law: verified specs live
// in one module everyone imports). Governs how English-source content surfaces
// (Brief Mind nodes · Treatment · Story) appear to the user:
//
//   'en'   — the original English, untouched (the source of truth, always).
//   'ar'   — Arabic shown as the primary read; the English source stays
//            editable underneath (a translation is never the editable copy).
//   'both' — English + the Arabic line together.
//
// LAW: English is ALWAYS the source. Arabic here is a TRANSLATION of it —
// made by the `arabic-translate` task (Settings → Models picks the model),
// batched + cached so the same sentence is never paid for twice.
// Text that is already Arabic (Story beats, VO, script) passes through as-is.

import { create } from 'zustand';
import { useEffect } from 'react';
import { llmForTask } from '../models/registry';

export type LangMode = 'en' | 'ar' | 'both';

// ─── mode store (persisted in {userData}/settings.json via IPC) ─────────────

interface LangState {
  mode: LangMode;
  /** bumped whenever new translations land — subscribers re-read the cache */
  version: number;
  setMode: (m: LangMode) => void;
}

export const useLang = create<LangState>((set) => ({
  mode: 'en',
  version: 0,
  setMode: (m) => {
    set({ mode: m });
    void window.hjen.langModeSet({ mode: m }).catch(() => {});
  },
}));

async function initLangMode() {
  try {
    const r = await window.hjen.langModeGet();
    const m = r?.mode;
    if (m === 'ar' || m === 'both' || m === 'en') useLang.setState({ mode: m });
  } catch { /* stays 'en' */ }
}
if (typeof window !== 'undefined' && (window as any).hjen) void initLangMode();

// ─── language detection ──────────────────────────────────────────────────────

/** True when the text is already Arabic-dominant — no translation needed. */
export function isArabicText(t: string): boolean {
  const ar = (t.match(/[؀-ۿ]/g) || []).length;
  const latin = (t.match(/[A-Za-z]/g) || []).length;
  return ar > 0 && ar >= latin;
}

/** Worth translating at all? (has real words, isn't a bare number/token) */
function translatable(t: string): boolean {
  const s = t.trim();
  if (s.length < 2) return false;
  if (isArabicText(s)) return false;
  return /[A-Za-z]{2}/.test(s);
}

// ─── cache (localStorage, English text → Arabic) ────────────────────────────

const LS_KEY = 'hjen.translations.v1';
const CACHE_CAP = 900;                      // entries; oldest evicted first

const cache = new Map<string, string>();
try {
  const raw = localStorage.getItem(LS_KEY);
  if (raw) for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, string>)) {
    if (typeof v === 'string') cache.set(k, v);
  }
} catch { /* fresh cache */ }

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persistCache() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      while (cache.size > CACHE_CAP) cache.delete(cache.keys().next().value as string);
      localStorage.setItem(LS_KEY, JSON.stringify(Object.fromEntries(cache)));
    } catch { /* quota — cache stays in-memory */ }
  }, 800);
}

// ─── batch queue → one arabic-translate call per flush ──────────────────────

const pending = new Set<string>();
const inflight = new Set<string>();
const failedAt = new Map<string, number>();   // text → ts, 30s cooldown
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function enqueue(text: string) {
  if (cache.has(text) || inflight.has(text) || pending.has(text)) return;
  if (!translatable(text)) return;
  const f = failedAt.get(text);
  if (f && Date.now() - f < 30_000) return;
  pending.add(text);
  if (!flushTimer) flushTimer = setTimeout(() => { flushTimer = null; void flush(); }, 350);
}

const SYSTEM = [
  'أنت طبقة الترجمة داخل HJEN Studio. تترجم نصوص إنتاج إبداعي (بريفات، أفكار، معالجات إخراجية) من الإنجليزية إلى عربية فصيحة حديثة بنَفَس سعودي طبيعي.',
  'القوانين:',
  '- ترجمة أمينة للمعنى — لا إضافة، لا حذف، لا شرح.',
  '- أسماء العلامات والأماكن والمصطلحات التقنية السينمائية (35mm، OOH، KV…) تبقى كما هي.',
  '- ممنوع قوالب الذكاء الاصطناعي: «يُعتبر، يُعد، بمثابة، رحلة، شغف، لا يخفى، الجدير بالذكر».',
  '- الجُمل قصيرة حيّة تُقال بصوت عالٍ في غرفة اجتماع في الرياض.',
  'المدخل JSON: {"items": ["…", …]} — أعد فقط JSON: {"t": ["…", …]} بنفس الترتيب ونفس العدد، كل عنصر ترجمة نظيره.',
].join('\n');

function extractJson(text: string): any {
  const a = text.indexOf('{'); const b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; }
}

async function flush() {
  // char-budgeted batch so one call never overruns the token cap
  const batch: string[] = [];
  let chars = 0;
  for (const t of pending) {
    if (batch.length >= 24 || chars + t.length > 5000) break;
    batch.push(t); chars += t.length;
  }
  batch.forEach(t => { pending.delete(t); inflight.add(t); });
  if (!batch.length) return;

  try {
    const res = await llmForTask('arabic-translate', { promptId: 'arabic-translate',
      system: SYSTEM,
      prompt: JSON.stringify({ items: batch }),
      maxTokens: 6000,
    });
    const j = res.ok && res.text ? extractJson(res.text) : null;
    const out: unknown[] = Array.isArray(j?.t) ? j.t : [];
    let landed = 0;
    batch.forEach((src, i) => {
      const tr = out[i];
      if (typeof tr === 'string' && tr.trim()) { cache.set(src, tr.trim()); landed++; }
      else failedAt.set(src, Date.now());
    });
    if (landed) {
      persistCache();
      useLang.setState(s => ({ version: s.version + 1 }));
    }
  } catch {
    batch.forEach(t => failedAt.set(t, Date.now()));
  } finally {
    batch.forEach(t => inflight.delete(t));
  }
  if (pending.size && !flushTimer) flushTimer = setTimeout(() => { flushTimer = null; void flush(); }, 350);
}

// ─── the two consumer primitives ─────────────────────────────────────────────

/** Current display mode (reactive). */
export function useLangMode(): LangMode {
  return useLang(s => s.mode);
}

/**
 * The Arabic rendition of an English source text, per the current mode.
 * Returns null when: mode is 'en', the text is empty/untranslatable, the text
 * is ALREADY Arabic (nothing to add), or the translation hasn't landed yet
 * (caller keeps showing the English source — never a blank).
 */
export function useAr(text: string | null | undefined): string | null {
  const mode = useLang(s => s.mode);
  useLang(s => s.version);            // re-render when new translations land
  const t = (text ?? '').trim();
  const want = mode !== 'en' && translatable(t);
  useEffect(() => { if (want) enqueue(t); }, [t, want]);
  if (!want) return null;
  return cache.get(t) ?? null;
}

/** Non-hook lookup (for loops over many strings inside one component). */
export function arOf(text: string): string | null {
  const t = text.trim();
  if (!translatable(t)) return null;
  return cache.get(t) ?? null;
}

/** Enqueue many strings at once (component effect over a list). */
export function requestAr(texts: Array<string | null | undefined>) {
  for (const t of texts) { const s = (t ?? '').trim(); if (s) enqueue(s); }
}
