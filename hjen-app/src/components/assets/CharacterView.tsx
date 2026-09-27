// CHARACTER — the casting room.
//
// Output shape: a casting deliverable. FACE locks identity; the three-view
// SHEET inherits that face and adds body proportions + optional exact wardrobe;
// VIDEO ANCHOR uses the same face at a safe full-body scale.
//
// The identity plate is CLOTHING-FREE by construction (bare shoulders, no
// garment at all), so wardrobe stays a separate, composable asset that binds in
// via parentId. A character reference shows the SUBJECT'S FACE; it does not
// define what they wear.

import { useState } from 'react';
import { useAssets } from '../../store/assetsStore';
import { readProfileFromPhotos, ATTRS, ALL_KEYS, buildData, type Profile } from '../../lib/castSchema';
import { makePlate, buildAsset } from '../../lib/assets/factory';
import { activePlate } from '../../types/assets';
import {
  AssetShell, Roster, Plate, Takes, Anchor, Negatives, SourceRefs, SpecField,
  useAssetFloor, useRecall, useFlash, recallSummary, ImportPanel, fileUrl,
} from './shared';
import { ImagePreviewDialog, type ImagePreviewItem } from '../ImagePreviewDialog';

/** The five anchors worth surfacing above the fold. The other 32 stay in the
 *  drawer — they matter to the recipe, not to the eye. */
const HEAD_KEYS = ['heritage', 'age', 'sex', 'build', 'height', 'facialHair'];

/** A short identity line built from whatever the read filled in. Deliberately
 *  compact: under a reference image the text must shrink, not expand. */
function suggestAnchor(name: string, values: Profile): string {
  const d = buildData(values);
  const bits = [
    d.age && d.sex ? `${d.age} ${d.sex}` : (d.age || d.sex),
    d.heritage,
    d.facialHair && d.facialHair !== 'None' ? d.facialHair.toLowerCase() : '',
    d.build && `${d.build.toLowerCase()} build`,
  ].filter(Boolean).join(', ');
  return `${name} — ${bits}. Identity 100% matches the attached reference; wardrobe is its own asset.`;
}

