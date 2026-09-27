// Brief Mind — عقل البريف. Standalone stage-1 tool: raw client brief →
// analyzed brief (species / gaps / proposition / persona) → Saudi-DNA card
// brainstorm → ≥10 collisions → kill-gate → 3 territories + 1 Big Idea.
//
// Shares stage-1 data with BriefComposer: EMPTY carries the composer's
// defaults for shared fields so a merge never wipes the composer's work.
// Domain source: STUDY/creative_pipeline/00_THE_COUNCIL.md §١+§٢ and
// _synthesis/B_brainstorm.md + C_creative_brief.md.

import { useMemo, useRef, useState } from 'react';
import '../../styles/preprod-brief.css';
import { useStore } from '../../store';
import type { BriefTerritory } from '../../types/preprod';
import { PreprodShell, usePreprodProject, useStageData, Field, Busy, useToast } from './shared';
import { ArText } from './ArText';
import { useLangMode } from '../../lib/lang/translate';
import { ALL_CARDS } from '../../lib/compiler';
import type { KnowledgeCard } from '../../lib/compiler';
import {
  type MindData, EMPTY_MIND, SPECIES_LABEL, SPECIES_LABEL_AR, MACHINES, MACHINE_LABEL,
  sentenceCount, bannedHit, asList, drawSeedCards, renderMindMarkdown,
  runAnalyze, runCollide, runPress, entityId,
} from '../../lib/creativemind/engine';
import type { BriefCollision } from '../../types/preprod';
import { openMindCanvas } from '../../lib/mindcanvas/actions';
import { syncStagesToCreativeGraph } from '../../lib/creativegraph/stageSync';

const EMPTY = EMPTY_MIND;

const ACCENT = '#0563E9';

// LLM systems + helpers + response shapes now live in lib/creativemind/engine.ts
// (shared with the Creative Mind's immersive stage — one brain, two surfaces).

// ─── the view ────────────────────────────────────────────────────────────────

