import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { DiscModel } from '../../lib/breakdown/discModel';
import { hjenFileUrl } from '../../lib/theme/apply';

// The disc's inner ring — the reversed HJEN pipeline (7 stages, read backwards).
export type StageKey = 'dnas' | 'pitch' | 'shotlist' | 'treatment' | 'references' | 'story' | 'beats' | 'brief';
export const STAGES: { key: StageKey; label: string }[] = [
  { key: 'dnas', label: 'DNAS' },
  { key: 'pitch', label: 'PITCH' },
  { key: 'shotlist', label: 'SHOTLIST' },
  { key: 'treatment', label: 'TREATMENT' },
  { key: 'references', label: 'REFERENCES' },
  { key: 'story', label: 'STORY' },
  { key: 'beats', label: 'BEATS' },
  { key: 'brief', label: 'BRIEF' },
];

const CX = 500, CY = 500;
const rad = (d: number) => (d - 90) * Math.PI / 180;
const pt = (r: number, a: number) => [CX + r * Math.cos(rad(a)), CY + r * Math.sin(rad(a))] as const;

function arcPath(r0: number, r1: number, a0: number, a1: number): string {
  const large = a1 - a0 > 180 ? 1 : 0;
  const [x0, y0] = pt(r1, a0), [x1, y1] = pt(r1, a1), [x2, y2] = pt(r0, a1), [x3, y3] = pt(r0, a0);
  return `M${x0},${y0} A${r1},${r1} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${r0},${r0} 0 ${large} 0 ${x3},${y3} Z`;
}

/** Split an English label into ≤13-char lines to fit inside a segment. */
function wrap(label: string): string[] {
  const words = label.split(/\s+/), out: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > 13) { if (cur) out.push(cur); cur = w; }
    else cur = (cur + ' ' + w).trim();
  }
  if (cur) out.push(cur);
  return out;
}

interface Props {
  model: DiscModel;
  ad: { title: string; brand: string; year?: string };
  onAxis: (index: number) => void;
  onStage: (key: StageKey) => void;
  onHub: () => void;
}