export function CharacterView() {
  const { loaded, assets, current, currentId, setCurrentId } = useAssetFloor('character');
  const addAsset = useAssets(s => s.addAsset);
  const updateAsset = useAssets(s => s.updateAsset);
  const removeAsset = useAssets(s => s.removeAsset);
  const childrenOf = useAssets(s => s.childrenOf);
  const recall = useRecall();
  const [flash, setFlash] = useFlash();
  const [reading, setReading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ImagePreviewItem | null>(null);

  const add = () => {
    const a = addAsset('character', 'Untitled character');
    if (a) setCurrentId(a.id);
  };

  /** Read the source photos into the 37-anchor profile. Multi-photo is the
   *  strong path: different angles and light make the read firmer, and the
   *  reader consolidates them into ONE profile rather than averaging faces. */
  const read = async () => {
    if (!current || !current.sourceRefs.length) return;
    setReading(true);
    const res = await readProfileFromPhotos(current.sourceRefs);
    setReading(false);
    if (!res.ok) { setFlash(res.message); return; }
    updateAsset(current.id, {
      spec: { ...current.spec, ...res.values },
      anchor: current.anchor || suggestAnchor(current.name, res.values),
    });
    setFlash(res.flagged.length
      ? `Read ${Object.keys(res.values).length} traits · ${res.flagged.length} to confirm`
      : `Read ${Object.keys(res.values).length} traits from ${current.sourceRefs.length} photo${current.sourceRefs.length === 1 ? '' : 's'}`);
  };

  const build = async () => {
    if (!current) return;
    setBusy(true);
    try {
      const out = await buildAsset(current.id);
      const failed = out.filter(r => !r.ok);
      setFlash(failed.length ? (failed[0].message || 'A plate failed.') : 'Identity built — face, then sheet from it.');
    } catch (e: any) {
      setFlash(String(e?.message || e || 'Identity build failed.'));
    } finally {
      setBusy(false);
    }
  };

  const one = async (role: 'face' | 'sheet' | 'video-anchor') => {
    if (!current) return;
    setBusy(true);
    try {
      const r = await makePlate({ assetId: current.id, role });
      if (!r.ok) setFlash(r.message || 'That plate failed.');
    } catch (e: any) {
      setFlash(String(e?.message || e || 'That plate failed.'));
    } finally {
      setBusy(false);
    }
  };

  const hasFace = !!(current && activePlate(current, 'face'));
  const openPlate = (plate: { path: string; note?: string }, title: string) => {
    const src = fileUrl(plate.path);
    if (src) setPreview({ src, title, detail: plate.note });
  };

  return (
    <>
    <AssetShell
      kind="character"
      actions={current && (
        <>
          <span className="mono-label">{recallSummary(current, childrenOf(current.id))}</span>
          <button className="pp-btn pp-btn--ghost" onClick={() => {
            const r = recall(current);
            if (!r.ok && r.notice) setFlash(r.notice);
            else if (r.notice) setFlash(r.notice);
          }}>Recall into Frame</button>
        </>
      )}
    >
      <aside className="pp-aside">
        <Roster
          kind="character"
          assets={assets}
          currentId={currentId}
          onPick={setCurrentId}
          onAdd={add}
          onPreview={(plate, asset) => openPlate(plate, `${asset.name} · ${plate.role}`)}
        />

        {current && (
          <>
            <SourceRefs
              asset={current}
              label="Identity references"
              addTitle="Add exact identity photos"
              note={current.sourceRefs.length > 1
                ? `${current.sourceRefs.length} photos → exact face identity`
                : 'Portraits steer the face plate only'}
              onOpen={(path, label) => {
                const src = fileUrl(path);
                if (src) setPreview({ src, title: `${current.name} · ${label}`, detail: path.split('/').pop() });
              }}
            />

            <SourceRefs
              asset={current}
              field="wardrobeRefs"
              label="Wardrobe references"
              addTitle="Add exact wardrobe references"
              note={(current.wardrobeRefs?.length ?? 0) > 0
                ? `${current.wardrobeRefs!.length} reference${current.wardrobeRefs!.length === 1 ? '' : 's'} → exact clothes locked in sheet`
                : 'Optional · add for culturally or client-sensitive wardrobe'}
              onOpen={(path, label) => {
                const src = fileUrl(path);
                if (src) setPreview({ src, title: `${current.name} · ${label}`, detail: path.split('/').pop() });
              }}
            />

            <div className="pp-panel">
              <div className="pp-panel__head">
                <span className="pp-panel__title mono-label">Identity anchors</span>
                <span className="pp-panel__spacer" />
                <button
                  className="pp-btn pp-btn--ghost"
                  style={{ padding: '5px 10px', fontSize: 11 }}
                  disabled={reading || !current.sourceRefs.length}
                  onClick={read}
                >{reading ? 'Reading…' : 'Read photos'}</button>
              </div>

              <div className="pp-field">
                <div className="pp-field__head"><span className="pp-field__label mono-label">Name</span></div>
                <input
                  className="pp-input"
                  value={current.name}
                  onChange={e => updateAsset(current.id, { name: e.target.value })}
                />
              </div>

              <SpecField
                asset={current}
                k="heightCm"
                label="Exact sheet height"
                hint="manual body lock"
                placeholder="e.g. 178 cm"
              />

              {(showAll ? ATTRS.flatMap(g => g.items) : ATTRS.flatMap(g => g.items).filter(i => HEAD_KEYS.includes(i.key)))
                .map(item => (
                  <SpecField
                    key={item.key}
                    asset={current}
                    k={item.key}
                    label={item.label}
                    options={item.options}
                    textarea={item.type === 'textarea'}
                    placeholder={item.placeholder}
                  />
                ))}

              <button
                className="pp-btn pp-btn--ghost"
                style={{ width: '100%', fontSize: 11 }}
                onClick={() => setShowAll(v => !v)}
              >
                {showAll ? 'Collapse' : `${ALL_KEYS.length - HEAD_KEYS.length} more anchors`}
              </button>
            </div>

            <Negatives asset={current} />

            <ImportPanel kind="character" onDone={setFlash} />

            <div className="pp-panel">
              <button className="pp-btn pp-btn--ghost" style={{ width: '100%', fontSize: 11 }}
                onClick={() => { removeAsset(current.id); setFlash('Character removed'); }}>
                Delete character
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
            <h3>Photos in, one locked identity out.</h3>
            <p>
              Add photos of one person — different angles and light make the read firmer. The face
              plate is made with no clothing at all, so identity stays separate from wardrobe, and
              the turnaround is then made <i>from</i> that face so it can't drift to someone else.
            </p>
            <button className="pp-btn pp-btn--accent" onClick={add}>＋ New character</button>
          </div></div>
        ) : (
          <>
            <Anchor asset={current} />

            <div className="ppa-contact">
              <Plate asset={current} role="face" className="ppa-contact__face" onMake={() => void one('face')} onOpen={plate => openPlate(plate, `${current.name} · Face`)} />
              <Plate asset={current} role="sheet" className="ppa-contact__sheet" onMake={() => void one('sheet')} onOpen={plate => openPlate(plate, `${current.name} · Character sheet`)} />
              <Plate asset={current} role="video-anchor" className="ppa-contact__anchor" onMake={() => void one('video-anchor')} onOpen={plate => openPlate(plate, `${current.name} · Video anchor`)} />

              <div className="ppa-contact__wide">
                <div className="pp-panel__head" style={{ marginBottom: 8 }}>
                  <span className="pp-panel__title mono-label">Build</span>
                  <span className="pp-panel__spacer" />
                  <span className="mono-label">
                    {(current.wardrobeRefs?.length ?? 0) > 0
                      ? 'sheet · headless front + face ¾ + locked wardrobe'
                      : 'sheet · headless front + face ¾ + neutral wardrobe'}
                  </span>
                </div>
                <div className="pp-chiprow">
                  <button className="pp-btn pp-btn--accent" disabled={busy} onClick={build}>
                    {busy ? 'Making…' : 'Build identity'}
                  </button>
                  <button className="pp-btn" disabled={busy} onClick={() => void one('face')}>Re-make face</button>
                  <button className="pp-btn" disabled={busy || !hasFace} onClick={() => void one('sheet')}
                    title={hasFace ? 'Three views: headless front, face-locked three-quarter, complete back' : 'Make the face first — the three-quarter view inherits it'}>Re-make sheet</button>
                  <button className="pp-btn" disabled={busy || !hasFace} onClick={() => void one('video-anchor')}
                    title="Full body, small face, grain + bloom — the variant a video model's face filter accepts">
                    Video anchor
                  </button>
                </div>
              </div>
            </div>

            <Takes asset={current} role="face" onOpen={plate => openPlate(plate, `${current.name} · Face take`)} />
            <Takes asset={current} role="sheet" onOpen={plate => openPlate(plate, `${current.name} · Sheet take`)} />
            <Takes asset={current} role="video-anchor" onOpen={plate => openPlate(plate, `${current.name} · Video anchor take`)} />
          </>
        )}
        {flash && <div className="pp-toast">{flash}</div>}
      </main>
    </AssetShell>
    <ImagePreviewDialog item={preview} onClose={() => setPreview(null)} />
    </>
  );
}
