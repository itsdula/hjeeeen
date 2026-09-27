// ProjectAssetPicker — attach images to the Assistant FROM inside the studio.
// Three sources: GENERATIONS (everything a project made — frames, storyboard
// takes, and any gen-tool export, for ANY project via a project selector),
// REFERENCES (the project's signed-off reference set — hunted, imported, or
// clipped from the browser), and the shared LIBRARY (with in-window upload).
// Every tile yields an absolute path, which is exactly what
// context.attachments[] wants. Monochrome, HJEN-token styling.

import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import type { ProjectMeta } from '../types/hjen-bridge';

type Tab = 'generations' | 'references' | 'library';
interface Item { path: string; thumb?: string; label?: string }

const fileUrl = (p: string) => `hjen-file://${encodeURI(p)}`;
const MONO = 'var(--font-mono, ui-monospace, monospace)';

export function ProjectAssetPicker({ onClose, onAttach }: { onClose: () => void; onAttach: (paths: string[]) => void }) {
  const projects = useStore(s => s.projects);
  const activeProjectId = useStore(s => s.activeProjectId);
  const library = useStore(s => s.library);
  const loadLibrary = useStore(s => s.loadLibrary);
  const uploadToLibrary = useStore(s => s.uploadToLibrary);

  const [tab, setTab] = useState<Tab>('generations');
  // Which project's generations we're browsing — defaults to the open one, else newest.
  const [projId, setProjId] = useState<string | null>(activeProjectId || (projects[0]?.id ?? null));
  const [projMenu, setProjMenu] = useState(false);
  const [gens, setGens] = useState<Item[]>([]);
  const [refs, setRefs] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const selProject: ProjectMeta | null = useMemo(() => projects.find(p => p.id === projId) ?? null, [projects, projId]);

  // Load the chosen project's generations: durable outputs (frames, video posters,
  // storyboard-made frames, enhancer/chain — all logged) MERGED with storyboard
  // takes, deduped by absolute path so nothing the project made is missed.
  useEffect(() => {
    if (tab !== 'generations' || !selProject) { setGens([]); return; }
    let dead = false;
    (async () => {
      setLoading(true);
      const byPath = new Map<string, Item>();
      try {
        const files = await window.hjen.listProjectFiles({ projectSlug: selProject.slug });
        for (const f of (files || [])) if (f?.imgPath) byPath.set(f.imgPath, { path: f.imgPath, thumb: f.thumbPath || f.imgPath, label: f.promptTitle });
      } catch { /* empty */ }
      try {
        const sb: any = await window.hjen.readStoryboard({ id: selProject.id });
        for (const sh of (sb?.shots || [])) {
          const cap = `shot ${String(sh.scene ?? '')}${sh.letter ?? ''}`.trim();
          for (const t of (sh.takes || [])) if (t?.imgPath && !byPath.has(t.imgPath)) byPath.set(t.imgPath, { path: t.imgPath, thumb: t.thumbPath || t.imgPath, label: cap });
          if (sh.generatedImagePath && !byPath.has(sh.generatedImagePath)) byPath.set(sh.generatedImagePath, { path: sh.generatedImagePath, thumb: sh.thumbPath || sh.generatedImagePath, label: cap });
        }
      } catch { /* empty */ }
      if (!dead) { setGens([...byPath.values()]); setLoading(false); }
    })();
    return () => { dead = true; };
  }, [tab, selProject]);

  // References live in stage 2 of the project contract — the same set the
  // References view shows, so a frame clipped from the browser is attachable
  // the moment it lands. The tag is its caption: it says where it came from.
  useEffect(() => {
    if (tab !== 'references' || !selProject) { setRefs([]); return; }
    let dead = false;
    (async () => {
      setLoading(true);
      let out: Item[] = [];
      try {
        const data: any = await window.hjen.readStageData({ id: selProject.id, stage: 2 });
        out = (data?.refs || [])
          .filter((r: any) => r?.imagePath)
          .map((r: any) => ({ path: r.imagePath, thumb: r.imagePath, label: r.sourceName || r.tag }));
      } catch { /* empty */ }
      if (!dead) { setRefs(out); setLoading(false); }
    })();
    return () => { dead = true; };
  }, [tab, selProject]);

  useEffect(() => { if (tab === 'library') void loadLibrary(); }, [tab, loadLibrary]);

  const libItems: Item[] = useMemo(
    () => (library || []).filter(a => /\.(png|jpe?g|webp|gif)$/i.test(a.filePath)).map(a => ({ path: a.filePath, thumb: a.thumbPath || a.filePath, label: a.category })),
    [library],
  );
  const items = tab === 'generations' ? gens : tab === 'references' ? refs : libItems;
  const toggle = (p: string) => setPicked(s => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; });
  const attach = () => { if (picked.size) onAttach([...picked]); onClose(); };
  async function upload() {
    setUploading(true);
    try { await uploadToLibrary('general'); } catch { /* cancelled */ }
    finally { setUploading(false); }
  }

  return (
    <div style={scrim} onClick={onClose}>
      <div style={panel} onClick={e => e.stopPropagation()}>
        <header style={head}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.5, marginInlineEnd: 4 }}>Attach from</span>
            {([['generations', 'Generations'], ['references', 'References'], ['library', 'Library']] as [Tab, string][]).map(([id, l]) => (
              <button key={id} onClick={() => setTab(id)} style={{ ...pill, ...(tab === id ? pillOn : {}) }}>{l}</button>
            ))}
          </div>
          <button onClick={onClose} style={xBtn} title="Close">✕</button>
        </header>

        {/* Sub-bar: project selector (project-scoped tabs) or Upload (Library) */}
        <div style={subbar}>
          {tab !== 'library' ? (
            <div style={{ position: 'relative' }}>
              <button style={projBtn} onClick={() => setProjMenu(v => !v)} title="Pick a project">
                <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.5 }}>project</span>
                <span style={{ fontWeight: 500 }}>{selProject?.name || 'none'}</span>
                <svg width="9" height="9" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" style={{ opacity: 0.5 }}><path d="M1 1l4 4 4-4" /></svg>
              </button>
              {projMenu && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 8 }} onClick={() => setProjMenu(false)} />
                  <div style={projMenuBox}>
                    {projects.map(p => (
                      <button key={p.id} onClick={() => { setProjId(p.id); setProjMenu(false); }} style={{ ...projItem, ...(p.id === projId ? projItemOn : {}) }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                        {p.id === activeProjectId && <span style={openTag}>open</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <button style={uploadBtn} onClick={upload} disabled={uploading}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V6M5 12l7-7 7 7" /></svg>
              {uploading ? 'Uploading…' : 'Upload to library'}
            </button>
          )}
        </div>

        <div style={grid}>
          {loading && <div style={hint}>Loading…</div>}
          {!loading && items.length === 0 && (
            <div style={hint}>{
              tab === 'library' ? 'Library is empty — use Upload above.'
                : !selProject ? 'No project selected.'
                : tab === 'generations' ? `No generations yet in ${selProject.name}.`
                : `No references yet in ${selProject.name} — hunt, import, or clip them from the browser.`
            }</div>
          )}
          {!loading && items.map((it, i) => {
            const on = picked.has(it.path);
            return (
              <button key={it.path + i} onClick={() => toggle(it.path)} style={{ ...tile, ...(on ? tileOn : {}) }} title={it.label || it.path}>
                <img src={fileUrl(it.thumb || it.path)} alt="" style={img} loading="lazy" />
                {on && <span style={check}>✓</span>}
                {it.label && <span style={cap}>{it.label}</span>}
              </button>
            );
          })}
        </div>

        <footer style={foot}>
          <span style={{ fontSize: 11.5, opacity: 0.6, fontFamily: MONO }}>{picked.size} selected</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={ghostBtn}>Cancel</button>
            <button onClick={attach} disabled={!picked.size} style={{ ...attachBtn, opacity: picked.size ? 1 : 0.4 }}>Attach</button>
          </div>
        </footer>
      </div>
    </div>
  );
}

const scrim: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,.5)', display: 'grid', placeItems: 'center' };
const panel: React.CSSProperties = { width: 'min(640px, 92vw)', height: 'min(74vh, 660px)', display: 'flex', flexDirection: 'column', background: 'var(--panel, #16191e)', border: '1px solid var(--hair, #2a2f36)', borderRadius: 14, overflow: 'hidden', color: 'var(--ink, #e8e6e1)', boxShadow: '0 24px 70px rgba(0,0,0,.55)' };
const head: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid var(--hair, #22262c)' };
const pill: React.CSSProperties = { padding: '5px 13px', borderRadius: 999, border: '1px solid var(--hair, #2a2f36)', background: 'var(--bg, #0c0e11)', color: 'inherit', cursor: 'pointer', fontSize: 12, opacity: 0.6 };
const pillOn: React.CSSProperties = { border: '1.5px solid var(--ink, #e8e6e1)', opacity: 1, fontWeight: 500 };
const xBtn: React.CSSProperties = { width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent', color: 'inherit', opacity: 0.6, cursor: 'pointer', fontSize: 13 };
const subbar: React.CSSProperties = { display: 'flex', alignItems: 'center', padding: '9px 14px 3px', minHeight: 40 };
const projBtn: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--hair, #2a2f36)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12.5, maxWidth: 320 };
const projMenuBox: React.CSSProperties = { position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 9, width: 260, maxHeight: 320, overflowY: 'auto', padding: 5, background: 'var(--bg, #0c0e11)', border: '1px solid var(--hair, #2a2f36)', borderRadius: 10, boxShadow: '0 16px 44px rgba(0,0,0,.55)' };
const projItem: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, width: '100%', padding: '8px 10px', border: 'none', borderRadius: 7, background: 'transparent', color: 'inherit', cursor: 'pointer', textAlign: 'start', fontSize: 12.5 };
const projItemOn: React.CSSProperties = { background: 'var(--panel, #16191e)' };
const openTag: React.CSSProperties = { fontSize: 8.5, fontFamily: MONO, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.5, border: '1px solid var(--hair, #2a2f36)', borderRadius: 999, padding: '1px 6px', flex: '0 0 auto' };
const uploadBtn: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 7, padding: '7px 13px', borderRadius: 8, border: '1px solid var(--hair, #2a2f36)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12.5 };
// Uniform, non-overlapping grid: every cell is a perfect square that keeps its
// height regardless of the generation's own aspect. The square is enforced with
// the padding-bottom:100% technique (padding-% is relative to the cell WIDTH),
// NOT aspect-ratio — an absolutely-positioned image removes itself from flow, so
// aspect-ratio stops contributing a row height and the tiles collapse/overlap.
// padding-bottom gives the grid a real box height, so rows never stack.
const grid: React.CSSProperties = { flex: 1, overflowY: 'auto', padding: '10px 16px 14px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: 10, alignContent: 'start' };
const hint: React.CSSProperties = { gridColumn: '1 / -1', textAlign: 'center', opacity: 0.5, fontSize: 12.5, padding: '32px 0' };
const tile: React.CSSProperties = { position: 'relative', width: '100%', height: 0, padding: '0 0 100% 0', minWidth: 0, borderRadius: 9, border: '1px solid var(--hair, #2a2f36)', background: 'var(--bg, #0c0e11)', cursor: 'pointer', overflow: 'hidden' };
const tileOn: React.CSSProperties = { border: '2px solid var(--ink, #e8e6e1)' };
const img: React.CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' };
const check: React.CSSProperties = { position: 'absolute', top: 5, insetInlineEnd: 5, width: 18, height: 18, borderRadius: 999, background: 'var(--ink, #e8e6e1)', color: 'var(--bg, #0c0e11)', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700 };
const cap: React.CSSProperties = { position: 'absolute', left: 0, right: 0, bottom: 0, padding: '3px 6px', fontSize: 9.5, fontFamily: MONO, letterSpacing: '0.04em', textTransform: 'uppercase', background: 'linear-gradient(transparent, rgba(0,0,0,.75))', color: '#fff', textAlign: 'start', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
const foot: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px', borderTop: '1px solid var(--hair, #22262c)' };
const ghostBtn: React.CSSProperties = { padding: '8px 15px', borderRadius: 9, border: '1px solid var(--hair, #2a2f36)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12.5 };
const attachBtn: React.CSSProperties = { padding: '8px 18px', borderRadius: 9, border: '1px solid var(--ink, #e8e6e1)', background: 'var(--ink, #e8e6e1)', color: 'var(--bg, #0c0e11)', cursor: 'pointer', fontSize: 12.5, fontWeight: 600 };
