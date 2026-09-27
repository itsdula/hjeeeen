import { createContext, useContext } from 'react';

/**
 * Keep-alive tab model — the "browser tab" contract.
 *
 * The interactive workspace views (Video, Breakdown, Node, Cast, Frame, and the
 * preprod minds) are rendered MOUNTED for every open tab and merely HIDDEN when
 * their tab isn't the active one — so switching tabs never unmounts a view and
 * therefore never destroys its local React state (prompt text, uploaded refs,
 * scroll position, the open shot/sub-page). Coming back to a tab restores it
 * exactly, like a browser.
 *
 * A hidden, still-mounted instance reads the SAME global store as the visible
 * one (activeProjectId, selections, …). To stop a background instance fighting
 * the active tab — reloading global state or clobbering its own local state for
 * a project it isn't showing — this context tells each view whether it is the
 * ACTIVE (visible) tab. Views guard their reload / global-write effects on it.
 *
 * Default is `true`, so any view rendered OUTSIDE the keep-alive host (a plain
 * conditional mount, a test) behaves normally with no changes.
 */
export const TabActiveContext = createContext<boolean>(true);

/** Whether the kept-alive tab pane rendering this subtree is the active tab. */
export function useTabActive(): boolean {
  return useContext(TabActiveContext);
}
