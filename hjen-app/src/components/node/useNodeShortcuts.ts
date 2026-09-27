// useNodeShortcuts — binds the NODE_SHORTCUTS registry to the Node view.
//
// A single keydown listener, mounted ONLY while NodeView is on screen (the
// effect's cleanup removes it when the view unmounts), so it can never steal
// keys from Frame / Storyboard / Video. Because tabs are kept alive, several
// canvases can be mounted at once (two Node tabs, or Node + SPACE) — `surface`
// + `enabled` make sure only the visible one answers. It ignores keys while typing in a
// field, bails when a Node-owned modal (DOP / chooser) wants the keyboard, and
// resolves the active context (canvas vs the focused timeline dock) before
// dispatching the first matching shortcut by id.

import { useEffect, useRef } from 'react';
import { useStore } from '../../store';
import type { NodeInstance, GraphEdge } from '../../lib/node-engine/types';
import { NODE_SHORTCUTS, type ShortcutContext } from '../../lib/node-engine/shortcuts';
import { nodesBBox, fitTransform, centerTransform, zoomAtPoint } from './viewport';
import { nodeClipboard, makeClipPayload } from './nodeClipboard';

export interface NodeShortcutApi {
  nodes: NodeInstance[];
  edges: GraphEdge[];
  sel: string[];
  setSel: (ids: string[]) => void;
  cursor: { current: { x: number; y: number } | null };   // board-space cursor
  boardRef: { current: HTMLDivElement | null };
  pan: { x: number; y: number };
  scale: number;
  setPan: (p: { x: number; y: number }) => void;
  setScale: (s: number) => void;
  nodeSize: (n: NodeInstance) => { w: number; h: number };
  addNodeAt: (type: string, at: { x: number; y: number }) => void;
  toggleTool: () => void;
  toggleFilter: () => void;
  openHelp: () => void;
  closeMenu: () => void;
  menuOpen: boolean;
  helpOpen: boolean;
  blocked: boolean;   // DOP / chooser owns the keyboard
  /** Which tool this canvas is — 'node' or 'space'. The listener only fires
   *  when the app is actually showing that view. */
  surface: 'node' | 'space';
  /** Open / close the tool wheel — the dial of every HJEN tool. */
  toggleWheel: () => void;
  /** This instance is the ACTIVE tab. Tabs stay mounted (keep-alive), so a Node
   *  tab and a SPACE tab both have a live listener; without this every hidden
   *  canvas would answer the same keystroke and a Delete would land twice. */
  enabled: boolean;
}

// Node type created by each creation shortcut (audio has no node type yet).
const CREATE_TYPE: Record<string, string> = {
  'create.text': 'text', 'create.image': 'frame', 'create.video': 'video',
  'create.subject': 'source', 'create.bin': 'bin', 'create.set': 'set', 'create.variable': 'variable',
};

export function useNodeShortcuts(api: NodeShortcutApi): void {
  const ref = useRef(api);
  ref.current = api;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = ref.current;
      const st = useStore.getState();
      if (!a.enabled || st.activeView !== a.surface) return;

      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

      // Help overlay open → only ⌘/ (toggle) and Esc (close) pass.
      if (a.helpOpen) {
        if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key === '/')) { e.preventDefault(); a.openHelp(); }
        return;
      }
      if (typing || a.blocked) return;

      const ctx: ShortcutContext = st.timelineFocused ? 'timeline' : 'canvas';
      const def = NODE_SHORTCUTS.find(d => d.when.includes(ctx) && d.match(e));
      if (!def) return;
      if (def.preventDefault !== false) e.preventDefault();
      if (runShortcut(def.id, e, a)) e.stopPropagation();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// Returns true when the shortcut consumed the event (→ stopPropagation, so it
