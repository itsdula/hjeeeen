import { useEffect, useMemo, useState } from 'react';
import { syncStagesToCreativeGraph } from '../../lib/creativegraph/stageSync';
import type { CreativeNode, ProjectCreativeGraph } from '../../lib/creativegraph/projectGraph';
import { evaluateCreativeGraph } from '../../lib/creativegraph/quality';
import { BENCHMARK_DIMENSIONS, BENCHMARK_PASS, evaluateBenchmarkReadiness } from '../../lib/creativegraph/benchmark';

const LANE: Record<string, number> = {
  source: 0, insight: 1, idea: 2, decision: 2, craft: 3,
  evidence: 1, critic: 2, artifact: 4, projection: 4,
};

interface Placed { node: CreativeNode; x: number; y: number }

export function CreativeGraphMap({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [graph, setGraph] = useState<ProjectCreativeGraph | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [inspectMode, setInspectMode] = useState<'node' | 'quality' | 'traces' | 'benchmark'>('node');
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    syncStagesToCreativeGraph(projectId)
      .then(value => { if (live) { setGraph(value); setSelected(value.nodes[0]?.id ?? null); } })
      .catch(err => { if (live) setError(String(err?.message || err)); });
    return () => { live = false; };
  }, [projectId]);

  const placed = useMemo<Placed[]>(() => {
    if (!graph) return [];
    const counts = new Map<number, number>();
    return graph.nodes.map(node => {
      const lane = LANE[node.kind] ?? 2;
      const row = counts.get(lane) ?? 0; counts.set(lane, row + 1);
      return { node, x: 90 + lane * 245, y: 120 + row * 145 };
    });
  }, [graph]);
  const pos = useMemo(() => new Map(placed.map(item => [item.node.id, item])), [placed]);
  const active = graph?.nodes.find(node => node.id === selected) ?? null;
  const quality = graph ? evaluateCreativeGraph(graph) : null;
  const benchmark = graph ? evaluateBenchmarkReadiness(graph) : null;

  return (
    <div className="cmgraph" role="dialog" aria-label="Project Creative Graph">
      <header className="cmgraph__head">
        <div><span className="mono-label">PROJECT CREATIVE GRAPH</span><h2>One idea. Every dependency.</h2></div>
        <div className="cmgraph__meta mono-label">QUALITY {quality?.score ?? '—'} · FIDELITY {quality?.contractFidelity ?? '—'} · BENCH READY {benchmark?.percent ?? '—'} · REV {graph?.revision ?? '—'}</div>
        <div className="cmgraph__modes">
          <button className={inspectMode === 'quality' ? 'is-on' : ''} onClick={() => setInspectMode('quality')}>Quality</button>
          <button className={inspectMode === 'traces' ? 'is-on' : ''} onClick={() => setInspectMode('traces')}>Traces</button>
          <button className={inspectMode === 'benchmark' ? 'is-on' : ''} onClick={() => setInspectMode('benchmark')}>Benchmark</button>
        </div>
        <button className="cmgraph__close" onClick={onClose}>Close</button>
      </header>
      {error ? <div className="cmgraph__error">{error}</div> : !graph ? <div className="cmgraph__loading">Reading the project graph…</div> : (
        <div className="cmgraph__body">
          <div className="cmgraph__canvas">
            <div className="cmgraph__lanes mono-label"><span>TRUTH</span><span>EVIDENCE</span><span>IDEA</span><span>CRAFT</span><span>DELIVERY</span></div>
            <svg className="cmgraph__edges" viewBox="0 0 1250 720" preserveAspectRatio="none" aria-hidden="true">
              {graph.edges.map(edge => {
                const a = pos.get(edge.from); const b = pos.get(edge.to);
                if (!a || !b) return null;
                const x1 = a.x + 176, y1 = a.y + 40, x2 = b.x, y2 = b.y + 40;
                return <path key={edge.id} d={`M${x1},${y1} C${x1 + 70},${y1} ${x2 - 70},${y2} ${x2},${y2}`} />;
              })}
            </svg>
            {placed.map(({ node, x, y }) => (
              <button key={node.id} style={{ left: x, top: y }}
                className={`cmgraph-node is-${node.status}${selected === node.id ? ' is-selected' : ''}`}
                onClick={() => { setSelected(node.id); setInspectMode('node'); }}>
                <span className="cmgraph-node__kind mono-label">{node.kind}</span>
                <strong>{node.label}</strong>
                <span className="cmgraph-node__foot mono-label">V{node.version} · {node.status}</span>
              </button>
            ))}
          </div>
          <aside className="cmgraph__inspect">
            {inspectMode === 'quality' && quality ? <>
              <span className="mono-label">CONTRACT QUALITY</span><h3>{quality.score}/100</h3>
              <div className="cmgraph-checks">{quality.checks.map(check => <p className={check.pass ? 'is-pass' : 'is-fail'} key={check.id}><b>{check.pass ? 'PASS' : 'FAIL'}</b>{check.note}</p>)}</div>
            </> : inspectMode === 'traces' && graph ? <>
              <span className="mono-label">CONSUMER TRACES</span><h3>{graph.traces.length} handoffs</h3>
              <div className="cmgraph-traces">{graph.traces.length ? graph.traces.slice().reverse().map(trace => <p key={trace.id}><b>{trace.surface}</b>{trace.action}<small>REV {trace.graphRevision} · {trace.nodeIds.join(' · ')}<br />{trace.finishedAt}</small></p>) : <p>No tool has applied a projection yet.</p>}</div>
            </> : inspectMode === 'benchmark' && benchmark ? <>
              <span className="mono-label">BLIND BENCHMARK READINESS</span><h3>{benchmark.percent}% ready</h3>
              <p className="cmgraph-benchmark__truth">This is readiness, not a creative score. HJEN earns a score only after anonymous A/B judging on real briefs.</p>
              <div className="cmgraph-checks">{benchmark.checks.map(check => <p className={check.pass ? 'is-pass' : 'is-fail'} key={check.label}><b>{check.pass ? 'READY' : 'BLOCK'}</b>{check.label}</p>)}</div>
              <div className="cmgraph__prov"><span className="mono-label">GLOBAL BAR · 100 POINTS</span>{BENCHMARK_DIMENSIONS.map(d => <p key={d.id}><b>{d.weight}% · {d.label}</b><small>{d.failure}</small></p>)}</div>
              <pre>{JSON.stringify(BENCHMARK_PASS, null, 2)}</pre>
            </> : active ? <>
              <span className={`cmgraph__status is-${active.status} mono-label`}>{active.status}</span>
              <h3>{active.label}</h3>
              <div className="cmgraph__finger mono-label">{active.id} · V{active.version}<br />{active.fingerprint}</div>
              <pre>{JSON.stringify(active.payload, null, 2)}</pre>
              <div className="cmgraph__prov">
                <span className="mono-label">PROVENANCE</span>
                {active.provenance.slice(-4).reverse().map((item, index) => <p key={`${item.at}-${index}`}>{item.surface}{item.stage ? ` · Stage 0${item.stage}` : ''}<small>{item.at}</small></p>)}
              </div>
            </> : <p>Select a node to inspect its contract.</p>}
          </aside>
        </div>
      )}
    </div>
  );
}
