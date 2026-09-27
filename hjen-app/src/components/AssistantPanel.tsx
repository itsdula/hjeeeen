// AssistantPanel — the in-app agent (MCP surface ②). Drives the SAME hjen MCP
// tools via hjen:assistant-turn. Conversations are PERSISTENT ON DISK (not
// localStorage): each one is either GENERAL or LINKED TO A PROJECT, stored in
// {projectsRoot}/_conversations/ or {slug}/_project/conversations/ — the same
// store external agents read via hjen_conversations_list/_get. The switcher
// shows every saved conversation with its linked project, from ANY view.

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { ProjectAssetPicker } from './ProjectAssetPicker';

interface Msg { role: 'user' | 'assistant'; text: string; steps?: Array<{ tool: string; args: any }>; ts?: number }
interface Convo {
  id: string; title: string;
  kind: 'general' | 'project';
  projectId?: string | null; projectName?: string | null; projectSlug?: string | null;
  messages: Msg[]; createdAt: string; updatedAt: string;
}
interface ConvoSummary {
  id: string; title: string; kind: 'general' | 'project';
  projectId?: string | null; projectName?: string | null; projectSlug?: string | null;
  updatedAt: string; msgCount: number;
}

const LEGACY_CONVOS_KEY = 'hjen_assistant_convos_v2';
const MIGRATED_KEY = 'hjen_assistant_migrated_to_disk_v1';
const ACTIVE_KEY = 'hjen_assistant_active_id';

const WELCOME: Msg = {
  role: 'assistant',
  text: "I'm the HJEN Assistant — I work on every page and drive the same tools. Ask me to build a storyboard, add and wire nodes, or set up a project. I plan and build the structure first; I only spend on images or video when you explicitly ask.",
};
const SUGGESTIONS = [
  'Build a 6-shot storyboard: a person riding a bicycle in New York',
  'Add a Frame node and wire it to a Video node',
  'Give me an overview of this project',
  'What models are available?',
];

