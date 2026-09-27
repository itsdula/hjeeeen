// Context Trainer — يضيف/يهذّب البطاقات ويدرس إعلاناً جديداً. The library-curation
// page of the Context Agents engine. The engine is still under development, so
// the library must GROW from inside the app: this page reads and writes the
// live method cards (methods/*.json) and studies a new ad into the corpus.
//
// Two sections:
//   · Methods — the card list + an editor panel (all writes go through the
//     validated MAIN handlers: caWriteCard verifies predicates + writes
//     atomically; caDeleteCard removes).
//   · Study a new ad — adId + profile + a YouTube URL or a plain description →
//     caStudy spawns the lab pipeline; progress streams over onCaStudyProgress.
//
// House law: this page never composes prompts or scores — it edits the source
// files the server-side recipe reads. Arabic content register per convention.

import { useEffect, useMemo, useState } from 'react';
import '../../styles/contextagents.css';
import { useStore } from '../../store';
import type { CACard, CAVocab, CAPredicate, CAProfileSummary } from '../../types/hjen-bridge';
import { listMethods, readCard, writeCard, deleteCard, listProfiles, vocab as loadVocab, study } from '../../lib/contextagents/engine';

type AxisKey = keyof CAPredicate;   // 'register' | 'beat' | 'energy'

/** The old ui-server labelOf, recomputed client-side: universal if its evidence
 *  spans ≥2 registers, genre if it names exactly one, tentative if it names none. */
function labelOf(card: CACard): { key: 'universal' | 'genre' | 'tentative'; en: string } {
  const regs = card.when_it_works?.register ?? [];
  if (regs.length >= 2) return { key: 'universal', en: 'universal' };
  if (regs.length === 1) return { key: 'genre', en: 'genre' };
  return { key: 'tentative', en: 'tentative' };
}

const BLANK_CARD: CACard = {
  id: '', craft: '', principle: '', effect: '',
  when_it_works: {}, when_it_fails: {}, weight: 1,
};

// ── multi-select chip group bound to one predicate axis ─────────────────────

function AxisChips({ label, ar, options, selected, onToggle }: {
  label: string; ar: string; options: string[]; selected: string[]; onToggle: (v: string) => void;
}) {
  return (
    <div className="cat-axis">
      <span className="cat-axis__label mono-label">{label} · {ar}</span>
      <div className="cat-axis__chips">
        {options.map(o => (
          <button
            key={o}
            type="button"
            className={`cat-chip${selected.includes(o) ? ' is-on' : ''}`}
            onClick={() => onToggle(o)}
            aria-pressed={selected.includes(o)}
          >{o}</button>
        ))}
      </div>
    </div>
  );
}

// ── the card editor panel ────────────────────────────────────────────────────

