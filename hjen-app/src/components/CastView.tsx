import { useEffect, useState } from 'react';
import { useStore } from '../store';
import type { CharacterCard, LibraryAsset } from '../types/hjen-bridge';
import {
  ATTRS, ALL_KEYS, PLATFORMS, buildData, fillTemplate, profileText,
  readProfileFromPhotos, characterPrompt, type Profile,
} from '../lib/castSchema';
import { readCreativeProjection, traceProjectionUse, type ProjectionRead } from '../lib/creativegraph/consumer';
import type { CastProjection } from '../lib/creativegraph/technicalCompiler';
import '../styles/cast.css';

function fileUrl(absPath?: string | null): string | undefined {
  if (!absPath) return undefined;
  return `hjen-file://${encodeURI(absPath)}`;
}

interface WorkCard {
  photos: string[];      // all uploaded photos; photos[mainIndex] is the portrait
  mainIndex: number;
  values: Profile;
  confidence: Record<string, number>;
  flagged: string[];
}
const EMPTY: WorkCard = { photos: [], mainIndex: 0, values: {}, confidence: {}, flagged: [] };
const LS_KEY = 'hjen_cast_work';

type Phase = 'idle' | 'reading' | 'ready' | 'error';

function downloadBlob(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
function safeName(values: Profile): string {
  return (values.name || 'character').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}
function loadWork(): WorkCard {
  try { const raw = localStorage.getItem(LS_KEY); if (raw) return { ...EMPTY, ...JSON.parse(raw) }; } catch { /* ignore */ }
  return EMPTY;
}

export function CastView() {
  const projectId = useStore(s => s.activeProjectId);
  const setActiveView = useStore(s => s.setActiveView);
  const addLayer = useStore(s => s.addLayer);
  const setSelection = useStore(s => s.setSelection);

  const [card, setCard] = useState<WorkCard>(loadWork);
  const [phase, setPhase] = useState<Phase>(() => (loadWork().values && Object.keys(loadWork().values).length ? 'ready' : 'idle'));
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('profile');
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cards, setCards] = useState<CharacterCard[]>([]);
  const [creativeRead, setCreativeRead] = useState<ProjectionRead<CastProjection> | null>(null);

  const refreshCards = () => { window.hjen.listCharacterCards().then(setCards).catch(() => setCards([])); };
  useEffect(() => { refreshCards(); }, []);
  useEffect(() => {
    let live = true;
    if (!projectId) { setCreativeRead(null); return; }
    void readCreativeProjection<CastProjection>(projectId, 'cast')
      .then(read => { if (live) setCreativeRead(read); })
      .catch(() => { if (live) setCreativeRead(null); });
    return () => { live = false; };
  }, [projectId]);

  const persist = (next: WorkCard) => {
    setCard(next);
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const flash = (msg: string) => { setToast(msg); window.setTimeout(() => setToast(null), 1800); };

  // ── photos ──────────────────────────────────────────────────
  const addPhotos = async () => {
    const picked = await window.hjen.pickImageFiles();
    if (!picked || !picked.length) return;
    const photos = [...card.photos];
    for (const p of picked) if (!photos.includes(p)) photos.push(p);
    persist({ ...card, photos });
  };
  const removePhoto = (path: string) => {
    const photos = card.photos.filter(p => p !== path);
    const mainIndex = Math.min(card.mainIndex, Math.max(0, photos.length - 1));
    persist({ ...card, photos, mainIndex });
  };
  const setMain = (idx: number) => persist({ ...card, mainIndex: idx });

  const read = async () => {
    if (!card.photos.length) return addPhotos();
    setError(null); setPhase('reading');
    const res = await readProfileFromPhotos(card.photos);
    if (!res.ok) { setError(res.message); setPhase('error'); return; }
    persist({ ...card, values: res.values, confidence: res.confidence, flagged: res.flagged });
    setPhase('ready');
    flash(res.dropped.length
      ? `Read ${Object.keys(res.values).length} traits from ${card.photos.length} photo${card.photos.length > 1 ? 's' : ''} · ${res.dropped.length} skipped`
      : `Read ${Object.keys(res.values).length} traits from ${card.photos.length} photo${card.photos.length > 1 ? 's' : ''}`);
  };

  const setField = (key: string, value: string) => {
    persist({ ...card, values: { ...card.values, [key]: value }, flagged: card.flagged.filter(k => k !== key) });
  };

  const applyCreativeContract = () => {
    const node = creativeRead?.node;
    if (!node) return;
    const projection = node.payload;
    const note = [
      projection.archetype && `CAST ARCHETYPE: ${projection.archetype}`,
      projection.performance && `PERFORMANCE: ${projection.performance}`,
      projection.negatives.length && `REFUSE: ${projection.negatives.join(' · ')}`,
    ].filter(Boolean).join('\n');
    const existing = card.values.extra?.trim() ?? '';
    const extra = existing.includes('CAST ARCHETYPE:') ? existing : [existing, note].filter(Boolean).join('\n\n');
    persist({ ...card, values: { ...card.values, extra }, flagged: card.flagged.filter(k => k !== 'extra') });
    void traceProjectionUse(creativeRead, 'Cast', 'apply cast handoff', [projection.persona]).catch(() => undefined);
    flash(`Applied Creative Graph v${node.version}`);
  };

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(() => flash('Copied')).catch(() => flash('Copy failed'));
  };

  const newCharacter = () => { persist(EMPTY); setPhase('idle'); setActiveTab('profile'); setError(null); };

  // ── library ─────────────────────────────────────────────────
  const saveToLibrary = async () => {
    const main = card.photos[card.mainIndex];
    if (!main) { setError('Add a portrait first.'); return; }
    setBusy(true); setError(null);
    const add = await window.hjen.addToLibrary({ category: 'character', sourcePath: main, name: card.values.name || 'Character' });
    if (!add.ok || !add.asset) { setError('Could not add the portrait to the library.'); setBusy(false); return; }
    const refs = card.photos.filter((_, i) => i !== card.mainIndex);
    const res = await window.hjen.saveCharacterCard({
      name: card.values.name || add.asset.name, profile: card.values, mainAsset: add.asset, referencePaths: refs,
    });
    setBusy(false);
    if (res.ok) { flash('Saved to Library'); refreshCards(); }
    else setError('Could not save the character card.');
  };

  const openCard = (c: CharacterCard) => {
    const photos = [c.mainAsset.filePath, ...c.references.map(r => r.filePath)];
    persist({ photos, mainIndex: 0, values: c.profile || {}, confidence: {}, flagged: [] });
    setPhase('ready'); setActiveTab('profile'); setError(null);
    flash(`Opened ${c.name}`);
  };

  const deleteCard = async (c: CharacterCard) => {
    await window.hjen.deleteCharacterCard({ id: c.id });
    refreshCards();
    flash('Card removed');
  };

  /** Recall a character into Frame: attach portrait + reference photos as
   *  layers and inject the locked identity into the prompt. */
  const sendToFrame = (c: CharacterCard) => {
    addLayer(c.mainAsset, 'character');
    c.references.forEach((r, i) => {
      const faux: LibraryAsset = {
        id: `${c.id}-ref${i}`, category: 'character', name: `${c.name} · ref ${i + 1}`,
        filename: r.name, filePath: r.filePath, thumbPath: r.filePath,
        addedAt: c.savedAt, bytes: 0,
      };
      addLayer(faux, 'character');
    });
    setSelection('prompt', characterPrompt(c.profile));
    setActiveView('frame');
  };

  const hasProfile = Object.keys(card.values).length > 0;
  const d = buildData(card.values);
  const displayName = card.values.name ? card.values.name : 'Unnamed character';
  const allItems = ATTRS.flatMap(g => g.items);

  return (
    <div className="cast">
      {/* ── bar ── */}
      <div className="cast-bar">
        <button className="cast-back" onClick={() => setActiveView('studio')} title="Back to Studio">‹ Studio</button>
        <div className="cast-bar__head">
          <h2 className="cast-bar__title">Cast</h2>
          <span className="cast-bar__lead">Read one or more photos into a locked character profile</span>
        </div>
        {hasProfile && <button className="cast-btn cast-btn--ghost" onClick={newCharacter}>+ New character</button>}
      </div>

      <div className="cast-grid">
        {/* ── left: photos + reader + editable profile ── */}
        <aside className="cast-left">
          {creativeRead?.node && (
            <section className="cast-creative">
              <div className="cast-creative__head">
                <span>Creative Graph</span>
                <span>v{creativeRead.node.version} · {creativeRead.node.status}</span>
              </div>
              <strong>{creativeRead.node.payload.persona || 'Casting contract'}</strong>
              <p>{creativeRead.node.payload.performance || 'Direction has not named the performance behavior yet.'}</p>
              <button className="cast-btn cast-btn--ghost" onClick={applyCreativeContract}>
                Apply to creative notes
              </button>
            </section>
          )}
          <div className="cast-photos">
            {card.photos.map((p, i) => (
              <div key={p} className={`cast-photo ${i === card.mainIndex ? 'cast-photo--main' : ''}`}>
                <img src={fileUrl(p)} alt={`photo ${i + 1}`} onClick={() => setMain(i)} title={i === card.mainIndex ? 'Portrait (main)' : 'Click to set as portrait'} />
                {i === card.mainIndex && <span className="cast-photo__badge">portrait</span>}
                <button className="cast-photo__x" onClick={() => removePhoto(p)} title="Remove">×</button>
              </div>
            ))}
            <button className="cast-photo cast-photo--add" onClick={addPhotos} title="Add photos">
              <span>+</span><small>{card.photos.length ? 'Add more' : 'Add photos'}</small>
            </button>
          </div>

          <div className="cast-actions">
            <button className="cast-btn cast-btn--accent" onClick={read} disabled={phase === 'reading' || !card.photos.length}>
              {phase === 'reading' ? 'Reading…' : card.photos.length > 1 ? `Read ${card.photos.length} photos` : 'Read the face'}
            </button>
          </div>

          {error && <div className="cast-error">{error}</div>}

          {hasProfile && (
            <div className="cast-form">
              {ATTRS.map(g => (
                <div className="cast-group" key={g.group}>
                  <div className="cast-group__title">{g.group}</div>
                  {g.items.map(item => {
                    const v = card.values[item.key] || '';
                    const flagged = card.flagged.includes(item.key);
                    return (
                      <div className={`cast-field ${flagged ? 'cast-field--flag' : ''}`} key={item.key}>
                        <label>{item.label}{flagged && <span className="cast-flag" title="Low confidence — confirm">confirm</span>}</label>
                        {item.options
                          ? <select value={v} onChange={e => setField(item.key, e.target.value)}>
                              <option value="">— not set —</option>
                              {item.options.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                          : item.type === 'textarea'
                            ? <textarea rows={2} value={v} placeholder={item.placeholder} onChange={e => setField(item.key, e.target.value)} />
                            : <input type="text" value={v} placeholder={item.placeholder} onChange={e => setField(item.key, e.target.value)} />}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </aside>

        {/* ── right: dossier + platform prompts + saved characters ── */}
        <main className="cast-right">
          {!hasProfile && (
            <div className="cast-hint">
              <h3>Photos in, one character spec out.</h3>
              <p>Add one or more photos of the same person — different angles and light make the read stronger. Cast consolidates them into one editable profile, flags anything it's unsure of, and saves the character to your Library so any Studio can recall it with its references and profile.</p>
            </div>
          )}

          {hasProfile && (
            <>
              <div className="cast-tabs">
                <button className={`cast-tab ${activeTab === 'profile' ? 'cast-tab--on' : ''}`} onClick={() => setActiveTab('profile')}>Profile</button>
                {PLATFORMS.map(p => (
                  <button key={p.id} className={`cast-tab ${activeTab === p.id ? 'cast-tab--on' : ''}`} onClick={() => setActiveTab(p.id)}>{p.name}</button>
                ))}
              </div>

              {activeTab === 'profile' ? (
                <div className="cast-dossier">
                  <h2>{displayName}</h2>
                  <div className="cast-dossier__sub">Character Reference Profile · read from {card.photos.length} photo{card.photos.length === 1 ? '' : 's'}</div>
                  <div className="cast-dossier__id">
                    {[d.age, d.sex, d.heritage, d.skinTone && `${d.skinTone} skin`, d.eyeColor && `${d.eyeColor} eyes`, d.hairColor && `${d.hairColor} hair`].filter(Boolean).join('  ·  ')}
                  </div>
                  <div className="cast-spec">
                    {ALL_KEYS.filter(k => card.values[k]).map(k => {
                      const item = allItems.find(i => i.key === k)!;
                      return (
                        <div className="cast-spec__row" key={k}>
                          <span className="cast-spec__k">{item.label}</span>
                          <span className="cast-spec__v">{card.values[k]}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="cast-panel-actions">
                    <button className="cast-btn cast-btn--accent" onClick={() => copy(profileText(card.values))}>Copy profile</button>
                  </div>
                </div>
              ) : (
                <div className="cast-prompt">
                  <div className="cast-prompt__text">{fillTemplate(PLATFORMS.find(p => p.id === activeTab)!.template, d)}</div>
                  <div className="cast-panel-actions">
                    <button className="cast-btn cast-btn--accent" onClick={() => copy(fillTemplate(PLATFORMS.find(p => p.id === activeTab)!.template, d))}>Copy prompt</button>
                  </div>
                </div>
              )}

              <div className="cast-toolbar">
                <button className="cast-btn cast-btn--accent" onClick={saveToLibrary} disabled={busy || !card.photos.length}>{busy ? 'Saving…' : '＋ Save to Library'}</button>
                <button className="cast-btn" onClick={() => {
                  let txt = profileText(card.values) + '\n\n';
                  PLATFORMS.forEach(p => { txt += '----- ' + p.name.toUpperCase() + ' -----\n' + fillTemplate(p.template, d) + '\n\n'; });
                  downloadBlob(safeName(card.values) + '-card.txt', txt, 'text/plain');
                }}>↓ Profile + prompts (.txt)</button>
              </div>
            </>
          )}

          {/* saved characters */}
          {cards.length > 0 && (
            <div className="cast-saved">
              <div className="cast-saved__title">Library characters</div>
              <div className="cast-saved__rail">
                {cards.map(c => (
                  <div className="cast-charcard" key={c.id}>
                    <img src={fileUrl(c.mainAsset.thumbPath || c.mainAsset.filePath)} alt={c.name} onClick={() => openCard(c)} title="Open" />
                    <div className="cast-charcard__name">{c.name}</div>
                    <div className="cast-charcard__meta">{c.references.length ? `${c.references.length + 1} refs` : '1 ref'}</div>
                    <div className="cast-charcard__acts">
                      <button onClick={() => sendToFrame(c)} title="Attach to Frame with its references + profile">→ Frame</button>
                      <button onClick={() => deleteCard(c)} title="Remove from library" className="cast-charcard__del">✕</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>

      {toast && <div className="cast-toast">{toast}</div>}
    </div>
  );
}
