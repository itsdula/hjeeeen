// LOCATION — the scout.
//
// Output shape: a scout deliverable. Four plates in fixed slots, PLUS a binding
// decision that changes how the asset behaves everywhere downstream:
//
//   hard   → recalls as a `composition` layer and fires the COMPOSITION LOCK.
//            The frame's geometry is pinned to this plate.
//   style  → recalls as a `location` layer: style reference only, not a fixed
//            keyframe — the model extends the world rather than pinning to it.
//
// Getting that wrong in either direction is a visible failure (a pinned frame
// that should have opened out, or a world that drifts when it should have held),
// which is why it is a decision the scout makes per location, not a default.
//
// The wide is built at a THREE-QUARTER angle so the model gets depth to extend,
// and the other three plates are made FROM it so the space stays one place.

import { useState } from 'react';
import { useAssets } from '../../store/assetsStore';
import { makePlate, buildAsset } from '../../lib/assets/factory';
import { activePlate } from '../../types/assets';
import type { PlateRole } from '../../types/assets';
import {
  AssetShell, Roster, Plate, Takes, Anchor, Negatives, SourceRefs, SpecField,
  useAssetFloor, useRecall, useFlash, recallSummary, ImportPanel,
} from './shared';

const SLOTS: Array<{ role: PlateRole; label: string; hint: string }> = [
  { role: 'wide', label: 'Establishing', hint: 'three-quarter angle · three planes' },
  { role: 'reverse', label: 'Reverse', hint: 'shot back, same light' },
  { role: 'working', label: 'Medium working', hint: 'where the beat plays' },
  { role: 'detail', label: 'Detail insert', hint: 'the truth object, tight' },
];

export function LocationView() {
  const { loaded, assets, current, currentId, setCurrentId } = useAssetFloor('location');
  const addAsset = useAssets(s => s.addAsset);
  const updateAsset = useAssets(s => s.updateAsset);
  const removeAsset = useAssets(s => s.removeAsset);
  const childrenOf = useAssets(s => s.childrenOf);
  const recall = useRecall();
  const [flash, setFlash] = useFlash();
  const [busy, setBusy] = useState(false);

  const add = () => {
    const a = addAsset('location', 'Untitled location');
    if (a) setCurrentId(a.id);
  };

  const build = async () => {
    if (!current) return;
    setBusy(true);
    const out = await buildAsset(current.id);
    setBusy(false);
    const failed = out.filter(r => !r.ok);
    setFlash(failed.length ? (failed[0].message || 'A plate failed.') : 'Plates made — the wide, then the rest from it.');
  };

  const one = async (role: PlateRole) => {
    if (!current) return;
    setBusy(true);
    const r = await makePlate({ assetId: current.id, role });
    setBusy(false);
    if (!r.ok) setFlash(r.message || 'That plate failed.');
  };

  const hasWide = !!(current && activePlate(current, 'wide'));
  const binding = current?.binding ?? 'style';

  return (
    <AssetShell
      kind="location"
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
        <Roster kind="location" assets={assets} currentId={currentId} onPick={setCurrentId} onAdd={add} />

        {current && (
          <>
            <div className="pp-panel">
              <div className="pp-panel__head"><span className="pp-panel__title mono-label">Name</span></div>
              <input
                className="pp-input"
                value={current.name}
                onChange={e => updateAsset(current.id, { name: e.target.value })}
              />
            </div>

            <div className="pp-panel">
              <div className="pp-panel__head"><span className="pp-panel__title mono-label">Binding strength</span></div>
              <div className="ppa-bind">
                <button
                  aria-pressed={binding === 'hard'}
                  onClick={() => updateAsset(current.id, { binding: 'hard' })}
                >Hard plate</button>
                <button
                  aria-pressed={binding === 'style'}
                  onClick={() => updateAsset(current.id, { binding: 'style' })}
                >Style reference</button>
              </div>
              <p className="ppa-bindnote">
                {binding === 'hard'
                  ? <>Recalls as a <b>composition</b> layer and fires the COMPOSITION LOCK — the frame's geometry is pinned to this plate.</>
                  : <>Recalls as a <b>location</b> layer: style reference only, not a fixed keyframe — the model extends the world, never pinned 1:1.</>}
              </p>
            </div>

            <div className="pp-panel">
              <div className="pp-panel__head"><span className="pp-panel__title mono-label">Three plates</span></div>
              <SpecField asset={current} k="foreground" label="Foreground" placeholder="Turnstile line, brushed steel" />
              <SpecField asset={current} k="midground" label="Midground" placeholder="Waiting bank, six seats" />
              <SpecField asset={current} k="background" label="Background" placeholder="Departure board, platform mouth" />
            </div>

            <div className="pp-panel">
              <div className="pp-panel__head"><span className="pp-panel__title mono-label">Truth + hour</span></div>
              <SpecField
                asset={current} k="truthObject" label="Cultural-truth object"
                hint="the one real thing" placeholder="Folded ghutra on the seat arm"
              />
              <SpecField asset={current} k="hour" label="Hour" placeholder="07:40, first train" />
              <SpecField
                asset={current} k="light" label="Light direction"
                hint="held across every plate" placeholder="key from the south-east"
              />
            </div>

            <SourceRefs asset={current} note="A real photo of the place, if you have one" />
            <Negatives asset={current} title="Forbidden drift" />

            <ImportPanel kind="location" onDone={setFlash} />

            <div className="pp-panel">
              <button className="pp-btn pp-btn--ghost" style={{ width: '100%', fontSize: 11 }}
                onClick={() => { removeAsset(current.id); setFlash('Location removed'); }}>
                Delete location
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
            <h3>Four plates, one binding decision.</h3>
            <p>
              An establishing wide at a three-quarter angle so the model has depth to extend, the
              reverse of the same room, the medium where the beat plays, and the detail that makes
              it real. Then decide whether the frame is pinned to this geometry or free to move
              through it.
            </p>
            <button className="pp-btn pp-btn--accent" onClick={add}>＋ New location</button>
          </div></div>
        ) : (
          <>
            <Anchor asset={current} />

            <div className="ppa-board">
              {SLOTS.map(s => (
                <Plate
                  key={s.role}
                  asset={current}
                  role={s.role}
                  onMake={() => void one(s.role)}
                  hint={<><b>{s.label}</b><span>{s.hint}</span></>}
                />
              ))}
            </div>

            <div className="pp-panel" style={{ marginTop: 'var(--ppa-gutter)' }}>
              <div className="pp-panel__head">
                <span className="pp-panel__title mono-label">Build</span>
                <span className="pp-panel__spacer" />
                <span className="mono-label">
                  {hasWide ? 'the rest inherit the wide' : 'the wide is the world — it goes first'}
                </span>
              </div>
              <div className="pp-chiprow">
                <button className="pp-btn pp-btn--accent" disabled={busy} onClick={build}>
                  {busy ? 'Making…' : 'Make the plates'}
                </button>
                <button className="pp-btn" disabled={busy} onClick={() => void one('wide')}>Re-make wide</button>
                <button className="pp-btn" disabled={busy || !hasWide} onClick={() => void one('detail')}
                  title={hasWide ? '' : 'Make the wide first'}>Detail insert</button>
              </div>
            </div>

            <Takes asset={current} role="wide" />
          </>
        )}
        {flash && <div className="pp-toast">{flash}</div>}
      </main>
    </AssetShell>
  );
}
