import { useEffect, useState, useCallback, useRef } from 'react';
import { useStore } from '../../../store';
import type { BriefData } from '../../../types/hjen-bridge';
import { HonestRiskField } from '../primitives/HonestRiskField';
import { RefusalsRow, DEFAULT_REFUSALS } from '../primitives/RefusalsRow';
import { SignButton } from '../primitives/SignButton';

// ─── canon ─────────────────────────────────────────────────────
// Region chips — pulled from the Saudi vocabulary memory. Multi-select.
const REGIONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'asir', label: 'Asir' },
  { id: 'jizan', label: 'Jizan' },
  { id: 'hail', label: 'Hail' },
  { id: 'najd', label: 'Najd' },
  { id: 'hijaz', label: 'Hijaz' },
  { id: 'eastern', label: 'Eastern' },
  { id: 'alula', label: 'AlUla' },
  { id: 'neom', label: 'NEOM' },
];

const MOODS: ReadonlyArray<string> = [
  'quiet', 'tender', 'heroic', 'atmospheric', 'documentary', 'editorial',
];

const PALETTES: ReadonlyArray<{ id: BriefData['paletteSignal']; label: string; hint: string }> = [
  { id: 'warm', label: 'Warm', hint: 'amber · clay · ochre' },
  { id: 'cool', label: 'Cool', hint: 'teal · slate · blue hour' },
  { id: 'colorful', label: 'Colorful', hint: 'saturated · regional' },
  { id: 'mixed', label: 'Mixed', hint: 'split or candid' },
];

const CHANNELS: ReadonlyArray<string> = ['OOH', 'Digital', 'Print', 'Social'];

const EMPTY: BriefData = {
  client: '',
  oneLine: '',
  regions: [],
  mood: '',
  paletteSignal: undefined,
  scope: { frameCount: undefined, shootDays: undefined, channels: [] },
  refusals: [...DEFAULT_REFUSALS],
  honestRisk: '',
  restatement: '',
};

/** Stage 01 — Brief Composer.
 *  Left: structured form (the spine).
 *  Right: free-text restatement (the voice).
 *  Bottom: Honest risk + Sign.
 *
 *  Persistence: on every change we debounce-write the structured fields to
 *  {projectSlug}/_project/01_brief.json. The restatement also mirrors to
 *  01_brief.md so the photographer can read it like a memo. */
