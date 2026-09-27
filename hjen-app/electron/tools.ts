// tools.ts — every external program HJEN Studio shells out to, in ONE place.
//
// WHY THIS EXISTS. The app worked on the machine it was built on and failed on
// everyone else's, because the heavy lifting is done by programs that are NOT
// part of the bundle: ffmpeg, yt-dlp, whisper, python. The author's Mac has all
// of them in ~/.local/bin — a directory that exists on exactly one computer.
// A tester's Mac has none, so Cuts answered `spawn yt-dlp ENOENT` and Breakdown,
// Film Space and Transcription failed in their own dialects of the same fault.
//
// Two things went wrong and both are fixed here:
//
//   1. NO SINGLE ANSWER. Four different files each probed a different list of
//      paths and fell back to a bare command name, which only works if the
//      program is on PATH — and a Mac app launched from Finder inherits
//      /usr/bin:/bin:/usr/sbin:/sbin, where Homebrew is not. Now one resolver
//      answers for everybody, and it also REPAIRS the PATH so a user who does
//      have Homebrew works whether they launched from Finder or a terminal.
//
//   2. NO HONEST FAILURE. A missing program surfaced as a raw ENOENT in a
//      status bar. `describeMissing` writes the sentence the user needs: what
//      is missing, what it powers, and the one command that installs it.
//
// House law (verified specs live in ONE module everyone imports): nothing else
// may probe for a binary. Call resolveTool / requireTool.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('node:path');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('node:fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const os = require('node:os');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const childProcess = require('node:child_process');

// ffprobe is deliberately absent: nothing in the app calls it (durations are
// parsed out of ffmpeg's own stderr), so listing it would report a failure
// that costs the user an install and changes nothing.
export type ToolId = 'ffmpeg' | 'yt-dlp' | 'whisper' | 'python3';

interface ToolSpec {
  id: ToolId;
  /** Command names to look for, in order of preference. */
  names: string[];
  /** Human name for the message. */
  label: string;
  /** What stops working without it — named as the user knows it. */
  powers: string;
  /** The one command that installs it. */
  install: string;
  /** Argument that makes it print something and exit 0, for the probe. */
  probe: string[];
  /** false = the app degrades instead of failing (transcription falls back). */
  required: boolean;
  /** Argument that prints a version, when it differs from the probe. */
  version?: string[];
  /** Run the probe rather than trusting the executable bit — only python3,
   *  whose macOS copy is a stub that opens an installer dialog. */
  stubRisk?: boolean;
}

const TOOLS: ToolSpec[] = [
  {
    id: 'ffmpeg', names: ['ffmpeg'], label: 'ffmpeg',
    powers: 'Cuts, Ad Breakdown, video thumbnails and Emulsion video',
    install: 'brew install ffmpeg', probe: ['-version'], required: true,
  },
  {
    id: 'yt-dlp', names: ['yt-dlp'], label: 'yt-dlp',
    powers: 'fetching a video from a link in Cuts and Ad Breakdown',
    install: 'brew install yt-dlp', probe: ['--version'], required: true,
  },
  {
    id: 'whisper', names: ['whisper-cli', 'whisper-cpp', 'whisper'], label: 'whisper',
    powers: 'transcribing dialogue on this Mac instead of sending it to an API',
    install: 'brew install whisper-cpp', probe: ['--help'], version: ['--version'], required: false,
  },
  {
    id: 'python3', names: ['python3'], label: 'Python 3',
    powers: 'Film Space, depth, pose and the local image passes',
    install: 'brew install python',
    probe: ['-c', 'import sys'], required: false, stubRisk: true,
  },
];

/** Where a program might live, most-specific first. `Resources/bin` comes first
 *  so a future bundled copy always wins over whatever the user happens to have. */
function searchDirs(): string[] {
  const home = os.homedir();
  return [
    path.join(process.resourcesPath || '', 'bin'),   // bundled with the app (if ever shipped)
    '/opt/homebrew/bin',                             // Homebrew, Apple silicon
    '/usr/local/bin',                                // Homebrew, Intel
    path.join(home, '.local/bin'),                   // pipx / pip --user
    '/usr/bin',
    '/bin',
  ];
}

/** A Mac app launched from Finder gets a minimal PATH with no Homebrew in it.
 *  Child processes inherit that, so yt-dlp could not find ffmpeg even when both
 *  were installed. Widening PATH once, at startup, fixes every child at once. */
