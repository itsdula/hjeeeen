// Persistent Assistant conversations — the ONE store both surfaces share:
// the in-app Assistant (via electron/main.ts importing this module from dist)
// and external agents (via the hjen_conversations_* tools). A conversation is
// either GENERAL ({projectsRoot}/_conversations/{id}.json) or PROJECT-linked
// ({slug}/_project/conversations/{id}.json). Same safety discipline as every
// other studio write: atomic tmp+rename, backups on meaningful change, and a
// refuse-empty-overwrite guard so a populated conversation is never clobbered
// by an empty one.

import fs from 'node:fs';
import path from 'node:path';
import type { Host } from './host.js';
import { projectFolder } from './paths.js';
import { atomicWrite } from './writers.js';

export interface ConvoMsg { role: 'user' | 'assistant'; text: string; steps?: any[]; ts?: number }
export interface Convo {
  id: string;
  title: string;
  kind: 'general' | 'project';
  projectId?: string | null;
  projectName?: string | null;
  projectSlug?: string | null;
  messages: ConvoMsg[];
  createdAt: string;
  updatedAt: string;
}
export interface ConvoSummary {
  id: string; title: string; kind: Convo['kind'];
  projectId?: string | null; projectName?: string | null; projectSlug?: string | null;
  updatedAt: string; msgCount: number;
}

const MAX_MSGS = 200;           // per conversation on disk
const KEEP_BACKUPS = 20;

export const generalConversationsDir = (h: Host) => path.join(h.projectsRoot(), '_conversations');
export const projectConversationsDir = (h: Host, slug: string) => path.join(projectFolder(h, slug), '_project', 'conversations');

function convoPath(h: Host, c: Pick<Convo, 'id' | 'kind' | 'projectSlug'>): string {
  const dir = c.kind === 'project' && c.projectSlug ? projectConversationsDir(h, c.projectSlug) : generalConversationsDir(h);
  return path.join(dir, `${c.id}.json`);
}

const readJson = <T>(f: string): T | null => {
  try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) as T : null; } catch { return null; }
};

function listDir(h: Host, dir: string): Convo[] {
  if (!fs.existsSync(dir)) return [];
  const out: Convo[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const c = readJson<Convo>(path.join(dir, name));
    if (c && c.id && Array.isArray(c.messages)) out.push(c);
  }
  return out;
}

function summarize(c: Convo): ConvoSummary {
  return {
    id: c.id, title: c.title || '(untitled)', kind: c.kind,
    projectId: c.projectId ?? null, projectName: c.projectName ?? null, projectSlug: c.projectSlug ?? null,
    updatedAt: c.updatedAt, msgCount: c.messages.length,
  };
}

/** All conversations — general + every project's — newest first.
 *  Pass projectSlug to scope to one project (plus nothing else). */
export function listConversations(h: Host, opts: { projectSlug?: string } = {}): ConvoSummary[] {
  let all: Convo[];
  if (opts.projectSlug) {
    all = listDir(h, projectConversationsDir(h, opts.projectSlug));
  } else {
    all = listDir(h, generalConversationsDir(h));
    const root = h.projectsRoot();
    if (fs.existsSync(root)) {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
        all.push(...listDir(h, projectConversationsDir(h, entry.name)));
      }
    }
  }
  return all
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .slice(0, 300)
    .map(summarize);
}

export function readConversation(h: Host, id: string, hint: { kind?: Convo['kind']; projectSlug?: string } = {}): Convo | null {
  // Fast path with a location hint, else scan both stores.
  if (hint.kind === 'project' && hint.projectSlug) {
    const c = readJson<Convo>(path.join(projectConversationsDir(h, hint.projectSlug), `${id}.json`));
    if (c) return c;
  }
  const g = readJson<Convo>(path.join(generalConversationsDir(h), `${id}.json`));
  if (g) return g;
  const root = h.projectsRoot();
  if (fs.existsSync(root)) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
      const c = readJson<Convo>(path.join(projectConversationsDir(h, entry.name), `${id}.json`));
      if (c) return c;
    }
  }
  return null;
}

export interface WriteConvoResult { ok: boolean; reason?: string; path?: string }

export function writeConversation(h: Host, convo: Convo, allowEmpty = false): WriteConvoResult {
  if (!convo?.id) return { ok: false, reason: 'missing_id' };
  if (convo.kind === 'project' && !convo.projectSlug) return { ok: false, reason: 'project_convo_needs_slug' };

  const next: Convo = {
    ...convo,
    kind: convo.kind === 'project' ? 'project' : 'general',
    messages: (convo.messages || []).slice(-MAX_MSGS),
    updatedAt: new Date().toISOString(),
    createdAt: convo.createdAt || new Date().toISOString(),
  };
  const f = convoPath(h, next);

  // Guard: never clobber a populated conversation with an empty one.
  const prev = readJson<Convo>(f);
  if (prev && prev.messages?.length > 0) {
    if (next.messages.length === 0 && !allowEmpty) return { ok: false, reason: 'refused_empty_overwrite', path: f };
    // Backup when the message count shrinks or every meaningful growth step.
    if (next.messages.length < prev.messages.length || prev.messages.length % 10 === 0) {
      try {
        const bdir = path.join(path.dirname(f), 'backups');
        fs.mkdirSync(bdir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        atomicWrite(path.join(bdir, `${next.id}_${stamp}.json`), JSON.stringify(prev, null, 2));
        const old = fs.readdirSync(bdir).filter(n => n.startsWith(`${next.id}_`)).sort();
        for (const stale of old.slice(0, Math.max(0, old.length - KEEP_BACKUPS))) {
          try { fs.unlinkSync(path.join(bdir, stale)); } catch { /* ignore */ }
        }
      } catch { /* backups never block */ }
    }
  }

  atomicWrite(f, JSON.stringify(next, null, 2));
  return { ok: true, path: f };
}

export function deleteConversation(h: Host, id: string): { ok: boolean } {
  const c = readConversation(h, id);
  if (!c) return { ok: false };
  try { fs.unlinkSync(convoPath(h, c)); return { ok: true }; } catch { return { ok: false }; }
}
