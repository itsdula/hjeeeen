// Which side of the title bar the macOS window buttons sit on, and therefore
// which side the top bar has to leave a 96px gutter on.
//
// macOS mirrors the title bar when the system language is right-to-left, so on
// an Arabic Mac close/minimise/zoom land on the RIGHT — on top of the account
// name — while the hardcoded left gutter sat empty. MAIN reads the system
// language and hands the answer over as a launch argument (electron/main.ts →
// trafficLightSide, preload.ts → window.hjen.chrome).
//
// That reading is an INFERENCE: AppKit decides from the app's effective
// localisation, which usually follows the system language but is not the same
// switch. So the user can overrule it, and the override is what ships if set.

export type TrafficLights = 'left' | 'right';
export type TrafficLightsPref = 'auto' | TrafficLights;

const KEY = 'hjen.trafficLights';

/** What the OS-side detection concluded. 'left' on any host without native
 *  window buttons (the web mount), which is also the safe default. */
export function detectedTrafficLights(): TrafficLights {
  return (window as any).hjen?.chrome?.trafficLights === 'right' ? 'right' : 'left';
}

export function readTrafficLightsPref(): TrafficLightsPref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'left' || v === 'right' ? v : 'auto';
  } catch { return 'auto'; }
}

/** The side to actually lay out for: the override, else what was detected. */
export function resolveTrafficLights(): TrafficLights {
  const pref = readTrafficLightsPref();
  return pref === 'auto' ? detectedTrafficLights() : pref;
}

/** Persist and apply in one step — the gutter moves as the user clicks. */
export function setTrafficLightsPref(pref: TrafficLightsPref): void {
  try {
    if (pref === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch { /* the applied value below still holds for this session */ }
  document.documentElement.dataset.trafficLights = resolveTrafficLights();
}