export function repairPath(): void {
  const have = new Set(String(process.env.PATH || '').split(':').filter(Boolean));
  const add = searchDirs().filter(d => d && !have.has(d) && exists(d));
  if (add.length) process.env.PATH = [...have, ...add].join(':');
}

function exists(p: string): boolean {
  try { return fs.existsSync(p); } catch { return false; }
}

/** Is this an executable file we can run?
 *
 *  Existence alone is NOT enough for python3: macOS ships /usr/bin/python3 as a
 *  stub that only opens the "install developer tools" dialog. So that one is
 *  actually executed. Everything else is judged on the executable bit, because
 *  running them is far too slow to do on a resolve — yt-dlp is a 38MB
 *  self-unpacking bundle and its first `--version` takes over twenty seconds.
 *  Probing it that way reported an INSTALLED yt-dlp as missing (caught by the
 *  clean-machine test, not by reading the code). */
function usable(bin: string, spec: ToolSpec): boolean {
  try { fs.accessSync(bin, fs.constants.X_OK); } catch { return false; }
  if (!spec.stubRisk) return true;
  try {
    childProcess.execFileSync(bin, spec.probe, { stdio: 'ignore', timeout: 10_000 });
    return true;
  } catch { return false; }
}

const cache = new Map<ToolId, string | null>();

/** Absolute path to the program, or null when this machine does not have it. */
export function resolveTool(id: ToolId): string | null {
  if (cache.has(id)) return cache.get(id) ?? null;
  const spec = TOOLS.find(t => t.id === id);
  if (!spec) { cache.set(id, null); return null; }

  const override = process.env[`HJEN_${id.toUpperCase().replace(/-/g, '_')}`];
  const candidates: string[] = [];
  if (override) candidates.push(override);
  for (const dir of searchDirs()) for (const n of spec.names) candidates.push(path.join(dir, n));

  for (const c of candidates) {
    if (!c.includes('/')) continue;          // a bare name has no file to check
    if (usable(c, spec)) { cache.set(id, c); return c; }
  }
  cache.set(id, null);
  return null;
}

/** Forget the probe results — used after the user installs something and asks
 *  the Tools panel to check again, so they do not have to restart. */
export function refreshTools(): void { cache.clear(); repairPath(); }

/** The sentence to show instead of `spawn yt-dlp ENOENT`. */
export function describeMissing(id: ToolId): string {
  const spec = TOOLS.find(t => t.id === id);
  if (!spec) return `A required program is missing.`;
  return `${spec.label} is not installed on this Mac. It is what HJEN Studio uses for ${spec.powers}. `
    + `Install it with:  ${spec.install}`;
}

/** Resolve or fail loudly with the useful sentence. */
export function requireTool(id: ToolId): string {
  const p = resolveTool(id);
  if (!p) throw new Error(describeMissing(id));
  return p;
}

export interface ToolStatus {
  id: ToolId; label: string; powers: string; install: string;
  required: boolean; found: boolean; path: string | null; version: string | null;
  /** True when the copy in use is the one shipped inside the app, so the panel
   *  says "included" instead of telling the user to install what they have. */
  bundled: boolean;
}

/** Everything the Tools panel shows. Runs the probes fresh so the panel is a
 *  true answer, not a memory of one. */
export function toolsStatus(): ToolStatus[] {
  return TOOLS.map(spec => {
    const p = resolveTool(spec.id);
    let version: string | null = null;
    if (p) {
      try {
        // stderr is DISCARDED: whisper prints its whole usage screen there and it
        // was leaking into the app's log. 30s because yt-dlp's first run unpacks.
        const out = String(childProcess.execFileSync(p, spec.version ?? spec.probe,
          { encoding: 'utf-8', timeout: 30_000, stdio: ['ignore', 'pipe', 'ignore'] }) || '');
        version = (out.split('\n')[0] || '').trim().slice(0, 80) || null;
      } catch { /* it runs but says nothing useful — the path is answer enough */ }
    }
    const bundledDir = path.join(process.resourcesPath || '\u0000', 'bin');
    return {
      id: spec.id, label: spec.label, powers: spec.powers, install: spec.install,
      required: spec.required, found: !!p, path: p, version,
      bundled: !!p && p.startsWith(bundledDir),
    };
  });
}