export function BriefMindView() {
  const { project } = usePreprodProject();
  const addLedger = useStore(s => s.addLedgerEntry);
  const { data, loaded, update, saveNow } = useStageData<MindData>(1, EMPTY);
  const [toast, showToast] = useToast();
  const langMode = useLangMode();

  const [analyzing, setAnalyzing] = useState(false);
  const [colliding, setColliding] = useState(false);
  const [pressing, setPressing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [costUsd, setCostUsd] = useState<number | null>(null);

  const propositionRef = useRef<HTMLInputElement | null>(null);
  const colliderRef = useRef<HTMLDivElement | null>(null);
  const territoriesRef = useRef<HTMLDivElement | null>(null);

  const cardById = useMemo(() => new Map(ALL_CARDS.map(c => [c.id, c])), []);
  const drawnCards = (data.drawnCardIds ?? [])
    .map(id => cardById.get(id))
    .filter((c): c is KnowledgeCard => !!c);
  const collisions = data.collisions ?? [];
  const keptCount = collisions.filter(c => c.kept).length;
  const territories = data.territories ?? [];

  const addCost = (usd?: number) => {
    if (typeof usd === 'number' && usd > 0) setCostUsd(prev => (prev ?? 0) + usd);
  };

  // ── load the raw brief from a file (instead of pasting) ──
  const handleLoadBriefFile = async () => {
    const res = await window.hjen.pickTextDocument?.({ title: 'Load client brief from file' });
    if (!res) return;
    if (res.unsupported || !res.text.trim()) {
      setError(`Can't read "${res.name}" as text — export it to .txt / .md / .rtf, or paste it below.`);
      return;
    }
    setError(null);
    const prev = (data.rawBrief ?? '').trim();
    const next = prev ? `${prev}\n\n${res.text}` : res.text;
    update({ rawBrief: next });
    showToast(`Loaded "${res.name}" — read it once for what's printed, once for what's not.`);
  };

  // ── stage 1: analyze ──
  const handleAnalyze = async () => {
    const raw = (data.rawBrief ?? '').trim();
    if (!raw || analyzing) return;
    setAnalyzing(true);
    setError(null);
    const res = await runAnalyze(raw);
    setAnalyzing(false);
    if (!res.ok) { setError(res.message); return; }
    addCost(res.usd);
    const j = res.json;
    const species = (['strategy', 'project-management', 'production-task'] as const)
      .find(s => s === j.species);
    const gaps = asList(j.gaps);
    update({
      species,
      proposition: (j.proposition ?? '').trim(),
      persona: (j.persona ?? '').trim(),
      gaps,
      questionsLog: asList(j.questionsLog),
      restatement: (j.restatement ?? '').trim() || data.restatement,
    });
    void addLedger({ kind: 'note', body: `Brief Mind: brief analyzed — ${species ?? 'unclassified'}, ${gaps.length} gaps flagged.` });
    showToast('Brief analyzed — gaps and proposition on the table.');
  };

  // ── stage 2: draw seeds ──
  const handleDraw = () => {
    const seedText = `${data.proposition ?? ''} ${data.rawBrief ?? ''}`.trim();
    const cards = drawSeedCards(seedText);
    update({ drawnCardIds: cards.map(c => c.id) });
    showToast(`${cards.length} cards drawn — boring is good.`);
  };

  const handleReroll = (idx: number) => {
    const drawn = data.drawnCardIds ?? [];
    const pool = ALL_CARDS.filter(c => !c.always && !drawn.includes(c.id));
    if (pool.length === 0) return;
    const next = [...drawn];
    next[idx] = pool[Math.floor(Math.random() * pool.length)].id;
    update({ drawnCardIds: next });
  };

  // ── stage 3: collide ──
  const handleCollide = async () => {
    if (drawnCards.length === 0 || colliding) return;
    setColliding(true);
    setError(null);
    const res = await runCollide({
      proposition: data.proposition ?? '',
      persona: data.persona ?? '',
      cards: drawnCards.map(c => ({ id: c.id, dimension: c.dimension, ar: c.ar, en: c.en })),
    });
    setColliding(false);
    if (!res.ok) { setError(res.message); return; }
    addCost(res.usd);
    const list: BriefCollision[] = (res.json.collisions ?? [])
      .map(c => ({
        id: entityId('col'),
        seed: String(c.seed ?? '').trim() || 'unseeded',
        machine: MACHINES.find(m => m === c.machine) ?? 'collision',
        idea: String(c.idea ?? '').trim(),
        kept: false,
      }))
      .filter(c => c.idea);
    if (list.length === 0) { setError('The collider came back empty — try again.'); return; }
    update({ collisions: list });
    void addLedger({ kind: 'note', body: `Brief Mind: ${list.length} collisions logged — kill-gate open.` });
    showToast(`${list.length} collisions on the table — now kill.`);
  };

  const toggleKeep = (idx: number) => {
    const next = collisions.map((c, i) => i === idx ? { ...c, kept: !c.kept } : c);
    update({ collisions: next });
  };

  // ── stage 4: press into territories ──
  const handlePress = async () => {
    if (keptCount === 0 || pressing) return;
    setPressing(true);
    setError(null);
    const res = await runPress({
      proposition: data.proposition ?? '',
      persona: data.persona ?? '',
      survivors: collisions.filter(c => c.kept).map(({ seed, machine, idea }) => ({ seed, machine, idea })),
    });
    setPressing(false);
    if (!res.ok) { setError(res.message); return; }
    addCost(res.usd);
    const terrs: BriefTerritory[] = (res.json.territories ?? []).slice(0, 3).map(t => ({
      id: entityId('ter'),
      name: String(t.name ?? '').trim(),
      hook: String(t.hook ?? '').trim(),
      insight: String(t.insight ?? '').trim(),
      firstFrameHint: String(t.firstFrameHint ?? '').trim(),
      culturalTruth: String(t.culturalTruth ?? '').trim(),
    })).filter(t => t.name);
    if (terrs.length === 0) { setError('No territories survived the press — kill-gate again, then retry.'); return; }
    const big = res.json.bigIdea;
    const bigTerritory = String(big?.territory ?? '').trim();
    const bigIdea = terrs.some(t => t.name === bigTerritory)
      ? { territory: bigTerritory, why: String(big?.why ?? '').trim() }
      : { territory: terrs[0].name, why: String(big?.why ?? '').trim() };
    update({ territories: terrs, bigIdea });
    void addLedger({ kind: 'note', body: `Brief Mind: ${terrs.length} territories pressed — big idea "${bigIdea.territory}".` });
    showToast('Territories on the table — pick the Big Idea.');
  };

  const patchTerritory = (idx: number, patch: Partial<BriefTerritory>) => {
    const prev = territories[idx];
    if (!prev) return;
    const list = territories.map((t, i) => i === idx ? { ...t, ...patch } : t);
    const extra: Partial<MindData> = { territories: list };
    if (patch.name !== undefined && data.bigIdea?.territory === prev.name) {
      extra.bigIdea = { territory: patch.name, why: data.bigIdea?.why ?? '' };
    }
    update(extra);
  };

  const pickBigIdea = (name: string) => {
    update({ bigIdea: { territory: name, why: data.bigIdea?.why ?? '' } });
  };

  // ── sign warnings (soft — SignButton via the shell) ──
  const banned = bannedHit(data.proposition, data.restatement);
  const propSentences = sentenceCount(data.proposition ?? '');
  const warnings: Array<{ body: string; onJump?: () => void }> = [];
  if (!data.proposition?.trim()) warnings.push({ body: 'Proposition is empty — nothing to sell out loud yet.', onJump: () => propositionRef.current?.focus() });
  if (!data.persona?.trim()) warnings.push({ body: 'Persona is empty — the brief is aimed at nobody.' });
  if (collisions.length < 10) warnings.push({ body: `Only ${collisions.length} collisions logged — the daily quota is 10.`, onJump: () => colliderRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) });
  if (territories.length < 3) warnings.push({ body: `Only ${territories.length} territories — the press outputs three.`, onJump: () => territoriesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) });
  if (!data.bigIdea?.territory?.trim()) warnings.push({ body: 'No Big Idea picked — three territories, one recommendation.', onJump: () => territoriesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) });
  if (banned) warnings.push({ body: `Banned phrase detected: "${banned}".`, onJump: () => propositionRef.current?.focus() });

  const beforeSign = async () => {
    await saveNow(renderMindMarkdown(data, project?.name));
    if (project?.id) await syncStagesToCreativeGraph(project.id);
  };

  return (
    <PreprodShell
      tool="Brief Mind"
      sub="Raw brief → gaps → one Big Idea"
      accent={ACCENT}
      stage={1}
      signWarnings={warnings}
      beforeSign={beforeSign}
      actions={
        <button
          className="pp-btn pp-btn--ghost ppb-canvasbtn"
          onClick={() => void openMindCanvas()}
          title="Open the same thinking on an infinite canvas — every thought a block"
        >Canvas view <span className="ppb-canvasbtn__ar">· لوحة التفكير</span></button>
      }
    >
      {!loaded ? (
        <div className="pp-gate"><Busy label="Reading stage 01…" /></div>
      ) : (
        <>
          <div className="pp-grid">

            {/* ── ASIDE: raw brief in, analysis out ─────────────────── */}
            <aside className="pp-aside">
              <Field label="Raw brief" hint="As it arrived — no cleanup · paste or upload">
                <div className="ppb-raw__load">
                  <button
                    className="pp-btn pp-btn--ghost"
                    onClick={() => void handleLoadBriefFile()}
                    title="Load the client brief from a file (.txt / .md / .rtf / .fountain)"
                  >↑ Upload brief file</button>
                </div>
                <textarea
                  className="pp-textarea pp-textarea--ar ppb-raw"
                  value={data.rawBrief ?? ''}
                  onChange={e => update({ rawBrief: e.target.value })}
                  placeholder="Paste the brief as it arrived — the email, the call notes, the deck text. What it leaves unsaid is more dangerous than what it says."
                />
              </Field>

              <div className="ppb-aside__actions">
                <button
                  className="pp-btn pp-btn--accent"
                  disabled={analyzing || !(data.rawBrief ?? '').trim()}
                  onClick={() => void handleAnalyze()}
                >Analyze the brief</button>
                {analyzing && <Busy label="Compressing the truth…" />}
              </div>

              {costUsd != null && (
                <div className="ppb-cost mono-label">LLM cost — ${costUsd.toFixed(4)}</div>
              )}

              {(data.species || (data.gaps ?? []).length > 0 || (data.questionsLog ?? []).length > 0) && (
                <div className="ppb-analysis">
                  {data.species && (
                    <div className="ppb-analysis__block">
                      <div className="mono-label ppb-analysis__label">Species</div>
                      <div className="ppb-species-row">
                        <span className="ppb-species mono-label">{SPECIES_LABEL[data.species]}</span>
                        {langMode !== 'en' && (
                          <span className="ppb-species__ar" dir="rtl">{SPECIES_LABEL_AR[data.species]}</span>
                        )}
                      </div>
                    </div>
                  )}
                  {(data.gaps ?? []).length > 0 && (
                    <div className="ppb-analysis__block">
                      <div className="mono-label ppb-analysis__label">Gaps — client-ready questions</div>
                      <ul className="ppb-list">
                        {(data.gaps ?? []).map((g, i) => (
                          <li key={i}>{g}<ArText text={g} className="ppb-inline-ar" /></li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {(data.questionsLog ?? []).length > 0 && (
                    <div className="ppb-analysis__block">
                      <div className="mono-label ppb-analysis__label">Questions log</div>
                      <ul className="ppb-list ppb-list--dim">
                        {(data.questionsLog ?? []).map((q, i) => <li key={i}>{q}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </aside>

            {/* ── MAIN: compression → seeds → collider → territories ── */}
            <main className="pp-main">
              {error && <div className="pp-error">{error}</div>}

              {/* 1 · THE COMPRESSION */}
              <section className="pp-panel">
                <div className="pp-panel__head">
                  <h3 className="pp-panel__title">THE COMPRESSION</h3>
                  <span className="ppb-panel__sub">One promise, one human</span>
                </div>

                <Field label="Proposition" hint="One sentence a stranger could sell out loud in any room">
                  <input
                    ref={propositionRef}
                    className="pp-input pp-input--ar"
                    value={data.proposition ?? ''}
                    onChange={e => update({ proposition: e.target.value })}
                    placeholder="One sentence. Longer than a sentence is not a proposition."
                  />
                  <ArText text={data.proposition} />
                  {propSentences > 1 && (
                    <div className="ppb-warn">More than one sentence — not a proposition yet.</div>
                  )}
                </Field>

                <Field label="Persona" hint="One named human you can see — not a segment">
                  <textarea
                    className="pp-textarea pp-textarea--ar"
                    value={data.persona ?? ''}
                    onChange={e => update({ persona: e.target.value })}
                    placeholder="Name, age, city, one concrete daily behavior, one thing they mock. 'Saudis 25–40' is rejected."
                  />
                  <ArText text={data.persona} />
                </Field>

                <Field label="Restatement" hint="Long–short–long rhythm · end on the heavy word">
                  <textarea
                    className="pp-textarea pp-textarea--ar ppb-restate"
                    value={data.restatement ?? ''}
                    onChange={e => update({ restatement: e.target.value })}
                    placeholder="The brief in your own words — if you can't say it, you haven't understood it."
                  />
                  <ArText text={data.restatement} />
                  {banned && (
                    <div className="ppb-warn">Banned phrase: «{banned}» — stock Arabic bounces the brief.</div>
                  )}
                </Field>
              </section>

              {/* 2 · SEEDS */}
              <section className="pp-panel">
                <div className="pp-panel__head">
                  <h3 className="pp-panel__title">SEEDS</h3>
                  <span className="ppb-panel__sub">Boring is good</span>
                  <div className="pp-panel__spacer" />
                  <button className="pp-btn" onClick={handleDraw}>Draw cards</button>
                </div>

                {drawnCards.length === 0 ? (
                  <p className="ppb-empty">Draw 4–6 Saudi-DNA cards — each card is a pre-captured seed: a concrete daily behavior, not a spectacle.</p>
                ) : (
                  <div className="ppb-seeds">
                    {drawnCards.map((c, i) => (
                      <div key={c.id} className="ppb-seed">
                        <div className="ppb-seed__head">
                          <span className="ppb-seed__dim mono-label">{c.dimension}</span>
                          <button
                            className="ppb-seed__reroll"
                            title="Re-draw this card"
                            onClick={() => handleReroll(i)}
                          >⟲</button>
                        </div>
                        <div className="ppb-seed__ar">{c.ar}</div>
                        <div className="ppb-seed__id mono-label">{c.id}</div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* 3 · THE COLLIDER */}
              <section className="pp-panel" ref={colliderRef}>
                <div className="pp-panel__head">
                  <h3 className="pp-panel__title">THE COLLIDER</h3>
                  <span className="ppb-panel__sub">The collision machines — the brainstorm</span>
                  <div className="pp-panel__spacer" />
                  {colliding && <Busy label="Running the machines…" />}
                  <button
                    className="pp-btn pp-btn--accent"
                    disabled={colliding || drawnCards.length === 0}
                    onClick={() => void handleCollide()}
                  >Collide ×10</button>
                </div>
                <p className="ppb-designline">Most of it will be awful — that is the design.</p>

                {collisions.length > 0 && (
                  <>
                    <div className="ppb-killcount mono-label">{keptCount} kept / {collisions.length} logged</div>
                    <div className="ppb-cols">
                      {collisions.map((c, i) => (
                        <div key={i} className={`ppb-col ${c.kept ? 'is-kept' : ''}`}>
                          <span className="ppb-col__machine mono-label">{MACHINE_LABEL[c.machine]}</span>
                          <div className="ppb-col__body">
                            <div className="ppb-col__idea">{c.idea}</div>
                            <ArText text={c.idea} className="ppb-inline-ar" />
                            <div className="ppb-col__seed mono-label">{c.seed}</div>
                          </div>
                          <button
                            className={`ppb-keep mono-label ${c.kept ? 'is-on' : ''}`}
                            onClick={() => toggleKeep(i)}
                          >{c.kept ? 'KEPT' : 'KEEP'}</button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </section>

              {/* 4 · TERRITORIES + BIG IDEA */}
              <section className="pp-panel" ref={territoriesRef}>
                <div className="pp-panel__head">
                  <h3 className="pp-panel__title">TERRITORIES + BIG IDEA</h3>
                  <span className="ppb-panel__sub">Kill-gate, then press — three directions, one call</span>
                  <div className="pp-panel__spacer" />
                  {pressing && <Busy label="Kill-gate, then press…" />}
                  <button
                    className="pp-btn pp-btn--accent"
                    disabled={pressing || keptCount === 0}
                    onClick={() => void handlePress()}
                  >Press into territories</button>
                </div>
                {keptCount === 0 && territories.length === 0 && (
                  <p className="ppb-empty">Keep at least one collision above — the press only takes survivors.</p>
                )}

                {territories.length > 0 && (
                  <>
                    <div className="pp-cards ppb-terrs">
                      {territories.map((t, i) => {
                        const isBig = data.bigIdea?.territory === t.name && !!t.name.trim();
                        return (
                          <div key={i} className={`pp-card ppb-terr ${isBig ? 'is-big' : ''}`}>
                            <span className="pp-card__accentbar" />
                            <input
                              className="pp-input pp-input--ar ppb-terr__name"
                              value={t.name}
                              onChange={e => patchTerritory(i, { name: e.target.value })}
                              placeholder="Territory name"
                            />
                            <ArText text={t.name} />
                            <label className="ppb-terr__field mono-label">Hook · the one line said in a majlis</label>
                            <input
                              className="pp-input pp-input--ar"
                              value={t.hook}
                              onChange={e => patchTerritory(i, { hook: e.target.value })}
                            />
                            <ArText text={t.hook} />
                            <label className="ppb-terr__field mono-label">Insight</label>
                            <textarea
                              className="pp-textarea pp-textarea--ar ppb-terr__ta"
                              value={t.insight}
                              onChange={e => patchTerritory(i, { insight: e.target.value })}
                            />
                            <ArText text={t.insight} />
                            <label className="ppb-terr__field mono-label">First frame hint</label>
                            <textarea
                              className="pp-textarea pp-textarea--ar ppb-terr__ta"
                              value={t.firstFrameHint}
                              onChange={e => patchTerritory(i, { firstFrameHint: e.target.value })}
                            />
                            <label className="ppb-terr__field mono-label">Cultural truth · name / place / year / gesture</label>
                            <input
                              className="pp-input pp-input--ar"
                              value={t.culturalTruth}
                              onChange={e => patchTerritory(i, { culturalTruth: e.target.value })}
                            />
                            <label className="ppb-terr__pick">
                              <input
                                type="radio"
                                name="ppb-bigidea"
                                checked={isBig}
                                onChange={() => pickBigIdea(t.name)}
                              />
                              <span className="mono-label">Big Idea</span>
                            </label>
                          </div>
                        );
                      })}
                    </div>

                    <Field label="Why this one" hint="The recommendation in two lines">
                      <textarea
                        className="pp-textarea pp-textarea--ar"
                        value={data.bigIdea?.why ?? ''}
                        onChange={e => update({ bigIdea: { territory: data.bigIdea?.territory ?? '', why: e.target.value } })}
                        placeholder="Why this territory holds forty frames and thirty seconds at once."
                      />
                    </Field>
                  </>
                )}
              </section>
            </main>
          </div>

          {toast && <div className="pp-toast">{toast}</div>}
        </>
      )}
    </PreprodShell>
  );
}