// hjen-studio:// deep links inside assistant replies become CLICKABLE — they
// navigate this window with the exact same mapping App.tsx uses for onNavigate.
const VIEW_MAP: Record<string, string> = {
  overview: 'project', project: 'project', storyboard: 'storyboard', node: 'node',
  frame: 'frame', video: 'video', library: 'library', cast: 'cast',
};
function navigateDeepLink(uri: string) {
  const m = /^hjen-studio:\/\/project\/([^/\s]+)(?:\/([a-z]+))?/i.exec(uri.trim());
  if (!m) return;
  const projectId = decodeURIComponent(m[1]);
  const view = (m[2] || 'overview').toLowerCase();
  const st = useStore.getState() as any;
  if (projectId) st.selectProject(projectId);
  const target = VIEW_MAP[view] || 'projects';
  if (target === 'project' && projectId) void st.openProjectWorkspace(projectId);
  else { if (target === 'node' && projectId) void st.loadGraphForProject(projectId); st.setActiveView(target); }
}
const LINK_RE = /\[([^\]]+)\]\((hjen-studio:\/\/[^\s)]+)\)|(hjen-studio:\/\/[^\s)\]]+)/g;
function renderMsgText(text: string): React.ReactNode {
  if (!text.includes('hjen-studio://')) return text;
  const out: React.ReactNode[] = [];
  let last = 0; let i = 0; let m: RegExpExecArray | null;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const uri = m[2] || m[3];
    const label = m[1] || 'Open in Studio';
    out.push(
      <button key={`dl${i++}`} onClick={() => navigateDeepLink(uri)} style={deepLinkBtn} title={uri}>
        ↗ {label}
      </button>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// Slash-command → tool scope. Typing "/storyboard remake shot 2B" pins the
// agent to the storyboard; "/storyboard" alone just sets the sticky scope.
const SLASH: Record<string, string> = { frame: 'frame', frames: 'frame', storyboard: 'storyboard', video: 'video', story: 'story', node: 'node' };
const SLASH_LIST: [string, string][] = [
  ['/storyboard', 'work in the storyboard board'],
  ['/frame', 'standalone frames only'],
  ['/video', 'video (Seedance) only'],
  ['/story', 'brief / treatment / shot list'],
  ['/node', 'the node graph'],
];

// Composer's resting height — ~3 comfortable lines (13.5px @ 1.55 + 10px×2 pad).
const COMPOSER_MIN = 80;

const newId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
function titleFrom(msgs: Msg[]): string {
  const u = msgs.find(m => m.role === 'user' && m.text.trim());
  if (!u) return 'New conversation';
  const t = u.text.trim();
  return t.length > 42 ? t.slice(0, 42) + '…' : t;
}
function ago(iso: string | number): string {
  const t = typeof iso === 'number' ? iso : Date.parse(iso || '');
  if (!t) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function AssistantPanel({ embedded, surface }: { embedded?: boolean; surface?: string } = {}) {
  const setActiveView = useStore(s => s.setActiveView);
  const activeProjectId = useStore(s => s.activeProjectId);
  const activeProject = useStore(s => s.projects.find(p => p.id === s.activeProjectId) ?? null);
  const projectName = activeProject?.name ?? null;

  const [summaries, setSummaries] = useState<ConvoSummary[]>([]);
  const [active, setActive] = useState<Convo | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState('');
  const [showConvos, setShowConvos] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [attachMenu, setAttachMenu] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Sticky tool scope from "/frame · /storyboard · /video · /story · /node" —
  // pins the agent to one surface until cleared.
  const [scope, setScope] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Resizable composer. Default is a comfortable ~3 lines (bigger than the old
  //    single line); it auto-grows with the text, and a drag handle above it lets
  //    the user pull it taller by hand (ChatGPT-style). It never grows past ~45%
  //    of the panel height — past that it scrolls internally — so the message
  //    list above only shrinks and nothing is ever pushed under the status bar
  //    (the drawer's `bottom: calc(--status-bar-h + 12px)` clamp stays intact).
  const rootRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const manualRef = useRef<number | null>(null); // user-dragged floor, if any
  const [taH, setTaH] = useState(COMPOSER_MIN);
  const maxTaH = () => Math.max(140, Math.round((rootRef.current?.clientHeight ?? 480) * 0.45));
  const autoGrow = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const floor = manualRef.current ?? COMPOSER_MIN;
    setTaH(Math.min(Math.max(ta.scrollHeight, floor), maxTaH()));
  };
  const resetComposer = () => { manualRef.current = null; setTaH(COMPOSER_MIN); };
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = taH;
    const max = maxTaH();
    const onMove = (ev: PointerEvent) => {
      const next = Math.min(Math.max(startH + (startY - ev.clientY), COMPOSER_MIN), max);
      manualRef.current = next;
      setTaH(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const messages = active?.messages ?? [WELCOME];
  const hasUserMsgs = messages.some(m => m.role === 'user');

  const freshConvo = (): Convo => {
    const now = new Date().toISOString();
    return activeProject
      ? { id: newId(), title: 'New conversation', kind: 'project', projectId: activeProject.id, projectName: activeProject.name, projectSlug: activeProject.slug, messages: [WELCOME], createdAt: now, updatedAt: now }
      : { id: newId(), title: 'New conversation', kind: 'general', messages: [WELCOME], createdAt: now, updatedAt: now };
  };

  async function refreshList(): Promise<ConvoSummary[]> {
    try {
      const r = await window.hjen.conversationsList?.();
      const list = r?.ok ? r.conversations : [];
      setSummaries(list);
      return list;
    } catch { return []; }
  }

  // Mount: one-time localStorage migration → hydrate list → resume last convo.
  useEffect(() => {
    (async () => {
      try {
        if (!localStorage.getItem(MIGRATED_KEY)) {
          const raw = localStorage.getItem(LEGACY_CONVOS_KEY);
          if (raw) {
            const legacy = JSON.parse(raw);
            for (const c of Array.isArray(legacy?.convos) ? legacy.convos : []) {
              if (!c?.id || !Array.isArray(c.messages) || !c.messages.some((m: any) => m?.role === 'user')) continue;
              const iso = new Date(c.updatedAt || Date.now()).toISOString();
              await window.hjen.conversationWrite?.({ id: c.id, title: c.title || titleFrom(c.messages), kind: 'general', messages: c.messages, createdAt: iso, updatedAt: iso });
            }
          }
          localStorage.setItem(MIGRATED_KEY, '1');
        }
      } catch { /* migration is best-effort */ }
      const list = await refreshList();
      const wantId = localStorage.getItem(ACTIVE_KEY);
      const pick = (wantId && list.find(s => s.id === wantId)) || list[0];
      if (pick) {
        try {
          const r = await window.hjen.conversationRead?.({ id: pick.id, kind: pick.kind, projectSlug: pick.projectSlug || undefined });
          if (r?.ok && r.conversation) { setActive(r.conversation); return; }
        } catch { /* fall through */ }
      }
      setActive(freshConvo());
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const off = window.hjen.onAssistantEvent?.((e) => {
      if (e.type === 'tool_call') setLive(`⚙︎ ${e.name}…`);
      else if (e.type === 'tool_result') setLive('');
    });
    return () => { off?.(); };
  }, []);
  useEffect(() => { if (active?.id) localStorage.setItem(ACTIVE_KEY, active.id); }, [active?.id]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages, live]);

  /** Persist a convo to disk (fire-and-forget) + refresh the switcher list. */
  function persist(convo: Convo) {
    window.hjen.conversationWrite?.(convo).then(() => refreshList()).catch(() => { /* non-blocking */ });
  }

  const setActiveMsgs = (convo: Convo, next: Msg[]): Convo => {
    const updated: Convo = {
      ...convo,
      messages: next,
      updatedAt: new Date().toISOString(),
      title: convo.title === 'New conversation' && next.some(m => m.role === 'user') ? titleFrom(next) : convo.title,
    };
    setActive(updated);
    persist(updated);
    return updated;
  };

  const newConvo = () => { setActive(freshConvo()); setShowConvos(false); };
  const switchConvo = async (s: ConvoSummary) => {
    setShowConvos(false);
    try {
      const r = await window.hjen.conversationRead?.({ id: s.id, kind: s.kind, projectSlug: s.projectSlug || undefined });
      if (r?.ok && r.conversation) setActive(r.conversation);
    } catch { /* keep current */ }
  };
  const deleteConvo = async (id: string) => {
    try { await window.hjen.conversationDelete?.({ id }); } catch { /* ignore */ }
    const list = await refreshList();
    if (active?.id === id) {
      const next = list[0];
      if (next) { await switchConvo(next); } else { setActive(freshConvo()); }
    }
  };

  /** Scope toggle — only before the first user message (a convo's home is fixed after that). */
  const toggleScope = () => {
    if (!active || hasUserMsgs) return;
    if (active.kind === 'project') {
      setActive({ ...active, kind: 'general', projectId: null, projectName: null, projectSlug: null });
    } else if (activeProject) {
      setActive({ ...active, kind: 'project', projectId: activeProject.id, projectName: activeProject.name, projectSlug: activeProject.slug });
    }
  };

  const addAttachments = (paths: string[]) => setAttachments(a => [...a, ...paths.filter(f => f && !a.includes(f))]);
  async function pickFromDisk() {
    setAttachMenu(false);
    try {
      const files = await window.hjen.pickImageFiles?.();
      if (Array.isArray(files) && files.length) addAttachments(files);
    } catch { /* dialog cancelled */ }
  }

  async function send(text: string) {
    const raw = text.trim();
    if (!raw || busy || !active) return;
    // Parse a leading slash-command into a tool scope (sticky). "/storyboard"
    // alone just sets the scope; "/storyboard <text>" scopes THIS message too.
    let useScope = scope;
    let msg = raw;
    const sm = /^\/([a-zA-Z]+)\s*([\s\S]*)$/.exec(raw);
    if (sm && SLASH[sm[1].toLowerCase()]) {
      useScope = SLASH[sm[1].toLowerCase()];
      setScope(useScope);
      msg = sm[2].trim();
      if (!msg) { setInput(''); return; }  // just pinned the scope; nothing to send yet
    }
    const files = attachments;
    setInput(''); setAttachments([]); setBusy(true); setLive('…'); resetComposer();
    const prior = active.messages;
    const shown = files.length ? `${msg}\n📎 ${files.map(f => f.split('/').pop()).join(' · ')}` : msg;
    const withUser: Msg[] = [...prior, { role: 'user', text: shown, ts: Date.now() }];
    const current = setActiveMsgs(active, withUser);
    const history = prior.filter(m => m.text).map(m => ({ role: m.role, content: m.text }));
    try {
      const res = await window.hjen.assistantTurn({
        message: msg, history,
        context: { surface: surface || 'studio', projectId: activeProjectId, projectName, attachments: files, scope: useScope || undefined },
      });
      const reply: Msg = res.ok
        ? { role: 'assistant', text: res.finalText || '(no answer)', steps: (res.steps || []).map(s => ({ tool: s.tool, args: s.args })), ts: Date.now() }
        : { role: 'assistant', text: `⚠︎ ${res.message || res.reason || 'error'}`, ts: Date.now() };
      setActiveMsgs(current, [...withUser, reply]);
    } catch (err: any) {
      setActiveMsgs(current, [...withUser, { role: 'assistant', text: `⚠︎ ${err?.message || err}`, ts: Date.now() }]);
    } finally { setBusy(false); setLive(''); }
  }

  const scopeLabel = active?.kind === 'project' ? (active.projectName || 'Project') : 'General';

  return (
    <div ref={rootRef} className="mcp-assistant" style={{ position: embedded ? 'relative' : 'absolute', inset: embedded ? undefined : 0, height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--ink)' }}>
      {!embedded && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderBottom: '1px solid var(--line)' }}>
          <button onClick={() => setActiveView('studio')} style={btn}>← Studio</button>
          <strong style={{ letterSpacing: 0.4 }}>MCP · Assistant</strong>
        </div>
      )}

      {/* Conversation switcher — every saved chat, each showing its linked project */}
      <div style={convobar}>
        <button onClick={() => setShowConvos(v => !v)} style={convoTitle} title="Conversations">
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{active?.title || 'Conversation'}</span>
          <svg width="9" height="9" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" style={{ opacity: 0.5, flexShrink: 0 }}><path d="M1 1l4 4 4-4" /></svg>
        </button>
        <button
          onClick={toggleScope}
          style={{ ...scopePill, ...(active?.kind === 'project' ? scopePillProject : {}), cursor: hasUserMsgs ? 'default' : 'pointer' }}
          title={hasUserMsgs ? `Saved ${active?.kind === 'project' ? `with project "${scopeLabel}"` : 'as general'}` : (activeProject ? 'Toggle: link to the open project or keep general' : 'General (open a project to link)')}
        >
          {scopeLabel}
        </button>
        <button onClick={newConvo} style={newBtn} title="New conversation">New</button>
        {showConvos && (
          <>
            <div style={convoScrim} onClick={() => setShowConvos(false)} />
            <div style={convoList}>
              <div style={{ fontSize: 11, opacity: 0.5, padding: '2px 8px 6px' }}>Saved conversations · {summaries.length}</div>
              {summaries.length === 0 && <div style={{ fontSize: 12, opacity: 0.5, padding: '4px 8px 8px' }}>Nothing saved yet — your chats persist here, general or per-project.</div>}
              {summaries.map(s => (
                <div key={s.id} style={{ ...convoRow, ...(s.id === active?.id ? { background: 'var(--bg-elev)' } : {}) }}>
                  <button onClick={() => switchConvo(s)} style={convoRowBtn}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
                      <span style={{ ...rowChip, ...(s.kind === 'project' ? rowChipProject : {}) }}>{s.kind === 'project' ? (s.projectName || 'Project') : 'General'}</span>
                    </span>
                    <span style={{ fontSize: 10, opacity: 0.45, fontFamily: 'ui-monospace, monospace' }}>{ago(s.updatedAt)} · {s.msgCount} msg</span>
                  </button>
                  <button onClick={() => deleteConvo(s.id)} style={convoDel} title="Delete">✕</button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: m.role === 'user' ? '82%' : '96%' }}>
            {m.steps && m.steps.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
                {m.steps.map((s, j) => <span key={j} style={chip}>{s.tool}</span>)}
              </div>
            )}
            {m.role === 'user' ? (
              <div style={bubble}>
                <div className="assistant-text" dir="auto" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55, unicodeBidi: 'plaintext' }}>{renderMsgText(m.text)}</div>
              </div>
            ) : (
              <div className="assistant-text" dir="auto" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: 13.5, opacity: 0.92, unicodeBidi: 'plaintext' }}>{renderMsgText(m.text)}</div>
            )}
          </div>
        ))}
        {busy && <ThinkingIndicator live={live} />}
      </div>

      {messages.length <= 1 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '0 18px 12px' }}>
          {SUGGESTIONS.map(s => <button key={s} onClick={() => send(s)} style={sugg}>{s}</button>)}
        </div>
      )}

      {/* Attachment tray — each removable; clear-all when several. */}
      {attachments.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: '0 18px 8px' }}>
          {attachments.map(f => (
            <span key={f} style={attachChip} title={f}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.split('/').pop()}</span>
              <button onClick={() => setAttachments(a => a.filter(x => x !== f))} style={attachX} title="Remove attachment" aria-label="Remove attachment">✕</button>
            </span>
          ))}
          {attachments.length > 1 && <button onClick={() => setAttachments([])} style={clearAllBtn} title="Remove all attachments">clear all</button>}
        </div>
      )}

      {/* Active tool scope (from a slash command) — removable. */}
      {scope && (
        <div style={{ padding: '0 18px 8px' }}>
          <span style={scopeChip}>
            /{scope}
            <button onClick={() => setScope(null)} style={attachX} title="Clear scope" aria-label="Clear scope">✕</button>
          </span>
        </div>
      )}

      {/* Drag handle — pull up to enlarge the composer (ChatGPT-style). The list
          above shrinks; nothing spills under the status bar. */}
      <div onPointerDown={startResize} style={resizeHandle} title="Drag to resize" role="separator" aria-label="Resize the message box" aria-orientation="horizontal">
        <span style={resizeGrip} />
      </div>

      <div style={{ display: 'flex', gap: 8, padding: '2px 16px 12px', alignItems: 'flex-end', position: 'relative' }}>
        {/* Slash-command autocomplete */}
        {/^\/[a-zA-Z]*$/.test(input) && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 8 }} onClick={() => setInput('')} />
            <div style={slashBox}>
              {SLASH_LIST.filter(([c]) => c.startsWith(input.toLowerCase())).map(([cmd, desc]) => (
                <button key={cmd} style={slashItem} onClick={() => setInput(cmd + ' ')}>
                  <span style={{ fontFamily: MONO, fontWeight: 600 }}>{cmd}</span>
                  <span style={{ opacity: 0.5, fontSize: 11 }}>{desc}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <button onClick={() => setAttachMenu(v => !v)} disabled={busy} style={clipBtn} title="Attach a reference — from this project or from disk">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" /></svg>
        </button>
        {attachMenu && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 8 }} onClick={() => setAttachMenu(false)} />
            <div style={attachMenuBox}>
              <button style={attachMenuItem} onClick={() => { setAttachMenu(false); setPickerOpen(true); }}>From project<span style={attachMenuHint}>generations · storyboard · library</span></button>
              <button style={attachMenuItem} onClick={pickFromDisk}>From disk<span style={attachMenuHint}>pick image files</span></button>
            </div>
          </>
        )}
        <textarea
          ref={taRef}
          value={input}
          onChange={e => { setInput(e.target.value); autoGrow(); }}
          onKeyDown={e => {
            // Enter sends · Shift+Enter inserts a newline (textarea default).
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
          }}
          placeholder="Ask the Assistant…   /  to scope · Shift+Enter = new line"
          disabled={busy}
          dir="auto"
          style={{ flex: 1, height: taH, padding: '10px 13px', borderRadius: 10, border: '1px solid var(--line-strong)', background: 'var(--bg-elev)', color: 'inherit', outline: 'none', resize: 'none', lineHeight: 1.55, fontSize: 13.5, overflowY: 'auto', fontFamily: 'inherit', unicodeBidi: 'plaintext' }}
        />
        <button onClick={() => send(input)} disabled={busy || !input.trim()} style={{ ...sendBtn, opacity: busy || !input.trim() ? 0.4 : 1 }}>Send</button>
      </div>

      {pickerOpen && <ProjectAssetPicker onClose={() => setPickerOpen(false)} onAttach={addAttachments} />}
    </div>
  );
}