function CardEditor({ card, vocab, onSaved, onDeleted, onClose }: {
  card: CACard; vocab: CAVocab | null;
  onSaved: () => void; onDeleted: () => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState<CACard>(card);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setDraft(card); setErr(null); }, [card]);

  const isNew = !card.id;

  const set = (patch: Partial<CACard>) => setDraft(d => ({ ...d, ...patch }));

  const works = (draft.when_it_works ?? {}) as CAPredicate;
  // when_it_fails may be a single predicate or an array — edit the first predicate.
  const failsSrc = Array.isArray(draft.when_it_fails) ? (draft.when_it_fails[0] ?? {}) : (draft.when_it_fails ?? {});
  const fails = failsSrc as CAPredicate;

  const toggleAxis = (bag: 'when_it_works' | 'when_it_fails', axis: AxisKey, v: string) => {
    const cur = bag === 'when_it_works' ? works : fails;
    const list = cur[axis] ?? [];
    const next = list.includes(v) ? list.filter(x => x !== v) : [...list, v];
    if (bag === 'when_it_works') set({ when_it_works: { ...works, [axis]: next } });
    else set({ when_it_fails: { ...fails, [axis]: next } });
  };

  const axisOpts = (axis: AxisKey): string[] =>
    axis === 'register' ? (vocab?.registers ?? []) : axis === 'beat' ? (vocab?.beats ?? []) : (vocab?.energies ?? []);

  const save = async () => {
    setBusy(true); setErr(null);
    const id = (draft.id || draft.craft || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const toWrite: CACard = { ...draft, id };
    const r = await writeCard(toWrite);
    setBusy(false);
    if (r.ok) onSaved();
    else setErr(r.message || 'Write failed.');
  };

  const remove = async () => {
    if (!card.id) { onClose(); return; }
    setBusy(true);
    const r = await deleteCard(card.id);
    setBusy(false);
    if (r.ok) onDeleted();
    else setErr(r.message || 'Delete failed.');
  };

  const canSave = draft.craft.trim().length > 0 && !busy;

  return (
    <aside className="cat-editor">
      <div className="cat-editor__head">
        <span className="mono-label">{isNew ? 'New method · بطاقة جديدة' : 'Edit method · تهذيب'}</span>
        <button className="ca-btn ca-btn--ghost cat-editor__close" onClick={onClose}>Close</button>
      </div>

      <label className="ca-field">
        <span className="ca-field__label mono-label">Craft · اسم الطريقة</span>
        <input className="ca-input" value={draft.craft} dir="auto"
          onChange={e => set({ craft: e.target.value })} placeholder="e.g. delayed reveal" />
      </label>
      <label className="ca-field">
        <span className="ca-field__label mono-label">Principle · المبدأ (ما هي)</span>
        <textarea className="ca-textarea" rows={2} dir="auto" value={draft.principle}
          onChange={e => set({ principle: e.target.value })} />
      </label>
      <label className="ca-field">
        <span className="ca-field__label mono-label">Effect · الأثر (ما تفعله)</span>
        <textarea className="ca-textarea" rows={2} dir="auto" value={draft.effect}
          onChange={e => set({ effect: e.target.value })} />
      </label>

      <div className="cat-preds">
        <div className="cat-preds__col">
          <span className="cat-preds__title mono-label">When it works · متى تنجح</span>
          {(['register', 'beat', 'energy'] as AxisKey[]).map(axis => (
            <AxisChips key={axis}
              label={axis} ar={axis === 'register' ? 'الإحساس' : axis === 'beat' ? 'الموضع' : 'الطاقة'}
              options={axisOpts(axis)} selected={works[axis] ?? []}
              onToggle={v => toggleAxis('when_it_works', axis, v)} />
          ))}
        </div>
        <div className="cat-preds__col">
          <span className="cat-preds__title mono-label">When it fails · متى تفشل</span>
          {(['register', 'beat', 'energy'] as AxisKey[]).map(axis => (
            <AxisChips key={axis}
              label={axis} ar={axis === 'register' ? 'الإحساس' : axis === 'beat' ? 'الموضع' : 'الطاقة'}
              options={axisOpts(axis)} selected={fails[axis] ?? []}
              onToggle={v => toggleAxis('when_it_fails', axis, v)} />
          ))}
        </div>
      </div>

      <label className="ca-field cat-weight">
        <span className="ca-field__label mono-label">Weight · الوزن ({(draft.weight ?? 1).toFixed(1)})</span>
        <input type="range" min={0} max={3} step={0.1} value={draft.weight ?? 1}
          onChange={e => set({ weight: Number(e.target.value) })} />
      </label>

      {err && <div className="cat-editor__err" role="alert">{err}</div>}

      <div className="cat-editor__actions">
        <button className="ca-btn ca-btn--primary" onClick={() => void save()} disabled={!canSave}>
          {busy ? 'Saving…' : 'Save · احفظ'}
        </button>
        {!isNew && (
          <button className="ca-btn ca-btn--danger" onClick={() => void remove()} disabled={busy}>
            Delete · احذف
          </button>
        )}
      </div>
    </aside>
  );
}

