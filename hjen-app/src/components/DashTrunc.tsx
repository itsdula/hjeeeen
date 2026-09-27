import { useEffect, useRef, useState } from 'react';

/**
 * Single-line text that, when too wide for its parent, hides the overflow
 * and shows a trailing " — " (em-dash with spaces) instead of the default
 * "…" ellipsis. Hover reveals the full text via the native `title` tooltip.
 *
 * Browser support note: Chromium does not implement `text-overflow: <string>`
 * yet, so we detect overflow via ResizeObserver in JS and conditionally
 * render the suffix. Cheap (one observer per node, no layout thrashing).
 */
export function DashTrunc({ children, className }: { children: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOverflow(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children]);

  return (
    <span className={`dash-trunc ${className || ''}`} title={children}>
      <span ref={ref} className="dash-trunc__text">{children}</span>
      {overflow && <span className="dash-trunc__suffix"> — </span>}
    </span>
  );
}
