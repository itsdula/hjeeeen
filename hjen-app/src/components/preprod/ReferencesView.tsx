// References — الباحث البصري. Anwar's redesign (2026-07-08): references are
// NOT model-invented citations. TAGS are extracted from the previous stages
// (brief → idea → treatment → story), each tag is hunted on real reference
// sites (Frameset & friends) inside a VISIBLE browser window the user can
// watch and log into, a vision pass judges fit-to-story, and the chosen
// frames are DOWNLOADED into {project}/_references/ and shown here as cards.
//
// House laws live here as code:
//  - The hunt window is real — the user logs in once, the session persists.
//  - Every kept frame carries why / take / leave — a frame without a Leave
//    line is an imitation trap.
//  - The set law: at least 5 hunted frames before signing.
//  - MADE not Generate — verbs here are Extract / Hunt / Open / Keep / Save.

import { useEffect, useMemo, useRef, useState } from 'react';
import '../../styles/preprod-references.css';
import { useStore } from '../../store';
import { useHunt } from '../../store/huntStore';
import { hjenFileUrl } from '../../lib/theme/apply';
import { PreprodShell, useStageData, Busy, useToast } from './shared';
import { getPOV, craftQueries } from '../../lib/creative360';
import { EYE_REGISTERS, type Register } from '../../lib/eye/types';
import type { SearchIntent, Strictness } from '../../lib/creative360';
import { ReferenceImportOverlay, type ImportItem } from './ReferenceImportOverlay';
import { ReferenceExportOverlay, type RefExportConfig } from './ReferenceExportOverlay';
import { buildReferencesPdf, refExportFiles, refNotesCsv, defaultExportName } from '../../lib/referencesExport';
import { HJEN_REF_MIME, setRefDragPayload, type PendingMedia } from '../../lib/dock/dragPayload';
import { RefDock } from '../dock/RefDock';
import type { PanelKind } from '../../lib/dock/usePanelDoc';
import { bytesToBase64 } from '../../lib/pdfPack';
import type { ReferencesData, RefSource, HuntedRef, RefPalette } from '../../types/preprod';
import { syncStagesToCreativeGraph } from '../../lib/creativegraph/stageSync';
import { nodeOf } from '../../lib/creativegraph/projectGraph';
import type { ReferenceProjection } from '../../lib/creativegraph/technicalCompiler';

type ImageType = 'frames' | 'motion';

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'tag';

const PALETTES: RefPalette[] = ['warm', 'cool', 'colorful', 'mid'];

// The internal Saudi library is a BUILT-IN source: no URL, not deletable,
// search-only (never browsable). It leads the list and is on by default.
const HJEN_REF_ID = 'hjen-ref';

const DEFAULT_SOURCES: RefSource[] = [
  { id: HJEN_REF_ID, name: 'HJEN REF', urlTemplate: '', enabled: true },
  { id: 'frameset', name: 'Frameset', urlTemplate: 'https://frameset.app/search?q={query}', enabled: true },
  { id: 'filmgrab', name: 'Film Grab', urlTemplate: 'https://film-grab.com/?s={query}', enabled: false },
  { id: 'shotcafe', name: 'Shot Cafe', urlTemplate: 'https://shot.cafe/search?q={query}', enabled: false },
];

const EMPTY: ReferencesData = { tags: [], intents: [], registers: [], perTag: 2, lanes: 4, strictness: 'strict', imageType: 'frames', sources: DEFAULT_SOURCES, refs: [] };
const MAX_LANES = 8;

// ─── the view ───────────────────────────────────────────────────────────────