/** Live "thinking" state — cycles Saudi-register phrases with a shimmer while a
 *  turn runs (like Claude/ChatGPT's living loader), instead of one static word.
 *  Arabic carries NO letter-spacing / mono (house law); the shimmer is on colour. */
const THINKING_PHRASES = [
  'أقرأ طلبك…',
  'أفكّر في أفضل طريقة…',
  'أرتّب المشاهد…',
  'أجهّز البنية…',
  'أوشك أن أنتهي…',
];
function ThinkingIndicator({ live }: { live?: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI(v => (v + 1) % THINKING_PHRASES.length), 2400);
    return () => clearInterval(id);
  }, []);
  // A tool is actively running → name it quietly beneath the living phrase.
  const tool = live && live.startsWith('⚙︎') ? live.replace('⚙︎', '').trim() : '';
  return (
    <div className="mcp-thinking" dir="rtl">
      <span className="mcp-thinking__dot" />
      <span className="mcp-thinking__txt" key={i}>{THINKING_PHRASES[i]}</span>
      {tool && <span className="mcp-thinking__tool" dir="ltr">{tool}</span>}
    </div>
  );
}

// ─── Style — HJEN's MCP language on HJEN tokens: flat monochrome, no color
// accents, mono labels, white-ring active states, numbered plainness. ─────────
const MONO = 'var(--font-mono, ui-monospace, monospace)';

