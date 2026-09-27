import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { MentionItem } from '../lib/mentions';
import { detectMention, findMentionTokens } from '../lib/mentions';

// Drop-in replacement for the prompt <textarea> in the Frame dock and the
// Video promptbar. Typing "@" opens an upward menu of the currently
// attached references (thumb + name), filtered as you type; selecting one
// inserts a plain-text "@name " token. A pointer-events:none overlay ON TOP
// of the textarea tints valid tokens ember — the textarea's own glyphs stay
// the visible text, so a metric drift can only nudge a tint pill, never
// double the text. The overlay reuses the textarea's own className so
// font/padding/border metrics stay in sync with future style edits.

function fileUrl(absPath?: string): string | undefined {
  if (!absPath) return undefined;
  return `hjen-file://${encodeURI(absPath)}`;
}

interface MentionTextareaProps {
  items: MentionItem[];
  value: string;
  onChange: (next: string) => void;
  className: string;
  placeholder?: string;
  rows?: number;
  dir?: string;
}

export function MentionTextarea({
  items,
  value,
  onChange,
  className,
  placeholder,
  rows,
  dir,
}: MentionTextareaProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const hlRef = useRef<HTMLDivElement>(null);
  const activeRowRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const atRef = useRef<HTMLSpanElement>(null);

  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuPos, setMenuPos] = useState<{ left: number; bottom: number }>({ left: 0, bottom: 0 });
  const [scrollTick, setScrollTick] = useState(0);
  // Escape arms this for the token it closed on; the menu won't reopen
  // until the caret leaves that "@" position.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  const names = useMemo(
    () => items.map(i => i.name.trim()).filter(Boolean),
    [items],
  );

  const filtered = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLocaleLowerCase();
    return items.filter(i => i.name.trim() && i.name.toLocaleLowerCase().startsWith(q));
  }, [items, mention]);

  const open = !!mention && filtered.length > 0 && dismissedAt !== mention.start;

  const recompute = () => {
    const ta = taRef.current;
    if (!ta) return;
    const found = items.length > 0 ? detectMention(ta.value, ta.selectionStart ?? 0) : null;
    setMention(found);
    if (found && dismissedAt !== null && dismissedAt !== found.start) setDismissedAt(null);
    if (!found) setDismissedAt(null);
  };

  // Clamp the active row when the filter narrows.
  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(0);
  }, [filtered.length, activeIndex]);

  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const syncScroll = () => {
    if (hlRef.current && taRef.current) {
      hlRef.current.scrollTop = taRef.current.scrollTop;
      hlRef.current.scrollLeft = taRef.current.scrollLeft;
    }
    setScrollTick(t => t + 1);
  };
  useEffect(syncScroll, [value]);

  const insert = (item: MentionItem) => {
    const ta = taRef.current;
    if (!ta || !mention) return;
    const caret = ta.selectionStart ?? value.length;
    const next =
      value.slice(0, mention.start) + '@' + item.name + ' ' + value.slice(caret);
    const pos = mention.start + item.name.length + 2;
    onChange(next);
    setMention(null);
    setDismissedAt(null);
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  // Clicking inside a token selects the whole "@name" — chip-like: the
  // user never hand-selects a mention; typing or Backspace then replaces
  // or removes it atomically. A click at the token's edges still places a
  // normal caret so text can be typed right before/after it.
  const handleClick = () => {
    const ta = taRef.current;
    if (!ta) return;
    const caret = ta.selectionStart ?? 0;
    if (ta.selectionEnd !== caret) {
      recompute();
      return;
    }
    const tok = findMentionTokens(ta.value, names).find(
      t => caret > t.start && caret < t.end,
    );
    if (tok) {
      ta.setSelectionRange(tok.start, tok.end);
      setMention(null);
      return;
    }
    recompute();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => (i + 1) % filtered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => (i - 1 + filtered.length) % filtered.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      insert(filtered[activeIndex] ?? filtered[0]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setDismissedAt(mention ? mention.start : null);
    }
  };

  // Overlay segments: full value with valid tokens wrapped in tint spans.
  // While a mention is being typed, the active "@" is additionally wrapped
  // in an invisible marker span — the overlay is a metric-identical mirror
  // of the textarea (including bidi), so the marker's measured position IS
  // the @'s true visual position, and the menu anchors to it. A trailing
  // zero-width char keeps a final empty line the same height as the
  // textarea's.
  // Marker only while the menu is actually open — a stale "mention
  // context" (caret sitting after a completed token) must not strip
  // that token's tint.
  const mentionStart = open && mention ? mention.start : -1;
  const segments = useMemo(() => {
    const marker = mentionStart >= 0 ? { start: mentionStart, end: mentionStart + 1 } : null;
    const ranges: Array<{ start: number; end: number; kind: 'tok' | 'at' }> = findMentionTokens(value, names)
      .filter(t => !marker || t.end <= marker.start || t.start >= marker.end)
      .map(t => ({ ...t, kind: 'tok' as const }));
    if (marker) ranges.push({ ...marker, kind: 'at' });
    ranges.sort((a, b) => a.start - b.start);
    const out: ReactNode[] = [];
    let pos = 0;
    ranges.forEach((r, i) => {
      if (r.start > pos) out.push(value.slice(pos, r.start));
      out.push(
        r.kind === 'tok' ? (
          <span key={i} className="mention-hl__tok">
            {value.slice(r.start, r.end)}
          </span>
        ) : (
          <span key="at" ref={atRef}>
            {value.slice(r.start, r.end)}
          </span>
        ),
      );
      pos = r.end;
    });
    out.push(value.slice(pos) + '​');
    return out;
  }, [value, names, mentionStart]);

  // Anchor the menu to the active "@": open right above its line, its
  // edge aligned to the glyph. Flips to open leftward when it would
  // overflow the box (the natural direction for RTL prompts).
  useLayoutEffect(() => {
    if (!open) return;
    const at = atRef.current;
    const hl = hlRef.current;
    const menu = menuRef.current;
    if (!at || !hl || !menu) return;
    const x = at.offsetLeft - hl.scrollLeft;
    const boxW = hl.clientWidth;
    const menuW = menu.offsetWidth;
    let left = x;
    if (left + menuW > boxW) left = x - menuW + 16;
    left = Math.max(0, Math.min(left, Math.max(0, boxW - menuW)));
    const atTop = at.offsetTop - hl.scrollTop;
    const bottom = hl.clientHeight - atTop + 6;
    setMenuPos({ left, bottom });
  }, [open, segments, scrollTick]);

  return (
    <div className="mention-wrap">
      <textarea
        ref={taRef}
        className={className}
        placeholder={placeholder}
        value={value}
        rows={rows}
        dir={dir}
        onChange={e => {
          onChange(e.target.value);
          requestAnimationFrame(recompute);
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={recompute}
        onClick={handleClick}
        onScroll={syncScroll}
        onBlur={() => setMention(null)}
      />
      <div ref={hlRef} aria-hidden dir={dir} className={`${className} mention-hl`}>
        {segments}
      </div>
      {open && (
        <div
          ref={menuRef}
          className="mention-menu"
          role="menu"
          aria-label="References"
          style={{ left: menuPos.left, bottom: menuPos.bottom }}
        >
          {filtered.map((item, i) => (
            <button
              key={item.id}
              ref={i === activeIndex ? activeRowRef : undefined}
              type="button"
              role="menuitem"
              className={`mention-menu__item ${i === activeIndex ? 'mention-menu__item--active' : ''}`}
              onMouseDown={e => e.preventDefault()}
              onClick={() => insert(item)}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <img className="mention-menu__thumb" src={fileUrl(item.thumbPath)} alt="" />
              <span className="mention-menu__name" dir="auto">{item.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
