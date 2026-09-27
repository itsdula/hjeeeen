// McpDock — the GLOBAL MCP drawer, pinned behind the top-bar MCP button and
// available on EVERY view. One unified surface: it reuses the NodeMcpOverlay
// drawer (Assistant + Connect tabs) so the Node-canvas button and the top-bar
// button open the exact same thing. Mounted once in App.tsx.

import { useStore } from '../store';
import { NodeMcpOverlay } from './NodeMcpOverlay';

export function McpDock() {
  const open = useStore(s => s.mcpDockOpen);
  const toggle = useStore(s => s.toggleMcpDock);
  const activeView = useStore(s => s.activeView);
  if (!open) return null;
  // Inside the Node canvas the Assistant keeps its canvas-builder behaviour;
  // everywhere else it runs as the general studio assistant.
  return <NodeMcpOverlay onClose={toggle} surface={activeView === 'node' || activeView === 'space' ? 'node' : 'studio'} />;
}