export function BriefComposer() {
  const activeProjectId = useStore(s => s.activeProjectId);
  const project = useStore(s => s.activeProject());
  const stageStatus = useStore(s => s.projectState?.stages[1]?.status ?? 'draft');
  const signStage = useStore(s => s.signProjectStage);
  const unsignStage = useStore(s => s.unsignProjectStage);

  const [data, setData] = useState<BriefData>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [restating, setRestating] = useState(false);
  const [sourceText, setSourceText] = useState('');
  const [restateError, setRestateError] = useState<string | null>(null);

  // Refs to scroll-to on Sign warnings
  const oneLineRef = useRef<HTMLInputElement | null>(null);
  const refusalsRef = useRef<HTMLDivElement | null>(null);
  const riskRef = useRef<HTMLDivElement | null>(null);
  const restatementRef = useRef<HTMLTextAreaElement | null>(null);

  // Load
  useEffect(() => {
    if (!activeProjectId) return;
    setLoaded(false);
    window.hjen.readStageData({ id: activeProjectId, stage: 1 })
      .then((d: any) => {
        if (d && typeof d === 'object') {
          setData({ ...EMPTY, ...d, scope: { ...EMPTY.scope, ...(d.scope ?? {}) } });
        } else {
          setData(EMPTY);
        }
      })
      .finally(() => setLoaded(true));
  }, [activeProjectId]);

  // Debounced persistence
  const persistTimer = useRef<number | null>(null);
  const persist = useCallback((next: BriefData) => {
    if (!activeProjectId) return;
    if (persistTimer.current) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      const stamped: BriefData = { ...next, updatedAt: new Date().toISOString() };
      window.hjen.writeStageData({
        id: activeProjectId,
        stage: 1,
        data: stamped,
        markdown: renderBriefMarkdown(stamped, project?.name),
      }).catch(() => {});
    }, 350);
  }, [activeProjectId, project?.name]);

  const update = useCallback((patch: Partial<BriefData>) => {
    setData(prev => {
      const next = { ...prev, ...patch };
      persist(next);
      return next;
    });
  }, [persist]);

  const updateScope = useCallback((patch: Partial<NonNullable<BriefData['scope']>>) => {
    setData(prev => {
      const next: BriefData = { ...prev, scope: { ...(prev.scope ?? {}), ...patch } };
      persist(next);
      return next;
    });
  }, [persist]);

  const toggleRegion = (id: string) => {
    const cur = data.regions ?? [];
    update({ regions: cur.includes(id) ? cur.filter(r => r !== id) : [...cur, id] });
  };

  const toggleChannel = (c: string) => {
    const cur = data.scope?.channels ?? [];
    updateScope({ channels: cur.includes(c) ? cur.filter(x => x !== c) : [...cur, c] });
  };

  // AI Restate — wraps the source text in a Brief-specific instruction and
  // routes through the existing enhancePrompt IPC. Per plan: the result fills
  // the free-text restatement only. Structured fields stay manual — we don't
  // let Claude invent fields it can't see in the source.
  const handleRestate = async () => {
    if (!sourceText.trim()) {
      setRestateError('Paste the source brief above first.');
      return;
    }
    setRestating(true);
    setRestateError(null);
    try {
      const instruction = [
        'You are restating a creative brief in the voice of a working Saudi commercial photographer.',
        '',
        'Source the user pasted:',
        sourceText.trim(),
        '',
        'Instructions:',
        '- 2-3 short paragraphs.',
        '- Saudi novelist register: calm, specific, slightly imperfect, novelistic.',
        '- Use one concrete cultural-truth noun if and only if it appears in the source.',
        '- DO NOT invent dates, talent, locations, brands, or numbers that are not in the source.',
        '- Banned openers: "في عالم اليوم", "نحو مستقبل أفضل", "تجربة لا تُنسى", "أصالة وحداثة", "بلمسة سعودية", "نحكي قصصاً".',
        '- End with a single line beginning "Honest risk:" naming the real weakness.',
        '- Return only the restatement prose.',
      ].join('\n');

      const res = await window.hjen.enhancePrompt({
        rawPrompt: instruction,
        references: [],
        projectId: activeProjectId ?? null,
        projectSlug: project?.slug ?? null,
        projectName: project?.name ?? null,
      });
      if (!res.ok) {
        setRestateError(res.message);
        return;
      }
      update({ restatement: res.enhancedPrompt });
    } finally {
      setRestating(false);
    }
  };

  // Warnings surfaced in the Sign dialog (advisory, never blocking)
  const warnings = collectBriefWarnings(data, {
    oneLine: () => oneLineRef.current?.focus(),
    refusals: () => refusalsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    risk: () => riskRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    restatement: () => restatementRef.current?.focus(),
  });

  if (!loaded) {
    return <div className="brief-loading mono-label">Loading brief…</div>;
  }

  return (
    <div className="brief">
      <div className="brief__grid">

        {/* ── LEFT: structured form ───────────────────────────── */}
        <section className="brief__form">

          <Field label="Client / agency (optional)">
            <input
              className="brief__input"
              type="text"
              value={data.client ?? ''}
              onChange={e => update({ client: e.target.value })}
              placeholder="Saudia · NEOM · SAR · Visit Saudi…"
            />
          </Field>

          <Field label="One-line intent" hint="The campaign on a phone at 7pm, in one sentence.">
            <input
              ref={oneLineRef}
              className="brief__input brief__input--lg"
              type="text"
              value={data.oneLine ?? ''}
              onChange={e => update({ oneLine: e.target.value })}
              placeholder="e.g. The quiet, composed dignity of a Saudi family arriving somewhere they trust."
            />
          </Field>

          <Field label="Region anchor" hint="Which Saudis the campaign answers to. Multi-select.">
            <div className="brief__chips">
              {REGIONS.map(r => {
                const on = data.regions?.includes(r.id);
                return (
                  <button
                    key={r.id}
                    className={`brief__chip ${on ? 'is-on' : ''}`}
                    onClick={() => toggleRegion(r.id)}
                    type="button"
                  >{r.label}</button>
                );
              })}
            </div>
          </Field>

          <div className="brief__row">
            <Field label="Mood register" hint="One. Set the temperature.">
              <div className="brief__chips">
                {MOODS.map(m => (
                  <button
                    key={m}
                    className={`brief__chip ${data.mood === m ? 'is-on' : ''}`}
                    onClick={() => update({ mood: data.mood === m ? '' : m })}
                    type="button"
                  >{m}</button>
                ))}
              </div>
            </Field>

            <Field label="Palette signal" hint="Forces colour diversification later.">
              <div className="brief__chips">
                {PALETTES.map(p => (
                  <button
                    key={p.id}
                    className={`brief__chip brief__chip--palette ${data.paletteSignal === p.id ? 'is-on' : ''}`}
                    onClick={() => update({ paletteSignal: data.paletteSignal === p.id ? undefined : p.id })}
                    type="button"
                    title={p.hint}
                  >{p.label}<small>{p.hint}</small></button>
                ))}
              </div>
            </Field>
          </div>

          <Field label="Scope">
            <div className="brief__scope">
              <label className="brief__scope-cell">
                <span className="mono-label">Frame count</span>
                <input
                  className="brief__input brief__input--num"
                  type="number"
                  min={1}
                  value={data.scope?.frameCount ?? ''}
                  onChange={e => updateScope({ frameCount: e.target.value ? Number(e.target.value) : undefined })}
                  placeholder="40"
                />
              </label>
              <label className="brief__scope-cell">
                <span className="mono-label">Shoot days</span>
                <input
                  className="brief__input brief__input--num"
                  type="number"
                  min={1}
                  value={data.scope?.shootDays ?? ''}
                  onChange={e => updateScope({ shootDays: e.target.value ? Number(e.target.value) : undefined })}
                  placeholder="2"
                />
              </label>
              <div className="brief__scope-cell brief__scope-cell--wide">
                <span className="mono-label">Hero channels</span>
                <div className="brief__chips">
                  {CHANNELS.map(c => (
                    <button
                      key={c}
                      className={`brief__chip ${data.scope?.channels?.includes(c) ? 'is-on' : ''}`}
                      onClick={() => toggleChannel(c)}
                      type="button"
                    >{c}</button>
                  ))}
                </div>
              </div>
            </div>
          </Field>

          <div ref={refusalsRef}>
            <RefusalsRow
              refusals={data.refusals ?? []}
              onChange={r => update({ refusals: r })}
            />
          </div>

          <div ref={riskRef}>
            <HonestRiskField
              value={data.honestRisk ?? ''}
              onChange={v => update({ honestRisk: v })}
            />
          </div>

        </section>

        {/* ── RIGHT: source + restatement ─────────────────────── */}
        <section className="brief__voice">

          <details className="brief__source" open={!data.restatement?.trim()}>
            <summary className="brief__source-summary">
              <span className="mono-label">Optional · Source brief</span>
              <small>Paste the deck text, the email, the call notes. Used by Restate.</small>
            </summary>
            <textarea
              className="brief__source-input"
              placeholder="Paste anything the client sent. The Restate button below uses this to draft a Saudi-novelist restatement — it will not invent details that aren't here."
              value={sourceText}
              onChange={e => setSourceText(e.target.value)}
              rows={6}
            />
            <div className="brief__source-actions">
              <button
                className="brief__restate"
                disabled={restating || !sourceText.trim()}
                onClick={handleRestate}
              >
                {restating ? 'Restating…' : 'Restate the brief'}
              </button>
              {restateError && <span className="brief__source-err">{restateError}</span>}
            </div>
          </details>

          <Field label="Restatement" hint="Two or three paragraphs in your voice. If you can't restate it, you don't understand it.">
            <textarea
              ref={restatementRef}
              className="brief__restatement"
              value={data.restatement ?? ''}
              onChange={e => update({ restatement: e.target.value })}
              placeholder="The campaign, in your words. A grandfather, his son, his grandson — three Riyadhs in one inherited gesture…"
              rows={14}
            />
            <div className="brief__wordcount mono-label">
              {(data.restatement ?? '').trim().split(/\s+/).filter(Boolean).length} words
            </div>
          </Field>

        </section>
      </div>

      {/* ── Sign row ─────────────────────────────────────────── */}
      <footer className="brief__foot">
        <div className="brief__foot-meta mono-label">
          {data.updatedAt && <span>last saved {new Date(data.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
        </div>
        <SignButton
          status={stageStatus}
          warnings={warnings}
          onSign={() => signStage(1)}
          onUnsign={() => unsignStage(1)}
          label="Sign the brief"
        />
      </footer>
    </div>
  );
}

// ─── helpers ───────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="brief__field">
      <div className="brief__field-head">
        <label className="brief__field-label mono-label">{label}</label>
        {hint && <span className="brief__field-hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

interface JumpHandlers {
  oneLine: () => void;
  refusals: () => void;
  risk: () => void;
  restatement: () => void;
}

function collectBriefWarnings(d: BriefData, jumps: JumpHandlers) {
  const w: Array<{ body: string; onJump?: () => void }> = [];
  if (!d.oneLine?.trim()) w.push({ body: 'One-line intent is empty.', onJump: jumps.oneLine });
  if (!d.regions || d.regions.length === 0) w.push({ body: 'No region anchor selected.' });
  if (!d.mood) w.push({ body: 'No mood register chosen.' });
  if (!d.paletteSignal) w.push({ body: 'No palette signal — colour diversification can\'t be enforced downstream.' });
  if (!d.refusals || d.refusals.filter(r => r.trim()).length < 3) w.push({ body: 'Fewer than three refusals listed.', onJump: jumps.refusals });
  if (!d.honestRisk?.trim()) w.push({ body: 'Honest risk is unfilled.', onJump: jumps.risk });
  if (!d.restatement?.trim()) w.push({ body: 'Restatement is empty — the brief isn\'t in your voice yet.', onJump: jumps.restatement });

  // Banned phrases scan (from copywrite memory)
  const banned = ['في عالم اليوم', 'نحو مستقبل أفضل', 'تجربة لا تُنسى', 'أصالة وحداثة', 'بلمسة سعودية', 'نحكي قصصاً'];
  const text = `${d.oneLine ?? ''} ${d.restatement ?? ''}`;
  const hit = banned.find(b => text.includes(b));
  if (hit) w.push({ body: `Banned phrase detected: "${hit}".`, onJump: jumps.restatement });

  return w;
}

function renderBriefMarkdown(d: BriefData, projectName?: string): string {
  const lines: string[] = [];
  lines.push(`# Brief — ${projectName ?? 'Untitled'}`);
  lines.push('');
  if (d.client) lines.push(`**Client:** ${d.client}  `);
  if (d.oneLine) lines.push(`**Intent:** ${d.oneLine}  `);
  if (d.regions?.length) lines.push(`**Region:** ${d.regions.join(' · ')}  `);
  if (d.mood) lines.push(`**Mood:** ${d.mood}  `);
  if (d.paletteSignal) lines.push(`**Palette:** ${d.paletteSignal}  `);
  const scope: string[] = [];
  if (d.scope?.frameCount) scope.push(`${d.scope.frameCount} frames`);
  if (d.scope?.shootDays) scope.push(`${d.scope.shootDays} shoot days`);
  if (d.scope?.channels?.length) scope.push(d.scope.channels.join(' / '));
  if (scope.length) lines.push(`**Scope:** ${scope.join(' · ')}  `);
  lines.push('');
  if (d.refusals?.length) {
    lines.push('## Refusals');
    for (const r of d.refusals.filter(x => x.trim())) lines.push(`- ${r}`);
    lines.push('');
  }
  if (d.restatement?.trim()) {
    lines.push('## Restatement');
    lines.push(d.restatement.trim());
    lines.push('');
  }
  if (d.honestRisk?.trim()) {
    lines.push(`**Honest risk:** ${d.honestRisk.trim()}`);
  }
  return lines.join('\n');
}