// ── study a new ad ───────────────────────────────────────────────────────────

function StudyPanel({ profiles, onDone }: { profiles: CAProfileSummary[]; onDone: () => void }) {
  const [adId, setAdId] = useState('');
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? '');
  const [source, setSource] = useState('');
  const [description, setDescription] = useState('');
  const [lang, setLang] = useState<'auto' | 'ar' | 'en'>('auto');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [report, setReport] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (!profileId && profiles[0]) setProfileId(profiles[0].id); }, [profiles, profileId]);

  // stream pipeline progress
  useEffect(() => {
    const off = window.hjen.onCaStudyProgress?.(d => setLog(l => [...l.slice(-40), d.line]));
    return () => { off?.(); };
  }, []);

  const isUrl = /^https?:\/\//i.test(source.trim());
  const canRun = adId.trim().length > 0 && !!profileId && (isUrl || description.trim().length > 0) && !busy;

  const run = async () => {
    setBusy(true); setErr(null); setReport(null); setLog([]);
    const r = await study({
      adId: adId.trim(),
      profileId,
      videoPathOrUrl: isUrl ? source.trim() : undefined,
      description: !isUrl && description.trim() ? description.trim() : undefined,
      lang: lang === 'auto' ? undefined : lang,
    });
    setBusy(false);
    if (r.ok) {
      setReport(`${r.report}${r.newCards?.length ? `\n\nNew / reinforced cards: ${r.newCards.join(', ')}` : ''}`);
      onDone();
    } else {
      setErr(r.message || 'Study failed.');
    }
  };

  return (
    <section className="cat-study">
      <header className="cat-study__head">
        <h2 className="cat-h">Study a new ad · ادرس إعلاناً</h2>
        <p className="cat-sub" dir="rtl">إعلان جديد يُدرَّس ويُدمج في مكتبة الطرق — رابط أو وصف مكتوب.</p>
      </header>
      <div className="cat-study__grid">
        <label className="ca-field">
          <span className="ca-field__label mono-label">Ad id · معرّف الإعلان</span>
          <input className="ca-input" value={adId} onChange={e => setAdId(e.target.value)} placeholder="e.g. HJC-0107" />
        </label>
        <label className="ca-field">
          <span className="ca-field__label mono-label">DNA profile · البروفايل</span>
          <select className="ca-select" value={profileId} onChange={e => setProfileId(e.target.value)}>
            {profiles.length === 0 && <option value="">—</option>}
            {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="ca-field">
          <span className="ca-field__label mono-label">Language · اللغة</span>
          <select className="ca-select" value={lang} onChange={e => setLang(e.target.value as any)}>
            <option value="auto">Auto</option>
            <option value="ar">Arabic</option>
            <option value="en">English</option>
          </select>
        </label>
      </div>
      <label className="ca-field ca-field--wide">
        <span className="ca-field__label mono-label">YouTube URL · رابط (or leave blank and describe below)</span>
        <input className="ca-input" value={source} dir="ltr"
          onChange={e => setSource(e.target.value)} placeholder="https://…" />
      </label>
      <label className="ca-field ca-field--wide">
        <span className="ca-field__label mono-label">Or a written description · وصف مكتوب</span>
        <textarea className="ca-textarea" rows={4} dir="auto" value={description}
          disabled={isUrl}
          onChange={e => setDescription(e.target.value)}
          placeholder="صف الإعلان لقطة لقطة — يُستخدم لو ما فيه رابط" />
      </label>

      <div className="cat-study__actions">
        <button className="ca-btn ca-btn--primary" onClick={() => void run()} disabled={!canRun}>
          {busy ? 'Studying…' : 'Study · ادرس'}
        </button>
      </div>

      {(busy || log.length > 0) && (
        <pre className="cat-log selectable" aria-live="polite">{log.join('\n') || 'Starting…'}</pre>
      )}
      {report && <pre className="cat-report selectable">{report}</pre>}
      {err && <div className="cat-editor__err" role="alert">{err}</div>}
    </section>
  );
}

