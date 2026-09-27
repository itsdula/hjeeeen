import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore, type GraphScope } from '../store';
import { useTabActive } from '../lib/keepAlive';
import { getNodeSpec, paramsByKind } from '../lib/node-engine/registry';
import { registerBuiltinNodes } from '../lib/node-engine/nodes';
import type { NodeInstance, NodeSpec, Parameter, DataType } from '../lib/node-engine/types';
import { ParamControl } from './node/ParamControl';
import { TimelineDock } from './TimelineDock';
import { useNodeShortcuts, type NodeShortcutApi } from './node/useNodeShortcuts';
import { ShortcutHelp } from './node/ShortcutHelp';
import { FloatingToolRail } from './node/FloatingToolRail';
import { ToolWheel } from './node/ToolWheel';
import { SpaceGateway } from './node/SpaceGateway';
import { PipelineRail } from './node/PipelineRail';
import '../styles/space.css';
import { HistoryPanel } from './node/HistoryPanel';
import { EditView } from './node/EditView';
import { nodesBBox, fitTransform, SCALE_BOUNDS } from './node/viewport';
import { MIND_BODIES, MIND_NODE_SIZE, MindFreeText } from './node/mindBodies';
import { MIND_ACCENT } from '../lib/node-engine/nodes/mind';
import {
  useMindCanvas, drawSeedsOnCanvas, collideOnCanvas, pressOnCanvas, importNotesOnCanvas,
} from '../lib/mindcanvas/actions';
import { arrangeNodes } from '../lib/mindcanvas/arrange';
import { sizeOfNode, minSizeOfType } from '../lib/mindcanvas/sizes';
import { loadBreakdownOnCanvas } from '../lib/mindcanvas/breakdownCanvas';
import { openMyMindOnCanvas, copyIntoMyMind } from '../lib/mindcanvas/mymind';
import { listBreakdowns, readBreakdown, type BreakdownSummary } from '../lib/creativemind/breakdown';
import { rewriteBreakdownArabic } from '../lib/creativemind/arabicRewrite';
import { routeEdge, EDGE_STYLES, type EdgeStyle } from '../lib/node-engine/edgeRoute';
import '../styles/node.css';

/**
 * NODE — HJEN's infinite media canvas, laid out as a studio:
 * a canvas toolbar on top, a floating create-tool rail on the left, the board
 * in the middle, a settings inspector on the RIGHT (not inside the node), and
 * a Sequence bar at the bottom. Nodes on the board are compact cards; their
 * parameters are edited in the inspector. The graph lives in the store and Run
 * hands it to GraphEngine, which executes each HJEN product.
 *
 * TWO SURFACES, ONE ENGINE. This component renders both HJEN tools:
 *
 *   surface="node"    HJEN NODE — the orchestration pipeline. Keeps the whole
 *                     thing: Create/Edit modes, the Sequence dock, ＋TL.
 *   surface="space"   HJEN SPACE — the same infinite board with the SEQUENCE
 *                     REMOVED. No timeline dock, no Edit sequencer, no "add to
 *                     timeline" anywhere. A pure spatial workspace: make,
 *                     arrange, wire, run. Its rail is movable and collapsible.
 *
 * The two are separate TOOLS, not two views of one board — each persists to its
 * own file (see GraphScope in the store), so a Space board can never overwrite
 * a Node pipeline. Everything else — engine, nodes, inspector, shortcuts,
 * canvases, the mind canvas — is shared, one implementation, no fork.
 */

registerBuiltinNodes();

// ---- Geometry -------------------------------------------------------------
const NODE_W = 188;
const TITLE_H = 38;
const SOCKET_H = 24;
const PREVIEW_H = 118;
const GROUP_BAR_H = 30;   // a group is grabbed / marquee-hit only by this top strip

const fileUrl = (p: string) => `hjen-file://${encodeURI(p)}`;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
// Nodes that produce an asset → get an in-card ▶ and an inspector Generate.
const GENERATES = new Set(['frame', 'video', 'enhancer']);
// Nodes whose body IS their output — always show a preview box (placeholder
// icon when empty · generating state while running · image/video when done).
const ASSET_NODES = new Set(['frame', 'video', 'enhancer', 'source', 'set']);

const TYPE_COLOR: Record<DataType, string> = {
  image: '#5BA8FF', video: '#E0726A', text: '#C9B06B', number: '#7FB069',
  boolean: '#B07FD0', selectionSet: '#D9913F', referenceSet: '#4FB7B3', any: '#8A8A8A',
};

// Take-loop colour labels (1–5).
const LABEL_COLORS: Record<number, string> = { 1: '#E0726A', 2: '#E0A24A', 3: '#7FB069', 4: '#4FA3E0', 5: '#B07FD0' };

