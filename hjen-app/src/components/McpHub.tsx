// MCP Hub — HJEN's "Connect your assistant" panel. Three tabs, one
// per surface: Assistant (in-app agent ②) · Connect agent (external agents ① —
// endpoint + per-client copy-paste) · External servers (③ — mount other MCPs).

import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { AssistantPanel } from './AssistantPanel';

type Tab = 'assistant' | 'connect' | 'external';
type Client = 'desktop' | 'code' | 'cursor';

function CopyBlock({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div style={{ position: 'relative', margin: '8px 0' }}>
      <pre style={{ margin: 0, padding: '12px 14px', paddingRight: 70, background: '#0c0e11', border: '1px solid var(--hair, #22262c)', borderRadius: 10, overflowX: 'auto', fontSize: 12.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{text}</pre>
      <button onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); }}
        style={{ position: 'absolute', top: 8, insetInlineEnd: 8, padding: '5px 10px', borderRadius: 7, border: '1px solid var(--hair, #2a2f36)', background: 'var(--panel, #16191e)', color: 'inherit', cursor: 'pointer', fontSize: 11.5 }}>{done ? 'copied ✓' : 'copy'}</button>
    </div>
  );
}

export function McpHub() {
  const setActiveView = useStore(s => s.setActiveView);
  const [tab, setTab] = useState<Tab>('assistant');
  const [cfg, setCfg] = useState<{ runShPath: string; serveHttpPath: string; defaultHttpUrl: string } | null>(null);
  const [client, setClient] = useState<Client>('desktop');
  const [token, setToken] = useState('');
  const [servers, setServers] = useState<Array<{ name: string; command: string; args?: string[] }>>([]);
  const [nn, setNn] = useState(''); const [nc, setNc] = useState('');

  useEffect(() => { window.hjen.mcpEndpointConfig?.().then(setCfg); window.hjen.mcpListServers?.().then(setServers); }, []);

  const tk = token || '<YOUR_TOKEN>';
  const stdioCmd = cfg ? `claude mcp add hjen -- "${cfg.runShPath}"` : '';
  const httpUrl = cfg?.defaultHttpUrl || 'http://127.0.0.1:8788/mcp';
  const codeHttp = `claude mcp add --transport http hjen --url ${httpUrl} \\\n  --header "Authorization: Bearer ${tk}"`;
  const desktopJson = `{
  "servers": {
    "hjen": {
      "type": "http",
      "url": "${httpUrl}",
      "headers": { "Authorization": "Bearer ${tk}" }
    }
  }
}`;
  const cursorCmd = `# Cursor → Settings → MCP → Add. URL: ${httpUrl}\n# Header: Authorization: Bearer ${tk}`;

  const genToken = () => setToken(Array.from(crypto.getRandomValues(new Uint8Array(24))).map(b => b.toString(16).padStart(2, '0')).join(''));

  async function saveServers(next: typeof servers) { setServers(next); await window.hjen.mcpSetServers?.(next); }
  function addServer() { const name = nn.trim(); const command = nc.trim(); if (!name || !command) return; saveServers([...servers, { name, command }]); setNn(''); setNc(''); }

  return (
    <div style={{ position: 'fixed', top: 'var(--top-chrome-h, 56px)', left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg, #0c0e11)', color: 'var(--ink, #e8e6e1)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 20px', borderBottom: '1px solid var(--hair, #22262c)' }}>
        <button onClick={() => setActiveView('studio')} style={btn}>← Studio</button>
        <strong style={{ letterSpacing: 0.4 }}>MCP</strong>
        <div style={{ display: 'flex', gap: 6, marginInlineStart: 8 }}>
          {([['assistant', 'Assistant'], ['connect', 'Connect agent'], ['external', 'External servers']] as [Tab, string][]).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{ ...tabBtn, ...(tab === id ? tabOn : {}) }}>{label}</button>
          ))}
        </div>
      </div>

      {tab === 'assistant' && <div style={{ flex: 1, minHeight: 0 }}><AssistantPanel embedded /></div>}

      {tab === 'connect' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '22px 26px', maxWidth: 760 }}>
          <h2 style={{ margin: '0 0 4px', fontSize: 19 }}>Connect your assistant</h2>
          <p style={{ opacity: 0.6, margin: '0 0 18px', fontSize: 13.5 }}>Give Claude / Cursor the keys to drive HJEN over MCP — the same 22 tools the in-app Assistant uses.</p>

          <div style={{ ...card }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Local — works now (stdio)</div>
            <div style={{ opacity: 0.6, fontSize: 12.5, marginBottom: 6 }}>No server, no token. Runs on this machine.</div>
            <CopyBlock text={stdioCmd || 'loading…'} />
          </div>

          <div style={{ ...card }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Hosted — HTTP + OAuth (for remote / teammates)</div>
            <div style={{ opacity: 0.6, fontSize: 12.5, marginBottom: 8 }}>Start the endpoint, then add its URL. Endpoint: <code>{httpUrl}</code></div>
            <CopyBlock text={cfg ? `"${cfg.serveHttpPath}"   # starts the hosted endpoint` : 'loading…'} />

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0 6px' }}>
              <span style={{ fontSize: 12.5, opacity: 0.7 }}>Access token</span>
              <input value={token} onChange={e => setToken(e.target.value)} placeholder="paste or generate" style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--hair, #2a2f36)', background: '#0c0e11', color: 'inherit', fontSize: 12.5 }} />
              <button onClick={genToken} style={btn}>Generate</button>
            </div>
            <div style={{ opacity: 0.55, fontSize: 11.5, marginBottom: 12 }}>Set this as <code>HJEN_MCP_DEV_TOKEN</code> in <code>mcp/.env</code> (operator), or issue a per-user token via the server admin. OAuth clients can skip the token and sign in through the browser.</div>

            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {([['desktop', 'Claude Desktop'], ['code', 'Claude Code'], ['cursor', 'Cursor']] as [Client, string][]).map(([id, label]) => (
                <button key={id} onClick={() => setClient(id)} style={{ ...tabBtn, ...(client === id ? tabOn : {}) }}>{label}</button>
              ))}
            </div>
            {client === 'desktop' && <CopyBlock text={desktopJson} />}
            {client === 'code' && <CopyBlock text={codeHttp} />}
            {client === 'cursor' && <CopyBlock text={cursorCmd} />}
            <div style={{ opacity: 0.6, fontSize: 12.5, marginTop: 8 }}>Verify: ask your assistant <b>“show me my HJEN projects.”</b></div>
          </div>
        </div>
      )}

      {tab === 'external' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '22px 26px', maxWidth: 760 }}>
          <h2 style={{ margin: '0 0 4px', fontSize: 19 }}>External MCP servers</h2>
          <p style={{ opacity: 0.6, margin: '0 0 18px', fontSize: 13.5 }}>Mount other MCP servers into the in-app Assistant — their tools appear alongside HJEN’s, prefixed <code>ext__&lt;name&gt;__</code>.</p>
          {servers.length === 0 && <div style={{ opacity: 0.5, fontSize: 13, marginBottom: 14 }}>None mounted yet.</div>}
          {servers.map((s, i) => (
            <div key={i} style={{ ...card, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1 }}><div style={{ fontWeight: 600 }}>{s.name}</div><div style={{ opacity: 0.6, fontSize: 12, wordBreak: 'break-all' }}>{s.command}</div></div>
              <button onClick={() => saveServers(servers.filter((_, j) => j !== i))} style={{ ...btn, borderColor: '#7a2c2c' }}>Remove</button>
            </div>
          ))}
          <div style={{ ...card, marginTop: 14 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Add a server (stdio)</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={nn} onChange={e => setNn(e.target.value)} placeholder="name (e.g. my-server)" style={inp} />
              <input value={nc} onChange={e => setNc(e.target.value)} placeholder="command (absolute path to the server)" style={{ ...inp, flex: 2 }} />
              <button onClick={addServer} style={{ ...btn, background: 'var(--accent, #0563E9)', color: '#fff' }}>Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const btn: React.CSSProperties = { padding: '7px 12px', borderRadius: 8, border: '1px solid var(--hair, #2a2f36)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12.5 };
const tabBtn: React.CSSProperties = { padding: '6px 12px', borderRadius: 8, border: '1px solid transparent', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12.5, opacity: 0.7 };
const tabOn: React.CSSProperties = { border: '1px solid var(--hair, #2a2f36)', background: 'var(--panel, #16191e)', opacity: 1 };
const card: React.CSSProperties = { background: 'var(--panel, #16191e)', border: '1px solid var(--hair, #22262c)', borderRadius: 12, padding: '16px 18px', marginBottom: 14 };
const inp: React.CSSProperties = { flex: 1, padding: '9px 11px', borderRadius: 8, border: '1px solid var(--hair, #2a2f36)', background: '#0c0e11', color: 'inherit', fontSize: 12.5 };