export function BreakdownDisc({ model, ad, onAxis, onStage, onHub }: Props) {
  // ── hub crossfade through the beat spine ──
  const cycle = model.cycleFrameIds;
  const [bi, setBi] = useState(0);
  const [frontA, setFrontA] = useState(true);   // which of the two <image> layers is visible
  const timer = useRef<number | null>(null);
  useEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || cycle.length < 2) return;
    timer.current = window.setInterval(() => {
      setBi(i => (i + 1) % cycle.length);
      setFrontA(f => !f);
    }, 3600);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [cycle.length]);

  const hubUrl = (idx: number): string | undefined => {
    const id = cycle[((idx % cycle.length) + cycle.length) % cycle.length];
    const f = id ? model.frames.get(id) : undefined;
    return f ? hjenFileUrl(f.file) : undefined;
  };
  const urlA = hubUrl(frontA ? bi : bi - 1);
  const urlB = hubUrl(frontA ? bi - 1 : bi);

  // ── outer ring — 13 axes ──
  const AX_R0 = 274, AX_R1 = 398, GAP = 1.5;
  const axStep = 360 / model.axes.length;
  const axisSegs = useMemo(() => model.axes.map((ax, i) => {
    const a0 = i * axStep + GAP / 2, a1 = (i + 1) * axStep - GAP / 2, mid = (a0 + a1) / 2;
    const [lx, ly] = pt(336, mid);
    const lines = wrap(ax.en.toUpperCase());
    const lh = 20, start = -((lines.length - 1) * lh) / 2 - 2;
    return { i, ax, d: arcPath(AX_R0, AX_R1, a0, a1), lx, ly, lines, lh, start };
  }), [model.axes, axStep]);

  // ── inner ring — 7 stages ──
  const P_R0 = 206, P_R1 = 258, POFF = 30;
  const pStep = 360 / STAGES.length;
  const stageSegs = useMemo(() => STAGES.map((st, i) => {
    const a0 = i * pStep + GAP / 2 + POFF, a1 = (i + 1) * pStep - GAP / 2 + POFF, mid = (a0 + a1) / 2;
    const [lx, ly] = pt((P_R0 + P_R1) / 2, mid);
    return { i, st, d: arcPath(P_R0, P_R1, a0, a1), lx, ly };
  }), [pStep]);

  const HUB_R = 194;
  const key = (fn: () => void) => (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
  };

  return (
    <svg className="bd-wheel" viewBox="0 0 1000 1000" role="group" aria-label={`${ad.brand} — ${ad.title} breakdown disc`}>
      <defs>
        <clipPath id="bdHubClip"><circle cx={CX} cy={CY} r={HUB_R} /></clipPath>
        <radialGradient id="bdHubShade">
          <stop offset="0%" stopColor="var(--midnight)" stopOpacity="0.15" />
          <stop offset="70%" stopColor="var(--midnight)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="var(--midnight)" stopOpacity="0.9" />
        </radialGradient>
      </defs>

      {/* outer ring */}
      {axisSegs.map(({ i, ax, d, lx, ly, lines, lh, start }) => (
        <g key={ax.slug} className={`bd-seg${ax.present ? '' : ' is-pending'}`} tabIndex={0} role="button"
          aria-label={`${ax.en} — ${ax.present ? `${ax.findings.length} findings` : 'pending'}`}
          onClick={() => onAxis(i)} onKeyDown={key(() => onAxis(i))}>
          <path className="arc" d={d} />
          <text x={lx} y={ly} textAnchor="middle">
            {lines.map((l, li) => <tspan key={li} x={lx} dy={li === 0 ? start : lh}>{l}</tspan>)}
            <tspan className="cnt" x={lx} dy={lh + 2}>{ax.present ? `${ax.findings.length} FINDINGS` : 'PENDING'}</tspan>
          </text>
        </g>
      ))}

      {/* inner ring */}
      {stageSegs.map(({ st, d, lx, ly }) => (
        <g key={st.key} className="bd-seg bd-pseg" tabIndex={0} role="button" aria-label={st.label}
          onClick={() => onStage(st.key)} onKeyDown={key(() => onStage(st.key))}>
          <path className="arc" d={d} />
          <text x={lx} y={ly + 5} textAnchor="middle">{st.label}</text>
        </g>
      ))}

      {/* hub */}
      <g className="bd-hub" tabIndex={0} role="button" aria-label={`${ad.title} — the film`}
        onClick={onHub} onKeyDown={key(onHub)}>
        {urlB && <image className="bd-hub-img" href={urlB} x={CX - HUB_R * 1.78} y={CY - HUB_R}
          width={HUB_R * 3.56} height={HUB_R * 2} clipPath="url(#bdHubClip)" preserveAspectRatio="xMidYMid slice" opacity={1} />}
        {urlA && <image className="bd-hub-img" href={urlA} x={CX - HUB_R * 1.78} y={CY - HUB_R}
          width={HUB_R * 3.56} height={HUB_R * 2} clipPath="url(#bdHubClip)" preserveAspectRatio="xMidYMid slice" opacity={1} />}
        <circle cx={CX} cy={CY} r={HUB_R} fill="url(#bdHubShade)" clipPath="url(#bdHubClip)" />
        <circle className="bd-hub-ring" cx={CX} cy={CY} r={HUB_R + 5} />
        {/* Compact identity caption only — the film's cycling frame reads cleanly
            underneath. The long ad title now lives as a typographic block UNDER
            the disc (see BreakdownView → .bd-disc-title), not across the image. */}
        <text className="bd-hub-sub" x={CX} y={CY - 6} textAnchor="middle">
          {(ad.brand || '').toUpperCase()}{ad.year ? ` · ${ad.year}` : ''}
        </text>
        <text className="bd-hub-line" x={CX} y={CY + 20} textAnchor="middle">MADE BY HJEN — REVERSE-READ</text>
      </g>
    </svg>
  );
}
