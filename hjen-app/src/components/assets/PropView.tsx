// PROP — the object study.
//
// Output shape: a turnaround deliverable. ONE canvas carrying four orthographic
// views, plus N detail inserts that are mandatory rather than optional —
// engravings, attachments and surface texture drift first when the model only
// ever sees the object wide.
//
// This floor defaults to the Gemini door, and that is a craft decision, not a
// preference: gpt-image-2 renders objects flat — no honest taper, no real
// contact shadow — and a flat prop animates like 2D card in any video model.
// Gemini's separate high-fidelity OBJECT budget is exactly this case.

import { useState } from 'react';
import { useAssets } from '../../store/assetsStore';
import { makePlate } from '../../lib/assets/factory';
import { activePlate, platesFor } from '../../types/assets';
import { MODELS } from '../../lib/models';
import type { ModelId } from '../../types/catalog';
import {
  AssetShell, Roster, Plate, Takes, Anchor, Negatives, SourceRefs, SpecField,
  useAssetFloor, useRecall, useFlash, recallSummary, ImportPanel,
} from './shared';

export function PropView() {
  const { loaded, assets, current, currentId, setCurrentId } = useAssetFloor('prop');
  const addAsset = useAssets(s => s.addAsset);
  const updateAsset = useAssets(s => s.updateAsset);
  const removeAsset = useAssets(s => s.removeAsset);
  const childrenOf = useAssets(s => s.childrenOf);
  const recall = useRecall();
  const [flash, setFlash] = useFlash();
  const [busy, setBusy] = useState(false);
  const [insertDraft, setInsertDraft] = useState('');

  const add = () => {
    const a = addAsset('prop', 'Untitled prop');
    if (a) setCurrentId(a.id);
  };

  const model = (current?.spec.model as ModelId) || 'NANO_BANANA_PRO';

  const makeTurnaround = async () => {
    if (!current) return;
    setBusy(true);
    const r = await makePlate({ assetId: current.id, role: 'turnaround', model });
    setBusy(false);
    if (!r.ok) setFlash(r.message || 'The turnaround failed.');
  };

  const makeInsert = async (part: string) => {
    if (!current || !part.trim()) return;
    setBusy(true);
    const r = await makePlate({ assetId: current.id, role: 'insert', part: part.trim(), model });
    setBusy(false);
    if (!r.ok) setFlash(r.message || 'That insert failed.');
    else setInsertDraft('');
  };

  const hasTurnaround = !!(current && activePlate(current, 'turnaround'));
  const inserts = current ? platesFor(current, 'insert') : [];

  return (
    <AssetShell
      kind="prop"
      actions={current && (
        <>
          <span className="mono-label">{recallSummary(current, childrenOf(current.id))}</span>
          <button className="pp-btn pp-btn--ghost" onClick={() => {
            const r = recall(current);
            if (r.notice) setFlash(r.notice);
          }}>Recall into Frame</button>
        </>
      )}
    >
      <aside className="pp-aside">
        <Roster kind="prop" assets={assets} currentId={currentId} onPick={setCurrentId} onAdd={add} />

        {current && (
          <>
            <div className="pp-panel">
              <div className="pp-panel__head"><span className="pp-panel__title mono-label">Object</span></div>
              <div className="pp-field">
                <div className="pp-field__head"><span className="pp-field__label mono-label">Name</span></div>
                <input
                  className="pp-input"
                  value={current.name}
                  onChange={e => updateAsset(current.id, { name: e.target.value })}
                />
              </div>
              <SpecField asset={current} k="material" label="Material" placeholder="Hammered brass" />
              <SpecField asset={current} k="finish" label="Finish" placeholder="Warm patina, matte" />
              <SpecField
                asset={current} k="scaleCue" label="Scale cue" hint="required"
                placeholder="24 cm tall, beside a demitasse cup"
              />
            </div>

            <div className="pp-panel">
              <div className="pp-panel__head"><span className="pp-panel__title mono-label">Model</span></div>
              <select
                className="pp-select"
                value={model}
                onChange={e => updateAsset(current.id, { spec: { ...current.spec, model: e.target.value } })}
              >
                {(Object.keys(MODELS) as ModelId[])
                  .filter(id => MODELS[id].refs !== null)
                  .map(id => <option key={id} value={id}>{MODELS[id].label}</option>)}
              </select>
              <p className="ppa-bindnote" style={{ marginTop: 8 }}>
                Objects render flat on gpt-image-2, and a flat prop animates like 2D card.
                Nano Banana Pro carries a separate high-fidelity object budget — it is the default here.
              </p>
            </div>

            <SourceRefs asset={current} note="A photo of the real object, if it exists" />
            <Negatives asset={current} />

            <ImportPanel kind="prop" onDone={setFlash} />

            <div className="pp-panel">
              <button className="pp-btn pp-btn--ghost" style={{ width: '100%', fontSize: 11 }}
                onClick={() => { removeAsset(current.id); setFlash('Prop removed'); }}>
                Delete prop
              </button>
            </div>
          </>
        )}
      </aside>

      <main className="pp-main">
        {!loaded ? (
          <div className="pp-gate"><span className="pp-busy"><span className="pp-busy__ring" />Reading stage 06…</span></div>
        ) : !current ? (
          <div className="ppa-blank"><div className="ppa-blank__inner">
            <h3>One canvas, four views, real shadow.</h3>
            <p>
              Front, three-quarter, side and back generated together on a single canvas — simultaneous
              holds the design where four separate renders drift. Then the details that go first:
              engravings, handles, attachments, texture.
            </p>
            <button className="pp-btn pp-btn--accent" onClick={add}>＋ New prop</button>
          </div></div>
        ) : (
          <>
            <Anchor asset={current} />

            <Plate asset={current} role="turnaround" className="ppa-strip" onMake={makeTurnaround} />

            <div className="pp-panel">
              <div className="pp-panel__head">
                <span className="pp-panel__title mono-label">Detail inserts</span>
                <span className="ppa-req">mandatory</span>
                <span className="pp-panel__spacer" />
                <span className="mono-label">engravings + attachments drift first</span>
              </div>

              <div className="ppa-inserts">
                {inserts.map(p => (
                  <Plate
                    key={p.id}
                    asset={current}
                    role="insert"
                    part={p.note}
                    onMake={() => void makeInsert(p.note || '')}
                  />
                ))}
              </div>

              <div className="pp-chiprow" style={{ marginTop: 'var(--s-3)' }}>
                <input
                  className="pp-input"
                  style={{ flex: 1, minWidth: 160, fontSize: 12 }}
                  value={insertDraft}
                  placeholder="Which part? handle · engraving · spout…"
                  onChange={e => setInsertDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void makeInsert(insertDraft); } }}
                />
                <button
                  className="pp-btn"
                  disabled={busy || !hasTurnaround || !insertDraft.trim()}
                  title={hasTurnaround ? '' : 'Make the turnaround first — inserts are cut from it'}
                  onClick={() => void makeInsert(insertDraft)}
                >Make insert</button>
              </div>
            </div>

            <div className="pp-panel">
              <div className="pp-panel__head"><span className="pp-panel__title mono-label">Build</span></div>
              <div className="pp-chiprow">
                <button className="pp-btn pp-btn--accent" disabled={busy} onClick={makeTurnaround}>
                  {busy ? 'Making…' : hasTurnaround ? 'Re-make the turnaround' : 'Make the turnaround'}
                </button>
              </div>
            </div>

            <Takes asset={current} role="turnaround" />
          </>
        )}
        {flash && <div className="pp-toast">{flash}</div>}
      </main>
    </AssetShell>
  );
}
