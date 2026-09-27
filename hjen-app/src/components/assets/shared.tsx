// Shared parts for the four asset factories.
//
// One engine, four floors: everything that is the SAME on every floor lives
// here (the shell, the roster, the plate, the takes rail, the negatives editor,
// the anchor). Each floor supplies only its layout, its spec schema, its plate
// roles and its recipe — see components/assets/*View.tsx.

import { useEffect, useRef, useState } from 'react';
import { PreprodShell } from '../preprod/shared';
import { useStore } from '../../store';
import { useAssets, usePendingCount } from '../../store/assetsStore';
import type { Asset, AssetKind, AssetPlate, PlateRole } from '../../types/assets';
import { activePlate, platesFor, ROLE_LABEL, recallPlates } from '../../types/assets';
import { compileFor, toLayers, toPromptAnchor, resolveRefs } from '../../lib/assets/payload';
import { DEFAULT_MODEL } from '../../lib/assets/factory';
import {
  importCastCards, importStoryboard, importBreakdown, importLibrary, summarize,
  type ImportResult,
} from '../../lib/assets/bridges';
import '../../styles/preprod-assets.css';

export const fileUrl = (p?: string): string | undefined =>
  p ? `hjen-file://${encodeURI(p)}` : undefined;

/** Per-floor identity. Accent is substrate only; PreprodShell derives the ink. */
export const FLOOR: Record<AssetKind, { tool: string; sub: string; accent: string }> = {
  character: { tool: 'Character', sub: 'Photos in, one locked identity out', accent: '#AF7757' },
  location: { tool: 'Location', sub: 'Four plates, one binding decision', accent: '#257D64' },
  prop: { tool: 'Prop', sub: 'One canvas, four views, real shadow', accent: '#B2D08D' },
  wardrobe: { tool: 'Wardrobe', sub: 'Piece by piece, bound to a character', accent: '#DCC9C1' },
};

/** Open the project's asset book whenever the active project changes.
 *  Every floor reads the same stage-6 document, so switching between them
 *  never reloads and never disagrees. */
export function useAssetFloor(kind: AssetKind) {
  const projectId = useStore(s => s.activeProjectId);
  const open = useAssets(s => s.open);
  const loaded = useAssets(s => s.loaded);
  const storeProject = useAssets(s => s.projectId);
  const assets = useAssets(s => (s.data?.assets ?? []).filter(a => a.kind === kind));

  useEffect(() => {
    if (projectId && projectId !== storeProject) void open(projectId);
  }, [projectId, storeProject, open]);

  const [currentId, setCurrentId] = useState<string | null>(null);
  // Keep a valid selection without fighting the user: only auto-pick when the
  // current one is gone (deleted, or we just switched project).
  useEffect(() => {
    if (currentId && assets.some(a => a.id === currentId)) return;
    setCurrentId(assets[0]?.id ?? null);
  }, [assets, currentId]);

  const current = assets.find(a => a.id === currentId) ?? null;
  return { projectId, loaded: loaded && !!projectId, assets, current, currentId, setCurrentId };
}

// ─── the shell ───────────────────────────────────────────────────────────────

