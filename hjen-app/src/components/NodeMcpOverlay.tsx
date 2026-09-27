// MCP, inside the node canvas — HJEN's "Connect your assistant"
// modal (centered card, clean sans, pill tabs, numbered steps, copy fields).
// Two tabs: Assistant (the in-canvas agent that builds nodes/storyboard here) and
// Connect (hand an external agent the endpoint). All copy is English.

import { useEffect, useState } from 'react';
import { AssistantPanel } from './AssistantPanel';

type Tab = 'assistant' | 'connect';
type Cli = 'desktop' | 'code' | 'cursor';
const FONT = '-apple-system, "SF Pro Text", Inter, system-ui, "Segoe UI", sans-serif';

export function NodeMcpOverlay({ onClose, surface = 'node' }: { onClose: () => void; surface?: string }) {
  const [tab, setTab] = useState<Tab>('assistant');
  const [cli, setCli] = useState<Cli>('desktop');
  const [cfg, setCfg] = useState<{ runShPath: string; defaultHttpUrl: string } | null>(null);
  const [copied, setCopied] = useState('');

  useEffect(() => { window.hjen.mcpEndpointConfig?.().then(c => setCfg(c as any)); }, []);
  const copy = (k: string, t: string) => { navigator.clipboard?.writeText(t); setCopied(k); setTimeout(() => setCopied(''), 1200); };

  const url = cfg?.defaultHttpUrl || 'http://127.0.0.1:8788/mcp';
  const stdio = cfg ? `claude mcp add hjen -- "${cfg.runShPath}"` : 'loading…';
  const codeHttp = `claude mcp add --transport http hjen --url ${url}`;
  const cursorNote = `Cursor → Settings → MCP → Add. URL: ${url}`;

  return (
    <div className="mcp-overlay mcp-assistant" style={{ ...drawer, fontFamily: FONT }}>
      <header style={head}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontFamily: 'var(--font-mono, ui-monospace)', fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.55, marginInlineEnd: 6 }}>MCP</span>
          {([['assistant', 'Assistant'], ['connect', 'Connect agent']] as [Tab, string][]).map(([id, l]) => (
            <button key={id} onClick={() => setTab(id)} style={{ ...pill, ...(tab === id ? pillOn : {}) }}>{l}</button>
          ))}
        </div>
        <button onClick={onClose} title="Close" style={xBtn}>✕</button>
      </header>

      {tab === 'assistant' ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <AssistantPanel embedded surface={surface} />
        </div>
      ) : (
        <div className="mcp-connect" style={{ flex: 1, overflowY: 'auto', padding: '20px 22px 24px' }}>
            <h1 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 650 }}>Connect your assistant</h1>
            <p style={{ margin: '0 0 20px', fontSize: 13, opacity: 0.6 }}>Drive the whole HJEN studio from Claude, Cursor, or any MCP client — the same 26 tools the Assistant uses (incl. asset upload + saved conversations).</p>

            <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
              {([['desktop', 'Claude Desktop'], ['code', 'Claude Code'], ['cursor', 'Cursor']] as [Cli, string][]).map(([id, l]) => (
                <button key={id} onClick={() => setCli(id)} style={{ ...pill, ...(cli === id ? pillOn : {}) }}>{l}</button>
              ))}
            </div>

            {cli === 'desktop' && (<>
              <Step n={1}>Open <b>Claude Desktop</b> → <b>Settings → Connectors</b>, then click <b>+ Add custom connector</b>.</Step>
              <Step n={2}>Enter this name and URL:
                <Field label="Name" text="HJEN" k="name" copied={copied} copy={copy} />
                <Field label="URL" text={url} k="url" copied={copied} copy={copy} />
              </Step>
              <Step n={3}>Set tool permissions: <b>Always allow</b> for read tools, <b>Needs approval</b> for make/write tools.</Step>
              <p style={foot}>The first time you connect, HJEN opens a short sign-in so you can approve access. Prefer no server? Use the local option:</p>
              <Field label="Local (stdio)" text={stdio} k="stdio" copied={copied} copy={copy} mono />
            </>)}
            {cli === 'code' && (<>
              <Step n={1}>Make sure the hosted endpoint is running: <code>mcp/serve-http.sh</code> (or use the local stdio option below).</Step>
              <Step n={2}>Add it:
                <Field label="Hosted (OAuth)" text={codeHttp} k="code" copied={copied} copy={copy} mono />
                <Field label="Local (stdio)" text={stdio} k="stdio" copied={copied} copy={copy} mono />
              </Step>
            </>)}
            {cli === 'cursor' && (<>
              <Step n={1}>Cursor → <b>Settings → MCP → Add</b>. Use the hosted URL with a Bearer token, or the local command.</Step>
              <Field label="URL" text={url} k="url" copied={copied} copy={copy} mono />
              <Field label="Local (stdio)" text={stdio} k="stdio" copied={copied} copy={copy} mono />
            </>)}
            <p style={{ ...foot, marginTop: 18 }}>Verify: ask your assistant <b>“show me my HJEN projects.”</b></p>
          </div>
        )}
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  // Steps are plain "1. 2. 3." — muted numbers, no circles.
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 15 }}>
      <div style={num}>{n}.</div>
      <div style={{ flex: 1, fontSize: 13.5, lineHeight: 1.55 }}>{children}</div>
    </div>
  );
}
function Field({ label, text, k, copied, copy, mono }: { label: string; text: string; k: string; copied: string; copy: (k: string, t: string) => void; mono?: boolean }) {
  return (
    <div style={{ margin: '8px 0' }}>
      <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 4 }}>{label}</div>
      <div style={{ position: 'relative' }}>
        <div className="mcp-field" style={{ ...fieldBox, fontFamily: 'var(--font-mono, ui-monospace, monospace)' }}>{text}</div>
        <button onClick={() => copy(k, text)} style={copyBtn}>{copied === k ? 'copied ✓' : 'copy'}</button>
      </div>
    </div>
  );
}

