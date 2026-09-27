import { NodeView } from './NodeView';

/**
 * HJEN SPACE — the infinite board, without the sequence.
 *
 * Same engine, same nodes, same canvases, same inspector, same shortcuts as
 * HJEN NODE. What SPACE does not have is the Sequence: no timeline dock at the
 * bottom, no Create/Edit sequencer, no "add to timeline" anywhere. It is the
 * spatial half of Node on its own — make, arrange, wire, run — for work that
 * never becomes a cut.
 *
 * Its board is its own: SPACE persists to the project's _space/graph.json, so a
 * Space canvas and a Node pipeline can live in one project without touching.
 *
 * The rail here is movable: grab the grip to drag it anywhere over the stage,
 * drop it near an edge to dock it there, fold it to a puck when the board needs
 * the room. Its place is remembered.
 */
export function SpaceView() {
  return <NodeView surface="space" />;
}
