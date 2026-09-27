import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../store';
import { readCreativeProjection, traceProjectionUse, type ProjectionRead } from '../../lib/creativegraph/consumer';
import type { ShotlistProjection } from '../../lib/creativegraph/technicalCompiler';
import { PreprodShell, Busy } from './shared';
import '../../styles/preprod-shotlist.css';

type Priority = 'A' | 'B' | 'C';
interface ShotRow {
  id: string;
  source: string;
  priority: Priority;
  beat: string;
  framing: string;
  lens: string;
  movement: string;
  light: string;
  sound: string;
  duration: string;
}
interface ShotlistDoc {
  rows: ShotRow[];
  sourceFingerprint?: string;
  sourceVersion?: number;
  updatedAt?: string;
}

const DOC_NAME = 'shotlist';
const EMPTY: ShotlistDoc = { rows: [] };
const rowId = (source: string, index: number) => {
  let h = 2166136261;
  for (const ch of source) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return `S${String(index + 1).padStart(2, '0')}-${(h >>> 0).toString(16).slice(0, 5)}`;
};
const csvCell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;

export function ShotlistView() {
  const projectId = useStore(s => s.activeProjectId);
  const projectName = useStore(s => s.projects.find(p => p.id === s.activeProjectId)?.name ?? 'HJEN');
  const setActiveView = useStore(s => s.setActiveView);
  const setSelection = useStore(s => s.setSelection);
  const [doc, setDoc] = useState<ShotlistDoc>(EMPTY);
  const [read, setRead] = useState<ProjectionRead<ShotlistProjection> | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let live = true;
    if (!projectId) { setDoc(EMPTY); setRead(null); setLoaded(false); return; }
    setLoaded(false);
    void Promise.all([
      window.hjen.projectDocRead({ id: projectId, name: DOC_NAME }).catch(() => null),
      readCreativeProjection<ShotlistProjection>(projectId, 'shotlist').catch(() => null),
    ]).then(([raw, projection]) => {
      if (!live) return;
      setDoc(raw && typeof raw === 'object' && Array.isArray((raw as ShotlistDoc).rows) ? raw as ShotlistDoc : EMPTY);
      setRead(projection);
      setLoaded(true);
    });
    return () => { live = false; if (timer.current) clearTimeout(timer.current); };
  }, [projectId]);

  const persist = (next: ShotlistDoc) => {
    setDoc(next);
    if (!projectId) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void window.hjen.projectDocWrite({ id: projectId, name: DOC_NAME, data: { ...next, updatedAt: new Date().toISOString() } });
    }, 400);
  };

  const projection = read?.node?.payload;
  const stale = !!read?.node && !!doc.sourceFingerprint && doc.sourceFingerprint !== read.node.fingerprint;
  const completeRows = doc.rows.filter(row => row.framing.trim() && row.lens.trim() && row.movement.trim() && row.light.trim()).length;
  const readiness = doc.rows.length ? Math.round((completeRows / doc.rows.length) * 100) : 0;
  const hasA = doc.rows.some(row => row.priority === 'A');

  const compile = () => {
    const node = read?.node;
    if (!node) return;
    const p = node.payload;
    const sources = p.priorities.length ? p.priorities : [p.cannotLose].filter(Boolean);
    const rows = sources.map((source, index) => {
      const existing = doc.rows.find(row => row.source === source);
      const [beat, ...rest] = source.split(/\s+—\s+/);
      return existing ?? {
        id: rowId(source, index), source,
        priority: (index === 0 ? 'A' : index < 4 ? 'B' : 'C') as Priority,
        beat: beat || `SHOT ${index + 1}`,
        framing: index === 0 ? p.cannotLose : rest.join(' — '),
        lens: p.aspectLaw,
        movement: p.movementLaw,
        light: p.lightLaw,
        sound: '', duration: '',
      };
    });
    persist({ rows, sourceFingerprint: node.fingerprint, sourceVersion: node.version });
    void traceProjectionUse(read, 'Shotlist', 'compile numbered shots', [`${rows.length} rows`]).catch(() => undefined);
    setNotice(`Compiled ${rows.length} shots from Creative Graph v${node.version}`);
    window.setTimeout(() => setNotice(null), 2200);
  };

  const updateRow = (id: string, patch: Partial<ShotRow>) => persist({ ...doc, rows: doc.rows.map(row => row.id === id ? { ...row, ...patch } : row) });

  const sendToFrame = (row: ShotRow) => {
    const p = projection;
    const prompt = [row.framing, `BEAT: ${row.beat}`, `LENS / ASPECT: ${row.lens}`, `MOVEMENT: ${row.movement}`, `LIGHT: ${row.light}`, row.sound && `SOUND OF FRAME: ${row.sound}`].filter(Boolean).join('\n');
    setSelection('prompt', prompt);
    if (read) void traceProjectionUse(read, 'Shotlist', 'send shot to Frame', [row.id]).catch(() => undefined);
    setActiveView('frame');
  };

  const exportCsv = () => {
    const header = ['Shot', 'Priority', 'Beat', 'Framing', 'Lens / aspect', 'Movement', 'Light', 'Sound', 'Duration'];
    const lines = [header, ...doc.rows.map(row => [row.id, row.priority, row.beat, row.framing, row.lens, row.movement, row.light, row.sound, row.duration])]
      .map(line => line.map(csvCell).join(','));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${projectName.replace(/\s+/g, '-')}-shotlist.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  const metrics = useMemo(() => ({ total: doc.rows.length, a: doc.rows.filter(r => r.priority === 'A').length }), [doc.rows]);

  return (
    <PreprodShell tool="Shotlist" sub="Signed story → production-locked shots" accent="#E5AAD8">
      {!loaded ? <Busy label="Reading the graph and shot ledger…" /> : (
        <div className="sl-page">
          <header className="sl-contract">
            <div>
              <span className="mono-label">Source contract</span>
              <h2>{read?.node ? `Creative Graph v${read.node.version}` : 'No creative source yet'}</h2>
              <p>{projection?.cannotLose || 'Sign the idea, complete Direction, and build Story before compiling shots.'}</p>
            </div>
            <div className="sl-contract__actions">
              {stale && <span className="sl-stale">STALE · rebuild required</span>}
              <button className="pp-btn pp-btn--accent" disabled={!read?.node} onClick={compile}>{doc.rows.length ? 'Recompile from graph' : 'Compile from graph'}</button>
              <button className="pp-btn pp-btn--ghost" disabled={!doc.rows.length} onClick={exportCsv}>Export CSV</button>
            </div>
          </header>

          <div className="sl-metrics">
            <div><span>Shots</span><b>{metrics.total}</b></div>
            <div><span>A priority</span><b>{metrics.a}</b></div>
            <div><span>Technical readiness</span><b>{readiness}%</b></div>
            <div className={hasA ? 'is-ok' : 'is-risk'}><span>Cannot-lose protected</span><b>{hasA ? 'YES' : 'NO'}</b></div>
          </div>

          {notice && <div className="sl-notice">{notice}</div>}
          {!doc.rows.length ? (
            <div className="sl-empty"><h3>No disconnected blank table.</h3><p>Compile only after the upstream contracts exist. Shotlist will inherit the narrative beats and Direction laws, then you finish the production-specific fields here.</p></div>
          ) : (
            <div className="sl-tablewrap">
              <table className="sl-table">
                <thead><tr><th>Shot</th><th>Pri</th><th>Beat</th><th>Framing / action</th><th>Lens / aspect</th><th>Movement</th><th>Light</th><th>Sound</th><th>Dur.</th><th /></tr></thead>
                <tbody>{doc.rows.map(row => (
                  <tr key={row.id} className={row.priority === 'A' ? 'is-a' : ''}>
                    <td><code>{row.id.split('-')[0]}</code></td>
                    <td><select value={row.priority} onChange={e => updateRow(row.id, { priority: e.target.value as Priority })}><option>A</option><option>B</option><option>C</option></select></td>
                    <td><input value={row.beat} onChange={e => updateRow(row.id, { beat: e.target.value })} /></td>
                    <td><textarea rows={3} value={row.framing} onChange={e => updateRow(row.id, { framing: e.target.value })} /></td>
                    <td><input value={row.lens} onChange={e => updateRow(row.id, { lens: e.target.value })} /></td>
                    <td><input value={row.movement} onChange={e => updateRow(row.id, { movement: e.target.value })} /></td>
                    <td><input value={row.light} onChange={e => updateRow(row.id, { light: e.target.value })} /></td>
                    <td><input value={row.sound} onChange={e => updateRow(row.id, { sound: e.target.value })} /></td>
                    <td><input value={row.duration} onChange={e => updateRow(row.id, { duration: e.target.value })} placeholder="3s" /></td>
                    <td><button className="sl-frame" onClick={() => sendToFrame(row)}>Frame →</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <p className="sl-risk"><b>Honest risk:</b> the graph can protect creative continuity, but locations, sun windows, talent calls and setup time still require a producer to schedule.</p>
        </div>
      )}
    </PreprodShell>
  );
}
