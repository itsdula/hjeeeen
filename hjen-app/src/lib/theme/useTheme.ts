import { useStore } from '../../store';
import { getBuiltin, DEFAULT_THEME } from './presets';
import type { Theme } from './types';

/** Resolve the currently-active theme object in any component.
 *  No import cycle: store.ts imports apply/presets/types, never this file. */
export function useActiveTheme(): Theme {
  const id = useStore(s => s.activeThemeId);
  const custom = useStore(s => s.customThemes);
  return getBuiltin(id) || custom.find(t => t.id === id) || DEFAULT_THEME;
}
