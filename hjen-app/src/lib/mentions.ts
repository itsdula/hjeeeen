// @-mention logic for the Frame / Video prompt boxes.
// Pure string functions — no React, no store. The component layer
// (MentionTextarea) owns caret state; the generation layer calls
// normalizeMentions so the model never sees a literal "@name".

export interface MentionItem {
  id: string;
  name: string;
  thumbPath: string;
}

// A "@" only starts a mention when it opens a word: start of text, or
// preceded by whitespace / opening punctuation. This kills emails and
// mid-word @s in both Latin and Arabic text.
const MENTION_PRECEDER = /[\s([{'"«»،؛]/;

// Unicode-aware "word continues" test — \b is useless for Arabic, so a
// token boundary is any char that is NOT a letter/digit/underscore.
const WORD_CHAR = /[\p{L}\p{N}_]/u;

const MAX_QUERY_LEN = 40;

/**
 * Scan back from the caret for an active "@query". selectionStart is
 * logical-order, so this needs no RTL special-casing.
 */
export function detectMention(
  value: string,
  caret: number,
): { start: number; query: string } | null {
  const upto = value.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at === -1) return null;
  if (at > 0 && !MENTION_PRECEDER.test(upto[at - 1])) return null;
  const query = upto.slice(at + 1);
  if (query.length > MAX_QUERY_LEN) return null;
  if (query.includes('\n')) return null;
  return { start: at, query };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// One matcher shared by findMentionTokens + normalizeMentions: literal
// "@" + a currently-valid name, longest name first so "@Anwar Senior"
// wins over "@Anwar", with the same boundary rules as detection.
function buildTokenRegex(names: string[]): RegExp | null {
  const cleaned = [...new Set(names.map(n => n.trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  if (cleaned.length === 0) return null;
  return new RegExp(`@(${cleaned.map(escapeRegex).join('|')})`, 'gu');
}

function isTokenAt(text: string, start: number, end: number): boolean {
  if (start > 0 && !MENTION_PRECEDER.test(text[start - 1])) return false;
  if (end < text.length && WORD_CHAR.test(text[end])) return false;
  return true;
}

/**
 * Ranges of valid @name tokens in `text` (names = currently attached
 * refs). Drives the highlight overlay — a removed ref simply stops
 * matching and its tint disappears.
 */
export function findMentionTokens(
  text: string,
  names: string[],
): Array<{ start: number; end: number }> {
  const re = buildTokenRegex(names);
  if (!re) return [];
  const out: Array<{ start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (isTokenAt(text, start, end)) out.push({ start, end });
  }
  return out;
}

/**
 * Rewrite @name tokens for the model.
 *  - 'quote' → 'name'  (frame convention — matches the quoted reference
 *    clauses buildPrompt already emits, so scene text and reference list
 *    name the same entity identically)
 *  - 'strip' → name    (video — Seedance gets plain prose)
 * Unknown @text passes through untouched (inert user text).
 */
export function normalizeMentions(
  text: string,
  names: string[],
  style: 'quote' | 'strip',
): string {
  const tokens = findMentionTokens(text, names);
  if (tokens.length === 0) return text;
  let out = '';
  let pos = 0;
  for (const t of tokens) {
    const name = text.slice(t.start + 1, t.end);
    out += text.slice(pos, t.start);
    out += style === 'quote' ? `'${name}'` : name;
    pos = t.end;
  }
  out += text.slice(pos);
  return out;
}
