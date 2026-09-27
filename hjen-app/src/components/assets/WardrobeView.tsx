// WARDROBE — the piece list.
//
// Output shape: a piece-list deliverable. N garment plates, one per piece, each
// with its own photo type, all bound to a parent character.
//
// The binding is the point. parentId → parentLayerId on recall, which is what
// makes Frame's prompt builder emit `'Mubarak' (character Mubarak; wardrobe
// thobe)` — one person's clothes can never migrate to another subject, and the
// character's own identity plates stay clothing-free.
//
// PHOTO TYPE is a real decision, not a preference. Input type measurably
// changes the output: flat-lay wins on print, logo and text fidelity; on-body
// imports pose artefacts from the reference figure; and for a thobe, abaya or
// bisht flat-lay destroys the drape that IS the garment — ghost-mannequin is
// the honest middle. Wrinkles in the input become amplified wrinkles out.

import { useEffect, useState } from 'react';
import { useAssets } from '../../store/assetsStore';
import { makePlate } from '../../lib/assets/factory';
import { platesFor } from '../../types/assets';
import type { PlateRole } from '../../types/assets';
import {
  AssetShell, Roster, Plate, Anchor, Negatives, SourceRefs, SpecField,
  useAssetFloor, useRecall, useFlash, recallSummary, ImportPanel, fileUrl,
} from './shared';
import { recallPlates } from '../../types/assets';
import { readCreativeProjection, traceProjectionUse, type ProjectionRead } from '../../lib/creativegraph/consumer';
import type { WardrobeProjection } from '../../lib/creativegraph/technicalCompiler';

type PhotoType = 'flat' | 'ghost' | 'on-body';

const PHOTO_TYPES: Array<{ id: PhotoType; label: string; why: string }> = [
  { id: 'ghost', label: 'Ghost-mannequin', why: 'keeps the drape — the default for thobe, abaya, bisht' },
  { id: 'flat', label: 'Flat-lay', why: 'best for print, logo and text fidelity' },
  { id: 'on-body', label: 'On body', why: 'how it really hangs, at the cost of pose artefacts' },
];

const roleOf = (t: PhotoType): PlateRole => t;

/** One garment. Pieces live as newline-separated lines in spec.pieces so the
 *  ledger stays a plain editable list rather than a nested schema. */
interface Piece { name: string }

function readPieces(spec: Record<string, string>): Piece[] {
  return (spec.pieces || '').split('\n').map(s => s.trim()).filter(Boolean).map(name => ({ name }));
}
function writePieces(pieces: Piece[]): string {
  return pieces.map(p => p.name).join('\n');
}