// Composer resize handle — a thin, full-width strip carrying the border-top,
// with a centred grip. row-resize cursor; touchAction none so a drag doesn't scroll.
const resizeHandle: React.CSSProperties = { display: 'grid', placeItems: 'center', height: 15, borderTop: '1px solid var(--line)', cursor: 'row-resize', touchAction: 'none', flex: '0 0 auto', userSelect: 'none' };
const resizeGrip: React.CSSProperties = { width: 34, height: 3, borderRadius: 999, background: 'var(--line-strong)' };

const btn: React.CSSProperties = { padding: '8px 14px', borderRadius: 8, border: '1px solid var(--line-strong)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13 };
const sendBtn: React.CSSProperties = { padding: '9px 18px', borderRadius: 9, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'var(--on-accent)', cursor: 'pointer', fontSize: 13, fontWeight: 600, flex: '0 0 auto' };
const clipBtn: React.CSSProperties = { width: 38, height: 38, display: 'grid', placeItems: 'center', borderRadius: 9, border: '1px solid var(--line-strong)', background: 'transparent', color: 'inherit', opacity: 0.75, cursor: 'pointer', flex: '0 0 auto' };
const attachMenuBox: React.CSSProperties = { position: 'absolute', bottom: 'calc(100% + 6px)', left: 16, zIndex: 9, minWidth: 220, padding: 5, background: 'var(--bg)', border: '1px solid var(--line-strong)', borderRadius: 11, boxShadow: '0 16px 44px rgba(0,0,0,.55)' };
const attachMenuItem: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, width: '100%', padding: '9px 11px', border: 'none', borderRadius: 8, background: 'transparent', color: 'inherit', cursor: 'pointer', textAlign: 'start', fontSize: 13 };
const attachMenuHint: React.CSSProperties = { fontSize: 10, opacity: 0.45, fontFamily: MONO, letterSpacing: '0.03em' };
const bubble: React.CSSProperties = { padding: '9px 13px', borderRadius: 11, border: '1px solid var(--line)', background: 'var(--bg-elev)', fontSize: 13.5 };
const chip: React.CSSProperties = { fontSize: 10, padding: '2px 8px', borderRadius: 5, border: '1px solid var(--line-strong)', opacity: 0.6, fontFamily: MONO, letterSpacing: '0.03em' };
const sugg: React.CSSProperties = { padding: '7px 13px', borderRadius: 999, border: '1px solid var(--line-strong)', background: 'var(--bg-elev)', color: 'inherit', opacity: 0.85, cursor: 'pointer', fontSize: 12, textAlign: 'start' };