export function AssetShell({ kind, actions, children }: {
  kind: AssetKind;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const meta = FLOOR[kind];
  const flush = useAssets(s => s.flush);
  return (
    <PreprodShell
      tool={meta.tool}
      sub={meta.sub}
      accent={meta.accent}
      stage={6}
      beforeSign={async () => { flush(); }}
      actions={actions}
    >
      <div className="pp-grid pp--assets-body copyable-surface">{children}</div>
    </PreprodShell>
  );
}

// ─── the roster ──────────────────────────────────────────────────────────────

export function Roster({ kind, assets, currentId, onPick, onAdd, onPreview }: {
  kind: AssetKind;
  assets: Asset[];
  currentId: string | null;
  onPick: (id: string) => void;
  onAdd: () => void;
  onPreview?: (plate: AssetPlate, asset: Asset) => void;
}) {
  const label = FLOOR[kind].tool;
  return (
    <div className="pp-panel">
      <div className="pp-panel__head">
        <span className="pp-panel__title mono-label">{label}s</span>
        <span className="pp-panel__spacer" />
        <span className="mono-label">{assets.length}</span>
      </div>
      <div className="ppa-roster">
        {assets.map(a => {
          const cover = recallPlates(a)[0];
          return (
            <button
              key={a.id}
              className={`ppa-rosteritem ${a.id === currentId ? 'is-current' : ''}`}
              onClick={() => onPick(a.id)}
            >
              {cover
                ? <img
                    className="ppa-rosteritem__thumb"
                    src={fileUrl(cover.thumbPath || cover.path)}
                    alt={`${a.name} preview`}
                    title="Click image to preview"
                    onClick={event => {
                      if (!onPreview) return;
                      event.preventDefault();
                      event.stopPropagation();
                      onPreview(cover, a);
                    }}
                  />
                : <span className="ppa-rosteritem__thumb ppa-rosteritem__thumb--empty" />}
              <span className="ppa-rosteritem__name">{a.name}</span>
              <span className="ppa-rosteritem__n">{a.plates.length || '—'}</span>
            </button>
          );
        })}
      </div>
      <button className="pp-btn pp-btn--ghost" style={{ width: '100%', marginTop: 'var(--s-3)' }} onClick={onAdd}>
        ＋ New {label.toLowerCase()}
      </button>
    </div>
  );
}

// ─── the plate ───────────────────────────────────────────────────────────────

export function Plate({ asset, role, part, className, hint, onMake, onOpen }: {
  asset: Asset;
  role: PlateRole;
  part?: string;
  className?: string;
  /** Small line under the plate — hour + light on a location, etc. */
  hint?: React.ReactNode;
  onMake: () => void;
  onOpen?: (plate: AssetPlate) => void;
}) {
  const pending = usePendingCount(asset.id);
  const plate = part
    ? platesFor(asset, role).filter(p => p.note === part).slice(-1)[0]
    : activePlate(asset, role);
  const making = pending > 0 && !plate;
  const label = `${ROLE_LABEL[role]}${part ? ` · ${part}` : ''}`;

  const body = making ? (
    <div className={`ppa-plate ppa-plate--making ${className ?? ''}`}>
      <span className="ppa-plate__role">{label}</span>
      <span className="pp-busy"><span className="pp-busy__ring" />making…</span>
    </div>
  ) : plate ? (
    <button
      className={`ppa-plate is-active ${className ?? ''}`}
      onClick={() => onOpen?.(plate)}
      title={`${onOpen ? 'Click to preview · ' : ''}Made ${new Date(plate.at).toLocaleString()}`}
    >
      <span className="ppa-plate__role">{label}</span>
      <span className="ppa-plate__ok">✓</span>
      <img className="ppa-plate__img" src={fileUrl(plate.thumbPath || plate.path)} alt={label} />
    </button>
  ) : (
    <button className={`ppa-plate ppa-plate--empty ${className ?? ''}`} onClick={onMake}>
      <span className="ppa-plate__role">{label}</span>
      ＋ make
    </button>
  );

  if (!hint) return body;
  return (
    <div>
      {body}
      <div className="ppa-slotmeta">{hint}</div>
    </div>
  );
}

// ─── takes ───────────────────────────────────────────────────────────────────

/** Append-only history for one role. Clicking a take moves the ACTIVE pointer;
 *  nothing is ever rewritten, so an earlier build is always recoverable. */
export function Takes({ asset, role, onOpen }: {
  asset: Asset;
  role: PlateRole;
  onOpen?: (plate: AssetPlate) => void;
}) {
  const setActive = useAssets(s => s.setActivePlate);
  const takes = platesFor(asset, role);
  const activeId = asset.active[role];
  if (takes.length < 2) return null;
  return (
    <div className="pp-panel" style={{ marginTop: 'var(--ppa-gutter)' }}>
      <div className="pp-panel__head">
        <span className="pp-panel__title mono-label">Takes · append-only</span>
        <span className="pp-panel__spacer" />
        <span className="mono-label">
          {takes.length} builds · active {new Date(takes.find(t => t.id === activeId)?.at ?? takes[takes.length - 1].at).toLocaleString()}
        </span>
      </div>
      <div className="ppa-takes">
        {takes.map(t => (
          <button
            key={t.id}
            className={`ppa-take ${t.id === activeId ? 'is-active' : ''}`}
            onClick={() => {
              setActive(asset.id, role, t.id);
              onOpen?.(t);
            }}
            title={`${onOpen ? 'Click to preview · ' : ''}${new Date(t.at).toLocaleString()}`}
          >
            <img src={fileUrl(t.thumbPath || t.path)} alt="" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── the anchor ──────────────────────────────────────────────────────────────

/** What actually rides into the prompt beside the plates.
 *
 *  Deliberately short — long appearance text fights the reference image and
 *  degrades it. The counter turns amber past 25 words as a nudge, not a gate:
 *  a stubborn detail the model keeps dropping is worth the extra word. */
export function Anchor({ asset }: { asset: Asset }) {
  const update = useAssets(s => s.updateAsset);
  const words = asset.anchor.trim() ? asset.anchor.trim().split(/\s+/).length : 0;
  return (
    <div className="ppa-anchor">
      <span className={`ppa-anchor__count mono-label ${words > 25 ? 'is-over' : ''}`}>{words} words</span>
      <span className="ppa-anchor__label">Anchor → </span>
      <textarea
        className="ppa-anchor__field"
        rows={2}
        value={asset.anchor}
        placeholder="The short line that travels with the plates. Name only what the model tends to drop."
        onChange={e => update(asset.id, { anchor: e.target.value })}
      />
    </div>
  );
}

// ─── negatives ───────────────────────────────────────────────────────────────

export function Negatives({ asset, title = 'Negatives' }: { asset: Asset; title?: string }) {
  const update = useAssets(s => s.updateAsset);
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (!v || asset.negatives.includes(v)) { setDraft(''); return; }
    update(asset.id, { negatives: [...asset.negatives, v] });
    setDraft('');
  };
  return (
    <div className="pp-panel">
      <div className="pp-panel__head"><span className="pp-panel__title mono-label">{title}</span></div>
      <div className="ppa-negs">
        {asset.negatives.map(n => (
          <span className="ppa-neg" key={n}>
            {n}
            <button
              className="ppa-neg__x"
              onClick={() => update(asset.id, { negatives: asset.negatives.filter(x => x !== n) })}
              title="Remove"
            >×</button>
          </span>
        ))}
      </div>
      <input
        className="pp-input"
        style={{ marginTop: 'var(--s-2)', fontSize: 12 }}
        value={draft}
        placeholder="Add a refusal…"
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        onBlur={add}
      />
    </div>
  );
}

// ─── source photos ───────────────────────────────────────────────────────────

export function SourceRefs({
  asset,
  note,
  field = 'sourceRefs',
  label = 'Source references',
  addTitle = 'Add source references',
  onOpen,
}: {
  asset: Asset;
  note?: string;
  field?: 'sourceRefs' | 'wardrobeRefs';
  label?: string;
  addTitle?: string;
  onOpen?: (path: string, label: string) => void;
}) {
  const update = useAssets(s => s.updateAsset);
  const refs = field === 'sourceRefs' ? asset.sourceRefs : (asset.wardrobeRefs ?? []);
  const pick = async () => {
    const picked = await window.hjen.pickImageFiles();
    if (!picked?.length) return;
    const next = [...refs];
    for (const p of picked) if (!next.includes(p)) next.push(p);
    update(asset.id, { [field]: next });
  };
  return (
    <div className="pp-panel">
      <div className="pp-panel__head"><span className="pp-panel__title mono-label">{label}</span></div>
      <div className="ppa-src">
        {refs.map(p => (
          <span
            className="ppa-src__s"
            key={p}
            role={onOpen ? 'button' : undefined}
            tabIndex={onOpen ? 0 : undefined}
            title={onOpen ? 'Click image to preview' : undefined}
            onClick={() => onOpen?.(p, label)}
            onKeyDown={event => {
              if (event.target !== event.currentTarget || !onOpen || (event.key !== 'Enter' && event.key !== ' ')) return;
              event.preventDefault();
              onOpen(p, label);
            }}
          >
            <img src={fileUrl(p)} alt={`${label} image`} />
            <button
              className="ppa-src__x"
              onClick={event => {
                event.stopPropagation();
                update(asset.id, { [field]: refs.filter(x => x !== p) });
              }}
              title="Remove"
            >×</button>
          </span>
        ))}
        <button className="ppa-src__s ppa-src__s--add" onClick={pick} title={addTitle}>＋</button>
      </div>
      {note && <div className="ppa-cascade">{note}</div>}
    </div>
  );
}

// ─── import ──────────────────────────────────────────────────────────────────

/** Pull what the project already knows into the book. One-way and idempotent:
 *  an asset whose name is already here is skipped, never overwritten, so the
 *  button is safe to press twice. */
export function ImportPanel({ kind, onDone }: { kind: AssetKind; onDone: (msg: string) => void }) {
  const projectId = useStore(s => s.activeProjectId);
  const breakdownSlug = useStore(s => s.tabs.find(t => t.id === s.activeTabId)?.sub?.slug as string | undefined);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (label: string, fn: () => Promise<ImportResult>) => {
    setBusy(label);
    try { onDone(summarize(await fn())); }
    catch (e: any) { onDone(String(e?.message || e).slice(0, 160)); }
    finally { setBusy(null); }
  };

  return (
    <div className="pp-panel">
      <div className="pp-panel__head">
        <span className="pp-panel__title mono-label">Import</span>
        <span className="pp-panel__spacer" />
        <span className="pp-field__hint">never overwrites</span>
      </div>
      <div className="pp-chiprow">
        {kind === 'character' && (
          <button className="pp-chip" disabled={!!busy} onClick={() => void run('cast', importCastCards)}>
            {busy === 'cast' ? 'Importing…' : 'Cast cards'}
          </button>
        )}
        <button
          className="pp-chip" disabled={!!busy || !projectId}
          onClick={() => projectId && void run('sb', () => importStoryboard(projectId))}
        >{busy === 'sb' ? 'Importing…' : 'Storyboard'}</button>
        {breakdownSlug && (
          <button className="pp-chip" disabled={!!busy}
            onClick={() => void run('bd', () => importBreakdown(breakdownSlug))}
          >{busy === 'bd' ? 'Importing…' : 'Breakdown'}</button>
        )}
        <button className="pp-chip" disabled={!!busy}
          onClick={() => void run('lib', () => importLibrary([kind]))}
        >{busy === 'lib' ? 'Importing…' : 'Library'}</button>
      </div>
    </div>
  );
}

// ─── a plain spec field ──────────────────────────────────────────────────────

export function SpecField({ asset, k, label, hint, placeholder, textarea, options }: {
  asset: Asset;
  k: string;
  label: string;
  hint?: string;
  placeholder?: string;
  textarea?: boolean;
  options?: string[];
}) {
  const update = useAssets(s => s.updateAsset);
  const set = (v: string) => update(asset.id, { spec: { ...asset.spec, [k]: v } });
  const v = asset.spec[k] ?? '';
  return (
    <div className="pp-field">
      <div className="pp-field__head">
        <span className="pp-field__label mono-label">{label}</span>
        {hint && <span className="pp-field__hint">{hint}</span>}
      </div>
      {options
        ? <select className="pp-select" value={v} onChange={e => set(e.target.value)}>
            <option value="">— not set —</option>
            {options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        : textarea
          ? <textarea className="pp-textarea" rows={3} value={v} placeholder={placeholder} onChange={e => set(e.target.value)} />
          : <input className="pp-input" value={v} placeholder={placeholder} onChange={e => set(e.target.value)} />}
    </div>
  );
}

// ─── recall ──────────────────────────────────────────────────────────────────

/** Send one asset (plus anything bound to it) into Frame: its active plates
 *  become layers, its anchor becomes the prompt. Wardrobe rides nested under
 *  its character via parentLayerId, which is what makes Frame's prompt builder
 *  emit `'Mubarak' (character Mubarak; wardrobe thobe)`. */
export function useRecall() {
  const setActiveView = useStore(s => s.setActiveView);
  const setSelection = useStore(s => s.setSelection);
  const clearLayers = useStore(s => s.clearLayers);
  const childrenOf = useAssets(s => s.childrenOf);

  return (asset: Asset): { ok: boolean; notice?: string } => {
    const bundle = [asset, ...childrenOf(asset.id)];
    const model = DEFAULT_MODEL[asset.kind];
    const compiled = compileFor(bundle, model);
    if (!compiled.refs.length) {
      return { ok: false, notice: 'Nothing to recall yet — make a plate first.' };
    }
    clearLayers();
    const layers = toLayers(compiled.refs);
    useStore.setState({ layers });
    setSelection('prompt', toPromptAnchor(compiled.refs));
    setActiveView('frame');
    return { ok: true, notice: compiled.notice };
  };
}

/** A one-line readout of what would be attached — shown beside the button so
 *  the reference budget is visible before it is spent, not after. */
export function recallSummary(asset: Asset, children: Asset[]): string {
  const refs = resolveRefs([asset, ...children]);
  const budget = compileFor([asset, ...children], DEFAULT_MODEL[asset.kind]);
  return refs.length > budget.refs.length
    ? `${budget.refs.length} of ${refs.length} plates`
    : `${refs.length} plate${refs.length === 1 ? '' : 's'}`;
}

/** A tiny inline toast — every floor needs one and none needs more. */
export function useFlash(): [string | null, (m: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = (m: string) => {
    setMsg(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 2600);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return [msg, flash];
}