export function WardrobeView() {
  const { projectId, loaded, assets, current, currentId, setCurrentId } = useAssetFloor('wardrobe');
  const addAsset = useAssets(s => s.addAsset);
  const updateAsset = useAssets(s => s.updateAsset);
  const removeAsset = useAssets(s => s.removeAsset);
  const bindTo = useAssets(s => s.bindTo);
  const childrenOf = useAssets(s => s.childrenOf);
  const characters = useAssets(s => (s.data?.assets ?? []).filter(a => a.kind === 'character'));
  const recall = useRecall();
  const [flash, setFlash] = useFlash();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [creativeRead, setCreativeRead] = useState<ProjectionRead<WardrobeProjection> | null>(null);

  useEffect(() => {
    let live = true;
    if (!projectId) { setCreativeRead(null); return; }
    void readCreativeProjection<WardrobeProjection>(projectId, 'wardrobe')
      .then(read => { if (live) setCreativeRead(read); })
      .catch(() => { if (live) setCreativeRead(null); });
    return () => { live = false; };
  }, [projectId]);

  const add = () => {
    const a = addAsset('wardrobe', 'Untitled wardrobe');
    if (a) setCurrentId(a.id);
  };

  const pieces = current ? readPieces(current.spec) : [];
  const photoType = (current?.photoType ?? 'ghost') as PhotoType;
  const parent = characters.find(c => c.id === current?.parentId) ?? null;
  const parentCover = parent ? recallPlates(parent)[0] : undefined;

  const addPiece = () => {
    if (!current || !draft.trim()) return;
    updateAsset(current.id, {
      spec: { ...current.spec, pieces: writePieces([...pieces, { name: draft.trim() }]) },
    });
    setDraft('');
  };

  const removePiece = (name: string) => {
    if (!current) return;
    updateAsset(current.id, {
      spec: { ...current.spec, pieces: writePieces(pieces.filter(p => p.name !== name)) },
    });
  };

  const applyCreativeContract = () => {
    const node = creativeRead?.node;
    if (!node) return;
    const projection = node.payload;
    const target = current ?? addAsset('wardrobe', `${projection.character || 'Direction'} wardrobe`);
    if (!target) return;
    const nextPieces = target.spec.pieces?.trim() || projection.direction;
    const anchor = [projection.character, projection.palette].filter(Boolean).join(' · ')
      .split(/\s+/).slice(0, 25).join(' ');
    updateAsset(target.id, {
      spec: { ...target.spec, pieces: nextPieces },
      negatives: Array.from(new Set([...(target.negatives ?? []), ...projection.negatives])),
      anchor: target.anchor?.trim() || anchor,
    });
    setCurrentId(target.id);
    void traceProjectionUse(creativeRead, 'Wardrobe', 'apply wardrobe handoff', [target.name]).catch(() => undefined);
    setFlash(`Applied Creative Graph v${node.version}`);
  };

  const makeOne = async (part: string) => {
    if (!current) return;
    setBusy(true);
    const r = await makePlate({ assetId: current.id, role: roleOf(photoType), part });
    setBusy(false);
    if (!r.ok) setFlash(r.message || 'That piece failed.');
  };

  const makeAll = async () => {
    if (!current || !pieces.length) return;
    setBusy(true);
    // Pieces are independent of each other — this is the only floor whose whole
    // build can run concurrently, because nothing here inherits anything.
    const out = await Promise.all(pieces.map(p => makePlate({ assetId: current.id, role: roleOf(photoType), part: p.name })));
    setBusy(false);
    const failed = out.filter(r => !r.ok);
    setFlash(failed.length ? `${failed.length} of ${pieces.length} pieces failed` : `${pieces.length} pieces made`);
  };

  return (
    <AssetShell
      kind="wardrobe"
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
        <Roster kind="wardrobe" assets={assets} currentId={currentId} onPick={setCurrentId} onAdd={add} />

        {creativeRead?.node && (
          <div className="pp-panel ppa-graph-contract">
            <div className="pp-panel__head">
              <span className="pp-panel__title mono-label">Creative Graph</span>
              <span className="pp-panel__spacer" />
              <span className="mono-label">v{creativeRead.node.version} · {creativeRead.node.status}</span>
            </div>
            <b>{creativeRead.node.payload.character || 'Wardrobe direction'}</b>
            <p className="ppa-bindnote">{creativeRead.node.payload.direction || 'Direction has not named the piece list yet.'}</p>
            <button className="pp-btn pp-btn--accent" style={{ width: '100%' }} onClick={applyCreativeContract}>
              {current ? 'Fill empty fields from Direction' : 'Create from Direction'}
            </button>
          </div>
        )}

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
              <div className="pp-panel__head"><span className="pp-panel__title mono-label">Bound to</span></div>
              <select
                className="pp-select"
                value={current.parentId ?? ''}
                onChange={e => bindTo(current.id, e.target.value || null)}
              >
                <option value="">— unbound —</option>
                {characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <p className="ppa-bindnote" style={{ marginTop: 8 }}>
                {current.parentId
                  ? <>Recalls nested under the character's layer via <b>parentLayerId</b>, so one person's clothes can never mix with another's.</>
                  : <>Unbound wardrobe recalls flat. Bind it to a character and the prompt names it as theirs.</>}
              </p>
            </div>

            <div className="pp-panel">
              <div className="pp-panel__head"><span className="pp-panel__title mono-label">Photo type</span></div>
              <div className="pp-chiprow">
                {PHOTO_TYPES.map(t => (
                  <button
                    key={t.id}
                    className={`pp-chip ${photoType === t.id ? 'is-on' : ''}`}
                    onClick={() => updateAsset(current.id, { photoType: t.id })}
                    title={t.why}
                  >{t.label}</button>
                ))}
              </div>
              <p className="ppa-bindnote" style={{ marginTop: 10 }}>
                {PHOTO_TYPES.find(t => t.id === photoType)?.why}
              </p>
            </div>

            <div className="pp-panel">
              <div className="pp-panel__head"><span className="pp-panel__title mono-label">The cloth</span></div>
              <SpecField asset={current} k="material" label="Material" placeholder="Mid-weight cotton poplin" />
              <SpecField asset={current} k="colour" label="Colour" placeholder="Off-white" />
              <SpecField
                asset={current} k="condition" label="Condition" hint="stated, never left to chance"
                placeholder="Pressed but not crisp, previously worn"
              />
              <SpecField asset={current} k="cut" label="Cut / construction" textarea
                placeholder="Saudi cut, straight collar, no cuff link" />
            </div>

            <SourceRefs asset={current} note="A photo of the real garment, if it exists" />
            <Negatives asset={current} />

            <ImportPanel kind="wardrobe" onDone={setFlash} />

            <div className="pp-panel">
              <button className="pp-btn pp-btn--ghost" style={{ width: '100%', fontSize: 11 }}
                onClick={() => { removeAsset(current.id); setFlash('Wardrobe removed'); }}>
                Delete wardrobe
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
            <h3>Piece by piece, bound to a character.</h3>
            <p>
              Every garment gets its own plate and its own photo type — ghost-mannequin keeps the
              drape that <i>is</i> a thobe or abaya, flat-lay wins on print and logo. Bind the set to
              a character and it recalls nested under them, never loose.
            </p>
            <button className="pp-btn pp-btn--accent" onClick={add}>＋ New wardrobe</button>
          </div></div>
        ) : (
          <>
            <div className="ppa-bound">
              {parentCover
                ? <img className="ppa-bound__av" src={fileUrl(parentCover.thumbPath || parentCover.path)} alt="" />
                : <span className="ppa-bound__av" />}
              <span>
                <span className="ppa-bound__who">{parent ? parent.name : 'Unbound'}</span>
                <span className="ppa-bound__rel">
                  {` · ${pieces.length} piece${pieces.length === 1 ? '' : 's'} · `}
                  {parent ? 'recalls nested, never flat' : 'bind it to a character in the rail'}
                </span>
              </span>
            </div>

            <Anchor asset={current} />

            <div className="pp-panel">
              <table className="ppa-ledger">
                <thead>
                  <tr>
                    <th style={{ width: 64 }}>Plate</th>
                    <th>Piece</th>
                    <th style={{ width: 150 }}>Photo type</th>
                    <th style={{ width: 210 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pieces.map(p => {
                    const made = platesFor(current, roleOf(photoType)).filter(x => x.note === p.name).slice(-1)[0];
                    return (
                      <tr key={p.name}>
                        <td>
                          <Plate asset={current} role={roleOf(photoType)} part={p.name} onMake={() => void makeOne(p.name)} />
                        </td>
                        <td><b>{p.name}</b></td>
                        <td><span className="pp-chip is-on">{PHOTO_TYPES.find(t => t.id === photoType)?.label}</span></td>
                        <td>
                          <button className="pp-btn pp-btn--ghost" style={{ padding: '5px 10px', fontSize: 11 }}
                            disabled={busy} onClick={() => void makeOne(p.name)}>
                            {made ? 'Re-make' : 'Make'}
                          </button>
                          {' '}
                          <button className="pp-btn pp-btn--ghost" style={{ padding: '5px 10px', fontSize: 11 }}
                            onClick={() => removePiece(p.name)}>Remove</button>
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="ppa-addrow">
                    <td colSpan={4}>
                      <input
                        className="pp-input"
                        style={{ maxWidth: 320, display: 'inline-block', fontSize: 12 }}
                        value={draft}
                        placeholder="＋ Add piece — thobe · shemagh · bisht · sandals"
                        onChange={e => setDraft(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addPiece(); } }}
                        onBlur={addPiece}
                      />
                    </td>
                  </tr>
                </tbody>
              </table>

              <p className="ppa-note">
                Flat-lay wins on anything carrying print, logo or text; on-body imports pose artefacts
                from the reference figure. Wrinkles in the input become amplified wrinkles in the output,
                so condition is stated rather than left to chance.
              </p>
            </div>

            <div className="pp-panel">
              <div className="pp-panel__head"><span className="pp-panel__title mono-label">Build</span></div>
              <div className="pp-chiprow">
                <button className="pp-btn pp-btn--accent" disabled={busy || !pieces.length} onClick={makeAll}>
                  {busy ? 'Making…' : `Make ${pieces.length || ''} piece${pieces.length === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          </>
        )}
        {flash && <div className="pp-toast">{flash}</div>}
      </main>
    </AssetShell>
  );
}
