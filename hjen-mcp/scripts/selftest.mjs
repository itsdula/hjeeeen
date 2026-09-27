// hjen-mcp self-test — a readable "does it work?" report you can run anytime.
//   READ  section: runs the read tools against your REAL projects (read-only).
//   WRITE section: runs the write tools against a THROWAWAY temp root, so your
//                  real data is never touched. The temp root is deleted after.
//
// Usage (via try.sh):  ./try.sh [read|write|all]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RUN = process.argv[2];
const MODE = (process.argv[3] || 'all').toLowerCase();

function connect(env) {
  const srv = spawn(RUN, [], { stdio: ['pipe', 'pipe', 'ignore'], env });
  let buf = ''; const pending = new Map();
  srv.stdout.setEncoding('utf8');
  srv.stdout.on('data', (c) => { buf += c; let nl; while ((nl = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1); if (!l) continue; let m; try { m = JSON.parse(l); } catch { continue; } if (m.id != null && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } });
  let idc = 0;
  const call = (method, params) => new Promise(r => { const id = ++idc; pending.set(id, r); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  const tool = async (name, args = {}) => { const res = await call('tools/call', { name, arguments: args }); return res.result ? JSON.parse(res.result.content[0].text) : { error: res.error }; };
  return { call, tool, close: () => srv.kill() };
}

const hr = (t) => console.log(`\n\x1b[1m════ ${t} ════\x1b[0m`);

async function readDemo() {
  const c = connect(process.env);
  const init = await c.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'selftest', version: '1' } });
  const tools = (await c.call('tools/list', {})).result.tools.map(t => t.name);

  hr('READ — against your real projects');
  console.log(`server: ${init.result.serverInfo.name} · ${tools.length} tools`);
  const list = await c.tool('hjen_projects_list');
  console.log(`projects (${list.count}) @ ${list.projectsRoot}`);
  for (const p of list.projects.slice(0, 8)) console.log(`  • ${p.name.padEnd(28)} [${p.slug}]  stage ${p.currentStage ?? 1}`);

  const first = list.projects[0];
  if (first) {
    const ov = await c.tool('hjen_project_overview', { project: first.id });
    console.log(`\noverview "${ov.project.name}":`);
    console.log(`  stages   ${ov.contract.stages.map(s => `${s.stage}${s.status === 'signed' ? '✓' : '·'}`).join(' ')}`);
    console.log(`  ledger   ${ov.contract.ledger.length} · storyboard ${ov.storyboard.present ? JSON.stringify(ov.storyboard.counts) : 'none'} · graph ${ov.nodeGraph.present ? ov.nodeGraph.counts.nodes + ' nodes' : 'none'}`);
    console.log(`  gens     ${ov.generations.total} · library ${JSON.stringify(ov.library.byCategory)} · cast ${ov.cast.length}`);
    console.log(`  open     ${ov.deepLinks.overview}`);
  }
  const models = await c.tool('hjen_models_list');
  console.log(`\nmodels: ${models.map(m => m.id).join(', ')}`);
  c.close();
}

async function writeDemo() {
  const sandbox = path.join(os.tmpdir(), 'hjen-mcp-selftest');
  fs.rmSync(sandbox, { recursive: true, force: true });
  const userdata = path.join(sandbox, '_userdata');
  fs.mkdirSync(userdata, { recursive: true });
  fs.writeFileSync(path.join(userdata, 'projects.json'), '[]');
  const c = connect({ ...process.env, HJEN_PROJECTS_ROOT: sandbox, HJEN_USERDATA: userdata });
  await c.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'selftest-w', version: '1' } });

  hr('WRITE — on a throwaway root (your data untouched)');
  console.log(`sandbox: ${sandbox}`);
  const proj = await c.tool('hjen_project_create', { name: 'Try HJEN MCP' });
  console.log(`  created  ${proj.name} [${proj.slug}]`);
  await c.tool('hjen_stage_write', { project: proj.id, stage: 1, data: { restatement: 'Quiet dignity of arrival.' }, markdown: '# Brief\nQuiet dignity.' });
  const sign = await c.tool('hjen_stage_sign', { project: proj.id, stage: 1 });
  console.log(`  brief    written + signed (${sign.status.signedAt?.slice(0, 19)})`);
  await c.tool('hjen_ledger_add', { project: proj.id, kind: 'risk', body: 'Casting the father is the whole KV.' });
  const shot = await c.tool('hjen_storyboard_shot_upsert', { project: proj.id, shot: { scene: 14, letter: 'A', description: 'Father waits at the platform edge.', shot: 'MCU', priority: 'A' } });
  console.log(`  shot     panel ${shot.panelId} added`);
  const graph = await c.tool('hjen_graph_upsert', { project: proj.id, nodes: [{ id: 'n1', type: 'frame' }, { id: 'n2', type: 'video' }], edges: [{ id: 'e1', from: { node: 'n1', param: 'image' }, to: { node: 'n2', param: 'startFrame' } }] });
  console.log(`  graph    ${graph.counts.nodes} nodes, ${graph.counts.edges} edge`);
  const ov = await c.tool('hjen_project_overview', { project: proj.id });
  console.log(`  verify   stage1=${ov.contract.stages[0].status} · ledger=${ov.contract.ledger.length} · shots=${ov.storyboard.counts.shots} · nodes=${ov.nodeGraph.counts.nodes}`);
  c.close();
  fs.rmSync(sandbox, { recursive: true, force: true });
  console.log('  cleanup  sandbox removed');
}

async function main() {
  if (MODE === 'read' || MODE === 'all') await readDemo();
  if (MODE === 'write' || MODE === 'all') await writeDemo();
  console.log('\n\x1b[32m✅ self-test complete — the MCP is answering over stdio.\x1b[0m');
  console.log('Real usage: open a NEW Claude session, type /mcp, then ask e.g. "give me an overview of project arri".');
  process.exit(0);
}
setTimeout(() => { console.error('TIMEOUT'); process.exit(3); }, 20000);
main();