// ---- Icons (create-tool set) --------------------------------------
const I = (d: React.ReactNode) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);
const ICONS: Record<string, React.ReactNode> = {
  source: I(<><circle cx="8" cy="15" r="3" /><path d="M13 4l4 7h-8z" /></>),               // Subject
  frame: I(<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M4 18l5-4 4 3 3-2 4 3" /></>), // Image
  video: I(<><rect x="3" y="6" width="12" height="12" rx="2" /><path d="M15 10l6-3v10l-6-3z" /></>), // Video
  set: I(<><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M12 3v18M4 7.5l8 4.5 8-4.5" /></>),   // Set (cube)
  text: I(<><path d="M5 6h14M12 6v12M8 18h8" /></>),                                          // Text
  bin: I(<><path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H3z" /></>),                                 // Bin (folder)
  group: I(<><rect x="3" y="4" width="18" height="16" rx="2" strokeDasharray="3 3" /><path d="M3 8h18" /></>), // Group (frame)
  file: I(<><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /></>),                          // File (document)
  addfiles: I(<><path d="M3 6h6l2 2h8v3M3 6v13h9" /><path d="M17 15v6M14 18h6" /></>),        // Add files (folder-plus)
  variable: I(<><path d="M8 5s-3 2-3 7 3 7 3 7M16 5s3 2 3 7-3 7-3 7" /></>),                  // Variable {}
  enhancer: I(<><path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" /></>),                          // Enhance (sparkle)
  output: I(<><path d="M4 4h16v16H4z" /><path d="M9 12h6M13 9l3 3-3 3" /></>),                // Output
  // لوحة التفكير — mind glyphs (lineage-blocks, not media)
  'mind.brief': I(<><rect x="4" y="3" width="14" height="18" rx="2" /><path d="M8 8h6M8 12h6M8 16h4" /></>),   // Brief (document)
  'mind.seed': I(<><path d="M12 21c5-1 7-6 6-12-6-1-10 3-9 8" /><path d="M6 18c3-4 7-6 10-6" /></>),          // Seed (sprout)
  'mind.note': I(<><path d="M5 4h11l3 3v13H5z" /><path d="M15 4v4h4M9 13h6M9 17h4" /></>),                    // Note (card)
  // تشريح الإعلان — Ad Breakdown 360 glyphs
  'mind.bdHeader': I(<><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3" /><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3" /></>),  // 360 dial
  'mind.bdAxis': I(<><circle cx="6" cy="12" r="2.4" /><path d="M8.5 12H14" /><rect x="14" y="7" width="7" height="10" rx="1.5" /></>),             // axis + strip
  'mind.bdElement': I(<><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M8 10h8M8 14h5" /></>),                                          // one fact
  'mind.myMind': I(<><rect x="3" y="4" width="18" height="16" rx="2" strokeDasharray="3 3" /><circle cx="9" cy="11" r="2" /><circle cx="15" cy="14" r="2" /><path d="M10.6 12.2l2.8 1" /></>), // my template
  breakdown: I(<><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v5M12 15.5v5M3.5 12h5M15.5 12h5" /><circle cx="12" cy="12" r="2" /></>),
  arrange: I(<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>), // Arrange (tidy grid)
};

// Left rail — the primary tools + HJEN extras below a divider.
const PRIMARY_TOOLS = ['source', 'frame', 'video', 'set'];
const SECONDARY_TOOLS = ['text', 'bin', 'variable', 'group'];
const EXTRA_TOOLS = ['enhancer', 'output'];
const TOOL_LABEL: Record<string, string> = {
  source: 'Subject', frame: 'Image', video: 'Video', set: 'Set',
  text: 'Text', bin: 'Bin', variable: 'Variable', enhancer: 'Enhance', output: 'Output',
  group: 'Group', file: 'File', addfiles: 'Add files',
  'mind.brief': 'Brief', 'mind.seed': 'Seed', 'mind.note': 'Note',
};

// File card — kind → glyph + human label. Tokens carry the colour; the glyph is
// a neutral outline so the card reads as a document, not a coloured chip.
const FILE_GLYPH: Record<string, React.ReactNode> = {
  pdf: I(<><path d="M6 3h8l4 4v14H6z" /><path d="M9 13h1.5a1.5 1.5 0 0 0 0-3H9v6M14 10v6M14 13h2" /></>),
  word: I(<><path d="M6 3h8l4 4v14H6z" /><path d="M8 11l1.5 6L11 13l1.5 4L14 11" /></>),
  deck: I(<><rect x="3" y="4" width="18" height="12" rx="1.5" /><path d="M12 16v4M8 21h8" /></>),
  audio: I(<><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M17 9a4 4 0 0 1 0 6" /></>),
  video: I(<><rect x="3" y="6" width="12" height="12" rx="2" /><path d="M15 10l6-3v10l-6-3z" /></>),
  text: I(<><path d="M6 3h8l4 4v14H6z" /><path d="M9 11h6M9 14h6M9 17h4" /></>),
  other: I(<><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /></>),
};
const FILE_KIND_LABEL: Record<string, string> = {
  pdf: 'PDF', word: 'Document', deck: 'Deck', audio: 'Audio', video: 'Video', text: 'Text', other: 'File',
};

// Wire-shape picker glyphs (step · curve · straight · hidden) — mirror routeEdge's styles.
const WIRE_ICON: Record<EdgeStyle, React.ReactNode> = {
  step: I(<><path d="M3 6h6v12h6" /></>),
  curve: I(<><path d="M3 6c6 0 6 12 12 12" /></>),
  straight: I(<><path d="M3 6l18 12" /></>),
  hidden: I(<><path d="M4 4l16 16M9.5 5.4A9.8 9.8 0 0 1 12 5c5.5 0 9 5 9 7 0 .9-.7 2.3-2 3.6M6.1 6.9C4 8.3 3 10.3 3 12c0 2 3.5 7 9 7 1.3 0 2.5-.3 3.6-.8" /></>),
};

// لوحة التفكير — the thinking canvas's left rail. Thought seeds up top, then
// a moodboard row (image / frame / video / bare text) so the map holds pictures
// beside ideas. Storyboard is deferred — no node type exists for it yet.
const MIND_TOOLS = ['mind.brief', 'mind.seed', 'mind.note'];
const MIND_MEDIA_TOOLS = ['source', 'frame', 'video', 'text', 'group'];
// Non-mind node types the thinking canvas welcomes (moodboard + free text +
// frames · files as first-class board citizens).
const MIND_ALLOWED = new Set(['source', 'frame', 'video', 'text', 'group', 'file']);

// Bodies without inputs — the whole card is a drag handle (Anwar: grab anywhere).
const MIND_READONLY = new Set(['mind.seed', 'mind.collision', 'mind.note', 'mind.answer',
  // Breakdown cards are read-only references into breakdown.json — the whole
  // card is a drag handle (that IS the My-Mind gesture).
  'mind.bdHeader', 'mind.bdAxis', 'mind.bdElement']);
const IMAGE_FILE_RE = /\.(png|jpe?g|webp|avif)$/i;

// ---- Compact node port layout (properties live in the inspector) ----------
function portRows(spec: NodeSpec): Parameter[] {
  return [...paramsByKind(spec, 'input'), ...paramsByKind(spec, 'output')];
}
function socketCenterY(spec: NodeSpec, kind: 'input' | 'output', param: string): number {
  const rows = portRows(spec);
  const i = rows.findIndex(p => p.kind === kind && p.name === param);
  return TITLE_H + (i < 0 ? 12 : i * SOCKET_H + SOCKET_H / 2);
}
const pstr = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const baseName = (p: string): string => p.split('/').pop() || p;
// Which file family a dropped/picked path belongs to (drives the file card glyph).
function fileKindOf(path: string): string {
  const e = (path.split('.').pop() || '').toLowerCase();
  if (['mp4', 'mov', 'webm', 'm4v', 'avi', 'mkv'].includes(e)) return 'video';
  if (['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'].includes(e)) return 'audio';
  if (e === 'pdf') return 'pdf';
  if (['doc', 'docx', 'pages', 'rtf'].includes(e)) return 'word';
  if (['ppt', 'pptx', 'key'].includes(e)) return 'deck';
  if (['txt', 'md', 'csv'].includes(e)) return 'text';
  return 'other';
}

export function NodeView({ surface = 'node' }: { surface?: GraphScope } = {}) {
  /** HJEN SPACE — the sequence is not part of this tool. Everything the
   *  timeline owns (the dock, Edit mode, ＋TL) is absent, not merely hidden. */
  const isSpace = surface === 'space';
  const nodes = useStore(s => s.graphNodes);
  const edges = useStore(s => s.graphEdges);
  const runtime = useStore(s => s.nodeRuntime);
  const status = useStore(s => s.graphStatus);
  const running = useStore(s => s.graphRunning);
  const addGraphNode = useStore(s => s.addGraphNode);
  const moveGraphNode = useStore(s => s.moveGraphNode);
  const resizeGraphNode = useStore(s => s.resizeGraphNode);
  const removeGraphNode = useStore(s => s.removeGraphNode);
  const addGraphEdge = useStore(s => s.addGraphEdge);
  const removeGraphEdge = useStore(s => s.removeGraphEdge);
  const selectGraphNode = useStore(s => s.selectGraphNode);
  const setNodeParam = useStore(s => s.setNodeParam);
  const runGraph = useStore(s => s.runGraph);
  const cancelGraph = useStore(s => s.cancelGraph);
  const activeProjectId = useStore(s => s.activeProjectId);
  const loadGraphForProject = useStore(s => s.loadGraphForProject);
  const openNodeDop = useStore(s => s.openNodeDop);
  const addToTimeline = useStore(s => s.addToTimeline);
  const pushGraphHistory = useStore(s => s.pushGraphHistory);
  const undoGraph = useStore(s => s.undoGraph);
  const redoGraph = useStore(s => s.redoGraph);
  const canUndo = useStore(s => s.graphUndoStack.length > 0);
  const canRedo = useStore(s => s.graphRedoStack.length > 0);
  const dopOpen = useStore(s => s.dopOpen);
  const setTimelineFocused = useStore(s => s.setTimelineFocused);
  const storedNodeMode = useStore(s => s.nodeMode);
  const setNodeMode = useStore(s => s.setNodeMode);
  // SPACE has no Edit mode (Edit IS the sequencer), so it is permanently on the
  // board. Reading it through this local means every `nodeMode === 'create'`
  // test below stays true in Space without a second branch at each site.
  const nodeMode = isSpace ? 'create' as const : storedNodeMode;
  const canvasList = useStore(s => s.canvasList);
  const activeCanvasId = useStore(s => s.activeCanvasId);
  const createCanvas = useStore(s => s.createCanvas);
  const switchCanvas = useStore(s => s.switchCanvas);
  const renameCanvas = useStore(s => s.renameCanvas);
  const deleteCanvas = useStore(s => s.deleteCanvas);
  const setCanvasEdgeStyle = useStore(s => s.setCanvasEdgeStyle);
  const setActiveView = useStore(s => s.setActiveView);
  const [canvasMenu, setCanvasMenu] = useState(false);
  // تشريح الإعلان — installed-breakdowns picker on the mind toolbar
  const [bdMenu, setBdMenu] = useState(false);
  const [bdList, setBdList] = useState<BreakdownSummary[] | null>(null);
  const [bdExporting, setBdExporting] = useState<string | null>(null);   // slug being printed
  const exportBreakdownPdf = async (slug: string) => {
    if (!slug || bdExporting) return;
    setBdExporting(slug);
    try { await window.hjen.mindBreakdownExportPdf({ slug }); }
    finally { setBdExporting(null); }
  };
  // الصياغة العربية — the task-assigned model (default: latest ChatGPT text)
  // re-authors the breakdown in Arabic, then the treatment PDF re-exports so
  // the comparison lands in the reader's hands immediately.
  const [bdArabic, setBdArabic] = useState<string | null>(null);      // slug being written
  const [bdArabicMsg, setBdArabicMsg] = useState<string | null>(null);
  const arabicRewrite = async (slug: string) => {
    if (!slug || bdArabic) return;
    setBdArabic(slug);
    setBdArabicMsg(null);
    try {
      const bd = await readBreakdown(slug);
      if (!bd) { setBdArabicMsg('التشريح غير موجود.'); return; }
      const res = await rewriteBreakdownArabic(bd);
      if (!res.ok) { setBdArabicMsg(res.message ?? 'فشلت الصياغة.'); return; }
      await window.hjen.mindBreakdownExportPdf({ slug });
    } finally { setBdArabic(null); }
  };
  const activeCanvas = canvasList.find(c => c.id === activeCanvasId);
  const activeCanvasName = activeCanvas?.name ?? 'Canvas 1';
  // لوحة التفكير — the current canvas is a thinking canvas, not a media one.
  const isMind = activeCanvas?.kind === 'mind';
  // Wire shape for this canvas (mind → orthogonal steps · media → classic curve).
  const edgeStyle: EdgeStyle = activeCanvas?.edgeStyle ?? (isMind ? 'step' : 'curve');
  const mindBusy = useMindCanvas(s => s.busy);
  const mindError = useMindCanvas(s => s.error);
  const setMindError = useMindCanvas(s => s.setError);
  const MIND_BUSY_LINE: Record<string, string> = {
    analyze: 'Reading the brief — compressing the truth…',
    collide: 'Running the collision machines…',
    press: 'Kill-gate, then pressing into territories…',
  };

  // Keep-alive guard — a hidden NodeView (another tab active) must NOT reload the
  // GLOBAL graph for whatever project just became active; that would fight the
  // visible view. Only the active instance loads its project's graph. When this
  // tab is re-selected, `active` flips true and applyTabNav has already restored
  // its projectId, so the correct graph loads.
  const active = useTabActive();
  useEffect(() => { if (active) loadGraphForProject(activeProjectId, surface); }, [active, activeProjectId, surface, loadGraphForProject]);

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const boardRef = useRef<HTMLDivElement>(null);
  /** The stage the floating rail lives over — its rect bounds the drag and
   *  decides which edge a drop docks to. */
  const stageRef = useRef<HTMLDivElement>(null);
  /** The tool wheel — every HJEN tool on a dial, opened from the board's
   *  bottom-centre (or Space). It lives INSIDE the stage, so in Node it rises
   *  above the Sequence dock without knowing the dock exists. */
  const [wheelOpen, setWheelOpen] = useState(false);
  /** HJEN SPACE — the production the gateway agent laid out for this canvas.
   *  Its presence is what swaps the empty state for the rail. */
  const spacePlan = useStore(s => s.spacePlan);
  const [pending, setPending] = useState<{ from: { node: string; param: string }; color: string; x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; bx: number; by: number; q: string } | null>(null);
  // Selection tool: 'select' = click/marquee-select, 'pan' = drag the canvas.
  const [chooser, setChooser] = useState<{ nodeId: string; param: string; lib: Array<{ id: string; name: string; filePath: string; thumbPath: string }> } | null>(null);
  const [tool, setTool] = useState<'select' | 'pan'>('select');
  const [sel, setSel] = useState<string[]>([]);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const marqueeRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  // MCP is now the GLOBAL dock (store-driven) — the canvas button opens the
  // same drawer the top-bar MCP button does. One unified surface.
  const mcpOpen = useStore(s => s.mcpDockOpen);
  const toggleMcpDock = useStore(s => s.toggleMcpDock);
  const [historyOpen, setHistoryOpen] = useState(false);
  // لوحة التفكير — the text node being written inline; the arrange animation
  // window; the Finder file-drop hover state (all mind-canvas only).
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [arranging, setArranging] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const arrangeGraphNodes = useStore(s => s.arrangeGraphNodes);
  // Group draw mode — the Group rail tool arms this; the next board drag marks
  // where the frame lands (Anwar: «المجموعة تُرسم حيث يحددها المستخدم»).
  const [groupArmed, setGroupArmed] = useState(false);
  const [drawRect, setDrawRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const drawRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [filterMenu, setFilterMenu] = useState(false);
  const [filter, setFilter] = useState<{ favOnly: boolean; hideRejected: boolean; labels: number[] }>({ favOnly: false, hideRejected: false, labels: [] });
  const filterActive = filter.favOnly || filter.hideRejected || filter.labels.length > 0;
  const cursorRef = useRef<{ x: number; y: number } | null>(null);   // last board-space cursor

  const toBoard = useCallback((clientX: number, clientY: number) => {
    const r = boardRef.current?.getBoundingClientRect();
    return { x: (clientX - (r?.left ?? 0) - pan.x) / scale, y: (clientY - (r?.top ?? 0) - pan.y) / scale };
  }, [pan, scale]);

  // ── The ONE size authority is sizeOfNode (lib/mindcanvas/sizes). Width is
  //    delegated wholesale (user resize → type default → media fallback). Height
  //    delegates too, EXCEPT a media-canvas card with no user resize keeps its
  //    content-driven height (title + ports + preview) — a rendering detail, not
  //    a size default, so the "one authority" law holds.
  const nodeW = (n: NodeInstance): number => sizeOfNode(n).w;
  const nodeH = (n: NodeInstance): number => {
    if (!n.size && !MIND_NODE_SIZE[n.type] && !(isMind && n.type === 'source')) {
      const spec = getNodeSpec(n.type);
      if (!spec) return TITLE_H;
      const ports = portRows(spec).length * SOCKET_H;
      const hasPrev = !!previewOf(n);
      return TITLE_H + ports + (hasPrev ? PREVIEW_H : 0);
    }
    return sizeOfNode(n).h;
  };
  // Nodes whose sockets anchor mid-left / mid-right (mind cards + group + file),
  // rather than on stacked port rows like media nodes.
  const usesMidSocket = (n: NodeInstance): boolean => !!MIND_BODIES[n.type] || n.type === 'group' || n.type === 'file';
  // Socket anchor: media nodes sit on port rows; card nodes (no rows) anchor
  // both dot (CSS top:50%) and wire endpoint to the card's vertical centre.
  const socketOffY = (n: NodeInstance, spec: NodeSpec, kind: 'input' | 'output', param: string): number =>
    usesMidSocket(n) ? nodeH(n) / 2 : socketCenterY(spec, kind, param);

  // Drop a node at the centre of the current viewport.
  const addNodeCentered = (type: string) => {
    const r = boardRef.current?.getBoundingClientRect();
    const cx = (r?.width ?? 800) / 2, cy = (r?.height ?? 500) / 2;
    addGraphNode(type, { x: (cx - pan.x) / scale - NODE_W / 2, y: (cy - pan.y) / scale - 30 });
  };
  // Drop a node centred on a board-space point (used by the creation shortcuts).
  const addNodeAt = (type: string, at: { x: number; y: number }) => {
    addGraphNode(type, { x: at.x - NODE_W / 2, y: at.y - 20 });
  };

  const zoomStep = (dir: 1 | -1) => {
    const r = boardRef.current?.getBoundingClientRect();
    const mx = (r?.width ?? 800) / 2, my = (r?.height ?? 500) / 2;
    setScale(prev => {
      const next = clamp(prev * (dir > 0 ? 1.15 : 0.87), SCALE_BOUNDS.min, SCALE_BOUNDS.max);
      setPan(pp => ({ x: mx - ((mx - pp.x) / prev) * next, y: my - ((my - pp.y) / prev) * next }));
      return next;
    });
  };
  const fitView = () => {
    const box = nodesBBox(nodes, (n) => ({ w: nodeW(n), h: nodeH(n) }));
    const r = boardRef.current?.getBoundingClientRect();
    if (!box || !r) { setPan({ x: 0, y: 0 }); setScale(1); return; }
    const t = fitTransform(box, { w: r.width, h: r.height });
    setScale(t.scale); setPan(t.pan);
  };

  // ---- Arrange (زر ترتيب) — tidy the whole board, or just the selection ----
  const onArrange = () => {
    const targets = sel.length >= 2 ? nodes.filter(n => sel.includes(n.id)) : nodes;
    const moves = arrangeNodes(targets, edges);
    if (!moves.length) return;
    setArranging(true);
    arrangeGraphNodes(moves);   // ONE history push, batched
    window.setTimeout(() => setArranging(false), 520);
  };

  // ---- Arrange INSIDE a group — tidy its geometric members, anchored so the
  //      tidy block lands within the frame (below its title strip), not across
  //      the whole board. Members = nodes whose centre sits inside, non-groups. ----
  const arrangeInsideGroup = (g: NodeInstance) => {
    const gx = g.position.x, gy = g.position.y, gw = nodeW(g), gh = nodeH(g);
    const members = nodes.filter(m => {
      if (m.id === g.id || m.type === 'group') return false;
      const cx = m.position.x + nodeW(m) / 2, cy = m.position.y + nodeH(m) / 2;
      return cx >= gx && cx <= gx + gw && cy >= gy && cy <= gy + gh;
    });
    if (members.length < 2) return;
    const moves = arrangeNodes(members, edges, { x: gx + 24, y: gy + GROUP_BAR_H + 16 });
    if (!moves.length) return;
    setArranging(true);
    arrangeGraphNodes(moves);
    window.setTimeout(() => setArranging(false), 520);
  };

  // ---- Text tool on the mind canvas → create + open in edit state ----
  const addMindText = () => {
    addNodeCentered('text');
    const id = useStore.getState().selectedNodeId;
    if (id) setEditingTextId(id);
  };

  // ---- Finder image drop → a Source node per image (moodboard) ----
  const onBoardDragOver = (e: React.DragEvent) => {
    if (!isMind) return;
    if (Array.from(e.dataTransfer.items || []).some(it => it.kind === 'file')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (!dropActive) setDropActive(true);
    }
  };
  const onBoardDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget === e.target) setDropActive(false);
  };
  // A path becomes a Source (image → part of the moodboard) or a File card
  // (video / audio / pdf / doc / deck / text → an attachment with an Open action).
  const createNodeForPath = (path: string, at: { x: number; y: number }) => {
    if (IMAGE_FILE_RE.test(path)) {
      addGraphNode('source', { x: at.x - NODE_W / 2, y: at.y - 20 });
      const id = useStore.getState().selectedNodeId;
      if (id) setNodeParam(id, 'asset', { path, name: baseName(path) });
    } else {
      addGraphNode('file', { x: at.x - NODE_W / 2, y: at.y - 20 });
      const id = useStore.getState().selectedNodeId;
      if (id) { setNodeParam(id, 'path', path); setNodeParam(id, 'name', baseName(path)); setNodeParam(id, 'kind', fileKindOf(path)); }
    }
  };
  const createNodesForPaths = (paths: string[], at: { x: number; y: number }) => {
    paths.filter(Boolean).forEach((path, i) => createNodeForPath(path, { x: at.x + i * 26, y: at.y + i * 26 }));
  };

  // Professional import — pick any files (images, video, audio, docs, decks)
  // and drop them onto the board at the current viewport centre.
  const onAddFiles = async () => {
    const paths = await window.hjen.pickAnyFiles({ title: 'Add files to the canvas' }).catch(() => null);
    if (!paths?.length) return;
    const r = boardRef.current?.getBoundingClientRect();
    const cx = (r?.width ?? 800) / 2, cy = (r?.height ?? 500) / 2;
    createNodesForPaths(paths, { x: (cx - pan.x) / scale, y: (cy - pan.y) / scale });
  };

  const onBoardDrop = (e: React.DragEvent) => {
    if (!isMind) return;
    e.preventDefault();
    setDropActive(false);
    const files = Array.from(e.dataTransfer.files);
    if (!files.length) return;
    const at = toBoard(e.clientX, e.clientY);
    const paths = files.map(f => window.hjen.pathForFile(f)).filter(Boolean) as string[];
    createNodesForPaths(paths, at);
  };

  // ---- Node dragging (moves the whole selection as a group) ----
  const dragRef = useRef<{ ids: string[]; start: Record<string, { x: number; y: number }>; from: { x: number; y: number }; pushed?: boolean } | null>(null);
  const startNodeDrag = (e: React.PointerEvent, n: NodeInstance) => {
    const t = e.target as HTMLElement;
    if (t.dataset.port || t.closest('.nodrag')) return;
    e.stopPropagation();
    setMenu(null);
    // Update selection (shift toggles; plain click selects just this node unless
    // it's already part of a multi-selection being dragged).
    let ids: string[];
    if (e.shiftKey) {
      ids = sel.includes(n.id) ? sel.filter(x => x !== n.id) : [...sel, n.id];
    } else {
      ids = sel.includes(n.id) && sel.length > 1 ? sel : [n.id];
    }
    setSel(ids);
    selectGraphNode(ids.length === 1 ? ids[0] : n.id);
    const from = toBoard(e.clientX, e.clientY);
    // Group membership is GEOMETRIC: dragging a group frame carries every node
    // whose centre sits inside it. Computed once here — no schema, no bookkeeping.
    const moveIds = new Set(ids);
    for (const gid of ids) {
      const g = nodes.find(x => x.id === gid);
      if (g?.type !== 'group' && g?.type !== 'mind.myMind') continue;
      const gx = g.position.x, gy = g.position.y, gw = nodeW(g), gh = nodeH(g);
      for (const m of nodes) {
        if (m.id === gid) continue;
        const cx = m.position.x + nodeW(m) / 2, cy = m.position.y + nodeH(m) / 2;
        if (cx >= gx && cx <= gx + gw && cy >= gy && cy <= gy + gh) moveIds.add(m.id);
      }
    }
    const start: Record<string, { x: number; y: number }> = {};
    for (const id of moveIds) { const nn = nodes.find(x => x.id === id); if (nn) start[id] = { ...nn.position }; }
    dragRef.current = { ids: Array.from(moveIds), start, from };
  };

  // ---- Corner resize (Anwar: تكبير/تصغير العقد بالسحب — especially images) ----
  const resizeRef = useRef<{ id: string; type: string; w0: number; h0: number; px: number; py: number; pushed?: boolean } | null>(null);
  const startResize = (e: React.PointerEvent, n: NodeInstance) => {
    e.stopPropagation();
    e.preventDefault();
    resizeRef.current = { id: n.id, type: n.type, w0: nodeW(n), h0: nodeH(n), px: e.clientX, py: e.clientY };
  };

  // ---- Board pointer: pan OR marquee-select depending on the tool ----
  const panRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const startPan = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    setMenu(null);
    setTimelineFocused(false);   // the canvas has focus now, not the dock
    // Group draw mode owns this gesture — mark the frame, suppress pan/marquee.
    if (groupArmed) {
      const p = toBoard(e.clientX, e.clientY);
      drawRef.current = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      setDrawRect(drawRef.current);
      return;
    }
    if (tool === 'pan' || e.altKey) {
      panRef.current = { x: pan.x, y: pan.y, px: e.clientX, py: e.clientY };
    } else {
      if (!e.shiftKey) { setSel([]); selectGraphNode(null); }
      const p = toBoard(e.clientX, e.clientY);
      marqueeRef.current = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      setMarquee(marqueeRef.current);
    }
  };

  const startConnect = (e: React.PointerEvent, n: NodeInstance, param: string, color: string) => {
    e.stopPropagation();
    const p = toBoard(e.clientX, e.clientY);
    setPending({ from: { node: n.id, param }, color, x: p.x, y: p.y });
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (resizeRef.current) {
        const r = resizeRef.current;
        const dw = (e.clientX - r.px) / scale, dh = (e.clientY - r.py) / scale;
        if (!r.pushed && (Math.abs(dw) > 0.5 || Math.abs(dh) > 0.5)) { pushGraphHistory('Resize'); r.pushed = true; }
        const min = minSizeOfType(r.type);
        resizeGraphNode(r.id, { w: Math.round(Math.max(min.w, r.w0 + dw)), h: Math.round(Math.max(min.h, r.h0 + dh)) });
        return;
      }
      if (dragRef.current) {
        const p = toBoard(e.clientX, e.clientY);
        const { ids, start, from } = dragRef.current;
        const dx = p.x - from.x, dy = p.y - from.y;
        // One undo step per drag gesture: snapshot on the first actual move.
        if (!dragRef.current.pushed && (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)) { pushGraphHistory('Move'); dragRef.current.pushed = true; }
        for (const id of ids) { const s = start[id]; if (s) moveGraphNode(id, { x: s.x + dx, y: s.y + dy }); }
      } else if (panRef.current) {
        const d = panRef.current;
        setPan({ x: d.x + (e.clientX - d.px), y: d.y + (e.clientY - d.py) });
      } else if (drawRef.current) {
        const p = toBoard(e.clientX, e.clientY);
        drawRef.current = { ...drawRef.current, x1: p.x, y1: p.y };
        setDrawRect(drawRef.current);
      } else if (marqueeRef.current) {
        const p = toBoard(e.clientX, e.clientY);
        marqueeRef.current = { ...marqueeRef.current, x1: p.x, y1: p.y };
        setMarquee(marqueeRef.current);
      } else if (pending) {
        const p = toBoard(e.clientX, e.clientY);
        setPending(pd => pd ? { ...pd, x: p.x, y: p.y } : pd);
      }
    };
    const up = (e: PointerEvent) => {
      if (drawRef.current) {
        const m = drawRef.current;
        const x = Math.min(m.x0, m.x1), y = Math.min(m.y0, m.y1);
        const w = Math.abs(m.x1 - m.x0), h = Math.abs(m.y1 - m.y0);
        drawRef.current = null;
        setDrawRect(null);
        setGroupArmed(false);
        // A real drag (≥ ~80×60 board-px) draws the frame there; a tiny drag cancels.
        if (w >= 80 && h >= 60) {
          addGraphNode('group', { x, y });
          const id = useStore.getState().selectedNodeId;
          if (id) resizeGraphNode(id, { w: Math.round(w), h: Math.round(h) });
        }
        return;
      }
      if (pending) {
        const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
        const portEl = el?.closest('[data-port="in"]') as HTMLElement | null;
        const toNode = portEl?.dataset.node;
        const toParam = portEl?.dataset.param;
        if (toNode && toParam && toNode !== pending.from.node) addGraphEdge(pending.from, { node: toNode, param: toParam });
        setPending(null);
      }
      if (marqueeRef.current) {
        const m = marqueeRef.current;
        const rx0 = Math.min(m.x0, m.x1), rx1 = Math.max(m.x0, m.x1);
        const ry0 = Math.min(m.y0, m.y1), ry1 = Math.max(m.y0, m.y1);
        // Only treat as a marquee if the user actually dragged a box.
        if (rx1 - rx0 > 4 || ry1 - ry0 > 4) {
          const hit = nodes.filter(n => {
            // A frame (group / My Mind) is only grabbed by its title-bar strip —
            // never its body, so the marquee can select the cards INSIDE it.
            const barOnly = n.type === 'group' || n.type === 'mind.myMind';
            const nx0 = n.position.x, nx1 = n.position.x + nodeW(n), ny0 = n.position.y;
            const ny1 = n.position.y + (barOnly ? GROUP_BAR_H : nodeH(n));
            return nx0 < rx1 && nx1 > rx0 && ny0 < ry1 && ny1 > ry0;
          }).map(n => n.id);
          setSel(prev => {
            const next = e.shiftKey ? Array.from(new Set([...prev, ...hit])) : hit;
            selectGraphNode(next.length === 1 ? next[0] : null);
            return next;
          });
        }
        marqueeRef.current = null;
        setMarquee(null);
      }
      // ── My Mind drop — a Breakdown element released inside the frame COPIES
      //    itself into mymind.json (provenance kept) and the original snaps
      //    back to where it lived: the breakdown ring stays whole. ──
      if (dragRef.current?.pushed) {
        const drag = dragRef.current;
        const st = useStore.getState();
        const frames = st.graphNodes.filter(x => x.type === 'mind.myMind');
        if (frames.length) {
          const drops: Array<{ node: NodeInstance; back: { x: number; y: number } }> = [];
          for (const id of drag.ids) {
            const n = st.graphNodes.find(x => x.id === id);
            if (!n || n.type !== 'mind.bdElement') continue;
            if (!pstr(n.paramValues.entity).startsWith('bd:')) continue;
            const cx = n.position.x + nodeW(n) / 2, cy = n.position.y + nodeH(n) / 2;
            const hit = frames.some(f => cx >= f.position.x && cx <= f.position.x + nodeW(f)
              && cy >= f.position.y && cy <= f.position.y + nodeH(f));
            const back = drag.start[id];
            if (hit && back) drops.push({ node: n, back });
          }
          if (drops.length) void copyIntoMyMind(drops);
        }
      }
      dragRef.current = null;
      panRef.current = null;
      resizeRef.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [pending, toBoard, moveGraphNode, addGraphEdge, nodes, pushGraphHistory, scale, resizeGraphNode, addGraphNode]);

  // Escape cancels an armed group-draw (before the node shortcuts see it).
  useEffect(() => {
    if (!groupArmed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault(); e.stopPropagation();
      setGroupArmed(false); setDrawRect(null); drawRef.current = null;
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [groupArmed]);

  // ---- Wheel zoom ----
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = board.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        // ⌘/⌃-scroll (and trackpad pinch) → zoom at cursor.
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        setScale(prevScale => {
          const next = clamp(prevScale * (1 - e.deltaY * 0.0015), SCALE_BOUNDS.min, SCALE_BOUNDS.max);
          setPan(prevPan => ({ x: mx - ((mx - prevPan.x) / prevScale) * next, y: my - ((my - prevPan.y) / prevScale) * next }));
          return next;
        });
      } else if (e.shiftKey) {
        setPan(pp => ({ x: pp.x - (e.deltaY || e.deltaX), y: pp.y }));   // horizontal pan
      } else {
        setPan(pp => ({ x: pp.x - e.deltaX, y: pp.y - e.deltaY }));      // pan
      }
    };
    board.addEventListener('wheel', onWheel, { passive: false });
    return () => board.removeEventListener('wheel', onWheel);
  }, []);

  // Keep the local selection valid when nodes change (undo/redo/delete).
  useEffect(() => {
    setSel(prev => {
      const live = new Set(nodes.map(n => n.id));
      const next = prev.filter(id => live.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [nodes]);

  // Canvas keyboard layer — scoped to this view (unmounts with NodeView).
  const shortcutApi: NodeShortcutApi = {
    nodes, edges, sel, setSel,
    cursor: cursorRef, boardRef, pan, scale, setPan, setScale,
    nodeSize: (n) => ({ w: nodeW(n), h: nodeH(n) }),
    // On a mind canvas the creation shortcuts drop thought blocks, the moodboard
    // media (image/frame/video), or bare text — but not the rest of the pipeline.
    addNodeAt: (type, at) => {
      if (isMind && !type.startsWith('mind.') && !MIND_ALLOWED.has(type)) return;
      addNodeAt(type, at);
    },
    toggleTool: () => setTool(t => (t === 'select' ? 'pan' : 'select')),
    toggleFilter: () => setFilterMenu(o => !o),
    openHelp: () => setHelpOpen(o => !o),
    closeMenu: () => setMenu(null),
    menuOpen: !!menu,
    helpOpen,
    // The wheel owns the keyboard while it is open (its own field has focus and
    // handles ←/→/↵/esc), so the canvas keymap must stand down — except for the
    // Space that closes it again, which is why the guard lives in the runner.
    blocked: dopOpen || !!chooser || historyOpen || filterMenu,   // NOT mcpOpen — MCP is a non-blocking drawer
    toggleWheel: () => setWheelOpen(o => !o),
    surface,
    enabled: active,
  };
  useNodeShortcuts(shortcutApi);

  // Timeline owns the keyboard in Edit mode; the canvas owns it in Create.
  // Space has no timeline at all, so the canvas always owns it there.
  useEffect(() => { if (active) setTimelineFocused(!isSpace && nodeMode === 'edit'); }, [active, isSpace, nodeMode, setTimelineFocused]);

  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const r = boardRef.current?.getBoundingClientRect();
    const sx = e.clientX - (r?.left ?? 0), sy = e.clientY - (r?.top ?? 0);
    setMenu({ x: sx, y: sy, bx: (sx - pan.x) / scale, by: (sy - pan.y) / scale, q: '' });
  };
  const addFromMenu = (type: string) => {
    if (!menu) return;
    addGraphNode(type, { x: menu.bx - NODE_W / 2, y: menu.by - 20 });
    setMenu(null);
  };

  const onAssetAction = async (node: NodeInstance, p: Parameter) => {
    if (p.control === 'selections') { openNodeDop(node.id); return; }
    if (p.control === 'asset') {
      // Offer a choice: project/library images OR a file from the device.
      const lib = await window.hjen.listLibrary().catch(() => []);
      setChooser({ nodeId: node.id, param: p.name, lib });
    }
  };

  const pickFromDevice = async (nodeId: string, param: string) => {
    const paths = await window.hjen.pickImageFiles();
    const first = paths?.[0];
    if (first) setNodeParam(nodeId, param, { path: first, name: first.split('/').pop() });
    setChooser(null);
  };

  const previewOf = (n: NodeInstance): { kind: 'image' | 'video'; src: string; poster?: string } | null => {
    const rt = runtime[n.id];
    const out = rt?.outputs?.out;
    if (out?.type === 'image' && (out.url || out.path)) return { kind: 'image', src: out.url || fileUrl(out.path!) };
    if (out?.type === 'video' && out.path) return { kind: 'video', src: fileUrl(out.path), poster: out.posterPath ? fileUrl(out.posterPath) : undefined };
    if ((n.type === 'source' || n.type === 'set') && (n.paramValues.asset || n.paramValues.plate)) {
      const a = (n.paramValues.asset || n.paramValues.plate) as { path?: string; thumbPath?: string } | undefined;
      const t = a?.thumbPath || a?.path;
      if (t) return { kind: 'image', src: fileUrl(t) };
    }
    return null;
  };

  const menuItems = menu ? [...PRIMARY_TOOLS, ...SECONDARY_TOOLS, ...EXTRA_TOOLS]
    .map(t => getNodeSpec(t)).filter(Boolean)
    .filter(s => (s!.label + ' ' + s!.sub).toLowerCase().includes(menu.q.toLowerCase())) as NodeSpec[] : [];

  // Wire obstacles — every node box (via sizeOfNode), EXCEPT groups (wires may
  // cross the translucent frames) and the edge's own two endpoints. The step
  // router steers around whatever remains.
  const nodeRects = nodes
    .filter(n => n.type !== 'group')
    .map(n => ({ id: n.id, x: n.position.x, y: n.position.y, w: nodeW(n), h: nodeH(n) }));
  const obstaclesExcept = (a: string, b?: string) =>
    nodeRects.filter(r => r.id !== a && r.id !== b).map(({ x, y, w, h }) => ({ x, y, w, h }));
  // Groups are the visual mind's frames — painted BEHIND every other node.
  // Stable-sort them first so DOM order (= paint order) puts them at the back.
  const isFrame = (t: string) => t === 'group' || t === 'mind.myMind';
  const ordered = [...nodes].sort((a, b) => (isFrame(a.type) ? 0 : 1) - (isFrame(b.type) ? 0 : 1));

  // One node selected → its inspector. Many → the Selection panel.
  const selNode = sel.length === 1 ? (nodes.find(n => n.id === sel[0]) ?? null) : null;
  const selSpec = selNode ? getNodeSpec(selNode.type) : null;
  const selBox = (() => {
    if (sel.length < 2) return null;
    const ns = nodes.filter(n => sel.includes(n.id));
    if (!ns.length) return null;
    const x0 = Math.min(...ns.map(n => n.position.x));
    const y0 = Math.min(...ns.map(n => n.position.y));
    const x1 = Math.max(...ns.map(n => n.position.x + nodeW(n)));
    return { cx: (x0 + x1) / 2, top: y0 };
  })();

  // Filter overlay: dim nodes that fail the active criteria (favorites only /
  // hide rejected / only these colour labels). Inactive → nothing dims.
  const isFilteredOut = (n: NodeInstance): boolean => {
    if (!filterActive) return false;
    if (filter.favOnly && !n.favorite) return true;
    if (filter.hideRejected && n.rejected) return true;
    if (filter.labels.length && (!n.colorLabel || !filter.labels.includes(n.colorLabel))) return true;
    return false;
  };

  /** Wrap the tool buttons in the right rail shell. SPACE gets the movable /
   *  collapsible rail; Node keeps the fixed left rail it has always had, until
   *  the movable one is signed off for it too. A plain function, not a
   *  component — an inline component type remounts every render, which would
   *  kill the floating rail's drag mid-gesture. */
  const railShell = (children: React.ReactNode) => (
    isSpace
      ? <FloatingToolRail surface="space" stageRef={stageRef} label="Create tools">{children}</FloatingToolRail>
      : <aside className="nv-toolrail">{children}</aside>
  );

  const ToolBtn = ({ type }: { type: string }) => (
    <button className="nv-tool" title={TOOL_LABEL[type]} onClick={() => addNodeCentered(type)}
      style={{ ['--nv-accent' as any]: getNodeSpec(type)?.accent ?? '#888' }}>
      {ICONS[type]}
    </button>
  );
  // The Group tool arms draw mode (a frame is marked on the board), rather than
  // dropping one at viewport centre — Anwar: the frame lands where you draw it.
  const GroupTool = () => (
    <button className={`nv-tool ${groupArmed ? 'nv-tool--on' : ''}`} title="Group — draw a frame on the board"
      onClick={() => setGroupArmed(a => !a)}
      style={{ ['--nv-accent' as any]: getNodeSpec('group')?.accent ?? '#888' }}>
      {ICONS.group}
    </button>
  );

  return (
    <div className="nodeview nv--m">
      {/* Canvas toolbar */}
      <header className="nv-cbar">
        <div className="nv-cbar__l">
          <div className="nv-canvassel">
            <button className="nv-canvas-pill" onClick={() => setCanvasMenu(o => !o)}>
              {isMind && (
                <span className="nv-canvasmenu__mind" aria-hidden="true" style={{ color: MIND_ACCENT }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="7" cy="8" r="2.4" /><circle cx="17" cy="8" r="2.4" /><circle cx="12" cy="17" r="2.4" /><path d="M9 9l3 6 3-6M9.2 8h5.6" /></svg>
                </span>
              )}
              <span>{activeCanvasName}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
            </button>
            {canvasMenu && (
              <>
                <div className="nv-canvasmenu__scrim" onClick={() => setCanvasMenu(false)} />
                <div className="nv-canvasmenu">
                  <div className="nv-canvasmenu__head mono-label">Canvases</div>
                  {canvasList.map(c => (
                    <div key={c.id} className={`nv-canvasmenu__row ${c.id === activeCanvasId ? 'nv-canvasmenu__row--on' : ''}`}>
                      <button className="nv-canvasmenu__name" onClick={() => { switchCanvas(c.id); setCanvasMenu(false); }}
                        onDoubleClick={() => { const n = prompt('Rename canvas', c.name); if (n) renameCanvas(c.id, n); }}>
                        {c.kind === 'mind' && (
                          <span className="nv-canvasmenu__mind" title="Thinking canvas" aria-hidden="true">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="7" cy="8" r="2.4" /><circle cx="17" cy="8" r="2.4" /><circle cx="12" cy="17" r="2.4" /><path d="M9 9l3 6 3-6M9.2 8h5.6" /></svg>
                          </span>
                        )}
                        {c.name}
                      </button>
                      {canvasList.length > 1 && (
                        <button className="nv-canvasmenu__del" title="Delete canvas"
                          onClick={() => { if (confirm(`Delete "${c.name}"? Its nodes are removed.`)) deleteCanvas(c.id); }}>✕</button>
                      )}
                    </div>
                  ))}
                  <button className="nv-canvasmenu__new" onClick={() => { createCanvas(); setCanvasMenu(false); }}>＋ New canvas</button>
                  <button className="nv-canvasmenu__new" onClick={() => { createCanvas(undefined, 'mind'); setCanvasMenu(false); }}>＋ Mind canvas · لوحة التفكير</button>
                </div>
              </>
            )}
          </div>
          {!isMind && !isSpace && (
            <div className="nv-modeseg">
              <button className={`nv-tbtn ${nodeMode === 'create' ? 'nv-tbtn--on' : ''}`} onClick={() => setNodeMode('create')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>Create
              </button>
              <button className={`nv-tbtn ${nodeMode === 'edit' ? 'nv-tbtn--on' : ''}`} onClick={() => setNodeMode('edit')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="2.6" /><circle cx="6" cy="18" r="2.6" /><path d="M20 4L8.5 15.5M14.5 14.5L20 20M8.5 8.5L12 12" /></svg>Edit
              </button>
            </div>
          )}
          {/* لوحة التفكير — the mind actions live left-of-centre; canvas tools sit right. */}
          {isMind && (
            <div className="nv-mindbar" style={{ ['--nv-accent' as any]: MIND_ACCENT }}>
              <button className="nv-tbtn nv-mind-tbtn" disabled={!!mindBusy} onClick={() => void drawSeedsOnCanvas()}>Draw seeds</button>
              <button className="nv-tbtn nv-tbtn--mind" disabled={!!mindBusy} onClick={() => void collideOnCanvas()}>Collide ×10</button>
              <button className="nv-tbtn nv-tbtn--mind" disabled={!!mindBusy} onClick={() => void pressOnCanvas()}>Press</button>
              <button className="nv-tbtn nv-mind-tbtn" disabled={!!mindBusy} onClick={() => void importNotesOnCanvas()}>Import notes</button>
              {/* تشريح الإعلان — load an installed Breakdown 360 onto this canvas */}
              <div className="nv-filterwrap">
                <button className={`nv-tbtn nv-mind-tbtn ${bdMenu ? 'nv-tbtn--on' : ''}`}
                  title="Breakdown 360 — a world-class ad, reverse-read as if HJEN made it"
                  onClick={() => {
                    setBdMenu(o => !o);
                    if (!bdMenu) { setBdList(null); void listBreakdowns().then(setBdList); }
                  }}>Breakdown</button>
                {bdMenu && (
                  <>
                    <div className="nv-filtermenu__scrim" onClick={() => setBdMenu(false)} />
                    <div className="nv-filtermenu">
                      <div className="nv-filtermenu__head mono-label">Breakdowns 360</div>
                      {bdList === null && <div className="nv-bdmenu__empty mono-label">Reading…</div>}
                      {bdList !== null && bdList.length === 0 && (
                        <div className="nv-bdmenu__empty mono-label" dir="auto">
                          No breakdowns installed yet — they land in _mind/breakdowns.
                        </div>
                      )}
                      {(bdList ?? []).map(b => (
                        <div key={b.slug} className="nv-bdmenu__rowwrap">
                          <button className="nv-bdmenu__row nodrag"
                            onClick={() => { setBdMenu(false); void loadBreakdownOnCanvas(b.slug); }}>
                            <span className="nv-bdmenu__brand mono-label">{b.brand}</span>
                            <span className="nv-bdmenu__title">{b.title}</span>
                            <span className="nv-bdmenu__meta mono-label">{b.frames}f{b.approved ? ' · ✓' : ''}</span>
                          </button>
                          <button className="nv-bdmenu__pdf nodrag" disabled={!!bdExporting}
                            title="Export the treatment PDF · معالجة الإعلان"
                            onClick={() => void exportBreakdownPdf(b.slug)}>
                            {bdExporting === b.slug ? '…' : 'PDF'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <button className="nv-tbtn nv-mind-tbtn" title="My Mind — your curated pipeline DNA; drag Breakdown findings into it"
                onClick={() => void openMyMindOnCanvas()}>My Mind</button>
              <span className="nv-tsep" />
              <button className="nv-tbtn nv-mind-arrange" title={sel.length >= 2 ? 'Arrange the selection' : 'Arrange — tidy the whole board'} disabled={nodes.length < 2} onClick={onArrange}>
                {ICONS.arrange}<span>{sel.length >= 2 ? `Arrange ${sel.length}` : 'Arrange'}</span>
              </button>
              <button className="nv-tbtn" title="Back to the cards view" onClick={() => setActiveView('brief')}>Cards view</button>
            </div>
          )}
        </div>
        <div className="nv-cbar__status mono-label">
          {isMind && mindError
            ? <button className="nv-mindbar__whisper mono-label" title="Dismiss" onClick={() => setMindError(null)}>{mindError} ✕</button>
            : (isMind && mindBusy ? MIND_BUSY_LINE[mindBusy] : status)}
        </div>
        <div className="nv-cbar__r">
          {(isMind || nodeMode === 'create') && (<>
            <div className="nv-tgroup">
              <button className="nv-tbtn nv-tbtn--icon" onClick={() => zoomStep(-1)} title="Zoom out">−</button>
              <span className="nv-tgroup__pct">{Math.round(scale * 100)}%</span>
              <button className="nv-tbtn nv-tbtn--icon" onClick={() => zoomStep(1)} title="Zoom in">+</button>
              <button className="nv-tbtn nv-tbtn--icon" onClick={fitView} title="Fit to view">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" /></svg>
              </button>
            </div>
            {/* Wire shape — steps / curve / straight, per canvas. */}
            <div className="nv-tgroup nv-wireseg" role="group" aria-label="Wire shape">
              {EDGE_STYLES.map(s => (
                <button key={s.value} className={`nv-tbtn nv-tbtn--icon ${edgeStyle === s.value ? 'nv-tbtn--on' : ''}`}
                  title={`Wire · ${s.label}`} onClick={() => activeCanvasId && setCanvasEdgeStyle(activeCanvasId, s.value)}>
                  {WIRE_ICON[s.value]}
                </button>
              ))}
            </div>
            {!isMind && <div className="nv-filterwrap">
              <button className={`nv-tbtn nv-tbtn--icon ${filterActive ? 'nv-tbtn--on' : ''}`} title="Filter takes (⇧F)" onClick={() => setFilterMenu(o => !o)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5h18l-7 8v5l-4 2v-7z" /></svg></button>
              {filterMenu && (
                <>
                  <div className="nv-filtermenu__scrim" onClick={() => setFilterMenu(false)} />
                  <div className="nv-filtermenu">
                    <div className="nv-filtermenu__head mono-label">Filter canvas</div>
                    <label className="nv-filtermenu__row"><input type="checkbox" checked={filter.favOnly} onChange={e => setFilter(f => ({ ...f, favOnly: e.target.checked }))} /> Favorites only ★</label>
                    <label className="nv-filtermenu__row"><input type="checkbox" checked={filter.hideRejected} onChange={e => setFilter(f => ({ ...f, hideRejected: e.target.checked }))} /> Hide rejected ✕</label>
                    <div className="nv-filtermenu__labels">
                      <span className="mono-label">Labels</span>
                      {[1, 2, 3, 4, 5].map(l => (
                        <button key={l} className={`nv-filtermenu__chip ${filter.labels.includes(l) ? 'nv-filtermenu__chip--on' : ''}`}
                          style={{ ['--chip' as any]: LABEL_COLORS[l] }}
                          onClick={() => setFilter(f => ({ ...f, labels: f.labels.includes(l) ? f.labels.filter(x => x !== l) : [...f.labels, l] }))} />
                      ))}
                    </div>
                    <button className="nv-filtermenu__clear" disabled={!filterActive} onClick={() => setFilter({ favOnly: false, hideRejected: false, labels: [] })}>Clear filter</button>
                  </div>
                </>
              )}
            </div>}
            <span className="nv-tsep" />
            <button className="nv-tbtn nv-tbtn--icon" onClick={() => undoGraph()} disabled={!canUndo} title="Undo (⌘Z)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-1" /></svg></button>
            <button className="nv-tbtn nv-tbtn--icon" onClick={() => redoGraph()} disabled={!canRedo} title="Redo (⇧⌘Z)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M15 7l5 5-5 5M20 12H9a5 5 0 0 0 0 10h1" /></svg></button>
            <button className={`nv-tbtn nv-tbtn--icon ${historyOpen ? 'nv-tbtn--on' : ''}`} title="History — last operations" onClick={() => setHistoryOpen(o => !o)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 4v4h4M12 8v4l3 2" /></svg></button>
            <button className="nv-tbtn nv-tbtn--icon" title="Keyboard shortcuts (⌘/)" onClick={() => setHelpOpen(o => !o)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 10h.01M11 10h.01M15 10h.01M8 14h8" /></svg></button>
            <span className="nv-tsep" />
          </>)}
          <button className={`nv-tbtn ${mcpOpen ? 'nv-tbtn--on' : ''}`} title="MCP — the Assistant builds nodes on this canvas; or connect an external agent" onClick={toggleMcpDock}>MCP</button>
          {!isMind && nodeMode === 'create' && (running
            ? <button className="nv-tbtn nv-tbtn--danger" onClick={cancelGraph}>Cancel</button>
            : <button className="nv-tbtn nv-tbtn--accent" onClick={runGraph}>Run</button>)}
        </div>
      </header>

      {/* ── THE PIPELINE RAIL — the production, across the top of the space.
       *  It lives between the canvas toolbar and the board on purpose: the plan
       *  is what the client reads first, and the board underneath is where the
       *  plan actually lands. SPACE only — Node has no gateway and no plan. */}
      {isSpace && !isMind && spacePlan && <PipelineRail />}

      {(nodeMode === 'create' || isMind) ? (<>
      <div className="nv-stage" ref={stageRef}>
        {/* Create-tool rail — cursor tools on top, then node tools. In SPACE it
         *  is a FloatingToolRail: grab the grip to move it anywhere over the
         *  stage, drop it near an edge to dock, fold it to a puck when the
         *  board needs the room. Node keeps the fixed left rail it has always
         *  had until the movable one is signed off for it too. */}
        {railShell(<>
          <button className={`nv-tool ${tool === 'select' ? 'nv-tool--on' : ''}`} title="Select tool (marquee)" onClick={() => setTool('select')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 8-6 1.5L10 20z" /></svg>
          </button>
          <button className={`nv-tool ${tool === 'pan' ? 'nv-tool--on' : ''}`} title="Pan tool (or hold Alt)" onClick={() => setTool('pan')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v6M10 10V5a2 2 0 0 0-4 0v9M6 12l-1-2a1.5 1.5 0 0 0-2.6 1.5C4 15 5 20 12 20a6 6 0 0 0 6-6v-3" /></svg>
          </button>
          <div className="nv-toolrail__div" />
          {isMind ? (<>
            {MIND_TOOLS.map(t => <ToolBtn key={t} type={t} />)}
            <div className="nv-toolrail__div" />
            {MIND_MEDIA_TOOLS.map(t => t === 'text'
              ? <button key={t} className="nv-tool" title={TOOL_LABEL[t]} onClick={addMindText}
                  style={{ ['--nv-accent' as any]: getNodeSpec(t)?.accent ?? '#888' }}>{ICONS[t]}</button>
              : t === 'group' ? <GroupTool key={t} /> : <ToolBtn key={t} type={t} />)}
            <button className="nv-tool" title="Add files — images, video, audio, documents"
              onClick={onAddFiles} style={{ ['--nv-accent' as any]: getNodeSpec('file')?.accent ?? '#888' }}>{ICONS.addfiles}</button>
          </>) : (<>
            {PRIMARY_TOOLS.map(t => <ToolBtn key={t} type={t} />)}
            <div className="nv-toolrail__div" />
            {SECONDARY_TOOLS.map(t => t === 'group' ? <GroupTool key={t} /> : <ToolBtn key={t} type={t} />)}
            <div className="nv-toolrail__div" />
            {EXTRA_TOOLS.map(t => <ToolBtn key={t} type={t} />)}
          </>)}
        </>)}

        {/* Board */}
        <div className={`nv-board ${tool === 'select' ? 'nv-board--sel' : ''} ${dropActive ? 'nv-board--drop' : ''} ${groupArmed ? 'nv-board--draw' : ''}`} ref={boardRef} onPointerDown={startPan} onContextMenu={openMenu}
          onPointerMove={(e) => { cursorRef.current = toBoard(e.clientX, e.clientY); }}
          onDragOver={onBoardDragOver} onDragLeave={onBoardDragLeave} onDrop={onBoardDrop}>
          <div className="nv-grid" style={{ backgroundPosition: `${pan.x}px ${pan.y}px`, backgroundSize: `${24 * scale}px ${24 * scale}px` }} />

          {nodes.length === 0 && isMind && (
            <div className="nv-empty">
              <div className="nv-empty__title">The thinking canvas</div>
              <div className="nv-empty__sub">Open a brief to begin — every thought becomes a block, every wire a lineage.</div>
            </div>
          )}

          {/* SPACE asks before it offers. An empty, never-asked canvas is the
           *  gateway; once a plan exists the rail owns the top and the board is
           *  left alone to receive what the steps make. */}
          {nodes.length === 0 && !isMind && isSpace && !spacePlan && (
            <SpaceGateway onBlank={t => addNodeCentered(t)} />
          )}

          {/* A plan exists but nothing has been run yet. "Start creating" would
           *  be wrong here — the work is already laid out; it is waiting for a
           *  press. Point at the rail instead of offering a different door. */}
          {nodes.length === 0 && !isMind && isSpace && spacePlan && (
            <div className="nv-empty">
              <div className="nv-empty__title">The production is laid out</div>
              <div className="nv-empty__sub">Open a pipeline above and press a step — it runs here, and lands on this board.</div>
            </div>
          )}

          {nodes.length === 0 && !isMind && !isSpace && (
            <div className="nv-empty">
              <div className="nv-empty__title">Start creating</div>
              <div className="nv-empty__sub">Create a subject, set, image, or video to begin</div>
              <div className="nv-empty__cards">
                {PRIMARY_TOOLS.map(t => (
                  <button key={t} className="nv-empty__card" style={{ ['--nv-accent' as any]: getNodeSpec(t)?.accent }} onClick={() => addNodeCentered(t)}>
                    <span className="nv-empty__icon">{ICONS[t]}</span>
                    <span className="nv-empty__label">{TOOL_LABEL[t]}</span>
                  </button>
                ))}
              </div>
              <div className="nv-empty__row">
                {SECONDARY_TOOLS.map(t => (
                  <button key={t} className="nv-empty__mini" onClick={() => addNodeCentered(t)}>
                    <span className="nv-empty__miniIcon">{ICONS[t]}</span>{TOOL_LABEL[t]}
                  </button>
                ))}
              </div>
            </div>
          )}

          <svg className="nv-edges">
            <g transform={`translate(${pan.x}, ${pan.y}) scale(${scale})`}>
              {edges.map(e => {
                const a = nodes.find(n => n.id === e.from.node);
                const b = nodes.find(n => n.id === e.to.node);
                if (!a || !b) return null;
                const sa = getNodeSpec(a.type); const sb = getNodeSpec(b.type);
                if (!sa || !sb) return null;
                const op = sa.params.find(p => p.name === e.from.param);
                // Card edges (mind · group · file) draw in their accent; media
                // edges keep their data-type colour.
                const color = usesMidSocket(a) ? sa.accent : (op ? TYPE_COLOR[op.dataType] : '#888');
                const sx = a.position.x + nodeW(a), sy = a.position.y + socketOffY(a, sa, 'output', e.from.param);
                const tx = b.position.x, ty = b.position.y + socketOffY(b, sb, 'input', e.to.param);
                const active = runtime[e.from.node]?.status === 'running' || runtime[e.to.node]?.status === 'running';
                if (edgeStyle === 'hidden') return null;   // wires hidden — clean board, lineage stays in the data
                const d = routeEdge(edgeStyle, sx, sy, tx, ty, obstaclesExcept(a.id, b.id));
                return (
                  <g key={e.id} className="nv-edge-g">
                    <path className={`nv-edge ${active ? 'nv-edge--active' : ''}`} style={{ stroke: color }} d={d} />
                    <path className="nv-edge-hit" d={d} onClick={() => removeGraphEdge(e.id)}><title>Click to disconnect</title></path>
                  </g>
                );
              })}
              {pending && (() => {
                const a = nodes.find(n => n.id === pending.from.node);
                const sa = a && getNodeSpec(a.type);
                if (!a || !sa) return null;
                const sx = a.position.x + nodeW(a), sy = a.position.y + socketOffY(a, sa, 'output', pending.from.param);
                // While CONNECTING the wire must stay visible even in hidden mode.
                const liveStyle = edgeStyle === 'hidden' ? (isMind ? 'step' : 'curve') : edgeStyle;
                return <path className="nv-edge nv-edge--pending" style={{ stroke: pending.color }} d={routeEdge(liveStyle, sx, sy, pending.x, pending.y, obstaclesExcept(a.id))} />;
              })()}
            </g>
          </svg>

          <div className={`nv-nodes ${arranging ? 'is-arranging' : ''}`} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`, transformOrigin: '0 0' }}>
            {ordered.map(n => {
              const spec = getNodeSpec(n.type);
              if (!spec) return null;

              // ── Group / My Mind — a Figma-style frame painted behind everything.
              //    Only the title bar (drag + rename) and resize handle take pointer
              //    events; the body is click-through so the marquee works inside it.
              //    My Mind is the same frame in the forensic-amber family — the drop
              //    target for elements dragged out of a Breakdown 360. ──
              if (n.type === 'group' || n.type === 'mind.myMind') {
                const isMyMind = n.type === 'mind.myMind';
                const labelParam = isMyMind ? 'title' : 'label';
                const editing = editingTextId === n.id;
                return (
                  <div key={n.id}
                    className={`nv-node nv-group ${isMyMind ? 'nv-group--mymind' : ''} ${sel.includes(n.id) ? 'is-sel' : ''} ${isFilteredOut(n) ? 'nv-node--dim' : ''}`}
                    style={{ left: n.position.x, top: n.position.y, width: nodeW(n), height: nodeH(n), ['--nv-accent' as any]: spec.accent }}
                  >
                    <div className="nv-group__bar" title={isMyMind ? 'My Mind — drag Breakdown findings in' : 'Drag to move the cluster · double-click to rename'}
                      onPointerDown={(e) => { if (!editing) startNodeDrag(e, n); }}
                      onDoubleClick={() => setEditingTextId(n.id)}>
                      {editing
                        ? <input className="nv-group__input nodrag" autoFocus dir="auto" value={pstr(n.paramValues[labelParam])}
                            onPointerDown={(e) => e.stopPropagation()}
                            onChange={(e) => setNodeParam(n.id, labelParam, e.target.value)}
                            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); setEditingTextId(null); } }}
                            onBlur={() => setEditingTextId(null)} />
                        : <span className="nv-group__label">{pstr(n.paramValues[labelParam]) || (isMyMind ? 'My Mind' : 'Group')}</span>}
                      <button className="nv-group__arrange nodrag" title="Arrange the frame's contents"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); arrangeInsideGroup(n); }}>{ICONS.arrange}</button>
                    </div>
                    {isMyMind && <div className="nv-group__hint mono-label" dir="auto">Drag findings from any breakdown into this frame — they copy; the breakdown stays whole.</div>}
                    <div className="nv-mind__sock nv-mind__sock--in" data-port="in" data-node={n.id} data-param="in" title="Lineage in" />
                    <div className="nv-mind__sock nv-mind__sock--out" data-port="out" data-node={n.id} data-param="out" title="Lineage out"
                      onPointerDown={(e) => startConnect(e, n, 'out', spec.accent)} />
                    <div className="nv-resize nodrag" title="Drag to resize" onPointerDown={(e) => startResize(e, n)} />
                  </div>
                );
              }

              // ── File — any dropped/picked document (video · audio · pdf · doc ·
              //    deck · text). Compact card: glyph/preview + name + Open. ──
              if (n.type === 'file') {
                const path = pstr(n.paramValues.path);
                const name = pstr(n.paramValues.name) || baseName(path) || 'File';
                const kind = pstr(n.paramValues.kind) || 'other';
                const url = path ? fileUrl(path) : '';
                return (
                  <div key={n.id}
                    className={`nv-node nv-file ${sel.includes(n.id) ? 'nv-node--sel' : ''} ${isFilteredOut(n) ? 'nv-node--dim' : ''}`}
                    style={{ left: n.position.x, top: n.position.y, width: nodeW(n), height: nodeH(n), ['--nv-accent' as any]: spec.accent }}
                    onPointerDown={(e) => startNodeDrag(e, n)}
                  >
                    {kind === 'audio' && url
                      ? <div className="nv-file__media nodrag"><audio src={url} controls /></div>
                      : kind === 'video' && url
                        ? <div className="nv-file__media nodrag"><video src={url} muted playsInline controls /></div>
                        : <span className="nv-file__glyph">{FILE_GLYPH[kind] ?? FILE_GLYPH.other}</span>}
                    <div className="nv-file__meta">
                      <span className="nv-file__name" title={name}>{name}</span>
                      <span className="nv-file__kind mono-label">{FILE_KIND_LABEL[kind] ?? kind}</span>
                    </div>
                    <button className="nv-file__open nodrag" title="Open in the default app"
                      disabled={!path} onClick={(e) => { e.stopPropagation(); if (path) void window.hjen.openFolder(path); }}>Open</button>
                    <div className="nv-mind__sock nv-mind__sock--in" data-port="in" data-node={n.id} data-param="in" title="Lineage in" />
                    <div className="nv-mind__sock nv-mind__sock--out" data-port="out" data-node={n.id} data-param="out" title="Lineage out"
                      onPointerDown={(e) => startConnect(e, n, 'out', spec.accent)} />
                    <div className="nv-resize nodrag" title="Drag to resize" onPointerDown={(e) => startResize(e, n)} />
                  </div>
                );
              }

              // ── لوحة التفكير — bare text: the words ARE the object (no card). ──
              if (isMind && n.type === 'text') {
                const editing = editingTextId === n.id;
                return (
                  <div key={n.id}
                    className={`nv-node nv-freetext ${sel.includes(n.id) ? 'is-sel' : ''} ${editing ? 'is-editing' : ''} ${isFilteredOut(n) ? 'nv-node--dim' : ''}`}
                    style={{ left: n.position.x, top: n.position.y, width: MIND_NODE_SIZE['mind.note']?.w ?? 260, ['--nv-accent' as any]: MIND_ACCENT }}
                    onPointerDown={(e) => { if (!editing) startNodeDrag(e, n); }}
                    onDoubleClick={() => setEditingTextId(n.id)}
                  >
                    <MindFreeText node={n} editing={editing} onCommit={() => setEditingTextId(null)} />
                  </div>
                );
              }

              // ── لوحة التفكير — moodboard image: frameless picture, thin outline. ──
              if (isMind && n.type === 'source') {
                const preview = previewOf(n);
                const assetParam = spec.params.find(p => p.name === 'asset');
                return (
                  <div key={n.id}
                    className={`nv-node nv-moodimg ${sel.includes(n.id) ? 'is-sel' : ''} ${isFilteredOut(n) ? 'nv-node--dim' : ''}`}
                    style={{ left: n.position.x, top: n.position.y, width: nodeW(n), height: nodeH(n), ['--nv-accent' as any]: MIND_ACCENT }}
                    onPointerDown={(e) => startNodeDrag(e, n)}
                    onDoubleClick={() => assetParam && onAssetAction(n, assetParam)}
                  >
                    {preview
                      ? <img src={preview.src} alt="" draggable={false} />
                      : <button className="nv-moodimg__ph nodrag" onClick={() => assetParam && onAssetAction(n, assetParam)}>
                          {ICONS.source}<span className="mono-label">Pick image</span>
                        </button>}
                    <div className="nv-resize nodrag" title="Drag to resize" onPointerDown={(e) => startResize(e, n)} />
                  </div>
                );
              }

              // ── لوحة التفكير — bodied thought card (title bar + rich body +
              //    two edge sockets), replacing port rows + preview. ──
              const MindBody = MIND_BODIES[n.type];
              if (MindBody) {
                const suffix = n.type.split('.')[1] ?? 'note';
                const kept = n.type === 'mind.collision' && !!n.paramValues.kept;
                const big = n.type === 'mind.territory' && !!n.paramValues.big;
                return (
                  <div key={n.id}
                    className={`nv-node nv-node--mind nv-node--m-${suffix} ${sel.includes(n.id) ? 'nv-node--sel' : ''} ${kept ? 'nv-node--kept' : ''} ${big ? 'nv-node--big' : ''} ${isFilteredOut(n) ? 'nv-node--dim' : ''}`}
                    style={{ left: n.position.x, top: n.position.y, width: nodeW(n), height: nodeH(n), ['--nv-accent' as any]: spec.accent }}
                    onPointerDown={(e) => startNodeDrag(e, n)}
                  >
                    <div className="nv-node__title-bar">
                      <span className="nv-node__ico">{ICONS[n.type]}</span>
                      <span className="nv-node__title">{n.name || spec.label}</span>
                      <span className="nv-node__seq mono-label">{n.id.slice(-3)}</span>
                    </div>
                    {/* Read-only bodies (seed/collision/note/answer) drag from
                        anywhere; editable bodies stay body-safe for text work. */}
                    <div className={`nv-mind__wrap ${MIND_READONLY.has(n.type) ? '' : 'nodrag'}`}
                      onPointerDown={(e) => { if (!MIND_READONLY.has(n.type)) e.stopPropagation(); }}
                      onKeyDown={(e) => e.stopPropagation()}>
                      <MindBody node={n} />
                    </div>
                    <div className="nv-mind__sock nv-mind__sock--in" data-port="in" data-node={n.id} data-param="in" title="Lineage in" />
                    <div className="nv-mind__sock nv-mind__sock--out" data-port="out" data-node={n.id} data-param="out" title="Lineage out"
                      onPointerDown={(e) => startConnect(e, n, 'out', spec.accent)} />
                    <div className="nv-resize nodrag" title="Drag to resize" onPointerDown={(e) => startResize(e, n)} />
                  </div>
                );
              }

              const rt = runtime[n.id];
              const rows = portRows(spec);
              const preview = previewOf(n);
              const showPreview = ASSET_NODES.has(n.type);
              const bodyH = rows.length * SOCKET_H;
              const totalH = TITLE_H + bodyH + (showPreview ? PREVIEW_H : 0);
              const statusCls = rt?.status === 'running' ? 'nv-node--run' : rt?.status === 'done' ? 'nv-node--done' : rt?.status === 'error' ? 'nv-node--error' : '';
              // On the thinking canvas, moodboard frames/videos may be resized
              // to compose the board; their box then follows the user's size.
              const mindMedia = isMind && (n.type === 'frame' || n.type === 'video');
              return (
                <div key={n.id}
                  className={`nv-node ${sel.includes(n.id) ? 'nv-node--sel' : ''} ${statusCls} ${n.rejected ? 'nv-node--rejected' : ''} ${n.favorite ? 'nv-node--fav' : ''} ${isFilteredOut(n) ? 'nv-node--dim' : ''}`}
                  style={{ left: n.position.x, top: n.position.y, width: nodeW(n), height: n.size ? nodeH(n) : totalH, ['--nv-accent' as any]: spec.accent }}
                  onPointerDown={(e) => startNodeDrag(e, n)}
                >
                  {n.colorLabel && <span className="nv-node__label" style={{ background: LABEL_COLORS[n.colorLabel] }} />}
                  <div className="nv-node__title-bar">
                    <span className="nv-node__ico">{ICONS[n.type]}</span>
                    <span className="nv-node__title">{n.name || spec.label}</span>
                    {n.favorite && <span className="nv-node__badge nv-node__badge--fav" title="Favorite">★</span>}
                    {n.rejected && <span className="nv-node__badge nv-node__badge--rej" title="Rejected">✕</span>}
                    {typeof n.takeIndex === 'number' && n.takeIndex > 0 && <span className="nv-node__take mono-label" title="Take">t{n.takeIndex}</span>}
                    <span className="nv-node__seq mono-label">{n.id.slice(-3)}</span>
                    {GENERATES.has(n.type) && (
                      <button className="nv-node__gen nodrag" disabled={running} title="Generate"
                        onClick={(e) => { e.stopPropagation(); selectGraphNode(n.id); runGraph(); }}>▶</button>
                    )}
                  </div>

                  <div className="nv-node__ports" style={{ height: bodyH }}>
                    {rows.map((p, i) => {
                      const isOut = p.kind === 'output';
                      const color = TYPE_COLOR[p.dataType];
                      return (
                        <div key={p.name} className={`nv-prow nv-prow--${isOut ? 'out' : 'in'}`} style={{ top: i * SOCKET_H, height: SOCKET_H }}>
                          <span className="nv-prow__label">{p.label}</span>
                          <div className={`nv-port nv-port--${isOut ? 'out' : 'in'}`} data-port={isOut ? 'out' : 'in'} data-node={n.id} data-param={p.name}
                            style={{ ['--sock' as any]: color }} title={`${p.label} · ${p.dataType}${p.optional ? ' · optional' : ''}`}
                            onPointerDown={isOut ? (e) => startConnect(e, n, p.name, color) : undefined} />
                        </div>
                      );
                    })}
                  </div>

                  {rt?.status === 'error' && rt.error && <div className="nv-node__err mono-label" title={rt.error}>{rt.error}</div>}

                  {showPreview && (
                    <div className="nv-node__preview nodrag" style={{ height: PREVIEW_H }}>
                      {preview
                        ? (preview.kind === 'image'
                            ? <img src={preview.src} alt="" />
                            : <video src={preview.src} poster={preview.poster} muted loop playsInline controls />)
                        : rt?.status === 'running'
                          ? <div className="nv-node__making"><span className="nv-spinner" /><span className="mono-label">{rt.statusText || 'Making…'}</span></div>
                          : <div className="nv-node__ph">{ICONS[n.type]}</div>}
                    </div>
                  )}
                  {mindMedia && <div className="nv-resize nodrag" title="Drag to resize" onPointerDown={(e) => startResize(e, n)} />}
                </div>
              );
            })}

            {marquee && (
              <div className="nv-marquee" style={{
                left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1),
                width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0),
              }} />
            )}
            {drawRect && (
              <div className="nv-marquee nv-marquee--group" style={{
                left: Math.min(drawRect.x0, drawRect.x1), top: Math.min(drawRect.y0, drawRect.y1),
                width: Math.abs(drawRect.x1 - drawRect.x0), height: Math.abs(drawRect.y1 - drawRect.y0),
                ['--nv-accent' as any]: getNodeSpec('group')?.accent ?? '#4FB7B3',
              }} />
            )}
          </div>

          {/* Floating selection toolbar when 2+ nodes are picked. */}
          {selBox && (
            <div className="nv-selbar nodrag" style={{ left: pan.x + selBox.cx * scale, top: pan.y + selBox.top * scale - 44 }}>
              <span className="nv-selbar__count mono-label">{sel.length} selected</span>
              {!isSpace && <button className="nv-selbar__btn" title="Add all to timeline" onClick={() => { sel.forEach(id => addToTimeline(id)); }}>＋TL</button>}
              <button className="nv-selbar__btn nv-selbar__btn--danger" title="Delete selection" onClick={() => { sel.forEach(id => removeGraphNode(id)); setSel([]); }}>✕</button>
            </div>
          )}

          {menu && (
            <div className="nv-menu nodrag" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
              <input autoFocus className="nv-menu__search" placeholder="Search nodes…" value={menu.q}
                onChange={(e) => setMenu(m => m ? { ...m, q: e.target.value } : m)} />
              <div className="nv-menu__list">
                {menuItems.map(s => (
                  <button key={s.type} className="nv-menu__item" style={{ ['--nv-accent' as any]: s.accent }} onClick={() => addFromMenu(s.type)}>
                    <span className="nv-menu__dot" /><span className="nv-menu__label">{s.label}</span><span className="nv-menu__sub">{s.sub}</span>
                  </button>
                ))}
                {menuItems.length === 0 && <div className="nv-menu__empty mono-label">no match</div>}
              </div>
            </div>
          )}
        </div>

        {/* ── THE TOOL WHEEL — every HJEN tool, one dial ──────────────────────
         *  A trigger at the board's bottom-centre; the dial's centre sits below
         *  the board's floor so only its top cap shows. Both live INSIDE the
         *  stage, which is what puts them above the Sequence dock in Node and
         *  at the true bottom in SPACE — neither has to know the dock exists. */}
        {!wheelOpen && (
          <button className="tw-trigger" onClick={() => setWheelOpen(true)}
            title="Every HJEN tool — spin the dial or type a name">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="2.4" />
              <path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3M6 6l2 2M18 6l-2 2M6 18l2-2M18 18l-2-2" />
            </svg>
            Tools
            <kbd>Space</kbd>
          </button>
        )}
        <ToolWheel open={wheelOpen} onClose={() => setWheelOpen(false)} surface={surface} />

        {/* Mind node selected → a minimal inspector (its fields edit on the card). */}
        {selNode && selSpec && MIND_BODIES[selNode.type] && (
          <aside className="nv-insp nodrag">
            <header className="nv-insp__head">
              <span className="nv-insp__ico" style={{ color: selSpec.accent }}>{ICONS[selNode.type]}</span>
              <span className="nv-insp__title">{selNode.name || selSpec.label}</span>
              <span className="nv-insp__id mono-label">{selNode.id.slice(-3)}</span>
              <button className="nv-insp__x" title="Deselect" onClick={() => selectGraphNode(null)}>✕</button>
            </header>
            <div className="nv-insp__body">
              <div className="nv-insp__field">
                <label className="nv-insp__label">Thought</label>
                <div className="nv-mind-insp__sub">{selSpec.sub}</div>
              </div>
              <div className="nv-insp__field">
                <label className="nv-insp__label">Entity</label>
                <div className="nv-mind-insp__ref mono-label selectable">{String(selNode.paramValues.entity ?? '—')}</div>
              </div>
              {/* Breakdown 360 settings — the treatment PDF lives here (Anwar:
                  «يصدر لي كملف PDF بأقسامه وصوره كأنه معالجة للإعلان»). */}
              {selNode.type === 'mind.bdHeader' && (
                <div className="nv-insp__field">
                  <label className="nv-insp__label">Treatment PDF · معالجة الإعلان</label>
                  <button className="nv-bd__export nodrag"
                    disabled={!!bdExporting || !!bdArabic}
                    onClick={() => void exportBreakdownPdf(pstr(selNode.paramValues.breakdownSlug))}>
                    {bdExporting ? 'Printing…' : 'Export PDF'}
                  </button>
                  <button className="nv-bd__export nodrag"
                    disabled={!!bdExporting || !!bdArabic}
                    title="النموذج المعيَّن لمهمة الصياغة العربية (الإعدادات → Models) يعيد كتابة الوثيقة بالعربية ثم يطبع الـPDF"
                    onClick={() => void arabicRewrite(pstr(selNode.paramValues.breakdownSlug))}>
                    {bdArabic ? 'يكتب بالعربية…' : 'الصياغة العربية'}
                  </button>
                  {bdArabicMsg && <div className="nv-bd__hintar nv-mind__warn" dir="auto">{bdArabicMsg}</div>}
                  {/* Arabic hint — NEVER mono/letter-spaced (joined letters law) */}
                  <div className="nv-mind-insp__hint nv-bd__hintar" dir="rtl">
                    وثيقة A4 بكل الأقسام والصور — تُفتح فور الطباعة وتُحفظ بجوار التشريح. الصياغة العربية تضيف «النسخة العربية» للوثيقة.
                  </div>
                </div>
              )}
              <div className="nv-mind-insp__hint mono-label">Edit this thought directly on its card.</div>
            </div>
          </aside>
        )}

        {/* Right inspector — the selected node's settings live HERE, not in the card. */}
        {selNode && selSpec && !MIND_BODIES[selNode.type] && (
          <aside className="nv-insp nodrag">
            <header className="nv-insp__head">
              <span className="nv-insp__ico" style={{ color: selSpec.accent }}>{ICONS[selNode.type]}</span>
              <span className="nv-insp__title">{selSpec.label}</span>
              <span className="nv-insp__id mono-label">{selNode.id.slice(-3)}</span>
              <button className="nv-insp__x" title="Deselect" onClick={() => selectGraphNode(null)}>✕</button>
            </header>
            <div className="nv-insp__body">
              {selNode.type === 'frame' && (
                <button className="nv-insp__dop" onClick={() => openNodeDop(selNode.id)}>Open DOP ▸</button>
              )}
              {paramsByKind(selSpec, 'property').map(p => (
                <div className="nv-insp__field" key={p.name}>
                  <label className="nv-insp__label">{p.label}</label>
                  <ParamControl param={p} value={selNode.paramValues[p.name]}
                    onChange={(v) => setNodeParam(selNode.id, p.name, v)} onAction={(pp) => onAssetAction(selNode, pp)} />
                </div>
              ))}
              {paramsByKind(selSpec, 'input').length > 0 && (
                <div className="nv-insp__ports">
                  <div className="nv-insp__portshead mono-label">Inputs</div>
                  {paramsByKind(selSpec, 'input').map(p => (
                    <div className="nv-insp__portrow" key={p.name}>
                      <span className="nv-insp__portdot" style={{ background: TYPE_COLOR[p.dataType] }} />
                      {p.label}<span className="nv-insp__porttype mono-label">{p.dataType}{p.optional ? ' · optional' : ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {GENERATES.has(selNode.type) && (
              <footer className="nv-insp__foot">
                <button className="nv-insp__gen" disabled={running} onClick={() => runGraph()}>
                  {running ? 'Generating…' : 'Generate'}
                </button>
                {!isSpace && (
                  <button className="nv-insp__tl" onClick={() => addToTimeline(selNode.id)} title="Add this shot to the timeline">
                    + Timeline
                  </button>
                )}
              </footer>
            )}
          </aside>
        )}

        {/* Selection panel — shown when 2+ nodes are selected. */}
        {sel.length > 1 && (
          <aside className="nv-insp nodrag">
            <header className="nv-insp__head">
              <span className="nv-insp__title">Selection</span>
              <span className="nv-insp__id mono-label">{sel.length} selected</span>
              <button className="nv-insp__x" title="Deselect" onClick={() => { setSel([]); selectGraphNode(null); }}>✕</button>
            </header>
            <div className="nv-insp__body">
              <div className="nv-insp__sellist">
                {nodes.filter(n => sel.includes(n.id)).map(n => (
                  <div key={n.id} className="nv-insp__selrow">
                    <span className="nv-insp__selico" style={{ color: getNodeSpec(n.type)?.accent }}>{ICONS[n.type]}</span>
                    {getNodeSpec(n.type)?.label} <span className="nv-insp__id mono-label">{n.id.slice(-3)}</span>
                  </div>
                ))}
              </div>
            </div>
            <footer className="nv-insp__foot">
              {!isSpace && <button className="nv-insp__gen" onClick={() => { sel.forEach(id => addToTimeline(id)); }}>Add all to timeline</button>}
              <button className="nv-insp__tl nv-insp__tl--danger" onClick={() => { sel.forEach(id => removeGraphNode(id)); setSel([]); }}>Delete</button>
            </footer>
          </aside>
        )}
      </div>

      {/* Asset chooser — project (Library) images OR a file from the device. */}
      {chooser && (
        <div className="nv-chooser__backdrop" onClick={() => setChooser(null)}>
          <div className="nv-chooser" onClick={(e) => e.stopPropagation()}>
            <header className="nv-chooser__head">
              <span className="nv-chooser__title">Choose image</span>
              <button className="nv-chooser__device" onClick={() => pickFromDevice(chooser.nodeId, chooser.param)}>From device…</button>
              <button className="nv-chooser__x" onClick={() => setChooser(null)}>✕</button>
            </header>
            <div className="nv-chooser__label mono-label">Project library · {chooser.lib.length}</div>
            <div className="nv-chooser__grid">
              {chooser.lib.map(a => (
                <button key={a.id} className="nv-chooser__item" title={a.name}
                  onClick={() => { setNodeParam(chooser.nodeId, chooser.param, { path: a.filePath, name: a.name, thumbPath: a.thumbPath }); setChooser(null); }}>
                  <img src={`hjen-file://${encodeURI(a.thumbPath || a.filePath)}`} alt="" />
                </button>
              ))}
              {chooser.lib.length === 0 && <div className="nv-chooser__empty mono-label">No project images yet — use “From device”.</div>}
            </div>
          </div>
        </div>
      )}

      {/* Docked timeline — media canvases only (a thinking canvas has no sequence),
       *  and NEVER in SPACE: the sequence is the one thing that tool doesn't have. */}
      {!isMind && !isSpace && <TimelineDock />}
      </>) : (<EditView />)}

      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
      {/* MCP drawer renders globally via <McpDock /> in App.tsx (store-driven). */}
      {historyOpen && <HistoryPanel onClose={() => setHistoryOpen(false)} />}
    </div>
  );
}
