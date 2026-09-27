import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { PanelWindowRoot } from './components/dock/PanelWindowRoot';
import type { PanelKind } from './lib/dock/usePanelDoc';
import './styles/globals.css';
import { applyTheme, readCachedTheme, readCachedAppearance, readCachedHubTiles, readCachedBgShade } from './lib/theme/apply';
import { resolveHubTiles } from './lib/theme/types';
import { resolveTrafficLights } from './lib/trafficLights';

// Paint the last-used theme + appearance + hub-tile mode + bg shade before first
// render so there's no flash of the Default/Classic look. The store re-applies
// the authoritative config on init(). Set the attributes even when there's no
// cached theme, so the pro-skin.css / hub-tile CSS apply to the very first paint.
const cachedTheme = readCachedTheme();
const cachedAppearance = readCachedAppearance();
const cachedHubTiles = readCachedHubTiles();
const cachedBgShade = readCachedBgShade();
if (cachedTheme) applyTheme(cachedTheme, cachedAppearance, cachedHubTiles, cachedBgShade);
else {
  document.documentElement.dataset.appearance = cachedAppearance;
  document.documentElement.dataset.hubTiles = resolveHubTiles(cachedAppearance, cachedHubTiles);
}

// Platform marker: macOS traffic lights only exist in the Electron desktop shell,
// so the top-bar's left clearance (padding-left) must apply on desktop but NOT on
// the web mount — otherwise the web logo floats in a big empty gap. Set before
// first paint so the chrome never flashes the wrong offset.
document.documentElement.dataset.platform = /electron/i.test(navigator.userAgent) ? 'desktop' : 'web';

// …and WHICH SIDE that clearance goes on. macOS moves the window buttons to the
// right of the title bar when the system language is right-to-left, so on an
// Arabic Mac the buttons were landing on top of the account name while the left
// gutter sat empty. Main reads the system language; this only places the gutter.
// Read from localStorage before first paint, like the theme above, so the bar
// never renders once with the gutter on the wrong side.
document.documentElement.dataset.trafficLights = resolveTrafficLights();

// Which window is this? Main hands the answer over as a launch argument, which
// preload reads synchronously — so a detached Mood Board / Timeline paints
// itself on the FIRST frame rather than flashing the studio shell first. The
// query string carries the same values for a devtools reload; argv is the
// authority. Everything above this line has already run for BOTH kinds of
// window, so a panel inherits the theme, the appearance and the traffic-light
// side for free.
const role = (window.hjen?.chrome?.role || new URLSearchParams(location.search).get('panel') || '').trim();
const isPanel = role === 'moodboard' || role === 'timeline';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isPanel ? (
      <PanelWindowRoot
        kind={role as PanelKind}
        projectId={window.hjen?.chrome?.projectId || new URLSearchParams(location.search).get('project') || ''}
        docId={window.hjen?.chrome?.docId || new URLSearchParams(location.search).get('doc') || ''}
      />
    ) : (
      <App />
    )}
  </React.StrictMode>
);
