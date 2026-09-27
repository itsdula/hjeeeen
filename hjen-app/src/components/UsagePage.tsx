import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import type { GlobalGenerationEntry, EnhancementEvent, SkillRunEvent } from '../types/hjen-bridge';

function fileUrl(absPath?: string): string | undefined {
  if (!absPath) return undefined;
  return `hjen-file://${encodeURI(absPath)}`;
}

type Preset = 'today' | '7d' | '30d' | 'month' | 'all';
const PRESETS: Array<{ id: Preset; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: 'month', label: 'This month' },
  { id: 'all', label: 'All time' },
];

function isoDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultRange(): { from: string; to: string } {
  const today = new Date();
  const from = new Date(today.getTime() - 30 * 86400000);
  return { from: isoDateOnly(from), to: isoDateOnly(today) };
}

export function UsagePage() {
  const view = useStore(s => s.viewPastGeneration);
  const setActiveView = useStore(s => s.setActiveView);

  const [all, setAll] = useState<GlobalGenerationEntry[]>([]);
  const [enhanceLog, setEnhanceLog] = useState<EnhancementEvent[]>([]);
  const [skillRunLog, setSkillRunLog] = useState<SkillRunEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState(defaultRange());
  const [preset, setPreset] = useState<Preset>('30d');

  useEffect(() => {
    setLoading(true);
    Promise.all([
      window.hjen.listGenerationsLog(),
      window.hjen.listEnhancements(),
      window.hjen.listSkillRuns(),
    ]).then(([gens, enhs, skillRuns]) => {
      setAll(gens);
      setEnhanceLog(enhs);
      setSkillRunLog(skillRuns);
      setLoading(false);
    });
  }, []);

  const applyPreset = (p: Preset) => {
    setPreset(p);
    const today = new Date();
    const todayStr = isoDateOnly(today);
    if (p === 'today') setRange({ from: todayStr, to: todayStr });
    else if (p === '7d') setRange({ from: isoDateOnly(new Date(today.getTime() - 6 * 86400000)), to: todayStr });
    else if (p === '30d') setRange({ from: isoDateOnly(new Date(today.getTime() - 29 * 86400000)), to: todayStr });
    else if (p === 'month') {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      setRange({ from: isoDateOnly(first), to: todayStr });
    }
    else if (p === 'all') setRange({ from: '2020-01-01', to: todayStr });
  };

  const filtered = useMemo(() => {
    const fromMs = new Date(range.from + 'T00:00:00').getTime();
    const toMs = new Date(range.to + 'T23:59:59.999').getTime();
    return all.filter(g => g.ts >= fromMs && g.ts <= toMs);
  }, [all, range]);

  const filteredEnh = useMemo(() => {
    const fromMs = new Date(range.from + 'T00:00:00').getTime();
    const toMs = new Date(range.to + 'T23:59:59.999').getTime();
    return enhanceLog.filter(e => e.ts >= fromMs && e.ts <= toMs);
  }, [enhanceLog, range]);

  const filteredSkill = useMemo(() => {
    const fromMs = new Date(range.from + 'T00:00:00').getTime();
    const toMs = new Date(range.to + 'T23:59:59.999').getTime();
    return skillRunLog.filter(e => e.ts >= fromMs && e.ts <= toMs);
  }, [skillRunLog, range]);

  const enhanceTotals = useMemo(() => {
    let cost = 0, inputTok = 0, outputTok = 0;
    for (const e of filteredEnh) {
      cost += e.usd;
      inputTok += e.inputTokens;
      outputTok += e.outputTokens;
    }
    return { count: filteredEnh.length, cost, inputTok, outputTok };
  }, [filteredEnh]);

  const skillTotals = useMemo(() => {
    let cost = 0, inputTok = 0, outputTok = 0;
    for (const e of filteredSkill) {
      cost += e.usd;
      inputTok += e.inputTokens;
      outputTok += e.outputTokens;
    }
    return { count: filteredSkill.length, cost, inputTok, outputTok };
  }, [filteredSkill]);

  const totals = useMemo(() => {
    const t = { count: 0, imageCost: 0, durationMs: 0, knownCost: 0, knownTime: 0 };
    for (const g of filtered) {
      t.count++;
      if (g.costUsd !== undefined) { t.imageCost += g.costUsd; t.knownCost++; }
      if (g.durationMs !== undefined) { t.durationMs += g.durationMs; t.knownTime++; }
    }
    return { ...t, totalCost: t.imageCost + enhanceTotals.cost + skillTotals.cost };
  }, [filtered, enhanceTotals.cost, skillTotals.cost]);

  const byProject = useMemo(() => {
    const m = new Map<string, { name: string; count: number; cost: number; durationMs: number; enhanceCost: number; enhanceCount: number; skillCost: number; skillCount: number }>();
    const blank = (name: string) => ({ name, count: 0, cost: 0, durationMs: 0, enhanceCost: 0, enhanceCount: 0, skillCost: 0, skillCount: 0 });
    for (const g of filtered) {
      const key = g.projectSlug;
      const cur = m.get(key) ?? blank(g.projectName);
      cur.count++;
      cur.cost += g.costUsd ?? 0;
      cur.durationMs += g.durationMs ?? 0;
      m.set(key, cur);
    }
    for (const e of filteredEnh) {
      const key = e.projectSlug || '_unassigned';
      const cur = m.get(key) ?? blank(e.projectName || '(unassigned)');
      cur.enhanceCost += e.usd;
      cur.enhanceCount++;
      m.set(key, cur);
    }
    for (const e of filteredSkill) {
      const key = e.projectSlug || '_unassigned';
      const cur = m.get(key) ?? blank(e.projectName || '(unassigned)');
      cur.skillCost += e.usd;
      cur.skillCount++;
      m.set(key, cur);
    }
    return Array.from(m.values()).sort((a, b) => (b.cost + b.enhanceCost + b.skillCost) - (a.cost + a.enhanceCost + a.skillCost));
  }, [filtered, filteredEnh, filteredSkill]);

  // Merge image generations + enhancement events into a single timeline
  // so the log mirrors the user's actual session order. Each row carries
  // its `kind` so the renderer can switch columns + icon.
  const unifiedLog = useMemo(() => {
    type LogRow =
      | { kind: 'image'; ts: number; entry: GlobalGenerationEntry }
      | { kind: 'enhance'; ts: number; idx: number; entry: EnhancementEvent }
      | { kind: 'skill'; ts: number; idx: number; entry: SkillRunEvent };
    const rows: LogRow[] = [];
    for (const g of filtered) rows.push({ kind: 'image', ts: g.ts, entry: g });
    filteredEnh.forEach((e, i) => rows.push({ kind: 'enhance', ts: e.ts, idx: i, entry: e }));
    filteredSkill.forEach((e, i) => rows.push({ kind: 'skill', ts: e.ts, idx: i, entry: e }));
    rows.sort((a, b) => b.ts - a.ts);
    return rows;
  }, [filtered, filteredEnh, filteredSkill]);

  const byModel = useMemo(() => {
    const m = new Map<string, { count: number; cost: number; kind: 'image' | 'enhance' }>();
    for (const g of filtered) {
      const key = g.modelLabel ?? '(unknown)';
      const cur = m.get(key) ?? { count: 0, cost: 0, kind: 'image' as const };
      cur.count++;
      cur.cost += g.costUsd ?? 0;
      m.set(key, cur);
    }
    for (const e of filteredEnh) {
      // Claude variants land under one row so the user sees their total
      // enhancement spend separate from image generation models.
      const key = e.model;
      const cur = m.get(key) ?? { count: 0, cost: 0, kind: 'enhance' as const };
      cur.count++;
      cur.cost += e.usd;
      m.set(key, cur);
    }
    for (const e of filteredSkill) {
      // Skill runs use the same Claude model as Enhance — same key.
      const key = e.model;
      const cur = m.get(key) ?? { count: 0, cost: 0, kind: 'enhance' as const };
      cur.count++;
      cur.cost += e.usd;
      m.set(key, cur);
    }
    return Array.from(m.entries()).sort((a, b) => b[1].cost - a[1].cost);
  }, [filtered, filteredEnh, filteredSkill]);

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1 className="page__title">Usage Report</h1>
          <p className="page__subtitle mono-label">
            {loading ? 'Loading…' : `${all.length} total frame${all.length === 1 ? '' : 's'} captured`}
          </p>
        </div>
      </header>

      <section className="usage-controls">
        <div className="usage-presets">
          {PRESETS.map(p => (
            <button
              key={p.id}
              className={`usage-preset ${preset === p.id ? 'usage-preset--active' : ''}`}
              onClick={() => applyPreset(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="usage-dates">
          <label>
            <span className="mono-label">From</span>
            <input
              type="date"
              className="usage-date-input"
              value={range.from}
              onChange={e => { setRange(r => ({ ...r, from: e.target.value })); setPreset('all'); }}
            />
          </label>
          <label>
            <span className="mono-label">To</span>
            <input
              type="date"
              className="usage-date-input"
              value={range.to}
              onChange={e => { setRange(r => ({ ...r, to: e.target.value })); setPreset('all'); }}
            />
          </label>
        </div>
      </section>

      <section className="usage-totals">
        <UsageBigStat label="Frames" value={String(totals.count)} />
        <UsageBigStat
          label="Total spend (est.)"
          value={`$${totals.totalCost.toFixed(2)}`}
          accent
          sub={
            (enhanceTotals.count > 0 || skillTotals.count > 0)
              ? `Images $${totals.imageCost.toFixed(2)}`
                + (enhanceTotals.count > 0 ? ` + Enhance $${enhanceTotals.cost.toFixed(2)}` : '')
                + (skillTotals.count > 0 ? ` + Skills $${skillTotals.cost.toFixed(2)}` : '')
              : (totals.knownCost < totals.count ? `${totals.knownCost}/${totals.count} tracked` : undefined)
          }
        />
        <UsageBigStat
          label="Enhancements"
          value={String(enhanceTotals.count)}
          sub={enhanceTotals.count > 0 ? `$${enhanceTotals.cost.toFixed(3)} · ${enhanceTotals.inputTok + enhanceTotals.outputTok} tok` : '—'}
        />
        <UsageBigStat
          label="Skill runs"
          value={String(skillTotals.count)}
          sub={skillTotals.count > 0 ? `$${skillTotals.cost.toFixed(3)} · ${skillTotals.inputTok + skillTotals.outputTok} tok` : '—'}
        />
        <UsageBigStat
          label="Total time"
          value={fmtTimeLong(totals.durationMs)}
          sub={totals.knownTime < totals.count ? `${totals.knownTime}/${totals.count} tracked` : undefined}
        />
        <UsageBigStat
          label="Avg per image"
          value={totals.knownCost > 0 ? `$${(totals.imageCost / totals.knownCost).toFixed(3)}` : '—'}
        />
      </section>

      <div className="usage-grid">
        <section className="usage-card">
          <h2 className="usage-card__title mono-label">By project</h2>
          {byProject.length === 0 ? (
            <div className="usage-card__empty">No data in range.</div>
          ) : (
            <table className="usage-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th className="num">Gens</th>
                  <th className="num">Images $</th>
                  <th className="num">Enhance $</th>
                  <th className="num">Skills $</th>
                  <th className="num">Time</th>
                </tr>
              </thead>
              <tbody>
                {byProject.map(p => (
                  <tr key={p.name}>
                    <td>{p.name}</td>
                    <td className="num">{p.count}
                      {p.enhanceCount > 0 ? ` · ${p.enhanceCount}e` : ''}
                      {p.skillCount > 0 ? ` · ${p.skillCount}s` : ''}
                    </td>
                    <td className="num accent">${p.cost.toFixed(2)}</td>
                    <td className="num">{p.enhanceCost > 0 ? `$${p.enhanceCost.toFixed(3)}` : '—'}</td>
                    <td className="num">{p.skillCost > 0 ? `$${p.skillCost.toFixed(3)}` : '—'}</td>
                    <td className="num">{fmtTimeLong(p.durationMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="usage-card">
          <h2 className="usage-card__title mono-label">By model</h2>
          {byModel.length === 0 ? (
            <div className="usage-card__empty">No data in range.</div>
          ) : (
            <table className="usage-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th className="num">Gens</th>
                  <th className="num">Cost</th>
                </tr>
              </thead>
              <tbody>
                {byModel.map(([name, m]) => (
                  <tr key={name}>
                    <td>
                      {m.kind === 'enhance' && <span className="usage-kind-badge">ENHANCE</span>}
                      {name}
                    </td>
                    <td className="num">{m.count}</td>
                    <td className="num accent">${m.cost < 0.01 ? m.cost.toFixed(4) : m.cost.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="usage-card usage-card--wide">
        <h2 className="usage-card__title mono-label">Log · {unifiedLog.length} item{unifiedLog.length === 1 ? '' : 's'}</h2>
        {unifiedLog.length === 0 ? (
          <div className="usage-card__empty">Nothing in the selected range.</div>
        ) : (
          <table className="usage-table usage-log">
            <thead>
              <tr>
                <th></th>
                <th>Time</th>
                <th>Project</th>
                <th>Prompt</th>
                <th>Model</th>
                <th>Size</th>
                <th className="num">Cost</th>
                <th className="num">Duration</th>
              </tr>
            </thead>
            <tbody>
              {unifiedLog.slice(0, 200).map(row => {
                if (row.kind === 'image') return (
                  <tr key={`g-${row.entry.imgPath}`} onClick={() => { view(row.entry as any); setActiveView('frame'); }}>
                    <td>
                      <img
                        className="usage-log__thumb"
                        src={fileUrl(row.entry.thumbPath ?? row.entry.imgPath)}
                        alt=""
                        loading="lazy"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
                      />
                    </td>
                    <td className="mono">{new Date(row.entry.ts).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td>{row.entry.projectName}</td>
                    <td className="truncate">{row.entry.promptTitle}</td>
                    <td>{row.entry.modelLabel ?? '—'}</td>
                    <td className="mono">{row.entry.finalSize ?? '—'}</td>
                    <td className="num accent">{row.entry.costUsd !== undefined ? `$${row.entry.costUsd.toFixed(3)}` : '—'}</td>
                    <td className="num">{row.entry.durationMs !== undefined ? fmtTimeLong(row.entry.durationMs) : '—'}</td>
                  </tr>
                );
                if (row.kind === 'enhance') return (
                  <tr key={`e-${row.entry.ts}-${row.idx}`} className="usage-log__row--enhance">
                    <td>
                      <span className="usage-log__enhance-mark" title="Prompt enhancement">✨</span>
                    </td>
                    <td className="mono">{new Date(row.entry.ts).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td>{row.entry.projectName || '(unassigned)'}</td>
                    <td className="truncate" dir="auto">
                      <span className="usage-kind-badge">ENHANCE</span>
                      {row.entry.rawPromptExcerpt || `(${row.entry.rawPromptChars} chars)`}
                    </td>
                    <td>{row.entry.model}</td>
                    <td className="mono">{row.entry.referencesCount} ref{row.entry.referencesCount === 1 ? '' : 's'}</td>
                    <td className="num accent">${row.entry.usd.toFixed(4)}</td>
                    <td className="num mono">{row.entry.inputTokens + row.entry.outputTokens} tok</td>
                  </tr>
                );
                // kind === 'skill'
                return (
                  <tr key={`s-${row.entry.ts}-${row.idx}`} className="usage-log__row--skill">
                    <td>
                      <span className="usage-log__skill-mark" title={`Skill: ${row.entry.skillName}`}>◈</span>
                    </td>
                    <td className="mono">{new Date(row.entry.ts).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td>{row.entry.projectName || '(unassigned)'}</td>
                    <td className="truncate" dir="auto">
                      <span className="usage-kind-badge usage-kind-badge--skill">SKILL · {row.entry.skillName}</span>
                      {row.entry.rawPromptExcerpt || `(${row.entry.rawPromptChars} chars)`}
                    </td>
                    <td>{row.entry.model}</td>
                    <td className="mono">master {row.entry.masterPromptChars}c</td>
                    <td className="num accent">${row.entry.usd.toFixed(4)}</td>
                    <td className="num mono">{row.entry.inputTokens + row.entry.outputTokens} tok</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {unifiedLog.length > 200 && (
          <div className="usage-card__more">Showing newest 200 of {unifiedLog.length}. Narrow the date range to see specific items.</div>
        )}
      </section>
    </div>
  );
}

function UsageBigStat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`usage-big-stat ${accent ? 'usage-big-stat--accent' : ''}`}>
      <div className="mono-label usage-big-stat__label">{label}</div>
      <div className="usage-big-stat__value">{value}</div>
      {sub && <div className="usage-big-stat__sub mono-label">{sub}</div>}
    </div>
  );
}

function fmtTimeLong(ms: number): string {
  if (!ms) return '0s';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