// ── root ─────────────────────────────────────────────────────────────────────

export function ContextTrainer() {
  const setActiveView = useStore(s => s.setActiveView);
  const [cards, setCards] = useState<CACard[]>([]);
  const [vocab, setVocab] = useState<CAVocab | null>(null);
  const [profiles, setProfiles] = useState<CAProfileSummary[]>([]);
  const [editing, setEditing] = useState<CACard | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  const refresh = async () => {
    const [m, p] = await Promise.all([listMethods(), listProfiles()]);
    setCards(m);
    setProfiles(p);
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
    void loadVocab().then(setVocab).catch(() => undefined);
  }, []);

  const openCard = async (id: string) => {
    const r = await readCard(id);
    if (r.ok) setEditing(r.card);
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const sorted = [...cards].sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1) || a.craft.localeCompare(b.craft));
    if (!needle) return sorted;
    return sorted.filter(c =>
      `${c.craft} ${c.principle} ${c.effect}`.toLowerCase().includes(needle));
  }, [cards, q]);

  return (
    <div className="ca cat">
      <div className="ca-top drag-region">
        <button className="ca-back no-drag" onClick={() => setActiveView('ca-studio')}>‹ Studio</button>
        <div className="ca-brand no-drag">
          <span className="ca-brand__dot" />
          <span className="ca-brand__ar" dir="auto">مدرّب السياق</span>
          <span className="ca-brand__en mono-label">Context Trainer</span>
        </div>
        <span className="ca-top__spacer" />
        <span className="cat-count mono-label no-drag">{cards.length} methods</span>
      </div>

      <div className="ca-scroll cat-scroll">
        {/* methods list + editor */}
        <section className="cat-methods">
          <header className="cat-methods__head">
            <h2 className="cat-h">Methods · الطرق</h2>
            <input className="ca-input cat-search" value={q} onChange={e => setQ(e.target.value)}
              placeholder="Search craft / effect…" />
            <button className="ca-btn ca-btn--primary" onClick={() => setEditing({ ...BLANK_CARD })}>
              + New · جديدة
            </button>
          </header>

          <div className="cat-layout">
            <div className="cat-list" role="list">
              {loading && <div className="cat-empty mono-label">Loading the library…</div>}
              {!loading && filtered.length === 0 && (
                <div className="cat-empty">
                  <span className="mono-label">No methods yet</span>
                  <span dir="rtl">ابدأ بإضافة بطاقة أو دراسة إعلان.</span>
                </div>
              )}
              {filtered.map(c => {
                const lbl = labelOf(c);
                const active = editing?.id === c.id && !!c.id;
                return (
                  <button key={c.id} role="listitem"
                    className={`cat-row${active ? ' is-active' : ''}`}
                    onClick={() => void openCard(c.id)}>
                    <span className="cat-row__craft" dir="auto">{c.craft}</span>
                    <span className="cat-row__principle" dir="auto">{c.principle}</span>
                    <span className="cat-row__meta">
                      <span className={`cat-tag cat-tag--${lbl.key}`}>{lbl.en}</span>
                      <span className="cat-row__weight mono-label">{(c.weight ?? 1).toFixed(1)}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {editing
              ? <CardEditor
                  card={editing}
                  vocab={vocab}
                  onClose={() => setEditing(null)}
                  onSaved={() => { setEditing(null); void refresh(); }}
                  onDeleted={() => { setEditing(null); void refresh(); }}
                />
              : <div className="cat-editor cat-editor--empty">
                  <span className="mono-label">Pick a method to edit</span>
                  <span dir="rtl">اختر بطاقة لتهذيبها، أو أضِف جديدة.</span>
                </div>}
          </div>
        </section>

        {/* study a new ad */}
        <StudyPanel profiles={profiles} onDone={() => void refresh()} />
      </div>
    </div>
  );
}