export function ReferencesView() {
  const projectId = useStore(st => st.activeProjectId);
  const projects = useStore(st => st.projects);
  const addLedger = useStore(st => st.addLedgerEntry);
  const { data, loaded, update, saveNow } = useStageData<ReferencesData>(2, EMPTY);
  const [toast, showToast] = useToast();
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState('');
  const [srcDraft, setSrcDraft] = useState({ name: '', urlTemplate: '' });
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportingSet, setExportingSet] = useState(false);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [highlightId, setHighlightId] = useState<string | null>(null);   // one tile focused at a time
  const [confirmDel, setConfirmDel] = useState<string[] | null>(null);
  const [undoNote, setUndoNote] = useState<string | null>(null);
  const undoStack = useRef<HuntedRef[][]>([]);       // snapshots of refs[] before each destructive op
  const undoTimer = useRef<number | null>(null);
  const [refIndex, setRefIndex] = useState<{ ok: boolean; frames: number } | null>(null);   // HJEN REF library status
  const [draggingIds, setDraggingIds] = useState<string[]>([]);   // tiles currently in a native drag
  const [dock, setDock] = useState<PanelKind | null>(null);       // Mood Board / Timeline, open over the board
  const [pendingMedia, setPendingMedia] = useState<PendingMedia[] | null>(null);

  // ── the background hunt (project-scoped store) — the view only observes it ──
  const huntRunning = useHunt(s => s.running);
  const huntProjectId = useHunt(s => s.projectId);
  const huntRefsVersion = useHunt(s => s.refsVersion);
  const huntToast = useHunt(s => s.toast);
  const activeHuntHere = huntRunning && huntProjectId === projectId;

  const projectSlug = projects.find(p => p.id === projectId)?.slug ?? null;
  const tags = data.tags ?? [];                 // searchable queries
  const intents = data.intents ?? [];           // parallel: creative intent per query
  const registers = data.registers ?? [];       // parallel: the feeling the eye ranks by
  const perTag = Math.min(6, Math.max(1, data.perTag ?? 2));
  const lanes = Math.min(MAX_LANES, Math.max(1, data.lanes ?? 4));
  const strictness: Strictness = data.strictness === 'lenient' ? 'lenient' : 'strict';
  const imageType: ImageType = data.imageType === 'motion' ? 'motion' : 'frames';
  // HJEN REF is always present and FIRST, even before the migration effect
  // persists it into older projects (derived so the UI never flickers).
  const storedSources = data.sources ?? DEFAULT_SOURCES;
  const sources = storedSources.some(s => s.id === HJEN_REF_ID)
    ? storedSources
    : [{ id: HJEN_REF_ID, name: 'HJEN REF', urlTemplate: '', enabled: true } as RefSource, ...storedSources];
  const refs = data.refs ?? [];
  // browser sources = real search sites driven over CDP (exclude the internal lib).
  const enabledSources = sources.filter(s => s.id !== HJEN_REF_ID && s.enabled && s.urlTemplate.includes('{query}'));
  const hjenRefEnabled = sources.some(s => s.id === HJEN_REF_ID && s.enabled);
  const intentFor = (tag: string): string => {
    const i = tags.indexOf(tag);
    return i >= 0 ? (intents[i] || '') : '';
  };
  // The feeling behind a tag — kept parallel to tags[], like intents. Anything
  // outside the eye's vocabulary is dropped rather than guessed.
  const registerFor = (tag: string): Register | null => {
    const i = tags.indexOf(tag);
    const v = i >= 0 ? String(registers[i] ?? '').toLowerCase() : '';
    return (EYE_REGISTERS as string[]).includes(v) ? (v as Register) : null;
  };

  // ── sign warnings ──
  const warnings = useMemo(() => {
    const w: Array<{ body: string }> = [];
    if (tags.length === 0) w.push({ body: 'No tags yet — extract them from the previous stages first.' });
    if (refs.length < 5) w.push({ body: 'The set is under five frames — the hunt law is ≥5.' });
    const noWhy = refs.filter(r => !(r.why || '').trim()).length;
    if (noWhy > 0) w.push({ body: `${noWhy} frame(s) with no Why line — every kept frame carries its fit-to-story reason.` });
    const noTakeLeave = refs.filter(r => !(r.take || '').trim() || !(r.leave || '').trim()).length;
    if (noTakeLeave > 0) w.push({ body: `${noTakeLeave} frame(s) missing Take or Leave — a frame without a Leave line is an imitation trap.` });
    return w;
  }, [tags, refs]);

  // ── HJEN REF: read the internal library's status once (zero network). ──
  useEffect(() => {
    let live = true;
    window.hjen.refStatus()
      .then(r => { if (live) setRefIndex(r.ok ? { ok: true, frames: r.frames } : { ok: false, frames: 0 }); })
      .catch(() => { if (live) setRefIndex({ ok: false, frames: 0 }); });
    return () => { live = false; };
  }, []);

  // ── migrate older projects: inject the built-in HJEN REF source (enabled)
  //    if it isn't persisted yet, so the toggle sticks across sessions. ──
  useEffect(() => {
    if (!loaded) return;
    const ss = data.sources;
    if (ss && !ss.some(s => s.id === HJEN_REF_ID)) {
      update({ sources: [{ id: HJEN_REF_ID, name: 'HJEN REF', urlTemplate: '', enabled: true }, ...ss] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // ── LIVE board refresh: when the background hunt flushes a keeper to disk it
  //    bumps refsVersion; merge the new frames into the view WITHOUT clobbering
  //    the user's in-progress edits (append by id, keep existing verbatim). ──
  const dataRef = useRef(data);
  dataRef.current = data;
  useEffect(() => {
    if (huntRefsVersion === 0 || !projectId) return;
    let live = true;
    window.hjen.readStageData({ id: projectId, stage: 2 }).then(disk => {
      if (!live) return;
      const diskRefs = (disk as ReferencesData | null)?.refs ?? [];
      const cur = dataRef.current.refs ?? [];
      const have = new Set(cur.map(r => r.id));
      const incoming = diskRefs.filter(r => !have.has(r.id));
      if (incoming.length) update({ refs: [...cur, ...incoming] });
    }).catch(() => { /* leave the board as-is */ });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [huntRefsVersion]);

  // ── CLIPPED FROM THE BROWSER: the extension posts a web frame through the
  //    localhost door; MAIN writes it into _references/ + stage 2 and fires
  //    this. Same merge discipline as the hunt — append by id, never clobber
  //    the Why/Take/Leave lines being typed in this view right now. ──
  useEffect(() => {
    const onClip = (e: Event) => {
      const pid = (e as CustomEvent<{ projectId?: string }>).detail?.projectId;
      if (!projectId || (pid && pid !== projectId)) return;
      window.hjen.readStageData({ id: projectId, stage: 2 }).then(disk => {
        const diskRefs = (disk as ReferencesData | null)?.refs ?? [];
        const cur = dataRef.current.refs ?? [];
        const have = new Set(cur.map(r => r.id));
        const incoming = diskRefs.filter(r => !have.has(r.id));
        if (!incoming.length) return;
        update({ refs: [...cur, ...incoming] });
        showToast(`${incoming.length} frame${incoming.length === 1 ? '' : 's'} clipped from the browser — write each Why and Leave line.`);
      }).catch(() => { /* leave the board as-is */ });
    };
    window.addEventListener('hjen:references-reload', onClip);
    return () => window.removeEventListener('hjen:references-reload', onClip);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, showToast]);

  // ── surface the hunt's toasts (login/quota, done, stopped) in this view ──
  useEffect(() => { if (huntToast) showToast(huntToast.msg); }, [huntToast?.id, showToast]);

  // ── tag mutations (keep intents[] parallel to tags[]) ──
  const removeTag = (t: string) => {
    const i = tags.indexOf(t);
    if (i < 0) return;
    update({
      tags: tags.filter((_, k) => k !== i),
      intents: intents.filter((_, k) => k !== i),
      registers: registers.filter((_, k) => k !== i),
    });
  };
  const addTag = () => {
    const t = tagDraft.trim();
    if (!t) return;
    if (!tags.includes(t)) update({ tags: [...tags, t], intents: [...intents, 'Added by hand'], registers: [...registers, null] });
    setTagDraft('');
  };

  // ── source mutations ──
  const setSource = (id: string, patch: Partial<RefSource>) =>
    update({ sources: sources.map(s => (s.id === id ? { ...s, ...patch } : s)) });
  const deleteSource = (id: string) => update({ sources: sources.filter(s => s.id !== id) });
  const addSource = () => {
    const name = srcDraft.name.trim();
    const urlTemplate = srcDraft.urlTemplate.trim();
    if (!name || !urlTemplate) return;
    update({ sources: [...sources, { id: uid(), name, urlTemplate, enabled: true }] });
    setSrcDraft({ name: '', urlTemplate: '' });
  };

  // ── ref mutations ──
  const setRef = (id: string, patch: Partial<HuntedRef>) =>
    update({ refs: refs.map(r => (r.id === id ? { ...r, ...patch } : r)) });

  // ── undo — a capped stack of refs[] snapshots over destructive ops. Text
  //    edits keep the browser's native per-field undo; this stack is only for
  //    ref-list mutations (delete one, delete many). ──
  const pushUndo = () => {
    undoStack.current.push(refs.map(r => ({ ...r })));
    if (undoStack.current.length > 20) undoStack.current.shift();
  };
  const undo = () => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    update({ refs: prev });
    setSelected(new Set());
    setUndoNote(null);
  };
  const deleteRefs = (ids: string[]) => {
    if (ids.length === 0) return;
    pushUndo();
    const kill = new Set(ids);
    update({ refs: refs.filter(r => !kill.has(r.id)) });
    setSelected(new Set());
    const n = ids.length;
    setUndoNote(`${n} frame${n === 1 ? '' : 's'} removed`);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndoNote(null), 7000);
    void addLedger({ kind: 'note', body: `References: removed ${n} frame(s) from the set.` });
  };
  const deleteRef = (id: string) => deleteRefs([id]);

  // ── selection over the board ──
  const toggleSelect = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const clearSelection = () => setSelected(new Set());
  const selectAll = () => setSelected(new Set(refs.map(r => r.id)));

  // Hand the current selection to a panel without a drag. A drag can fail for
  // reasons outside this app's control; putting a frame on a board must not.
  const sendSelectionTo = (kind: PanelKind) => {
    const byId = new Map(refs.map(r => [r.id, r]));
    const picked = [...selected].map(id => byId.get(id)).filter(Boolean) as HuntedRef[];
    if (!picked.length) return;
    setPendingMedia(picked.map(r => ({ src: r.imagePath, label: r.tag, refId: r.id })));
    setDock(kind);
    showToast(`${picked.length} frame${picked.length === 1 ? '' : 's'} sent.`);
  };

  // ── native drag-out — a frame is a FILE, and it should behave like one ──
  //    Dragging a SELECTED tile drags the WHOLE selection; dragging an
  //    unselected tile drags just that frame and does NOT change the selection
  //    (a drag is not a click — the same rule NodeView.startNodeDrag follows).
  const refsRef = useRef(refs);
  refsRef.current = refs;
  const onTileDragStart = (e: React.DragEvent, id: string) => {
    // The corner check is a click target, never a drag handle.
    if ((e.target as HTMLElement).closest('.ppr-tile__check')) { e.preventDefault(); return; }

    const ids = selected.has(id) && selected.size > 1 ? [...selected] : [id];
    const byId = new Map(refsRef.current.map(r => [r.id, r]));
    const picked = ids.map(i => byId.get(i)).filter(Boolean) as HuntedRef[];
    const paths = picked.map(r => r.imagePath).filter(Boolean);
    if (paths.length === 0) { e.preventDefault(); return; }

    // Stash the rich payload (tag, why, take, leave) where a drop target in
    // THIS document can read it — dataTransfer is about to be thrown away.
    setRefDragPayload(picked);
    try { e.dataTransfer.setData(HJEN_REF_MIME, JSON.stringify({ ids })); } catch { /* cancelled below anyway */ }

    // THE CANCEL. Chromium is about to open its own HTML5 drag session for this
    // mouse-down, whose payload can only ever be in-page data or a bitmap — it
    // can never hand Finder a real file. webContents.startDrag opens a native
    // AppKit session for the actual paths instead. One mouse-down cannot own
    // two drag sessions; if the HTML5 one is allowed to start, it wins.
    e.preventDefault();
    setDraggingIds(ids);
    // Fire-and-forget: the invoke resolves only when the drag ENDS, so awaiting
    // it here would stall the handler for the whole gesture. And because the
    // HTML5 session never started, `dragend` never fires — this promise
    // settling is the only reliable "the drag is over" signal there is.
    void window.hjen.startDrag(paths)
      .then(r => { if (!r.ok) showToast(r.message); })
      .catch(() => { /* the gesture was its own feedback */ })
      .finally(() => setDraggingIds([]));
  };

  // ── IMPORT — copy chosen frames (device / generations / storyboard / library)
  //    into {project}/_references/ and add them as refs the user then annotates.
  const importFrames = async (items: ImportItem[]) => {
    if (!projectSlug) { showToast('No project folder — pick a project first.'); return; }
    if (items.length === 0 || importing) return;
    setImporting(true); setError(null);
    const seenPaths = new Set(refs.map(r => r.imageUrl).filter(Boolean) as string[]);
    const added: HuntedRef[] = [];
    let failed = 0;
    for (const it of items) {
      if (seenPaths.has(it.path)) continue;            // already in the set
      try {
        const dataUrl = await window.hjen.readImageDataUrl(it.path);
        const base64 = dataUrl?.includes(',') ? dataUrl.split(',')[1] : null;
        if (!base64) { failed++; continue; }
        const saved = await window.hjen.saveImageBase64({
          base64, projectSlug, fileName: `import_${slugify(it.source)}_${uid()}`, subfolder: '_references',
        });
        if (!saved.ok) { failed++; continue; }
        seenPaths.add(it.path);
        added.push({
          id: uid(),
          tag: it.source.toLowerCase(),
          intent: `Imported from ${it.source}`,
          imagePath: saved.path,
          imageUrl: it.path,
          sourceName: it.source,
          why: '', take: '', leave: '', palette: 'mid',
        });
      } catch { failed++; }
    }
    if (added.length > 0) {
      update({ refs: [...refs, ...added] });
      void addLedger({ kind: 'note', body: `References: imported ${added.length} frame(s) by hand${failed ? ` (${failed} failed)` : ''}.` });
    }
    setImporting(false);
    setImportOpen(false);
    showToast(added.length > 0
      ? `${added.length} frame(s) imported — add each Why and Leave line.`
      : (failed ? 'Could not read the chosen files.' : 'Those frames are already in the set.'));
  };

  // ── EXPORT — the set leaves the app. Two exits in one act: a PDF of the
  //    board (cover + the chosen layout, carrying Why / Take / Leave) and a
  //    folder of the frames copied VERBATIM — a GIF stays a GIF. Only the PDF
  //    flattens a moving frame to its first frame; the folder never does.
  const exportSet = async (cfg: RefExportConfig) => {
    if (cfg.refs.length === 0 || exportingSet) return;
    setError(null);
    const projectName = projects.find(p => p.id === projectId)?.name ?? 'References';
    const folder = await window.hjen.pickExportFolder({
      projectSlug: projectSlug ?? undefined,
      tool: 'References',
      title: 'Export the references into…',
    });
    if (!folder) return;                                  // cancelled the dialog
    setExportingSet(true);
    try {
      const pdfBase64 = cfg.wantPdf
        ? bytesToBase64(await buildReferencesPdf(cfg.refs, { title: projectName, layout: cfg.layout }))
        : null;
      const res = await window.hjen.exportReferences({
        folder,
        baseName: cfg.baseName,
        // a PDF on its own lands in the chosen folder; frames get their own folder
        subfolder: cfg.wantFiles,
        files: cfg.wantFiles ? refExportFiles(cfg.refs) : [],
        pdfBase64,
        notesCsv: cfg.wantNotes ? refNotesCsv(cfg.refs) : null,
      });
      if (!res.ok) { setError(res.reason || 'Export failed.'); return; }
      const parts: string[] = [];
      if (cfg.wantFiles) parts.push(`${res.written ?? 0} frame${(res.written ?? 0) === 1 ? '' : 's'}`);
      if (cfg.wantPdf) parts.push('the PDF');
      if (cfg.wantNotes) parts.push('the notes sheet');
      const skipped = res.skipped ?? 0;
      showToast(`Exported ${parts.join(' + ')}${skipped ? ` — ${skipped} file(s) missing on disk` : ''}.`);
      void addLedger({ kind: 'note', body: `References: exported ${cfg.refs.length} frame(s)${cfg.wantPdf ? ` as a ${cfg.layout} PDF` : ''} to ${res.dir ?? folder}.` });
      setExportOpen(false);
      if (res.dir) window.hjen.openFolder(res.dir).catch(() => { /* the files are written either way */ });
    } catch (e) {
      setError(String((e as Error)?.message || e).slice(0, 300));
    } finally {
      setExportingSet(false);
    }
  };

  // ── extract queries via the Creative 360 mind (POV → intents → queries) ──
  const extractTags = async () => {
    if (!projectId || extracting) return;
    setExtracting(true); setError(null);
    try {
      const graph = await syncStagesToCreativeGraph(projectId);
      const handoff = nodeOf<ReferenceProjection>(graph, 'projection:references')?.payload;
      const flatTags: string[] = [...tags];
      const flatIntents: string[] = [...intents];
      const flatRegisters: Array<string | null> = [...registers];
      let added = 0;
      for (const intent of handoff?.intents ?? []) {
        const query = intent.querySeed.split(/\s+/).slice(0, 8).join(' ').trim();
        if (query && !flatTags.includes(query)) {
          flatTags.push(query);
          flatIntents.push(`${intent.purpose} · TAKE: ${intent.take} · LEAVE: ${intent.leave}`);
          flatRegisters.push(null);
          added++;
        }
      }
      const pov = await getPOV(projectId);
      if (!pov && added === 0) {
        showToast('Nothing to read yet — make Brief Mind / Treatment / Story first.');
        setExtracting(false); return;
      }
      const found: SearchIntent[] = pov ? await craftQueries(pov) : [];
      for (const si of found) {
        for (const q of si.queries) {
          if (!flatTags.includes(q)) { flatTags.push(q); flatIntents.push(si.intent); flatRegisters.push(si.register ?? null); added++; }
        }
      }
      if (added === 0) {
        setError('The mind returned no new queries — try again or add by hand.');
      } else {
        update({ tags: flatTags, intents: flatIntents, registers: flatRegisters });
        showToast(`${added} searchable quer${added === 1 ? 'y' : 'ies'} crafted — edit before the hunt.`);
      }
    } catch (e) {
      setError(String((e as Error)?.message || e));
    }
    setExtracting(false);
  };

  // ── open the user's real Chrome (dedicated HJEN profile) so they can log
  //    into Frameset once; the session persists for every hunt after. ──
  const firstHome = (): string => {
    // browser sources only — the internal lib has no URL to open.
    const first = enabledSources[0] ?? sources.find(s => s.id !== HJEN_REF_ID && s.urlTemplate.includes('{query}'));
    if (!first) return 'https://frameset.app';
    try { return new URL(first.urlTemplate.replace('{query}', 'x')).origin; } catch { return first.urlTemplate; }
  };
  const openHuntWindow = async () => {
    const r = await window.hjen.chromeLaunch({ url: firstHome() });
    if (!r.ok) showToast(r.message || 'Could not open Chrome.');
    else showToast('Chrome open — log into Frameset once; it stays for every hunt.');
  };
  const closeHuntWindow = () => { void window.hjen.chromeClose(); };

  // ── THE HUNT lives in the project-scoped store (src/store/huntStore.ts) so it
  //    survives navigation. The view only KICKS IT OFF and observes its state. ──
  const startHunt = () => {
    if (!projectId || !projectSlug) { showToast('No project folder — pick a project first.'); return; }
    if (tags.length === 0) { showToast('No queries — extract or add them first.'); return; }
    const browserSources = enabledSources;
    const useRefLib = hjenRefEnabled && refIndex?.ok === true;
    if (imageType === 'motion' && useRefLib && browserSources.length === 0) {
      showToast('HJEN REF is stills-only — enable Frameset for motion.'); return;
    }
    if (browserSources.length === 0 && !useRefLib) {
      showToast('No enabled source — turn on HJEN REF or a search site.'); return;
    }
    const r = useHunt.getState().start({
      projectId,
      projectName: projects.find(p => p.id === projectId)?.name ?? 'this project',
      projectSlug,
      tags: [...tags],
      intentFor,
      registerFor,
      perTag, laneCount: lanes, strictness, imageType,
      browserSources, useRefLib, seedRefs: refs,
    });
    if (!r.ok) showToast(`A hunt is running on «${r.busyProject}» — stop it first.`);
  };
  const stopHunt = () => useHunt.getState().stop();

  // ── board keyboard: select-all / delete / undo / clear. The lightbox owns
  //    the keyboard while it is open (its own effect handles ESC + arrows), and
  //    no shortcut fires while typing in a field — Cmd+A/Cmd+Z keep their native
  //    text behaviour there. ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (lightboxId) return;                      // lightbox handles its own keys
      if (importOpen || exportOpen) return;        // an overlay owns the keyboard while open
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable);
      const meta = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (meta && key === 'z') { if (typing) return; e.preventDefault(); undo(); return; }
      // Cmd/Ctrl+A only extends an existing selection — with nothing selected it does nothing.
      if (meta && key === 'a') { if (typing || selected.size < 1) return; e.preventDefault(); selectAll(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (typing || confirmDel) return;
        if (selected.size > 0) { e.preventDefault(); setConfirmDel([...selected]); }
        return;
      }
      if (e.key === 'Escape') {
        if (typing) return;
        if (confirmDel) { setConfirmDel(null); return; }
        if (selected.size > 0) { setSelected(new Set()); return; }
        if (highlightId) setHighlightId(null);         // clear the highlight once nothing's selected
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refs, selected, highlightId, lightboxId, confirmDel, importOpen, exportOpen]);

  // clear the undo-toast timer on unmount
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

  return (
    <PreprodShell
      tool="References"
      sub="Query-hunted frames from your logged-in browser"
      accent="#257D64"
      stage={2}
      signWarnings={warnings}
      beforeSign={() => saveNow()}
      actions={
        <>
          <button className="pp-btn pp-btn--ghost" onClick={() => setDock('moodboard')}>Mood Board</button>
          <button className="pp-btn pp-btn--ghost" onClick={() => setDock('timeline')}>Timeline</button>
        </>
      }
    >
      {!loaded ? (
        <div className="pp-gate"><Busy label="Reading stage 02…" /></div>
      ) : (
        <div className="pp-grid">
          <aside className="pp-aside">
            {/* ── 1 · TAGS ─────────────────────────────────── */}
            <div className="pp-panel">
              <div className="pp-panel__head">
                <span className="pp-panel__title mono-label">QUERIES</span>
                <span className="ppr-panel-sub">The mind crafts · you edit</span>
              </div>
              {tags.length === 0 && (
                <div className="ppr-empty">No queries yet — Extract to have the Creative 360 mind craft searchable queries from the story, or add by hand.</div>
              )}
              {tags.length > 0 && (
                <div className="ppr-tags">
                  {tags.map(t => (
                    <span key={t} className="ppr-tag" title={intentFor(t) || undefined}>
                      {t}
                      <button className="ppr-tag__x" title="Remove query" onClick={() => removeTag(t)}>×</button>
                    </span>
                  ))}
                </div>
              )}
              <div className="ppr-tagadd">
                <input
                  className="pp-input ppr-tagadd__input"
                  value={tagDraft}
                  placeholder="tungsten kitchen night…"
                  onChange={e => setTagDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addTag(); }}
                />
                <button className="pp-btn pp-btn--ghost" onClick={addTag}>+ Add</button>
              </div>
              <button
                className="pp-btn pp-btn--accent ppr-widebtn"
                disabled={extracting || !projectId}
                onClick={() => void extractTags()}
              >
                {extracting ? <Busy label="Reading the stages…" /> : 'Extract tags'}
              </button>
            </div>

            {/* ── 2 · SOURCES ──────────────────────────────── */}
            <div className="pp-panel">
              <div className="pp-panel__head">
                <span className="pp-panel__title mono-label">SOURCES</span>
                <span className="ppr-panel-sub">Where the hunt runs</span>
              </div>
              {sources.map(s => s.id === HJEN_REF_ID ? (
                // Internal Saudi library — search-only, no URL, not deletable.
                <div key={s.id} className={`ppr-source ppr-source--internal${s.enabled ? '' : ' is-off'}`}>
                  <button
                    className={`ppr-source__toggle${s.enabled ? ' is-on' : ''}`}
                    title={s.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
                    onClick={() => setSource(s.id, { enabled: !s.enabled })}
                  />
                  <div className="ppr-source__fields">
                    <div className="ppr-source__internalname">
                      HJEN REF
                      <span className="ppr-source__badge mono-label">internal</span>
                    </div>
                    <div className="ppr-source__internalsub mono-label">
                      {refIndex === null ? 'reading index…'
                        : refIndex.ok ? `510 Saudi ads · ${refIndex.frames.toLocaleString()} frames`
                          : 'index not found — skipped'}
                    </div>
                  </div>
                </div>
              ) : (
                <div key={s.id} className={`ppr-source${s.enabled ? '' : ' is-off'}`}>
                  <button
                    className={`ppr-source__toggle${s.enabled ? ' is-on' : ''}`}
                    title={s.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
                    onClick={() => setSource(s.id, { enabled: !s.enabled })}
                  />
                  <div className="ppr-source__fields">
                    <input
                      className="pp-input ppr-source__name"
                      value={s.name}
                      placeholder="Site name"
                      onChange={e => setSource(s.id, { name: e.target.value })}
                    />
                    <input
                      className="pp-input ppr-source__url"
                      value={s.urlTemplate}
                      placeholder="https://…?q={query}"
                      spellCheck={false}
                      onChange={e => setSource(s.id, { urlTemplate: e.target.value })}
                    />
                  </div>
                  <button className="ppr-x" title="Delete source" onClick={() => deleteSource(s.id)}>×</button>
                </div>
              ))}
              <div className="ppr-srcadd">
                <input
                  className="pp-input ppr-source__name"
                  value={srcDraft.name}
                  placeholder="Name"
                  onChange={e => setSrcDraft(d => ({ ...d, name: e.target.value }))}
                />
                <input
                  className="pp-input ppr-source__url"
                  value={srcDraft.urlTemplate}
                  placeholder="https://…?q={query}"
                  spellCheck={false}
                  onChange={e => setSrcDraft(d => ({ ...d, urlTemplate: e.target.value }))}
                />
                <button className="pp-btn pp-btn--ghost" onClick={addSource}>+ Add source</button>
              </div>
              <div className="ppr-hint">Use {'{query}'} where the search term goes.</div>
            </div>

            {/* ── 3 · HUNT ─────────────────────────────────── */}
            <div className="pp-panel">
              <div className="pp-panel__head">
                <span className="pp-panel__title mono-label">HUNT</span>
                <span className="ppr-panel-sub">Your logged-in Chrome</span>
              </div>
              <div className="ppr-strict">
                <span className="ppr-pertag__label mono-label">Image type</span>
                <div className="ppr-strict__seg">
                  <button
                    className={`ppr-strict__opt${imageType === 'frames' ? ' is-on' : ''}`}
                    onClick={() => update({ imageType: 'frames' })}
                    title="Film stills — single frames"
                  >Frames</button>
                  <button
                    className={`ppr-strict__opt${imageType === 'motion' ? ' is-on' : ''}`}
                    onClick={() => update({ imageType: 'motion' })}
                    title="Motion — clips / moving reference"
                  >Motion</button>
                </div>
              </div>
              <div className="ppr-pertag">
                <span className="ppr-pertag__label mono-label">Keep per query</span>
                <input
                  className="pp-input ppr-pertag__num"
                  type="number" min={1} max={6} value={perTag}
                  onChange={e => {
                    const n = Math.round(Number(e.target.value));
                    if (Number.isFinite(n)) update({ perTag: Math.min(6, Math.max(1, n)) });
                  }}
                />
              </div>
              <div className="ppr-pertag">
                <span className="ppr-pertag__label mono-label" title="Queries hunted at once, each in its own Chrome tab — more lanes = faster, heavier">Lanes (parallel)</span>
                <input
                  className="pp-input ppr-pertag__num"
                  type="number" min={1} max={MAX_LANES} value={lanes}
                  onChange={e => {
                    const n = Math.round(Number(e.target.value));
                    if (Number.isFinite(n)) update({ lanes: Math.min(MAX_LANES, Math.max(1, n)) });
                  }}
                />
              </div>
              <div className="ppr-strict">
                <span className="ppr-pertag__label mono-label">Judge</span>
                <div className="ppr-strict__seg">
                  <button
                    className={`ppr-strict__opt${strictness === 'strict' ? ' is-on' : ''}`}
                    onClick={() => update({ strictness: 'strict' })}
                    title="Refuses rather than force-fills — may keep fewer or zero"
                  >Strict</button>
                  <button
                    className={`ppr-strict__opt${strictness === 'lenient' ? ' is-on' : ''}`}
                    onClick={() => update({ strictness: 'lenient' })}
                    title="Lower bar — fills more, for early exploration"
                  >Lenient</button>
                </div>
              </div>
              <div className="ppr-row">
                <button className="pp-btn pp-btn--ghost" disabled={activeHuntHere} onClick={() => void openHuntWindow()}>
                  Open Chrome + log in
                </button>
                <button className="pp-btn pp-btn--ghost" disabled={activeHuntHere} onClick={closeHuntWindow}>
                  Close Chrome
                </button>
              </div>
              {activeHuntHere ? (
                <button className="pp-btn ppr-widebtn ppr-stopbtn" onClick={stopHunt}>
                  Stop the hunt
                </button>
              ) : (
                <button
                  className="pp-btn pp-btn--accent ppr-widebtn"
                  disabled={!projectId || (huntRunning && huntProjectId !== projectId)}
                  onClick={startHunt}
                >
                  {huntRunning && huntProjectId !== projectId ? 'A hunt is running elsewhere' : 'Hunt the queries'}
                </button>
              )}
              <HuntPanel forProjectId={projectId} />
              <div className="ppr-law">Runs in your real Chrome — log into Frameset once, the session stays for every hunt.</div>
            </div>

            {/* ── 4 · IMPORT ───────────────────────────────── */}
            <div className="pp-panel">
              <div className="pp-panel__head">
                <span className="pp-panel__title mono-label">IMPORT</span>
                <span className="ppr-panel-sub">Bring your own frames</span>
              </div>
              <div className="ppr-hint">Add frames from your device, past generations, this storyboard, or the library — beside the hunt.</div>
              <button
                className="pp-btn pp-btn--ghost ppr-widebtn"
                disabled={!projectId}
                onClick={() => setImportOpen(true)}
              >+ Import frames</button>
            </div>

            {/* ── 5 · EXPORT ───────────────────────────────── */}
            <div className="pp-panel">
              <div className="pp-panel__head">
                <span className="pp-panel__title mono-label">EXPORT</span>
                <span className="ppr-panel-sub">Take the set out</span>
              </div>
              <div className="ppr-hint">
                A PDF of the board with its Why / Take / Leave lines, a folder of the frames copied as they are — GIFs stay GIFs — or both.
              </div>
              <button
                className="pp-btn pp-btn--ghost ppr-widebtn"
                disabled={!projectId || refs.length === 0}
                title={refs.length === 0 ? 'Nothing to export yet.' : undefined}
                onClick={() => setExportOpen(true)}
              >↓ Export {selected.size > 0 ? `${selected.size} selected` : 'the set'}</button>
            </div>
          </aside>

          <main className="pp-main">
            {error && <div className="pp-error">{error}</div>}
            {refs.length === 0 ? (
              <div className="ppr-blank">
                <div className="mono-label ppr-blank__eyebrow">STAGE 02 · REFERENCES</div>
                <h3 className="ppr-blank__h">No frames yet — extract tags, then hunt.</h3>
                <p className="ppr-blank__p">
                  Tags come out of the brief, the treatment, and the story.
                  The hunt opens a real browser window, reads each source,
                  judges every candidate against THIS story, and keeps only
                  the frames that serve it — downloaded into the project.
                </p>
              </div>
            ) : (
              <>
                <div className="ppr-board">
                  {refs.map(r => (
                    <RefTile
                      key={r.id}
                      r={r}
                      selected={selected.has(r.id)}
                      highlighted={highlightId === r.id}
                      dragging={draggingIds.includes(r.id)}
                      onToggle={() => toggleSelect(r.id)}
                      onHighlight={() => setHighlightId(r.id)}
                      onOpen={() => setLightboxId(r.id)}
                      onDragStart={e => onTileDragStart(e, r.id)}
                    />
                  ))}
                </div>
                {selected.size > 0 && (
                  <div className="ppr-actionbar">
                    <span className="mono-label ppr-actionbar__count">{selected.size} selected</span>
                    <span className="ppr-actionbar__spacer" />
                    {/* The routes that never depend on a drag landing: whatever
                        the OS does with the gesture, these always work. */}
                    <button className="pp-btn pp-btn--ghost" onClick={() => void sendSelectionTo('moodboard')}>
                      Send to Board
                    </button>
                    <button className="pp-btn pp-btn--ghost" onClick={() => void sendSelectionTo('timeline')}>
                      Send to Timeline
                    </button>
                    <button className="pp-btn pp-btn--ghost" onClick={clearSelection}>Clear</button>
                    <button className="pp-btn pp-btn--ghost" onClick={() => setExportOpen(true)}>Export</button>
                    <button className="ppr-actionbar__del" onClick={() => setConfirmDel([...selected])}>Delete</button>
                  </div>
                )}
              </>
            )}
          </main>
        </div>
      )}
      {importOpen && (
        <ReferenceImportOverlay
          projectId={projectId}
          importing={importing}
          onClose={() => { if (!importing) setImportOpen(false); }}
          onImport={items => void importFrames(items)}
        />
      )}
      {exportOpen && (
        <ReferenceExportOverlay
          refs={refs}
          selectedIds={[...selected]}
          defaultName={defaultExportName(projects.find(p => p.id === projectId)?.name ?? 'project')}
          exporting={exportingSet}
          onClose={() => { if (!exportingSet) setExportOpen(false); }}
          onExport={cfg => void exportSet(cfg)}
        />
      )}
      {lightboxId && (() => {
        const idx = refs.findIndex(r => r.id === lightboxId);
        if (idx < 0) return null;
        const r = refs[idx];
        const go = (step: number) => setLightboxId(refs[(idx + step + refs.length) % refs.length].id);
        return (
          <RefLightbox
            r={r}
            index={idx}
            total={refs.length}
            onChange={p => setRef(r.id, p)}
            onDelete={() => { deleteRef(r.id); setLightboxId(null); }}
            onClose={() => setLightboxId(null)}
            onPrev={() => go(-1)}
            onNext={() => go(1)}
          />
        );
      })()}
      {confirmDel && (
        <div className="modal-backdrop" onClick={() => setConfirmDel(null)}>
          <div className="modal modal--narrow ppr-confirm" onClick={e => e.stopPropagation()}>
            <div className="ppr-confirm__body">
              <div className="mono-label ppr-confirm__eyebrow">DELETE</div>
              <h3 className="ppr-confirm__h">
                Remove {confirmDel.length} frame{confirmDel.length === 1 ? '' : 's'} from the set?
              </h3>
              <p className="ppr-confirm__p">They leave the reference board — you can undo right after.</p>
            </div>
            <div className="ppr-confirm__foot">
              <button className="pp-btn pp-btn--ghost" onClick={() => setConfirmDel(null)}>Keep</button>
              <button
                className="ppr-lb__delyes"
                onClick={() => { const ids = confirmDel; setConfirmDel(null); deleteRefs(ids); }}
              >Delete {confirmDel.length}</button>
            </div>
          </div>
        </div>
      )}
      {undoNote && (
        <div className="pp-toast ppr-undotoast">
          <span className="ppr-undotoast__note">{undoNote}</span>
          <button className="ppr-undotoast__btn" onClick={undo}>Undo</button>
        </div>
      )}
      {toast && !undoNote && <div className="pp-toast">{toast}</div>}
      {/* Rendered INSIDE the shell, never portalled to <body>: KeepAlivePane
          hides this whole view with visibility:hidden, and a portal would
          escape that and leave a board floating over another tab. */}
      {dock && (
        <RefDock
          projectId={projectId}
          initialKind={dock}
          pending={pendingMedia}
          onPendingConsumed={() => setPendingMedia(null)}
          onClose={() => { setDock(null); setPendingMedia(null); }}
        />
      )}
    </PreprodShell>
  );
}

// ─── one board tile — the frame, full-bleed; details open on click ──────────

function RefTile({ r, selected, highlighted, dragging, onToggle, onHighlight, onOpen, onDragStart }: {
  r: HuntedRef;
  selected: boolean;
  highlighted: boolean;
  dragging: boolean;
  onToggle: () => void;
  onHighlight: () => void;
  onOpen: () => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  const palette = r.palette ?? 'mid';
  const leaveEmpty = !(r.leave || '').trim();
  return (
    <div
      className={`ppr-tile ppr-tile--${palette}${selected ? ' is-selected' : ''}${highlighted ? ' is-highlit' : ''}${dragging ? ' is-dragging' : ''}`}
      role="button"
      tabIndex={0}
      // The TILE is the drag source, never the bare <img>: an <img> has its own
      // default drag that hands over a bitmap and a URL rather than the file,
      // and a gesture begun on the scrim or the palette edge would do nothing.
      draggable
      onDragStart={onDragStart}
      onClick={onHighlight}
      onDoubleClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onOpen(); } }}
      title={`${r.intent ? `${r.tag} — ${r.intent}` : r.tag}\nClick to highlight · double-click to open · drag out to save the file`}
    >
      <img className="ppr-tile__img" src={hjenFileUrl(r.imagePath)} alt={r.tag} loading="lazy" decoding="async" draggable={false} />
      <span className="ppr-tile__edge" />
      {/* selection lives ONLY on this corner check — top-left, hover-revealed */}
      <button
        type="button"
        className="ppr-tile__check"
        aria-pressed={selected}
        aria-label={selected ? 'Deselect frame' : 'Select frame'}
        title={selected ? 'Selected — click to deselect' : 'Select frame'}
        onClick={e => { e.stopPropagation(); onToggle(); }}
        onDoubleClick={e => e.stopPropagation()}
      >{selected ? '✓' : ''}</button>
      {leaveEmpty && (
        <span className="ppr-tile__warn" title="No Leave line yet — a frame without a Leave line is an imitation trap." />
      )}
      <span className="ppr-tile__scrim">
        <span className="ppr-tile__tag mono-label">{r.tag}</span>
        <span className="ppr-tile__hint mono-label">dbl-click</span>
      </span>
    </div>
  );
}

// ─── the frame, enlarged — with its editable details beside it ──────────────

function RefLightbox({ r, index, total, onChange, onDelete, onClose, onPrev, onNext }: {
  r: HuntedRef;
  index: number;
  total: number;
  onChange: (patch: Partial<HuntedRef>) => void;
  onDelete: () => void;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const palette = r.palette ?? 'mid';
  const [confirmDel, setConfirmDel] = useState(false);
  const leaveEmpty = !(r.leave || '').trim();
  const multi = total > 1;

  const cyclePalette = () => onChange({ palette: PALETTES[(PALETTES.indexOf(palette) + 1) % PALETTES.length] });
  const openSource = () => { if (r.sourceUrl) void window.hjen.refHuntOpen({ url: r.sourceUrl }); };

  // a new frame drops any pending delete confirm.
  useEffect(() => { setConfirmDel(false); }, [r.id]);

  // ESC closes; ←/→ walk the board — but never while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return;
      if (e.key === 'ArrowLeft') onPrev();
      else if (e.key === 'ArrowRight') onNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal ppr-lb ppr-lb--${palette}`} onClick={e => e.stopPropagation()}>
        {/* the enlarged frame */}
        <div className="ppr-lb__stage">
          <img className="ppr-lb__img" src={hjenFileUrl(r.imagePath)} alt={r.tag} />
          {multi && (
            <>
              <button className="ppr-lb__nav ppr-lb__nav--prev" onClick={onPrev} title="Previous frame (←)" aria-label="Previous frame">‹</button>
              <button className="ppr-lb__nav ppr-lb__nav--next" onClick={onNext} title="Next frame (→)" aria-label="Next frame">›</button>
            </>
          )}
          <span className="ppr-lb__count mono-label">{index + 1} / {total}</span>
        </div>

        {/* the details, on demand */}
        <aside className="ppr-lb__rail">
          <div className="ppr-lb__head">
            <span className="ppr-tagchip mono-label" title={r.intent ? `Intent: ${r.intent}` : 'The query that found this frame'}>{r.tag}</span>
            {r.sourceName && (
              <button
                className="ppr-srclink mono-label"
                title={r.sourceUrl ? 'Open the source page in the hunt window' : undefined}
                disabled={!r.sourceUrl}
                onClick={openSource}
              >{r.sourceName} ↗</button>
            )}
            <span className="ppr-lb__headspacer" />
            <button className="modal__close" onClick={onClose}>Close</button>
          </div>

          {r.intent && <div className="ppr-lb__intent">{r.intent}</div>}

          <div className="ppr-lb__palrow">
            <span className="ppr-field__label mono-label">PALETTE</span>
            <button
              className={`ppr-palchip ppr-palchip--${palette} mono-label`}
              title="Palette — click to change"
              onClick={cyclePalette}
            >{palette}</button>
          </div>

          {r.scores && (
            <div className="ppr-scores" title={`literal ${r.scores.literal} · pov ${r.scores.pov} · craft ${r.scores.craft} · fit ${r.scores.fit} · anti-cliché ${r.scores.antiCliche}`}>
              <ScoreDot label="LIT" v={r.scores.literal} />
              <ScoreDot label="POV" v={r.scores.pov} />
              <ScoreDot label="CFT" v={r.scores.craft} />
              <ScoreDot label="FIT" v={r.scores.fit} />
              <ScoreDot label="CLI" v={r.scores.antiCliche} />
              <span className="ppr-scores__total mono-label">{r.scores.total}/25</span>
            </div>
          )}

          <div className="ppr-field">
            <div className="ppr-field__label mono-label">WHY <span className="ppr-field__sub">fit to this story</span></div>
            <textarea
              className="pp-textarea ppr-ta"
              value={r.why}
              placeholder="How this frame serves the story…"
              onChange={e => onChange({ why: e.target.value })}
            />
          </div>

          <div className="ppr-field">
            <div className="ppr-field__label mono-label">TAKE <span className="ppr-field__sub">checkable in the frame</span></div>
            <textarea
              className="pp-textarea ppr-ta"
              value={r.take ?? ''}
              placeholder="One practical key at 45°, warm against the cool street…"
              onChange={e => onChange({ take: e.target.value })}
            />
          </div>

          <div className="ppr-field">
            <div className="ppr-field__label mono-label">LEAVE <span className="ppr-field__sub">mandatory</span></div>
            <textarea
              className={`pp-textarea ppr-ta${leaveEmpty ? ' ppr-leave--empty' : ''}`}
              value={r.leave ?? ''}
              placeholder="What we refuse from this frame…"
              onChange={e => onChange({ leave: e.target.value })}
            />
            {leaveEmpty && <div className="ppr-leave__warn">A frame without a Leave line is an imitation trap.</div>}
          </div>

          <div className="ppr-lb__foot">
            {confirmDel ? (
              <div className="ppr-lb__confirm">
                <span className="ppr-lb__confirmq">Remove this frame from the set?</span>
                <button className="pp-btn pp-btn--ghost" onClick={() => setConfirmDel(false)}>Keep</button>
                <button className="ppr-lb__delyes" onClick={onDelete}>Delete</button>
              </div>
            ) : (
              <button className="ppr-lb__del" onClick={() => setConfirmDel(true)}>Delete frame</button>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/** One rubric axis as a labelled 0–5 bar. */
function ScoreDot({ label, v }: { label: string; v: number }) {
  const pct = Math.max(0, Math.min(5, v)) / 5 * 100;
  const tone = v >= 4 ? 'hi' : v >= 3 ? 'mid' : 'lo';
  return (
    <span className={`ppr-score ppr-score--${tone}`} title={`${label} ${v}/5`}>
      <span className="ppr-score__lbl mono-label">{label}</span>
      <span className="ppr-score__bar"><span className="ppr-score__fill" style={{ width: `${pct}%` }} /></span>
    </span>
  );
}

// ─── the live hunt progress + transparency log (HUNT panel) ─────────────────

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function HuntPanel({ forProjectId }: { forProjectId: string | null }) {
  const running = useHunt(s => s.running);
  const projectId = useHunt(s => s.projectId);
  const phase = useHunt(s => s.phase);
  const queriesDone = useHunt(s => s.queriesDone);
  const queriesTotal = useHunt(s => s.queriesTotal);
  const kept = useHunt(s => s.kept);
  const startedAt = useHunt(s => s.startedAt);
  const finishedAt = useHunt(s => s.finishedAt);
  const lanes = useHunt(s => s.lanes);
  const logEntries = useHunt(s => s.log);
  const imageType = useHunt(s => s.imageType);
  const strictness = useHunt(s => s.strictness);
  const clear = useHunt(s => s.clear);
  const [logOpen, setLogOpen] = useState(false);
  const [, tick] = useState(0);   // 1s elapsed ticker while running

  const mine = projectId === forProjectId && (running || logEntries.length > 0);
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => tick(x => x + 1), 1000);
    return () => window.clearInterval(t);
  }, [running]);
  if (!mine) return null;

  const elapsed = fmtElapsed((finishedAt ?? Date.now()) - (startedAt ?? Date.now()));

  return (
    <div className="ppr-hunt">
      <div className="ppr-hunt__head">
        <span className="ppr-hunt__phase mono-label">
          {running && <span className="ppr-hunt__spin" aria-hidden="true" />}
          {phase || 'Idle'}
        </span>
        {!running && <button className="ppr-hunt__clear mono-label" onClick={clear} title="Clear the panel">clear</button>}
      </div>
      <div className="ppr-hunt__stats mono-label">
        <span>{queriesDone}/{queriesTotal} queries</span>
        <span className="ppr-hunt__dot">·</span>
        <span>{kept} kept</span>
        <span className="ppr-hunt__dot">·</span>
        <span>{elapsed}</span>
      </div>
      {lanes.length > 0 && (
        <div className="ppr-hunt__lanes">
          {lanes.map(l => (
            <div key={l.id} className="ppr-hunt__lane mono-label">
              <span className="ppr-hunt__lanen">lane {l.id}</span>
              <span className="ppr-hunt__lanestage" title={l.query ? `«${l.query}» — ${l.stage}` : l.stage}>
                {l.query ? `«${l.query}» — ${l.stage}` : l.stage}
              </span>
            </div>
          ))}
        </div>
      )}
      <button className="ppr-hunt__logtoggle mono-label" onClick={() => setLogOpen(o => !o)}>
        <span>{logOpen ? '▾' : '▸'} hunt log</span>
        <span className="ppr-hunt__judge">judge: {strictness} · {imageType}</span>
      </button>
      {logOpen && (
        <div className="ppr-hunt__log">
          {logEntries.length === 0
            ? <div className="ppr-hunt__logempty mono-label">no events yet…</div>
            : logEntries.map(e => (
              <div key={e.id} className={`ppr-hunt__logline ppr-hunt__logline--${e.kind}`}>{e.text}</div>
            ))}
        </div>
      )}
    </div>
  );
}