// doesn't reach App-level Esc / other listeners when we actually handled it).
function runShortcut(id: string, e: KeyboardEvent, a: NodeShortcutApi): boolean {
  const st = useStore.getState();
  const rect = a.boardRef.current?.getBoundingClientRect();
  const vp = { w: rect?.width ?? 800, h: rect?.height ?? 500 };
  const size = a.nodeSize;
  const selNodes = a.nodes.filter(n => a.sel.includes(n.id));
  // Cursor in viewport px (for anchored zoom); centre fallback.
  const cur = a.cursor.current;
  const px = cur ? cur.x * a.scale + a.pan.x : vp.w / 2;
  const py = cur ? cur.y * a.scale + a.pan.y : vp.h / 2;
  const boardCursor = cur ?? { x: (vp.w / 2 - a.pan.x) / a.scale, y: (vp.h / 2 - a.pan.y) / a.scale };

  const applyZoom = (factor: number) => {
    const t = zoomAtPoint({ pan: a.pan, scale: a.scale }, factor, px, py);
    a.setScale(t.scale); a.setPan(t.pan);
  };
  const fitTo = (nodes: NodeInstance[]) => {
    const box = nodesBBox(nodes, size);
    if (!box) return;
    const t = fitTransform(box, vp);
    a.setScale(t.scale); a.setPan(t.pan);
  };

  // ---- Create ----
  if (id in CREATE_TYPE) { a.addNodeAt(CREATE_TYPE[id], boardCursor); return true; }
  if (id === 'create.audio') { useStore.setState({ graphStatus: 'Audio node — coming soon.' }); return true; }

  switch (id) {
    // ---- Selection ----
    case 'select.all': {
      const all = a.nodes.map(n => n.id);
      a.setSel(all);
      st.selectGraphNode(all.length === 1 ? all[0] : null);
      return true;
    }
    case 'select.none': {
      let consumed = false;
      if (a.menuOpen) { a.closeMenu(); consumed = true; }
      if (a.sel.length) { a.setSel([]); st.selectGraphNode(null); consumed = true; }
      return consumed;   // only stopProp when we closed something → App Esc still works
    }
    case 'select.mode': a.toggleTool(); return true;

    // ---- Camera ----
    case 'camera.fit': fitTo(a.nodes); return true;
    case 'camera.zoomsel': fitTo(selNodes.length ? selNodes : a.nodes); return true;
    case 'camera.center': {
      const box = nodesBBox(selNodes.length ? selNodes : a.nodes, size);
      if (box) a.setPan(centerTransform(box, vp, a.scale));
      return true;
    }
    case 'camera.zoomin': case 'camera.zoomin2': applyZoom(1.15); return true;
    case 'camera.zoomout': case 'camera.zoomout2': applyZoom(0.87); return true;
    case 'camera.zoomtool': applyZoom(1.3); return true;
    case 'camera.reset': {
      if (a.sel.length) { a.sel.forEach(idn => st.setNodeColorLabel(idn, null)); }
      else { const box = nodesBBox(a.nodes, size); a.setScale(1); a.setPan(box ? centerTransform(box, vp, 1) : { x: 0, y: 0 }); }
      return true;
    }

    // ---- Clipboard + duplicate ----
    case 'clip.copy': { if (nodeClipboard.copy(a.nodes, a.edges, a.sel)) useStore.setState({ graphStatus: `Copied ${a.sel.length}.` }); return true; }
    case 'clip.cut': {
      if (a.sel.length && nodeClipboard.copy(a.nodes, a.edges, a.sel)) { st.removeGraphNodes(a.sel); a.setSel([]); }
      return true;
    }
    case 'clip.paste': {
      const p = nodeClipboard.get();
      if (p) { const ids = st.pasteNodes(p, boardCursor); a.setSel(ids); }
      return true;
    }
    case 'dup.plain': case 'dup.settings': {
      const p = makeClipPayload(a.nodes, a.edges, a.sel);
      if (p) { const ids = st.pasteNodes(p, { x: p.origin.x + 28, y: p.origin.y + 28 }); a.setSel(ids); }
      return true;
    }

    // ---- Take-loop ----
    case 'take.favorite': a.sel.forEach(idn => st.setNodeFavorite(idn)); return true;
    case 'take.reject': a.sel.forEach(idn => st.setNodeRejected(idn)); return true;
    case 'take.upscale': {
      if (a.sel.length) { const nid = st.duplicateAsTake(a.sel[0]); if (nid) { a.setSel([nid]); useStore.setState({ graphStatus: 'Upscale take created — connect an Enhance node.' }); } }
      return true;
    }
    case 'take.label': {
      const d = Number(e.key) as 1 | 2 | 3 | 4 | 5;
      a.sel.forEach(idn => st.setNodeColorLabel(idn, d));
      return true;
    }
    case 'take.filter': a.toggleFilter(); return true;

    // ---- History ----
    case 'history.undo': st.undoGraph(); return true;
    case 'history.redo': st.redoGraph(); return true;

    // ---- Stacks ----
    case 'stack.prev': case 'stack.next': {
      const cur1 = a.sel.length === 1 ? a.nodes.find(n => n.id === a.sel[0]) : null;
      if (!cur1?.stackId) return false;
      const members = a.nodes.filter(n => n.stackId === cur1.stackId).sort((x, y) => (x.takeIndex ?? 0) - (y.takeIndex ?? 0));
      if (members.length < 2) return false;
      const i = members.findIndex(n => n.id === cur1.id);
      const dir = id === 'stack.next' ? 1 : -1;
      const nx = members[(i + dir + members.length) % members.length];
      a.setSel([nx.id]); st.selectGraphNode(nx.id);
      return true;
    }

    // ---- Delete ----
    case 'node.delete': if (a.sel.length) { st.removeGraphNodes(a.sel); a.setSel([]); } return true;

    // ---- Help ----
    case 'help.toggle': a.openHelp(); return true;

    // ---- Tool wheel ----
    case 'wheel.toggle': a.toggleWheel(); return true;

    // ---- Timeline ----
    case 'tl.split': {
      const target = st.selectedClipId ?? clipUnderPlayhead(st)?.id;
      if (target) st.splitClip(target, st.timelinePlayhead);
      return true;
    }
    case 'tl.snap': st.toggleSnapping(); return true;
    case 'tl.selall': useStore.setState({ graphStatus: 'Select-all clips — coming soon.' }); return true;
    case 'tl.delete': if (st.selectedClipId) st.removeClip(st.selectedClipId); return true;
    case 'tl.ripple': if (st.selectedClipId) st.rippleDeleteClip(st.selectedClipId); return true;
    case 'tl.nudgeL': if (st.selectedClipId) st.nudgeClip(st.selectedClipId, -1); return true;
    case 'tl.nudgeR': if (st.selectedClipId) st.nudgeClip(st.selectedClipId, 1); return true;
    case 'tl.nudgeL5': if (st.selectedClipId) st.nudgeClip(st.selectedClipId, -5); return true;
    case 'tl.nudgeR5': if (st.selectedClipId) st.nudgeClip(st.selectedClipId, 5); return true;
    case 'tl.prevEdit': st.setPlayhead(nearestEdit(st, -1)); return true;
    case 'tl.nextEdit': st.setPlayhead(nearestEdit(st, 1)); return true;
    case 'tl.setIn': if (st.selectedClipId) st.setClipInOut(st.selectedClipId, 'in', st.timelinePlayhead); return true;
    case 'tl.setOut': if (st.selectedClipId) st.setClipInOut(st.selectedClipId, 'out', st.timelinePlayhead); return true;
    case 'tl.export': st.requestExport(); return true;

    // ---- Playback ----
    case 'pb.playpause': { if (!st.timelinePlaying) st.setPlayRate(1); st.setPlaying(!st.timelinePlaying); return true; }
    case 'pb.shuttleBack': st.setPlayRate(-2); st.setPlaying(true); return true;
    case 'pb.shuttleFwd': st.setPlayRate(2); st.setPlaying(true); return true;
    case 'pb.stop': st.setPlaying(false); st.setPlayRate(1); return true;
    case 'pb.stepBack': st.stepPlayhead(-1 / 30); return true;
    case 'pb.stepFwd': st.stepPlayhead(1 / 30); return true;
    case 'pb.jumpStart': st.setPlaying(false); st.setPlayhead(0); return true;
    case 'pb.jumpEnd': st.setPlaying(false); st.setPlayhead(timelineTotal(st)); return true;

    default: return false;
  }
}

// ---- Timeline helpers (V1 track = the master video lane) ----
function timelineTotal(st: ReturnType<typeof useStore.getState>): number {
  return st.timelineClips.filter(c => c.track === 'V1').reduce((m, c) => Math.max(m, c.start + c.duration), 0);
}
function clipUnderPlayhead(st: ReturnType<typeof useStore.getState>) {
  const t = st.timelinePlayhead;
  return st.timelineClips.find(c => c.track === 'V1' && t >= c.start && t < c.start + c.duration) ?? null;
}
function nearestEdit(st: ReturnType<typeof useStore.getState>, dir: 1 | -1): number {
  const t = st.timelinePlayhead;
  const edges = new Set<number>([0]);
  for (const c of st.timelineClips) { edges.add(c.start); edges.add(c.start + c.duration); }
  const sorted = [...edges].sort((x, y) => x - y);
  if (dir > 0) return sorted.find(x => x > t + 1e-4) ?? timelineTotal(st);
  return [...sorted].reverse().find(x => x < t - 1e-4) ?? 0;
}
