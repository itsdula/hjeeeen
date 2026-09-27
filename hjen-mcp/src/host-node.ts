// Node implementation of the Host seam (headless — no Electron).
//
// Resolves the same locations the desktop app uses so the MCP reads/writes the
// user's real projects and reuses the user's already-configured keys:
//   userData  = ~/Library/Application Support/hjen-studio   (macOS; app "name")
//   projects  = settings.json.projectsRoot ?? ~/Pictures/HJEN Studio
//   keys      = env  OR  {userData}/{provider}_key.txt
// All three are overridable via env for CI / alternate installs.

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import type { Host, KeyName } from './host.js';

const APP_NAME = 'hjen-studio'; // package.json "name" — Electron's userData folder

function defaultUserData(): string {
  const home = os.homedir();
  switch (process.platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', APP_NAME);
    case 'win32':
      return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), APP_NAME);
    default:
      return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), APP_NAME);
  }
}

function defaultPicturesRoot(): string {
  // Mirrors Electron app.getPath('pictures') + "/HJEN Studio".
  return path.join(os.homedir(), 'Pictures', 'HJEN Studio');
}

const KEY_ENV: Record<KeyName, string[]> = {
  openai: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  google: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
  ark: ['ARK_API_KEY'],
  kling: ['KLING_API_KEY'],
};

const KEY_FILE: Record<KeyName, string> = {
  openai: 'openai_key.txt',
  anthropic: 'anthropic_key.txt',
  google: 'google_key.txt',
  ark: 'ark_key.txt',
  kling: 'kling_key.txt',
};

export function createNodeHost(): Host {
  const userData = process.env.HJEN_USERDATA?.trim() || defaultUserData();

  function readSettings(): Record<string, unknown> {
    try {
      const f = path.join(userData, 'settings.json');
      if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf-8')) || {};
    } catch { /* ignore */ }
    return {};
  }

  function projectsRoot(): string {
    if (process.env.HJEN_PROJECTS_ROOT?.trim()) return process.env.HJEN_PROJECTS_ROOT.trim();
    const s = readSettings();
    if (typeof s.projectsRoot === 'string' && s.projectsRoot.trim()) return s.projectsRoot.trim();
    return defaultPicturesRoot();
  }

  function getKey(name: KeyName): string | null {
    for (const envName of KEY_ENV[name]) {
      const v = process.env[envName];
      if (v && v.trim()) return v.trim();
    }
    try {
      const f = path.join(userData, KEY_FILE[name]);
      if (fs.existsSync(f)) {
        const v = fs.readFileSync(f, 'utf-8').trim();
        if (v) return v;
      }
    } catch { /* ignore */ }
    return null;
  }

  return { projectsRoot, userDataDir: () => userData, getKey };
}