const convobar: React.CSSProperties = { position: 'relative', display: 'flex', alignItems: 'center', gap: 6, padding: '9px 12px', borderBottom: '1px solid var(--line)' };
const convoTitle: React.CSSProperties = { flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, padding: '6px 11px', borderRadius: 8, border: '1px solid var(--line-strong)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12.5 };
const newBtn: React.CSSProperties = { padding: '6px 12px', borderRadius: 999, border: '1px solid var(--line-strong)', background: 'transparent', color: 'inherit', opacity: 0.85, cursor: 'pointer', fontSize: 11.5, flex: '0 0 auto' };
const convoScrim: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 5 };
const convoList: React.CSSProperties = { position: 'absolute', top: 'calc(100% + 4px)', left: 12, right: 12, zIndex: 6, maxHeight: 300, overflowY: 'auto', padding: 6, background: 'var(--bg)', border: '1px solid var(--line-strong)', borderRadius: 10, boxShadow: '0 16px 44px rgba(0,0,0,.5)' };
const convoRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, borderRadius: 7 };
const convoRowBtn: React.CSSProperties = { flex: 1, display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, padding: '8px 9px', border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', textAlign: 'start', fontSize: 12.5 };
const convoDel: React.CSSProperties = { width: 26, height: 26, border: 'none', background: 'transparent', color: 'inherit', opacity: 0.45, cursor: 'pointer', fontSize: 11, borderRadius: 6, flex: '0 0 auto' };

// Scope: active-pill = white ring at full strength; general = muted.
const scopePill: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 999, border: '1px solid var(--line-strong)', background: 'transparent', color: 'inherit', opacity: 0.6, fontSize: 10.5, fontFamily: MONO, letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', flex: '0 0 auto' };
const scopePillProject: React.CSSProperties = { border: '1.5px solid var(--ink)', opacity: 1 };
const rowChip: React.CSSProperties = { flex: '0 0 auto', fontSize: 8.5, padding: '1px 7px', borderRadius: 999, border: '1px solid var(--line-strong)', opacity: 0.55, fontFamily: MONO, letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis' };
const rowChipProject: React.CSSProperties = { border: '1px solid var(--ink)', opacity: 0.9 };
const attachChip: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontFamily: MONO, padding: '3px 4px 3px 10px', borderRadius: 6, border: '1px solid var(--line-strong)', background: 'var(--bg-elev)', maxWidth: 220 };
const attachX: React.CSSProperties = { display: 'grid', placeItems: 'center', width: 18, height: 18, borderRadius: 5, border: 'none', background: 'transparent', color: 'inherit', opacity: 0.6, cursor: 'pointer', fontSize: 11, flex: '0 0 auto' };
const clearAllBtn: React.CSSProperties = { padding: '4px 9px', borderRadius: 6, border: '1px solid var(--line-strong)', background: 'transparent', color: 'inherit', opacity: 0.7, cursor: 'pointer', fontSize: 10.5, fontFamily: MONO };
const scopeChip: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontFamily: MONO, padding: '3px 4px 3px 10px', borderRadius: 999, border: '1.5px solid var(--ink)', background: 'transparent' };
const slashBox: React.CSSProperties = { position: 'absolute', bottom: 'calc(100% + 6px)', left: 16, right: 16, zIndex: 9, padding: 5, background: 'var(--bg)', border: '1px solid var(--line-strong)', borderRadius: 11, boxShadow: '0 16px 44px rgba(0,0,0,.55)' };
const slashItem: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, width: '100%', padding: '8px 11px', border: 'none', borderRadius: 8, background: 'transparent', color: 'inherit', cursor: 'pointer', textAlign: 'start', fontSize: 13 };
const deepLinkBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, margin: '0 2px', padding: '3px 11px', borderRadius: 7, border: '1px solid var(--ink)', background: 'transparent', color: 'var(--ink)', cursor: 'pointer', fontSize: 12, fontWeight: 500, verticalAlign: 'baseline' };