// Right-docked drawer — bottom-anchored (bottom → middle of the screen), NON-blocking
// so the canvas stays fully usable alongside the Assistant.
// Bottom is lifted CLEAR of the global status bar (--status-bar-h) so the
// composer is never clipped beneath it, on any window height.
const drawer: React.CSSProperties = { position: 'fixed', right: 12, bottom: 'calc(var(--status-bar-h, 28px) + 12px)', top: 'auto', width: 'min(390px, 94vw)', height: 'min(60vh, 660px)', maxHeight: 'calc(100vh - var(--top-chrome-h, 56px) - var(--status-bar-h, 28px) - 24px)', background: 'var(--bg-elev)', border: '1px solid var(--line-strong)', borderRadius: 14, display: 'flex', flexDirection: 'column', overflow: 'hidden', color: 'var(--ink)', boxShadow: '0 20px 60px rgba(0,0,0,.5)', zIndex: 70 };
const head: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid var(--line)' };
// Pill language: active = white ring at full strength, inactive = muted dark pill.
const pill: React.CSSProperties = { padding: '6px 15px', borderRadius: 999, border: '1px solid var(--line-strong)', background: 'var(--bg)', color: 'inherit', cursor: 'pointer', fontSize: 12.5, opacity: 0.6 };
const pillOn: React.CSSProperties = { border: '1.5px solid var(--ink)', opacity: 1, fontWeight: 500 };
const xBtn: React.CSSProperties = { width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent', color: 'inherit', opacity: 0.6, cursor: 'pointer', fontSize: 13 };
const num: React.CSSProperties = { minWidth: 16, fontSize: 13, opacity: 0.45, flexShrink: 0, textAlign: 'end' };
const foot: React.CSSProperties = { fontSize: 12.5, opacity: 0.55, lineHeight: 1.5, margin: '6px 0' };
const fieldBox: React.CSSProperties = { padding: '10px 12px', paddingInlineEnd: 58, background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 9, fontSize: 12.5, overflowX: 'auto', whiteSpace: 'nowrap' };
const copyBtn: React.CSSProperties = { position: 'absolute', top: 6, insetInlineEnd: 6, padding: '5px 10px', borderRadius: 7, border: '1px solid var(--line-strong)', background: 'var(--bg-elev)', color: 'inherit', cursor: 'pointer', fontSize: 11 };
