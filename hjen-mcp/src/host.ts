// hjen-core — the Host seam.
//
// The ONE abstraction that lets the same engine run in two homes:
//   • the Electron desktop app injects an Electron host (app.getPath, secure
//     key files), and
//   • the MCP server injects a Node host (platform defaults + env + key files).
//
// Phase 0 needs only config + paths + provider keys. Phase 2 (make) extends
// this interface with a generation sink + http; keeping the surface tiny now
// keeps renderer and MCP cores from drifting (the honest risk in the plan).

export type KeyName = 'openai' | 'anthropic' | 'google' | 'ark' | 'kling';

export interface Host {
  /** Absolute path to the folder holding every project folder, plus
   *  `_library/` and `_generations.jsonl`. Mirrors main.ts `projectsRootPath()`. */
  projectsRoot(): string;

  /** Absolute path to the app's userData dir — holds `projects.json`,
   *  `settings.json`, and the `*_key.txt` secrets. Mirrors `app.getPath('userData')`. */
  userDataDir(): string;

  /** Resolve a provider API key, or null if unset. The Node host reads the
   *  SAME `*_key.txt` files the desktop app already wrote, so the MCP inherits
   *  the user's configured keys with zero extra setup. */
  getKey(name: KeyName): string | null;
}
